import { hasPurchaseDetails, localDay, parsePurchase } from './purchases.mjs';

export function createPurchaseEditor(ledger) {
  const section = document.getElementById('card-purchase');
  const field = name => document.getElementById('purchase-' + name);
  const amount = field('amount'),
    date = field('date'),
    source = field('source');
  const purchased = field('purchased'),
    pulled = field('pulled'),
    box = field('box'),
    boxField = field('box-field');
  const fields = field('fields'),
    status = field('form-status'),
    clear = field('clear'),
    retry = field('retry');
  let draft = null;

  function updateBox() {
    boxField.hidden = box.disabled = !pulled.checked;
    if (box.disabled) box.value = '';
    field('amount-label').textContent = pulled.checked ? 'Cost for this card (USD)' : 'Total paid (USD)';
    field('date-label').textContent = pulled.checked ? 'Date pulled' : 'Purchase date';
    field('source-label').textContent = pulled.checked ? 'Source' : 'Purchased from';
    field('hint').textContent = pulled.checked
      ? 'Leave the cost blank if unknown. Enter 0 if this card was free.'
      : 'Include tax, shipping and fees. Enter 0 for a free card.';
  }

  function fill(values) {
    amount.value = values?.amount || '';
    date.value = values?.date || '';
    source.value = values?.source || '';
    pulled.checked = values?.acquisitionType === 'pulled';
    purchased.checked = !pulled.checked;
    box.value = values?.boxName || '';
    updateBox();
    clear.hidden = true;
  }

  async function load(current) {
    fields.disabled = true;
    retry.hidden = true;
    status.textContent = 'Loading your purchase details…';
    try {
      await ledger.load(true);
      if (draft !== current) return;
      const row = ledger.records[current.card.id] || null;
      current.original = row;
      fill({
        amount: row?.amount_cents != null ? (row.amount_cents / 100).toFixed(2) : '',
        date: row?.purchased_on,
        source: row?.source,
        acquisitionType: row?.acquisition_type,
        boxName: row?.box_name,
      });
      clear.hidden = !hasPurchaseDetails(row);
      current.ready = true;
      fields.disabled = false;
      status.textContent = '';
      if (current.focus && document.activeElement === section.querySelector('summary')) {
        (pulled.checked ? box : amount).focus();
      }
    } catch {
      if (draft !== current) return;
      status.textContent = 'Purchase details could not be loaded. Reconnect and retry to edit them.';
      retry.hidden = false;
    }
  }

  function open(card, focus = false, savedDraft = null) {
    draft = { card, focus, ready: !card, original: null };
    section.open = !card && savedDraft ? savedDraft.open : focus;
    date.max = localDay();
    fill(card ? null : savedDraft);
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
      value = parsePurchase(snapshot());
    } catch (error) {
      section.open = true;
      amount.focus();
      throw error;
    }
    const record = {
      amount_cents: null,
      purchased_on: null,
      source: null,
      acquisition_type: null,
      box_name: null,
      ...value,
    };
    const original = draft.original;
    if (Object.keys(record).every(key => record[key] === (original?.[key] ?? null))) return null;
    return { ...record, expected_revision: original?.revision ?? null, revision: crypto.randomUUID() };
  }

  purchased.addEventListener('change', updateBox);
  pulled.addEventListener('change', updateBox);
  retry.addEventListener('click', () => {
    if (draft?.card) void load(draft);
  });
  clear.addEventListener('click', () => {
    fill(null);
    status.textContent = 'Save changes to clear this purchase.';
    amount.focus();
  });
  section.addEventListener('input', () => {
    if (draft?.ready) status.textContent = '';
  });
  section.addEventListener(
    'invalid',
    () => {
      section.open = true;
    },
    true,
  );
  function close() {
    draft = null;
    fill(null);
    status.textContent = '';
    section.open = false;
  }
  function snapshot() {
    return {
      amount: amount.value,
      date: date.value,
      source: source.value,
      acquisitionType: pulled.checked ? 'pulled' : null,
      boxName: box.value,
      open: section.open,
    };
  }
  return { open, close, change, snapshot };
}
