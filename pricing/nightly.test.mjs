import assert from 'node:assert/strict';
import test from 'node:test';
import { identityKey } from './identity.mjs';
import { runNightlyValuations } from './nightly.mjs';

const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const card = (id, owner, extra = {}) => ({
  id,
  owner,
  player: 'Player ' + id,
  year: 2024,
  set_name: 'Prizm',
  card_number: id.slice(0, 2),
  ...extra,
});

function fakeDatabase(initial = {}) {
  const stored = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    stored,
    readPrices: async owner => structuredClone(stored.get(owner) || { quotes: {}, reviews: {}, history: [] }),
    writePrices: async (owner, updates, entries) => {
      writes.push({ owner, updates, entries });
      const current = stored.get(owner) || { quotes: {}, reviews: {}, history: [] };
      Object.assign(current.quotes, updates);
      for (const entry of entries) {
        current.history = current.history.filter(day => day.date !== entry.date).concat(entry);
      }
      stored.set(owner, current);
    },
  };
}

const clockAt = iso => () => new Date(iso);

test('every owner gets a fresh estimate and one snapshot for the night', async () => {
  const db = fakeDatabase();
  const looked = [];
  const result = await runNightlyValuations({
    listCards: async () => [card('a1', alice), card('a2', alice), card('b1', bob)],
    ...db,
    lookup: async (c, { now }) => {
      looked.push(c.id);
      return { status: 'valued', valueCents: 1000, sales: [], checkedAt: now.toISOString(), source: 'CardPricer' };
    },
    clock: clockAt('2026-11-20T09:17:00Z'),
  });
  assert.deepEqual(looked.sort(), ['a1', 'a2', 'b1']);
  assert.deepEqual(
    result.owners.map(({ owner, cards, priced, valueCents, date }) => [owner, cards, priced, valueCents, date]),
    [
      [alice, 2, 2, 2000, '2026-11-20'],
      [bob, 1, 1, 1000, '2026-11-20'],
    ],
  );
  const days = db.writes.flatMap(write => write.entries.map(entry => [write.owner, entry.date]));
  assert.deepEqual(days, [
    [alice, '2026-11-20'],
    [bob, '2026-11-20'],
  ]);
  assert.equal(result.lookupsStopped, false);
});

test('estimates checked within the last week are reused, so a quiet night only records the snapshot', async () => {
  const fresh = card('a1', alice);
  const db = fakeDatabase({
    [alice]: {
      quotes: {
        a1: {
          status: 'valued',
          valueCents: 4200,
          sales: [],
          checkedAt: '2026-11-18T09:00:00.000Z',
          identity: identityKey(fresh),
          source: 'CardPricer',
        },
      },
      reviews: {},
      history: [],
    },
  });
  const result = await runNightlyValuations({
    listCards: async () => [fresh],
    ...db,
    lookup: async () => assert.fail('no lookup expected'),
    clock: clockAt('2026-11-20T09:17:00Z'),
  });
  assert.equal(result.owners[0].valueCents, 4200);
  assert.deepEqual(
    db.writes.at(-1).entries.map(entry => entry.date),
    ['2026-11-20'],
  );
});

test('when the lookup budget runs out, snapshots are still recorded for everyone', async () => {
  const db = fakeDatabase();
  const result = await runNightlyValuations({
    listCards: async () => [card('a1', alice), card('b1', bob)],
    ...db,
    lookupBudgetMs: 0,
    lookup: async () => assert.fail('no time for lookups'),
    clock: clockAt('2026-11-20T09:17:00Z'),
  });
  assert.equal(result.lookupsStopped, true);
  assert.deepEqual(
    result.owners.map(({ owner, priced, date }) => [owner, priced, date]),
    [
      [alice, 0, '2026-11-20'],
      [bob, 0, '2026-11-20'],
    ],
  );
  assert.match(result.owners[0].notice, /budget/);
});

test('a provider outage keeps the previous estimate and still records the day', async () => {
  const kept = card('a1', alice);
  const db = fakeDatabase({
    [alice]: {
      quotes: {
        a1: {
          status: 'valued',
          valueCents: 900,
          sales: [],
          checkedAt: '2026-11-01T09:00:00.000Z',
          identity: identityKey(kept),
          source: 'CardPricer',
        },
      },
      reviews: {},
      history: [],
    },
  });
  const result = await runNightlyValuations({
    listCards: async () => [kept],
    ...db,
    lookup: async () => {
      throw Object.assign(new Error('Service unavailable'), { status: 503 });
    },
    clock: clockAt('2026-11-20T09:17:00Z'),
  });
  assert.equal(result.owners[0].valueCents, 900);
  assert.match(result.owners[0].notice, /could not be loaded/);
});

test('a project without the valuation functions fails loudly instead of pretending', async () => {
  await assert.rejects(
    runNightlyValuations({
      listCards: async () => [card('a1', alice)],
      readPrices: async () => null,
      writePrices: async () => {},
      lookup: async (c, { now }) => ({
        status: 'insufficient',
        valueCents: null,
        sales: [],
        checkedAt: now.toISOString(),
      }),
      clock: clockAt('2026-11-20T09:17:00Z'),
    }),
    /sync is not installed/,
  );
});
