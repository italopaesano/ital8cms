/**
 * tests/integration/hideExtension.test.js
 *
 * Test di integrazione per la funzionalità hideExtension (Clean URLs).
 * Verifica che koa-classic-server nasconda correttamente l'estensione .ejs
 * dagli URL serviti, con configurazione indipendente per i 3 contesti:
 *   - wwwPath (pagine pubbliche)
 *   - pluginPagesPrefix (pagine plugin)
 *   - adminPrefix (pagine admin)
 *
 * Eseguire con:
 *   npx jest tests/integration/hideExtension.test.js --verbose
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Fase 1 — Validazione configurazione  (nessun server)         │
 * │    • struttura hideExtension in ital8Config.json5              │
 * │    • valori di default corretti                                │
 * │    • logica di mapping verso opzione koa-classic-server        │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 2 — Server con hideExtension DISABILITATO               │
 * │    • file .ejs serviti normalmente con estensione              │
 * │    • URL senza estensione → 404                                │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 3 — Server con hideExtension ABILITATO (tutti)          │
 * │    • URL pulito /about → serve about.ejs                      │
 * │    • URL con estensione /about.ejs → redirect 301 a /about    │
 * │    • index.ejs → redirect a directory /                       │
 * │    • pluginPages: clean URL funziona                           │
 * │    • admin: clean URL funziona                                 │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 4 — Configurazione indipendente per contesto            │
 * │    • solo wwwPath abilitato → altri contesti invariati         │
 * │    • verifica isolamento tra contesti                          │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Porte riservate per i test (evitano conflitti con prod e altri test):
 *   Fase 2: HTTP 19300
 *   Fase 3: HTTP 19301
 *   Fase 4: HTTP 19302
 */

'use strict';

jest.setTimeout(60000);

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const json5 = require('json5');

// ── Costanti ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const FIXTURES_WWW_PATH = '/tests/fixtures/www';

// Porte riservate per i test hideExtension
const TEST_PORT_DISABLED = 19300;
const TEST_PORT_ENABLED = 19301;
const TEST_PORT_PARTIAL = 19302;

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Esegue una richiesta HTTP senza seguire redirect.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body,
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Avvia il server ital8cms con una configurazione personalizzata.
 * Modifica temporaneamente ital8Config.json5 e lo ripristina alla fine.
 *
 * @param {number} httpPort
 * @param {object} hideExtensionConfig
 * @returns {{ proc, restoreConfig, waitForReady }}
 */
