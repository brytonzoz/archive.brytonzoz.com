// The pile in 3D, driven imperatively from the canvas's frame loop (no React state per frame):
//   * every pile receipt is one instance of one InstancedMesh (1 draw + 1 shadow pass), its pose written from
//     the physics world, its crumple from a per-instance attribute (only animating instances are uploaded);
//   * the receipt you pick leaves the instanced set and becomes the held sheet: it springs up to a reading
//     pose in front of the camera while it uncrumples, and scrolls with rubber banding and momentum; put back,
//     it balls up again as it drops and rejoins the physics;
//   * your own receipt waits flat in your hand at the bottom of the frame; flick it (or press the key) and it
//     balls up in flight and lands on the pile, where it's just another receipt;
//   * a printer elsewhere on the page can toss a ball in (receive()).
// The loop runs only while something moves; when the pile is still and nothing animates, rendering stops.
import * as THREE from 'three';
import { rubber, spring, type SpringConfig } from '../physics';
import { crumple as crumpleSound, land, uncrumple, whoosh } from '../thermal/sfx';
import type { Raster } from '../thermal/raster';
import type { ScreenRect, TossPayload } from '../thermal/toss';
import type { ThermalReceipt } from '../thermal/types';
import { ATLAS_SLOTS, InkAtlas } from './atlas';
import { FLAT_CRUMPLE, PILE_GRID, SHEET_W, heldLength, pileLength, restCrumple, shapeHull, shapeSeed, type Hull, type Seed4 } from './crumple';
import { MASK_ALPHA, MASK_RED, createContactMaterial, createCounterMaterial, createPaper, createSheetGeometry, type PaperSet } from './material';
import { BurnQueue, docDots, tileFrom, type Tile } from './rasters';
import { GRAVITY, PileWorld, type Rapier } from './world';

export type Anchor = { id: string; label: string; x: number; y: number; r: number };

export type EngineCallbacks = {
  onReady(): void;
  onOpen(receipt: ThermalReceipt | null): void;
  onOwnTossed(receipt: ThermalReceipt): void;
  onLanded(receipt: ThermalReceipt): void;
  onAnchors(anchors: Anchor[]): void;
  onHandRect(rect: { x: number; y: number; width: number; height: number } | null): void;
  onCursor(cursor: string): void;
  /** Something threw outside a caller's frame (the heap being built on a timer): the 3D pile is done. */
  onError(error: unknown): void;
};

export type EngineOptions = {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  invalidate: () => void;
  R: Rapier;
  receipts: ThermalReceipt[];
  own: ThermalReceipt | null;
  ownRaster: Raster | null;
  capacity: number;
  reduced: boolean;
  crumple: number | null;
  fontFamily: string;
  phone: boolean;
  debug: boolean;
  callbacks: EngineCallbacks;
};

type Slot = {
  receipt: ThermalReceipt;
  seed: Seed4;
  length: number;
  rest: number;
  hull: Hull;
  tile: THREE.Vector4;
  tileSlot: number;
  hidden: boolean;
  /** Crumple / length currently drawn, and an animation toward new values. */
  crumple: number;
  len: number;
  anim: { from: number; to: number; lenFrom: number; lenTo: number; start: number; dur: number } | null;
  burning: { cancel(): void } | null;
  landing: boolean;
  order: number;
};

type Pose = { p: THREE.Vector3; q: THREE.Quaternion };

type Held = {
  slot: number;
  phase: 'lift' | 'read' | 'drop';
  start: number;
  t: number;
  v: number;
  from: Pose;
  to: Pose;
  c0: number;
  len0: number;
  lenH: number;
  scroll: number;
  scrollV: number;
  min: number;
  max: number;
  texture: THREE.Texture | null;
  burn: { cancel(): void } | null;
};

type Hand = {
  receipt: ThermalReceipt;
  seed: Seed4;
  length: number;
  raster: Raster | null;
  texture: THREE.Texture | null;
  /** Its atlas tile, made ahead (in idle time) so the toss only has to upload it. */
  tile: Tile | null;
  /** Drag offset from the resting pose (css px) and its spring velocity. */
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  dragging: boolean;
  springing: boolean;
};

type Gesture = {
  id: number;
  kind: 'tap' | 'scroll' | 'hand';
  x0: number;
  y0: number;
  t0: number;
  lx: number;
  ly: number;
  lt: number;
  vx: number;
  vy: number;
  moved: boolean;
  scroll0: number;
};

const LIFT = spring(0.52, 0.2);
const HAND_BACK = spring(0.42, 0.18);
const SCROLL_BACK = spring(0.4, 0);

/** physics.ts's springStep without the tuple: returns the new position, leaves the new velocity in springV. */
let springV = 0;
function springTo(x: number, v: number, target: number, config: SpringConfig, dt: number): number {
  springV = v + (-config.stiffness * (x - target) - config.damping * v) * dt;
  return x + springV * dt;
}
const ELEVATION = (55 * Math.PI) / 180;
const UP = new THREE.Vector3(0, 1, 0);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inQuad: (t: number) => t * t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

function receiptLabel(receipt: ThermalReceipt): string {
  return `${receipt.who}, ${receipt.count} ${receipt.count === 1 ? 'item' : 'items'}`;
}

export class PileEngine {
  private o: EngineOptions;
  private cb: EngineCallbacks;
  private capacity: number;
  private slots: (Slot | null)[];
  private order = 0;
  private world: PileWorld;
  private atlas = new InkAtlas();
  private queue: BurnQueue;
  private paper: PaperSet;
  private heldPaper: PaperSet;
  private handPaper: PaperSet;
  private geometry: THREE.BufferGeometry;
  private sheetGeometry: THREE.BufferGeometry;
  private mesh: THREE.InstancedMesh;
  private heldMesh: THREE.Mesh;
  private handMesh: THREE.Mesh;
  private contacts: THREE.InstancedMesh;
  private contactAttr: THREE.InstancedBufferAttribute;
  private contactMaterial: THREE.ShaderMaterial;
  private counter: THREE.Mesh;
  private counterMaterial: THREE.MeshPhysicalMaterial;
  private lamp: THREE.SpotLight;
  private fill: THREE.HemisphereLight;
  private seedAttr: THREE.InstancedBufferAttribute;
  private crumpleAttr: THREE.InstancedBufferAttribute;
  private tileAttr: THREE.InstancedBufferAttribute;
  private lengthAttr: THREE.InstancedBufferAttribute;
  private bounds = { hx: 1.6, hz: 1.3, height: 1.8 };
  private top = 0.8;
  /** Half extents of the settled pile (balls included), once it has settled. */
  private extent: { x: number; z: number } | null = null;
  /** Leave room at the bottom of the frame for a receipt in hand. */
  private reserveHand = false;
  /** The heap still to be dropped (before the first frame), and its estimated radius. */
  private drops: { slot: number; hull: Hull; x: number; z: number; euler: THREE.Euler }[] = [];
  private heap = 1;
  /** Frames left of the shader warm-up before the pile is shown. */
  private warming = 0;
  private held: Held | null = null;
  private hand: Hand | null = null;
  private gesture: Gesture | null = null;
  private ready = false;
  private visible = true;
  private disposed = false;
  private last = 0;
  private width = 1;
  private height = 1;
  private lastSound = 0;
  private settleTimer = 0;
  private anchorsKey = '';
  private hoverFrame = 0;
  /** Lab timings (only with `debug`): [time, ms] of this engine's work per frame, of the render, of each physics step. */
  private profile: { frame: number[][]; render: number[][]; step: number[][] } | null = null;
  // Scratch, reused every frame.
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private ray = new THREE.Ray();
  private ndc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private camFwd = new THREE.Vector3();
  private handPose: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private restPose: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private euler = new THREE.Euler();
  private handBase = { d: 2, x: 0, y: 0, unit: 0.01, tilt: -0.06, lean: -0.32 };
  private readBase = { d: 2, unit: 0.01, hh: 1 };

