// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const loadJson5 = require('./core/loadJson5');
const path = require('path');

/**
 * Playwright configuration for ital8cms
 *
 * Reads ital8Config.json5 to determine the correct baseURL:
 * - If HTTPS is enabled with AutoRedirect: uses https://localhost:{httpsPort}
 *   (HTTP port only serves 301 redirects, not the app)
 * - Otherwise: uses http://localhost:{httpPort}
 *
 * @see https://playwright.dev/docs/test-configuration
 */

const ital8Conf = loadJson5(path.join(__dirname, 'ital8Config.json5'));
const httpPort = ital8Conf.httpPort || 3000;
const httpsEnabled = !!ital8Conf.https?.enabled;
const httpsPort = ital8Conf.https?.port || 3443;
const autoRedirect = !!ital8Conf.https?.AutoRedirectHttpPortToHttpsPort;

// When HTTPS is enabled with AutoRedirect, HTTP port only serves 301 redirects.
// Tests must connect directly to HTTPS to get application-level responses.
const useHttps = httpsEnabled && autoRedirect;
const baseURL = useHttps
  ? `https://localhost:${httpsPort}`
  : `http://localhost:${httpPort}`;

module.exports = defineConfig({
  testDir: './tests/e2e',

  /* Global setup and teardown for test users */
  globalSetup: './tests/e2e/globalSetup.js',
  globalTeardown: './tests/e2e/globalTeardown.js',

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
    /* Base URL — dynamic based on HTTPS configuration */
    baseURL,

    /* Accept self-signed certificates (development) */
    ignoreHTTPSErrors: true,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test on Firefox and Safari
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'node index.js',
    url: `http://localhost:${httpPort}`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
