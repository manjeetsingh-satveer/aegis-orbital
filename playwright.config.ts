import { defineConfig, devices } from '@playwright/test'

const PORT = 3210
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * E2E runs against a production build.
 *
 * Dev mode re-evaluates modules per request, which changes real behaviour —
 * the API rate limiter appears inert under `next dev` and works correctly under
 * `next start`. Testing the built output is the only way these assertions mean
 * anything.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /*
   * Project order is load-bearing.
   *
   * Projects run in declaration order, and the rate limiter keys on client IP —
   * so the burst test in zz-rate-limit.spec.ts must be the last thing the whole
   * run does. Mobile is declared first (UI specs only, since API and header
   * assertions are viewport-independent), leaving the desktop project — which
   * ends alphabetically on zz-rate-limit — to exhaust the quota once nothing
   * else needs it.
   */
  projects: [
    {
      name: 'mobile',
      testMatch: /console\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    // Full suite: UI, API contract, security headers, rate limiting.
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
