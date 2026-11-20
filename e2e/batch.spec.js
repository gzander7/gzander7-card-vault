import { fileURLToPath } from 'node:url';
import { expect, serveTesseractLocally, signIn, test } from './support/test.js';

const photo = fileURLToPath(new URL('./fixtures/card-front.jpg', import.meta.url));

test('batch scanning saves one card and skips another', async ({ page, context, backend }) => {
  test.slow();
  await serveTesseractLocally(context);
  await page.goto('./');
  await signIn(page);
  // Phones keep Batch scan in the Account menu.
  const nav = page.locator('#auth-bar');
  if (!(await nav.locator('#batch-scan-btn').isVisible())) await nav.getByRole('button', { name: 'Account' }).click();
  await nav.locator('[data-nav="batch"]:visible').first().click();
  const batch = page.getByRole('dialog', { name: 'Batch scan' });
  await batch.locator('#batch-files').setInputFiles([photo, photo]);
  await expect(batch.locator('#batch-list > li')).toHaveCount(2);
  await batch.getByRole('button', { name: 'Review 2 cards' }).click();

  const review = page.getByRole('dialog', { name: 'Review card' });
  await expect(review.locator('#batch-position')).toHaveText(/Card 1 of 2/);
  await expect(review.getByRole('button', { name: 'Save & next' })).toBeEnabled({ timeout: 30_000 });
  await review.getByLabel('Player').fill('Batch One');
  await review.getByRole('button', { name: 'Save & next' }).click();
  await expect(review.locator('#batch-position')).toHaveText(/Card 2 of 2 · 1 saved/, { timeout: 30_000 });
  await review.getByRole('button', { name: 'Skip card' }).click();

  await expect(batch).toBeVisible();
  await expect(batch.locator('#batch-outcome')).toHaveText('1 saved · 1 skipped');
  expect(backend.cards.filter(card => card.player === 'Batch One')).toHaveLength(1);
  await batch.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#card-grid')).toContainText('Batch One');
});
