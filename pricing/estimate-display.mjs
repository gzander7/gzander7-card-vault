const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' });
const confidenceLabels = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const rejectionLabels = {
  incomplete_card: 'with incomplete card details',
  missing_title: 'without a title',
  unsafe_listing: 'with a disallowed listing type',
  wrong_grade: 'with a different grade',
  wrong_player: 'with a different player',
  wrong_set: 'with a different set',
  wrong_year: 'with a different year',
  wrong_parallel: 'with a different parallel',
  missing_parallel: 'without the required parallel designation',
  wrong_autograph: 'with a different autograph designation',
  wrong_relic: 'with a different relic designation',
  wrong_card_number: 'with a different card number',
  wrong_print_run: 'with a different print run',
  unknown_title_words: 'with unrecognized title words',
  outside_window: 'outside the 90-day window',
  unconfirmed_sale: 'without a confirmed sale',
  wrong_card: 'linked to a different card',
  invalid_link: 'without a verifiable receipt link',
  unsupported_currency: 'in an unsupported currency',
  invalid_price: 'without a valid price',
};

export function money(cents) {
  return Number.isSafeInteger(cents) && cents >= 0 ? usd.format(cents / 100) : '—';
}

export function estimateEvidenceText(quote) {
  if (quote?.status !== 'valued') return '';
  const confidence = Object.hasOwn(confidenceLabels, quote.confidence) && confidenceLabels[quote.confidence];
  const { lowCents, highCents } = quote.range || {};
  if (!confidence || !Number.isSafeInteger(lowCents) || !Number.isSafeInteger(highCents) || lowCents <= 0 || highCents < lowCents) {
    return 'Confidence unavailable';
  }
  const range = lowCents === highCents ? 'All sales ' + money(lowCents) : 'Sale range ' + money(lowCents) + '–' + money(highCents);
  return confidence + ' · ' + range;
}

export function listingDiagnosticsText(diagnostics) {
  if (!diagnostics) return '';
  const { found, verified, rejected, unchecked } = diagnostics;
  const reasons = Object.entries(rejected || {});
  const counts = [found, verified, unchecked, ...reasons.map(([, count]) => count)];
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0)
      || found !== reasons.reduce((total, [, count]) => total + count, verified + unchecked)) return '';
  if (found === 0) return 'CardPricer found no listings for this card.';
  const labels = [verified + ' verified'];
  for (const [reason, count] of reasons.sort(([, a], [, b]) => b - a)) {
    if (!count) continue;
    const label = reason === 'lot' ? (count === 1 ? 'lot' : 'lots')
      : Object.hasOwn(rejectionLabels, reason) ? rejectionLabels[reason] : reason.replaceAll('_', ' ');
    labels.push(count + ' ' + label);
  }
  if (unchecked) labels.push(unchecked + ' unchecked');
  return 'CardPricer found ' + found + (found === 1 ? ' listing. ' : ' listings. ') + labels.join(' · ');
}
