/**
 * tests/integration/cliBridge.test.js
 *
 * End-to-end test del CLI control plane:
 *   1. Patch temporaneo di ital8Config.json5 (http port libera, https off,
 *      socket path in os.tmpdir)
 *   2. spawn `node index.js`
 *   3. Attesa che il socket compaia su disco
 *   4. Esecuzione di `node bin/ital8cms-cli.js ...` con vari comandi
 *   5. Verifica anche del soft public stop (HTTP GET / → 503)
 *   6. Cleanup: SIGTERM al server, restore della config, unlink del socket,
 *      ripristino file di stato cliBridge
 *
 * NOTA: i test `admin start/stop` non sono eseguiti qui perché farebbero
 * scattare un restart reale del processo, distruggendo il setup. La logica
 * è coperta dagli unit test (configEditor, protocol.test.js).
 */

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const json5 = require('json5');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CLIENT_PATH = path.join(PROJECT_ROOT, 'bin', 'ital8cms-cli.js');
const STATE_PATH = path.join(PROJECT_ROOT, 'core', 'cliBridge', 'state.json5');

const TEST_HTTP_PORT = 19500;
const TEST_SOCKET = path.join(
  os.tmpdir(),
  `ital8cms-cli-int-${process.pid}-${Date.now()}.sock`
);

jest.setTimeout(60000);

let serverProc = null;
let originalConfigRaw = null;
let originalStateRaw = null;
let serverOutput = '';

function patchConfig() {
  originalConfigRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = json5.parse(originalConfigRaw);
  const testCfg = {
    ...cfg,
    httpPort: TEST_HTTP_PORT,
    https: { ...(cfg.https || {}), enabled: false },
    cli: {
      enabled: true,
      socketPath: TEST_SOCKET,
      socketMode: '0600',
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testCfg, null, 2), 'utf8');
}

function snapshotState() {
  if (fs.existsSync(STATE_PATH)) {
    originalStateRaw = fs.readFileSync(STATE_PATH, 'utf8');
  }
}

function restoreConfig() {
  if (originalConfigRaw !== null) {
    fs.writeFileSync(CONFIG_PATH, originalConfigRaw, 'utf8');
    originalConfigRaw = null;
  }
}

function restoreState() {
  if (originalStateRaw !== null) {
    fs.writeFileSync(STATE_PATH, originalStateRaw, 'utf8');
  } else {
    try { fs.unlinkSync(STATE_PATH); } catch (_) {}
  }
}

function waitForSocket(timeoutMs = 25000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(TEST_SOCKET)) return resolve();
      if (serverProc && serverProc.exitCode !== null) {
        return reject(new Error(
          `server exited (code ${serverProc.exitCode}) before socket appeared\n--- server output ---\n${serverOutput}`
        ));
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(
          `timeout (${timeoutMs}ms) waiting for socket ${TEST_SOCKET}\n--- server output ---\n${serverOutput}`
        ));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function runClient(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLIENT_PATH, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function httpGet(reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: TEST_HTTP_PORT, path: reqPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('http timeout')));
  });
}

function httpPost(reqPath, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: TEST_HTTP_PORT, path: reqPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let payload = '';
      res.on('data', (c) => { payload += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: payload }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('http timeout')));
    req.end(body);
  });
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 5000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    try { proc.kill('SIGTERM'); } catch (_) { clearTimeout(forceKill); resolve(); }
  });
}

