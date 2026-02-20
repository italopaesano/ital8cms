/**
 * Unit Tests per la pipeline di rendering di navbarRenderer.render()
 *
 * Copre: validazione input, settings merge, dispatch per tipo,
 * HTML output per i 3 tipi navbar, dropdown, separatori, auto-active,
 * e caching.
 *
 * Le funzioni interne (renderNavItem, renderDropdown, ecc.) non sono
 * esportate, quindi vengono testate indirettamente attraverso render().
 */

const fs = require('fs');

jest.mock('../../../core/loadJson5', () => jest.fn());
const loadJson5 = require('../../../core/loadJson5');

const navbarRenderer = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');

// ─── Costanti ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/home/user/ital8cms';
const SERVING_PATHS = {
  wwwPath: '/www',
  pluginPagesPath: '/pluginPages',
  adminPagesPath: '/core/admin/webPages',
};
const SERVING_CONFIG = { projectRoot: PROJECT_ROOT, servingPaths: SERVING_PATHS };

// ─── Helper ──────────────────────────────────────────────────────────────────

function passData(filePath, href, ctx) {
  return {
    filePath: filePath || `${PROJECT_ROOT}/www/page.ejs`,
    href: href || 'http://localhost:3000/',
    ctx: ctx || { session: {} },
  };
}

