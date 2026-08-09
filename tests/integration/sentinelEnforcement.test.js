/**
 * tests/integration/sentinelEnforcement.test.js
 *
 * End-to-end del filtro `sentinel` su un server reale.
 *
 * PERCHE UN TEST D'INTEGRAZIONE E NON SOLO UNIT: la promessa centrale del
 * blocco — «un percorso filtrato è indistinguibile da uno che non è mai
 * esistito» — non è verificabile su un doppio. Dipende da quale static server
 * gestisce quella famiglia di path, da come `koa-classic-server` compone la
 * propria error page e dagli header che aggiunge. Va misurata su risposte vere.
 *
 * Setup: patch temporanea di `ital8Config.json5` (porta e socket dedicati) e dei
 * due config vivi di sentinel (`mode: enforce`, una regola in `block`), spawn di
 * `node index.js`, richieste HTTP reali, ripristino di tutto in afterAll.
 *
 * I config vivi di sentinel sono git-ignored e rigenerabili dai `.default`: la
 * patch è sicura anche se il test viene interrotto a metà.
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
const SENTINEL_DIR = path.join(PROJECT_ROOT, 'plugins', 'sentinel');
const SENTINEL_CONFIG = path.join(SENTINEL_DIR, 'pluginConfig.json5');
const SENTINEL_RULES = path.join(SENTINEL_DIR, 'sentinelRules.json5');
const SENTINEL_DATA = path.join(SENTINEL_DIR, 'data');

const TEST_HTTP_PORT = 19540;
const TEST_SOCKET = path.join(os.tmpdir(), `ital8cms-sentinel-int-${process.pid}-${Date.now()}.sock`);

jest.setTimeout(60000);

let serverProc = null;
let serverOutput = '';
const originals = new Map();

function snapshot(filePath) {
  originals.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null);
}

function restoreAll() {
  for (const [filePath, content] of originals) {
    if (content === null) { try { fs.unlinkSync(filePath); } catch (_) {} }
    else fs.writeFileSync(filePath, content, 'utf8');
  }
  originals.clear();
}

/** Regole dedicate al test: path che non esistono nel sito, così non interferiscono. */
const TEST_RULES = {
  schemaVersion: 1,
  rules: [
    {
      name: 'test-block-php',
      enabled: true,
      category: 'cms-probe',
      description: 'blocco per il test di identità del 404',
      action: 'block',
      match: { extension: ['php'] },
    },
    {
      name: 'test-monitor-env',
      enabled: true,
      category: 'sensitive-file',
      description: 'osservazione: deve lasciar passare',
      action: 'monitor',
      match: { path: '/.env' },
    },
  ],
};

function patchEnvironment() {
  [CONFIG_PATH, SENTINEL_CONFIG, SENTINEL_RULES, STATE_PATH].forEach(snapshot);

  const cfg = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    ...cfg,
    httpPort: TEST_HTTP_PORT,
    https: { ...(cfg.https || {}), enabled: false },
    cli: { enabled: true, socketPath: TEST_SOCKET, socketMode: '0600' },
  }, null, 2), 'utf8');

  // Il config vivo può non esistere (clone fresco): si parte dal .default.
  const liveOrDefault = fs.existsSync(SENTINEL_CONFIG)
    ? SENTINEL_CONFIG
    : path.join(SENTINEL_DIR, 'pluginConfig.default.json5');
  const sentinelCfg = json5.parse(fs.readFileSync(liveOrDefault, 'utf8'));
  sentinelCfg.custom.mode = 'enforce';
  sentinelCfg.custom.log = { ...(sentinelCfg.custom.log || {}), flushIntervalSeconds: 0 };
  fs.writeFileSync(SENTINEL_CONFIG, JSON.stringify(sentinelCfg, null, 2), 'utf8');

  fs.writeFileSync(SENTINEL_RULES, JSON.stringify(TEST_RULES, null, 2), 'utf8');
  fs.rmSync(SENTINEL_DATA, { recursive: true, force: true });
  try { fs.unlinkSync(STATE_PATH); } catch (_) {}
}

