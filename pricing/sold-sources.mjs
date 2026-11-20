import { lookupComps } from './cardpricer.mjs';
import { identityKey } from './identity.mjs';
import { estimateSales, saleUrl } from './reviews.mjs';

const DAY = 86_400_000;
const rows = quote => [...(quote?.sales || []), ...(quote?.extraSales || [])];
const fromEbay = row => row.provider === 'CompsAPI';

// The browser asks its own backend for eBay receipts; the scheduler supplies the
// same lookup in-process. Either source can succeed while the other is down.
/**
 * @param {(card: any, options: {now: Date, signal?: AbortSignal, excludedUrls?: Set<string>, session?: any, previous?: any}) => Promise<{status:string,sales?:any[]}>} ebay
 */
export function combineSoldLookups(ebay, primary = lookupComps) {
  return async (card, options) => {
    const { now, signal, excludedUrls = new Set() } = options;
    const previous = options.previous?.identity === identityKey(card) ? options.previous : null;
    const [catalogue, market] = await Promise.allSettled([primary(card, options), ebay(card, options)]);
    signal?.throwIfAborted();
    const ebayResult = market.status === 'fulfilled' ? market.value : { status: 'retry' };
    if (catalogue.status === 'rejected' && ebayResult.status !== 'ready' && !ebayResult.sales?.length)
      throw catalogue.reason;
    const base = catalogue.status === 'fulfilled' ? catalogue.value : null;
    const oldRows = rows(previous);
    const primaryRows = base ? rows(base) : oldRows.filter(r => !fromEbay(r));
    const secondaryRows =
      ebayResult.status === 'ready' || ebayResult.sales?.length ? ebayResult.sales || [] : oldRows.filter(fromEbay);
    const unique = new Map();
    // An exact identification beats a reference; for an exact eBay receipt
    // prefer the marketplace's final sale amount if both feeds report it.
    for (const sale of [...primaryRows, ...secondaryRows]) {
      let url;
      try {
        url = saleUrl(sale.url);
      } catch {
        continue;
      }
      if (!unique.has(url) || !sale.matchNote) unique.set(url, { ...sale, url });
    }
    const all = [...unique.values()].sort(
      (a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt) || a.url.localeCompare(b.url),
    );
    const today = Math.floor(+now / DAY);
    const eligible = all.filter(s => {
      const day = Math.floor(Date.parse(s.soldAt) / DAY);
      return !s.matchNote && !excludedUrls.has(s.url) && day >= today - 90 && day <= today;
    });
    const { sales, valueCents, range, confidence } = estimateSales(eligible);
    const partial = !base || ebayResult.status === 'retry';
    const nextLookupAt = partial
      ? +now + 15 * 60_000
      : ebayResult.status === 'disabled' || sales.length < 2
        ? (today + 1) * DAY
        : +now + 7 * DAY;
    const status =
      valueCents !== null
        ? 'valued'
        : all.length || ebayResult.status === 'ready'
          ? 'insufficient'
          : base?.status || 'insufficient';
    const message =
      valueCents !== null
        ? 'Median of recent verified sales of this card.'
        : ebayResult.status === 'ready'
          ? 'Two matching sales within 90 days are needed for an estimate.'
          : base?.message || 'Sales lookup will retry.';
    return {
      ...(base || {}),
      status,
      message,
      checkedAt: now.toISOString(),
      source: secondaryRows.length || ebayResult.status === 'ready' ? 'CardPricer and eBay' : 'CardPricer',
      sales,
      extraSales: all.filter(s => !sales.includes(s)),
      valueCents,
      range,
      confidence,
      ebayStatus: ebayResult.status,
      nextLookupAt,
    };
  };
}
