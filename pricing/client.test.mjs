import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingClient } from '../pricing-client.js';

const session = { user: { id: 'owner' }, access_token: 'unit-test' };
const first = { id: 'first', owner: 'owner', player: 'Player A', year: 2025, set_name: 'Sample', card_number: '1' };
const blank = { ...first, id: 'second', card_number: '' };
const otherOwner = { ...first, id: 'other', owner: 'another' };

function fixture({ disk = new Map(), readRemote = async () => null, writeRemote = async () => true } = {}) {
  let now = new Date('2026-11-01T10:00:00Z');
  let failure;
  const calls = [];
  const client = createPricingClient({
    lookup: async (card, options) => {
      calls.push(card.id);
      if (failure) throw failure;
      return { status: 'valued', valueCents: 1799, sales: [], checkedAt: options.now.toISOString(), source: 'CardPricer' };
    },
    clock: () => now, readRemote, writeRemote,
    storage: () => ({ getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }),
  });
  return { ...client, calls, disk, date: value => { now = new Date(value); }, fail: error => { failure = error; } };
}

test('saving cards collects owner-only estimates with coverage and one daily snapshot', async () => {
  const f = fixture();
  const progress = [];
  const initial = await f.refreshVaultPrices(session, [first, blank, otherOwner], { onUpdate: s => progress.push(s) });
  assert.deepEqual(f.calls, ['first']);
  assert.ok(progress.length >= 1);
  assert.equal(initial.storage, 'device');
  assert.equal(initial.quotes.second.status, 'needs_details');
  assert.equal(initial.quotes.other, undefined);
  assert.deepEqual(initial.history.map(({ valueCents, priced, total }) => [valueCents, priced, total]), [[1799, 1, 2]]);
  const later = await f.refreshVaultPrices(session, [{ ...first, notes: 'New note' }, { ...blank, card_number: '2' }]);
  assert.deepEqual(f.calls, ['first', 'second']);
  assert.equal(later.history.length, 1);
  assert.equal(later.history[0].valueCents, 3598);
  f.date('2026-11-02T01:00:00Z');
  const next = await f.refreshVaultPrices(session, []);
  assert.deepEqual(next.quotes, {});
  assert.equal(next.history.length, 2);
  assert.equal(next.history[1].valueCents, null);
  const reopened = await fixture({ disk: f.disk }).loadVaultPrices(session);
  assert.equal(reopened.history[0].valueCents, 3598);
  assert.deepEqual((await f.loadVaultPrices({ user: { id: 'another' } })).history, []);
  assert.ok(![...f.disk.values()].some(s => s.includes('unit-test')));
});

test('refresh retains a dated estimate through an outage and respects the retry window', async () => {
  const f = fixture();
  const old = await f.refreshVaultPrices(session, [first]);
  f.fail(Object.assign(new Error('limited'), { status: 429, retryAfterMs: 60000 }));
  f.date('2026-11-02T12:00:00Z');
  const resend = await f.refreshVaultPrices(session, [first], { force: true });
  assert.equal(resend.quotes.first.valueCents, 1799);
  assert.equal(resend.quotes.first.checkedAt, old.quotes.first.checkedAt);
  assert.equal(resend.quotes.first.refreshFailed, true);
  await f.refreshVaultPrices(session, [first], { force: true });
  assert.equal(f.calls.length, 2);
  f.fail(null);
  f.date('2026-11-09T13:00:00Z');
  const recovered = await f.refreshVaultPrices(session, [first]);
  assert.equal(f.calls.length, 3);
  assert.equal(recovered.quotes.first.refreshFailed, undefined);
});

test('an edited or new card with a failed lookup does not borrow a past value', async () => {
  const f = fixture();
  await f.refreshVaultPrices(session, [first]);
  f.date('2026-11-01T12:00:00Z');
  f.fail(new Error('unavailable'));
  const update = await f.refreshVaultPrices(session, [{ ...first, parallel: 'Gold' }]);
  assert.equal(update.quotes.first.status, 'unavailable');
  assert.equal(update.history[0].priced, 0);
  assert.equal(update.history[0].valueCents, null);
});

test('optional cloud sync adopts prior local observations and only writes changes', async () => {
  const local = fixture();
  await local.refreshVaultPrices(session, [first]);
  const writes = [];
  const online = fixture({ disk: local.disk, readRemote: async () => ({ quotes: {}, history: [] }),
    writeRemote: async (_user, quotes, days) => { writes.push([quotes, days]); return true; } });
  const synced = await online.refreshVaultPrices(session, [first]);
  assert.equal(synced.storage, 'cloud');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].first.valueCents, 1799);
  assert.equal(writes[0][1][0].priced, 1);
  await online.refreshVaultPrices(session, [first]);
  assert.equal(writes.length, 1);
  assert.equal(online.calls.length, 0);
});

test('remote failure preserves local snapshots on the same device', async () => {
  const f = fixture({ readRemote: async () => { throw new Error('offline'); } });
  const value = await f.refreshVaultPrices(session, [blank]);
  assert.equal(value.storage, 'device-offline');
  assert.equal(value.history[0].valueCents, null);
});
