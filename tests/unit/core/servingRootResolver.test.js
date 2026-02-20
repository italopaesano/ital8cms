/**
 * Unit Tests per core/servingRootResolver.js
 *
 * Testa la funzione resolveServingRoot che determina la "serving root"
 * di un file in base al contesto di serving (www, pluginPages, admin).
 */

const path = require('path');
const resolveServingRoot = require('../../../core/servingRootResolver');

// Configurazione di test comune
const PROJECT_ROOT = '/home/user/ital8cms';
const SERVING_PATHS = {
  wwwPath: '/www',
  pluginPagesPath: '/pluginPages',
  adminPagesPath: '/core/admin/webPages',
};

describe('servingRootResolver', () => {

  // ─── Contesto www ───────────────────────────────────────────────────────────

  describe('contesto www', () => {
    test('file nella root di www', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/index.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/www`,
        context: 'www',
      });
    });

    test('file in sottocartella di www', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/pages/about.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/www`,
        context: 'www',
      });
    });

    test('file in sottocartella profonda di www', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/a/b/c/d/deep.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/www`,
        context: 'www',
      });
    });

    test('root www rimane invariata indipendentemente dalla profondita', () => {
      const shallow = resolveServingRoot(
        `${PROJECT_ROOT}/www/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );
      const deep = resolveServingRoot(
        `${PROJECT_ROOT}/www/sub1/sub2/sub3/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(shallow.root).toBe(deep.root);
      expect(shallow.root).toBe(`${PROJECT_ROOT}/www`);
    });
  });

  // ─── Contesto pluginPages ──────────────────────────────────────────────────

  describe('contesto pluginPages', () => {
    test('file di un plugin', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/myPlugin/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/pluginPages/myPlugin`,
        context: 'pluginPages',
      });
    });

    test('file in sottocartella di un plugin', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/exampleComplete/subdir/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/pluginPages/exampleComplete`,
        context: 'pluginPages',
      });
    });

    test('isolamento tra plugin diversi', () => {
      const pluginA = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/pluginA/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );
      const pluginB = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/pluginB/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(pluginA.root).not.toBe(pluginB.root);
      expect(pluginA.root).toBe(`${PROJECT_ROOT}/pluginPages/pluginA`);
      expect(pluginB.root).toBe(`${PROJECT_ROOT}/pluginPages/pluginB`);
    });

    test('file direttamente nella root di pluginPages ritorna null', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/orphan.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toBeNull();
    });
  });

  // ─── Contesto admin ─────────────────────────────────────────────────────────

  describe('contesto admin', () => {
    test('file in una sezione admin', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/index.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/core/admin/webPages/usersManagment`,
        context: 'admin',
      });
    });

    test('file in sottocartella di una sezione admin', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/views/detail.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/core/admin/webPages/usersManagment`,
        context: 'admin',
      });
    });

    test('isolamento tra sezioni admin diverse', () => {
      const users = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/usersManagment/index.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );
      const roles = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/rolesManagment/index.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(users.root).not.toBe(roles.root);
      expect(users.root).toBe(`${PROJECT_ROOT}/core/admin/webPages/usersManagment`);
      expect(roles.root).toBe(`${PROJECT_ROOT}/core/admin/webPages/rolesManagment`);
    });

    test('file alla root dell admin (dashboard) ritorna null', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/index.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toBeNull();
    });
  });

  // ─── Path sconosciuti ──────────────────────────────────────────────────────

  describe('path sconosciuti', () => {
    test('file fuori da qualsiasi contesto ritorna null', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/other/random/file.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toBeNull();
    });

    test('file nella root del progetto ritorna null', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/index.js`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toBeNull();
    });

    test('file in directory plugins (non pluginPages) ritorna null', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/plugins/myPlugin/webPages/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result).toBeNull();
    });
  });

  // ─── Ordine di priorita nella detection ────────────────────────────────────

  describe('ordine di priorita detection', () => {
    test('admin ha priorita su www se i path si sovrappongono', () => {
      // Caso teorico: adminPagesPath contiene wwwPath come sottostringa
      // Il check admin viene prima di www, quindi vince
      const customPaths = {
        wwwPath: '/www',
        pluginPagesPath: '/pluginPages',
        adminPagesPath: '/www/admin/pages', // ipotetico path dentro www
      };

      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/admin/pages/section/index.ejs`,
        PROJECT_ROOT,
        customPaths
      );

      // Admin dovrebbe vincere perche viene controllato per primo
      expect(result).not.toBeNull();
      expect(result.context).toBe('admin');
    });
  });

  // ─── Configurazione custom dei path ────────────────────────────────────────

  describe('configurazione custom dei serving paths', () => {
    test('funziona con wwwPath personalizzato', () => {
      const customPaths = {
        wwwPath: '/public/html',
        pluginPagesPath: '/pluginPages',
        adminPagesPath: '/core/admin/webPages',
      };

      const result = resolveServingRoot(
        `${PROJECT_ROOT}/public/html/index.ejs`,
        PROJECT_ROOT,
        customPaths
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/public/html`,
        context: 'www',
      });
    });

    test('funziona con pluginPagesPath personalizzato', () => {
      const customPaths = {
        wwwPath: '/www',
        pluginPagesPath: '/ext/plugins',
        adminPagesPath: '/core/admin/webPages',
      };

      const result = resolveServingRoot(
        `${PROJECT_ROOT}/ext/plugins/myPlugin/page.ejs`,
        PROJECT_ROOT,
        customPaths
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/ext/plugins/myPlugin`,
        context: 'pluginPages',
      });
    });

    test('funziona con adminPagesPath personalizzato', () => {
      const customPaths = {
        wwwPath: '/www',
        pluginPagesPath: '/pluginPages',
        adminPagesPath: '/admin/views',
      };

      const result = resolveServingRoot(
        `${PROJECT_ROOT}/admin/views/mySection/index.ejs`,
        PROJECT_ROOT,
        customPaths
      );

      expect(result).toEqual({
        root: `${PROJECT_ROOT}/admin/views/mySection`,
        context: 'admin',
      });
    });
  });

  // ─── Struttura del risultato ───────────────────────────────────────────────

  describe('struttura del risultato', () => {
    test('root e sempre un path assoluto', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(path.isAbsolute(result.root)).toBe(true);
    });

    test('context e uno dei valori previsti', () => {
      const validContexts = ['www', 'pluginPages', 'admin'];

      const wwwResult = resolveServingRoot(
        `${PROJECT_ROOT}/www/page.ejs`, PROJECT_ROOT, SERVING_PATHS
      );
      const ppResult = resolveServingRoot(
        `${PROJECT_ROOT}/pluginPages/p/page.ejs`, PROJECT_ROOT, SERVING_PATHS
      );
      const adminResult = resolveServingRoot(
        `${PROJECT_ROOT}/core/admin/webPages/s/page.ejs`, PROJECT_ROOT, SERVING_PATHS
      );

      expect(validContexts).toContain(wwwResult.context);
      expect(validContexts).toContain(ppResult.context);
      expect(validContexts).toContain(adminResult.context);
    });

    test('root non termina con separatore', () => {
      const result = resolveServingRoot(
        `${PROJECT_ROOT}/www/page.ejs`,
        PROJECT_ROOT,
        SERVING_PATHS
      );

      expect(result.root.endsWith(path.sep)).toBe(false);
    });
  });
});
