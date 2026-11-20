import { fileURLToPath } from 'node:url';
import { expect, OWNER, seedCard, signIn, test } from './support/test.js';

const photo = fileURLToPath(new URL('./fixtures/card-front.jpg', import.meta.url));

test.use({ seed: { cards: [seedCard({ player: 'Existing Card', year: 2019 })] } });

const addCardButton = page => page.locator('#auth-bar [data-nav="add"]:visible').first();

async function openDetails(page, name) {
  await page
    .locator('#card-grid')
    .getByRole('button', { name: new RegExp('^View ' + name) })
    .click();
  const details = page.locator('#card-detail');
  await expect(details).toBeVisible();
  return details;
}

test('the owner can add, edit and delete a card, with undo', async ({ page, backend }) => {
  await page.clock.install();
  await page.goto('./');
  await signIn(page);

  await addCardButton(page).click();
  const editor = page.getByRole('dialog', { name: 'Add card' });
  await editor.locator('#card-image').setInputFiles(photo);
  await expect(editor.locator('#photo-preview')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save card' })).toBeEnabled();
  await editor.getByLabel('Player').fill('Rookie Phenom');
  await editor.getByLabel('Year').fill('2023');
  await editor.getByLabel('Set').fill('Prizm');
  await editor.getByRole('button', { name: 'Save card' }).click();
  await expect(page.locator('#status')).toHaveText(/Added Rookie Phenom/);
  await expect(editor).toBeHidden();

  const added = backend.cards.find(card => card.player === 'Rookie Phenom');
  expect(added).toMatchObject({ owner: OWNER.id, year: 2023, set_name: 'Prizm' });
  expect(backend.objects.has(added.image_path)).toBe(true);
  expect(added.image_path.startsWith(OWNER.id + '/')).toBe(true);

  let details = await openDetails(page, 'Rookie Phenom');
  await details.getByRole('button', { name: /^Edit/ }).click();
  const edit = page.getByRole('dialog', { name: 'Edit card' });
  await edit.getByLabel('Grader').fill('PSA');
  await edit.getByLabel('Grade', { exact: true }).fill('10');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#status')).toHaveText(/Updated Rookie Phenom/);
  expect(backend.cards.find(card => card.id === added.id)).toMatchObject({ grader: 'PSA', grade: '10' });
  if (await details.isVisible()) await page.keyboard.press('Escape');
  await expect(page.locator('#card-grid .gallery-tile', { hasText: 'Rookie Phenom' })).toContainText('PSA 10');

  // Undo keeps the card.
  details = await openDetails(page, 'Rookie Phenom');
  await details.getByRole('button', { name: 'More card actions' }).click();
  await details.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('button', { name: 'Undo deletion of Rookie Phenom' }).click();
  await expect(page.locator('#status')).toHaveText(/Kept Rookie Phenom/);
  await page.clock.fastForward(11_000);
  expect(backend.cards.some(card => card.id === added.id)).toBe(true);

  // Without undo, the card and its photos are removed after ten seconds.
  details = await openDetails(page, 'Rookie Phenom');
  await details.getByRole('button', { name: 'More card actions' }).click();
  await details.getByRole('button', { name: 'Delete card' }).click();
  await expect(page.locator('#card-grid .gallery-tile', { hasText: 'Rookie Phenom' })).toHaveCount(0);
  await page.clock.fastForward(11_000);
  await expect(page.locator('#status')).toHaveText(/Deleted Rookie Phenom/);
  expect(backend.cards.some(card => card.id === added.id)).toBe(false);
  expect(backend.objects.has(added.image_path)).toBe(false);
});

test('saving requires a photo', async ({ page, backend: _backend }) => {
  await page.goto('./');
  await signIn(page);
  await addCardButton(page).click();
  const editor = page.getByRole('dialog', { name: 'Add card' });
  await editor.getByLabel('Player').fill('No Photo');
  await editor.getByRole('button', { name: 'Save card' }).click();
  await expect(editor.locator('#card-form-error')).toHaveText('Add a photo of the card.');
});

test('signing out hides owner controls and values', async ({ page, backend: _backend }) => {
  await page.goto('./');
  await signIn(page);
  await expect(addCardButton(page)).toBeVisible();
  await page.locator('#auth-bar').getByRole('button', { name: 'Account' }).click();
  await page.locator('#auth-bar').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#auth-bar').getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#auth-bar [data-nav="add"]')).toHaveCount(0);
  await expect(page.locator('#vault-value')).toBeHidden();
});
