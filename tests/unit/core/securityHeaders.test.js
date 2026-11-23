/**
 * Unit test: gli header di sicurezza × REVIEW.md → A5.
 *
 * Prima di questo modulo i cinque header comparivano in UN solo posto del
 * progetto — `runtimeGate.js` — cioè sulla pagina di manutenzione e sui rifiuti
 * dei gate. Sito pubblico, pagine dei plugin, pannello admin e API non ne
 * avevano nessuno.
 *
 * Il gruppo di test che conta più degli altri è il primo: il contesto di una
 * richiesta si DERIVA dalla zona del suo path, non da un elenco di prefissi
 * scritto a mano. È la lezione di A1 e A4: un elenco a mano è il difetto che
 * aspetta di tornare, e `views` — che dichiara `requiresAuth` senza chiamarsi
 * « admin » — è il caso che un elenco dimenticherebbe.
 */

'use strict';

const { createSecurityHeaders, contextForZone } = require('../../../core/priorityMiddlewares/securityHeaders');

/** Config minima ma realistica: i prefissi che il resolver usa per le zone. */
function conf(overrides = {}) {
  return {
    adminPrefix: 'admin',
    apiPrefix: 'api',
    viewsPrefix: 'views',
    pluginPagesPrefix: 'pluginPages',
    publicThemeResourcesPrefix: 'public-theme-resources',
    adminThemeResourcesPrefix: 'admin-theme-resources',
    enableAdmin: true,
    securityHeaders: {
      hsts: { enabled: true, maxAge: 86400 },
      wwwPath: { nosniff: true, referrerPolicy: 'strict-origin-when-cross-origin', frameOptions: '', csp: { enabled: false, policy: 'default-src \'self\'' } },
      pluginPages: { nosniff: true, referrerPolicy: 'strict-origin-when-cross-origin', frameOptions: '', csp: { enabled: false, policy: 'default-src \'self\'' } },
      admin: { nosniff: true, referrerPolicy: 'strict-origin-when-cross-origin', frameOptions: 'DENY', csp: { enabled: false, policy: 'default-src \'self\'; script-src \'self\'' } },
    },
    ...overrides,
  };
}

/** Un ctx Koa finto che registra gli header impostati. */
function fakeCtx(reqPath, preset = {}) {
  const headers = { ...preset };
  return {
    path: reqPath,
    response: { get: (name) => headers[name.toLowerCase()] || '' },
    set: (name, value) => { headers[name.toLowerCase()] = value; },
    headers,
  };
}

async function run(sh, ctx, next = async () => {}) {
  await sh.middleware(ctx, next);
  return ctx.headers;
}

// ── Il contesto si deriva dalle zone ─────────────────────────────────────────

describe('il contesto si deriva dalla ZONA, non da un elenco di prefissi', () => {
  const sh = createSecurityHeaders({ ital8Conf: conf() });

  test.each([
    ['/index.ejs',                       'wwwPath',     'il sito'],
    ['/qualsiasi/pagina.ejs',            'wwwPath',     'una pagina qualunque'],
    ['/public-theme-resources/a.css',    'wwwPath',     'risorse del tema pubblico'],
    ['/api/adminUsers/logged',           'wwwPath',     'le api'],
    ['/pluginPages/x/y.ejs',             'pluginPages', 'le pagine dei plugin'],
    ['/admin/',                          'admin',       'il pannello'],
    ['/admin/usersManagment/index.ejs',  'admin',       'una sezione del pannello'],
    ['/admin-theme-resources/css/a.css', 'admin',       'risorse del tema admin'],
    ['/views/x.ejs',                     'admin',       'views: requiresAuth senza chiamarsi admin'],
  ])('%s → contesto %s (%s)', (reqPath, atteso) => {
    expect(sh.settingsFor(reqPath).context).toBe(atteso);
  });

  test('una zona senza baseline chiuso NON diventa admin', () => {
    expect(contextForZone({ name: 'site', baseline: { requiresAuth: false } })).toBe('wwwPath');
    expect(contextForZone(null)).toBe('wwwPath');
  });

  test('qualunque zona che dichiari requiresAuth eredita il contesto admin', () => {
    // Il punto della derivazione: una zona NUOVA non va aggiunta a nessun elenco.
    expect(contextForZone({ name: 'zonaInventata', baseline: { requiresAuth: true } })).toBe('admin');
  });
});

// ── Quali header, su quale superficie ────────────────────────────────────────

