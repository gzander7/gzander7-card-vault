import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchEbayReceipts } from './ebay-sold.mjs';
import { combineSoldLookups } from './sold-sources.mjs';
import { identityKey } from './identity.mjs';
import { changeReview, reviewedQuote } from './reviews.mjs';

const now = new Date('2026-11-20T18:00:00Z');
const card = {
  id: 'lamb',
  player: 'CeeDee Lamb',
  year: 2025,
  set_name: 'Topps Chrome',
  card_number: '76',
  parallel: 'Orange Leather',
  serial: '22/25',
};
const title = '2025 Topps Chrome Football CeeDee Lamb #76 Leather Orange 08/25 Cowboys';
const item = {
  item_id: '406895173407',
  title,
  url: 'https://www.ebay.com/itm/406895173407?nordt=true',
  price: 80,
  last_sold: '2026-11-17T03:00:00Z',
  format: 'FIXED_PRICE',
  units_sold: 1,
  card: { graded: false, flags: [] },
  print_run: 25,
};
const response = async (rows, receive = () => {}) =>
  fetchEbayReceipts(card, {
    key: 'fixture',
    now,
    fetchImpl: async (url, init) => {
      receive(url, init);
      return Response.json({ ok: true, source: 'ebay', items: rows });
    },
  });
const empty = () =>
  Promise.resolve({
    status: 'insufficient',
    checkedAt: now.toISOString(),
    valueCents: null,
    sales: [],
    source: 'CardPricer',
  });
const id = identityKey(card);
const lookup = (primary, secondary, options = {}) => combineSoldLookups(secondary, primary)(card, { now, ...options });
test('searches completed listings by variant and run independently of any catalogue ID', async () => {
  const rows = await response([item], (url, { headers }) => {
    assert.equal(url.origin + url.pathname, 'https://api.compsapi.com/v1/sold');
    assert.equal(url.searchParams.get('q'), '2025 Topps Chrome CeeDee Lamb Orange Leather /25');
    assert.equal(url.searchParams.get('best_offer'), '1');
    assert.equal(url.searchParams.get('days'), '365');
    assert.equal(new Headers(headers).get('x-api-key'), 'fixture');
    assert.ok(!url.href.includes('fixture'));
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://www.ebay.com/itm/406895173407');
  assert.equal(rows[0].priceCents, 8000);
});
test('rejects averages, bad receipts, different grades, unrelated variants and future sales', async () => {
  for (const delta of [
    { units_sold: 2 },
    { units_sold: null },
    { price: 0 },
    { currency: 'CAD' },
    { url: 'https://example.com/itm/406895173407' },
    { item_id: '999999999999' },
    { title: title.replace('Leather', 'Wave') },
    { title: title.replace('#76', '#77') },
    { title: title + ' PSA 10' },
    { title: title + ' Lot of 2' },
    { title: title.replace('08/25', '08/99') },
    { last_sold: '2026-11-21T00:00:00Z' },
  ]) {
    assert.deepEqual(await response([{ ...item, ...delta }]), [], JSON.stringify(delta));
  }
});
test('a strong numbered match that omits the checklist number is a reference until confirmed', async () => {
  const withoutNumber = title.replace('#76', '').trim() + ' SSP';
  const [reference] = await response([{ ...item, title: withoutNumber }]);
  assert.equal(reference.matchNote, 'Card number unconfirmed');
  const q = await lookup(empty, async () => ({ status: 'ready', sales: [reference] }));
  const reviewed = reviewedQuote(card, { ...q, identity: id }, {}, now);
  assert.equal(reviewed.sales.length, 0);
  assert.equal(reviewed.evidence[0].reason, 'Card number unconfirmed');
  const entries = changeReview(
    card,
    {},
    reviewed,
    {
      type: 'save',
      confirmUrl: reference.url,
      input: { url: reference.url, price: '80', date: '2026-11-17', parallel: 'Orange Leather', exact: true },
    },
    now,
  );
  assert.equal(reviewedQuote(card, { ...q, identity: id }, entries, now).sales.length, 1);
});
test('an older sale is visible without changing the 90-day median; sources deduplicate by eBay item', async () => {
  const [a] = await response([item]);
  const b = { ...a, url: 'https://www.ebay.com/itm/123456789012', priceCents: 3000 };
  const old = { ...a, url: 'https://www.ebay.com/itm/123456789013', soldAt: '2026-07-28T12:00:00Z' };
  const q = await lookup(
    async () => ({ ...(await empty()), sales: [{ ...a, url: a.url + '?tracking=123', priceCents: 1000 }, b] }),
    async () => ({ status: 'ready', sales: [a, old] }),
  );
  const manual = { [a.url]: { manual: { identity: id, exact: true, soldAt: '2026-11-17', priceCents: 5000 } } };
  const result = reviewedQuote(card, { ...q, identity: id }, manual, now);
  assert.equal(result.valueCents, 4000);
  assert.equal(result.evidence.length, 3);
  assert.equal(result.evidence.at(-1).reason, 'Outside the 90-day window');
});
test('one unavailable provider preserves its previous receipts and still accepts fresh sales from the other', async () => {
  const [a] = await response([item]);
  const previous = { identity: id, sales: [a] };
  const b = { ...a, provider: 'CardPricer', url: 'https://www.ebay.com/itm/123456789012', priceCents: 3000 };
  const q = await lookup(
    async () => ({ ...(await empty()), sales: [b] }),
    async () => {
      throw new Error('quota');
    },
    { previous },
  );
  assert.equal(q.valueCents, 5500);
  assert.equal(q.ebayStatus, 'retry');
  const recovered = await lookup(
    async () => {
      throw new Error('offline');
    },
    async () => ({ status: 'ready', sales: [a] }),
  );
  assert.equal(recovered.sales.length, 1);
  await assert.rejects(
    lookup(
      async () => {
        throw new Error('offline');
      },
      async () => ({ status: 'disabled', sales: [] }),
    ),
  );
});

test('a possible finish typo yields a reference for an autograph only when the rest of the card matches', async () => {
  const jeanty = {
    player: 'Ashton Jeanty',
    year: 2025,
    set_name: 'Resurgence',
    card_number: '149',
    parallel: 'Sliver',
    is_auto: true,
  };
  const listing = {
    ...item,
    title: '2025 Topps Resurgence #149 Ashton Jeanty RC - Silver Refractor Auto',
    print_run: null,
  };
  const sales = await fetchEbayReceipts(jeanty, {
    key: 'fixture',
    now,
    fetchImpl: async () =>
      Response.json({
        ok: true,
        source: 'ebay',
        items: [
          listing,
          {
            ...listing,
            title: listing.title.replace('Silver', 'Silver Static'),
            item_id: '123456789123',
            url: 'https://www.ebay.com/itm/123456789123',
          },
        ],
      }),
  });
  assert.equal(sales.length, 1);
  assert.equal(sales[0].matchNote, 'Parallel unconfirmed');
});

test('sparse cards search again the next UTC day; two recent automatic sales stay on the weekly cycle', async () => {
  const [a] = await response([item]);
  const sparse = await lookup(empty, async () => ({ status: 'ready', sales: [a] }));
  assert.equal(sparse.nextLookupAt, Date.parse('2026-11-21T00:00:00Z'));
  const b = { ...a, url: 'https://www.ebay.com/itm/123456789012' };
  const covered = await lookup(empty, async () => ({ status: 'ready', sales: [a, b] }));
  assert.equal(covered.nextLookupAt, +now + 7 * 86400000);
});
