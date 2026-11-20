import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingClient } from '../pricing-client.js';
import { identityKey } from './identity.mjs';

const session = { user: { id: 'owner' }, access_token: 'unit-test' };
const first = { id: 'first', owner: 'owner', player: 'Player A', year: 2025, set_name: 'Sample', card_number: '1' };
const blank = { ...first, id: 'second', card_number: '' };
const otherOwner = { ...first, id: 'other', owner: 'another' };

function fixture({
  disk = new Map(),
  readRemote = async () => null,
  writeRemote = async () => true,
  price = () => 1799,
} = {}) {
  let now = new Date('2026-11-01T10:00:00Z');
  let failure;
  const calls = [];
  const client = createPricingClient({
    lookup: async (card, options) => {
      calls.push(card.id);
      if (failure) throw failure;
      return {
        status: 'valued',
        valueCents: price(card),
        sales: [],
        checkedAt: options.now.toISOString(),
        source: 'CardPricer',
      };
    },
    clock: () => now,
    readRemote,
    writeRemote,
    storage: () => ({ getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }),
  });
  return {
    ...client,
    calls,
    disk,
    date: value => {
      now = new Date(value);
    },
    fail: error => {
      failure = error;
    },
  };
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
  assert.deepEqual(
    initial.history.map(({ valueCents, priced, total }) => [valueCents, priced, total]),
    [[1799, 1, 2]],
  );
  const later = await f.refreshVaultPrices(session, [
    { ...first, notes: 'New note' },
    { ...blank, card_number: '2' },
  ]);
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

test('a pre-upgrade quote is revalued from cached receipts and the next snapshot uses that median', async () => {
  const checkedAt = '2026-10-31T10:00:00Z';
  const sales = [100000, 12000, 11000, 10000].map((priceCents, index) => ({
    priceCents,
    soldAt: '2026-10-' + (30 - index),
    url: 'https://example.com/receipt/' + index,
    title: first.player,
  }));
  const legacy = { identity: identityKey(first), checkedAt, status: 'valued', valueCents: 11500, sales };
  const priorDay = { date: '2026-10-31', observedAt: checkedAt, valueCents: 11500, priced: 1, total: 1 };
  const f = fixture({ readRemote: async () => ({ quotes: { first: legacy }, history: [priorDay] }) });
  const next = await f.refreshVaultPrices(session, [first]);
  assert.deepEqual(f.calls, []);
  assert.equal(next.quotes.first.confidence, 'medium');
  assert.deepEqual(next.quotes.first.range, { lowCents: 10000, highCents: 12000 });
  assert.equal(next.quotes.first.evidence[0].reason, 'Unusual price');
  assert.deepEqual(
    next.history.map(day => day.valueCents),
    [11500, 11000],
  );
  assert.equal(next.quotes.first.diagnostics, undefined);
});

test('rejected-only listing counts keep their original check date during a provider outage', async () => {
  const diagnostics = { found: 2, verified: 0, unchecked: 0, rejected: { wrong_parallel: 2 } };
  const checkedAt = '2026-10-29T10:00:00Z';
  const quote = {
    identity: identityKey(first),
    checkedAt,
    status: 'insufficient',
    valueCents: null,
    sales: [],
    diagnostics,
  };
  const f = fixture({ readRemote: async () => ({ quotes: { first: quote }, history: [] }) });
  f.fail(new Error('Provider unavailable'));
  const next = await f.refreshVaultPrices(session, [first], { force: true });
  assert.equal(next.quotes.first.status, 'insufficient');
  assert.equal(next.quotes.first.refreshFailed, true);
  assert.equal(next.quotes.first.checkedAt, checkedAt);
  assert.deepEqual(next.quotes.first.diagnostics, diagnostics);
  assert.equal(next.history[0].priced, 0);
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
  const online = fixture({
    disk: local.disk,
    readRemote: async () => ({ quotes: {}, history: [] }),
    writeRemote: async (_user, quotes, days) => {
      writes.push([quotes, days]);
      return true;
    },
  });
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
  const f = fixture({
    readRemote: async () => {
      throw new Error('offline');
    },
  });
  const value = await f.refreshVaultPrices(session, [blank]);
  assert.equal(value.storage, 'device-offline');
  assert.equal(value.history[0].valueCents, null);
});

test('daily observations retain the owned cards, historical labels and unknown prices after removal', async () => {
  const f = fixture();
  const variant = { ...first, parallel: 'Gold', serial: '07/25', grader: 'PSA', grade: '9' };
  const saved = await f.refreshVaultPrices(session, [blank, otherOwner, variant]);
  const rows = saved.history[0].cards;
  assert.deepEqual(
    rows.map(({ id, valueCents }) => [id, valueCents]),
    [
      ['first', 1799],
      ['second', null],
    ],
  );
  for (const part of ['Player A', '2025', 'Sample', '#1', 'Gold', '07/25', 'PSA 9'])
    assert.ok(rows[0].label.includes(part));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'label', 'valueCents']);

  f.date('2026-11-03T10:00:00Z');
  await f.refreshVaultPrices(session, []);
  const reopened = await fixture({ disk: f.disk }).loadVaultPrices(session);
  assert.deepEqual(
    reopened.history.map(day => [day.date, day.cards]),
    [
      ['2026-11-01', rows],
      ['2026-11-03', []],
    ],
  );
});

