/**
 * Unit Tests per core/materializeFromDefault.js
 *
 * Copre:
 * - Materializzazione quando il file vivo manca (copia fedele del default)
 * - No-op quando il vivo esiste già (mai sovrascritto)
 * - Preservazione di commenti, formattazione e schemaVersion
 * - Scrittura atomica (nessun file .tmp residuo)
 * - Errori: default mancante, default JSON5 non valido, argomenti non validi
 * - Roundtrip con loadJson5
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const materializeFromDefault = require('../../../core/materializeFromDefault');
const loadJson5 = require('../../../core/loadJson5');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;
let logSpy;
let errorSpy;

// Contenuto di default rappresentativo: header standard, schemaVersion come
// prima chiave con commento a destra, commenti interni, trailing comma.
const DEFAULT_RAW =
  '// This file follows the JSON5 standard - comments and trailing commas are supported\n' +
  '{\n' +
  '  "schemaVersion": 1,  // struttura del file\n' +
  '  "active": 1,\n' +
  '  // descrittore di esempio\n' +
  '  "weight": 5,\n' +
  '}\n';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'materializeFromDefault-'));
  // Silenzia i log di saveJson5 per un output di test pulito.
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function writeDefault(content = DEFAULT_RAW) {
  const defaultPath = path.join(tmpDir, 'x.default.json5');
  fs.writeFileSync(defaultPath, content, 'utf8');
  return defaultPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('materializeFromDefault', () => {

  // ─── Materializzazione ────────────────────────────────────────────────────

  describe('materialization (live missing)', () => {
    test('creates the live file from the default', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');

      const result = await materializeFromDefault(defaultPath, livePath);

      expect(result).toEqual({ created: true, reason: 'materialized' });
      expect(fs.existsSync(livePath)).toBe(true);
    });

    test('live content is a byte-faithful copy of the default', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');

      await materializeFromDefault(defaultPath, livePath);

      const liveContent = fs.readFileSync(livePath, 'utf8');
      expect(liveContent).toBe(DEFAULT_RAW);
    });

    test('preserves comments, schemaVersion and trailing comma', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');

      await materializeFromDefault(defaultPath, livePath);

      const liveContent = fs.readFileSync(livePath, 'utf8');
      expect(liveContent).toContain('// This file follows the JSON5 standard');
      expect(liveContent).toContain('"schemaVersion": 1,  // struttura del file');
      expect(liveContent).toContain('// descrittore di esempio');
      expect(liveContent).toContain('"weight": 5,'); // trailing comma kept
    });

    test('materialized live is loadable and equals the parsed default', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');

      await materializeFromDefault(defaultPath, livePath);

      const loaded = loadJson5(livePath);
      expect(loaded).toEqual({ schemaVersion: 1, active: 1, weight: 5 });
    });
  });

  // ─── No-op quando il vivo esiste ──────────────────────────────────────────

  describe('no-op (live already exists)', () => {
    test('does not overwrite an existing live file', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');
      const existing = '// edited by user\n{ "active": 0, "weight": 99 }\n';
      fs.writeFileSync(livePath, existing, 'utf8');

      const result = await materializeFromDefault(defaultPath, livePath);

      expect(result).toEqual({ created: false, reason: 'already-exists' });
      expect(fs.readFileSync(livePath, 'utf8')).toBe(existing);
    });

    test('no-op even if the default is invalid (live is never touched)', async () => {
      const defaultPath = writeDefault('{ this is :: not json5');
      const livePath = path.join(tmpDir, 'x.json5');
      const existing = '{ "active": 1 }\n';
      fs.writeFileSync(livePath, existing, 'utf8');

      const result = await materializeFromDefault(defaultPath, livePath);

      expect(result).toEqual({ created: false, reason: 'already-exists' });
      expect(fs.readFileSync(livePath, 'utf8')).toBe(existing);
    });
  });

  // ─── Scrittura atomica ────────────────────────────────────────────────────

  describe('atomic write', () => {
    test('does not leave a temp file after materialization', async () => {
      const defaultPath = writeDefault();
      const livePath = path.join(tmpDir, 'x.json5');

      await materializeFromDefault(defaultPath, livePath);

      expect(fs.existsSync(livePath + '.tmp')).toBe(false);
      expect(fs.existsSync(livePath)).toBe(true);
    });
  });

  // ─── Errori ───────────────────────────────────────────────────────────────

  describe('error handling', () => {
    test('throws when the default is missing', async () => {
      const defaultPath = path.join(tmpDir, 'does-not-exist.default.json5');
      const livePath = path.join(tmpDir, 'x.json5');

      await expect(
        materializeFromDefault(defaultPath, livePath)
      ).rejects.toThrow();
      expect(fs.existsSync(livePath)).toBe(false);
    });

    test('throws on invalid JSON5 in the default, without writing the live', async () => {
      const defaultPath = writeDefault('// broken\n{ "active": :: }\n');
      const livePath = path.join(tmpDir, 'x.json5');

      await expect(
        materializeFromDefault(defaultPath, livePath)
      ).rejects.toThrow();
      expect(fs.existsSync(livePath)).toBe(false);
    });

    test('throws on invalid arguments', async () => {
      await expect(materializeFromDefault('', 'live.json5')).rejects.toThrow();
      await expect(materializeFromDefault('def.json5', '')).rejects.toThrow();
      await expect(materializeFromDefault(null, 'live.json5')).rejects.toThrow();
      await expect(materializeFromDefault('def.json5', 42)).rejects.toThrow();
    });
  });
});
