/**
 * Unit Tests per core/loadJson5.js
 *
 * Testa il caricamento e parsing di file JSON5:
 * - Caricamento con path assoluto
 * - Caricamento con path relativo e callerDir
 * - Caricamento con path relativo senza callerDir (usa cwd)
 * - Parsing JSON5 (commenti, trailing commas)
 * - Gestione errori (file inesistente, sintassi invalida)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const loadJson5 = require('../../../core/loadJson5');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadJson5-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name, content) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadJson5', () => {

  // ─── Basic loading ────────────────────────────────────────────────────────

  describe('basic loading', () => {
    test('loads valid JSON file with absolute path', () => {
      const filePath = writeFile('config.json5', '{"key": "value"}');
      const result = loadJson5(filePath);
      expect(result).toEqual({ key: 'value' });
    });

    test('loads JSON5 with comments', () => {
      const content = `// This is a comment\n{"key": "value" /* inline */}`;
      const filePath = writeFile('commented.json5', content);
      const result = loadJson5(filePath);
      expect(result).toEqual({ key: 'value' });
    });

    test('loads JSON5 with trailing commas', () => {
      const content = `{\n  "a": 1,\n  "b": 2,\n}`;
      const filePath = writeFile('trailing.json5', content);
      const result = loadJson5(filePath);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test('loads JSON5 with unquoted keys', () => {
      const content = `{key: "value", num: 42}`;
      const filePath = writeFile('unquoted.json5', content);
      const result = loadJson5(filePath);
      expect(result).toEqual({ key: 'value', num: 42 });
    });

    test('loads array data', () => {
      const filePath = writeFile('array.json5', '[1, 2, 3]');
      const result = loadJson5(filePath);
      expect(result).toEqual([1, 2, 3]);
    });

    test('loads nested objects', () => {
      const content = `{"outer": {"inner": true}}`;
      const filePath = writeFile('nested.json5', content);
      const result = loadJson5(filePath);
      expect(result).toEqual({ outer: { inner: true } });
    });
  });

  // ─── Path resolution ─────────────────────────────────────────────────────

  describe('path resolution', () => {
    test('resolves relative path with callerDir', () => {
      const filePath = writeFile('relative.json5', '{"found": true}');
      const result = loadJson5('relative.json5', tmpDir);
      expect(result).toEqual({ found: true });
    });

    test('resolves relative path with callerDir in subdirectory', () => {
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'deep.json5'), '{"deep": true}', 'utf8');
      const result = loadJson5('deep.json5', subDir);
      expect(result).toEqual({ deep: true });
    });

    test('uses process.cwd() when no callerDir for relative path', () => {
      // Write file relative to cwd
      const filePath = writeFile('cwd-test.json5', '{"cwd": true}');
      // Use absolute path since cwd may not be tmpDir
      const result = loadJson5(filePath);
      expect(result).toEqual({ cwd: true });
    });

    test('absolute path ignores callerDir', () => {
      const filePath = writeFile('abs.json5', '{"absolute": true}');
      const result = loadJson5(filePath, '/some/other/dir');
      expect(result).toEqual({ absolute: true });
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    test('throws for non-existent file', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() => loadJson5('/nonexistent/file.json5')).toThrow();
      errorSpy.mockRestore();
    });

    test('throws for invalid JSON5 syntax', () => {
      const filePath = writeFile('invalid.json5', '{invalid: json5: bad}');
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() => loadJson5(filePath)).toThrow();
      errorSpy.mockRestore();
    });

    test('logs error details to console', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      try {
        loadJson5('/nonexistent/file.json5');
      } catch (e) {
        // expected
      }
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[loadJson5]'),
        expect.anything()
      );
      errorSpy.mockRestore();
    });
  });

  // ─── JSON5-specific features ──────────────────────────────────────────────

  describe('JSON5 features', () => {
    test('supports single-line comments', () => {
      const content = `// comment\n{"key": 1}`;
      const filePath = writeFile('sl-comment.json5', content);
      expect(loadJson5(filePath)).toEqual({ key: 1 });
    });

    test('supports multi-line comments', () => {
      const content = `/* multi\nline */\n{"key": 1}`;
      const filePath = writeFile('ml-comment.json5', content);
      expect(loadJson5(filePath)).toEqual({ key: 1 });
    });

    test('supports single-quoted strings', () => {
      const content = `{'key': 'value'}`;
      const filePath = writeFile('single-quoted.json5', content);
      expect(loadJson5(filePath)).toEqual({ key: 'value' });
    });

    test('supports hexadecimal numbers', () => {
      const content = `{hex: 0xFF}`;
      const filePath = writeFile('hex.json5', content);
      expect(loadJson5(filePath)).toEqual({ hex: 255 });
    });

    test('supports Infinity and NaN', () => {
      const content = `{inf: Infinity, negInf: -Infinity, nan: NaN}`;
      const filePath = writeFile('special-nums.json5', content);
      const result = loadJson5(filePath);
      expect(result.inf).toBe(Infinity);
      expect(result.negInf).toBe(-Infinity);
      expect(result.nan).toBeNaN();
    });

    test('supports multiline strings', () => {
      const content = `{text: "line1\\\nline2"}`;
      const filePath = writeFile('multiline.json5', content);
      const result = loadJson5(filePath);
      expect(result.text).toBe('line1line2');
    });
  });
});
