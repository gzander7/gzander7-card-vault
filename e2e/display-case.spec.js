import { expect, seedCard, test } from './support/test.js';

const shown = seedCard({ player: 'Case Star', year: 2015, set_name: 'Select', notes: 'Bought at a show for $400' });
const hidden = seedCard({ player: 'Not In Case' });
const caseId = '22222222-2222-4222-8222-222222222222';

test.use({
  seed: {
    cards: [shown, hidden],
    cases: [{ id: caseId, title: 'Rookie Wall', card_ids: [shown.id] }],
  },
});

test('a shared display case shows only its cards and no private notes', async ({ page, backend: _backend }) => {
  await page.goto(`case.html?id=${caseId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rookie Wall');
  const gallery = page.locator('#case-gallery');
  await expect(gallery.locator('.case-tile')).toHaveCount(1);
  await expect(gallery).toContainText('Case Star');
  await expect(page.locator('body')).not.toContainText('Not In Case');
  await expect(page.locator('body')).not.toContainText('$400');
  await gallery.getByRole('button', { name: /View photo of/ }).click();
  await expect(page.locator('#card-viewer')).toBeVisible();
});

test('an unknown display case link explains itself', async ({ page, backend: _backend }) => {
  await page.goto('case.html?id=33333333-3333-4333-8333-333333333333');
  await expect(page.locator('#case-public-status')).not.toBeEmpty();
  await expect(page.locator('#case-gallery')).toBeHidden();
});
