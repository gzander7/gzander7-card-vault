// An older device can provide just the daily total. Only a complete inventory
// that reconciles with that total can explain its change card by card.
function inventory(day) {
  if (!Array.isArray(day.cards) || day.cards.length !== day.total) return null;
  const cards = new Map();
  let priced = 0;
  let sum = 0;
  for (const card of day.cards) {
    if (typeof card?.id !== 'string' || !card.id || cards.has(card.id) ||
        typeof card.label !== 'string' || !card.label.trim()) return null;
    if (card.valueCents !== null) {
      if (!Number.isSafeInteger(card.valueCents) || card.valueCents < 0) return null;
      priced++;
      sum += card.valueCents;
    }
    cards.set(card.id, card);
  }
  const matchesValue = priced > 0 ? day.valueCents === sum
    : day.valueCents === null || (cards.size === 0 && day.valueCents === 0);
  return matchesValue && priced === day.priced && Number.isSafeInteger(sum) ? cards : null;
}

function changeKind(before, after) {
  if (!before) return 'added';
  if (!after) return 'removed';
  if (before.valueCents === after.valueCents) return null;
  if (before.valueCents === null) return 'priced';
  if (after.valueCents === null) return 'unpriced';
  return 'estimate';
}

export function compareDays(previous, current) {
  const unavailable = status => ({ status, netCents: null, changes: [] });
  if (!current) return unavailable('empty');
  const after = inventory(current);
  if (!after) return unavailable('legacy');
  if (!previous) return unavailable('baseline');
  const before = inventory(previous);
  if (!before) return unavailable('legacy');

  const changes = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(id);
    const to = after.get(id);
    const kind = changeKind(from, to);
    if (!kind) continue;
    const beforeCents = from?.valueCents ?? null;
    const afterCents = to?.valueCents ?? null;
    changes.push({ id, label: (to || from).label, kind, beforeCents, afterCents,
      deltaCents: (afterCents ?? 0) - (beforeCents ?? 0) });
  }
  changes.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents)
    || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { status: 'ready', netCents: (current.valueCents ?? 0) - (previous.valueCents ?? 0), changes };
}
