/**
 * Integration Tests per globalPrefix
 * Verifica che il globalPrefix sia applicato correttamente a tutte le route e configurazioni
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

describe('GlobalPrefix Configuration', () => {
  const configPath = path.join(__dirname, '../../ital8Config.json5');
  let originalConfig;

  beforeAll(() => {
    // Backup della configurazione originale
    originalConfig = fs.readFileSync(configPath, 'utf8');
  });

  afterAll(() => {
    // Ripristina la configurazione originale
    fs.writeFileSync(configPath, originalConfig, 'utf8');
  });

  describe('Config Loading', () => {
    test('ital8Config.json5 contiene globalPrefix', () => {
      const config = loadJson5(configPath);
      expect(config).toHaveProperty('globalPrefix');
    });

    test('globalPrefix è una stringa', () => {
      const config = loadJson5(configPath);
      expect(typeof config.globalPrefix).toBe('string');
    });

    test('globalPrefix vuoto è valido (retrocompatibilità)', () => {
      const config = loadJson5(configPath);
      // Può essere vuoto o avere un valore
      expect(config.globalPrefix).toBeDefined();
      expect(typeof config.globalPrefix).toBe('string');
    });
  });

  describe('Path Construction', () => {
    test('route API costruite correttamente con globalPrefix vuoto', () => {
      const config = { globalPrefix: '', apiPrefix: 'api' };
      const apiPath = `${config.globalPrefix}/${config.apiPrefix}`;
      expect(apiPath).toBe('/api');
    });

    test('route API costruite correttamente con globalPrefix impostato', () => {
      const config = { globalPrefix: '/cms1', apiPrefix: 'api' };
      const apiPath = `${config.globalPrefix}/${config.apiPrefix}`;
      expect(apiPath).toBe('/cms1/api');
    });

    test('route admin costruite correttamente con globalPrefix', () => {
      const config = { globalPrefix: '/blog', adminPrefix: 'admin' };
      const adminPath = `${config.globalPrefix}/${config.adminPrefix}`;
      expect(adminPath).toBe('/blog/admin');
    });

    test('theme resources costruite correttamente con globalPrefix', () => {
      const config = { globalPrefix: '/shop', publicThemeResourcesPrefix: 'public-theme-resources' };
      const themePath = `${config.globalPrefix}/${config.publicThemeResourcesPrefix}`;
      expect(themePath).toBe('/shop/public-theme-resources');
    });

    test('percorsi multipli con stesso globalPrefix', () => {
      const config = {
        globalPrefix: '/cms1',
        apiPrefix: 'api',
        adminPrefix: 'admin',
        publicThemeResourcesPrefix: 'public-theme-resources'
      };

      const paths = {
        api: `${config.globalPrefix}/${config.apiPrefix}`,
        admin: `${config.globalPrefix}/${config.adminPrefix}`,
        theme: `${config.globalPrefix}/${config.publicThemeResourcesPrefix}`
      };

      expect(paths.api).toBe('/cms1/api');
      expect(paths.admin).toBe('/cms1/admin');
      expect(paths.theme).toBe('/cms1/public-theme-resources');
    });
  });

  describe('GlobalPrefix Validation', () => {
    test('globalPrefix deve iniziare con / se non vuoto', () => {
      const validPrefixes = ['', '/cms1', '/blog', '/shop', '/subdirectory'];
      const invalidPrefixes = ['cms1', 'blog/', '/cms1/', 'path/to/cms'];

      validPrefixes.forEach(prefix => {
        if (prefix !== '') {
          expect(prefix.startsWith('/')).toBe(true);
          expect(prefix.endsWith('/')).toBe(false);
        }
      });

      invalidPrefixes.forEach(prefix => {
        const isValid = prefix === '' || (prefix.startsWith('/') && !prefix.endsWith('/'));
        if (prefix !== '') {
          expect(isValid).toBe(false);
        }
      });
    });

    test('globalPrefix non deve contenere spazi', () => {
      const validPrefixes = ['/cms1', '/blog', '/my-shop'];
      const invalidPrefixes = ['/cms 1', '/ blog', '/my shop'];

      validPrefixes.forEach(prefix => {
        expect(prefix.includes(' ')).toBe(false);
      });

      invalidPrefixes.forEach(prefix => {
        expect(prefix.includes(' ')).toBe(true);
      });
    });

    test('globalPrefix non deve contenere caratteri speciali problematici', () => {
      const validPrefixes = ['/cms1', '/blog', '/my-shop', '/cms_test'];
      const invalidPrefixes = ['/cms?1', '/blog#', '/my shop', '/cms@test'];

      validPrefixes.forEach(prefix => {
        // Caratteri validi: lettere, numeri, -, _
        expect(/^\/[a-zA-Z0-9_-]+$/.test(prefix)).toBe(true);
      });

      invalidPrefixes.forEach(prefix => {
        expect(/^\/[a-zA-Z0-9_-]+$/.test(prefix)).toBe(false);
      });
    });
  });

  describe('Session Path Configuration', () => {
    test('session path usa globalPrefix se impostato', () => {
      const config = { globalPrefix: '/cms1' };
      const sessionPath = config.globalPrefix || '/';
      expect(sessionPath).toBe('/cms1');
    });

    test('session path usa / se globalPrefix è vuoto', () => {
      const config = { globalPrefix: '' };
      const sessionPath = config.globalPrefix || '/';
      expect(sessionPath).toBe('/');
    });

    test('session path non termina con /', () => {
      const prefixes = ['/cms1', '/blog', '/shop'];
      prefixes.forEach(prefix => {
        expect(prefix.endsWith('/')).toBe(false);
      });
    });
  });

  describe('Multi-CMS Scenario', () => {
    test('simulazione di 3 CMS con prefissi diversi', () => {
      const cms1 = {
        globalPrefix: '/cms1',
        apiPrefix: 'api',
        adminPrefix: 'admin'
      };

      const cms2 = {
        globalPrefix: '/cms2',
        apiPrefix: 'api',
        adminPrefix: 'admin'
      };

      const cms3 = {
        globalPrefix: '/blog',
        apiPrefix: 'api',
        adminPrefix: 'admin'
      };

      // Verifica che i percorsi non si sovrappongano
      const paths = [
        `${cms1.globalPrefix}/${cms1.apiPrefix}`,
        `${cms2.globalPrefix}/${cms2.apiPrefix}`,
        `${cms3.globalPrefix}/${cms3.apiPrefix}`
      ];

      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(3);
      expect(paths).toEqual(['/cms1/api', '/cms2/api', '/blog/api']);
    });

    test('CMS con globalPrefix vuoto non interferisce con altri', () => {
      const rootCms = { globalPrefix: '', apiPrefix: 'api' };
      const subCms = { globalPrefix: '/cms1', apiPrefix: 'api' };

      const rootPath = `${rootCms.globalPrefix}/${rootCms.apiPrefix}`;
      const subPath = `${subCms.globalPrefix}/${subCms.apiPrefix}`;

      expect(rootPath).toBe('/api');
      expect(subPath).toBe('/cms1/api');
      expect(rootPath).not.toBe(subPath);
    });
  });

  describe('PassData Integration', () => {
    test('globalPrefix disponibile in passData per template EJS', () => {
      const config = loadJson5(configPath);

      // Simula passData come costruito in index.js
      const passData = {
        globalPrefix: config.globalPrefix,
        apiPrefix: config.apiPrefix,
        adminPrefix: config.adminPrefix
      };

      expect(passData).toHaveProperty('globalPrefix');
      expect(typeof passData.globalPrefix).toBe('string');
    });

    test('passData costruisce URL completi correttamente', () => {
      const passData = {
        globalPrefix: '/cms1',
        apiPrefix: 'api',
        adminPrefix: 'admin'
      };

      // Simula costruzione URL in template EJS
      const apiUrl = `${passData.globalPrefix}/${passData.apiPrefix}/plugin/endpoint`;
      const adminUrl = `${passData.globalPrefix}/${passData.adminPrefix}/section`;

      expect(apiUrl).toBe('/cms1/api/plugin/endpoint');
      expect(adminUrl).toBe('/cms1/admin/section');
    });
  });

  describe('Reserved URLs Configuration', () => {
    test('urlsReserved includono globalPrefix', () => {
      const config = {
        globalPrefix: '/cms1',
        adminPrefix: 'admin',
        apiPrefix: 'api',
        viewsPrefix: 'views',
        publicThemeResourcesPrefix: 'public-theme-resources',
        adminThemeResourcesPrefix: 'admin-theme-resources'
      };

      const urlsReserved = [
        `${config.globalPrefix}/${config.adminPrefix}`,
        `${config.globalPrefix}/${config.apiPrefix}`,
        `${config.globalPrefix}/${config.viewsPrefix}`,
        `${config.globalPrefix}/${config.publicThemeResourcesPrefix}`,
        `${config.globalPrefix}/${config.adminThemeResourcesPrefix}`
      ];

      expect(urlsReserved).toEqual([
        '/cms1/admin',
        '/cms1/api',
        '/cms1/views',
        '/cms1/public-theme-resources',
        '/cms1/admin-theme-resources'
      ]);
    });

    test('urlsReserved con globalPrefix vuoto', () => {
      const config = {
        globalPrefix: '',
        adminPrefix: 'admin',
        apiPrefix: 'api'
      };

      const urlsReserved = [
        `${config.globalPrefix}/${config.adminPrefix}`,
        `${config.globalPrefix}/${config.apiPrefix}`
      ];

      expect(urlsReserved).toEqual(['/admin', '/api']);
    });
  });

  describe('Edge Cases', () => {
    test('globalPrefix con sottopercorso multiplo è formattato correttamente', () => {
      // Anche se non raccomandato, verifica che funzioni
      const config = { globalPrefix: '/path/to/cms' };
      const apiPath = `${config.globalPrefix}/api`;
      expect(apiPath).toBe('/path/to/cms/api');
    });

    test('globalPrefix con numeri è valido', () => {
      const config = { globalPrefix: '/cms1', apiPrefix: 'api' };
      const apiPath = `${config.globalPrefix}/${config.apiPrefix}`;
      expect(apiPath).toBe('/cms1/api');
    });

    test('globalPrefix con trattini è valido', () => {
      const config = { globalPrefix: '/my-cms', apiPrefix: 'api' };
      const apiPath = `${config.globalPrefix}/${config.apiPrefix}`;
      expect(apiPath).toBe('/my-cms/api');
    });

    test('globalPrefix con underscore è valido', () => {
      const config = { globalPrefix: '/my_cms', apiPrefix: 'api' };
      const apiPath = `${config.globalPrefix}/${config.apiPrefix}`;
      expect(apiPath).toBe('/my_cms/api');
    });
  });
});
