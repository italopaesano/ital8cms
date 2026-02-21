/**
 * Integration Tests - HTTPS Server Setup
 *
 * Verifica il comportamento del server in tutti e 4 gli scenari di avvio:
 *   Scenario 1 - HTTP puro                  (https.enabled: false)
 *   Scenario 2 - HTTPS + redirect 301       (enabled, AutoRedirect: true)
 *   Scenario 3 - HTTPS + HTTP in parallelo  (enabled, AutoRedirect: false)
 *   Scenario 4 - Fallback HTTP              (enabled, certificati mancanti)
 *   Scenario 5 - Logica URL redirect        (porta 443 omessa, porta custom inclusa)
 *
 * Approccio (Opzione B - zero modifiche a index.js):
 *   - Backup di ital8Config.json5 prima di ogni scenario
 *   - Scrittura config di test (porte libere: HTTP 19000, HTTPS 19443)
 *   - Spawn di `node index.js` come processo figlio
 *   - Attesa del log di avvio per confermare che il server sia pronto
 *   - Richieste HTTP/HTTPS reali per verificare il comportamento
 *   - Kill del processo figlio al termine di ogni scenario
 *   - Ripristino di ital8Config.json5 originale in afterAll globale
 *
 * ATTENZIONE: Se il processo di test viene interrotto bruscamente (Ctrl+C, crash)
 *   prima dell'afterAll, ital8Config.json5 potrebbe restare nella versione di test.
 *   In tal caso, ripristinare manualmente da .git o dal backup automatico creato
 *   nel file ital8Config.json5.bak (se presente).
 *
 * Prerequisiti:
 *   - openssl deve essere disponibile nel PATH (per generare i certificati di test)
 *   - Le porte 19000 e 19443 devono essere libere sul sistema
 */

jest.setTimeout(45000);

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const json5 = require('json5');

// ── Costanti ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT  = path.join(__dirname, '../..');
const CONFIG_PATH   = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CERTS_DIR     = path.join(__dirname, '../fixtures/certs');
const TEST_HTTP_PORT  = 19000;
const TEST_HTTPS_PORT = 19443;

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Legge il contenuto raw di ital8Config.json5 per il backup.
 */
function readRawConfig() {
  return fs.readFileSync(CONFIG_PATH, 'utf8');
}

/**
 * Sovrascrive ital8Config.json5 con una versione di test.
 * Mantiene tutti i campi originali, sovrascrive solo httpPort e https.*.
 * @param {object} httpsOverride - Campi da sovrascrivere dentro il blocco "https"
 */
function writeTestConfig(httpsOverride) {
  const original = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const testConfig = {
    ...original,
    httpPort: TEST_HTTP_PORT,
    https: {
      ...original.https,
      ...httpsOverride,
      // hotReload disabilitato nei test: evita che fs.watch() tenga attivi
      // watcher nel processo figlio interferendo con il ciclo di vita del test
      hotReload: { enabled: false },
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2), 'utf8');
}

/**
 * Ripristina ital8Config.json5 dal contenuto raw salvato in precedenza.
 */
function restoreConfig(rawOriginal) {
  fs.writeFileSync(CONFIG_PATH, rawOriginal, 'utf8');
}

/**
 * Genera certificati self-signed per i test HTTPS (validi 1 giorno).
 * Crea la directory tests/fixtures/certs/ se non esiste.
 * @returns {{ certPath: string, keyPath: string }}
 */
function ensureTestCerts() {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }
  const certPath = path.join(CERTS_DIR, 'cert.pem');
  const keyPath  = path.join(CERTS_DIR, 'key.pem');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe' }
    );
  }
  return { certPath, keyPath };
}

/**
 * Avvia il server come processo figlio con `node index.js`.
 * @returns {import('child_process').ChildProcess}
 */
function spawnServer() {
  return spawn('node', ['index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Attende che il processo figlio emetta uno specifico frammento di testo
 * su stdout o stderr. Usa un buffer interno per gestire chunk parziali.
 *
 * @param {import('child_process').ChildProcess} proc - Processo figlio
 * @param {string} fragment - Frammento di testo atteso
 * @param {number} [timeoutMs=25000] - Timeout massimo in millisecondi
 * @returns {Promise<void>}
 */
function waitForLog(proc, fragment, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener('data', onData);
      proc.stderr.removeListener('data', onData);
      proc.removeListener('exit', onExit);
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes(fragment)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(
        `Il processo è uscito (codice ${code}) prima di emettere: "${fragment}"\n` +
        `Output catturato:\n${buffer}`
      ));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        `Timeout (${timeoutMs}ms) in attesa di: "${fragment}"\n` +
        `Output catturato:\n${buffer}`
      ));
    }, timeoutMs);

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', onExit);
  });
}

