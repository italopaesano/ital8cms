/**
 * Unit test del motore di rate limiting (escalation in stile fail2ban).
 * La clock è iniettata per rendere i test deterministici.
 */

'use strict';

const RateLimitEngine = require('../../lib/rateLimitEngine');

const POLICY = {
  findWindowSeconds: 900,
  maxFailures: 3,
  shortBlockSeconds: 300,
  maxShortBlocks: 2,
  longBlockSeconds: 86400,
  escalationResetSeconds: 86400,
};

const IP = '203.0.113.7';
const RULE = 'adminLogin';

function makeEngine() {
  const clock = { now: 1_000_000 };
  const engine = new RateLimitEngine({
    resolvePolicy: () => POLICY,
    now: () => clock.now,
  });
  const advanceSeconds = (sec) => { clock.now += sec * 1000; };
  return { engine, advanceSeconds, clock };
}

/** Porta il client fino a uno short block (maxFailures fallimenti consecutivi). */
function triggerShortBlock(engine) {
  let verdict;
  for (let i = 0; i < POLICY.maxFailures; i++) {
    verdict = engine.recordFailure(IP, RULE);
  }
  return verdict;
}

describe('RateLimitEngine — costruttore', () => {
  test('richiede resolvePolicy', () => {
    expect(() => new RateLimitEngine({})).toThrow(/resolvePolicy/);
  });
});

describe('RateLimitEngine — conteggio fallimenti e short block', () => {
  test('sotto la soglia non blocca', () => {
    const { engine } = makeEngine();
    engine.recordFailure(IP, RULE);
    const v = engine.recordFailure(IP, RULE); // 2 < maxFailures(3)
    expect(v.blocked).toBe(false);
    expect(engine.check(IP, RULE).blocked).toBe(false);
  });

  test('raggiunta la soglia scatta lo short block con retryAfter corretto', () => {
    const { engine } = makeEngine();
    const v = triggerShortBlock(engine);
    expect(v.blocked).toBe(true);
    expect(v.tier).toBe('short');
    expect(v.retryAfterSeconds).toBe(POLICY.shortBlockSeconds);
  });

  test('durante il blocco check() resta bloccato e i fallimenti non incrementano', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine);
    expect(engine.check(IP, RULE).blocked).toBe(true);
    const entryBefore = engine.state.get(`${IP}|${RULE}`).failureCount;
    engine.recordFailure(IP, RULE);
    const entryAfter = engine.state.get(`${IP}|${RULE}`).failureCount;
    expect(entryAfter).toBe(entryBefore); // nessun incremento durante il blocco
  });

  test('alla scadenza dello short block il client torna libero', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerShortBlock(engine);
    advanceSeconds(POLICY.shortBlockSeconds + 1);
    expect(engine.check(IP, RULE).blocked).toBe(false);
  });
});

describe('RateLimitEngine — escalation a long block', () => {
  test('dopo maxShortBlocks short block, il successivo è un long block', () => {
    const { engine, advanceSeconds } = makeEngine();

    // Short block #1
    let v = triggerShortBlock(engine);
    expect(v.tier).toBe('short');
    advanceSeconds(POLICY.shortBlockSeconds + 1);

    // Short block #2 (raggiunge maxShortBlocks)
    v = triggerShortBlock(engine);
    expect(v.tier).toBe('short');
    advanceSeconds(POLICY.shortBlockSeconds + 1);

    // Terzo ciclo → escalation a long block
    v = triggerShortBlock(engine);
    expect(v.tier).toBe('long');
    expect(v.retryAfterSeconds).toBe(POLICY.longBlockSeconds);
  });

  test('alla scadenza del long block lo stato fa reset totale', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerShortBlock(engine);
    advanceSeconds(POLICY.shortBlockSeconds + 1);
    triggerShortBlock(engine);
    advanceSeconds(POLICY.shortBlockSeconds + 1);
    triggerShortBlock(engine); // long block
    advanceSeconds(POLICY.longBlockSeconds + 1);

    expect(engine.check(IP, RULE).blocked).toBe(false);
    const entry = engine.state.get(`${IP}|${RULE}`);
    expect(entry.shortBlockCount).toBe(0);
    expect(entry.failureCount).toBe(0);
  });
});

