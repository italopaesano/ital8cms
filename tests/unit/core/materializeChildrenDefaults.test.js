/**
 * Unit Tests per core/materializeChildrenDefaults.js
 *
 * Copre:
 * - Materializzazione su più sottocartelle (es. plugins/* simulato)
 * - Prefisso del nome con la sottocartella (seo/pluginConfig.json5)
 * - Mix created/skipped (un plugin con vivo già presente)
 * - Entry-file nella radice ignorate (solo le directory contano)
 * - Degradazione graziosa: un default rotto in una sottocartella
 * - Radice senza sottocartelle / con sottocartelle senza default
 * - Errori: radice mancante, non-directory, argomenti non validi
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const materializeChildrenDefaults = require('../../../core/materializeChildrenDefaults');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let rootDir;
let logSpy;
let errorSpy;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'materializeChildrenDefaults-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

const VALID_DEFAULT = '// header\n{\n  "schemaVersion": 1,\n  "active": 1,\n}\n';

function makeChild(name) {
  const dir = path.join(rootDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeIn(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('materializeChildrenDefaults', () => {

  describe('materialization across children', () => {
    test('materializes missing defaults in every child directory', async () => {
      const seo = makeChild('seo');
      writeIn(seo, 'pluginConfig.default.json5', VALID_DEFAULT);
      writeIn(seo, 'seoPages.default.json5', '// h\n{ "schemaVersion": 1 }\n');
      const bootstrap = makeChild('bootstrap');
      writeIn(bootstrap, 'pluginConfig.default.json5', VALID_DEFAULT);

      const result = await materializeChildrenDefaults(rootDir);

      expect(result.created.sort()).toEqual([
        'bootstrap/pluginConfig.json5',
        'seo/pluginConfig.json5',
        'seo/seoPages.json5',
      ]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(fs.existsSync(path.join(seo, 'pluginConfig.json5'))).toBe(true);
      expect(fs.existsSync(path.join(bootstrap, 'pluginConfig.json5'))).toBe(true);
    });

    test('names are prefixed with the child directory', async () => {
      const media = makeChild('media');
      writeIn(media, 'pluginConfig.default.json5', VALID_DEFAULT);

      const result = await materializeChildrenDefaults(rootDir);

      expect(result.created).toEqual(['media/pluginConfig.json5']);
    });

    test('mixes created and skipped across children', async () => {
      const a = makeChild('alpha');
      writeIn(a, 'pluginConfig.default.json5', VALID_DEFAULT);
      writeIn(a, 'pluginConfig.json5', '{ "active": 0 }\n'); // already there
      const b = makeChild('beta');
      writeIn(b, 'pluginConfig.default.json5', VALID_DEFAULT);

      const result = await materializeChildrenDefaults(rootDir);

      expect(result.created).toEqual(['beta/pluginConfig.json5']);
      expect(result.skipped).toEqual(['alpha/pluginConfig.json5']);
    });
  });

  describe('filtering', () => {
    test('ignores file entries in the root (only directories are scanned)', async () => {
      const plugin = makeChild('realPlugin');
      writeIn(plugin, 'pluginConfig.default.json5', VALID_DEFAULT);
      // A stray file directly in the root — must be ignored, not crash.
      fs.writeFileSync(path.join(rootDir, 'README.md'), '# root\n', 'utf8');
      fs.writeFileSync(path.join(rootDir, 'stray.default.json5'), VALID_DEFAULT, 'utf8');

      const result = await materializeChildrenDefaults(rootDir);

      expect(result.created).toEqual(['realPlugin/pluginConfig.json5']);
    });

    test('returns empty summary when there are no children', async () => {
      const result = await materializeChildrenDefaults(rootDir);
      expect(result).toEqual({ created: [], skipped: [], errors: [] });
    });

    test('child without defaults contributes nothing', async () => {
      const empty = makeChild('codeOnly');
      writeIn(empty, 'main.js', '// just code\n');

      const result = await materializeChildrenDefaults(rootDir);

      expect(result).toEqual({ created: [], skipped: [], errors: [] });
    });
  });

  describe('graceful degradation', () => {
    test('a broken default in one child does not stop the others', async () => {
      const good = makeChild('good');
      writeIn(good, 'pluginConfig.default.json5', VALID_DEFAULT);
      const bad = makeChild('bad');
      writeIn(bad, 'pluginConfig.default.json5', '{ broken :: }');

      const result = await materializeChildrenDefaults(rootDir);

      expect(result.created).toEqual(['good/pluginConfig.json5']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('bad/pluginConfig.json5');
    });
  });

  describe('error handling', () => {
    test('throws when the root does not exist', async () => {
      await expect(
        materializeChildrenDefaults(path.join(rootDir, 'nope'))
      ).rejects.toThrow();
    });

    test('throws when the root is not a directory', async () => {
      const filePath = path.join(rootDir, 'afile');
      fs.writeFileSync(filePath, 'x', 'utf8');
      await expect(materializeChildrenDefaults(filePath)).rejects.toThrow();
    });

    test('throws on invalid argument', async () => {
      await expect(materializeChildrenDefaults('')).rejects.toThrow();
      await expect(materializeChildrenDefaults(null)).rejects.toThrow();
    });
  });
});