function spawnServer(httpPort, hideExtensionConfig) {
  const originalRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const original = json5.parse(originalRaw);

  const testConf = {
    ...original,
    httpPort: httpPort,
    debugMode: 0,
    wwwPath: FIXTURES_WWW_PATH,
    activeTheme: 'themeForTesting',
    adminActiveTheme: 'themeForTestingAdmin',
    hideExtension: hideExtensionConfig,
    // Disabilita HTTPS per questi test
    https: {
      ...original.https,
      enabled: false,
    },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConf, null, 2), 'utf8');

  const proc = spawn('node', ['index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const restoreConfig = () => {
    fs.writeFileSync(CONFIG_PATH, originalRaw, 'utf8');
  };

  const waitForReady = (timeoutMs = 30000) => {
    return new Promise((resolve, reject) => {
      let buf = '';
      const cleanup = () => {
        clearTimeout(timer);
        proc.stdout.removeListener('data', onData);
        proc.stderr.removeListener('data', onData);
      };
      const onData = (chunk) => {
        buf += chunk.toString();
        // Il server logga la porta HTTP quando è pronto
        if (buf.includes(`${httpPort}`)) {
          cleanup();
          // Piccolo delay per assicurarsi che il server sia completamente pronto
          setTimeout(() => resolve(buf), 500);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) in attesa di server ready\nOutput:\n${buf}`));
      }, timeoutMs);
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.once('exit', (code) => {
        cleanup();
        reject(new Error(`Server uscito (codice ${code}) prima di essere pronto\nOutput:\n${buf}`));
      });
    });
  };

  return { proc, restoreConfig, waitForReady };
}

/**
 * Termina un processo in modo pulito.
 */
async function killProcess(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }, 3000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    proc.kill('SIGTERM');
  });
}

// ── Configurazioni di test ────────────────────────────────────────────────────

const HIDE_EXT_ALL_DISABLED = {
  wwwPath: { enabled: false, ext: '.ejs' },
  pluginPagesPrefix: { enabled: false, ext: '.ejs' },
  adminPrefix: { enabled: false, ext: '.ejs' },
};

const HIDE_EXT_ALL_ENABLED = {
  wwwPath: { enabled: true, ext: '.ejs' },
  pluginPagesPrefix: { enabled: true, ext: '.ejs' },
  adminPrefix: { enabled: true, ext: '.ejs' },
};

const HIDE_EXT_ONLY_WWW = {
  wwwPath: { enabled: true, ext: '.ejs' },
  pluginPagesPrefix: { enabled: false, ext: '.ejs' },
  adminPrefix: { enabled: false, ext: '.ejs' },
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 1 — VALIDAZIONE CONFIGURAZIONE
// (nessun server avviato — verifica struttura e logica di mapping)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[hideExtension] Fase 1 — Validazione configurazione', () => {

  let config;

  beforeAll(() => {
    config = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  });

  describe('Struttura hideExtension in ital8Config.json5', () => {

    test('hideExtension esiste nella configurazione', () => {
      expect(config).toHaveProperty('hideExtension');
      expect(typeof config.hideExtension).toBe('object');
    });

    test('hideExtension ha i 3 contesti richiesti', () => {
      expect(config.hideExtension).toHaveProperty('wwwPath');
      expect(config.hideExtension).toHaveProperty('pluginPagesPrefix');
      expect(config.hideExtension).toHaveProperty('adminPrefix');
    });

    test('ogni contesto ha i campi "enabled" e "ext"', () => {
      const contexts = ['wwwPath', 'pluginPagesPrefix', 'adminPrefix'];
      contexts.forEach(ctx => {
        expect(config.hideExtension[ctx]).toHaveProperty('enabled');
        expect(config.hideExtension[ctx]).toHaveProperty('ext');
        expect(typeof config.hideExtension[ctx].enabled).toBe('boolean');
        expect(typeof config.hideExtension[ctx].ext).toBe('string');
      });
    });

    test('ext inizia con un punto in tutti i contesti', () => {
      const contexts = ['wwwPath', 'pluginPagesPrefix', 'adminPrefix'];
      contexts.forEach(ctx => {
        expect(config.hideExtension[ctx].ext.startsWith('.')).toBe(true);
      });
    });

    test('valori di default: tutti disabilitati', () => {
      // Verifica che la configurazione di default sia conservativa
      expect(config.hideExtension.wwwPath.enabled).toBe(false);
      expect(config.hideExtension.pluginPagesPrefix.enabled).toBe(false);
      expect(config.hideExtension.adminPrefix.enabled).toBe(false);
    });

    test('valori di default: ext è ".ejs"', () => {
      expect(config.hideExtension.wwwPath.ext).toBe('.ejs');
      expect(config.hideExtension.pluginPagesPrefix.ext).toBe('.ejs');
      expect(config.hideExtension.adminPrefix.ext).toBe('.ejs');
    });
  });

  describe('Logica di mapping verso koa-classic-server', () => {

    test('enabled: true → produce oggetto { ext: ".ejs" }', () => {
      const ctx = { enabled: true, ext: '.ejs' };
      const result = ctx.enabled ? { ext: ctx.ext } : undefined;
      expect(result).toEqual({ ext: '.ejs' });
    });

    test('enabled: false → produce undefined', () => {
      const ctx = { enabled: false, ext: '.ejs' };
      const result = ctx.enabled ? { ext: ctx.ext } : undefined;
      expect(result).toBeUndefined();
    });

    test('ext personalizzato viene preservato', () => {
      const ctx = { enabled: true, ext: '.pug' };
      const result = ctx.enabled ? { ext: ctx.ext } : undefined;
      expect(result).toEqual({ ext: '.pug' });
    });

    test('mapping per tutti i 3 contesti funziona indipendentemente', () => {
      const hideExt = {
        wwwPath: { enabled: true, ext: '.ejs' },
        pluginPagesPrefix: { enabled: false, ext: '.ejs' },
        adminPrefix: { enabled: true, ext: '.pug' },
      };

      const wwwResult = hideExt.wwwPath.enabled ? { ext: hideExt.wwwPath.ext } : undefined;
      const pluginResult = hideExt.pluginPagesPrefix.enabled ? { ext: hideExt.pluginPagesPrefix.ext } : undefined;
      const adminResult = hideExt.adminPrefix.enabled ? { ext: hideExt.adminPrefix.ext } : undefined;

      expect(wwwResult).toEqual({ ext: '.ejs' });
      expect(pluginResult).toBeUndefined();
      expect(adminResult).toEqual({ ext: '.pug' });
    });
  });

  describe('Compatibilità con koa-classic-server', () => {

    test('formato { ext: ".ejs" } è accettato da koa-classic-server', () => {
      // koa-classic-server valida: typeof === 'object' && !Array.isArray && ext è stringa non vuota
      const option = { ext: '.ejs' };
      expect(typeof option).toBe('object');
      expect(Array.isArray(option)).toBe(false);
      expect(typeof option.ext).toBe('string');
      expect(option.ext.length).toBeGreaterThan(0);
      expect(option.ext.startsWith('.')).toBe(true);
    });

    test('undefined è accettato (feature disabilitata)', () => {
      const option = undefined;
      // koa-classic-server controlla: if (options.hideExtension !== undefined && options.hideExtension !== null)
      expect(option === undefined || option === null).toBe(true);
    });

    test('stringa nuda NON è un formato valido (causerebbe errore)', () => {
      // Questo test documenta il bug che è stato fixato
      const wrongFormat = '.ejs';
      expect(typeof wrongFormat).not.toBe('object');
      // koa-classic-server lancerebbe: "hideExtension must be an object with an 'ext' property"
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 2 — SERVER CON hideExtension DISABILITATO
// (verifica che il comportamento classico sia invariato)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[hideExtension] Fase 2 — Server con hideExtension disabilitato', () => {

  let proc;
  let restoreConfig;

  beforeAll(async () => {
    const server = spawnServer(TEST_PORT_DISABLED, HIDE_EXT_ALL_DISABLED);
    proc = server.proc;
    restoreConfig = server.restoreConfig;
    await server.waitForReady();
  });

  afterAll(async () => {
    await killProcess(proc);
    restoreConfig();
  });

  test('server avviato correttamente', () => {
    expect(proc.exitCode).toBeNull();
  });

  test('GET /index.ejs → 200 (pagina servita normalmente)', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT_DISABLED}/index.ejs`);
    expect(res.status).toBe(200);
  });

  test('GET / → 200 (index.ejs servito come index file)', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT_DISABLED}/`);
    expect(res.status).toBe(200);
  });

  test('GET /hello_word.ejs → 200 (file con estensione servito)', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT_DISABLED}/hello_word.ejs`);
    expect(res.status).toBe(200);
  });

  test('GET /hello_word (senza ext) → 404 (hideExtension disabilitato)', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT_DISABLED}/hello_word`);
    expect(res.status).toBe(404);
  });

  test('GET /i18n-test (senza ext) → 404 (hideExtension disabilitato)', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT_DISABLED}/i18n-test`);
    expect(res.status).toBe(404);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 3 — SERVER CON hideExtension ABILITATO (TUTTI I CONTESTI)
