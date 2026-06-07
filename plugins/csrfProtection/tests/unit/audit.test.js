'use strict';

const { createCtxMock } = require('../../../../core/testHelpers');
const csrf = require('../../main');

function baseCustom(over = {}) {
  return Object.assign({
    enabled: true,
    protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    tokenHeaderName: 'X-CSRF-Token',
    tokenFieldName: '_csrf',
    metaName: 'csrf-token',
    trustProxy: false,
    originCheck: { enabled: true, allowedOrigins: [] },
    exemptPaths: [],
    failureStatus: 403,
    enableLogging: false,
  }, over);
}

describe('csrfProtection · audit / stats / simulate (API per il twin admin)', () => {
  beforeEach(() => {
    csrf._internals._setConfigForTest(baseCustom());
  });

  describe('getStats + recording dei blocchi', () => {
    test('stato iniziale: zero blocchi, flag coerenti', () => {
      const s = csrf._internals.getStats();
      expect(s.enabled).toBe(true);
      expect(s.originCheckEnabled).toBe(true);
      expect(s.totalBlocks).toBe(0);
      expect(s.blocksByReason).toEqual({ missing_or_invalid_token: 0, origin_mismatch: 0 });
    });

    test('una POST senza token incrementa il contatore missing_or_invalid_token', () => {
      const ctx = createCtxMock({ method: 'POST', path: '/api/x', session: {}, headers: {}, host: 'localhost:3000' });
      csrf._internals.validateRequest(ctx);
      const s = csrf._internals.getStats();
      expect(s.totalBlocks).toBe(1);
      expect(s.blocksByReason.missing_or_invalid_token).toBe(1);
      expect(s.blocksByReason.origin_mismatch).toBe(0);
    });

    test('una POST cross-origin con token valido incrementa origin_mismatch', () => {
      const ctx = createCtxMock({
        method: 'POST', path: '/api/x',
        session: { csrfToken: 'T' },
        headers: { 'x-csrf-token': 'T', origin: 'http://evil.com' },
        host: 'localhost:3000', protocol: 'http',
      });
      csrf._internals.validateRequest(ctx);
      const s = csrf._internals.getStats();
      expect(s.totalBlocks).toBe(1);
      expect(s.blocksByReason.origin_mismatch).toBe(1);
    });

    test('una richiesta valida NON incrementa i contatori', () => {
      const ctx = createCtxMock({
        method: 'POST', path: '/api/x',
        session: { csrfToken: 'T' },
        headers: { 'x-csrf-token': 'T', origin: 'http://localhost:3000' },
        host: 'localhost:3000', protocol: 'http',
      });
      expect(csrf._internals.validateRequest(ctx).ok).toBe(true);
      expect(csrf._internals.getStats().totalBlocks).toBe(0);
    });
  });

  describe('getRecentBlocks', () => {
    test('registra i blocchi più recenti per primi, con metadati', () => {
      for (let i = 0; i < 3; i++) {
        const ctx = createCtxMock({ method: 'POST', path: `/api/p${i}`, session: {}, headers: {} });
        csrf._internals.validateRequest(ctx);
      }
      const blocks = csrf._internals.getRecentBlocks(10);
      expect(blocks).toHaveLength(3);
      expect(blocks[0].path).toBe('/api/p2'); // più recente prima
      expect(blocks[0]).toHaveProperty('ts');
      expect(blocks[0]).toHaveProperty('reason', 'missing_or_invalid_token');
      expect(blocks[0]).toHaveProperty('method', 'POST');
    });

    test('rispetta il limite richiesto', () => {
      for (let i = 0; i < 5; i++) {
        csrf._internals.validateRequest(createCtxMock({ method: 'POST', path: '/x', session: {}, headers: {} }));
      }
      expect(csrf._internals.getRecentBlocks(2)).toHaveLength(2);
    });
  });

  describe('simulate (CSRF tester)', () => {
    test('POST same-origin con token valido → consentita', () => {
      const v = csrf._internals.simulate({
        method: 'POST', path: '/api/x',
        siteOrigin: 'https://cms.example.com',
        requestOrigin: 'https://cms.example.com',
        tokenProvided: true,
      });
      expect(v.ok).toBe(true);
    });

    test('POST cross-origin con token valido → bloccata (origin_mismatch)', () => {
      const v = csrf._internals.simulate({
        method: 'POST', path: '/api/x',
        siteOrigin: 'https://cms.example.com',
        requestOrigin: 'https://evil.com',
        tokenProvided: true,
      });
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/origin_mismatch/);
    });

    test('POST senza token → bloccata (missing_or_invalid_token)', () => {
      const v = csrf._internals.simulate({ method: 'POST', path: '/api/x', tokenProvided: false });
      expect(v.ok).toBe(false);
      expect(v.reason).toBe('missing_or_invalid_token');
    });

    test('GET → non controllata (skipped non-mutating)', () => {
      const v = csrf._internals.simulate({ method: 'GET', path: '/whatever' });
      expect(v).toMatchObject({ ok: true, skipped: 'non-mutating' });
    });

    test('il simulatore NON inquina i contatori reali', () => {
      csrf._internals.simulate({ method: 'POST', path: '/api/x', tokenProvided: false });
      expect(csrf._internals.getStats().totalBlocks).toBe(0);
    });
  });

  describe('shared object espone le API admin', () => {
    test('getObjectToShareToOthersPlugin include stats/recent/simulate/reloadConfig', () => {
      const api = csrf.getObjectToShareToOthersPlugin();
      expect(typeof api.getStats).toBe('function');
      expect(typeof api.getRecentBlocks).toBe('function');
      expect(typeof api.simulate).toBe('function');
      expect(typeof api.reloadConfig).toBe('function');
    });
  });
});
