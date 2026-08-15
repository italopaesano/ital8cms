/**
 * sentinelLog.test.js
 *
 * Il log degli eventi non aveva test propri, e nascondeva due difetti di natura
 * opposta — uno di costo, uno di significato.
 *
 *   • **Una write per riga.** L'atomicità che il modulo si impegna a preservare
 *     (una `write` in O_APPEND sotto 4 KB non si interlaccia con quella di un
 *     altro processo, ed è ciò che rende sensato `instanceId` in cluster)
 *     riguarda la DIMENSIONE della write, non il numero di righe. Scriverne una
 *     alla volta era la lettura più severa del vincolo, pagata con una syscall
 *     sincrona per evento proprio sotto attacco, quando gli eventi al secondo
 *     sono migliaia e l'event loop è il tempo di risposta dell'intero sito.
 *
 *   • **L'allerta sul budget disco partiva come "INFO".** `enforceSizeBudget`
 *     emetteva `kind: 'log-size-threshold'`, che nella tabella `ALERT_SEVERITY`
 *     di `alertDispatcher` non esiste — quindi severità di ripiego, e un oggetto
 *     email che non distingue la riga da alzarsi a leggere dalle altre. Il
 *     difetto era invisibile perché i due moduli avevano un'idea diversa dello
 *     stesso nome e nessun test li faceva parlare fra loro: quelli del
 *     dispatcher notificavano già `diskBudget`, il nome giusto.
 *
 * Da qui la forma di questo file: la parte sull'allerta collega DAVVERO i due
 * moduli invece di verificarli separatamente, perché è esattamente lì che il
 * difetto si nascondeva.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SentinelLog, batchLines, MAX_ATOMIC_WRITE_BYTES,
} = require('../../lib/sentinelLog');
const { AlertDispatcher, ALERT_SEVERITY } = require('../../lib/alertDispatcher');

let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-log-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Un evento di dimensione nota, per ragionare sui blocchi in byte. */
function eventOfSize(bytes) {
  // {"p":"..."}\n → 9 caratteri di cornice più il riempimento
  return { p: 'x'.repeat(Math.max(1, bytes - 9)) };
}

describe('batchLines — raggruppare senza perdere l atomicità', () => {
  test('più righe piccole finiscono in un solo blocco', () => {
    const chunks = batchLines([{ a: 1 }, { a: 2 }, { a: 3 }], MAX_ATOMIC_WRITE_BYTES);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].split('\n').filter(Boolean)).toHaveLength(3);
  });

  test('nessun blocco supera il tetto atomico', () => {
    const events = Array.from({ length: 400 }, (_, i) => eventOfSize(100 + i));
    for (const chunk of batchLines(events, MAX_ATOMIC_WRITE_BYTES)) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(MAX_ATOMIC_WRITE_BYTES);
    }
  });

  test('una riga più grande del tetto esce da sola invece di trascinarsi le altre', () => {
    const chunks = batchLines(
      [{ a: 1 }, eventOfSize(MAX_ATOMIC_WRITE_BYTES + 500), { a: 2 }],
      MAX_ATOMIC_WRITE_BYTES,
    );
    // Il gigante non deve stare in blocco con nessuno: spezzarlo produrrebbe
    // JSONL non valido, che è molto peggio di una write non atomica.
    const giant = chunks.find((c) => Buffer.byteLength(c, 'utf8') > MAX_ATOMIC_WRITE_BYTES);
    expect(giant).toBeDefined();
    expect(giant.split('\n').filter(Boolean)).toHaveLength(1);
  });

  test('nessun evento perso e ordine conservato', () => {
    const events = Array.from({ length: 500 }, (_, i) => ({ n: i }));
    const rows = batchLines(events, MAX_ATOMIC_WRITE_BYTES)
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(rows).toHaveLength(500);
    expect(rows.map((r) => r.n)).toEqual(events.map((e) => e.n));
  });

  test('nessun evento, nessun blocco', () => {
    expect(batchLines([], MAX_ATOMIC_WRITE_BYTES)).toEqual([]);
  });
});

