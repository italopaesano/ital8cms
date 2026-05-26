/**
 * Integration test del flusso dry-run di pluginsInstall.
 *
 * Verifica l'intera pipeline UI/server senza dipendere da rete o repo reali:
 *   POST /plugins/install/dryRun  →  job in stato pending
 *   polling /status               →  job evolve attraverso receiving, resolving,
 *                                    updatingFiles, e termina in success
 *
 * Il dry-run è gated da debugMode >= 1 in ital8Config.json5. Il test verifica
 * sia il caso enabled (default in dev) sia un caso che simula l'endpoint
 * raggiungibile per discovery.
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const pluginsInstall = require(path.join(PROJECT_ROOT, 'plugins', 'admin', 'pluginsInstall'));

const TEST_TIMEOUT_MS = 15_000;

function makeCtx(opts = {}) {
  return {
    request: { body: opts.body || {} },
    params: opts.params || {},
    session: { user: { username: 'jest-dryRun' } },
    status: 200,
    body: null,
  };
}

function findRoute(method, pathPattern) {
  const route = pluginsInstall.getRoutes().find(
    r => r.method === method && r.path === pathPattern
  );
  if (!route) throw new Error(`Route ${method} ${pathPattern} non trovata`);
  return route;
}

async function waitForJobTerminal(installId, maxMs = TEST_TIMEOUT_MS) {
  const route = findRoute('GET', '/plugins/install/:installId/status');
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    await new Promise(r => setTimeout(r, 200));
    const ctx = makeCtx({ params: { installId } });
    await route.handler(ctx);
    last = ctx.body && ctx.body.job;
    if (!last) continue;
    if (last.status === 'success' || last.status === 'failed') return last;
  }
  throw new Error(
    `Timeout: job ${installId} non terminale dopo ${maxMs}ms ` +
    `(ultimo status: ${last && last.status})`
  );
}

describe('pluginsInstall — dry-run', () => {
  test('availability endpoint riflette il flag debugMode', async () => {
    const route = findRoute('GET', '/plugins/install/dryRunAvailable');
    const ctx = makeCtx({});
    await route.handler(ctx);
    expect(ctx.body.success).toBe(true);
    expect(typeof ctx.body.available).toBe('boolean');
    // Quando debugMode === 1 (default in dev) deve essere true
    expect(ctx.body.available).toBe(pluginsInstall._isDryRunEnabled());
  });

  test('dry-run completa con success e produce progress events plausibili', async () => {
    if (!pluginsInstall._isDryRunEnabled()) {
      console.warn('[pluginsInstall.dryRun] debugMode disabilitato — test skippato');
      return;
    }

    const dryRunRoute = findRoute('POST', '/plugins/install/dryRun');
    const ctxStart = makeCtx({ body: { wantActive: false } });
    await dryRunRoute.handler(ctxStart);
    expect(ctxStart.status).toBe(200);
    expect(ctxStart.body.success).toBe(true);
    expect(ctxStart.body.dryRun).toBe(true);
    expect(ctxStart.body.pluginName).toMatch(/^dryRunPlugin\d+$/);
    expect(ctxStart.body.installId).toMatch(/^inst_/);

    const job = await waitForJobTerminal(ctxStart.body.installId);
    expect(job.status).toBe('success');
    expect(job.result).toBeTruthy();
    // Il segnale "questo è un dry-run" lato client passa via result.dryRun
    // (dryRun sul job stesso è interno al modulo, non propagato dallo snapshot).
    expect(job.result.dryRun).toBe(true);

    // Tutte le fasi attese sono presenti
    const phaseNames = job.phases.map(p => p.name);
    expect(phaseNames).toEqual(
      expect.arrayContaining([
        'lockAcquired', 'validateInput', 'checkDestination',
        'cloneStart', 'cloneDone', 'validate', 'finalizeConfig',
      ]),
    );

    // Progress history popolato con eventi di tutti gli stadi attesi
    expect(job.progressHistory.length).toBeGreaterThan(10);
    const stages = new Set(job.progressHistory.map(e => e.stage));
    expect(stages.has('receiving')).toBe(true);
    expect(stages.has('resolving')).toBe(true);
    expect(stages.has('updatingFiles')).toBe(true);

    // Eventi receiving hanno bytes e rate (come git reale)
    const receivingEvents = job.progressHistory.filter(e => e.stage === 'receiving');
    const sampleReceiving = receivingEvents.find(e => e.percent > 50);
    expect(sampleReceiving).toBeTruthy();
    expect(sampleReceiving.bytes).toMatch(/[KMG]?i?B/);
    expect(sampleReceiving.rate).toMatch(/\/s$/);

    // Ultimo evento è updatingFiles al 100%
    const last = job.progressHistory[job.progressHistory.length - 1];
    expect(last.stage).toBe('updatingFiles');
    expect(last.percent).toBe(100);
    expect(last.current).toBe(last.total);
  }, TEST_TIMEOUT_MS);

  test('dry-run non scrive nulla nel filesystem plugins/', async () => {
    if (!pluginsInstall._isDryRunEnabled()) return;

    const dryRunRoute = findRoute('POST', '/plugins/install/dryRun');
    const ctxStart = makeCtx({ body: {} });
    await dryRunRoute.handler(ctxStart);
    const pluginName = ctxStart.body.pluginName;
    const job = await waitForJobTerminal(ctxStart.body.installId);
    expect(job.status).toBe('success');

    // Verifica esplicita: nessuna cartella plugins/{dryRunPluginXXXX}/ creata
    const fs = require('fs');
    const expectedDir = path.join(PROJECT_ROOT, 'plugins', pluginName);
    expect(fs.existsSync(expectedDir)).toBe(false);

    // Il themePath nel result deve indicare esplicitamente che è un dry-run
    expect(job.result.pluginPath).toMatch(/dry-run/);
  }, TEST_TIMEOUT_MS);

  test('snapshot del job include progress e progressHistory', async () => {
    if (!pluginsInstall._isDryRunEnabled()) return;

    const dryRunRoute = findRoute('POST', '/plugins/install/dryRun');
    const ctxStart = makeCtx({});
    await dryRunRoute.handler(ctxStart);
    const installId = ctxStart.body.installId;

    // Polling intermedio: il job deve avere progress popolato
    await new Promise(r => setTimeout(r, 500));
    const statusRoute = findRoute('GET', '/plugins/install/:installId/status');
    const ctxMid = makeCtx({ params: { installId } });
    await statusRoute.handler(ctxMid);
    expect(ctxMid.body.success).toBe(true);
    expect(ctxMid.body.job).toHaveProperty('progress');
    expect(ctxMid.body.job).toHaveProperty('progressHistory');
    expect(Array.isArray(ctxMid.body.job.progressHistory)).toBe(true);

    // Aspetta che termini per non lasciare il lock in stato dirty
    await waitForJobTerminal(installId);
  }, TEST_TIMEOUT_MS);
});
