/**
 * Route di adminSentinel. L'oggetto condiviso di `sentinel` e la sua data dir
 * sono simulati: qui si verifica il contratto delle rotte, non la lettura dei
 * file (coperta da sentinelDataReader.test.js).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPluginSysMock, createCtxMock, runRoute, validateRoute } = require('../../../../core/testHelpers');
const plugin = require('../../main.js');
const reader = require('../../lib/sentinelDataReader');

let dataDir;
let serviceFolder;
let rulesFilePath;
let ownFolder;

const mockSentinel = {
  getStats: () => ({
    enabled: true,
    mode: 'monitor',
    gateState: 'running',
    ruleCount: 3,
    pendingLogEvents: 0,
    fingerprints: { tracked: 4, evictions: 0, ipMode: 'count' },
    outcomes: { tracked: 2, evictions: 0 },
  }),
  getRuleNames: () => ['php-probe', 'mai-scattata'],
  getRulesSource: () => ([
    { name: 'php-probe', action: 'monitor', match: { extension: ['php'] } },
  ]),
  setRuleFields: jest.fn((ruleName, rule) => (rule.action === 'inventata'
    ? { changed: false, valid: false, errors: ['azione sconosciuta'], warnings: [] }
    : { changed: true, valid: true, errors: [], warnings: [] })),
  flushNow: jest.fn(),

  // ── Superficie di SCRITTURA del service, simulata quanto basta ──
  // Il validatore finto accetta ogni file che abbia `rules` come array: la
  // validazione vera è del motore ed è provata nei test di `sentinel`. Qui
  // interessa il contratto delle rotte attorno a essa — cosa viene scritto,
  // quando, e cosa succede quando la validazione dice di no.
  getRulesFilePath: jest.fn(() => rulesFilePath),
  validateRules: jest.fn((data) => (Array.isArray(data && data.rules)
    ? { valid: true, errors: [], warnings: [], rules: data.rules }
    : { valid: false, errors: ['la chiave "rules" deve essere un array'], warnings: [], rules: [] })),
  reloadRules: jest.fn(() => 2),
  setRuleAction: jest.fn((ruleName, action) => (action === 'inventata'
    ? (() => { throw new Error(`azione non valida: ${action}`); })()
    : { changed: true, previous: 'monitor' })),
  setMode: jest.fn(async (mode) => (mode === 'monitor' || mode === 'enforce'
    ? { changed: true, previous: 'monitor' }
    : (() => { throw new Error(`modalità non valida: ${mode}`); })())),
  testRequest: jest.fn((spec) => ({ subject: { path: spec.path }, matched: null, evaluated: [] })),
  getRules: jest.fn(() => ([
    { name: 'php-probe', action: 'monitor', category: 'cms-probe', enabled: true },
    { name: 'mai-scattata', action: 'monitor', category: 'altro', enabled: true },
  ])),
};

/** Finge la cartella del plugin di servizio, con il suo config e la data dir. */
function makeServiceFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-svc-'));
  fs.writeFileSync(path.join(folder, 'pluginConfig.json5'),
    '// test\n{ "custom": { "dataPath": "./data" } }\n', 'utf8');
  const dir = path.join(folder, 'data');
  fs.mkdirSync(dir);
  return { folder, dir };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.withService]      - il plugin `sentinel` è registrato
 * @param {boolean} [opts.withSharedObject] - ed espone il proprio oggetto condiviso
 *
 * I due sono separabili perché nella realtà si separano: con
 * `sentinel.custom.enabled: false` il plugin resta registrato — quindi la data
 * dir si risolve e i dati storici si leggono — ma `getObjectToShareToOthersPlugin`
 * restituisce `null`. È lo stato in cui le rotte davano due risposte diverse
 * alla stessa domanda.
 */
function attach({ withService = true, withSharedObject = true } = {}) {
  const condiviso = withService && withSharedObject;
  const pluginSys = createPluginSysMock({
    sharedObjects: condiviso ? { sentinel: mockSentinel } : {},
    plugins: withService ? { sentinel: { pathPluginFolder: serviceFolder } } : {},
  });
  // getPlugin non è fra i metodi del mock condiviso: lo si aggiunge qui perché
  // adminSentinel lo usa per risolvere la data dir del service.
  pluginSys.getPlugin = (name) => (withService && name === 'sentinel'
    ? { pathPluginFolder: serviceFolder } : null);
  // La cartella del plugin è una temporanea, non `__dirname`: il salvataggio
  // dall'editor raw crea i backup DENTRO la cartella del plugin, e passando
  // quella dei test la suite lasciava un `tests/unit/backups/` nel repo a ogni
  // esecuzione. Un test che sporca l'albero dei sorgenti è un test che prima o
  // poi viene committato.
  return plugin.loadPlugin(pluginSys, ownFolder).then(() => pluginSys);
}

