import { caseLink, cardCount, MAX_CARDS, presentCard } from './cards.mjs';
import { element, button } from './dom.mjs';
import { editCase } from './editor.mjs';
import { listCases, listPickerCards, saveCase, stopSharing, CaseConflict } from './store.mjs';

export function createDisplayCases({ client, getOwner }) {
  let manager;
  function close() {
    manager?.close();
    manager = null;
  }
  function open(trigger, card = null) {
    const owner = getOwner();
    if (card && (!card.id || !owner || String(card.owner).toLowerCase() !== owner.toLowerCase())) return;
    if (manager?.dialog.open && manager.owner === owner) return;
    close();
    if (owner) manager = openManager({ client, owner, getOwner }, trigger || document.activeElement, card);
  }
  return { open, close };
}

function openManager({ client, owner, getOwner }, trigger, card) {
  const dialog = element('dialog', 'case-manager');
  dialog.setAttribute('aria-labelledby', 'case-manager-title');
  dialog.innerHTML = `
    <header class="case-manager-head">
      <h2 id="case-manager-title">Display cases</h2>
      <button type="button" class="link-button case-close">Close</button>
    </header>
    <div class="case-panel"></div>
    <p class="case-manager-status" role="status" aria-live="polite" aria-atomic="true"></p>`;
  const panel = dialog.querySelector('.case-panel');
  const heading = dialog.querySelector('h2');
  const status = dialog.querySelector('.case-manager-status');
  const closeButton = dialog.querySelector('.case-close');
  let cases = [];
  let pending = null;
  const live = () => dialog.open && getOwner() === owner;
  const tell = message => {
    if (live()) status.textContent = message;
  };

  function close() {
    pending?.abort();
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    if (closeButton.disabled) event.preventDefault();
  });
  dialog.addEventListener(
    'close',
    () => {
      pending?.abort();
      dialog.remove();
      if (
        getOwner() === owner &&
        trigger?.isConnected &&
        (trigger.closest('dialog[open]') || !document.querySelector('dialog[open]'))
      ) {
        trigger.focus({ preventScroll: true });
      }
    },
    { once: true },
  );

  function screen(title) {
    heading.textContent = title;
    panel.replaceChildren();
    tell('');
    dialog.scrollTop = 0;
  }

  async function request(work, lock = false) {
    if (!live() || pending) return null;
    const controller = new AbortController();
    let timer;
    const renewTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), 15000);
    };
    renewTimeout();
    pending = controller;
    closeButton.disabled = lock;
    try {
      const data = await work(controller.signal, renewTimeout);
      return live() ? { data } : null;
    } catch (error) {
      return live() ? { error } : null;
    } finally {
      clearTimeout(timer);
      pending = null;
      closeButton.disabled = false;
    }
  }

  async function load() {
    screen(card ? 'Add to case' : 'Display cases');
    tell('Loading your display cases…');
    const result = await request(signal => listCases(client, owner, signal));
    if (!result) return;
    if (result.error) {
      const retry = button('Try again', 'link-button', load);
      panel.append(retry);
      const missing = ['42P01', 'PGRST205'].includes(result.error.code);
      tell(
        missing
          ? 'Display cases haven’t been set up for this vault yet.'
          : 'Your display cases could not be loaded. Check your connection and try again.',
      );
      retry.focus();
      return;
    }
    cases = result.data;
    showHome();
  }

  function showHome(notice = '', focusRow = null) {
    if (card) showPicker(notice);
    else showList(notice, focusRow);
  }

  function showPicker(notice) {
    screen('Add to case');
    const picker = element('fieldset', 'case-fields');
    picker.setAttribute('aria-label', 'Choose a display case');
    const top = element('div', 'case-list-intro');
    const create = button('New display case', 'gold-btn', () => edit(null));
    top.append(element('p', 'case-hint', presentCard(card).label), create);
    picker.append(top, element('p', 'case-hint case-sharing-hint', 'Anyone with the case link can view its cards.'));
    let firstAvailable;
    if (!cases.length) picker.append(element('p', 'case-list-empty', 'You haven’t created a display case yet.'));
    const list = element('ul', 'case-list case-destinations');
    for (const row of cases) {
      const item = element('li');
      const copy = element('div', 'case-destination-name');
      copy.append(element('h3', '', row.title), element('span', 'case-count', cardCount(row.card_ids.length)));
      item.append(copy);
      const included = row.card_ids.includes(card.id);
      if (included || row.card_ids.length >= MAX_CARDS) {
        item.append(element('span', 'case-availability', included ? 'Already included' : 'Case full'));
      } else {
        let change;
        const add = button('Add card', 'link-button', async () => {
          change ??= {
            id: row.id,
            title: row.title,
            card_ids: [...row.card_ids, card.id],
            expectedRevision: row.revision,
            revision: crypto.randomUUID(),
          };
          picker.disabled = true;
          tell('Adding card…');
          const result = await request(signal => saveCase(client, owner, change, signal), true);
          if (!result) return;
          picker.disabled = false;
          if (result.error) {
            if (result.error instanceof CaseConflict || result.error.code === '23514') {
              const reload = button('Reload cases', 'link-button', load);
              add.replaceWith(reload);
              tell(
                result.error instanceof CaseConflict
                  ? result.error.message
                  : 'A card in this selection is unavailable. Check the saved selection in Display cases.',
              );
              reload.focus();
            } else {
              tell('Could not add the card. Check your connection and try again.');
              add.focus();
            }
            return;
          }
          cases = cases.map(existing => (existing.id === row.id ? result.data : existing));
          showPicker('Card added to “' + row.title + '”.');
        });
        add.setAttribute('aria-label', 'Add card to ' + row.title);
        firstAvailable ??= add;
        item.append(add);
      }
      list.append(item);
    }
    if (cases.length) picker.append(list);
    panel.append(picker);
    tell(notice);
    (notice ? closeButton : firstAvailable || create).focus({ preventScroll: true });
  }

  function showList(notice = '', focusRow = null) {
    screen('Display cases');
    const top = element('div', 'case-list-intro');
    const create = button('New display case', 'gold-btn', () => edit(null));
    top.append(element('p', 'case-hint', 'Anyone with a case link can view the cards you select.'), create);
    panel.append(top);
    let focus = create;
    const list = element('ul', 'case-list');
    if (!cases.length) {
      panel.append(element('p', 'case-list-empty', 'You haven’t shared a display case yet.'));
    }
    for (const row of cases) {
      const item = element('li');
      const title = element('h3', '', row.title);
      const header = element('div', 'case-list-title');
      header.append(title, element('span', 'case-count', cardCount(row.card_ids.length) + ' selected'));
      const actions = element('div', 'case-row-actions');
      const href = caseLink(location.href, row.id);
      const open = element('a', 'link-button', 'Open case');
      open.href = href;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.setAttribute('aria-label', 'Open ' + row.title + ' in a new tab');
      const manual = element('label', 'case-field case-manual-link', 'Share link');
      const address = element('input');
      address.type = 'url';
      address.readOnly = true;
      address.value = href;
      manual.hidden = true;
      manual.append(address);
      const copy = button('Copy link', 'link-button', async () => {
        try {
          await navigator.clipboard.writeText(href);
          if (copy.isConnected) tell('Link copied for “' + row.title + '”.');
        } catch {
          if (!live() || !copy.isConnected) return;
          manual.hidden = false;
          tell('Select and copy the share link.');
          address.focus();
          address.select();
        }
      });
      const editButton = button('Edit', 'link-button', () => edit(row));
      const stop = button('Stop sharing', 'link-button danger', () => confirmStop(row));
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', 'Sharing options for ' + row.title);
      actions.append(copy, open, editButton, stop);
      item.append(header, actions, manual);
      list.append(item);
      if (focusRow === row.id) focus = copy;
    }
    if (cases.length) panel.append(list);
    tell(notice);
    focus.focus({ preventScroll: !focusRow });
  }

  async function edit(original) {
    screen(original ? 'Edit display case' : 'New display case');
    tell('Loading your vault cards…');
    const catalogue = await request((signal, renewTimeout) =>
      listPickerCards(client, owner, signal, count => {
        renewTimeout();
        tell('Loading your vault cards… ' + cardCount(count) + ' loaded.');
      }),
    );
    if (!catalogue) return;
    if (catalogue.error) {
      const actions = element('div', 'case-controls');
      const retry = button('Try again', 'gold-btn', () => edit(original));
      const back = button('Back to display cases', 'link-button', () => showHome('', original?.id));
      actions.append(retry, back);
      panel.append(actions);
      tell('Your vault cards could not be loaded. Check your connection and try again.');
      retry.focus();
      return;
    }
    if (card && !catalogue.data.some(item => item.id === card.id)) {
      screen('Add to case');
      tell('This card is no longer in your vault. Close this window and refresh the collection.');
      closeButton.focus();
      return;
    }
    tell('');
    editCase(panel, {
      cards: catalogue.data,
      original,
      initialCardId: card?.id,
      tell,
      onReload: load,
      onCancel: () => showHome('', original?.id),
      async onSave(change) {
        const result = await request(signal => saveCase(client, owner, change, signal), true);
        if (!result) return null;
        if (result.error) {
          const conflict = result.error instanceof CaseConflict;
          if (conflict) tell(result.error.message);
          else if (result.error.code === '23514')
            tell('A selected card is unavailable. Reopen the editor to refresh your card choices.');
          else tell('Could not save this case. Check your connection and try again.');
          return { conflict };
        }
        const saved = result.data;
        cases = [...cases.filter(item => item.id !== saved.id), saved].sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        );
        showHome(
          original ? 'Changes saved to the same share link.' : '“' + saved.title + '” is ready to share.',
          saved.id,
        );
        return null;
      },
    });
  }

  function confirmStop(row) {
    screen('Stop sharing this case?');
    panel.append(element('p', 'case-confirm-copy', 'The public link for “' + row.title + '” will close immediately.'));
    const actions = element('div', 'case-controls');
    const keep = button('Keep sharing', 'link-button', () => showList('', row.id));
    const reload = button('Reload display cases', 'link-button', load);
    reload.hidden = true;
    const stop = button('Stop sharing', 'case-stop', async () => {
      stop.disabled = keep.disabled = true;
      tell('Closing the share link…');
      const result = await request(signal => stopSharing(client, owner, row, signal), true);
      if (!result) return;
      if (result.error) {
        const conflict = result.error instanceof CaseConflict;
        tell(conflict ? result.error.message : 'Could not close the share link. Check your connection and try again.');
        keep.disabled = false;
        stop.disabled = conflict;
        reload.hidden = !conflict;
        (conflict ? reload : keep).focus();
        return;
      }
      cases = cases.filter(item => item.id !== row.id);
      showList('Sharing stopped for “' + row.title + '”.');
    });
    actions.append(keep, stop, reload);
    panel.append(actions);
    keep.focus();
  }

  document.body.append(dialog);
  dialog.showModal();
  void load();
  return { owner, dialog, close };
}
