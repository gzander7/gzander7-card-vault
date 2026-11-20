import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingClient } from '../pricing-client.js';
import { identityKey } from './identity.mjs';
import { changeReview, estimateSales, reviewedQuote } from './reviews.mjs';

const card = {
  id: 'card',
  owner: 'owner',
  player: 'Test Player',
  year: 2025,
  card_number: '17',
  set_name: 'Test set',
  parallel: 'Silver',
  is_auto: true,
};
const session = { user: { id: card.owner } };
const now = new Date('2026-11-18T15:00:00Z');
const sale = (id, price = '25.00', date = '2026-11-17') => ({
  url: 'https://www.ebay.com/itm/12345678900' + id,
  price,
  date,
  parallel: 'Silver',
  exact: true,
});
const first = sale(1);
const second = sale(2, '45');
const quote = sales => ({
  status: sales.length >= 2 ? 'valued' : 'insufficient',
  checkedAt: now.toISOString(),
  sales,
  valueCents: sales.length >= 2 ? 3500 : null,
  identity: identityKey(card),
  source: 'CardPricer',
});
const auto = input => ({
  url: input.url,
  title: 'Silver autograph sale',
  soldAt: input.date + 'T15:00:00Z',
  priceCents: Math.round(Number(input.price) * 100),
});
function fixture({ disk = new Map(), provider = [], cloud, write, time = now } = {}) {
  let tick = time;
  let offline = false;
  const client = createPricingClient({
    clock: () => tick,
    lookup: async () => {
      if (offline) throw new Error('Provider unavailable');
      return quote(provider);
    },
    readRemote: async () => cloud ?? null,
    writeRemote: write ?? (async () => true),
    storage: () => ({ getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }),
  });
  return {
    client,
    disk,
    goOffline: () => {
      offline = true;
    },
    date: d => {
      tick = new Date(d);
    },
    refresh: (list = [card]) => client.refreshVaultPrices(session, list),
    change: (command, target = card) => client.reviewSale(session, [target], target, command),
  };
}
test('one owner-entered receipt stays visible, two price the vault, and both survive a reload and automatic refresh', async () => {
  const f = fixture();
  await f.refresh();
  assert.equal(typeof f.client.reviewSale, 'function', 'owner can save a completed sale');
  const one = await f.change({ type: 'save', input: first });
  assert.equal(one.quotes.card.evidence.length, 1);
  assert.equal(one.quotes.card.valueCents, null);
  const two = await f.change({ type: 'save', input: second });
  assert.equal(two.quotes.card.valueCents, 3500);
  assert.deepEqual(
    two.history.map(r => [r.valueCents, r.priced, r.total]),
    [[3500, 1, 1]],
  );
  const reopened = fixture({ disk: f.disk });
  assert.equal((await reopened.refresh()).quotes.card.valueCents, 3500);
  const foreign = await reopened.client.loadVaultPrices({ user: { id: 'someone-else' } });
  assert.deepEqual(foreign.quotes, {});
  await assert.rejects(reopened.change({ type: 'save', input: first }, { ...card, owner: 'someone-else' }));
});
test('excluding and restoring a provider sale updates coverage and never duplicates a listing', async () => {
  const f = fixture({ provider: [auto(first), auto(second)] });
  await f.refresh();
  const duplicate = { ...first, url: 'https://m.ebay.co.uk/itm/test/123456789001?mkcid=123' };
  await assert.rejects(f.change({ type: 'save', input: duplicate }), /already/i);
  const flagged = await f.change({ type: 'exclude', url: first.url, reason: 'Wrong autograph' });
  assert.equal(flagged.quotes.card.valueCents, null);
  assert.equal(flagged.history.at(-1).priced, 0);
  assert.equal(flagged.quotes.card.evidence.find(s => s.url === first.url).flag, 'Wrong autograph');
  const refreshed = await f.client.refreshVaultPrices(session, [card], { force: true });
  assert.equal(refreshed.quotes.card.valueCents, null);
  const restored = await f.change({ type: 'restore', url: first.url });
  assert.equal(restored.quotes.card.valueCents, 3500);
});
test('older sales and reference-only entries remain visible, and changed cards require a fresh match confirmation', async () => {
  const f = fixture();
  await f.refresh();
  await f.change({ type: 'save', input: { ...first, date: '2026-06-01' } });
  await f.change({ type: 'save', input: { ...second, parallel: 'Gold', exact: false } });
  const res = await f.change({ type: 'save', input: sale(3) });
  assert.equal(res.quotes.card.evidence.length, 3);
  assert.equal(res.quotes.card.sales.length, 1);
  assert.equal(res.quotes.card.valueCents, null);
  const changed = await f.refresh([{ ...card, grader: 'PSA', grade: '10' }]);
  assert.equal(changed.quotes.card.evidence.length, 3);
  assert.equal(changed.quotes.card.sales.length, 0);
});
test('validates sold dates, USD prices, marketplace links, and parallel before any change', async () => {
  const f = fixture();
  await f.refresh();
  for (const bad of [
    { price: '0' },
    { price: '-1' },
    { price: '1.123' },
    { date: '2026-02-30' },
    { date: '2026-11-19' },
    { url: 'javascript:alert(1)' },
    { url: 'https://name:pass@test.example/sale/1' },
    { url: 'https://www.ebay.com/sch/i.html?_nkw=test' },
    { parallel: 'Gold' },
  ]) {
    await assert.rejects(f.change({ type: 'save', input: { ...first, ...bad } }), Error);
  }
  assert.equal((await f.refresh()).history[0].priced, 0);
});
test('edits, removes and ages out sales, with only the five newest eligible receipts used', async () => {
  const f = fixture();
  await f.refresh();
  for (let i = 1; i <= 6; i++)
    await f.change({ type: 'save', input: sale(i, String(i * 10), '2026-11-' + String(i + 10)) });
  let result = await f.change({
    type: 'save',
    key: sale(5).url,
    input: { ...sale(5), price: '100', date: '2026-11-15' },
  });
  assert.equal(result.quotes.card.sales.length, 5);
  assert.equal(result.quotes.card.valueCents, 4000);
  result = await f.change({ type: 'remove', url: sale(4).url });
  assert.equal(result.quotes.card.evidence.length, 5);
  assert.equal(result.quotes.card.valueCents, 3000);
  f.date('2027-03-01');
  result = await f.refresh();
  assert.equal(result.quotes.card.evidence.length, 5);
  assert.equal(result.history.at(-1).priced, 0);
});

