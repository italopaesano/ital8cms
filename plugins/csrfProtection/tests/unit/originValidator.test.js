'use strict';

const { createCtxMock } = require('../../../../core/testHelpers');
const { getExpectedOrigin, originFromUrl, validateOrigin } = require('../../lib/originValidator');

describe('csrfProtection · originValidator', () => {
  describe('getExpectedOrigin', () => {
    test('ricostruisce scheme://host dalla richiesta', () => {
      const ctx = createCtxMock({ protocol: 'http', host: 'localhost:3000' });
      expect(getExpectedOrigin(ctx)).toBe('http://localhost:3000');
    });

    test('usa l\'header Host se presente', () => {
      const ctx = createCtxMock({ protocol: 'https', headers: { host: 'cms.example.com' } });
      expect(getExpectedOrigin(ctx)).toBe('https://cms.example.com');
    });

    test('ignora X-Forwarded-* senza trustProxy', () => {
      const ctx = createCtxMock({
        protocol: 'http', host: 'localhost:3000',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.com' },
      });
      expect(getExpectedOrigin(ctx, { trustProxy: false })).toBe('http://localhost:3000');
    });

    test('onora X-Forwarded-Proto/Host con trustProxy', () => {
      const ctx = createCtxMock({
        protocol: 'http', host: 'localhost:3000',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'cms.example.com' },
      });
      expect(getExpectedOrigin(ctx, { trustProxy: true })).toBe('https://cms.example.com');
    });

    test('con trustProxy prende il primo valore della catena XFH', () => {
      const ctx = createCtxMock({
        protocol: 'http', host: 'localhost:3000',
        headers: { 'x-forwarded-host': 'cms.example.com, proxy1, proxy2' },
      });
      expect(getExpectedOrigin(ctx, { trustProxy: true })).toBe('http://cms.example.com');
    });
  });

  describe('originFromUrl', () => {
    test('estrae l\'origin da una URL completa', () => {
      expect(originFromUrl('https://x.com/a/b?c=1#h')).toBe('https://x.com');
      expect(originFromUrl('http://localhost:3000/admin/')).toBe('http://localhost:3000');
    });
    test('ritorna null per input non parsabile', () => {
      expect(originFromUrl('not a url')).toBeNull();
      expect(originFromUrl('/relative/path')).toBeNull();
      expect(originFromUrl('')).toBeNull();
    });
  });

  describe('validateOrigin', () => {
    const base = { protocol: 'http', host: 'localhost:3000' };

    test('mode=origin ok quando Origin combacia', () => {
      const ctx = createCtxMock({ ...base, headers: { origin: 'http://localhost:3000' } });
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'origin', ok: true });
    });

    test('mode=origin ko quando Origin non combacia', () => {
      const ctx = createCtxMock({ ...base, headers: { origin: 'http://evil.com' } });
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'origin', ok: false, requestOrigin: 'http://evil.com' });
    });

    test('Origin "null" (es. sandbox) è ignorato → fallback', () => {
      const ctx = createCtxMock({ ...base, headers: { origin: 'null' } });
      // niente referer → mode none
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'none', ok: null });
    });

    test('fallback su Referer quando manca Origin', () => {
      const ctx = createCtxMock({ ...base, headers: { referer: 'http://localhost:3000/admin/' } });
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'referer', ok: true });
    });

    test('Referer di origin diverso → ko', () => {
      const ctx = createCtxMock({ ...base, headers: { referer: 'http://evil.com/x' } });
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'referer', ok: false });
    });

    test('né Origin né Referer → mode none, ok null (token-fallback)', () => {
      const ctx = createCtxMock({ ...base, headers: {} });
      expect(validateOrigin(ctx)).toMatchObject({ mode: 'none', ok: null });
    });

    test('allowedOrigins consente un origin extra', () => {
      const ctx = createCtxMock({ ...base, headers: { origin: 'https://app.example.com' } });
      const res = validateOrigin(ctx, { allowedOrigins: ['https://app.example.com'] });
      expect(res).toMatchObject({ mode: 'origin', ok: true });
    });
  });
});
