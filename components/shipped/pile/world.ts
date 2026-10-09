// The pile's physics: raw rapier, 1 unit = 10 cm. A counter, four invisible walls just inside the frame, and
// one dynamic body per crumpled receipt with a lumpy convex hull from the crumple twin. Fixed 1/60 s steps
// with an accumulator; poses are interpolated between the last two steps, so 120 Hz screens stay smooth.
// Paper balls are light and draggy: they settle quickly, and once every ball has been still for a moment the
// world stops stepping (and the render loop with it) until something is added, removed or thrown.
import type * as RapierNS from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Rapier = typeof RapierNS.default;

export const GRAVITY = -98.1;
const STEP = 1 / 60;
const MAX_STEPS = 4;
const QUIET_LINEAR = 0.12;
const QUIET_ANGULAR = 0.35;
const QUIET_TIME = 0.35;
const DENSITY = 30;
const LINEAR_DAMPING = 0.45;
const ANGULAR_DAMPING = 3;
const SETTLE_ANGULAR_DAMPING = 12;

export type Bounds = { hx: number; hz: number; height: number };

export type BodyInit = {
  hull: Float32Array;
  radius: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  linvel?: THREE.Vector3;
  angvel?: THREE.Vector3;
  ccd?: boolean;
  /** Add it without waking the world (it's put exactly where it rests). */
  still?: boolean;
};

export class PileWorld {
  readonly R: Rapier;
  readonly world: RapierNS.World;
  private queue: RapierNS.EventQueue;
  private bodies: (RapierNS.RigidBody | null)[];
  private slotOf = new Map<number, number>();
  private prev: Float32Array;
  private curr: Float32Array;
  /** Frames of pose writes still owed to the renderer (2 while moving, 1 for the final pose). */
  readonly dirty: Uint8Array;
  private quiet: Float32Array;
  private watch: Float32Array;
  /** Seconds of heavy damping left after a thrown ball's first impact (paper soaks up the blow). */
  private brake: Float32Array;
  private acc = 0;
  private time = 0;
  private active = false;
  private settling = false;
  // Reused for every read from rapier (no allocation per step).
  private tv = { x: 0, y: 0, z: 0 };
  private tw = { x: 0, y: 0, z: 0 };
  private tq = { x: 0, y: 0, z: 0, w: 1 };
  awake = 0;
  onContact: ((slot: number, strength: number) => void) | null = null;
  /** Lab timing of each rapier step (start, ms). */
  onStep: ((start: number, ms: number) => void) | null = null;

