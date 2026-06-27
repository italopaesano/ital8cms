/**
 * Unit Tests per core/reconcileSchemaVersion.js (drift di schemaVersion + merge additivo).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const reconcileSchemaVersion = require('../../../core/reconcileSchemaVersion');
const loadJson5 = require('../../../core/loadJson5');

let tmpDir;
let logSpy;
let errorSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcileSchema-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function write(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
function paths(defaultRaw, liveRaw) {
  const d = write('x.default.json5', defaultRaw);
  const l = liveRaw === null ? path.join(tmpDir, 'x.json5') : write('x.json5', liveRaw);
  return [d, l];
}

describe('reconcileSchemaVersion', () => {

  test('aligned: same version → no action', async () => {
    const [d, l] = paths(
      '{ "schemaVersion": 1, "active": 1 }\n',
      '{ "schemaVersion": 1, "active": 0 }\n'
    );
    const res = await reconcileSchemaVersion(d, l);
    expect(res.status).toBe('aligned');
    expect(loadJson5(l)).toEqual({ schemaVersion: 1, active: 0 }); // unchanged
  });

  test('merged: default ahead → adds new keys, aligns schemaVersion, preserves existing values', async () => {
    const [d, l] = paths(
      '// h\n{ "schemaVersion": 2, "active": 1, "weight": 5, "newKey": "x" }\n',
      '// h\n{\n  "schemaVersion": 1,\n  "active": 0,\n  "weight": 5,\n  "isInstalled": 1,\n}\n'
    );
    const res = await reconcileSchemaVersion(d, l);

    expect(res.status).toBe('merged');
    expect(res).toMatchObject({ from: 1, to: 2 });
    expect(res.added).toEqual(['newKey']);

    const live = loadJson5(l);
    expect(live.schemaVersion).toBe(2);   // aligned
    expect(live.active).toBe(0);          // user value preserved (not 1 from default)
    expect(live.newKey).toBe('x');        // new key added
    expect(live.isInstalled).toBe(1);     // live-only key NOT removed
  });

  test('live without schemaVersion → treated as 0 → merged', async () => {
    const [d, l] = paths(
      '{ "schemaVersion": 1, "active": 1, "extra": true }\n',
      '{\n  "active": 0,\n}\n'
    );
    const res = await reconcileSchemaVersion(d, l);
    expect(res.status).toBe('merged');
    const live = loadJson5(l);
    expect(live.schemaVersion).toBe(1);
    expect(live.active).toBe(0);
    expect(live.extra).toBe(true);
  });

  test('live-ahead: live version higher than default (anomalous)', async () => {
    const [d, l] = paths(
      '{ "schemaVersion": 1, "a": 1 }\n',
      '{ "schemaVersion": 3, "a": 1 }\n'
    );
    const res = await reconcileSchemaVersion(d, l);
    expect(res).toMatchObject({ status: 'live-ahead', from: 3, to: 1 });
  });

  test('no-live: live file missing', async () => {
    const [d, l] = paths('{ "schemaVersion": 1 }\n', null);
    const res = await reconcileSchemaVersion(d, l);
    expect(res.status).toBe('no-live');
  });

  test('no-default-version: default without schemaVersion', async () => {
    const [d, l] = paths('{ "a": 1 }\n', '{ "a": 1 }\n');
    const res = await reconcileSchemaVersion(d, l);
    expect(res.status).toBe('no-default-version');
  });

  test('merge preserves comments in the live file', async () => {
    const [d, l] = paths(
      '{ "schemaVersion": 2, "active": 1, "newK": 9 }\n',
      '// live header\n{\n  "schemaVersion": 1,\n  // keep me\n  "active": 0,\n}\n'
    );
    await reconcileSchemaVersion(d, l);
    const raw = fs.readFileSync(l, 'utf8');
    expect(raw).toContain('// live header');
    expect(raw).toContain('// keep me');
  });

  describe('errors', () => {
    test('throws when the default is missing', async () => {
      const l = write('x.json5', '{ "schemaVersion": 1 }\n');
      await expect(
        reconcileSchemaVersion(path.join(tmpDir, 'nope.default.json5'), l)
      ).rejects.toThrow();
    });

    test('throws on invalid arguments', async () => {
      await expect(reconcileSchemaVersion('', 'l.json5')).rejects.toThrow();
      await expect(reconcileSchemaVersion('d.json5', '')).rejects.toThrow();
    });
  });
});