const routeByPath = (p) => plugin.getRouteArray().find((r) => r.path === p);

beforeEach(() => {
  const made = makeServiceFolder();
  serviceFolder = made.folder;
  dataDir = made.dir;
  ownFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'adminSentinel-own-'));
  rulesFilePath = path.join(serviceFolder, 'sentinelRules.json5');
  fs.writeFileSync(rulesFilePath, '// regole\n{ rules: [] }\n', 'utf8');
  // Cache dei riepiloghi e freno del flush sono stato di PROCESSO: senza
  // azzerarli, un test leggerebbe il risultato di quello prima.
  plugin._internals.clearSummaryCache();
  plugin._internals.resetFlushThrottle();
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(serviceFolder, { recursive: true, force: true });
  fs.rmSync(ownFolder, { recursive: true, force: true });
});

describe('contratto delle rotte', () => {
  const routes = plugin.getRouteArray();

  test('ogni rotta rispetta il contratto di pluginSys', () => {
    for (const route of routes) {
      expect(validateRoute(route)).toEqual([]);
    }
  });

  // La configurazione del filtro è sensibile: una rotta di lettura lasciata
  // pubblica esporrebbe la mappa del traffico e le regole a chiunque.
  test('ogni rotta richiede autenticazione e ruolo root/admin', () => {
    for (const route of routes) {
      expect(route.access.requiresAuth).toBe(true);
      expect(route.access.allowedRoles).toEqual([0, 1]);
    }
  });

  test('espone gli endpoint attesi dalla Vista Dati', () => {
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual([
      '/events', '/fingerprints', '/flush', '/mode',
      '/rules', '/rules/action', '/rules/fields', '/rules/raw', '/rules/save', '/rules/source',
      '/rules/test', '/rules/validate',
      '/scanners', '/status', '/summary',
    ]);
  });
});

describe('service assente o disattivato', () => {
  beforeEach(async () => { await attach({ withService: false }); });

  test.each(['/status', '/summary', '/rules', '/fingerprints', '/scanners', '/events'])(
    '%s risponde enabled:false invece di rompersi', async (p) => {
      const ctx = createCtxMock();
      await runRoute(routeByPath(p), ctx);
      expect(ctx.body.enabled).toBe(false);
    });

  test('/flush non lancia se non c è nessuno da svuotare', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    await expect(runRoute(routeByPath('/flush'), ctx)).resolves.toBeDefined();
    expect(ctx.body.enabled).toBe(false);
  });
});

// `enabled` significava due cose diverse a seconda della rotta: `/status` lo
// ricavava dall'oggetto condiviso, le rotte di lettura dalla sola esistenza
// della data dir. Con il filtro spento ma il plugin registrato, la stessa
// installazione rispondeva sia «attivo» sia «non attivo».
describe('service registrato ma disattivato', () => {
  beforeEach(async () => {
    await attach({ withSharedObject: false });
    fs.writeFileSync(path.join(dataDir, 'sentinel-2026-08-08.jsonl'),
      JSON.stringify({
        timestamp: new Date().toISOString(), path: '/x.php', ruleName: 'php-probe',
        category: 'cms-probe', ip: '1.2.3.4', fp: 'aaa', enforced: false,
      }) + '\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'ruleHits.json5'),
      '// t\n' + JSON.stringify({ rules: { 'php-probe': { hits: 9, authenticatedHits: 0 } } }) + '\n', 'utf8');
  });

  test.each(['/status', '/summary', '/rules', '/fingerprints', '/scanners', '/events'])(
    '%s dice enabled:false, come /status', async (p) => {
      const ctx = createCtxMock();
      await runRoute(routeByPath(p), ctx);
      expect(ctx.body.enabled).toBe(false);
    });

  // I dati su disco non smettono di esistere quando il filtro viene spento, e
  // nasconderli impedirebbe di guardare cosa era successo prima di spegnerlo.
  test('i dati storici restano leggibili', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/events'), ctx);
    expect(ctx.body.events).toHaveLength(1);
  });

  // Senza definizioni non si sa quali regole esistano: marcarle «rimossa»
  // sarebbe un verdetto che nessuno ha emesso.
  test('/rules non dichiara «rimosse» le regole di cui non sa nulla', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/rules'), ctx);

    expect(ctx.body.definitionsAvailable).toBe(false);
    expect(ctx.body.rules).toHaveLength(1);
    expect(ctx.body.rules[0].ruleName).toBe('php-probe');
    expect(ctx.body.rules[0].defined).toBeNull();
  });
});

