/**
 * Unit test: una sola istanza per cartella × REVIEW.md → B7.
 *
 * ital8cms archivia i dati su **file** e non ha lock fra processi: la coda di
 * `core/json5UpdateQueue.js` serializza, ma vive **in memoria**, quindi copre un
 * processo solo. Due istanze sulla stessa cartella si sovrascrivono le modifiche
 * a vicenda, in silenzio.
 *
 * E i documenti raccomandano `pm2`: `pm2 start index.js -i max` — che è il motivo
 * per cui si usa pm2 — avvia N processi sulle stesse cartelle.
 *
 * I due test che contano più degli altri sono gli ultimi due: il lock **orfano**
 * (un crash non deve richiedere un intervento manuale) e il lock **copiato** (i
 * test d'integrazione copiano l'intero progetto in una tmpdir, e un lock copiato
 * con un PID vivo bloccherebbe ogni fixture con un errore incomprensibile).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireSingleProcessLock,
  releaseSingleProcessLock,
  warnAlreadyRunning,
  LOCK_FILENAME,
} = require('../../../core/singleProcessLock');

const radici = [];

function radice() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-lock-'));
  radici.push(dir);
  return dir;
}

const scriviLock = (root, dati) =>
  fs.writeFileSync(path.join(root, LOCK_FILENAME), JSON.stringify(dati), 'utf8');

const leggiLock = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, LOCK_FILENAME), 'utf8'));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const dir of radici) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  radici.length = 0;
});

describe('acquisizione', () => {
  test('cartella libera → preso, e il file contiene PID e radice', () => {
    const root = radice();

    const esito = acquireSingleProcessLock({ projectRoot: root });

    expect(esito).toMatchObject({ acquired: true, reason: 'free' });
    expect(leggiLock(root)).toMatchObject({ pid: process.pid, projectRoot: root });
  });

  test('un altro processo VIVO sulla stessa cartella → rifiutato', () => {
    const root = radice();
    // `process.ppid` è vivo per definizione: è chi ha lanciato questo test.
    scriviLock(root, { pid: process.ppid, projectRoot: root, startedAt: 'ieri' });

    const esito = acquireSingleProcessLock({ projectRoot: root });

    expect(esito.acquired).toBe(false);
    expect(esito.reason).toBe('held');
    expect(esito.heldBy.pid).toBe(process.ppid);
  });

  test('il lock di un PID non più vivo è ORFANO: si prende il posto', () => {
    // Un crash non deve richiedere un intervento manuale, altrimenti il rimedio
    // diventa peggio del male.
    const root = radice();
    scriviLock(root, { pid: 2 ** 22, projectRoot: root });   // PID irraggiungibile

    const esito = acquireSingleProcessLock({ projectRoot: root });

    expect(esito).toMatchObject({ acquired: true, reason: 'stale' });
    expect(leggiLock(root).pid).toBe(process.pid);
  });

  test('un lock con una RADICE diversa è una COPIA: si ignora', () => {
    // Succede davvero: i test d'integrazione copiano l'intero progetto in una
    // tmpdir, e senza questo controllo un lock copiato con un PID vivo (il
    // server di sviluppo di chi lancia i test) bloccherebbe ogni fixture.
    const root = radice();
    scriviLock(root, { pid: process.ppid, projectRoot: '/una/altra/installazione' });

    const esito = acquireSingleProcessLock({ projectRoot: root });

    expect(esito).toMatchObject({ acquired: true, reason: 'copied' });
  });

  test('il nostro stesso PID non blocca un riavvio in-process', () => {
    const root = radice();
    acquireSingleProcessLock({ projectRoot: root });

    expect(acquireSingleProcessLock({ projectRoot: root }).acquired).toBe(true);
  });

  test.each([
    ['non è JSON', 'questo non è json'],
    ['è JSON ma non un oggetto', '"stringa"'],
    ['è vuoto', ''],
  ])('un lock illeggibile (%s) non blocca l\'avvio', (_caso, contenuto) => {
    const root = radice();
    fs.writeFileSync(path.join(root, LOCK_FILENAME), contenuto, 'utf8');

    expect(acquireSingleProcessLock({ projectRoot: root }).acquired).toBe(true);
  });

  test('se il lock non si può SCRIVERE il boot prosegue (fail-soft)', () => {
    // Su un filesystem di sola lettura rifiutare l'avvio sarebbe peggio del
    // rischio che si evita: il gate delle data dir scrivibili copre i casi veri.
    const esito = acquireSingleProcessLock({ projectRoot: path.join(path.sep, 'proc', 'non-scrivibile') });

    expect(esito.acquired).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('rilascio', () => {
  test('rilascia il proprio lock', () => {
    const root = radice();
    acquireSingleProcessLock({ projectRoot: root });

    expect(releaseSingleProcessLock({ projectRoot: root })).toBe(true);
    expect(fs.existsSync(path.join(root, LOCK_FILENAME))).toBe(false);
  });

  test('NON rilascia il lock di qualcun altro', () => {
    // Se il nostro è stato preso da un processo più recente, togliere il file lo
    // lascerebbe senza protezione.
    const root = radice();
    scriviLock(root, { pid: process.ppid, projectRoot: root });

    expect(releaseSingleProcessLock({ projectRoot: root })).toBe(false);
    expect(fs.existsSync(path.join(root, LOCK_FILENAME))).toBe(true);
  });

  test('su una cartella senza lock non fa nulla e non lancia', () => {
    expect(releaseSingleProcessLock({ projectRoot: radice() })).toBe(false);
  });
});

describe('il messaggio dice cosa fare', () => {
  test('nomina il PID, il file, e il comando pm2 da NON usare', () => {
    warnAlreadyRunning({ pid: 4242, startedAt: '2026-11-23T10:00:00Z' }, '/x/ital8cms.lock');

    const stampato = console.error.mock.calls.map((c) => c[0]).join('\n');
    expect(stampato).toContain('4242');
    expect(stampato).toContain('/x/ital8cms.lock');
    expect(stampato).toContain('-i max');            // il comando che causa il problema
    expect(stampato).toMatch(/kill 4242/);           // come fermare l'altra istanza
    expect(stampato).toMatch(/rm .*ital8cms\.lock/); // come rimuovere un orfano
  });
});

// ── Il gate è montato davvero ────────────────────────────────────────────────

describe('index.js usa il lock', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../index.js'), 'utf8');

  test('lo acquisisce e esce se non è libero', () => {
    expect(src).toMatch(/require\(['"]\.\/core\/singleProcessLock['"]\)/);
    expect(src).toMatch(/acquireSingleProcessLock\(\{ projectRoot: __dirname \}\)/);
    expect(src).toMatch(/warnAlreadyRunning\(/);
  });

  test('lo rilascia nella chiusura ordinata', () => {
    expect(src).toMatch(/releaseSingleProcessLock\(\{ projectRoot: __dirname \}\)/);
  });
});
