import { expect, seedCard, signIn, test } from './support/test.js';

test.use({
  seed: {
    cards: [
      seedCard({
        player: 'CeeDee Lamb',
        year: 2025,
        set_name: 'Topps Chrome',
        card_number: '76',
        parallel: 'Orange Leather',
        serial: '22/25',
      }),
      seedCard({
        player: 'Ashton Jeanty',
        year: 2025,
        set_name: 'Resurgence',
        card_number: '149',
        parallel: 'Sliver',
        is_auto: true,
      }),
    ],
  },
});

test('a numbered card opens eBay sold results for any copy, keeping the vault open to add a sale', async ({
  page,
  context,
  backend: _backend,
}) => {
  await context.route('https://www.ebay.com/sch/i.html?*', route =>
    route.fulfill({ contentType: 'text/html', body: 'Sold results' }),
  );
  await page.goto('./');
  await signIn(page);
  await page
    .locator('#card-grid')
    .getByRole('button', { name: /^View CeeDee Lamb/ })
    .click();
  const detail = page.getByRole('dialog', { name: 'CeeDee Lamb' });
  const find = detail.getByRole('link', { name: /Find sold comps/ });
  const add = detail.getByRole('button', { name: 'Add a sale' });
  await expect(find).toBeVisible();
  await find.scrollIntoViewIfNeeded();
  await expect(find).toBeInViewport({ ratio: 1 });
  await expect(add).toBeInViewport({ ratio: 1 });

  const opened = page.waitForEvent('popup');
  await find.click();
  const results = await opened;
  await results.waitForURL('https://www.ebay.com/sch/i.html?*');
  const url = new URL(results.url());
  expect(url.searchParams.get('_nkw')).toBe('2025 Topps Chrome CeeDee Lamb Orange Leather /25');
  expect(url.searchParams.get('LH_Sold')).toBe('1');
  expect(url.searchParams.get('LH_Complete')).toBe('1');
  await results.close();
  await add.click();
  const form = page.getByRole('dialog', { name: 'Add sold comp' });
  await expect(form.getByLabel('Sale link')).toHaveValue('');
  await expect(form.getByLabel('Count as an exact match')).not.toBeChecked();
});

test('the owner can still search for an autograph after recording enough sales to price it', async ({
  page,
  backend: _backend,
}) => {
  await page.goto('./');
  await signIn(page);
  await page
    .locator('#card-grid')
    .getByRole('button', { name: /^View Ashton Jeanty/ })
    .click();
  const detail = page.getByRole('dialog', { name: 'Ashton Jeanty' });
  const today = new Date().toISOString().slice(0, 10);
  for (const [item, price] of [
    ['111111111111', '20'],
    ['222222222222', '30'],
  ]) {
    await detail.getByRole('button', { name: 'Add a sale' }).click();
    const form = page.getByRole('dialog', { name: 'Add sold comp' });
    await form.getByLabel('Sale link').fill('https://www.ebay.com/itm/' + item);
    await form.getByLabel('Sold price (USD)').fill(price);
    await form.getByLabel('Sale date').fill(today);
    await form.getByLabel('Count as an exact match').check();
    await form.getByRole('button', { name: 'Save sale' }).click();
    await expect(form).toBeHidden();
  }
  await expect(detail.locator('.estimate-amount')).toHaveText('$25');
  const find = detail.getByRole('link', { name: /Find sold comps/ });
  await expect(find).toBeVisible();
  const url = new URL(await find.getAttribute('href'));
  expect(url.searchParams.get('_nkw')).toBe('2025 Resurgence Ashton Jeanty 149 auto');
});