  constructor(options: EngineOptions) {
    this.o = options;
    this.cb = options.callbacks;
    this.capacity = Math.min(options.capacity, ATLAS_SLOTS);
    this.slots = new Array(this.capacity).fill(null);
    this.queue = new BurnQueue(options.fontFamily);
    this.queue.onProgress = () => this.kick();
    if (options.debug) this.profile = { frame: [], render: [], step: [] };

    const { gl, scene } = options;
    // No tone mapping: the lamp and fill are set so paper stays below 1, and the palette comes out as specified
    // (Neutral tone mapping crushes dark greys toward orange; the counter must match the page).
    gl.toneMapping = THREE.NoToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.autoUpdate = true;
    scene.background = null;
    gl.setClearColor(0x000000, 0);

    // Pile: one instanced mesh.
    this.geometry = createSheetGeometry(PILE_GRID.across, PILE_GRID.along);
    const cap = this.capacity;
    this.seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.crumpleAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.lengthAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(2), 1);
    this.crumpleAttr.setUsage(THREE.DynamicDrawUsage);
    this.tileAttr.setUsage(THREE.DynamicDrawUsage);
    this.lengthAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aSeed', this.seedAttr);
    this.geometry.setAttribute('aCrumple', this.crumpleAttr);
    this.geometry.setAttribute('aTile', this.tileAttr);
    this.geometry.setAttribute('aLength', this.lengthAttr);
    this.paper = createPaper(true);
    this.paper.paper.uInk.value = this.atlas.texture;
    this.atlas.texture.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
    this.mesh = new THREE.InstancedMesh(this.geometry, this.paper.material, cap);
    this.mesh.customDepthMaterial = this.paper.depth;
    this.mesh.customDistanceMaterial = this.paper.distance;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, HIDE);
    scene.add(this.mesh);

    // The held sheet and the one in your hand: same paper, uniforms instead of attributes, a finer grid.
    this.sheetGeometry = createSheetGeometry(16, 120);
    this.heldPaper = createPaper(false);
    this.heldMesh = new THREE.Mesh(this.sheetGeometry, this.heldPaper.material);
    this.heldMesh.customDepthMaterial = this.heldPaper.depth;
    this.heldMesh.customDistanceMaterial = this.heldPaper.distance;
    this.heldMesh.castShadow = true;
    this.heldMesh.receiveShadow = true;
    this.heldMesh.frustumCulled = false;
    this.heldMesh.visible = false;
    this.heldMesh.matrixAutoUpdate = false;
    scene.add(this.heldMesh);

    this.handPaper = createPaper(false);
    this.handMesh = new THREE.Mesh(this.sheetGeometry, this.handPaper.material);
    this.handMesh.customDepthMaterial = this.handPaper.depth;
    this.handMesh.customDistanceMaterial = this.handPaper.distance;
    this.handMesh.castShadow = false;
    this.handMesh.receiveShadow = false;
    this.handMesh.frustumCulled = false;
    this.handMesh.visible = false;
    this.handMesh.matrixAutoUpdate = false;
    scene.add(this.handMesh);

    // Counter and contact shadows.
    this.counterMaterial = createCounterMaterial();
    this.counter = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.counterMaterial);
    this.counter.rotation.x = -Math.PI / 2;
    this.counter.receiveShadow = true;
    scene.add(this.counter);

    const blob = new THREE.PlaneGeometry(1, 1);
    blob.rotateX(-Math.PI / 2);
    this.contactAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.contactAttr.setUsage(THREE.DynamicDrawUsage);
    blob.setAttribute('aContact', this.contactAttr);
    this.contactMaterial = createContactMaterial();
    this.contacts = new THREE.InstancedMesh(blob, this.contactMaterial, cap);
    this.contacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.contacts.frustumCulled = false;
    this.contacts.renderOrder = -1;
    for (let i = 0; i < cap; i++) this.contacts.setMatrixAt(i, HIDE);
    scene.add(this.contacts);

    // One warm lamp above and in front of the pile, and a low cool fill.
    this.lamp = new THREE.SpotLight(0xffe4ba, 1.6, 0, 0.8, 1, 0);
    this.lamp.position.set(-3.4, 12.5, 6.2);
    this.lamp.target.position.set(0.15, 0.2, -0.35);
    this.lamp.castShadow = true;
    const size = options.phone ? 1024 : 2048;
    this.lamp.shadow.mapSize.set(size, size);
    this.lamp.shadow.radius = options.phone ? 3 : 4;
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.012;
    this.lamp.shadow.camera.near = 5;
    this.lamp.shadow.camera.far = 24;
    this.lamp.shadow.focus = 0.62;
    scene.add(this.lamp);
    scene.add(this.lamp.target);
    this.fill = new THREE.HemisphereLight(0xe4e9f0, 0x141518, 1.3);
    scene.add(this.fill);

    // Physics bounds from the pile's size.
    const receipts = options.receipts.slice(0, this.capacity - (options.own ? 1 : 0));
    const inputs = receipts.map((receipt) => this.makeSlotInput(receipt, options.crumple));
    let volume = 0;
    let largest = 0;
    inputs.forEach((input) => {
      volume += (4 / 3) * Math.PI * Math.pow(input.hull.radius * 0.8, 3);
      largest = Math.max(largest, input.hull.radius);
    });
    const heap = Math.max(0.9, Math.cbrt((3 * (volume / 0.55)) / (0.55 * Math.PI)));
    this.bounds = { hx: Math.max(heap + 0.3, largest + 0.3), hz: Math.max(heap * 0.8 + 0.25, largest + 0.2), height: 1.9 };
    this.top = Math.min(1.4, heap * 0.6);
    this.world = new PileWorld(options.R, this.capacity, this.bounds);
    this.world.onContact = (slot, strength) => this.contact(slot, strength);
    if (this.profile) {
      const profile = this.profile;
      this.world.onStep = (start, ms) => record(profile.step, start, ms);
    }

    // The heap is built the way a real one is: dropped one at a time near the middle (largest first), each
    // finding its place before the next (start() runs it in slices before the first 3D frame).
    const random = mulberry(inputs.length * 7919 + 13);
    this.drops = inputs
      .map((input) => ({ input, slot: this.insert(input) }))
      .sort((a, b) => b.input.hull.radius - a.input.hull.radius)
      .map(({ input, slot }) => {
        const a = random() * Math.PI * 2;
        const rr = heap * 0.25 * Math.sqrt(random());
        return { slot, hull: input.hull, x: Math.cos(a) * rr, z: Math.sin(a) * rr * 0.8, euler: new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28) };
      });
    this.heap = heap;

    this.reserveHand = Boolean(options.own);
    if (options.own) this.setOwn(options.own, options.ownRaster);
  }

  // ---- setup ------------------------------------------------------------------------------------------

  private makeSlotInput(receipt: ThermalReceipt, override: number | null) {
    const seed = shapeSeed(receipt.id);
    const length = pileLength(docDots(receipt));
    const rest = override ?? restCrumple(receipt.id);
    const hull = shapeHull({ seed, length, crumple: rest });
    return { receipt, seed, length, rest, hull };
  }

  /** Put a receipt in a free instance (evicting the lowest ball if the pile is full). */
  private insert(input: ReturnType<PileEngine['makeSlotInput']>, crumpleNow?: number, lengthNow?: number, source?: Raster | Tile | null): number {
    let index = this.slots.indexOf(null);
    if (index < 0) index = this.evict();
    const slot: Slot = {
      ...input,
      tile: new THREE.Vector4(0, 0, 0, 0),
      tileSlot: -1,
      hidden: false,
      crumple: crumpleNow ?? input.rest,
      len: lengthNow ?? input.length,
      anim: null,
      burning: null,
      landing: false,
      order: this.order++,
    };
    this.slots[index] = slot;
    this.seedAttr.setXYZW(index, slot.seed[0], slot.seed[1], slot.seed[2], slot.seed[3]);
    this.seedAttr.needsUpdate = true;
    this.writeCrumple(index, slot.crumple, slot.len);
    this.tileAttr.setXYZW(index, 0, 0, 0, 0);
    this.tileAttr.needsUpdate = true;
    this.requestTile(index, source);
    return index;
  }

  /** Free the instance of the lowest ball that isn't busy. */
  private evict(): number {
    let pick = -1;
    let lowest = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot || slot.hidden || slot.anim || slot.landing || this.held?.slot === i) continue;
      const y = this.world.position(i, this.v).y;
      if (y < lowest) {
        lowest = y;
        pick = i;
      }
    }
    if (pick < 0) pick = 0;
    this.release(pick);
    return pick;
  }

  private release(index: number) {
    const slot = this.slots[index];
    if (!slot) return;
    slot.burning?.cancel();
    this.atlas.release(slot.tileSlot);
    this.world.remove(index, !this.o.reduced);
    this.mesh.setMatrixAt(index, HIDE);
    this.contacts.setMatrixAt(index, HIDE);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.contacts.instanceMatrix.needsUpdate = true;
    this.slots[index] = null;
  }

  private writeCrumple(index: number, crumple: number, length: number) {
    this.crumpleAttr.setX(index, crumple);
    this.lengthAttr.setX(index, length);
    this.crumpleAttr.addUpdateRange(index, 1);
    this.lengthAttr.addUpdateRange(index, 1);
    this.crumpleAttr.needsUpdate = true;
    this.lengthAttr.needsUpdate = true;
  }

  /** Copy the receipt's tile into the atlas: one made already, one from a burned raster, or burn it in idle time. */
  private requestTile(index: number, source?: Raster | Tile | null) {
    const slot = this.slots[index];
    if (!slot) return;
    const tileSlot = this.atlas.allocate(slot.receipt.id);
    if (tileSlot < 0) return;
    slot.tileSlot = tileSlot;
    const apply = (from: Raster | Tile) => {
      if (this.disposed || this.slots[index] !== slot) return;
      slot.burning = null;
      this.atlas.write(this.o.gl, tileSlot, 'data' in from ? from : tileFrom(from), slot.tile);
      this.tileAttr.setXYZW(index, slot.tile.x, slot.tile.y, slot.tile.z, slot.tile.w);
      this.tileAttr.needsUpdate = true;
      if (this.held?.slot === index && !this.held.texture) this.heldPaper.sheet!.aTile.value.copy(slot.tile);
      this.kick();
    };
    if (source) {
      if (!('data' in source)) source.burn();
      apply(source);
      return;
    }
    const job = this.queue.burn(slot.receipt, -slot.order);
    slot.burning = job;
    job.promise.then(apply).catch(() => undefined);
  }

  /** Pre-settle in slices so the first 3D frame shows a pile already at rest. */
  start() {
    let next = 0;
    let dropTop = 0;
    const slice = () => {
      if (this.disposed) return;
      try {
        build();
      } catch (error) {
        this.cb.onError(error);
      }
    };
    const build = () => {
      const end = performance.now() + 8;
      // Drop the balls, a dozen physics steps apart.
      while (next < this.drops.length && performance.now() < end) {
        const drop = this.drops[next++];
        this.q.setFromEuler(drop.euler);
        this.p.set(drop.x, dropTop + drop.hull.radius + 0.05, drop.z);
        this.world.add(drop.slot, { hull: drop.hull.points, radius: drop.hull.radius, position: this.p, quaternion: this.q });
        this.world.drop(12);
        dropTop = 0;
        for (let k = 0; k < next; k++) dropTop = Math.max(dropTop, this.world.position(this.drops[k].slot, this.v).y);
        dropTop = Math.min(dropTop, this.heap * 0.6);
        if (next === this.drops.length) this.world.resetClock();
      }
      // Then let it all come to rest.
      if (next < this.drops.length || !this.world.settle(Math.max(1, end - performance.now()), 4)) {
        this.settleTimer = window.setTimeout(slice, 0);
        return;
      }
      this.drops = [];
      this.world.resetClock();
      this.measureTop();
      // Print the balls you can see first: the top of the heap and the side facing you.
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        if (!slot || !slot.burning || !this.world.has(i)) continue;
        const p = this.world.position(i, this.v);
        this.queue.prioritize(slot.receipt.id, p.y * 2 + p.z);
      }
      this.writeAll();
      this.layout();
      this.queue.schedule();
      // Compile every program now, while the 2D pile is still showing: the held sheet is parked under the
      // counter for the first frames so its colour and shadow programs exist before the first grab.
      this.heldMesh.visible = true;
      this.heldMesh.matrix.makeTranslation(0, -6, 0);
      this.heldMesh.matrixWorldNeedsUpdate = true;
      const warm = () => {
        if (this.disposed) return;
        this.warming = 2;
        this.o.invalidate();
      };
      const gl = this.o.gl;
      if (gl.extensions.has('KHR_parallel_shader_compile')) gl.compileAsync(this.o.scene, this.o.camera).then(warm, warm);
      else {
        gl.compile(this.o.scene, this.o.camera);
        warm();
      }
    };
    this.settleTimer = window.setTimeout(slice, 0);
  }

  /** Height of the settled pile (for framing and for where dropped balls start). */
  private measureTop() {
    let top = 0.3;
    let x = 0.6;
    let z = 0.5;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot || !this.world.has(i)) continue;
      const p = this.world.position(i, this.v);
      const r = slot.hull.radius * 0.85;
      top = Math.max(top, p.y + r);
      x = Math.max(x, Math.abs(p.x) + r);
      z = Math.max(z, Math.abs(p.z) + r);
    }
    this.top = top;
    this.extent = { x: x + 0.12, z: z + 0.12 };
  }

  private writeAll() {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.writePose(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.contacts.instanceMatrix.needsUpdate = true;
    this.contactAttr.needsUpdate = true;
  }

  private writePose(index: number, alpha: number) {
    const slot = this.slots[index];
    if (!slot || slot.hidden || !this.world.has(index)) return;
    this.world.pose(index, alpha, this.p, this.q, this.qa, this.qb);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(index, this.m);
    // Contact shadow: a soft dark patch on the counter under the ball, fading as it lifts off.
    const r = slot.hull.radius * 0.8;
    const lift = Math.max(0, this.p.y - r * 0.7);
    const strength = Math.max(0, 1 - lift / (r * 2.5));
    const scale = r * 2.6 * (1 + lift * 0.6);
    this.w.set(scale, 1, scale);
    this.v.set(this.p.x, 0.002, this.p.z);
    this.m.compose(this.v, this.qa.identity(), this.w);
    this.contacts.setMatrixAt(index, this.m);
    this.contactAttr.setX(index, 0.5 * strength);
  }

  // ---- camera and layout ------------------------------------------------------------------------------

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.layout();
    this.kick();
  }

  private layout() {
    const cam = this.o.camera;
    const aspect = this.width / this.height;
    cam.aspect = aspect;
    cam.fov = aspect < 0.8 ? 44 : aspect < 1.3 ? 38 : 32;
    cam.near = 0.1;
    cam.far = 80;
    // Frame the pile as it lies (or the walls, before it has settled). The framing doesn't change when your
    // receipt leaves your hand, so the camera never jumps mid-throw.
    const ex = this.extent?.x ?? this.bounds.hx;
    const ez = this.extent?.z ?? this.bounds.hz;
    const hasHand = this.reserveHand;
    const yMin = hasHand ? (aspect < 0.8 ? -0.42 : -0.56) : -0.8;
    const yMax = 0.8;
    const xMax = aspect < 0.8 ? 0.88 : 0.74;
    const target = new THREE.Vector3(0, this.top * 0.35, 0);
    const dir = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
    const box = (x: number, z: number, y: number) => {
      const corners: THREE.Vector3[] = [];
      [-x, x].forEach((cx) => [-z, z].forEach((cz) => [0, y].forEach((cy) => corners.push(new THREE.Vector3(cx, cy, cz)))));
      return corners;
    };
    const inside = (corners: THREE.Vector3[], x0: number, y0: number, y1: number) =>
      corners.every((c) => {
        const n = this.w.copy(c).project(cam);
        return n.x > -x0 && n.x < x0 && n.y > y0 && n.y < y1;
      });
    const pile = box(ex, ez, this.top);
    const place = (d: number) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      if (hasHand) {
        // Shift the view so the pile sits in the free space above the hand.
        const off = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * d * ((yMin + yMax) / 2);
        this.camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
        cam.position.addScaledVector(this.camUp, -off);
        cam.updateMatrixWorld();
      }
    };
    let lo = 2;
    let hi = 60;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      place(mid);
      if (inside(pile, xMax, yMin, yMax)) hi = mid;
      else lo = mid;
    }
    place(hi);
    cam.matrixWorld.extractBasis(this.camRight, this.camUp, this.camFwd);
    this.camFwd.negate();

    // The invisible walls: the widest box around the pile that is still entirely in frame.
    if (this.extent) {
      let a = 1;
      let b = 4;
      for (let i = 0; i < 20; i++) {
        const k = (a + b) / 2;
        if (inside(box(ex * k, ez * k, 0.5), 0.97, yMin - 0.04, 0.96)) a = k;
        else b = k;
      }
      const hx = ex * a;
      const hz = ez * a;
      if (Math.abs(hx - this.bounds.hx) > 0.02 || Math.abs(hz - this.bounds.hz) > 0.02) {
        this.bounds = { hx, hz, height: this.bounds.height };
        this.world.setBounds(this.bounds);
      }
    }

    // The reading pose: the sheet fitted to ~92% of the width (capped so it stays a receipt on a desktop).
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const widthPx = Math.min(this.width * 0.92, 500);
    const d = (SHEET_W * this.height) / (2 * tanHalf * widthPx);
    this.readBase = { d, unit: (2 * d * tanHalf) / this.height, hh: d * tanHalf };
    if (this.held) this.scrollLimits(this.held);

    // The receipt in hand: about 78% of the width (capped), its top third showing above the bottom edge.
    const handPx = Math.min(this.width * 0.74, 300);
    const hd = (SHEET_W * this.height) / (2 * tanHalf * handPx);
    const hhh = hd * tanHalf;
    const unit = (2 * hd * tanHalf) / this.height;
    const length = this.hand?.length ?? 2.5;
    const showing = Math.min(length * 0.42, hhh * 2 * (aspect < 0.8 ? 0.4 : 0.36));
    this.handBase = { d: hd, x: aspect < 0.8 ? 0.06 * hhh : 0.18 * hhh * aspect, y: -hhh - length / 2 + showing, unit, tilt: -0.07, lean: -0.3 };
    this.updateHandPose();
    this.emitHandRect();
    this.emitAnchors(true);
  }

  // ---- frame -----------------------------------------------------------------------------------------

  /** Called from useFrame. Advances physics and animations, writes what changed, keeps the loop alive. */
  frame(now: number) {
    if (this.warming > 0 && !this.disposed) {
      // Two frames to compile (colour and shadow passes), then show the pile.
      this.warming--;
      if (this.warming === 0) {
        this.heldMesh.visible = false;
        this.ready = true;
        this.layout();
        this.cb.onReady();
      }
      this.o.invalidate();
      return;
    }
    if (!this.ready || this.disposed) return;
    const t0 = performance.now();
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    let busy = false;

    const alpha = this.world.update(dt);
    let wrote = false;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.world.dirty[i] === 0) continue;
      this.writePose(i, alpha);
      if (this.world.dirty[i] === 1) this.world.dirty[i] = 0;
      wrote = true;
    }
    if (wrote) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.contacts.instanceMatrix.needsUpdate = true;
      this.contactAttr.needsUpdate = true;
    }
    busy = busy || this.world.moving;

    // Instances whose crumple (or length) is animating.
    const ms = performance.now();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot?.anim) continue;
      const k = Math.min(1, (ms - slot.anim.start) / slot.anim.dur);
      const e = ease.outCubic(k);
      slot.crumple = slot.anim.from + (slot.anim.to - slot.anim.from) * e;
      slot.len = slot.anim.lenFrom + (slot.anim.lenTo - slot.anim.lenFrom) * e;
      this.writeCrumple(i, slot.crumple, slot.len);
      if (k >= 1) slot.anim = null;
      else busy = true;
    }

    if (this.held) busy = this.stepHeld(dt, ms) || busy;
    if (this.hand) busy = this.stepHand(dt) || busy;
    if (this.gesture) busy = true;

    // Rasters burn (and tiles are made) only in idle time, between frames, never inside one.
    if (this.queue.pending) this.queue.schedule();

    if (this.profile) record(this.profile.frame, t0, performance.now() - t0);

    if (busy) {
      if (this.visible) this.o.invalidate();
    } else {
      this.last = 0;
      this.emitAnchors(false);
    }
  }

  /** Render another frame (something changed). */
  kick() {
    if (this.ready && this.visible && !this.disposed) this.o.invalidate();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.last = 0;
    if (visible) this.kick();
  }

  // ---- contact sounds ----------------------------------------------------------------------------------

  private contact(index: number, strength: number) {
    const slot = this.slots[index];
    const now = performance.now();
    if (slot?.landing) {
      slot.landing = false;
      this.cb.onLanded(slot.receipt);
    }
    if (now - this.lastSound < 90) return;
    this.lastSound = now;
    land(strength);
  }

  // ---- picking -----------------------------------------------------------------------------------------

  private setRay(clientX: number, clientY: number, rect: DOMRect) {
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.o.camera);
    this.ray.copy(this.raycaster.ray);
  }

  /** The front-most ball under the pointer (bounding spheres from the physics poses, plus a finger's slack). */
  private pick(clientX: number, clientY: number, rect: DOMRect): number {
    this.setRay(clientX, clientY, rect);
    let best = -1;
    let bestT = Infinity;
    let near = -1;
    let nearD = Infinity;
    const slack = 20;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot || slot.hidden || !this.world.has(i)) continue;
      const c = this.world.position(i, this.w);
      const t = this.v.subVectors(c, this.ray.origin).dot(this.ray.direction);
      if (t <= 0) continue;
      const d = this.ray.distanceToPoint(c);
      const r = slot.hull.radius * 0.78;
      if (d < r && t < bestT) {
        best = i;
        bestT = t;
      }
      // Within ~20 css px of a ball counts on a touch screen.
      const pxPerUnit = this.height / (2 * t * Math.tan(THREE.MathUtils.degToRad(this.o.camera.fov) / 2));
      const gap = (d - r) * pxPerUnit;
      if (gap < slack && gap < nearD) {
        near = i;
        nearD = gap;
      }
    }
    return best >= 0 ? best : near;
  }

  /** Is the pointer over the held sheet? */
  private hitsHeld(clientX: number, clientY: number, rect: DOMRect): boolean {
    if (!this.held) return false;
    this.setRay(clientX, clientY, rect);
    const len = this.heldPaper.sheet!.aLength.value;
    this.heldMesh.updateMatrixWorld();
    this.m.copy(this.heldMesh.matrixWorld).invert();
    const origin = this.v.copy(this.ray.origin).applyMatrix4(this.m);
    const end = this.w.copy(this.ray.origin).add(this.ray.direction).applyMatrix4(this.m).sub(origin);
    if (Math.abs(end.z) < 1e-6) return false;
    const t = -origin.z / end.z;
    const x = origin.x + end.x * t;
    const y = origin.y + end.y * t;
    return Math.abs(x) < SHEET_W / 2 + 0.012 && Math.abs(y) < len / 2 + 0.012;
  }

  // ---- the held receipt --------------------------------------------------------------------------------

  /** Open a receipt: by id (keyboard) or by index (a tap). */
  open(id: string) {
    const index = this.slots.findIndex((slot) => slot?.receipt.id === id);
    if (index >= 0) this.grab(index);
  }

  private grab(index: number) {
    const slot = this.slots[index];
    if (!slot || this.held || !this.ready) return;
    const from: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.world.pose(index, 1, from.p, from.q, this.qa, this.qb);
    this.world.remove(index, !this.o.reduced);
    slot.hidden = true;
    slot.anim = null;
    this.mesh.setMatrixAt(index, HIDE);
    this.contacts.setMatrixAt(index, HIDE);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.contacts.instanceMatrix.needsUpdate = true;

    const sheet = this.heldPaper.sheet!;
    sheet.aSeed.value.set(slot.seed[0], slot.seed[1], slot.seed[2], slot.seed[3]);
    sheet.aCrumple.value = slot.crumple;
    sheet.aLength.value = slot.len;
    sheet.aTile.value.copy(slot.tile);
    this.heldPaper.paper.uInk.value = this.atlas.texture;
    this.heldPaper.paper.uInkMask.value.copy(MASK_RED);

    const lenH = heldLength(docDots(slot.receipt));
    const held: Held = {
      slot: index,
      phase: this.o.reduced ? 'read' : 'lift',
      start: performance.now(),
      t: 0,
      v: 0,
      from,
      to: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
      c0: slot.crumple,
      len0: slot.len,
      lenH,
      scroll: 0,
      scrollV: 0,
      min: 0,
      max: 0,
      texture: null,
      burn: null,
    };
    this.held = held;
    this.scrollLimits(held);
    held.scroll = held.min;
    this.heldMesh.visible = true;
    if (this.o.reduced) {
      sheet.aCrumple.value = FLAT_CRUMPLE;
      sheet.aLength.value = lenH;
      this.readingPose(held.scroll, held.to);
      this.placeHeld(held.to);
    } else {
      this.placeHeld(from);
      uncrumple(0.55);
    }

    // The full-resolution print for reading.
    const job = this.queue.burn(slot.receipt, 100);
    held.burn = job;
    job.promise
      .then((raster) => {
        if (this.held !== held || this.disposed) return;
        held.burn = null;
        this.queue.remember(slot.receipt.id, raster);
        held.texture = this.heldTexture(raster);
        this.o.gl.initTexture(held.texture);
        this.heldPaper.paper.uInk.value = held.texture;
        this.heldPaper.paper.uInkMask.value.copy(MASK_ALPHA);
        sheet.aTile.value.set(0, 0, 1, 1);
        this.kick();
      })
      .catch(() => undefined);

    this.o.callbacks.onCursor('default');
    this.settleHand();
    this.cb.onOpen(slot.receipt);
    this.kick();
  }

  private heldTexture(raster: Raster): THREE.Texture {
    const max = this.o.gl.capabilities.maxTextureSize;
    const source = raster.height > max ? scaleCanvas(raster.canvas, max) : raster.canvas;
    const texture = new THREE.CanvasTexture(source);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.o.gl.capabilities.getMaxAnisotropy();
    return texture;
  }

  private scrollLimits(held: Held) {
    const { hh } = this.readBase;
    const margin = hh * 0.06;
    const top = hh - margin - held.lenH / 2;
    const bottom = -hh + margin + held.lenH / 2;
    if (top >= bottom) {
      held.min = held.max = 0;
    } else {
      held.min = top;
      held.max = bottom;
    }
    held.scroll = Math.min(held.max, Math.max(held.min, held.scroll));
  }

  /** The sheet flat in front of the camera, facing it, `scroll` up from centre. */
  private readingPose(scroll: number, out: Pose) {
    const cam = this.o.camera;
    out.q.copy(cam.quaternion);
    out.p.copy(cam.position).addScaledVector(this.camFwd, this.readBase.d).addScaledVector(this.camUp, scroll);
  }

  private placeHeld(pose: Pose) {
    this.heldMesh.matrix.compose(pose.p, pose.q, this.s);
    this.heldMesh.matrixWorldNeedsUpdate = true;
  }

  private stepHeld(dt: number, now: number): boolean {
    const held = this.held!;
    const sheet = this.heldPaper.sheet!;
    if (held.phase === 'lift') {
      held.t = springTo(held.t, held.v, 1, LIFT, dt);
      held.v = springV;
      const k = Math.min(1, (now - held.start) / 620);
      const e = ease.outCubic(k);
      sheet.aCrumple.value = held.c0 + (FLAT_CRUMPLE - held.c0) * e;
      sheet.aLength.value = held.len0 + (held.lenH - held.len0) * e;
      this.readingPose(held.scroll, held.to);
      const t = held.t;
      this.p.lerpVectors(held.from.p, held.to.p, t).addScaledVector(UP, Math.sin(Math.PI * Math.min(1, t)) * 0.5);
      this.q.slerpQuaternions(held.from.q, held.to.q, Math.min(1, Math.max(0, ease.inOut(Math.min(1, t * 1.08)))));
      this.heldMesh.matrix.compose(this.p, this.q, this.s);
      this.heldMesh.matrixWorldNeedsUpdate = true;
      if (k >= 1 && Math.abs(1 - held.t) < 0.0015 && Math.abs(held.v) < 0.02) {
        held.phase = 'read';
        this.placeHeld(held.to);
        return false;
      }
      return true;
    }
    if (held.phase === 'read') {
      let moving = false;
      const g = this.gesture;
      if (!(g && g.kind === 'scroll' && g.moved)) {
        // Momentum, then a spring back inside the ends.
        if (held.scroll < held.min - 1e-4 || held.scroll > held.max + 1e-4) {
          const target = held.scroll < held.min ? held.min : held.max;
          held.scroll = springTo(held.scroll, held.scrollV, target, SCROLL_BACK, dt);
          held.scrollV = springV;
          if (Math.abs(held.scroll - target) < 1e-4 && Math.abs(held.scrollV) < 1e-3) {
            held.scroll = target;
            held.scrollV = 0;
          } else moving = true;
        } else if (Math.abs(held.scrollV) > 1e-3) {
          held.scroll += held.scrollV * dt;
          held.scrollV *= Math.pow(0.0025, dt);
          moving = true;
        } else held.scrollV = 0;
      }
      this.readingPose(held.scroll, held.to);
      this.placeHeld(held.to);
      return moving || Boolean(g);
    }
    // Dropping back onto the pile: balls up as it falls.
    const k = Math.min(1, (now - held.start) / 360);
    const e = ease.inQuad(k);
    const slot = this.slots[held.slot];
    sheet.aCrumple.value = FLAT_CRUMPLE + ((slot?.rest ?? 0.9) - FLAT_CRUMPLE) * ease.outCubic(k);
    sheet.aLength.value = held.lenH + (held.len0 - held.lenH) * ease.outCubic(k);
    this.p.lerpVectors(held.from.p, held.to.p, e);
    this.q.slerpQuaternions(held.from.q, held.to.q, ease.outCubic(k));
    this.heldMesh.matrix.compose(this.p, this.q, this.s);
    this.heldMesh.matrixWorldNeedsUpdate = true;
    if (k >= 1) this.finishDrop(held, false);
    return true;
  }

  /** Put the held receipt back (tap outside, Esc, swipe down). */
  close() {
    const held = this.held;
    if (!held || held.phase === 'drop') return;
    const slot = this.slots[held.slot];
    if (!slot) {
      this.clearHeld();
      return;
    }
    held.burn?.cancel();
    if (this.o.reduced) {
      this.finishDrop(held, true);
      return;
    }
    // From wherever it is now to a point above the pile near where it came from.
    const from: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.heldMesh.matrix.decompose(from.p, from.q, this.w);
    const x = THREE.MathUtils.clamp(held.from.p.x * 0.7, -this.bounds.hx + 0.4, this.bounds.hx - 0.4);
    const z = THREE.MathUtils.clamp(held.from.p.z * 0.7, -this.bounds.hz + 0.4, this.bounds.hz - 0.4);
    const to: Pose = {
      p: new THREE.Vector3(x, Math.max(held.from.p.y, this.top) + slot.hull.radius + 0.5, z),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28)),
    };
    held.phase = 'drop';
    held.start = performance.now();
    held.from = from;
    held.to = to;
    crumpleSound(0.38);
    this.cb.onOpen(null);
    this.kick();
  }

  private finishDrop(held: Held, instant: boolean) {
    const index = held.slot;
    const slot = this.slots[index];
    if (slot) {
      slot.hidden = false;
      slot.crumple = slot.rest;
      slot.len = slot.length;
      this.writeCrumple(index, slot.crumple, slot.len);
      if (instant) {
        // Reduced motion: straight back where it was, at rest.
        this.world.add(index, { hull: slot.hull.points, radius: slot.hull.radius, position: held.from.p, quaternion: held.from.q, still: true });
      } else {
        const spin = 3 + Math.random() * 4;
        this.world.add(index, {
          hull: slot.hull.points,
          radius: slot.hull.radius,
          position: held.to.p,
          quaternion: held.to.q,
          linvel: this.v.set(0, -3.2, 0),
          angvel: this.w.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
        });
        this.world.watchLanding(index, 2);
      }
      this.writePose(index, 1);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.contacts.instanceMatrix.needsUpdate = true;
      this.contactAttr.needsUpdate = true;
    }
    if (instant) this.cb.onOpen(null);
    this.clearHeld();
    this.kick();
  }

  private clearHeld() {
    const held = this.held;
    if (!held) return;
    held.burn?.cancel();
    held.texture?.dispose();
    this.heldPaper.paper.uInk.value = this.atlas.texture;
    this.heldMesh.visible = false;
    this.held = null;
    this.settleHand();
  }

  /** Keyboard / wheel scrolling of the held receipt (css px; positive shows more of the foot). */
  scrollBy(px: number) {
    const held = this.held;
    if (!held || held.phase !== 'read') return;
    held.scroll = Math.min(held.max, Math.max(held.min, held.scroll + px * this.readBase.unit));
    held.scrollV = 0;
    this.kick();
  }

  get isHolding(): boolean {
    return this.held !== null;
  }

  // ---- your receipt, in hand -----------------------------------------------------------------------------

  setOwn(receipt: ThermalReceipt | null, raster: Raster | null = null) {
    if (this.hand && this.hand.receipt.id === receipt?.id) return;
    this.hand?.texture?.dispose();
    this.hand = null;
    this.handMesh.visible = false;
    if (!receipt) {
      this.emitHandRect();
      this.layout();
      return;
    }
    this.reserveHand = true;
    const seed = shapeSeed(receipt.id);
    const length = heldLength(docDots(receipt));
    const hand: Hand = { receipt, seed, length, raster: null, texture: null, tile: null, dx: 0, dy: 0, vx: 0, vy: 0, dragging: false, springing: false };
    this.hand = hand;
    const sheet = this.handPaper.sheet!;
    sheet.aSeed.value.set(seed[0], seed[1], seed[2], seed[3]);
    sheet.aCrumple.value = 0;
    sheet.aLength.value = length;
    sheet.aTile.value.set(0, 0, 0, 0);
    this.handPaper.paper.uInk.value = this.atlas.texture;
    this.handMesh.visible = true;
    const job = this.queue.burn(receipt, 50, raster);
    job.promise
      .then((r) => {
        if (this.hand !== hand || this.disposed) return;
        hand.raster = r;
        hand.tile = tileFrom(r);
        hand.texture = this.heldTexture(r);
        this.handPaper.paper.uInk.value = hand.texture;
        this.handPaper.paper.uInkMask.value.copy(MASK_ALPHA);
        sheet.aTile.value.set(0, 0, 1, 1);
        this.kick();
      })
      .catch(() => undefined);
    this.layout();
  }

  /** Where the receipt in hand is, `dx`/`dy` css px from where it rests. */
  private handPoseAt(dx: number, dy: number, pose: Pose) {
    const cam = this.o.camera;
    const b = this.handBase;
    // Camera space: below centre, tipped back a little, turned a few degrees, following the finger.
    this.v.set(b.x + dx * b.unit, b.y - dy * b.unit, -b.d);
    pose.p.copy(this.v).applyQuaternion(cam.quaternion).add(cam.position);
    const swing = THREE.MathUtils.clamp(dx * 0.0016, -0.25, 0.25);
    this.qa.setFromEuler(this.euler.set(b.lean + Math.min(0, dy) * -0.0012, 0, b.tilt - swing));
    pose.q.copy(cam.quaternion).multiply(this.qa);
  }

  private updateHandPose() {
    const hand = this.hand;
    if (!hand) return;
    this.handPoseAt(hand.dx, hand.dy, this.handPose);
    this.handMesh.matrix.compose(this.handPose.p, this.handPose.q, this.s);
    this.handMesh.matrixWorldNeedsUpdate = true;
  }

  /** While a receipt is held up to read, your own slides down out of the way. */
  private handRest(): number {
    return this.held ? this.height * 0.75 : 0;
  }

  /** Spring the hand to where it should be now (after a grab, a put back or a drag). */
  private settleHand() {
    const hand = this.hand;
    if (!hand) return;
    if (this.o.reduced) {
      hand.dx = 0;
      hand.dy = this.handRest();
      hand.vx = hand.vy = 0;
      hand.springing = false;
      this.updateHandPose();
    } else {
      hand.springing = true;
    }
    if (this.held) this.cb.onHandRect(null);
    else this.emitHandRect();
  }

  private stepHand(dt: number): boolean {
    const hand = this.hand!;
    if (hand.dragging) {
      this.updateHandPose();
      return true;
    }
    if (!hand.springing) return false;
    const rest = this.handRest();
    hand.dx = springTo(hand.dx, hand.vx, 0, HAND_BACK, dt);
    hand.vx = springV;
    hand.dy = springTo(hand.dy, hand.vy, rest, HAND_BACK, dt);
    hand.vy = springV;
    if (Math.abs(hand.dx) + Math.abs(hand.dy - rest) < 0.3 && Math.abs(hand.vx) + Math.abs(hand.vy) < 4) {
      hand.dx = hand.vx = hand.vy = 0;
      hand.dy = rest;
      hand.springing = false;
    }
    this.updateHandPose();
    return hand.springing;
  }

  private emitHandRect() {
    const hand = this.hand;
    if (!hand || !this.ready) {
      this.cb.onHandRect(null);
      return;
    }
    // Project the visible part of the sheet (its corners), as it rests, to the screen.
    const cam = this.o.camera;
    const rest = this.restPose;
    this.handPoseAt(0, 0, rest);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    const L = hand.length;
    [-1, 1].forEach((sx) =>
      [-1, 1].forEach((sy) => {
        this.v.set((sx * SHEET_W) / 2, (sy * L) / 2, 0).applyQuaternion(rest.q).add(rest.p).project(cam);
        const x = ((this.v.x + 1) / 2) * this.width;
        const y = ((1 - this.v.y) / 2) * this.height;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
      }),
    );
    const top = Math.max(0, minY);
    this.cb.onHandRect({ x: Math.max(0, minX), y: top, width: Math.min(this.width, maxX) - Math.max(0, minX), height: this.height - top });
  }

  /** Flick or key: ball it up and throw it on the pile. `velocity` in css px/s (+y down), from a flick. */
  tossOwn(velocity?: { x: number; y: number }) {
    const hand = this.hand;
    if (!hand || !this.ready) return;
    this.updateHandPose();
    const input = this.makeSlotInput(hand.receipt, null);
    const index = this.insert(input, this.o.reduced ? input.rest : 0, this.o.reduced ? input.length : hand.length, hand.tile ?? hand.raster);
    const slot = this.slots[index]!;
    this.handMesh.visible = false;
    this.hand = null;
    this.cb.onHandRect(null);
    this.cb.onOwnTossed(hand.receipt);

    if (this.o.reduced) {
      this.dropOnTop(index);
      slot.landing = false;
      this.cb.onLanded(hand.receipt);
      hand.texture?.dispose();
      this.kick();
      return;
    }
    // Aim for the top of the pile, a little to the side the flick went.
    const vx = velocity?.x ?? (Math.random() - 0.5) * 300;
    const vy = velocity?.y ?? -1400;
    const start = this.handPose.p;
    const target = this.w.set(
      THREE.MathUtils.clamp(vx / 900, -this.bounds.hx * 0.55, this.bounds.hx * 0.55),
      this.top + 0.3,
      THREE.MathUtils.clamp(0.25 + (Math.random() - 0.5) * 0.4, -this.bounds.hz * 0.5, this.bounds.hz * 0.5),
    );
    // Your hand is a hand's length from your eyes, so a lob would leave the frame: launch almost flat (a
    // harder flick a little higher) and let the drop to the pile set the time of flight.
    const g = -GRAVITY;
    const up = THREE.MathUtils.clamp(Math.abs(vy) / 900, 0.6, 2.6);
    const fall = Math.max(0.2, start.y - target.y);
    const time = (up + Math.sqrt(up * up + 2 * g * fall)) / g;
    const linvel = new THREE.Vector3().subVectors(target, start).divideScalar(time);
    linvel.y = up;
    // Air drag (the body's linear damping) over the flight.
    const drag = 1 + 0.45 * time * 0.5;
    linvel.x *= drag;
    linvel.z *= drag;
    const spin = 6 + Math.random() * 6;
    this.world.add(index, {
      hull: input.hull.points,
      radius: input.hull.radius,
      position: start,
      quaternion: this.handPose.q,
      linvel,
      angvel: new THREE.Vector3((Math.random() - 0.5) * spin - vy * 0.004, (Math.random() - 0.5) * spin, -vx * 0.006),
      ccd: true,
    });
    this.world.watchLanding(index, 4);
    slot.landing = true;
    slot.anim = { from: 0, to: input.rest, lenFrom: hand.length, lenTo: input.length, start: performance.now(), dur: 300 };
    whoosh();
    crumpleSound(0.3);
    window.setTimeout(() => hand.texture?.dispose(), 400);
    this.kick();
  }

  /** Reduced motion: a new ball simply appears on top of the pile, already at rest. */
  private dropOnTop(index: number) {
    const slot = this.slots[index]!;
    slot.crumple = slot.rest;
    slot.len = slot.length;
    this.writeCrumple(index, slot.crumple, slot.len);
    this.p.set((Math.random() - 0.5) * 0.4, this.top + slot.hull.radius + 0.2, (Math.random() - 0.5) * 0.3);
    this.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.world.add(index, { hull: slot.hull.points, radius: slot.hull.radius, position: this.p, quaternion: this.q });
    this.world.resetClock();
    while (!this.world.settle(50, 2.5)) {
      // keep stepping
    }
    this.writeAll();
    this.emitAnchors(true);
  }

  // ---- a ball from elsewhere on the page ------------------------------------------------------------------

  receive(payload: TossPayload, rect: DOMRect): boolean {
    if (!this.ready || this.disposed) return false;
    const input = this.makeSlotInput(payload.receipt, null);
    const index = this.insert(input, this.o.reduced ? input.rest : Math.min(1, Math.max(0, payload.crumple)), undefined, payload.raster);
    const slot = this.slots[index]!;
    if (this.o.reduced) {
      this.dropOnTop(index);
      this.cb.onLanded(payload.receipt);
      this.kick();
      return true;
    }
    // Where the ball is on screen, pushed along its view ray until it's inside the walls.
    const cx = payload.from.x + payload.from.width / 2;
    const cy = payload.from.y + payload.from.height / 2;
    this.setRay(cx, cy, rect);
    const spawn = new THREE.Vector3();
    const r = input.hull.radius;
    let found = false;
    for (let t = 0.5; t < 60; t += 0.05) {
      this.ray.at(t, spawn);
      if (spawn.y < this.top + r + 0.2) break;
      if (Math.abs(spawn.x) < this.bounds.hx - r && Math.abs(spawn.z) < this.bounds.hz - r && spawn.y < this.bounds.height + 2.5) {
        found = true;
        break;
      }
    }
    if (!found) spawn.set(THREE.MathUtils.clamp(spawn.x, -this.bounds.hx + r, this.bounds.hx - r), this.top + r + 1.2, THREE.MathUtils.clamp(spawn.z, -this.bounds.hz + r, this.bounds.hz - r));
    // Screen velocity to world at that depth.
    const depth = this.v.subVectors(spawn, this.o.camera.position).dot(this.camFwd);
    const unit = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.o.camera.fov) / 2)) / this.height;
    const linvel = new THREE.Vector3()
      .addScaledVector(this.camRight, payload.velocity.x * unit)
      .addScaledVector(this.camUp, -payload.velocity.y * unit);
    linvel.y = Math.min(linvel.y, 2) - 2;
    if (linvel.length() > 12) linvel.setLength(12);
    const spin = payload.spin ?? 6 + Math.random() * 6;
    this.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.world.add(index, {
      hull: input.hull.points,
      radius: r,
      position: spawn,
      quaternion: this.q,
      linvel,
      angvel: this.w.set(spin * 0.6, spin * 0.3, -spin * 0.5),
      ccd: true,
    });
    this.world.watchLanding(index, 4);
    slot.landing = true;
    slot.anim = { from: slot.crumple, to: input.rest, lenFrom: input.length, lenTo: input.length, start: performance.now(), dur: 260 };
    this.kick();
    return true;
  }

  rect(): ScreenRect | null {
    const el = this.o.gl.domElement;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }

  // ---- input -------------------------------------------------------------------------------------------

  pointerDown(event: PointerEvent, hand: boolean) {
    if (!this.ready || this.gesture || event.button > 0) return;
    const now = performance.now();
    const kind: Gesture['kind'] = hand ? 'hand' : this.held && this.held.phase === 'read' ? 'scroll' : 'tap';
    if (kind === 'hand' && !this.hand) return;
    this.gesture = { id: event.pointerId, kind, x0: event.clientX, y0: event.clientY, t0: now, lx: event.clientX, ly: event.clientY, lt: now, vx: 0, vy: 0, moved: false, scroll0: this.held?.scroll ?? 0 };
    if (kind === 'scroll' && this.held) this.held.scrollV = 0;
    if (kind === 'hand' && this.hand) {
      this.hand.dragging = true;
      this.hand.springing = false;
    }
    this.kick();
  }

  pointerMove(event: PointerEvent, rect: DOMRect) {
    const g = this.gesture;
    if (!g) {
      if (event.pointerType === 'mouse' && !this.held && this.ready) this.hover(event, rect);
      return;
    }
    if (g.id !== event.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - g.lt);
    g.vx = 0.75 * ((event.clientX - g.lx) / dt) * 1000 + 0.25 * g.vx;
    g.vy = 0.75 * ((event.clientY - g.ly) / dt) * 1000 + 0.25 * g.vy;
    g.lx = event.clientX;
    g.ly = event.clientY;
    g.lt = now;
    const dx = event.clientX - g.x0;
    const dy = event.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.kind === 'scroll' && this.held && g.moved) {
      const held = this.held;
      // Finger up shows more of the foot. Past either end it rubber-bands.
      let next = g.scroll0 - dy * this.readBase.unit;
      if (this.o.reduced) next = Math.min(held.max, Math.max(held.min, next));
      else if (next < held.min) next = held.min - rubber(held.min - next, this.readBase.hh * 0.35);
      else if (next > held.max) next = held.max + rubber(next - held.max, this.readBase.hh * 0.35);
      held.scroll = next;
      this.kick();
    }
    if (g.kind === 'hand' && this.hand) {
      this.hand.dx = rubber(dx, 260);
      this.hand.dy = dy > 0 ? rubber(dy, 40) : dy;
      this.kick();
    }
  }

  pointerUp(event: PointerEvent, rect: DOMRect, cancelled = false) {
    const g = this.gesture;
    if (!g || g.id !== event.pointerId) return;
    this.gesture = null;
    const quick = performance.now() - g.t0 < 450;
    if (g.kind === 'hand') {
      const hand = this.hand;
      if (!hand) return;
      hand.dragging = false;
      const up = event.clientY - g.y0;
      if (!cancelled && ((g.vy < -380 && up < -18) || up < -this.height * 0.22)) {
        this.tossOwn({ x: g.vx, y: Math.min(g.vy, -900) });
      } else if (!cancelled && !g.moved && quick) {
        // A tap on your own receipt: a little lift, nothing else (the key tosses it).
        hand.vy = -260;
        hand.springing = true;
      } else {
        hand.vx = 0;
        hand.vy = 0;
        hand.springing = !this.o.reduced;
        if (this.o.reduced) {
          hand.dx = hand.dy = 0;
          this.updateHandPose();
        }
      }
      this.kick();
      return;
    }
    if (cancelled) return;
    if (g.kind === 'scroll' && this.held) {
      const held = this.held;
      if (g.moved) {
        // Pulled down past the top, or flicked down at the top: put it back.
        const over = (held.min - held.scroll) / this.readBase.unit;
        if (over > 70 || (held.scroll <= held.min + 1e-3 && g.vy > 1100 && event.clientY - g.y0 > 40)) {
          this.close();
          return;
        }
        held.scrollV = this.o.reduced ? 0 : -g.vy * this.readBase.unit;
        this.kick();
        return;
      }
      if (quick && !this.hitsHeld(event.clientX, event.clientY, rect)) this.close();
      return;
    }
    if (g.kind === 'tap' && !g.moved && quick) {
      if (this.held) {
        if (!this.hitsHeld(event.clientX, event.clientY, rect)) this.close();
        return;
      }
      const index = this.pick(event.clientX, event.clientY, rect);
      if (index >= 0) this.grab(index);
    }
  }

  private hover(event: PointerEvent, rect: DOMRect) {
    const frame = Math.floor(performance.now() / 32);
    if (frame === this.hoverFrame) return;
    this.hoverFrame = frame;
    this.cb.onCursor(this.pick(event.clientX, event.clientY, rect) >= 0 ? 'pointer' : 'default');
  }

  // ---- accessibility anchors ---------------------------------------------------------------------------

  /** Where each ball is on screen (for the keyboard buttons). Only after settling or a resize. */
  private emitAnchors(force: boolean) {
    if (!this.ready) return;
    const cam = this.o.camera;
    const anchors: Anchor[] = [];
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot || slot.hidden || !this.world.has(i)) continue;
      const c = this.world.position(i, this.w);
      const depth = this.v.subVectors(c, cam.position).dot(this.camFwd);
      this.v.copy(c).project(cam);
      const x = ((this.v.x + 1) / 2) * this.width;
      const y = ((1 - this.v.y) / 2) * this.height;
      const r = (slot.hull.radius * 0.8 * this.height) / (2 * depth * tanHalf);
      anchors.push({ id: slot.receipt.id, label: receiptLabel(slot.receipt), x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    }
    const key = anchors.map((a) => `${a.id}:${a.x}:${a.y}:${a.r}`).join('|');
    if (!force && key === this.anchorsKey) return;
    this.anchorsKey = key;
    this.cb.onAnchors(anchors);
  }

  /** Frame times (ms of this engine's work per frame), for the lab page. */
  frameStats(): { frame: number[][]; render: number[][]; step: number[][] } {
    return this.profile ?? { frame: [], render: [], step: [] };
  }

  /** Lab: how long the renderer took to submit a frame. */
  recordRender(start: number, ms: number) {
    if (this.profile) record(this.profile.render, start, ms);
  }

  /** Lab: what each instance is doing. */
  inspect() {
    return {
      bounds: this.bounds,
      top: this.top,
      awake: this.world.awake,
      camera: this.o.camera.position.toArray().map((n) => +n.toFixed(2)),
      slots: this.slots.map((slot, i) =>
        slot
          ? {
              id: slot.receipt.id,
              hidden: slot.hidden,
              crumple: +slot.crumple.toFixed(2),
              length: +slot.len.toFixed(2),
              radius: +slot.hull.radius.toFixed(3),
              tile: slot.tile.toArray().map((n) => +n.toFixed(3)),
              body: this.world.has(i) ? this.world.position(i, new THREE.Vector3()).toArray().map((n) => +n.toFixed(2)) : null,
            }
          : null,
      ),
    };
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.settleTimer);
    this.queue.dispose();
    this.slots.forEach((slot) => slot?.burning?.cancel());
    this.held?.texture?.dispose();
    this.hand?.texture?.dispose();
    const { scene } = this.o;
    [this.mesh, this.heldMesh, this.handMesh, this.counter, this.contacts, this.lamp, this.lamp.target, this.fill].forEach((object) => scene.remove(object));
    this.geometry.dispose();
    this.sheetGeometry.dispose();
    this.counter.geometry.dispose();
    this.contacts.geometry.dispose();
    this.paper.dispose();
    this.heldPaper.dispose();
    this.handPaper.dispose();
    this.counterMaterial.dispose();
    this.contactMaterial.dispose();
    this.atlas.dispose();
    this.lamp.shadow.dispose();
    this.mesh.dispose();
    this.contacts.dispose();
    this.world.free();
  }
}

function record(list: number[][], t: number, ms: number) {
  list.push([Math.round(t), +ms.toFixed(3)]);
  if (list.length > 4000) list.splice(0, list.length - 4000);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scaleCanvas(source: HTMLCanvasElement, maxHeight: number): HTMLCanvasElement {
  const scale = maxHeight / source.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = maxHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}
