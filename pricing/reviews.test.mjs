import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingClient } from '../pricing-client.js';
import { identityKey } from './identity.mjs';

const card = { id: 'card', owner: 'owner', player: 'Test Player', year: 2025, card_number: '17', set_name: 'Test set', parallel: 'Silver', is_auto: true };
const session = { user: { id: card.owner } };
const now = new Date('2026-11-18T15:00:00Z');
const sale = (id, price = '25.00', date = '2026-11-17') => ({
  url: 'https://www.ebay.com/itm/12345678900' + id, price, date, parallel: 'Silver', exact: true,
});
const first = sale(1);
const second = sale(2, '45');
const quote = sales => ({ status: sales.length >= 2 ? 'valued' : 'insufficient', checkedAt: now.toISOString(),
  sales, valueCents: sales.length >= 2 ? 3500 : null, identity: identityKey(card), source: 'CardPricer' });
const auto = input => ({url: input.url, title: 'Silver autograph sale', soldAt: input.date + 'T15:00:00Z', priceCents: Math.round(Number(input.price) * 100)});
function fixture({ disk = new Map(), provider = [], cloud, write, time = now } = {}) {
  let tick = time;
  let offline = false;
  const client = createPricingClient({ clock: () => tick,
    lookup: async () => {
      if (offline) throw new Error('Provider unavailable');
      return quote(provider);
    }, readRemote: async () => cloud ?? null,
    writeRemote: write ?? (async () => true),
    storage: () => ({getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value)}),
  });
  return { client, disk, goOffline: () => { offline = true; }, date: d => { tick = new Date(d); }, refresh: (list = [card]) => client.refreshVaultPrices(session, list),
    change: (command, target = card) => client.reviewSale(session, [target], target, command) };
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
  assert.deepEqual(two.history.map(r => [r.valueCents, r.priced, r.total]), [[3500, 1, 1]]);
  const reopened = fixture({disk: f.disk});
  assert.equal((await reopened.refresh()).quotes.card.valueCents, 3500);
  const foreign = await reopened.client.loadVaultPrices({user:{id:'someone-else'}});
  assert.deepEqual(foreign.quotes, {});
  await assert.rejects(reopened.change({type:'save',input:first}, {...card,owner:'someone-else'}));
});
test('excluding and restoring a provider sale updates coverage and never duplicates a listing', async () => {
  const f = fixture({provider:[auto(first), auto(second)]});
  await f.refresh();
  const duplicate = { ...first, url:'https://m.ebay.co.uk/itm/test/123456789001?mkcid=123' };
  await assert.rejects(f.change({type:'save',input:duplicate}), /already/i);
  const flagged = await f.change({type:'exclude', url:first.url, reason:'Wrong autograph'});
  assert.equal(flagged.quotes.card.valueCents, null);
  assert.equal(flagged.history.at(-1).priced, 0);
  assert.equal(flagged.quotes.card.evidence.find(s=>s.url===first.url).flag, 'Wrong autograph');
  const refreshed = await f.client.refreshVaultPrices(session,[card],{force:true});
  assert.equal(refreshed.quotes.card.valueCents,null);
  const restored = await f.change({type:'restore',url:first.url});
  assert.equal(restored.quotes.card.valueCents,3500);
});
test('older sales and reference-only entries remain visible, and changed cards require a fresh match confirmation', async () => {
  const f = fixture();
  await f.refresh();
  await f.change({type:'save',input:{...first, date:'2026-06-01'}});
  await f.change({type:'save',input:{...second, parallel:'Gold', exact:false}});
  const res = await f.change({type:'save',input:sale(3)});
  assert.equal(res.quotes.card.evidence.length,3);
  assert.equal(res.quotes.card.sales.length,1);
  assert.equal(res.quotes.card.valueCents,null);
  const changed = await f.refresh([{...card,grader:'PSA',grade:'10'}]);
  assert.equal(changed.quotes.card.evidence.length,3);
  assert.equal(changed.quotes.card.sales.length,0);
});
test('validates sold dates, USD prices, marketplace links, and parallel before any change', async () => {
  const f = fixture();
  await f.refresh();
  for (const bad of [{price:'0'},{price:'-1'},{price:'1.123'},{date:'2026-02-30'},{date:'2026-11-19'},
    {url:'javascript:alert(1)'},{url:'https://name:pass@test.example/sale/1'},
    {url:'https://www.ebay.com/sch/i.html?_nkw=test'},{parallel:'Gold'}]) {
    await assert.rejects(f.change({type:'save',input:{...first,...bad}}),Error);
  }
  assert.equal((await f.refresh()).history[0].priced,0);
});
test('edits, removes and ages out sales, with only the five newest eligible receipts used', async () => {
  const f = fixture();
  await f.refresh();
  for (let i=1;i<=6;i++) await f.change({type:'save',input:sale(i,String(i*10),'2026-11-'+String(i+10))});
  let result = await f.change({type:'save',key:sale(5).url,input:{...sale(5),price:'100',date:'2026-11-15'}});
  assert.equal(result.quotes.card.sales.length,5);
  assert.equal(result.quotes.card.valueCents,4000);
  result=await f.change({type:'remove',url:sale(4).url});
  assert.equal(result.quotes.card.evidence.length,5);
  assert.equal(result.quotes.card.valueCents,3000);
  f.date('2027-03-01');
  result=await f.refresh();
  assert.equal(result.quotes.card.evidence.length,5);
  assert.equal(result.history.at(-1).priced,0);
});

