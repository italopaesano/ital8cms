/**
 * Unit test di core/httpsManager.js — il server HTTP di redirect e le challenge ACME.
 *
 * Sono i due presìdi chiesti da REVIEW.md → A7, più i casi positivi che li
 * rendono leggibili. Perché qui e non in un test d'integrazione: quel server
 * NON passa dall'applicazione Koa, quindi è l'unico pezzo di codice del
 * progetto esposto a Internet senza alcuno strato davanti. Un difetto lì va
 * verificabile in isolamento — senza certificati, senza spawn, senza porte
 * fisse — altrimenti il presidio costa troppo per essere scritto.
 *
 * Le richieste dei casi di path traversal sono scritte su un socket GREZZO, non
 * con `http.request`: il client HTTP di Node può normalizzare il path, e un
 * test che non mette `..` sul filo verificherebbe un'altra cosa.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const net  = require('net');
const path = require('path');
const http = require('http');

const { createHttpRedirectServer, readAcmeToken, resolveRedirectHost } =
  require('../../../core/httpsManager');

// ── Helpers ───────────────────────────────────────────────────────────────────

const tempDirs = [];
const liveServers = [];

/** Crea un webroot con la cartella delle challenge e, se dato, un token dentro. */
function createWebroot({ tokenName, tokenBody } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8acme-'));
  tempDirs.push(dir);
  const challengeDir = path.join(dir, '.well-known', 'acme-challenge');
  fs.mkdirSync(challengeDir, { recursive: true });
  if (tokenName) fs.writeFileSync(path.join(challengeDir, tokenName), tokenBody, 'utf8');
  return { webroot: dir, challengeDir };
}

