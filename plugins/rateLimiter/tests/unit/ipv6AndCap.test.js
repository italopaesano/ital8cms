/**
 * Unit test: rate limiting su IPv6 e tetto alle voci × REVIEW.md → C2.
 *
 * Due problemi indipendenti nello stesso plugin.
 *
 *   (1) La chiave era l'indirizzo IP **intero**. Su IPv4 ha senso: un indirizzo
 *       costa. Su IPv6 no — l'assegnazione minima a un utente domestico è una
 *       /64, cioè 18 miliardi di miliardi di indirizzi: cambiare indirizzo a
 *       ogni tentativo è banale e ogni tentativo riparte da zero. La difesa
 *       anti brute-force **non rallentava nulla** su IPv6.
 *
 *   (2) Nessun tetto alle voci tracciate: la mappa cresceva di una voce per
 *       ogni (IP, regola) con almeno un fallimento, e `sweep()` rimuove solo
 *       quelle già scadute. Lo stato è persistito su disco, quindi cresceva
 *       anche il file — riscritto per intero a ogni flush.
 */

'use strict';

const { normalizeIpForKey, resolveClientId } = require('../../lib/keyResolver');
const RateLimitEngine = require('../../lib/rateLimitEngine');

// ── (1) IPv6 → /64 ───────────────────────────────────────────────────────────

describe('la chiave IPv6 è la /64, non l\'indirizzo', () => {
  test('tutti gli indirizzi della stessa /64 condividono la chiave', () => {
    // È il punto: con la chiave per indirizzo, questi quattro tentativi
    // partivano da quattro contatori a zero.
    const stessaRete = [
      '2001:db8:1:2:0:0:0:1',
      '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
      '2001:db8:1:2::ffff',
      '2001:db8:1:2:1:2:3:4',
    ].map(normalizeIpForKey);

    expect(new Set(stessaRete).size).toBe(1);
    expect(stessaRete[0]).toBe('2001:db8:1:2::/64');
  });

  test('/64 diverse restano chiavi diverse', () => {
    expect(normalizeIpForKey('2001:db8:1:2::1'))
      .not.toBe(normalizeIpForKey('2001:db8:1:3::1'));
  });

  test('la stessa rete scritta in forme diverse dà la stessa chiave', () => {
    // Forma compressa, zeri non significativi, maiuscole: tutte la stessa rete.
    const forme = ['2001:db8::1', '2001:0db8:0000:0000::1', '2001:DB8::1'];
    expect(new Set(forme.map(normalizeIpForKey)).size).toBe(1);
  });

  test.each([
    ['192.168.1.7',    '192.168.1.7',  'IPv4: l\'indirizzo intero È la chiave giusta'],
    ['::ffff:1.2.3.4', '1.2.3.4',      'IPv4-mapped: è un IPv4, non va troncato'],
    ['unknown',        'unknown',      'valore non riconoscibile: invariato'],
    ['',               '',             'vuoto: invariato'],
  ])('%s → %s (%s)', (input, atteso) => {
    expect(normalizeIpForKey(input)).toBe(atteso);
  });

  test('troncare un IPv4-mapped metterebbe TUTTI gli IPv4 nello stesso contatore', () => {
    // Il caso limite che trasformerebbe la difesa in un blocco globale.
    expect(normalizeIpForKey('::ffff:1.2.3.4')).not.toBe(normalizeIpForKey('::ffff:9.9.9.9'));
  });

  test('la zona (%eth0) è un dettaglio dell\'host e viene scartata', () => {
    expect(normalizeIpForKey('fe80::1%eth0')).toBe(normalizeIpForKey('fe80::1%wlan0'));
  });

  test('resolveClientId normalizza anche l\'IP preso da X-Forwarded-For', () => {
    const ctx = { headers: { 'x-forwarded-for': '2001:db8:1:2:3:4:5:6, 10.0.0.1' }, ip: '10.0.0.1' };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('2001:db8:1:2::/64');
  });

  test('e anche quello della socket', () => {
    expect(resolveClientId({ ip: '2001:db8:9:9::7' })).toBe('2001:db8:9:9::/64');
  });
});

// ── (2) il tetto ─────────────────────────────────────────────────────────────

