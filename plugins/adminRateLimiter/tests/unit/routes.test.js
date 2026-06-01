/**
 * Unit test delle route di adminRateLimiter (Vista Dati, Step 2).
 * L'oggetto condiviso di rateLimiter è mockato via createPluginSysMock.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPluginSysMock, createCtxMock, runRoute, validateRoute } = require('../../../../core/testHelpers');
const loadJson5 = require('../../../../core/loadJson5');
const plugin = require('../../main.js');

const mockRl = {
  getStats: () => ({ enabled: true, enforcementEnabled: true, activeBlocks: 1, shortBlocks: 1, longBlocks: 0, ruleCount: 2 }),
  getActiveBlocks: () => ([
    { clientId: '1.2.3.4', ruleName: 'adminLogin', tier: 'short', shortBlockCount: 1, blockedUntil: Date.now() + 300000, retryAfterSeconds: 300 },
  ]),
  getRecentAttempts: (opts) => {
    const all = [
      { ts: '2026-06-01T10:00:00.000Z', event: 'failure', clientId: '1.2.3.4', ruleName: 'adminLogin' },
      { ts: '2026-06-01T10:00:01.000Z', event: 'shortBlock', clientId: '1.2.3.4', ruleName: 'adminLogin' },
    ];
    return all.slice(0, opts && opts.limit ? opts.limit : 100);
  },
  getRuleNames: () => ['adminLogin', 'downloads'],
  releaseBlock: () => true,
  banClient: (clientId, ruleName, opts) => ({ blocked: true, tier: (opts && opts.tier) || 'long', retryAfterSeconds: (opts && opts.seconds) || 86400 }),
  validateRules: (data) => {
    if (!data || !Array.isArray(data.rules)) return { valid: false, errors: ['rules array mancante'], warnings: [] };
    const bad = data.rules.find((r) => !r || typeof r.name !== 'string' || r.name.length === 0);
    if (bad) return { valid: false, errors: ['regola senza name valido'], warnings: [] };
    return { valid: true, errors: [], warnings: [] };
  },
  reloadRules: jest.fn(() => new Map()),
  validateConfig: (cfg) => {
    if (!cfg || typeof cfg !== 'object' || !cfg.defaults) return { valid: false, errors: ['defaults mancante'], warnings: [] };
    return { valid: true, errors: [], warnings: [] };
  },
  reloadConfig: jest.fn(() => ({ enabled: true })),
};

const routeOf = (routes, method, path) => routes.find((r) => r.method === method && r.path === path);

describe('adminRateLimiter — routes (rateLimiter attivo)', () => {
  let routes;
  beforeAll(async () => {
    await plugin.loadPlugin(createPluginSysMock({ sharedObjects: { rateLimiter: mockRl } }), null);
    routes = plugin.getRouteArray();
  });

  test('tutte le route hanno struttura valida e access [0,1]', () => {
    routes.forEach((r) => {
      expect(validateRoute(r)).toEqual([]);
      expect(r.access.requiresAuth).toBe(true);
      expect(r.access.allowedRoles).toEqual([0, 1]);
    });
  });

  test('GET /status restituisce stato + statistiche + blocchi', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/status'), createCtxMock({ path: '/status' }));
    expect(ctx.body.enabled).toBe(true);
    expect(ctx.body.stats.ruleCount).toBe(2);
    expect(ctx.body.stats.enforcementEnabled).toBe(true);
    expect(ctx.body.activeBlocks).toHaveLength(1);
    expect(ctx.body.activeBlocks[0].clientId).toBe('1.2.3.4');
    expect(ctx.body.ruleNames).toEqual(['adminLogin', 'downloads']);
  });

  test('POST /unblock sblocca con clientId+ruleName', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/unblock'),
      createCtxMock({ method: 'POST', path: '/unblock', body: { clientId: '1.2.3.4', ruleName: 'adminLogin' } }));
    expect(ctx.body.success).toBe(true);
    expect(ctx.body.released).toBe(true);
  });

  test('POST /unblock senza input → 400', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/unblock'),
      createCtxMock({ method: 'POST', path: '/unblock', body: {} }));
    expect(ctx.status).toBe(400);
    expect(ctx.body.success).toBe(false);
  });

  test('POST /ban banna con durata', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/ban'),
      createCtxMock({ method: 'POST', path: '/ban', body: { clientId: '9.9.9.9', ruleName: 'adminLogin', seconds: 600 } }));
    expect(ctx.body.success).toBe(true);
    expect(ctx.body.verdict.blocked).toBe(true);
    expect(ctx.body.verdict.retryAfterSeconds).toBe(600);
  });

  test('POST /ban senza input → 400', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/ban'),
      createCtxMock({ method: 'POST', path: '/ban', body: { clientId: '9.9.9.9' } }));
    expect(ctx.status).toBe(400);
    expect(ctx.body.success).toBe(false);
  });

  test('GET /attempts restituisce l\'audit log', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/attempts'), createCtxMock({ path: '/attempts', query: { limit: '50' } }));
    expect(ctx.body.enabled).toBe(true);
    expect(Array.isArray(ctx.body.attempts)).toBe(true);
    expect(ctx.body.attempts.length).toBeGreaterThan(0);
    expect(ctx.body.attempts[0]).toHaveProperty('event');
  });

  test('GET /attempts rispetta il parametro limit', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/attempts'), createCtxMock({ path: '/attempts', query: { limit: '1' } }));
    expect(ctx.body.attempts).toHaveLength(1);
  });

  test('getObjectToShareToWebPages espone i parametri UI', () => {
    const shared = plugin.getObjectToShareToWebPages();
    expect(typeof shared.autoRefreshSeconds).toBe('number');
    expect(typeof shared.auditLimit).toBe('number');
  });
});

describe('adminRateLimiter — routes (rateLimiter disattivato)', () => {
  let routes;
  beforeAll(async () => {
    // nessun rateLimiter tra gli sharedObjects → getSharedObject('rateLimiter') === null
    await plugin.loadPlugin(createPluginSysMock({ sharedObjects: {} }), null);
    routes = plugin.getRouteArray();
  });

  test('GET /status → enabled:false', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/status'), createCtxMock({ path: '/status' }));
    expect(ctx.body.enabled).toBe(false);
  });

  test('GET /attempts → enabled:false, attempts vuoto', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/attempts'), createCtxMock({ path: '/attempts' }));
    expect(ctx.body.enabled).toBe(false);
    expect(ctx.body.attempts).toEqual([]);
  });

  test('POST /unblock → 409 quando il servizio è disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/unblock'),
      createCtxMock({ method: 'POST', path: '/unblock', body: { clientId: '1.2.3.4', ruleName: 'adminLogin' } }));
    expect(ctx.status).toBe(409);
    expect(ctx.body.success).toBe(false);
  });

  test('POST /ban → 409 quando il servizio è disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/ban'),
      createCtxMock({ method: 'POST', path: '/ban', body: { clientId: '9.9.9.9', ruleName: 'adminLogin', seconds: 600 } }));
    expect(ctx.status).toBe(409);
    expect(ctx.body.success).toBe(false);
  });

  test('POST /validate-rules → 409 quando disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/validate-rules'),
      createCtxMock({ method: 'POST', path: '/validate-rules', body: { content: '{}' } }));
    expect(ctx.status).toBe(409);
  });

  test('POST /rules → 409 quando disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/rules'),
      createCtxMock({ method: 'POST', path: '/rules', body: { content: '{}' } }));
    expect(ctx.status).toBe(409);
  });

  test('POST /validate-config → 409 quando disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/validate-config'),
      createCtxMock({ method: 'POST', path: '/validate-config', body: { content: '{}' } }));
    expect(ctx.status).toBe(409);
  });

  test('POST /config → 409 quando disattivato', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{}' } }));
    expect(ctx.status).toBe(409);
  });
});

describe('adminRateLimiter — Regole (editor JSON5, Step 4)', () => {
  let routes;
  let rlFolder;
  let ownFolder;
  const INITIAL = '// header\n{ "rules": [ { "name": "adminLogin" } ] }\n';

  beforeAll(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-arl-rules-'));
    rlFolder = path.join(base, 'rateLimiter');
    ownFolder = path.join(base, 'adminRateLimiter');
    fs.mkdirSync(rlFolder, { recursive: true });
    fs.mkdirSync(ownFolder, { recursive: true });
    fs.writeFileSync(path.join(rlFolder, 'protectedRoutes.json5'), INITIAL);

    const pluginSys = createPluginSysMock({
      sharedObjects: { rateLimiter: mockRl },
      plugins: { rateLimiter: { pathPluginFolder: rlFolder } },
    });
    await plugin.loadPlugin(pluginSys, ownFolder);
    routes = plugin.getRouteArray();
  });

  afterAll(() => {
    const base = path.dirname(rlFolder);
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  });

  test('GET /rules restituisce il contenuto grezzo', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/rules'), createCtxMock({ path: '/rules' }));
    expect(ctx.body.enabled).toBe(true);
    expect(ctx.body.content).toContain('"name": "adminLogin"');
  });

  test('POST /validate-rules: contenuto valido', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/validate-rules'),
      createCtxMock({ method: 'POST', path: '/validate-rules', body: { content: '{ "rules": [ { "name": "x" } ] }' } }));
    expect(ctx.body.valid).toBe(true);
  });

  test('POST /validate-rules: JSON5 non valido', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/validate-rules'),
      createCtxMock({ method: 'POST', path: '/validate-rules', body: { content: '{ rules: [ ' } }));
    expect(ctx.body.valid).toBe(false);
    expect(ctx.body.errors.join(' ')).toMatch(/JSON5/);
  });

  test('POST /validate-rules: regole invalide (name mancante)', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/validate-rules'),
      createCtxMock({ method: 'POST', path: '/validate-rules', body: { content: '{ "rules": [ { } ] }' } }));
    expect(ctx.body.valid).toBe(false);
  });

  test('POST /rules salva, fa backup e ricarica', async () => {
    const before = mockRl.reloadRules.mock.calls.length;
    const newContent = '{ "rules": [ { "name": "adminLogin", "maxFailures": 7 } ] }\n';
    const ctx = await runRoute(routeOf(routes, 'POST', '/rules'),
      createCtxMock({ method: 'POST', path: '/rules', body: { content: newContent } }));
    expect(ctx.body.success).toBe(true);
    expect(fs.readFileSync(path.join(rlFolder, 'protectedRoutes.json5'), 'utf8')).toBe(newContent);
    const baks = fs.readdirSync(path.join(ownFolder, 'backups')).filter((f) => f.endsWith('.bak'));
    expect(baks.length).toBeGreaterThanOrEqual(1);
    expect(mockRl.reloadRules.mock.calls.length).toBeGreaterThan(before);
  });

  test('POST /rules: JSON5 non valido → 400', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/rules'),
      createCtxMock({ method: 'POST', path: '/rules', body: { content: '{ bad ' } }));
    expect(ctx.status).toBe(400);
    expect(ctx.body.success).toBe(false);
  });

  test('POST /rules: regole invalide → 400', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/rules'),
      createCtxMock({ method: 'POST', path: '/rules', body: { content: '{ "rules": [ { } ] }' } }));
    expect(ctx.status).toBe(400);
    expect(ctx.body.success).toBe(false);
  });
});

describe('adminRateLimiter — Impostazioni (editor JSON5, Step 5)', () => {
  let routes;
  let rlFolder;
  let ownFolder;
  let requestRestart;
  const PLUGIN_CONFIG = '// header\n{\n  "active": 1,\n  "isInstalled": 1,\n  "custom": {\n    "enabled": true,\n    "defaults": { "maxFailures": 5 },\n  },\n}\n';

  beforeAll(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-arl-cfg-'));
    rlFolder = path.join(base, 'rateLimiter');
    ownFolder = path.join(base, 'adminRateLimiter');
    fs.mkdirSync(rlFolder, { recursive: true });
    fs.mkdirSync(ownFolder, { recursive: true });
    fs.writeFileSync(path.join(rlFolder, 'pluginConfig.json5'), PLUGIN_CONFIG);

    const ps = createPluginSysMock({
      sharedObjects: { rateLimiter: mockRl },
      plugins: { rateLimiter: { pathPluginFolder: rlFolder } },
    });
    requestRestart = jest.fn(() => true);
    ps.requestRestart = requestRestart;
    await plugin.loadPlugin(ps, ownFolder);
    routes = plugin.getRouteArray();
  });

  afterAll(() => {
    const base = path.dirname(rlFolder);
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  });

  test('GET /config restituisce il blocco custom serializzato', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/config'), createCtxMock({ path: '/config' }));
    expect(ctx.body.enabled).toBe(true);
    expect(JSON.parse(ctx.body.content).defaults.maxFailures).toBe(5);
  });

  test('POST /validate-config: valido e invalido', async () => {
    const ok = await runRoute(routeOf(routes, 'POST', '/validate-config'),
      createCtxMock({ method: 'POST', path: '/validate-config', body: { content: '{ "enabled": true, "defaults": { "maxFailures": 3 } }' } }));
    expect(ok.body.valid).toBe(true);
    const bad = await runRoute(routeOf(routes, 'POST', '/validate-config'),
      createCtxMock({ method: 'POST', path: '/validate-config', body: { content: '{ "enabled": true }' } }));
    expect(bad.body.valid).toBe(false);
  });

  test('POST /config aggiorna solo il blocco custom (preserva il resto) e ricarica', async () => {
    const before = mockRl.reloadConfig.mock.calls.length;
    const ctx = await runRoute(routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{ "enabled": true, "defaults": { "maxFailures": 9 } }' } }));
    expect(ctx.body.success).toBe(true);

    const after = loadJson5(path.join(rlFolder, 'pluginConfig.json5'));
    expect(after.custom.defaults.maxFailures).toBe(9); // custom aggiornato
    expect(after.active).toBe(1);                       // resto del file preservato
    expect(after.isInstalled).toBe(1);

    const baks = fs.readdirSync(path.join(ownFolder, 'backups')).filter((f) => f.endsWith('.bak'));
    expect(baks.length).toBeGreaterThanOrEqual(1);
    expect(mockRl.reloadConfig.mock.calls.length).toBeGreaterThan(before);
  });

  test('POST /config: JSON5 non valido → 400', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{ bad ' } }));
    expect(ctx.status).toBe(400);
  });

  test('POST /restart invoca pluginSys.requestRestart', async () => {
    const ctx = await runRoute(routeOf(routes, 'POST', '/restart'), createCtxMock({ method: 'POST', path: '/restart', body: {} }));
    expect(ctx.body.success).toBe(true);
    expect(requestRestart).toHaveBeenCalled();
  });
});
