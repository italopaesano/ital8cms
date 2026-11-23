/**
 * Unit test: la coda di aggiornamento dei file JSON5 × REVIEW.md → B1 e B2.
 *
 * Il difetto presidiato qui è B2, il più insidioso dei due: Node esegue un solo
 * thread, quindi il ciclo leggi-modifica-scrivi è sicuro **finché non c'è un
 * `await` in mezzo**. In `updateUserProfile` c'era `await bcrypt.hash`, ~100 ms
 * di lentezza VOLUTA, durante i quali Node esegue altre richieste: due
 * salvataggi concorrenti si basavano sulla stessa copia del file e uno dei due
 * spariva — con entrambi gli utenti che leggevano « Modifica riuscita ».
 *
 * Il primo test riproduce esattamente quella finestra.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const loadJson5 = require('../../../core/loadJson5');
const { updateJson5Serialized, writeJson5Serialized, pendingQueueCount } =
  require('../../../core/json5UpdateQueue');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const creati = [];

function fileCon(data) {
  const f = path.join(os.tmpdir(), `queue-${Date.now()}-${Math.random().toString(36).slice(2)}.json5`);
  creati.push(f);
  fs.writeFileSync(f, JSON.stringify(data), 'utf8');
  return f;
}

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => {
  jest.restoreAllMocks();
  for (const f of creati) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
  creati.length = 0;
});

// ── Il difetto B2, riprodotto ────────────────────────────────────────────────

describe('lost update — la finestra di `await bcrypt.hash`', () => {
  test('due modifiche concorrenti sopravvivono entrambe', async () => {
    const f = fileCon({ users: { alice: { email: 'a@x' }, bob: { email: 'b@x' } } });

    // A è lenta come bcrypt; B arriva durante la sua attesa.
    await Promise.all([
      updateJson5Serialized(f, async (d) => { await sleep(60); d.users.alice.email = 'alice@nuovo'; return d; }),
      updateJson5Serialized(f, async (d) => { d.users.bob.email = 'bob@nuovo'; return d; }),
    ]);

    const finale = loadJson5(f);
    expect(finale.users.alice.email).toBe('alice@nuovo');
    expect(finale.users.bob.email).toBe('bob@nuovo');   // prima sparivano
  });

  test('il mutatore vede SEMPRE il dato fresco, non quello di partenza', async () => {
    const f = fileCon({ n: 0 });
    const visti = [];

    await Promise.all(
      [1, 2, 3, 4, 5].map(() => updateJson5Serialized(f, async (d) => {
        visti.push(d.n);
        await sleep(5);
        d.n += 1;
        return d;
      }))
    );

    expect(loadJson5(f).n).toBe(5);              // nessun incremento perso
    expect(visti).toEqual([0, 1, 2, 3, 4]);      // ognuno ha visto il precedente
  });

  test('cancellazione e modifica insieme: l\'utente cancellato non resuscita', async () => {
    // Lo scenario misto della scheda: un admin cancella un utente mentre quello
    // sta cambiando la propria email.
    const f = fileCon({ users: { carla: { email: 'c@x' } } });

    await Promise.all([
      updateJson5Serialized(f, async (d) => { await sleep(40); delete d.users.carla; return d; }),
      updateJson5Serialized(f, async (d) => {
        if (!d.users.carla) return null;        // riletto: non c'è più → non scrive
        d.users.carla.email = 'c@nuovo';
        return d;
      }),
    ]);

    expect(loadJson5(f).users.carla).toBeUndefined();
  });
});

// ── Il contratto ─────────────────────────────────────────────────────────────

describe('contratto', () => {
  test('restituire null non scrive nulla', async () => {
    const f = fileCon({ a: 1 });
    const prima = fs.readFileSync(f, 'utf8');

    const esito = await updateJson5Serialized(f, () => null);

    expect(esito.written).toBe(false);
    expect(fs.readFileSync(f, 'utf8')).toBe(prima);
  });

  test('un mutatore che lancia propaga l\'errore e NON blocca la coda', async () => {
    const f = fileCon({ a: 1 });

    await expect(updateJson5Serialized(f, () => { throw new Error('boom'); })).rejects.toThrow('boom');

    const esito = await updateJson5Serialized(f, (d) => { d.b = 2; return d; });
    expect(esito.written).toBe(true);
    expect(loadJson5(f).b).toBe(2);
  });

  test('file inesistente: errore, oppure il fallback se dato', async () => {
    const assente = path.join(os.tmpdir(), `mai-esistito-${Date.now()}.json5`);

    await expect(updateJson5Serialized(assente, (d) => d)).rejects.toThrow();

    creati.push(assente);
    const esito = await updateJson5Serialized(assente, (d) => { d.nato = true; return d; }, { fallback: {} });
    expect(esito.written).toBe(true);
    expect(loadJson5(assente).nato).toBe(true);
  });

  test('writeJson5Serialized sta nella STESSA coda dell\'update', async () => {
    // Se fossero code diverse, la serializzazione sarebbe un'illusione.
    const f = fileCon({ n: 0 });

    await Promise.all([
      updateJson5Serialized(f, async (d) => { await sleep(40); d.n = 1; return d; }),
      writeJson5Serialized(f, { n: 99 }),
    ]);

    expect(loadJson5(f).n).toBe(99);   // la scrittura è arrivata DOPO, non in mezzo
  });

  test('due nomi diversi dello stesso file finiscono nella stessa coda', async () => {
    const f = fileCon({ n: 0 });
    const alias = path.join(path.dirname(f), '.', path.basename(f));

    await Promise.all([
      updateJson5Serialized(f, async (d) => { await sleep(40); d.n += 10; return d; }),
      updateJson5Serialized(alias, async (d) => { d.n += 1; return d; }),
    ]);

    expect(loadJson5(f).n).toBe(11);   // 0 +10 +1, nessuno sovrascritto
  });
});

// ── La scrittura è atomica (B1) ──────────────────────────────────────────────

describe('atomicità (B1)', () => {
  test('non lascia mai un file troncato: passa da saveJson5 (temp + rename)', async () => {
    const f = fileCon({ users: { a: 1 } });

    await updateJson5Serialized(f, (d) => { d.users.b = 2; return d; });

    // Il contenuto è parsabile e completo, e nessun .tmp resta in giro.
    expect(loadJson5(f).users).toEqual({ a: 1, b: 2 });
    expect(fs.existsSync(`${f}.tmp`)).toBe(false);
  });
});

// ── La Map non cresce senza fine ─────────────────────────────────────────────

describe('la coda si libera', () => {
  test('dopo l\'ultimo accodato la voce del file sparisce', async () => {
    const f = fileCon({ a: 1 });

    await updateJson5Serialized(f, (d) => { d.b = 2; return d; });
    await sleep(20);

    expect(pendingQueueCount()).toBe(0);
  });
});
