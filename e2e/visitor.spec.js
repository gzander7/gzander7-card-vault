import AxeBuilder from '@axe-core/playwright';
import { expect, seedCard, test } from './support/test.js';

const cards = [
  seedCard({ player: 'Shohei Ohtani', year: 2018, set_name: 'Topps Chrome', is_auto: true, featured: true }),
  seedCard({ player: 'Mike Trout', year: 2011, set_name: 'Topps Update', grader: 'PSA', grade: '10' }),
  seedCard({ player: 'Julio Rodriguez', year: 2022, set_name: 'Bowman', serial: '12/99' }),
];

test.use({ seed: { cards } });

test('a visitor can browse, filter and inspect the collection', async ({ page, backend }) => {
  await page.goto('./');
  const tiles = page.locator('#card-grid .gallery-tile');
  await expect(tiles).toHaveCount(3);
  await expect(page.locator('#collection-count')).toHaveText('3 cards');
  await expect(page.locator('#spotlight-body')).toContainText('Shohei Ohtani');

  // Phones reach search from the header button.
  if (!(await page.locator('#search').isVisible())) await page.locator('#mast-search').click();
  await page.locator('#search').fill('trout');
  await expect(tiles).toHaveCount(1);
  await expect(page.locator('#collection-count')).toHaveText('1 of 3 cards');
  await page.locator('#search').fill('');
  await page.locator('.gallery-chips').getByRole('button', { name: 'Graded', exact: true }).click();
  await expect(tiles).toHaveCount(1);
  await expect(tiles).toContainText('PSA 10');

  await tiles.getByRole('button', { name: /^View Mike Trout/ }).click();
  const details = page.locator('#card-detail');
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { name: 'Mike Trout' })).toBeVisible();
  // Visitors never see owner controls or private values.
  await expect(details.getByRole('button', { name: 'Edit' })).toBeHidden();
  await expect(details).not.toContainText('Your purchase');
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();

  await expect(page.locator('#vault-value')).toBeHidden();
  expect(backend.requests.some(request => /^(POST|PATCH|DELETE) .*\/rest\/v1\/(?!rpc)/.test(request))).toBe(false);
});

test('the gallery has no serious accessibility violations', async ({ page, backend: _backend }) => {
  await page.goto('./');
  await expect(page.locator('#card-grid .gallery-tile')).toHaveCount(3);
  const results = await new AxeBuilder({ page }).exclude('#backdrop').analyze();
  const serious = results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact));
  expect(serious.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map(node => node.target) }))).toEqual([]);
});

test('a wrong password shows a clear message', async ({ page, backend: _backend }) => {
  await page.goto('./');
  await page.locator('#auth-bar').getByRole('button', { name: 'Sign in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByLabel('Email').fill('owner@example.com');
  await dialog.getByLabel('Password').fill('wrong');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.locator('#auth-message')).toHaveText('The email or password is incorrect.');
});
