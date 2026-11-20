import { exclusionReasons } from './reviews.mjs';
import { identityKey } from './identity.mjs';

export function createReviewDialog(commit) {
  const field = name => document.getElementById('sold-comp-' + name);
  const dialog = field('dialog');
  const form = field('form');
  const save = field('submit');
  const close = field('close');
  const remove = field('remove');
  const reason = field('reason');
  let draft = null;
  let saving = false;
  let opener;

  for (const value of exclusionReasons) {
    const option = document.createElement('option');
    option.value = option.textContent = value;
    reason.append(option);
  }

  function show(mode, card, sale) {
    draft = { mode, card, sale };
    const entry = sale?.manual;
    const editing = mode === 'save';
    form.reset();
    field('error').textContent = '';
    field('title').textContent = editing
      ? entry
        ? 'Edit sold comp'
        : 'Add sold comp'
      : mode === 'exclude'
        ? 'Flag a wrong match'
        : 'Remove saved sale?';
    field('card').textContent = [
      card.player,
      card.year,
      card.set_name,
      card.card_number && '#' + card.card_number,
      card.parallel || 'Base',
      card.serial,
      card.is_auto && 'Autograph',
      card.is_relic && 'Relic',
      [card.grader, card.grade].filter(Boolean).join(' ') || 'Raw',
    ]
      .filter(Boolean)
      .join(' · ');
    field('fields').hidden = field('fields').disabled = !editing;
    field('flag-fields').hidden = field('flag-fields').disabled = mode !== 'exclude';
    field('detail').hidden = !sale || editing;
    field('detail').textContent = sale
      ? sale.title +
        ' · ' +
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sale.priceCents / 100) +
        ' · ' +
        sale.soldAt.slice(0, 10)
      : '';
    field('url').value = entry?.url || '';
    field('price').value = entry ? (entry.priceCents / 100).toFixed(2) : '';
    field('date').max = new Date().toISOString().slice(0, 10);
    field('date').value = entry?.soldAt || '';
    field('parallel').value = entry?.parallel || card.parallel || 'Base';
    field('exact').checked = Boolean(entry?.exact && entry.identity === identityKey(card));
    reason.value = '';
    save.textContent = editing ? 'Save sale' : mode === 'exclude' ? 'Exclude sale' : 'Remove sale';
    remove.hidden = !editing || !entry;
    if (!dialog.open) {
      opener = document.activeElement?.closest('.value-card');
      dialog.showModal();
    }
    (editing ? field('url') : mode === 'exclude' ? reason : close).focus();
  }

  close.addEventListener('click', () => dialog.close());
  remove.addEventListener('click', () => {
    if (draft && !saving) show('remove', draft.card, draft.sale);
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    draft = null;
    if (opener?.isConnected && document.activeElement === document.body) opener.querySelector('.comp-add')?.focus();
    opener = null;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft || saving) return;
    const current = draft;
    const { mode, card, sale } = current;
    const command =
      mode === 'save'
        ? {
            type: mode,
            key: sale?.url,
            input: {
              url: field('url').value,
              price: field('price').value,
              date: field('date').value,
              parallel: field('parallel').value,
              exact: field('exact').checked,
            },
          }
        : { type: mode, url: sale.url, reason: reason.value };
    saving = true;
    save.disabled = remove.disabled = true;
    const idleText = save.textContent;
    save.textContent = 'Saving…';
    field('error').textContent = '';
    try {
      await commit(card, command);
      if (draft === current && dialog.open) dialog.close();
    } catch (error) {
      if (draft === current) field('error').textContent = error.message || 'Could not save the sale. Try again.';
    } finally {
      saving = false;
      save.disabled = remove.disabled = false;
      if (draft === current) save.textContent = idleText;
    }
  });
  return {
    show,
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