describe('/status', () => {
  beforeEach(async () => { await attach(); });

  // Le due condizioni sono indipendenti, e mostrarne una sola è la trappola
  // diagnostica che questa feature esiste per evitare.
  test('mode enforce + gate running → sta davvero bloccando', async () => {
    mockSentinel.getStats = () => ({ mode: 'enforce', gateState: 'running' });
    const ctx = createCtxMock();
    await runRoute(routeByPath('/status'), ctx);
    expect(ctx.body.effectivelyEnforcing).toBe(true);
  });

  test('mode enforce + gate monitor → NON sta bloccando', async () => {
    mockSentinel.getStats = () => ({ mode: 'enforce', gateState: 'monitor' });
    const ctx = createCtxMock();
    await runRoute(routeByPath('/status'), ctx);
    expect(ctx.body.effectivelyEnforcing).toBe(false);
  });

  test('mode monitor + gate running → NON sta bloccando', async () => {
    mockSentinel.getStats = () => ({ mode: 'monitor', gateState: 'running' });
    const ctx = createCtxMock();
    await runRoute(routeByPath('/status'), ctx);
    expect(ctx.body.effectivelyEnforcing).toBe(false);
  });

  test('espone la data dir risolta dal config del service', async () => {
    mockSentinel.getStats = () => ({ mode: 'monitor', gateState: 'running' });
    const ctx = createCtxMock();
    await runRoute(routeByPath('/status'), ctx);
    expect(ctx.body.dataDir).toBe(dataDir);
  });
});

