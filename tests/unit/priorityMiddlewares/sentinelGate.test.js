const { createSentinelGate } = require('../../../core/priorityMiddlewares/runtimeGate');

/**
 * Doppio del reserved gate. Il sentinel gate gli delega il 404 proprio perché
 * un solo posto deve produrlo: qui si verifica che la delega avvenga davvero.
 */
function makeReservedGate({ closed = false, reservedPaths = [] } = {}) {
  return {
    denyCalls: 0,
    deny(ctx) { this.denyCalls++; ctx.status = 404; ctx.body = 'Not Found'; },
    isClosed: () => closed,
    isReservedPath: (p) => reservedPaths.includes(p),
  };
}

function makeCtx(path = '/x', status = 200) {
  return {
    path,
    status,
    body: undefined,
    headers: {},
    setCalls: {},
    set(name, value) { this.setCalls[name] = value; },
  };
}

/** next() che registra di essere stato chiamato e imposta uno status finale. */
function makeNext(finalStatus) {
  const fn = async () => { fn.called = true; if (finalStatus !== undefined) fn.ctx.status = finalStatus; };
  fn.called = false;
  return fn;
}

const baseConf = { globalPrefix: '', debugMode: 0 };

function engineReturning(verdict, extra = {}) {
  return {
    evaluateCalls: 0,
    observeCalls: [],
    evaluate(ctx) { this.evaluateCalls++; return typeof verdict === 'function' ? verdict(ctx) : verdict; },
    observeOutcome(ctx, info) { this.observeCalls.push({ status: ctx.status, info }); },
    ...extra,
  };
}

describe('stato del gate', () => {
  test('stopped: il motore non viene nemmeno interrogato', async () => {
    const engine = engineReturning({ action: 'block', enforce: true, ruleName: 'r' });
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate(), initialState: 'stopped' });
    gate.setEngine(engine);

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(next.called).toBe(true);
    expect(engine.evaluateCalls).toBe(0);
  });

  // Il secondo tetto: la configurazione può dire enforce, ma il gate no.
  test('monitor: il motore decide ma nulla viene applicato', async () => {
    const reserved = makeReservedGate();
    const engine = engineReturning({ action: 'block', enforce: true, ruleName: 'r' });
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved, initialState: 'monitor' });
    gate.setEngine(engine);

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(engine.evaluateCalls).toBe(1);   // osserva
    expect(reserved.denyCalls).toBe(0);     // ma non agisce
    expect(next.called).toBe(true);
  });

  test('setState rifiuta gli stati non previsti', () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    expect(() => gate.setState('inventato')).toThrow(/stato non valido/);
    ['running', 'monitor', 'stopped'].forEach((s) => expect(() => gate.setState(s)).not.toThrow());
  });

  test('notifica il motore a ogni cambio di stato', () => {
    const seen = [];
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine(engineReturning(null, { onGateState: (s) => seen.push(s) }));
    gate.setState('monitor');
    expect(seen).toEqual(['running', 'monitor']); // la prima all'installazione del motore
  });
});

describe('slot vuoto', () => {
  test('senza motore è un pass-through', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    expect(gate.hasEngine()).toBe(false);

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);
    expect(next.called).toBe(true);
  });

  test('un oggetto senza evaluate non viene accettato come motore', () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    expect(gate.setEngine({ qualcosa: true })).toBe(false);
    expect(gate.setEngine(null)).toBe(false);
    expect(gate.hasEngine()).toBe(false);
  });
});

describe('esenzioni non negoziabili', () => {
  // Bloccare acme-challenge impedisce il rinnovo dei certificati e fa cadere
  // l'HTTPS dopo 90 giorni: dev'essere una precondizione del core, non una
  // regola che si possa cancellare per distrazione.
  test('/.well-known/ non arriva mai al motore', async () => {
    const engine = engineReturning({ action: 'block', enforce: true, ruleName: 'r' });
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine(engine);

    const ctx = makeCtx('/.well-known/acme-challenge/token');
    const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(engine.evaluateCalls).toBe(0);
    expect(next.called).toBe(true);
  });

  test('l esenzione tiene conto del globalPrefix', async () => {
    const engine = engineReturning({ action: 'block', enforce: true, ruleName: 'r' });
    const gate = createSentinelGate({ ital8Conf: { globalPrefix: '/sito', debugMode: 0 }, reservedGate: makeReservedGate() });
    gate.setEngine(engine);

    const ctx = makeCtx('/sito/.well-known/acme-challenge/token');
    const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(engine.evaluateCalls).toBe(0);
  });
});

describe('fail-open', () => {
  test('un motore che lancia non ferma la richiesta', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine({ evaluate() { throw new Error('boom'); } });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);
    spy.mockRestore();

    expect(next.called).toBe(true);
  });

  test('l errore viene segnalato UNA volta sola, non a ogni richiesta', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine({ evaluate() { throw new Error('boom'); } });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
      await gate.middleware(ctx, next);
    }
    const calls = spy.mock.calls.length;
    spy.mockRestore();

    expect(calls).toBe(1);
  });

  test('un motore che si impianta viene abbandonato e la richiesta prosegue', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine({ evaluate: () => new Promise(() => { /* mai risolta */ }) });

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(next.called).toBe(true);
  }, 2000);
});

