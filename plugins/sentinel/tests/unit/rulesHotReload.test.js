/**
 * rulesHotReload.test.js
 *
 * Come il motore si accorge che il file delle regole è cambiato.
 *
 * ─── IL DIFETTO CHE QUESTI TEST PRESIDIANO ────────────────────────────────────
 * In `debugMode` le regole si rileggevano a OGNI richiesta:
 * `isDebugMode ? loadRules() : compiledRules`. L'intento era giusto — una
 * modifica al file deve avere effetto senza riavviare — ma `loadRules()` non è
 * una rilettura: è lettura del file, validazione completa, ricompilazione di
 * tutte le regex, un `existsSync` per ogni decoy, e l'emissione di ogni avviso
 * di validazione sul log.
 *
 * Il gate sta PRIMA del router, quindi tutto questo girava anche per ogni
 * immagine e ogni foglio di stile. E con un solo avviso in sospeso — cioè la
 * condizione normale di chi sta scrivendo regole, l'unico motivo per cui si
 * accende il debug — il log prendeva una riga per richiesta.
 *
 * I due test che contano sono quindi in tensione fra loro, ed è voluto: uno
 * pretende che la modifica si veda subito, l'altro che senza modifiche non si
 * legga niente. Una correzione che rompe l'equilibrio fallisce da una parte o
 * dall'altra.
 *
 * ─── PERCHE UN ALBERO TEMPORANEO ──────────────────────────────────────────────
 * `loadPlugin` risolve `ital8Config.json5` da `<cartella-plugin>/../..`, e
 * `debugMode` sta lì. Montare il plugin su un albero finto è l'unico modo di
 * provare il comportamento in debug senza toccare la configurazione vera del
 * repository — che gli altri test leggono.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sentinel = require('../../main');

let root;          // radice finta del CMS
let pluginFolder;  // <root>/plugins/sentinel
let rulesPath;

/** Regole minime: una regola per il percorso indicato. */
function rulesFor(ruleName, matchPath) {
  return `// This file follows the JSON5 standard\n{
  schemaVersion: 1,
  rules: [
    {
      name: "${ruleName}",
      enabled: true,
      category: "test",
      action: "monitor",
      match: { path: ["${matchPath}"] },
    },
  ],
}\n`;
}

/** Contesto Koa sintetico, quanto basta a `evaluate`. */
function ctxFor(reqPath) {
  return {
    path: reqPath,
    method: 'GET',
    querystring: '',
    headers: {},
    session: null,
    ip: '203.0.113.7',
    get: () => '',
    req: { rawHeaders: [], httpVersion: '1.1', headers: {} },
  };
}

/**
 * Riscrive il file delle regole spostandone in avanti il timbro di modifica.
 *
 * Su un filesystem con granularità grossolana due scritture nello stesso
 * millisecondo possono avere lo stesso `mtime`: il test misurerebbe la
 * risoluzione dell'orologio invece del comportamento del motore.
 */
function rewriteRules(content) {
  fs.writeFileSync(rulesPath, content, 'utf8');
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(rulesPath, future, future);
}

function mountPlugin({ debugMode }) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-reload-'));
  pluginFolder = path.join(root, 'plugins', 'sentinel');
  fs.mkdirSync(pluginFolder, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'ital8Config.json5'),
    `// This file follows the JSON5 standard\n{ debugMode: ${debugMode} }\n`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(pluginFolder, 'pluginConfig.json5'),
    `// This file follows the JSON5 standard\n{
  schemaVersion: 5,
  active: 1,
  custom: {
    enabled: true,
    mode: "monitor",
    dataPath: "./data",
    sweepIntervalSeconds: 0,
    census: { saveIntervalSeconds: 0 },
    log: { flushIntervalSeconds: 0 },
    hitCounter: { flushIntervalSeconds: 0 },
  },
}\n`,
    'utf8',
  );

  rulesPath = path.join(pluginFolder, 'sentinelRules.json5');
  rewriteRules(rulesFor('prima-regola', '/uno'));

  return sentinel.loadPlugin({}, pluginFolder);
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('debugMode — la modifica si vede senza riavviare', () => {
  test('una regola aggiunta al file ha effetto sulla richiesta successiva', async () => {
    await mountPlugin({ debugMode: 1 });
    const engine = sentinel.getObjectToShareToOthersPlugin();

    expect(engine.evaluate(ctxFor('/uno')).ruleName).toBe('prima-regola');
    expect(engine.evaluate(ctxFor('/due'))).toBeNull();

    rewriteRules(rulesFor('seconda-regola', '/due'));

    expect(engine.evaluate(ctxFor('/due')).ruleName).toBe('seconda-regola');
  });

  test('senza modifiche al file non si legge nulla dal disco', async () => {
    await mountPlugin({ debugMode: 1 });
    const engine = sentinel.getObjectToShareToOthersPlugin();
    engine.evaluate(ctxFor('/uno'));   // prima valutazione: allinea il timbro

    const readSpy = jest.spyOn(fs, 'readFileSync');
    for (let i = 0; i < 50; i++) engine.evaluate(ctxFor(`/asset-${i}.css`));
    const readsOfRules = readSpy.mock.calls.filter((c) => String(c[0]).endsWith('sentinelRules.json5'));
    readSpy.mockRestore();

    // Prima erano 50: una rilettura e una rivalidazione integrale per ogni
    // richiesta, comprese quelle per gli asset.
    expect(readsOfRules).toHaveLength(0);
  });

  test('un file cancellato non toglie di mezzo le regole già in vigore', async () => {
    // Fail-soft come tutto il percorso caldo: un problema sul file non deve
    // spegnere il filtro che sta già funzionando.
    await mountPlugin({ debugMode: 1 });
    const engine = sentinel.getObjectToShareToOthersPlugin();
    engine.evaluate(ctxFor('/uno'));

    fs.unlinkSync(rulesPath);

    expect(engine.evaluate(ctxFor('/uno')).ruleName).toBe('prima-regola');
  });
});

describe('senza debugMode — il file non si tocca mai nel percorso caldo', () => {
  test('una modifica al file NON ha effetto finché non si ricarica esplicitamente', async () => {
    await mountPlugin({ debugMode: 0 });
    const engine = sentinel.getObjectToShareToOthersPlugin();

    rewriteRules(rulesFor('seconda-regola', '/due'));

    expect(engine.evaluate(ctxFor('/due'))).toBeNull();

    // La ricarica a caldo resta la strada esplicita, ed è quella che il twin
    // admin usa dopo ogni salvataggio.
    engine.reloadRules();
    expect(engine.evaluate(ctxFor('/due')).ruleName).toBe('seconda-regola');
  });

  test('nessuna lettura del file delle regole durante le valutazioni', async () => {
    await mountPlugin({ debugMode: 0 });
    const engine = sentinel.getObjectToShareToOthersPlugin();

    const readSpy = jest.spyOn(fs, 'readFileSync');
    const statSpy = jest.spyOn(fs, 'statSync');
    for (let i = 0; i < 20; i++) engine.evaluate(ctxFor('/uno'));
    const reads = readSpy.mock.calls.filter((c) => String(c[0]).endsWith('sentinelRules.json5'));
    const stats = statSpy.mock.calls.filter((c) => String(c[0]).endsWith('sentinelRules.json5'));
    readSpy.mockRestore();
    statSpy.mockRestore();

    expect(reads).toHaveLength(0);
    // Fuori dal debug non si paga nemmeno la `stat`.
    expect(stats).toHaveLength(0);
  });
});
