/**
 * tarpit.test.js
 *
 * La risposta a goccia. Qui i test non difendono la funzionalità — trattenere
 * una connessione è facile — ma i **limiti**, che sono la ragione per cui il
 * modulo può esistere senza essere un'arma puntata contro di noi:
 *
 *   1. IL TETTO. Superato, si degrada; non si accoda. Se accodasse, il tetto
 *      sposterebbe il consumo di risorse invece di fermarlo.
 *   2. IL RILASCIO ALLA CHIUSURA. Uno scanner con un timeout aggressivo stacca
 *      dopo pochi secondi: se il posto non si liberasse in quel momento, il
 *      tetto resterebbe occupato da connessioni che non esistono più — e
 *      basterebbe aprire e chiudere in fretta per saturarlo.
 *   3. `abortAll()`. `gracefulShutdown` aspetta le connessioni: senza, un
 *      riavvio durerebbe quanto il tarpit più lungo.
 *   4. IL TETTO DI DURATA NON E NEGOZIABILE DALLA REGOLA.
 */

'use strict';

const { EventEmitter } = require('events');
const { Tarpit } = require('../../lib/tarpit');

/**
 * Finto contesto Koa: quel che serve al tarpit è `ctx.res` — un writable che
 * emette `close` — e `ctx.respond`, che deve poter essere spento.
 */
function makeCtx() {
  const res = new EventEmitter();
  res.written = [];
  res.headers = null;
  res.statusCode = null;
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  res.write = (chunk) => { res.written.push(String(chunk)); return true; };
  res.end = (chunk) => {
    if (chunk) res.written.push(String(chunk));
    res.writableEnded = true;
  };
  res.socket = { destroyed: false, destroy() { this.destroyed = true; res.destroyed = true; } };

  return { res, respond: true };
}

const tick = () => new Promise((r) => setImmediate(r));

