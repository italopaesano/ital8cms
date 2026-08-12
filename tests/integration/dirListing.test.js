/**
 * tests/integration/dirListing.test.js
 *
 * Elenco automatico del contenuto di una directory senza file indice
 * (`ital8Config.json5 → dirListing.wwwPath`), sul server reale.
 *
 * PERCHE UN TEST D'INTEGRAZIONE: la proprietà da verificare non è «il flag viene
 * letto» ma «con l'elenco spento la radice del sito continua a funzionare», e
 * quella dipende interamente da come koa-classic-server compone risoluzione
 * dell'indice ed elenco. Fino alla v5.1.0 le due cose erano annidate — la ricerca
 * dell'indice viveva DENTRO il ramo `if (options.dirListing.enabled)` — quindi
 * spegnere l'elenco faceva rispondere 404 anche a `/` con `index: ["index.ejs"]`
 * configurato e il file presente. Corretto nella v5.2.0 (modulo mantenuto dal
 * team, vedi CLAUDE.md regola 4): questo test è il presidio contro la regressione.
 *
 * I DUE ESITI CHE NON VANNO CONFUSI: «l'indice è tornato» e «l'elenco è stato
 * riacceso» sono cose diverse, e solo la prima è quella voluta. Per questo ogni
 * fase interroga sia una directory CON indice (`/`, `/dirListingFixture/`) sia una
 * SENZA (`/media/`): la seconda smaschera un elenco riacceso per sbaglio.
 *
 * Porte riservate: 19310 (spento) e 19311 (acceso).
 */

'use strict';

jest.setTimeout(60000);

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const json5 = require('json5');

const PROJECT_ROOT = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const TEST_WWW_PATH = '/tests/www';

const PORT_OFF = 19310;
const PORT_ON = 19311;

// Directory di tests/www usate dalle asserzioni.
//
// `media/` è vuota nel repo: è proprio il caso "nessun indice" che serve qui, e va
// garantita esistente perché git non traccia le directory vuote.
//
// La sottodirectory CON indice va invece creata: le uniche che esistono già
// (`lib/`, `private/`, `reserved/`) sono protette da accessControl e rispondono
// 401, che qui confonderebbe il segnale — un 401 non dice nulla su indice ed
// elenco. Serve una directory pubblica e banale.
const EMPTY_DIR = path.join(PROJECT_ROOT, 'tests', 'www', 'media');
const INDEXED_DIR = path.join(PROJECT_ROOT, 'tests', 'www', 'dirListingFixture');

function httpGet(port, urlPath, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${urlPath}`)));
    req.on('error', reject);
    req.end();
  });
}

/** True se il corpo è un elenco di directory prodotto da koa-classic-server. */
function isListing(body) {
  return /<title>Index of /.test(body);
}

function spawnServer(httpPort, dirListingConfig) {
  const originalRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const original = json5.parse(originalRaw);

  const testConf = {
    ...original,
    httpPort,
    debugMode: 0,
    wwwPath: TEST_WWW_PATH,
    activeTheme: 'themeForTesting',
    adminActiveTheme: 'themeForTestingAdmin',
    dirListing: dirListingConfig,
    https: { ...original.https, enabled: false },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConf, null, 2), 'utf8');

  const proc = spawn('node', ['index.js'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const restoreConfig = () => fs.writeFileSync(CONFIG_PATH, originalRaw, 'utf8');

  const waitForReady = (timeoutMs = 30000) => new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener('data', onData);
      proc.stderr.removeListener('data', onData);
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes(`server started on port: ${httpPort}`)) {
        cleanup();
        setTimeout(() => resolve(buf), 500);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout in attesa del server\n${buf}`));
    }, timeoutMs);
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      cleanup();
      reject(new Error(`Server uscito (codice ${code}) prima di essere pronto\n${buf}`));
    });
  });

  return { proc, restoreConfig, waitForReady };
}

async function killProcess(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const force = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 3000);
    proc.once('exit', () => { clearTimeout(force); resolve(); });
    proc.kill('SIGTERM');
  });
}

// La sitemap di tests/www è un file TRACCIATO che il plugin `seo` rigenera a ogni
// boot leggendo le directory con un file indice: la fixture qui sotto ci finirebbe
// dentro, sporcando il working tree con una voce che non appartiene al repository.
// Si fotografa prima e si riscrive dopo, come già si fa con ital8Config.json5.
const SITEMAP_PATH = path.join(PROJECT_ROOT, 'tests', 'www', 'sitemap.xml');
let sitemapSnapshot = null;

