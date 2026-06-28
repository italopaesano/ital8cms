/**
 * Unit Tests per core/reconcileSchemaVersions.js (scansione + riconciliazione al boot + box).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const reconcileSchemaVersions = require('../../../core/reconcileSchemaVersions');

let root;
let logSpy;
let warnSpy;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcileSchemas-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

function child(container, name, { def, live } = {}) {
  const dir = path.join(root, container, name);
  fs.mkdirSync(dir, { recursive: true });
  if (def !== undefined) fs.writeFileSync(path.join(dir, 'pluginConfig.default.json5'), def, 'utf8');
  if (live !== undefined) fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), live, 'utf8');
  return dir;
}

const LIVE_V1 = '// h\n{\n  "schemaVersion": 1,\n  "active": 0,\n}\n';
const LIVE_NOVER = '// h\n{\n  "active": 0,\n}\n';

describe('reconcileSchemaVersions', () => {

  test('scans a container: classifies drifted / alignedSilently / aligned', async () => {
    child('plugins', 'pDrift', { def: '{ "schemaVersion": 2, "active": 1, "newKey": "x" }\n', live: LIVE_V1 });
    child('plugins', 'pAligned', { def: '{ "schemaVersion": 1, "active": 1 }\n', live: '{ "schemaVersion": 1, "active": 0 }\n' });
    child('plugins', 'pNoVer', { def: '{ "schemaVersion": 1, "active": 1 }\n', live: LIVE_NOVER });

    const res = await reconcileSchemaVersions({ containers: [path.join(root, 'plugins')] });

    expect(res.drifted.map((d) => d.label)).toEqual(['pDrift/pluginConfig.json5']);
    expect(res.drifted[0].added).toEqual(['newKey']);
    expect(res.drifted[0]).toMatchObject({ from: 1, to: 2 });
    expect(res.alignedSilently.map((d) => d.label)).toEqual(['pNoVer/pluginConfig.json5']);
    expect(res.ahead).toEqual([]);
    expect(res.errors).toEqual([]);

    // il box è stato stampato (c'è drift significativo)
    expect(warnSpy).toHaveBeenCalled();
    // e il merge ha aggiunto la chiave nuova preservando il valore esistente
    const merged = fs.readFileSync(path.join(root, 'plugins', 'pDrift', 'pluginConfig.json5'), 'utf8');
    expect(merged).toContain('"newKey"');
    expect(merged).toContain('"schemaVersion": 2');
  });

  test('no box when everything is aligned', async () => {
    child('plugins', 'a', { def: '{ "schemaVersion": 1, "x": 1 }\n', live: '{ "schemaVersion": 1, "x": 9 }\n' });

    const res = await reconcileSchemaVersions({ containers: [path.join(root, 'plugins')] });

    expect(res.drifted).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('explicit pairs (core configs)', async () => {
    const dir = path.join(root, 'core');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ital8Config.default.json5'), '{ "schemaVersion": 2, "a": 1, "b": 2 }\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'ital8Config.json5'), '// h\n{\n  "schemaVersion": 1,\n  "a": 0,\n}\n', 'utf8');

    const res = await reconcileSchemaVersions({
      pairs: [{ label: 'ital8Config.json5', defaultPath: path.join(dir, 'ital8Config.default.json5'), livePath: path.join(dir, 'ital8Config.json5') }],
    });

    expect(res.drifted.map((d) => d.label)).toEqual(['ital8Config.json5']);
    expect(res.drifted[0].added).toEqual(['b']);
  });

  test('live-ahead is reported (anomalous) and boxed', async () => {
    child('plugins', 'p', { def: '{ "schemaVersion": 1, "a": 1 }\n', live: '{ "schemaVersion": 5, "a": 1 }\n' });
    const res = await reconcileSchemaVersions({ containers: [path.join(root, 'plugins')] });
    expect(res.ahead.map((a) => a.label)).toEqual(['p/pluginConfig.json5']);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('collects errors without throwing (invalid default)', async () => {
    child('plugins', 'bad', { def: '{ broken :: }', live: LIVE_V1 });
    const res = await reconcileSchemaVersions({ containers: [path.join(root, 'plugins')] });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].label).toBe('bad/pluginConfig.json5');
  });

  test('empty input → empty report, no box', async () => {
    const res = await reconcileSchemaVersions({});
    expect(res).toEqual({ drifted: [], alignedSilently: [], ahead: [], errors: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
