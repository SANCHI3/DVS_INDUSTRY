/**
 * vitest.config.ts — sets up test environment variables BEFORE any module loads.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    // The integration files import the whole app in beforeAll; with all files
    // running in parallel on a laptop that alone can take over 15 s.
    hookTimeout: 60000,
    include: ['src/__tests__/**/*.test.ts'],
    env: {
      NODE_ENV:             'test',
      PORT:                 '3001',
      DATABASE_URL:         'postgresql://test:test@localhost:5432/test_db',
      JWT_SECRET:           'test-secret-at-least-32-characters-long!!',
      JWT_EXPIRES_IN:       '15m',
      JWT_REFRESH_SECRET:   'test-refresh-secret-at-least-32-chars-long!!',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CORS_ORIGINS:         'http://localhost:5173',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/server.ts'],
    },
  },
});
