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

describe('csrfProtection · main (integrazione plugin)', () => {
  beforeEach(() => {
    csrf._internals._setConfigForTest(baseCustom());
  });

  describe('gestione token in sessione', () => {
    test('ensureToken genera e memorizza il token, idempotente', () => {
      const ctx = createCtxMock({ session: {} });
      const t1 = csrf._internals.ensureToken(ctx);
      expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(ctx.session.csrfToken).toBe(t1);
      expect(csrf._internals.ensureToken(ctx)).toBe(t1); // idempotente
    });

    test('ensureToken ritorna null senza sessione', () => {
      expect(csrf._internals.ensureToken(createCtxMock({ session: null }))).toBeNull();
    });

    test('rotateToken cambia il token', () => {
      const ctx = createCtxMock({ session: {} });
      const t1 = csrf._internals.ensureToken(ctx);
      const t2 = csrf._internals.rotateToken(ctx);
      expect(t2).not.toBe(t1);
      expect(ctx.session.csrfToken).toBe(t2);
    });
  });

  describe('helper markup', () => {
    test('csrfFieldFor stampa l\'input hidden col token', () => {
      const ctx = createCtxMock({ session: {} });
      const html = csrf._internals.csrfFieldFor(ctx);
      expect(html).toMatch(/^<input type="hidden" name="_csrf" value="[A-Za-z0-9_-]{43}">$/);
      expect(html).toContain(ctx.session.csrfToken);
    });

    test('csrfFieldFor ritorna stringa vuota senza sessione', () => {
      expect(csrf._internals.csrfFieldFor(createCtxMock({ session: null }))).toBe('');
    });

    test('funzioni globali csrfField/csrfToken operano su passData.ctx', () => {
      const globals = csrf.getGlobalFunctionsForTemplates();
      expect(typeof globals.csrfField).toBe('function');
      expect(typeof globals.csrfToken).toBe('function');

      const ctx = createCtxMock({ session: {} });
      const field = globals.csrfField({ ctx });
      const token = globals.csrfToken({ ctx });
      expect(field).toContain(token);
      expect(field).toContain('name="_csrf"');
    });

    test('getObjectToShareToWebPages espone le versioni locali', () => {
      const local = csrf.getObjectToShareToWebPages();
      expect(typeof local.csrfField).toBe('function');
      expect(typeof local.csrfToken).toBe('function');
    });
  });

  describe('hook head (meta + interceptor)', () => {
    test('inietta <meta> col token e lo <script> interceptor', () => {
      const hooks = csrf.getHooksPage();
      expect(hooks.has('head')).toBe(true);
      const ctx = createCtxMock({ session: {} });
      const html = hooks.get('head')({ ctx });
      expect(html).toMatch(/<meta name="csrf-token" content="[A-Za-z0-9_-]{43}">/);
      expect(html).toContain(ctx.session.csrfToken);
      expect(html).toContain('<script>');
      expect(html).toMatch(/window\.fetch/);
    });

    test('senza sessione non inietta nulla', () => {
      const hooks = csrf.getHooksPage();
      expect(hooks.get('head')({ ctx: createCtxMock({ session: null }) })).toBe('');
    });
  });

  describe('oggetto condiviso (guard per il core)', () => {
    test('espone validateRequest/ensureToken/rotateToken/getConfig/validateConfig', () => {
      const api = csrf.getObjectToShareToOthersPlugin();
      expect(typeof api.validateRequest).toBe('function');
      expect(typeof api.ensureToken).toBe('function');
      expect(typeof api.rotateToken).toBe('function');
      expect(typeof api.getToken).toBe('function');
      expect(typeof api.getConfig).toBe('function');
      expect(typeof api.validateConfig).toBe('function');
    });

    test('validateRequest blocca una POST senza token e passa una valida', () => {
      const api = csrf.getObjectToShareToOthersPlugin();

      const bad = createCtxMock({ method: 'POST', path: '/api/x', session: {}, headers: {} });
      expect(api.validateRequest(bad).ok).toBe(false);

      const ctx = createCtxMock({ method: 'POST', path: '/api/x', session: {}, headers: { origin: 'http://localhost:3000' } });
      const token = api.ensureToken(ctx);
      ctx.headers['x-csrf-token'] = token; // il client rispedisce il token
      expect(api.validateRequest(ctx)).toEqual({ ok: true });
    });

    test('getConfig ritorna una copia (non il riferimento interno)', () => {
      const api = csrf.getObjectToShareToOthersPlugin();
      const c1 = api.getConfig();
      c1.enabled = false;
      expect(api.getConfig().enabled).toBe(true); // la copia non muta lo stato interno
    });
  });

  describe('middleware ensure-token', () => {
    test('imposta il token in sessione e chiama next()', async () => {
      const mws = csrf.getMiddlewareToAdd();
      expect(mws).toHaveLength(1);
      const ctx = createCtxMock({ session: {} });
      const next = jest.fn(async () => {});
      await mws[0](ctx, next);
      expect(ctx.session.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('plugin disabilitato (custom.enabled=false)', () => {
    beforeEach(() => csrf._internals._setConfigForTest(baseCustom({ enabled: false })));

    test('oggetto condiviso null, nessun hook, nessun middleware', () => {
      expect(csrf.getObjectToShareToOthersPlugin()).toBeNull();
      expect(csrf.getHooksPage().size).toBe(0);
      expect(csrf.getMiddlewareToAdd()).toEqual([]);
    });
  });
});
