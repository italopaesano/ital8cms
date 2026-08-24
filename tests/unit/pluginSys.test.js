// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per core/pluginSys.js — il modulo REALE.
 *
 * PERCHÉ QUESTO FILE È STATO RISCRITTO (v2.97.0)
 * ----------------------------------------------
 * La versione precedente non conteneva alcun `require` di core/pluginSys.js:
 * l'unico import era `semver`. Le funzioni verificate — risoluzione delle
 * dipendenze, rilevamento dei cicli, ordinamento per weight — erano RISCRITTE
 * dentro il file di test, sotto un commento che lo dichiarava
 * («Funzione estratta da pluginSys per testing»). I test passavano e
 * verificavano una copia: il modulo vero risultava a 0% di copertura, e una
 * regressione al suo interno non avrebbe fatto fallire niente.
 *
 * È lo stesso antipattern già corretto per themeSys in v2.90.0 («i nuovi test
 * esercitano la funzione REALE, non una copia»), rimasto qui.
 *
 * PERIMETRO
 * ---------
 * Due gruppi di test, che richiedono due strade diverse:
 *
 *  1. Superficie raggiungibile SENZA initialize() — costruttore, accessori,
 *     copie difensive, iniezione dei sottosistemi e getGlobalFunctions(), che è
 *     pilotato dalla configurazione iniettata nel costruttore.
 *
 *  2. `initialize()`, dove vive la maggior parte del modulo: stati dei plugin,
 *     ordine di caricamento, cascata sui dipendenti, cicli, persistenza di
 *     `isInstalled`. Risolveva i plugin con `path.join(__dirname, '..',
 *     'plugins')` — la cartella REALE — quindi eseguirlo in un test avrebbe
 *     caricato i plugin veri in-process e scritto `isInstalled` nei loro config
 *     vivi, contro l'isolamento filesystem di docs/testing.it.md. Da v2.98.0 il
 *     costruttore accetta una root opzionale (`pluginsRootPath`, default
 *     invariato), sulla falsariga di `validateThemeContent(..., themesRootPath)`
 *     in v2.92.0: i test usano una tmpdir con plugin sintetici.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginSys = require('../../core/pluginSys');
const loadJson5 = require('../../core/loadJson5');

// Il modulo logga su console in diversi rami (warning sulla whitelist, banner
// dell'errore fatale). I test li esercitano di proposito, quindi le console
// vengono silenziate qui invece di sporcare l'output della suite.
let consoleSpies = [];

