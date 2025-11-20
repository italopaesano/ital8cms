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
  clearMocks: true
};
