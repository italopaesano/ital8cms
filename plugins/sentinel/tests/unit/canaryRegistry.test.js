/**
 * canaryRegistry.test.js
 *
 * Il registro dei token esca. Ciò che va difeso con dei test, in ordine di
 * gravità di quello che succede se cede:
 *
 *   1. UNICITA E IMPREVEDIBILITA. Il valore di un canary è tutto nel fatto che
 *      non si possa arrivarci per caso. Un token indovinabile — o peggio, uno
 *      ripetuto — trasformerebbe l'unica CERTEZZA del plugin in un falso
 *      positivo, e sarebbe la peggiore delle regressioni possibili: quella che
 *      fa bandire un innocente proprio con la regola che si era promossa perché
 *      «tanto quella non sbaglia mai».
 *   2. IL LEGAME CON IL DESTINATARIO. Un token senza la memoria di chi l'ha
 *      ricevuto è solo un URL improbabile.
 *   3. IL TETTO. La frequenza di conio la decide chi bussa.
 */

'use strict';

const { CanaryRegistry, findCanary, DEFAULT_PREFIX } = require('../../lib/canaryRegistry');

// ─────────────────────────────────────────────────────────────────────────────
describe('conio dei token', () => {
  test('il token porta il prefisso configurato', () => {
    const registry = new CanaryRegistry({ tokenPrefix: 'zz' });
    expect(registry.mint()).toMatch(/^zz[a-z0-9]{22}$/);
  });

  test('un prefisso non valido ricade sul default invece di produrre token rotti', () => {
    // Un prefisso con caratteri fuori alfabeto renderebbe la regex di
    // riconoscimento incoerente col token coniato: si troverebbero token che non
    // si riconoscono più, cioè la trappola muta.
    for (const bad of ['', 'MAIUSC', 'ha-trattini', 'troppolungoassai', 'a b']) {
      const registry = new CanaryRegistry({ tokenPrefix: bad });
      expect(registry.prefix).toBe(DEFAULT_PREFIX);
      expect(registry.find(registry.mint())).not.toBeNull();
    }
  });

  test('mille token sono tutti diversi', () => {
    const registry = new CanaryRegistry();
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(registry.mint());
    expect(seen.size).toBe(1000);
  });

  test('il conteggio dei coniati cresce', () => {
    const registry = new CanaryRegistry();
    registry.mint();
    registry.mint();
    expect(registry.getStats().minted).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('riconoscimento', () => {
  test('trova un token dentro un percorso più lungo', () => {
    const registry = new CanaryRegistry();
    const token = registry.mint();
    expect(registry.find(`/backup-2026-08-09-${token}.tar.gz`)).toBe(token);
  });

  test('non trova nulla in un percorso normale', () => {
    const registry = new CanaryRegistry();
    for (const p of ['/', '/index.html', '/api/adminUsers/login', '/wp-login.php', '']) {
      expect(registry.find(p)).toBeNull();
    }
  });

  test('due ricerche consecutive danno lo stesso risultato', () => {
    // Una regex globale conserva `lastIndex` fra le chiamate: senza azzerarlo,
    // una richiesta su due mancherebbe il token. È il tipo di difetto che in
    // produzione si manifesta come «la trappola scatta a intermittenza».
    const registry = new CanaryRegistry();
    const token = registry.mint();
    expect(registry.find(`/x/${token}`)).toBe(token);
    expect(registry.find(`/x/${token}`)).toBe(token);
    expect(registry.find(`/x/${token}`)).toBe(token);
  });

  test('un token coniato altrove ha la forma giusta ma è sconosciuto', () => {
    const registry = new CanaryRegistry();
    const altrove = new CanaryRegistry();
    const token = altrove.mint();
    expect(registry.find(`/x/${token}`)).toBe(token);
    expect(registry.verify(token).status).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('memoria del destinatario', () => {
  test('verify restituisce chi aveva ricevuto il token', () => {
    const registry = new CanaryRegistry();
    const token = registry.mint({ ip: '203.0.113.7', fp: 'abc123', path: '/backup/' });

    const verified = registry.verify(token);
    expect(verified.status).toBe('known');
    expect(verified.ip).toBe('203.0.113.7');
    expect(verified.fp).toBe('abc123');
    expect(verified.path).toBe('/backup/');
    expect(typeof verified.mintedAt).toBe('number');
  });

  test('un token mai coniato è unknown, non un errore', () => {
    const registry = new CanaryRegistry();
    const verified = registry.verify('a7zzzzzzzzzzzzzzzzzzzzzz');
    expect(verified.status).toBe('unknown');
    expect(verified.ip).toBeNull();
  });

  test('verificare NON consuma il token', () => {
    // Un token monouso trasformerebbe l'insistenza — che è essa stessa un
    // segnale — in silenzio dopo la prima richiesta.
    const registry = new CanaryRegistry();
    const token = registry.mint({ ip: '203.0.113.7' });
    for (let i = 0; i < 5; i++) expect(registry.verify(token).status).toBe('known');
  });

  test('verificare NON rinfresca la scadenza', () => {
    // Altrimenti basterebbe usarlo a intervalli regolari per tenerlo vivo per
    // sempre: sarebbe l'attaccante a decidere quanta memoria gli dedichiamo.
    const registry = new CanaryRegistry();
    const token = registry.mint();
    const before = registry.store.get(token).lastSeenMs;
    registry.verify(token);
    expect(registry.store.get(token).lastSeenMs).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tetto e scadenza', () => {
  test('oltre il tetto i token più vecchi vengono sfrattati', () => {
    const registry = new CanaryRegistry({ maxTokens: 10 });
    const first = registry.mint();
    for (let i = 0; i < 20; i++) registry.mint();

    expect(registry.getStats().liveTokens).toBe(10);
    expect(registry.getStats().evictions).toBeGreaterThan(0);
    // Sfrattato ma ancora riconoscibile per forma: la trappola scatta come
    // "unknown" invece di sparire.
    expect(registry.verify(first).status).toBe('unknown');
    expect(registry.find(`/x/${first}`)).toBe(first);
  });

  test('lo sweep rimuove i token scaduti', () => {
    const registry = new CanaryRegistry({ ttlHours: 1 });
    const token = registry.mint();
    registry.store.get(token).lastSeenMs = Date.now() - 2 * 3600 * 1000;

    expect(registry.sweep()).toBe(1);
    expect(registry.verify(token).status).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('registrazione degli scatti', () => {
  test('gli scatti recenti sono in ordine dal più nuovo', () => {
    const registry = new CanaryRegistry();
    registry.recordTrigger({ token: 'a', status: 'known' });
    registry.recordTrigger({ token: 'b', status: 'known' });

    const stats = registry.getStats();
    expect(stats.triggered).toBe(2);
    expect(stats.recentTriggers[0].token).toBe('b');
  });

  test('la lista degli scatti recenti non cresce senza limite', () => {
    // Anche questa è una chiave controllata dall'attaccante: usare il token in
    // ciclo non deve gonfiare la memoria.
    const registry = new CanaryRegistry();
    for (let i = 0; i < 500; i++) registry.recordTrigger({ token: `t${i}`, status: 'known' });
    expect(registry.recentTriggers.length).toBeLessThanOrEqual(50);
    expect(registry.getStats().triggered).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('findCanary — la ricerca fatta una volta per richiesta', () => {
  let registry;
  let token;

  beforeEach(() => {
    registry = new CanaryRegistry();
    token = registry.mint({ ip: '203.0.113.7' });
  });

  test('null senza registro (canary disattivato)', () => {
    expect(findCanary(null, `/x/${token}`, '')).toBeNull();
  });

  test('null quando la richiesta non porta token', () => {
    expect(findCanary(registry, '/index.html', 'page=2')).toBeNull();
  });

  test('trova il token nel percorso', () => {
    const found = findCanary(registry, `/backup-${token}.tar.gz`, '');
    expect(found.token).toBe(token);
    expect(found.status).toBe('known');
    expect(found.deliveredTo.ip).toBe('203.0.113.7');
  });

  test('trova il token nella querystring', () => {
    const found = findCanary(registry, '/download', `file=${token}`);
    expect(found.token).toBe(token);
  });

  test('trova il token nella querystring percent-encoded', () => {
    // Stessa ragione per cui `matchQuery` guarda anche la forma decodificata: un
    // parametro può arrivare codificato, e confrontare solo il grezzo lo
    // lascerebbe passare.
    const found = findCanary(registry, '/download', `path=%2Fbackup%2F${token}`);
    expect(found.token).toBe(token);
  });

  test('un token della forma giusta ma sconosciuto viene comunque segnalato', () => {
    const orfano = 'a7aaaaaaaaaaaaaaaaaaaaaa';
    const found = findCanary(registry, `/x/${orfano}`, '');
    expect(found.status).toBe('unknown');
    expect(found.deliveredTo.ip).toBeNull();
  });
});
