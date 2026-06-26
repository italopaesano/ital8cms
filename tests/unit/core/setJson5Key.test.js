/**
 * Unit Tests per core/setJson5Key.js (update-or-insert di una chiave top-level).
 *
 * Copre:
 * - update di chiave esistente (preserva commenti) + no-op se valore uguale
 * - insert di chiave mancante: dopo `{` (default) e dopo `afterKey`
 * - preservazione di commenti / trailing comma all'insert
 * - oggetto con solo schemaVersion; valore non scalare
 * - roundtrip loadJson5
 * - errori: file mancante, JSON5 invalido, argomenti non validi, root non oggetto
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const setJson5Key = require('../../../core/setJson5Key');
const loadJson5 = require('../../../core/loadJson5');

let tmpDir;
let logSpy;
let errorSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setJson5Key-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function writeFile(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const DESCRIPTOR = `// This file follows the JSON5 standard
{
  "schemaVersion": 1,  // struttura
  "active": 1,
  // commento su weight
  "weight": 5,
}
`;

describe('setJson5Key', () => {

  describe('update (key present)', () => {
    test('updates an existing key and preserves comments', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      const res = await setJson5Key(p, 'active', 0);

      expect(res.action).toBe('updated');
      expect(loadJson5(p).active).toBe(0);
      const out = read(p);
      expect(out).toContain('// struttura');
      expect(out).toContain('// commento su weight');
    });

    test('no-op when the value is already equal', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      const res = await setJson5Key(p, 'active', 1);
      expect(res.action).toBe('unchanged');
      expect(read(p)).toBe(DESCRIPTOR); // file untouched
    });
  });

  describe('insert (key absent)', () => {
    test('inserts a missing key (default: after the opening brace)', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      const res = await setJson5Key(p, 'isInstalled', 1);

      expect(res.action).toBe('inserted');
      expect(loadJson5(p).isInstalled).toBe(1);
      // still valid + comments preserved
      const out = read(p);
      expect(out).toContain('// struttura');
      expect(out).toContain('"weight": 5,');
    });

    test('inserts after afterKey (isInstalled after schemaVersion)', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      await setJson5Key(p, 'isInstalled', 0, { afterKey: 'schemaVersion' });

      const out = read(p);
      const idxSchema = out.indexOf('"schemaVersion"');
      const idxInstalled = out.indexOf('"isInstalled"');
      const idxActive = out.indexOf('"active"');
      expect(idxSchema).toBeGreaterThanOrEqual(0);
      expect(idxInstalled).toBeGreaterThan(idxSchema);   // after schemaVersion
      expect(idxInstalled).toBeLessThan(idxActive);      // before active
      expect(loadJson5(p).isInstalled).toBe(0);
    });

    test('inserts into an object that has only schemaVersion', async () => {
      const p = writeFile('m.json5', '// h\n{\n  "schemaVersion": 1,\n}\n');
      await setJson5Key(p, 'isInstalled', 1, { afterKey: 'schemaVersion' });
      expect(loadJson5(p)).toEqual({ schemaVersion: 1, isInstalled: 1 });
    });

    test('inserts a non-scalar value', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      await setJson5Key(p, 'meta', { a: 1, b: [2, 3] });
      expect(loadJson5(p).meta).toEqual({ a: 1, b: [2, 3] });
    });

    test('afterKey not found falls back to after the opening brace', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      await setJson5Key(p, 'isInstalled', 1, { afterKey: 'doesNotExist' });
      expect(loadJson5(p).isInstalled).toBe(1);
    });
  });

  describe('error handling', () => {
    test('throws when the file does not exist', async () => {
      await expect(
        setJson5Key(path.join(tmpDir, 'nope.json5'), 'k', 1)
      ).rejects.toThrow();
    });

    test('throws on invalid JSON5', async () => {
      const p = writeFile('bad.json5', '{ broken :: }');
      await expect(setJson5Key(p, 'k', 1)).rejects.toThrow();
    });

    test('throws when root is not an object', async () => {
      const p = writeFile('arr.json5', '[1, 2, 3]\n');
      await expect(setJson5Key(p, 'k', 1)).rejects.toThrow();
    });

    test('throws on invalid arguments', async () => {
      const p = writeFile('d.json5', DESCRIPTOR);
      await expect(setJson5Key('', 'k', 1)).rejects.toThrow();
      await expect(setJson5Key(p, '', 1)).rejects.toThrow();
      await expect(setJson5Key(p, 'k', undefined)).rejects.toThrow();
    });
  });
});
