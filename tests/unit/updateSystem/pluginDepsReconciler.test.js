/**
 * Test per scripts/lib/pluginDepsReconciler.js (deps-sync).
 *
 * Due gruppi di verifiche complementari:
 *   1. BRANCHING / REPORT in dry-run (nessun npm eseguito): rami self-contained /
 *      legacy / disabled / themes, validazione dep-spec (sicurezza) e realign del
 *      vivo dal .default.
 *   2. INVOCAZIONE npm REALE con `child_process.execFileSync` MOCKATO (nessun npm
 *      lanciato davvero): asserisce che il ramo self-contained deleghi a
 *      core/installPluginNpmDeps con `cwd` = cartella del plugin (`install`/`ci`) e
 *      che il ramo legacy usi `--no-save` a root con gli spec corretti.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock di child_process PRIMA di require del reconciler (che transitivamente carica
// core/installPluginNpmDeps, il quale usa execFileSync). I test in dry-run non
// invocano mai npm, quindi il mock è innocuo per loro.
jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const { execFileSync } = require('child_process');

const loadJson5 = require('../../../core/loadJson5');
const { reconcile } = require('../../../scripts/lib/pluginDepsReconciler');

let root;

function mkPlugin(name, { def, live, pkg } = {}) {
  const dir = path.join(root, 'plugins', name);
  fs.mkdirSync(dir, { recursive: true });
  if (def !== undefined) fs.writeFileSync(path.join(dir, 'pluginConfig.default.json5'), def);
  if (live !== undefined) fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), live);
  if (pkg !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return dir;
}
function mkTheme(name, { def } = {}) {
  const dir = path.join(root, 'themes', name);
  fs.mkdirSync(dir, { recursive: true });
  if (def !== undefined) fs.writeFileSync(path.join(dir, 'themeConfig.default.json5'), def);
}
const cfg = (obj) => `// test\n{\n${Object.entries(obj).map(([k, v]) => `  "${k}": ${JSON.stringify(v)},`).join('\n')}\n}\n`;

// Chiamate a execFileSync('npm', ...) con un dato cwd (per il gruppo 2).
function npmCallsWithCwd(cwd) {
  return execFileSync.mock.calls.filter((c) => c[0] === 'npm' && c[2] && c[2].cwd === cwd);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-recon-'));
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'themes'), { recursive: true });
  execFileSync.mockReset();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('reconcile (dry-run branching)', () => {
  test('self-contained plugin → per-plugin branch', async () => {
    mkPlugin('selfCont', { def: cfg({ active: 1, nodeModuleDependency: {} }), pkg: { name: 'x', version: '1.0.0' } });
    const r = await reconcile(root, { dryRun: true });
    expect(r.perPlugin).toEqual([{ container: 'plugins', name: 'selfCont', dryRun: true }]);
    expect(r.legacy).toEqual([]);
  });

  test('legacy plugin → root --no-save branch (reports specs)', async () => {
    mkPlugin('legacyOk', { def: cfg({ active: 1, nodeModuleDependency: { leftpad: '^1.0.0' } }) });
    const r = await reconcile(root, { dryRun: true });
    expect(r.legacy).toEqual([{ container: 'plugins', name: 'legacyOk', wouldInstall: ['leftpad@^1.0.0'], dryRun: true }]);
  });

  test('disabled plugin (active:0) is skipped entirely', async () => {
    mkPlugin('disabled', { def: cfg({ active: 0, nodeModuleDependency: { foo: '^1.0.0' } }) });
    const r = await reconcile(root, { dryRun: true });
    expect(r.perPlugin).toEqual([]);
    expect(r.legacy).toEqual([]);
  });

  test('themes container is scanned (no active field → processed)', async () => {
    mkTheme('depTheme', { def: cfg({ nodeModuleDependency: { leftpad: '^2.0.0' } }) });
    const r = await reconcile(root, { dryRun: true });
    expect(r.legacy).toEqual([{ container: 'themes', name: 'depTheme', wouldInstall: ['leftpad@^2.0.0'], dryRun: true }]);
  });
});

describe('reconcile (security: dep-spec validation)', () => {
  test('invalid npm name / range are skipped with a warning, never passed to npm', async () => {
    mkPlugin('badspec', { def: cfg({ active: 1, nodeModuleDependency: { '../evil': '^1.0.0', pkgok: 'not-a-range' } }) });
    const r = await reconcile(root, { dryRun: true });
    // nessuno spec valido → niente install
    expect(r.legacy).toEqual([]);
    expect(r.warnings.length).toBe(2);
    expect(r.warnings.join('\n')).toMatch(/\.\.\/evil/);
    expect(r.warnings.join('\n')).toMatch(/not-a-range/);
  });
});

describe('reconcile (realign live nodeModuleDependency from default)', () => {
  test('detects drift in dry-run', async () => {
    mkPlugin('realignMe', {
      def: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: {} }),
      live: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: { stale: '^1.0.0' } }),
    });
    const r = await reconcile(root, { dryRun: true });
    expect(r.realigned).toEqual([{ container: 'plugins', name: 'realignMe', to: {} }]);
    // dry-run non scrive
    expect(loadJson5(path.join(root, 'plugins', 'realignMe', 'pluginConfig.json5')).nodeModuleDependency).toEqual({ stale: '^1.0.0' });
  });

  test('writes the realigned value to the live config (non dry-run)', async () => {
    mkPlugin('realignMe', {
      def: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: {} }),
      live: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: { stale: '^1.0.0' } }),
    });
    await reconcile(root, { dryRun: false });
    expect(loadJson5(path.join(root, 'plugins', 'realignMe', 'pluginConfig.json5')).nodeModuleDependency).toEqual({});
  });

  test('no realign when live matches default', async () => {
    mkPlugin('inSync', {
      def: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: { a: '^1.0.0' } }),
      live: cfg({ schemaVersion: 1, active: 1, nodeModuleDependency: { a: '^1.0.0' } }),
    });
    const r = await reconcile(root, { dryRun: true });
    expect(r.realigned).toEqual([]);
  });
});

describe('reconcile (invocazione npm reale, execFileSync mockato)', () => {
  test('self-contained attivo → `npm install --no-audit --no-fund` DENTRO la cartella', async () => {
    const pdir = mkPlugin('sc', { def: cfg({ active: 1 }), pkg: { name: 'sc', version: '1.0.0', private: true } });

    const report = await reconcile(root, {});

    const calls = npmCallsWithCwd(pdir);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(['install', '--no-audit', '--no-fund']);
    expect(report.perPlugin).toContainEqual({ container: 'plugins', name: 'sc', ok: true });
  });

  test('clean=true → `npm ci` nel ramo self-contained', async () => {
    const pdir = mkPlugin('sc', { def: cfg({ active: 1 }), pkg: { name: 'sc', version: '1.0.0', private: true } });

    await reconcile(root, { clean: true });

    expect(npmCallsWithCwd(pdir)[0][1]).toEqual(['ci', '--no-audit', '--no-fund']);
  });

  test('legacy con dep mancante → `npm install --no-save <spec>` a ROOT', async () => {
    mkPlugin('lg', { def: cfg({ active: 1, nodeModuleDependency: { leftpad: '^1.0.0' } }) });

    const report = await reconcile(root, {});

    const rootCalls = npmCallsWithCwd(root);
    expect(rootCalls).toHaveLength(1);
    expect(rootCalls[0][1]).toEqual(['install', '--no-save', '--no-audit', '--no-fund', 'leftpad@^1.0.0']);
    expect(report.legacy.some((e) => e.name === 'lg')).toBe(true);
  });
});
