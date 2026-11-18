import { compareDays } from './history-changes.mjs';

function changeDescription(change, money) {
  const before = change.beforeCents == null ? 'Unpriced' : money(change.beforeCents);
  const after = change.afterCents == null ? 'Unpriced' : money(change.afterCents);
  if (change.kind === 'added') return 'Added to vault · ' + after;
  if (change.kind === 'removed') return 'Removed from vault · ' + before;
  if (change.kind === 'priced') return 'Newly priced at ' + after;
  if (change.kind === 'unpriced') return 'Now unpriced · Previously ' + before;
  return 'Estimate changed from ' + before + ' to ' + after;
}

export function createHistoryComparison(section, { dateText, money, signedMoney }) {
  const dates = section.querySelector('.history-comparison-dates');
  const net = section.querySelector('.history-net');
  const amount = net.querySelector('strong');
  const note = section.querySelector('.history-comparison-note');
  const cards = section.querySelector('.history-card-changes');

  function cardRow(change) {
    const row = document.createElement('li');
    const identity = document.createElement('div');
    const label = document.createElement('strong');
    const description = document.createElement('p');
    const delta = document.createElement('span');
    label.textContent = change.label;
    description.textContent = changeDescription(change, money);
    identity.append(label, description);
    delta.className = 'history-card-delta';
    delta.dataset.direction = String(Math.sign(change.deltaCents));
    delta.textContent = signedMoney(change.deltaCents);
    row.append(identity, delta);
    return row;
  }

  return function showComparison(previous, current, datesOutsideRange = false) {
    const { status, netCents, changes } = compareDays(previous, current);
    dates.textContent = [previous, current].filter(Boolean).map(day => dateText(day.date)).join(' to ');
    net.hidden = status !== 'ready';
    amount.textContent = net.hidden ? '' : signedMoney(netCents);
    amount.dataset.direction = net.hidden ? '' : String(Math.sign(netCents));
    let message = '';
    if (status === 'empty') {
      message = datesOutsideRange ? 'Choose a longer chart range to compare recorded dates.' : 'Your first recorded date will appear here.';
    } else if (status === 'legacy') {
      if (!Array.isArray(current.cards)) message = 'Only the vault total was recorded for this date.';
      else if (previous && !Array.isArray(previous.cards)) message = 'The previous date has only a vault total. This date starts a new card-by-card comparison.';
      else message = 'The saved card details are incomplete for this comparison.';
    } else if (status === 'baseline') {
      message = 'This is the first record with card details. The next recorded date will show what changed.';
    } else if (!changes.length) {
      message = 'The same cards and estimates were recorded on both dates.';
    }
    note.textContent = message;
    note.hidden = !message;
    cards.hidden = !changes.length;
    cards.replaceChildren(...changes.map(cardRow));
  };
}