describe('lettura dei dati', () => {
  beforeEach(async () => {
    await attach();
    fs.writeFileSync(path.join(dataDir, 'sentinel-2026-08-08.jsonl'),
      JSON.stringify({
        timestamp: '2026-08-08T10:00:00.000Z', path: '/x.php', ruleName: 'php-probe',
        category: 'cms-probe', ip: '1.2.3.4', fp: 'aaa', enforced: false,
        fpClass: { coherent: false }, isAuthenticated: false, isBot: false,
      }) + '\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'ruleHits.json5'),
      '// t\n' + JSON.stringify({ rules: { 'php-probe': { hits: 9, authenticatedHits: 0 } } }) + '\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'fingerprintCensus.json5'),
      '// t\n' + JSON.stringify({ ipMode: 'count', evictions: 0, fingerprints: { aaa: { count: 20, matchedCount: 5, class: { family: 'curl' } } } }) + '\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'outcomeCensus.json5'),
      '// t\n' + JSON.stringify({ byClient: { '9.9.9.9': { total: 40, distinctPaths: 38, byStatus: { 404: 38 } } } }) + '\n', 'utf8');
  });

  test('/summary aggrega gli eventi della finestra', async () => {
    const ctx = createCtxMock({ query: { days: '365' } });
    await runRoute(routeByPath('/summary'), ctx);
    expect(ctx.body.summary.total).toBe(1);
    expect(ctx.body.summary.incoherent).toBe(1);
    expect(ctx.body.unclassified.unclassifiedPercent).toBe(75);
  });

  test('/summary limita la finestra richiesta a un anno', async () => {
    const ctx = createCtxMock({ query: { days: '99999' } });
    await runRoute(routeByPath('/summary'), ctx);
    expect(ctx.body.days).toBe(365);
  });

  test('/rules mostra anche le regole che non hanno mai sparato', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/rules'), ctx);
    const names = ctx.body.rules.map((r) => r.ruleName);
    expect(names).toContain('php-probe');
    expect(names).toContain('mai-scattata');
    expect(ctx.body.rules.find((r) => r.ruleName === 'mai-scattata').neverFired).toBe(true);
  });

  test('/fingerprints riporta la modalità IP del censimento', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/fingerprints'), ctx);
    expect(ctx.body.ipMode).toBe('count');
    expect(ctx.body.fingerprints[0].fp).toBe('aaa');
  });

  test('/scanners applica la soglia richiesta', async () => {
    const sopra = createCtxMock({ query: { minPaths: '20' } });
    await runRoute(routeByPath('/scanners'), sopra);
    expect(sopra.body.scanners).toHaveLength(1);

    const sotto = createCtxMock({ query: { minPaths: '100' } });
    await runRoute(routeByPath('/scanners'), sotto);
    expect(sotto.body.scanners).toHaveLength(0);
  });

  // `|| default` scartava lo zero, che è la richiesta più utile di tutte:
  // «mostrami tutti i client», cioè come si sceglie una soglia guardando la
  // distribuzione invece di indovinarla.
  test('/scanners con soglia 0 mostra tutti i client, invece di ricadere sul default', async () => {
    const ctx = createCtxMock({ query: { minPaths: '0' } });
    await runRoute(routeByPath('/scanners'), ctx);

    expect(ctx.body.threshold).toBe(0);
    expect(ctx.body.scanners).toHaveLength(1);
  });

  test('/scanners con una soglia illeggibile ricade sul default', async () => {
    const ctx = createCtxMock({ query: { minPaths: 'molti' } });
    await runRoute(routeByPath('/scanners'), ctx);
    expect(ctx.body.threshold).toBe(20);
  });

  test('/events filtra per regola', async () => {
    const match = createCtxMock({ query: { ruleName: 'php-probe' } });
    await runRoute(routeByPath('/events'), match);
    expect(match.body.events).toHaveLength(1);

    const noMatch = createCtxMock({ query: { ruleName: 'altra' } });
    await runRoute(routeByPath('/events'), noMatch);
    expect(noMatch.body.events).toHaveLength(0);
  });

  // Il service tiene in memoria fino a un minuto di censimento: senza questo la
  // dashboard mostrerebbe dati vecchi senza dirlo.
  test('/flush chiede al service di scrivere su disco', async () => {
    mockSentinel.flushNow.mockClear();
    const ctx = createCtxMock({ method: 'POST' });
    await runRoute(routeByPath('/flush'), ctx);
    expect(mockSentinel.flushNow).toHaveBeenCalled();
    expect(ctx.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VISTA C — form strutturato
// ─────────────────────────────────────────────────────────────────────────────

// Il riepilogo si ricava da TUTTO il log della finestra, e la finestra arriva a
// un anno: ricalcolarlo a ogni auto-aggiornamento significa rileggere centinaia
// di megabyte ogni quindici secondi per ottenere quasi sempre lo stesso numero.
// Peggio, la lettura è sincrona: finché gira, il sito intero è fermo.
describe('cache del riepilogo', () => {
  let scanSpy;

  beforeEach(async () => {
    await attach();
    fs.writeFileSync(path.join(dataDir, 'sentinel-2026-08-08.jsonl'),
      JSON.stringify({
        timestamp: new Date().toISOString(), path: '/x.php', ruleName: 'php-probe',
        category: 'cms-probe', ip: '1.2.3.4', fp: 'aaa', enforced: false,
      }) + '\n', 'utf8');
    scanSpy = jest.spyOn(reader, 'forEachEventSince');
  });

  afterEach(() => {
    scanSpy.mockRestore();
  });

  test('dichiara quando i numeri sono stati calcolati', async () => {
    const ctx = createCtxMock({ query: { days: '7' } });
    await runRoute(routeByPath('/summary'), ctx);
    expect(Number.isNaN(Date.parse(ctx.body.computedAt))).toBe(false);
  });

  // A file immutati la risposta in cache non è vecchia: è esattamente quella che
  // il ricalcolo produrrebbe. Riusarla non è una scorciatoia.
  test('a file immutati non rilegge il log', async () => {
    const primo = createCtxMock({ query: { days: '7' } });
    await runRoute(routeByPath('/summary'), primo);
    const secondo = createCtxMock({ query: { days: '7' } });
    await runRoute(routeByPath('/summary'), secondo);

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(secondo.body.summary).toEqual(primo.body.summary);
    expect(secondo.body.computedAt).toBe(primo.body.computedAt);
  });

  test('finestre diverse non si scambiano il riepilogo', async () => {
    await runRoute(routeByPath('/summary'), createCtxMock({ query: { days: '7' } }));
    await runRoute(routeByPath('/summary'), createCtxMock({ query: { days: '30' } }));
    expect(scanSpy).toHaveBeenCalledTimes(2);
  });

  // `days` è un parametro di query e vale 1-365: chi chiama l'API direttamente
  // può fabbricare una voce per ogni valore. La cache resta una mappa di lavoro.
  test('molte finestre diverse non fanno crescere la cache senza limite', async () => {
    for (let giorni = 1; giorni <= 40; giorni++) {
      await runRoute(routeByPath('/summary'), createCtxMock({ query: { days: String(giorni) } }));
    }
    expect(plugin._internals.summaryCacheSize())
      .toBeLessThanOrEqual(plugin._internals.MAX_CACHED_WINDOWS);

    // Lo sfratto non deve costare la correttezza: la finestra più recente è
    // ancora in cache e risponde con i numeri giusti.
    const ultimo = createCtxMock({ query: { days: '40' } });
    await runRoute(routeByPath('/summary'), ultimo);
    expect(ultimo.body.summary.total).toBe(1);
    expect(scanSpy).toHaveBeenCalledTimes(40);
  });

  test('quando il log cresce e la cache è disattivata, ricalcola', async () => {
    const precedente = plugin._internals.setSummaryCacheSeconds(0);
    try {
      const primo = createCtxMock({ query: { days: '7' } });
      await runRoute(routeByPath('/summary'), primo);

      fs.appendFileSync(path.join(dataDir, 'sentinel-2026-08-08.jsonl'),
        JSON.stringify({
          timestamp: new Date().toISOString(), path: '/y.php', ruleName: 'php-probe',
          category: 'cms-probe', ip: '5.6.7.8', fp: 'bbb', enforced: true,
        }) + '\n', 'utf8');

      const secondo = createCtxMock({ query: { days: '7' } });
      await runRoute(routeByPath('/summary'), secondo);

      expect(scanSpy).toHaveBeenCalledTimes(2);
      expect(secondo.body.summary.total).toBe(2);
    } finally {
      plugin._internals.setSummaryCacheSeconds(precedente);
    }
  });

  // Il difetto originale peggiorava con le schede aperte, quindi la deduplica
  // va chiusa qui e non nel browser: tre schede fanno un calcolo, non tre.
  test('richieste simultanee producono un solo calcolo', async () => {
    const precedente = plugin._internals.setSummaryCacheSeconds(0);
    try {
      const contesti = [createCtxMock({ query: { days: '7' } }),
        createCtxMock({ query: { days: '7' } }),
        createCtxMock({ query: { days: '7' } })];
      await Promise.all(contesti.map((ctx) => runRoute(routeByPath('/summary'), ctx)));

      expect(scanSpy).toHaveBeenCalledTimes(1);
      for (const ctx of contesti) expect(ctx.body.summary.total).toBe(1);
    } finally {
      plugin._internals.setSummaryCacheSeconds(precedente);
    }
  });
});

describe('/rules/source', () => {
  beforeEach(async () => { await attach(); });

  test('restituisce le regole come stanno sul file, non compilate', () => {
    // Un form popolato dalla versione compilata riscriverebbe `["php"]` dove
    // l'amministratore aveva scritto `"php"`.
    const ctx = createCtxMock();
    return runRoute(routeByPath('/rules/source'), ctx).then(() => {
      expect(ctx.body.enabled).toBe(true);
      expect(ctx.body.rules[0].match).toEqual({ extension: ['php'] });
    });
  });

  test('è una GET: è una lettura', () => {
    expect(routeByPath('/rules/source').method).toBe('GET');
  });
});

describe('/rules/fields', () => {
  beforeEach(async () => { await attach(); mockSentinel.setRuleFields.mockClear(); });

  test('delega la scrittura al service', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { ruleName: 'php-probe', rule: { name: 'php-probe', action: 'block', match: { extension: ['php'] } } };

    await runRoute(routeByPath('/rules/fields'), ctx);

    expect(mockSentinel.setRuleFields).toHaveBeenCalledWith('php-probe', expect.objectContaining({ action: 'block' }));
    expect(ctx.body.ok).toBe(true);
  });

  test('una regola invalida torna 400 con gli errori del validatore del motore', async () => {
    // Riusare il validatore del service è la sola garanzia che ciò che la GUI
    // accetta e ciò che il filtro accetta restino la stessa cosa.
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { ruleName: 'php-probe', rule: { name: 'php-probe', action: 'inventata', match: {} } };

    await runRoute(routeByPath('/rules/fields'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.ok).toBe(false);
    expect(ctx.body.errors).toContain('azione sconosciuta');
  });

  test.each([
    [{}],
    [{ ruleName: 'php-probe' }],
    [{ rule: { name: 'x' } }],
    [{ ruleName: '  ', rule: {} }],
  ])('richiesta incompleta (%j) → 400 senza chiamare il service', async (body) => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = body;

    await runRoute(routeByPath('/rules/fields'), ctx);

    expect(ctx.status).toBe(400);
    expect(mockSentinel.setRuleFields).not.toHaveBeenCalled();
  });

  test('un errore del service non diventa un 500', async () => {
    // L'editor verifica la propria modifica prima di scrivere: se arriva
    // un'eccezione, il file non è stato toccato — è un 400, non un guasto.
    mockSentinel.setRuleFields.mockImplementationOnce(() => { throw new Error('blocco non individuabile'); });
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { ruleName: 'php-probe', rule: { name: 'php-probe', action: 'block', match: { extension: ['php'] } } };

    await runRoute(routeByPath('/rules/fields'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toMatch(/blocco non individuabile/);
  });
});

// Le tre viste modificano lo STESSO file, e la panoramica ci scrive pure: il
// pulsante «promuovi» è una scrittura. Chi tiene aperto un editor per minuti
// deve accorgersi che sotto è cambiato qualcosa, invece di cancellarlo.
describe('guardia contro la sovrascrittura', () => {
  beforeEach(async () => { await attach(); });

  /** L mtime attuale del file di regole, come lo vedrebbe il client caricando. */
  const mtimeOra = () => fs.statSync(rulesFilePath).mtime.toISOString();

  /** Riscrive il file con un mtime sicuramente diverso. */
  function toccaIlFile() {
    fs.writeFileSync(rulesFilePath, '// toccato da qualcun altro\n{ rules: [] }\n', 'utf8');
    const dopo = new Date(Date.now() + 5000);
    fs.utimesSync(rulesFilePath, dopo, dopo);
  }

  test('/rules/source porta l mtime, che è ciò che il client dovrà rimandare', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/rules/source'), ctx);
    expect(ctx.body.mtime).toBe(mtimeOra());
  });

  test('/rules/save con l mtime giusto salva', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }', knownMtime: mtimeOra() };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.body.saved).toBe(true);
    expect(mockSentinel.reloadRules).toHaveBeenCalled();
  });

  test('/rules/save con l mtime superato → 409, e il file NON viene toccato', async () => {
    const vecchio = mtimeOra();
    toccaIlFile();
    const contenutoAltrui = fs.readFileSync(rulesFilePath, 'utf8');

    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [ /* il mio testo vecchio */ ] }', knownMtime: vecchio };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.status).toBe(409);
    expect(ctx.body.conflict).toBe(true);
    expect(ctx.body.saved).toBe(false);
    // La parte che conta: la modifica dell'altro è ancora lì.
    expect(fs.readFileSync(rulesFilePath, 'utf8')).toBe(contenutoAltrui);
    expect(mockSentinel.reloadRules).not.toHaveBeenCalled();
  });

  test('il conflitto viene rilevato PRIMA della validazione', async () => {
    // Dire a un testo vecchio che è valido lo incoraggerebbe solo a essere
    // scritto sopra a quello nuovo.
    toccaIlFile();
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: 'questo non è nemmeno JSON5 {{{', knownMtime: '2020-01-01T00:00:00.000Z' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.status).toBe(409);
    expect(mockSentinel.validateRules).not.toHaveBeenCalled();
  });

  test('senza knownMtime si salva come prima: la precondizione è opzionale', async () => {
    toccaIlFile();
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.body.saved).toBe(true);
  });

  test('/rules/fields con l mtime superato → 409 senza chiamare il service', async () => {
    const vecchio = mtimeOra();
    toccaIlFile();

    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = {
      ruleName: 'php-probe',
      rule: { name: 'php-probe', action: 'block', match: { extension: ['php'] } },
      knownMtime: vecchio,
    };

    await runRoute(routeByPath('/rules/fields'), ctx);

    expect(ctx.status).toBe(409);
    expect(mockSentinel.setRuleFields).not.toHaveBeenCalled();
  });

  test('un file di regole assente non inventa un conflitto', () => {
    // Non poter leggere l mtime non è la prova che qualcuno abbia scritto: la
    // guardia si tira indietro invece di bloccare un salvataggio legittimo.
    const conflitto = plugin._internals.staleWriteConflict(
      path.join(serviceFolder, 'non-esiste.json5'), '2020-01-01T00:00:00.000Z');
    expect(conflitto).toBeNull();
  });
});