describe('il tetto alle voci tracciate', () => {
  const policy = {
    findWindowSeconds: 600, maxFailures: 3, shortBlockSeconds: 60,
    maxShortBlocks: 2, longBlockSeconds: 3600, escalationResetSeconds: 86400,
  };

  function motore(maxEntries, now = () => 1_000_000) {
    return new RateLimitEngine({ resolvePolicy: () => policy, maxEntries, now });
  }

  test('la mappa non supera il tetto, per quanti client arrivino', () => {
    const engine = motore(5);

    for (let i = 0; i < 50; i += 1) engine.recordFailure(`client-${i}`, 'login');

    expect(engine.state.size).toBe(5);
  });

  test('si sfrattano le voci NON bloccate, dalla meno recente', () => {
    let adesso = 1_000_000;
    const engine = motore(3, () => adesso);

    engine.recordFailure('vecchio', 'login');     // un solo fallimento: non bloccato
    adesso += 1000;
    engine.recordFailure('medio', 'login');
    adesso += 1000;
    engine.recordFailure('recente', 'login');
    adesso += 1000;
    engine.recordFailure('nuovo', 'login');       // supera il tetto → sfratto

    expect(engine.state.has('vecchio|login')).toBe(false);   // il meno recente
    expect(engine.state.has('nuovo|login')).toBe(true);      // il nuovo entra
    expect(engine.state.size).toBe(3);
  });

  test('un client BLOCCATO non viene dimenticato per far posto a uno non bloccato', () => {
    // Sfrattare un blocco attivo significherebbe RILASCIARE un attaccante.
    let adesso = 1_000_000;
    const engine = motore(2, () => adesso);

    // `bloccato` accumula fallimenti fino al blocco.
    for (let i = 0; i < 3; i += 1) { engine.recordFailure('bloccato', 'login'); adesso += 10; }
    expect(engine.state.get('bloccato|login').blockedUntil).toBeGreaterThan(adesso);

    adesso += 10;
    engine.recordFailure('passante', 'login');     // non bloccato
    adesso += 10;
    engine.recordFailure('altro', 'login');        // supera il tetto

    expect(engine.state.has('bloccato|login')).toBe(true);   // il blocco sopravvive
    expect(engine.state.has('passante|login')).toBe(false);  // sacrificato il non bloccato
  });

  test('se TUTTE sono bloccate si sacrifica quella che scade prima', () => {
    let adesso = 1_000_000;
    const engine = motore(2, () => adesso);

    for (const nome of ['primo', 'secondo']) {
      for (let i = 0; i < 3; i += 1) { engine.recordFailure(nome, 'login'); adesso += 10; }
      adesso += 1000;   // il secondo sarà bloccato più a lungo
    }
    const scadePrima = engine.state.get('primo|login').blockedUntil
      < engine.state.get('secondo|login').blockedUntil ? 'primo' : 'secondo';

    engine.recordFailure('terzo', 'login');

    expect(engine.state.has(`${scadePrima}|login`)).toBe(false);
    expect(engine.state.size).toBe(2);
  });

  test('la voce nuova viene SEMPRE inserita: non tracciare chi arriva è il male peggiore', () => {
    const engine = motore(1);

    engine.recordFailure('primo', 'login');
    engine.recordFailure('secondo', 'login');

    expect(engine.state.has('secondo|login')).toBe(true);
  });

  test('lo sfratto è un evento di audit, non una perdita silenziosa', () => {
    const eventi = [];
    const engine = new RateLimitEngine({
      resolvePolicy: () => policy, maxEntries: 1, now: () => 1_000_000,
      onEvent: (e) => eventi.push(e),
    });

    engine.recordFailure('primo', 'login');
    engine.recordFailure('secondo', 'login');

    expect(eventi.some((e) => e.event === 'evict' && e.count === 1)).toBe(true);
  });

  test('il tetto di serie è generoso, non stretto', () => {
    const engine = new RateLimitEngine({ resolvePolicy: () => policy });
    expect(engine.maxEntries).toBe(10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Il tetto è configurabile DAVVERO (review della v3.51.0)
//
// L'opzione `maxEntries` esisteva nell'engine ed era documentata come
// configurabile, ma nessuno la passava e non c'era una chiave di config: il
// tetto era sempre il default, e la frase « chi ha bisogno di più lo configura »
// era falsa.
// ─────────────────────────────────────────────────────────────────────────────

describe('maxTrackedEntries arriva dal config', () => {
  const fs = require('fs');
  const path = require('path');
  const loadJson5 = require('../../../../core/loadJson5');

  test('il `.default` del plugin dichiara la chiave', () => {
    const cfg = loadJson5(path.join(__dirname, '../../pluginConfig.default.json5'));
    expect(cfg.custom.maxTrackedEntries).toBe(10000);
  });

  test('main.js la passa all\'engine', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((r) => !r.trim().startsWith('//') && !r.trim().startsWith('*')).join('\n');

    expect(src).toMatch(/maxEntries:\s*Number\.isInteger\(custom\.maxTrackedEntries\)/);
  });

  test('un valore dal config sostituisce il default', () => {
    const policy = {
      findWindowSeconds: 600, maxFailures: 3, shortBlockSeconds: 60,
      maxShortBlocks: 2, longBlockSeconds: 3600, escalationResetSeconds: 86400,
    };
    const engine = new RateLimitEngine({ resolvePolicy: () => policy, maxEntries: 7 });

    for (let i = 0; i < 50; i += 1) engine.recordFailure(`c${i}`, 'r');

    expect(engine.state.size).toBe(7);
  });

  test('un valore non valido ricade sul default, non su zero', () => {
    const policy = {
      findWindowSeconds: 600, maxFailures: 3, shortBlockSeconds: 60,
      maxShortBlocks: 2, longBlockSeconds: 3600, escalationResetSeconds: 86400,
    };
    for (const valore of [0, -5, 1.5, 'molte', null]) {
      const engine = new RateLimitEngine({ resolvePolicy: () => policy, maxEntries: valore });
      expect(engine.maxEntries).toBe(10000);
    }
  });
});

