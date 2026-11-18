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

function fixture({cards = [catalog], recent = observations, rows = sales, pages, malformed, status} = {}) {
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
      const page = pages?.[offset] ?? cards;
      body = {...envelope(page), meta:{pagination:{total:pages ? 400 : cards.length, nextOffset: pages && offset === 0 ? 200 : null}}};
    } else if (url.pathname.endsWith('/provenance')) {
      body = envelope({card:catalog, window:{days:30}, comps:{recent, stats:{median:999}}, fairValue:{estimate:999}});
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
  assert.equal(provider.calls[0].searchParams.get('player'), 'cameron-ward');
  assert.match(result.sales[0].url, /^https:\/\/polygonscan\.com\/tx\/0x/);
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
  assert.equal(p.calls.length, 1);
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
  const many = Array.from({length:8},(_,i) => ({...observations[0], id:String(i+1), price:i+1, soldDate:new Date(+now - (i+1)*86400000).toISOString()}));
  const old = {...many[0],id:'stale',soldDate:'2026-01-01T00:00:00Z'};
  const p = fixture({recent:[old,...many].reverse(),rows:many.map((obs,i) => ({
    ...sales[0],...obs, currency:'USD', sourceUrl:'https://www.ebay.com/itm/1234567890'+i
  }))});
  const result = await lookupComps(card, p);
  assert.equal(result.sales.length, 5);
  assert.equal(result.valueCents,300);
  assert.deepEqual(result.sales.map(s=>s.id),['1','2','3','4','5']);
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
