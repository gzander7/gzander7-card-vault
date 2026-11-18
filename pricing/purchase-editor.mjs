import { localDay, parsePurchase } from './purchases.mjs';

export function createPurchaseEditor(ledger) {
  const section = document.getElementById('card-purchase');
  const field = name => document.getElementById('purchase-' + name);
  const amount = field('amount'), date = field('date'), source = field('source');
  const fields = field('fields'), status = field('form-status'), clear = field('clear'), retry = field('retry');
  let draft = null;

  function fill(row) {
    amount.value = row?.amount_cents != null ? (row.amount_cents / 100).toFixed(2) : '';
    date.value = row?.purchased_on || '';
    source.value = row?.source || '';
    clear.hidden = row?.amount_cents == null;
  }

  async function load(current) {
    fields.disabled = true;
    retry.hidden = true;
    status.textContent = 'Loading your purchase details…';
    try {
      await ledger.load(true);
      if (draft !== current) return;
      current.original = ledger.records[current.card.id] || null;
      fill(current.original);
      current.ready = true;
      fields.disabled = false;
      status.textContent = '';
      if (current.focus && document.activeElement === section.querySelector('summary')) amount.focus();
    } catch {
      if (draft !== current) return;
      status.textContent = 'Purchase details could not be loaded. Reconnect and retry to edit them.';
      retry.hidden = false;
    }
  }

  function open(card, focus = false, savedDraft = null) {
    draft = {card, focus, ready:!card, original:null};
    section.open = focus;
    date.max = localDay();
    fill(null);
    if (!card && savedDraft) {
      amount.value = savedDraft.amount;
      date.value = savedDraft.date;
      source.value = savedDraft.source;
      section.open = savedDraft.open;
    }
    retry.hidden = true;
    fields.disabled = false;
    status.textContent = '';
    if (focus) section.querySelector('summary').focus();
    if (card) void load(draft);
    else if (focus) amount.focus();
  }

  function change() {
    if (!draft?.ready) return null;
    let value;
    try {
      value = parsePurchase({amount:amount.value, date:date.value, source:source.value});
    } catch (error) {
      section.open = true;
      amount.focus();
      throw error;
    }
    const record = value || {amount_cents:null, purchased_on:null, source:null};
    const original = draft.original;
    if (Object.keys(record).every(key => record[key] === (original?.[key] ?? null))) return null;
    return {...record, expected_revision:original?.revision ?? null, revision:crypto.randomUUID()};
  }

  retry.addEventListener('click', () => { if (draft?.card) void load(draft); });
  clear.addEventListener('click', () => {
    fill(null);
    status.textContent = 'Save changes to clear this purchase.';
    amount.focus();
  });
  section.addEventListener('input', () => { if (draft?.ready) status.textContent = ''; });
  section.addEventListener('invalid', () => { section.open = true; }, true);
  function close() {
    draft = null;
    fill(null);
    status.textContent = '';
    section.open = false;
  }
  function snapshot() {
    return {amount:amount.value, date:date.value, source:source.value, open:section.open};
  }
  return {open, close, change, snapshot};
}
