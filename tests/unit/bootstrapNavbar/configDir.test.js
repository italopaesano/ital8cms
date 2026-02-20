/**
 * Unit Tests per bootstrapNavbar - configDir feature
 *
 * Testa il parametro configDir nel render() di navbarRenderer.js
 * che permette di cercare il file di configurazione navbar in una
 * directory diversa da quella del template chiamante.
 */

const path = require('path');
const fs = require('fs');

// Mock loadJson5 prima di importare il modulo
jest.mock('../../../core/loadJson5', () => jest.fn());
const loadJson5 = require('../../../core/loadJson5');

const navbarRenderer = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');

// ─── Costanti di test ─────────────────────────────────────────────────────────

const PROJECT_ROOT = '/home/user/ital8cms';
const SERVING_PATHS = {
  wwwPath: '/www',
  pluginPagesPath: '/pluginPages',
  adminPagesPath: '/core/admin/webPages',
};
const SERVING_CONFIG = { projectRoot: PROJECT_ROOT, servingPaths: SERVING_PATHS };

// Configurazione navbar minima valida
const VALID_NAVBAR_CONFIG = {
  settings: { type: 'horizontal', colorScheme: 'dark', bgClass: 'bg-primary' },
  sections: {
    left: [{ label: 'Home', href: '/' }],
    right: [],
  },
};

/**
 * Helper per creare un passData di test
 */
