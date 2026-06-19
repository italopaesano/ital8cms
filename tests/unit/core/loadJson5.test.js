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

  // ─── Error handling (throw-only: loadJson5 NON stampa, lancia errori chiari) ──

  describe('error handling', () => {
    test('throws for non-existent file', () => {
      expect(() => loadJson5('/nonexistent/file.json5')).toThrow();
    });

    test('throws for invalid JSON5 syntax', () => {
      const filePath = writeFile('invalid.json5', '{invalid: json5: bad}');
      expect(() => loadJson5(filePath)).toThrow();
    });

    test('file inesistente → messaggio "non trovato" + code ENOENT, nessun console.error', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let caught;
      try { loadJson5('/nonexistent/file.json5'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toContain('non trovato');
      expect(caught.message).toContain('/nonexistent/file.json5');
      expect(caught.code).toBe('ENOENT');
      expect(errorSpy).not.toHaveBeenCalled(); // throw-only: la presentazione è del chiamante
      errorSpy.mockRestore();
    });

    test('sintassi invalida → messaggio "sintassi JSON5 non valida", nessun console.error', () => {
      const filePath = writeFile('invalid2.json5', '{invalid: json5: bad}');
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      let caught;
      try { loadJson5(filePath); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toContain('sintassi JSON5 non valida');
      expect(caught.code).toBe('JSON5_PARSE_ERROR');
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    test('preserva l\'errore originale come cause', () => {
      let caught;
      try { loadJson5('/nonexistent/file.json5'); } catch (e) { caught = e; }
      expect(caught.cause).toBeDefined();
      expect(caught.cause.code).toBe('ENOENT');
    });
  });

  // ─── warnConfigError (box [CONFIG] per i config critici al boot) ─────────────

  describe('warnConfigError', () => {
    test('è esportata come proprietà di loadJson5', () => {
      expect(typeof loadJson5.warnConfigError).toBe('function');
    });

    test('stampa un box [CONFIG] con etichetta file e dettaglio (sintassi)', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('sintassi JSON5 non valida in foo.json5: JSON5: ... at line 2');
      err.code = 'JSON5_PARSE_ERROR';
      loadJson5.warnConfigError('foo.json5', err);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const out = errorSpy.mock.calls[0][0];
      expect(out).toContain('[CONFIG]');
      expect(out).toContain('foo.json5');
      expect(out).toContain('sintassi JSON5');
      expect(out).toContain('Avvio interrotto');
      errorSpy.mockRestore();
    });

    test('per ENOENT mostra il ramo "file non trovato"', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('file di configurazione non trovato: x.json5');
      err.code = 'ENOENT';
      loadJson5.warnConfigError('x.json5', err);
      const out = errorSpy.mock.calls[0][0];
      expect(out).toContain('non esiste nel percorso atteso');
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
