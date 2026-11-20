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

  // A single online visit must be enough: no second online load before going offline.
  await expect(page.locator('#card-grid')).toContainText('Offline Hero');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('card-vault-site-v1');
        const cached = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
        return ['app.js', 'vendor/supabase-js.mjs', 'collection.css'].every(file =>
          [...cached].some(path => path.endsWith('/' + file)),
        );
      }),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  // The app's own code and styles load: the gallery renders and its stylesheet applies.
  await expect(page.locator('#auth-bar').getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await context.setOffline(false);
});

test("cleanup removes only the vault's own outdated caches", async ({ page, backend: _backend }) => {
  // Other GitHub Pages sites under the same account share this origin and its caches.
  await page.goto('favicon.svg');
  await page.evaluate(async () => {
    await (await caches.open('another-pages-site')).put('/another-site/', new Response('theirs'));
    await (await caches.open('card-vault-site-v0')).put('/old/', new Response('stale'));
  });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('card-vault-site-v0');
  expect(await page.evaluate(() => caches.keys())).toContain('another-pages-site');
});