describe('/rules/save', () => {
  beforeEach(async () => { await attach(); });

  test('valida col validatore del service prima di scrivere', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(mockSentinel.validateRules).toHaveBeenCalled();
    expect(ctx.body.saved).toBe(true);
  });

  test('scrive il testo ESATTAMENTE come arriva, commenti compresi', async () => {
    const testo = '// il mio commento\n{\n  rules: [], // niente\n}\n';
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: testo };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(fs.readFileSync(rulesFilePath, 'utf8')).toBe(testo);
  });

  test('un testo rifiutato non tocca il file su disco', async () => {
    const originale = fs.readFileSync(rulesFilePath, 'utf8');
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ regole: "non è un array" }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.saved).toBe(false);
    expect(ctx.body.errors.length).toBeGreaterThan(0);
    expect(fs.readFileSync(rulesFilePath, 'utf8')).toBe(originale);
    expect(mockSentinel.reloadRules).not.toHaveBeenCalled();
  });

  test('sintassi JSON5 rotta → 400 con il motivo, non un 500', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [ }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.errors[0]).toMatch(/sintassi JSON5/);
  });

  test('crea un backup prima di sostituire il file', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(typeof ctx.body.backup).toBe('string');
    expect(ctx.body.backup).toMatch(/^sentinelRules\./);
  });

  // Il difetto: un disco pieno o una cartella non scrivibile arrivavano
  // all'utente travestiti da errore di validazione, senza un messaggio.
  test('un errore di SCRITTURA torna 500 col motivo, distinto dalla validazione', async () => {
    const rulesFileManager = require('../../lib/rulesFileManager');
    const spy = jest.spyOn(rulesFileManager, 'writeRaw')
      .mockReturnValue({ ok: false, error: 'ENOSPC: no space left on device' });
    try {
      const ctx = createCtxMock({ method: 'POST' });
      ctx.request.body = { content: '{ rules: [] }' };

      await runRoute(routeByPath('/rules/save'), ctx);

      expect(ctx.status).toBe(500);
      expect(ctx.body.saved).toBe(false);
      expect(ctx.body.error).toMatch(/ENOSPC/);
      // Nessun elenco di errori di validazione: il client distingue i due casi
      // proprio da qui, e mostrarne uno per l'altro manda a cercare nel posto
      // sbagliato.
      expect(ctx.body.errors).toBeUndefined();
      expect(mockSentinel.reloadRules).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('dopo il salvataggio le regole sono in vigore, senza riavvio', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }' };

    await runRoute(routeByPath('/rules/save'), ctx);

    expect(mockSentinel.reloadRules).toHaveBeenCalledTimes(1);
    expect(ctx.body.ruleCount).toBe(2);
  });
});

