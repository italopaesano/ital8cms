/**
 * Integration test del BOOT — ciclo di vita config (docs/decisions/config-lifecycle.it.md).
 *
 * Verifica l'orchestrazione reale di index.js end-to-end facendo lo spawn di
 * `node index.js` su una FIXTURE isolata (copia del progetto in tmpdir, con
 * node_modules in symlink). Niente mock: si osservano exit code, i box su stdout
 * ([INIT]/[PLUGINS]/[FATAL]) e i file vivi rigenerati su disco.
 *
 * Casi coperti (process-level, non coperti dagli unit test):
 *   1. Gate di init: manca ital8Config.json5 (c'è solo il .default) → box [INIT] + exit 1.
 *   2. Materializzazione fresh-clone: descrittori plugin/tema vivi assenti → rigenerati
 *      dai .default al boot, con isInstalled persistito (plugin via pluginSys, temi
 *      bundled via ensureThemesInstalled) → server avviato.
 *   3. Boot graceful: un plugin NON essenziale con dep npm inesistente → marcato
 *      incomplete + box [PLUGINS], il boot COMPLETA (server avviato).
 *   4. Plugin essenziale non caricabile → box [FATAL] + exit 1 (server NON avviato).
 *
 * Strategia fixture: si copia il sorgente del progetto SALTANDO i symlink (il boot
 * ricrea pluginPages/ e le sezioni admin) e node_modules (aggiunto come symlink).
 * Ogni test costruisce una fixture fresca; teardown affidabile in afterEach.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const loadJson5 = require('../../core/loadJson5');
const setJson5Key = require('../../core/setJson5Key');
const editJson5 = require('../../core/editJson5');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const REAL_NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');

jest.setTimeout(60000);

// Dirs/processi creati dai test → puliti in afterEach.
const createdFixtures = [];
const liveProcs = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

// Copia il progetto in una tmpdir SALTANDO node_modules/.git/tests/coverage, i
// socket e TUTTI i symlink (il boot ricrea pluginPages/ e le sezioni admin, che
// nel repo sono symlink assoluti → non isolabili se copiati così com'è).
const EXCLUDED_BASENAMES = new Set(['node_modules', '.git', 'tests', 'coverage', '.github', 'ital8cms.sock']);

async function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8boot-'));
  createdFixtures.push(dir);

  fs.cpSync(PROJECT_ROOT, dir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (EXCLUDED_BASENAMES.has(base)) return false;
      if (base.endsWith('.sock')) return false;
      if (fs.lstatSync(src).isSymbolicLink()) return false; // ricreati al boot
      return true;
    },
  });

  // node_modules condiviso via symlink (evita 177 MB di copia).
  fs.symlinkSync(REAL_NODE_MODULES, path.join(dir, 'node_modules'), 'dir');

  // Porta alta randomica per non collidere con altri server della suite.
  const port = 34000 + Math.floor(Math.random() * 1500);
  await editJson5(path.join(dir, 'ital8Config.json5'), 'httpPort', port);

  return { dir, port };
}

// Rimuove i descrittori VIVI (pluginConfig/themeConfig) di una fixture, lasciando
// i .default → al boot vengono rimaterializzati. Simula il clone fresco (post-wizard,
// con i 3 core già presenti).
function removeLiveDescriptors(dir) {
  for (const [container, live] of [['plugins', 'pluginConfig.json5'], ['themes', 'themeConfig.json5']]) {
    const base = path.join(dir, container);
    for (const name of fs.readdirSync(base)) {
      const p = path.join(base, name, live);
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  }
}

// Spawn di `node index.js` nella fixture. Risolve quando il server è su
// ("server started on port") OPPURE quando il processo esce (gate/[FATAL]).
function runBoot(dir, { timeoutMs = 40000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['index.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    liveProcs.push(proc);

    let out = '';
    let settled = false;
    const READY = /server started on port/;

    const settle = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ proc, output: out, started: READY.test(out), ...extra });
    };

    const onData = (chunk) => {
      out += chunk.toString();
      if (READY.test(out)) settle({ exited: false, code: null });
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => settle({ exited: true, code }));

    const timer = setTimeout(() => settle({ exited: false, code: null, timedOut: true }), timeoutMs);
  });
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return resolve();
    const force = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 5000);
    proc.once('exit', () => { clearTimeout(force); resolve(); });
    try { proc.kill('SIGTERM'); } catch (_) { clearTimeout(force); resolve(); }
  });
}

afterEach(async () => {
  for (const proc of liveProcs) await killProc(proc);
  liveProcs.length = 0;
  for (const dir of createdFixtures) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  createdFixtures.length = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('boot — ciclo di vita config (integration)', () => {

  test('gate di init: ital8Config.json5 mancante → box [INIT] + exit 1, server NON avviato', async () => {
    const { dir } = await buildFixture();
    // Simula progetto non inizializzato: rimuovi il vivo, lascia il .default.
    fs.rmSync(path.join(dir, 'ital8Config.json5'));
    expect(fs.existsSync(path.join(dir, 'ital8Config.default.json5'))).toBe(true);

    const res = await runBoot(dir);

    expect(res.exited).toBe(true);
    expect(res.code).toBe(1);
    expect(res.started).toBe(false);
    expect(res.output).toMatch(/\[INIT\]/);
  });

  test('fresh-clone: descrittori vivi rigenerati dai .default + isInstalled persistito → server avviato', async () => {
    const { dir } = await buildFixture();
    removeLiveDescriptors(dir);
    // precondizione: i vivi non ci sono, i .default sì
    expect(fs.existsSync(path.join(dir, 'plugins/bootstrap/pluginConfig.json5'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'plugins/bootstrap/pluginConfig.default.json5'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'themes/default/themeConfig.json5'))).toBe(false);

    const res = await runBoot(dir);

    expect(res.timedOut).toBeFalsy();
    expect(res.started).toBe(true);

    // Plugin: vivo rigenerato + isInstalled persistito da pluginSys.
    const pluginCfgPath = path.join(dir, 'plugins/bootstrap/pluginConfig.json5');
    expect(fs.existsSync(pluginCfgPath)).toBe(true);
    expect(loadJson5(pluginCfgPath).isInstalled).toBe(1);

    // Tema bundled: vivo rigenerato + isInstalled:1 da ensureThemesInstalled.
    const themeCfgPath = path.join(dir, 'themes/default/themeConfig.json5');
    expect(fs.existsSync(themeCfgPath)).toBe(true);
    expect(loadJson5(themeCfgPath).isInstalled).toBe(1);
  });

  test('boot graceful: plugin NON essenziale con dep npm inesistente → [PLUGINS] + server avviato', async () => {
    const { dir } = await buildFixture();

    // Inietta un plugin sintetico non essenziale con una dipendenza npm inesistente.
    const pdir = path.join(dir, 'plugins', 'zzBrokenDep');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'pluginConfig.default.json5'),
      '// test\n{\n  "schemaVersion": 1,\n  "active": 1,\n  "weight": 250,\n  "dependency": {},\n  "nodeModuleDependency": { "ital8-nonexistent-pkg-zzz": "^1.0.0" },\n}\n', 'utf8');
    fs.writeFileSync(path.join(pdir, 'pluginDescription.json5'),
      '// test\n{\n  "name": "zzBrokenDep",\n  "version": "1.0.0",\n  "description": "fixture",\n  "author": "test",\n  "email": "t@t.t",\n  "license": "ISC",\n}\n', 'utf8');
    fs.writeFileSync(path.join(pdir, 'main.js'),
      'module.exports = { async loadPlugin() {}, getRouteArray() { return []; } };\n', 'utf8');

    const res = await runBoot(dir);

    expect(res.timedOut).toBeFalsy();
    expect(res.started).toBe(true);                  // non essenziale → il boot completa
    expect(res.output).toMatch(/\[PLUGINS\]/);       // box di riepilogo degli incompleti
    expect(res.output).toMatch(/zzBrokenDep/);       // cita il plugin problematico
  });

  test('plugin essenziale non caricabile → box [FATAL] + exit 1, server NON avviato', async () => {
    const { dir } = await buildFixture();

    // Rompi un essenziale (adminAccessControl) con una dep npm inesistente nel vivo.
    const essentialCfg = path.join(dir, 'plugins/adminAccessControl/pluginConfig.json5');
    expect(fs.existsSync(essentialCfg)).toBe(true);
    await setJson5Key(essentialCfg, 'nodeModuleDependency', { 'ital8-nonexistent-pkg-zzz': '^1.0.0' });

    const res = await runBoot(dir);

    expect(res.exited).toBe(true);
    expect(res.code).toBe(1);
    expect(res.started).toBe(false);
    expect(res.output).toMatch(/\[FATAL\]/);
    expect(res.output).toMatch(/adminAccessControl/);
  });
});