describe('applicazione delle azioni', () => {
  test('block delega il 404 al reserved gate', async () => {
    const reserved = makeReservedGate();
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({ action: 'block', enforce: true, ruleName: 'php-probe' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(reserved.denyCalls).toBe(1);
    expect(ctx.status).toBe(404);
    expect(next.called).toBe(false);
  });

  test('enforce:false lascia passare anche con azione block', async () => {
    const reserved = makeReservedGate();
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({ action: 'block', enforce: false, ruleName: 'php-probe' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(reserved.denyCalls).toBe(0);
    expect(next.called).toBe(true);
  });

  test.each(['allow', 'monitor'])('azione "%s" lascia sempre passare', async (action) => {
    const reserved = makeReservedGate();
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({ action, enforce: true, ruleName: 'r' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(reserved.denyCalls).toBe(0);
    expect(next.called).toBe(true);
  });

  test('decoy chiama la risposta fornita dal motore', async () => {
    let responded = false;
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine(engineReturning({
      action: 'decoy', enforce: true, ruleName: 'r',
      respond: async (ctx) => { responded = true; ctx.status = 200; ctx.body = 'finto'; },
    }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(responded).toBe(true);
    expect(ctx.body).toBe('finto');
  });

  test('senza respond, un azione decorante degrada al 404', async () => {
    const reserved = makeReservedGate();
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({ action: 'decoy', enforce: true, ruleName: 'r' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(reserved.denyCalls).toBe(1);
  });

  test('una respond che lancia degrada al 404 invece di rompere la risposta', async () => {
    const reserved = makeReservedGate();
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({
      action: 'decoy', enforce: true, ruleName: 'r',
      respond: async () => { throw new Error('decoy rotto'); },
    }));

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);
    spy.mockRestore();

    expect(reserved.denyCalls).toBe(1);
    expect(ctx.status).toBe(404);
  });
});

describe('non interferenza con la superficie riservata', () => {
  // Un 200 con contenuto finto su un percorso riservato mentre la superficie è
  // CHIUSA direbbe che quel percorso esiste: è il canale di enumerazione che il
  // reserved gate esiste per chiudere, e il suo 404 è presidiato da un test
  // byte-per-byte. Qui sentinel deve degradare, non decorare.
  test('a superficie chiusa, un decoy su path riservato diventa 404', async () => {
    const reserved = makeReservedGate({ closed: true, reservedPaths: ['/admin'] });
    let responded = false;
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({
      action: 'decoy', enforce: true, ruleName: 'r',
      respond: async () => { responded = true; },
    }));

    const ctx = makeCtx('/admin'); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(responded).toBe(false);
    expect(reserved.denyCalls).toBe(1);
  });

  test('a superficie APERTA lo stesso decoy viene servito', async () => {
    const reserved = makeReservedGate({ closed: false, reservedPaths: ['/admin'] });
    let responded = false;
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({
      action: 'decoy', enforce: true, ruleName: 'r',
      respond: async () => { responded = true; },
    }));

    const ctx = makeCtx('/admin'); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(responded).toBe(true);
    expect(reserved.denyCalls).toBe(0);
  });

  test('a superficie chiusa, un decoy su path NON riservato resta servito', async () => {
    const reserved = makeReservedGate({ closed: true, reservedPaths: ['/admin'] });
    let responded = false;
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: reserved });
    gate.setEngine(engineReturning({
      action: 'decoy', enforce: true, ruleName: 'r',
      respond: async () => { responded = true; },
    }));

    const ctx = makeCtx('/wp-login.php'); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(responded).toBe(true);
  });
});

describe('osservazione dell esito', () => {
  test('un 2xx non è un segnale e non viene osservato', async () => {
    const engine = engineReturning(null);
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine(engine);

    const ctx = makeCtx('/ok'); const next = makeNext(200); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(engine.observeCalls).toHaveLength(0);
  });

  test.each([404, 403, 500])('un %d viene osservato', async (status) => {
    const engine = engineReturning(null);
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine(engine);

    const ctx = makeCtx('/x'); const next = makeNext(status); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(engine.observeCalls).toHaveLength(1);
    expect(engine.observeCalls[0].status).toBe(status);
  });

  test('un observeOutcome che lancia non tocca la risposta già emessa', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: makeReservedGate() });
    gate.setEngine({ evaluate: () => null, observeOutcome() { throw new Error('boom'); } });

    const ctx = makeCtx('/x'); const next = makeNext(404); next.ctx = ctx;
    await expect(gate.middleware(ctx, next)).resolves.toBeUndefined();
  });
});

describe('header diagnostico', () => {
  test('assente in produzione: rivelerebbe l esistenza e la logica del filtro', async () => {
    const gate = createSentinelGate({ ital8Conf: { globalPrefix: '', debugMode: 0 }, reservedGate: makeReservedGate() });
    gate.setEngine(engineReturning({ action: 'block', enforce: true, ruleName: 'php-probe' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(ctx.setCalls['X-Sentinel-Rule']).toBeUndefined();
  });

  test('presente in debug, con il nome della regola', async () => {
    const gate = createSentinelGate({ ital8Conf: { globalPrefix: '', debugMode: 1 }, reservedGate: makeReservedGate() });
    gate.setEngine(engineReturning({ action: 'block', enforce: true, ruleName: 'php-probe' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(ctx.setCalls['X-Sentinel-Rule']).toBe('php-probe');
  });
});

describe('ripiego senza reserved gate', () => {
  test('produce comunque un 404 invece di non bloccare', async () => {
    const gate = createSentinelGate({ ital8Conf: baseConf, reservedGate: null });
    gate.setEngine(engineReturning({ action: 'block', enforce: true, ruleName: 'r' }));

    const ctx = makeCtx(); const next = makeNext(); next.ctx = ctx;
    await gate.middleware(ctx, next);

    expect(ctx.status).toBe(404);
    expect(next.called).toBe(false);
  });
});
