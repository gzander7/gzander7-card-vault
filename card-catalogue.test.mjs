import assert from 'node:assert/strict';
import test from 'node:test';
import { readCardPages } from './card-catalogue.mjs';

test('the gallery finishes reading capped pages before exposing an inventory for history', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let calls = 0;
  const pages = () => {
    let cursor = '';
    return {
      gt(key, id) { assert.equal(key, 'id'); cursor = id; return this; },
      order() { return this; }, limit() { return this; },
      abortSignal() { calls++; return { data: rows.filter(row => row.id > cursor).slice(0, 1), count: null }; },
    };
  };
  assert.deepEqual(await readCardPages(pages), rows);
  assert.equal(calls, 4);
});

test('a single page with an exact count returns all cards in one request', async () => {
  let calls = 0;
  const page = { order() { return this; }, limit() { return this; },
    abortSignal() { calls++; return { data: [{ id: 'a' }], count: 1 }; } };
  assert.deepEqual(await readCardPages(() => page), [{ id: 'a' }]);
  assert.equal(calls, 1);
});
