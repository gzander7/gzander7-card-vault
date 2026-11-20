import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupComps } from './cardpricer.mjs';

// Catalogue, provenance, and tape shapes from CardPricer's public Cameron Ward
// #199 PSA 9 responses. Provenance deliberately has no observationType.
const now = new Date('2026-11-18T14:00:00Z');
const card = { player: 'Cameron Ward', year: 2024, set_name: 'Prizm Draft Picks', card_number: '199', grader: 'PSA', grade: '9' };
const catalog = { id: 'ebe329ae-443e-4db6-befc-a1b9c9c25665', player: 'Cameron Ward', year: 2024,
  set: 'Panini Prizm Draft Picks', cardNumber: '199', sport: 'football', grade: 'PSA 9', price: 45 };
const title = '2024 Panini Prizm Draft Picks #199 Cameron Ward (PSA 9 MINT)';
const observations = [
  ['19da671b-b295-4fbd-97aa-bf8afcc42fe4', 13.05, '2026-11-18T04:50:25+00:00'],
  ['626c958e-9886-491c-8e95-3b8e6751919c', 13.4, '2026-11-11T00:26:24+00:00'],
  ['38d6ca80-9a2a-4d93-b7e7-73105d2a5470', 13.46, '2026-10-20T03:59:46.5+00:00']
].map(([id, price, soldDate], i) => ({id, price, soldDate, title, grade:'PSA 9', source:'other',
  url: 'https://polygonscan.com/tx/0x' + String(i + 1).repeat(64)}));
const sales = observations.map(obs => ({id:obs.id, price:obs.price, soldDate:obs.soldDate,
  card:catalog, cardId:catalog.id, grade:'PSA 9', title, observationType:'sale', source:'courtyard', sourceUrl:obs.url}));

function transactions(prices) {
  const recent = prices.map((price, index) => ({
    ...observations[0], id:String(index + 1), price,
    soldDate:new Date(+now - (index + 1) * 86400000).toISOString(),
    url:'https://www.ebay.com/itm/' + (123456789000 + index)
  }));
  const rows = recent.map(obs => ({...sales[0], ...obs, source:'ebay', currency:'USD', sourceUrl:obs.url}));
  return {recent, rows};
}

function fixture({cards = [catalog], recent = observations, rows = sales, provenanceCard, pages, malformed, status} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(url.origin, 'https://cardpricer.co');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal);
    if (status) return {ok:false, status, headers:new Headers({'Retry-After':'60'})};
    const envelope = data => ({ok:true, apiVersion:'1.0.0', generatedAt:now.toISOString(), data});
    let body;
    if (url.pathname.endsWith('/cards')) {
      const offset = Number(url.searchParams.get('offset'));
      const player = url.searchParams.get('player').toLowerCase();
      const page = (pages?.[offset] ?? cards).filter(row => {
        const name = row.player.toLowerCase();
        return name.includes(player) || name.replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') === player;
      });
      const nextOffset = pages && Object.keys(pages).map(Number).sort((a,b) => a-b).find(n => n > offset);
      body = {...envelope(page), meta:{pagination:{total:pages ? Object.values(pages).flat().length : page.length,
        nextOffset:nextOffset ?? null}}};
    } else if (url.pathname.endsWith('/provenance')) {
      const id = url.pathname.split('/').at(-2);
      const record = (pages ? Object.values(pages).flat() : cards).find(row => row.id === id);
      body = envelope({card:provenanceCard ?? record, window:{days:30}, comps:{recent, stats:{median:999}}, fairValue:{estimate:999}});
    } else {
      assert.equal(url.pathname, '/api/v1/sales');
      assert.equal(url.searchParams.get('include'), 'sale');
      const start = Date.parse(url.searchParams.get('since'));
      const end = Date.parse(url.searchParams.get('until'));
      body = envelope(rows.filter(row => Date.parse(row.soldDate) >= start && Date.parse(row.soldDate) <= end));
    }
    return {ok:true, json:async () => malformed ? malformed(url, body) : body};
  };
  return {calls, fetchImpl, now};
}

