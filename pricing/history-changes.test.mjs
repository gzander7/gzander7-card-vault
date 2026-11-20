import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDays } from './history-changes.mjs';

const card = (id, valueCents, label = id) => ({ id, label, valueCents });
function day(...cards) {
  const prices = cards.filter(card => card.valueCents !== null);
  return {
    cards,
    total: cards.length,
    priced: prices.length,
    valueCents: prices.length ? prices.reduce((sum, card) => sum + card.valueCents, 0) : null,
  };
}

test('explains a vault increase as an addition, new coverage and repricing', () => {
  const previous = day(card('veteran', 2500), card('rookie', null), card('unchanged', 1000));
  const current = day(card('pull', 5000), card('veteran', 3500), card('rookie', 2000), card('unchanged', 1000));
  const result = compareDays(previous, current);
  assert.equal(result.status, 'ready');
  assert.equal(result.netCents, 8000);
  assert.deepEqual(
    result.changes.map(c => [c.id, c.kind, c.deltaCents, c.beforeCents, c.afterCents]),
    [
      ['pull', 'added', 5000, null, 5000],
      ['rookie', 'priced', 2000, null, 2000],
      ['veteran', 'estimate', 1000, 2500, 3500],
    ],
  );
});

test('separates removals from lost coverage and preserves the label at the time', () => {
  const previous = day(card('gone', 2200, 'Historical name'), card('stale', 1800), card('same', 1500));
  const current = day(card('same', 1000, 'Updated title'), card('stale', null));
  const { changes, netCents } = compareDays(previous, current);
  assert.deepEqual(
    changes.map(c => [c.label, c.kind, c.deltaCents]),
    [
      ['Historical name', 'removed', -2200],
      ['stale', 'unpriced', -1800],
      ['Updated title', 'estimate', -500],
    ],
  );
  assert.equal(netCents, -4500);
  assert.equal(
    changes.reduce((sum, c) => sum + c.deltaCents, 0),
    netCents,
  );
});

test('preserves offsetting moves and changes in unpriced inventory at zero net change', () => {
  const a = day(card('rise', 1500), card('fall', 1500), card('exit', null));
  const b = day(card('fall', 1000), card('rise', 2000), card('enter', null));
  const result = compareDays(a, b);
  assert.equal(result.netCents, 0);
  assert.equal(result.changes.length, 4);
  assert.equal(result.changes.find(c => c.id === 'enter').kind, 'added');
  assert.equal(result.changes.find(c => c.id === 'exit').deltaCents, 0);
  assert.deepEqual(compareDays(a, a).changes, []);
});

test('compares a confirmed empty vault and distinguishes zero from unknown', () => {
  const valued = day(card('priced', 1200), card('zero', 0), card('unknown', null));
  assert.equal(compareDays(valued, day()).netCents, -1200);
  assert.equal(compareDays(day(), valued).changes.length, 3);
  assert.equal(compareDays(day(card('zero', null)), day(card('zero', 0))).changes[0].kind, 'priced');
  assert.equal(compareDays(day(), { ...day(), valueCents: 0 }).status, 'ready');
});

test('a baseline, absent day or unreliable detail never produces invented card-level changes', () => {
  const good = day(card('a', 100));
  assert.equal(compareDays(null, null).status, 'empty');
  assert.equal(compareDays(null, good).status, 'baseline');
  for (const historical of [
    { ...good, cards: undefined },
    { ...good, cards: null },
    { ...good, valueCents: 400 },
    { ...good, total: 2 },
    { ...good, priced: 0 },
    day(card('a', 1), card('a', 2)),
    day(card('a', -1)),
    day(card('a', 2.5)),
    day(card('a', 1, '')),
  ]) {
    for (const result of [compareDays(good, historical), compareDays(historical, good)]) {
      assert.deepEqual(result, { status: 'legacy', netCents: null, changes: [] });
    }
  }
});
