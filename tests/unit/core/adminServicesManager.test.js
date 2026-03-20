/**
 * Unit Tests per core/admin/lib/adminServicesManager.js
 *
 * Testa la gestione dei servizi admin:
 * - setPluginSys
 * - loadServices (required/optional, plugin attivo/inattivo/mancante)
 * - registerPlugin
 * - getService, hasService, getAllServices
 * - getEndpointsForPassData
 */

const AdminServicesManager = require('../../../core/admin/lib/adminServicesManager');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockConfigManager(servicesConfig = {}) {
  return {
    getServices: () => servicesConfig,
  };
}

function createMockPluginSys(plugins = {}) {
  return {
    getPlugin: (name) => plugins[name] || null,
  };
}

function createActivePlugin(name, overrides = {}) {
  return {
    pluginName: name,
    pluginConfig: { active: 1 },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminServicesManager', () => {

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('initializes with configManager', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      expect(manager.configManager).toBe(cm);
      expect(manager.pluginSys).toBeNull();
      expect(manager.services).toBeInstanceOf(Map);
      expect(manager.services.size).toBe(0);
    });
  });

  // ─── setPluginSys ─────────────────────────────────────────────────────────

  describe('setPluginSys', () => {
    test('stores pluginSys reference', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      const ps = createMockPluginSys();
      manager.setPluginSys(ps);
      expect(manager.pluginSys).toBe(ps);
    });
  });

  // ─── loadServices ─────────────────────────────────────────────────────────

  describe('loadServices', () => {
    test('throws if pluginSys not set', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      expect(() => manager.loadServices()).toThrow('PluginSys not set');
    });

    test('loads required service when plugin is available and active', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createActivePlugin('adminUsers');
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({ adminUsers: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      manager.loadServices();

      expect(manager.hasService('auth')).toBe(true);
      expect(manager.getService('auth')).toBe(plugin);
      logSpy.mockRestore();
    });

    test('throws for required service when plugin is missing', () => {
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({}); // no plugins
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      expect(() => manager.loadServices()).toThrow('Required service "auth"');
    });

    test('throws for required service when plugin is not active', () => {
      const plugin = {
        pluginName: 'adminUsers',
        pluginConfig: { active: 0 },
      };
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({ adminUsers: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      expect(() => manager.loadServices()).toThrow('not active');
    });

    test('warns for optional service when plugin is missing', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({
        email: { plugin: 'adminMailer', required: false },
      });
      const ps = createMockPluginSys({});
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      manager.loadServices(); // should not throw

      expect(manager.hasService('email')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Optional service "email"')
      );
      warnSpy.mockRestore();
    });

    test('warns for optional service when plugin is not active', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const plugin = {
        pluginName: 'adminMailer',
        pluginConfig: { active: 0 },
      };
      const cm = createMockConfigManager({
        email: { plugin: 'adminMailer', required: false },
      });
      const ps = createMockPluginSys({ adminMailer: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      manager.loadServices(); // should not throw

      expect(manager.hasService('email')).toBe(false);
      warnSpy.mockRestore();
    });

    test('loads multiple services', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const authPlugin = createActivePlugin('adminUsers');
      const storagePlugin = createActivePlugin('adminStorage');
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
        storage: { plugin: 'adminStorage', required: false },
      });
      const ps = createMockPluginSys({
        adminUsers: authPlugin,
        adminStorage: storagePlugin,
      });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);

      manager.loadServices();

      expect(manager.hasService('auth')).toBe(true);
      expect(manager.hasService('storage')).toBe(true);
      logSpy.mockRestore();
    });
  });

  // ─── registerPlugin ───────────────────────────────────────────────────────

  describe('registerPlugin', () => {
    test('skips plugin without adminConfig.providesServices', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      const plugin = createActivePlugin('somePlugin');

      // Should not throw
      manager.registerPlugin(plugin);
    });

    test('registers plugin with matching service config', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const manager = new AdminServicesManager(cm);
      const plugin = createActivePlugin('adminUsers', {
        adminConfig: { providesServices: ['auth'] },
      });

      manager.registerPlugin(plugin);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('registered for service "auth"')
      );
      logSpy.mockRestore();
    });

    test('warns when service is not configured in adminConfig.json5', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({}); // no services configured
      const manager = new AdminServicesManager(cm);
      const plugin = createActivePlugin('adminMailer', {
        adminConfig: { providesServices: ['email'] },
      });

      manager.registerPlugin(plugin);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not configured in adminConfig')
      );
      warnSpy.mockRestore();
    });

    test('warns when plugin name does not match config', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const manager = new AdminServicesManager(cm);
      const plugin = createActivePlugin('wrongPlugin', {
        adminConfig: { providesServices: ['auth'] },
      });

      manager.registerPlugin(plugin);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('expects plugin "adminUsers"')
      );
      warnSpy.mockRestore();
    });
  });

  // ─── getService / hasService / getAllServices ─────────────────────────────

  describe('service getters', () => {
    test('getService returns null for unregistered service', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      expect(manager.getService('nonexistent')).toBeNull();
    });

    test('hasService returns false for unregistered service', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      expect(manager.hasService('nonexistent')).toBe(false);
    });

    test('getAllServices returns empty map initially', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      const all = manager.getAllServices();
      expect(all).toBeInstanceOf(Map);
      expect(all.size).toBe(0);
    });

    test('getAllServices returns loaded services', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createActivePlugin('adminUsers');
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({ adminUsers: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);
      manager.loadServices();

      const all = manager.getAllServices();
      expect(all.size).toBe(1);
      expect(all.get('auth')).toBe(plugin);
      logSpy.mockRestore();
    });
  });

  // ─── getEndpointsForPassData ──────────────────────────────────────────────

  describe('getEndpointsForPassData', () => {
    test('returns empty object when no services loaded', () => {
      const cm = createMockConfigManager();
      const manager = new AdminServicesManager(cm);
      expect(manager.getEndpointsForPassData()).toEqual({});
    });

    test('returns endpoints from service plugins', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createActivePlugin('adminUsers', {
        adminConfig: {
          apiEndpoints: {
            login: '/api/adminUsers/login',
            logout: '/api/adminUsers/logout',
          },
        },
      });
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({ adminUsers: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);
      manager.loadServices();

      const endpoints = manager.getEndpointsForPassData();
      expect(endpoints.auth).toEqual({
        login: '/api/adminUsers/login',
        logout: '/api/adminUsers/logout',
      });
      logSpy.mockRestore();
    });

    test('returns empty object for service without apiEndpoints', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createActivePlugin('adminUsers');
      const cm = createMockConfigManager({
        auth: { plugin: 'adminUsers', required: true },
      });
      const ps = createMockPluginSys({ adminUsers: plugin });
      const manager = new AdminServicesManager(cm);
      manager.setPluginSys(ps);
      manager.loadServices();

      const endpoints = manager.getEndpointsForPassData();
      expect(endpoints.auth).toEqual({});
      logSpy.mockRestore();
    });
  });
});
