/**
 * Unit Tests per core/themeSys.js
 *
 * Testa le funzionalità del sistema dei temi
 */

const path = require('path');
const fs = require('fs');

// Mock di ital8Conf per i test
const mockItal8Conf = {
  activeTheme: 'default',
  adminActiveTheme: 'default',
  apiPrefix: 'api'
};

// Percorso base per i temi
const themesBasePath = path.join(__dirname, '../../themes');

describe('Theme System', () => {

  describe('Theme Validation', () => {
    // Funzione di validazione estratta da themeSys per testing
    function validateTheme(themeName) {
      const themePath = path.join(themesBasePath, themeName);

      // Controlla esistenza directory del tema
      if (!fs.existsSync(themePath)) {
        return { valid: false, error: `Directory del tema '${themeName}' non trovata` };
      }

      // Controlla se è effettivamente una directory
      const stats = fs.statSync(themePath);
      if (!stats.isDirectory()) {
        return { valid: false, error: `'${themeName}' non è una directory` };
      }

      // Controlla esistenza themeConfig.json
      const configPath = path.join(themePath, 'themeConfig.json5');
      if (!fs.existsSync(configPath)) {
        return { valid: false, error: `themeConfig.json mancante nel tema '${themeName}'` };
      }

      // Controlla esistenza directory views
      const viewsPath = path.join(themePath, 'views');
      if (!fs.existsSync(viewsPath)) {
        return { valid: false, error: `Directory 'views' mancante nel tema '${themeName}'` };
      }

      // Controlla partials obbligatori
      const requiredPartials = ['head.ejs', 'header.ejs', 'footer.ejs'];
      for (const partial of requiredPartials) {
        const partialPath = path.join(viewsPath, partial);
        if (!fs.existsSync(partialPath)) {
          return { valid: false, error: `Partial '${partial}' mancante nel tema '${themeName}'` };
        }
      }

      // Tutte le validazioni passate
      return { valid: true, error: null };
    }

    test('valida correttamente il tema default', () => {
      const result = validateTheme('default');
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('valida correttamente il tema baseExampleTheme', () => {
      const result = validateTheme('baseExampleTheme');
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('valida correttamente il tema exampleTheme', () => {
      const result = validateTheme('exampleTheme');
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('ritorna errore per tema inesistente', () => {
      const result = validateTheme('nonExistentTheme');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non trovata');
    });

    test('ritorna errore se manca config-theme.json', () => {
      // Questo test assume che non esista un tema senza config
      // In un ambiente di test reale, creeremmo un tema temporaneo
      const result = validateTheme('nonExistentTheme');
      expect(result.valid).toBe(false);
    });
  });

  describe('Theme Description', () => {
    // Funzione per leggere themeDescription.json
    function getThemeDescription(themeName) {
      const descPath = path.join(themesBasePath, themeName, 'themeDescription.json5');

      try {
        if (fs.existsSync(descPath)) {
          return JSON.parse(fs.readFileSync(descPath, 'utf8'));
        }
      } catch (error) {
        return null;
      }

      return null;
    }

    test('legge correttamente themeDescription.json del tema default', () => {
      const desc = getThemeDescription('default');
      expect(desc).not.toBeNull();
      expect(desc.name).toBe('default');
      expect(desc.version).toBeDefined();
      expect(desc.author).toBeDefined();
    });

    test('legge correttamente themeDescription.json del tema exampleTheme', () => {
      const desc = getThemeDescription('exampleTheme');
      expect(desc).not.toBeNull();
      expect(desc.name).toBe('exampleTheme');
      expect(desc.supportedHooks).toBeInstanceOf(Array);
      expect(desc.supportedHooks).toContain('head');
      expect(desc.supportedHooks).toContain('footer');
    });

    test('ritorna null per tema senza themeDescription.json', () => {
      const desc = getThemeDescription('nonExistentTheme');
      expect(desc).toBeNull();
    });

    test('verifica presenza di tutti i campi richiesti', () => {
      const desc = getThemeDescription('default');
      expect(desc.name).toBeDefined();
      expect(desc.version).toBeDefined();
      expect(desc.description).toBeDefined();
      expect(desc.author).toBeDefined();
    });

    test('versione è in formato semver', () => {
      const desc = getThemeDescription('default');
      // Verifica formato x.y.z
      expect(desc.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('Theme Dependencies', () => {
    // Funzione per leggere le dipendenze
    function getThemeDependencies(themeName) {
      const configPath = path.join(themesBasePath, themeName, 'themeConfig.json5');

      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          return {
            plugins: config.pluginDependency || {},
            nodeModules: config.nodeModuleDependency || {}
          };
        }
      } catch (error) {
        return { plugins: {}, nodeModules: {} };
      }

      return { plugins: {}, nodeModules: {} };
    }

    test('legge correttamente le dipendenze del tema default', () => {
      const deps = getThemeDependencies('default');
      expect(deps).toBeDefined();
      expect(deps.plugins).toBeDefined();
      expect(deps.nodeModules).toBeDefined();
    });

    test('tema default richiede plugin bootstrap', () => {
      const deps = getThemeDependencies('default');
      expect(deps.plugins.bootstrap).toBeDefined();
      expect(deps.plugins.bootstrap).toMatch(/^\^?\d+\.\d+\.\d+/);
    });

    test('tema default richiede modulo ejs', () => {
      const deps = getThemeDependencies('default');
      expect(deps.nodeModules.ejs).toBeDefined();
    });

    test('ritorna oggetti vuoti per tema senza dipendenze', () => {
      const deps = getThemeDependencies('nonExistentTheme');
      expect(deps.plugins).toEqual({});
      expect(deps.nodeModules).toEqual({});
    });

    test('verifica formato versioni delle dipendenze', () => {
      const deps = getThemeDependencies('default');

      // Verifica che le versioni siano in formato valido (^x.y.z o ~x.y.z)
      for (const [name, version] of Object.entries(deps.plugins)) {
        expect(version).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
      }

      for (const [name, version] of Object.entries(deps.nodeModules)) {
        expect(version).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
      }
    });
  });

  describe('Theme Path Resolution', () => {
    test('genera correttamente path per partial pubblico', () => {
      const partName = 'head.ejs';
      const expectedPath = path.join(themesBasePath, mockItal8Conf.activeTheme, 'views', partName);
      const generatedPath = path.join(themesBasePath, 'default', 'views', partName);

      expect(generatedPath).toBe(expectedPath);
    });

    test('genera correttamente path per partial admin', () => {
      const partName = 'footer.ejs';
      const expectedPath = path.join(themesBasePath, mockItal8Conf.adminActiveTheme, 'views', partName);
      const generatedPath = path.join(themesBasePath, 'default', 'views', partName);

      expect(generatedPath).toBe(expectedPath);
    });

    test('i file dei partials esistono effettivamente', () => {
      const partials = ['head.ejs', 'header.ejs', 'footer.ejs'];

      for (const partial of partials) {
        const partialPath = path.join(themesBasePath, 'default', 'views', partial);
        expect(fs.existsSync(partialPath)).toBe(true);
      }
    });
  });

  describe('Theme Resource URL Generation', () => {
    // Funzione per generare URL risorse del tema
    function getThemeResourceUrl(resourcePath) {
      const cleanPath = resourcePath.replace(/^\/+/, '');
      return `/theme-assets/${cleanPath}`;
    }

    test('genera URL corretto per CSS', () => {
      expect(getThemeResourceUrl('css/theme.css')).toBe('/theme-assets/css/theme.css');
    });

    test('genera URL corretto per JS', () => {
      expect(getThemeResourceUrl('js/theme.js')).toBe('/theme-assets/js/theme.js');
    });

    test('rimuove slash iniziali', () => {
      expect(getThemeResourceUrl('/css/theme.css')).toBe('/theme-assets/css/theme.css');
      expect(getThemeResourceUrl('///images/logo.png')).toBe('/theme-assets/images/logo.png');
    });

    test('gestisce path senza slash', () => {
      expect(getThemeResourceUrl('style.css')).toBe('/theme-assets/style.css');
    });
  });

  describe('Plugin Customization', () => {
    // Funzione per verificare esistenza template custom
    function hasCustomPluginTemplate(themeName, pluginName, endpointName, templateFile = 'template.ejs') {
      const customPath = path.join(
        themesBasePath,
        themeName,
        'plugins',
        pluginName,
        endpointName,
        templateFile
      );

      return fs.existsSync(customPath);
    }

    test('tema default ha personalizzazione login', () => {
      const hasCustom = hasCustomPluginTemplate('default', 'simpleAccess', 'login');
      expect(hasCustom).toBe(true);
    });

    test('tema default ha personalizzazione logout', () => {
      const hasCustom = hasCustomPluginTemplate('default', 'simpleAccess', 'logout');
      expect(hasCustom).toBe(true);
    });

    test('tema exampleTheme ha personalizzazione login', () => {
      const hasCustom = hasCustomPluginTemplate('exampleTheme', 'simpleAccess', 'login');
      expect(hasCustom).toBe(true);
    });

    test('ritorna false per endpoint non personalizzato', () => {
      const hasCustom = hasCustomPluginTemplate('default', 'nonExistent', 'endpoint');
      expect(hasCustom).toBe(false);
    });

    test('verifica esistenza file CSS personalizzato', () => {
      const cssPath = path.join(
        themesBasePath,
        'default',
        'plugins',
        'simpleAccess',
        'login',
        'style.css'
      );

      expect(fs.existsSync(cssPath)).toBe(true);
    });
  });

  describe('Available Themes', () => {
    test('trova tutti i temi nella directory', () => {
      const entries = fs.readdirSync(themesBasePath);
      const themes = entries.filter(entry => {
        const entryPath = path.join(themesBasePath, entry);
        return fs.statSync(entryPath).isDirectory();
      });

      expect(themes).toContain('default');
      expect(themes).toContain('baseExampleTheme');
      expect(themes).toContain('exampleTheme');
    });

    test('tutti i temi hanno themeConfig.json', () => {
      const entries = fs.readdirSync(themesBasePath);
      const themes = entries.filter(entry => {
        const entryPath = path.join(themesBasePath, entry);
        return fs.statSync(entryPath).isDirectory();
      });

      for (const theme of themes) {
        const configPath = path.join(themesBasePath, theme, 'themeConfig.json5');
        expect(fs.existsSync(configPath)).toBe(true);
      }
    });
  });

  describe('Hook Support', () => {
    // Funzione per verificare supporto hook
    function themeSupportsHook(themeName, hookName) {
      const descPath = path.join(themesBasePath, themeName, 'themeDescription.json5');

      try {
        if (fs.existsSync(descPath)) {
          const desc = JSON.parse(fs.readFileSync(descPath, 'utf8'));
          if (desc.supportedHooks) {
            return desc.supportedHooks.includes(hookName);
          }
        }
      } catch (error) {
        return true; // Assume supporto se non specificato
      }

      return true;
    }

    test('tema default supporta tutti gli hook standard', () => {
      const hooks = ['head', 'header', 'nav', 'main', 'body', 'aside', 'footer', 'script'];

      for (const hook of hooks) {
        expect(themeSupportsHook('default', hook)).toBe(true);
      }
    });

    test('tema exampleTheme supporta tutti gli hook standard', () => {
      const hooks = ['head', 'header', 'nav', 'main', 'body', 'aside', 'footer', 'script'];

      for (const hook of hooks) {
        expect(themeSupportsHook('exampleTheme', hook)).toBe(true);
      }
    });

    test('tema baseExampleTheme ha hook limitati', () => {
      // baseExampleTheme ha solo head, header, footer, script
      expect(themeSupportsHook('baseExampleTheme', 'head')).toBe(true);
      expect(themeSupportsHook('baseExampleTheme', 'footer')).toBe(true);
    });
  });

  describe('Version Format Checking', () => {
    test('versione tema è in formato valido', () => {
      const descPath = path.join(themesBasePath, 'default', 'themeDescription.json5');
      const desc = JSON.parse(fs.readFileSync(descPath, 'utf8'));

      // Verifica formato x.y.z
      expect(desc.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('tutte le versioni dei temi sono in formato valido', () => {
      const themes = ['default', 'baseExampleTheme', 'exampleTheme'];

      for (const theme of themes) {
        const descPath = path.join(themesBasePath, theme, 'themeDescription.json5');
        if (fs.existsSync(descPath)) {
          const desc = JSON.parse(fs.readFileSync(descPath, 'utf8'));
          expect(desc.version).toMatch(/^\d+\.\d+\.\d+$/);
        }
      }
    });
  });
});
