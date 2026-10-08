import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite: the full user journey in a real browser.
 *
 * Several bugs of this project passed typecheck, lint and every unit test and
 * only showed on screen (viewport jumps, a replay bar pushing its buttons off
 * the window, candles without wicks). These tests drive the real UI against a
 * mocked market feed, so they are fast and never depend on Dukascopy or Yahoo.
 *
 * Files are named `*.e2e.ts` so that Vitest, which picks up `*.test.ts` and
 * `*.spec.ts`, never tries to run them.
 */
const PORT = 4173;
/** The production build, for what only exists there (the CSP, hashed assets). */
const PROD_PORT = 4174;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1470, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/*.prod.e2e.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1470, height: 860 } },
    },
    {
      name: 'production-build',
      testMatch: '**/*.prod.e2e.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1470, height: 860 }, baseURL: `http://localhost:${PROD_PORT}` },
    },
  ],
  webServer: [
    {
      // The dev server: the chart instance is exposed to the tests in DEV only.
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // In dev, Vite injects every stylesheet as a <style> tag, which a strict
      // CSP forbids by design: the policy can only be checked on the build.
      command: `npx vite build --logLevel error && npx vite preview --port ${PROD_PORT} --strictPort`,
      url: `http://localhost:${PROD_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
