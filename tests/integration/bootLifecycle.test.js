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
    // Si conclude su 'close', NON su 'exit' — vedi la nota estesa in
    // tests/integration/pluginNpmInstall.test.js. In sintesi: 'exit' non garantisce
    // che le pipe siano drenate, quindi `out` può essere incompleto proprio nel ramo
    // che qui serve di più (i gate che escono, di cui si asserisce l'output).
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

/**
 * Asserisce che il boot sia arrivato IN ASCOLTO e, se non ci è arrivato, dice perché.
 *
 * `expect(res.started).toBe(true)` stampa « Expected: true / Received: false » e
 * butta via l'output del processo, cioè l'unica cosa che spiega l'uscita: un gate
 * che è scattato, un box [FATAL], una porta occupata. Questo helper allega invece
 * exit code, timedOut e la coda di stdout+stderr al messaggio di fallimento.
 *
 * La prova che la lacuna non era teorica: il 22/11/2026 il test « boot graceful:
 * plugin NON essenziale con dep npm inesistente » è caduto in CI su Node 24
 * (verde su Node 22, verde al rilancio dello STESSO commit), e dai log non c'era
 * modo di sapere perché il processo fosse uscito. La causa resta ignota.
 *
 * ⚠️ Si lancia un Error invece di asserire sull'oggetto, e la differenza NON è
 * stilistica. `expect({ started, code, output }).toMatchObject({ started: true })`
 * — l'idioma che `pluginNpmInstall.test.js` adotta dalla v2.95.0 proprio per
 * « portare con sé stdout+stderr » — stampa solo le chiavi che DIFFERISCONO:
 * misurato, il messaggio è `- "started": true / + "started": false` e nient'altro.
 * `code` e `output` non compaiono, quindi quell'idioma non diagnostica niente.
 * Il messaggio di un Error, invece, jest lo stampa per intero.
 */