function startRedirectServer(conf, httpsPort = 443) {
  const server = createHttpRedirectServer(httpsPort, conf);
  liveServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Richiesta via client HTTP di Node (path già canonico). */
function get(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Richiesta scritta a mano sul socket: i byte arrivano al server esattamente
 * come sono scritti qui, `..` compresi.
 */
function rawGet(port, rawTarget, hostHeader = 'esempio.it') {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${rawTarget} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    let raw = '';
    socket.on('data', (c) => { raw += c.toString(); });
    socket.on('end', () => {
      const status = Number((raw.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);
      const location = (raw.match(/^Location: (.+)$/im) || [])[1];
      resolve({ status, location, raw });
    });
    socket.on('error', reject);
  });
}

afterEach(async () => {
  for (const server of liveServers) {
    await new Promise((resolve) => server.close(resolve));
  }
  liveServers.length = 0;
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.length = 0;
});

// ── Il presidio 1: il path traversal non spegne il processo ───────────────────

describe('ACME challenge — il path traversal che spegneva il sito (A7)', () => {
  // La catena del difetto: path.basename('/.well-known/acme-challenge/..') è
  // '..', path.join(dir, '..') è la cartella padre, existsSync su una directory
  // è true, readFileSync su una directory lancia EISDIR — sincrono e non
  // catturato, dentro un server che non ha Koa davanti. L'eccezione arrivava a
  // uncaughtException, dove processSafetyNet chiude il processo con
  // respawn: false. Una richiesta, nessuna autenticazione, sito giù.
  const TOKEN = 'aBcD1234efGh5678ijKl9012mnOp3456qrSt';

  test.each([
    ['/.well-known/acme-challenge/..',               'la directory padre'],
    ['/.well-known/acme-challenge/../../etc/passwd', 'un file di sistema'],
    ['/.well-known/acme-challenge/.',                'la directory stessa'],
    ['/.well-known/acme-challenge/',                 'nessun token'],
  ])('%s → 404, e il server resta vivo', async (target) => {
    const { webroot } = createWebroot({ tokenName: TOKEN, tokenBody: 'contenuto' });
    const { port } = await startRedirectServer({
      https: { acmeChallenge: { enabled: true, webroot } },
    });

    const res = await rawGet(port, target);

    expect(res.status).toBe(404);
    // La prova che l'handler non è esploso: il server risponde ancora.
    const dopo = await rawGet(port, `/.well-known/acme-challenge/${TOKEN}`);
    expect(dopo.status).toBe(200);
  });

  test('un token valido è servito, con il suo contenuto esatto', async () => {
    const { webroot } = createWebroot({ tokenName: TOKEN, tokenBody: 'payload.della-challenge' });
    const { port } = await startRedirectServer({
      https: { acmeChallenge: { enabled: true, webroot } },
    });

    const res = await get(port, `/.well-known/acme-challenge/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('payload.della-challenge');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  test('una query string in coda non impedisce di servire il token', async () => {
    // `req.url` è il target grezzo: senza togliere la query, l'ultimo segmento
    // sarebbe `tok?x=1` e la whitelist lo rifiuterebbe — rifiutando una
    // richiesta legittima.
    const { webroot } = createWebroot({ tokenName: TOKEN, tokenBody: 'ok' });
    const { port } = await startRedirectServer({
      https: { acmeChallenge: { enabled: true, webroot } },
    });

    const res = await get(port, `/.well-known/acme-challenge/${TOKEN}?probe=1`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  test('un token assente NON ricade sul redirect: 404, non 301', async () => {
    // Rimandare una challenge su HTTPS la fa fallire comunque — il certificato
    // è proprio quello che si sta tentando di ottenere.
    const { webroot } = createWebroot();
    const { port } = await startRedirectServer({
      https: { acmeChallenge: { enabled: true, webroot } },
    });

    const res = await get(port, `/.well-known/acme-challenge/${TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('con acmeChallenge disabilitato il path ACME torna a essere redirezionato', async () => {
    const { port } = await startRedirectServer({
      https: { publicHost: 'esempio.it', acmeChallenge: { enabled: false } },
    });

    const res = await get(port, '/.well-known/acme-challenge/qualsiasi');

    expect(res.status).toBe(301);
  });
});

// ── Il presidio 2: il Location non contiene un host estraneo ──────────────────

describe('redirect 301 — l\'header Host è scelto dal client (A7)', () => {
  test('con publicHost configurato, un Host estraneo NON finisce nel Location', async () => {
    const { port } = await startRedirectServer({ https: { publicHost: 'esempio.it' } });

    const res = await get(port, '/pagina', { host: 'attaccante.example' });

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://esempio.it/pagina');
    expect(res.headers.location).not.toContain('attaccante.example');
  });

  test('con publicHost configurato, l\'Host corretto è conservato', async () => {
    const { port } = await startRedirectServer({ https: { publicHost: 'esempio.it' } });

    const res = await get(port, '/pagina?a=1', { host: 'esempio.it' });

    expect(res.headers.location).toBe('https://esempio.it/pagina?a=1');
  });

  test('senza publicHost un Host di forma implausibile non finisce nel Location', async () => {
    // Comportamento storico conservato per gli Host plausibili, ma un valore
    // fuori forma non deve comparire in un header Location.
    const { port } = await startRedirectServer({ https: {} });

    const res = await rawGet(port, '/pagina', 'host con spazi');

    expect(res.status).toBe(301);
    expect(res.location).toBe('https://localhost/pagina');
  });

  test('la porta HTTPS compare nel Location solo se non è la 443', async () => {
    const conf = { https: { publicHost: 'esempio.it' } };

    const { port: p443 } = await startRedirectServer(conf, 443);
    expect((await get(p443, '/x')).headers.location).toBe('https://esempio.it/x');

    const { port: pAlt } = await startRedirectServer(conf, 8443);
    expect((await get(pAlt, '/x')).headers.location).toBe('https://esempio.it:8443/x');
  });
});

// ── I due moduli puri, caso per caso ─────────────────────────────────────────

describe('readAcmeToken — whitelist invece di path.basename', () => {
  const TOKEN = 'aBcD1234efGh5678ijKl9012mnOp3456qrSt';

  test('restituisce il contenuto di un token di forma valida', () => {
    const { challengeDir } = createWebroot({ tokenName: TOKEN, tokenBody: 'contenuto' });
    expect(readAcmeToken(challengeDir, TOKEN)).toBe('contenuto');
  });

  test.each([
    ['..',                      'risalita di directory'],
    ['../../etc/passwd',        'risalita con path'],
    ['.',                       'la directory stessa'],
    ['',                        'vuoto'],
    ['tok/con/slash',           'separatori di path'],
    ['troppocorto',             'sotto i 16 caratteri'],
    ['a'.repeat(129),           'oltre i 128 caratteri'],
    ['token.con.punti',         'caratteri fuori da base64url'],
    ['tok%2e%2e',               'risalita percent-encoded'],
  ])('rifiuta %s (%s)', (rawToken) => {
    const { challengeDir } = createWebroot({ tokenName: TOKEN, tokenBody: 'contenuto' });
    expect(readAcmeToken(challengeDir, rawToken)).toBeNull();
  });

  test('non lancia su una directory con nome di forma valida', () => {
    // È il caso EISDIR, la causa del DoS: qui deve tornare null, non esplodere.
    const { challengeDir } = createWebroot();
    fs.mkdirSync(path.join(challengeDir, TOKEN));
    expect(() => readAcmeToken(challengeDir, TOKEN)).not.toThrow();
    expect(readAcmeToken(challengeDir, TOKEN)).toBeNull();
  });

  test('senza challengeDir restituisce null invece di costruire un path', () => {
    expect(readAcmeToken(null, TOKEN)).toBeNull();
  });
});

describe('resolveRedirectHost', () => {
  test.each([
    ['attaccante.example', 'esempio.it', 'esempio.it',  'host estraneo → vince la config'],
    ['esempio.it',         'esempio.it', 'esempio.it',  'host corretto → conservato'],
    ['ESEMPIO.IT',         'esempio.it', 'ESEMPIO.IT',  'confronto senza case, valore conservato'],
    ['esempio.it:8080',    'esempio.it', 'esempio.it',  'la porta è ignorata nel confronto'],
    [undefined,            'esempio.it', 'esempio.it',  'Host assente → config'],
    ['esempio.it',         '',           'esempio.it',  'senza config, host plausibile conservato'],
    ['host con spazi',     '',           'localhost',   'senza config, host implausibile scartato'],
    ['',                   '',           'localhost',   'senza config, host vuoto scartato'],
  ])('%s + publicHost=%s → %s (%s)', (hostHeader, publicHost, atteso) => {
    expect(resolveRedirectHost(hostHeader, publicHost)).toBe(atteso);
  });
});
