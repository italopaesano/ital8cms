/**
 * Jest Configuration per ital8cms
 *
 * Discovery dei test:
 *  - tests/unit/**, tests/integration/**            (core del progetto)
 *  - plugins/<pluginName>/tests/**                   (test per plugin)
 *  - themes/<themeName>/tests/**                     (test per temi)
 *
 * I plugin con `active: 0` in pluginConfig.json5 e i temi con `active: 0` in
 * themeConfig.json5 vengono esclusi dalla scansione.
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../core/loadJson5');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Scansiona una directory (plugins/ o themes/) e ritorna i path assoluti
 * delle sotto-directory con flag `active: 0` nel file di config specificato.
 */
function getInactivePaths(parentDir, configFileName) {
  const absoluteParent = path.join(PROJECT_ROOT, parentDir);
  if (!fs.existsSync(absoluteParent)) return [];

  const inactive = [];
  for (const entry of fs.readdirSync(absoluteParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(absoluteParent, entry.name, configFileName);
    if (!fs.existsSync(configPath)) continue;
    try {
      const config = loadJson5(configPath);
      if (!config || config.active === 0) {
        inactive.push(`/${parentDir}/${entry.name}/`);
      }
    } catch (_err) {
      // Se il config è corrotto, non escludiamo: sarà un test fallito più chiaro
    }
  }
  return inactive;
}

const inactivePlugins = getInactivePaths('plugins', 'pluginConfig.json5');
const inactiveThemes = getInactivePaths('themes', 'themeConfig.json5');

module.exports = {
  // Root del progetto (una directory sopra rispetto a questo file in tests/)
  rootDir: '..',

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
    '/tests/e2e/', // E2E gestiti da Playwright
    ...inactivePlugins,
    ...inactiveThemes
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
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Clear mocks tra i test
  clearMocks: true,

  // Esecuzione seriale: i test di integrazione (httpsServer, httpsDiagnostics)
  // modificano lo stesso file ital8Config.json5 e spawnano server sulle stesse porte.
  // Con maxWorkers > 1 si verificano race condition su config e EADDRINUSE sulle porte.
  maxWorkers: 1
};
