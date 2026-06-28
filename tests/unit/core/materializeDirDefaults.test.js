/**
 * Unit Tests per core/materializeDirDefaults.js
 *
 * Copre:
 * - Materializzazione di più default mancanti in una directory
 * - No-op sui vivi già presenti (mix created/skipped)
 * - Mappatura del nome x.default.json5 → x.json5
 * - File non-.default ignorati
 * - Degradazione graziosa: un default rotto non blocca gli altri (errors)
 * - Directory vuota / senza default
 * - Errori: dir mancante, path non-directory, argomenti non validi
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const materializeDirDefaults = require('../../../core/materializeDirDefaults');
const loadJson5 = require('../../../core/loadJson5');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;
let logSpy;
let errorSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'materializeDirDefaults-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function write(name, content) {
  fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
}

const VALID_DEFAULT = '// header\n{\n  "schemaVersion": 1,\n  "active": 1,\n}\n';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('materializeDirDefaults', () => {

  describe('materialization', () => {
    test('materializes all missing live files from their defaults', async () => {
      write('pluginConfig.default.json5', VALID_DEFAULT);
      write('seoPages.default.json5', '// h\n{ "schemaVersion": 1 }\n');

      const result = await materializeDirDefaults(tmpDir);

      expect(result.created.sort()).toEqual(['pluginConfig.json5', 'seoPages.json5']);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(fs.existsSync(path.join(tmpDir, 'pluginConfig.json5'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'seoPages.json5'))).toBe(true);
    });

    test('maps x.default.json5 → x.json5 correctly', async () => {
      write('themeConfig.default.json5', VALID_DEFAULT);

      const result = await materializeDirDefaults(tmpDir);

      expect(result.created).toEqual(['themeConfig.json5']);
      expect(loadJson5(path.join(tmpDir, 'themeConfig.json5'))).toEqual({ schemaVersion: 1, active: 1 });
    });

    test('skips live files that already exist (no overwrite)', async () => {
      write('pluginConfig.default.json5', VALID_DEFAULT);
      write('pluginConfig.json5', '{ "active": 0 }\n'); // already present, edited
      write('redirectMap.default.json5', '// h\n{ "redirects": [] }\n');

      const result = await materializeDirDefaults(tmpDir);

      expect(result.created).toEqual(['redirectMap.json5']);
      expect(result.skipped).toEqual(['pluginConfig.json5']);
      // existing live untouched
      expect(fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8')).toBe('{ "active": 0 }\n');
    });
  });

  describe('filtering', () => {
    test('ignores files that are not *.default.json5', async () => {
      write('pluginConfig.default.json5', VALID_DEFAULT);
      write('main.js', 'module.exports = {};\n');
      write('README.md', '# readme\n');
      write('alreadyLive.json5', '{ "x": 1 }\n'); // live without a default

      const result = await materializeDirDefaults(tmpDir);

      expect(result.created).toEqual(['pluginConfig.json5']);
      // the stray live file is left alone, no spurious work
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test('returns empty summary for a directory with no defaults', async () => {
      write('main.js', '// nothing to do\n');

      const result = await materializeDirDefaults(tmpDir);

      expect(result).toEqual({ created: [], skipped: [], errors: [] });
    });
  });

  describe('graceful degradation', () => {
    test('a broken default does not stop the others', async () => {
      write('good.default.json5', VALID_DEFAULT);
      write('broken.default.json5', '{ not valid :: json5');

      const result = await materializeDirDefaults(tmpDir);

      expect(result.created).toEqual(['good.json5']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('broken.json5');
      // the good one was still materialized; the broken live was not created
      expect(fs.existsSync(path.join(tmpDir, 'good.json5'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'broken.json5'))).toBe(false);
    });
  });

  describe('error handling', () => {
    test('throws when the directory does not exist', async () => {
      await expect(
        materializeDirDefaults(path.join(tmpDir, 'nope'))
      ).rejects.toThrow();
    });

    test('throws when the path is not a directory', async () => {
      write('afile.default.json5', VALID_DEFAULT);
      await expect(
        materializeDirDefaults(path.join(tmpDir, 'afile.default.json5'))
      ).rejects.toThrow();
    });

    test('throws on invalid argument', async () => {
      await expect(materializeDirDefaults('')).rejects.toThrow();
      await expect(materializeDirDefaults(null)).rejects.toThrow();
    });
  });
});
