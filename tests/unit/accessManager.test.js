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
