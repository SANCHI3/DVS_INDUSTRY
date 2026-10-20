import { expect, test } from '@playwright/test';
import { admin, failOnPageErrors, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  test.skip(!admin.password, 'E2E_ADMIN_PASSWORD is not set');
  failOnPageErrors(page);
  await signIn(page, admin);
  await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible();
});

// Each section is a lazily loaded page backed by its own API calls
const sections: [nav: string, heading: RegExp][] = [
  ['Production', /Production/],
  ['AI Security', /Security/],
  ['Inventory', /Inventory/],
  ['Orders & Supply', /Orders/],
  ['Reports Center', /Reports/],
  ['Smart Analytics', /Smart Analytics/],
  ['User Management', /User Management/],
  ['My Profile', /My Profile/],
];

for (const [nav, heading] of sections) {
  test(`${nav} opens without errors`, async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 500) failed.push(`${res.status()} ${res.url()}`);
    });

    await page.getByText(nav, { exact: true }).first().click();

    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(failed).toEqual([]);
  });
}
