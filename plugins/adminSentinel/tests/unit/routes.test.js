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

let dataDir;
let serviceFolder;

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
  flushNow: jest.fn(),
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

function attach({ withService = true } = {}) {
  const pluginSys = createPluginSysMock({
    sharedObjects: withService ? { sentinel: mockSentinel } : {},
    plugins: withService ? { sentinel: { pathPluginFolder: serviceFolder } } : {},
  });
  // getPlugin non è fra i metodi del mock condiviso: lo si aggiunge qui perché
  // adminSentinel lo usa per risolvere la data dir del service.
  pluginSys.getPlugin = (name) => (withService && name === 'sentinel'
    ? { pathPluginFolder: serviceFolder } : null);
  return plugin.loadPlugin(pluginSys, __dirname).then(() => pluginSys);
}

const routeByPath = (p) => plugin.getRouteArray().find((r) => r.path === p);

beforeEach(() => {
  const made = makeServiceFolder();
  serviceFolder = made.folder;
  dataDir = made.dir;
});

afterEach(() => {
  fs.rmSync(serviceFolder, { recursive: true, force: true });
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
    expect(paths).toEqual(['/events', '/fingerprints', '/flush', '/rules', '/scanners', '/status', '/summary']);
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
