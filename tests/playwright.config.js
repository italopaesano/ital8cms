// @ts-check
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const { E2E_TEST_HTTP_PORT } = require('./e2e/testConstants');

// Root del progetto (una directory sopra rispetto a questo file in tests/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Playwright configuration for ital8cms
 *
 * Usa una porta HTTP dedicata (E2E_TEST_HTTP_PORT) definita in testConstants.js.
 * Il globalSetup.js sovrascrive ital8Config.json5 con questa porta, la directory
 * www di test, i temi di test, e disabilita HTTPS — garantendo isolamento completo
 * dal server di sviluppo (che gira sulla porta 3000).
 *
 * Flusso:
 *   1. globalSetup.js modifica ital8Config.json5 (porta, wwwPath, temi, HTTPS off)
 *   2. Playwright avvia il server: `node index.js` (legge la config modificata)
 *   3. Test E2E eseguiti sulla porta dedicata
 *   4. globalTeardown.js ripristina ital8Config.json5 dall'originale
 *
 * @see https://playwright.dev/docs/test-configuration
 */

module.exports = defineConfig({
  testDir: './e2e',

  /* Global setup and teardown for test users and config override */
  globalSetup: './e2e/globalSetup.js',
  globalTeardown: './e2e/globalTeardown.js',

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
    /* Base URL — porta dedicata E2E, sempre HTTP (HTTPS disabilitato dal globalSetup) */
    baseURL: `http://localhost:${E2E_TEST_HTTP_PORT}`,

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

  /* Run your local dev server before starting the tests
   * La porta dedicata (E2E_TEST_HTTP_PORT) evita conflitti con un eventuale
   * server di sviluppo già attivo sulla porta 3000.
   * reuseExistingServer: false — forza sempre l'avvio di un server nuovo
   * per garantire che usi la config modificata dal globalSetup. */
  webServer: {
    command: 'node index.js',
    cwd: PROJECT_ROOT,
    url: `http://localhost:${E2E_TEST_HTTP_PORT}`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
