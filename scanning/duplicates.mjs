const clean = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
const label = value => clean(value).normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/['’‘]|(?<=\p{L})\./gu, '').replace(/[\p{Pd},\s]+/gu, ' ').trim();

function printedNumber(value) {
  return clean(value).replace(/^(?:card\s*)?(?:no\.|(?:no|number)(?=\s|#|$)|#)\s*#?\s*/u, '')
    .replace(/[\p{Pd}\s]+/gu, '-')
    .replace(/(?<=\p{L})-(?=\d)|(?<=\d)-(?=\p{L})/gu, '');
}

function parallelLabel(value) {
  const parallel = label(value);
  return parallel === 'base' ? '' : parallel;
}

function serialDetails(value) {
  const text = clean(value);
  const match = /^(?:#?\s*(?:(\d+)\s*)?(?:\/|of)\s*|numbered\s+to\s+)(\d+)$/.exec(text);
  if (match) {
    const copy = match[1] ? Number(match[1]) : null;
    const run = Number(match[2]);
    if (Number.isSafeInteger(run) && run > 0 && (copy === null || (copy > 0 && copy <= run))) {
      return { text: (copy ?? '') + '/' + run, run };
    }
  }
  return { text, run: null };
}

// Different copies of the same issue can both belong in the vault. A serial
// can distinguish a different print run or point the viewer to an exact copy.
export function findSimilarCard(cards, owner, draft) {
  const ownerId = clean(owner);
  const year = clean(draft.year);
  if (!ownerId || !/^\d{4}$/.test(year)) return null;
  const player = label(draft.player);
  const set = label(draft.set_name);
  const number = printedNumber(draft.card_number);
  if (![player, set, number].every(part => /[\p{L}\p{N}]/u.test(part))) return null;
  const parallel = parallelLabel(draft.parallel);
  const serial = serialDetails(draft.serial);
  let best = null;
  let bestRank = -1;
  for (const card of cards) {
    if (card.id === draft.id || clean(card.owner) !== ownerId || clean(card.year) !== year
      || printedNumber(card.card_number) !== number || label(card.player) !== player || label(card.set_name) !== set
      || parallelLabel(card.parallel) !== parallel || Boolean(card.is_auto) !== Boolean(draft.is_auto)
      || Boolean(card.is_relic) !== Boolean(draft.is_relic)) continue;
    const candidate = serialDetails(card.serial);
    if (candidate.text === serial.text) return card;
    const sameRun = serial.run !== null && serial.run === candidate.run;
    if (serial.text && candidate.text && !sameRun) continue;
    const rank = sameRun ? 1 : 0;
    if (rank > bestRank) {
      best = card;
      bestRank = rank;
    }
  }
  return best;
}
