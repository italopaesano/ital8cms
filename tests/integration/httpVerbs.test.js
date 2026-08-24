// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * I VERBI HTTP su tutte le superfici che ital8cms serve.
 *
 * PERCHÉ ESISTE
 * -------------
 * Fino alla v2.94.0 nessun test del progetto emetteva una richiesta `HEAD`, e la
 * conseguenza è misurata: `koa-classic-server` accettava di default il solo
 * `GET`, quindi un `HEAD` cadeva su `next()` e finiva **404 su ogni file statico
 * del sito** — `www`, risorse dei temi, pagine dei plugin — mentre `GET`
 * rispondeva 200. Un server che afferma «questa risorsa non esiste» su file che
 * serve regolarmente. Cache, reverse proxy, link-checker e monitor di uptime
 * leggevano quel « non esiste ».
 *
 * La suite è rimasta verde prima e dopo la correzione, perché la copertura era
 * unidimensionale: tutti i test parlavano un verbo solo. Questo file aggiunge la
 * dimensione mancante.
 *
 * COSA VERIFICA
 * -------------
 *  1. `HEAD` rispecchia `GET` (RFC 9110 §9.3.2) su TUTTE e cinque le istanze di
 *     koa-classic-server più le rotte del router: stesso status, stesso
 *     `Content-Length`, corpo vuoto.
 *  2. `OPTIONS` — caratterizzazione del comportamento attuale, così un cambiamento
 *     diventa deliberato invece che accidentale.
 *  3. La superficie riservata è chiusa **per verbo**, non solo per path: con
 *     `reserved stop` un `HEAD` deve prendere lo stesso 404 di un `GET`. Se il
 *     gate discriminasse per metodo, `HEAD` sarebbe una porta di servizio per
 *     enumerare ciò che il 404 deve nascondere.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const json5 = require('json5');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CLIENT_PATH = path.join(PROJECT_ROOT, 'bin', 'ital8cms-cli.js');
// La sitemap di tests/www è un file TRACCIATO che il plugin `seo` rigenera a ogni
// boot: va fotografata e riscritta, come già fa dirListing.test.js.
const SITEMAP_PATH = path.join(PROJECT_ROOT, 'tests', 'www', 'sitemap.xml');

const TEST_HTTP_PORT = 19340;
const TEST_SOCKET = path.join(os.tmpdir(), `ital8cms-verbs-${process.pid}-${Date.now()}.sock`);

let serverProc = null;
let serverOutput = '';
let configSnapshot = null;
let sitemapSnapshot = null;

/** Richiesta HTTP con verbo arbitrario. */
function request(method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: TEST_HTTP_PORT, path: reqPath, method },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c.toString(); });
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          bodyBytes: Buffer.byteLength(body),
        }));
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error(`timeout ${method} ${reqPath}`)));
    req.end();
  });
}

function runClient(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLIENT_PATH, ...args], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.on('close', (code) => resolve({ code, stdout }));
  });
}

function waitForHttp(timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: TEST_HTTP_PORT, path: '/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (serverProc && serverProc.exitCode !== null) {
          return reject(new Error(`server uscito (${serverProc.exitCode})\n${serverOutput}`));
        }
        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error(`timeout in attesa di HTTP\n${serverOutput}`));
        }
        setTimeout(tick, 200);
      });
      req.setTimeout(2000, () => req.destroy(new Error('probe timeout')));
    };
    tick();
  });
}

function waitForSocket(timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(TEST_SOCKET)) return resolve();
      if (serverProc && serverProc.exitCode !== null) {
        return reject(new Error(`server uscito (${serverProc.exitCode})\n${serverOutput}`));
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`timeout in attesa del socket\n${serverOutput}`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

beforeAll(async () => {
  configSnapshot = fs.readFileSync(CONFIG_PATH, 'utf8');
  sitemapSnapshot = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : null;

  const cfg = json5.parse(configSnapshot);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    ...cfg,
    httpPort: TEST_HTTP_PORT,
    debugMode: 0,
    wwwPath: '/tests/www',
    activeTheme: 'themeForTesting',
    adminActiveTheme: 'themeForTestingAdmin',
    https: { ...(cfg.https || {}), enabled: false },
    cli: { enabled: true, socketPath: TEST_SOCKET, socketMode: '0600' },
  }, null, 2), 'utf8');

  serverProc = spawn('node', ['index.js'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stdout.on('data', (c) => { serverOutput += c.toString(); });
  serverProc.stderr.on('data', (c) => { serverOutput += c.toString(); });

  await waitForHttp();
  await waitForSocket();
}, 60000);

afterAll(async () => {
  if (serverProc && serverProc.exitCode === null) {
    await new Promise((resolve) => {
      const force = setTimeout(() => { try { serverProc.kill('SIGKILL'); } catch (_) {} }, 3000);
      serverProc.once('exit', () => { clearTimeout(force); resolve(); });
      serverProc.kill('SIGTERM');
    });
  }
  if (configSnapshot !== null) fs.writeFileSync(CONFIG_PATH, configSnapshot, 'utf8');
  if (sitemapSnapshot !== null) fs.writeFileSync(SITEMAP_PATH, sitemapSnapshot, 'utf8');
  try { fs.unlinkSync(TEST_SOCKET); } catch (_) {}
}, 30000);

