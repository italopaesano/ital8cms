/**
 * Unit Tests per checkDependencies() in core/themeSys.js
 *
 * Copre specificamente la risoluzione del package.json per i moduli NPM.
 *
 * REGRESSIONE: prima del fix il path veniva risolto via
 *   `path.dirname(require.resolve(moduleName)) + '..' + 'package.json'`
 * che fallisce per moduli con entry in sotto-cartelle (es. ejs v5+ in lib/cjs/).
 * Risultato: warning "Impossibile verificare versione del modulo 'ejs'"
 * e mancato rilevamento di incompatibilità di versione.
 */

const path = require('path');
const fs = require('fs');

const ThemeSys = require('../../core/themeSys');
const loadJson5 = require('../../core/loadJson5');

const PROJECT_ROOT = path.join(__dirname, '../..');
const THEMES_DIR = path.join(PROJECT_ROOT, 'themes');

/**
 * Costruisce un themeSys con pluginSys stub.
 * Silenzia i log del constructor per non sporcare l'output dei test.
 */
function makeThemeSys({ activeTheme = 'placeholderExample', adminActiveTheme = 'defaultAdminTheme' } = {}) {
  const ital8Conf = {
    activeTheme,
    adminActiveTheme,
    apiPrefix: 'api',
    publicThemeResourcesPrefix: 'public-theme-resources',
    adminThemeResourcesPrefix: 'admin-theme-resources',
  };
  const pluginSys = {
    isPluginActive: () => true,
    getPluginVersion: () => '1.0.0',
  };

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return new ThemeSys(ital8Conf, pluginSys);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

describe('themeSys.checkDependencies — risoluzione versione moduli NPM', () => {

  describe('regressione bug ejs 5.x', () => {
    test('NON emette il warning "Impossibile verificare versione del modulo ejs"', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const themeSys = makeThemeSys();

      warnSpy.mockClear();
      themeSys.checkDependencies('default');

      const warnings = warnSpy.mock.calls.map(args => args.join(' '));
      const offendingWarn = warnings.find(w => /Impossibile verificare versione del modulo 'ejs'/.test(w));
      expect(offendingWarn).toBeUndefined();

      warnSpy.mockRestore();
    });

    test('risolve correttamente la versione di ejs (modulo con entry in sotto-cartella)', () => {
      // ejs è installato con main in lib/cjs/ejs.js dalla v4+.
      // Il vecchio codice produceva path errato in lib/package.json.
      const ejsPackageJson = path.join(PROJECT_ROOT, 'node_modules', 'ejs', 'package.json');
      expect(fs.existsSync(ejsPackageJson)).toBe(true);
      const installedVersion = JSON.parse(fs.readFileSync(ejsPackageJson, 'utf8')).version;
      expect(installedVersion).toMatch(/^\d+\.\d+\.\d+/);

      // Il check sui temi bundled (che dichiarano ejs ^5.0.0) deve essere soddisfatto.
      const themeSys = makeThemeSys();
      const result = themeSys.checkDependencies('default');
      const ejsErrors = result.errors.filter(e => e.includes("'ejs'"));
      expect(ejsErrors).toEqual([]);
    });
  });

  describe('rilevamento incompatibilità di versione', () => {
    test('riporta errore quando la versione installata non soddisfa il requisito', () => {
      // Creo un tema temporaneo che richiede ejs ^99.0.0 (impossibile da soddisfare)
      const tempThemeName = `__test_theme_incompat_${Date.now()}`;
      const tempThemePath = path.join(THEMES_DIR, tempThemeName);
      fs.mkdirSync(path.join(tempThemePath, 'views'), { recursive: true });

      // Partials minimi richiesti da validateTheme
      ['head.ejs', 'header.ejs', 'footer.ejs'].forEach(p => {
        fs.writeFileSync(path.join(tempThemePath, 'views', p), '', 'utf8');
      });

      fs.writeFileSync(
        path.join(tempThemePath, 'themeConfig.json5'),
        '// test\n{\n  "active": 0,\n  "isInstalled": 0,\n  "isAdminTheme": false,\n  "nodeModuleDependency": { "ejs": "^99.0.0" }\n}\n',
        'utf8'
      );

      try {
        const themeSys = makeThemeSys();
        const result = themeSys.checkDependencies(tempThemeName);

        expect(result.satisfied).toBe(false);
        const ejsErrors = result.errors.filter(e => e.includes("'ejs'"));
        expect(ejsErrors.length).toBe(1);
        expect(ejsErrors[0]).toMatch(/non soddisfa requisito.*\^99\.0\.0/);
      } finally {
        fs.rmSync(tempThemePath, { recursive: true, force: true });
      }
    });

    test('riporta modulo come "non installato" se assente da node_modules', () => {
      const tempThemeName = `__test_theme_missing_${Date.now()}`;
      const tempThemePath = path.join(THEMES_DIR, tempThemeName);
      fs.mkdirSync(path.join(tempThemePath, 'views'), { recursive: true });
      ['head.ejs', 'header.ejs', 'footer.ejs'].forEach(p => {
        fs.writeFileSync(path.join(tempThemePath, 'views', p), '', 'utf8');
      });
      fs.writeFileSync(
        path.join(tempThemePath, 'themeConfig.json5'),
        '// test\n{\n  "active": 0,\n  "isInstalled": 0,\n  "isAdminTheme": false,\n  "nodeModuleDependency": { "moduloInesistente_xyz_123": "^1.0.0" }\n}\n',
        'utf8'
      );

      try {
        const themeSys = makeThemeSys();
        const result = themeSys.checkDependencies(tempThemeName);

        expect(result.satisfied).toBe(false);
        expect(result.errors.some(e => /moduloInesistente_xyz_123.*non installato/.test(e))).toBe(true);
      } finally {
        fs.rmSync(tempThemePath, { recursive: true, force: true });
      }
    });
  });

  describe('coerenza versione ejs dichiarata vs installata', () => {
    test('tutti i temi bundled dichiarano un range ejs soddisfatto dalla versione installata', () => {
      const ejsPackagePath = path.join(PROJECT_ROOT, 'node_modules', 'ejs', 'package.json');
      const installedEjsVersion = JSON.parse(fs.readFileSync(ejsPackagePath, 'utf8')).version;

      const themeSys = makeThemeSys();
      const themes = fs.readdirSync(THEMES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);

      for (const themeName of themes) {
        const cfgPath = path.join(THEMES_DIR, themeName, 'themeConfig.json5');
        if (!fs.existsSync(cfgPath)) continue;
        const cfg = loadJson5(cfgPath);
        if (!cfg.nodeModuleDependency || !cfg.nodeModuleDependency.ejs) continue;

        const result = themeSys.checkDependencies(themeName);
        const ejsErr = result.errors.find(e => e.includes("'ejs'"));
        if (ejsErr) {
          throw new Error(
            `Tema '${themeName}' dichiara ejs '${cfg.nodeModuleDependency.ejs}' ` +
            `ma la versione installata ${installedEjsVersion} non lo soddisfa. ` +
            `Aggiornare il themeConfig.json5 oppure la dipendenza root.`
          );
        }
      }
    });
  });
});