test('uses completed price on the tape, excluding displayed catalogue and provenance marks', async () => {
  const provider = fixture();
  const result = await lookupComps(card, provider);
  assert.equal(result.status, 'valued');
  assert.equal(result.valueCents, 1340);
  assert.equal(result.sales.length, 3);
  assert.equal(result.source, 'CardPricer');
  assert.deepEqual(result.diagnostics, {found:3, verified:3, unchecked:0, rejected:{}});
  assert.equal(result.confidence, 'medium');
  assert.deepEqual(result.range, {lowCents:1305, highCents:1346});
  assert.match(result.sales[0].url, /^https:\/\/polygonscan\.com\/tx\/0x/);
});

test('finds a suffix omitted from either catalogue or collection using the directory’s substring filter', async () => {
  for (const [stored, directory] of [['Bobby Witt Jr.', 'Bobby Witt'], ['Bobby Witt', 'Bobby Witt Jr.']]) {
    const record = {...catalog, player:directory};
    const recent = observations.map(obs => ({...obs, title:obs.title.replace('Cameron Ward', stored)}));
    const rows = sales.map(row => ({...row, card:record, title:row.title.replace('Cameron Ward', directory)}));
    const p = fixture({cards:[record], recent, rows});
    const result = await lookupComps({...card, player:stored}, p);
    assert.equal(result.status, 'valued', stored);
    assert.equal(result.valueCents, 1340);
  }
});

test('retrieval covers catalogue accents, apostrophes and hyphens without hiding an ambiguous spelling', async () => {
  for (const [stored, directory] of [
    ["Shaquille O'Neal", 'Shaquille ONeal'], ['Shaquille ONeal', "Shaquille O'Neal"],
    ['Ronald Acuña Jr.', 'Ronald Acuna'], ['Ronald Acuna', 'Ronald Acuña Jr.'],
    ['Karl-Anthony Towns', 'Karl Anthony Towns'], ['Karl Anthony Towns', 'Karl-Anthony Towns']
  ]) {
    const record = {...catalog, player:directory};
    const recent = observations.map(obs => ({...obs, title:obs.title.replace('Cameron Ward', directory)}));
    const rows = sales.map(row => ({...row, card:record, title:row.title.replace('Cameron Ward', directory)}));
    const p = fixture({cards:[record], recent, rows});
    assert.equal((await lookupComps({...card, player:stored}, p)).status, 'valued', stored);
    assert.ok(p.calls.filter(url => url.pathname.endsWith('/cards')).length <= 2);
  }
  const records = [{...catalog, player:'Shaquille ONeal'},
    {...catalog, player:"Shaquille O'Neal", id:'73ac930b-24fd-4991-b13e-3196b679d369'}];
  const ambiguous = fixture({cards:records});
  assert.equal((await lookupComps({...card, player:'Shaquille ONeal'}, ambiguous)).status, 'needs_details');
  assert.equal(ambiguous.calls.length, 1);
  const plain = fixture({cards:records});
  assert.equal((await lookupComps({...card, player:'Shaquille Oneal'}, plain)).status, 'needs_details');
});

test('different explicit suffixes in catalogue, provenance, and tape cannot become one sale through an omitted suffix', async () => {
  for (const [stored, directory, provenance, tapePlayer, tapeTitle] of [
    ['Bobby Witt', 'Bobby Witt Jr.', 'Bobby Witt Sr.', 'Bobby Witt', 'Bobby Witt'],
    ['Bobby Witt', 'Bobby Witt Jr.', 'Bobby Witt', 'Bobby Witt Sr.', 'Bobby Witt'],
    ['Bobby Witt', 'Bobby Witt', 'Bobby Witt Jr.', 'Bobby Witt', 'Bobby Witt Sr.'],
    ['Bobby Witt Sr.', 'Bobby Witt', 'Bobby Witt', 'Bobby Witt', 'Bobby Witt Jr.']
  ]) {
    const recent = observations.map(obs => ({...obs, title:obs.title.replace('Cameron Ward', provenance)}));
    const rows = sales.map(row => ({...row, card:{...catalog, player:tapePlayer}, title:row.title.replace('Cameron Ward', tapeTitle)}));
    const p = fixture({cards:[{...catalog, player:directory}], recent, rows});
    const result = await lookupComps({...card, player:stored}, p);
    assert.equal(result.status, 'insufficient');
    assert.deepEqual(result.diagnostics, {found:3, verified:0, unchecked:0, rejected:{wrong_player:3}});
  }
});

