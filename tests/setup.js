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

const loadJson5 = require('../core/loadJson5');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CONFIG_DEFAULT_PATH = path.join(PROJECT_ROOT, 'ital8Config.default.json5');
let savedConfigRaw = null;

beforeAll(() => {
  // ital8Config.json5 è un config VIVO git-ignored (materializzato dal globalSetup
  // dal suo .default). Snapshotta il vivo per poterlo ripristinare in afterAll,
  // così le mutazioni dei test di integrazione (httpsServer/hideExtension/...) non
  // persistono tra le suite.
  // Nota (config-lifecycle): il riferimento canonico NON è più `git show HEAD`
  // (il file è untracked) ma il `.default` committato, usato come recovery se il
  // vivo manca o è corrotto (run precedente crashato senza ripristino).
  try {
    const currentRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
    loadJson5(CONFIG_PATH); // valida: se non parsa come JSON5 → catch (recovery dal default)
    savedConfigRaw = currentRaw;
  } catch (_) {
    try {
      savedConfigRaw = fs.readFileSync(CONFIG_DEFAULT_PATH, 'utf8');
      fs.writeFileSync(CONFIG_PATH, savedConfigRaw, 'utf8');
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
