/**
 * Unit test delle route di adminRateLimiter (Vista Dati, Step 2).
 * L'oggetto condiviso di rateLimiter è mockato via createPluginSysMock.
 */

'use strict';

const { createPluginSysMock, createCtxMock, runRoute, validateRoute } = require('../../../../core/testHelpers');
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
});
