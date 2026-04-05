/**
 * Unit tests for seoFileManager.js
 *
 * Tests file I/O operations for the adminSeo plugin:
 * - readGlobalSettings(): reads pluginConfig.json5 custom block
 * - readFullPluginConfig(): reads entire pluginConfig.json5
 * - readPageRules(): reads seoPages.json5
 * - saveGlobalSettings(): saves custom block with backup
 * - savePageRules(): saves seoPages.json5 with backup
 * - createBackup(): timestamped backup creation
 * - cleanupBackups(): old backup removal
 *
 * Uses temporary directories for all write operations — no production files touched.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readGlobalSettings,
  readFullPluginConfig,
  readPageRules,
  saveGlobalSettings,
  savePageRules,
  createBackup,
  cleanupBackups,
} = require('../../../plugins/adminSeo/lib/seoFileManager');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEST FIXTURES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seoFileManager-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTestFile(fileName, data) {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function writePlainFile(fileName, content) {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// readGlobalSettings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('readGlobalSettings', () => {
  test('reads custom block from pluginConfig.json5', () => {
    writeTestFile('pluginConfig.json5', {
      active: 1,
      custom: { siteName: 'Test Site', enableMetaTags: true },
    });
    const result = readGlobalSettings(tmpDir);
    expect(result.success).toBe(true);
    expect(result.data.siteName).toBe('Test Site');
    expect(result.data.enableMetaTags).toBe(true);
  });

  test('returns empty object when custom block is missing', () => {
    writeTestFile('pluginConfig.json5', { active: 1 });
    const result = readGlobalSettings(tmpDir);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  test('returns error for missing file', () => {
    const result = readGlobalSettings(path.join(tmpDir, 'nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('returns error for invalid JSON5', () => {
    writePlainFile('pluginConfig.json5', '{ bad json }}}');
    const result = readGlobalSettings(tmpDir);
    expect(result.success).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// readFullPluginConfig
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('readFullPluginConfig', () => {
  test('reads entire config including system fields', () => {
    const config = { active: 1, isInstalled: 1, weight: 5, custom: { siteName: 'X' } };
    writeTestFile('pluginConfig.json5', config);
    const result = readFullPluginConfig(tmpDir);
    expect(result.success).toBe(true);
    expect(result.data.active).toBe(1);
    expect(result.data.weight).toBe(5);
    expect(result.data.custom.siteName).toBe('X');
  });

  test('returns error for missing file', () => {
    const result = readFullPluginConfig(path.join(tmpDir, 'nope'));
    expect(result.success).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// readPageRules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('readPageRules', () => {
  test('reads seoPages.json5 data and raw string', () => {
    const rules = { '/about': { title: 'About' }, '/blog/*': { ogType: 'article' } };
    writeTestFile('seoPages.json5', rules);
    const result = readPageRules(tmpDir);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(rules);
    expect(typeof result.raw).toBe('string');
    expect(result.raw).toContain('/about');
  });

  test('returns error for missing file', () => {
    const result = readPageRules(path.join(tmpDir, 'missing'));
    expect(result.success).toBe(false);
  });

  test('returns error for invalid JSON', () => {
    writePlainFile('seoPages.json5', 'not valid json{{{');
    const result = readPageRules(tmpDir);
    expect(result.success).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// savePageRules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('savePageRules', () => {
  test('saves rules and creates backup', async () => {
    // Create initial file
    const rules = { '/old': { title: 'Old' } };
    writeTestFile('seoPages.json5', rules);
    const backupDir = path.join(tmpDir, 'backups');

    const newRules = { '/new': { title: 'New' } };
    const result = await savePageRules(tmpDir, newRules, backupDir, 10);
    expect(result.success).toBe(true);

    // Verify file was updated
    const saved = readPageRules(tmpDir);
    expect(saved.data).toEqual(newRules);

    // Verify backup was created
    const backups = fs.readdirSync(backupDir);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0]).toMatch(/^seoPages_/);
  });

  test('returns error if file cannot be written', async () => {
    // Don't create the file at all — saveJson5 will fail
    const backupDir = path.join(tmpDir, 'backups');
    const result = await savePageRules(path.join(tmpDir, 'nonexistent'), {}, backupDir, 10);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// saveGlobalSettings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('saveGlobalSettings', () => {
  test('replaces only custom block, preserving system fields', async () => {
    const initialConfig = {
      active: 1,
      isInstalled: 1,
      weight: 5,
      dependency: {},
      custom: { siteName: 'Old' },
    };
    writeTestFile('pluginConfig.json5', initialConfig);
    const backupDir = path.join(tmpDir, 'backups');

    const newCustom = { siteName: 'New', enableMetaTags: false };
    const result = await saveGlobalSettings(tmpDir, newCustom, backupDir, 10);
    expect(result.success).toBe(true);

    // Verify system fields preserved
    const saved = readFullPluginConfig(tmpDir);
    expect(saved.data.active).toBe(1);
    expect(saved.data.weight).toBe(5);
    expect(saved.data.custom.siteName).toBe('New');
    expect(saved.data.custom.enableMetaTags).toBe(false);
  });

  test('creates backup before save', async () => {
    writeTestFile('pluginConfig.json5', { active: 1, custom: {} });
    const backupDir = path.join(tmpDir, 'backups');

    await saveGlobalSettings(tmpDir, { siteName: 'X' }, backupDir, 10);

    const backups = fs.readdirSync(backupDir);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0]).toMatch(/^pluginConfig_/);
  });

  test('returns error for missing file', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    const result = await saveGlobalSettings(path.join(tmpDir, 'nope'), {}, backupDir, 10);
    expect(result.success).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// createBackup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('createBackup', () => {
  test('creates backup file with timestamp', async () => {
    const filePath = writePlainFile('test.json5', '{"key": "value"}');
    const backupDir = path.join(tmpDir, 'backups');

    await createBackup(filePath, backupDir, 10, 'test');

    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^test_\d{4}-\d{2}-\d{2}T/);
    expect(backups[0]).toMatch(/\.json5$/);

    // Verify content matches original
    const backupContent = fs.readFileSync(path.join(backupDir, backups[0]), 'utf8');
    expect(backupContent).toBe('{"key": "value"}');
  });

  test('creates backup directory if it does not exist', async () => {
    const filePath = writePlainFile('test.json5', 'content');
    const deepBackupDir = path.join(tmpDir, 'deep', 'nested', 'backups');

    await createBackup(filePath, deepBackupDir, 10, 'test');

    expect(fs.existsSync(deepBackupDir)).toBe(true);
    const backups = fs.readdirSync(deepBackupDir);
    expect(backups).toHaveLength(1);
  });

  test('does not throw for missing source file', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    // Should not throw — warns to console instead
    await expect(
      createBackup(path.join(tmpDir, 'missing.json5'), backupDir, 10, 'test')
    ).resolves.not.toThrow();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// cleanupBackups
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('cleanupBackups', () => {
  function createFakeBackups(backupDir, prefix, count) {
    fs.mkdirSync(backupDir, { recursive: true });
    const files = [];
    for (let i = 0; i < count; i++) {
      // Use zero-padded counter to simulate ISO timestamps
      const name = `${prefix}_2026-01-${String(i + 1).padStart(2, '0')}T00-00-00.json5`;
      fs.writeFileSync(path.join(backupDir, name), `backup ${i}`, 'utf8');
      files.push(name);
    }
    return files;
  }

  test('removes excess backups keeping maxBackups most recent', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    createFakeBackups(backupDir, 'seoPages', 15);

    await cleanupBackups(backupDir, 'seoPages', 5);

    const remaining = fs.readdirSync(backupDir);
    expect(remaining).toHaveLength(5);
    // Should keep the most recent (highest timestamps)
    expect(remaining.every(f => f.startsWith('seoPages_'))).toBe(true);
  });

  test('does nothing when backups are within limit', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    createFakeBackups(backupDir, 'test', 3);

    await cleanupBackups(backupDir, 'test', 10);

    const remaining = fs.readdirSync(backupDir);
    expect(remaining).toHaveLength(3);
  });

  test('only removes matching prefix files', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    createFakeBackups(backupDir, 'seoPages', 5);
    createFakeBackups(backupDir, 'pluginConfig', 5);

    await cleanupBackups(backupDir, 'seoPages', 2);

    const remaining = fs.readdirSync(backupDir);
    const seoPagesFiles = remaining.filter(f => f.startsWith('seoPages_'));
    const pluginConfigFiles = remaining.filter(f => f.startsWith('pluginConfig_'));
    expect(seoPagesFiles).toHaveLength(2);
    expect(pluginConfigFiles).toHaveLength(5); // untouched
  });

  test('does not throw for missing backup directory', async () => {
    await expect(
      cleanupBackups(path.join(tmpDir, 'nonexistent'), 'test', 5)
    ).resolves.not.toThrow();
  });
});
