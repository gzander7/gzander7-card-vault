import { identityKey } from './identity.mjs';

export const exclusionReasons = ['Wrong parallel', 'Wrong autograph', 'Wrong grade', 'Different card', 'Not a completed sale'];
const DAY = 86400000;
const ebayMarket = /^(?:(?:www|m)\.)?ebay\.(?:com(?:\.au)?|co\.uk|ca|de|fr|it|es)$/i;

export function saleUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { /* Validated below. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) {
    throw new Error('Enter the HTTPS link to the completed sale.');
  }
  if (ebayMarket.test(url.hostname)) {
    const item = /^\/itm\/(?:[^/]+\/)?(\d{9,16})\/?$/i.exec(url.pathname);
    if (!item) throw new Error('Open the individual eBay sale and paste its item link.');
    return 'https://www.ebay.com/itm/' + item[1];
  }
  if (['ebay.us', 'ebay.to'].includes(url.hostname.replace(/^www\./, ''))) {
    throw new Error('Open the short eBay link, then copy the full item URL.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname === '/' && !url.search) throw new Error('Use the individual sale page, including its listing or lot number.');
  if (url.href.length > 1800) throw new Error('Use a shorter direct link to the sale.');
  return url.href;
}

export function medianCents(sales) {
  if (sales.length < 2) return null;
  const prices = sales.map(sale => sale.priceCents).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : prices[mid - 1] + Math.round((prices[mid] - prices[mid - 1]) / 2);
}

const normalizedParallel = text => String(text || 'Base').trim().toLowerCase().replace(/\s+/g, ' ') || 'base';

function manualSale(card, input, now) {
  const url = saleUrl(input.url);
  const amount = String(input.price ?? '').trim();
  const [dollars, fraction = ''] = amount.split('.');
  const cents = Number(dollars + fraction.padEnd(2, '0'));
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(amount) || !Number.isSafeInteger(cents) || cents < 1) {
    throw new Error('Enter a positive USD sale price with up to two decimal places.');
  }
  const day = String(input.date || '');
  const time = Date.parse(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== day || day > now.toISOString().slice(0, 10)) {
    throw new Error('Enter a valid sale date on or before today.');
  }
  const parallel = String(input.parallel || '').trim() || 'Base';
  if (parallel.length > 120) throw new Error('Keep the parallel to 120 characters.');
  const exact = input.exact === true;
  if (exact && normalizedParallel(parallel) !== normalizedParallel(card.parallel)) {
    throw new Error('The parallel differs from your card. Save it as a reference or correct the parallel.');
  }
  return {url, soldAt: day, priceCents: cents, title: card.player + ' · ' + parallel, parallel, exact, identity: identityKey(card)};
}

// Edits to independent receipts merge by key. A removal or restoration remains
// a versioned record so a device returning after an offline edit cannot undo it.
export function mergeReviews(left = {}, right = {}) {
  const merged = { ...left };
  for (const [cardId, entries] of Object.entries(right || {})) {
    const next = { ...merged[cardId] };
    for (const [url, record] of Object.entries(entries || {})) {
      if (record?.version && (!next[url] || record.version > next[url].version)) next[url] = record;
    }
    merged[cardId] = next;
  }
  return merged;
}

function stamp(previous, now) {
  const last = Date.parse(previous?.version?.slice(0, 24));
  const timestamp = new Date(Math.max(+now, Number.isFinite(last) ? last + 1 : 0)).toISOString();
  return timestamp + ':' + crypto.randomUUID();
}

export function changeReview(card, entries, quote, command, now) {
  const identity = identityKey(card);
  const write = (url, manual, flag) => ({ version: stamp(entries[url], now), manual, flag });
  if (command.type === 'save') {
    const manual = manualSale(card, command.input, now);
    const oldKey = command.key;
    if (oldKey && !entries[oldKey]?.manual) throw new Error('That saved sale has changed. Reopen Sold comps.');
    const oldFlag = oldKey ? entries[oldKey].flag : null;
    if (oldKey !== manual.url && (entries[manual.url]?.manual || quote?.evidence?.some(row => row.url === manual.url))) {
      throw new Error('This sale is already in Sold comps.');
    }
    const changes = { [manual.url]: write(manual.url, manual, oldKey === manual.url ? oldFlag : null) };
    if (oldKey && oldKey !== manual.url) changes[oldKey] = write(oldKey, null, oldFlag);
    return changes;
  }
  const url = saleUrl(command.url);
  const entry = entries[url];
  const row = quote?.evidence?.find(sale => sale.url === url);
  if (command.type === 'remove' && entry?.manual) return { [url]: write(url, null, row?.automatic ? entry.flag : null) };
  if (command.type === 'restore' && entry?.flag?.identity === identity) return { [url]: write(url, entry.manual, null) };
  if (command.type === 'exclude' && row && exclusionReasons.includes(command.reason)) {
    const receipt = {url, title: row.title, soldAt: row.soldAt, priceCents: row.priceCents};
    return { [url]: write(url, entry?.manual ?? null, {identity, reason: command.reason, receipt}) };
  }
  throw new Error('This sale changed. Reopen Sold comps and try again.');
}

export function reviewedQuote(card, automatic, entries, now) {
  const identity = identityKey(card);
  const base = automatic?.identity === identity ? automatic : undefined;
  const receipts = new Map();
  for (const receipt of [...(base?.sales || []), ...(base?.extraSales || [])]) {
    let url;
    try { url = saleUrl(receipt.url); } catch { continue; }
    if (!receipts.has(url)) receipts.set(url, { ...receipt, url, automatic: true });
  }
  for (const [url, entry] of Object.entries(entries || {})) {
    const manual = entry.manual;
    const flag = entry.flag?.identity === identity ? entry.flag : null;
    if (!manual && !flag) continue;
    const row = receipts.get(url) || { ...(manual || flag.receipt), url, automatic: false };
    // Apply corrections for this card before ordering and filtering the receipts.
    const correction = manual?.identity === identity ? manual : null;
    receipts.set(url, { ...row, ...correction, url, manual, flag: flag?.reason || '' });
  }
  if (!receipts.size) return base;
  const cutoff = new Date(+now - 90 * DAY).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const evidence = [...receipts.values()].sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt) || a.url.localeCompare(b.url));
  const sales = [];
  for (const row of evidence) {
    const date = row.soldAt.slice(0, 10);
    if (row.flag) row.reason = row.flag;
    else if (row.manual && row.manual.identity === identity && !row.manual.exact) row.reason = 'Reference only';
    else if (!row.automatic && row.manual?.identity !== identity) row.reason = 'Card details changed';
    else if (date < cutoff || date > today) row.reason = 'Outside the 90-day window';
    else if (sales.length === 5) row.reason = 'Outside the latest five';
    else sales.push(row);
  }
  const valueCents = medianCents(sales);
  const message = sales.length === 1 ? 'One matching sale. A second is needed for an estimate.'
    : 'Two matching sales within 90 days are needed for an estimate.';
  return { ...base, identity, status: valueCents === null ? 'insufficient' : 'valued', valueCents, sales, evidence, message };
}
