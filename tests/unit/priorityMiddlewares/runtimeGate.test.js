const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMaintenanceGate, isExemptPath, normalizeExemptPaths } = require('../../../core/priorityMiddlewares/runtimeGate');

describe('isExemptPath', () => {
  test('lets /admin/* through', () => {
    expect(isExemptPath('/admin/index.ejs', 'admin', 'admin-theme-resources', '')).toBe(true);
    expect(isExemptPath('/admin/usersManagment/index.ejs', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  test('lets /admin-theme-resources/* through', () => {
    expect(isExemptPath('/admin-theme-resources/css/theme.css', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  test('intercepts /', () => {
    expect(isExemptPath('/', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  // Senza exemptPaths (lista assente o vuota) /api/* e /pluginPages/* sono
  // intercettati: è il comportamento della sola parte hardcoded del gate.
  // Le esenzioni di login arrivano dalla config (`maintenance.exemptPaths`),
  // coperta dai test più sotto.
  test('intercepts /api/anyplugin/login when no exemptPaths are configured', () => {
    expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '')).toBe(false);
    expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '', [])).toBe(false);
  });

  test('intercepts /pluginPages/* when no exemptPaths are configured', () => {
    expect(isExemptPath('/pluginPages/adminUsers/login.ejs', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('intercepts /public-theme-resources/* (per design)', () => {
    expect(isExemptPath('/public-theme-resources/css/main.css', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('honours custom globalPrefix', () => {
    expect(isExemptPath('/myapp/admin/x', 'admin', 'admin-theme-resources', '/myapp')).toBe(true);
    expect(isExemptPath('/admin/x', 'admin', 'admin-theme-resources', '/myapp')).toBe(false);
  });

  test('honours custom adminPrefix', () => {
    expect(isExemptPath('/backoffice/x', 'backoffice', 'admin-theme-resources', '')).toBe(true);
    expect(isExemptPath('/admin/x', 'backoffice', 'admin-theme-resources', '')).toBe(false);
  });

  describe('exemptPaths (maintenance.exemptPaths)', () => {
    const LOGIN_EXEMPTIONS = ['/pluginPages/adminUsers/login', '/api/adminUsers/login'];

    test('lets configured login paths through', () => {
      expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(true);
      expect(isExemptPath('/pluginPages/adminUsers/login', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(true);
    });

    test('prefix match covers the .ejs form (hideExtension off/on)', () => {
      expect(isExemptPath('/pluginPages/adminUsers/login.ejs', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(true);
    });

    test('still intercepts unrelated public paths', () => {
      expect(isExemptPath('/', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(false);
      expect(isExemptPath('/api/adminUsers/logout', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(false);
      expect(isExemptPath('/api/seo/sitemap.xml', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(false);
      expect(isExemptPath('/pluginPages/media/gallery.ejs', 'admin', 'admin-theme-resources', '', LOGIN_EXEMPTIONS)).toBe(false);
    });

    test('exemptPaths are relative to globalPrefix', () => {
      expect(isExemptPath('/myapp/api/adminUsers/login', 'admin', 'admin-theme-resources', '/myapp', LOGIN_EXEMPTIONS)).toBe(true);
      expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '/myapp', LOGIN_EXEMPTIONS)).toBe(false);
    });

    test('SECURITY: an empty string never exempts the whole site', () => {
      expect(isExemptPath('/', 'admin', 'admin-theme-resources', '', [''])).toBe(false);
      expect(isExemptPath('/any/public/page', 'admin', 'admin-theme-resources', '', [''])).toBe(false);
    });

    test('ignores malformed entries (no leading slash, non-strings)', () => {
      const malformed = ['api/adminUsers/login', 42, null, undefined, {}, ['/x']];
      expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '', malformed)).toBe(false);
    });

    test('tolerates a non-array value', () => {
      expect(isExemptPath('/', 'admin', 'admin-theme-resources', '', 'nope')).toBe(false);
      expect(isExemptPath('/', 'admin', 'admin-theme-resources', '', null)).toBe(false);
    });
  });
});

describe('normalizeExemptPaths', () => {
  test('keeps only non-empty strings starting with /', () => {
    expect(normalizeExemptPaths(['/a', 'b', '', '/c', 7, null, {}])).toEqual(['/a', '/c']);
  });

  test('returns [] for non-array input', () => {
    expect(normalizeExemptPaths(undefined)).toEqual([]);
    expect(normalizeExemptPaths(null)).toEqual([]);
    expect(normalizeExemptPaths('/a')).toEqual([]);
  });
});

describe('createMaintenanceGate', () => {
  function tmpPagePath(html) {
    const p = path.join(os.tmpdir(), `mg-page-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ejs`);
    fs.writeFileSync(p, html, 'utf8');
    return p;
  }

  function fakeCtx(reqPath) {
    return {
      path: reqPath,
      status: 200,
      type: null,
      body: null,
      _headers: {},
      set(name, value) { this._headers[name] = value; },
    };
  }

  test('middleware lets through when state is "running"', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: { adminPrefix: 'admin', adminThemeResourcesPrefix: 'admin-theme-resources' },
      projectRoot: __dirname,
      initialState: 'running',
    });
    const ctx = fakeCtx('/');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(200);
  });

  test('middleware intercepts public routes when stopped', async () => {
    const page = tmpPagePath('<h1>Torniamo subito</h1><p>retry=<%= retryAfterSeconds %></p>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page, retryAfterSeconds: 120 },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      const ctx = fakeCtx('/');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
      expect(ctx._headers['Retry-After']).toBe('120');
      expect(ctx._headers['X-Robots-Tag']).toBe('noindex');
      expect(ctx.body).toContain('Torniamo subito');
      expect(ctx.body).toContain('retry=120');
    } finally { fs.unlinkSync(page); }
  });

  test('middleware lets /admin/* through even when stopped', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      const ctx = fakeCtx('/admin/usersManagment/');
      let nextCalled = false;
      await gate.middleware(ctx, async () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(ctx.status).toBe(200);
    } finally { fs.unlinkSync(page); }
  });

  test('middleware lets configured exemptPaths through when stopped', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: {
            pagePath: page,
            exemptPaths: ['/pluginPages/adminUsers/login', '/api/adminUsers/login'],
          },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });

      // il login passa (l'admin sloggato può rientrare)
      for (const reqPath of ['/api/adminUsers/login', '/pluginPages/adminUsers/login.ejs']) {
        const ctx = fakeCtx(reqPath);
        let nextCalled = false;
        await gate.middleware(ctx, async () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
        expect(ctx.status).toBe(200);
      }

      // il resto del sito pubblico resta in manutenzione
      const ctxPublic = fakeCtx('/');
      await gate.middleware(ctxPublic, async () => { throw new Error('next should not be called'); });
      expect(ctxPublic.status).toBe(503);
    } finally { fs.unlinkSync(page); }
  });

  // Installazioni AGGIORNATE: il merge additivo del boot non propaga le chiavi
  // annidate, quindi `maintenance.exemptPaths` risulta assente. Il gate deve
  // ricadere sui default incorporati, altrimenti chi aggiorna resterebbe senza
  // login raggiungibile durante la manutenzione.
  test('middleware falls back to DEFAULT_EXEMPT_PATHS when the key is absent', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },   // nessun exemptPaths
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });

      const ctxLogin = fakeCtx('/api/adminUsers/login');
      let nextCalled = false;
      await gate.middleware(ctxLogin, async () => { nextCalled = true; });
      expect(nextCalled).toBe(true);

      const ctxPublic = fakeCtx('/');
      await gate.middleware(ctxPublic, async () => { throw new Error('next should not be called'); });
      expect(ctxPublic.status).toBe(503);
    } finally { fs.unlinkSync(page); }
  });

  test('middleware fails closed (and warns) when exemptPaths is not an array', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page, exemptPaths: '/api/adminUsers/login' },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      expect(warn).toHaveBeenCalled();
      const ctx = fakeCtx('/api/adminUsers/login');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
    } finally { warn.mockRestore(); fs.unlinkSync(page); }
  });

  test('middleware keeps blocking login when exemptPaths is empty (max lockdown)', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page, exemptPaths: [] },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      const ctx = fakeCtx('/api/adminUsers/login');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
    } finally { fs.unlinkSync(page); }
  });

  test('setState/getState toggle behaviour live', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'running',
      });
      expect(gate.getState()).toBe('running');

      const ctx1 = fakeCtx('/');
      let called1 = false;
      await gate.middleware(ctx1, async () => { called1 = true; });
      expect(called1).toBe(true);

      gate.setState('stopped');
      expect(gate.getState()).toBe('stopped');
      const ctx2 = fakeCtx('/');
      await gate.middleware(ctx2, async () => { throw new Error('should not be called'); });
      expect(ctx2.status).toBe(503);

      gate.setState('running');
      const ctx3 = fakeCtx('/');
      let called3 = false;
      await gate.middleware(ctx3, async () => { called3 = true; });
      expect(called3).toBe(true);
    } finally { fs.unlinkSync(page); }
  });

  test('setState rejects invalid states', () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'running',
      });
      expect(() => gate.setState('paused')).toThrow();
    } finally { fs.unlinkSync(page); }
  });

  test('falls back to inline HTML when page template is missing', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: {
        adminPrefix: 'admin',
        adminThemeResourcesPrefix: 'admin-theme-resources',
        maintenance: { pagePath: '/nonexistent/page.ejs', retryAfterSeconds: 60 },
      },
      projectRoot: __dirname,
      initialState: 'stopped',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = fakeCtx('/');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
      expect(ctx.body).toContain('Torniamo subito');
    } finally { warn.mockRestore(); }
  });
});