function expectBootListening(res) {
  if (res.started) return;
  const tail = res.output.split('\n').slice(-30).join('\n');
  throw new Error([
    'il boot non è mai arrivato in ascolto: «server started on port» non è stato stampato.',
    `timedOut: ${!!res.timedOut} · exited: ${!!res.exited} · exit code: ${res.code}`,
    '─── ultime 30 righe di stdout+stderr del processo ───',
    tail,
  ].join('\n'));
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

    // ital8Config.json5 è l'UNICO config del core deliberatamente NON
    // materializzato: la sua assenza è il gate di init. Se un domani finisse
    // nell'elenco dei config rigenerati al boot, il wizard verrebbe scavalcato in
    // silenzio e il progetto partirebbe coi default — con questo test verde.
    expect(fs.existsSync(path.join(dir, 'ital8Config.json5'))).toBe(false);
  });

  // I config vivi del core sono git-ignored e dichiarati «rigenerabili dai
  // .default» come tutti gli altri, ma a crearli era solo il wizard: dopo
  // l'installazione un `git clean -X` o un ripristino parziale da backup li
  // faceva sparire per sempre, e l'avvio moriva con uno stack trace grezzo.
  describe('config vivi del core rigenerati dai .default', () => {
    const CORE_PAIRS = [
      ['core/priorityMiddlewares/koaSession.json5', 'letto dal montaggio dei priority middleware, prima di startApp()'],
      ['core/admin/adminConfig.json5', 'letto da adminSystem.initialize(), dentro startApp()'],
    ];

    // La proprietà sotto test è UNA — « il vivo mancante rinasce dal .default,
    // byte per byte » — e vale per entrambi i file. Cambia ciò che succede DOPO,
    // e solo per koaSession: il suo .default spedisce i segnaposti pubblici, che
    // dalla correzione di REVIEW.md → A2 non fanno partire il CMS.
    //
    // È il comportamento giusto, e va detto perché non è ovvio: un'installazione
    // configurata che perde `koaSession.json5` (un `git clean -X`, un ripristino
    // parziale) lo rigenera con chiavi PUBBLICHE, e ripartire con quelle
    // ricreerebbe A2 passando da un comando di pulizia. Meglio fermarsi e dirlo.
    test.each(CORE_PAIRS)('%s mancante → rigenerato al boot dal suo .default', async (relLive) => {
      const { dir } = await buildFixture();
      const live = path.join(dir, relLive);
      const dflt = live.replace(/\.json5$/, '.default.json5');
      fs.rmSync(live);
      expect(fs.existsSync(dflt)).toBe(true);

      const res = await runBoot(dir);

      expect(res.timedOut).toBeFalsy();
      expect(fs.existsSync(live)).toBe(true);
      // Copia byte-fedele: il vivo nasce identico al default, commenti inclusi.
      expect(fs.readFileSync(live, 'utf8')).toBe(fs.readFileSync(dflt, 'utf8'));
    });

    test('adminConfig.json5 rigenerato → il boot COMPLETA', async () => {
      const { dir } = await buildFixture();
      fs.rmSync(path.join(dir, 'core/admin/adminConfig.json5'));

      const res = await runBoot(dir);

      expectBootListening(res);
      await killProc(res.proc);
    });

    test('koaSession.json5 rigenerato → il gate [SESSION] ferma il boot', async () => {
      // Il file c'è (lo verifica il test parametrizzato sopra), ma porta i
      // segnaposti pubblici del .default: il boot si ferma qui invece di servire
      // il sito con chiavi che chiunque conosce.
      const { dir } = await buildFixture();
      fs.rmSync(path.join(dir, 'core/priorityMiddlewares/koaSession.json5'));

      const res = await runBoot(dir);

      expect(res.exited).toBe(true);
      expect(res.code).toBe(1);
      expect(res.started).toBe(false);
      expect(res.output).toMatch(/\[SESSION\]/);
      expect(res.output).toMatch(/npm run start-configure/);
    });

    test('entrambi mancanti → koaSession al primo boot, adminConfig al secondo', async () => {
      // Prima della correzione di A2 questi due nascevano nello stesso boot.
      // Non più, e la ragione è la COLLOCAZIONE del gate sulle chiavi: sta a
      // livello di modulo, prima di startApp(), quindi interrompe il boot fra la
      // materializzazione di koaSession (riga ~135) e quella di adminConfig
      // (dentro startApp()).
      //
      // È una scelta, non un effetto collaterale: con chiavi pubbliche non si
      // vuole che girino il bind del canale CLI, il caricamento dei 22 plugin e
      // la creazione dei symlink. Il prezzo è che un'installazione che ha perso
      // PIÙ config del core si risana in due avvii invece di uno — e questo test
      // lo mette nero su bianco, così un domani la si cambia sapendo cosa.
      const { dir } = await buildFixture();
      const koaSession = path.join(dir, 'core/priorityMiddlewares/koaSession.json5');
      const adminConfig = path.join(dir, 'core/admin/adminConfig.json5');
      fs.rmSync(koaSession);
      fs.rmSync(adminConfig);

      // Boot 1 — koaSession rinasce (pubblico), il gate ferma il boot: adminConfig
      // non è ancora stato raggiunto.
      let res = await runBoot(dir);
      expect(res.code).toBe(1);
      expect(res.output).toMatch(/\[SESSION\]/);
      expect(fs.existsSync(koaSession)).toBe(true);
      expect(fs.existsSync(adminConfig)).toBe(false);

      // Chiavi sistemate (è ciò che farebbe il wizard) → boot 2 completa il resto.
      await editJson5(koaSession, 'keys', [
        'Zx9_random-secure-key-abcdef0123456789AAA',
        'Qw8-another-secure-key-zyxwvu9876543210BBB',
      ]);

      res = await runBoot(dir);
      expectBootListening(res);
      expect(fs.existsSync(adminConfig)).toBe(true);
      await killProc(res.proc);
    });

    // Senza il .default non c'è nulla da cui rigenerare: è un'installazione
    // incompleta, e va detto subito invece di lasciar morire il boot più avanti
    // con un errore criptico (o, peggio, di avviarsi a metà).
    test.each(CORE_PAIRS)('%s: manca anche il .default → box [CONFIG] + exit 1', async (relLive) => {
      const { dir } = await buildFixture();
      const live = path.join(dir, relLive);
      const dflt = live.replace(/\.json5$/, '.default.json5');
      fs.rmSync(live);
      fs.rmSync(dflt);

      const res = await runBoot(dir);

      expect(res.exited).toBe(true);
      expect(res.code).toBe(1);
      expect(res.started).toBe(false);
      expect(res.output).toMatch(/\[CONFIG\]/);
      expect(res.output).toContain(path.basename(relLive));
    });

    // Il caso normale (sviluppo, vivi presenti) deve restare un no-op: i file
    // dell'utente non vanno mai sovrascritti dal loro default.
    test('vivi già presenti → non toccati', async () => {
      const { dir } = await buildFixture();
      const live = path.join(dir, 'core/admin/adminConfig.json5');
      const marker = fs.readFileSync(live, 'utf8') + '\n// marcatore del test\n';
      fs.writeFileSync(live, marker, 'utf8');

      const res = await runBoot(dir);

      expectBootListening(res);
      expect(fs.readFileSync(live, 'utf8')).toBe(marker);
    });
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
    expectBootListening(res);

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
    expectBootListening(res);                  // non essenziale → il boot completa
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

  // upgradePlugin() girava a OGNI boot: `oldVersion` veniva letto da
  // `pluginConfig.version`, che il codice dichiarava di non salvare mai, quindi
  // valeva sempre '0.0.0' e `semver.gt` era vero per qualunque plugin. Inoffensivo
  // finché tutte le implementazioni erano stub vuoti; rotto al primo che ci avesse
  // messo una migrazione reale. Qui si verifica il ciclo completo su boot
  // successivi — l'unico modo di osservare il difetto.
  test('upgradePlugin: non gira alla prima installazione né a boot invariati, gira al bump di versione', async () => {
    const { dir } = await buildFixture();

    // Questo test fa QUATTRO boot: su una porta dedicata, per non contendere la
    // 3000 con gli altri test che spawnano un server (la suite gira seriale, ma
    // un processo che tarda a chiudere basta a far fallire il boot successivo
    // con EADDRINUSE).
    await editJson5(path.join(dir, 'ital8Config.json5'), 'httpPort', 3457);

    const pdir = path.join(dir, 'plugins', 'zzUpgradeProbe');
    const logPath = path.join(pdir, 'upgradeCalls.json');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'pluginConfig.default.json5'),
      '// test\n{\n  "schemaVersion": 1,\n  "active": 1,\n  "weight": 250,\n  "dependency": {},\n  "nodeModuleDependency": {},\n  "custom": {},\n}\n', 'utf8');
    const writeDescription = (version) => fs.writeFileSync(path.join(pdir, 'pluginDescription.json5'),
      `// test\n{\n  "name": "zzUpgradeProbe",\n  "version": "${version}",\n  "description": "fixture",\n  "author": "test",\n  "email": "t@t.t",\n  "license": "ISC",\n}\n`, 'utf8');
    writeDescription('1.0.0');

    // Registra ogni invocazione su file: la require cache non falsa il conteggio
    // fra boot successivi, che sono processi distinti.
    fs.writeFileSync(path.join(pdir, 'main.js'), `
const fs = require('fs');
const path = require('path');
module.exports = {
  async loadPlugin() {},
  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
    const p = path.join(pathPluginFolder, 'upgradeCalls.json');
    const calls = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    calls.push({ oldVersion, newVersion });
    fs.writeFileSync(p, JSON.stringify(calls), 'utf8');
  },
  getRouteArray() { return []; },
};
`, 'utf8');

    const readCalls = () => (fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : []);
    const liveVersion = () => loadJson5(path.join(pdir, 'pluginConfig.json5')).version;

    // Boot 1 — prima installazione: NON è un upgrade. L'hook non va invocato, ma
    // la versione di partenza va registrata.
    let res = await runBoot(dir);
    expectBootListening(res);
    expect(readCalls()).toEqual([]);
    expect(liveVersion()).toBe('1.0.0');
    await killProc(res.proc);

    // Boot 2 — nulla è cambiato: l'hook deve restare fermo (è QUI che prima
    // scattava, a ogni riavvio).
    res = await runBoot(dir);
    expectBootListening(res);
    expect(readCalls()).toEqual([]);
    await killProc(res.proc);

    // Boot 3 — versione del codice avanzata: l'hook gira una volta, con le due
    // versioni corrette, e la nuova viene persistita.
    writeDescription('2.0.0');
    res = await runBoot(dir);
    expectBootListening(res);
    expect(readCalls()).toEqual([{ oldVersion: '1.0.0', newVersion: '2.0.0' }]);
    expect(liveVersion()).toBe('2.0.0');
    await killProc(res.proc);

    // Boot 4 — l'upgrade è già stato eseguito: non si ripete.
    res = await runBoot(dir);
    expectBootListening(res);
    expect(readCalls()).toHaveLength(1);
    await killProc(res.proc);
  }, 180000);

  // ── Gate sulle chiavi di sessione (REVIEW.md → A2) ─────────────────────────
  // È il presidio che la scheda A2 chiedeva per primo: « un test che avvii
  // l'app con chiavi pubbliche e asserisca che non parta ». Sta qui, al livello
  // di processo, perché è l'unico posto dove si osserva ciò che conta davvero —
  // l'exit code — invece del valore di ritorno di una funzione.
  describe('chiavi di sessione', () => {
    const KOA_SESSION = 'core/priorityMiddlewares/koaSession.json5';

    test('chiavi PUBBLICHE (CHANGE_ME_*) → box [SESSION] + exit 1, server NON avviato', async () => {
      const { dir } = await buildFixture();
      // Esattamente ciò che il .default spedisce: la condizione di
      // un'installazione mai configurata, o configurata a mano.
      await editJson5(path.join(dir, KOA_SESSION), 'keys', [
        'CHANGE_ME_session_key_1', 'CHANGE_ME_session_key_2', 'CHANGE_ME_session_key_3',
      ]);

      const res = await runBoot(dir);

      expect(res.exited).toBe(true);
      expect(res.code).toBe(1);
      expect(res.started).toBe(false);
      expect(res.output).toMatch(/\[SESSION\]/);
      expect(res.output).toMatch(/il CMS non parte/);
      expect(res.output).toMatch(/npm run start-configure/);
    });

    test('un placeholder STORICO è pubblico quanto quelli correnti → exit 1', async () => {
      // Il caso che un'euristica strutturale mancherebbe: 20 caratteri, forma
      // plausibile, ma leggibile nella storia di git. Vedi la nota in
      // core/sessionSecurity.js sul perché l'elenco esatto non è sostituibile.
      const { dir } = await buildFixture();
      await editJson5(path.join(dir, KOA_SESSION), 'keys', ['key.segretussimmmmmm']);

      const res = await runBoot(dir);

      expect(res.exited).toBe(true);
      expect(res.code).toBe(1);
      expect(res.started).toBe(false);
      expect(res.output).toMatch(/storia di git/);
    });

    test('il gate scatta PRIMA che il server sia in ascolto', async () => {
      // Il difetto che la correzione ha dovuto evitare: il controllo stava in
      // fondo a startApp(), DOPO httpsManager.start(). Lì un gate fatale
      // avrebbe accettato richieste — con cookie forgiabili — per il tempo che
      // separa l'ascolto dall'uscita. Qui si verifica che nell'output non
      // compaia mai l'avvio del server.
      const { dir } = await buildFixture();
      await editJson5(path.join(dir, KOA_SESSION), 'keys', ['CHANGE_ME_session_key_1']);

      const res = await runBoot(dir);

      expect(res.code).toBe(1);
      expect(res.output).not.toMatch(/server started on port/);
    });

    test('chiavi DEBOLI (corte ma non note) → avviso, il boot COMPLETA', async () => {
      // Il livello 2 è una stima, non un fatto: non si spegne un'installazione
      // su un sospetto. Questo test è il contrappeso dei tre sopra — senza, una
      // fix che rendesse fatale anche il livello debole passerebbe inosservata.
      const { dir } = await buildFixture();
      await editJson5(path.join(dir, KOA_SESSION), 'keys', ['corta1', 'corta2']);

      const res = await runBoot(dir);

      expectBootListening(res);
      expect(res.output).toMatch(/\[SESSION\]/);
      expect(res.output).toMatch(/Il server parte comunque/);
      expect(res.output).not.toMatch(/il CMS non parte/);
      await killProc(res.proc);
    });

    test('con chiavi a posto il gate tace del tutto', async () => {
      // Un gate che parla sempre smette di essere letto: la fixture nasce con le
      // chiavi generate da globalSetup, quindi non deve produrre alcun [SESSION].
      const { dir } = await buildFixture();

      const res = await runBoot(dir);

      expectBootListening(res);
      expect(res.output).not.toMatch(/\[SESSION\]/);
      await killProc(res.proc);
    });
  });
});
