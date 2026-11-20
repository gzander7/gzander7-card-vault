import { expect, seedCard, test } from './support/test.js';

test.use({ serviceWorkers: 'allow', seed: { cards: [seedCard({ player: 'Offline Hero' })] } });

test('the vault is installable and opens offline after a visit', async ({ page, context, backend: _backend }) => {
  await page.goto('./');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await page.request.get(manifest);
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data).toMatchObject({ display: 'standalone', start_url: './' });
  for (const icon of data.icons) expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator('#card-grid')).toContainText('Offline Hero');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Card Vault' })).toBeVisible();
  await context.setOffline(false);
});