// Le sei superfici che servono contenuto, una per istanza di koa-classic-server
// più il router. Se domani ne nascesse una settima, il buco si vedrebbe qui.
const SURFACES = [
  ['/robots.txt',                            'file statico di www'],
  ['/index.ejs',                             'template EJS di www'],
  ['/public-theme-resources/css/theme.css',  'risorsa del tema pubblico'],
  ['/admin-theme-resources/css/theme.css',   'risorsa del tema admin'],
  ['/pluginPages/adminUsers/login.ejs',      'pagina di un plugin'],
  ['/api/adminUsers/logged',                 'rotta del router'],
];

describe('HEAD rispecchia GET su ogni superficie (RFC 9110 §9.3.2)', () => {
  test.each(SURFACES)('%s — stesso status, stesso Content-Length, corpo vuoto (%s)', async (urlPath) => {
    const get = await request('GET', urlPath);
    const head = await request('HEAD', urlPath);

    // Precondizione: la risorsa deve esistere, altrimenti il test confronterebbe
    // due 404 e si dichiarerebbe soddisfatto senza aver verificato niente.
    expect(get.status).toBe(200);

    expect(head.status).toBe(get.status);
    expect(head.headers['content-length']).toBe(get.headers['content-length']);
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    // «no body» è il senso stesso di HEAD.
    expect(head.bodyBytes).toBe(0);
  });

  test('anche un 404 è rispecchiato: HEAD non inventa un esito diverso', async () => {
    const get = await request('GET', '/zzz-non-esiste-affatto.ejs');
    const head = await request('HEAD', '/zzz-non-esiste-affatto.ejs');

    expect(get.status).toBe(404);
    expect(head.status).toBe(404);
    expect(head.bodyBytes).toBe(0);
  });
});

describe('OPTIONS — caratterizzazione del comportamento attuale', () => {
  // NON un contratto desiderato: una fotografia. Oggi `OPTIONS` è gestito dal solo
  // `router.allowedMethods()`; le istanze statiche lasciano passare i verbi diversi
  // da GET/HEAD e la richiesta finisce 404. Se un giorno si volesse rispondere
  // anche lì, questi test falliscono e obbligano a una scelta deliberata.
  test('su una rotta del router: 200 con Allow che elenca GET e HEAD', async () => {
    const res = await request('OPTIONS', '/api/adminUsers/logged');

    expect(res.status).toBe(200);
    expect(res.headers.allow).toBeDefined();
    expect(res.headers.allow).toMatch(/GET/);
    // HEAD compare perché @koa/router lo deriva da GET: è la stessa parità
    // verificata sopra, dichiarata in un header.
    expect(res.headers.allow).toMatch(/HEAD/);
  });

  test.each([
    ['/robots.txt',                           'file statico di www'],
    ['/public-theme-resources/css/theme.css', 'risorsa del tema pubblico'],
    ['/pluginPages/adminUsers/login.ejs',     'pagina di un plugin'],
  ])('%s — le istanze statiche non gestiscono OPTIONS: 404 (%s)', async (urlPath) => {
    const res = await request('OPTIONS', urlPath);
    expect(res.status).toBe(404);
  });
});

describe('la superficie riservata è chiusa per VERBO, non solo per path', () => {
  // Il cuore della cosa. Il 404 della superficie riservata serve a non far capire
  // che cosa esiste: se il gate discriminasse per metodo, `HEAD` diventerebbe una
  // porta di servizio per enumerare esattamente ciò che il 404 deve nascondere.
  const RESERVED = [
    ['/admin/',                          'pannello admin (per prefisso)'],
    ['/pluginPages/adminUsers/login.ejs', 'entry point di autenticazione'],
  ];

  beforeAll(async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']);
    expect(r.code).toBe(0);
  }, 20000);

  afterAll(async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'start']);
  }, 20000);

  test('precondizione: con reserved stop un GET riservato risponde 404', async () => {
    // Senza questa verifica, i confronti sotto potrebbero passare su un gate
    // che non è mai stato chiuso.
    const res = await request('GET', '/admin/');
    expect(res.status).toBe(404);
  });

  test.each(RESERVED)('%s — HEAD prende lo stesso 404 di GET (%s)', async (urlPath) => {
    const get = await request('GET', urlPath);
    const head = await request('HEAD', urlPath);

    expect(get.status).toBe(404);
    expect(head.status).toBe(404);
    expect(head.headers['content-length']).toBe(get.headers['content-length']);
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.bodyBytes).toBe(0);
  });

  test('il 404 riservato è indistinguibile da quello di una risorsa mai esistita', async () => {
    // Vale per entrambi i verbi: un HEAD che rispondesse in modo anche solo
    // leggermente diverso rivelerebbe che dietro c'è qualcosa.
    const genuine = await request('HEAD', '/zzz-mai-esistita.ejs');
    const reserved = await request('HEAD', '/pluginPages/adminUsers/login.ejs');

    expect(reserved.status).toBe(genuine.status);
    expect(reserved.headers['content-type']).toBe(genuine.headers['content-type']);
    expect(reserved.headers['content-length']).toBe(genuine.headers['content-length']);
  });
});
