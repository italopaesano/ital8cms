/**
 * Test d'integrazione del plugin rateLimiter: esercita main.js end-to-end
 * (loadPlugin → oggetto condiviso "guard" L1 + middleware di enforcement L2),
 * usando un sandbox su filesystem (mai la cartella reale del plugin).
 *
 * Soglie volutamente basse per provocare i blocchi in tempo reale, senza dover
 * avanzare l'orologio (l'algoritmo di escalation/scadenza è coperto dai test
 * unitari del motore con clock iniettata).
 */

'use strict';

const {
  createPluginSandbox,
  createPluginSysMock,
  createCtxMock,
  runMiddleware,
} = require('../../../../core/testHelpers');

const CUSTOM = {
  enabled: true,
  trustProxy: false,
  defaults: {
    findWindowSeconds: 900,
    maxFailures: 2,        // 2 fallimenti → short block
    shortBlockSeconds: 300,
    maxShortBlocks: 1,
    longBlockSeconds: 3600,
    escalationResetSeconds: 86400,
  },
  state: { flushIntervalSeconds: 0 },  // nessun timer
  log: { enabled: true },              // audit attivo (scrive nel sandbox tmp)
  response: { status: 429, retryAfterHeader: true },
  enforcement: {
    enabled: true,
    globalLongBlock: true,
    status: 429,
    redirectTo: '',
    exemptPaths: ['/admin/**'],
  },
  sweepIntervalSeconds: 0,             // nessun timer
  enableLogging: false,
  strictValidation: false,
};

const RULES = {
  rules: [
    { name: 'adminLogin' },                                            // usa i defaults (maxFailures 2)
    { name: 'instaBan', maxFailures: 1, maxShortBlocks: 0 },           // 1 fallimento → long block
    { name: 'downloads', pathPattern: '/downloads/**', maxFailures: 1, maxShortBlocks: 5 }, // short block + pattern L2
  ],
};

/** ctx mock con un IP impostato (keyResolver usa ctx.ip con trustProxy=false). */
function ctxWith(ip, path = '/') {
  const ctx = createCtxMock({ path });
  ctx.ip = ip;
  return ctx;
}

let sandbox;
let plugin;
let shared;
let middleware;

beforeAll(async () => {
  process.setMaxListeners(20); // evita warning per gli handler SIGTERM/SIGINT accumulati
  sandbox = createPluginSandbox('rateLimiter', {
    pluginConfig: { active: 1, isInstalled: 1, weight: 5, dependency: {}, nodeModuleDependency: {}, custom: CUSTOM },
  });
  sandbox.writeJson5('protectedRoutes.json5', RULES);

  plugin = require('../../main.js');
  await plugin.loadPlugin(createPluginSysMock(), sandbox.path);

  shared = plugin.getObjectToShareToOthersPlugin('adminUsers');
  const mwArray = plugin.getMiddlewareToAdd({});
  middleware = mwArray[0];
});

afterAll(() => {
  if (sandbox) sandbox.cleanup();
});

