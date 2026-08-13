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
    // Prima di test-block-php di proposito: `/wp-login.php` matcherebbe anche
    // quella, e con first-match-wins l'ordine è la sola cosa che decide.
    {
      name: 'test-decoy-wp',
      enabled: true,
      category: 'cms-probe',
      description: 'decoy: serve il finto login WordPress al posto del 404',
      action: 'decoy',
      match: { path: '/wp-login.php' },
      decoy: { file: 'wp-login.html', headers: { 'X-Powered-By': 'PHP/7.4.33' } },
    },
    // Il ciclo completo del canary: questo decoy conia un token, e la regola
    // trappola più sotto lo riconosce quando torna indietro.
    {
      name: 'test-decoy-canary',
      enabled: true,
      category: 'sensitive-file',
      description: 'decoy con token esca: consegna un canary a chi cerca il .env',
      action: 'decoy',
      match: { path: '/zzz-canary-source' },
      decoy: { file: 'env.txt' },
    },
    {
      name: 'test-canary-used',
      enabled: true,
      category: 'canary',
      description: 'trappola: qualcuno ha usato un token consegnato da un decoy',
      action: 'block',
      match: { canary: 'known' },
    },
    {
      name: 'test-drop',
      enabled: true,
      category: 'scanner',
      description: 'drop: tronca la connessione senza rispondere',
      action: 'drop',
      match: { path: '/zzz-drop' },
    },
    {
      name: 'test-tarpit',
      enabled: true,
      category: 'scanner',
      description: 'tarpit: trattiene la connessione a gocce',
      action: 'tarpit',
      match: { path: '/zzz-tarpit' },
      tarpit: { seconds: 1.5 },
    },
    {
      name: 'test-decoy-assente',
      enabled: true,
      category: 'cms-probe',
      description: 'decoy che punta a un file inesistente: deve degradare al 404',
      action: 'decoy',
      match: { path: '/zzz-decoy-assente' },
      decoy: { file: 'questo-file-non-esiste.html' },
    },
    {
      name: 'test-redirect-interno',
      enabled: true,
      category: 'cms-probe',
      description: 'redirect: manda altrove invece di rispondere',
      action: 'redirect',
      match: { path: '/zzz-redirect' },
      redirect: { to: '/', status: 302 },
    },
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
    // `throttle` AGISCE (alimenta rateLimiter) ma non risponde: la richiesta deve
    // proseguire. Senza il ramo corretto il gate non trova un `respond` e degrada
    // al 404 comune, cioè la regola blocca invece di contare.
    //
    // Punta su una pagina che ESISTE, di proposito: su un percorso inesistente il
    // 404 del file server e il 404 del blocco sono byte-identici — è la promessa
    // centrale del plugin — quindi la risposta non distinguerebbe le due cose.
    // Con una pagina vera, «200» è la prova diretta che il filtro l'ha lasciata
    // passare. La pagina di login è pubblica ed è nel repository, quindi c'è
    // sempre; le altre asserzioni su `/pluginPages/adminUsers/` usano percorsi
    // diversi (`z.php`, `zzz.ejs`) e non la incrociano.
    {
      name: 'test-throttle',
      enabled: true,
      category: 'scanner',
      description: 'throttle: conta senza bloccare',
      action: 'throttle',
      match: { path: '/pluginPages/adminUsers/login.ejs' },
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

    // `set-cookie` NON è fra i volatili, ed è una correzione: escluderlo qui
    // rendeva questo test cieco proprio al canale che ha poi rivelato il filtro
    // dal vivo. Il 404 di sentinel esce da uno slot PRE-ROUTER, quello autentico
    // attraversa tutta la catena; finché un middleware toccava la sessione dei
    // visitatori senza cookie, il primo rispondeva con zero `Set-Cookie` e il
    // secondo con due. Il corpo era identico e nessun test se ne accorgeva.
    const VOLATILE = new Set(['date', 'connection', 'keep-alive']);
    const stable = (h) => Object.fromEntries(
      Object.entries(h).filter(([name]) => !VOLATILE.has(name.toLowerCase())));
    expect(stable(blocked.headers)).toEqual(stable(genuine.headers));
  });

  // Presidio esplicito del difetto misurato: un client SENZA cookie non deve
  // poter separare le due risposte contando gli header. È un test a sé perché
  // la parità sopra è un `toEqual` su un oggetto — questo dice cosa cercare a
  // chi legge il fallimento.
  test.each([
    ['/zzz-sentinel.php',             '/zzz-non-esiste-affatto.ejs'],
    ['/api/adminUsers/zzz.php',       '/api/adminUsers/zzz-non-esiste'],
  ])('%s e %s emettono lo stesso numero di Set-Cookie', async (blockedPath, genuinePath) => {
    const blocked = await httpGet(blockedPath);
    const genuine = await httpGet(genuinePath);

    const countCookies = (h) => {
      const raw = h['set-cookie'];
      if (raw === undefined) return 0;
      return Array.isArray(raw) ? raw.length : 1;
    };
    expect(countCookies(blocked.headers)).toBe(countCookies(genuine.headers));
    // E il numero atteso è zero: nessuna delle due risposte ha motivo di aprire
    // una sessione per chi non ne ha una.
    expect(countCookies(genuine.headers)).toBe(0);
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

// `throttle` è l'unica azione che agisce senza produrre una risposta, ed è
// esattamente per questo che era rotta: il gate, non trovando `respond`, cadeva
// sul proprio 404. Il README la documenta come «delega a rateLimiter SENZA
// bloccare», quindi il test verifica la promessa, non l'implementazione.
describe('sentinel — throttle conta senza bloccare', () => {
  const COPERTA = '/pluginPages/adminUsers/login.ejs';

  test('la pagina coperta dalla regola continua a essere servita', async () => {
    // LA PROVA. Prima della correzione questa rispondeva 404: il verdetto
    // chiedeva enforcement, il gate non trovava un `respond` e cadeva sul 404
    // comune. Con `mode: enforce` attivo, un 200 qui significa che il filtro ha
    // riconosciuto la regola e ha lasciato proseguire.
    const r = await httpGet(COPERTA);
    expect(r.status).toBe(200);
  });

  test('la regola ha comunque agito: l evento è registrato, ma non come blocco', async () => {
    await httpGet(COPERTA);
    await sleep(300);
    const eventi = eventsFor(COPERTA);
    expect(eventi.length).toBeGreaterThan(0);
    expect(eventi[0].ruleName).toBe('test-throttle');
    // `enforced` è il campo in cui il difetto si vedeva: vale insieme «ho
    // bloccato» per la colonna della dashboard e «conta come blocco» per il
    // censimento delle impronte, da cui la reputazione ricava suspect/bad.
    // Un throttle che lo mette a true fa condannare impronte per blocchi mai
    // avvenuti.
    expect(eventi[0].enforced).toBe(false);
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

// Le azioni che producono un corpo proprio. Un unit test sul renderer dice che
// il file viene letto e i segnaposto sostituiti; solo un test end-to-end dice
// che quel corpo arriva davvero al client al posto del 404, con lo stato e gli
// header giusti e senza che nulla a valle lo tocchi.
describe('sentinel — decoy e redirect producono la loro risposta', () => {
  test('il decoy prende il posto del 404, con i suoi header', async () => {
    const r = await httpGet('/wp-login.php');

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['x-powered-by']).toBe('PHP/7.4.33');
    expect(r.body).toContain('id="loginform"');

    // Fuori dalla pipeline EJS: nessun frammento del tema del sito, che
    // renderebbe il decoy riconoscibile a colpo d'occhio.
    expect(r.body).not.toContain('ital8cms');
  });

  test('due risposte non sono identiche: il nonce cambia', async () => {
    // È la ragione del livello 1. Un decoy uguale a se stesso viene riconosciuto
    // confrontando l'hash di due risposte.
    const [a, b] = await Promise.all([httpGet('/wp-login.php'), httpGet('/wp-login.php')]);
    expect(a.body).not.toBe(b.body);
  });

  test('il decoy scavalca la regola di blocco che lo segue', async () => {
    // /wp-login.php matcherebbe anche test-block-php: se rispondesse 404
    // vorrebbe dire che first-match-wins non vale per le azioni decoranti.
    expect((await httpGet('/wp-login.php')).status).toBe(200);
    expect((await httpGet('/zzz-altro.php')).status).toBe(404);
  });

  test('un decoy che punta a un file assente degrada al 404 comune', async () => {
    // Fallire aperto sarebbe peggio: la regola dice «questa richiesta è ostile».
    // Fallire con una pagina d'errore diversa dal 404 del sito sarebbe peggio
    // ancora, perché rivelerebbe il filtro proprio dove è rotto.
    const degradato = await httpGet('/zzz-decoy-assente');
    const genuino = await httpGet('/zzz-non-esiste-affatto.ejs');
    expect(degradato.status).toBe(404);
    expect(degradato.body).toBe(genuino.body);
  });

  test('il redirect risponde 302 con Location e senza corpo rivelatore', async () => {
    const r = await httpGet('/zzz-redirect');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
    expect(r.body).toBe('');
  });

  test('decoy e redirect finiscono nel log come applicati', async () => {
    await sleep(300);
    const decoy = eventsFor('/wp-login.php');
    const redirect = eventsFor('/zzz-redirect');

    expect(decoy.length).toBeGreaterThan(0);
    expect(decoy[0].ruleName).toBe('test-decoy-wp');
    expect(decoy[0].enforced).toBe(true);

    expect(redirect.length).toBeGreaterThan(0);
    expect(redirect[0].ruleName).toBe('test-redirect-interno');
    expect(redirect[0].enforced).toBe(true);
  });
});

// Le due azioni che non producono una risposta HTTP normale. Un unit test può
// dire che il socket viene distrutto e che il corpo esce a pezzi; solo un
// server vero dice come si comporta il CLIENT davanti a quelle risposte — ed è
// l'unica cosa che conta, perché il bersaglio è il tempo di chi bussa.
describe('sentinel — drop e tarpit', () => {
  test('drop tronca la connessione senza rispondere', async () => {
    // Non un 404, non un 502, non un corpo vuoto: proprio nessuna risposta. Il
    // client vede la connessione azzerata.
    await expect(httpGet('/zzz-drop')).rejects.toMatchObject({ code: 'ECONNRESET' });
  });

  test('drop è registrato come applicato', async () => {
    await sleep(300);
    const evento = eventsFor('/zzz-drop')[0];
    expect(evento).toBeDefined();
    expect(evento.ruleName).toBe('test-drop');
    expect(evento.action).toBe('drop');
    expect(evento.enforced).toBe(true);
  });

  test('il tarpit trattiene la connessione per la durata dichiarata', async () => {
    const startedAt = Date.now();
    const r = await httpGet('/zzz-tarpit');
    const elapsed = Date.now() - startedAt;

    expect(r.status).toBe(200);
    // La regola chiede 1,5 secondi: la risposta non può arrivare subito.
    expect(elapsed).toBeGreaterThan(1000);
    expect(r.body).toContain('<!DOCTYPE html>');
  });

  test('il tarpit non dichiara la lunghezza del corpo', async () => {
    // È il motivo per cui il client resta in attesa invece di chiudere.
    const r = await httpGet('/zzz-tarpit');
    expect(r.headers['content-length']).toBeUndefined();
  });

  test('il sito continua a rispondere mentre un tarpit è in corso', async () => {
    // La verifica che conta: il tarpit non deve bloccare l'event loop. Se lo
    // facesse, la difesa fermerebbe il sito invece dell'attaccante.
    //
    // La sonda NON è `/`: `www/` è git-ignored e su un clone pulito è vuota,
    // quindi la radice non ha un file indice. Rispondeva 200 solo perché serviva
    // l'ELENCO della directory — un 200 accidentale, che è sparito quando
    // `dirListing.wwwPath` è diventato `false` di default. Serve una pagina che
    // esista sempre nel repository: quella di login lo è, ed è pubblica.
    const trattenuta = httpGet('/zzz-tarpit');
    await sleep(200);

    const startedAt = Date.now();
    const normale = await httpGet('/pluginPages/adminUsers/login.ejs');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(normale.status).toBe(200);

    await trattenuta;
  });
});

// Il ciclo completo del token esca, che nessun unit test può coprire: il token
// nasce dentro la risposta di un decoy, viene registrato insieme al destinatario,
// e deve essere riconosciuto quando torna indietro su un'ALTRA richiesta. Sono
// due richieste HTTP separate legate da uno stato in memoria del processo — che
// è esattamente ciò che un test in-process non prova.
describe('sentinel — il canary chiude il cerchio', () => {
  let token = null;

  test('il decoy consegna un token della forma attesa', async () => {
    const r = await httpGet('/zzz-canary-source');
    expect(r.status).toBe(200);

    const found = r.body.match(/\ba7[a-z0-9]{22}\b/);
    expect(found).not.toBeNull();
    [token] = found;

    // Due consegne, due token diversi: il legame è col singolo destinatario.
    const second = await httpGet('/zzz-canary-source');
    expect(second.body).not.toContain(token);
  });

  test('usare il token fa scattare la trappola', async () => {
    const r = await httpGet(`/telescope-${token}/requests`);
    expect(r.status).toBe(404); // action: block

    await sleep(300);
    const evento = eventsFor(`/telescope-${token}/requests`)[0];
    expect(evento).toBeDefined();
    expect(evento.ruleName).toBe('test-canary-used');
    expect(evento.enforced).toBe(true);
    expect(evento.canary).toEqual({ token, status: 'known' });
  });

  test('il token viaggia anche nella querystring', async () => {
    const r = await httpGet(`/zzz-download?file=${token}`);
    expect(r.status).toBe(404);
  });

  test('una stringa della forma giusta ma mai coniata NON è "known"', async () => {
    // La regola di prova chiede `known`: un token orfano non deve bastare, o la
    // distinzione fra i due gradi di certezza non varrebbe niente.
    const orfano = 'a7aaaaaaaaaaaaaaaaaaaaaa';
    const r = await httpGet(`/telescope-${orfano}/requests`);
    expect(r.status).toBe(404); // il file non esiste comunque

    await sleep(300);
    const eventi = eventsFor(`/telescope-${orfano}/requests`);
    // Nessun evento della regola trappola: al più l'osservazione dell'esito.
    expect(eventi.filter((e) => e.ruleName === 'test-canary-used')).toHaveLength(0);
  });

  test('una richiesta normale non porta token', async () => {
    await httpGet('/zzz-normale');
    await sleep(300);
    const eventi = eventsFor('/zzz-normale');
    for (const e of eventi) expect(e.canary).toBeNull();
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
