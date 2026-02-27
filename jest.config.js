/**
 * Jest Configuration per ital8cms
 */
module.exports = {
  // Ambiente di test
  testEnvironment: 'node',

  // Pattern per trovare i test
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Cartelle da ignorare
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/' // E2E gestiti da Playwright
  ],

  // Coverage
  collectCoverageFrom: [
    'core/**/*.js',
    'plugins/**/main.js',
    '!**/node_modules/**'
  ],

  // Reporter
  verbose: true,

  // Timeout per test (10 secondi)
  testTimeout: 10000,

  // Setup file
  setupFilesAfterEnv: ['./tests/setup.js'],

  // Clear mocks tra i test
  clearMocks: true,

  // Esecuzione seriale: i test di integrazione (httpsServer, httpsDiagnostics)
  // modificano lo stesso file ital8Config.json5 e spawnano server sulle stesse porte.
  // Con maxWorkers > 1 si verificano race condition su config e EADDRINUSE sulle porte.
  maxWorkers: 1
};
