/**
 * Unit Tests per core/ensureThemesInstalled.js
 * (riempie il gap di materializzazione: isInstalled:1 sui temi bundled).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ensureThemesInstalled = require('../../../core/ensureThemesInstalled');
const loadJson5 = require('../../../core/loadJson5');

let themesDir;
let logSpy;

beforeEach(() => {
  themesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensureThemes-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  fs.rmSync(themesDir, { recursive: true, force: true });
  logSpy.mockRestore();
});

function theme(name, { def, live } = {}) {
  const dir = path.join(themesDir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (def !== undefined) fs.writeFileSync(path.join(dir, 'themeConfig.default.json5'), def, 'utf8');
  if (live !== undefined) fs.writeFileSync(path.join(dir, 'themeConfig.json5'), live, 'utf8');
  return dir;
}

const DEF = '// h\n{\n  "schemaVersion": 1,\n  "weight": 0,\n}\n';
const LIVE_NO_INSTALL = '// h\n{\n  "schemaVersion": 1,\n  "weight": 0,\n}\n';
const LIVE_WITH_INSTALL = '// h\n{\n  "schemaVersion": 1,\n  "isInstalled": 1,\n  "weight": 0,\n}\n';

describe('ensureThemesInstalled', () => {

  test('bundled theme without isInstalled → adds isInstalled: 1', async () => {
    theme('default', { def: DEF, live: LIVE_NO_INSTALL });

    const res = await ensureThemesInstalled(themesDir);

    expect(res.updated.map((u) => u.theme)).toEqual(['default']);
    expect(res.errors).toEqual([]);
    const live = loadJson5(path.join(themesDir, 'default', 'themeConfig.json5'));
    expect(live.isInstalled).toBe(1);
    expect(live.schemaVersion).toBe(1); // preservato
    expect(live.weight).toBe(0);        // preservato
  });

  test('isInstalled is inserted right after schemaVersion', async () => {
    theme('default', { def: DEF, live: LIVE_NO_INSTALL });
    await ensureThemesInstalled(themesDir);
    const raw = fs.readFileSync(path.join(themesDir, 'default', 'themeConfig.json5'), 'utf8');
    expect(raw).toMatch(/"schemaVersion":\s*1,\s*\n\s*"isInstalled":\s*1,/);
  });

  test('bundled theme already with isInstalled → skipped, value preserved', async () => {
    theme('default', { def: DEF, live: LIVE_WITH_INSTALL });

    const res = await ensureThemesInstalled(themesDir);

    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual([{ theme: 'default', reason: 'already-present' }]);
    const live = loadJson5(path.join(themesDir, 'default', 'themeConfig.json5'));
    expect(live.isInstalled).toBe(1);
  });

  test('non-bundled theme (no .default) → skipped, live untouched', async () => {
    // tema clonato: ha solo il vivo, con isInstalled: 0 (gestito da themesInstall)
    theme('cloned', { live: '// h\n{\n  "isInstalled": 0,\n}\n' });

    const res = await ensureThemesInstalled(themesDir);

    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual([{ theme: 'cloned', reason: 'no-default' }]);
    const live = loadJson5(path.join(themesDir, 'cloned', 'themeConfig.json5'));
    expect(live.isInstalled).toBe(0); // l'attivazione manuale dell'admin è preservata
  });

  test('bundled theme with .default but no live → skipped (no-live)', async () => {
    theme('orphan', { def: DEF });

    const res = await ensureThemesInstalled(themesDir);

    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual([{ theme: 'orphan', reason: 'no-live' }]);
  });

  test('preserves comments when inserting', async () => {
    theme('default', {
      def: DEF,
      live: '// live header\n{\n  "schemaVersion": 1,\n  // keep me\n  "weight": 0,\n}\n',
    });
    await ensureThemesInstalled(themesDir);
    const raw = fs.readFileSync(path.join(themesDir, 'default', 'themeConfig.json5'), 'utf8');
    expect(raw).toContain('// live header');
    expect(raw).toContain('// keep me');
  });

  test('collects errors without throwing (invalid live JSON5)', async () => {
    theme('bad', { def: DEF, live: '{ broken :: }' });

    const res = await ensureThemesInstalled(themesDir);

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].theme).toBe('bad');
  });

  test('multiple themes: classifies each', async () => {
    theme('a', { def: DEF, live: LIVE_NO_INSTALL });        // updated
    theme('b', { def: DEF, live: LIVE_WITH_INSTALL });      // already-present
    theme('c', { live: '// h\n{\n  "isInstalled": 0,\n}\n' }); // no-default

    const res = await ensureThemesInstalled(themesDir);

    expect(res.updated.map((u) => u.theme).sort()).toEqual(['a']);
    expect(res.skipped.map((s) => s.theme).sort()).toEqual(['b', 'c']);
  });

  test('nonexistent themesDir → empty report, no throw', async () => {
    const res = await ensureThemesInstalled(path.join(themesDir, 'nope'));
    expect(res).toEqual({ updated: [], skipped: [], errors: [] });
  });

  test('throws on invalid argument', async () => {
    await expect(ensureThemesInstalled('')).rejects.toThrow();
  });
});