beforeAll(async () => {
  snapshotState();
  patchConfig();
  serverProc = spawn('node', ['index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (c) => { serverOutput += c.toString(); });
  serverProc.stderr.on('data', (c) => { serverOutput += c.toString(); });
  await waitForSocket();
});

afterAll(async () => {
  await killProc(serverProc);
  restoreConfig();
  restoreState();
  try { fs.unlinkSync(TEST_SOCKET); } catch (_) {}
});

describe('cliBridge status', () => {
  test('status (--json) returns ok with pid, ports, admin/public running', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(typeof payload.data.pid).toBe('number');
    expect(payload.data.pid).toBeGreaterThan(0);
    expect(payload.data.httpPort).toBe(TEST_HTTP_PORT);
    expect(payload.data.httpsEnabled).toBe(false);
    expect(payload.data.httpsPort).toBeNull();
    // `unreachable` segnala che il pannello, pur acceso, e' irraggiungibile
    // perche' la superficie riservata che lo contiene e' chiusa.
    expect(payload.data.admin).toEqual({ state: 'running', unreachable: false });
    expect(payload.data.reserved).toEqual({ state: 'running' });
    expect(payload.data.public).toEqual({ state: 'running' });
    expect(typeof payload.data.uptime).toBe('number');
    expect(payload.data.uptime).toBeGreaterThanOrEqual(0);
  });

  test('status (human-readable) prints expected lines', async () => {
    const r = await runClient(['--socket', TEST_SOCKET, 'status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/ital8cms running/);
    expect(r.stdout).toMatch(/pid:\s+\d+/);
    expect(r.stdout).toMatch(new RegExp(`http:\\s+${TEST_HTTP_PORT}`));
    expect(r.stdout).toMatch(/https:\s+disabled/);
    expect(r.stdout).toMatch(/admin state:\s+running/);
    expect(r.stdout).toMatch(/reserved state:\s+running/);
    expect(r.stdout).toMatch(/public state:\s+running/);
  });
});

describe('cliBridge public stop/start (soft, no restart)', () => {
  // Order matters: stop first, then verify, then start, then verify again.
  // Each test depends on the previous state — keep them in order in one describe.

  test('public stop returns ok + restart:false, writes state file', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('public.stop');
    expect(payload.restart).toBe(false);
    expect(fs.readFileSync(STATE_PATH, 'utf8')).toMatch(/"public"\s*:\s*"stopped"/);
  });

  test('status reflects public=stopped after stop', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.data.public.state).toBe('stopped');
    expect(payload.data.admin.state).toBe('running');
  });

  test('GET / returns 503 + Retry-After + X-Robots-Tag when public is stopped', async () => {
    const r = await httpGet('/');
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(r.body).toMatch(/Torniamo subito/);
  });

  test('GET /admin/ still works when public is stopped (admin exempt)', async () => {
    const r = await httpGet('/admin/');
    // admin returns either 200 (page renders), 302 (redirect to login),
    // 403/401 (auth required) — anything except 503 is acceptable here.
    // The point is: admin must NOT be intercepted by the maintenance gate.
    expect(r.status).not.toBe(503);
    // Confirm the maintenance page body was not served either
    expect(r.body).not.toMatch(/Torniamo subito/);
  });

  test('public stop is idempotent (noop) when already stopped', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.noop).toBe(true);
  });

  test('public start restores serving', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('public.start');
    expect(payload.restart).toBe(false);
    expect(fs.readFileSync(STATE_PATH, 'utf8')).toMatch(/"public"\s*:\s*"running"/);
  });

  test('GET / no longer returns 503 after start', async () => {
    const r = await httpGet('/');
    expect(r.status).not.toBe(503);
  });

  test('public start is idempotent (noop) when already running', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.noop).toBe(true);
  });

  test('human output of public stop/start mentions the action', async () => {
    const rStop = await runClient(['--socket', TEST_SOCKET, 'public', 'stop']);
    expect(rStop.code).toBe(0);
    expect(rStop.stdout).toMatch(/public\.stop/);

    const rStart = await runClient(['--socket', TEST_SOCKET, 'public', 'start']);
    expect(rStart.code).toBe(0);
    expect(rStart.stdout).toMatch(/public\.start/);
  });
});