test('a suffix supplied by the provenance card applies to the sale and conflicts across card records fail the lookup', async () => {
  const base = {...catalog, player:'Bobby Witt'};
  const junior = {...base, player:'Bobby Witt Jr.'};
  const senior = {...base, player:'Bobby Witt Sr.'};
  const recent = observations.map(obs => ({...obs, title:obs.title.replace('Cameron Ward', 'Bobby Witt')}));
  const rows = sales.map(row => ({...row, card:senior, title:row.title.replace('Cameron Ward', 'Bobby Witt Sr.')}));
  const stored = {...card, player:'Bobby Witt'};
  const q = await lookupComps(stored, fixture({cards:[base], provenanceCard:junior, recent, rows}));
  assert.equal(q.status, 'insufficient');
  assert.deepEqual(q.diagnostics, {found:3, verified:0, unchecked:0, rejected:{wrong_player:3}});
  const conflict = fixture({cards:[junior], provenanceCard:senior, recent, rows});
  await assert.rejects(lookupComps(stored, conflict), {code:'invalid_response'});
  assert.equal(conflict.calls.length, 2);
  const legacy = await lookupComps(stored, fixture({cards:[base], provenanceCard:{id:base.id}, recent, rows}));
  assert.equal(legacy.status, 'valued');
});

test('multiple compatible generations or a truncated catalogue cannot establish uniqueness', async () => {
  const junior = {...catalog, player:'Bobby Witt Jr.'};
  const senior = {...catalog, id:'73ac930b-24fd-4991-b13e-3196b679d369', player:'Bobby Witt Sr.'};
  for (const [pages, count] of [[{0:[junior], 200:[senior]}, 2], [{0:[junior], 200:[], 400:[], 600:[senior]}, 3]]) {
    const p = fixture({pages});
    const result = await lookupComps({...card, player:'Bobby Witt'}, p);
    assert.equal(result.status, 'needs_details');
    assert.equal(result.diagnostics, undefined);
    assert.equal(p.calls.length, count);
  }
});

test('untyped observations or quotes, wrong grade, other card IDs, unsafe links and currencies cannot supply a value', async () => {
  const mutations = [{observationType:'quote'}, {observationType:'listing'}, {cardId:'different'}, {grade:'PSA 10'},
    {card:{...catalog, year:2023}}, {sourceUrl:'https://example.com'}, {sourceUrl:'https://www.ebay.com@fake.example/itm/1234567890'},
    {currency:'EUR'}, {title: title + ' Gold /10'}, {price:0}];
  for (const change of mutations) {
    const p = fixture({rows:sales.map(row => ({...row,...change}))});
    assert.equal((await lookupComps(card, p)).status, 'insufficient', JSON.stringify(change));
  }
});

test('missing number or uncertain match never consumes downstream reads', async () => {
  let p = fixture();
  assert.equal((await lookupComps({...card, card_number:''}, p)).status, 'needs_details');
  assert.equal(p.calls.length, 0);
  p = fixture({cards:[]});
  assert.equal((await lookupComps(card, p)).status, 'insufficient');
  assert.ok(p.calls.length <= 2 && p.calls.every(url => url.pathname.endsWith('/cards')));
  p = fixture({pages:{0:[catalog],200:[{...catalog,id:'73ac930b-24fd-4991-b13e-3196b679d369'}]}});
  assert.equal((await lookupComps(card, p)).status, 'needs_details');
  assert.equal(p.calls.length, 2);
});

