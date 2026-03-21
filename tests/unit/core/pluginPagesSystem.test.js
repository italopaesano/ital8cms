/**
 * Unit Tests per core/pluginPagesSystem.js
 *
 * Testa il sistema di pagine pubbliche dei plugin:
 * - Creazione symlink per plugin con webPages/
 * - Validazione e pulizia symlink esistenti
 * - Rimozione symlink
 * - Rilevamento plugin con pagine pubbliche
 * - Gestione conflitti symlink
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;
let pluginPagesDir;
let pluginsDir;

/**
 * Crea un mock di pluginSys
 */
function createMockPluginSys(pluginsList = []) {
  const pluginsMap = new Map();
  for (const p of pluginsList) {
    pluginsMap.set(p.pluginName, p);
  }
  return {
    getAllPlugins: () => pluginsList,
    getPlugin: (name) => pluginsMap.get(name) || null,
  };
}

/**
 * Crea una struttura plugin con webPages/
 */
function createPluginWithWebPages(name) {
  const pluginDir = path.join(pluginsDir, name);
  const webPagesDir = path.join(pluginDir, 'webPages');
  fs.mkdirSync(webPagesDir, { recursive: true });
  fs.writeFileSync(path.join(webPagesDir, 'index.ejs'), '<h1>Test</h1>');
  return {
    pluginName: name,
    pathPluginFolder: pluginDir,
  };
}

/**
 * Crea una struttura plugin senza webPages/
 */
