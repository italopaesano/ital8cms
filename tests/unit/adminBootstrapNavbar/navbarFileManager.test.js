/**
 * Unit Tests per navbarFileManager.js
 *
 * Testa le operazioni filesystem per i file di configurazione navbar:
 * - Scansione ricorsiva (scanNavbarFiles)
 * - Lettura file (readNavbarFile)
 * - Creazione file (createNavbarFile)
 * - Salvataggio con backup (saveNavbarFile)
 * - Eliminazione soft (deleteNavbarFile)
 * - Gestione backup (createBackup, cleanup)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const navbarFileManager = require('../../../plugins/adminBootstrapNavbar/lib/navbarFileManager');

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Crea una directory temporanea per i test
 */
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'navbar-fm-'));
}

/**
 * Crea un file navbar JSON5 valido
 */
function writeNavbarFile(dir, name, config = null) {
  const fileName = `navbar.${name}.json5`;
  const content = config || JSON.stringify({
    settings: { type: 'horizontal', id: name },
    sections: { left: [], right: [] },
  }, null, 2);
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('navbarFileManager', () => {

  // ─── scanNavbarFiles ──────────────────────────────────────────────────────

  describe('scanNavbarFiles', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns empty array for non-existent directory', () => {
      const result = navbarFileManager.scanNavbarFiles('/non/existent/path');
      expect(result).toEqual([]);
    });

    test('returns empty array for empty directory', () => {
      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toEqual([]);
    });

    test('finds navbar.*.json5 files', () => {
      writeNavbarFile(tmpDir, 'main');
      writeNavbarFile(tmpDir, 'sidebar');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(2);

      const names = result.map(r => r.name);
      expect(names).toContain('main');
      expect(names).toContain('sidebar');
    });

    test('ignores non-navbar files', () => {
      writeNavbarFile(tmpDir, 'main');
      fs.writeFileSync(path.join(tmpDir, 'config.json5'), '{}');
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'hello');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('main');
    });

    test('scans subdirectories recursively', () => {
      writeNavbarFile(tmpDir, 'main');
      const subDir = path.join(tmpDir, 'examples');
      fs.mkdirSync(subDir);
      writeNavbarFile(subDir, 'demo');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(2);

      const names = result.map(r => r.name);
      expect(names).toContain('main');
      expect(names).toContain('demo');
    });

    test('returns correct file metadata', () => {
      writeNavbarFile(tmpDir, 'main');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'main',
        fileName: 'navbar.main.json5',
        relativePath: '.',
      });
      expect(result[0].filePath).toBe(path.join(tmpDir, 'navbar.main.json5'));
    });

    test('relative path is correct for subdirectory files', () => {
      const subDir = path.join(tmpDir, 'examples');
      fs.mkdirSync(subDir);
      writeNavbarFile(subDir, 'demo');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].relativePath).toBe('examples');
    });

    test('reads navbar type from config', () => {
      const config = JSON.stringify({
        settings: { type: 'vertical', id: 'sidebar' },
        sections: { left: [], right: [] },
      });
      writeNavbarFile(tmpDir, 'sidebar', config);

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result[0].type).toBe('vertical');
    });

    test('defaults type to horizontal when settings.type is missing', () => {
      const config = JSON.stringify({
        settings: { id: 'test' },
        sections: { left: [], right: [] },
      });
      writeNavbarFile(tmpDir, 'test', config);

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result[0].type).toBe('horizontal');
    });

    test('type is "unknown" when file is not parseable', () => {
      const filePath = path.join(tmpDir, 'navbar.broken.json5');
      fs.writeFileSync(filePath, 'invalid json {{{', 'utf8');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('unknown');
    });

    test('skips hidden directories', () => {
      const hiddenDir = path.join(tmpDir, '.hidden');
      fs.mkdirSync(hiddenDir);
      writeNavbarFile(hiddenDir, 'secret');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(0);
    });

    test('skips node_modules directory', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      writeNavbarFile(nmDir, 'test');

      const result = navbarFileManager.scanNavbarFiles(tmpDir);
      expect(result).toHaveLength(0);
    });
  });

  // ─── readNavbarFile ───────────────────────────────────────────────────────

  describe('readNavbarFile', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('reads existing file successfully', () => {
      const content = JSON.stringify({ settings: { type: 'horizontal', id: 'test' }, sections: { left: [], right: [] } }, null, 2);
      const filePath = writeNavbarFile(tmpDir, 'test', content);

      const result = navbarFileManager.readNavbarFile(filePath);
      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.parsed).toBeTruthy();
    });

    test('returns error for non-existent file', () => {
      const result = navbarFileManager.readNavbarFile('/non/existent/file.json5');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test('returns content even when JSON5 parse fails', () => {
      const filePath = path.join(tmpDir, 'navbar.broken.json5');
      const badContent = '{ invalid }}}';
      fs.writeFileSync(filePath, badContent, 'utf8');

      const result = navbarFileManager.readNavbarFile(filePath);
      expect(result.success).toBe(true);
      expect(result.content).toBe(badContent);
      expect(result.parsed).toBeNull();
      expect(result.parseError).toBeTruthy();
    });
  });

  // ─── createNavbarFile ─────────────────────────────────────────────────────

  describe('createNavbarFile', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('creates new file successfully', () => {
      const filePath = path.join(tmpDir, 'navbar.new.json5');
      const content = '{"settings":{"id":"new"},"sections":{}}';

      const result = navbarFileManager.createNavbarFile(filePath, content);
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
    });

    test('returns error if file already exists', () => {
      const filePath = writeNavbarFile(tmpDir, 'existing');

      const result = navbarFileManager.createNavbarFile(filePath, 'new content');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
    });

    test('creates parent directory if not exists', () => {
      const subDir = path.join(tmpDir, 'nested', 'deep');
      const filePath = path.join(subDir, 'navbar.test.json5');

      const result = navbarFileManager.createNavbarFile(filePath, '{}');
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ─── saveNavbarFile ───────────────────────────────────────────────────────

  describe('saveNavbarFile', () => {
    let tmpDir;
    let backupDir;

    beforeEach(() => {
      tmpDir = createTempDir();
      backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('saves content to file', () => {
      const filePath = path.join(tmpDir, 'navbar.test.json5');
      const content = '{"settings":{"id":"saved"}}';

      const result = navbarFileManager.saveNavbarFile(filePath, content, backupDir, tmpDir, 10);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
    });

    test('creates backup when file already exists', () => {
      const filePath = writeNavbarFile(tmpDir, 'test', 'original content');

      navbarFileManager.saveNavbarFile(filePath, 'updated content', backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBe(1);
    });

    test('does not create backup for new file', () => {
      const filePath = path.join(tmpDir, 'navbar.new.json5');

      navbarFileManager.saveNavbarFile(filePath, 'new content', backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBe(0);
    });

    test('uses atomic write (temp file then rename)', () => {
      const filePath = path.join(tmpDir, 'navbar.atomic.json5');
      const content = '{"atomic":"write"}';

      const result = navbarFileManager.saveNavbarFile(filePath, content, backupDir, tmpDir, 10);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
      // Temp file should not exist after rename
      expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    });
  });

  // ─── deleteNavbarFile ─────────────────────────────────────────────────────

  describe('deleteNavbarFile', () => {
    let tmpDir;
    let backupDir;

    beforeEach(() => {
      tmpDir = createTempDir();
      backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('soft-deletes file (moves to backup)', () => {
      const filePath = writeNavbarFile(tmpDir, 'todelete');

      const result = navbarFileManager.deleteNavbarFile(filePath, backupDir, tmpDir);
      expect(result.success).toBe(true);

      // Original file removed
      expect(fs.existsSync(filePath)).toBe(false);

      // Backup exists
      const backupFiles = fs.readdirSync(backupDir);
      expect(backupFiles.length).toBe(1);
      expect(backupFiles[0]).toContain('DELETED');
    });

    test('returns error for non-existent file', () => {
      const result = navbarFileManager.deleteNavbarFile(
        path.join(tmpDir, 'nonexistent.json5'),
        backupDir,
        tmpDir
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test('backup preserves original content', () => {
      const originalContent = '{"preserved":"content"}';
      const filePath = path.join(tmpDir, 'navbar.preserve.json5');
      fs.writeFileSync(filePath, originalContent, 'utf8');

      navbarFileManager.deleteNavbarFile(filePath, backupDir, tmpDir);

      const backupFiles = fs.readdirSync(backupDir);
      const backupContent = fs.readFileSync(path.join(backupDir, backupFiles[0]), 'utf8');
      expect(backupContent).toBe(originalContent);
    });

    test('creates backup directory if not exists', () => {
      const newBackupDir = path.join(tmpDir, 'new-backups');
      const filePath = writeNavbarFile(tmpDir, 'test');

      const result = navbarFileManager.deleteNavbarFile(filePath, newBackupDir, tmpDir);
      expect(result.success).toBe(true);
      expect(fs.existsSync(newBackupDir)).toBe(true);
    });
  });

  // ─── createBackup ─────────────────────────────────────────────────────────

  describe('createBackup', () => {
    let tmpDir;
    let backupDir;

    beforeEach(() => {
      tmpDir = createTempDir();
      backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('creates backup of existing file', () => {
      const filePath = writeNavbarFile(tmpDir, 'test');

      navbarFileManager.createBackup(filePath, backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBe(1);
      expect(backupFiles[0]).toContain('navbar.test');
    });

    test('does nothing for non-existent file', () => {
      navbarFileManager.createBackup('/non/existent/file.json5', backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBe(0);
    });

    test('backup filename includes timestamp', () => {
      const filePath = writeNavbarFile(tmpDir, 'test');

      navbarFileManager.createBackup(filePath, backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir);
      // Timestamp format: 2026-03-19T... with colons/dots replaced by hyphens
      expect(backupFiles[0]).toMatch(/___\d{4}-\d{2}-\d{2}T/);
    });

    test('backup filename includes relative path for subdirectory files', () => {
      const subDir = path.join(tmpDir, 'examples');
      fs.mkdirSync(subDir);
      const filePath = writeNavbarFile(subDir, 'demo');

      navbarFileManager.createBackup(filePath, backupDir, tmpDir, 10);

      const backupFiles = fs.readdirSync(backupDir);
      expect(backupFiles[0]).toContain('examples__');
    });

    test('cleans up old backups when exceeding maxBackups', () => {
      const filePath = writeNavbarFile(tmpDir, 'test');

      // Create 5 backups
      for (let i = 0; i < 5; i++) {
        navbarFileManager.createBackup(filePath, backupDir, tmpDir, 3);
        // Small delay to ensure different timestamps
      }

      const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBeLessThanOrEqual(3);
    });

    test('creates backup directory if not exists', () => {
      const newBackupDir = path.join(tmpDir, 'new-backups');
      const filePath = writeNavbarFile(tmpDir, 'test');

      navbarFileManager.createBackup(filePath, newBackupDir, tmpDir, 10);

      expect(fs.existsSync(newBackupDir)).toBe(true);
      const backupFiles = fs.readdirSync(newBackupDir).filter(f => f.endsWith('.json5'));
      expect(backupFiles.length).toBe(1);
    });
  });

  // ─── Module exports ───────────────────────────────────────────────────────

  describe('module exports', () => {
    test('exports all expected functions', () => {
      expect(typeof navbarFileManager.scanNavbarFiles).toBe('function');
      expect(typeof navbarFileManager.readNavbarFile).toBe('function');
      expect(typeof navbarFileManager.saveNavbarFile).toBe('function');
      expect(typeof navbarFileManager.createNavbarFile).toBe('function');
      expect(typeof navbarFileManager.deleteNavbarFile).toBe('function');
      expect(typeof navbarFileManager.createBackup).toBe('function');
    });
  });
});