test('two devices merge distinct receipts, a deletion wins over stale copies, and old sync installations keep reviews local', async () => {
  const remote = { quotes: {}, history: [], reviews: {} };
  let clock = now;
  const build = () =>
    createPricingClient({
      clock: () => clock,
      lookup: async () => quote([]),
      storage: (() => {
        const disk = new Map();
        return () => ({ getItem: k => disk.get(k), setItem: (k, v) => disk.set(k, v) });
      })(),
      readRemote: async () => structuredClone(remote),
      writeRemote: async (_session, quotes, days) => {
        Object.assign(remote.quotes, structuredClone(quotes));
        if (days.length) remote.history = structuredClone(days);
        return true;
      },
      writeRemoteReviews: async (_session, changes) => {
        for (const [id, records] of Object.entries(changes)) {
          const entries = (remote.reviews[id] ||= {});
          for (const [url, record] of Object.entries(records)) {
            if (!entries[url] || entries[url].version < record.version) entries[url] = structuredClone(record);
          }
        }
        return structuredClone(remote.reviews);
      },
    });
  const a = build(),
    b = build();
  await Promise.all([a.refreshVaultPrices(session, [card]), b.refreshVaultPrices(session, [card])]);
  await a.reviewSale(session, [card], card, { type: 'save', input: first });
  const both = await b.reviewSale(session, [card], card, { type: 'save', input: second });
  assert.equal(both.reviewStorage, 'cloud');
  assert.equal(both.quotes.card.valueCents, 3500);
  assert.equal(remote.history[0].valueCents, 3500);
  await b.reviewSale(session, [card], card, { type: 'remove', url: first.url });
  clock = new Date(+now + 120000);
  const updated = await a.refreshVaultPrices(session, [card]);
  assert.equal(updated.quotes.card.evidence.length, 1);
  assert.equal(updated.quotes.card.valueCents, null);
  const legacy = fixture({ cloud: { quotes: {}, history: [] } });
  await legacy.refresh();
  const saved = await legacy.change({ type: 'save', input: first });
  assert.equal(saved.reviewStorage, 'device');
  assert.equal(saved.quotes.card.evidence.length, 1);
});

