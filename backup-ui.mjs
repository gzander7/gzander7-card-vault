import { backupVaultPrices } from './pricing-client.js';
import { buildVaultExport, exportFilename, vaultExportCsv } from './backup.mjs';

function download(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Wires the "Back up your vault" buttons in the expanded Vault Value panel.
 * @param {object} deps
 * @param {() => any} deps.getSession
 * @param {() => any[] | null} deps.getOwnedCards the owner's cards, or null while the collection is loading
 * @param {{ load: (force?: boolean) => Promise<void>, records: Record<string, any>, status: string }} deps.purchases
 * @param {(path: string) => { front: string, back: string }} deps.photoUrls
 */
export function bindVaultBackup({ getSession, getOwnedCards, purchases, photoUrls }) {
  const status = document.getElementById('backup-status');
  const buttons = [document.getElementById('backup-json'), document.getElementById('backup-csv')];
  let running = false;

  async function backup(kind) {
    if (running) return;
    const session = getSession();
    const cards = getOwnedCards();
    if (!session?.user?.id || !cards) {
      status.textContent = 'Wait for your collection to finish loading, then try again.';
      return;
    }
    running = true;
    buttons.forEach(button => (button.disabled = true));
    status.textContent = 'Preparing your download…';
    try {
      // An incomplete backup is worse than none: stop if private records are unavailable.
      try {
        await purchases.load();
      } catch {}
      if (purchases.status !== 'ready') throw new Error('Purchases could not be loaded.');
      const prices = await backupVaultPrices(session, cards);
      if (getSession()?.user?.id !== session.user.id) return;
      const data = buildVaultExport({
        cards,
        purchases: purchases.records,
        prices,
        owner: { id: session.user.id, email: session.user.email },
        photoUrls,
      });
      if (kind === 'csv') download(vaultExportCsv(data), 'text/csv;charset=utf-8', exportFilename('csv'));
      else download(JSON.stringify(data, null, 2) + '\n', 'application/json', exportFilename('json'));
      status.textContent = `Downloaded ${data.cards.length} ${data.cards.length === 1 ? 'card' : 'cards'}.`;
    } catch (error) {
      status.textContent = `${error?.message || 'The download could not be prepared.'} Check the connection and try again.`;
    } finally {
      running = false;
      buttons.forEach(button => (button.disabled = false));
    }
  }

  buttons[0].addEventListener('click', () => backup('json'));
  buttons[1].addEventListener('click', () => backup('csv'));
}
