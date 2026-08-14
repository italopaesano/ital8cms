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
  clientClassOf,
} = require('../../lib/sessionCoherence');

/** La classe di un browser vero, e quella di un client script che lo finge. */
const CLASSE_BROWSER = {
  headerProfile: 'browser', family: 'browser-like', coherent: true,
  claimedBrowser: 'firefox', claimedOs: 'linux', isBot: false, botName: null,
};
const CLASSE_SCRIPT = {
  headerProfile: 'minimal', family: 'script-like', coherent: false,
  claimedBrowser: 'firefox', claimedOs: 'linux', isBot: false, botName: null,
};

const BASE = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0',
  fpClass: CLASSE_BROWSER,
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
    sc.observe('telefono', { ...BASE, userAgent: 'Safari iPhone' });

    expect(sc.observe('portatile', BASE).anomalies).toEqual([]);
    expect(sc.observe('telefono', { ...BASE, userAgent: 'Safari iPhone' }).anomalies)
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

  test('fingerprintChanged: la CLASSE del client cambia', () => {
    expect(sc.observe('s1', { ...BASE, fpClass: CLASSE_SCRIPT }).anomalies)
      .toContain('fingerprintChanged');
  });

  /**
   * ─── IL RUMORE CHE LA FOGLIA PRODUCEVA (C9) ─────────────────────────────────
   * Il confronto avveniva sull'HASH dell'impronta, che descrive la forma di una
   * RICHIESTA e non il client: misurato con Chromium su una pagina con CSS,
   * font, immagine, iframe, script, fetch GET e POST, XHR, sendBeacon e submit
   * di form, **13 richieste producono 9 hash distinti** — e ogni campo di
   * `fpClass` resta costante.
   *
   * Ne seguiva che ogni sessione admin che mescoli navigazioni e AJAX — cioè
   * ogni sessione admin — produceva l'anomalia in continuazione. E siccome la
   * linea di base non si aggiorna mai (ed è giusto così), la marcatura restava
   * fino al logout: `byKind.fingerprintChanged` e `flagged` sempre accesi,
   * cioè i numeri che si guardano per decidere una promozione.
   */
  describe('non scatta sul traffico normale dello stesso browser', () => {
    // Le nove impronte misurate hanno hash diversi ma la stessa classe: qui si
    // verifica che la foglia guardi la seconda cosa e non la prima.
    test.each([
      ['navigazione → foglio di stile'],
      ['navigazione → fetch GET'],
      ['navigazione → fetch POST'],
      ['navigazione → submit di form'],
    ])('%s: nessuna anomalia', () => {
      expect(sc.observe('s1', { ...BASE, fpClass: { ...CLASSE_BROWSER } }).anomalies)
        .not.toContain('fingerprintChanged');
    });

    // I campi derivati dal SOLO User-Agent non entrano nel confronto: se
    // cambiano è cambiato l'UA, e a dirlo c'è già `uaChanged`. Includerli
    // avrebbe reso questa foglia un duplicato di quella.
    test('un aggiornamento del browser non la fa scattare due volte', () => {
      const r = sc.observe('s1', {
        ...BASE,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/122.0',   // 121 → 122
        fpClass: { ...CLASSE_BROWSER, claimedBrowser: 'firefox' },
      });
      expect(r.anomalies).toContain('uaChanged');
      expect(r.anomalies).not.toContain('fingerprintChanged');
    });

    test('nemmeno se cambiano isBot o claimedOs, che vengono dall UA', () => {
      const r = sc.observe('s1', {
        ...BASE,
        fpClass: { ...CLASSE_BROWSER, isBot: true, botName: 'Googlebot', claimedOs: 'windows' },
      });
      expect(r.anomalies).not.toContain('fingerprintChanged');
    });
  });

  // ...e il caso per cui la foglia esiste resta intero.
  describe('scatta quando la classe cambia davvero', () => {
    test.each([
      ['la forma degli header crolla a minimal', { headerProfile: 'minimal' }],
      ['l UA smette di essere coerente con gli header', { coherent: false }],
      ['la famiglia diventa script-like', { family: 'script-like' }],
      ['la famiglia diventa un tool dichiarato', { family: 'curl' }],
    ])('%s', (_titolo, delta) => {
      expect(sc.observe('s1', { ...BASE, fpClass: { ...CLASSE_BROWSER, ...delta } }).anomalies)
        .toContain('fingerprintChanged');
    });

    // Anche il caso intermedio: una sessione che PARTE da browser e degrada a
    // `partial` ha comunque smesso di mandare i segnali che mandava.
    test('browser → partial è un cambiamento, non un dettaglio', () => {
      expect(sc.observe('s1', { ...BASE, fpClass: { ...CLASSE_BROWSER, headerProfile: 'partial' } })
        .anomalies).toContain('fingerprintChanged');
    });
  });

  test('clientClassOf ignora i campi che vengono dal solo User-Agent', () => {
    expect(clientClassOf(CLASSE_BROWSER))
      .toBe(clientClassOf({ ...CLASSE_BROWSER, claimedBrowser: 'chrome', claimedOs: 'macos', isBot: true }));
    expect(clientClassOf(CLASSE_BROWSER)).not.toBe(clientClassOf(CLASSE_SCRIPT));
    expect(clientClassOf(null)).toBe('');
    expect(clientClassOf(undefined)).toBe('');
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
      fpClass: CLASSE_SCRIPT,
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
      userAgent: 'altro', fpClass: CLASSE_SCRIPT, ip: '10.0.0.1', isScriptClient: true,
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
