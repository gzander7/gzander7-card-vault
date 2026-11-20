import test from 'node:test';
import assert from 'node:assert/strict';
import { caseIdFromSearch, caseLink, caseFields, presentCard } from './cards.mjs';
import { readPublicCase } from './reader.mjs';
import { listPickerCards, saveCase, stopSharing, CaseConflict } from './store.mjs';
import { createDisplayCases } from './manager.mjs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001';
const first = '40000000-0000-4000-8000-000000000001';
const second = '40000000-0000-4000-8000-000000000002';
const rev = '50000000-0000-4000-8000-000000000001';
const next = '50000000-0000-4000-8000-000000000002';
const fields = { title: 'Playoff shelf', card_ids: [second, first] };
const allowed = [
  { id: first, owner },
  { id: second, owner },
];

test('creating or closing a dormant manager leaves the document and backend untouched', () => {
  const manager = createDisplayCases({ client: {}, getOwner: () => '' });
  manager.close();
  manager.open();
});

test('links keep the Pages project path and drop vault query parameters and fragments', () => {
  assert.equal(
    caseLink('https://example.test/vault/index.html?ref=old#gallery', id),
    'https://example.test/vault/case.html?id=' + id,
  );
  assert.equal(caseIdFromSearch('?id=' + id), id);
  for (const query of ['', '?id=bogus', '?id=' + id + '&id=' + first]) {
    assert.equal(caseIdFromSearch(query), null);
  }
});

test('the editor preserves the selected order and only accepts cards in the picker catalogue', () => {
  assert.deepEqual(caseFields('  Playoff shelf  ', [second, first], allowed), fields);
  for (const selection of [[], [id], [first, first]]) {
    assert.throws(() => caseFields('Case', selection, allowed));
  }
  assert.throws(() => caseFields('  ', [first], allowed));
  assert.throws(() => caseFields('x'.repeat(81), [first], allowed));
  const many = Array.from({ length: 61 }, () => ({ id: crypto.randomUUID(), owner }));
  assert.equal(
    caseFields(
      'x'.repeat(80),
      many.slice(0, 60).map(c => c.id),
      many,
    ).card_ids.length,
    60,
  );
  assert.throws(() =>
    caseFields(
      'Case',
      many.map(c => c.id),
      many,
    ),
  );
});

function cardCatalogue(records, { cap = 73, failPage = 0 } = {}) {
  let requests = 0;
  return {
    from(table) {
      assert.equal(table, 'cards');
      let columns, limit;
      let rows = [...records];
      return {
        select(fields) {
          columns = fields.split(',');
          return this;
        },
        eq(key, value) {
          rows = rows.filter(row => row[key] === value);
          return this;
        },
        gt(key, value) {
          rows = rows.filter(row => row[key] > value);
          return this;
        },
        order(key, options) {
          rows.sort((a, b) => a[key].localeCompare(b[key]) * (options?.ascending === false ? -1 : 1));
          return this;
        },
        limit(value) {
          limit = value;
          return this;
        },
        async abortSignal() {
          if (++requests === failPage) return { data: null, error: new Error('Catalogue offline') };
          if (requests > records.length + 2) throw new Error('Repeated page');
          const data = rows
            .slice(0, Math.min(limit, cap))
            .map(row => Object.fromEntries(columns.map(key => [key, row[key]])));
          return { data, error: null };
        },
      };
    },
  };
}

test('the picker keeps older selections beyond 1,000 rows and server caps smaller than the requested page', async () => {
  const fixture = Array.from({ length: 1005 }, (_, index) => ({
    id: '40000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    owner,
    player: index === 1004 ? 'A. Rivers' : 'B. Fields',
    year: 2025,
    set_name: 'Sample',
    card_number: '1',
    parallel: null,
    serial: null,
    is_auto: false,
    is_relic: false,
    grader: null,
    grade: null,
    image_path: 'fixture.jpg',
    notes: 'PRIVATE',
  }));
  const oldest = fixture.at(-1).id;
  const source = cardCatalogue([{ id, owner: other, player: 'Other collection' }, ...fixture.reverse()]);
  const cards = await listPickerCards(source, owner);
  assert.equal(cards.length, 1005);
  assert.equal(new Set(cards.map(card => card.id)).size, 1005);
  assert.equal(cards[0].id, oldest);
  assert.deepEqual(caseFields('Old cards', [oldest, first], cards).card_ids, [oldest, first]);
  assert.equal(
    cards.some(card => card.id === id),
    false,
  );
  assert.deepEqual(Object.keys(cards[0]).sort(), [
    'card_number',
    'grade',
    'grader',
    'id',
    'image_path',
    'is_auto',
    'is_relic',
    'parallel',
    'player',
    'serial',
    'set_name',
    'year',
  ]);
});

test('a later picker-page failure rejects the whole catalogue before it can be used for editing', async () => {
  const source = cardCatalogue(
    [
      { id: first, owner, player: 'A' },
      { id: second, owner, player: 'B' },
    ],
    { cap: 1, failPage: 2 },
  );
  await assert.rejects(listPickerCards(source, owner), /Catalogue offline/);
});

