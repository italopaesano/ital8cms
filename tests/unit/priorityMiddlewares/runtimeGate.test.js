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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESERVED GATE — superficie riservata (tutto cio che sta dietro l'autenticazione)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { createReservedGate, isReservedPrefixPath } = require('../../../core/priorityMiddlewares/runtimeGate');

// Contesto Koa minimo: al gate servono path, status, type, body e set().
function fakeCtx(reqPath) {
  const headers = {};
  return {
    path: reqPath, status: 200, type: null, body: null, headers,
    set(name, value) { headers[name] = value; },
  };
}

describe('isReservedPrefixPath', () => {
  // Specchio esatto di isExemptPath: il maintenance gate ESENTA questi due
  // prefissi, il reserved gate li PRENDE DI MIRA.
  test('targets the admin panel prefix', () => {
    expect(isReservedPrefixPath('/admin', 'admin', 'admin-theme-resources', '')).toBe(true);
    expect(isReservedPrefixPath('/admin/usersManagment/index.ejs', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  // Nessuna regola di accessControl.json5 copre le risorse del tema admin:
  // senza questo caso resterebbero servite a chiunque, rivelando il pannello.
  test('targets the admin theme resources prefix', () => {
    expect(isReservedPrefixPath('/admin-theme-resources/css/theme.css', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  test('leaves the public site alone', () => {
    expect(isReservedPrefixPath('/', 'admin', 'admin-theme-resources', '')).toBe(false);
    expect(isReservedPrefixPath('/chi-siamo.ejs', 'admin', 'admin-theme-resources', '')).toBe(false);
    expect(isReservedPrefixPath('/public-theme-resources/css/main.css', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('honours custom prefixes and globalPrefix', () => {
    expect(isReservedPrefixPath('/myapp/backoffice/x', 'backoffice', 'admin-theme-resources', '/myapp')).toBe(true);
    expect(isReservedPrefixPath('/backoffice/x', 'backoffice', 'admin-theme-resources', '/myapp')).toBe(false);
  });
});

describe('createReservedGate', () => {
  const conf = { adminPrefix: 'admin', adminThemeResourcesPrefix: 'admin-theme-resources', globalPrefix: '' };

  test('running: lets everything through untouched', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'running' });
    const ctx = fakeCtx('/admin');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(200);
    expect(gate.isClosed()).toBe(false);
  });

  test('stopped: answers 404 on the admin prefix, in the site 404 shape', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    const ctx = fakeCtx('/admin/usersManagment/');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(404);
    // Fuori da /api la forma e quella della error page del file server.
    expect(ctx.type).toBe('text/html; charset=utf-8');
    expect(ctx.body).toContain('The requested URL was not found on this server.');
    expect(ctx.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  // Un prefisso non deve catturare i fratelli che gli somigliano: `/admin-guide.ejs`
  // e contenuto pubblico, e prima veniva 404'ato (startsWith senza confine).
  test('stopped: a public sibling of the admin prefix is NOT captured', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    for (const publicPath of ['/admin-guide.ejs', '/administrivia', '/admin-theme-resources-public.css']) {
      const ctx = fakeCtx(publicPath);
      let nextCalled = false;
      await gate.middleware(ctx, async () => { nextCalled = true; });
      expect([publicPath, nextCalled]).toEqual([publicPath, true]);
    }
  });

  // Il router gira con `sensitive:false` e `strict:false`: risponde anche a
  // /API/... e a .../login/. Un confronto esatto lasciava passare proprio quelle
  // forme attraverso allowedMethods() (405/200), riaprendo il canale che
  // l'indice esiste per chiudere.
  test('stopped: route index matches the way the router matches (case + trailing slash)', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    gate.setReservedRoutePaths(new Set(['/api/adminUsers/login']));
    for (const variant of ['/api/adminUsers/login', '/api/adminUsers/login/', '/API/adminUsers/login', '/api/adminusers/LOGIN']) {
      const ctx = fakeCtx(variant);
      let nextCalled = false;
      await gate.middleware(ctx, async () => { nextCalled = true; });
      expect([variant, nextCalled, ctx.status]).toEqual([variant, false, 404]);
    }
  });

  // Sotto /api nessuno static server risponde: il 404 autentico e quello di
  // default di Koa, quindi qui la forma deve essere QUELLA, non la pagina HTML.
  test('stopped: /api paths get the Koa-default 404 shape instead of the HTML page', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    gate.setReservedRoutePaths(new Set(['/api/adminUsers/logged']));
    const ctx = fakeCtx('/api/adminUsers/logged');
    await gate.middleware(ctx, async () => {});
    expect(ctx.status).toBe(404);
    expect(ctx.type).toBe('text/plain; charset=utf-8');
    expect(ctx.body).toBe('Not Found');
    expect(ctx.headers['X-Content-Type-Options']).toBeUndefined();
  });

  test('stopped: still lets the public site through', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    const ctx = fakeCtx('/chi-siamo.ejs');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(200);
  });

  // Il route-wrap di pluginSys non vede il metodo sbagliato: allowedMethods()
  // risponde 405 senza entrare nell'handler, e un 405 dice "questo path esiste".
  // Il gate chiude i path riservati PER PATH, chiudendo anche quel canale.
  test('stopped: closes reserved route paths regardless of method', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    gate.setReservedRoutePaths(new Set(['/api/adminUsers/login', '/api/adminUsers/userList']));
    const ctx = fakeCtx('/api/adminUsers/login');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(404);
  });

  test('stopped: a public route path is not in the index and passes', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    gate.setReservedRoutePaths(new Set(['/api/adminUsers/login']));
    const ctx = fakeCtx('/api/bootstrap/css/bootstrap.min.css');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('setReservedRoutePaths accepts an array too', () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    expect(() => gate.setReservedRoutePaths(['/api/x/y'])).not.toThrow();
    expect(() => gate.setReservedRoutePaths(undefined)).not.toThrow();
  });

  test('setState toggles at runtime and rejects invalid values', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'running' });
    gate.setState('stopped');
    expect(gate.getState()).toBe('stopped');
    expect(gate.isClosed()).toBe(true);
    gate.setState('running');
    expect(gate.isClosed()).toBe(false);
    expect(() => gate.setState('paused')).toThrow(/stato non valido/);
  });

  // deny() e condiviso con pluginSys e adminAccessControl proprio perche' le tre
  // risposte devono essere IDENTICHE: una differenza fra loro tornerebbe a essere
  // un canale di fingerprinting.
  //
  // GUARDIA ANTI-DERIVA: il corpo e gli header qui sotto sono un mirror della
  // error page di koa-classic-server. Il confronto byte per byte con un 404
  // autentico vive nel test d'integrazione; questo fissa il contenuto atteso, in
  // modo che una modifica distratta al mirror non passi inosservata.
  test('deny() mirrors the file server 404 page outside /api', () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    const ctx = fakeCtx('/whatever');
    gate.deny(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.type).toBe('text/html; charset=utf-8');
    expect(Buffer.byteLength(ctx.body, 'utf8')).toBe(325);
    expect(ctx.headers).toEqual({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
  });
});

// Le esenzioni del maintenance gate esistono per far lavorare l'admin durante la
// manutenzione. Se la superficie riservata e chiusa non entra piu nessuno: le
// esenzioni non servono e il loro unico effetto residuo e far rispondere 404 ai
// percorsi esenti mentre tutto il resto risponde 503 — differenza che enumera
// con precisione la superficie riservata.
describe('createMaintenanceGate + reserved closed', () => {
  const conf = {
    adminPrefix: 'admin',
    adminThemeResourcesPrefix: 'admin-theme-resources',
    globalPrefix: '',
    maintenance: { pagePath: path.join(os.tmpdir(), 'nope.ejs'), retryAfterSeconds: 60, exemptPaths: ['/api/adminUsers/login'] },
  };

  function ctxFor(reqPath) {
    return { path: reqPath, status: 200, type: null, body: null, set() {} };
  }

  test('exemptions apply while the reserved surface is open', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: conf, projectRoot: os.tmpdir(), initialState: 'stopped',
      isReservedClosed: () => false,
    });
    for (const exempt of ['/admin/x', '/admin-theme-resources/a.css', '/api/adminUsers/login']) {
      const ctx = ctxFor(exempt);
      let nextCalled = false;
      await gate.middleware(ctx, async () => { nextCalled = true; });
      expect([exempt, nextCalled]).toEqual([exempt, true]);
    }
  });

  test('exemptions are suspended once the reserved surface is closed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gate = createMaintenanceGate({
        ital8Conf: conf, projectRoot: os.tmpdir(), initialState: 'stopped',
        isReservedClosed: () => true,
      });
      for (const formerlyExempt of ['/admin/x', '/admin-theme-resources/a.css', '/api/adminUsers/login']) {
        const ctx = ctxFor(formerlyExempt);
        let nextCalled = false;
        await gate.middleware(ctx, async () => { nextCalled = true; });
        expect([formerlyExempt, nextCalled, ctx.status]).toEqual([formerlyExempt, false, 503]);
      }
    } finally { warn.mockRestore(); }
  });

  test('defaults to exemptions enabled when no predicate is supplied', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: conf, projectRoot: os.tmpdir(), initialState: 'stopped',
    });
    const ctx = ctxFor('/admin/x');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

