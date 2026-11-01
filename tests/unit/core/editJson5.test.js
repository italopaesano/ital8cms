/**
 * Unit Tests per core/editJson5.js
 *
 * Testa l'editor edit-by-position di file JSON5:
 * - Modifica di valori scalari preservando commenti
 * - Sostituzione scalare → oggetto/array
 * - Preservazione di commenti inline, trailing commas, indentazione
 * - Gestione di chiavi con/senza virgolette (JSON5)
 * - No-op quando il valore è già quello richiesto
 * - Errori espliciti per casi non supportati
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const editJson5 = require('../../../core/editJson5');
const json5 = require('json5');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'editJson5-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name, content) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('editJson5', () => {

  // ─── Basic scalar edits ─────────────────────────────────────────────────────

  describe('basic scalar edits', () => {
    test('modifies number value preserving comments', async () => {
      const filePath = writeFile('cfg.json5', `// header comment
{
  // comment before isInstalled
  "active": 1,
  "isInstalled": 0, // inline comment
  "weight": 0,
}
`);
      const result = await editJson5(filePath, 'isInstalled', 1);
      expect(result.changed).toBe(true);
      expect(result.oldValue).toBe(0);
      expect(result.newValue).toBe(1);

      const content = readFile(filePath);
      expect(content).toContain('// header comment');
      expect(content).toContain('// comment before isInstalled');
      expect(content).toContain('// inline comment');
      expect(content).toContain('"isInstalled": 1');
      // Preserve trailing comma and other fields
      expect(content).toContain('"active": 1');
      expect(content).toContain('"weight": 0');
    });

    test('modifies boolean true → false', async () => {
      const filePath = writeFile('cfg.json5', `{
  "enabled": true,
}
`);
      const result = await editJson5(filePath, 'enabled', false);
      expect(result.changed).toBe(true);
      expect(result.oldValue).toBe(true);
      expect(result.newValue).toBe(false);
      expect(readFile(filePath)).toContain('"enabled": false');
    });

    test('modifies string value', async () => {
      const filePath = writeFile('cfg.json5', `{
  // pre-comment
  "name": "old-name",
}
`);
      const result = await editJson5(filePath, 'name', 'new-name');
      expect(result.changed).toBe(true);
      expect(result.oldValue).toBe('old-name');
      expect(result.newValue).toBe('new-name');
      const content = readFile(filePath);
      expect(content).toContain('"name": "new-name"');
      expect(content).toContain('// pre-comment');
    });

    test('modifies null value', async () => {
      const filePath = writeFile('cfg.json5', `{
  "data": null,
}
`);
      const result = await editJson5(filePath, 'data', 42);
      expect(result.changed).toBe(true);
      expect(result.oldValue).toBe(null);
      expect(result.newValue).toBe(42);
      expect(readFile(filePath)).toContain('"data": 42');
    });
  });

  // ─── No-op behavior ─────────────────────────────────────────────────────────

  describe('no-op when value unchanged', () => {
    test('returns changed=false and skips write when value already matches', async () => {
      const filePath = writeFile('cfg.json5', `{
  "isInstalled": 1,
}
`);
      const before = readFile(filePath);
      const beforeMtime = fs.statSync(filePath).mtimeMs;

      // Sleep tiny bit so mtime would change if a write happened
      await new Promise(r => setTimeout(r, 10));

      const result = await editJson5(filePath, 'isInstalled', 1);
      expect(result.changed).toBe(false);
      expect(result.oldValue).toBe(1);
      expect(result.newValue).toBe(1);

      // File content unchanged
      expect(readFile(filePath)).toBe(before);
      // mtime unchanged (write skipped)
      expect(fs.statSync(filePath).mtimeMs).toBe(beforeMtime);
    });
  });

  // ─── Output normalization ───────────────────────────────────────────────────

  describe('output normalization', () => {
    test('normalizes whitespace around colon', async () => {
      const filePath = writeFile('cfg.json5', `{
  "key"   :   0,
}
`);
      await editJson5(filePath, 'key', 1);
      const content = readFile(filePath);
      expect(content).toContain('"key": 1');
      expect(content).not.toContain('"key"   :   ');
    });

    test('normalizes unquoted JSON5 key to quoted on save', async () => {
      const filePath = writeFile('cfg.json5', `{
  isInstalled: 0,
}
`);
      await editJson5(filePath, 'isInstalled', 1);
      const content = readFile(filePath);
      expect(content).toContain('"isInstalled": 1');
      expect(content).not.toMatch(/^\s*isInstalled:/m);
    });

    test('preserves line indentation', async () => {
      const filePath = writeFile('cfg.json5', `{
    "deeply": {
      // wrong scope, should not match
      "active": 999,
    },
    "active": 0,
}
`);
      await editJson5(filePath, 'active', 1);
      const content = readFile(filePath);
      // Top-level "active" replaced
      expect(content).toMatch(/^    "active": 1,?$/m);
      // Nested "active" untouched
      expect(content).toContain('"active": 999');
    });
  });

  // ─── Comment preservation ──────────────────────────────────────────────────

  describe('comment preservation', () => {
    test('preserves multi-line block comments', async () => {
      const filePath = writeFile('cfg.json5', `/*
 * Header
 */
{
  /* inline block */
  "flag": 0, /* trailing block */
}
`);
      await editJson5(filePath, 'flag', 1);
      const content = readFile(filePath);
      expect(content).toContain('/*\n * Header\n */');
      expect(content).toContain('/* inline block */');
      expect(content).toContain('/* trailing block */');
      expect(content).toContain('"flag": 1');
    });

    test('preserves inline comment after value', async () => {
      const filePath = writeFile('cfg.json5', `{
  "x": 0, // important note
}
`);
      await editJson5(filePath, 'x', 1);
      expect(readFile(filePath)).toContain('"x": 1, // important note');
    });

    test('does not match keys that appear in comments', async () => {
      const filePath = writeFile('cfg.json5', `{
  // "isInstalled": 999 — note in comment
  "isInstalled": 0,
}
`);
      await editJson5(filePath, 'isInstalled', 1);
      const content = readFile(filePath);
      expect(content).toContain('// "isInstalled": 999 — note in comment');
      expect(content).toContain('"isInstalled": 1');
      const parsed = json5.parse(content);
      expect(parsed.isInstalled).toBe(1);
    });

    test('does not match keys that appear inside string values', async () => {
      const filePath = writeFile('cfg.json5', `{
  "description": "the isInstalled: 999 field",
  "isInstalled": 0,
}
`);
      await editJson5(filePath, 'isInstalled', 1);
      const content = readFile(filePath);
      expect(content).toContain('"the isInstalled: 999 field"');
      const parsed = json5.parse(content);
      expect(parsed.isInstalled).toBe(1);
      expect(parsed.description).toBe('the isInstalled: 999 field');
    });
  });

  // ─── Replacing scalar with object/array ─────────────────────────────────────

  describe('replacing scalar with object/array', () => {
    test('replaces scalar with multi-line object, preserving line indent', async () => {
      const filePath = writeFile('cfg.json5', `{
  // before
  "custom": null,
  // after
}
`);
      await editJson5(filePath, 'custom', { foo: 'bar', n: 42 });
      const content = readFile(filePath);
      expect(content).toContain('// before');
      expect(content).toContain('// after');
      const parsed = json5.parse(content);
      expect(parsed.custom).toEqual({ foo: 'bar', n: 42 });
    });

    test('replaces scalar with array', async () => {
      const filePath = writeFile('cfg.json5', `{
  "items": 0,
}
`);
      await editJson5(filePath, 'items', [1, 'two', { three: 3 }]);
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.items).toEqual([1, 'two', { three: 3 }]);
    });
  });

  // ─── Nested structures: only root depth matched ─────────────────────────────

  describe('depth handling', () => {
    test('only root-level field is matched, not nested with same name', async () => {
      const filePath = writeFile('cfg.json5', `{
  "active": 0,
  "custom": {
    "active": 999,
    "deeper": {
      "active": "nope",
    },
  },
}
`);
      await editJson5(filePath, 'active', 1);
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.active).toBe(1);
      expect(parsed.custom.active).toBe(999);
      expect(parsed.custom.deeper.active).toBe('nope');
    });

    test('handles single-quoted JSON5 strings without false matches', async () => {
      const filePath = writeFile('cfg.json5', `{
  'singleKey': 'old',
}
`);
      await editJson5(filePath, 'singleKey', 'new');
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.singleKey).toBe('new');
    });
  });

  // ─── Errors ─────────────────────────────────────────────────────────────────

  describe('errors', () => {
    test('throws on invalid JSON5 source', async () => {
      const filePath = writeFile('cfg.json5', '{ this is not json5 }');
      await expect(editJson5(filePath, 'x', 1)).rejects.toThrow(/not valid JSON5/);
    });

    test('throws when root is not an object', async () => {
      const filePath = writeFile('cfg.json5', '[1, 2, 3]');
      await expect(editJson5(filePath, 'x', 1)).rejects.toThrow(/object at the root/);
    });

    test('throws when field not found', async () => {
      const filePath = writeFile('cfg.json5', `{
  "a": 1,
}
`);
      await expect(editJson5(filePath, 'missing', 1)).rejects.toThrow(/path "missing" not found/);
    });

    test('throws when newValue is undefined', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, 'x', undefined)).rejects.toThrow(/undefined/);
    });

    test('throws on empty fieldName', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, '', 1)).rejects.toThrow(/fieldName/);
    });

    test('throws on empty filePath', async () => {
      await expect(editJson5('', 'x', 1)).rejects.toThrow(/filePath/);
    });
  });

  // ─── L4: replacing object/array OLD values ─────────────────────────────────

  describe('replacing object/array OLD values (L4)', () => {
    test('replaces object value with another object, preserving outer comments', async () => {
      const filePath = writeFile('cfg.json5', `{
  // pre comment
  "active": 1,
  // before custom
  "custom": {
    "old": "value",
    "n": 42,
  },
  // after custom
  "weight": 0,
}
`);
      const result = await editJson5(filePath, 'custom', { fresh: true, list: [1, 2, 3] });
      expect(result.changed).toBe(true);
      expect(result.oldValue).toEqual({ old: 'value', n: 42 });
      expect(result.newValue).toEqual({ fresh: true, list: [1, 2, 3] });

      const content = readFile(filePath);
      // Outer comments preserved
      expect(content).toContain('// pre comment');
      expect(content).toContain('// before custom');
      expect(content).toContain('// after custom');
      // Sibling fields untouched
      expect(content).toContain('"active": 1');
      expect(content).toContain('"weight": 0');
      // Custom block fully replaced
      const parsed = json5.parse(content);
      expect(parsed.custom).toEqual({ fresh: true, list: [1, 2, 3] });
    });

    test('replaces array value with object', async () => {
      const filePath = writeFile('cfg.json5', `{
  "items": [1, 2, 3, 4, 5],
  "name": "stable",
}
`);
      await editJson5(filePath, 'items', { type: 'map', count: 0 });
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.items).toEqual({ type: 'map', count: 0 });
      expect(parsed.name).toBe('stable');
    });

    test('replaces object value with scalar', async () => {
      const filePath = writeFile('cfg.json5', `{
  "data": { "nested": { "deep": [1, 2] } },
  "version": "1.0.0",
}
`);
      await editJson5(filePath, 'data', null);
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.data).toBe(null);
      expect(parsed.version).toBe('1.0.0');
    });

    test('handles deeply nested OLD object with mixed brackets and strings', async () => {
      const filePath = writeFile('cfg.json5', `{
  // header
  "complex": {
    "arr": [{ "x": "} fake close in string" }, [1, 2, "[also]"]],
    "obj": {
      "more": [/* comment with } */ "y"],
    },
  },
  "tail": true,
}
`);
      await editJson5(filePath, 'complex', { simplified: true });
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.complex).toEqual({ simplified: true });
      expect(parsed.tail).toBe(true);
      expect(readFile(filePath)).toContain('// header');
    });

    test('preserves inline comment after closing bracket of OLD object', async () => {
      const filePath = writeFile('cfg.json5', `{
  "config": {
    "a": 1,
    "b": 2,
  }, // inline note after the close brace
  "next": 99,
}
`);
      await editJson5(filePath, 'config', { c: 3 });
      const content = readFile(filePath);
      expect(content).toContain('// inline note after the close brace');
      const parsed = json5.parse(content);
      expect(parsed.config).toEqual({ c: 3 });
      expect(parsed.next).toBe(99);
    });

    test('no-op when object value matches deeply', async () => {
      const filePath = writeFile('cfg.json5', `{
  // important header
  "shape": { "k": "v", "list": [1, 2] },
}
`);
      const before = readFile(filePath);
      const beforeMtime = fs.statSync(filePath).mtimeMs;
      await new Promise(r => setTimeout(r, 10));

      const result = await editJson5(filePath, 'shape', { k: 'v', list: [1, 2] });
      expect(result.changed).toBe(false);
      expect(readFile(filePath)).toBe(before);
      expect(fs.statSync(filePath).mtimeMs).toBe(beforeMtime);
    });

    test('replaces empty object {} with non-empty', async () => {
      const filePath = writeFile('cfg.json5', `{
  "config": {},
}
`);
      await editJson5(filePath, 'config', { populated: true });
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.config).toEqual({ populated: true });
    });

    test('replaces empty array [] with non-empty', async () => {
      const filePath = writeFile('cfg.json5', `{
  "items": [],
}
`);
      await editJson5(filePath, 'items', ['a', 'b']);
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.items).toEqual(['a', 'b']);
    });

    test('does not falsely match brackets inside string values', async () => {
      const filePath = writeFile('cfg.json5', `{
  "msg": "this } looks like a close",
  "data": { "real": true },
  "msg2": "and { this opens",
}
`);
      await editJson5(filePath, 'data', { real: false });
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.data).toEqual({ real: false });
      expect(parsed.msg).toBe('this } looks like a close');
      expect(parsed.msg2).toBe('and { this opens');
    });
  });

  // ─── L5: nested path support ────────────────────────────────────────────────

  describe('nested paths (L5)', () => {
    test('modifies nested scalar preserving sibling comments inside parent', async () => {
      const filePath = writeFile('cfg.json5', `{
  // outer comment
  "https": {
    // header inside https
    "enabled": true,
    // before port
    "port": 443,
    // before certFile
    "certFile": "./cert.pem",
  },
  "weight": 0,
}
`);
      const result = await editJson5(filePath, ['https', 'enabled'], false);
      expect(result.changed).toBe(true);
      expect(result.oldValue).toBe(true);
      expect(result.newValue).toBe(false);

      const content = readFile(filePath);
      // Outer comment preserved
      expect(content).toContain('// outer comment');
      // ALL comments inside https preserved (this is the L5 win)
      expect(content).toContain('// header inside https');
      expect(content).toContain('// before port');
      expect(content).toContain('// before certFile');
      // Sibling values inside https untouched
      const parsed = json5.parse(content);
      expect(parsed.https.enabled).toBe(false);
      expect(parsed.https.port).toBe(443);
      expect(parsed.https.certFile).toBe('./cert.pem');
      expect(parsed.weight).toBe(0);
    });

    test('modifies deeply nested scalar (3 levels)', async () => {
      const filePath = writeFile('cfg.json5', `{
  "level1": {
    // c1
    "level2": {
      // c2
      "level3": {
        // c3
        "target": "old",
        "sibling": 99,
      },
    },
  },
}
`);
      await editJson5(filePath, ['level1', 'level2', 'level3', 'target'], 'new');
      const content = readFile(filePath);
      expect(content).toContain('// c1');
      expect(content).toContain('// c2');
      expect(content).toContain('// c3');
      const parsed = json5.parse(content);
      expect(parsed.level1.level2.level3.target).toBe('new');
      expect(parsed.level1.level2.level3.sibling).toBe(99);
    });

    test('replaces nested object value (L4 inside nested path)', async () => {
      const filePath = writeFile('cfg.json5', `{
  // top
  "outer": {
    // before inner
    "inner": { "a": 1, "b": 2 },
    // sibling
    "next": 99,
  },
}
`);
      await editJson5(filePath, ['outer', 'inner'], { c: 3, d: 4 });
      const content = readFile(filePath);
      expect(content).toContain('// top');
      expect(content).toContain('// before inner');
      expect(content).toContain('// sibling');
      const parsed = json5.parse(content);
      expect(parsed.outer.inner).toEqual({ c: 3, d: 4 });
      expect(parsed.outer.next).toBe(99);
    });

    test('does NOT match a key with the same name at the wrong depth', async () => {
      const filePath = writeFile('cfg.json5', `{
  "enabled": "root-level",
  "https": {
    "enabled": "https-level",
  },
  "outer": {
    "enabled": "outer-level",
    "nested": {
      "enabled": "deepest",
    },
  },
}
`);
      await editJson5(filePath, ['https', 'enabled'], 'CHANGED');
      const parsed = json5.parse(readFile(filePath));
      expect(parsed.enabled).toBe('root-level');
      expect(parsed.https.enabled).toBe('CHANGED');
      expect(parsed.outer.enabled).toBe('outer-level');
      expect(parsed.outer.nested.enabled).toBe('deepest');
    });

    test('no-op when nested value already matches', async () => {
      const filePath = writeFile('cfg.json5', `{
  "https": { "enabled": false },
}
`);
      const before = readFile(filePath);
      const beforeMtime = fs.statSync(filePath).mtimeMs;
      await new Promise(r => setTimeout(r, 10));

      const result = await editJson5(filePath, ['https', 'enabled'], false);
      expect(result.changed).toBe(false);
      expect(readFile(filePath)).toBe(before);
      expect(fs.statSync(filePath).mtimeMs).toBe(beforeMtime);
    });

    test('single-element array path is equivalent to string fieldName', async () => {
      const filePath = writeFile('cfg.json5', `{
  // hdr
  "active": 0,
}
`);
      await editJson5(filePath, ['active'], 1);
      const content = readFile(filePath);
      expect(content).toContain('// hdr');
      expect(content).toContain('"active": 1');
    });

    test('throws when intermediate segment is missing', async () => {
      const filePath = writeFile('cfg.json5', `{
  "https": { "enabled": true },
}
`);
      await expect(editJson5(filePath, ['nonexistent', 'enabled'], false))
        .rejects.toThrow(/"nonexistent".*not found/);
    });

    test('throws when leaf segment is missing', async () => {
      const filePath = writeFile('cfg.json5', `{
  "https": { "enabled": true },
}
`);
      await expect(editJson5(filePath, ['https', 'missingLeaf'], 1))
        .rejects.toThrow(/"https" → "missingLeaf".*not found/);
    });

    test('throws when intermediate segment is a scalar', async () => {
      const filePath = writeFile('cfg.json5', `{
  "https": "i am a string",
}
`);
      await expect(editJson5(filePath, ['https', 'enabled'], false))
        .rejects.toThrow(/cannot descend.*not a plain object/);
    });

    test('throws when intermediate segment is an array', async () => {
      const filePath = writeFile('cfg.json5', `{
  "list": [{ "enabled": true }],
}
`);
      await expect(editJson5(filePath, ['list', 'enabled'], false))
        .rejects.toThrow(/cannot descend.*not a plain object/);
    });

    test('throws on empty path array', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, [], 1))
        .rejects.toThrow(/at least one segment/);
    });

    test('throws on path with empty-string segment', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, ['x', ''], 1))
        .rejects.toThrow(/non-empty string/);
    });

    test('throws on path with non-string segment', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, ['x', 0], 1))
        .rejects.toThrow(/non-empty string/);
    });

    test('throws on second arg of unsupported type', async () => {
      const filePath = writeFile('cfg.json5', `{ "x": 1 }`);
      await expect(editJson5(filePath, 42, 1))
        .rejects.toThrow(/string.*or.*array/);
    });

    test('realistic ital8Config-style: flips https.enabled preserving https comments', async () => {
      const filePath = writeFile('ital8Config.json5', `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "httpPort": 3000,

  // HTTPS configuration block
  "https": {
    // true = abilita HTTPS
    "enabled": true,
    // Porta HTTPS (default 443)
    "port": 443,
    // true = redirect 301 HTTP→HTTPS
    "AutoRedirectHttpPortToHttpsPort": false,
    // Percorso certificato server
    "certFile": "./certs/fullchain.pem",
    // Percorso chiave privata
    "keyFile": "./certs/privkey.pem",
    // CA intermedia (opzionale)
    "caFile": "",
    // Opzioni TLS avanzate
    "tlsOptions": {},
  },

  "wwwPath": "/www",
}
`);
      const result = await editJson5(filePath, ['https', 'enabled'], false);
      expect(result.changed).toBe(true);

      const content = readFile(filePath);
      // EVERY comment in the file is preserved
      expect(content).toContain('// This file follows the JSON5 standard');
      expect(content).toContain('// HTTPS configuration block');
      expect(content).toContain('// true = abilita HTTPS');
      expect(content).toContain('// Porta HTTPS (default 443)');
      expect(content).toContain('// true = redirect 301 HTTP→HTTPS');
      expect(content).toContain('// Percorso certificato server');
      expect(content).toContain('// Percorso chiave privata');
      expect(content).toContain('// CA intermedia (opzionale)');
      expect(content).toContain('// Opzioni TLS avanzate');

      const parsed = json5.parse(content);
      expect(parsed.https.enabled).toBe(false);
      expect(parsed.https.port).toBe(443);
      expect(parsed.https.certFile).toBe('./certs/fullchain.pem');
      expect(parsed.httpPort).toBe(3000);
      expect(parsed.wwwPath).toBe('/www');
    });
  });

  // ─── Atomic write ───────────────────────────────────────────────────────────

  describe('atomic write', () => {
    test('produces valid JSON5 after edit (round-trip with json5 parser)', async () => {
      const filePath = writeFile('cfg.json5', `// hdr
{
  // c1
  "a": 1, // c2
  /* c3 */
  "b": "two",
  c: [1, 2, 3], // unquoted key
  "d": {
    "nested": true,
  },
}
`);
      await editJson5(filePath, 'a', 99);
      const content = readFile(filePath);
      // Re-parsing must succeed
      const parsed = json5.parse(content);
      expect(parsed.a).toBe(99);
      expect(parsed.b).toBe('two');
      expect(parsed.c).toEqual([1, 2, 3]);
      expect(parsed.d).toEqual({ nested: true });
      // Comments preserved
      expect(content).toContain('// hdr');
      expect(content).toContain('// c1');
      expect(content).toContain('// c2');
      expect(content).toContain('/* c3 */');
      expect(content).toContain('// unquoted key');
    });
  });

  // ─── Real-world scenario: pluginConfig.json5 ────────────────────────────────

  describe('pluginConfig.json5 realistic scenario', () => {
    test('flips isInstalled=0→1 preserving full file structure with comments', async () => {
      const filePath = writeFile('pluginConfig.json5', `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  // Plugin attivo (0=disabilitato, 1=abilitato)
  "active": 1,

  // Stato di installazione (0=non installato, 1=installato)
  // Il sistema setta automaticamente questo a 1 dopo la prima installazione
  "isInstalled": 0,

  // Priorità di caricamento (più basso = caricato prima)
  "weight": 100,

  // Dipendenze plugin (semantic versioning)
  "dependency": {
    "bootstrap": "^1.0.0",
  },

  // Dipendenze npm
  "nodeModuleDependency": {},

  // Configurazione custom del plugin
  "custom": {
    "featureEnabled": true,
    "maxItems": 50,
  },
}
`);
      const result = await editJson5(filePath, 'isInstalled', 1);
      expect(result.changed).toBe(true);

      const content = readFile(filePath);
      // Tutti i commenti preservati
      expect(content).toContain('// This file follows the JSON5 standard');
      expect(content).toContain('// Plugin attivo (0=disabilitato, 1=abilitato)');
      expect(content).toContain('// Stato di installazione (0=non installato, 1=installato)');
      expect(content).toContain('// Il sistema setta automaticamente questo a 1');
      expect(content).toContain('// Priorità di caricamento (più basso = caricato prima)');
      expect(content).toContain('// Dipendenze plugin (semantic versioning)');
      expect(content).toContain('// Dipendenze npm');
      expect(content).toContain('// Configurazione custom del plugin');

      // Solo isInstalled cambiato
      expect(content).toContain('"isInstalled": 1');
      expect(content).not.toContain('"isInstalled": 0');

      // Altri campi intatti
      const parsed = json5.parse(content);
      expect(parsed.active).toBe(1);
      expect(parsed.isInstalled).toBe(1);
      expect(parsed.weight).toBe(100);
      expect(parsed.dependency).toEqual({ bootstrap: '^1.0.0' });
      expect(parsed.nodeModuleDependency).toEqual({});
      expect(parsed.custom).toEqual({ featureEnabled: true, maxItems: 50 });
    });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Sostituzione per chiave (Fase 2 di json5-key-operations)
// ─────────────────────────────────────────────────────────────────────────────
//
// Fino alla v3.32.0, sostituire un valore oggetto/array riscriveva il BLOCCO
// intero, e con esso spariva ogni commento che ci stava dentro — compresi quelli
// di chiavi il cui valore non cambiava. Non era un limite tecnico: le chiavi
// danno identità, quindi si sa a chi appartiene ogni commento.
//
// Il primo test è il difetto MISURATO che ha aperto la fase. I successivi
// coprono i rami in cui la conservazione NON è possibile, dove il contratto è
// dichiararlo invece di tacerlo.
//
// → docs/decisions/json5-key-operations.it.md (D3, D5)
describe('sostituzione per chiave: i commenti restano dove sono', () => {
  test('cambiando UNA chiave, i commenti delle altre sopravvivono', async () => {
    // Il difetto misurato: cambiando solo `retryAfter`, sparivano anche le
    // spiegazioni di `status` e `maxHits`, i cui valori restavano identici.
    const filePath = writeFile('cfg.json5', `{
  "policy": {
    // perché 429 e non 403: è un limite temporaneo
    "status": 429,
    "retryAfter": 60,   // secondi
    // soglia concordata col cliente
    "maxHits": 5,
  },
}
`);
    const out = await editJson5(filePath, 'policy', { status: 429, retryAfter: 120, maxHits: 5 });
    const content = readFile(filePath);
    expect(content).toContain('limite temporaneo');
    expect(content).toContain('// secondi');          // sulla riga CAMBIATA
    expect(content).toContain('soglia concordata col cliente');
    expect(json5.parse(content).policy.retryAfter).toBe(120);
    expect(out.droppedComments).toEqual([]);          // niente è stato ricostruito
  });

  test('la ricorsione scende su più livelli', async () => {
    const filePath = writeFile('cfg.json5', `{
  "a": {
    // nota di a
    "b": {
      // nota di b
      "c": {
        // nota di c
        "valore": 1,
      },
    },
  },
}
`);
    await editJson5(filePath, 'a', { b: { c: { valore: 2 } } });
    const content = readFile(filePath);
    expect(content).toContain('nota di a');
    expect(content).toContain('nota di b');
    expect(content).toContain('nota di c');
    expect(json5.parse(content).a.b.c.valore).toBe(2);
  });

  test('ARRAY di pari lunghezza: ricorre per indice', async () => {
    // È il caso delle migrazioni della Fase 5 di path-zones: tre letterali che
    // diventano tre segnaposti. Il commento sopra l'elemento CAMBIATO resta.
    const filePath = writeFile('cfg.json5', `{
  "exemptPaths": [
    // il pannello, per non auto-bloccarsi
    "/admin/**",
    // la mia area riservata
    "/area/**",
  ],
}
`);
    const out = await editJson5(filePath, 'exemptPaths', ['{{admin}}/**', '/area/**']);
    const content = readFile(filePath);
    expect(content).toContain('il pannello, per non auto-bloccarsi');
    expect(content).toContain('la mia area riservata');
    expect(json5.parse(content).exemptPaths).toEqual(['{{admin}}/**', '/area/**']);
    expect(out.droppedComments).toEqual([]);
  });

  test('ARRAY di OGGETTI: un elemento cambiato conserva i propri commenti', async () => {
    // 🐞 REGRESSIONE. Fino alla v3.36.0 il ramo array ricorreva per indice ma
    // RIFACEVA l'elemento cambiato come blocco: i commenti al suo interno
    // morivano, e `droppedComments` restava VUOTO perché nessuno li raccoglieva.
    // Misurato allora su questo stesso file: 2 commenti prima, 0 dopo, resoconto
    // vuoto — cioè la perdita silenziosa che la sostituzione per chiave esiste
    // per impedire, riprodotta un livello sotto, dentro un array, e peggiore
    // perché autocertificata come innocua.
    //
    // Il commento di `window` è la parte che conta: il suo valore NON cambia,
    // quindi è il caso « riscrive 60 in 60 e cancella il perché di quel 60 ».
    const filePath = writeFile('cfg.json5', `{
  "rules": [
    {
      // soglia concordata col cliente: non alzarla senza chiedere
      "limit": 5,
      // finestra in secondi
      "window": 60,
    },
    {
      "limit": 99,
    },
  ],
}
`);
    const out = await editJson5(filePath, 'rules', [
      { limit: 10, window: 60 },
      { limit: 99 },
    ]);
    const content = readFile(filePath);
    expect(content).toContain('soglia concordata col cliente');
    expect(content).toContain('finestra in secondi');
    expect(out.droppedComments).toEqual([]);
    expect(json5.parse(content).rules).toEqual([{ limit: 10, window: 60 }, { limit: 99 }]);
    // la formattazione della chiave NON toccata resta quella originale
    expect(content).toContain('"window": 60,');
  });

  test('ARRAY di OGGETTI: ricorre anche in profondità dentro l elemento', async () => {
    // La ricorsione dentro un elemento non si ferma al primo livello: un oggetto
    // annidato dentro l'elemento è a sua volta percorso per chiave.
    const filePath = writeFile('cfg.json5', `{
  "rules": [
    {
      "name": "login",
      "policy": {
        // perché 429 e non 403: è un limite temporaneo
        "status": 429,
        // concordato col cliente
        "retryAfter": 60,
      },
    },
  ],
}
`);
    const out = await editJson5(filePath, 'rules', [
      { name: 'login', policy: { status: 429, retryAfter: 120 } },
    ]);
    const content = readFile(filePath);
    expect(content).toContain('perché 429 e non 403');
    expect(content).toContain('concordato col cliente');
    expect(content).toContain('"status": 429,');   // intatta, non riscritta
    expect(out.droppedComments).toEqual([]);
    expect(json5.parse(content).rules[0].policy.retryAfter).toBe(120);
  });

  test('ARRAY di OGGETTI: ciò che NON è preservabile viene DICHIARATO col suo indice', async () => {
    // L'altra metà del contratto: quando l'elemento cambia TIPO il blocco si rifa
    // per forza, e allora i commenti perduti finiscono in `droppedComments` con
    // il percorso che li situa — indice dell'elemento compreso, perché « un
    // commento è andato perso » non è azionabile e « in rules.0 » sì.
    const filePath = writeFile('cfg.json5', `{
  "rules": [
    {
      // questa regola andava spiegata
      "limit": 5,
    },
    {
      "limit": 99,
    },
  ],
}
`);
    const out = await editJson5(filePath, 'rules', ['soloUnaStringa', { limit: 99 }]);
    expect(out.droppedComments).toEqual([
      { path: ['rules', '0'], text: '// questa regola andava spiegata' },
    ]);
    expect(json5.parse(readFile(filePath)).rules[0]).toBe('soloUnaStringa');
  });

  test('ARRAY di SCALARI: nessun commento inventato da una stringa che contiene /**', async () => {
    // 🐞 REGRESSIONE. La raccolta dei commenti perduti riconosce un commento
    // guardando `mask`, che marca anche il CONTENUTO delle stringhe: su un
    // elemento scalare come "/admin/**" vedeva `/**` e riportava un commento che
    // non è mai esistito. Uno scalare non può aver ospitato commenti, quindi non
    // si raccoglie affatto.
    const filePath = writeFile('cfg.json5', `{
  "exemptPaths": [
    "/admin/**",
    "/area/**",
  ],
}
`);
    const out = await editJson5(filePath, 'exemptPaths', ['{{admin}}/**', '/area/**']);
    expect(out.droppedComments).toEqual([]);
    expect(json5.parse(readFile(filePath)).exemptPaths).toEqual(['{{admin}}/**', '/area/**']);
  });

  test('la formattazione delle parti non toccate non è normalizzata', async () => {
    const filePath = writeFile('cfg.json5', '{\n  "o": {\n    "a":    1,\n\t"b":\t2,\n  },\n}\n');
    await editJson5(filePath, 'o', { a: 1, b: 9 });
    const content = readFile(filePath);
    expect(content).toContain('"a":    1,');   // spaziatura originale intatta
  });

  test('chiave AGGIUNTA: entra nell ordine del nuovo oggetto', async () => {
    const filePath = writeFile('cfg.json5', '{\n  "cfg": {\n    // nota di x\n    "x": 1,\n  },\n}\n');
    await editJson5(filePath, 'cfg', { x: 1, y: 2, z: 3 });
    const content = readFile(filePath);
    expect(content).toContain('nota di x');
    expect(Object.keys(json5.parse(content).cfg)).toEqual(['x', 'y', 'z']);
  });

  test('chiave RIMOSSA: porta via il SUO commento e solo quello', async () => {
    const filePath = writeFile('cfg.json5', `{
  "cfg": {
    // nota di x
    "x": 1,
    // nota di y
    "y": 2,
  },
}
`);
    await editJson5(filePath, 'cfg', { x: 1 });
    const content = readFile(filePath);
    expect(content).toContain('nota di x');
    expect(content).not.toContain('nota di y');
    expect(json5.parse(content).cfg).toEqual({ x: 1 });
  });

  test('aggiunta e rimozione nello stesso passaggio', async () => {
    const filePath = writeFile('cfg.json5', `{
  "cfg": {
    // nota di x
    "x": 1,
    // nota di y
    "y": 2,
  },
}
`);
    await editJson5(filePath, 'cfg', { x: 1, z: 3 });
    const content = readFile(filePath);
    expect(content).toContain('nota di x');
    expect(content).not.toContain('nota di y');
    expect(json5.parse(content).cfg).toEqual({ x: 1, z: 3 });
  });

  test('blocco INLINE: la chiave nuova entra DENTRO, senza doppia virgola', async () => {
    // Due difetti colti qui dalla postcondizione, non da una lettura del codice:
    // su un blocco inline la « fine della riga di afterKey » cade oltre la `}`,
    // quindi la chiave nuova finiva FUORI dall'oggetto; e fermarsi prima della
    // virgola di afterKey produceva `"d": 4,,` perché needsComma guarda indietro.
    const filePath = writeFile('cfg.json5', '{\n  "outer": {\n    "inner": { "a": 1, "b": 2 },\n    "next": 99,\n  },\n}\n');
    await editJson5(filePath, ['outer', 'inner'], { c: 3, d: 4 });
    const content = readFile(filePath);
    expect(() => json5.parse(content)).not.toThrow();
    expect(json5.parse(content).outer.inner).toEqual({ c: 3, d: 4 });
    expect(json5.parse(content).outer.next).toBe(99);
    expect(content).not.toContain(',,');
  });
});

describe('sostituzione per chiave: ciò che NON si può conservare, si dichiara', () => {
  test('ARRAY di lunghezza diversa: blocco rifatto, commenti dichiarati', async () => {
    // Niente congetture: a lunghezza diversa non c'è corrispondenza fra gli
    // elementi vecchi e i nuovi, quindi i commenti interni non sono ricollocabili.
    const filePath = writeFile('cfg.json5', '{\n  "lista": [\n    // commento interno\n    1,\n    2,\n  ],\n}\n');
    const out = await editJson5(filePath, 'lista', [1, 2, 3]);
    expect(json5.parse(readFile(filePath)).lista).toEqual([1, 2, 3]);
    expect(out.droppedComments).toEqual([{ path: ['lista'], text: '// commento interno' }]);
  });

  test('CAMBIO DI TIPO: i commenti interni non hanno a cosa attaccarsi', async () => {
    const filePath = writeFile('cfg.json5', '{\n  "a": {\n    // commento interno\n    "x": 1,\n  },\n}\n');
    const out = await editJson5(filePath, 'a', 'ora una stringa');
    expect(json5.parse(readFile(filePath)).a).toBe('ora una stringa');
    expect(out.droppedComments).toHaveLength(1);
    expect(out.droppedComments[0].text).toBe('// commento interno');
  });

  test('il resoconto porta il PATH, non solo il testo', async () => {
    // « Un commento è andato perso » non è azionabile; « in custom.policy » sì.
    const filePath = writeFile('cfg.json5', '{\n  "custom": {\n    "policy": [\n      // dentro policy\n      1,\n    ],\n  },\n}\n');
    const out = await editJson5(filePath, ['custom', 'policy'], [1, 2]);
    expect(out.droppedComments[0].path).toEqual(['custom', 'policy']);
  });

  test('droppedComments è VUOTO quando nulla viene ricostruito', async () => {
    const filePath = writeFile('cfg.json5', '{\n  "a": 1,\n}\n');
    const out = await editJson5(filePath, 'a', 2);
    expect(out.droppedComments).toEqual([]);
  });

  test('una sola scrittura: nessun file temporaneo residuo', async () => {
    const filePath = writeFile('cfg.json5', '{\n  "o": { "a": 1, "b": 2, "c": 3 },\n}\n');
    await editJson5(filePath, 'o', { a: 9, b: 8, c: 7 });
    expect(fs.readdirSync(tmpDir)).toEqual(['cfg.json5']);
  });
});
