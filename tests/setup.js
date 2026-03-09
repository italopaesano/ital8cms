/**
 * Jest Setup File
 * Configurazione globale per tutti i test
 */

const fs = require('fs');
const path = require('path');

// Silenzio i log durante i test (opzionale)
// process.env.LOG_LEVEL = 'ERROR';

// Timeout esteso per test di integrazione
jest.setTimeout(10000);

// ── Config safety net ────────────────────────────────────────────────────────
// I test di integrazione (httpsServer, httpsDiagnostics, hideExtension)
// modificano ital8Config.json5 e lo ripristinano in afterAll. Se un test
// crasha o il processo viene interrotto, il file resta nella versione di test.
// Questa safety net salva il contenuto originale prima di ogni test file
// e lo ripristina alla fine, prevenendo corruzioni a catena tra run successivi.
// ─────────────────────────────────────────────────────────────────────────────

const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
let savedConfigRaw = null;

beforeAll(() => {
  try {
    // Use the git-committed version as the canonical reference.
    // This prevents cascading corruption when a previous test run
    // crashed without restoring the config file.
    savedConfigRaw = execSync('git show HEAD:ital8Config.json5', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    const currentRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (currentRaw !== savedConfigRaw) {
      fs.writeFileSync(CONFIG_PATH, savedConfigRaw, 'utf8');
    }
  } catch (_) {
    // Fallback if git is unavailable: save current file contents
    try {
      savedConfigRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
    } catch (__) {
      savedConfigRaw = null;
    }
  }
});

// Helper globale per test
global.testHelpers = {
  // Aspetta un certo tempo
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Crea un plugin di test temporaneo
  createMockPlugin: (name, config = {}) => ({
    name,
    config: {
      active: 1,
      isInstalled: 1,
      weight: 0,
      dependency: {},
      nodeModuleDependency: {},
      version: '1.0.0',
      ...config
    }
  })
};

// Cleanup dopo tutti i test — ripristina config se modificata
afterAll(async () => {
  if (savedConfigRaw !== null) {
    try {
      const currentRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
      if (currentRaw !== savedConfigRaw) {
        fs.writeFileSync(CONFIG_PATH, savedConfigRaw, 'utf8');
      }
    } catch (_) {
      // Ignore restore errors
    }
  }
});
