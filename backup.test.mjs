import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVaultExport, exportFilename, vaultExportCsv } from './backup.mjs';

const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com' };
const cards = [
  {
    id: 'c1',
    created_at: '2026-11-01T00:00:00Z',
    player: 'José Ramírez',
    year: 2014,
    set_name: 'Topps, Update',
    card_number: 'US-12',
    parallel: null,
    serial: '12/99',
    is_auto: true,
    is_relic: false,
    grader: 'PSA',
    grade: '10',
    notes: 'Said "gem"\nline two',
    featured: true,
    image_path: 'owner/pairs/x/front.jpg',
    owner: owner.id,
  },
  { id: 'c2', player: '=HYPERLINK("http://evil")', image_path: 'owner/c2.jpg', is_auto: false },
];
const purchases = { c1: { amount_cents: 12550, purchased_on: '2026-10-01', source: 'Card show', revision: 'r1' } };
const prices = {
  quotes: {
    c1: {
      status: 'valued',
      valueCents: 20000,
      confidence: 'medium',
      range: { lowCents: 18000, highCents: 21000 },
      checkedAt: '2026-11-18T00:00:00.000Z',
      sales: [],
    },
  },
  reviews: { c1: { 'https://www.ebay.com/itm/1': { version: 'v', manual: { priceCents: 19000 } } } },
  history: [{ date: '2026-11-18', valueCents: 20000, priced: 1, total: 2 }],
};
const photoUrls = path => ({ front: 'https://cdn/' + path, back: path.includes('/pairs/') ? 'https://cdn/back' : '' });

test('the JSON backup carries cards, private records and history', () => {
  const data = buildVaultExport({
    cards,
    purchases,
    prices,
    photoUrls,
    owner,
    exportedAt: new Date('2026-11-19T12:00:00Z'),
  });
  assert.equal(data.format, 'card-vault-export');
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, '2026-11-19T12:00:00.000Z');
  assert.deepEqual(data.owner, owner);
  assert.equal(data.cards.length, 2);
  assert.deepEqual(data.cards[0].photos, { front: 'https://cdn/owner/pairs/x/front.jpg', back: 'https://cdn/back' });
  assert.equal(data.cards[0].purchase.amount_cents, 12550);
  assert.equal(data.cards[0].estimate.valueCents, 20000);
  assert.ok(data.cards[0].soldComps['https://www.ebay.com/itm/1']);
  assert.equal(data.cards[0].owner, undefined, 'the owner ID appears once, not on every card');
  assert.deepEqual(data.cards[1].photos.back, null);
  assert.equal(data.cards[1].purchase, null);
  assert.deepEqual(data.valueHistory, prices.history);
});

test('the CSV quotes commas, quotes and new lines, and neutralises formulas', () => {
  const data = buildVaultExport({ cards, purchases, prices, photoUrls, owner });
  const csv = vaultExportCsv(data);
  assert.ok(csv.startsWith(String.fromCharCode(0xfeff) + 'Player,Year,Set,'));
  const rows = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(rows.length, 3);
  assert.match(
    rows[1],
    /^José Ramírez,2014,"Topps, Update",US-12,,12\/99,Yes,No,PSA,10,Yes,"Said ""gem""\nline two",Bought,125\.50,2026-10-01,Card show,200\.00,medium,180\.00,210\.00,/,
  );
  assert.ok(rows[2].startsWith(`"'=HYPERLINK(""http://evil"")"`), rows[2]);
});

test('export filenames are dated', () => {
  assert.equal(exportFilename('csv', new Date('2026-11-19T23:00:00Z')), 'card-vault-2026-11-19.csv');
});
