/**
 * Unit Tests per adminAccessControl/lib/ruleValidator.js
 *
 * Testa la validazione delle regole di accesso:
 * - Validazione struttura base (config, sezioni obbligatorie)
 * - Validazione regole (requiresAuth, allowedRoles, priority, editable)
 * - Validazione pattern URL (via patternMatcher.validatePattern)
 * - Validazione defaultPolicy
 * - Validazione ruoli (con mock pluginSys + adminUsers)
 * - Conflitti con rotte plugin
 * - Validazione da UI (immutabilità hardcodedRules)
 */

const RuleValidator = require('../../plugins/adminAccessControl/lib/ruleValidator');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Crea un mock di pluginSys minimale
 */
function createMockPluginSys(options = {}) {
  const plugins = options.plugins || new Map();
  return {
    getPlugin: (name) => plugins.get(name) || null,
    getAllPlugins: () => plugins,
  };
}

/**
 * Crea una configurazione accessControl valida minimale
 */
function validConfig(overrides = {}) {
  return {
    hardcodedRules: overrides.hardcodedRules || {
      '/admin/**': {
        requiresAuth: true,
        allowedRoles: [0, 1],
        priority: 100,
        editable: false,
      },
    },
    customRules: overrides.customRules || {},
    defaultPolicy: overrides.defaultPolicy || {
      action: 'allow',
      redirectOnDenied: '/login',
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RuleValidator', () => {
  let validator;
  let mockPluginSys;

  beforeEach(() => {
    mockPluginSys = createMockPluginSys();
    validator = new RuleValidator(mockPluginSys, { apiPrefix: 'api' });
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('creates instance with pluginSys and ital8Conf', () => {
      expect(validator.pluginSys).toBe(mockPluginSys);
      expect(validator.ital8Conf).toEqual({ apiPrefix: 'api' });
    });

    test('falls back to default ital8Conf if not provided', () => {
      const v = new RuleValidator(mockPluginSys);
      expect(v.ital8Conf).toEqual({ apiPrefix: 'api' });
    });

    test('creates a PatternMatcher instance', () => {
      expect(validator.patternMatcher).toBeDefined();
      expect(validator.patternMatcher.validatePattern).toBeInstanceOf(Function);
    });
  });

  // ─── validateConfig: struttura base ───────────────────────────────────────

  describe('validateConfig — base structure', () => {
    test('returns valid for a correct config', () => {
      const result = validator.validateConfig(validConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects null config', () => {
      const result = validator.validateConfig(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid configuration: must be an object');
    });

    test('rejects non-object config (string)', () => {
      const result = validator.validateConfig('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid configuration: must be an object');
    });

    test('rejects config missing hardcodedRules', () => {
      const result = validator.validateConfig({
        customRules: {},
        defaultPolicy: { action: 'allow' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('hardcodedRules'));
    });

    test('rejects config missing customRules', () => {
      const result = validator.validateConfig({
        hardcodedRules: {},
        defaultPolicy: { action: 'allow' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('customRules'));
    });

    test('rejects config missing defaultPolicy', () => {
      const result = validator.validateConfig({
        hardcodedRules: {},
        customRules: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('defaultPolicy'));
    });

    test('rejects config with hardcodedRules as non-object', () => {
      const result = validator.validateConfig({
        hardcodedRules: 'invalid',
        customRules: {},
        defaultPolicy: { action: 'allow' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('hardcodedRules'));
    });

    test('stops early when base sections are missing', () => {
      const result = validator.validateConfig({});
      expect(result.valid).toBe(false);
      // Should have errors for all three missing sections
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── validateRuleSection ──────────────────────────────────────────────────

  describe('validateRuleSection', () => {
    test('returns no errors for valid rules', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: [0, 1] },
        '/public': { requiresAuth: false, allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toHaveLength(0);
    });

    test('reports missing requiresAuth', () => {
      const rules = {
        '/page': { allowedRoles: [0] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('requiresAuth'));
    });

    test('reports non-boolean requiresAuth', () => {
      const rules = {
        '/page': { requiresAuth: 1, allowedRoles: [0] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('"requiresAuth" must be boolean'));
    });

    test('reports missing allowedRoles', () => {
      const rules = {
        '/page': { requiresAuth: true },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('allowedRoles'));
    });

    test('reports non-array allowedRoles', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: 'admin' },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('"allowedRoles" must be an array'));
    });

    test('reports non-number priority', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: [], priority: 'high' },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('"priority" must be a number'));
    });

    test('accepts valid numeric priority', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: [], priority: 500 },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toHaveLength(0);
    });

    test('reports non-boolean editable', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: [], editable: 'yes' },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('"editable" must be boolean'));
    });

    test('accepts valid boolean editable', () => {
      const rules = {
        '/page': { requiresAuth: true, allowedRoles: [], editable: false },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toHaveLength(0);
    });

    test('reports invalid pattern (whitespace)', () => {
      const rules = {
        '/page with space': { requiresAuth: true, allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('whitespace'));
    });

    test('reports invalid regex pattern', () => {
      const rules = {
        'regex:^/invalid[': { requiresAuth: true, allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toContainEqual(expect.stringContaining('Invalid regex'));
    });

    test('skips field validation when pattern is invalid', () => {
      const rules = {
        'regex:^/invalid[': { /* missing fields */ },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      // Should only have pattern error, not field errors
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Invalid regex');
    });

    test('accepts valid regex pattern', () => {
      const rules = {
        'regex:^/product/\\d+$': { requiresAuth: false, allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toHaveLength(0);
    });

    test('accepts wildcard patterns', () => {
      const rules = {
        '/admin/*': { requiresAuth: true, allowedRoles: [0] },
        '/docs/**': { requiresAuth: false, allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors).toHaveLength(0);
    });

    test('includes section name in error messages', () => {
      const rules = {
        '/page': { requiresAuth: 'invalid', allowedRoles: [] },
      };
      const errors = validator.validateRuleSection(rules, 'hardcodedRules', false);
      expect(errors[0]).toContain('hardcodedRules');
    });

    test('validates multiple rules and reports all errors', () => {
      const rules = {
        '/page1': { allowedRoles: [] }, // missing requiresAuth
        '/page2': { requiresAuth: true }, // missing allowedRoles
      };
      const errors = validator.validateRuleSection(rules, 'customRules', false);
      expect(errors.length).toBe(2);
    });
  });

  // ─── validateRoles ────────────────────────────────────────────────────────

  describe('validateRoles', () => {
    test('skips validation when adminUsers plugin is not available', () => {
      const errors = validator.validateRoles([0, 1], '/admin', 'customRules');
      expect(errors).toHaveLength(0);
    });

    test('reports non-number role IDs when adminUsers is available with valid role file', () => {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Create a temporary directory with a valid userRole.json5
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleValidator-'));
      const roleData = { roles: { '0': { name: 'root' }, '1': { name: 'admin' } } };
      fs.writeFileSync(path.join(tmpDir, 'userRole.json5'), JSON.stringify(roleData));

      const adminUsersPlugin = { pathPluginFolder: tmpDir };
      const plugins = new Map([['adminUsers', adminUsersPlugin]]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.validateRoles(['admin', true], '/page', 'customRules');
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(errors).toContainEqual(expect.stringContaining('must be a number'));

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true });
    });

    test('reports non-existent role IDs as warnings', () => {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleValidator-'));
      const roleData = { roles: { '0': { name: 'root' } } };
      fs.writeFileSync(path.join(tmpDir, 'userRole.json5'), JSON.stringify(roleData));

      const adminUsersPlugin = { pathPluginFolder: tmpDir };
      const plugins = new Map([['adminUsers', adminUsersPlugin]]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.validateRoles([0, 999], '/page', 'customRules');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Role 999 not found');

      fs.rmSync(tmpDir, { recursive: true });
    });

    test('skips role validation when userRole.json5 fails to load', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const adminUsersPlugin = { pathPluginFolder: '/nonexistent/path' };
      const plugins = new Map([['adminUsers', adminUsersPlugin]]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.validateRoles([0], '/page', 'customRules');
      expect(errors).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  // ─── validateDefaultPolicy ────────────────────────────────────────────────

  describe('validateDefaultPolicy', () => {
    test('accepts valid "allow" policy', () => {
      const errors = validator.validateDefaultPolicy({ action: 'allow' });
      expect(errors).toHaveLength(0);
    });

    test('accepts valid "deny" policy', () => {
      const errors = validator.validateDefaultPolicy({ action: 'deny' });
      expect(errors).toHaveLength(0);
    });

    test('accepts valid "requireAuth" policy', () => {
      const errors = validator.validateDefaultPolicy({ action: 'requireAuth' });
      expect(errors).toHaveLength(0);
    });

    test('reports missing action', () => {
      const errors = validator.validateDefaultPolicy({});
      expect(errors).toContainEqual(expect.stringContaining('Missing required field "action"'));
    });

    test('reports invalid action value', () => {
      const errors = validator.validateDefaultPolicy({ action: 'block' });
      expect(errors).toContainEqual(expect.stringContaining('must be one of'));
    });

    test('accepts valid redirectOnDenied string', () => {
      const errors = validator.validateDefaultPolicy({
        action: 'allow',
        redirectOnDenied: '/login',
      });
      expect(errors).toHaveLength(0);
    });

    test('reports non-string redirectOnDenied', () => {
      const errors = validator.validateDefaultPolicy({
        action: 'allow',
        redirectOnDenied: 123,
      });
      expect(errors).toContainEqual(expect.stringContaining('"redirectOnDenied" must be a string'));
    });

    test('accepts policy without redirectOnDenied (optional)', () => {
      const errors = validator.validateDefaultPolicy({ action: 'deny' });
      expect(errors).toHaveLength(0);
    });
  });

  // ─── checkPluginRouteConflicts ────────────────────────────────────────────

  describe('checkPluginRouteConflicts', () => {
    test('returns no errors when no plugins have routes', () => {
      const errors = validator.checkPluginRouteConflicts({
        '/my-page': { requiresAuth: false, allowedRoles: [] },
      });
      expect(errors).toHaveLength(0);
    });

    test('detects conflict with plugin route', () => {
      const plugins = new Map([
        ['myPlugin', {
          getRouteArray: () => [{ path: '/endpoint', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.checkPluginRouteConflicts({
        '/api/myPlugin/endpoint': { requiresAuth: true, allowedRoles: [0] },
      });
      expect(errors).toContainEqual(expect.stringContaining('FATAL'));
      expect(errors).toContainEqual(expect.stringContaining('myPlugin'));
    });

    test('detects conflict with wildcard pattern matching plugin route', () => {
      const plugins = new Map([
        ['myPlugin', {
          getRouteArray: () => [{ path: '/users', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.checkPluginRouteConflicts({
        '/api/myPlugin/**': { requiresAuth: true, allowedRoles: [0] },
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('FATAL');
    });

    test('no conflict when custom rule does not match plugin routes', () => {
      const plugins = new Map([
        ['myPlugin', {
          getRouteArray: () => [{ path: '/endpoint', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.checkPluginRouteConflicts({
        '/my-page': { requiresAuth: false, allowedRoles: [] },
      });
      expect(errors).toHaveLength(0);
    });

    test('handles plugin that throws in getRouteArray', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const plugins = new Map([
        ['broken', {
          getRouteArray: () => { throw new Error('broken'); },
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.checkPluginRouteConflicts({});
      expect(errors).toHaveLength(0);
      warnSpy.mockRestore();
    });

    test('handles plugin without getRouteArray', () => {
      const plugins = new Map([['simple', {}]]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const errors = v.checkPluginRouteConflicts({});
      expect(errors).toHaveLength(0);
    });
  });

  // ─── getPluginRoutes ──────────────────────────────────────────────────────

  describe('getPluginRoutes', () => {
    test('returns empty array when no plugins exist', () => {
      const routes = validator.getPluginRoutes();
      expect(routes).toEqual([]);
    });

    test('builds full path correctly', () => {
      const plugins = new Map([
        ['users', {
          getRouteArray: () => [
            { path: '/list', method: 'get' },
            { path: '/create', method: 'post' },
          ],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const routes = v.getPluginRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0]).toEqual({
        plugin: 'users',
        path: '/list',
        fullPath: '/api/users/list',
      });
      expect(routes[1]).toEqual({
        plugin: 'users',
        path: '/create',
        fullPath: '/api/users/create',
      });
    });

    test('uses custom apiPrefix', () => {
      const plugins = new Map([
        ['test', {
          getRouteArray: () => [{ path: '/ping', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'v2' });

      const routes = v.getPluginRoutes();
      expect(routes[0].fullPath).toBe('/v2/test/ping');
    });

    test('handles getRouteArray returning non-array', () => {
      const plugins = new Map([
        ['bad', { getRouteArray: () => 'not-array' }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const routes = v.getPluginRoutes();
      expect(routes).toEqual([]);
    });

    test('collects routes from multiple plugins', () => {
      const plugins = new Map([
        ['a', { getRouteArray: () => [{ path: '/x', method: 'get' }] }],
        ['b', { getRouteArray: () => [{ path: '/y', method: 'get' }] }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const routes = v.getPluginRoutes();
      expect(routes).toHaveLength(2);
      expect(routes.map(r => r.plugin)).toEqual(['a', 'b']);
    });
  });

  // ─── validateConfig: integration of all sections ──────────────────────────

  describe('validateConfig — full validation', () => {
    test('aggregates errors from multiple sections', () => {
      const config = {
        hardcodedRules: {
          '/admin/**': { requiresAuth: 'yes', allowedRoles: [] },
        },
        customRules: {
          '/page': { allowedRoles: [0] }, // missing requiresAuth
        },
        defaultPolicy: { action: 'invalid' },
      };
      const result = validator.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    test('skips plugin route conflicts when fromUI is true', () => {
      const plugins = new Map([
        ['myPlugin', {
          getRouteArray: () => [{ path: '/endpoint', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const config = validConfig({
        customRules: {
          '/api/myPlugin/endpoint': { requiresAuth: true, allowedRoles: [0] },
        },
      });
      // fromUI = true → should NOT check plugin route conflicts
      const result = v.validateConfig(config, true);
      // Should be valid (no conflict check from UI)
      expect(result.errors.filter(e => e.includes('FATAL'))).toHaveLength(0);
    });

    test('checks plugin route conflicts when fromUI is false', () => {
      const plugins = new Map([
        ['myPlugin', {
          getRouteArray: () => [{ path: '/endpoint', method: 'get' }],
        }],
      ]);
      const ps = createMockPluginSys({ plugins });
      const v = new RuleValidator(ps, { apiPrefix: 'api' });

      const config = validConfig({
        customRules: {
          '/api/myPlugin/endpoint': { requiresAuth: true, allowedRoles: [0] },
        },
      });
      const result = v.validateConfig(config, false);
      expect(result.errors).toContainEqual(expect.stringContaining('FATAL'));
    });
  });

  // ─── validateFromUI ───────────────────────────────────────────────────────

  describe('validateFromUI', () => {
    const originalHardcoded = {
      '/admin/**': {
        requiresAuth: true,
        allowedRoles: [0, 1],
        editable: false,
      },
    };

    test('accepts valid JSON5 with unchanged hardcoded rules', () => {
      const jsonString = JSON.stringify({
        hardcodedRules: originalHardcoded,
        customRules: { '/page': { requiresAuth: false, allowedRoles: [] } },
        defaultPolicy: { action: 'allow' },
      });
      const result = validator.validateFromUI(jsonString, originalHardcoded);
      expect(result.valid).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    test('rejects invalid JSON5 syntax', () => {
      const result = validator.validateFromUI('{invalid json', originalHardcoded);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('JSON5 syntax error'));
      expect(result.parsed).toBeNull();
    });

    test('rejects modified hardcoded rules', () => {
      const modifiedHardcoded = {
        '/admin/**': {
          requiresAuth: true,
          allowedRoles: [0], // changed from [0, 1]
          editable: false,
        },
      };
      const jsonString = JSON.stringify({
        hardcodedRules: modifiedHardcoded,
        customRules: {},
        defaultPolicy: { action: 'allow' },
      });
      const result = validator.validateFromUI(jsonString, originalHardcoded);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('Cannot modify hardcodedRules')
      );
      expect(result.parsed).toBeNull();
    });

    test('rejects config with validation errors (propagated from validateConfig)', () => {
      const jsonString = JSON.stringify({
        hardcodedRules: originalHardcoded,
        customRules: {
          '/page': { requiresAuth: 'invalid' }, // wrong type
        },
        defaultPolicy: { action: 'allow' },
      });
      const result = validator.validateFromUI(jsonString, originalHardcoded);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.parsed).toBeNull();
    });

    test('returns parsed object on success', () => {
      const config = {
        hardcodedRules: originalHardcoded,
        customRules: {},
        defaultPolicy: { action: 'deny', redirectOnDenied: '/login' },
      };
      const jsonString = JSON.stringify(config);
      const result = validator.validateFromUI(jsonString, originalHardcoded);
      expect(result.valid).toBe(true);
      expect(result.parsed).toEqual(config);
    });
  });
});
