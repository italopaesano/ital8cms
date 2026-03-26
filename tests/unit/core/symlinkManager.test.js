/**
 * Unit Tests per core/admin/lib/symlinkManager.js
 *
 * Testa la gestione dei symlink per le sezioni admin:
 * - installPluginSection (creazione symlink per plugin admin)
 * - uninstallPluginSection (rimozione symlink)
 * - validateSymlinks (validazione integrità)
 * - Gestione conflitti e casi edge
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const SymlinkManager = require('../../../core/admin/lib/symlinkManager');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;
let adminWebPagesPath;
let pluginsDir;

function createMockConfigManager(sections = {}) {
  return {
    getConfig: () => ({
      sections,
      menuOrder: Object.keys(sections),
    }),
  };
}

/**
 * Crea struttura plugin admin con adminWebSections/
 */
function createAdminPlugin(name, sectionIds = []) {
  const pluginDir = path.join(pluginsDir, name);
  fs.mkdirSync(pluginDir, { recursive: true });

  for (const sectionId of sectionIds) {
    const sectionDir = path.join(pluginDir, 'adminWebSections', sectionId);
    fs.mkdirSync(sectionDir, { recursive: true });
    fs.writeFileSync(path.join(sectionDir, 'index.ejs'), '<h1>Test</h1>');
  }

  return {
    pluginName: name,
    pathPluginFolder: pluginDir,
    pluginConfig: {
      active: 1,
      adminSections: sectionIds,
    },
  };
}