describe('gli header emessi', () => {
  test('nosniff e Referrer-Policy su ogni superficie', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    for (const p of ['/index.ejs', '/pluginPages/a.ejs', '/admin/', '/api/x']) {
      const h = await run(sh, fakeCtx(p));
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    }
  });

  test('X-Frame-Options: DENY SOLO sulle superfici riservate', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });

    expect((await run(sh, fakeCtx('/admin/'))) ['x-frame-options']).toBe('DENY');
    expect((await run(sh, fakeCtx('/admin-theme-resources/a.css')))['x-frame-options']).toBe('DENY');
    // Il sito pubblico resta inquadrabile: una pagina pubblica può legittimamente
    // essere embeddata, e deciderlo al posto di chi costruisce il sito sarebbe
    // arbitrario.
    expect((await run(sh, fakeCtx('/index.ejs')))['x-frame-options']).toBeUndefined();
    expect((await run(sh, fakeCtx('/pluginPages/a.ejs')))['x-frame-options']).toBeUndefined();
  });

  test('la CSP è SPENTA di serie, anche se la policy è configurata', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    for (const p of ['/index.ejs', '/admin/']) {
      expect((await run(sh, fakeCtx(p)))['content-security-policy']).toBeUndefined();
    }
  });

  test('accesa, la CSP esce con la policy del suo contesto', async () => {
    const c = conf();
    c.securityHeaders.admin.csp.enabled = true;
    c.securityHeaders.wwwPath.csp.enabled = true;
    const sh = createSecurityHeaders({ ital8Conf: c });

    expect((await run(sh, fakeCtx('/admin/')))['content-security-policy']).toContain("script-src 'self'");
    expect((await run(sh, fakeCtx('/index.ejs')))['content-security-policy']).toBe("default-src 'self'");
  });

  test('accesa ma senza policy non emette un header vuoto', async () => {
    const c = conf();
    c.securityHeaders.admin.csp = { enabled: true, policy: '' };
    const sh = createSecurityHeaders({ ital8Conf: c });
    expect((await run(sh, fakeCtx('/admin/')))['content-security-policy']).toBeUndefined();
  });
});

// ── HSTS ─────────────────────────────────────────────────────────────────────

describe('HSTS — solo con HTTPS, e non per contesto', () => {
  test('in HTTP puro NON viene emesso', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf({ https: { enabled: false } }) });
    expect((await run(sh, fakeCtx('/index.ejs')))['strict-transport-security']).toBeUndefined();
  });

  test('con https.enabled viene emesso su ogni contesto', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf({ https: { enabled: true } }) });
    for (const p of ['/index.ejs', '/pluginPages/a.ejs', '/admin/']) {
      expect((await run(sh, fakeCtx(p)))['strict-transport-security']).toBe('max-age=86400');
    }
  });

  test('senza config esplicita il max-age è prudente, non di un anno', async () => {
    const c = conf({ https: { enabled: true } });
    delete c.securityHeaders.hsts;
    const sh = createSecurityHeaders({ ital8Conf: c });
    expect((await run(sh, fakeCtx('/index.ejs')))['strict-transport-security']).toBe('max-age=86400');
  });

  test('si può spegnere anche con HTTPS attivo', async () => {
    const c = conf({ https: { enabled: true } });
    c.securityHeaders.hsts.enabled = false;
    const sh = createSecurityHeaders({ ital8Conf: c });
    expect((await run(sh, fakeCtx('/index.ejs')))['strict-transport-security']).toBeUndefined();
  });
});

// ── Non sovrascrive ──────────────────────────────────────────────────────────

describe('non sovrascrive ciò che un plugin ha già impostato', () => {
  test('un header già presente resta quello del plugin', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    const ctx = fakeCtx('/admin/', { 'x-frame-options': 'SAMEORIGIN' });

    const h = await run(sh, ctx);

    expect(h['x-frame-options']).toBe('SAMEORIGIN');       // non toccato
    expect(h['x-content-type-options']).toBe('nosniff');   // gli assenti sì
  });

  test('l\'header viene impostato DOPO l\'handler, altrimenti il no-overwrite non vedrebbe nulla', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    const ctx = fakeCtx('/index.ejs');

    // L'handler imposta il suo Referrer-Policy mentre la richiesta è in volo.
    await sh.middleware(ctx, async () => { ctx.set('Referrer-Policy', 'no-referrer'); });

    expect(ctx.headers['referrer-policy']).toBe('no-referrer');
  });
});

// ── Le risposte di errore ────────────────────────────────────────────────────

describe('copertura delle risposte di errore', () => {
  test('una risposta di errore NON eccezionale (404 assegnato) riceve gli header', async () => {
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    const ctx = fakeCtx('/non-esiste.ejs');

    await sh.middleware(ctx, async () => { ctx.status = 404; });

    expect(ctx.headers['x-content-type-options']).toBe('nosniff');
  });

  test('se l\'handler LANCIA, gli header vengono impostati comunque e l\'errore si propaga', async () => {
    // Il `finally` fa la sua parte; che poi Koa li rimuova in `ctx.onerror` è un
    // limite del framework, dichiarato nel modulo e nella doc.
    const sh = createSecurityHeaders({ ital8Conf: conf() });
    const ctx = fakeCtx('/index.ejs');

    await expect(sh.middleware(ctx, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(ctx.headers['x-content-type-options']).toBe('nosniff');
  });
});
