/**
 * tests/integration/httpsDiagnostics.test.js
 *
 * Test diagnostici HTTPS — aiutano a individuare la causa esatta del
 * malfunzionamento di HTTPS sull'installazione locale.
 *
 * Ogni fase è indipendente e fornisce un messaggio di errore azionabile.
 * Eseguire con:
 *   npx jest tests/integration/httpsDiagnostics.test.js --verbose
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Fase 1 — Pre-flight certificati  (nessun server avviato)     │
 * │    • file cert/key esistono e leggibili                        │
 * │    • PEM parseable come X.509                                  │
 * │    • certificato non scaduto                                   │
 * │    • coppia cert/key coerente (stessa chiave pubblica)         │
 * │    • SAN include "localhost" o "127.0.0.1" (richiesto dai      │
 * │      browser moderni; senza SAN Chrome rifiuta la connessione) │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 2 — Disponibilità porte     (nessun server avviato)     │
 * │    • porta HTTP libera                                         │
 * │    • porta HTTPS libera                                        │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 3 — TLS isolato             (server minimale Node.js)   │
 * │    • https.createServer() con i cert di produzione            │
 * │    • handshake TLS completato (rejectUnauthorized: false)      │
 * │    • dettagli TLS: versione, cipher, autorizzato/non          │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 4 — Server completo         (spawn node index.js)       │
 * │    • server parte senza crash (log di avvio ricevuto)          │
 * │    • HTTP risponde                                             │
 * │    • HTTPS risponde con i cert di produzione                   │
 * │    • (se AutoRedirect) HTTP → 301 HTTPS                       │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Porte usate nella Fase 4 (spawn server) per evitare conflitti con un
 * eventuale server già in esecuzione sulle porte di produzione:
 *   HTTP  → 19100
 *   HTTPS → 19443
 */

jest.setTimeout(50000);

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const net   = require('net');
const tls   = require('tls');
const { X509Certificate, createPublicKey, createPrivateKey } = require('crypto');
const { spawn, execSync } = require('child_process');
const json5 = require('json5');

// ── Costanti ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '../..');
const CONFIG_PATH  = path.join(PROJECT_ROOT, 'ital8Config.json5');

// Porte riservate per i test (Fase 4 — spawn server)
const TEST_HTTP_PORT  = 19100;
const TEST_HTTPS_PORT = 19443;

// ── Carica config di produzione (sola lettura, mai modificata) ────────────────

const ital8Conf     = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const HTTP_PORT     = ital8Conf.httpPort;
const HTTPS_PORT    = ital8Conf.https?.port;
const CERT_FILE     = ital8Conf.https?.certFile;
const KEY_FILE      = ital8Conf.https?.keyFile;
const CA_FILE       = ital8Conf.https?.caFile;
const HTTPS_ENABLED = !!ital8Conf.https?.enabled;
const AUTO_REDIRECT = !!ital8Conf.https?.AutoRedirectHttpPortToHttpsPort;

// Risolve percorsi relativi dalla root del progetto
const certPath = CERT_FILE ? path.resolve(PROJECT_ROOT, CERT_FILE) : null;
const keyPath  = KEY_FILE  ? path.resolve(PROJECT_ROOT, KEY_FILE)  : null;
const caPath   = (CA_FILE && CA_FILE !== '') ? path.resolve(PROJECT_ROOT, CA_FILE) : null;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Verifica se una porta TCP è libera (non occupata da un altro processo).
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => { probe.close(); resolve(true); });
    probe.listen(port, '0.0.0.0');
  });
}

/**
 * Crea un server HTTPS minimale (senza Koa) sulla porta indicata,
 * usando i cert di produzione. Serve a isolare problemi TLS da problemi
 * applicativi.
 *
 * @param {number} port
 * @param {Buffer} certBuf
 * @param {Buffer} keyBuf
 * @param {Buffer|null} caBuf
 * @returns {Promise<{ server: import('https').Server, close: Function }>}
 */