beforeEach(() => {
  consoleSpies = [
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
  consoleSpies = [];
});

describe('pluginSys — costruttore', () => {
  test('costruire non tocca il filesystem né carica plugin', () => {
    // Il costruttore fa SOLO setup dei campi: il caricamento è in initialize().
    // Se un giorno tornasse a scandire plugins/, questo test se ne accorge.
    const sys = new pluginSys({});

    expect(sys.getActivePluginNames()).toEqual([]);
    expect(sys.getAllPlugins()).toEqual([]);
    expect(sys.getPluginStates().size).toBe(0);
  });

  test('accetta una configurazione assente senza lanciare', () => {
    expect(() => new pluginSys(undefined)).not.toThrow();
  });
});

describe('pluginSys — accessori sullo stato iniziale', () => {
  let sys;
  beforeEach(() => { sys = new pluginSys({}); });

  test('getPluginState() di un plugin sconosciuto è null, non undefined', () => {
    expect(sys.getPluginState('nonEsiste')).toBeNull();
  });

  test('isPluginActive() è false per un plugin non caricato', () => {
    expect(sys.isPluginActive('adminUsers')).toBe(false);
  });

  test('getPlugin() di un plugin non attivo è null', () => {
    expect(sys.getPlugin('adminUsers')).toBeNull();
  });

  test('getMiddlewaresToLoad() parte da un array vuoto', () => {
    expect(sys.getMiddlewaresToLoad()).toEqual([]);
  });

  test('getObjectsToShareInWebPages() parte da un oggetto vuoto', () => {
    expect(sys.getObjectsToShareInWebPages()).toEqual({});
  });

  test('getPluginVersion() è null per un plugin non attivo, senza leggere il disco', () => {
    // Cortocircuita su isPluginActive(): non deve arrivare a cercare
    // pluginDescription.json5, altrimenti un plugin inesistente produrrebbe
    // un warning invece di un null pulito.
    expect(sys.getPluginVersion('nonEsiste')).toBeNull();
  });
});

describe('pluginSys — gli accessori restituiscono COPIE, non lo stato interno', () => {
  // Se restituissero il riferimento vivo, un chiamante potrebbe corrompere lo
  // stato del sistema plugin per sbaglio. È un contratto, non un dettaglio.
  test('getPluginStates(): mutare la mappa restituita non tocca il sistema', () => {
    const sys = new pluginSys({});
    const states = sys.getPluginStates();
    states.set('intruso', { state: 'installed' });

    expect(sys.getPluginStates().has('intruso')).toBe(false);
    expect(sys.getPluginState('intruso')).toBeNull();
  });

  test('getReservedRoutePaths(): mutare il Set restituito non tocca l\'indice', () => {
    const sys = new pluginSys({});
    const paths = sys.getReservedRoutePaths();
    paths.add('/api/intruso');

    expect(sys.getReservedRoutePaths().has('/api/intruso')).toBe(false);
    expect(sys.getReservedRoutePaths().size).toBe(0);
  });
});

describe('pluginSys — dependency injection dei sottosistemi', () => {
  let sys;
  beforeEach(() => { sys = new pluginSys({}); });

  test('themeSys: null prima, restituito dopo', () => {
    expect(sys.getThemeSys()).toBeNull();
    const fakeThemeSys = { marker: 'themeSys' };
    sys.setThemeSys(fakeThemeSys);
    expect(sys.getThemeSys()).toBe(fakeThemeSys);
  });

  test('reservedGate: null prima, restituito dopo', () => {
    expect(sys.getReservedGate()).toBeNull();
    const fakeGate = { isClosed: () => false };
    sys.setReservedGate(fakeGate);
    expect(sys.getReservedGate()).toBe(fakeGate);
  });

  test('adminSystem: null prima, restituito dopo (init a 2 fasi)', () => {
    expect(sys.getAdminSystem()).toBeNull();
    const fakeAdmin = { marker: 'adminSystem' };
    sys.setAdminSystem(fakeAdmin);
    expect(sys.getAdminSystem()).toBe(fakeAdmin);
  });
});

describe('pluginSys — requestRestart()', () => {
  test('senza callback registrato ritorna false e non lancia', () => {
    // Situazione anomala ma non fatale: il chiamante deve poterla distinguere.
    const sys = new pluginSys({});
    expect(sys.requestRestart({ reason: 'test' })).toBe(false);
  });

  test('con callback registrato lo invoca e ritorna true', () => {
    const sys = new pluginSys({});
    const callback = jest.fn();
    sys.setRequestRestart(callback);

    expect(sys.requestRestart({ reason: 'cambio tema' })).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ reason: 'cambio tema' });
  });

  test('invocata senza argomenti passa un oggetto vuoto, non undefined', () => {
    const sys = new pluginSys({});
    const callback = jest.fn();
    sys.setRequestRestart(callback);

    sys.requestRestart();
    expect(callback).toHaveBeenCalledWith({});
  });
});

describe('pluginSys — getSharedObject()', () => {
  test('provider non attivo → null (non lancia)', () => {
    const sys = new pluginSys({});
    expect(sys.getSharedObject('dbApi')).toBeNull();
  });

  test('provider non attivo → null anche indicando il chiamante', () => {
    const sys = new pluginSys({});
    expect(sys.getSharedObject('dbApi', 'adminMedia')).toBeNull();
  });
});

describe('pluginSys — getGlobalFunctions(): il modello a whitelist', () => {
  test('whitelist assente → nessuna funzione globale', () => {
    const sys = new pluginSys({});
    expect(sys.getGlobalFunctions()).toEqual({});
  });

  test('whitelist vuota → nessuna funzione globale', () => {
    const sys = new pluginSys({ globalFunctionsWhitelist: {} });
    expect(sys.getGlobalFunctions()).toEqual({});
  });

  test('required:true con plugin NON attivo → lancia (fail-fast al boot)', () => {
    // È il contratto dichiarato in CLAUDE.md: una funzione dichiarata
    // indispensabile e non disponibile deve fermare il boot, non degradare.
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n', required: true, description: 'traduzioni' },
      },
    });

    expect(() => sys.getGlobalFunctions()).toThrow(/simpleI18n/);
    expect(() => sys.getGlobalFunctions()).toThrow(/__/);
  });

  test('required:false con plugin NON attivo → fallback, nessun throw', () => {
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n', required: false },
      },
    });

    const globals = sys.getGlobalFunctions();
    expect(typeof globals.__).toBe('function');
  });

  test('required omesso equivale a false (default permissivo)', () => {
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n' },
      },
    });

    expect(() => sys.getGlobalFunctions()).not.toThrow();
    expect(typeof sys.getGlobalFunctions().__).toBe('function');
  });
});

