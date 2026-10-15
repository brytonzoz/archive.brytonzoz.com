import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutWall, wallColumns, wallGutter } from '../lib/shipped-wall.ts';

test('long printed receipts keep their proportions and tilted corners inside the board', () => {
  const receipts = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, items: [{ name: 'A release' }] }));
  const ratios = new Map(receipts.map(({ id }) => [id, id % 2 ? 6 : 2.5]));
  for (const width of [320, 390, 800, 1200]) {
    const { cards, height } = layoutWall(receipts, new Set(), width, wallColumns(width), wallGutter(width), ratios);
    for (const card of cards) {
      // The print fills the available paper width; the remaining height is fastener and caption space.
      assert.ok(Math.abs((card.h - 62) / (card.w - 12) - ratios.get(card.id)) < 0.01);
      const angle = card.rotate * Math.PI / 180;
      for (const [x, y] of [[0, 0], [card.w, 0], [0, card.h], [card.w, card.h]]) {
        const rx = card.x + card.w / 2 + (x - card.w / 2) * Math.cos(angle) - (y - 8) * Math.sin(angle);
        const ry = card.y + 8 + (x - card.w / 2) * Math.sin(angle) + (y - 8) * Math.cos(angle);
        assert.ok(rx >= 0 && rx <= width, `receipt ${card.id} crosses a side at ${width}px`);
        assert.ok(ry >= 0 && ry <= height, `receipt ${card.id} crosses top/bottom at ${width}px`);
      }
    }
  }
});

test('crumpled receipts ignore the long image ratio and leave room for the remaining pins', () => {
  const receipts = [{ id: 1, items: [] }, { id: 2, items: [] }];
  const { cards } = layoutWall(receipts, new Set([1]), 390, 1, 22, new Map([[1, 8], [2, 3]]));
  assert.ok(cards[0].h < cards[0].w);
  assert.ok(cards[1].y >= cards[0].y + cards[0].h + 22);
  assert.ok(cards[1].h > cards[1].w * 2);
});