test('insufficient or duplicate evidence cannot zero or inflate the value', async () => {
  const p = fixture({recent:[...observations, observations[0]],rows:sales.map(row => ({...row,sourceUrl:sales[0].sourceUrl}))});
  const result = await lookupComps(card, p);
  assert.equal(result.sales.length, 1);
  assert.equal(result.status,'insufficient');
  assert.equal(result.valueCents,null);
  assert.deepEqual(result.diagnostics,{found:1,verified:1,unchecked:0,rejected:{}});
});

test('only an observed empty provenance can report that there were no listings', async () => {
  for (const result of [await lookupComps({...card, card_number:''}, fixture()), await lookupComps(card, fixture({cards:[]}))]) {
    assert.equal(result.diagnostics, undefined);
  }
  const empty = await lookupComps(card, fixture({recent:[]}));
  assert.deepEqual(empty.diagnostics, {found:0, verified:0, unchecked:0, rejected:{}});
});

test('counts each listing once, using title and tape rejection reasons without reading irrelevant titles', async () => {
  const {recent, rows} = transactions(Array(10).fill(12));
  recent[2].grade = 'PSA 10';
  recent[3].title += ' Lot of 2';
  rows[4].observationType = 'quote';
  rows[4].price = 0;
  rows[5].currency = 'EUR';
  rows[6].sourceUrl = 'https://example.com/receipt';
  rows[7].cardId = 'different';
  rows[8].price = 0;
  recent[9].soldDate = '2026-01-01T00:00:00Z';
  recent.push(recent[2], {...recent[0], id:'same-listing', url:recent[0].url + '?tracking=1', soldDate:recent[1].soldDate});
  const p = fixture({recent, rows});
  const result = await lookupComps(card, p);
  assert.deepEqual(result.diagnostics, {
    found:10, verified:2, unchecked:0, rejected:{wrong_grade:1, lot:1, unconfirmed_sale:1, unsupported_currency:1,
      invalid_link:1, wrong_card:1, invalid_price:1, outside_window:1}
  });
  assert.equal(p.calls.filter(url => url.pathname.endsWith('/sales')).length, 7);
});

test('unconfirmed observations cannot hide a verified sale for the same marketplace item', async () => {
  const {recent, rows} = transactions([12, 14]);
  const listing = {...recent[1], id:'listing', soldDate:now.toISOString()};
  const result = await lookupComps(card, fixture({recent:[listing, ...recent], rows}));
  assert.deepEqual(result.diagnostics, {found:2, verified:2, unchecked:0, rejected:{}});
  assert.equal(result.valueCents, 1300);
});

test('a duplicate future observation cannot hide the sale for that provider ID within the time window', async () => {
  const future = {...observations[0], soldDate:'2026-12-01T00:00:00Z'};
  const result = await lookupComps(card, fixture({recent:[future, ...observations]}));
  assert.deepEqual(result.diagnostics, {found:3, verified:3, unchecked:0, rejected:{}});
  assert.equal(result.valueCents, 1340);
});

test('missing variant details in a catalogue summary must still be verified in sold title', async () => {
  const p = fixture();
  assert.equal((await lookupComps({...card, parallel:'Gold'}, p)).status, 'insufficient');
  assert.equal((await lookupComps({...card, is_auto:true}, p)).status, 'insufficient');
  assert.equal((await lookupComps({...card, serial:'09/25'}, p)).status, 'insufficient');
});

test('rate limits, malformed bodies and network outages fail separately from genuine empty searches', async () => {
  await assert.rejects(lookupComps(card, fixture({status:429})), {code:'rate_limited',retryAfter:'60'});
  await assert.rejects(lookupComps(card,{fetchImpl:async()=>{throw Error('offline')},now}),{code:'unavailable'});
  for (const location of ['cards','provenance','sales']) {
    const p = fixture({malformed:(url, valid) => url.pathname.endsWith('/' + location) ? {ok:true,data:{}} : valid});
    await assert.rejects(lookupComps(card,p), {code:'invalid_response'});
  }
});

