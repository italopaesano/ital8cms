/**
 * Unit Tests per isItemVisible()
 *
 * Logica di filtro visibilita basata su autenticazione e ruoli.
 * Ordine di priorita: showWhen → requiresAuth → allowedRoles
 */

const { isItemVisible } = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');

// ─── Helper per creare ctx ──────────────────────────────────────────────────

/** Utente NON autenticato */
const CTX_ANON = { session: {} };

/** Utente autenticato senza ruoli specifici */
const CTX_AUTH = { session: { authenticated: true, user: { roleIds: [] } } };

/** Utente con ruolo root (0) */
const CTX_ROOT = { session: { authenticated: true, user: { roleIds: [0] } } };

/** Utente con ruolo admin (1) */
const CTX_ADMIN = { session: { authenticated: true, user: { roleIds: [1] } } };

/** Utente con ruolo editor (2) */
const CTX_EDITOR = { session: { authenticated: true, user: { roleIds: [2] } } };

/** Utente con ruolo custom (102) */
const CTX_CUSTOM = { session: { authenticated: true, user: { roleIds: [102] } } };

/** Utente con multi-ruoli (admin + custom) */
const CTX_MULTI = { session: { authenticated: true, user: { roleIds: [1, 102] } } };

describe('isItemVisible', () => {

  // ─── Item senza restrizioni ───────────────────────────────────────────────

  describe('item senza restrizioni (sempre visibile)', () => {
    const item = { label: 'Home', href: '/' };

    test('visibile per utente anonimo', () => {
      expect(isItemVisible(item, CTX_ANON)).toBe(true);
    });

    test('visibile per utente autenticato', () => {
      expect(isItemVisible(item, CTX_AUTH)).toBe(true);
    });

    test('visibile per admin', () => {
      expect(isItemVisible(item, CTX_ADMIN)).toBe(true);
    });
  });

  // ─── showWhen: "authenticated" ────────────────────────────────────────────

  describe('showWhen: "authenticated"', () => {
    const item = { label: 'Profile', href: '/profile', showWhen: 'authenticated' };

    test('visibile quando autenticato', () => {
      expect(isItemVisible(item, CTX_AUTH)).toBe(true);
    });

    test('nascosto quando NON autenticato', () => {
      expect(isItemVisible(item, CTX_ANON)).toBe(false);
    });

    test('visibile per root', () => {
      expect(isItemVisible(item, CTX_ROOT)).toBe(true);
    });
  });

  // ─── showWhen: "unauthenticated" ─────────────────────────────────────────

  describe('showWhen: "unauthenticated"', () => {
    const item = { label: 'Login', href: '/login', showWhen: 'unauthenticated' };

    test('visibile quando NON autenticato', () => {
      expect(isItemVisible(item, CTX_ANON)).toBe(true);
    });

    test('nascosto quando autenticato', () => {
      expect(isItemVisible(item, CTX_AUTH)).toBe(false);
    });

    test('nascosto per admin', () => {
      expect(isItemVisible(item, CTX_ADMIN)).toBe(false);
    });
  });

  // ─── requiresAuth: true ───────────────────────────────────────────────────

  describe('requiresAuth: true (senza allowedRoles)', () => {
    const item = { label: 'Dashboard', href: '/dash', requiresAuth: true };

    test('visibile quando autenticato', () => {
      expect(isItemVisible(item, CTX_AUTH)).toBe(true);
    });

    test('nascosto quando NON autenticato', () => {
      expect(isItemVisible(item, CTX_ANON)).toBe(false);
    });
  });

  // ─── requiresAuth: false ──────────────────────────────────────────────────

  describe('requiresAuth: false (solo utenti anonimi)', () => {
    const item = { label: 'Guest Area', href: '/guest', requiresAuth: false };

    test('visibile quando NON autenticato', () => {
      expect(isItemVisible(item, CTX_ANON)).toBe(true);
    });

    test('nascosto quando autenticato', () => {
      expect(isItemVisible(item, CTX_AUTH)).toBe(false);
    });

    test('nascosto per root', () => {
      expect(isItemVisible(item, CTX_ROOT)).toBe(false);
    });
  });

  // ─── allowedRoles ─────────────────────────────────────────────────────────

  describe('allowedRoles', () => {
    const adminOnlyItem = {
      label: 'Admin', href: '/admin',
      requiresAuth: true, allowedRoles: [0, 1],
    };

    test('visibile per root (ruolo 0)', () => {
      expect(isItemVisible(adminOnlyItem, CTX_ROOT)).toBe(true);
    });

    test('visibile per admin (ruolo 1)', () => {
      expect(isItemVisible(adminOnlyItem, CTX_ADMIN)).toBe(true);
    });

    test('nascosto per editor (ruolo 2) senza permesso', () => {
      expect(isItemVisible(adminOnlyItem, CTX_EDITOR)).toBe(false);
    });

    test('nascosto per custom role (ruolo 102) senza permesso', () => {
      expect(isItemVisible(adminOnlyItem, CTX_CUSTOM)).toBe(false);
    });

    test('nascosto per utente anonimo (requiresAuth prima di allowedRoles)', () => {
      expect(isItemVisible(adminOnlyItem, CTX_ANON)).toBe(false);
    });

    test('visibile se utente ha ALMENO un ruolo consentito', () => {
      // CTX_MULTI ha [1, 102] → 1 e in [0, 1] → visibile
      expect(isItemVisible(adminOnlyItem, CTX_MULTI)).toBe(true);
    });
  });

  // ─── allowedRoles con ruolo singolo ───────────────────────────────────────

  describe('allowedRoles con ruolo singolo (root-only)', () => {
    const rootOnlyItem = {
      label: 'Root Only', href: '/root',
      requiresAuth: true, allowedRoles: [0],
    };

    test('visibile solo per root', () => {
      expect(isItemVisible(rootOnlyItem, CTX_ROOT)).toBe(true);
    });

    test('nascosto per admin', () => {
      expect(isItemVisible(rootOnlyItem, CTX_ADMIN)).toBe(false);
    });

    test('nascosto per editor', () => {
      expect(isItemVisible(rootOnlyItem, CTX_EDITOR)).toBe(false);
    });
  });

  // ─── allowedRoles vuoto ───────────────────────────────────────────────────

  describe('allowedRoles vuoto (tutti gli utenti autenticati)', () => {
    const authOnlyItem = {
      label: 'Any Auth', href: '/auth',
      requiresAuth: true, allowedRoles: [],
    };

    test('visibile per qualsiasi utente autenticato', () => {
      expect(isItemVisible(authOnlyItem, CTX_AUTH)).toBe(true);
    });

    test('visibile per admin', () => {
      expect(isItemVisible(authOnlyItem, CTX_ADMIN)).toBe(true);
    });

    test('nascosto per utente anonimo', () => {
      expect(isItemVisible(authOnlyItem, CTX_ANON)).toBe(false);
    });
  });

  // ─── allowedRoles ignorato senza requiresAuth ─────────────────────────────

  describe('allowedRoles ignorato quando requiresAuth non e true', () => {
    test('allowedRoles senza requiresAuth → visibile per tutti', () => {
      const item = { label: 'X', href: '/x', allowedRoles: [0] };
      expect(isItemVisible(item, CTX_EDITOR)).toBe(true);
      expect(isItemVisible(item, CTX_ANON)).toBe(true);
    });

    test('allowedRoles con requiresAuth: false → ignorato', () => {
      const item = { label: 'X', href: '/x', requiresAuth: false, allowedRoles: [0] };
      // requiresAuth: false nasconde agli autenticati, non controlla ruoli
      expect(isItemVisible(item, CTX_ANON)).toBe(true);
      expect(isItemVisible(item, CTX_ROOT)).toBe(false);
    });
  });

  // ─── Priorita: showWhen ha la precedenza ──────────────────────────────────

  describe('priorita showWhen vs requiresAuth', () => {
    test('showWhen: "unauthenticated" nasconde anche se requiresAuth assente', () => {
      const item = { label: 'X', showWhen: 'unauthenticated' };
      expect(isItemVisible(item, CTX_AUTH)).toBe(false);
    });

    test('showWhen + requiresAuth combinati', () => {
      // showWhen: 'authenticated' + requiresAuth: true → entrambi richiedono auth
      const item = { label: 'X', showWhen: 'authenticated', requiresAuth: true, allowedRoles: [0] };
      expect(isItemVisible(item, CTX_ROOT)).toBe(true);
      expect(isItemVisible(item, CTX_ADMIN)).toBe(false); // ha auth ma non ruolo 0
      expect(isItemVisible(item, CTX_ANON)).toBe(false); // showWhen blocca prima
    });
  });

  // ─── Edge cases del ctx ───────────────────────────────────────────────────

  describe('edge cases del ctx', () => {
    test('ctx senza session → trattato come anonimo', () => {
      const item = { label: 'X', requiresAuth: true };
      expect(isItemVisible(item, {})).toBe(false);
    });

    test('session senza user → roleIds vuoto', () => {
      const ctx = { session: { authenticated: true } };
      const item = { label: 'X', requiresAuth: true, allowedRoles: [0] };
      expect(isItemVisible(item, ctx)).toBe(false);
    });

    test('session.user senza roleIds → roleIds vuoto', () => {
      const ctx = { session: { authenticated: true, user: {} } };
      const item = { label: 'X', requiresAuth: true, allowedRoles: [0] };
      expect(isItemVisible(item, ctx)).toBe(false);
    });

    test('ctx undefined → TypeError (ctx.session senza guardia)', () => {
      const item = { label: 'X', showWhen: 'unauthenticated' };
      // ctx.session lancia TypeError se ctx e undefined
      // Questo riflette il comportamento reale: ctx e sempre un oggetto Koa
      expect(() => isItemVisible(item, undefined)).toThrow(TypeError);
    });
  });

  // ─── Ruoli custom (100+) ──────────────────────────────────────────────────

  describe('ruoli custom (100+)', () => {
    test('ruolo custom 102 accede a item con allowedRoles [102]', () => {
      const item = { label: 'X', requiresAuth: true, allowedRoles: [102] };
      expect(isItemVisible(item, CTX_CUSTOM)).toBe(true);
    });

    test('ruolo custom 102 non accede a item con allowedRoles [103]', () => {
      const item = { label: 'X', requiresAuth: true, allowedRoles: [103] };
      expect(isItemVisible(item, CTX_CUSTOM)).toBe(false);
    });

    test('multi-ruoli: admin + custom accede a item con [102]', () => {
      const item = { label: 'X', requiresAuth: true, allowedRoles: [102] };
      expect(isItemVisible(item, CTX_MULTI)).toBe(true);
    });
  });
});