test('a stale inventory in a second tab cannot erase a local-only sale on a newly added card', async () => {
  const disk = new Map();
  const a = fixture({ disk }),
    b = fixture({ disk });
  const added = { ...card, id: 'later-card' };
  await b.refresh([card]);
  await a.client.reviewSale(session, [card, added], added, { type: 'save', input: first });
  await b.refresh([card]);
  const reopened = await fixture({ disk }).refresh([card, added]);
  assert.equal(reopened.quotes[added.id].evidence?.length, 1);
});
test('removing a flagged manual-only receipt removes its evidence too', async () => {
  const f = fixture();
  await f.change({ type: 'save', input: first });
  await f.change({ type: 'exclude', url: first.url, reason: 'Wrong grade' });
  const removed = await f.change({ type: 'remove', url: first.url });
  assert.equal(removed.quotes.card?.evidence?.length || 0, 0);
});
test('a provider receipt that appears later counts once and preserves the authored reference during an outage', async () => {
  const provider = [];
  const f = fixture({ provider });
  await f.change({ type: 'save', input: first });
  provider.push(auto(first), auto(second));
  let q = (await f.client.refreshVaultPrices(session, [card], { force: true })).quotes.card;
  assert.equal(q.evidence.length, 2);
  assert.equal(q.evidence.filter(row => row.automatic && row.manual).length, 1);
  assert.equal(q.valueCents, 3500);
  q = (await f.change({ type: 'exclude', url: second.url, reason: 'Wrong parallel' })).quotes.card;
  assert.equal(q.valueCents, null);
  f.goOffline();
  f.date('2026-11-19T15:00:00Z');
  q = (await f.client.refreshVaultPrices(session, [card], { force: true })).quotes.card;
  assert.equal(q.refreshFailed, true);
  assert.equal(q.evidence.length, 2);
  assert.equal(q.valueCents, null);
});

test('a confirmed card deletion drops its private reviews even if an older tab later saves its cache', async () => {
  const disk = new Map();
  const firstTab = fixture({ disk });
  await firstTab.change({ type: 'save', input: first });
  const secondTab = fixture({ disk });
  await secondTab.refresh();
  firstTab.client.forgetCardReviews(session, card);
  await secondTab.refresh();
  await assert.rejects(secondTab.change({ type: 'save', input: second }), /removed/i);
  assert.ok(![...disk.values()].some(value => value.includes(first.url)));
});