describe('/rules/validate e /rules/raw', () => {
  beforeEach(async () => { await attach(); });

  test('/rules/validate non tocca il file', async () => {
    const originale = fs.readFileSync(rulesFilePath, 'utf8');
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '{ rules: [] }' };

    await runRoute(routeByPath('/rules/validate'), ctx);

    expect(ctx.body.ok).toBe(true);
    expect(fs.readFileSync(rulesFilePath, 'utf8')).toBe(originale);
  });

  test('/rules/validate riporta gli errori invece di lanciare', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: 'non JSON5 {{{' };

    await runRoute(routeByPath('/rules/validate'), ctx);

    expect(ctx.body.ok).toBe(false);
    expect(ctx.body.errors[0]).toMatch(/sintassi JSON5/);
  });

  test('/rules/validate su contenuto vuoto non chiama il validatore', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { content: '   ' };

    await runRoute(routeByPath('/rules/validate'), ctx);

    expect(ctx.body.ok).toBe(false);
    expect(mockSentinel.validateRules).not.toHaveBeenCalled();
  });

  test('/rules/raw restituisce testo, mtime ed elenco dei backup', async () => {
    const ctx = createCtxMock();
    await runRoute(routeByPath('/rules/raw'), ctx);

    expect(ctx.body.content).toBe('// regole\n{ rules: [] }\n');
    expect(ctx.body.mtime).toBe(fs.statSync(rulesFilePath).mtime.toISOString());
    expect(Array.isArray(ctx.body.backups)).toBe(true);
  });
});

