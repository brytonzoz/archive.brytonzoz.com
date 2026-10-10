import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prng } from '../components/shipped/physics.ts';
import { receiptToDoc } from '../components/shipped/thermal/layout.ts';
import { buildFeedPlan, jobDuration, sampleFeed, stepperEase } from '../components/shipped/print/timeline.ts';
import { EDGE_WIDTH, TOOTH_DEPTH, TOOTH_PITCH, aboveClip, belowClip, edgeY, serratedEdge } from '../components/shipped/print/tear.ts';
import { stepFalling, stepHeld } from '../components/shipped/print/body.ts';

const RECEIPT = {
  id: 'r42',
  year: 2026,
  who: 'Ada Ships',
  kicker: 'SAMPLE · NAME',
  date: '08 OCT 2026',
  number: '000042',
  items: [
    { name: 'TIDE TABLES', status: 'SHIPPED', date: 'MAR 3', description: 'iOS widget for surf and tide times.' },
    { name: 'CRON BUDDY', status: 'LIVE', date: null, description: 'Tells you when a cron job silently stops.' },
  ],
  count: 2,
  note: 'Proof over hype.',
  presented: null,
  paidBy: ['POCKET FACTORY', 'MOPKIN'],
  barcode: 'BZ000042',
};

/** Band heights as raster.ts sets them (no canvas needed for the schedule). */
function bandsFor(doc) {
  let y = 0;
  return doc.lines.map((line) => {
    const height =
      line.kind === 'text' ? (line.invert ? 40 : line.tall ? 56 : line.small ? 22 : 30)
      : line.kind === 'lead' ? (line.tall ? 56 : line.small ? 22 : 30)
      : line.kind === 'rule' ? 20
      : line.kind === 'feed' ? line.dots
      : line.kind === 'barcode' ? line.height + 8
      : line.kind === 'logo' ? 0
      : 14;
    const band = { y, height, ink: 0, kind: line.kind };
    y += height;
    return band;
  });
}

const DOC = receiptToDoc(RECEIPT);
const BANDS = bandsFor(DOC);
const plan = (seed = 'r42:feed', speed = 1) => buildFeedPlan(BANDS, DOC.lines, prng(seed), speed);

test('the feed plan is the same for the same receipt, and only for it', () => {
  assert.deepEqual(plan(), plan());
  assert.notDeepEqual(plan().steps.map((s) => s.burn), plan('r43:feed').steps.map((s) => s.burn));
});

test('a job takes 2.5-6 s at speed 1, and speed scales it', () => {
  const p = plan();
  assert.ok(p.duration >= 2500 && p.duration <= 6000, String(p.duration));
  assert.equal(p.duration, jobDuration(p.rows));
  assert.equal(Math.round(plan('r42:feed', 2).duration), Math.round(p.duration / 2));
  assert.equal(jobDuration(100), 2500);
  assert.equal(jobDuration(100000), 6000);
});

test('every line burns, then is shoved out, in order, and the paper ends fully fed', () => {
  const p = plan();
  assert.equal(p.steps.length, DOC.lines.length);
  let last = 0;
  for (const s of p.steps) {
    assert.ok(s.burn >= last - 1e-6, 'burns in order, after the previous shove');
    assert.ok(s.start >= s.burn && s.end >= s.start);
    last = s.end;
  }
  assert.equal(p.rows, BANDS.at(-1).y + BANDS.at(-1).height);
  const end = sampleFeed(p, p.duration + 1, 0);
  assert.equal(end.rows, p.rows);
  assert.equal(end.burned, DOC.lines.length);
  const start = sampleFeed(p, 0, 0);
  assert.equal(start.rows, 0);
  assert.equal(start.burned, 0);
});

test('a line is burned a beat before it shows, and the paper never runs back past a line', () => {
  const p = plan();
  let hint = 0;
  let floor = 0;
  for (let t = 0; t <= p.duration; t += 4) {
    const s = sampleFeed(p, t, hint);
    hint = s.step;
    // Visible rows never exceed what has been burned (plus the stepper's few-percent overshoot).
    const burnedRows = s.burned ? BANDS[s.burned - 1].y + BANDS[s.burned - 1].height : 0;
    assert.ok(s.rows <= burnedRows * 1.06 + 0.01, `t=${t}: ${s.rows} > ${burnedRows}`);
    assert.ok(s.rows >= floor - 3, `t=${t}: ran back to ${s.rows} from ${floor}`);
    floor = Math.max(floor, s.rows);
  }
});