test('public photo URLs stay in the image bucket and preserve the older front-only layout', () => {
  const root = SUPABASE_URL + '/storage/v1/object/public/card-images/';
  const paired = presentCard({ id: first, player: 'Player A', image_path: owner + '/pairs/' + id + '/front.jpg' });
  assert.equal(paired.frontUrl, root + owner + '/pairs/' + id + '/front.jpg');
  assert.equal(paired.backUrl, root + owner + '/pairs/' + id + '/back');
  const legacy = presentCard({ id: first, player: 'Player A', image_path: owner + '/older photo.jpg' });
  assert.equal(legacy.frontUrl, root + owner + '/older%20photo.jpg');
  assert.equal(legacy.backUrl, '');
  for (const image_path of ['https://outside.test/image.jpg', '../other-bucket/image.jpg', 'folder/%2e%2e/key', '']) {
    assert.equal(presentCard({ id: first, image_path }).frontUrl, '');
  }
});

test('a public read requests one anonymous case and exposes only catalogue details in server order', async () => {
  const raw = {
    title: 'October',
    owner,
    cards: [
      {
        id: second,
        player: 'Player B',
        year: 2025,
        set_name: 'The Set',
        serial: '8/25',
        is_relic: true,
        notes: 'PRIVATE-NOTE',
        purchase_source: 'PRIVATE-SOURCE',
        owner,
      },
      { id: first, player: 'Player A', image_path: '' },
    ],
  };
  const result = await readPublicCase(id, async (url, options) => {
    assert.equal(url, SUPABASE_URL + '/rest/v1/rpc/vault_read_display_case');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(new Headers(options.headers).get('apikey'), SUPABASE_ANON_KEY);
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.deepEqual(JSON.parse(options.body), { p_case_id: id });
    return Response.json(raw);
  });
  assert.deepEqual(
    result.cards.map(card => card.name),
    ['Player B', 'Player A'],
  );
  assert.deepEqual(result.cards[0].tags, ['Relic', 'Serial 8/25']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|owner|purchase_source|notes/);
  assert.equal(await readPublicCase(id, () => Response.json(null)), null);
  assert.equal(await readPublicCase(id, () => new Response(null, { status: 204 })), null);
  assert.deepEqual(await readPublicCase(id, () => Response.json({ title: 'Empty', cards: [] })), {
    title: 'Empty',
    cards: [],
  });
  await assert.rejects(readPublicCase(id, () => Response.json({}, { status: 503 })));
  await assert.rejects(readPublicCase(id, () => Response.json({ title: 'Wrong', cards: {} })));
});

// Model table filtering and lost network replies at the same boundary as PostgREST.
function memoryTable(initial, loseReply = false) {
  let row = initial && { ...initial };
  return {
    from(table) {
      assert.equal(table, 'vault_display_cases');
      let method = 'read',
        data;
      const filters = [];
      return {
        insert(value) {
          method = 'insert';
          data = value;
          return this;
        },
        update(value) {
          method = 'update';
          data = value;
          return this;
        },
        delete() {
          method = 'delete';
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        select() {
          return this;
        },
        abortSignal() {
          return this;
        },
        async maybeSingle() {
          const matches = row && filters.every(([key, value]) => row[key] === value);
          let result = matches ? { ...row } : null;
          if (method === 'insert') {
            if (row) return { status: 409, data: null, error: { code: '23505' } };
            row = result = { ...data };
          }
          if (method === 'update' && matches) {
            assert.deepEqual(Object.keys(data).sort(), ['card_ids', 'revision', 'title']);
            row = result = { ...row, ...data };
          }
          if (method === 'delete' && matches) row = null;
          if (loseReply && method !== 'read') {
            loseReply = false;
            throw new TypeError('Network connection lost');
          }
          return { data: result, error: null, status: 200 };
        },
      };
    },
  };
}

test('retrying an acknowledged or ambiguous save keeps the same public ID and revision', async () => {
  const table = memoryTable(null, true);
  const change = { id, revision: rev, expectedRevision: null, ...fields };
  assert.equal((await saveCase(table, owner, change)).id, id);
  assert.equal((await saveCase(table, owner, change)).revision, rev);
  const edited = await saveCase(table, owner, { ...change, expectedRevision: rev, revision: next, title: 'New title' });
  assert.equal(edited.title, 'New title');
  assert.equal(edited.id, id);
});

test('an already-issued link outside this owner’s cases requires a fresh case instead of a network retry', async () => {
  const table = memoryTable({ id, owner: other, revision: next, ...fields });
  await assert.rejects(saveCase(table, owner, { id, revision: rev, expectedRevision: null, ...fields }), CaseConflict);
});

test('stale or foreign revisions cannot overwrite a case or revoke its link', async () => {
  const original = { id, owner, revision: next, ...fields };
  const table = memoryTable(original);
  await assert.rejects(
    saveCase(table, owner, { id, expectedRevision: rev, revision: crypto.randomUUID(), ...fields }),
    CaseConflict,
  );
  await assert.rejects(stopSharing(table, owner, { ...original, revision: rev }), CaseConflict);
  await assert.rejects(
    saveCase(table, other, { id, expectedRevision: next, revision: crypto.randomUUID(), ...fields }),
    CaseConflict,
  );
  await stopSharing(table, other, original); // Already invisible to this owner.
  assert.equal((await saveCase(table, owner, { id, expectedRevision: next, revision: rev, ...fields })).id, id);
  await stopSharing(table, owner, { ...original, revision: rev });
  await stopSharing(table, owner, { ...original, revision: rev }); // Ambiguous or repeated delete.
});