test('history records manually reviewed estimates and coverage alongside automatic estimates', async () => {
  const f = fixture();
  const cards = [first, { ...first, id: 'second' }];
  await f.refreshVaultPrices(session, cards);
  const receipt = (lot, price) => ({
    type: 'save',
    input: { url: 'https://example.com/lot/' + lot, date: '2026-10-31', price, exact: true },
  });
  const one = await f.reviewSale(session, cards, first, receipt(1, '10'));
  assert.deepEqual(
    one.history[0].cards.map(row => row.valueCents),
    [null, 1799],
  );
  const two = await f.reviewSale(session, cards, first, receipt(2, '30'));
  assert.deepEqual(
    two.history[0].cards.map(row => row.valueCents),
    [2000, 1799],
  );
  assert.equal(two.history[0].valueCents, 3799);
});

test('opposing price moves, replacement cards, and label edits replace the same-day observation', async () => {
  const amounts = { first: 1000, second: 3000, third: 3000 };
  const f = fixture({ price: card => amounts[card.id] });
  const second = { ...first, id: 'second', card_number: '2' };
  const observe = async (cards, force = false) => (await f.refreshVaultPrices(session, cards, { force })).history[0];
  const initial = await observe([second, first]);
  assert.equal((await observe([first, second])).observedAt, initial.observedAt);
  amounts.first = amounts.second = 2000;
  const repriced = await observe([first, second], true);
  assert.ok(repriced.observedAt > initial.observedAt);
  assert.equal(repriced.valueCents, 4000);
  assert.deepEqual(
    repriced.cards.map(row => row.valueCents),
    [2000, 2000],
  );

  amounts.third = 2000;
  const third = { ...second, id: 'third', serial: '01/50' };
  const swapped = await observe([first, third]);
  assert.ok(swapped.observedAt > repriced.observedAt);
  assert.deepEqual(
    swapped.cards.map(row => row.id),
    ['first', 'third'],
  );
  const renamed = await observe([first, { ...third, serial: '02/50' }]);
  assert.ok(renamed.observedAt > swapped.observedAt);
  assert.ok(renamed.cards[1].label.includes('02/50'));
  assert.equal(renamed.valueCents, 4000);
});

test('card labels remain nonempty and bounded for incomplete cards and long Unicode names', async () => {
  const f = fixture();
  const result = await f.refreshVaultPrices(session, [
    { id: 'a', owner: first.owner, player: ' ' },
    { id: 'b', owner: first.owner, player: 'x' + '🏆'.repeat(320) },
  ]);
  const [incomplete, long] = result.history[0].cards;
  assert.ok(incomplete.label.trim().length);
  assert.ok([...long.label].length <= 320);
  assert.ok(long.label.isWellFormed());
  assert.equal(result.history[0].valueCents, null);
});