test('editing a manual sale overrides a matching feed receipt in evidence, median and daily totals after reload', async () => {
  const provider = [];
  const f = fixture({ provider });
  await f.change({ type: 'save', input: first });
  provider.push(
    { ...auto(sale(1, '10', '2026-11-01')), url: 'https://m.ebay.co.uk/itm/test/123456789001?mkcid=123' },
    auto(sale(2, '30')),
  );
  await f.client.refreshVaultPrices(session, [card], { force: true });
  const corrected = await f.change({ type: 'save', key: first.url, input: sale(1, '50') });
  const reopened = fixture({ disk: f.disk, provider });
  const refreshed = await reopened.client.refreshVaultPrices(session, [card], { force: true });
  for (const result of [corrected, refreshed]) {
    const q = result.quotes.card;
    assert.equal(q.evidence.length, 2);
    assert.equal(q.valueCents, 4000);
    const receipt = q.evidence.find(row => row.url === first.url);
    assert.equal(receipt.priceCents, 5000);
    assert.equal(receipt.soldAt, '2026-11-17');
    assert.equal(receipt.title, 'Test Player · Silver');
    assert.equal(receipt.automatic, true);
    assert.ok(receipt.manual);
    assert.equal(result.history.at(-1).valueCents, 4000);
    assert.equal(result.history.at(-1).cards[0].valueCents, 4000);
  }
  const removed = await reopened.change({ type: 'remove', url: first.url });
  assert.equal(removed.quotes.card.valueCents, 2000);
  const original = removed.quotes.card.evidence.find(row => row.url === first.url);
  assert.equal(original.priceCents, 1000);
  assert.equal(original.soldAt, '2026-11-01T15:00:00Z');
  assert.ok(!original.manual);
});

for (const { manualDate, feedDate, value, reason } of [
  { manualDate: '2026-08-01', feedDate: '2026-11-17', value: null, reason: 'Outside the 90-day window' },
  { manualDate: '2026-11-17', feedDate: '2026-08-01', value: 4000, reason: undefined },
  { manualDate: '2026-11-17', feedDate: '2026-11-19', value: 4000, reason: undefined },
]) {
  test(`manual date ${manualDate} controls eligibility over feed date ${feedDate}`, async () => {
    const provider = [];
    const f = fixture({ provider });
    await f.change({ type: 'save', input: sale(1, '50', manualDate) });
    provider.push(auto(sale(1, '10', feedDate)), auto(sale(2, '30')));
    const q = (await f.client.refreshVaultPrices(session, [card], { force: true })).quotes.card;
    assert.equal(q.valueCents, value);
    assert.equal(q.evidence.find(row => row.url === first.url).reason, reason);
    assert.equal(q.evidence.find(row => row.url === first.url).soldAt, manualDate);
    assert.equal(
      q.sales.some(row => row.url === first.url),
      value !== null,
    );
  });
}

test('the corrected date moves a provider overflow receipt into the latest five', () => {
  const entries = changeReview(card, {}, null, { type: 'save', input: sale(1, '100') }, now);
  const automatic = quote([2, 3, 4, 5, 6].map(id => auto(sale(id, String(id * 10), `2026-11-${18 - id}`))));
  automatic.extraSales = [auto(sale(1, '10', '2026-11-01'))];
  const original = structuredClone(automatic);
  const q = reviewedQuote(card, automatic, entries, now);
  assert.deepEqual(
    q.sales.map(row => row.url),
    [1, 2, 3, 4, 5].map(id => sale(id).url),
  );
  assert.equal(q.evidence.find(row => row.url === sale(6).url).reason, 'Outside the latest five');
  assert.equal(q.valueCents, 4000);
  assert.deepEqual(automatic, original);
});

test('manual precedence respects reference status, exclusions and the card identity', () => {
  const entries = changeReview(card, {}, null, { type: 'save', input: sale(1, '50') }, now);
  const automatic = quote([auto(sale(1, '10', '2026-11-01')), auto(sale(2, '30'))]);
  let q = reviewedQuote(card, automatic, entries, now);
  const excluded = changeReview(card, entries, q, { type: 'exclude', url: first.url, reason: 'Wrong parallel' }, now);
  q = reviewedQuote(card, automatic, excluded, now);
  assert.equal(q.valueCents, null);
  assert.equal(q.evidence.find(row => row.url === first.url).priceCents, 5000);
  assert.equal(q.evidence.find(row => row.url === first.url).reason, 'Wrong parallel');
  const restored = changeReview(card, excluded, q, { type: 'restore', url: first.url }, now);
  assert.equal(reviewedQuote(card, automatic, restored, now).valueCents, 4000);

  const reference = changeReview(
    card,
    entries,
    q,
    { type: 'save', key: first.url, input: { ...sale(1, '50'), exact: false } },
    now,
  );
  q = reviewedQuote(card, automatic, reference, now);
  assert.equal(q.valueCents, null);
  assert.equal(q.evidence.find(row => row.url === first.url).reason, 'Reference only');

  const changedCard = { ...card, parallel: 'Gold' };
  q = reviewedQuote(changedCard, { ...automatic, identity: identityKey(changedCard) }, entries, now);
  assert.equal(q.valueCents, 2000);
  assert.equal(q.evidence.find(row => row.url === first.url).priceCents, 1000);
  q = reviewedQuote(changedCard, undefined, entries, now);
  assert.equal(q.sales.length, 0);
  assert.equal(q.evidence[0].reason, 'Card details changed');
});

