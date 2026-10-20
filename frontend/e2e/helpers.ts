import { expect, type Page } from '@playwright/test';

export const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@dvsindustry.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};

export const store = {
  email: process.env.E2E_STORE_EMAIL ?? 'store.test@dvsindustry.local',
  password: process.env.E2E_STORE_PASSWORD ?? '',
};

/** Fails the test on any uncaught error in the page. */
export function failOnPageErrors(page: Page): void {
  page.on('pageerror', (err) => {
    throw err;
  });
}

export async function signIn(page: Page, who: { email: string; password: string }, portal = /Administrator/) {
  await page.goto('/');
  await page.getByRole('button', { name: /access system/i }).first().click();
  await page.getByRole('button', { name: portal }).first().click();
  await page.getByPlaceholder('Enter your email').fill(who.email);
  await page.getByPlaceholder('Enter password').fill(who.password);
  // The mode tab and the submit button are both labelled "Sign In"
  await page.getByRole('button', { name: /Sign In/ }).last().click();
}

export async function expectNoTokenInStorage(page: Page): Promise<void> {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  // JWTs start with "eyJ" (base64 of '{"')
  expect(stored).not.toContain('eyJ');
}