describe('flush — il file risultante è identico, il numero di write no', () => {
  test('scrive tutte le righe come JSONL valido', () => {
    const log = new SentinelLog(dataDir, { flushIntervalSeconds: 0 }, {});
    for (let i = 0; i < 250; i++) log.append({ n: i, path: `/p${i}` });
    log.flush();

    const file = fs.readdirSync(dataDir).find((f) => f.endsWith('.jsonl'));
    const rows = fs.readFileSync(path.join(dataDir, file), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));

    expect(rows).toHaveLength(250);
    expect(rows[0].path).toBe('/p0');
    expect(rows[249].path).toBe('/p249');
  });

  test('molti eventi costano molte meno write che eventi', () => {
    const log = new SentinelLog(dataDir, { flushIntervalSeconds: 60 }, {});
    for (let i = 0; i < 1000; i++) log.append({ n: i, ruleName: 'php-probe' });

    const spy = jest.spyOn(fs, 'appendFileSync');
    log.flush();
    const writes = spy.mock.calls.length;
    spy.mockRestore();

    // Prima era esattamente 1000. Il valore preciso dipende dalla dimensione
    // degli eventi; ciò che conta è l'ordine di grandezza.
    expect(writes).toBeLessThan(100);
    expect(writes).toBeGreaterThan(0);
  });

  test('il buffer si svuota anche quando la scrittura fallisce', () => {
    // Fail-soft: gli eventi si perdono, la memoria no. Un buffer che ricresce
    // ad ogni tentativo fallito sarebbe il modo di far cadere il processo
    // proprio mentre il disco è già in difficoltà.
    const log = new SentinelLog(dataDir, { flushIntervalSeconds: 60 }, {});
    log.append({ n: 1 });

    const spy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('EROFS');
    });
    log.flush();
    spy.mockRestore();

    expect(log.pendingSize()).toBe(0);
  });
});

describe('allerta sul budget disco — il genere deve esistere per il dispatcher', () => {
  /** Riempie la data dir oltre la soglia d'allerta. */
  function fillOverThreshold() {
    fs.writeFileSync(path.join(dataDir, 'sentinel-2026-08-01.jsonl'), 'x'.repeat(900), 'utf8');
  }

  test('enforceSizeBudget emette un genere presente in ALERT_SEVERITY', () => {
    const received = [];
    const log = new SentinelLog(
      dataDir,
      { maxTotalBytes: 1000, alertAtPercent: 70 },
      { onAlert: (payload) => received.push(payload) },
    );
    fillOverThreshold();
    log.enforceSizeBudget();

    expect(received).toHaveLength(1);
    expect(ALERT_SEVERITY[received[0].kind]).toBeDefined();
  });

  test('attraversando il dispatcher, la gravità è "warning" e non quella di ripiego', () => {
    // È il collegamento che mancava: i due moduli verificati insieme, come
    // girano davvero. Separatamente passavano entrambi.
    const subjects = [];
    const dispatcher = new AlertDispatcher({
      getRecipient: () => 'ops@example.test',
      getMailer: () => ({ send: (msg) => { subjects.push(msg.subject); } }),
    });

    const log = new SentinelLog(
      dataDir,
      { maxTotalBytes: 1000, alertAtPercent: 70 },
      {
        onAlert: (payload) => {
          const { kind, ...rest } = payload;
          dispatcher.notify(kind, rest);
        },
      },
    );
    fillOverThreshold();
    log.enforceSizeBudget();

    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toContain('WARNING');
    expect(subjects[0]).not.toContain('INFO');
  });

  test('l allerta non si ripete finché l occupazione resta sopra soglia', () => {
    const received = [];
    const log = new SentinelLog(
      dataDir,
      { maxTotalBytes: 1000, alertAtPercent: 70 },
      { onAlert: (payload) => received.push(payload) },
    );
    fillOverThreshold();
    log.enforceSizeBudget();
    log.enforceSizeBudget();
    log.enforceSizeBudget();

    expect(received).toHaveLength(1);
  });
});
