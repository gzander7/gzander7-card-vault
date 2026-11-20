import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installFakeSupabase, OWNER } from './fake-supabase.js';

export { expect, OWNER };
export { seedCard } from './fake-supabase.js';

// `backend` seeds the fake Supabase before the page loads. Tests that need
// specific data call `useBackend({ cards })` before their first navigation.
export const test = base.extend({
  seed: [{}, { option: true }],
  backend: async ({ context, seed }, use) => {
    const errors = [];
    context.on('weberror', error => errors.push(error.error().message));
    // A blocked script, image or request is a broken feature even when the page copes.
    context.on('console', message => {
      if (/Content Security Policy/i.test(message.text())) errors.push(message.text());
    });
    const backend = await installFakeSupabase(context, seed);
    backend.pageErrors = errors;
    await use(backend);
    expect(errors, 'uncaught page errors and CSP violations').toEqual([]);
  },
});

export async function signIn(page) {
  await page.locator('#auth-bar').getByRole('button', { name: 'Sign in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByLabel('Email').fill(OWNER.email);
  await dialog.getByLabel('Password').fill(OWNER.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
}

const modules = fileURLToPath(new URL('../../node_modules/', import.meta.url));

// Serve the pinned Tesseract core and English model from node_modules instead of jsDelivr.
export async function serveTesseractLocally(context) {
  await context.route('https://cdn.jsdelivr.net/npm/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/npm\//, '').replace(/@[\d.]+(?=\/|$)/, '');
    return route.fulfill({ path: modules + path });
  });
}