test('a daily record cannot store a rounded sum when individually valid prices exceed safe integer precision', async () => {
  const f = fixture({ price: card => (card.id === 'first' ? Number.MAX_SAFE_INTEGER : 2) });
  const before = await f.refreshVaultPrices(session, [first]);
  f.date('2026-11-02T10:00:00Z');
  await assert.rejects(f.refreshVaultPrices(session, [first, { ...first, id: 'second' }]), /total/i);
  const reloaded = await fixture({ disk: f.disk }).loadVaultPrices(session);
  assert.deepEqual(reloaded.history, before.history);
});

test('an unconfirmed inventory or aborted lookup never records a partial day', async () => {
  const f = fixture();
  await f.refreshVaultPrices(session, [first]);
  f.date('2026-11-02T10:00:00Z');
  const pending = await f.refreshVaultPrices(session, null);
  assert.deepEqual(
    pending.history.map(day => day.date),
    ['2026-11-01'],
  );
  const controller = new AbortController();
  const partial = await f.refreshVaultPrices(session, [first, blank], {
    force: true,
    signal: controller.signal,
    onUpdate(snapshot) {
      assert.deepEqual(
        snapshot.history.map(day => day.date),
        ['2026-11-01'],
      );
      controller.abort();
    },
  });
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(partial.history, pending.history);
  assert.deepEqual((await fixture({ disk: f.disk }).loadVaultPrices(session)).history, pending.history);
});

test('an inventory change in the final millisecond can sync a newer observation on the same UTC date', async () => {
  const writes = [];
  const f = fixture({
    readRemote: async () => ({ history: [], quotes: {} }),
    writeRemote: async (_session, _quotes, days) => {
      writes.push(...days);
      return true;
    },
  });
  f.date('2026-11-02T23:59:59.999Z');
  await f.refreshVaultPrices(session, [first]);
  await f.refreshVaultPrices(session, [{ ...first, id: 'replacement' }]);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].date, '2026-11-02');
  assert.equal(writes[1].observedAt, '2026-11-02T23:59:59.999001Z');
});

test('tied legacy and detailed observations merge only for matching totals and sync historical detail', async () => {
  const local = fixture();
  const detailed = (await local.refreshVaultPrices(session, [first])).history[0];
  const { cards, ...legacy } = detailed;
  // Postgres may render the same instant with a different UTC offset spelling.
  legacy.observedAt = detailed.observedAt.replace('Z', '+00:00');
  const writes = [];
  const online = fixture({
    disk: new Map(local.disk),
    readRemote: async () => ({ quotes: {}, history: [legacy] }),
    writeRemote: async (_session, _quotes, days) => {
      writes.push(...days);
      return true;
    },
  });
  online.date('2026-11-03T10:00:00Z');
  const merged = await online.refreshVaultPrices(session, []);
  assert.ok(Array.isArray(merged.history[0].cards));
  assert.deepEqual(merged.history[0].cards, cards);
  assert.deepEqual(
    writes.map(day => day.date),
    ['2026-11-01', '2026-11-03'],
  );
  await online.refreshVaultPrices(session, []);
  assert.equal(writes.length, 2);

  for (const replacement of [
    { ...legacy, valueCents: 1800 },
    { ...legacy, observedAt: '2026-11-01T11:00:00Z', cards: null },
    { ...legacy, observedAt: '2026-11-01T10:00:00.000001Z' },
  ]) {
    const reloaded = fixture({
      disk: new Map(local.disk),
      readRemote: async () => ({ quotes: {}, history: [replacement] }),
    });
    const result = await reloaded.loadVaultPrices(session);
    assert.deepEqual(result.history, [replacement]);
    assert.deepEqual((await fixture({ disk: reloaded.disk }).loadVaultPrices(session)).history, [replacement]);
  }
});
