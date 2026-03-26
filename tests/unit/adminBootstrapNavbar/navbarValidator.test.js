/**
 * Unit Tests per navbarValidator.js
 *
 * Testa la validazione delle configurazioni navbar JSON5:
 * - Parsing JSON5
 * - Struttura richiesta (settings, sections)
 * - Valori settings
 * - Struttura items (regular, dropdown, separator, divider)
 * - Visibilità (requiresAuth, allowedRoles, showWhen)
 * - Validazione link interni
 * - Validazione ruoli con roleData
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { validate, VALID_TYPES, VALID_EXPAND_AT, VALID_COLOR_SCHEMES, VALID_POSITIONS, VALID_SHOW_WHEN } = require('../../../plugins/adminBootstrapNavbar/lib/navbarValidator');

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Genera una configurazione navbar JSON5 valida minimale
 */
function validConfig(overrides = {}) {
  const config = {
    settings: { type: 'horizontal', id: 'testNavbar', ...(overrides.settings || {}) },
    sections: { left: [], right: [], ...(overrides.sections || {}) },
    ...overrides,
  };
  // Remove nested overrides that were spread into config
  delete config.settings;
  delete config.sections;
  return JSON.stringify({
    settings: { type: 'horizontal', id: 'testNavbar', ...(overrides.settings || {}) },
    sections: { left: [], right: [], ...(overrides.sections || {}) },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('navbarValidator', () => {

  // ─── Exported constants ───────────────────────────────────────────────────

  describe('exported constants', () => {
    test('VALID_TYPES contains expected values', () => {
      expect(VALID_TYPES).toEqual(['horizontal', 'vertical', 'offcanvas']);
    });

    test('VALID_EXPAND_AT contains Bootstrap breakpoints', () => {
      expect(VALID_EXPAND_AT).toEqual(['sm', 'md', 'lg', 'xl', 'xxl']);
    });

    test('VALID_COLOR_SCHEMES contains dark and light', () => {
      expect(VALID_COLOR_SCHEMES).toEqual(['dark', 'light']);
    });

    test('VALID_POSITIONS contains start and end', () => {
      expect(VALID_POSITIONS).toEqual(['start', 'end']);
    });

    test('VALID_SHOW_WHEN contains authenticated and unauthenticated', () => {
      expect(VALID_SHOW_WHEN).toEqual(['authenticated', 'unauthenticated']);
    });
  });

  // ─── JSON5 Parsing ────────────────────────────────────────────────────────

  describe('JSON5 parsing', () => {
    test('valid JSON5 parses successfully', () => {
      const result = validate(validConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('JSON5 with comments parses successfully', () => {
      const content = `// Comment
{
  // Settings block
  "settings": { "type": "horizontal", "id": "test" },
  "sections": { "left": [], "right": [] },
}`;
      const result = validate(content);
      expect(result.valid).toBe(true);
    });

    test('JSON5 with trailing commas parses successfully', () => {
      const content = `{
  "settings": { "type": "horizontal", "id": "test", },
  "sections": { "left": [], "right": [], },
}`;
      const result = validate(content);
      expect(result.valid).toBe(true);
    });

    test('invalid JSON5 returns parse error', () => {
      const result = validate('{ invalid json }}}');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/JSON5 syntax error/);
    });

    test('empty string returns parse error', () => {
      const result = validate('');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/JSON5 syntax error/);
    });
  });

  // ─── Required Structure ───────────────────────────────────────────────────

  describe('required top-level structure', () => {
    test('missing settings object is an error', () => {
      const content = JSON.stringify({ sections: { left: [], right: [] } });
      const result = validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Missing or invalid "settings"'));
    });

    test('missing sections object is an error', () => {
      const content = JSON.stringify({ settings: { type: 'horizontal', id: 'test' } });
      const result = validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Missing or invalid "sections"'));
    });

    test('settings as non-object is an error', () => {
      const content = JSON.stringify({ settings: 'not-an-object', sections: { left: [], right: [] } });
      const result = validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Missing or invalid "settings"'));
    });

    test('sections as non-object is an error', () => {
      const content = JSON.stringify({ settings: { type: 'horizontal', id: 'test' }, sections: 'wrong' });
      const result = validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Missing or invalid "sections"'));
    });

    test('both missing stops validation early', () => {
      const content = JSON.stringify({});
      const result = validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });
  });

  // ─── Settings Validation ──────────────────────────────────────────────────

  describe('settings validation', () => {
    test('valid type values are accepted', () => {
      for (const type of VALID_TYPES) {
        const result = validate(validConfig({ settings: { type, id: 'test' } }));
        expect(result.errors).toHaveLength(0);
      }
    });

    test('invalid type is an error', () => {
      const result = validate(validConfig({ settings: { type: 'invalid-type', id: 'test' } }));
      expect(result.errors).toContainEqual(expect.stringContaining('settings.type'));
    });

    test('missing id is an error', () => {
      const content = JSON.stringify({
        settings: { type: 'horizontal' },
        sections: { left: [], right: [] },
      });
      const result = validate(content);
      expect(result.errors).toContainEqual(expect.stringContaining('settings.id'));
    });

    test('empty string id is an error', () => {
      const result = validate(validConfig({ settings: { type: 'horizontal', id: '  ' } }));
      expect(result.errors).toContainEqual(expect.stringContaining('settings.id'));
    });

    test('invalid colorScheme is a warning', () => {
      const result = validate(validConfig({ settings: { colorScheme: 'rainbow', id: 'test' } }));
      expect(result.valid).toBe(true); // warnings don't invalidate
      expect(result.warnings).toContainEqual(expect.stringContaining('settings.colorScheme'));
    });

    test('valid colorScheme values produce no warnings', () => {
      for (const cs of VALID_COLOR_SCHEMES) {
        const result = validate(validConfig({ settings: { colorScheme: cs, id: 'test' } }));
        expect(result.warnings.filter(w => w.includes('colorScheme'))).toHaveLength(0);
      }
    });

    test('invalid expandAt is a warning', () => {
      const result = validate(validConfig({ settings: { expandAt: 'huge', id: 'test' } }));
      expect(result.warnings).toContainEqual(expect.stringContaining('settings.expandAt'));
    });

    test('valid expandAt values produce no warnings', () => {
      for (const ea of VALID_EXPAND_AT) {
        const result = validate(validConfig({ settings: { expandAt: ea, id: 'test' } }));
        expect(result.warnings.filter(w => w.includes('expandAt'))).toHaveLength(0);
      }
    });

    test('invalid position is a warning', () => {
      const result = validate(validConfig({ settings: { position: 'center', id: 'test' } }));
      expect(result.warnings).toContainEqual(expect.stringContaining('settings.position'));
    });

    test('valid position values produce no warnings', () => {
      for (const pos of VALID_POSITIONS) {
        const result = validate(validConfig({ settings: { position: pos, id: 'test' } }));
        expect(result.warnings.filter(w => w.includes('position'))).toHaveLength(0);
      }
    });

    test('autoActive as non-boolean is a warning', () => {
      const result = validate(validConfig({ settings: { autoActive: 'yes', id: 'test' } }));
      expect(result.warnings).toContainEqual(expect.stringContaining('settings.autoActive'));
    });

    test('autoActive as boolean produces no warning', () => {
      const result = validate(validConfig({ settings: { autoActive: true, id: 'test' } }));
      expect(result.warnings.filter(w => w.includes('autoActive'))).toHaveLength(0);
    });

    test('offcanvasAlways as non-boolean is a warning', () => {
      const result = validate(validConfig({ settings: { offcanvasAlways: 1, id: 'test' } }));
      expect(result.warnings).toContainEqual(expect.stringContaining('settings.offcanvasAlways'));
    });

    test('offcanvasAlways as boolean produces no warning', () => {
      const result = validate(validConfig({ settings: { offcanvasAlways: false, id: 'test' } }));
      expect(result.warnings.filter(w => w.includes('offcanvasAlways'))).toHaveLength(0);
    });
  });

  // ─── Regular Item Validation ──────────────────────────────────────────────

  describe('regular item validation', () => {
    test('valid regular item passes', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Home', href: '/' }], right: [] },
      }));
      expect(result.valid).toBe(true);
    });

    test('item without label is an error', () => {
      const result = validate(validConfig({
        sections: { left: [{ href: '/' }], right: [] },
      }));
      expect(result.errors).toContainEqual(expect.stringContaining('must have a "label"'));
    });

    test('item with non-string label is an error', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 123, href: '/' }], right: [] },
      }));
      expect(result.errors).toContainEqual(expect.stringContaining('must have a "label"'));
    });

    test('separator has no required fields', () => {
      const result = validate(validConfig({
        sections: { left: [{ type: 'separator' }], right: [] },
      }));
      expect(result.valid).toBe(true);
    });

    test('divider has no required fields', () => {
      const result = validate(validConfig({
        sections: { left: [{ type: 'divider' }], right: [] },
      }));
      expect(result.valid).toBe(true);
    });
  });

  // ─── Dropdown Validation ──────────────────────────────────────────────────

  describe('dropdown validation', () => {
    test('valid dropdown passes', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            label: 'Menu',
            items: [{ label: 'Item 1', href: '#' }],
          }],
          right: [],
        },
      }));
      expect(result.valid).toBe(true);
    });

    test('dropdown without label is an error', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            items: [{ label: 'Item 1', href: '#' }],
          }],
          right: [],
        },
      }));
      expect(result.errors).toContainEqual(expect.stringContaining('dropdown must have a "label"'));
    });

    test('dropdown without items array is an error', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            label: 'Menu',
          }],
          right: [],
        },
      }));
      expect(result.errors).toContainEqual(expect.stringContaining('dropdown must have an "items" array'));
    });

    test('dropdown sub-items are validated recursively', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            label: 'Menu',
            items: [{ href: '#' }], // Missing label in sub-item
          }],
          right: [],
        },
      }));
      expect(result.errors).toContainEqual(expect.stringContaining('items[0]'));
      expect(result.errors).toContainEqual(expect.stringContaining('must have a "label"'));
    });

    test('dropdown with divider in items passes', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            label: 'Menu',
            items: [
              { label: 'Item 1', href: '#' },
              { type: 'divider' },
              { label: 'Item 2', href: '#' },
            ],
          }],
          right: [],
        },
      }));
      expect(result.valid).toBe(true);
    });
  });

  // ─── Visibility Validation ────────────────────────────────────────────────

  describe('visibility validation', () => {
    test('valid showWhen values produce no warning', () => {
      for (const sw of VALID_SHOW_WHEN) {
        const result = validate(validConfig({
          sections: { left: [{ label: 'Test', href: '#', showWhen: sw }], right: [] },
        }));
        expect(result.warnings.filter(w => w.includes('showWhen'))).toHaveLength(0);
      }
    });

    test('invalid showWhen produces a warning', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', showWhen: 'always' }], right: [] },
      }));
      expect(result.warnings).toContainEqual(expect.stringContaining('showWhen'));
    });

    test('requiresAuth as non-boolean is a warning', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', requiresAuth: 'yes' }], right: [] },
      }));
      expect(result.warnings).toContainEqual(expect.stringContaining('requiresAuth'));
    });

    test('allowedRoles as non-array is a warning', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', allowedRoles: 'admin' }], right: [] },
      }));
      expect(result.warnings).toContainEqual(expect.stringContaining('allowedRoles'));
    });

    test('allowedRoles with non-number is a warning', () => {
      const roleData = { roles: { '0': { name: 'root' }, '1': { name: 'admin' } } };
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', allowedRoles: ['admin'] }], right: [] },
      }), { roleData });
      expect(result.warnings).toContainEqual(expect.stringContaining('not a number'));
    });

    test('allowedRoles with unknown role ID is a warning', () => {
      const roleData = { roles: { '0': { name: 'root' }, '1': { name: 'admin' } } };
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', allowedRoles: [999] }], right: [] },
      }), { roleData });
      expect(result.warnings).toContainEqual(expect.stringContaining('role ID 999 not found'));
    });

    test('allowedRoles with valid role IDs produce no warning', () => {
      const roleData = { roles: { '0': { name: 'root' }, '1': { name: 'admin' } } };
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', allowedRoles: [0, 1] }], right: [] },
      }), { roleData });
      expect(result.warnings.filter(w => w.includes('allowedRoles'))).toHaveLength(0);
    });

    test('allowedRoles without roleData skips role validation', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Test', href: '#', allowedRoles: [999] }], right: [] },
      }));
      expect(result.warnings.filter(w => w.includes('role ID'))).toHaveLength(0);
    });

    test('dropdown visibility is validated', () => {
      const result = validate(validConfig({
        sections: {
          left: [{
            type: 'dropdown',
            label: 'Menu',
            items: [{ label: 'X', href: '#' }],
            requiresAuth: 'not-bool',
          }],
          right: [],
        },
      }));
      expect(result.warnings).toContainEqual(expect.stringContaining('requiresAuth'));
    });
  });

  // ─── Internal Link Validation ─────────────────────────────────────────────

  describe('internal link validation', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navbar-validator-'));
      // Create test files
      fs.writeFileSync(path.join(tmpDir, 'index.ejs'), '');
      fs.writeFileSync(path.join(tmpDir, 'about.ejs'), '');
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'index.ejs'), '');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('existing file link produces no warning', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'About', href: '/about.ejs' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'warning' });
      expect(result.warnings.filter(w => w.includes('target file not found'))).toHaveLength(0);
    });

    test('non-existing file link produces warning (default severity)', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Missing', href: '/nonexistent.ejs' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'warning' });
      expect(result.warnings).toContainEqual(expect.stringContaining('target file not found'));
      expect(result.valid).toBe(true); // warning, not error
    });

    test('non-existing file link produces error when severity=error', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Missing', href: '/nonexistent.ejs' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toContainEqual(expect.stringContaining('target file not found'));
      expect(result.valid).toBe(false);
    });

    test('root "/" is always valid', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Home', href: '/' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('API routes are skipped', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'API', href: '/api/plugin/endpoint' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('anchor-only routes are skipped', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Hash', href: '/#section' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('external URLs are skipped', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Ext', href: 'https://example.com' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('admin paths are skipped', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Admin', href: '/admin/settings' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('pluginPages paths are skipped', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Login', href: '/pluginPages/adminUsers/login.ejs' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('file without extension found with .ejs appended', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'About', href: '/about' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('directory with index.ejs is valid', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Subdir', href: '/subdir' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('link validation skipped without wwwDir', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'Missing', href: '/nonexistent.ejs' }], right: [] },
      }), { linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('query strings are stripped before validation', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'About', href: '/about.ejs?foo=bar' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });

    test('hash fragments are stripped before validation', () => {
      const result = validate(validConfig({
        sections: { left: [{ label: 'About', href: '/about.ejs#section' }], right: [] },
      }), { wwwDir: tmpDir, linkValidationSeverity: 'error' });
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── Mixed sections ───────────────────────────────────────────────────────

  describe('mixed section content', () => {
    test('items in both left and right are validated', () => {
      const result = validate(validConfig({
        sections: {
          left: [{ href: '/' }], // Missing label
          right: [{ href: '/' }], // Missing label
        },
      }));
      expect(result.errors.length).toBe(2);
      expect(result.errors[0]).toContain('sections.left[0]');
      expect(result.errors[1]).toContain('sections.right[0]');
    });

    test('complex valid configuration passes', () => {
      const result = validate(validConfig({
        settings: {
          type: 'horizontal',
          id: 'mainNavbar',
          colorScheme: 'dark',
          bgClass: 'bg-primary',
          expandAt: 'lg',
          autoActive: true,
        },
        sections: {
          left: [
            { label: 'Home', href: '/' },
            { type: 'separator' },
            {
              type: 'dropdown',
              label: 'Pages',
              items: [
                { label: 'Page 1', href: '/page1' },
                { type: 'divider' },
                { label: 'Page 2', href: '/page2' },
              ],
            },
          ],
          right: [
            { label: 'Login', href: '/login', showWhen: 'unauthenticated' },
            { label: 'Logout', href: '/logout', showWhen: 'authenticated' },
          ],
        },
      }));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── Return structure ─────────────────────────────────────────────────────

  describe('return structure', () => {
    test('always returns { valid, errors, warnings }', () => {
      const result = validate(validConfig());
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    test('valid is true when no errors', () => {
      const result = validate(validConfig());
      expect(result.valid).toBe(true);
    });

    test('valid is false when errors exist', () => {
      const result = validate('invalid json!!!');
      expect(result.valid).toBe(false);
    });

    test('warnings do not affect valid flag', () => {
      const result = validate(validConfig({ settings: { colorScheme: 'neon', id: 'test' } }));
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
