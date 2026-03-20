/**
 * Unit Tests per core/admin/lib/configManager.js
 *
 * Testa il caricamento e la validazione della configurazione admin:
 * - Caricamento adminConfig.json5
 * - Validazione struttura (sections, menuOrder)
 * - Validazione tipi sezione (plugin, hardcoded)
 * - Getter (getConfig, getSection, getSections, getMenuOrder, getServices, getUI)
 *
 * NOTA: ConfigManager carica il file nel costruttore, quindi testiamo
 * usando il file reale del progetto (non mock).
 */

const path = require('path');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConfigManager', () => {
  let ConfigManager;
  let configManager;

  beforeAll(() => {
    ConfigManager = require('../../../core/admin/lib/configManager');
  });

  beforeEach(() => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    configManager = new ConfigManager();
    logSpy.mockRestore();
  });

  // ─── Constructor & loading ────────────────────────────────────────────────

  describe('constructor and loading', () => {
    test('loads config successfully', () => {
      expect(configManager.config).toBeDefined();
      expect(configManager.config).not.toBeNull();
    });

    test('config has version field', () => {
      expect(configManager.config.version).toBeDefined();
    });
  });

  // ─── getConfig ────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    test('returns the full config object', () => {
      const config = configManager.getConfig();
      expect(config).toBeDefined();
      expect(config.sections).toBeDefined();
      expect(config.menuOrder).toBeDefined();
    });
  });

  // ─── getSections ──────────────────────────────────────────────────────────

  describe('getSections', () => {
    test('returns sections object', () => {
      const sections = configManager.getSections();
      expect(typeof sections).toBe('object');
      expect(Object.keys(sections).length).toBeGreaterThan(0);
    });

    test('each section has a type field', () => {
      const sections = configManager.getSections();
      for (const [id, section] of Object.entries(sections)) {
        expect(section.type).toBeDefined();
        expect(['plugin', 'hardcoded']).toContain(section.type);
      }
    });

    test('plugin sections have a plugin field', () => {
      const sections = configManager.getSections();
      for (const [id, section] of Object.entries(sections)) {
        if (section.type === 'plugin') {
          expect(section.plugin).toBeDefined();
          expect(typeof section.plugin).toBe('string');
        }
      }
    });
  });

  // ─── getSection ───────────────────────────────────────────────────────────

  describe('getSection', () => {
    test('returns a specific section by ID', () => {
      const section = configManager.getSection('usersManagment');
      expect(section).toBeDefined();
      expect(section.type).toBe('plugin');
      expect(section.plugin).toBe('adminUsers');
    });

    test('returns null for non-existent section', () => {
      const section = configManager.getSection('nonExistent');
      expect(section).toBeNull();
    });
  });

  // ─── getMenuOrder ─────────────────────────────────────────────────────────

  describe('getMenuOrder', () => {
    test('returns an array', () => {
      const menuOrder = configManager.getMenuOrder();
      expect(Array.isArray(menuOrder)).toBe(true);
    });

    test('contains section IDs', () => {
      const menuOrder = configManager.getMenuOrder();
      expect(menuOrder.length).toBeGreaterThan(0);
      expect(menuOrder).toContain('usersManagment');
    });

    test('all menuOrder IDs exist in sections', () => {
      const menuOrder = configManager.getMenuOrder();
      const sections = configManager.getSections();
      for (const sectionId of menuOrder) {
        expect(sections[sectionId]).toBeDefined();
      }
    });
  });

  // ─── getServices ──────────────────────────────────────────────────────────

  describe('getServices', () => {
    test('returns services object', () => {
      const services = configManager.getServices();
      expect(typeof services).toBe('object');
    });

    test('auth service is configured', () => {
      const services = configManager.getServices();
      expect(services.auth).toBeDefined();
      expect(services.auth.plugin).toBe('adminUsers');
      expect(services.auth.required).toBe(true);
    });
  });

  // ─── getUI ────────────────────────────────────────────────────────────────

  describe('getUI', () => {
    test('returns UI configuration', () => {
      const ui = configManager.getUI();
      expect(typeof ui).toBe('object');
    });

    test('has title field', () => {
      const ui = configManager.getUI();
      expect(ui.title).toBeDefined();
      expect(typeof ui.title).toBe('string');
    });

    test('has welcomeMessage field', () => {
      const ui = configManager.getUI();
      expect(ui.welcomeMessage).toBeDefined();
    });
  });

  // ─── Validation ───────────────────────────────────────────────────────────

  describe('validation', () => {
    test('throws if config is null', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = null;
      expect(() => cm.validateConfig()).toThrow('Admin config is null');
    });

    test('throws if sections is missing', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = { menuOrder: [] };
      expect(() => cm.validateConfig()).toThrow('missing "sections"');
    });

    test('throws if menuOrder is missing', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = { sections: {} };
      expect(() => cm.validateConfig()).toThrow('missing "menuOrder"');
    });

    test('throws for section with missing type', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = {
        sections: { test: { label: 'Test' } },
        menuOrder: ['test'],
      };
      expect(() => cm.validateConfig()).toThrow('missing "type"');
    });

    test('throws for section with invalid type', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = {
        sections: { test: { type: 'invalid' } },
        menuOrder: ['test'],
      };
      expect(() => cm.validateConfig()).toThrow('invalid type');
    });

    test('throws for plugin section without plugin name', () => {
      const cm = Object.create(ConfigManager.prototype);
      cm.config = {
        sections: { test: { type: 'plugin' } },
        menuOrder: ['test'],
      };
      expect(() => cm.validateConfig()).toThrow('missing "plugin" name');
    });

    test('warns for menuOrder entry not in sections', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = Object.create(ConfigManager.prototype);
      cm.config = {
        sections: { real: { type: 'hardcoded' } },
        menuOrder: ['real', 'ghost'],
      };
      cm.validateConfig();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ghost')
      );
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});
