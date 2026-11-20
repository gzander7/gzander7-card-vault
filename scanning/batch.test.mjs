import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanQueue } from './batch.mjs';

const image = name => ({ name, type: 'image/jpeg', size: 20 });
const [a, b, c, d] = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map(image);
const bad = { name: 'list.pdf', type: 'application/pdf', size: 30 };
const setup = () => {
  const q = createScanQueue();
  q.setOwner('owner');
  return q;
};

test('fronts stay separate and pairs follow picker order with an optional final back', () => {
  const q = setup();
  q.add([a, b], false);
  q.add([c, d, a], true);
  assert.deepEqual(
    q.items.map(e => [e.front, e.back]),
    [
      [a, null],
      [b, null],
      [c, d],
      [a, null],
    ],
  );
  assert.equal(new Set(q.items.map(e => e.id)).size, 4);
});

test('an unreadable selection never shifts the side of a later card', () => {
  const q = setup();
  const { ignored } = q.add([bad, a, b, bad, c, d], true);
  assert.equal(ignored, 3);
  assert.deepEqual(
    q.items.map(e => [e.front, e.back]),
    [
      [b, null],
      [c, d],
    ],
  );
  q.add([{ name: 'PHONE.HEIC', type: '', size: 20 }], false);
  assert.equal(q.items.length, 3);
});

test('completion advances the active card once and discards a different account’s queue', () => {
  const q = setup();
  q.add([a, b, c], false);
  const [first, second, third] = q.items;
  assert.equal(q.finish(second, 'saved'), false);
  assert.equal(q.finish(first, 'saved'), true);
  assert.equal(q.finish(first, 'saved'), false);
  assert.equal(q.finish(second, 'skipped'), true);
  q.setOwner('owner');
  assert.equal(q.items[0], third);
  assert.deepEqual([q.saved, q.skipped], [1, 1]);
  q.setOwner('different');
  assert.deepEqual([q.items.length, q.saved, q.skipped], [0, 0, 0]);
  assert.equal(q.finish(third, 'saved'), false);
  q.setOwner(null);
  q.add([a], false);
  assert.equal(q.items.length, 0);
});