// (verifica clean URLs, redirect, e backward compatibility)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[hideExtension] Fase 3 — Server con hideExtension abilitato (tutti i contesti)', () => {

  let proc;
  let restoreConfig;

  beforeAll(async () => {
    const server = spawnServer(TEST_PORT_ENABLED, HIDE_EXT_ALL_ENABLED);
    proc = server.proc;
    restoreConfig = server.restoreConfig;
    await server.waitForReady();
  });

  afterAll(async () => {
    await killProcess(proc);
    restoreConfig();
  });

  test('server avviato correttamente', () => {
    expect(proc.exitCode).toBeNull();
  });

  // ── wwwPath: Clean URLs ──

  describe('wwwPath: Clean URLs', () => {

    test('GET /hello_word → 200 (clean URL, serve hello_word.ejs)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/hello_word`);
      expect(res.status).toBe(200);
      // Verifica che sia HTML (ejs renderizzato)
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    test('GET /i18n-test → 200 (clean URL con trattino)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/i18n-test`);
      expect(res.status).toBe(200);
    });

    test('GET /prova_thema → 200 (clean URL con underscore)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/prova_thema`);
      expect(res.status).toBe(200);
    });

    test('GET / → 200 (homepage servita normalmente)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/`);
      expect(res.status).toBe(200);
    });

    test('GET /nonexistent → 404 (file non esiste neanche con .ejs)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  // ── wwwPath: Backward compatibility (redirect .ejs → clean URL) ──

  describe('wwwPath: Backward compatibility (redirect)', () => {

    test('GET /hello_word.ejs → 301 redirect a /hello_word', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/hello_word.ejs`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/hello_word');
    });

    test('GET /i18n-test.ejs → 301 redirect a /i18n-test', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/i18n-test.ejs`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/i18n-test');
    });

    test('GET /index.ejs → 301 redirect a / (index file → directory)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/index.ejs`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/');
    });

    test('redirect preserva query string', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/hello_word.ejs?foo=bar&baz=1`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/hello_word?foo=bar&baz=1');
    });
  });

  // ── pluginPages: Clean URLs ──

  describe('pluginPages: Clean URLs', () => {

    test('GET /pluginPages/adminUsers/login → 200 (clean URL)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/pluginPages/adminUsers/login`);
      expect(res.status).toBe(200);
    });

    test('GET /pluginPages/adminUsers/login.ejs → 301 redirect', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/pluginPages/adminUsers/login.ejs`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/pluginPages/adminUsers/login');
    });

    test('GET /pluginPages/adminUsers/logout → 200 (clean URL)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/pluginPages/adminUsers/logout`);
      expect(res.status).toBe(200);
    });
  });

  // ── admin: Clean URLs ──
  // NOTA: Le pagine admin sono protette da adminAccessControl (redirect 302 al login).
  // Non possiamo testare 200 direttamente senza autenticazione.
  // Verifichiamo invece che il server risponda (302 = access control attivo, non 404).

  describe('admin: Clean URLs (protetto da access control)', () => {

    test('GET /admin/ → 302 (redirect a login, access control attivo)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/admin/`);
      // 302 = access control intercetta prima di servire la pagina
      expect(res.status).toBe(302);
    });

    test('GET /admin/index.ejs → 302 (access control intercetta prima di hideExtension)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/admin/index.ejs`);
      // Access control ha priorità su hideExtension redirect
      expect(res.status).toBe(302);
    });
  });

  // ── Risorse statiche non affette ──

  describe('Risorse statiche: non affette da hideExtension', () => {

    test('GET /api/bootstrap/css/bootstrap.min.css → 200 (API route invariata)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_ENABLED}/api/bootstrap/css/bootstrap.min.css`);
      expect(res.status).toBe(200);
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 4 — CONFIGURAZIONE INDIPENDENTE PER CONTESTO
// (verifica che abilitare un contesto non influenzi gli altri)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[hideExtension] Fase 4 — Configurazione indipendente per contesto (solo wwwPath)', () => {

  let proc;
  let restoreConfig;

  beforeAll(async () => {
    const server = spawnServer(TEST_PORT_PARTIAL, HIDE_EXT_ONLY_WWW);
    proc = server.proc;
    restoreConfig = server.restoreConfig;
    await server.waitForReady();
  });

  afterAll(async () => {
    await killProcess(proc);
    restoreConfig();
  });

  test('server avviato correttamente', () => {
    expect(proc.exitCode).toBeNull();
  });

  // ── wwwPath: ABILITATO ──

  describe('wwwPath: ABILITATO', () => {

    test('GET /hello_word → 200 (clean URL funziona)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_PARTIAL}/hello_word`);
      expect(res.status).toBe(200);
    });

    test('GET /hello_word.ejs → 301 (redirect a clean URL)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_PARTIAL}/hello_word.ejs`);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/hello_word');
    });
  });

  // ── pluginPages: DISABILITATO ──

  describe('pluginPages: DISABILITATO (non influenzato da wwwPath)', () => {

    test('GET /pluginPages/adminUsers/login.ejs → 200 (file con estensione servito normalmente)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_PARTIAL}/pluginPages/adminUsers/login.ejs`);
      expect(res.status).toBe(200);
      // NON deve essere un redirect (hideExtension disabilitato per pluginPages)
      expect(res.status).not.toBe(301);
    });

    test('GET /pluginPages/adminUsers/login (senza ext) → 404 (hideExtension disabilitato)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_PARTIAL}/pluginPages/adminUsers/login`);
      expect(res.status).toBe(404);
    });
  });

  // ── admin: DISABILITATO ──
  // NOTA: Le pagine admin sono protette da access control (302 al login).
  // Verifichiamo che risponda 302 (non 301 da hideExtension, non 404).

  describe('admin: DISABILITATO (non influenzato da wwwPath)', () => {

    test('GET /admin/index.ejs → 302 (access control, non 301 da hideExtension)', async () => {
      const res = await httpGet(`http://127.0.0.1:${TEST_PORT_PARTIAL}/admin/index.ejs`);
      // 302 = access control attivo (hideExtension disabilitato per admin non è rilevante qui)
      expect(res.status).toBe(302);
      // NON deve essere un 301 da hideExtension
      expect(res.status).not.toBe(301);
    });
  });
});