function waitForSocket(timeoutMs = 25000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(TEST_SOCKET)) return resolve();
      if (serverProc && serverProc.exitCode !== null) {
        return reject(new Error(`server exited (${serverProc.exitCode})\n${serverOutput}`));
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`timeout waiting for socket\n${serverOutput}`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Attende che il server HTTP accetti connessioni.
 *
 * NON basta `waitForSocket()`: il socket del control plane viene creato subito
 * dopo i priority middleware, mentre il server HTTP parte in fondo a `startApp()`
 * — dopo il caricamento dei plugin e dei temi. Fra i due eventi passa qualche
 * secondo, e una richiesta lanciata in mezzo prende ECONNREFUSED.
 */
function waitForHttp(timeoutMs = 25000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port: TEST_HTTP_PORT, path: '/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (serverProc && serverProc.exitCode !== null) {
          return reject(new Error(`server exited (${serverProc.exitCode})\n${serverOutput}`));
        }
        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error(`timeout waiting for HTTP\n${serverOutput}`));
        }
        setTimeout(tick, 200);
      });
      req.setTimeout(2000, () => req.destroy(new Error('probe timeout')));
    };
    tick();
  });
}

function httpGet(reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: TEST_HTTP_PORT, path: reqPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('http timeout')));
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

function readEvents() {
  if (!fs.existsSync(SENTINEL_DATA)) return [];
  return fs.readdirSync(SENTINEL_DATA)
    .filter((f) => f.startsWith('sentinel') && f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(SENTINEL_DATA, f), 'utf8')
      .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean));
}

const eventsFor = (p) => readEvents().filter((e) => e.path === p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  patchEnvironment();
  serverProc = spawn('node', ['index.js'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stdout.on('data', (c) => { serverOutput += c.toString(); });
  serverProc.stderr.on('data', (c) => { serverOutput += c.toString(); });
  await waitForSocket();
  await waitForHttp();
});

afterAll(async () => {
  if (serverProc && serverProc.exitCode === null) {
    await new Promise((resolve) => {
      const force = setTimeout(() => { try { serverProc.kill('SIGKILL'); } catch (_) {} }, 5000);
      serverProc.once('exit', () => { clearTimeout(force); resolve(); });
      try { serverProc.kill('SIGTERM'); } catch (_) { clearTimeout(force); resolve(); }
    });
  }
  restoreAll();
  fs.rmSync(SENTINEL_DATA, { recursive: true, force: true });
  try { fs.unlinkSync(TEST_SOCKET); } catch (_) {}
});

describe('sentinel — il motore è nello slot', () => {
  test('il boot installa il motore pre-router', () => {
    expect(serverOutput).toContain('motore installato nello slot pre-router');
  });

  test('status distingue lo stato del gate dalla presenza del motore', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.data.sentinel).toEqual({ state: 'running', engine: true });
  });
});

// IL CUORE DELLA PROMESSA. Non basta che il blocco risponda 404: deve rispondere
// il 404 che quel sito darebbe per un URL che non è mai esistito. Le forme sono
// DUE — sotto /api risponde Koa (text/plain), altrove la error page del file
// server — e sentinel non ne fabbrica nessuna: delega a reservedGate.deny().
// Se koa-classic-server cambia la sua pagina, è questo test a fallire, invece
// che le due risposte a divergere in silenzio.
describe('sentinel — il 404 di blocco è indistinguibile da un 404 autentico', () => {
  test.each([
    ['/zzz-sentinel.php',              '/zzz-non-esiste-affatto.ejs',        'pagina'],
    ['/api/adminUsers/zzz.php',        '/api/adminUsers/zzz-non-esiste',     'rotta API'],
    ['/pluginPages/adminUsers/z.php',  '/pluginPages/adminUsers/zzz.ejs',    'plugin page'],
  ])('%s è byte-identico a %s (%s)', async (blockedPath, genuinePath) => {
    const blocked = await httpGet(blockedPath);
    const genuine = await httpGet(genuinePath);

    expect(blocked.status).toBe(404);
    expect(blocked.status).toBe(genuine.status);
    expect(blocked.body).toBe(genuine.body);

    const VOLATILE = new Set(['date', 'set-cookie', 'connection', 'keep-alive']);
    const stable = (h) => Object.fromEntries(
      Object.entries(h).filter(([name]) => !VOLATILE.has(name.toLowerCase())));
    expect(stable(blocked.headers)).toEqual(stable(genuine.headers));
  });

  test('sotto /api la forma è quella di Koa, non la pagina HTML', async () => {
    const blocked = await httpGet('/api/adminUsers/zzz.php');
    expect(blocked.headers['content-type']).toMatch(/text\/plain/);
    expect(blocked.body).toBe('Not Found');
  });

  test('altrove la forma è la error page del file server', async () => {
    const blocked = await httpGet('/zzz-sentinel.php');
    expect(blocked.headers['content-type']).toMatch(/text\/html/);
    expect(blocked.body).toContain('<h1>Not Found</h1>');
  });

  test('nessun header rivela l esistenza del filtro', async () => {
    const blocked = await httpGet('/zzz-sentinel.php');
    // X-Sentinel-Rule esiste solo con debugMode >= 1: in un config di test che
    // eredita quello reale non deve comparire per caso.
    const rivelatori = Object.keys(blocked.headers).filter((h) => /sentinel/i.test(h));
    if (Number(json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).debugMode) < 1) {
      expect(rivelatori).toEqual([]);
    }
  });
});