describe('cliBridge transport errors', () => {
  test('client reports not_running when socket does not exist', async () => {
    const bogusSocket = path.join(os.tmpdir(), `ital8cms-cli-bogus-${Date.now()}.sock`);
    const r = await runClient(['--json', '--socket', bogusSocket, 'status']);
    expect(r.code).toBe(1);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload).toMatchObject({ ok: false, error: 'not_running' });
    expect(payload.message).toMatch(/non sembra in esecuzione/);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUPERFICIE RISERVATA — il perimetro end-to-end
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// L'ordine conta: stop → verifiche → start → verifiche. Come per public,
// ogni test dipende dallo stato lasciato dal precedente.

describe('cliBridge reserved stop/start (soft, no restart)', () => {
  test('reserved stop returns ok + restart:false, writes state file', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('reserved.stop');
    expect(payload.restart).toBe(false);
    expect(fs.readFileSync(STATE_PATH, 'utf8')).toMatch(/"reserved"\s*:\s*"stopped"/);
  });

  test('status reports reserved stopped and admin unreachable', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.data.reserved.state).toBe('stopped');
    // enableAdmin resta true: e' proprio il caso in cui `unreachable` conta.
    expect(payload.data.admin).toEqual({ state: 'running', unreachable: true });
  });

  // Il cuore della feature: ogni faccia della superficie riservata deve dare 404,
  // e devono darlo TUTTE ALLO STESSO MODO — una risposta diversa dalle altre
  // ridiventa un canale di fingerprinting.
  test.each([
    ['/admin/',                                'pannello admin (prefisso)'],
    ['/admin-theme-resources/css/theme.css',   'risorse del tema admin (prefisso)'],
    ['/pluginPages/adminUsers/login.ejs',      'pagina di login (isAuthEntryPoint via regola)'],
    ['/pluginPages/adminUsers/userProfile.ejs','pagina autenticata (requiresAuth via regola)'],
    ['/api/adminUsers/logged',                 'rotta isAuthEntryPoint'],
    ['/api/adminUsers/userList',               'rotta requiresAuth'],
    ['/api/admin/ping',                        'sonda del plugin admin'],
    ['/api/adminUsers/login',                  'varco POST interrogato in GET (niente 405)'],
  ])('GET %s → 404 when reserved is stopped (%s)', async (urlPath) => {
    const r = await httpGet(urlPath);
    expect(r.status).toBe(404);
  });

  test('the public site keeps working while reserved is stopped', async () => {
    const r = await httpGet('/api/bootstrap/css/bootstrap.min.css');
    expect(r.status).toBe(200);
  });

  // Un prefisso riservato non deve inghiottire i suoi fratelli pubblici.
  test('a public page whose name merely starts with the admin prefix still works', async () => {
    const publicPage = path.join(PROJECT_ROOT, 'www', 'admin-guide.ejs');
    fs.writeFileSync(publicPage, '<h1>guida pubblica</h1>', 'utf8');
    try {
      const r = await httpGet('/admin-guide.ejs');
      expect(r.status).toBe(200);
      expect(r.body).toContain('guida pubblica');
    } finally { fs.unlinkSync(publicPage); }
  });

  // GUARDIA ANTI-DERIVA E CUORE DELLA PROMESSA: la risposta di un percorso
  // riservato deve essere INDISTINGUIBILE da quella di un percorso che non e mai
  // esistito. Non basta "404": corpo e header devono coincidere, e le forme sono
  // due (sotto /api risponde Koa, altrove la error page del file server).
  // Se koa-classic-server cambia la sua pagina, e questo test a fallire — invece
  // che le due risposte a divergere in silenzio.
  test.each([
    ['/api/adminUsers/logged',                '/api/adminUsers/zzz-non-esiste'],
    ['/api/adminUsers/userList',              '/api/adminUsers/zzz-non-esiste'],
    ['/pluginPages/adminUsers/login.ejs',     '/pluginPages/adminUsers/zzz-non-esiste.ejs'],
    ['/pluginPages/adminUsers/logout.ejs',    '/pluginPages/adminUsers/zzz-non-esiste.ejs'],
    ['/admin-theme-resources/css/theme.css',  '/admin-theme-resources/css/zzz-non-esiste.css'],
    ['/admin/',                               '/zzz-non-esiste.ejs'],
  ])('%s is byte-identical to a genuine 404 (%s)', async (reservedPath, genuineMissingPath) => {
    const reserved = await httpGet(reservedPath);
    const genuine = await httpGet(genuineMissingPath);

    expect(reserved.status).toBe(genuine.status);
    expect(reserved.body).toBe(genuine.body);

    // Header volatili esclusi: cambiano a ogni richiesta e non sono un segnale.
    const VOLATILE = new Set(['date', 'set-cookie', 'connection', 'keep-alive']);
    const stable = (headers) => Object.fromEntries(
      Object.entries(headers).filter(([name]) => !VOLATILE.has(name.toLowerCase()))
    );
    expect(stable(reserved.headers)).toEqual(stable(genuine.headers));
  });

  test('reserved stop is idempotent (noop) when already stopped', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.noop).toBe(true);
  });

  test('reserved start reopens the surface without a restart', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'start']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.restart).toBe(false);

    // Il login torna raggiungibile: 404 non e' piu' la risposta.
    const login = await httpGet('/pluginPages/adminUsers/login.ejs');
    expect(login.status).not.toBe(404);
    // E il pannello torna a comportarsi come prima (302 verso il login da anonimo).
    const admin = await httpGet('/admin/');
    expect(admin.status).not.toBe(404);
  });
});

