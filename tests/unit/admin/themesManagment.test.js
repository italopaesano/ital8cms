/**
 * Unit Tests per plugins/admin/themesManagment.js
 *
 * Copre:
 *  - setActiveTheme(): attivazione tema pubblico/admin con validazione
 *  - Regressione bug: il file scritto deve essere ital8Config.json5 (non .json)
 *  - Preservazione commenti JSON5 dopo l'attivazione
 *  - getThemesList(), getThemeDetails()
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');

const themesManagment = require('../../../plugins/admin/themesManagment');

const PROJECT_ROOT = path.join(__dirname, '../../..');
const ITAL8_CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const ITAL8_CONFIG_PATH_JSON = path.join(PROJECT_ROOT, 'ital8Config.json');
const THEMES_DIR = path.join(PROJECT_ROOT, 'themes');

// Stub minimo di themeSys: implementa solo i metodi usati da themesManagment
function makeThemeSysStub({ validateResult, depsResult } = {}) {
  return {
    pluginSys: { fake: true },
    validateTheme: jest.fn(() => validateResult || { valid: true, error: null }),
    checkDependencies: jest.fn(() => depsResult || { satisfied: true, errors: [] }),
    getAvailableThemes: jest.fn(() => []),
    getCustomizedPlugins: jest.fn(() => []),
  };
}

describe('themesManagment', () => {
  let originalConfigRaw;

  beforeAll(() => {
    originalConfigRaw = fs.readFileSync(ITAL8_CONFIG_PATH, 'utf8');
  });

  afterEach(() => {
    // Ripristina ital8Config.json5 dopo ogni test
    fs.writeFileSync(ITAL8_CONFIG_PATH, originalConfigRaw, 'utf8');
    // Rimuove file con estensione errata se per qualche ragione viene creato
    if (fs.existsSync(ITAL8_CONFIG_PATH_JSON)) {
      fs.unlinkSync(ITAL8_CONFIG_PATH_JSON);
    }
  });

  // ─── setActiveTheme: regressione bug ENOENT ──────────────────────────────────
  describe('setActiveTheme — regressione bug ENOENT', () => {
    test('attivazione tema pubblico esistente NON lancia ENOENT su ital8Config.json', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('default', 'public', themeSys);

      expect(result.success).toBe(true);
      // Il bug fixed: prima cercava ital8Config.json (senza 5) -> ENOENT
      expect(result.error).toBeUndefined();
    });

    test('NON viene creato un file ital8Config.json (senza 5)', async () => {
      const themeSys = makeThemeSysStub();
      await themesManagment.setActiveTheme('default', 'public', themeSys);

      expect(fs.existsSync(ITAL8_CONFIG_PATH_JSON)).toBe(false);
      expect(fs.existsSync(ITAL8_CONFIG_PATH)).toBe(true);
    });

    test('il file ital8Config.json5 resta leggibile come JSON5 dopo l\'attivazione', async () => {
      const themeSys = makeThemeSysStub();
      await themesManagment.setActiveTheme('default', 'public', themeSys);

      // Non deve lanciare
      const config = loadJson5(ITAL8_CONFIG_PATH);
      expect(config.activeTheme).toBe('default');
    });
  });

  // ─── setActiveTheme: validazione parametri ──────────────────────────────────
  describe('setActiveTheme — validazione parametri', () => {
    test('errore se themeName mancante', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('', 'public', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/obbligatori/);
    });

    test('errore se themeType mancante', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('default', '', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/obbligatori/);
    });

    test('errore se themeType non è "public" né "admin"', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('default', 'foo', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/public.*admin/);
    });

    test('errore se il tema non esiste su disco', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('themeInesistente_xyz', 'public', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non esiste/);
    });

    test('errore se la struttura del tema è invalida', async () => {
      const themeSys = makeThemeSysStub({
        validateResult: { valid: false, error: 'Partial head.ejs mancante' },
      });
      const result = await themesManagment.setActiveTheme('default', 'public', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Tema non valido/);
      expect(result.error).toMatch(/head\.ejs/);
    });
  });

  // ─── setActiveTheme: tipo tema (admin vs public) ─────────────────────────────
  describe('setActiveTheme — coerenza tipo tema', () => {
    test('errore se si attiva un tema admin per il sito pubblico', async () => {
      const themeSys = makeThemeSysStub();
      // defaultAdminTheme ha isAdminTheme: true
      const result = await themesManagment.setActiveTheme('defaultAdminTheme', 'public', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/admin/i);
    });

    test('errore se si attiva un tema pubblico per il pannello admin', async () => {
      const themeSys = makeThemeSysStub();
      // default ha isAdminTheme: false
      const result = await themesManagment.setActiveTheme('default', 'admin', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/admin/i);
    });

    test('OK: tema admin attivato per il pannello admin', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('defaultAdminTheme', 'admin', themeSys);
      expect(result.success).toBe(true);

      const config = loadJson5(ITAL8_CONFIG_PATH);
      expect(config.adminActiveTheme).toBe('defaultAdminTheme');
    });

    test('OK: tema pubblico attivato per il sito pubblico', async () => {
      const themeSys = makeThemeSysStub();
      const result = await themesManagment.setActiveTheme('default', 'public', themeSys);
      expect(result.success).toBe(true);

      const config = loadJson5(ITAL8_CONFIG_PATH);
      expect(config.activeTheme).toBe('default');
    });
  });

  // ─── setActiveTheme: scrittura corretta su ital8Config.json5 ────────────────
  describe('setActiveTheme — scrittura su disco', () => {
    test('cambia activeTheme nel file ital8Config.json5', async () => {
      const before = loadJson5(ITAL8_CONFIG_PATH);
      const themeSys = makeThemeSysStub();

      const result = await themesManagment.setActiveTheme('exampleTheme', 'public', themeSys);

      expect(result.success).toBe(true);
      const after = loadJson5(ITAL8_CONFIG_PATH);
      expect(after.activeTheme).toBe('exampleTheme');
      // Tutti gli altri campi devono restare uguali
      expect(after.adminActiveTheme).toBe(before.adminActiveTheme);
      expect(after.apiPrefix).toBe(before.apiPrefix);
      expect(after.httpPort).toBe(before.httpPort);
    });

    test('cambia adminActiveTheme nel file ital8Config.json5', async () => {
      const before = loadJson5(ITAL8_CONFIG_PATH);
      const themeSys = makeThemeSysStub();

      const result = await themesManagment.setActiveTheme('defaultAdminTheme', 'admin', themeSys);

      expect(result.success).toBe(true);
      const after = loadJson5(ITAL8_CONFIG_PATH);
      expect(after.adminActiveTheme).toBe('defaultAdminTheme');
      expect(after.activeTheme).toBe(before.activeTheme);
    });

    test('previousTheme nel risultato corrisponde al valore precedente', async () => {
      const before = loadJson5(ITAL8_CONFIG_PATH);
      const themeSys = makeThemeSysStub();

      const result = await themesManagment.setActiveTheme('exampleTheme', 'public', themeSys);

      expect(result.success).toBe(true);
      expect(result.previousTheme).toBe(before.activeTheme);
    });

    test('preserva i commenti JSON5 presenti in ital8Config.json5', async () => {
      // Verifica che il file originale contenga almeno un commento
      const rawBefore = fs.readFileSync(ITAL8_CONFIG_PATH, 'utf8');
      expect(rawBefore).toMatch(/\/\//); // c'è almeno un commento

      const themeSys = makeThemeSysStub();
      await themesManagment.setActiveTheme('exampleTheme', 'public', themeSys);

      const rawAfter = fs.readFileSync(ITAL8_CONFIG_PATH, 'utf8');
      // Dopo il salvataggio i commenti devono essere ancora presenti
      expect(rawAfter).toMatch(/\/\//);
      // Header banner sui prefissi tema deve essere conservato
      if (rawBefore.includes('HTTPS CONFIGURATION')) {
        expect(rawAfter).toContain('HTTPS CONFIGURATION');
      }
    });
  });

  // ─── setActiveTheme: dipendenze ─────────────────────────────────────────────
  describe('setActiveTheme — dipendenze plugin', () => {
    test('dipendenze non soddisfatte producono warning ma non bloccano', async () => {
      const themeSys = makeThemeSysStub({
        depsResult: { satisfied: false, errors: ['Plugin bootstrap non attivo'] },
      });

      const result = await themesManagment.setActiveTheme('default', 'public', themeSys);

      expect(result.success).toBe(true);
      expect(result.dependenciesWarning).toMatch(/bootstrap/);
    });
  });

  // ─── getThemesList ───────────────────────────────────────────────────────────
  describe('getThemesList', () => {
    test('ritorna tutti i temi presenti nella directory themes/', () => {
      // Per questo test usiamo lo stub di themeSys che ritorna l'elenco reale via fs
      const realThemes = fs.readdirSync(THEMES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, valid: true, error: null, isActive: false, isAdminActive: false }));

      const themeSys = {
        ...makeThemeSysStub(),
        getAvailableThemes: jest.fn(() => realThemes),
      };

      const list = themesManagment.getThemesList(themeSys);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(realThemes.length);
      const names = list.map(t => t.name);
      expect(names).toContain('default');
      expect(names).toContain('defaultAdminTheme');
    });

    test('per ogni tema include i campi isAdminTheme e config caricati da themeConfig.json5', () => {
      const themeSys = {
        ...makeThemeSysStub(),
        getAvailableThemes: jest.fn(() => [
          { name: 'default', valid: true, error: null, isActive: false, isAdminActive: false },
          { name: 'defaultAdminTheme', valid: true, error: null, isActive: false, isAdminActive: false },
        ]),
      };

      const list = themesManagment.getThemesList(themeSys);
      const defaultTheme = list.find(t => t.name === 'default');
      const adminTheme = list.find(t => t.name === 'defaultAdminTheme');

      expect(defaultTheme.isAdminTheme).toBe(false);
      expect(adminTheme.isAdminTheme).toBe(true);
      expect(defaultTheme.config).toBeDefined();
      expect(adminTheme.config).toBeDefined();
    });
  });

  // ─── themeConfig.json5 bundled: isInstalled e assenza di active ─────────────
  // Il campo 'active' è stato RIMOSSO dallo schema dei temi
  // (docs/decisions/theme-active-isinstalled.it.md): la fonte di verità del tema
  // attivo è solo ital8Config.json5 (activeTheme / adminActiveTheme).
  describe('themeConfig.json5 bundled: isInstalled e assenza di active', () => {
    function listBundledThemes() {
      return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    }

    test('nessun tema bundled ha più il campo active (rimosso dallo schema)', () => {
      for (const themeName of listBundledThemes()) {
        const cfgPath = path.join(THEMES_DIR, themeName, 'themeConfig.json5');
        if (!fs.existsSync(cfgPath)) continue;
        const cfg = loadJson5(cfgPath);
        expect(cfg.active).toBeUndefined();
      }
    });

    test('tutti i temi bundled hanno isInstalled: 1 (sono installati per definizione)', () => {
      for (const themeName of listBundledThemes()) {
        const cfgPath = path.join(THEMES_DIR, themeName, 'themeConfig.json5');
        if (!fs.existsSync(cfgPath)) continue;
        const cfg = loadJson5(cfgPath);
        expect(cfg.isInstalled).toBe(1);
      }
    });
  });

  // ─── getThemeDetails ────────────────────────────────────────────────────────
  describe('getThemeDetails', () => {
    test('ritorna error per tema inesistente', () => {
      const themeSys = makeThemeSysStub();
      const result = themesManagment.getThemeDetails('themeInesistente_xyz', themeSys);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non esiste/);
    });

    test('ritorna dettagli completi per il tema default', () => {
      const themeSys = makeThemeSysStub();
      const result = themesManagment.getThemeDetails('default', themeSys);

      expect(result.success).toBe(true);
      expect(result.theme.name).toBe('default');
      expect(result.theme.config).toBeDefined();
      expect(result.theme.isAdminTheme).toBe(false);
      expect(result.theme.files.views).toContain('head.ejs');
    });

    test('legge correttamente ital8Config.json5 per determinare status active', () => {
      // Il bug fixed riguardava setActiveTheme ma getThemeDetails leggeva già il
      // path giusto: verifichiamo come safety net che non si introduca regressione.
      const themeSys = makeThemeSysStub();
      const config = loadJson5(ITAL8_CONFIG_PATH);
      const result = themesManagment.getThemeDetails(config.activeTheme, themeSys);

      expect(result.success).toBe(true);
      expect(result.theme.status.isActivePublic).toBe(true);
    });
  });
});