function createPassData(filePath) {
  return {
    filePath,
    href: 'http://localhost:3000/',
    ctx: { session: {} },
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('bootstrapNavbar configDir', () => {
  let cache;
  let warnSpy;
  let logSpy;

  beforeEach(() => {
    cache = new Map();
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Default: file esiste e contiene config valida
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    loadJson5.mockReturnValue(VALID_NAVBAR_CONFIG);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    jest.restoreAllMocks();
  });

  // ─── Comportamento default (senza configDir) ─────────────────────────────

  describe('senza configDir (comportamento default)', () => {
    test('cerca il file nella directory del template', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'main' },
        passData,
        true, // debug mode
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
      expect(result).not.toBe('');
    });

    test('funziona senza servingConfig quando configDir non specificato', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'main' },
        passData,
        true,
        cache
        // servingConfig omesso
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
      expect(result).not.toBe('');
    });
  });

  // ─── configDir nel contesto www ───────────────────────────────────────────

  describe('configDir nel contesto www', () => {
    test('configDir: "/" cerca nella root di www', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/deep/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/navbar.main.json5`
      );
    });

    test('configDir: "/shared" cerca in www/shared/', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/shared/navbar.main.json5`
      );
    });

    test('configDir senza "/" iniziale equivale a con "/"', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      // Con /
      navbarRenderer.render(
        { name: 'nav1', configDir: '/shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      // Senza /
      navbarRenderer.render(
        { name: 'nav1', configDir: 'shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      // Entrambi devono cercare nello stesso path
      const calls = fs.existsSync.mock.calls.map(c => c[0]);
      const expectedPath = `${PROJECT_ROOT}/www/shared/navbar.nav1.json5`;
      expect(calls.filter(c => c === expectedPath)).toHaveLength(2);
    });

    test('configDir con sottocartella annidata', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/index.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/navbars/global' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/navbars/global/navbar.main.json5`
      );
    });
  });

  // ─── configDir nel contesto pluginPages ───────────────────────────────────

  describe('configDir nel contesto pluginPages', () => {
    test('configDir: "/" cerca nella root del plugin', () => {
      const passData = createPassData(`${PROJECT_ROOT}/pluginPages/myPlugin/subdir/page.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/pluginPages/myPlugin/navbar.main.json5`
      );
    });

    test('configDir isola tra plugin diversi', () => {
      const passDataA = createPassData(`${PROJECT_ROOT}/pluginPages/pluginA/page.ejs`);
      const passDataB = createPassData(`${PROJECT_ROOT}/pluginPages/pluginB/page.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/' },
        passDataA,
        true,
        cache,
        SERVING_CONFIG
      );
      navbarRenderer.render(
        { name: 'main', configDir: '/' },
        passDataB,
        true,
        cache,
        SERVING_CONFIG
      );

      const calls = fs.existsSync.mock.calls.map(c => c[0]);
      expect(calls).toContain(`${PROJECT_ROOT}/pluginPages/pluginA/navbar.main.json5`);
      expect(calls).toContain(`${PROJECT_ROOT}/pluginPages/pluginB/navbar.main.json5`);
    });
  });

  // ─── configDir nel contesto admin ─────────────────────────────────────────

  describe('configDir nel contesto admin', () => {
    test('configDir: "/" cerca nella root della sezione admin', () => {
      const passData = createPassData(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/views/detail.ejs`
      );

      navbarRenderer.render(
        { name: 'admin', configDir: '/' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/navbar.admin.json5`
      );
    });

    test('admin root-level (dashboard) ritorna stringa vuota', () => {
      const passData = createPassData(
        `${PROJECT_ROOT}/core/admin/webPages/index.ejs`
      );

      const result = navbarRenderer.render(
        { name: 'admin', configDir: '/' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('configDir not supported')
      );
    });
  });

  // ─── Sicurezza: path traversal ────────────────────────────────────────────

  describe('sicurezza: path traversal', () => {
    test('blocca ../ che esce dalla root', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'main', configDir: '../../etc' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security')
      );
    });

    test('blocca path traversal da pluginPages verso altri plugin', () => {
      const passData = createPassData(`${PROJECT_ROOT}/pluginPages/pluginA/page.ejs`);

      const result = navbarRenderer.render(
        { name: 'main', configDir: '../pluginB' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security')
      );
    });

    test('blocca path traversal da sezione admin verso altra sezione', () => {
      const passData = createPassData(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/index.ejs`
      );

      const result = navbarRenderer.render(
        { name: 'main', configDir: '../rolesManagment' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security')
      );
    });

    test('permette sottocartelle valide (non traversal)', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'main', configDir: '/navbars' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      // Non deve generare warning di sicurezza
      const securityWarnings = warnSpy.mock.calls.filter(
        c => c[0] && c[0].includes('Security')
      );
      expect(securityWarnings).toHaveLength(0);
    });
  });

  // ─── Logging ──────────────────────────────────────────────────────────────

  describe('logging', () => {
    test('logga sempre il path risolto in debug mode', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true, // debug
        cache,
        SERVING_CONFIG
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('configDir resolved')
      );
    });

    test('logga sempre il path risolto in production mode', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        false, // production
        cache,
        SERVING_CONFIG
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('configDir resolved')
      );
    });

    test('log contiene il configDir originale e il path risolto', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      const logMessage = logSpy.mock.calls[0][0];
      expect(logMessage).toContain('/shared');
      expect(logMessage).toContain(`${PROJECT_ROOT}/www/shared`);
      expect(logMessage).toContain('context: "www"');
    });

    test('non logga quando configDir non specificato', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      const configDirLogs = logSpy.mock.calls.filter(
        c => c[0] && c[0].includes('configDir resolved')
      );
      expect(configDirLogs).toHaveLength(0);
    });
  });

  // ─── servingConfig mancante ───────────────────────────────────────────────

  describe('servingConfig mancante', () => {
    test('fallback a templateDir quando servingConfig e undefined', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true,
        cache,
        undefined // no servingConfig
      );

      // Deve fare fallback alla directory del template, non a /shared
      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('servingConfig not available')
      );
    });

    test('fallback a templateDir quando servingConfig incompleto', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true,
        cache,
        { projectRoot: PROJECT_ROOT } // servingPaths mancante
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
    });
  });

  // ─── File non trovato ─────────────────────────────────────────────────────

  describe('file non trovato', () => {
    test('ritorna stringa vuota se il file non esiste', () => {
      fs.existsSync.mockReturnValue(false);
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'nonexistent', configDir: '/shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('File not found')
      );
    });
  });

  // ─── Rendering con configDir ──────────────────────────────────────────────

  describe('rendering con configDir', () => {
    test('genera HTML valido quando file trovato via configDir', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      const result = navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toContain('<nav');
      expect(result).toContain('navbar');
      expect(result).toContain('Home');
    });
  });

  // ─── Cache con configDir ──────────────────────────────────────────────────

  describe('cache con configDir', () => {
    test('chiavi cache diverse per configDir diversi', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      // Prima chiamata: configDir /shared
      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        false, // production = cache attiva
        cache,
        SERVING_CONFIG
      );

      // Seconda chiamata: configDir /other
      navbarRenderer.render(
        { name: 'main', configDir: '/other' },
        passData,
        false,
        cache,
        SERVING_CONFIG
      );

      // Cache deve contenere 2 entry diverse
      expect(cache.size).toBe(2);
      expect(cache.has(`${PROJECT_ROOT}/www/shared/navbar.main.json5`)).toBe(true);
      expect(cache.has(`${PROJECT_ROOT}/www/other/navbar.main.json5`)).toBe(true);
    });

    test('stessa chiave cache per stesso configDir (production mode)', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        false,
        cache,
        SERVING_CONFIG
      );

      navbarRenderer.render(
        { name: 'main', configDir: '/shared' },
        passData,
        false,
        cache,
        SERVING_CONFIG
      );

      // loadJson5 chiamato una sola volta (seconda da cache)
      expect(loadJson5).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('configDir: "" (stringa vuota) usa comportamento default', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
    });

    test('configDir: null usa comportamento default', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: null },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/pages/navbar.main.json5`
      );
    });

    test('configDir con multipli "/" iniziali normalizzati', () => {
      const passData = createPassData(`${PROJECT_ROOT}/www/pages/home.ejs`);

      navbarRenderer.render(
        { name: 'main', configDir: '///shared' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(fs.existsSync).toHaveBeenCalledWith(
        `${PROJECT_ROOT}/www/shared/navbar.main.json5`
      );
    });

    test('contesto sconosciuto con configDir ritorna stringa vuota', () => {
      const passData = createPassData('/some/unknown/path/file.ejs');

      const result = navbarRenderer.render(
        { name: 'main', configDir: '/' },
        passData,
        true,
        cache,
        SERVING_CONFIG
      );

      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('configDir not supported')
      );
    });
  });
});
