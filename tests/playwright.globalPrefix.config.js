// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const { GLOBAL_PREFIX_TEST } = require('./e2e/testConstants');

// Root del progetto (una directory sopra rispetto a questo file in tests/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
  testDir: './e2e',
  testMatch: 'globalPrefix.spec.js',

  /* Il setup è invocato dal launcher del webServer (E2E_MODE=prefix), NON da
   * globalSetup: Playwright attende l'url del webServer prima di globalSetup,
   * quindi la config va applicata prima del boot. Vedi tests/e2e/startWebServer.js. */
  globalTeardown: './e2e/globalPrefixTeardown.js',

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

  /* Il launcher applica la config di test (E2E_MODE=prefix) PRIMA di avviare il
   * server, così l'url col prefix è disponibile quando Playwright lo attende. */
  webServer: {
    command: 'node tests/e2e/startWebServer.js',
    env: { E2E_MODE: 'prefix' },
    cwd: PROJECT_ROOT,
    url: `http://localhost:${httpPort}${prefix}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