describe('RateLimitEngine — finestra e reset escalation', () => {
  test('fallimenti oltre la finestra non si accumulano', () => {
    const { engine, advanceSeconds } = makeEngine();
    engine.recordFailure(IP, RULE); // count=1
    advanceSeconds(POLICY.findWindowSeconds + 1);
    engine.recordFailure(IP, RULE); // nuova finestra, count=1
    advanceSeconds(POLICY.findWindowSeconds + 1);
    const v = engine.recordFailure(IP, RULE); // ancora count=1
    expect(v.blocked).toBe(false);
  });

  test('dopo inattività oltre escalationReset la memoria di escalation si azzera', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerShortBlock(engine); // shortBlockCount=1
    advanceSeconds(POLICY.escalationResetSeconds + 1);
    // un check applica la scadenza e resetta lo shortBlockCount
    engine.check(IP, RULE);
    const entry = engine.state.get(`${IP}|${RULE}`);
    expect(entry.shortBlockCount).toBe(0);
  });
});

describe('RateLimitEngine — checkClientLongBlock (Livello 2)', () => {
  /** Porta il client fino a un long block (escalation completa). */
  function triggerLongBlock(engine, advanceSeconds) {
    triggerShortBlock(engine);
    advanceSeconds(POLICY.shortBlockSeconds + 1);
    triggerShortBlock(engine);
    advanceSeconds(POLICY.shortBlockSeconds + 1);
    triggerShortBlock(engine); // → long block
  }

  test('uno short block NON è un long block', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine);
    expect(engine.checkClientLongBlock(IP).blocked).toBe(false);
  });

  test('rileva un long block attivo per il client', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerLongBlock(engine, advanceSeconds);
    const v = engine.checkClientLongBlock(IP);
    expect(v.blocked).toBe(true);
    expect(v.tier).toBe('long');
    expect(v.ruleName).toBe(RULE);
    expect(v.retryAfterSeconds).toBe(POLICY.longBlockSeconds);
  });

  test('un altro IP non è coinvolto', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerLongBlock(engine, advanceSeconds);
    expect(engine.checkClientLongBlock('198.51.100.1').blocked).toBe(false);
  });

  test('alla scadenza del long block il client torna libero', () => {
    const { engine, advanceSeconds } = makeEngine();
    triggerLongBlock(engine, advanceSeconds);
    advanceSeconds(POLICY.longBlockSeconds + 1);
    expect(engine.checkClientLongBlock(IP).blocked).toBe(false);
  });
});

describe('RateLimitEngine — success, sweep, introspezione, persistenza', () => {
  test('recordSuccess rimuove ogni stato per la chiave', () => {
    const { engine } = makeEngine();
    engine.recordFailure(IP, RULE);
    engine.recordFailure(IP, RULE);
    engine.recordSuccess(IP, RULE);
    expect(engine.state.has(`${IP}|${RULE}`)).toBe(false);
    expect(engine.check(IP, RULE).blocked).toBe(false);
  });

  test('getActiveBlocks elenca i blocchi attivi', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine);
    const active = engine.getActiveBlocks();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ clientId: IP, ruleName: RULE, tier: 'short' });
  });

  test('sweep rimuove le voci ormai pulite', () => {
    const { engine, advanceSeconds } = makeEngine();
    engine.recordFailure(IP, RULE);
    // oltre la finestra e oltre escalationReset → la voce diventa pulita
    advanceSeconds(POLICY.escalationResetSeconds + 1);
    engine.sweep();
    expect(engine.state.has(`${IP}|${RULE}`)).toBe(false);
  });

  test('serialize/load preservano i blocchi attivi', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine);
    const snapshot = engine.serialize();

    const { engine: engine2 } = makeEngine();
    engine2.load(snapshot);
    expect(engine2.check(IP, RULE).blocked).toBe(true);
  });

  test('eventi onEvent emessi per failure e shortBlock', () => {
    const events = [];
    const clock = { now: 1_000_000 };
    const engine = new RateLimitEngine({
      resolvePolicy: () => POLICY,
      now: () => clock.now,
      onEvent: (ev) => events.push(ev),
    });
    for (let i = 0; i < POLICY.maxFailures; i++) engine.recordFailure(IP, RULE);
    const types = events.map((e) => e.event);
    expect(types.filter((t) => t === 'failure')).toHaveLength(POLICY.maxFailures - 1);
    expect(types).toContain('shortBlock');
  });
});

