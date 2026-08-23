/**
 * Integration test — npm install dei plugin SELF-CONTAINED alla transizione
 * d'installazione (docs/self-update.it.md, spigolo #5; core/installPluginNpmDeps.js).
 *
 * Verifica il WIRING in pluginSys facendo lo spawn di `node index.js` su una
 * FIXTURE isolata (copia del progetto in tmpdir, node_modules in symlink) con
 * plugin sintetici iniettati. Niente mock: si osserva il boot reale (stdout + file
 * vivi su disco). Casi coperti (non copribili a livello unit, initialize() scansiona
 * la cartella plugins/ reale e può fare process.exit sugli essenziali):
 *   1. self-contained fresco → `npm install` nella sua cartella + isInstalled:1;
 *      legacy (no package.json) → nessun install; self-contained con install che
 *      FALLISCE → boot graceful, plugin comunque caricato (best-effort).
 *   2. self-contained già installato (isInstalled:1 nel vivo) → install SALTATO.
 *
 * adminMedia (unico plugin self-contained reale) è disabilitato nella fixture così
 * il boot non tenta un npm install DI RETE per le sue deps, irrilevanti a questo test.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const loadJson5 = require('../../core/loadJson5');
const editJson5 = require('../../core/editJson5');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const REAL_NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');

jest.setTimeout(90000);

const createdFixtures = [];
const liveProcs = [];

const EXCLUDED_BASENAMES = new Set(['node_modules', '.git', 'tests', 'coverage', '.github', 'ital8cms.sock']);

// Copia il progetto in tmpdir saltando node_modules/.git/tests/symlink; node_modules
// via symlink. Disabilita adminMedia (unico self-contained reale) per evitare un
// npm install di rete al boot.
async function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8npm-'));
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

  fs.symlinkSync(REAL_NODE_MODULES, path.join(dir, 'node_modules'), 'dir');

  const port = 35000 + Math.floor(Math.random() * 1500);
  await editJson5(path.join(dir, 'ital8Config.json5'), 'httpPort', port);

  // Neutralizza adminMedia: default active→0 e rimuovi il vivo (rimaterializzato
  // come inactive dal default). Così il boot non prova un npm install per le sue deps.
  const amDefault = path.join(dir, 'plugins', 'adminMedia', 'pluginConfig.default.json5');
  if (fs.existsSync(amDefault)) await editJson5(amDefault, 'active', 0);
  const amLive = path.join(dir, 'plugins', 'adminMedia', 'pluginConfig.json5');
  if (fs.existsSync(amLive)) fs.rmSync(amLive);

  return { dir, port };
}

// Inietta un plugin sintetico. selfContained → scrive package.json; liveIsInstalled
// definito → scrive un pluginConfig.json5 VIVO con quel isInstalled (altrimenti solo
// il .default, materializzato al boot → transizione d'installazione).
function injectPlugin(dir, name, { packageJson, active = 1, weight = 250, liveIsInstalled } = {}) {
  const pdir = path.join(dir, 'plugins', name);
  fs.mkdirSync(pdir, { recursive: true });

  const cfg = { schemaVersion: 1, active, weight, dependency: {}, nodeModuleDependency: {} };
  fs.writeFileSync(path.join(pdir, 'pluginConfig.default.json5'), '// test\n' + JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  if (liveIsInstalled !== undefined) {
    fs.writeFileSync(path.join(pdir, 'pluginConfig.json5'), '// test\n' + JSON.stringify({ ...cfg, isInstalled: liveIsInstalled }, null, 2) + '\n', 'utf8');
  }

  fs.writeFileSync(path.join(pdir, 'pluginDescription.json5'),
    '// test\n' + JSON.stringify({ name, version: '1.0.0', description: 'fixture', author: 'test', email: 't@t.t', license: 'ISC' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(pdir, 'main.js'),
    'module.exports = { async loadPlugin() {}, getRouteArray() { return []; } };\n', 'utf8');

  if (packageJson) fs.writeFileSync(path.join(pdir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
  return pdir;
}

// Spawn di `node index.js`. Risolve quando il server è su o quando il processo esce.
function runBoot(dir, { timeoutMs = 60000 } = {}) {
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
    // Si conclude su 'close', NON su 'exit'. 'exit' segnala la morte del processo ma
    // NON che le pipe di stdio siano state drenate: gli ultimi chunk possono essere
    // ancora in volo, quindi valutare `out` lì può perdere proprio la riga READY e
    // riportare `started: false` su un boot RIUSCITO. Misurato: su 200 spawn che
    // stampano un marker e escono subito, in 14 casi (7%) il marker mancava su
    // 'exit' ed era presente su 'close'. 'close' è emesso dopo la chiusura di tutti
    // gli stdio, quindi lì `out` è completo. Se 'close' non arrivasse, resta il
    // timeout esterno: un fallimento dichiarato è meglio di un esito sbagliato.
    proc.on('exit', (code) => {
      proc.once('close', () => settle({ exited: true, code }));
    });

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

describe('npm install self-contained alla transizione d\'installazione (integration)', () => {

  test('self-contained → npm install + isInstalled:1; legacy → nessun install; fallimento → boot graceful', async () => {
    const { dir } = await buildFixture();

    // self-contained fresco, NESSUNA dipendenza → npm install offline e veloce.
    injectPlugin(dir, 'zzScFresh', { packageJson: { name: 'zzscfresh', version: '1.0.0', private: true } });
    // legacy: nessun package.json.
    injectPlugin(dir, 'zzLegacyOk', {});
    // self-contained il cui npm install FALLISCE in modo deterministico e OFFLINE:
    // package.json VALIDO (così Node lo parsa e require(main.js) riesce) ma con uno
    // script preinstall che esce non-zero → `npm install` fallisce. main.js/loadPlugin
    // riescono comunque → dimostra il best-effort (npm fallisce ma il plugin si carica).
    injectPlugin(dir, 'zzScFails', {
      packageJson: { name: 'zzscfails', version: '1.0.0', private: true, scripts: { preinstall: 'exit 1' } },
    });

    const res = await runBoot(dir);

    expect(res.timedOut).toBeFalsy();
    // Vedi la nota nell'altro test: l'oggetto porta l'output nel messaggio d'errore.
    expect({ started: res.started, code: res.code, output: res.output })
      .toMatchObject({ started: true });

    // self-contained fresco → riga di install + caricato + isInstalled:1 + lockfile creato
    expect(res.output).toMatch(/Plugin self-contained "zzScFresh": installo le dipendenze npm/);
    expect(res.output).toMatch(/Plugin caricato: zzScFresh/);
    expect(loadJson5(path.join(dir, 'plugins/zzScFresh/pluginConfig.json5')).isInstalled).toBe(1);
    expect(fs.existsSync(path.join(dir, 'plugins/zzScFresh/package-lock.json'))).toBe(true);

    // legacy → NESSUNA riga di install, comunque caricato
    expect(res.output).not.toMatch(/zzLegacyOk.*installo le dipendenze npm/);
    expect(res.output).toMatch(/Plugin caricato: zzLegacyOk/);

    // self-contained con install fallito → warning MA boot graceful e plugin caricato
    expect(res.output).toMatch(/npm install fallito per "zzScFails"/);
    expect(res.output).toMatch(/Plugin caricato: zzScFails/);
    expect(loadJson5(path.join(dir, 'plugins/zzScFails/pluginConfig.json5')).isInstalled).toBe(1);
  });

  test('self-contained già installato (isInstalled:1) → npm install SALTATO', async () => {
    const { dir } = await buildFixture();

    injectPlugin(dir, 'zzScInstalled', {
      packageJson: { name: 'zzscinstalled', version: '1.0.0', private: true },
      liveIsInstalled: 1,
    });

    const res = await runBoot(dir);

    expect(res.timedOut).toBeFalsy();
    // Si asserisce sull'oggetto e non sul solo booleano: quando il boot NON parte,
    // il messaggio di jest deve dire PERCHÉ. `expect(res.started).toBe(true)` stampa
    // "Expected: true / Received: false" e basta — l'output del processo, che è
    // l'unica cosa che spiega l'uscita, viene buttato via. È la ragione per cui
    // questo fallimento è rimasto senza causa in TODO.md §5.
    expect({ started: res.started, code: res.code, output: res.output })
      .toMatchObject({ started: true });
    expect(res.output).toMatch(/Plugin caricato: zzScInstalled/);
    // isInstalled era già 1 → transizione NON attraversata → nessun npm install
    expect(res.output).not.toMatch(/Plugin self-contained "zzScInstalled": installo le dipendenze npm/);
  });
});
