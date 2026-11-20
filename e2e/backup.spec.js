import { readFile } from 'node:fs/promises';
import { expect, OWNER, seedCard, signIn, test } from './support/test.js';

test.use({
  seed: {
    cards: [
      seedCard({ player: 'Backup One', year: 2020, set_name: 'Prizm, Silver' }),
      seedCard({ player: 'Backup Two', grader: 'PSA', grade: '9' }),
      seedCard({ player: 'Someone Else', owner: '99999999-9999-4999-8999-999999999999' }),
    ],
  },
});

test('the owner can download a JSON backup and a CSV of their own cards', async ({ page, backend: _backend }) => {
  await page.goto('./');
  await signIn(page);
  await page.locator('#auth-bar [data-nav="value"]').click();
  const section = page.locator('#vault-value');
  const backup = section.getByRole('region', { name: 'Back up your vault' });
  await expect(backup).toBeVisible();

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    backup.getByRole('button', { name: 'Download backup (JSON)' }).click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^card-vault-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'));
  expect(data).toMatchObject({ format: 'card-vault-export', version: 1, owner: { id: OWNER.id } });
  expect(data.cards.map(card => card.player).sort()).toEqual(['Backup One', 'Backup Two']);
  expect(data.cards[0].photos.front).toMatch(/\/storage\/v1\/object\/public\/card-images\//);
  await expect(backup.locator('#backup-status')).toHaveText('Downloaded 2 cards.');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    backup.getByRole('button', { name: 'Download spreadsheet (CSV)' }).click(),
  ]);
  const csv = await readFile(await csvDownload.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toContain('Player,Year,Set,Card number');
  expect(csv).toContain('"Prizm, Silver"');
  expect(csv).not.toContain('Someone Else');
});
