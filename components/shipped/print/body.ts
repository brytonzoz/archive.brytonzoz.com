// A torn receipt as a 2D rigid body (x, y = centre in px, a = angle in rad), per unit mass. Held, it hangs
// from the point you hold through a stiff spring, so it swings like paper pinched at one spot (the
// moment of inertia of a w x h sheet); let go, it falls with air drag. Pure, so it can be tested.

export type Body2D = {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  va: number;
  w: number;
  h: number;
};

export type Air = { linear: number; angular: number };

/** Moment of inertia of a flat w x h sheet about its centre, per unit mass. */
export function inertia(w: number, h: number): number {
  return (w * w + h * h) / 12;
}

/** Where a point fixed on the body (offset from its centre, body axes) is in the world. */
export function worldPoint(body: Body2D, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(body.a);
  const s = Math.sin(body.a);
  return { x: body.x + lx * c - ly * s, y: body.y + lx * s + ly * c };
}

/** The inverse: a world point in body axes. */
export function localPoint(body: Body2D, x: number, y: number): { x: number; y: number } {
  const c = Math.cos(body.a);
  const s = Math.sin(body.a);
  const dx = x - body.x;
  const dy = y - body.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/**
 * One step of a body held at `grab` (body axes) by a spring toward `target`, under gravity `g` (px/s²).
 * `k` is the spring's stiffness (1/s²) and `c` its damping; sub-step for dt above ~1/90 s. `upright` is the
 * sheet's own stiffness (1/s²): paper pinched below its middle doesn't flop over, it sways and comes back.
 */
export function stepHeld(body: Body2D, grab: { x: number; y: number }, target: { x: number; y: number }, dt: number, g: number, air: Air, k = 300, c = 30, upright = 0): void {
  const cos = Math.cos(body.a);
  const sin = Math.sin(body.a);
  const rx = grab.x * cos - grab.y * sin;
  const ry = grab.x * sin + grab.y * cos;
  // Velocity of the held point: the centre's plus the spin's.
  const pvx = body.vx - body.va * ry;
  const pvy = body.vy + body.va * rx;
  const fx = k * (target.x - (body.x + rx)) - c * pvx;
  const fy = k * (target.y - (body.y + ry)) - c * pvy;
  const torque = rx * fy - ry * fx;
  body.vx += (fx - air.linear * body.vx) * dt;
  body.vy += (fy + g - air.linear * body.vy) * dt;
  body.va += (torque / inertia(body.w, body.h) - upright * Math.sin(body.a) - air.angular * body.va) * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.a += body.va * dt;
}

/** One step of free fall with drag. A falling sheet also turns a little toward lying flat across the air. */
export function stepFalling(body: Body2D, dt: number, g: number, air: Air, flatten = 0): void {
  body.vx += -air.linear * body.vx * dt;
  body.vy += (g - air.linear * body.vy) * dt;
  body.va += (-air.angular * body.va - flatten * Math.sin(body.a)) * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.a += body.va * dt;
}
