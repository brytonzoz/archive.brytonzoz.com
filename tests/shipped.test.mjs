import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHIPPED_ITEMS, shippedCounts } from '../lib/shipped.ts';

test('shipped receipt counts only real line items', () => {
  const counts = shippedCounts();
  assert.equal(counts.items, SHIPPED_ITEMS.length);
  assert.equal(counts.live, SHIPPED_ITEMS.filter((item) => item.status === 'LIVE').length);
  assert.equal(counts.prototype, SHIPPED_ITEMS.filter((item) => item.status === 'PROTOTYPE').length);
  assert.equal(counts.live + counts.prototype, counts.items);
  assert.equal(counts.live, 5);
  assert.equal(counts.prototype, 2);
});

test('prototypes have no live links and are flagged for Bryton to confirm', () => {
  const prototypes = SHIPPED_ITEMS.filter((item) => item.status === 'PROTOTYPE');
  assert.deepEqual(prototypes.map((item) => item.name).sort(), ['LiveCaps', 'WellnessBuddy']);
  for (const item of prototypes) {
    assert.equal(item.links.length, 0);
    assert.equal(item.confirmStatus, true);
  }
});

test('live products point at public URLs, not GitHub', () => {
  for (const item of SHIPPED_ITEMS.filter((entry) => entry.status === 'LIVE')) {
    assert.ok(item.links.length > 0, `${item.name} needs a live link`);
    for (const link of item.links) {
      assert.equal(link.href.includes('github.com'), false, `${item.name} must not link GitHub`);
    }
  }
});