beforeAll(() => {
  if (!fs.existsSync(EMPTY_DIR)) fs.mkdirSync(EMPTY_DIR, { recursive: true });
  sitemapSnapshot = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : null;
  fs.mkdirSync(INDEXED_DIR, { recursive: true });
  fs.writeFileSync(path.join(INDEXED_DIR, 'index.ejs'), 'INDICE DELLA SOTTODIRECTORY\n', 'utf8');
});

afterAll(() => {
  fs.rmSync(INDEXED_DIR, { recursive: true, force: true });
  if (sitemapSnapshot !== null) fs.writeFileSync(SITEMAP_PATH, sitemapSnapshot, 'utf8');
});

// ── Fase 1 — configurazione ──────────────────────────────────────────────────

describe('dirListing — configurazione', () => {
  test('il .default dichiara la chiave, spenta', () => {
    const dflt = json5.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'ital8Config.default.json5'), 'utf8'));
    expect(dflt.dirListing).toEqual({ wwwPath: false });
  });

  // Una chiave di sicurezza non deve accendersi per omissione: se `dirListing`
  // manca del tutto (config a mano, o boot prima del merge additivo) l'elenco
  // resta spento. Il mapping vive in index.js; qui se ne presidia la forma.
  test('assente o non booleana → spento; solo `true` esplicito accende', () => {
    const enabledFor = (conf) => conf.dirListing?.wwwPath === true;
    expect(enabledFor({})).toBe(false);
    expect(enabledFor({ dirListing: {} })).toBe(false);
    expect(enabledFor({ dirListing: { wwwPath: false } })).toBe(false);
    expect(enabledFor({ dirListing: { wwwPath: 'true' } })).toBe(false);
    expect(enabledFor({ dirListing: { wwwPath: true } })).toBe(true);
  });
});

// ── Fase 2 — elenco SPENTO (il default) ──────────────────────────────────────

describe('dirListing.wwwPath: false — il default', () => {
  let server;

  beforeAll(async () => {
    server = spawnServer(PORT_OFF, { wwwPath: false });
    try {
      await server.waitForReady();
    } catch (err) {
      server.restoreConfig();
      throw err;
    }
  });

  afterAll(async () => {
    await killProcess(server.proc);
    server.restoreConfig();
  });

  // LA REGRESSIONE DA PRESIDIARE: con koa-classic-server 5.1.0 questa era 404.
  test('la radice serve il suo index.ejs (non 404)', async () => {
    const res = await httpGet(PORT_OFF, '/');
    expect(res.status).toBe(200);
    expect(isListing(res.body)).toBe(false);
  });

  test('una sottodirectory con indice serve il suo index.ejs', async () => {
    const res = await httpGet(PORT_OFF, '/dirListingFixture/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('INDICE DELLA SOTTODIRECTORY');
    expect(isListing(res.body)).toBe(false);
  });

  test('una directory SENZA indice risponde 404 e non elenca nulla', async () => {
    const res = await httpGet(PORT_OFF, '/media/');
    expect(res.status).toBe(404);
    expect(isListing(res.body)).toBe(false);
  });

  test('l\'accesso diretto a un file non è toccato', async () => {
    const res = await httpGet(PORT_OFF, '/robots.txt');
    expect(res.status).toBe(200);
  });
});

// ── Fase 3 — elenco ACCESO (scelta esplicita dell'amministratore) ────────────

describe('dirListing.wwwPath: true — scelta esplicita', () => {
  let server;

  beforeAll(async () => {
    server = spawnServer(PORT_ON, { wwwPath: true });
    try {
      await server.waitForReady();
    } catch (err) {
      server.restoreConfig();
      throw err;
    }
  });

  afterAll(async () => {
    await killProcess(server.proc);
    server.restoreConfig();
  });

  test('una directory senza indice viene elencata', async () => {
    const res = await httpGet(PORT_ON, '/media/');
    expect(res.status).toBe(200);
    expect(isListing(res.body)).toBe(true);
  });

  // L'indice vince sull'elenco anche con l'elenco acceso: sono due cose distinte,
  // ed è la distinzione che la 5.1.0 non faceva.
  test('una directory CON indice serve l\'indice, non l\'elenco', async () => {
    const res = await httpGet(PORT_ON, '/');
    expect(res.status).toBe(200);
    expect(isListing(res.body)).toBe(false);
  });
});