// Con entrambi i gate chiusi il sito deve rispondere 503 OVUNQUE. Prima, i
// percorsi esenti dal maintenance (login) e i prefissi admin davano 404 mentre
// tutto il resto dava 503: la differenza era essa stessa una mappa della
// superficie riservata.
describe('cliBridge public stop + reserved stop (uniformita)', () => {
  beforeAll(async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']);
    await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
  });

  afterAll(async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'start']);
  });

  test.each([
    ['/'],
    ['/robots.txt'],
    ['/pluginPages/adminUsers/login.ejs'],
    ['/admin/'],
    ['/admin-theme-resources/css/theme.css'],
    ['/api/adminUsers/logged'],
  ])('%s answers 503 like everything else', async (urlPath) => {
    const r = await httpGet(urlPath);
    expect(r.status).toBe(503);
  });
});

// Un 403 da CSRF racconta che dietro quel path c'e' un endpoint che accetta POST:
// e' lo stesso canale di fingerprinting dei 401/405, solo per un'altra porta.
// Il route-wrap controlla infatti la superficie riservata PRIMA del CSRF, e il
// gate chiude comunque il path prima ancora del router. Questo test blocca
// entrambe le regressioni possibili: un riordino del wrap, o un buco nell'indice.
describe('superficie riservata — nessun 403 CSRF a superficie chiusa', () => {
  beforeAll(async () => { await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']); });
  afterAll(async () => { await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'start']); });

  test.each([
    ['/api/adminUsers/login',  'username=x&password=y'],
    ['/api/adminUsers/logout', ''],
  ])('POST %s senza token CSRF risponde 404, non 403', async (urlPath, body) => {
    const r = await httpPost(urlPath, body);
    expect(r.status).toBe(404);
    expect(r.body).not.toMatch(/csrf/i);
  });

  test('a superficie APERTA lo stesso POST torna a essere respinto dal CSRF (403)', async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'start']);
    const r = await httpPost('/api/adminUsers/login', 'username=x&password=y');
    // Il punto non e' il codice esatto, ma che il comportamento pre-esistente
    // sia tornato: la richiesta viene VALUTATA invece che ignorata.
    expect(r.status).not.toBe(404);
    await runClient(['--json', '--socket', TEST_SOCKET, 'reserved', 'stop']);
  });
});