function orderedReceipts(prices, dates = []) {
  return prices.map((priceCents, index) => ({
    ...auto(sale(index + 1)),
    priceCents,
    soldAt: dates[index] ?? `2026-11-${18 - index}`,
  }));
}

test('unusual sales on either side of the median leave the latest five without backfilling', () => {
  const sample = orderedReceipts([251, 102, 39, 100, 98, 99]);
  const estimate = estimateSales(sample);
  assert.deepEqual(estimate, {
    valueCents: 100,
    confidence: 'medium',
    range: { lowCents: 98, highCents: 102 },
    sales: [sample[1], sample[3], sample[4]],
    unusual: [sample[0], sample[2]],
  });
  assert.equal(estimate.sales[0], sample[1]);
  assert.equal(estimate.unusual[0], sample[0]);
});

for (const { name, prices, valueCents, confidence, range } of [
  {
    name: 'the two exact 2.5× boundaries count',
    prices: [40, 100, 100, 250],
    valueCents: 100,
    confidence: 'low',
    range: { lowCents: 40, highCents: 250 },
  },
  {
    name: 'four sales use the unrounded initial median',
    prices: [40, 100, 101, 252],
    valueCents: 101,
    confidence: 'low',
    range: { lowCents: 100, highCents: 101 },
  },
  {
    name: 'cents near the safe-integer limit retain strict guard boundaries',
    prices: [3_000_000_000_000_001, 3_000_000_000_000_001, 3_000_000_000_000_002, 7_500_000_000_000_004],
    valueCents: 3_000_000_000_000_001,
    confidence: 'medium',
    range: { lowCents: 3_000_000_000_000_001, highCents: 3_000_000_000_000_002 },
  },
  {
    name: 'three widely spread sales all count',
    prices: [10, 100, 1000],
    valueCents: 100,
    confidence: 'low',
    range: { lowCents: 10, highCents: 1000 },
  },
  {
    name: 'two identical sales still give low confidence',
    prices: [100, 100],
    valueCents: 100,
    confidence: 'low',
    range: { lowCents: 100, highCents: 100 },
  },
  { name: 'one sale stays visible without an estimate', prices: [88], valueCents: null, confidence: null, range: null },
  {
    name: 'only one surviving sale leaves the card unpriced',
    prices: [1, 2, 1000, 9999],
    valueCents: null,
    confidence: null,
    range: null,
  },
]) {
  test(name, () => {
    const q = reviewedQuote(card, quote(orderedReceipts(prices)), {}, now);
    assert.deepEqual(
      { valueCents: q.valueCents, confidence: q.confidence, range: q.range },
      { valueCents, confidence, range },
    );
  });
}

test('confidence uses the UTC calendar dates and the strict spread threshold of surviving sales', () => {
  const newest = '2026-11-17T23:10:00-01:00';
  const oldest = '2026-11-05T00:59:00+01:00';
  for (const [oldestSale, highestPrice, confidence] of [
    [oldest, 199, 'high'],
    [oldest, 200, 'low'],
    ['2026-11-05', 199, 'medium'],
  ]) {
    const receipts = orderedReceipts([100, 150, 151, highestPrice], [newest, '2026-11-14', '2026-11-09', oldestSale]);
    const q = reviewedQuote(card, quote(receipts), {}, now);
    assert.equal(q.confidence, confidence);
  }
});