// Il gate legge quattro valori dal config (globalPrefix, apiPrefix, adminPrefix,
// adminThemeResourcesPrefix). Testarlo solo con i default lascia scoperte le
// installazioni che li personalizzano — dove un errore non darebbe un errore ma
// una superficie silenziosamente aperta, o un sito pubblico silenziosamente chiuso.
describe('createReservedGate — prefissi personalizzati', () => {
  const conf = {
    globalPrefix: '/myapp',
    apiPrefix: 'servizi',
    adminPrefix: 'backoffice',
    adminThemeResourcesPrefix: 'bo-resources',
  };

  function fakeCtxWithHeaders(reqPath) {
    const headers = {};
    return { path: reqPath, status: 200, type: null, body: null, headers, set(n, v) { headers[n] = v; } };
  }

  async function passesThrough(gate, reqPath) {
    const ctx = fakeCtxWithHeaders(reqPath);
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    return { nextCalled, ctx };
  }

  test('chiude i prefissi admin sotto il globalPrefix', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    for (const reqPath of ['/myapp/backoffice', '/myapp/backoffice/utenti/', '/myapp/bo-resources/css/x.css']) {
      const { nextCalled, ctx } = await passesThrough(gate, reqPath);
      expect([reqPath, nextCalled, ctx.status]).toEqual([reqPath, false, 404]);
    }
  });

  // Gli stessi path SENZA globalPrefix non appartengono a questo deploy: chiuderli
  // spegnerebbe contenuto che non c'entra nulla.
  test('non tocca gli stessi prefissi privi di globalPrefix', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    const { nextCalled } = await passesThrough(gate, '/backoffice/utenti');
    expect(nextCalled).toBe(true);
  });

  // La forma della risposta dipende dall'apiPrefix EFFETTIVO: sbagliarlo
  // restituirebbe la pagina HTML dove il sito risponde text/plain (e viceversa),
  // cioe' esattamente la divergenza che rende enumerabile la superficie.
  test('la forma della risposta segue apiPrefix e globalPrefix configurati', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });

    const apiCtx = fakeCtxWithHeaders('/myapp/servizi/adminUsers/logged');
    gate.deny(apiCtx);
    expect(apiCtx.type).toBe('text/plain; charset=utf-8');
    expect(apiCtx.body).toBe('Not Found');

    const pageCtx = fakeCtxWithHeaders('/myapp/backoffice/x');
    gate.deny(pageCtx);
    expect(pageCtx.type).toBe('text/html; charset=utf-8');
    expect(Buffer.byteLength(pageCtx.body, 'utf8')).toBe(325);

    // `/servizi/...` senza globalPrefix non e' l'API di QUESTO deploy: forma pagina.
    const strayCtx = fakeCtxWithHeaders('/servizi/adminUsers/logged');
    gate.deny(strayCtx);
    expect(strayCtx.type).toBe('text/html; charset=utf-8');
  });

  test('senza apiPrefix nel config ricade su "api"', () => {
    const gate = createReservedGate({ ital8Conf: { globalPrefix: '' }, initialState: 'stopped' });
    const ctx = fakeCtxWithHeaders('/api/qualcosa');
    gate.deny(ctx);
    expect(ctx.type).toBe('text/plain; charset=utf-8');
  });
});

// getReservedRoutePaths() deve restituire una COPIA: se restituisse il Set interno,
// un chiamante potrebbe svuotarlo e disarmare il gate senza che nulla lo segnali.
describe('createReservedGate — isolamento dell indice', () => {
  const conf = { adminPrefix: 'admin', adminThemeResourcesPrefix: 'admin-theme-resources', globalPrefix: '' };

  test('mutare il Set passato non altera l indice del gate', async () => {
    const gate = createReservedGate({ ital8Conf: conf, initialState: 'stopped' });
    const source = new Set(['/api/adminUsers/login']);
    gate.setReservedRoutePaths(source);
    source.clear();

    const ctx = { path: '/api/adminUsers/login', status: 200, type: null, body: null, headers: {}, set(n, v) { this.headers[n] = v; } };
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(404);
  });
});
