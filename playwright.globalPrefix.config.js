// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const { GLOBAL_PREFIX_TEST } = require('./tests/e2e/testConstants');

/**
 * Playwright configuration for globalPrefix E2E tests
 *
 * Runs globalPrefix.spec.js with a non-empty globalPrefix ("/testprefix")
 * on a dedicated port (19300) to avoid conflicts with the default server.
 *
 * Flow:
 *   1. globalPrefixSetup.js modifies ital8Config.json5 (prefix + port + disables HTTPS)
 *   2. Playwright starts the server (reads modified config)
 *   3. globalPrefix.spec.js runs — all paths computed dynamically from config
 *   4. globalPrefixTeardown.js restores original ital8Config.json5
 *
 * @see https://playwright.dev/docs/test-configuration
 */

const { httpPort, prefix } = GLOBAL_PREFIX_TEST;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'globalPrefix.spec.js',

  /* Dedicated setup/teardown for globalPrefix testing */
  globalSetup: './tests/e2e/globalPrefixSetup.js',
  globalTeardown: './tests/e2e/globalPrefixTeardown.js',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL — dedicated port for prefix testing */
    baseURL: `http://localhost:${httpPort}`,

    /* Accept self-signed certificates (development) */
    ignoreHTTPSErrors: true,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Single project: chromium with globalPrefix */
  projects: [
    {
      name: 'chromium-globalPrefix',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start server with modified config (globalPrefixSetup.js runs BEFORE this) */
  webServer: {
    command: 'node index.js',
    url: `http://localhost:${httpPort}${prefix}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