test('owner corrections and flags determine which receipts face the unusual-price check', () => {
  const [spike, ...others] = orderedReceipts(
    [10000, 1000, 1200, 1010, 1050, 900],
    ['2026-11-18', '2026-11-17', '2026-11-14', '2026-11-10', '2026-11-04', '2026-11-03'],
  );
  const automatic = { ...quote(others.slice(0, 4)), extraSales: [spike, others[4]] };
  const initial = reviewedQuote(card, automatic, {}, now);
  assert.equal(initial.valueCents, 1030);
  assert.equal(initial.confidence, 'medium');
  assert.equal(initial.evidence[0].reason, 'Unusual price');
  assert.equal(initial.evidence.at(-1).reason, 'Outside the latest five');

  const corrected = changeReview(card, {}, null, { type: 'save', input: sale(1, '10.20', '2026-11-18') }, now);
  const edited = reviewedQuote(card, automatic, corrected, now);
  assert.equal(edited.valueCents, 1020);
  assert.equal(edited.confidence, 'high');
  assert.equal(edited.evidence[0].reason, undefined);
  assert.equal(edited.sales[0].priceCents, 1020);

  const flag = changeReview(card, corrected, edited, { type: 'exclude', url: spike.url, reason: 'Wrong grade' }, now);
  const flagged = reviewedQuote(card, automatic, flag, now);
  assert.equal(flagged.evidence[0].reason, 'Wrong grade');
  assert.equal(flagged.sales.at(-1).url, others[4].url);
  assert.equal(flagged.valueCents, 1010);
  assert.deepEqual(flagged.range, { lowCents: 900, highCents: 1200 });
});

test('a saved estimate without receipts keeps its value and has no confidence or range', () => {
  for (const saved of [[], [null, { url: 'missing', priceCents: 1000 }]]) {
    const old = { ...quote(saved), status: 'valued', valueCents: 875 };
    const q = reviewedQuote(card, old, {}, now);
    assert.equal(q.status, 'valued');
    assert.equal(q.valueCents, 875);
    assert.equal(q.confidence, null);
    assert.equal(q.range, null);
    assert.deepEqual(q.sales, []);
  }
});

test('malformed saved receipts cannot break the vault or count toward an estimate', () => {
  const [first, ...valid] = orderedReceipts([99, 110, 120, 130, 140, 150]);
  for (const [invalidFields, reason] of [
    [{ priceCents: 12.5 }, 'Invalid sale price'],
    [{ priceCents: 0 }, 'Invalid sale price'],
    [{ priceCents: '99' }, 'Invalid sale price'],
    [{ priceCents: Number.MAX_SAFE_INTEGER + 1 }, 'Invalid sale price'],
    [{ soldAt: null }, 'Invalid sale date'],
    [{ soldAt: 'unknown' }, 'Invalid sale date'],
    [{ soldAt: '2026-11' }, 'Invalid sale date'],
    [{ soldAt: '2026-09-31' }, 'Invalid sale date'],
    [{ soldAt: '2026-11-15T23:00:00' }, 'Invalid sale date'],
  ]) {
    const damaged = { ...first, ...invalidFields };
    const mixed = reviewedQuote(card, quote([damaged, ...valid]), {}, now);
    assert.deepEqual(
      mixed.sales.map(row => row.url),
      valid.map(row => row.url),
    );
    assert.equal(mixed.valueCents, 130);
    assert.equal(mixed.evidence.find(row => row.url === damaged.url).reason, reason);

    const lone = reviewedQuote(card, quote([damaged]), {}, now);
    assert.equal(lone.status, 'insufficient');
    assert.equal(lone.valueCents, null);
    assert.equal(lone.confidence, null);
    assert.equal(lone.range, null);
  }
});
