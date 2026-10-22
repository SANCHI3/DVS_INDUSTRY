import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the built frontend and the real API on a real database.
 *
 * Needs PostgreSQL with migrations applied and the seed run, plus the
 * credentials below. Locally:  npm run build && npm run test:e2e
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   (the seeded administrator)
 *   E2E_STORE_EMAIL / E2E_STORE_PASSWORD   (optional: the seeded store user)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm --prefix ../backend run dev',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // vite preview proxies /api and /uploads to the API, like Vercel does
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