describe('/rules/action, /mode e /rules/test', () => {
  beforeEach(async () => { await attach(); });

  test('/rules/action delega al service e riporta lo stato precedente', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { ruleName: 'php-probe', action: 'block' };

    await runRoute(routeByPath('/rules/action'), ctx);

    expect(mockSentinel.setRuleAction).toHaveBeenCalledWith('php-probe', 'block');
    expect(ctx.body.ok).toBe(true);
    expect(ctx.body.previous).toBe('monitor');
  });

  test.each([[{}], [{ ruleName: 'php-probe' }], [{ action: 'block' }]])(
    '/rules/action con richiesta incompleta (%j) → 400 senza chiamare il service', async (body) => {
      const ctx = createCtxMock({ method: 'POST' });
      ctx.request.body = body;

      await runRoute(routeByPath('/rules/action'), ctx);

      expect(ctx.status).toBe(400);
      expect(mockSentinel.setRuleAction).not.toHaveBeenCalled();
    });

  test('/rules/action su un azione rifiutata → 400, non un guasto', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { ruleName: 'php-probe', action: 'inventata' };

    await runRoute(routeByPath('/rules/action'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.ok).toBe(false);
  });

  test('/mode commuta osservazione ↔ enforcement', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { mode: 'enforce' };

    await runRoute(routeByPath('/mode'), ctx);

    expect(mockSentinel.setMode).toHaveBeenCalledWith('enforce');
    expect(ctx.body.ok).toBe(true);
  });

  test('/mode con una modalità inventata → 400', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { mode: 'aggressivo' };

    await runRoute(routeByPath('/mode'), ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.ok).toBe(false);
  });

  test('/rules/test prova senza inviare nulla per davvero', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { spec: { path: '/wp-login.php' } };

    await runRoute(routeByPath('/rules/test'), ctx);

    expect(mockSentinel.testRequest).toHaveBeenCalledWith({ path: '/wp-login.php' });
    expect(ctx.body.ok).toBe(true);
  });

  test('/rules/test senza percorso → 400 senza scomodare il motore', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    ctx.request.body = { spec: { method: 'GET' } };

    await runRoute(routeByPath('/rules/test'), ctx);

    expect(ctx.status).toBe(400);
    expect(mockSentinel.testRequest).not.toHaveBeenCalled();
  });
});