function minConfig(overrides = {}) {
  return {
    settings: { type: 'horizontal', ...overrides.settings },
    sections: {
      left: overrides.left || [],
      right: overrides.right || [],
    },
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('navbarRenderer.render()', () => {
  let cache;
  let warnSpy;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    cache = new Map();
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    loadJson5.mockReturnValue(minConfig());
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDAZIONE INPUT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('validazione input', () => {
    test('senza name → warning + stringa vuota', () => {
      const result = navbarRenderer.render({}, passData(), true, cache);
      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without a name'));
    });

    test('name vuoto → warning + stringa vuota', () => {
      const result = navbarRenderer.render({ name: '' }, passData(), true, cache);
      expect(result).toBe('');
    });

    test('senza passData → warning + stringa vuota', () => {
      const result = navbarRenderer.render({ name: 'main' }, null, true, cache);
      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('passData'));
    });

    test('passData senza filePath → warning + stringa vuota', () => {
      const result = navbarRenderer.render({ name: 'main' }, { href: '/' }, true, cache);
      expect(result).toBe('');
    });

    test('input validi → genera HTML', () => {
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache, SERVING_CONFIG);
      expect(result).toContain('<nav');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE LOADING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('file loading', () => {
    test('file non trovato → warning + stringa vuota', () => {
      fs.existsSync.mockReturnValue(false);
      const result = navbarRenderer.render({ name: 'missing' }, passData(), true, cache);
      expect(result).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    });

    test('errore parsing JSON5 → error + stringa vuota', () => {
      loadJson5.mockImplementation(() => { throw new Error('Syntax error'); });
      const result = navbarRenderer.render({ name: 'bad' }, passData(), true, cache);
      expect(result).toBe('');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing'),
        expect.any(String)
      );
    });

    test('il nome del file segue il pattern navbar.{name}.json5', () => {
      navbarRenderer.render({ name: 'customName' }, passData(), true, cache);
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('navbar.customName.json5')
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('caching', () => {
    test('production: prima chiamata popola la cache', () => {
      navbarRenderer.render({ name: 'main' }, passData(), false, cache);
      expect(cache.size).toBe(1);
    });

    test('production: seconda chiamata usa la cache', () => {
      navbarRenderer.render({ name: 'main' }, passData(), false, cache);
      navbarRenderer.render({ name: 'main' }, passData(), false, cache);
      expect(loadJson5).toHaveBeenCalledTimes(1);
    });

    test('debug: non popola la cache', () => {
      navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(cache.size).toBe(0);
    });

    test('debug: rilegge il file ogni volta', () => {
      navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(loadJson5).toHaveBeenCalledTimes(2);
    });

    test('debug: ignora la cache anche se popolata', () => {
      // Popola cache manualmente
      const fakeConfig = minConfig({ settings: { bgClass: 'bg-cached' } });
      const cacheKey = `${PROJECT_ROOT}/www/navbar.main.json5`;
      cache.set(cacheKey, fakeConfig);

      // In debug, deve ri-leggere il file
      navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(loadJson5).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS MERGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('settings merge (defaults < file < runtime)', () => {
    test('settings di default applicati quando file non li specifica', () => {
      loadJson5.mockReturnValue({ sections: { left: [], right: [] } });
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      // Default: type horizontal, bgClass bg-primary, colorScheme dark
      expect(result).toContain('bg-primary');
      expect(result).toContain('data-bs-theme="dark"');
      expect(result).toContain('navbar-expand-lg');
    });

    test('settings del file sovrascrivono i default', () => {
      loadJson5.mockReturnValue({
        settings: { bgClass: 'bg-danger', colorScheme: 'light' },
        sections: { left: [], right: [] },
      });
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('bg-danger');
      expect(result).toContain('data-bs-theme="light"');
    });

    test('settingsOverrides sovrascrivono il file', () => {
      loadJson5.mockReturnValue({
        settings: { bgClass: 'bg-danger' },
        sections: { left: [], right: [] },
      });
      const result = navbarRenderer.render(
        { name: 'main', settingsOverrides: { bgClass: 'bg-success' } },
        passData(), true, cache
      );
      expect(result).toContain('bg-success');
      expect(result).not.toContain('bg-danger');
    });

    test('override parziale: solo un campo sovrascritto', () => {
      loadJson5.mockReturnValue({
        settings: { bgClass: 'bg-warning', expandAt: 'sm' },
        sections: { left: [], right: [] },
      });
      const result = navbarRenderer.render(
        { name: 'main', settingsOverrides: { expandAt: 'xl' } },
        passData(), true, cache
      );
      expect(result).toContain('bg-warning'); // dal file
      expect(result).toContain('navbar-expand-xl'); // dall'override
      expect(result).not.toContain('navbar-expand-sm');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISPATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('type dispatch', () => {
    test('type horizontal → navbar con collapse', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { type: 'horizontal' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-collapse');
      expect(result).toContain('collapse');
    });

    test('type vertical → navbar con flex-column', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { type: 'vertical' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('flex-column');
      expect(result).not.toContain('navbar-collapse');
    });

    test('type offcanvas → navbar con offcanvas', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { type: 'offcanvas' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('offcanvas');
      expect(result).toContain('offcanvas-header');
      expect(result).toContain('offcanvas-body');
    });

    test('type sconosciuto → default a horizontal', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { type: 'invalid' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-collapse');
    });

    test('type non specificato → default a horizontal', () => {
      loadJson5.mockReturnValue({ sections: { left: [], right: [] } });
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-collapse');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HORIZONTAL NAVBAR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('horizontal navbar', () => {
    test('contiene navbar-toggler per mobile', () => {
      loadJson5.mockReturnValue(minConfig());
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-toggler');
      expect(result).toContain('navbar-toggler-icon');
    });

    test('applica expandAt al breakpoint', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { expandAt: 'sm' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-expand-sm');
      expect(result).toContain('mb-sm-0');
    });

    test('containerClass applicato', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { containerClass: 'container' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('class="container"');
    });

    test('id usato per collapse target', () => {
      loadJson5.mockReturnValue(minConfig({ settings: { id: 'myNav' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('data-bs-target="#myNav"');
      expect(result).toContain('id="myNav"');
    });

    test('left items in ul con me-auto', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Home', href: '/' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('me-auto');
      expect(result).toContain('Home');
    });

    test('right items nel secondo ul', () => {
      loadJson5.mockReturnValue(minConfig({
        right: [{ label: 'Login', href: '/login' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('Login');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VERTICAL NAVBAR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('vertical navbar', () => {
    function verticalConfig(overrides = {}) {
      const { settings: extraSettings, ...rest } = overrides;
      return minConfig({ ...rest, settings: { type: 'vertical', ...extraSettings } });
    }

    test('struttura flex-column', () => {
      loadJson5.mockReturnValue(verticalConfig());
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('flex-column');
      expect(result).toContain('align-items-stretch');
      expect(result).toContain('p-3');
    });

    test('position: start → nessuna classe ms-auto', () => {
      loadJson5.mockReturnValue(verticalConfig({ settings: { position: 'start' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toContain('ms-auto');
    });

    test('position: end → classe ms-auto', () => {
      loadJson5.mockReturnValue(verticalConfig({ settings: { position: 'end' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('ms-auto');
    });

    test('right items presenti → hr separator + secondo ul', () => {
      loadJson5.mockReturnValue(verticalConfig({
        left: [{ label: 'Home', href: '/' }],
        right: [{ label: 'Settings', href: '/settings' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('<hr');
      expect(result).toContain('Settings');
    });

    test('right items vuoti → nessun hr separator', () => {
      loadJson5.mockReturnValue(verticalConfig({
        left: [{ label: 'Home', href: '/' }],
        right: [],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toContain('<hr');
    });

    test('nessun navbar-toggler (no collapse in vertical)', () => {
      loadJson5.mockReturnValue(verticalConfig());
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toContain('navbar-toggler');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFCANVAS NAVBAR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('offcanvas navbar', () => {
    function offcanvasConfig(overrides = {}) {
      const { settings: extraSettings, ...rest } = overrides;
      return minConfig({ ...rest, settings: { type: 'offcanvas', ...extraSettings } });
    }

    test('struttura offcanvas con header e body', () => {
      loadJson5.mockReturnValue(offcanvasConfig());
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('offcanvas-header');
      expect(result).toContain('offcanvas-body');
      expect(result).toContain('offcanvas-title');
      expect(result).toContain('btn-close');
    });

    test('id offcanvas = settingsId + "-offcanvas"', () => {
      loadJson5.mockReturnValue(offcanvasConfig({ settings: { id: 'myNav' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('id="myNav-offcanvas"');
      expect(result).toContain('data-bs-target="#myNav-offcanvas"');
    });

    test('position: start → offcanvas-start', () => {
      loadJson5.mockReturnValue(offcanvasConfig({ settings: { position: 'start' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('offcanvas-start');
    });

    test('position: end → offcanvas-end', () => {
      loadJson5.mockReturnValue(offcanvasConfig({ settings: { position: 'end' } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('offcanvas-end');
    });

    test('offcanvasAlways: true → nessun navbar-expand-*', () => {
      loadJson5.mockReturnValue(offcanvasConfig({ settings: { offcanvasAlways: true } }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toMatch(/navbar-expand-\w+/);
    });

    test('offcanvasAlways: false → navbar-expand-{expandAt}', () => {
      loadJson5.mockReturnValue(offcanvasConfig({
        settings: { offcanvasAlways: false, expandAt: 'md' },
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('navbar-expand-md');
    });

    test('data-bs-toggle="offcanvas" sul toggler', () => {
      loadJson5.mockReturnValue(offcanvasConfig());
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('data-bs-toggle="offcanvas"');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NAV ITEMS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('nav items', () => {
    test('item semplice → li.nav-item con a.nav-link', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Home', href: '/' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('<li class="nav-item">');
      expect(result).toContain('class="nav-link');
      expect(result).toContain('href="/"');
      expect(result).toContain('Home');
    });

    test('item con icon → icon inserita prima del label', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Home', href: '/', icon: "<i class='bi bi-house'></i>" }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain("<i class='bi bi-house'></i>");
      expect(result).toContain('Home');
    });

    test('item con target → attributo target nel link', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Ext', href: '/ext', target: '_blank' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('target="_blank"');
    });

    test('item senza href → href="#"', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'NoLink' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('href="#"');
    });

    test('item con label contenente HTML → label escaped', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: '<b>Bold</b>', href: '/' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('&lt;b&gt;Bold&lt;/b&gt;');
      expect(result).not.toContain('<b>Bold</b>');
    });

    test('icon NON escaped (HTML raw)', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'X', href: '/', icon: '<i class="test"></i>' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('<i class="test"></i>');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('auto-active', () => {
    test('item con href uguale a currentHref → classe active', () => {
      loadJson5.mockReturnValue(minConfig({
        settings: { autoActive: true },
        left: [{ label: 'Page', href: '/page' }],
      }));
      const pd = passData(undefined, 'http://localhost:3000/page');
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).toContain('nav-link active');
      expect(result).toContain('aria-current="page"');
    });

    test('item con href diverso → nessuna classe active', () => {
      loadJson5.mockReturnValue(minConfig({
        settings: { autoActive: true },
        left: [{ label: 'Other', href: '/other' }],
      }));
      const pd = passData(undefined, 'http://localhost:3000/page');
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).not.toContain('nav-link active');
      expect(result).not.toContain('aria-current');
    });

    test('autoActive: false → nessuna classe active anche se href match', () => {
      loadJson5.mockReturnValue(minConfig({
        settings: { autoActive: false },
        left: [{ label: 'Page', href: '/page' }],
      }));
      const pd = passData(undefined, 'http://localhost:3000/page');
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).not.toContain('nav-link active');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DROPDOWN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('dropdown', () => {
    test('dropdown con sub-items → struttura completa', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{
          type: 'dropdown',
          label: 'Menu',
          items: [
            { label: 'Item 1', href: '/item1' },
            { label: 'Item 2', href: '/item2' },
          ],
        }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('nav-item dropdown');
      expect(result).toContain('dropdown-toggle');
      expect(result).toContain('dropdown-menu');
      expect(result).toContain('dropdown-item');
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
    });

    test('dropdown con divider → <hr class="dropdown-divider">', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{
          type: 'dropdown',
          label: 'Menu',
          items: [
            { label: 'Before', href: '/before' },
            { type: 'divider' },
            { label: 'After', href: '/after' },
          ],
        }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('dropdown-divider');
    });

    test('dropdown con icon → icon nel toggle button', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{
          type: 'dropdown',
          label: 'Menu',
          icon: "<i class='bi bi-menu'></i>",
          items: [{ label: 'X', href: '/' }],
        }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain("<i class='bi bi-menu'></i>");
    });

    test('dropdown ID generato da settings.id + label', () => {
      loadJson5.mockReturnValue(minConfig({
        settings: { id: 'navMain' },
        left: [{
          type: 'dropdown',
          label: 'My Services',
          items: [{ label: 'X', href: '/' }],
        }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('dropdown-navMain-my-services');
    });

    test('dropdown senza sub-items visibili → non renderizzato', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{
          type: 'dropdown',
          label: 'Empty',
          items: [
            { label: 'Auth Only', href: '/', requiresAuth: true },
          ],
        }],
      }));
      // Utente anonimo → sub-item nascosto → dropdown nascosto
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toContain('Empty');
      expect(result).not.toContain('dropdown');
    });

    test('dropdown con items undefined → non renderizzato', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ type: 'dropdown', label: 'NoItems' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).not.toContain('NoItems');
    });

    test('sub-item active → classe active sul dropdown-item', () => {
      loadJson5.mockReturnValue(minConfig({
        settings: { autoActive: true },
        left: [{
          type: 'dropdown',
          label: 'Menu',
          items: [{ label: 'Active', href: '/current' }],
        }],
      }));
      const pd = passData(undefined, 'http://localhost:3000/current');
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).toContain('dropdown-item active');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEPARATOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('separator', () => {
    test('type separator → barra verticale', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [
          { label: 'A', href: '/a' },
          { type: 'separator' },
          { label: 'B', href: '/b' },
        ],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('disabled px-1');
      expect(result).toContain('|');
    });

    test('separator non filtrato dalla visibilita', () => {
      // Anche senza auth, il separator deve apparire
      loadJson5.mockReturnValue(minConfig({
        left: [{ type: 'separator' }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('|');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY FILTERING (tramite render)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('visibility filtering nel rendering', () => {
    test('item con requiresAuth: true nascosto per utente anonimo', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [
          { label: 'Public', href: '/pub' },
          { label: 'Private', href: '/priv', requiresAuth: true },
        ],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('Public');
      expect(result).not.toContain('Private');
    });

    test('item con showWhen: "authenticated" visibile per utente autenticato', () => {
      loadJson5.mockReturnValue(minConfig({
        right: [
          { label: 'Login', href: '/login', showWhen: 'unauthenticated' },
          { label: 'Logout', href: '/logout', showWhen: 'authenticated' },
        ],
      }));
      const ctx = { session: { authenticated: true, user: { roleIds: [1] } } };
      const pd = passData(undefined, undefined, ctx);
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).not.toContain('Login');
      expect(result).toContain('Logout');
    });

    test('item con allowedRoles filtrato per ruolo', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [
          { label: 'Admin', href: '/admin', requiresAuth: true, allowedRoles: [0, 1] },
        ],
      }));
      const ctx = { session: { authenticated: true, user: { roleIds: [2] } } };
      const pd = passData(undefined, undefined, ctx);
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).not.toContain('Admin');
    });

    test('tutti gli item nascosti → HTML navbar vuoto ma struttura presente', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Auth', href: '/', requiresAuth: true }],
        right: [{ label: 'Auth2', href: '/', requiresAuth: true }],
      }));
      const result = navbarRenderer.render({ name: 'main' }, passData(), true, cache);
      expect(result).toContain('<nav');
      expect(result).not.toContain('Auth');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSDATA FALLBACK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('passData fallback', () => {
    test('passData.href mancante → currentHref stringa vuota', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Home', href: '/' }],
      }));
      const pd = { filePath: `${PROJECT_ROOT}/www/page.ejs`, ctx: { session: {} } };
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).toContain('Home');
      expect(result).not.toContain(' active');
    });

    test('passData.ctx mancante → trattato come utente anonimo', () => {
      loadJson5.mockReturnValue(minConfig({
        left: [{ label: 'Auth', href: '/', requiresAuth: true }],
      }));
      const pd = { filePath: `${PROJECT_ROOT}/www/page.ejs`, href: 'http://localhost:3000/' };
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);
      expect(result).not.toContain('Auth');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO REALISTICO COMPLETO
  // ═══════════════════════════════════════════════════════════════════════════

  describe('scenario realistico completo', () => {
    test('navbar con tutti i tipi di item per utente autenticato', () => {
      loadJson5.mockReturnValue({
        settings: {
          type: 'horizontal',
          colorScheme: 'dark',
          bgClass: 'bg-primary',
          expandAt: 'lg',
          autoActive: true,
          id: 'navbarMain',
        },
        sections: {
          left: [
            { label: 'Home', href: '/' },
            { type: 'dropdown', label: 'Pages', items: [
              { label: 'About', href: '/about' },
              { type: 'divider' },
              { label: 'Contact', href: '/contact' },
            ]},
            { type: 'separator' },
            { label: 'Admin', href: '/admin', requiresAuth: true, allowedRoles: [0, 1] },
          ],
          right: [
            { label: 'Login', href: '/login', showWhen: 'unauthenticated' },
            { label: 'Logout', href: '/logout', showWhen: 'authenticated' },
          ],
        },
      });

      const ctx = { session: { authenticated: true, user: { roleIds: [1] } } };
      const pd = passData(undefined, 'http://localhost:3000/', ctx);
      const result = navbarRenderer.render({ name: 'main' }, pd, true, cache);

      // Struttura navbar
      expect(result).toContain('<nav');
      expect(result).toContain('bg-primary');

      // Items visibili
      expect(result).toContain('Home');
      expect(result).toContain('Pages');
      expect(result).toContain('About');
      expect(result).toContain('Contact');
      expect(result).toContain('Admin'); // admin role ha accesso
      expect(result).toContain('Logout'); // autenticato

      // Items nascosti
      expect(result).not.toContain('Login'); // autenticato → Login nascosto

      // Separator
      expect(result).toContain('|');

      // Divider nel dropdown
      expect(result).toContain('dropdown-divider');

      // Home attiva (href=/ e currentHref=/)
      expect(result).toContain('nav-link active');
    });
  });
});