// ─────────────────────────────────────────────────────────────────────────────
describe('trattenimento', () => {
  test('la connessione viene trattenuta e il corpo comincia a uscire', async () => {
    const tarpit = new Tarpit({ maxSeconds: 0.05, intervalMs: 5 });
    const ctx = makeCtx();

    const outcome = await tarpit.hold(ctx);

    expect(outcome.held).toBe(true);
    expect(ctx.respond).toBe(false);          // la risposta è tolta di mano a Koa
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.res.written.length).toBeGreaterThan(1);
    expect(ctx.res.writableEnded).toBe(true);
  });

  test('non dichiara la lunghezza del corpo', () => {
    // È il motivo per cui il client resta in attesa invece di chiudere: senza
    // Content-Length non sa dove finisce la risposta.
    const tarpit = new Tarpit({ maxSeconds: 0.02, intervalMs: 5 });
    const ctx = makeCtx();
    return tarpit.hold(ctx).then(() => {
      const nomi = Object.keys(ctx.res.headers).map((h) => h.toLowerCase());
      expect(nomi).not.toContain('content-length');
    });
  });

  test('il primo pezzo somiglia a una pagina che sta caricando', async () => {
    // Servire subito spazi bianchi farebbe chiudere il client, e il tarpit non
    // avrebbe trattenuto nessuno.
    const tarpit = new Tarpit({ maxSeconds: 0.02, intervalMs: 5 });
    const ctx = makeCtx();
    await tarpit.hold(ctx);
    expect(ctx.res.written[0]).toContain('<!DOCTYPE html>');
  });

  test('la durata rispetta grossomodo quella richiesta', async () => {
    const tarpit = new Tarpit({ maxSeconds: 1, intervalMs: 5 });
    const ctx = makeCtx();

    const outcome = await tarpit.hold(ctx, { seconds: 0.08 });
    expect(outcome.ms).toBeGreaterThanOrEqual(70);
    expect(outcome.ms).toBeLessThan(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('il tetto di connessioni', () => {
  test('oltre il tetto rinuncia invece di accodare', async () => {
    const tarpit = new Tarpit({ maxConcurrent: 2, maxSeconds: 0.3, intervalMs: 5 });

    const a = tarpit.hold(makeCtx());
    const b = tarpit.hold(makeCtx());
    expect(tarpit.concurrent).toBe(2);

    const rifiutato = makeCtx();
    const c = await tarpit.hold(rifiutato);

    expect(c).toEqual({ held: false, ms: 0 });
    // Il contesto dev'essere INTATTO: il chiamante ci scriverà sopra il 404
    // comune, e se `respond` fosse già false quel 404 non uscirebbe mai.
    expect(rifiutato.respond).toBe(true);
    expect(rifiutato.res.statusCode).toBeNull();

    await Promise.all([a, b]);
  });

  test('il posto si libera quando la connessione finisce', async () => {
    const tarpit = new Tarpit({ maxConcurrent: 1, maxSeconds: 0.05, intervalMs: 5 });

    await tarpit.hold(makeCtx());
    expect(tarpit.concurrent).toBe(0);
    expect((await tarpit.hold(makeCtx())).held).toBe(true);
  });

  test('il tetto conta i rifiuti', async () => {
    const tarpit = new Tarpit({ maxConcurrent: 1, maxSeconds: 0.2, intervalMs: 5 });
    const tenuta = tarpit.hold(makeCtx());

    await tarpit.hold(makeCtx());
    await tarpit.hold(makeCtx());
    expect(tarpit.getStats().refused).toBe(2);

    await tenuta;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('rilascio alla chiusura del client', () => {
  test('il client che stacca libera il posto SUBITO', async () => {
    // Senza questo, chi apre e chiude in fretta saturerebbe il tetto pur non
    // restando mai in attesa: il costo sarebbe tutto nostro e zero suo.
    const tarpit = new Tarpit({ maxConcurrent: 1, maxSeconds: 60, intervalMs: 5 });
    const ctx = makeCtx();

    const inCorso = tarpit.hold(ctx);
    await tick();
    expect(tarpit.concurrent).toBe(1);

    ctx.res.emit('close');
    const outcome = await inCorso;

    expect(outcome.held).toBe(true);
    expect(tarpit.concurrent).toBe(0);
    expect(outcome.ms).toBeLessThan(1000);   // non ha aspettato i 60 secondi
  });

  test('un errore sul socket libera il posto come una chiusura', async () => {
    const tarpit = new Tarpit({ maxSeconds: 60, intervalMs: 5 });
    const ctx = makeCtx();

    const inCorso = tarpit.hold(ctx);
    await tick();
    ctx.res.emit('error', new Error('ECONNRESET'));

    await inCorso;
    expect(tarpit.concurrent).toBe(0);
  });

  test('una write che fallisce non lascia il posto occupato', async () => {
    const tarpit = new Tarpit({ maxSeconds: 60, intervalMs: 5 });
    const ctx = makeCtx();
    ctx.res.write = () => { throw new Error('socket sparito'); };

    const outcome = await tarpit.hold(ctx);
    expect(outcome.held).toBe(true);
    expect(tarpit.concurrent).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('spegnimento', () => {
  test('abortAll tronca tutte le connessioni trattenute', async () => {
    // gracefulShutdown aspetta le connessioni: senza questo, un riavvio
    // durerebbe quanto il tarpit più lungo — un fermo causato dalla propria
    // difesa.
    const tarpit = new Tarpit({ maxConcurrent: 5, maxSeconds: 60, intervalMs: 5 });
    const contesti = [makeCtx(), makeCtx(), makeCtx()];
    const attese = contesti.map((c) => tarpit.hold(c));
    await tick();

    expect(tarpit.abortAll()).toBe(3);
    await Promise.all(attese);

    expect(tarpit.concurrent).toBe(0);
    for (const c of contesti) expect(c.res.socket.destroyed).toBe(true);
  });

  test('abortAll senza connessioni attive è un no-op', () => {
    expect(new Tarpit().abortAll()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('la regola non può superare il tetto di durata', () => {
  test('una durata maggiore del massimo viene limitata', async () => {
    // Una durata scritta a mano nel file delle regole non deve poter tenere
    // occupato un socket più a lungo di quanto abbia deciso l'amministratore.
    const tarpit = new Tarpit({ maxSeconds: 0.05, intervalMs: 5 });
    const outcome = await tarpit.hold(makeCtx(), { seconds: 600 });
    expect(outcome.ms).toBeLessThan(1000);
  });

  test.each([[0], [-5], ['dieci'], [null]])('una durata non valida (%p) ricade sul massimo', async (seconds) => {
    const tarpit = new Tarpit({ maxSeconds: 0.05, intervalMs: 5 });
    const outcome = await tarpit.hold(makeCtx(), { seconds });
    expect(outcome.held).toBe(true);
    expect(outcome.ms).toBeLessThan(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('statistiche', () => {
  test('riportano trattenute, rifiuti e durata media', async () => {
    const tarpit = new Tarpit({ maxConcurrent: 1, maxSeconds: 0.05, intervalMs: 5 });
    await tarpit.hold(makeCtx());
    await tarpit.hold(makeCtx());

    const stats = tarpit.getStats();
    expect(stats.held).toBe(2);
    expect(stats.refused).toBe(0);
    expect(stats.maxConcurrent).toBe(1);
    expect(stats.averageHeldSeconds).toBeGreaterThanOrEqual(0);
  });
});
