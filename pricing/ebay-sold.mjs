import { needsDetails, printRun, saleMismatchReason } from './identity.mjs';
import { saleUrl } from './reviews.mjs';
import { soldSearchTerms } from './sold-search.mjs';

const DAY = 86_400_000;
const DAYS = 365;
const colors = ['silver', 'gold', 'orange', 'red', 'blue', 'green', 'purple', 'black', 'white', 'pink'];
function transposedColor(parallel) {
  const value = String(parallel || '')
    .trim()
    .toLowerCase();
  if (colors.includes(value)) return null;
  return (
    colors.find(
      color =>
        color.length === value.length &&
        [...value].some(
          (_, i) => i + 1 < value.length && value.slice(0, i) + value[i + 1] + value[i] + value.slice(i + 2) === color,
        ),
    ) || null
  );
}

function classify(card, item) {
  const parsed = item.card;
  if (!parsed || !Array.isArray(parsed.flags) || parsed.flags.length || parsed.graded !== Boolean(card.grader))
    return false;
  const row = {
    title: item.title,
    cardNumber: parsed.card_number,
    year: parsed.year,
    grader: parsed.grader,
    grade: parsed.grade,
    printRun: item.print_run,
  };
  // Some title parsers return a serial such as 08/25 as the checklist number.
  // It is evidence of the run only; the matcher still checks the title for the printed card number.
  if (
    /^\d+\s*\/\s*\d+$/.test(row.cardNumber) &&
    printRun(row.cardNumber) === printRun(card.serial) &&
    row.cardNumber !== card.card_number
  )
    row.cardNumber = null;
  if (!saleMismatchReason(card, row)) return {};
  // Nearby listings stay out of pricing unless the owner verifies the receipt.
  const title = row.title.replace(/\b(?:ssp|sp)\b/gi, ' ');
  if (
    printRun(card.serial) &&
    card.parallel &&
    card.parallel.trim().toLowerCase() !== 'base' &&
    !row.cardNumber &&
    saleMismatchReason(card, { ...row, title }) === 'wrong_card_number' &&
    !saleMismatchReason(card, { ...row, title }, { allowMissingNumber: true })
  ) {
    return { matchNote: 'Card number unconfirmed' };
  }
  const color = transposedColor(card.parallel);
  if (
    color &&
    !saleMismatchReason({ ...card, parallel: color }, { ...row, title: title.replace(/\brefractor\b/gi, ' ') })
  ) {
    return { matchNote: 'Parallel unconfirmed' };
  }
  return false;
}

/** Server-side only. CompsAPI /v1/sold reports completed transactions in USD.
 * Multi-unit listings have an average price and cannot stand for an individual sale.
 * @param {any} card
 * @param {{key:string, now?:Date, fetchImpl?:typeof fetch, signal?:AbortSignal}} options
 */
export async function fetchEbayReceipts(card, { key, now = new Date(), fetchImpl = fetch, signal = undefined }) {
  if (needsDetails(card)) return [];
  const url = new URL('https://api.compsapi.com/v1/sold');
  const params = {
    q: soldSearchTerms(card),
    days: String(DAYS),
    size: '200',
    best_offer: '1',
    cards: '1',
    exclude: 'junk',
    print_run: String(printRun(card.serial) || 'any'),
  };
  url.search = new URLSearchParams(params).toString();
  const timeout = AbortSignal.timeout(25_000);
  const response = await fetchImpl(url, {
    headers: { 'X-API-Key': key, 'User-Agent': 'CardVault/1.0', Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw Object.assign(new Error('eBay sold search is unavailable.'), { status: response.status });
  const body = await response.json();
  if (body?.ok !== true || body.source !== 'ebay' || !Array.isArray(body.items))
    throw new Error('Unexpected eBay sold search response.');
  const receipts = new Map();
  for (const item of body.items) {
    if (
      !item ||
      typeof item.title !== 'string' ||
      !['FIXED_PRICE', 'AUCTION'].includes(item.format) ||
      item.units_sold !== 1 ||
      (item.currency != null && item.currency !== 'USD')
    )
      continue;
    const priceCents = Math.round(item.price * 100);
    if (typeof item.price !== 'number' || !Number.isSafeInteger(priceCents) || priceCents <= 0) continue;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z$/.test(item.last_sold)) continue;
    const time = Date.parse(item.last_sold);
    if (
      !Number.isFinite(time) ||
      time > +now ||
      time < (Math.floor(+now / DAY) - DAYS) * DAY ||
      new Date(time).toISOString().slice(0, 10) !== item.last_sold.slice(0, 10)
    )
      continue;
    let receipt;
    try {
      receipt = saleUrl(item.url);
    } catch {
      continue;
    }
    if (!/^\d{9,16}$/.test(item.item_id) || receipt !== 'https://www.ebay.com/itm/' + item.item_id) continue;
    const match = classify(card, item);
    if (!match) continue;
    const sale = {
      url: receipt,
      title: item.title.trim(),
      priceCents,
      soldAt: new Date(time).toISOString(),
      provider: 'CompsAPI',
      ...match,
    };
    if (!receipts.has(receipt) || (!sale.matchNote && receipts.get(receipt).matchNote)) receipts.set(receipt, sale);
  }
  const sorted = [...receipts.values()].sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.url.localeCompare(b.url));
  return [...sorted.filter(s => !s.matchNote).slice(0, 20), ...sorted.filter(s => s.matchNote).slice(0, 3)];
}