test('two devices merge distinct receipts, a deletion wins over stale copies, and old sync installations keep reviews local', async () => {
  const remote = { quotes: {}, history: [], reviews: {} };
  let clock = now;
  const build = () => createPricingClient({
    clock: () => clock, lookup: async () => quote([]),
    storage: (() => { const disk=new Map();return () => ({getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v)}); })(),
    readRemote: async () => structuredClone(remote),
    writeRemote: async (_session, quotes, days) => {
      Object.assign(remote.quotes, structuredClone(quotes));
      if (days.length) remote.history = structuredClone(days);
      return true;
    },
    writeRemoteReviews: async (_session, changes) => {
      for (const [id, records] of Object.entries(changes)) {
        const entries=remote.reviews[id] ||= {};
        for(const [url,record] of Object.entries(records)) {
          if(!entries[url] || entries[url].version < record.version) entries[url]=structuredClone(record);
        }
      }
      return structuredClone(remote.reviews);
    },
  });
  const a=build(), b=build();
  await Promise.all([a.refreshVaultPrices(session,[card]),b.refreshVaultPrices(session,[card])]);
  await a.reviewSale(session,[card],card,{type:'save',input:first});
  const both=await b.reviewSale(session,[card],card,{type:'save',input:second});
  assert.equal(both.reviewStorage,'cloud');
  assert.equal(both.quotes.card.valueCents,3500);
  assert.equal(remote.history[0].valueCents,3500);
  await b.reviewSale(session,[card],card,{type:'remove',url:first.url});
  clock = new Date(+now + 120000);
  const updated=await a.refreshVaultPrices(session,[card]);
  assert.equal(updated.quotes.card.evidence.length,1);
  assert.equal(updated.quotes.card.valueCents,null);
  const legacy=fixture({cloud:{quotes:{},history:[]}});
  await legacy.refresh();
  const saved=await legacy.change({type:'save',input:first});
  assert.equal(saved.reviewStorage,'device');
  assert.equal(saved.quotes.card.evidence.length,1);
});

test('a stale inventory in a second tab cannot erase a local-only sale on a newly added card', async () => {
  const disk=new Map();
  const a=fixture({disk}), b=fixture({disk});
  const added={...card,id:'later-card'};
  await b.refresh([card]);
  await a.client.reviewSale(session,[card,added],added,{type:'save',input:first});
  await b.refresh([card]);
  const reopened=await fixture({disk}).refresh([card,added]);
  assert.equal(reopened.quotes[added.id].evidence?.length,1);
});
test('removing a flagged manual-only receipt removes its evidence too', async () => {
  const f=fixture();
  await f.change({type:'save',input:first});
  await f.change({type:'exclude',url:first.url,reason:'Wrong grade'});
  const removed=await f.change({type:'remove',url:first.url});
  assert.equal(removed.quotes.card?.evidence?.length || 0,0);
});
test('a provider receipt that appears later counts once and preserves the authored reference during an outage', async () => {
  const provider=[];
  const f=fixture({provider});
  await f.change({type:'save',input:first});
  provider.push(auto(first),auto(second));
  let q=(await f.client.refreshVaultPrices(session,[card],{force:true})).quotes.card;
  assert.equal(q.evidence.length,2);
  assert.equal(q.evidence.filter(row=>row.automatic&&row.manual).length,1);
  assert.equal(q.valueCents,3500);
  q=(await f.change({type:'exclude',url:second.url,reason:'Wrong parallel'})).quotes.card;
  assert.equal(q.valueCents,null);
  f.goOffline();
  f.date('2026-11-19T15:00:00Z');
  q=(await f.client.refreshVaultPrices(session,[card],{force:true})).quotes.card;
  assert.equal(q.refreshFailed,true);
  assert.equal(q.evidence.length,2);
  assert.equal(q.valueCents,null);
});

test('a confirmed card deletion drops its private reviews even if an older tab later saves its cache', async () => {
  const disk = new Map();
  const firstTab = fixture({disk});
  await firstTab.change({type:'save', input:first});
  const secondTab = fixture({disk});
  await secondTab.refresh();
  firstTab.client.forgetCardReviews(session, card);
  await secondTab.refresh();
  await assert.rejects(secondTab.change({type:'save',input:second}), /removed/i);
  assert.ok(![...disk.values()].some(value => value.includes(first.url)));
});
