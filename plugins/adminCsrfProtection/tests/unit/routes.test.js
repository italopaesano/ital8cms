/**
 * Unit test delle route di adminCsrfProtection.
 * L'oggetto condiviso di csrfProtection è mockato via createPluginSysMock.
 * La cartella del servizio (config + backup) è una sandbox in os.tmpdir().
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPluginSysMock, createCtxMock, runRoute, validateRoute } = require('../../../../core/testHelpers');
const loadJson5 = require('../../../../core/loadJson5');
const plugin = require('../../main.js');

const mockCsrf = {
  getStats: () => ({
    enabled: true,
    originCheckEnabled: true,
    protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    exemptCount: 0,
    totalBlocks: 2,
    blocksByReason: { missing_or_invalid_token: 1, origin_mismatch: 1 },
  }),
  getRecentBlocks: (limit) => ([
    { ts: '2026-06-07T10:00:00.000Z', method: 'POST', path: '/api/x', reason: 'missing_or_invalid_token', ip: '1.2.3.4' },
    { ts: '2026-06-07T10:00:01.000Z', method: 'POST', path: '/api/y', reason: 'origin_mismatch:origin', ip: '5.6.7.8' },
  ].slice(0, limit || 100)),
  simulate: (input) => {
    if (String(input.method).toUpperCase() === 'GET') return { ok: true, skipped: 'non-mutating' };
    if (input.requestOrigin === 'https://evil.com') return { ok: false, status: 403, reason: 'origin_mismatch:origin' };
    if (!input.tokenProvided) return { ok: false, status: 403, reason: 'missing_or_invalid_token' };
    return { ok: true };
  },
  validateConfig: (cfg) => (cfg && typeof cfg === 'object' && typeof cfg.enabled === 'boolean'
    ? { valid: true, errors: [], warnings: [] }
    : { valid: false, errors: ['enabled (boolean) mancante'], warnings: [] }),
  reloadConfig: jest.fn(() => ({ enabled: true })),
};

const routeOf = (routes, method, p) => routes.find((r) => r.method === method && r.path === p);

let sandbox;

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csrfsvc-'));
  fs.writeFileSync(
    path.join(dir, 'pluginConfig.json5'),
    '// header\n{\n  "active": 1,\n  "isInstalled": 1,\n  "weight": 0,\n  "custom": {\n    "enabled": true,\n    "failureStatus": 403\n  }\n}\n',
  );
  return dir;
}

describe('adminCsrfProtection — routes (csrfProtection attivo)', () => {
  let routes;
  beforeAll(async () => {
    sandbox = makeSandbox();
    const mock = createPluginSysMock({
      sharedObjects: { csrfProtection: mockCsrf },
      plugins: { csrfProtection: { pathPluginFolder: sandbox } },
    });
    await plugin.loadPlugin(mock, sandbox); // 2° arg = ownFolder → backup in sandbox
    routes = plugin.getRouteArray();
  });

  afterAll(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

  test('tutte le route hanno struttura valida e access [0,1]', () => {
    routes.forEach((r) => {
      expect(validateRoute(r)).toEqual([]);
      expect(r.access.requiresAuth).toBe(true);
      expect(r.access.allowedRoles).toEqual([0, 1]);
    });
  });

  test('GET /status → enabled + stats', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/status'), createCtxMock({ path: '/status' }));
    expect(ctx.body.enabled).toBe(true);
    expect(ctx.body.stats.totalBlocks).toBe(2);
    expect(ctx.body.stats.blocksByReason.origin_mismatch).toBe(1);
  });

  test('GET /recent → blocchi recenti (rispetta limit)', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/recent'), createCtxMock({ path: '/recent', query: { limit: '1' } }));
    expect(ctx.body.enabled).toBe(true);
    expect(ctx.body.blocks).toHaveLength(1);
    expect(ctx.body.blocks[0].path).toBe('/api/x');
  });

  test('POST /simulate → verdetto (cross-origin bloccato)', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/simulate'),
      createCtxMock({ method: 'POST', path: '/simulate', body: { method: 'POST', path: '/api/x', requestOrigin: 'https://evil.com', tokenProvided: true } }),
    );
    expect(ctx.body.success).toBe(true);
    expect(ctx.body.verdict.ok).toBe(false);
    expect(ctx.body.verdict.reason).toMatch(/origin_mismatch/);
  });

  test('GET /config → contenuto del blocco custom', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/config'), createCtxMock({ path: '/config' }));
    expect(ctx.body.enabled).toBe(true);
    const parsed = JSON.parse(ctx.body.content);
    expect(parsed.enabled).toBe(true);
    expect(parsed.failureStatus).toBe(403);
  });

  test('POST /validate-config → valido per JSON5 corretto', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/validate-config'),
      createCtxMock({ method: 'POST', path: '/validate-config', body: { content: '{ "enabled": true }' } }),
    );
    expect(ctx.body.valid).toBe(true);
  });

  test('POST /validate-config → errore per JSON5 malformato', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/validate-config'),
      createCtxMock({ method: 'POST', path: '/validate-config', body: { content: '{ enabled: }' } }),
    );
    expect(ctx.body.valid).toBe(false);
    expect(ctx.body.errors.join()).toMatch(/JSON5/);
  });

  test('POST /config → salva, scrive il file e chiama reloadConfig', async () => {
    const before = mockCsrf.reloadConfig.mock.calls.length;
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{ "enabled": true, "failureStatus": 419 }' } }),
    );
    expect(ctx.body.success).toBe(true);
    expect(mockCsrf.reloadConfig.mock.calls.length).toBe(before + 1);
    // Il file del servizio è stato aggiornato (editJson5 del solo blocco custom)
    const cfg = loadJson5(path.join(sandbox, 'pluginConfig.json5'));
    expect(cfg.custom.failureStatus).toBe(419);
    expect(cfg.active).toBe(1); // resto del file preservato
    // backup creato nella sandbox (non nel repo)
    expect(fs.existsSync(path.join(sandbox, 'backups'))).toBe(true);
  });

  test('POST /config → rifiuta JSON5 malformato (400)', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{ nope' } }),
    );
    expect(ctx.status).toBe(400);
    expect(ctx.body.success).toBe(false);
  });
});

describe('adminCsrfProtection — routes (csrfProtection disattivo)', () => {
  let routes;
  beforeAll(async () => {
    const mock = createPluginSysMock({ sharedObjects: {}, plugins: {} }); // getSharedObject → null
    await plugin.loadPlugin(mock, null);
    routes = plugin.getRouteArray();
  });

  test('GET /status → enabled:false', async () => {
    const ctx = await runRoute(routeOf(routes, 'GET', '/status'), createCtxMock({ path: '/status' }));
    expect(ctx.body.enabled).toBe(false);
  });

  test('POST /simulate → 409 (servizio assente)', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/simulate'),
      createCtxMock({ method: 'POST', path: '/simulate', body: {} }),
    );
    expect(ctx.status).toBe(409);
    expect(ctx.body.success).toBe(false);
  });

  test('POST /config → 409 (servizio assente)', async () => {
    const ctx = await runRoute(
      routeOf(routes, 'POST', '/config'),
      createCtxMock({ method: 'POST', path: '/config', body: { content: '{}' } }),
    );
    expect(ctx.status).toBe(409);
  });
});
