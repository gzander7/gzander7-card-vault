// CardPricer distinguishes sales, asking prices and quotes in its public sales feed.
// Its card provenance mixes those types, so verify every observation against the feed.
import { matchesSale, needsDetails } from './identity.mjs';

const API = 'https://cardpricer.co/api/v1/';
const DAY = 86400000;
const MAX_SALES = 5;
const MAX_PAGES = 3;
const MAX_OBSERVATIONS = 15;
const MINUTE = 60000;
const HOUR = MINUTE * 60;
const requests = [];
let backoffUntil = 0;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text = value => String(value ?? '').trim();
const normalize = value => text(value).normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const idNumber = value => normalize(value).replace(/ /g, '');
const validTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;

function providerError(message, code, status = null) {
  return Object.assign(new Error(message), { name: 'CardPricerError', code, status });
}

function invalid() {
  return providerError('CardPricer returned an unexpected response.', 'invalid_response');
}

function rateDelay(header, now) {
  if (header && /^\d+$/.test(header.trim())) return Math.max(0, Number(header) * 1000);
  const date = Date.parse(header || '');
  return Number.isFinite(date) ? Math.max(0, date - now) : MINUTE;
}

function limited(retryAfterMs) {
  return Object.assign(providerError('CardPricer is rate limited.', 'rate_limited', 429), {retryAfterMs});
}

async function waitForSlot(signal) {
  for (;;) {
    signal?.throwIfAborted();
    const now = Date.now();
    while (requests.length && requests[0] <= now - HOUR) requests.shift();
    // Leave room for parallel readers sharing the same outgoing IP. A single
    // card can use its brief burst immediately; slow down sustained batches.
    const minute = requests.filter(time => time > now - MINUTE);
    let resume = backoffUntil;
    if (requests.length >= 950) resume = Math.max(resume, requests[0] + HOUR);
    if (minute.length >= 55) resume = Math.max(resume, minute[0] + MINUTE);
    if (minute.length >= 40) resume = Math.max(resume, minute.at(-1) + 1250);
    const delay = resume - now;
    if (delay <= 0) {
      requests.push(now);
      return;
    }
    if (backoffUntil > now || delay > MINUTE) throw limited(delay);
    await new Promise((resolve, reject) => {
      const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(finish, delay);
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort', cancel, {once:true});
    });
  }
}

function gradeMatches(card, observed) {
  const grade = normalize(observed);
  if (!text(card.grader)) return ['', 'raw', 'ungraded'].includes(grade);
  const company = normalize(card.grader).replace(/^beckett(?: grading services)?$/, 'bgs');
  const match = /^([a-z]+)\s*(\d+(?:\.\d+)?)$/i.exec(text(observed));
  return Boolean(match && normalize(match[1]) === company && Number(match[2]) === Number(card.grade));
}

function setMatches(card, name) {
  const expected = normalize(card.set_name);
  const observed = normalize(name);
  const parallel = normalize(card.parallel);
  const names = new Set([observed]);
  if (parallel && observed.endsWith(' ' + parallel)) names.add(observed.slice(0, -parallel.length - 1));
  for (const candidate of names) {
    if (candidate === expected) return true;
    // Collectors can omit a leading manufacturer. Never equate two named manufacturers.
    const brand = /^(?:topps|panini|upper deck|leaf|fleer) /;
    if (candidate.replace(brand, '') === expected || expected.replace(brand, '') === candidate) return true;
  }
  return false;
}

function catalogMatch(card, row) {
  return UUID.test(row.id) && normalize(row.player) === normalize(card.player) &&
    text(row.year) === text(card.year) && idNumber(row.cardNumber) === idNumber(card.card_number) &&
    setMatches(card, row.set) && gradeMatches(card, row.grade);
}

