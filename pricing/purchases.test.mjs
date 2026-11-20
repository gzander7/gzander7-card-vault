import test from 'node:test';
import assert from 'node:assert/strict';
import { bookValueTotals, createPurchaseLedger, parsePurchase, purchaseTotals } from './purchases.mjs';

test('purchase inputs preserve exact cents, optional details and a zero-cost acquisition', () => {
  const parse = (amount, date = '', source = '') => parsePurchase({ amount, date, source }, '2026-11-18');
  assert.equal(parse(''), null);
  assert.deepEqual(parse('19.99', '2024-02-29', '  Card show  '), {
    amount_cents: 1999,
    purchased_on: '2024-02-29',
    source: 'Card show',
  });
  assert.deepEqual(parse('0'), { amount_cents: 0, purchased_on: null, source: null });
  assert.equal(parse('.29').amount_cents, 29);
  for (const invalid of ['-1', '1.005', '1e3', '10000000000', 'abc']) assert.throws(() => parse(invalid));
  for (const invalid of ['2026-02-29', '2026-11-19']) assert.throws(() => parse('5', invalid));
  assert.throws(() => parse('', '', 'Shop'));
});

test('a pull can record a box or just the acquisition without inventing a cost', () => {
  const fields = { amount: '', date: '', source: '', acquisitionType: 'pulled', boxName: '' };
  assert.deepEqual(parsePurchase(fields), {
    acquisition_type: 'pulled',
    box_name: null,
    amount_cents: null,
    purchased_on: null,
    source: null,
  });
  assert.deepEqual(
    parsePurchase({ ...fields, boxName: '  2023 Topps Chrome Hobby  ', date: '2024-02-29', source: ' Card shop ' }),
    {
      acquisition_type: 'pulled',
      box_name: '2023 Topps Chrome Hobby',
      amount_cents: null,
      purchased_on: '2024-02-29',
      source: 'Card shop',
    },
  );
  assert.equal(parsePurchase({ ...fields, amount: '0' }).amount_cents, 0);
  assert.equal(parsePurchase({ ...fields, amount: '9.25' }).amount_cents, 925);
  assert.throws(() => parsePurchase({ ...fields, amount: '1.005' }));
  assert.throws(() => parsePurchase({ ...fields, date: '2025-02-29' }));
  assert.equal(parsePurchase({ ...fields, boxName: 'x'.repeat(160) }).box_name.length, 160);
  assert.throws(() => parsePurchase({ ...fields, boxName: 'x'.repeat(161) }), /box/i);
  assert.equal(parsePurchase({ ...fields, acquisitionType: null, boxName: 'old draft value' }), null);
});

test('spending includes unpriced cards and gains use only cards with both amounts', () => {
  const cards = ['priced', 'unpriced', 'free', 'unknown', 'cleared', 'pull'].map(id => ({ id }));
  const purchases = {
    priced: { amount_cents: 1000 },
    unpriced: { amount_cents: 4000 },
    free: { acquisition_type: 'pulled', amount_cents: 0 },
    pull: { acquisition_type: 'pulled', box_name: 'Hobby', amount_cents: null },
    cleared: { amount_cents: null },
    deleted: { amount_cents: 6000 },
  };
  const quotes = { priced: 800, free: 400, unknown: 90000, cleared: 800, pull: 1500 };
  assert.deepEqual(
    purchaseTotals(cards, purchases, card => quotes[card.id]),
    {
      tracked: 3,
      spent: 5000,
      compared: 2,
      comparedCost: 1000,
      comparedValue: 1200,
      change: 200,
      percent: 20,
    },
  );
  assert.equal(purchaseTotals([cards[1]], purchases, () => null).change, null);
  assert.equal(purchaseTotals([cards[2]], purchases, () => 400).percent, null);
  assert.equal(purchaseTotals([cards[0]], purchases, () => 800).percent, -20);
});