test('takes only the five newest individually confirmed sales within 90 days', async () => {
  const {recent, rows} = transactions([11, 12, 13, 14, 15, 16, 17, 18, 19]);
  recent[8].soldDate = '2026-01-01T00:00:00Z';
  const p = fixture({recent:recent.reverse(), rows});
  const result = await lookupComps(card, p);
  assert.equal(result.sales.length, 5);
  assert.equal(result.valueCents,1300);
  assert.deepEqual(result.sales.map(s=>s.id),['1','2','3','4','5']);
  assert.deepEqual(result.diagnostics,{found:9,verified:5,unchecked:3,rejected:{outside_window:1}});
  assert.equal(p.calls.filter(url => url.pathname.endsWith('/sales')).length, 5);
});

test('receipts screened as unusual or flagged by the owner stay available to manual review', async () => {
  const {recent, rows} = transactions([12, 14, 90, 13, 11, 10, 15]);
  const p = fixture({recent, rows});
  const result = await lookupComps(card, {...p, excludedUrls:new Set([recent[0].url])});
  assert.equal(result.valueCents, 1200);
  assert.deepEqual(result.range, {lowCents:1000, highCents:1400});
  assert.deepEqual(result.sales.map(s => s.id), ['2','4','5','6']);
  assert.deepEqual(result.extraSales.map(s => s.id), ['1','3']);
  assert.deepEqual(result.diagnostics,{found:7,verified:6,unchecked:1,rejected:{}});
  assert.equal(p.calls.filter(url => url.pathname.endsWith('/sales')).length, 6);
});

test('the tape budget leaves unexamined listings unchecked and reuses a timestamp across receipts', async () => {
  const {recent} = transactions(Array(18).fill(13));
  recent[1].soldDate = recent[0].soldDate;
  recent[17].title += ' Lot of 2';
  const p = fixture({recent, rows:[]});
  const result = await lookupComps(card, p);
  assert.deepEqual(result.diagnostics,{found:18,verified:0,unchecked:1,rejected:{unconfirmed_sale:16,lot:1}});
  assert.equal(p.calls.filter(url => url.pathname.endsWith('/sales')).length, 15);
});

test('a receipt missing from a truncated tape page stays unchecked', async () => {
  const p = fixture({recent:[observations[0]], rows:[], malformed:(url, body) => url.pathname.endsWith('/sales')
    ? {...body, meta:{pagination:{nextCursor:observations[0].soldDate}}} : body});
  const result = await lookupComps(card, p);
  assert.deepEqual(result.diagnostics,{found:1,verified:0,unchecked:1,rejected:{}});
  assert.equal(p.calls.length, 3);
});

test('propagates caller cancellation across an in-flight fetch and respects pre-aborted signals', async () => {
  const controller = new AbortController();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = lookupComps(card, {now,signal:controller.signal,fetchImpl:async (url, {signal}) => {
    entered();
    return new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  }});
  await ready;
  const reason = new DOMException('Card edited','AbortError');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  const p = fixture();
  await assert.rejects(lookupComps(card,{...p,signal:controller.signal}), error => error === reason);
  assert.equal(p.calls.length, 0);
});

test('reports Retry-After seconds and HTTP dates to the scheduler', async () => {
  const later = new Date(Date.now() + 60000).toUTCString();
  for (const [header, min, max] of [['19',19000,19000],[later,58000,60500]]) {
    const fetchImpl = async () => ({ok:false,status:429,headers:new Headers({'Retry-After':header})});
    await assert.rejects(lookupComps(card,{fetchImpl,now}), error =>
      error.code === 'rate_limited' && error.retryAfterMs >= min && error.retryAfterMs <= max);
  }
});

test('unmarked currency only qualifies for documented dollar-settled venue and receipt pairs', async () => {
  const usdUnknown = sales.map(row => ({...row, source:'ebay', sourceUrl:'https://www.ebay.com/itm/123456789012'}));
  assert.equal((await lookupComps(card, fixture({rows:usdUnknown}))).sales.length, 0);
  const euro = sales.map(row => ({...row, currency:'EUR'}));
  assert.equal((await lookupComps(card, fixture({rows:euro}))).sales.length, 0);
  const usdc = sales.map(row => ({...row, currency:'USDC'}));
  assert.equal((await lookupComps(card, fixture({rows:usdc}))).status, 'valued');
});