function saleLink(row) {
  // Only link to a documented marketplace sale or transaction. Tracking parameters
  // are unnecessary; credentials, redirect URLs, and arbitrary hosts have no place here.
  let url;
  try { url = new URL(row.sourceUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const hostname = url.hostname.replace(/^www\./, '');
  if (hostname === 'ebay.com') {
    const match = /^\/itm\/(?:[^/]+\/)?(\d{9,16})\/?$/.exec(url.pathname);
    return match ? 'https://www.ebay.com/itm/' + match[1] : null;
  }
  if (hostname === 'polygonscan.com' && /^\/tx\/0x[\da-f]{64}$/i.test(url.pathname)) return 'https://polygonscan.com' + url.pathname;
  if (hostname === 'solscan.io' && /^\/tx\/[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(url.pathname)) return 'https://solscan.io' + url.pathname;
  return null;
}

function saleFor(card, row, candidate, now) {
  if (row.cardId !== candidate.id || row.observationType !== 'sale' || !catalogMatch(card, row.card || {}) ||
      !gradeMatches(card, row.grade) || typeof row.title !== 'string' || !row.title.trim()) return null;
  const url = saleLink(row);
  if (!url) return null;
  // CardPricer's v1 tape omits currency. It explicitly documents USDC amounts for
  // these physical-card venues. For other sources require an explicit USD code.
  // https://cardpricer.co/ecosystem and https://cardpricer.co/methodology
  const source = normalize(row.source);
  const dollarSettled = (source === 'courtyard' && url.startsWith('https://polygonscan.com/')) ||
    (['collector crypt', 'collectorcrypt', 'magic eden'].includes(source) && url.startsWith('https://solscan.io/'));
  if (row.currency !== 'USD' && !(dollarSettled && (row.currency == null || row.currency === 'USDC'))) return null;
  const time = validTime(row.soldDate);
  if (!Number.isFinite(time) || time > now || time < now - 90 * DAY) return null;
  if (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0) return null;
  const priceCents = Math.round(row.price * 100);
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) return null;
  if (!matchesSale(card, { title: row.title, grade: row.grade, year: row.card.year, cardNumber: row.card.cardNumber })) return null;
  return { id: text(row.id), title: row.title.trim(), soldAt: new Date(time).toISOString(), priceCents, url };
}

export async function lookupComps(card, { fetchImpl = fetch, now = new Date(), signal } = {}) {
  signal?.throwIfAborted();
  const checkedAt = now.toISOString();
  const result = (status, message, sales = [], valueCents = null) => ({status, valueCents, sales, checkedAt, message, source: 'CardPricer'});
  const issue = needsDetails(card);
  if (issue) return result('needs_details', issue);

  async function get(path, params) {
    const url = new URL(path, API);
    url.search = new URLSearchParams(params);
    const shared = fetchImpl === globalThis.fetch;
    if (shared) await waitForSlot(signal);
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, {once:true});
    const timer = setTimeout(() => controller.abort(), 12000);
    let body;
    try {
      const response = await fetchImpl(url, {signal: controller.signal, credentials: 'omit', redirect: 'error'});
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers?.get?.('Retry-After') || null;
          const retryAfterMs = rateDelay(retryAfter, Date.now());
          if (shared) backoffUntil = Math.max(backoffUntil, Date.now() + retryAfterMs);
          throw Object.assign(limited(retryAfterMs), {retryAfter});
        }
        throw providerError('CardPricer returned HTTP ' + response.status + '.', 'unavailable', response.status);
      }
      try { body = await response.json(); }
      catch (error) { if (controller.signal.aborted) throw error; throw invalid(); }
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.name === 'CardPricerError') throw error;
      throw providerError('CardPricer could not be reached.', 'unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    if (body?.ok !== true || !('data' in body)) throw invalid();
    return body;
  }

  const candidates = new Map();
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, meta } = await get('cards', {
      player: normalize(card.player).replace(/ /g, '-'), year: text(card.year),
      q: text(card.card_number).replace(/^#\s*/, ''), limit: '200', offset: String(offset)
    });
    const paging = meta?.pagination;
    if (!Array.isArray(data) || !paging || !Number.isSafeInteger(paging.total) || paging.total < 0 ||
        !('nextOffset' in paging) || data.some(row => !row || !UUID.test(row.id) || !('cardNumber' in row) || !('grade' in row) || !('set' in row))) throw invalid();
    for (const row of data) if (catalogMatch(card, row)) candidates.set(row.id, row);
    if (candidates.size > 1) return result('needs_details', 'Multiple catalogue entries match this card. Confirm its set, number, and variation.');
    if (paging.nextOffset === null) break;
    if (!Number.isSafeInteger(paging.nextOffset) || paging.nextOffset <= offset) throw invalid();
    if (page + 1 === MAX_PAGES) return result('needs_details', 'The catalogue search is too broad to identify a unique card.');
    offset = paging.nextOffset;
  }
  if (!candidates.size) return result('insufficient', 'CardPricer has no exact catalogue match for this card and grade.');

  const [candidate] = candidates.values();
  const { data } = await get('cards/' + candidate.id + '/provenance');
  if (data?.card?.id !== candidate.id || !Array.isArray(data?.comps?.recent)) throw invalid();
  const observations = data.comps.recent;
  if (observations.some(obs => !obs || typeof obs.id !== 'string' || !obs.id || !Number.isFinite(validTime(obs.soldDate)))) throw invalid();

  const at = now.getTime();
  const recent = observations.filter(obs => validTime(obs.soldDate) <= at && validTime(obs.soldDate) >= at - 90 * DAY)
    .sort((a, b) => validTime(b.soldDate) - validTime(a.soldDate));
  // Provenance lists the latest observations for this exact catalogue record, but
  // doesn't currently mark sales vs listings. Check only its relevant titles, newest first.
  const sales = [];
  const seen = new Set();
  const sources = new Set();
  const tape = new Map();
  let calls = 0;
  for (const obs of recent) {
    if (seen.has(obs.id)) continue;
    seen.add(obs.id);
    if (!gradeMatches(card, obs.grade) || !matchesSale(card, {title: obs.title, grade: obs.grade, year: candidate.year, cardNumber: candidate.cardNumber})) continue;
    const time = validTime(obs.soldDate);
    if (!tape.has(time)) {
      if (calls >= MAX_OBSERVATIONS) break;
      const params = { include: 'sale', since: new Date(time - 1000).toISOString(), until: new Date(time + 1000).toISOString(), limit: '200' };
      if (candidate.sport) params.sport = candidate.sport;
      const feed = await get('sales', params);
      if (!Array.isArray(feed.data) || feed.data.some(row => !row || typeof row.id !== 'string' ||
          !('observationType' in row) || !('cardId' in row) || !('price' in row))) throw invalid();
      tape.set(time, feed.data);
      calls++;
    }
    const verified = tape.get(time).find(row => row.id === obs.id && validTime(row.soldDate) === time);
    if (!verified) continue;
    const sale = saleFor(card, verified, candidate, at);
    if (!sale || sources.has(sale.url)) continue;
    sources.add(sale.url);
    sales.push(sale);
    if (sales.length === MAX_SALES) break;
  }
  if (sales.length < 2) return result('insufficient', 'Two recent, verified sales of this exact card are needed for an estimate.', sales);
  const prices = sales.map(sale => sale.priceCents).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : prices[mid - 1] + Math.round((prices[mid] - prices[mid - 1]) / 2);
  return result('valued', 'Median of recent verified sales of this card.', sales, median);
}
