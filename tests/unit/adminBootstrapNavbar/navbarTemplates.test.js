/**
 * Unit Tests per navbarTemplates.js
 *
 * Testa la generazione di template navbar predefiniti:
 * - Lista template disponibili (getTemplateList)
 * - Generazione da template (generateFromTemplate)
 * - Generazione vuota (generateEmpty)
 * - Validità JSON5 dell'output generato
 * - Corretto uso del navbarName nei template
 */

const JSON5 = require('json5');
const { getTemplateList, generateFromTemplate, generateEmpty } = require('../../../plugins/adminBootstrapNavbar/lib/navbarTemplates');

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('navbarTemplates', () => {

  // ─── getTemplateList ──────────────────────────────────────────────────────

  describe('getTemplateList', () => {
    test('returns a non-empty array', () => {
      const list = getTemplateList();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    test('each template has id, label, description', () => {
      const list = getTemplateList();
      for (const t of list) {
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('label');
        expect(t).toHaveProperty('description');
        expect(typeof t.id).toBe('string');
      }
    });

    test('each template has i18n labels (it and en)', () => {
      const list = getTemplateList();
      for (const t of list) {
        expect(t.label).toHaveProperty('it');
        expect(t.label).toHaveProperty('en');
        expect(typeof t.label.it).toBe('string');
        expect(typeof t.label.en).toBe('string');
      }
    });

    test('each template has i18n descriptions (it and en)', () => {
      const list = getTemplateList();
      for (const t of list) {
        expect(t.description).toHaveProperty('it');
        expect(t.description).toHaveProperty('en');
        expect(typeof t.description.it).toBe('string');
        expect(typeof t.description.en).toBe('string');
      }
    });

    test('template IDs are unique', () => {
      const list = getTemplateList();
      const ids = list.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('contains expected template IDs', () => {
      const list = getTemplateList();
      const ids = list.map(t => t.id);
      expect(ids).toContain('horizontalBase');
      expect(ids).toContain('horizontalComplete');
      expect(ids).toContain('sidebar');
      expect(ids).toContain('offcanvasResponsive');
      expect(ids).toContain('offcanvasAlways');
    });
  });

  // ─── generateFromTemplate ────────────────────────────────────────────────

  describe('generateFromTemplate', () => {
    test('returns null for unknown template ID', () => {
      const result = generateFromTemplate('nonExistentTemplate', 'test');
      expect(result).toBeNull();
    });

    test('returns a string for valid template ID', () => {
      const list = getTemplateList();
      for (const t of list) {
        const result = generateFromTemplate(t.id, 'testNav');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    test('generated content is valid JSON5', () => {
      const list = getTemplateList();
      for (const t of list) {
        const content = generateFromTemplate(t.id, 'testNav');
        expect(() => JSON5.parse(content)).not.toThrow();
      }
    });

    test('generated config has settings and sections', () => {
      const list = getTemplateList();
      for (const t of list) {
        const content = generateFromTemplate(t.id, 'testNav');
        const config = JSON5.parse(content);
        expect(config).toHaveProperty('settings');
        expect(config).toHaveProperty('sections');
        expect(config.settings).toHaveProperty('id');
        expect(config.sections).toHaveProperty('left');
        expect(config.sections).toHaveProperty('right');
      }
    });

    test('uses navbarName as settings.id', () => {
      const list = getTemplateList();
      for (const t of list) {
        const navbarName = 'myCustomNavbar';
        const content = generateFromTemplate(t.id, navbarName);
        const config = JSON5.parse(content);
        expect(config.settings.id).toBe(navbarName);
      }
    });

    test('horizontalBase has type horizontal', () => {
      const content = generateFromTemplate('horizontalBase', 'test');
      const config = JSON5.parse(content);
      expect(config.settings.type).toBe('horizontal');
    });

    test('sidebar has type vertical', () => {
      const content = generateFromTemplate('sidebar', 'test');
      const config = JSON5.parse(content);
      expect(config.settings.type).toBe('vertical');
    });

    test('offcanvasResponsive has type offcanvas', () => {
      const content = generateFromTemplate('offcanvasResponsive', 'test');
      const config = JSON5.parse(content);
      expect(config.settings.type).toBe('offcanvas');
    });

    test('offcanvasAlways has offcanvasAlways: true', () => {
      const content = generateFromTemplate('offcanvasAlways', 'test');
      const config = JSON5.parse(content);
      expect(config.settings.offcanvasAlways).toBe(true);
    });

    test('horizontalComplete has items with auth visibility', () => {
      const content = generateFromTemplate('horizontalComplete', 'test');
      const config = JSON5.parse(content);

      // Should have at least one item with showWhen or requiresAuth
      const allItems = [
        ...(config.sections.left || []),
        ...(config.sections.right || []),
      ];
      const authItems = allItems.filter(
        item => item.showWhen || item.requiresAuth !== undefined
      );
      expect(authItems.length).toBeGreaterThan(0);
    });

    test('horizontalComplete has a dropdown', () => {
      const content = generateFromTemplate('horizontalComplete', 'test');
      const config = JSON5.parse(content);
      const dropdowns = config.sections.left.filter(i => i.type === 'dropdown');
      expect(dropdowns.length).toBeGreaterThan(0);
    });

    test('horizontalComplete has a separator', () => {
      const content = generateFromTemplate('horizontalComplete', 'test');
      const config = JSON5.parse(content);
      const separators = config.sections.left.filter(i => i.type === 'separator');
      expect(separators.length).toBeGreaterThan(0);
    });
  });

  // ─── generateEmpty ────────────────────────────────────────────────────────

  describe('generateEmpty', () => {
    test('returns a string', () => {
      const result = generateEmpty('test');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('generated content is valid JSON5', () => {
      const content = generateEmpty('testEmpty');
      expect(() => JSON5.parse(content)).not.toThrow();
    });

    test('has settings with correct id', () => {
      const content = generateEmpty('myEmpty');
      const config = JSON5.parse(content);
      expect(config.settings.id).toBe('myEmpty');
    });

    test('has type horizontal', () => {
      const content = generateEmpty('test');
      const config = JSON5.parse(content);
      expect(config.settings.type).toBe('horizontal');
    });

    test('has empty sections (left and right)', () => {
      const content = generateEmpty('test');
      const config = JSON5.parse(content);
      expect(config.sections.left).toEqual([]);
      expect(config.sections.right).toEqual([]);
    });

    test('includes JSON5 standard comment on first line', () => {
      const content = generateEmpty('test');
      expect(content.startsWith('// This file follows the JSON5 standard')).toBe(true);
    });

    test('has default settings values', () => {
      const content = generateEmpty('test');
      const config = JSON5.parse(content);
      expect(config.settings.colorScheme).toBe('dark');
      expect(config.settings.bgClass).toBe('bg-primary');
      expect(config.settings.expandAt).toBe('lg');
      expect(config.settings.containerClass).toBe('container-fluid');
      expect(config.settings.autoActive).toBe(true);
    });
  });

  // ─── Cross-template consistency ───────────────────────────────────────────

  describe('cross-template consistency', () => {
    test('all templates start with JSON5 standard comment', () => {
      const list = getTemplateList();
      for (const t of list) {
        const content = generateFromTemplate(t.id, 'test');
        expect(content.startsWith('// This file follows the JSON5 standard')).toBe(true);
      }
    });

    test('all templates have valid navbar type', () => {
      const validTypes = ['horizontal', 'vertical', 'offcanvas'];
      const list = getTemplateList();
      for (const t of list) {
        const config = JSON5.parse(generateFromTemplate(t.id, 'test'));
        expect(validTypes).toContain(config.settings.type);
      }
    });

    test('all templates produce arrays for left and right sections', () => {
      const list = getTemplateList();
      for (const t of list) {
        const config = JSON5.parse(generateFromTemplate(t.id, 'test'));
        expect(Array.isArray(config.sections.left)).toBe(true);
        expect(Array.isArray(config.sections.right)).toBe(true);
      }
    });

    test('navbarName with special characters works', () => {
      // Names with underscores and hyphens
      const names = ['my-navbar', 'my_navbar', 'test123'];
      for (const name of names) {
        const content = generateEmpty(name);
        const config = JSON5.parse(content);
        expect(config.settings.id).toBe(name);
      }
    });
  });

  // ─── Module exports ───────────────────────────────────────────────────────

  describe('module exports', () => {
    test('exports all expected functions', () => {
      expect(typeof getTemplateList).toBe('function');
      expect(typeof generateFromTemplate).toBe('function');
      expect(typeof generateEmpty).toBe('function');
    });
  });
});
