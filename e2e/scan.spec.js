import { fileURLToPath } from 'node:url';
import { expect, serveTesseractLocally, signIn, test } from './support/test.js';

const photo = fileURLToPath(new URL('./fixtures/card-front.jpg', import.meta.url));

test('reading both sides runs the on-device text reader to completion', async ({
  page,
  context,
  backend: _backend,
}) => {
  test.slow();
  await serveTesseractLocally(context);
  await page.goto('./');
  await signIn(page);
  await page.getByRole('button', { name: 'Add card' }).click();
  const editor = page.getByRole('dialog', { name: 'Add card' });
  await editor.locator('#card-image').setInputFiles(photo);
  await editor.locator('#card-back-image').setInputFiles(photo);
  const status = editor.locator('#scan-status');
  await expect(status).toHaveText(/Loading the text reader|Reading the card/, { timeout: 15_000 });
  await expect(status).not.toHaveText(/Loading the text reader|Reading the card|could not start/, { timeout: 90_000 });
  // The reader finished and reported a result rather than a startup or photo error.
  await expect(status).toHaveText(/Filled \d+ fields?|Scan complete|No fields could be read confidently/);
});
