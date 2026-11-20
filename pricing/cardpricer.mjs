// CardPricer distinguishes sales, asking prices and quotes in its public sales feed.
// Its card provenance mixes those types, so verify every observation against the feed.
import { listingPlayer, needsDetails, playerSearchName, playersMatch, saleMismatchReason } from './identity.mjs';
import { estimateSales } from './reviews.mjs';

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

function catalogMismatch(card, row) {
  if (!row || !UUID.test(row.id)) return 'wrong_card';
  if (!playersMatch(card.player, row.player)) return 'wrong_player';
  if (text(row.year) !== text(card.year)) return 'wrong_year';
  if (idNumber(row.cardNumber) !== idNumber(card.card_number)) return 'wrong_card_number';
  if (!setMatches(card, row.set)) return 'wrong_set';
  if (!gradeMatches(card, row.grade)) return 'wrong_grade';
  return null;
}

// The directory accepts a canonical slug or a literal name substring. A
// hyphenated slug can exclude every catalogue spelling with an omitted suffix.
function directoryPlayers(player) {
  const base = playerSearchName(player);
  const input = text(player);
  const terms = base.split(' ');
  const pieces = input.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .toLowerCase().match(/[a-z0-9]+/g) || [];
  const whole = pieces.filter(piece => terms.includes(piece));
  const fragments = whole.length ? whole : pieces.filter(piece => terms.some(term => term.includes(piece)));
  const fragment = fragments.sort((a, b) => b.length - a.length)[0] || base;
  // A narrow full-name search is normally sufficient. A stable component also
  // reaches O'Neal/ONeal and accented or hyphenated spellings on the directory.
  const literal = input.toLowerCase().replace(/\s+/g, ' ');
  const hasFormatting = !literal.includes(base) || /[a-z][A-Z]|[A-Z]{2}[a-z]/.test(input);
  return [...new Set(hasFormatting ? [fragment, base] : [base, fragment])];
}

function specificPlayer(known, compatible) {
  return normalize(known) === playerSearchName(known) ? compatible : known;
}

function listingMismatch(card, row, catalog) {
  if (typeof row.title !== 'string' || !row.title.trim()) return 'missing_title';
  if (!gradeMatches(card, row.grade)) return 'wrong_grade';
  return saleMismatchReason(card, {title:row.title, grade:row.grade, year:catalog.year, cardNumber:catalog.cardNumber});
}