// Forzare il salvataggio degli archivi prima di leggerli è giusto; farlo a ogni
// aggiornamento di ogni scheda aperta moltiplicava per dodici le scritture su
// disco di un plugin nato per non pesare.
describe('freno del /flush', () => {
  beforeEach(async () => { await attach(); });

  test('il primo flush passa', async () => {
    const ctx = createCtxMock({ method: 'POST' });
    await runRoute(routeByPath('/flush'), ctx);

    expect(mockSentinel.flushNow).toHaveBeenCalledTimes(1);
    expect(ctx.body.flushed).toBe(true);
  });

  test('i successivi ravvicinati non riscrivono gli archivi, e lo dichiarano', async () => {
    for (let i = 0; i < 5; i++) {
      await runRoute(routeByPath('/flush'), createCtxMock({ method: 'POST' }));
    }
    const ultimo = createCtxMock({ method: 'POST' });
    await runRoute(routeByPath('/flush'), ultimo);

    expect(mockSentinel.flushNow).toHaveBeenCalledTimes(1);
    // Non è un errore: gli archivi sono già stati scritti pochi istanti fa.
    expect(ultimo.body.ok).toBe(true);
    expect(ultimo.body.flushed).toBe(false);
    expect(ultimo.body.ageMs).toBeLessThan(plugin._internals.FLUSH_MIN_INTERVAL_MS);
  });
});