describe('pluginSys — le funzioni di fallback restano usabili nei template', () => {
  // Un fallback che lancia trasformerebbe un plugin mancante in una pagina
  // rotta: il punto del required:false è esattamente evitarlo.
  const buildFallback = (functionName) => new pluginSys({
    globalFunctionsWhitelist: {
      [functionName]: { plugin: 'simpleI18n', required: false },
    },
  }).getGlobalFunctions()[functionName];

  test('__(): restituisce la traduzione inglese quando c\'è', () => {
    expect(buildFallback('__')({ en: 'Hello', it: 'Ciao' })).toBe('Hello');
  });

  test('__(): ricade sulla prima lingua disponibile se manca l\'inglese', () => {
    expect(buildFallback('__')({ it: 'Ciao' })).toBe('Ciao');
    expect(buildFallback('__')({ de: 'Hallo' })).toBe('Hallo');
  });

  test('__(): nessuna traduzione → segnaposto esplicito, non stringa vuota', () => {
    expect(buildFallback('__')({})).toBe('[NO TRANSLATION]');
    expect(buildFallback('__')(undefined)).toBe('[NO TRANSLATION]');
  });

  test('funzione generica: restituisce stringa vuota e non lancia', () => {
    const fallback = buildFallback('formatPrice');
    expect(fallback()).toBe('');
    expect(fallback(1, 2, 3)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initialize(): il ramo dove vive la maggior parte del modulo.
//
// Reso esercitabile dal parametro `pluginsRootPath` del costruttore (default
// invariato): i plugin vengono risolti da una tmpdir con plugin sintetici,
// quindi nessun plugin reale viene caricato e nessun config vivo del progetto
// viene toccato. `essentialPlugins` è lasciato vuoto di proposito: un
// essenziale mancante farebbe `process.exit`, che qui ucciderebbe il worker.
// ─────────────────────────────────────────────────────────────────────────────

let fixtureRoots = [];

afterEach(() => {
  for (const dir of fixtureRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  fixtureRoots = [];
});

/** Crea una root temporanea che farà da cartella `plugins/`. */
const makePluginsRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-pluginsys-'));
  fixtureRoots.push(dir);
  return dir;
};

/** Scrive un plugin sintetico dentro `root`. */
const writePlugin = (root, name, opts = {}) => {
  const {
    active = 1, weight = 0, dependency = {}, nodeModuleDependency = {},
    isInstalled, main, withoutLiveConfig = false,
  } = opts;

  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });

  if (!withoutLiveConfig) {
    const cfg = { schemaVersion: 1, active, weight, dependency, nodeModuleDependency };
    if (isInstalled !== undefined) cfg.isInstalled = isInstalled;
    fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), '// fixture\n' + JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  }

  fs.writeFileSync(
    path.join(dir, 'pluginDescription.json5'),
    '// fixture\n' + JSON.stringify({
      name, version: '1.0.0', description: 'fixture', author: 'test', email: 't@t.t', license: 'ISC',
    }, null, 2) + '\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'main.js'),
    main || 'module.exports = { async loadPlugin() {}, getRouteArray() { return []; } };\n',
    'utf8',
  );

  return dir;
};

/** main.js che annota in un file ogni hook del ciclo di vita invocato. */
const recordingMain = (marker, logFile) =>
  `const fs = require('fs');\n` +
  `const note = (what) => fs.appendFileSync(${JSON.stringify(logFile)}, what + ':${marker}\\n');\n` +
  `module.exports = {\n` +
  `  async loadPlugin() { note('load'); },\n` +
  `  async installPlugin() { note('install'); },\n` +
  `  getRouteArray() { return []; },\n` +
  `};\n`;

describe('pluginSys.initialize() — gli stati dei plugin', () => {
  test('plugin attivo e completo → installed e caricato', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzSemplice');

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzSemplice').state).toBe('installed');
    expect(sys.isPluginActive('zzSemplice')).toBe(true);
    expect(sys.getActivePluginNames()).toContain('zzSemplice');
  });

  test('active: 0 → disabled, e NON viene caricato', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzSpento', { active: 0 });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzSpento').state).toBe('disabled');
    expect(sys.isPluginActive('zzSpento')).toBe(false);
  });

  test('senza pluginConfig.json5 vivo → available (mai preso in carico)', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzMaiPreso', { withoutLiveConfig: true });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzMaiPreso').state).toBe('available');
    expect(sys.isPluginActive('zzMaiPreso')).toBe(false);
  });

  test('dipendenza da un plugin inesistente → incomplete', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzOrfano', { dependency: { zzNonEsiste: '^1.0.0' } });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzOrfano').state).toBe('incomplete');
    expect(sys.isPluginActive('zzOrfano')).toBe(false);
  });

  test('dipendenza npm assente → incomplete', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzNpmMancante', {
      nodeModuleDependency: { 'questo-modulo-npm-non-esiste-davvero': '^1.0.0' },
    });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzNpmMancante').state).toBe('incomplete');
  });
});