test('book value uses the market estimate first and the recorded cost of remaining cards once', () => {
  const cards = ['both', 'market-only', 'paid-pull', 'gift', 'box-only', 'unknown'].map(id => ({ id }));
  const records = {
    both: { amount_cents: 12000 },
    'paid-pull': { acquisition_type: 'pulled', amount_cents: 4135 },
    gift: { amount_cents: 0 },
    'box-only': { acquisition_type: 'pulled', amount_cents: null, box_name: 'Hobby' },
    removed: { amount_cents: 80000 },
  };
  const marketValues = { both: 2000, 'market-only': 1505 };
  assert.deepEqual(
    bookValueTotals(cards, records, card => marketValues[card.id]),
    {
      valueCents: 7640,
      atMarket: 2,
      atCost: 2,
      missing: 2,
    },
  );
});

test('a recorded free card gives a zero book value while an empty or uncovered vault has no amount', () => {
  const card = { id: 'one' };
  const noEstimate = () => null;
  assert.deepEqual(bookValueTotals([card], { one: { amount_cents: 0 } }, noEstimate), {
    valueCents: 0,
    atMarket: 0,
    atCost: 1,
    missing: 0,
  });
  for (const amount_cents of [undefined, null, -1, '0', 1.5]) {
    assert.deepEqual(bookValueTotals([card], { one: { amount_cents } }, noEstimate), {
      valueCents: null,
      atMarket: 0,
      atCost: 0,
      missing: 1,
    });
  }
  assert.deepEqual(bookValueTotals([], null, noEstimate), {
    valueCents: null,
    atMarket: 0,
    atCost: 0,
    missing: 0,
  });
});

test('an unread purchase ledger leaves fallback coverage unknown unless every card has a market estimate', () => {
  const cards = [{ id: 'one' }, { id: 'two' }];
  assert.deepEqual(
    bookValueTotals(cards, null, card => (card.id === 'one' ? 1250 : null)),
    {
      valueCents: null,
      atMarket: 1,
      atCost: null,
      missing: null,
    },
  );
  assert.deepEqual(
    bookValueTotals(cards, null, card => (card.id === 'one' ? 1250 : 1950)),
    {
      valueCents: 3200,
      atMarket: 2,
      atCost: 0,
      missing: 0,
    },
  );
});

test('invalid market amounts fall back to cost and an unrepresentable total has no dollar amount', () => {
  const cards = [{ id: 'one' }, { id: 'two' }];
  const records = { one: { amount_cents: 6 }, two: { amount_cents: 5 } };
  for (const invalid of [0, -5, '100', 1.5, Infinity]) {
    assert.deepEqual(
      bookValueTotals(cards, records, () => invalid),
      {
        valueCents: 11,
        atMarket: 0,
        atCost: 2,
        missing: 0,
      },
    );
  }
  assert.equal(bookValueTotals(cards, records, () => Number.MAX_SAFE_INTEGER).valueCents, null);
});

test('a late cloud read cannot replace an acknowledged edit or expose another account', async () => {
  const calls = [];
  const ledger = createPurchaseLedger(() => new Promise((resolve, reject) => calls.push({ resolve, reject })));
  ledger.setSession({ user: { id: 'a' } });
  const initial = ledger.load();
  calls[0].resolve({ old: { amount_cents: 200 } });
  await initial;
  const refresh = ledger.load(true);
  ledger.accept('a', 'new', { amount_cents: 0 });
  calls[1].resolve({ old: { amount_cents: 300 } });
  await refresh;
  assert.equal(ledger.records.new.amount_cents, 0);
  const late = ledger.load(true);
  ledger.setSession({ user: { id: 'b' } });
  const next = ledger.load();
  calls[2].resolve({ secret: { amount_cents: 9000 } });
  calls[3].resolve({});
  await Promise.all([late, next]);
  assert.deepEqual(ledger.records, {});
  ledger.accept('a', 'old', { amount_cents: 500 });
  assert.deepEqual(ledger.records, {});
  const offline = ledger.load(true);
  calls[4].reject(new Error('offline'));
  await assert.rejects(offline);
  assert.equal(ledger.status, 'error');
  ledger.setSession(null);
  assert.deepEqual(ledger.records, {});
});
