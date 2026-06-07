'use strict';

const { createCtxMock } = require('../../../../core/testHelpers');
const PatternMatcher = require('../../../../core/patternMatcher');
const requestGuard = require('../../lib/requestGuard');

const matcher = new PatternMatcher();
const TOKEN = 'SECRET_TOKEN_abc123';

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
  }, over);
}

// Helper: ctx di una POST same-origin valida (token in header + Origin corretto)
function validPostCtx(over = {}) {
  return createCtxMock(Object.assign({
    method: 'POST',
    path: '/api/adminUsers/usertUser',
    protocol: 'http',
    host: 'localhost:3000',
    session: { csrfToken: TOKEN },
    headers: { 'x-csrf-token': TOKEN, origin: 'http://localhost:3000' },
  }, over));
}

describe('csrfProtection · requestGuard.evaluate', () => {
  describe('skip / pass-through', () => {
    test('plugin disabilitato → ok (skipped:disabled)', () => {
      const ctx = validPostCtx({ headers: {}, session: null });
      expect(requestGuard.evaluate(ctx, baseCustom({ enabled: false }), matcher)).toMatchObject({ ok: true, skipped: 'disabled' });
    });

    test('metodo GET non mutante → ok (skipped:non-mutating)', () => {
      const ctx = createCtxMock({ method: 'GET', path: '/api/adminUsers/userList', session: { csrfToken: TOKEN } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: true, skipped: 'non-mutating' });
    });

    test('HEAD e OPTIONS non mutanti → ok', () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        const ctx = createCtxMock({ method, path: '/x' });
        expect(requestGuard.evaluate(ctx, baseCustom(), matcher).ok).toBe(true);
      }
    });

    test('path esente → ok (skipped:exempt) anche senza token', () => {
      const ctx = createCtxMock({ method: 'POST', path: '/api/webhook/stripe', session: null, headers: {} });
      const custom = baseCustom({ exemptPaths: ['/api/webhook/**'] });
      expect(requestGuard.evaluate(ctx, custom, matcher)).toMatchObject({ ok: true, skipped: 'exempt' });
    });
  });

  describe('token sincronizzatore', () => {
    test('POST valida (token in header) → ok', () => {
      expect(requestGuard.evaluate(validPostCtx(), baseCustom(), matcher)).toEqual({ ok: true });
    });

    test('POST valida (token nel body _csrf) → ok', () => {
      const ctx = validPostCtx({ headers: { origin: 'http://localhost:3000' }, body: { _csrf: TOKEN } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toEqual({ ok: true });
    });

    test('manca il token in sessione → blocco', () => {
      const ctx = validPostCtx({ session: {} });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: false, status: 403, reason: 'missing_or_invalid_token' });
    });

    test('manca il token nella richiesta → blocco', () => {
      const ctx = validPostCtx({ headers: { origin: 'http://localhost:3000' } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: false, reason: 'missing_or_invalid_token' });
    });

    test('token della richiesta diverso da quello di sessione → blocco', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': 'WRONG', origin: 'http://localhost:3000' } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: false, reason: 'missing_or_invalid_token' });
    });

    test('failureStatus personalizzato è rispettato', () => {
      const ctx = validPostCtx({ session: {} });
      expect(requestGuard.evaluate(ctx, baseCustom({ failureStatus: 419 }), matcher).status).toBe(419);
    });
  });

  describe('controllo Origin/Referer', () => {
    test('Origin cross-site con token valido → blocco (origin_mismatch)', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': TOKEN, origin: 'http://evil.com' } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: false, reason: 'origin_mismatch:origin' });
    });

    test('Referer cross-site con token valido → blocco', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': TOKEN, referer: 'http://evil.com/x' } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toMatchObject({ ok: false, reason: 'origin_mismatch:referer' });
    });

    test('né Origin né Referer + token valido → ok (token-fallback)', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': TOKEN } });
      expect(requestGuard.evaluate(ctx, baseCustom(), matcher)).toEqual({ ok: true });
    });

    test('originCheck.enabled=false → Origin cross-site ignorato (basta il token)', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': TOKEN, origin: 'http://evil.com' } });
      const custom = baseCustom({ originCheck: { enabled: false, allowedOrigins: [] } });
      expect(requestGuard.evaluate(ctx, custom, matcher)).toEqual({ ok: true });
    });

    test('allowedOrigins consente un origin extra con token valido', () => {
      const ctx = validPostCtx({ headers: { 'x-csrf-token': TOKEN, origin: 'https://app.example.com' } });
      const custom = baseCustom({ originCheck: { enabled: true, allowedOrigins: ['https://app.example.com'] } });
      expect(requestGuard.evaluate(ctx, custom, matcher)).toEqual({ ok: true });
    });
  });

  describe('helper interni', () => {
    test('isMutatingMethod normalizza DEL→DELETE e ignora GET', () => {
      expect(requestGuard.isMutatingMethod('post', ['POST'])).toBe(true);
      expect(requestGuard.isMutatingMethod('DELETE', ['DEL'])).toBe(true);
      expect(requestGuard.isMutatingMethod('GET', ['POST', 'PUT', 'DELETE', 'PATCH'])).toBe(false);
    });

    test('tokenFromRequest preferisce l\'header al body', () => {
      const ctx = createCtxMock({ headers: { 'x-csrf-token': 'H' }, body: { _csrf: 'B' } });
      expect(requestGuard.tokenFromRequest(ctx, 'X-CSRF-Token', '_csrf')).toBe('H');
    });

    test('tokenFromRequest cade sul body se l\'header manca', () => {
      const ctx = createCtxMock({ headers: {}, body: { _csrf: 'B' } });
      expect(requestGuard.tokenFromRequest(ctx, 'X-CSRF-Token', '_csrf')).toBe('B');
    });
  });
});