describe('pluginSys.initialize() — boot graceful', () => {
  test('un loadPlugin() che lancia NON blocca il boot: gli altri caricano', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzRotto', {
      main: 'module.exports = { async loadPlugin() { throw new Error("boom"); }, getRouteArray() { return []; } };\n',
    });
    writePlugin(root, 'zzSano');

    const sys = new pluginSys({}, root);
    await expect(sys.initialize()).resolves.not.toThrow();

    expect(sys.getPluginState('zzRotto').state).toBe('incomplete');
    expect(sys.getPluginState('zzSano').state).toBe('installed');
    expect(sys.isPluginActive('zzSano')).toBe(true);
  });

  test('il dipendente di un plugin fallito cascata a incomplete', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzBase', {
      main: 'module.exports = { async loadPlugin() { throw new Error("boom"); }, getRouteArray() { return []; } };\n',
    });
    writePlugin(root, 'zzDipende', { dependency: { zzBase: '^1.0.0' } });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(sys.getPluginState('zzBase').state).toBe('incomplete');
    expect(sys.getPluginState('zzDipende').state).toBe('incomplete');
  });

  test('ciclo A → B → A: entrambi incomplete, il boot completa comunque', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzCicloA', { dependency: { zzCicloB: '^1.0.0' } });
    writePlugin(root, 'zzCicloB', { dependency: { zzCicloA: '^1.0.0' } });
    writePlugin(root, 'zzFuoriDalCiclo');

    const sys = new pluginSys({}, root);
    await expect(sys.initialize()).resolves.not.toThrow();

    expect(sys.getPluginState('zzCicloA').state).toBe('incomplete');
    expect(sys.getPluginState('zzCicloB').state).toBe('incomplete');
    // Il ciclo non deve trascinarsi dietro chi non c'entra.
    expect(sys.getPluginState('zzFuoriDalCiclo').state).toBe('installed');
  });
});