  constructor(R: Rapier, capacity: number, bounds: Bounds) {
    this.R = R;
    this.world = new R.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = STEP;
    this.world.lengthUnit = 10;
    this.queue = new R.EventQueue(true);
    this.bodies = new Array(capacity).fill(null);
    this.prev = new Float32Array(capacity * 7);
    this.curr = new Float32Array(capacity * 7);
    this.dirty = new Uint8Array(capacity);
    this.quiet = new Float32Array(capacity);
    this.watch = new Float32Array(capacity);
    this.brake = new Float32Array(capacity);

    const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setFriction(0.9).setRestitution(0.05), ground);
    this.setBounds(bounds);
  }

  private walls: RapierNS.RigidBody[] = [];

  /** Four invisible walls just inside the frame (moved when the frame changes). */
  setBounds(bounds: Bounds) {
    const { R } = this;
    this.walls.forEach((body) => this.world.removeRigidBody(body));
    const t = 0.5;
    const h = bounds.height;
    const walls: [number, number, number, number, number, number][] = [
      [bounds.hx + t, h / 2, 0, t, h / 2, bounds.hz + 2 * t],
      [-bounds.hx - t, h / 2, 0, t, h / 2, bounds.hz + 2 * t],
      [0, h / 2, bounds.hz + t, bounds.hx + 2 * t, h / 2, t],
      [0, h / 2, -bounds.hz - t, bounds.hx + 2 * t, h / 2, t],
    ];
    this.walls = walls.map(([x, y, z, hx, hy, hz]) => {
      const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
      this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.4).setRestitution(0.05), body);
      return body;
    });
  }

  has(slot: number): boolean {
    return this.bodies[slot] !== null;
  }

  add(slot: number, init: BodyInit) {
    this.remove(slot, false);
    const { R } = this;
    const p = init.position;
    const q = init.quaternion;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANGULAR_DAMPING)
      .setCcdEnabled(Boolean(init.ccd));
    if (init.linvel) desc.setLinvel(init.linvel.x, init.linvel.y, init.linvel.z);
    if (init.angvel) desc.setAngvel({ x: init.angvel.x, y: init.angvel.y, z: init.angvel.z });
    if (this.settling) desc.setAngularDamping(SETTLE_ANGULAR_DAMPING);
    const body = this.world.createRigidBody(desc);
    const shape = R.ColliderDesc.convexHull(init.hull) ?? R.ColliderDesc.roundCuboid(init.radius * 0.6, init.radius * 0.5, init.radius * 0.55, init.radius * 0.2);
    shape
      .setDensity(DENSITY)
      .setFriction(0.85)
      .setRestitution(0.1)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(160)
      // A hair of skin: resting balls keep a millimetre apart instead of sinking into each other.
      .setContactSkin(0.006);
    const collider = this.world.createCollider(shape, body);
    this.slotOf.set(collider.handle, slot);
    this.bodies[slot] = body;
    this.quiet[slot] = 0;
    this.watch[slot] = init.linvel ? 3 : 0;
    this.brake[slot] = init.linvel ? -1 : 0;
    this.read(slot, this.curr);
    this.keep(slot);
    this.dirty[slot] = 2;
    if (!init.still) this.wake();
  }

  remove(slot: number, wake = true) {
    const body = this.bodies[slot];
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) this.slotOf.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
    this.bodies[slot] = null;
    this.dirty[slot] = 0;
    // Whatever rested on it falls into the gap.
    if (wake) this.wakeAll();
  }

  wakeAll() {
    this.bodies.forEach((body) => body?.wakeUp());
    this.wake();
  }

  /** Is the world stepping (something still moving)? */
  get moving(): boolean {
    return this.active;
  }

  /** Listen for this body's landing (contact sounds) for a few seconds. */
  watchLanding(slot: number, seconds = 3) {
    this.watch[slot] = seconds;
  }

  /** prev = curr for one body (no views, no allocation). */
  private keep(slot: number) {
    const o = slot * 7;
    for (let k = 0; k < 7; k++) this.prev[o + k] = this.curr[o + k];
  }

  private read(slot: number, into: Float32Array) {
    const body = this.bodies[slot];
    if (!body) return;
    const t = body.translation(this.tv);
    const r = body.rotation(this.tq);
    const o = slot * 7;
    into[o] = t.x;
    into[o + 1] = t.y;
    into[o + 2] = t.z;
    into[o + 3] = r.x;
    into[o + 4] = r.y;
    into[o + 5] = r.z;
    into[o + 6] = r.w;
  }

  private stepOnce() {
    const start = this.onStep ? performance.now() : 0;
    this.world.step(this.queue);
    if (this.onStep) this.onStep(start, performance.now() - start);
    this.time += STEP;
    let restless = 0;
    for (let slot = 0; slot < this.bodies.length; slot++) {
      const body = this.bodies[slot];
      if (!body) continue;
      if (this.watch[slot] > 0) this.watch[slot] -= STEP;
      if (this.brake[slot] > 0) {
        this.brake[slot] -= STEP;
        if (this.brake[slot] <= 0) {
          this.brake[slot] = 0;
          body.setLinearDamping(LINEAR_DAMPING);
          body.setAngularDamping(ANGULAR_DAMPING);
        }
      }
      this.keep(slot);
      if (body.isSleeping()) {
        // Rapier's own sleep (after a couple of seconds at rest): nothing to read.
        if (this.dirty[slot] === 2) this.dirty[slot] = 1;
        continue;
      }
      this.read(slot, this.curr);
      this.dirty[slot] = 2;
      const v = body.linvel(this.tv);
      const w = body.angvel(this.tw);
      const still = Math.hypot(v.x, v.y, v.z) < QUIET_LINEAR && Math.hypot(w.x, w.y, w.z) < QUIET_ANGULAR;
      this.quiet[slot] = still ? this.quiet[slot] + STEP : 0;
      if (this.quiet[slot] < QUIET_TIME) restless++;
    }
    // Everything has been still for a moment: stop stepping until something happens. (Never body.sleep():
    // a body put to sleep by hand loses its contacts and falls through the counter when it wakes.)
    this.awake = restless;
    if (restless === 0) this.pause();
    if (this.onContact) {
      this.queue.drainContactForceEvents((event) => {
        const a = this.slotOf.get(event.collider1());
        const b = this.slotOf.get(event.collider2());
        const slot = a !== undefined && this.watch[a] > 0 ? a : b !== undefined && this.watch[b] > 0 ? b : -1;
        if (slot < 0) return;
        if (this.brake[slot] < 0) {
          const body = this.bodies[slot];
          this.brake[slot] = 0.45;
          body?.setLinearDamping(4);
          body?.setAngularDamping(6);
        }
        const strength = Math.min(1, Math.max(0, (event.totalForceMagnitude() - 160) / 2600));
        if (strength > 0.02) this.onContact?.(slot, strength);
      });
    } else {
      this.queue.clear();
    }
  }

  /** Advance by a frame's time; returns the interpolation factor between the last two steps. */
  update(frameDt: number): number {
    if (!this.active) return 1;
    this.acc += Math.min(frameDt, STEP * MAX_STEPS);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS && this.active) {
      this.stepOnce();
      this.acc -= STEP;
      steps++;
    }
    return this.active ? this.acc / STEP : 1;
  }

  /** Start stepping again (something was added, removed or thrown). */
  wake() {
    if (this.active) return;
    this.active = true;
    this.acc = 0;
    this.quiet.fill(0);
    this.awake = 1;
  }

  /** Stop stepping: every pose is final (one last write each). */
  pause() {
    this.active = false;
    this.acc = 0;
    this.awake = 0;
    for (let slot = 0; slot < this.bodies.length; slot++) {
      if (!this.bodies[slot]) continue;
      this.keep(slot);
      if (this.dirty[slot]) this.dirty[slot] = 1;
    }
  }

  /** While the heap is being built: a few steps with rotation damped hard (see settle()). */
  drop(steps: number) {
    this.wake();
    if (!this.settling) {
      this.settling = true;
      this.bodies.forEach((body) => body?.setAngularDamping(SETTLE_ANGULAR_DAMPING));
    }
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  /** Step synchronously for up to `budget` ms (pre-settling). True once everything is still or `maxTime` passed. */
  settle(budget: number, maxTime: number): boolean {
    this.wake();
    // Paper balls barely roll (their lumps catch and they give a little): while the heap forms, damp
    // rotation hard so it holds its slope instead of spreading into a single layer.
    if (!this.settling) {
      this.settling = true;
      this.bodies.forEach((body) => body?.setAngularDamping(SETTLE_ANGULAR_DAMPING));
    }
    const end = performance.now() + budget;
    let done = false;
    do {
      this.stepOnce();
      if (!this.active) done = true;
      else if (this.time >= maxTime) {
        this.pause();
        done = true;
      }
    } while (!done && performance.now() < end);
    if (done) {
      this.settling = false;
      this.bodies.forEach((body) => body?.setAngularDamping(ANGULAR_DAMPING));
    }
    return done;
  }

  resetClock() {
    this.time = 0;
  }

  /** The interpolated pose of a body. */
  pose(slot: number, alpha: number, position: THREE.Vector3, quaternion: THREE.Quaternion, qa: THREE.Quaternion, qb: THREE.Quaternion) {
    const o = slot * 7;
    const p = this.prev;
    const c = this.curr;
    const a = Math.min(1, Math.max(0, alpha));
    position.set(p[o] + (c[o] - p[o]) * a, p[o + 1] + (c[o + 1] - p[o + 1]) * a, p[o + 2] + (c[o + 2] - p[o + 2]) * a);
    qa.set(p[o + 3], p[o + 4], p[o + 5], p[o + 6]);
    qb.set(c[o + 3], c[o + 4], c[o + 5], c[o + 6]);
    quaternion.slerpQuaternions(qa, qb, a);
  }

  /** Current (latest step) position, for picking and anchors. */
  position(slot: number, out: THREE.Vector3): THREE.Vector3 {
    const o = slot * 7;
    return out.set(this.curr[o], this.curr[o + 1], this.curr[o + 2]);
  }

  free() {
    this.bodies.fill(null);
    this.slotOf.clear();
    try {
      this.queue.free();
      this.world.free();
    } catch {
      // A world that panicked stays borrowed and can't be freed; it goes with the page.
    }
  }
}
