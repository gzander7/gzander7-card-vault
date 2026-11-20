// Generated from pricing/sold-search.mjs by scripts/sync-function-shared.mjs. Do not edit.
import { printRun } from './identity.mjs';

export function soldSearchTerms(card) {
  const run = printRun(card.serial);
  const parallel = card.parallel?.trim();
  const variant = parallel && parallel.toLowerCase() !== 'base' ? parallel : '';
  // Sellers often omit the checklist number on numbered parallels. For an
  // unnumbered auto or relic, the checklist number identifies the design even
  // when sellers use different names for the finish.
  const useInsertNumber = !run && card.card_number && (card.is_auto || card.is_relic);
  return [
    card.year,
    card.set_name,
    card.player,
    !(run && variant) && card.card_number,
    !useInsertNumber && variant,
    run && '/' + run,
    card.is_auto && 'auto',
    card.is_relic && 'relic',
    card.grader,
    card.grade,
  ]
    .filter(Boolean)
    .join(' ');
}
