import { expect, test } from '@playwright/test';
import { admin, expectNoTokenInStorage, failOnPageErrors, signIn, store } from './helpers';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('administrator signs in, survives a reload and signs out', async ({ page }) => {
  test.skip(!admin.password, 'E2E_ADMIN_PASSWORD is not set');

  await signIn(page, admin);
  await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible();
  await expectNoTokenInStorage(page);

  // The access token is only in memory; the refresh cookie restores it
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible();
  await expectNoTokenInStorage(page);

  await page.getByRole('button', { name: /Sign Out/ }).click();
  await expect(page.getByRole('button', { name: /access system/i }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toHaveCount(0);
});

test('a wrong password is refused with a message', async ({ page }) => {
  await signIn(page, { email: admin.email, password: 'definitely-not-the-password' });
  await expect(page.getByText('Invalid email or password')).toBeVisible();
});

test('a store user lands in Orders & Supply, without admin sections', async ({ page }) => {
  test.skip(!store.password, 'E2E_STORE_PASSWORD is not set');

  await signIn(page, store, /^Store/);
  await expect(page.getByText('Orders & Supply', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('User Management', { exact: true })).toHaveCount(0);
});