describe('pluginSys.initialize() — ordine di caricamento', () => {
  /** Nomi dei plugin nell'ordine in cui loadPlugin() è stato invocato. */
  const loadOrder = (logFile) => fs.readFileSync(logFile, 'utf8').trim().split('\n')
    .filter((r) => r.startsWith('load:')).map((r) => r.split(':')[1]);

  test('weight minore viene caricato prima, anche contro l\'ordine alfabetico', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    // I due criteri si contraddicono di proposito: alfabeticamente zzAlpha
    // precede zzBeta, per weight è l'inverso. Deve vincere il weight.
    writePlugin(root, 'zzAlpha', { weight: 900, main: recordingMain('zzAlpha', logFile) });
    writePlugin(root, 'zzBeta', { weight: 1, main: recordingMain('zzBeta', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(loadOrder(logFile)).toEqual(['zzBeta', 'zzAlpha']);
  });

  test('weight negativo precede lo zero (è il caso reale di simpleI18n a -10)', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    writePlugin(root, 'zzAnticipato', { weight: -10, main: recordingMain('zzAnticipato', logFile) });
    writePlugin(root, 'zzNormale', { weight: 0, main: recordingMain('zzNormale', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(loadOrder(logFile)).toEqual(['zzAnticipato', 'zzNormale']);
  });

  test('a parità di weight l\'ordine è alfabetico', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    // Scritti in ordine NON alfabetico: il tiebreak non deve dipendere né
    // dall'ordine di creazione né da quello che restituisce readdirSync.
    writePlugin(root, 'zzGamma', { weight: 5, main: recordingMain('zzGamma', logFile) });
    writePlugin(root, 'zzAlfa', { weight: 5, main: recordingMain('zzAlfa', logFile) });
    writePlugin(root, 'zzBeta', { weight: 5, main: recordingMain('zzBeta', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(loadOrder(logFile)).toEqual(['zzAlfa', 'zzBeta', 'zzGamma']);
  });

  test('weight assente equivale a 0 (retrocompatibilità)', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    const dir = path.join(root, 'zzSenzaPeso');
    writePlugin(root, 'zzSenzaPeso', { main: recordingMain('zzSenzaPeso', logFile) });
    // Rimuovo il campo weight dal config vivo.
    const raw = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), raw.replace(/\s*"weight": \d+,/, ''), 'utf8');

    writePlugin(root, 'zzDopo', { weight: 5, main: recordingMain('zzDopo', logFile) });
    writePlugin(root, 'zzPrima', { weight: -5, main: recordingMain('zzPrima', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(loadOrder(logFile)).toEqual(['zzPrima', 'zzSenzaPeso', 'zzDopo']);
  });

  test('weight non numerico → trattato come 0 e segnalato', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    const dir = path.join(root, 'zzPesoStorto');
    writePlugin(root, 'zzPesoStorto', { main: recordingMain('zzPesoStorto', logFile) });
    const raw = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), raw.replace(/"weight": \d+/, '"weight": "alto"'), 'utf8');

    writePlugin(root, 'zzDopo', { weight: 5, main: recordingMain('zzDopo', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    // Un config sbagliato non deve far scivolare il plugin in silenzio.
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).toMatch(/zzPesoStorto/);
    expect(logged).toMatch(/weight non numerico/);
    expect(loadOrder(logFile)).toEqual(['zzPesoStorto', 'zzDopo']);
  });

  test('una dipendenza è caricata prima del suo dipendente, anche con weight contrario', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ordine.log');
    // Il dipendente ha weight MINORE: senza risoluzione delle dipendenze
    // andrebbe per primo, ed è esattamente ciò che non deve accadere.
    writePlugin(root, 'zzConsumer', { weight: 1, dependency: { zzProvider: '^1.0.0' }, main: recordingMain('zzConsumer', logFile) });
    writePlugin(root, 'zzProvider', { weight: 500, main: recordingMain('zzProvider', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    const loaded = fs.readFileSync(logFile, 'utf8').trim().split('\n')
      .filter((r) => r.startsWith('load:')).map((r) => r.split(':')[1]);
    expect(loaded).toEqual(['zzProvider', 'zzConsumer']);
  });
});

describe('pluginSys.initialize() — persistenza di isInstalled', () => {
  test('isInstalled assente → persistito a 1 nel config vivo', async () => {
    const root = makePluginsRoot();
    const dir = writePlugin(root, 'zzFresco'); // nessun isInstalled

    const sys = new pluginSys({}, root);
    await sys.initialize();

    expect(loadJson5(path.join(dir, 'pluginConfig.json5')).isInstalled).toBe(1);
  });

  test('installPlugin() gira SOLO alla transizione non-1 → 1', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ciclo.log');
    writePlugin(root, 'zzGiaInstallato', { isInstalled: 1, main: recordingMain('zzGiaInstallato', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    const events = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    expect(events).toContain('load:zzGiaInstallato');
    // Era già installato: la transizione non è stata attraversata.
    expect(events).not.toContain('install:zzGiaInstallato');
  });

  test('un plugin fresco attraversa la transizione e installPlugin() gira', async () => {
    const root = makePluginsRoot();
    const logFile = path.join(root, 'ciclo.log');
    writePlugin(root, 'zzDaInstallare', { isInstalled: 0, main: recordingMain('zzDaInstallare', logFile) });

    const sys = new pluginSys({}, root);
    await sys.initialize();

    const events = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    expect(events).toContain('install:zzDaInstallare');
    expect(events).toContain('load:zzDaInstallare');
  });
});

describe('pluginSys.loadRoutes() — i metodi non gestiti non spariscono più in silenzio', () => {
  /** Router finto con i cinque metodi che pluginSys sa smistare. */
  const makeRouterMock = () => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn(), all: jest.fn(),
  });

  /** main.js che dichiara una sola rotta con il metodo indicato. */
  const mainWithRoute = (method) =>
    `module.exports = {\n` +
    `  async loadPlugin() {},\n` +
    `  getRouteArray() {\n` +
    `    return [{ method: ${JSON.stringify(method)}, path: '/prova',\n` +
    `      access: { requiresAuth: false, allowedRoles: [] },\n` +
    `      handler: async (ctx) => { ctx.body = 'ok'; } }];\n` +
    `  },\n` +
    `};\n`;

  test('baseline: una rotta GET viene registrata sul router', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzRottaBuona', { main: mainWithRoute('GET') });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    expect(router.get).toHaveBeenCalledTimes(1);
    expect(router.get.mock.calls[0][0]).toBe('/api/zzRottaBuona/prova');
  });

  test('un metodo non gestito NON viene registrato, ma ora viene segnalato', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzRottaPatch', { main: mainWithRoute('PATCH') });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    // Il comportamento non cambia — la rotta resta non registrata, perché il
    // router non la saprebbe smistare. Cambia che ora lo si viene a sapere.
    for (const method of Object.keys(router)) {
      expect(router[method]).not.toHaveBeenCalled();
    }

    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).toMatch(/Rotta IGNORATA/);
    expect(logged).toMatch(/zzRottaPatch/);   // quale plugin
    expect(logged).toMatch(/PATCH/);          // quale metodo
    expect(logged).toMatch(/\/api\/zzRottaPatch\/prova/); // quale path
  });

  test('anche il method minuscolo — la forma più insidiosa — viene segnalato', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzMinuscolo', { main: mainWithRoute('get') });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    expect(router.get).not.toHaveBeenCalled();
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).toMatch(/Rotta IGNORATA/);
    expect(logged).toMatch(/zzMinuscolo/);
  });
});

describe('pluginSys.loadRoutes() — handler mancante o non invocabile', () => {
  const makeRouterMock = () => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), del: jest.fn(), all: jest.fn(),
  });

  test('`func` invece di `handler`: non registrata e segnalata (prima era un 500)', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzConFunc', {
      main:
        `module.exports = {\n` +
        `  async loadPlugin() {},\n` +
        `  getRouteArray() {\n` +
        `    return [{ method: 'GET', path: '/prova',\n` +
        `      access: { requiresAuth: false, allowedRoles: [] },\n` +
        `      func: async (ctx) => { ctx.body = 'ok'; } }];\n` +
        `  },\n};\n`,
    });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    // Misurato prima della correzione: la rotta VENIVA registrata con un handler
    // che avvolgeva undefined, e falliva alla prima richiesta con
    // «TypeError: originalHandler is not a function».
    expect(router.get).not.toHaveBeenCalled();

    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).toMatch(/Rotta IGNORATA/);
    expect(logged).toMatch(/zzConFunc/);
    expect(logged).toMatch(/handler mancante o non invocabile/);
    // Il messaggio deve nominare la causa vera, non solo il sintomo.
    expect(logged).toMatch(/"func"/);
  });

  test('handler che non è una funzione → non registrata e segnalata', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzHandlerStringa', {
      main:
        `module.exports = {\n` +
        `  async loadPlugin() {},\n` +
        `  getRouteArray() {\n` +
        `    return [{ method: 'GET', path: '/prova',\n` +
        `      access: { requiresAuth: false, allowedRoles: [] },\n` +
        `      handler: 'non una funzione' }];\n` +
        `  },\n};\n`,
    });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    expect(router.get).not.toHaveBeenCalled();
    const logged = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(logged).toMatch(/handler mancante o non invocabile/);
  });

  test('una rotta rotta non impedisce alle altre dello stesso plugin di registrarsi', async () => {
    const root = makePluginsRoot();
    writePlugin(root, 'zzMisto', {
      main:
        `module.exports = {\n` +
        `  async loadPlugin() {},\n` +
        `  getRouteArray() {\n` +
        `    return [\n` +
        `      { method: 'GET', path: '/rotta', access: { requiresAuth: false, allowedRoles: [] }, func: async () => {} },\n` +
        `      { method: 'GET', path: '/sana',  access: { requiresAuth: false, allowedRoles: [] }, handler: async (ctx) => { ctx.body = 'ok'; } },\n` +
        `    ];\n` +
        `  },\n};\n`,
    });

    const sys = new pluginSys({}, root);
    await sys.initialize();
    const router = makeRouterMock();
    sys.loadRoutes(router, '/api');

    expect(router.get).toHaveBeenCalledTimes(1);
    expect(router.get.mock.calls[0][0]).toBe('/api/zzMisto/sana');
  });
});