/**
 * Termina il processo figlio con SIGTERM, poi SIGKILL dopo 2s se necessario.
 * @param {import('child_process').ChildProcess} proc
 */
async function killServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();

    const forceKill = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
    }, 2000);

    proc.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

/**
 * Esegue una richiesta HTTP o HTTPS all'URL specificato.
 * Per HTTPS usa rejectUnauthorized: false (necessario per certificati self-signed).
 *
 * @param {string} url - URL completo (http:// o https://)
 * @param {object} [options] - Opzioni aggiuntive per http.request / https.request
 * @returns {Promise<{ status: number, headers: object }>}
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https://') ? https : http;
    const req = mod.request(url, { rejectUnauthorized: false, ...options }, (res) => {
      // Consuma il body per liberare il socket (evita ECONNRESET)
      res.resume();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout richiesta a ${url}`));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Setup/Teardown globale ────────────────────────────────────────────────────

let originalConfigRaw;
let testCerts;

beforeAll(() => {
  originalConfigRaw = readRawConfig();
  testCerts = ensureTestCerts();
});

afterAll(() => {
  // Ripristina sempre la config originale al termine di tutti i test
  restoreConfig(originalConfigRaw);
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 1 — HTTP puro (https.enabled: false)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Scenario 1 - HTTP puro (https.enabled: false)', () => {
  let server;

  beforeAll(async () => {
    writeTestConfig({ enabled: false });
    server = spawnServer();
    await waitForLog(server, `server started on port: ${TEST_HTTP_PORT}`);
  });

  afterAll(async () => {
    await killServer(server);
  });

  test('il server risponde su HTTP', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('HTTPS non è in ascolto (connessione rifiutata)', async () => {
    await expect(
      makeRequest(`https://localhost:${TEST_HTTPS_PORT}/`)
    ).rejects.toThrow();
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 2 — HTTPS abilitato con redirect 301 (AutoRedirect: true)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Scenario 2 - HTTPS + redirect 301 da HTTP (AutoRedirect: true)', () => {
  let server;

  beforeAll(async () => {
    writeTestConfig({
      enabled: true,
      port: TEST_HTTPS_PORT,
      AutoRedirectHttpPortToHttpsPort: true,
      certFile: testCerts.certPath,
      keyFile:  testCerts.keyPath,
      caFile:   '',
    });
    server = spawnServer();
    // Entrambi i server devono essere pronti prima di eseguire i test
    await Promise.all([
      waitForLog(server, `server started on HTTPS port: ${TEST_HTTPS_PORT}`),
      waitForLog(server, `HTTP port ${TEST_HTTP_PORT} \u2192 redirect 301 to HTTPS port ${TEST_HTTPS_PORT}`),
    ]);
  });

  afterAll(async () => {
    await killServer(server);
  });

  test('HTTP risponde con status 301', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.status).toBe(301);
  });

  test('Location header punta a HTTPS', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.headers.location).toMatch(/^https:\/\//);
  });

  test('Location header include la porta non-standard (:19443)', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.headers.location).toContain(`:${TEST_HTTPS_PORT}`);
  });

  test('Location header preserva il path originale', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/percorso/di/test`);
    expect(res.headers.location).toContain('/percorso/di/test');
  });

  test('HTTPS risponde (certificato self-signed accettato)', async () => {
    const res = await makeRequest(`https://localhost:${TEST_HTTPS_PORT}/`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 3 — HTTPS + HTTP in parallelo (AutoRedirect: false)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Scenario 3 - HTTPS + HTTP in parallelo (AutoRedirect: false)', () => {
  let server;

  beforeAll(async () => {
    writeTestConfig({
      enabled: true,
      port: TEST_HTTPS_PORT,
      AutoRedirectHttpPortToHttpsPort: false,
      certFile: testCerts.certPath,
      keyFile:  testCerts.keyPath,
      caFile:   '',
    });
    server = spawnServer();
    await Promise.all([
      waitForLog(server, `server started on HTTPS port: ${TEST_HTTPS_PORT}`),
      waitForLog(server, `server started on HTTP port: ${TEST_HTTP_PORT}`),
    ]);
  });

  afterAll(async () => {
    await killServer(server);
  });

  test('HTTP risponde normalmente (nessun redirect)', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(302);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('HTTPS risponde normalmente', async () => {
    const res = await makeRequest(`https://localhost:${TEST_HTTPS_PORT}/`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 4 — Fallback HTTP su certificati mancanti
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Scenario 4 - Fallback HTTP su certificati mancanti', () => {
  let server;
  let capturedOutput = '';

  beforeAll(async () => {
    writeTestConfig({
      enabled: true,
      port: TEST_HTTPS_PORT,
      AutoRedirectHttpPortToHttpsPort: false,
      certFile: './certs/INESISTENTE_fullchain.pem',
      keyFile:  './certs/INESISTENTE_privkey.pem',
      caFile:   '',
    });
    server = spawnServer();

    // Cattura tutto l'output (stdout + stderr) per verificare i log di errore
    server.stdout.on('data', (d) => { capturedOutput += d.toString(); });
    server.stderr.on('data', (d) => { capturedOutput += d.toString(); });

    await waitForLog(server, 'HTTP - HTTPS fallback per cert mancanti');
  });

  afterAll(async () => {
    await killServer(server);
  });

  test('il server risponde su HTTP (fallback attivo)', async () => {
    const res = await makeRequest(`http://localhost:${TEST_HTTP_PORT}/`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('HTTPS non è in ascolto (nessun server HTTPS avviato)', async () => {
    await expect(
      makeRequest(`https://localhost:${TEST_HTTPS_PORT}/`)
    ).rejects.toThrow();
  });

  test('i log contengono il messaggio di errore certificati', () => {
    expect(capturedOutput).toContain('[HTTPS] Errore nel caricamento dei certificati');
  });

  test('i log contengono il messaggio di fallback', () => {
    expect(capturedOutput).toContain('[HTTPS] Fallback');
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 5 — Logica costruzione URL redirect (nessun server spawniato)
//
// La porta 443 non può essere usata nei test (richiede privilegi root), quindi
// la logica di costruzione dell'URL di redirect viene verificata in isolamento,
// replicando esattamente il codice presente in index.js.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Scenario 5 - Logica URL redirect (porta 443 vs porta custom)', () => {
  /**
   * Replica la logica di costruzione del Location header da index.js:
   *   const portSuffix = httpsPort === 443 ? '' : ':' + httpsPort;
   *   'https://' + hostname + portSuffix + req.url
   */
  function buildRedirectLocation(httpsPort, host, reqUrl) {
    const portSuffix = httpsPort === 443 ? '' : ':' + httpsPort;
    const hostname   = (host || 'localhost').split(':')[0];
    return 'https://' + hostname + portSuffix + reqUrl;
  }

  test('porta 443 → URL di redirect senza :443', () => {
    const location = buildRedirectLocation(443, 'example.com', '/pagina');
    expect(location).toBe('https://example.com/pagina');
    expect(location).not.toContain(':443');
  });

  test('porta non-standard → URL di redirect con porta inclusa', () => {
    const location = buildRedirectLocation(8443, 'example.com', '/pagina');
    expect(location).toBe('https://example.com:8443/pagina');
  });

  test('porta 19443 (test) → URL di redirect con porta inclusa', () => {
    const location = buildRedirectLocation(19443, 'localhost', '/');
    expect(location).toBe('https://localhost:19443/');
  });

  test('hostname estratto correttamente da host:porta', () => {
    const location = buildRedirectLocation(443, 'example.com:8080', '/test');
    expect(location).toBe('https://example.com/test');
    expect(location).not.toContain(':8080');
  });

  test('path e query string preservati nel redirect', () => {
    const location = buildRedirectLocation(443, 'example.com', '/pagina?chiave=valore&altro=123');
    expect(location).toBe('https://example.com/pagina?chiave=valore&altro=123');
  });

  test('host mancante → fallback a localhost', () => {
    const location = buildRedirectLocation(8443, null, '/test');
    expect(location).toBe('https://localhost:8443/test');
  });
});