function createManager(configManager) {
  const manager = new SymlinkManager(configManager);
  manager.adminWebPagesPath = adminWebPagesPath;
  return manager;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlinkMgr-'));
  adminWebPagesPath = path.join(tmpDir, 'webPages');
  pluginsDir = path.join(tmpDir, 'plugins');
  fs.mkdirSync(adminWebPagesPath, { recursive: true });
  fs.mkdirSync(pluginsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SymlinkManager', () => {

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('stores configManager reference', () => {
      const cm = createMockConfigManager();
      const manager = new SymlinkManager(cm);
      expect(manager.configManager).toBe(cm);
    });
  });

  // ─── installPluginSection ─────────────────────────────────────────────────

  describe('installPluginSection', () => {
    test('skips non-admin plugins (name does not start with admin)', () => {
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = {
        pluginName: 'bootstrap',
        pathPluginFolder: path.join(pluginsDir, 'bootstrap'),
      };

      // Should not throw, just skip
      manager.installPluginSection(plugin);
      const entries = fs.readdirSync(adminWebPagesPath);
      expect(entries).toHaveLength(0);
    });

    test('skips admin plugin without adminSections array', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = {
        pluginName: 'adminEmpty',
        pathPluginFolder: path.join(pluginsDir, 'adminEmpty'),
        pluginConfig: {},
      };

      manager.installPluginSection(plugin);
      const entries = fs.readdirSync(adminWebPagesPath);
      expect(entries).toHaveLength(0);
      logSpy.mockRestore();
    });

    test('skips admin plugin with empty adminSections', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = {
        pluginName: 'adminNoSections',
        pathPluginFolder: path.join(pluginsDir, 'adminNoSections'),
        pluginConfig: { adminSections: [] },
      };

      manager.installPluginSection(plugin);
      const entries = fs.readdirSync(adminWebPagesPath);
      expect(entries).toHaveLength(0);
      logSpy.mockRestore();
    });

    test('creates symlink for each section in adminSections', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment', 'rolesManagment']);

      manager.installPluginSection(plugin);

      const symlink1 = path.join(adminWebPagesPath, 'usersManagment');
      const symlink2 = path.join(adminWebPagesPath, 'rolesManagment');

      expect(fs.existsSync(symlink1)).toBe(true);
      expect(fs.lstatSync(symlink1).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(symlink2)).toBe(true);
      expect(fs.lstatSync(symlink2).isSymbolicLink()).toBe(true);
      logSpy.mockRestore();
    });

    test('symlinks point to correct source directories (relative)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      manager.installPluginSection(plugin);

      const symlinkPath = path.join(adminWebPagesPath, 'usersManagment');
      const rawTarget = fs.readlinkSync(symlinkPath);
      const expectedAbsolute = path.join(plugin.pathPluginFolder, 'adminWebSections', 'usersManagment');
      // Symlink is relative — resolve to absolute for comparison
      const resolvedTarget = path.resolve(path.dirname(symlinkPath), rawTarget);
      expect(resolvedTarget).toBe(expectedAbsolute);
      // Verify it's actually a relative path (no leading /)
      expect(path.isAbsolute(rawTarget)).toBe(false);
      logSpy.mockRestore();
    });

    test('skips if symlink already points to correct target (absolute legacy)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      // Create correct symlink with absolute path (legacy format)
      const expectedTarget = path.join(plugin.pathPluginFolder, 'adminWebSections', 'usersManagment');
      const symlinkPath = path.join(adminWebPagesPath, 'usersManagment');
      fs.symlinkSync(expectedTarget, symlinkPath, 'dir');

      // Should recognize absolute legacy symlink as valid and skip
      manager.installPluginSection(plugin);

      // Symlink should still be the original absolute one (not recreated)
      expect(fs.readlinkSync(symlinkPath)).toBe(expectedTarget);
      logSpy.mockRestore();
    });

    test('skips if symlink already points to correct target (relative)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      // Create correct symlink with relative path (new format)
      const expectedTarget = path.join(plugin.pathPluginFolder, 'adminWebSections', 'usersManagment');
      const symlinkPath = path.join(adminWebPagesPath, 'usersManagment');
      const relativeTarget = path.relative(path.dirname(symlinkPath), expectedTarget);
      fs.symlinkSync(relativeTarget, symlinkPath, 'dir');

      // Should recognize relative symlink as valid and skip
      manager.installPluginSection(plugin);

      expect(fs.readlinkSync(symlinkPath)).toBe(relativeTarget);
      logSpy.mockRestore();
    });

    test('recreates symlink if pointing to wrong target', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      const wrongTarget = path.join(tmpDir, 'wrong');
      fs.mkdirSync(wrongTarget, { recursive: true });
      const symlinkPath = path.join(adminWebPagesPath, 'usersManagment');
      fs.symlinkSync(wrongTarget, symlinkPath, 'dir');

      manager.installPluginSection(plugin);

      const expectedAbsolute = path.join(plugin.pathPluginFolder, 'adminWebSections', 'usersManagment');
      const rawTarget = fs.readlinkSync(symlinkPath);
      const resolvedTarget = path.resolve(path.dirname(symlinkPath), rawTarget);
      expect(resolvedTarget).toBe(expectedAbsolute);
      expect(path.isAbsolute(rawTarget)).toBe(false);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('throws if non-symlink exists at target path', () => {
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      // Create regular directory at symlink path
      const conflictDir = path.join(adminWebPagesPath, 'usersManagment');
      fs.mkdirSync(conflictDir, { recursive: true });

      expect(() => manager.installPluginSection(plugin)).toThrow('not a symlink');
    });

    test('throws if section directory does not exist in plugin', () => {
      const cm = createMockConfigManager();
      const manager = createManager(cm);

      // Plugin with declared section but no directory
      const pluginDir = path.join(pluginsDir, 'adminBroken');
      fs.mkdirSync(pluginDir, { recursive: true });
      const plugin = {
        pluginName: 'adminBroken',
        pathPluginFolder: pluginDir,
        pluginConfig: { adminSections: ['nonexistent'] },
      };

      expect(() => manager.installPluginSection(plugin)).toThrow('does not exist');
    });

    test('saves adminSections on plugin object', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);

      manager.installPluginSection(plugin);

      expect(plugin.adminSections).toEqual(['usersManagment']);
      logSpy.mockRestore();
    });

    test('skips invalid sectionId (non-string)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = {
        pluginName: 'adminBad',
        pathPluginFolder: path.join(pluginsDir, 'adminBad'),
        pluginConfig: { adminSections: [null, 123, ''] },
      };

      // Should warn but not throw
      manager.installPluginSection(plugin);
      warnSpy.mockRestore();
    });
  });

  // ─── uninstallPluginSection ───────────────────────────────────────────────

  describe('uninstallPluginSection', () => {
    test('removes symlinks for all sections', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = createAdminPlugin('adminUsers', ['usersManagment', 'rolesManagment']);

      // Install first
      manager.installPluginSection(plugin);
      expect(fs.existsSync(path.join(adminWebPagesPath, 'usersManagment'))).toBe(true);
      expect(fs.existsSync(path.join(adminWebPagesPath, 'rolesManagment'))).toBe(true);

      // Uninstall
      manager.uninstallPluginSection(plugin);

      let exists1 = false, exists2 = false;
      try { fs.lstatSync(path.join(adminWebPagesPath, 'usersManagment')); exists1 = true; } catch (e) {}
      try { fs.lstatSync(path.join(adminWebPagesPath, 'rolesManagment')); exists2 = true; } catch (e) {}
      expect(exists1).toBe(false);
      expect(exists2).toBe(false);
      logSpy.mockRestore();
    });

    test('skips plugin without adminSections', () => {
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = { pluginName: 'adminEmpty' };

      // Should not throw
      manager.uninstallPluginSection(plugin);
    });

    test('handles non-existent symlink gracefully', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);
      const plugin = {
        pluginName: 'adminUsers',
        pathPluginFolder: path.join(pluginsDir, 'adminUsers'),
        adminSections: ['nonexistent'],
      };

      // Should not throw
      manager.uninstallPluginSection(plugin);
      logSpy.mockRestore();
    });

    test('skips removal if symlink points to different target', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);

      const wrongTarget = path.join(tmpDir, 'other');
      fs.mkdirSync(wrongTarget, { recursive: true });
      const symlinkPath = path.join(adminWebPagesPath, 'testSection');
      fs.symlinkSync(wrongTarget, symlinkPath, 'dir');

      const plugin = {
        pluginName: 'adminTest',
        pathPluginFolder: path.join(pluginsDir, 'adminTest'),
        adminSections: ['testSection'],
      };

      manager.uninstallPluginSection(plugin);

      // Symlink should still exist (not removed for safety)
      expect(fs.existsSync(symlinkPath)).toBe(true);
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    test('warns when entry is not a symlink', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager();
      const manager = createManager(cm);

      const dirPath = path.join(adminWebPagesPath, 'regularSection');
      fs.mkdirSync(dirPath, { recursive: true });

      const plugin = {
        pluginName: 'adminTest',
        pathPluginFolder: path.join(pluginsDir, 'adminTest'),
        adminSections: ['regularSection'],
      };

      manager.uninstallPluginSection(plugin);

      // Directory should still exist
      expect(fs.existsSync(dirPath)).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // ─── validateSymlinks ─────────────────────────────────────────────────────

  describe('validateSymlinks', () => {
    test('validates valid symlinks without errors', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createAdminPlugin('adminUsers', ['usersManagment']);
      const cm = createMockConfigManager({
        usersManagment: {
          type: 'plugin',
          plugin: 'adminUsers',
          enabled: true,
          required: true,
        },
      });
      const manager = createManager(cm);

      // Create valid symlink
      const expectedTarget = path.join(plugin.pathPluginFolder, 'adminWebSections', 'usersManagment');
      fs.symlinkSync(expectedTarget, path.join(adminWebPagesPath, 'usersManagment'), 'dir');

      // Should not throw or warn
      manager.validateSymlinks();
      logSpy.mockRestore();
    });

    test('skips hardcoded sections', () => {
      const cm = createMockConfigManager({
        systemSettings: {
          type: 'hardcoded',
          enabled: true,
        },
      });
      const manager = createManager(cm);

      // Should not check for symlink
      manager.validateSymlinks();
    });

    test('warns for missing required symlinks', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({
        usersManagment: {
          type: 'plugin',
          plugin: 'adminUsers',
          enabled: true,
          required: true,
        },
      });
      const manager = createManager(cm);

      manager.validateSymlinks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Required symlink')
      );
      warnSpy.mockRestore();
    });

    test('removes broken symlinks (pointing to non-existent target)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({
        brokenSection: {
          type: 'plugin',
          plugin: 'adminBroken',
          enabled: true,
          required: false,
        },
      });
      const manager = createManager(cm);

      // Create broken symlink
      const brokenTarget = path.join(tmpDir, 'nonexistent');
      const symlinkPath = path.join(adminWebPagesPath, 'brokenSection');
      fs.symlinkSync(brokenTarget, symlinkPath, 'dir');

      manager.validateSymlinks();

      // Should be removed
      let exists = false;
      try { fs.lstatSync(symlinkPath); exists = true; } catch (e) {}
      expect(exists).toBe(false);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('warns for non-symlink entry', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const cm = createMockConfigManager({
        regularDir: {
          type: 'plugin',
          plugin: 'adminTest',
          enabled: true,
          required: false,
        },
      });
      const manager = createManager(cm);

      // Create regular directory instead of symlink
      fs.mkdirSync(path.join(adminWebPagesPath, 'regularDir'), { recursive: true });

      manager.validateSymlinks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not a symlink')
      );
      warnSpy.mockRestore();
    });
  });
});
