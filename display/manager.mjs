import { caseLink, cardCount } from './cards.mjs';
import { element, button } from './dom.mjs';
import { editCase } from './editor.mjs';
import { listCases, listPickerCards, saveCase, stopSharing, CaseConflict } from './store.mjs';

export function createDisplayCases({ client, getOwner }) {
  let manager;
  function close() {
    manager?.close();
    manager = null;
  }
  function open(trigger) {
    const owner = getOwner();
    if (manager?.dialog.open && manager.owner === owner) return;
    close();
    if (owner) manager = openManager({ client, owner, getOwner }, trigger || document.activeElement);
  }
  return { open, close };
}

function openManager({ client, owner, getOwner }, trigger) {
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
  const tell = message => { if (live()) status.textContent = message; };

  function close() {
    pending?.abort();
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    if (closeButton.disabled) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    pending?.abort();
    dialog.remove();
    if (getOwner() === owner && trigger?.isConnected && !document.querySelector('dialog[open]')) {
      trigger.focus({ preventScroll: true });
    }
  }, { once: true });

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
    screen('Display cases');
    tell('Loading your display cases…');
    const result = await request(signal => listCases(client, owner, signal));
    if (!result) return;
    if (result.error) {
      const retry = button('Try again', 'link-button', load);
      panel.append(retry);
      const missing = ['42P01', 'PGRST205'].includes(result.error.code);
      tell(missing ? 'Display cases haven’t been set up for this vault yet.'
        : 'Your display cases could not be loaded. Check your connection and try again.');
      retry.focus();
      return;
    }
    cases = result.data;
    showList();
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
    const catalogue = await request((signal, renewTimeout) => listPickerCards(client, owner, signal, count => {
      renewTimeout();
      tell('Loading your vault cards… ' + cardCount(count) + ' loaded.');
    }));
    if (!catalogue) return;
    if (catalogue.error) {
      const actions = element('div', 'case-controls');
      const retry = button('Try again', 'gold-btn', () => edit(original));
      const back = button('Back to display cases', 'link-button', () => showList('', original?.id));
      actions.append(retry, back);
      panel.append(actions);
      tell('Your vault cards could not be loaded. Check your connection and try again.');
      retry.focus();
      return;
    }
    tell('');
    editCase(panel, {
      cards: catalogue.data, original, tell, onReload: load,
      onCancel: () => showList('', original?.id),
      async onSave(change) {
        const result = await request(signal => saveCase(client, owner, change, signal), true);
        if (!result) return null;
        if (result.error) {
          const conflict = result.error instanceof CaseConflict;
          if (conflict) tell(result.error.message);
          else if (result.error.code === '23514') tell('A selected card is unavailable. Reopen the editor to refresh your card choices.');
          else tell('Could not save this case. Check your connection and try again.');
          return { conflict };
        }
        const saved = result.data;
        cases = [...cases.filter(item => item.id !== saved.id), saved]
          .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
        showList(original ? 'Changes saved to the same share link.' : '“' + saved.title + '” is ready to share.', saved.id);
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
