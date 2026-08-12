/**
 * sessionCoherence.test.js
 *
 * La sorveglianza sulle sessioni autenticate. Quattro proprietà da difendere,
 * e la prima è quella su cui poggia tutto il resto:
 *
 *   1. LA LINEA DI BASE NON SI AGGIORNA MAI. Se dopo un'anomalia si adottasse il
 *      nuovo valore come riferimento, la richiesta successiva del ladro tornerebbe
 *      "coerente" e la sessione dirottata risulterebbe pulita per tutto il resto
 *      della sua vita. È il difetto che renderebbe l'intero modulo inutile pur
 *      lasciandolo apparentemente funzionante — un test che passa alla prima
 *      anomalia e non alla seconda non se ne accorgerebbe.
 *   2. La prima richiesta non può essere un'anomalia (non c'è confronto).
 *   3. L'identificativo di sessione è stabile e si conia una volta sola.
 *   4. Il tetto regge, e le statistiche contano SESSIONI, non richieste.
 */

'use strict';

const {
  SessionCoherence,
  ANOMALY_KINDS,
  SESSION_ID_KEY,
  networkOf,
} = require('../../lib/sessionCoherence');

const BASE = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0',
  fp: 'fp-browser',
  ip: '203.0.113.7',
  username: 'mario',
  isScriptClient: false,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('linea di base', () => {
  test('la prima richiesta non produce anomalie', () => {
    const sc = new SessionCoherence();
    expect(sc.observe('s1', BASE).anomalies).toEqual([]);
  });

  test('una richiesta identica alla prima non produce anomalie', () => {
    const sc = new SessionCoherence();
    sc.observe('s1', BASE);
    expect(sc.observe('s1', { ...BASE }).anomalies).toEqual([]);
  });

  test('sessioni diverse hanno linee di base indipendenti', () => {
    // Chi entra da portatile e telefono ha due sessioni: se la chiave fosse
    // l'account invece della sessione, sarebbe subito un falso positivo.
    const sc = new SessionCoherence();
    sc.observe('portatile', BASE);
    sc.observe('telefono', { ...BASE, userAgent: 'Safari iPhone', fp: 'fp-safari' });

    expect(sc.observe('portatile', BASE).anomalies).toEqual([]);
    expect(sc.observe('telefono', { ...BASE, userAgent: 'Safari iPhone', fp: 'fp-safari' }).anomalies)
      .toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('rilevamento delle anomalie', () => {
  let sc;
  beforeEach(() => {
    sc = new SessionCoherence();
    sc.observe('s1', BASE);
  });

  test('uaChanged: lo User-Agent cambia a metà sessione', () => {
    const r = sc.observe('s1', { ...BASE, userAgent: 'python-requests/2.31.0' });
    expect(r.anomalies).toContain('uaChanged');
  });

  test('fingerprintChanged: cambia la forma degli header', () => {
    expect(sc.observe('s1', { ...BASE, fp: 'fp-diverso' }).anomalies)
      .toContain('fingerprintChanged');
  });

  test('ipChanged senza networkChanged dentro lo stesso blocco', () => {
    const r = sc.observe('s1', { ...BASE, ip: '203.0.113.99' });
    expect(r.anomalies).toContain('ipChanged');
    expect(r.anomalies).not.toContain('networkChanged');
  });

  test('un indirizzo di un altro blocco produce entrambe', () => {
    const r = sc.observe('s1', { ...BASE, ip: '198.51.100.4' });
    expect(r.anomalies).toEqual(expect.arrayContaining(['ipChanged', 'networkChanged']));
  });

  test('scriptClient è uno stato, non un cambiamento', () => {
    // Vale anche se il client è stato così fin dall'inizio: un cookie valido in
    // mano a qualcosa che non è un browser descrive già un problema.
    const scriptFromStart = new SessionCoherence();
    scriptFromStart.observe('s2', { ...BASE, isScriptClient: true });
    expect(scriptFromStart.observe('s2', { ...BASE, isScriptClient: true }).anomalies)
      .toEqual(['scriptClient']);
  });

  test('il dirottamento completo produce più anomalie insieme', () => {
    const r = sc.observe('s1', {
      userAgent: 'python-requests/2.31.0',
      fp: 'fp-script',
      ip: '198.51.100.4',
      isScriptClient: true,
    });
    expect(r.anomalies.sort()).toEqual(
      ['fingerprintChanged', 'ipChanged', 'networkChanged', 'scriptClient', 'uaChanged'],
    );
  });

  test('ogni anomalia dichiarata è effettivamente producibile', () => {
    // Presidio contro le costanti morte: un valore ammesso dal validatore che
    // nessun percorso può produrre sarebbe una regola che non scatta mai.
    const prodotte = new Set();
    const s = new SessionCoherence();
    s.observe('x', BASE);
    for (const a of s.observe('x', {
      userAgent: 'altro', fp: 'altro', ip: '10.0.0.1', isScriptClient: true,
    }).anomalies) prodotte.add(a);
    expect(Array.from(prodotte).sort()).toEqual([...ANOMALY_KINDS].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('la linea di base non si aggiorna mai', () => {
  // IL test di questo file. Con una linea di base che si adegua, il modulo
  // sembrerebbe funzionare — la prima anomalia verrebbe rilevata — ma la sessione
  // rubata tornerebbe pulita dalla richiesta dopo, cioè per tutta la parte in cui
  // il ladro la usa davvero.
  test('la sessione resta segnalata a ogni richiesta successiva', () => {
    const sc = new SessionCoherence();
    sc.observe('s1', BASE);

    const ladro = { ...BASE, userAgent: 'python-requests/2.31.0' };
    for (let i = 0; i < 10; i++) {
      expect(sc.observe('s1', ladro).anomalies).toContain('uaChanged');
    }
  });

  test('tornare al client originale fa sparire l\'anomalia', () => {
    // Il riferimento è «com'era all'inizio», non «com'era l'ultima volta»: se
    // l'utente vero riprende a navigare, le sue richieste sono di nuovo coerenti.
    const sc = new SessionCoherence();
    sc.observe('s1', BASE);
    expect(sc.observe('s1', { ...BASE, userAgent: 'altro' }).anomalies).toContain('uaChanged');
    expect(sc.observe('s1', BASE).anomalies).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('statistiche', () => {
  test('flagged conta le SESSIONI, non le richieste', () => {
    // Una sessione dirottata produce l'anomalia a ogni richiesta: sommarle
    // direbbe quanto è stata attiva, non quante sessioni sono compromesse.
    const sc = new SessionCoherence();
    sc.observe('s1', BASE);
    for (let i = 0; i < 20; i++) sc.observe('s1', { ...BASE, userAgent: 'ladro' });

    const stats = sc.getStats();
    expect(stats.flagged).toBe(1);
    expect(stats.byKind.uaChanged).toBe(1);
  });

  test('un\'anomalia nuova sulla stessa sessione viene contata', () => {
    const sc = new SessionCoherence();
    sc.observe('s1', BASE);
    sc.observe('s1', { ...BASE, userAgent: 'ladro' });
    sc.observe('s1', { ...BASE, userAgent: 'ladro', ip: '198.51.100.4' });

    const stats = sc.getStats();
    expect(stats.flagged).toBe(1);
    expect(stats.byKind.uaChanged).toBe(1);
    expect(stats.byKind.ipChanged).toBe(1);
  });

  test('tracked conta le sessioni prese in carico', () => {
    const sc = new SessionCoherence();
    sc.observe('a', BASE);
    sc.observe('b', BASE);
    sc.observe('a', BASE);
    expect(sc.getStats().tracked).toBe(2);
    expect(sc.getStats().live).toBe(2);
  });

  test('la lista degli eventi recenti non cresce senza limite', () => {
    const sc = new SessionCoherence();
    for (let i = 0; i < 200; i++) {
      sc.observe(`s${i}`, BASE);
      sc.observe(`s${i}`, { ...BASE, userAgent: 'ladro' });
    }
    expect(sc.recent.length).toBeLessThanOrEqual(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tetto e scadenza', () => {
  test('oltre il tetto le sessioni meno usate vengono sfrattate', () => {
    const sc = new SessionCoherence({ maxSessions: 10 });
    for (let i = 0; i < 25; i++) sc.observe(`s${i}`, BASE);
    expect(sc.getStats().live).toBe(10);
    expect(sc.getStats().evictions).toBeGreaterThan(0);
  });

  test('la scadenza si conta dall\'ULTIMO uso, non dalla creazione', () => {
    // Al contrario dei token canary: qui la chiave non è controllata da chi
    // attacca (servirebbero altrettanti login validi), e una sessione attiva non
    // deve perdere la propria linea di base mentre è in uso.
    const sc = new SessionCoherence({ ttlHours: 1 });
    sc.observe('s1', BASE);
    sc.store.get('s1').lastSeenMs = Date.now() - 2 * 3600 * 1000;

    sc.observe('s1', BASE);          // uso recente → rinnova
    expect(sc.sweep()).toBe(0);
    expect(sc.getStats().live).toBe(1);
  });

  test('una sessione inattiva viene dimenticata', () => {
    const sc = new SessionCoherence({ ttlHours: 1 });
    sc.observe('s1', BASE);
    sc.store.get('s1').lastSeenMs = Date.now() - 2 * 3600 * 1000;
    expect(sc.sweep()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('identificativo di sessione', () => {
  test('viene coniato una volta sola e poi riletto', () => {
    const session = { authenticated: true };
    const first = SessionCoherence.resolveSessionId(session);

    expect(typeof first).toBe('string');
    expect(session[SESSION_ID_KEY]).toBe(first);
    expect(SessionCoherence.resolveSessionId(session)).toBe(first);
  });

  test('sessioni diverse ricevono identificativi diversi', () => {
    const a = SessionCoherence.resolveSessionId({ authenticated: true });
    const b = SessionCoherence.resolveSessionId({ authenticated: true });
    expect(a).not.toBe(b);
  });

  test('una sessione non scrivibile non fa fallire la richiesta', () => {
    // Fail-soft: si rinuncia al tracciamento, non si rompe il sito.
    const congelata = Object.freeze({ authenticated: true });
    expect(SessionCoherence.resolveSessionId(congelata)).toBeNull();
  });

  test.each([[null], [undefined], ['stringa'], [42]])('%p non è una sessione', (value) => {
    expect(SessionCoherence.resolveSessionId(value)).toBeNull();
  });

  // ── I due vincoli sul NOME della chiave ──
  // Nessuno dei due si vede provando il modulo da solo, ed entrambi lo
  // renderebbero silenziosamente inutile o indiscreto.

  test('la chiave sopravvive alla serializzazione di koa-session', () => {
    // `Session.toJSON()` di koa-session salta ogni chiave che inizia con `_`
    // («skip private stuff»). Con una chiave così, l'identificativo non
    // finirebbe nel cookie: ogni richiesta ne conierebbe uno nuovo, ogni
    // richiesta sembrerebbe la prima della sua sessione, e NESSUNA anomalia
    // sarebbe mai rilevabile — con tutti gli altri test di questo file verdi.
    const serializzabile = (key) => key[0] !== '_';
    expect(serializzabile(SESSION_ID_KEY)).toBe(true);

    const session = { authenticated: true };
    SessionCoherence.resolveSessionId(session);
    const cookiePayload = Object.fromEntries(
      Object.entries(session).filter(([k]) => serializzabile(k)),
    );
    expect(cookiePayload[SESSION_ID_KEY]).toBe(session[SESSION_ID_KEY]);
  });

  test('la chiave non nomina il plugin', () => {
    // La sessione viaggia in un cookie che il client può decodificare (firmato,
    // non cifrato): una chiave che dice "sentinel" annuncerebbe il filtro a
    // chiunque guardi i propri cookie.
    expect(SESSION_ID_KEY.toLowerCase()).not.toContain('sentinel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('networkOf', () => {
  test.each([
    ['203.0.113.7', '203.0.113'],
    ['10.1.2.3', '10.1.2'],
    ['2001:db8:85a3:0:0:8a2e:370:7334', '2001:db8:85a3'],
    ['', ''],
  ])('%s → %s', (ip, expected) => {
    expect(networkOf(ip)).toBe(expected);
  });
});
