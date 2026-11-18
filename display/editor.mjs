import { caseFields, MAX_CARDS, MAX_TITLE, presentCard } from './cards.mjs';
import { element, photo } from './dom.mjs';

export function editCase(panel, { cards, original, onCancel, onSave, onReload, tell }) {
  panel.innerHTML = `
    <form class="case-editor">
      <fieldset class="case-fields">
        <label class="case-field">Case name
          <input name="title" type="text" required autocomplete="off" placeholder="e.g. Postseason favorites">
        </label>
        <fieldset class="case-picker" aria-describedby="case-picker-help">
          <legend>Choose cards</legend>
          <p id="case-picker-help" class="case-hint">Cards appear in the order you select them. Choose up to 60.</p>
          <label class="case-field case-search">Find a card
            <input type="search" placeholder="Player, set, or number" autocomplete="off">
          </label>
          <p class="case-count" role="status"></p>
          <ul class="case-choices" aria-label="Your vault cards"></ul>
          <p class="case-picker-message case-hint"></p>
        </fieldset>
      </fieldset>
      <div class="case-controls">
        <button class="gold-btn case-save" type="submit"></button>
        <button class="link-button case-cancel" type="button">Cancel</button>
        <button class="link-button case-reload" type="button" hidden>Reload display cases</button>
      </div>
    </form>`;
  const find = selector => panel.querySelector(selector);
  const form = find('form');
  const name = find('[name="title"]');
  const fields = find('.case-fields');
  const search = find('[type="search"]');
  const count = find('.case-count');
  const choices = find('.case-choices');
  const message = find('.case-picker-message');
  const save = find('.case-save');
  const cancel = find('.case-cancel');
  const reload = find('.case-reload');
  const available = new Set(cards.map(card => card.id));
  const savedIds = original?.card_ids || [];
  const selected = new Set(savedIds.filter(id => available.has(id)));
  const options = [];
  const id = original?.id || crypto.randomUUID();
  let lastAttempt;
  let busy = false;
  name.maxLength = MAX_TITLE;
  name.value = original?.title || '';
  save.textContent = original ? 'Save changes' : 'Create case';
  cancel.addEventListener('click', onCancel);
  reload.addEventListener('click', onReload);

  if (savedIds.length > selected.size) {
    fields.prepend(element('p', 'case-warning',
      'Some saved cards are missing from your vault. Saving will remove those cards from this case.'));
  }
  if (!cards.length) {
    find('.case-search').hidden = true;
    choices.hidden = true;
    message.textContent = 'Add a card to your vault to share it in a case.';
  }

  function updateSelection() {
    const ranks = new Map(Array.from(selected, (id, index) => [id, index + 1]));
    for (const { id, input, rank, rankNumber } of options) {
      input.checked = ranks.has(id);
      input.disabled = !input.checked && selected.size >= MAX_CARDS;
      rank.hidden = !input.checked;
      rankNumber.textContent = ranks.get(id) || '';
      if (input.checked) input.setAttribute('aria-describedby', rank.id);
      else input.removeAttribute('aria-describedby');
    }
    count.textContent = selected.size + ' of ' + MAX_CARDS + ' selected';
    save.disabled = busy || !selected.size;
  }

  const items = document.createDocumentFragment();
  for (const card of cards) {
    const item = presentCard(card);
    const li = element('li');
    const label = element('label', 'case-option');
    const input = element('input');
    input.type = 'checkbox';
    input.value = card.id;
    input.setAttribute('aria-label', item.label);
    const thumb = element('span', 'case-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    thumb.append(photo(item.frontUrl, ''));
    const copy = element('span', 'case-option-text');
    copy.append(element('strong', '', item.name));
    const details = [item.meta, item.detail, ...item.tags].filter(Boolean).join(' · ');
    if (details) copy.append(element('span', '', details));
    const rank = element('span', 'case-rank');
    rank.id = 'case-position-' + card.id;
    const rankNumber = element('span');
    rank.append(element('span', 'visually-hidden', 'Display position '), rankNumber);
    input.addEventListener('change', () => {
      if (input.checked && selected.size < MAX_CARDS) selected.add(card.id);
      else selected.delete(card.id);
      updateSelection();
    });
    options.push({ id: card.id, li, input, rank, rankNumber, searchText: item.label.toLocaleLowerCase() });
    label.append(input, thumb, copy, rank);
    li.append(label);
    items.append(li);
  }
  choices.append(items);
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const option of options) {
      option.li.hidden = !option.searchText.includes(query);
      if (!option.li.hidden) matches++;
    }
    message.textContent = matches ? '' : 'No cards match your search.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    let values;
    try {
      values = caseFields(name.value, selected, cards);
    } catch (error) {
      tell(error.message);
      if (!name.value.trim()) name.focus();
      return;
    }
    const sameAttempt = lastAttempt?.title === values.title
      && lastAttempt.card_ids.join() === values.card_ids.join();
    if (!sameAttempt) {
      lastAttempt = { id, ...values, expectedRevision: original?.revision ?? null, revision: crypto.randomUUID() };
    }
    busy = true;
    fields.disabled = save.disabled = cancel.disabled = true;
    tell('Saving display case…');
    const result = await onSave(lastAttempt);
    if (!form.isConnected || !result) return;
    busy = false;
    fields.disabled = cancel.disabled = false;
    if (result.conflict) {
      save.disabled = true;
      fields.disabled = true;
      reload.hidden = false;
      reload.focus();
    } else {
      updateSelection();
      save.focus();
    }
  });
  updateSelection();
  name.focus();
}
