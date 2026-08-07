/**
 * Unit Tests: AccessManager
 *
 * Testa la logica di controllo accessi (checkAccess, applyDefaultPolicy).
 * Usa mock per loadJson5 per isolare la logica dal filesystem.
 */

// Mock loadJson5 BEFORE requiring AccessManager
jest.mock('../../core/loadJson5', () => {
  return jest.fn();
});

const loadJson5 = require('../../core/loadJson5');

// Mock data for access control config
const mockAccessConfig = {
  hardcodedRules: {
    '/admin': {
      requiresAuth: true,
      allowedRoles: [0, 1],
      priority: 1000,
      editable: false
    },
    '/admin/**': {
      requiresAuth: true,
      allowedRoles: [0, 1],
      priority: 100,
      editable: false
    }
  },
  customRules: {
    '/pluginPages/adminUsers/userProfile.ejs': {
      requiresAuth: true,
      allowedRoles: []
    }
  },
  defaultPolicy: {
    action: 'allow',
    redirectOnDenied: '/pluginPages/adminUsers/login.ejs'
  }
};

// Setup mock before requiring AccessManager
loadJson5.mockReturnValue(mockAccessConfig);

const AccessManager = require('../../plugins/adminAccessControl/lib/accessManager');

describe('AccessManager', () => {
  let accessManager;
  const mockPluginSys = {};
  const mockPathPluginFolder = '/fake/path/plugins/adminAccessControl';

  beforeEach(() => {
    // Reset mock and create fresh instance
    loadJson5.mockReturnValue(mockAccessConfig);
    accessManager = new AccessManager(mockPluginSys, mockPathPluginFolder);
  });

  // ========================================================================
  // checkAccess - Unauthenticated User
  // ========================================================================
  describe('checkAccess - unauthenticated user', () => {
    test('should deny access to admin pages', () => {
      const result = accessManager.checkAccess('/admin/dashboard', null);
      expect(result.allowed).toBe(false);
      expect(result.redirect).toBe('/pluginPages/adminUsers/login.ejs');
      expect(result.reason).toBe('Authentication required');
    });

    test('should deny access to exact admin path', () => {
      const result = accessManager.checkAccess('/admin', null);
      expect(result.allowed).toBe(false);
      expect(result.redirect).toBe('/pluginPages/adminUsers/login.ejs');
    });

    test('should deny access to user profile', () => {
      const result = accessManager.checkAccess('/pluginPages/adminUsers/userProfile.ejs', null);
      expect(result.allowed).toBe(false);
      expect(result.redirect).toBe('/pluginPages/adminUsers/login.ejs');
    });

    test('should allow access to public pages (default policy: allow)', () => {
      const result = accessManager.checkAccess('/some-public-page.ejs', null);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Default policy: allow');
    });
  });

  // ========================================================================
  // checkAccess - Authenticated User with Correct Role
  // ========================================================================
  describe('checkAccess - authenticated user with correct role', () => {
    test('should allow admin access with admin role', () => {
      const adminUser = { roleIds: [1] };
      const result = accessManager.checkAccess('/admin/dashboard', adminUser);
      expect(result.allowed).toBe(true);
    });

    test('should allow admin access with root role', () => {
      const rootUser = { roleIds: [0] };
      const result = accessManager.checkAccess('/admin/dashboard', rootUser);
      expect(result.allowed).toBe(true);
    });

    test('should allow user profile access for any authenticated user', () => {
      const editorUser = { roleIds: [2] };
      const result = accessManager.checkAccess('/pluginPages/adminUsers/userProfile.ejs', editorUser);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Access granted');
    });
  });

  // ========================================================================
  // checkAccess - Authenticated User with Wrong Role
  // ========================================================================
  describe('checkAccess - authenticated user with wrong role', () => {
    test('should deny admin access with editor role', () => {
      const editorUser = { roleIds: [2] };
      const result = accessManager.checkAccess('/admin/dashboard', editorUser);
      expect(result.allowed).toBe(false);
      expect(result.redirect).toBe('/pluginPages/adminAccessControl/access-denied.ejs');
      expect(result.reason).toContain('Required roles');
    });

    test('should deny admin access with selfEditor role', () => {
      const selfEditorUser = { roleIds: [3] };
      const result = accessManager.checkAccess('/admin/settings', selfEditorUser);
      expect(result.allowed).toBe(false);
    });

    test('should include role info in denial reason', () => {
      const editorUser = { roleIds: [2] };
      const result = accessManager.checkAccess('/admin/dashboard', editorUser);
      expect(result.reason).toContain('0, 1'); // Required roles
      expect(result.reason).toContain('2'); // User's role
    });
  });

  // ========================================================================
  // checkAccess - Multi-role Users
  // ========================================================================
  describe('checkAccess - multi-role users', () => {
    test('should allow if user has at least one required role', () => {
      const multiRoleUser = { roleIds: [2, 1] }; // editor + admin
      const result = accessManager.checkAccess('/admin/dashboard', multiRoleUser);
      expect(result.allowed).toBe(true);
    });

    test('should deny if user has no required roles', () => {
      const noAdminUser = { roleIds: [2, 3] }; // editor + selfEditor, but no admin
      const result = accessManager.checkAccess('/admin/dashboard', noAdminUser);
      expect(result.allowed).toBe(false);
    });
  });

  // ========================================================================
  // applyDefaultPolicy
  // ========================================================================
  describe('applyDefaultPolicy', () => {
    test('should allow everyone when action is "allow"', () => {
      const result = accessManager.applyDefaultPolicy(null);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Default policy: allow');
    });

    test('should deny everyone when action is "deny"', () => {
      // Override default policy for this test
      accessManager.defaultPolicy = { action: 'deny', redirectOnDenied: '/login' };
      const result = accessManager.applyDefaultPolicy(null);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(403);
    });

    test('should require auth when action is "requireAuth"', () => {
      accessManager.defaultPolicy = {
        action: 'requireAuth',
        redirectOnDenied: '/pluginPages/adminUsers/login.ejs'
      };

      // Unauthenticated
      const result1 = accessManager.applyDefaultPolicy(null);
      expect(result1.allowed).toBe(false);
      expect(result1.redirect).toBe('/pluginPages/adminUsers/login.ejs');

      // Authenticated
      const result2 = accessManager.applyDefaultPolicy({ roleIds: [2] });
      expect(result2.allowed).toBe(true);
    });

    test('should fallback to allow for unknown action', () => {
      accessManager.defaultPolicy = { action: 'unknown', redirectOnDenied: '/login' };
      const result = accessManager.applyDefaultPolicy(null);
      expect(result.allowed).toBe(true);
    });
  });

  // ========================================================================
  // createMiddleware
  // ========================================================================
  describe('createMiddleware', () => {
    test('should return a function', () => {
      const middleware = accessManager.createMiddleware();
      expect(typeof middleware).toBe('function');
    });

    test('should call next() when access is allowed', async () => {
      const middleware = accessManager.createMiddleware();
      const ctx = {
        path: '/public-page',
        session: null
      };
      const next = jest.fn();
      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    test('should redirect when access is denied (unauthenticated)', async () => {
      const middleware = accessManager.createMiddleware();
      const ctx = {
        path: '/admin/dashboard',
        session: {},
        redirect: jest.fn()
      };
      const next = jest.fn();
      await middleware(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.redirect).toHaveBeenCalledWith('/pluginPages/adminUsers/login.ejs');
    });

    test('should redirect to access-denied for wrong role', async () => {
      const middleware = accessManager.createMiddleware();
      const ctx = {
        path: '/admin/dashboard',
        session: { user: { roleIds: [2] } },
        redirect: jest.fn()
      };
      const next = jest.fn();
      await middleware(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.redirect).toHaveBeenCalledWith('/pluginPages/adminAccessControl/access-denied.ejs');
    });

    test('should allow access for correct role', async () => {
      const middleware = accessManager.createMiddleware();
      const ctx = {
        path: '/admin/dashboard',
        session: { user: { roleIds: [1] } }
      };
      const next = jest.fn();
      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // LAYER A — canonicalizzazione del path nella guardia (audit #1)
  // Prova che la guardia chiude il bypass da SOLA (senza il gate globale B):
  // path non canonici che risolvono a /admin devono comunque matchare la
  // regola /admin/** e NON cadere sulla defaultPolicy "allow".
  // ========================================================================
  describe('createMiddleware - path non canonici (Layer A)', () => {
    const nonCanonicalAdminPaths = [
      '/./admin/usersManagment/index.ejs',
      '/x/../admin/usersManagment/index.ejs',
      '//admin/usersManagment/index.ejs',
      '/admin/./usersManagment/index.ejs',
    ];

    test.each(nonCanonicalAdminPaths)(
      'anonimo su %j → bloccato (redirect al login), NON allow',
      async (p) => {
        const middleware = accessManager.createMiddleware();
        const ctx = { path: p, session: null, redirect: jest.fn() };
        const next = jest.fn();
        await middleware(ctx, next);
        expect(next).not.toHaveBeenCalled();
        expect(ctx.redirect).toHaveBeenCalledWith('/pluginPages/adminUsers/login.ejs');
      }
    );

    test.each(nonCanonicalAdminPaths)(
      'ruolo insufficiente [2] su %j → access-denied, NON allow',
      async (p) => {
        const middleware = accessManager.createMiddleware();
        const ctx = { path: p, session: { user: { roleIds: [2] } }, redirect: jest.fn() };
        const next = jest.fn();
        await middleware(ctx, next);
        expect(next).not.toHaveBeenCalled();
        expect(ctx.redirect).toHaveBeenCalledWith('/pluginPages/adminAccessControl/access-denied.ejs');
      }
    );

    test('ruolo corretto [1] su path non canonico → consentito', async () => {
      const middleware = accessManager.createMiddleware();
      const ctx = { path: '/./admin/dashboard', session: { user: { roleIds: [1] } } };
      const next = jest.fn();
      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Backward compatibility (roleId singolo)
  // ========================================================================
  describe('backward compatibility - single roleId', () => {
    test('should support legacy roleId field', () => {
      const legacyUser = { roleId: 1 }; // Old format without roleIds array
      const result = accessManager.checkAccess('/admin/dashboard', legacyUser);
      expect(result.allowed).toBe(true);
    });
  });
});

// ==========================================================================
// SUPERFICIE RISERVATA — createMiddleware()
// ==========================================================================
// Terzo punto di enforcement del `reserved stop`: quello delle PAGINE. Le rotte
// API le chiude il route-wrap di pluginSys, i due prefissi admin il gate stesso;
// le pagine servite staticamente passano SOLO di qui, perche cadono oltre il
// router. Finora questo ramo non aveva alcun unit test.
describe('createMiddleware - superficie riservata', () => {
  // Il folder e solo un'etichetta: loadJson5 e mockato, non si tocca il disco.
  const mockPathPluginFolder = '/fake/path/plugins/adminAccessControl';

  // Config con anche i varchi (login/logout), come il default reale.
  const configWithEntryPoints = {
    ...mockAccessConfig,
    customRules: {
      ...mockAccessConfig.customRules,
      '/pluginPages/adminUsers/login.ejs': { requiresAuth: false, allowedRoles: [], isAuthEntryPoint: true },
    },
  };

  function makeGate(closed) {
    const denied = [];
    return {
      denied,
      isClosed: () => closed,
      deny: (ctx) => { denied.push(ctx.path); ctx.status = 404; ctx.body = 'denied'; },
    };
  }

  function makeCtx(reqPath, user = null) {
    return {
      path: reqPath,
      status: 200,
      body: null,
      session: user ? { user } : null,
      redirect(location) { this.status = 302; this.headers = { location }; },
    };
  }

  async function run(managerConfig, gate, ctx) {
    loadJson5.mockReturnValue(managerConfig);
    const manager = new AccessManager({ getReservedGate: () => gate }, mockPathPluginFolder);
    let nextCalled = false;
    await manager.createMiddleware()(ctx, async () => { nextCalled = true; });
    return nextCalled;
  }

  test('superficie CHIUSA: una pagina requiresAuth viene negata dal gate', async () => {
    const gate = makeGate(true);
    const ctx = makeCtx('/pluginPages/adminUsers/userProfile.ejs');
    const nextCalled = await run(configWithEntryPoints, gate, ctx);
    expect(nextCalled).toBe(false);
    expect(gate.denied).toEqual(['/pluginPages/adminUsers/userProfile.ejs']);
  });

  // Il varco e requiresAuth:false: senza il ramo isAuthEntryPoint passerebbe
  // liscio proprio la pagina piu' importante da nascondere.
  test('superficie CHIUSA: un varco isAuthEntryPoint viene negato dal gate', async () => {
    const gate = makeGate(true);
    const ctx = makeCtx('/pluginPages/adminUsers/login.ejs');
    const nextCalled = await run(configWithEntryPoints, gate, ctx);
    expect(nextCalled).toBe(false);
    expect(gate.denied).toEqual(['/pluginPages/adminUsers/login.ejs']);
  });

  test('superficie CHIUSA: una pagina pubblica passa comunque', async () => {
    const gate = makeGate(true);
    const ctx = makeCtx('/chi-siamo.ejs');
    const nextCalled = await run(configWithEntryPoints, gate, ctx);
    expect(nextCalled).toBe(true);
    expect(gate.denied).toEqual([]);
  });

  // Il gate NON deve negare prima di checkAccess quando la superficie e aperta:
  // il comportamento ordinario (redirect al login) deve restare intatto.
  test('superficie APERTA: nessun intervento del gate, resta il redirect al login', async () => {
    const gate = makeGate(false);
    const ctx = makeCtx('/pluginPages/adminUsers/userProfile.ejs');
    const nextCalled = await run(configWithEntryPoints, gate, ctx);
    expect(gate.denied).toEqual([]);
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(302);
    expect(ctx.headers.location).toBe('/pluginPages/adminUsers/login.ejs');
  });

  test('superficie APERTA: un utente autorizzato accede normalmente', async () => {
    const gate = makeGate(false);
    const ctx = makeCtx('/admin/dashboard', { roleIds: [1] });
    const nextCalled = await run(configWithEntryPoints, gate, ctx);
    expect(nextCalled).toBe(true);
  });

  // Degradazione: il middleware non deve rompersi se il gate non c'e' (pluginSys
  // senza il getter, o gate non ancora iniettato durante il boot).
  test('nessun gate disponibile: comportamento ordinario, nessun errore', async () => {
    loadJson5.mockReturnValue(configWithEntryPoints);
    const manager = new AccessManager({}, mockPathPluginFolder);
    const ctx = makeCtx('/chi-siamo.ejs');
    let nextCalled = false;
    await expect(
      manager.createMiddleware()(ctx, async () => { nextCalled = true; })
    ).resolves.not.toThrow();
    expect(nextCalled).toBe(true);
  });

  // Il gate viene interrogato a OGNI richiesta, non letto una volta al boot:
  // altrimenti `reserved start/stop` non avrebbe effetto immediato.
  test('lo stato del gate e riletto a ogni richiesta (commutazione a caldo)', async () => {
    loadJson5.mockReturnValue(configWithEntryPoints);
    let closed = false;
    const denied = [];
    const gate = {
      isClosed: () => closed,
      deny: (ctx) => { denied.push(ctx.path); ctx.status = 404; },
    };
    const manager = new AccessManager({ getReservedGate: () => gate }, mockPathPluginFolder);
    const middleware = manager.createMiddleware();

    const first = makeCtx('/pluginPages/adminUsers/login.ejs');
    await middleware(first, async () => {});
    expect(denied).toEqual([]);

    closed = true;
    const second = makeCtx('/pluginPages/adminUsers/login.ejs');
    await middleware(second, async () => {});
    expect(denied).toEqual(['/pluginPages/adminUsers/login.ejs']);
  });
});