describe('Livello 1 — oggetto condiviso (guard)', () => {
  test('getObjectToShareToOthersPlugin restituisce l\'API (non null)', () => {
    expect(shared).not.toBeNull();
    expect(typeof shared.checkCtx).toBe('function');
    expect(typeof shared.recordFailureCtx).toBe('function');
    expect(typeof shared.recordSuccessCtx).toBe('function');
    expect(typeof shared.guardCtx).toBe('function');
  });

  test('keyFromCtx restituisce l\'IP del client', () => {
    expect(shared.keyFromCtx(ctxWith('203.0.113.10'))).toBe('203.0.113.10');
  });

  test('getRuleNames elenca le regole configurate', () => {
    const names = shared.getRuleNames();
    expect(names).toEqual(expect.arrayContaining(['adminLogin', 'instaBan', 'downloads']));
  });

  test('checkCtx: non bloccato inizialmente', () => {
    expect(shared.checkCtx(ctxWith('1.1.1.1'), 'adminLogin').blocked).toBe(false);
  });

  test('recordFailureCtx: blocca al raggiungimento della soglia', () => {
    const ip = '2.2.2.2';
    expect(shared.recordFailureCtx(ctxWith(ip), 'adminLogin').blocked).toBe(false); // 1° < 2
    const v = shared.recordFailureCtx(ctxWith(ip), 'adminLogin');                   // 2° == soglia
    expect(v.blocked).toBe(true);
    expect(v.tier).toBe('short');
    expect(shared.checkCtx(ctxWith(ip), 'adminLogin').blocked).toBe(true);
  });

  test('guardCtx: su IP bloccato scrive 429 + Retry-After e ritorna true', () => {
    const ip = '3.3.3.3';
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin');
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin'); // ora bloccato

    const ctx = ctxWith(ip);
    const blocked = shared.guardCtx(ctx, 'adminLogin');
    expect(blocked).toBe(true);
    expect(ctx.status).toBe(429);
    expect(ctx._setHeaders['Retry-After']).toBeDefined();
    expect(ctx.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('guardCtx: su IP libero ritorna false e non tocca lo status', () => {
    const ctx = ctxWith('4.4.4.4');
    expect(shared.guardCtx(ctx, 'adminLogin')).toBe(false);
    expect(ctx.status).toBe(200);
  });

  test('recordSuccessCtx: azzera i contatori', () => {
    const ip = '5.5.5.5';
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin');
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin'); // bloccato
    expect(shared.checkCtx(ctxWith(ip), 'adminLogin').blocked).toBe(true);
    shared.recordSuccessCtx(ctxWith(ip), 'adminLogin');
    expect(shared.checkCtx(ctxWith(ip), 'adminLogin').blocked).toBe(false);
  });

  test('getActiveBlocks riflette i blocchi attivi', () => {
    const ip = '6.6.6.6';
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin');
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin');
    const active = shared.getActiveBlocks();
    expect(active.some((b) => b.clientId === ip && b.ruleName === 'adminLogin')).toBe(true);
  });
});

describe('Livello 2 — middleware di enforcement', () => {
  test('getMiddlewareToAdd restituisce un middleware', () => {
    expect(typeof middleware).toBe('function');
  });

  test('globalLongBlock: IP con long block negato su pagina fall-through', async () => {
    const ip = '10.0.0.1';
    shared.recordFailureCtx(ctxWith(ip), 'instaBan'); // 1 fallimento → long block immediato

    const ctx = ctxWith(ip, '/qualche-pagina');
    const { next } = await runMiddleware(middleware, ctx);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(429);
    expect(ctx._setHeaders['Retry-After']).toBeDefined();
  });

  test('exemptPaths: /admin/** passa anche se l\'IP è bloccato', async () => {
    const ip = '10.0.0.2';
    shared.recordFailureCtx(ctxWith(ip), 'instaBan'); // long block

    const ctx = ctxWith(ip, '/admin/dashboard');
    const { next } = await runMiddleware(middleware, ctx);
    expect(next).toHaveBeenCalled();
    expect(ctx.status).not.toBe(429);
  });

  test('IP pulito: la richiesta passa', async () => {
    const ctx = ctxWith('10.0.0.99', '/qualche-pagina');
    const { next } = await runMiddleware(middleware, ctx);
    expect(next).toHaveBeenCalled();
  });

  test('pathPattern: pagina protetta negata; altre pagine passano', async () => {
    const ip = '10.0.0.3';
    shared.recordFailureCtx(ctxWith(ip), 'downloads'); // short block sulla regola downloads

    // /downloads/** matcha il pathPattern → negato
    const ctxBlocked = ctxWith(ip, '/downloads/report.pdf');
    const r1 = await runMiddleware(middleware, ctxBlocked);
    expect(r1.next).not.toHaveBeenCalled();
    expect(ctxBlocked.status).toBe(429);

    // un'altra pagina non matcha (e non c'è long block) → passa
    const ctxOk = ctxWith(ip, '/altra-pagina');
    const r2 = await runMiddleware(middleware, ctxOk);
    expect(r2.next).toHaveBeenCalled();
  });
});

describe('API per adminRateLimiter (Step 1)', () => {
  test('releaseBlock sblocca una chiave', () => {
    const ip = '7.7.7.1';
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin');
    shared.recordFailureCtx(ctxWith(ip), 'adminLogin'); // bloccato
    expect(shared.checkCtx(ctxWith(ip), 'adminLogin').blocked).toBe(true);
    expect(shared.releaseBlock(ip, 'adminLogin')).toBe(true);
    expect(shared.checkCtx(ctxWith(ip), 'adminLogin').blocked).toBe(false);
  });

  test('banClient applica un blocco manuale immediato', () => {
    const ip = '7.7.7.2';
    const v = shared.banClient(ip, 'adminLogin', { seconds: 600 });
    expect(v.blocked).toBe(true);
    expect(v.tier).toBe('long');
    expect(shared.check(ip, 'adminLogin').blocked).toBe(true);
  });

  test('releaseAllForClient rimuove tutti i blocchi di un IP', () => {
    const ip = '7.7.7.3';
    shared.banClient(ip, 'adminLogin', { seconds: 600 });
    shared.banClient(ip, 'downloads', { seconds: 600 });
    expect(shared.releaseAllForClient(ip)).toBe(2);
    expect(shared.check(ip, 'adminLogin').blocked).toBe(false);
    expect(shared.check(ip, 'downloads').blocked).toBe(false);
  });

  test('getStats riporta stato e conteggi', () => {
    const s = shared.getStats();
    expect(s.enabled).toBe(true);
    expect(s.enforcementEnabled).toBe(true);
    expect(s.ruleCount).toBe(3);
    expect(typeof s.activeBlocks).toBe('number');
    expect(typeof s.shortBlocks).toBe('number');
    expect(typeof s.longBlocks).toBe('number');
  });

  test('getRecentAttempts restituisce gli eventi recenti (audit)', () => {
    shared.recordFailureCtx(ctxWith('7.7.7.5'), 'adminLogin');
    const recent = shared.getRecentAttempts({ limit: 50 });
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0]).toHaveProperty('event');
    expect(recent[0]).toHaveProperty('ts');
  });

  test('getConfig restituisce una copia profonda del custom', () => {
    const c1 = shared.getConfig();
    expect(c1.defaults.maxFailures).toBe(2);
    const c2 = shared.getConfig();
    expect(c2).not.toBe(c1); // riferimenti diversi (deep copy)
    c1.defaults.maxFailures = 999; // la mutazione non deve propagarsi
    expect(shared.getConfig().defaults.maxFailures).toBe(2);
  });

  test('validateRules valida le regole', () => {
    expect(shared.validateRules({ rules: [{ name: 'ok' }] }).valid).toBe(true);
    expect(shared.validateRules({ rules: [{ name: '' }] }).valid).toBe(false);
  });

  test('validateConfig valida il custom', () => {
    const good = {
      enabled: true,
      defaults: { findWindowSeconds: 900, maxFailures: 5, shortBlockSeconds: 300, maxShortBlocks: 5, longBlockSeconds: 86400, escalationResetSeconds: 86400 },
    };
    expect(shared.validateConfig(good).valid).toBe(true);
    expect(shared.validateConfig({ enabled: true, defaults: { maxFailures: 5 } }).valid).toBe(false);
  });

  test('reloadRules non lancia e mantiene le regole', () => {
    expect(() => shared.reloadRules()).not.toThrow();
    expect(shared.getRuleNames()).toEqual(expect.arrayContaining(['adminLogin', 'instaBan', 'downloads']));
  });
});

describe('hot-reload via reloadConfig (Step 1)', () => {
  const writeCustom = (c) =>
    sandbox.writeJson5('pluginConfig.json5', { active: 1, isInstalled: 1, weight: 5, dependency: {}, nodeModuleDependency: {}, custom: c });

  afterAll(() => {
    // ripristina la config originale per non influenzare altri file/test
    writeCustom(CUSTOM);
    shared.reloadConfig();
  });

  test('reloadConfig aggiorna i defaults a caldo', () => {
    writeCustom({ ...CUSTOM, defaults: { ...CUSTOM.defaults, maxFailures: 9 } });
    shared.reloadConfig();
    expect(shared.getConfig().defaults.maxFailures).toBe(9);
  });

  test('reloadConfig disattiva l\'enforcement L2 a caldo (middleware live)', async () => {
    const ip = '8.8.8.1';
    shared.banClient(ip, 'instaBan', { seconds: 3600 }); // long block attivo

    // enforcement attivo → negato
    const ctxBefore = ctxWith(ip, '/pagina-x');
    const r1 = await runMiddleware(middleware, ctxBefore);
    expect(r1.next).not.toHaveBeenCalled();
    expect(ctxBefore.status).toBe(429);

    // disattivo l'enforcement e ricarico a caldo
    writeCustom({ ...CUSTOM, enforcement: { ...CUSTOM.enforcement, enabled: false } });
    shared.reloadConfig();

    // stesso IP ancora bloccato nell'engine, ma enforcement off → passa
    const ctxAfter = ctxWith(ip, '/pagina-x');
    const r2 = await runMiddleware(middleware, ctxAfter);
    expect(r2.next).toHaveBeenCalled();
    expect(ctxAfter.status).not.toBe(429);
  });
});