function saleLink(value) {
  // Only link to a documented marketplace sale or transaction. Tracking parameters
  // are unnecessary; credentials, redirect URLs, and arbitrary hosts have no place here.
  let url;
  try { url = new URL(value); } catch { return null; }
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

function tapeMismatch(card, row, catalogId, url) {
  if (row.observationType !== 'sale') return 'unconfirmed_sale';
  if (row.cardId !== catalogId || row.card?.id !== catalogId) return 'wrong_card';
  const identity = catalogMismatch(card, row.card);
  if (identity) return identity;
  const reason = listingMismatch({...card, player:specificPlayer(card.player, row.card.player)}, row, row.card);
  if (reason) return reason;
  if (!url) return 'invalid_link';
  // CardPricer's v1 tape omits currency. It explicitly documents USDC amounts for
  // these physical-card venues. For other sources require an explicit USD code.
  // https://cardpricer.co/ecosystem and https://cardpricer.co/methodology
  const source = normalize(row.source);
  const dollarSettled = (source === 'courtyard' && url.startsWith('https://polygonscan.com/')) ||
    (['collector crypt', 'collectorcrypt', 'magic eden'].includes(source) && url.startsWith('https://solscan.io/'));
  if (row.currency !== 'USD' && !(dollarSettled && (row.currency == null || row.currency === 'USDC'))) return 'unsupported_currency';
  const priceCents = Math.round(row.price * 100);
  if (typeof row.price !== 'number' || !Number.isSafeInteger(priceCents) || priceCents < 1) return 'invalid_price';
  return null;
}

export async function lookupComps(card, { fetchImpl = fetch, now = new Date(), signal, excludedUrls = new Set() } = {}) {
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
  let pages = 0;
  for (const player of directoryPlayers(card.player)) {
    let offset = 0;
    for (;;) {
      if (pages >= MAX_PAGES) return result('needs_details', 'The catalogue search is too broad to identify a unique card.');
      const {data, meta} = await get('cards', {
        player, year:text(card.year), q:text(card.card_number).replace(/^#\s*/, ''), limit:'200', offset:String(offset)
      });
      pages++;
      const paging = meta?.pagination;
      if (!Array.isArray(data) || !paging || !Number.isSafeInteger(paging.total) || paging.total < 0 ||
          !('nextOffset' in paging) || data.some(row => !row || !UUID.test(row.id) || !('cardNumber' in row) || !('grade' in row) || !('set' in row))) throw invalid();
      for (const row of data) if (!catalogMismatch(card, row)) candidates.set(row.id, row);
      if (candidates.size > 1) return result('needs_details', 'Multiple catalogue entries match this card. Confirm its set, number, and variation.');
      if (paging.nextOffset === null) break;
      if (!Number.isSafeInteger(paging.nextOffset) || paging.nextOffset <= offset) throw invalid();
      offset = paging.nextOffset;
    }
    const [match] = candidates.values();
    // A directory spelling such as "ONeal" can reveal an alternate form even
    // when the entered name was plain "Oneal". Check that broader spelling too.
    if (match && (player !== playerSearchName(card.player) || directoryPlayers(match.player)[0] === player)) break;
  }
  if (!candidates.size) return result('insufficient', 'CardPricer has no exact catalogue match for this card and grade.');

  const [candidate] = candidates.values();
  const { data } = await get('cards/' + candidate.id + '/provenance');
  if (data?.card?.id !== candidate.id || !Array.isArray(data?.comps?.recent)) throw invalid();
  const observations = data.comps.recent;
  if (observations.some(obs => !obs || typeof obs.id !== 'string' || !obs.id || !Number.isFinite(validTime(obs.soldDate)))) throw invalid();

  let player = specificPlayer(card.player, candidate.player);
  if (text(data.card.player)) {
    if (!playersMatch(player, data.card.player)) throw invalid();
    player = specificPlayer(player, data.card.player);
  }
  const catalogCard = {...card, player};
  const at = now.getTime();
  const inWindow = time => time <= at && time >= at - 90 * DAY;
  const ordered = observations.map(obs => ({obs, time:validTime(obs.soldDate)}))
    .sort((a, b) => Number(inWindow(b.time)) - Number(inWindow(a.time)) || b.time - a.time);
  const confirmed = [];
  const seenIds = new Set();
  const outcomes = new Map();
  const tape = new Map();
  let eligible = 0;
  // Multiple provider observations may refer to one marketplace receipt. A
  // completed sale takes precedence, then a pending check, then a rejection.
  function record(key, outcome) {
    const previous = outcomes.get(key);
    if (!previous || outcome === 'verified' || (previous !== 'verified' && outcome === 'unchecked')) outcomes.set(key, outcome);
  }
  for (const {obs, time} of ordered) {
    if (seenIds.has(obs.id)) continue;
    seenIds.add(obs.id);
    const key = saleLink(obs.url) || 'id:' + obs.id;
    if (outcomes.get(key) === 'verified') continue;
    if (!inWindow(time)) {
      record(key, 'outside_window');
      continue;
    }
    const reason = listingMismatch(catalogCard, obs, candidate);
    if (reason) {
      record(key, reason);
      continue;
    }
    if (eligible === MAX_SALES || (!tape.has(time) && tape.size >= MAX_OBSERVATIONS)) {
      record(key, 'unchecked');
      continue;
    }
    if (!tape.has(time)) {
      const params = { include: 'sale', since: new Date(time - 1000).toISOString(), until: new Date(time + 1000).toISOString(), limit: '200' };
      if (candidate.sport) params.sport = candidate.sport;
      const feed = await get('sales', params);
      if (!Array.isArray(feed.data) || feed.data.some(row => !row || typeof row.id !== 'string' ||
          !('observationType' in row) || !('cardId' in row) || !('price' in row))) throw invalid();
      tape.set(time, feed);
    }
    const feed = tape.get(time);
    const row = feed.data.find(row => row.id === obs.id && validTime(row.soldDate) === time);
    if (!row) {
      const paging = feed.meta?.pagination;
      const truncated = paging && 'nextCursor' in paging ? paging.nextCursor !== null : feed.data.length >= 200;
      record(key, truncated ? 'unchecked' : 'unconfirmed_sale');
      continue;
    }
    const url = saleLink(row.sourceUrl);
    const linkedCard = {...catalogCard, player:listingPlayer(catalogCard.player, obs.title)};
    const tapeReason = tapeMismatch(linkedCard, row, candidate.id, url);
    if (tapeReason) {
      record(url || key, tapeReason);
      continue;
    }
    if (outcomes.get(url) === 'verified') continue;
    record(url, 'verified');
    confirmed.push({id:row.id, title:row.title.trim(), soldAt:new Date(time).toISOString(), priceCents:Math.round(row.price * 100), url});
    if (!excludedUrls.has(url)) eligible++;
  }
  const diagnostics = {found:outcomes.size, verified:confirmed.length, unchecked:0, rejected:{}};
  for (const reason of outcomes.values()) {
    if (reason === 'unchecked') diagnostics.unchecked++;
    else if (reason !== 'verified') diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1;
  }
  const {sales, valueCents, confidence, range} = estimateSales(confirmed.filter(sale => !excludedUrls.has(sale.url)));
  const quote = valueCents === null
    ? result('insufficient', 'Two recent, verified sales of this exact card are needed for an estimate.', sales)
    : result('valued', 'Median of recent verified sales of this card.', sales, valueCents);
  Object.assign(quote, {confidence, range, diagnostics});
  const extraSales = confirmed.filter(sale => !sales.includes(sale));
  if (extraSales.length) quote.extraSales = extraSales;
  return quote;
}