describe('RateLimitEngine — edge case e isolamento', () => {
  test('maxShortBlocks = 0 → primo raggiungimento soglia = long block immediato', () => {
    const clock = { now: 1_000_000 };
    const policy = { ...POLICY, maxShortBlocks: 0 };
    const engine = new RateLimitEngine({ resolvePolicy: () => policy, now: () => clock.now });

    let verdict;
    for (let i = 0; i < policy.maxFailures; i++) {
      verdict = engine.recordFailure(IP, RULE);
    }
    expect(verdict.blocked).toBe(true);
    expect(verdict.tier).toBe('long');
    expect(verdict.retryAfterSeconds).toBe(policy.longBlockSeconds);
  });

  test('IP diversi sono indipendenti', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine); // blocca IP
    expect(engine.check(IP, RULE).blocked).toBe(true);
    expect(engine.check('198.51.100.99', RULE).blocked).toBe(false);
  });

  test('regole diverse per lo stesso IP sono indipendenti', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine); // blocca (IP, adminLogin)
    expect(engine.check(IP, RULE).blocked).toBe(true);
    expect(engine.check(IP, 'altraRegola').blocked).toBe(false);
  });

  test('resolvePolicy riceve il ruleName (policy per-regola)', () => {
    const clock = { now: 1_000_000 };
    const policies = {
      severa: { ...POLICY, maxFailures: 2 },
      lasca: { ...POLICY, maxFailures: 10 },
    };
    const seen = [];
    const engine = new RateLimitEngine({
      resolvePolicy: (ruleName) => { seen.push(ruleName); return policies[ruleName]; },
      now: () => clock.now,
    });

    // 'severa' si blocca a 2 fallimenti
    engine.recordFailure(IP, 'severa');
    expect(engine.recordFailure(IP, 'severa').blocked).toBe(true);
    // 'lasca' a 2 fallimenti non si blocca
    engine.recordFailure(IP, 'lasca');
    expect(engine.recordFailure(IP, 'lasca').blocked).toBe(false);

    expect(seen).toContain('severa');
    expect(seen).toContain('lasca');
  });
});

describe('RateLimitEngine — azioni admin (release / forceBlock)', () => {
  test('release rimuove un blocco specifico', () => {
    const { engine } = makeEngine();
    triggerShortBlock(engine);
    expect(engine.check(IP, RULE).blocked).toBe(true);
    expect(engine.release(IP, RULE)).toBe(true);
    expect(engine.check(IP, RULE).blocked).toBe(false);
    expect(engine.state.has(`${IP}|${RULE}`)).toBe(false);
  });

  test('release su chiave inesistente ritorna false', () => {
    const { engine } = makeEngine();
    expect(engine.release(IP, RULE)).toBe(false);
  });

  test('releaseAllForClient rimuove tutte le regole di un IP, non gli altri IP', () => {
    const { engine } = makeEngine();
    engine.recordFailure(IP, 'regolaA');
    engine.recordFailure(IP, 'regolaB');
    engine.recordFailure('198.51.100.1', 'regolaA');

    const removed = engine.releaseAllForClient(IP);
    expect(removed).toBe(2);
    expect(engine.state.has(`${IP}|regolaA`)).toBe(false);
    expect(engine.state.has(`${IP}|regolaB`)).toBe(false);
    expect(engine.state.has('198.51.100.1|regolaA')).toBe(true);
  });

  test('forceBlock applica un long block con durata indicata', () => {
    const { engine } = makeEngine();
    const v = engine.forceBlock(IP, RULE, { seconds: 600 });
    expect(v.blocked).toBe(true);
    expect(v.tier).toBe('long');
    expect(v.retryAfterSeconds).toBe(600);
    expect(engine.check(IP, RULE).blocked).toBe(true);
  });

  test('forceBlock con tier short', () => {
    const { engine } = makeEngine();
    const v = engine.forceBlock(IP, RULE, { tier: 'short', seconds: 120 });
    expect(v.tier).toBe('short');
    expect(v.retryAfterSeconds).toBe(120);
  });

  test('forceBlock senza opzioni usa longBlockSeconds della policy', () => {
    const { engine } = makeEngine();
    const v = engine.forceBlock(IP, RULE);
    expect(v.tier).toBe('long');
    expect(v.retryAfterSeconds).toBe(POLICY.longBlockSeconds);
  });
});