function createPluginWithoutWebPages(name) {
  const pluginDir = path.join(pluginsDir, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  return {
    pluginName: name,
    pathPluginFolder: pluginDir,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluginPages-'));
  pluginPagesDir = path.join(tmpDir, 'pluginPages');
  pluginsDir = path.join(tmpDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// We need to override the hardcoded path in PluginPagesSystem.
// Since the constructor uses __dirname, we'll test individual methods
// by creating an instance and overriding pluginPagesDir.
function createSystem(pluginSys) {
  const PluginPagesSystem = require('../../../core/pluginPagesSystem');
  const logSpy = jest.spyOn(console, 'log').mockImplementation();
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation();

  const system = new PluginPagesSystem(pluginSys);
  // Override the hardcoded path
  system.pluginPagesDir = pluginPagesDir;

  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();

  return system;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PluginPagesSystem', () => {

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('stores pluginSys reference', () => {
      const ps = createMockPluginSys();
      const system = createSystem(ps);
      expect(system.pluginSys).toBe(ps);
    });

    test('sets pluginPagesDir path', () => {
      const ps = createMockPluginSys();
      const system = createSystem(ps);
      expect(system.pluginPagesDir).toBe(pluginPagesDir);
    });
  });

  // ─── createSymlinkForPlugin ───────────────────────────────────────────────

  describe('createSymlinkForPlugin', () => {
    test('creates relative symlink for plugin with webPages', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createPluginWithWebPages('myPlugin');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');
      system.createSymlinkForPlugin('myPlugin', sourceDir);

      const symlinkPath = path.join(pluginPagesDir, 'myPlugin');
      expect(fs.existsSync(symlinkPath)).toBe(true);
      expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      // Symlink is relative — resolve to absolute for comparison
      const rawTarget = fs.readlinkSync(symlinkPath);
      const resolvedTarget = path.resolve(path.dirname(symlinkPath), rawTarget);
      expect(resolvedTarget).toBe(sourceDir);
      expect(path.isAbsolute(rawTarget)).toBe(false);
      logSpy.mockRestore();
    });

    test('skips if absolute legacy symlink already points to correct target', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createPluginWithWebPages('existingPlugin');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');

      // Create symlink with absolute path (legacy format)
      const symlinkPath = path.join(pluginPagesDir, 'existingPlugin');
      fs.symlinkSync(sourceDir, symlinkPath, 'dir');

      // Try to create again — should recognize as valid and skip
      system.createSymlinkForPlugin('existingPlugin', sourceDir);

      // Symlink should still be the original absolute one (not recreated)
      expect(fs.readlinkSync(symlinkPath)).toBe(sourceDir);
      logSpy.mockRestore();
    });

    test('skips if relative symlink already points to correct target', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createPluginWithWebPages('existingPlugin');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');

      // Create symlink with relative path (new format)
      const symlinkPath = path.join(pluginPagesDir, 'existingPlugin');
      const relativeTarget = path.relative(path.dirname(symlinkPath), sourceDir);
      fs.symlinkSync(relativeTarget, symlinkPath, 'dir');

      // Try to create again — should recognize as valid and skip
      system.createSymlinkForPlugin('existingPlugin', sourceDir);

      expect(fs.readlinkSync(symlinkPath)).toBe(relativeTarget);
      logSpy.mockRestore();
    });

    test('recreates symlink as relative if pointing to wrong target', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const plugin = createPluginWithWebPages('wrongTarget');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const correctSource = path.join(plugin.pathPluginFolder, 'webPages');
      const wrongSource = path.join(tmpDir, 'wrong');
      fs.mkdirSync(wrongSource, { recursive: true });

      // Create symlink pointing to wrong target
      const symlinkPath = path.join(pluginPagesDir, 'wrongTarget');
      fs.symlinkSync(wrongSource, symlinkPath, 'dir');

      // Recreate with correct target
      system.createSymlinkForPlugin('wrongTarget', correctSource);

      const rawTarget = fs.readlinkSync(symlinkPath);
      const resolvedTarget = path.resolve(path.dirname(symlinkPath), rawTarget);
      expect(resolvedTarget).toBe(correctSource);
      expect(path.isAbsolute(rawTarget)).toBe(false);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('reports error if non-symlink exists at target path', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const plugin = createPluginWithWebPages('conflicting');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');

      // Create regular directory (not symlink) at target
      const conflictPath = path.join(pluginPagesDir, 'conflicting');
      fs.mkdirSync(conflictPath, { recursive: true });

      system.createSymlinkForPlugin('conflicting', sourceDir);

      // Should not have replaced the directory
      expect(fs.lstatSync(conflictPath).isSymbolicLink()).toBe(false);
      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ─── removeSymlinkForPlugin ───────────────────────────────────────────────

  describe('removeSymlinkForPlugin', () => {
    test('removes existing symlink', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createPluginWithWebPages('toRemove');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');
      const symlinkPath = path.join(pluginPagesDir, 'toRemove');
      fs.symlinkSync(sourceDir, symlinkPath, 'dir');

      system.removeSymlinkForPlugin('toRemove');

      expect(fs.existsSync(symlinkPath)).toBe(false);
      logSpy.mockRestore();
    });

    test('handles non-existent symlink gracefully', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const ps = createMockPluginSys();
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });

      // Should not throw
      system.removeSymlinkForPlugin('nonexistent');
      logSpy.mockRestore();
    });

    test('warns when target is not a symlink', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const ps = createMockPluginSys();
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const dirPath = path.join(pluginPagesDir, 'notSymlink');
      fs.mkdirSync(dirPath);

      system.removeSymlinkForPlugin('notSymlink');

      // Directory should still exist
      expect(fs.existsSync(dirPath)).toBe(true);
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ─── hasPublicPages ───────────────────────────────────────────────────────

  describe('hasPublicPages', () => {
    test('returns true for plugin with webPages directory', () => {
      const plugin = createPluginWithWebPages('withPages');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      expect(system.hasPublicPages('withPages')).toBe(true);
    });

    test('returns false for plugin without webPages directory', () => {
      const plugin = createPluginWithoutWebPages('withoutPages');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      expect(system.hasPublicPages('withoutPages')).toBe(false);
    });

    test('returns false for non-existent plugin', () => {
      const ps = createMockPluginSys();
      const system = createSystem(ps);

      expect(system.hasPublicPages('nonexistent')).toBe(false);
    });
  });

  // ─── getPluginPagesDirectory ──────────────────────────────────────────────

  describe('getPluginPagesDirectory', () => {
    test('returns the pluginPages directory path', () => {
      const ps = createMockPluginSys();
      const system = createSystem(ps);
      expect(system.getPluginPagesDirectory()).toBe(pluginPagesDir);
    });
  });

  // ─── getPluginsWithPublicPages ────────────────────────────────────────────

  describe('getPluginsWithPublicPages', () => {
    test('returns empty array when no plugins have webPages', () => {
      const plugin = createPluginWithoutWebPages('noPages');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      expect(system.getPluginsWithPublicPages()).toEqual([]);
    });

    test('returns only plugins with webPages directory', () => {
      const withPages = createPluginWithWebPages('with');
      const withoutPages = createPluginWithoutWebPages('without');
      const ps = createMockPluginSys([withPages, withoutPages]);
      const system = createSystem(ps);

      const result = system.getPluginsWithPublicPages();
      expect(result).toEqual(['with']);
    });

    test('returns multiple plugins with webPages', () => {
      const p1 = createPluginWithWebPages('alpha');
      const p2 = createPluginWithWebPages('beta');
      const ps = createMockPluginSys([p1, p2]);
      const system = createSystem(ps);

      const result = system.getPluginsWithPublicPages();
      expect(result).toContain('alpha');
      expect(result).toContain('beta');
      expect(result).toHaveLength(2);
    });
  });

  // ─── validateAndCleanSymlinks ─────────────────────────────────────────────

  describe('validateAndCleanSymlinks', () => {
    test('does nothing if pluginPages directory does not exist', () => {
      const ps = createMockPluginSys();
      const system = createSystem(ps);
      // pluginPagesDir not created - should not throw
      system.validateAndCleanSymlinks();
    });

    test('removes broken symlinks', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const ps = createMockPluginSys();
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });

      // Create broken symlink (points to non-existent target)
      const brokenTarget = path.join(tmpDir, 'nonexistent');
      const symlinkPath = path.join(pluginPagesDir, 'brokenPlugin');
      fs.symlinkSync(brokenTarget, symlinkPath, 'dir');

      system.validateAndCleanSymlinks();

      // Broken symlink should be removed
      let exists = false;
      try {
        fs.lstatSync(symlinkPath);
        exists = true;
      } catch (e) {
        exists = false;
      }
      expect(exists).toBe(false);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('removes orphaned symlinks (plugin no longer exists)', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      // Plugin exists in filesystem but NOT in pluginSys
      const plugin = createPluginWithWebPages('orphaned');
      const ps = createMockPluginSys([]); // empty - no plugins
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');
      const symlinkPath = path.join(pluginPagesDir, 'orphaned');
      fs.symlinkSync(sourceDir, symlinkPath, 'dir');

      system.validateAndCleanSymlinks();

      let exists = false;
      try {
        fs.lstatSync(symlinkPath);
        exists = true;
      } catch (e) {
        exists = false;
      }
      expect(exists).toBe(false);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('keeps valid symlinks for active plugins', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const plugin = createPluginWithWebPages('active');
      const ps = createMockPluginSys([plugin]);
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      const sourceDir = path.join(plugin.pathPluginFolder, 'webPages');
      const symlinkPath = path.join(pluginPagesDir, 'active');
      fs.symlinkSync(sourceDir, symlinkPath, 'dir');

      system.validateAndCleanSymlinks();

      expect(fs.existsSync(symlinkPath)).toBe(true);
      expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      logSpy.mockRestore();
    });

    test('skips non-symlink entries', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const ps = createMockPluginSys();
      const system = createSystem(ps);

      fs.mkdirSync(pluginPagesDir, { recursive: true });
      // Create regular directory (not symlink)
      const dirPath = path.join(pluginPagesDir, 'regularDir');
      fs.mkdirSync(dirPath);

      system.validateAndCleanSymlinks();

      // Regular directory should not be removed
      expect(fs.existsSync(dirPath)).toBe(true);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  // ─── initialize ───────────────────────────────────────────────────────────

  describe('initialize', () => {
    test('creates pluginPages directory if it does not exist', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const ps = createMockPluginSys([]);
      const system = createSystem(ps);

      system.initialize();

      expect(fs.existsSync(pluginPagesDir)).toBe(true);
      logSpy.mockRestore();
    });

    test('creates symlinks for plugins with webPages', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const p1 = createPluginWithWebPages('plugA');
      const p2 = createPluginWithWebPages('plugB');
      const p3 = createPluginWithoutWebPages('plugC');
      const ps = createMockPluginSys([p1, p2, p3]);
      const system = createSystem(ps);

      system.initialize();

      expect(fs.existsSync(path.join(pluginPagesDir, 'plugA'))).toBe(true);
      expect(fs.existsSync(path.join(pluginPagesDir, 'plugB'))).toBe(true);
      expect(fs.existsSync(path.join(pluginPagesDir, 'plugC'))).toBe(false);
      logSpy.mockRestore();
    });

    test('handles empty plugin list', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const ps = createMockPluginSys([]);
      const system = createSystem(ps);

      system.initialize();

      expect(fs.existsSync(pluginPagesDir)).toBe(true);
      const entries = fs.readdirSync(pluginPagesDir);
      expect(entries).toHaveLength(0);
      logSpy.mockRestore();
    });
  });
});