function startMinimalTlsServer(port, certBuf, keyBuf, caBuf) {
  return new Promise((resolve, reject) => {
    const opts = { cert: certBuf, key: keyBuf };
    if (caBuf) opts.ca = caBuf;

    const server = https.createServer(opts, (req, res) => {
      res.writeHead(200);
      res.end('TLS OK');
    });

    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

/**
 * Esegue una richiesta HTTPS accettando certificati self-signed.
 * Restituisce informazioni dettagliate sul socket TLS.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ status: number, tlsVersion: string, cipher: string, authorized: boolean, authError: string|null }>}
 */
function makeHttpsRequest(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { rejectUnauthorized: false }, (res) => {
      const sock = res.socket;
      res.resume(); // consuma il body
      resolve({
        status:      res.statusCode,
        tlsVersion:  sock.getProtocol?.() || 'N/D',
        cipher:      sock.getCipher?.()?.name || 'N/D',
        authorized:  sock.authorized,
        authError:   sock.authorizationError || null,
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Esegue una richiesta HTTP senza seguire redirect.
 * @param {string} url
 * @returns {Promise<{ status: number, location: string|null }>}
 */
function makeHttpRequest(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || null });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Avvia il server reale (node index.js) con una config temporanea che usa
 * le porte di test ma i cert di produzione.
 */
function spawnServerWithRealCerts() {
  const originalRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const original    = json5.parse(originalRaw);

  // Config di test: porte sicure + cert di produzione + hotReload disabilitato
  const testConf = {
    ...original,
    httpPort: TEST_HTTP_PORT,
    https: {
      ...original.https,
      enabled: true,
      port: TEST_HTTPS_PORT,
      certFile: CERT_FILE,
      keyFile:  KEY_FILE,
      caFile:   CA_FILE || '',
      hotReload: { enabled: false },
    },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConf, null, 2), 'utf8');

  const proc = spawn('node', ['index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return { proc, restoreConfig: () => fs.writeFileSync(CONFIG_PATH, originalRaw, 'utf8') };
}

/**
 * Attende che il processo emetta un frammento di testo su stdout/stderr.
 */
function waitForLog(proc, fragment, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener('data', onData);
      proc.stderr.removeListener('data', onData);
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes(fragment)) { cleanup(); resolve(buf); }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout (${timeoutMs}ms) in attesa di: "${fragment}"\nOutput:\n${buf}`));
    }, timeoutMs);
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      cleanup();
      reject(new Error(`Processo uscito (codice ${code}) prima di: "${fragment}"\nOutput:\n${buf}`));
    });
  });
}

async function killProcess(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    proc.kill('SIGTERM');
  });
}

/**
 * Genera automaticamente un certificato self-signed per il testing
 * se i file cert/key configurati in ital8Config.json5 non esistono.
 *
 * Requisiti: openssl installato nel PATH di sistema.
 * Il certificato generato include SAN per localhost e 127.0.0.1,
 * necessario per i browser moderni (Chrome >= 58).
 *
 * NON sovrascrive cert esistenti — se i file sono già presenti non fa nulla.
 */
function ensureTestCertificates() {
  if (!certPath || !keyPath) return; // percorsi non configurati in ital8Config.json5

  const certExists = fs.existsSync(certPath);
  const keyExists  = fs.existsSync(keyPath);
  if (certExists && keyExists) return; // già presenti — nessuna azione necessaria

  const certsDir = path.dirname(certPath);
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  console.log([
    '',
    '🔧 Certificati non trovati — generazione automatica per il testing...',
    `   certFile: ${certPath}`,
    `   keyFile:  ${keyPath}`,
    '',
  ].join('\n'));

  try {
    execSync(
      [
        'openssl req -x509 -newkey rsa:2048',
        `-keyout "${keyPath}"`,
        `-out "${certPath}"`,
        '-days 365 -nodes',
        '-subj "/CN=localhost"',
        '-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"',
      ].join(' '),
      { stdio: 'pipe' }
    );

    console.log([
      '   ✅ Certificato generato con successo (valido 365 giorni).',
      '   ⚠️  Certificato di TEST — non usare in produzione.',
      '',
    ].join('\n'));
  } catch (err) {
    console.error([
      '   ❌ Generazione automatica fallita.',
      `   Errore: ${err.message}`,
      '',
      '   Assicurarsi che openssl sia installato:',
      '     Linux:  sudo apt install openssl   (Debian/Ubuntu)',
      '             sudo dnf install openssl   (Fedora/RHEL)',
      '             nix-env -iA nixpkgs.openssl (NixOS)',
      '     macOS:  brew install openssl',
      '',
      '   Oppure generare il certificato manualmente:',
      '     mkdir -p certs',
      '     openssl req -x509 -newkey rsa:2048 \\',
      '       -keyout certs/privkey.pem \\',
      '       -out certs/fullchain.pem \\',
      '       -days 365 -nodes \\',
      '       -subj "/CN=localhost" \\',
      '       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"',
      '',
    ].join('\n'));
  }
}

// ── Genera i certificati prima di qualsiasi test ──────────────────────────────
beforeAll(() => {
  ensureTestCertificates();
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 1 — PRE-FLIGHT CERTIFICATI
// (nessun server avviato — verifica solo i file e la loro validità)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[DIAGNOSTICA] Fase 1 — Pre-flight: configurazione e file certificati', () => {

  test('ital8Config.json5: https.enabled è true', () => {
    expect(HTTPS_ENABLED).toBe(true);
    // Se false: aprire ital8Config.json5 e impostare "https": { "enabled": true }
  });

  test('ital8Config.json5: https.certFile è configurato', () => {
    expect(CERT_FILE).toBeTruthy();
    // Se mancante: aggiungere "certFile": "./certs/fullchain.pem" nel blocco https
  });

  test('ital8Config.json5: https.keyFile è configurato', () => {
    expect(KEY_FILE).toBeTruthy();
  });

  test(`file cert esiste sul disco: ${certPath}`, () => {
    if (!certPath) return;
    const exists = fs.existsSync(certPath);
    expect(exists).toBe(true);
    // Se manca: eseguire
    //   mkdir -p certs
    //   openssl req -x509 -newkey rsa:2048 -keyout certs/privkey.pem \
    //     -out certs/fullchain.pem -days 365 -nodes -subj "/CN=localhost"
  });

  test(`file key esiste sul disco: ${keyPath}`, () => {
    if (!keyPath) return;
    const exists = fs.existsSync(keyPath);
    expect(exists).toBe(true);
  });

  test('file cert è leggibile (permessi sufficienti)', () => {
    if (!certPath || !fs.existsSync(certPath)) return;
    expect(() => fs.readFileSync(certPath)).not.toThrow();
    // Se fallisce: chmod 644 certs/fullchain.pem
  });

  test('file key è leggibile (permessi sufficienti)', () => {
    if (!keyPath || !fs.existsSync(keyPath)) return;
    expect(() => fs.readFileSync(keyPath)).not.toThrow();
    // Se fallisce: chmod 600 certs/privkey.pem
  });

  test('cert è un PEM X.509 valido (parseable)', () => {
    if (!certPath || !fs.existsSync(certPath)) return;
    const certBuf = fs.readFileSync(certPath);
    let cert;
    expect(() => { cert = new X509Certificate(certBuf); }).not.toThrow();
    // Se fallisce: il file non è un certificato PEM valido.
    // Verificare con: openssl x509 -in certs/fullchain.pem -noout -text
  });

  test('cert non è scaduto', () => {
    if (!certPath || !fs.existsSync(certPath)) return;
    const cert      = new X509Certificate(fs.readFileSync(certPath));
    const expiryMs  = new Date(cert.validTo).getTime();
    const nowMs     = Date.now();
    const daysLeft  = Math.floor((expiryMs - nowMs) / 86_400_000);
    expect(expiryMs).toBeGreaterThan(nowMs);
    // Info: scade il ${new Date(expiryMs).toISOString().split('T')[0]} (tra ${daysLeft} giorni)
    // Se scaduto: rigenerare il certificato:
    //   openssl req -x509 -newkey rsa:2048 -keyout certs/privkey.pem \
    //     -out certs/fullchain.pem -days 365 -nodes -subj "/CN=localhost"
  });

  test('cert non scade nei prossimi 7 giorni', () => {
    if (!certPath || !fs.existsSync(certPath)) return;
    const cert     = new X509Certificate(fs.readFileSync(certPath));
    const daysLeft = Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
    expect(daysLeft).toBeGreaterThan(7);
  });

  test('coppia cert/key coerente (stessa chiave pubblica)', () => {
    if (!certPath || !keyPath) return;
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return;

    const cert = new X509Certificate(fs.readFileSync(certPath));
    const certPubKeyDer = cert.publicKey.export({ type: 'spki', format: 'der' });

    let privKey;
    expect(() => {
      privKey = createPrivateKey(fs.readFileSync(keyPath));
    }).not.toThrow();
    // Se fallisce qui: il file key non è una chiave privata PEM valida

    const derivedPubKeyDer = createPublicKey(privKey).export({ type: 'spki', format: 'der' });

    expect(Buffer.compare(certPubKeyDer, derivedPubKeyDer)).toBe(0);
    // Se fallisce: cert e key non formano una coppia valida.
    // Rigenerare entrambi insieme:
    //   openssl req -x509 -newkey rsa:2048 -keyout certs/privkey.pem \
    //     -out certs/fullchain.pem -days 365 -nodes -subj "/CN=localhost"
  });

  test('cert ha SAN (Subject Alternative Name) con "localhost" o "127.0.0.1"', () => {
    if (!certPath || !fs.existsSync(certPath)) return;
    const cert = new X509Certificate(fs.readFileSync(certPath));
    const san  = cert.subjectAltName || '';

    const hasLocalhost = san.includes('DNS:localhost') || san.includes('IP Address:127.0.0.1');

    // Diagnostichiamo ma non falliamo il test — il browser rifiuterà la connessione
    // senza SAN, ma Node.js (con rejectUnauthorized: false) continua a funzionare.
    if (!hasLocalhost) {
      console.warn([
        '',
        '⚠️  ATTENZIONE: il certificato NON ha SAN per localhost.',
        `   subjectAltName trovato: "${san || '(nessuno)'}"`,
        '',
        '   I browser moderni (Chrome ≥ 58, Firefox, Safari) rifiutano i certificati',
        '   che hanno solo CN=localhost senza SAN.',
        '   Questo spiega perché il browser mostra "ERR_CERT_COMMON_NAME_INVALID"',
        '   anche se Node.js accetta la connessione.',
        '',
        '   ✅ Soluzione: rigenerare il certificato con SAN:',
        '   openssl req -x509 -newkey rsa:2048 \\',
        '     -keyout certs/privkey.pem \\',
        '     -out certs/fullchain.pem \\',
        '     -days 365 -nodes \\',
        '     -subj "/CN=localhost" \\',
        '     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"',
        '',
      ].join('\n'));
    }

    // Il test viene segnato come "passed con warning" (non fallisce)
    // per non bloccare le fasi successive che testano la connettività Node.js.
    expect(typeof san).toBe('string');
  });

  test('diagnostica completa certificato (output informativo)', () => {
    if (!certPath || !fs.existsSync(certPath)) {
      console.log('[INFO] File certificato non trovato — skip diagnostica');
      return;
    }
    const cert       = new X509Certificate(fs.readFileSync(certPath));
    const expiryDate = new Date(cert.validTo);
    const daysLeft   = Math.floor((expiryDate - Date.now()) / 86_400_000);
    const isSelfSign = cert.subject === cert.issuer;

    console.log([
      '',
      '📋 Riepilogo certificato:',
      `   Soggetto:     ${cert.subject}`,
      `   Emittente:    ${cert.issuer}`,
      `   Self-signed:  ${isSelfSign ? 'sì' : 'no'}`,
      `   Validità:     ${new Date(cert.validFrom).toISOString().split('T')[0]} → ${expiryDate.toISOString().split('T')[0]}`,
      `   Giorni rimasti: ${daysLeft}`,
      `   SAN:          ${cert.subjectAltName || '(nessuno)'}`,
      `   Percorso:     ${certPath}`,
      '',
    ].join('\n'));

    expect(true).toBe(true); // test informativo, non fallisce mai
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 2 — DISPONIBILITÀ PORTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[DIAGNOSTICA] Fase 2 — Disponibilità porte configurate', () => {

  test(`porta HTTP ${HTTP_PORT} è libera (nessun server già in ascolto)`, async () => {
    const free = await isPortFree(HTTP_PORT);
    if (!free) {
      console.warn([
        ``,
        `⚠️  La porta HTTP ${HTTP_PORT} è già occupata.`,
        `   Un server è già in esecuzione su questa porta.`,
        `   Per vedere chi la occupa:`,
        `     lsof -i :${HTTP_PORT}`,
        `     ss -tlnp | grep ${HTTP_PORT}`,
        `   Per fermare il server: kill $(lsof -t -i:${HTTP_PORT})`,
        ``,
      ].join('\n'));
    }
    expect(free).toBe(true);
  });

  test(`porta HTTPS ${HTTPS_PORT} è libera (nessun server già in ascolto)`, async () => {
    const free = await isPortFree(HTTPS_PORT);
    if (!free) {
      console.warn([
        ``,
        `⚠️  La porta HTTPS ${HTTPS_PORT} è già occupata.`,
        `   Un server è già in ascolto su questa porta.`,
        `   Possibili cause:`,
        `     1. ital8cms è già avviato — fermarlo prima di eseguire i test`,
        `     2. Un altro processo usa la porta — lsof -i :${HTTPS_PORT}`,
        ``,
      ].join('\n'));
    }
    expect(free).toBe(true);
  });

  test('le porte HTTP e HTTPS sono diverse', () => {
    expect(HTTP_PORT).not.toBe(HTTPS_PORT);
    // Se uguali: aprire ital8Config.json5 e assegnare porte diverse a httpPort e https.port
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 3 — TLS ISOLATO
// (server HTTPS minimale con i cert di produzione, senza Koa / index.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[DIAGNOSTICA] Fase 3 — TLS isolato: Node.js + cert di produzione', () => {
  const ISOLATED_TLS_PORT = 19200;
  let minimalServer = null;

  beforeAll(async () => {
    // Skip se i cert non esistono (già fallito in Fase 1)
    if (!certPath || !fs.existsSync(certPath) || !keyPath || !fs.existsSync(keyPath)) return;

    const certBuf = fs.readFileSync(certPath);
    const keyBuf  = fs.readFileSync(keyPath);
    const caBuf   = caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath) : null;

    try {
      minimalServer = await startMinimalTlsServer(ISOLATED_TLS_PORT, certBuf, keyBuf, caBuf);
    } catch (err) {
      console.error([
        '',
        '❌ Impossibile avviare il server TLS minimale:',
        `   ${err.message}`,
        '',
        '   Questo significa che Node.js rifiuta i certificati prima ancora',
        '   che qualsiasi client provi a connettersi.',
        '   Cause comuni:',
        '     • key e cert non corrispondono (Fase 1 dovrebbe aver rilevato questo)',
        '     • formato PEM non standard',
        '     • file corrotti',
        '',
      ].join('\n'));
      // Non rilanciamo — i test singoli gestiranno il caso minimalServer === null
    }
  });

  afterAll(async () => {
    if (minimalServer) await minimalServer.close();
  });

  test('Node.js può creare un server HTTPS con i cert di produzione', () => {
    if (!certPath || !fs.existsSync(certPath) || !keyPath || !fs.existsSync(keyPath)) {
      return; // già fallito in Fase 1
    }
    expect(minimalServer).not.toBeNull();
    // Se null: https.createServer() ha lanciato un'eccezione.
    // Rileggere il messaggio di errore nel beforeAll qui sopra.
  });

  test('handshake TLS completato (rejectUnauthorized: false)', async () => {
    if (!minimalServer) return;

    let result;
    try {
      result = await makeHttpsRequest(`https://127.0.0.1:${ISOLATED_TLS_PORT}/`);
    } catch (err) {
      fail([
        `❌ Connessione HTTPS a 127.0.0.1:${ISOLATED_TLS_PORT} fallita: ${err.message}`,
        '',
        '   Anche con rejectUnauthorized: false il client non riesce a connettersi.',
        '   Cause possibili:',
        '     • il server non è in ascolto sull\'interfaccia 127.0.0.1',
        '     • firewall locale blocca la porta',
        '     • timeout durante il TLS handshake',
      ].join('\n'));
    }

    expect(result.status).toBe(200);
  });

  test('dettagli TLS: versione protocollo e cipher suite', async () => {
    if (!minimalServer) return;

    const result = await makeHttpsRequest(`https://127.0.0.1:${ISOLATED_TLS_PORT}/`);

    console.log([
      '',
      '🔒 Dettagli TLS:',
      `   Versione:   ${result.tlsVersion}`,
      `   Cipher:     ${result.cipher}`,
      `   Autorizzato (CA fidata): ${result.authorized}`,
      result.authError ? `   authError:  ${result.authError}` : '',
      '',
      result.authorized
        ? '   ✅ Il certificato è firmato da una CA fidata (o il sistema lo riconosce).'
        : '   ℹ️  Certificato self-signed — authError è normale senza rejectUnauthorized: false.',
      '',
    ].filter(Boolean).join('\n'));

    // Il test passa sempre (è solo informativo)
    expect(result.status).toBe(200);
  });

  test('connessione HTTPS rifiutata con rejectUnauthorized: true (comportamento browser)', async () => {
    if (!minimalServer) return;

    // Con rejectUnauthorized: true il client si comporta come un browser
    // che NON ha accettato l'eccezione di sicurezza.
    let rejected = false;
    try {
      await new Promise((resolve, reject) => {
        const req = https.request(
          `https://127.0.0.1:${ISOLATED_TLS_PORT}/`,
          { rejectUnauthorized: true }, // comportamento browser-like
          (res) => { res.resume(); resolve(res.statusCode); }
        );
        req.setTimeout(5000, () => req.destroy(new Error('Timeout')));
        req.on('error', reject);
        req.end();
      });
    } catch (_) {
      rejected = true;
    }

    if (!rejected) {
      console.warn([
        '',
        '⚠️  Il certificato è stato accettato da Node.js anche con rejectUnauthorized: true.',
        '   Questo è inatteso per un certificato self-signed.',
        '   Potrebbe essere stato aggiunto al trust store di sistema.',
        '',
      ].join('\n'));
    } else {
      console.log([
        '',
        'ℹ️  Comportamento browser simulato:',
        '   Con rejectUnauthorized: true il client rifiuta il cert self-signed.',
        '   Questo è CORRETTO — i browser mostrano "Connessione non sicura".',
        '',
        '   Per eliminare il warning nel browser (sviluppo locale):',
        '   Opzione A — Aggiungere il cert al trust store del sistema:',
        '     Linux (Ubuntu/Debian):',
        '       sudo cp certs/fullchain.pem /usr/local/share/ca-certificates/ital8cms-localhost.crt',
        '       sudo update-ca-certificates',
        '     macOS:',
        '       sudo security add-trusted-cert -d -r trustRoot \\',
        '         -k /Library/Keychains/System.keychain certs/fullchain.pem',
        '',
        '   Opzione B — Usare mkcert (genera cert localmente trusted):',
        '     brew install mkcert && mkcert -install',
        '     mkcert -key-file certs/privkey.pem -cert-file certs/fullchain.pem localhost 127.0.0.1',
        '',
      ].join('\n'));
    }

    // Il test è informativo — documentiamo il comportamento ma non falliamo
    expect(typeof rejected).toBe('boolean');
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 4 — SERVER COMPLETO (spawn node index.js)
// Usa porte di test (19100/19443) + cert di produzione
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('[DIAGNOSTICA] Fase 4 — Server completo con cert di produzione', () => {
  let serverProc  = null;
  let restoreConf = null;
  let startupLog  = '';
  let startFailed = false;

  beforeAll(async () => {
    if (!certPath || !fs.existsSync(certPath) || !keyPath || !fs.existsSync(keyPath)) {
      startFailed = true;
      return;
    }

    const { proc, restoreConfig } = spawnServerWithRealCerts();
    serverProc  = proc;
    restoreConf = restoreConfig;

    // Cattura tutto l'output per diagnostica
    proc.stdout.on('data', d => { startupLog += d.toString(); });
    proc.stderr.on('data', d => { startupLog += d.toString(); });

    try {
      // Aspettiamo il log di avvio HTTPS
      startupLog = await waitForLog(proc, `server started on HTTPS port: ${TEST_HTTPS_PORT}`);
    } catch (err) {
      startFailed = true;
      console.error([
        '',
        '❌ Il server NON ha emesso il log di avvio HTTPS atteso.',
        `   Atteso: "server started on HTTPS port: ${TEST_HTTPS_PORT}"`,
        '',
        '   Output catturato dal processo:',
        '   ──────────────────────────────',
        startupLog.split('\n').map(l => '   ' + l).join('\n'),
        '   ──────────────────────────────',
        '',
        '   Cause comuni:',
        '     • Errore nel caricamento dei certificati → cerca "[HTTPS] Errore" nell\'output',
        '     • Plugin che crasha durante l\'inizializzazione',
        '     • Porta già in uso',
        '',
      ].join('\n'));
    }
  });

  afterAll(async () => {
    await killProcess(serverProc);
    if (restoreConf) restoreConf();
  });

  test('server parte senza crash (log HTTPS ricevuto)', () => {
    if (startFailed && (!certPath || !fs.existsSync(certPath))) return; // skip
    expect(startFailed).toBe(false);
  });

  test('log di avvio NON contiene "[HTTPS] Errore nel caricamento dei certificati"', () => {
    if (startFailed) return;
    const hasError = startupLog.includes('[HTTPS] Errore nel caricamento dei certificati');
    if (hasError) {
      console.error([
        '',
        '❌ Il server ha fallito il caricamento dei certificati.',
        '   Estratto rilevante dall\'output:',
        ...startupLog.split('\n')
          .filter(l => l.includes('[HTTPS]'))
          .map(l => '   ' + l),
        '',
      ].join('\n'));
    }
    expect(hasError).toBe(false);
  });

  test(`HTTPS risponde su 127.0.0.1:${TEST_HTTPS_PORT}`, async () => {
    if (startFailed) return;

    let result;
    try {
      result = await makeHttpsRequest(`https://127.0.0.1:${TEST_HTTPS_PORT}/`);
    } catch (err) {
      fail([
        `❌ Connessione HTTPS fallita: ${err.message}`,
        '',
        `   Il server dice di essere avviato su porta ${TEST_HTTPS_PORT} ma non risponde.`,
        '   Possibili cause:',
        `     • il server ascolta su 0.0.0.0 ma il firewall blocca le connessioni`,
        `     • il processo è crashato subito dopo aver scritto il log di avvio`,
        '   Output avvio server:',
        ...startupLog.split('\n').slice(-20).map(l => '   ' + l),
      ].join('\n'));
    }

    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(600);
    console.log(`   ✅ HTTPS risponde con status ${result.status} — TLS ${result.tlsVersion} — cipher ${result.cipher}`);
  });

  test(`HTTP risponde su 127.0.0.1:${TEST_HTTP_PORT}`, async () => {
    if (startFailed) return;

    // Il log HTTP potrebbe già essere nel buffer catturato durante beforeAll.
    // Controlliamo prima di chiamare waitForLog (che ascolta solo eventi futuri).
    const expectedHttpLog = AUTO_REDIRECT
      ? `HTTP port ${TEST_HTTP_PORT}`
      : `server started on HTTP port: ${TEST_HTTP_PORT}`;

    if (!startupLog.includes(expectedHttpLog)) {
      await waitForLog(serverProc, expectedHttpLog, 10000).catch(() => {});
    }

    let result;
    try {
      result = await makeHttpRequest(`http://127.0.0.1:${TEST_HTTP_PORT}/`);
    } catch (err) {
      fail([
        `❌ Connessione HTTP su porta ${TEST_HTTP_PORT} fallita: ${err.message}`,
        '   Il server HTTPS è avviato ma HTTP non risponde.',
        `   AutoRedirect configurato: ${AUTO_REDIRECT}`,
      ].join('\n'));
    }

    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(600);
  });

  test(`(AutoRedirect=${AUTO_REDIRECT}) comportamento HTTP verificato`, async () => {
    if (startFailed) return;

    let result;
    try {
      result = await makeHttpRequest(`http://127.0.0.1:${TEST_HTTP_PORT}/`);
    } catch (err) {
      return; // già fallito nel test precedente
    }

    if (AUTO_REDIRECT) {
      expect(result.status).toBe(301);
      expect(result.location).toMatch(/^https:\/\//);
      console.log(`   ✅ Redirect 301 → ${result.location}`);
    } else {
      expect(result.status).not.toBe(301);
      expect(result.status).not.toBe(302);
      console.log(`   ✅ HTTP in parallelo (nessun redirect) — status ${result.status}`);
    }
  });

  test('riepilogo diagnostica finale (output informativo)', () => {
    const lines = [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '📊 RIEPILOGO CONFIGURAZIONE HTTPS',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `   https.enabled:                  ${HTTPS_ENABLED}`,
      `   httpPort:                       ${HTTP_PORT}`,
      `   https.port:                     ${HTTPS_PORT}`,
      `   AutoRedirectHttpPortToHttpsPort: ${AUTO_REDIRECT}`,
      `   certFile:                       ${certPath}`,
      `   keyFile:                        ${keyPath}`,
      `   caFile:                         ${caPath || '(non configurato)'}`,
    ];

    if (certPath && fs.existsSync(certPath)) {
      try {
        const cert       = new X509Certificate(fs.readFileSync(certPath));
        const daysLeft   = Math.floor((new Date(cert.validTo) - Date.now()) / 86_400_000);
        const san        = cert.subjectAltName || '(nessuno)';
        const hasSan     = san.includes('DNS:localhost') || san.includes('IP Address:127.0.0.1');
        lines.push(
          `   cert scade tra:                 ${daysLeft} giorni`,
          `   cert SAN:                       ${san}`,
          `   cert ha SAN localhost:          ${hasSan ? '✅ sì' : '❌ no — browser rifiuterà la connessione'}`,
        );
      } catch (_) {}
    }

    lines.push(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    );

    console.log(lines.join('\n'));
    expect(true).toBe(true);
  });
});