test('dense lines (the inverse band, the barcode) hold longer than a plain line', () => {
  const p = plan();
  const holdBefore = (i) => p.steps[i].burn - (i > 0 ? p.steps[i - 1].end : 0);
  const invert = DOC.lines.findIndex((l) => l.kind === 'text' && l.invert);
  const barcode = DOC.lines.findIndex((l) => l.kind === 'barcode');
  const plain = DOC.lines.findIndex((l) => l.kind === 'text' && !l.invert && !l.tall && !l.bold && l.small);
  assert.ok(holdBefore(invert) > holdBefore(plain) * 1.5);
  assert.ok(holdBefore(barcode) > holdBefore(plain) * 1.5);
});

test('the stepper lands on its line with a small settle', () => {
  assert.equal(stepperEase(0), 0);
  assert.equal(stepperEase(1), 1);
  let peak = 0;
  for (let u = 0; u <= 1; u += 0.01) peak = Math.max(peak, stepperEase(u));
  assert.ok(peak > 1 && peak < 1.06, String(peak));
  assert.ok(stepperEase(0.25) > 0.6, 'fast attack');
});

test('the serrated edge has the bar pitch, stays within its depth, and is seeded', () => {
  const edge = serratedEdge(prng('r42:tear'));
  assert.deepEqual(edge, serratedEdge(prng('r42:tear')));
  assert.notDeepEqual(edge, serratedEdge(prng('r43:tear')));
  assert.equal(edge[0].x, 0);
  assert.equal(edge.at(-1).x, EDGE_WIDTH);
  for (let i = 1; i < edge.length; i++) assert.ok(edge[i].x > edge[i - 1].x, 'x strictly increasing');
  for (const p of edge) assert.ok(Math.abs(p.y) <= TOOTH_DEPTH / 2 * 1.25 + 3.3, String(p.y));
  // High points near every tooth tip of the bar (pitch/2 + k * pitch).
  for (let k = 0; k < EDGE_WIDTH / TOOTH_PITCH; k++) {
    const tip = TOOTH_PITCH / 2 + k * TOOTH_PITCH;
    assert.ok(edgeY(edge, tip) < 0 || Math.min(edgeY(edge, tip - 3), edgeY(edge, tip + 3)) < 0, `tooth ${k}`);
  }
});

test('receipt and stub are cut along the same line', () => {
  const edge = serratedEdge(prng('r42:tear'));
  const above = aboveClip(edge, 500, 0.5);
  const below = belowClip(edge, 6, 0.5);
  const pts = (clip) => clip.slice(8, -1).split(', ').map((p) => p.split(' ')[0]);
  // Same x positions (one is the other reversed, plus the outer corners).
  const a = pts(above).filter((x) => x !== '0%' && x !== '100%');
  const b = pts(below).filter((x) => x !== '0%' && x !== '100%');
  assert.deepEqual([...a].reverse(), b);
});

test('a partial tear keeps the paper past the front attached to the stub', () => {
  const edge = serratedEdge(prng('r42:tear'));
  const fromLeft = aboveClip(edge, 500, 0.5, { side: -1, front: 320 });
  assert.ok(fromLeft.includes('100% 100%'), 'right side still reaches into the slot');
  assert.ok(fromLeft.includes('50.000% 100%'), 'down the front');
  const fromRight = aboveClip(edge, 500, 0.5, { side: 1, front: 320 });
  assert.ok(fromRight.includes('0% 100%'), 'left side still attached');
  assert.ok(!aboveClip(edge, 500, 0.5, { side: -1, front: EDGE_WIDTH }).includes('100% 100%'), 'fully torn');
});

test('paper held at its top hangs below the hand; let go, it falls', () => {
  const body = { x: 0, y: 0, a: 0.6, vx: 0, vy: 0, va: 0, w: 320, h: 600 };
  const air = { linear: 0.7, angular: 3 };
  for (let i = 0; i < 1200; i++) stepHeld(body, { x: 0, y: -280 }, { x: 0, y: 0 }, 1 / 240, 2200, air);
  assert.ok(Math.abs(body.a) < 0.02, `swung back to hanging: ${body.a}`);
  assert.ok(body.y > 250 && body.y < 320, `centre below the hand: ${body.y}`);
  const vy = body.vy;
  stepFalling(body, 1 / 60, 2600, air);
  assert.ok(body.vy > vy + 30);
});

test('held below its middle, the sheet stays up instead of flopping over', () => {
  const body = { x: 0, y: 0, a: 0.05, vx: 0, vy: 0, va: 0, w: 320, h: 600 };
  for (let i = 0; i < 1200; i++) stepHeld(body, { x: 0, y: 260 }, { x: 0, y: 260 }, 1 / 240, 2200, { linear: 0.7, angular: 7 }, 300, 30, 70);
  assert.ok(Math.abs(body.a) < 0.3, String(body.a));
});
