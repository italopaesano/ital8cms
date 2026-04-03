/**
 * Unit Tests per core/saveJson5.js
 *
 * Testa il salvataggio di file JSON5:
 * - Scrittura con path assoluto
 * - Scrittura con path relativo e callerDir
 * - Header JSON5 standard
 * - Scrittura atomica (temp file + rename)
 * - Formattazione indentata (2 spazi)
 * - Gestione errori
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const saveJson5 = require('../../../core/saveJson5');
const loadJson5 = require('../../../core/loadJson5');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saveJson5-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveJson5', () => {

  // ─── Basic saving ─────────────────────────────────────────────────────────

  describe('basic saving', () => {
    test('saves object to file with absolute path', async () => {
      const filePath = path.join(tmpDir, 'test.json5');
      await saveJson5(filePath, { key: 'value' });

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('"key"');
      expect(content).toContain('"value"');
    });

    test('saves array data', async () => {
      const filePath = path.join(tmpDir, 'array.json5');
      await saveJson5(filePath, [1, 2, 3]);

      const result = loadJson5(filePath);
      expect(result).toEqual([1, 2, 3]);
    });

    test('saves nested objects', async () => {
      const filePath = path.join(tmpDir, 'nested.json5');
      const data = { outer: { inner: { deep: true } } };
      await saveJson5(filePath, data);

      const result = loadJson5(filePath);
      expect(result).toEqual(data);
    });

    test('saves null value', async () => {
      const filePath = path.join(tmpDir, 'null.json5');
      await saveJson5(filePath, null);

      const result = loadJson5(filePath);
      expect(result).toBeNull();
    });

    test('overwrites existing file', async () => {
      const filePath = path.join(tmpDir, 'overwrite.json5');
      await saveJson5(filePath, { v: 1 });
      await saveJson5(filePath, { v: 2 });

      const result = loadJson5(filePath);
      expect(result).toEqual({ v: 2 });
    });
  });

  // ─── JSON5 header ────────────────────────────────────────────────────────

  describe('JSON5 header', () => {
    test('includes standard JSON5 comment header', async () => {
      const filePath = path.join(tmpDir, 'header.json5');
      await saveJson5(filePath, {});

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.startsWith('// This file follows the JSON5 standard')).toBe(true);
    });

    test('header is on first line', async () => {
      const filePath = path.join(tmpDir, 'first-line.json5');
      await saveJson5(filePath, { a: 1 });

      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      expect(lines[0]).toBe('// This file follows the JSON5 standard - comments and trailing commas are supported');
    });
  });

  // ─── Formatting ───────────────────────────────────────────────────────────

  describe('formatting', () => {
    test('uses 2-space indentation', async () => {
      const filePath = path.join(tmpDir, 'indent.json5');
      await saveJson5(filePath, { key: 'value' });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('  "key"');
    });

    test('ends file with newline', async () => {
      const filePath = path.join(tmpDir, 'newline.json5');
      await saveJson5(filePath, { a: 1 });

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.endsWith('\n')).toBe(true);
    });
  });

  // ─── Path resolution ─────────────────────────────────────────────────────

  describe('path resolution', () => {
    test('resolves relative path with callerDir', async () => {
      await saveJson5('rel-save.json5', { rel: true }, tmpDir);

      const filePath = path.join(tmpDir, 'rel-save.json5');
      expect(fs.existsSync(filePath)).toBe(true);
      const result = loadJson5(filePath);
      expect(result).toEqual({ rel: true });
    });
  });

  // ─── Atomic write ────────────────────────────────────────────────────────

  describe('atomic write', () => {
    test('does not leave temp file after successful write', async () => {
      const filePath = path.join(tmpDir, 'atomic.json5');
      await saveJson5(filePath, { ok: true });

      const tempPath = filePath + '.tmp';
      expect(fs.existsSync(tempPath)).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ─── Roundtrip with loadJson5 ────────────────────────────────────────────

  describe('roundtrip with loadJson5', () => {
    test('saved data can be loaded back identically', async () => {
      const data = {
        name: 'test',
        version: '1.0.0',
        settings: { debug: true, port: 3000 },
        items: ['a', 'b', 'c'],
      };
      const filePath = path.join(tmpDir, 'roundtrip.json5');
      await saveJson5(filePath, data);

      const loaded = loadJson5(filePath);
      expect(loaded).toEqual(data);
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    test('throws when writing to non-existent directory', async () => {
      const logSpy = jest.spyOn(console, 'error').mockImplementation();
      await expect(
        saveJson5('/nonexistent/dir/file.json5', { a: 1 })
      ).rejects.toThrow();
      logSpy.mockRestore();
    });

    test('logs error details to console', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      try {
        await saveJson5('/nonexistent/dir/file.json5', {});
      } catch (e) {
        // expected
      }
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[saveJson5]'),
        expect.anything()
      );
      errorSpy.mockRestore();
    });
  });

  // ─── String input (raw JSON5) ─────────────────────────────────────────────

  describe('string input — raw JSON5', () => {
    test('saves raw JSON5 string as-is', async () => {
      const filePath = path.join(tmpDir, 'raw.json5');
      const raw = '// my comment\n{ "key": "value" }\n';
      await saveJson5(filePath, raw);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe(raw);
    });

    test('preserves inline comments', async () => {
      const filePath = path.join(tmpDir, 'comments.json5');
      const raw = '// header\n{\n  // rule comment\n  "/about.ejs": { "title": "About" }\n}\n';
      await saveJson5(filePath, raw);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('// rule comment');
      expect(content).toContain('// header');
    });

    test('preserves trailing commas', async () => {
      const filePath = path.join(tmpDir, 'trailing.json5');
      const raw = '{ "a": 1, "b": 2, }\n';
      await saveJson5(filePath, raw);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('"b": 2,');
    });

    test('saved string can be loaded back by loadJson5', async () => {
      const filePath = path.join(tmpDir, 'roundtrip-raw.json5');
      const raw = '// comment\n{ "x": 42, "y": [1, 2, 3,] }\n';
      await saveJson5(filePath, raw);

      const loaded = loadJson5(filePath);
      expect(loaded).toEqual({ x: 42, y: [1, 2, 3] });
    });

    test('throws on invalid JSON5 string without writing the file', async () => {
      const filePath = path.join(tmpDir, 'invalid.json5');
      const logSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        saveJson5(filePath, '{ invalid json5 :::')
      ).rejects.toThrow();

      expect(fs.existsSync(filePath)).toBe(false);
      logSpy.mockRestore();
    });

    test('does not add the standard header when input is a string', async () => {
      const filePath = path.join(tmpDir, 'no-header.json5');
      const raw = '{ "clean": true }\n';
      await saveJson5(filePath, raw);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toContain('// This file follows the JSON5 standard');
      expect(content).toBe(raw);
    });

    test('atomic write: does not leave temp file after successful string save', async () => {
      const filePath = path.join(tmpDir, 'atomic-str.json5');
      await saveJson5(filePath, '{ "ok": true }\n');

      expect(fs.existsSync(filePath + '.tmp')).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