describe('sentinel — monitor osserva senza agire', () => {
  test('una regola in monitor lascia passare la richiesta', async () => {
    const r = await httpGet('/.env');
    // Il file non esiste: quel che conta è che NON sia il blocco a deciderlo,
    // cioè che la richiesta sia arrivata al file server.
    expect(r.status).toBe(404);
    await sleep(300);
    const eventi = eventsFor('/.env');
    expect(eventi.length).toBeGreaterThan(0);
    expect(eventi[0].enforced).toBe(false);
    expect(eventi[0].ruleName).toBe('test-monitor-env');
  });

  test('una regola in block registra l evento come enforced', async () => {
    await httpGet('/zzz-registrato.php');
    await sleep(300);
    const eventi = eventsFor('/zzz-registrato.php');
    expect(eventi.length).toBeGreaterThan(0);
    expect(eventi[0].enforced).toBe(true);
    expect(eventi[0].ruleName).toBe('test-block-php');
    expect(eventi[0].ip).toBeTruthy();      // IP pieno, scelta esplicita
    expect(eventi[0].fp).toBeTruthy();
  });
});

// Bloccare acme-challenge impedisce il rinnovo dei certificati Let's Encrypt e
// fa cadere l'HTTPS dopo 90 giorni, con una causa che nessuno collegherebbe al
// plugin di sicurezza. È una precondizione del core, non una regola.
describe('sentinel — esenzioni non negoziabili', () => {
  test('/.well-known/ non viene né filtrato né osservato', async () => {
    await httpGet('/.well-known/acme-challenge/zzz-token.php');
    await sleep(300);
    expect(eventsFor('/.well-known/acme-challenge/zzz-token.php')).toHaveLength(0);
  });
});

describe('sentinel — il control plane commuta a caldo', () => {
  afterAll(async () => { await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'start']); });

  test('sentinel monitor ferma l enforcement SENZA perdere i dati', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'monitor']);
    expect(JSON.parse(r.stdout.trim()).ok).toBe(true);

    // Il discriminante NON può essere il corpo della risposta: quel percorso non
    // esiste comunque, quindi bloccato o no il visitatore vede lo stesso 404 —
    // che è esattamente la proprietà verificata più sopra. La differenza sta
    // nell'evento registrato.
    await httpGet('/zzz-sotto-monitor.php');
    await sleep(300);

    // È la ragione per cui `monitor` esiste accanto a `stop`: l'osservazione
    // resta, e con lei i dati che servono a capire cosa è andato storto.
    const eventi = eventsFor('/zzz-sotto-monitor.php');
    expect(eventi.length).toBeGreaterThan(0);
    expect(eventi[0].enforced).toBe(false);
  });

  test('sentinel stop non interroga nemmeno il motore', async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'stop']);
    await httpGet('/zzz-sotto-stop.php');
    await sleep(300);
    expect(eventsFor('/zzz-sotto-stop.php')).toHaveLength(0);
  });

  test('sentinel start ripristina il comportamento dichiarato nei file', async () => {
    await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'start']);
    const r = await httpGet('/zzz-dopo-start.php');
    expect(r.status).toBe(404);
    await sleep(300);
    const eventi = eventsFor('/zzz-dopo-start.php');
    expect(eventi.length).toBeGreaterThan(0);
    expect(eventi[0].enforced).toBe(true);
  });

  test('nessuno dei comandi richiede un riavvio', async () => {
    const pidPrima = JSON.parse((await runClient(['--json', '--socket', TEST_SOCKET, 'status'])).stdout.trim()).data.pid;
    await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'monitor']);
    await runClient(['--json', '--socket', TEST_SOCKET, 'sentinel', 'start']);
    const pidDopo = JSON.parse((await runClient(['--json', '--socket', TEST_SOCKET, 'status'])).stdout.trim()).data.pid;
    expect(pidDopo).toBe(pidPrima);
  });
});

describe('sentinel — il sito continua a funzionare', () => {
  test('una risorsa pubblica non è toccata dal filtro', async () => {
    const r = await httpGet('/api/bootstrap/css/bootstrap.min.css');
    expect(r.status).toBe(200);
  });
});
