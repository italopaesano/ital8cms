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
      await expect(editJson5(filePath, 'missing', 1)).rejects.toThrow(/not found at root/);
    });

    test('throws when old value is an object', async () => {
      const filePath = writeFile('cfg.json5', `{
  "data": { "nested": 1 },
}
`);
      await expect(editJson5(filePath, 'data', 42)).rejects.toThrow(/object or array/);
    });

    test('throws when old value is an array', async () => {
      const filePath = writeFile('cfg.json5', `{
  "list": [1, 2, 3],
}
`);
      await expect(editJson5(filePath, 'list', 42)).rejects.toThrow(/object or array/);
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
