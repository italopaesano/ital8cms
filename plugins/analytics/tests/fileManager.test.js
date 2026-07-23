/**
 * Unit test per plugins/analytics/lib/fileManager.js
 *
 * Focus: robustezza fail-soft delle scritture su disco (Opzione B + log-once).
 *
 * Contesto: la scrittura degli analytics è un effetto collaterale non critico.
 * Un fallimento del filesystem (dir dati mancante e non creabile, oppure
 * file/dir read-only o con permessi negati) NON deve mai propagare:
 *   - dalla rotta /stats (adminAnalytics.flushNow) diventerebbe un HTTP 500;
 *   - dal timer periodico di flush diventerebbe un uncaughtException → exit
 *     (crash-loop sotto systemd Restart=always);
 *   - in modalità flush immediato colpirebbe ogni richiesta.
 *
 * I guasti del filesystem sono iniettati via jest.spyOn(fs, ...) così i test
 * sono deterministici a prescindere dall'utente (root incluso, dove chmod non
 * basterebbe a rendere una dir non scrivibile).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Scalda la transform di babel dei moduli sotto test con fs REALE, prima che i
// singoli test spiino su fs. Babel carica la propria config via fs.existsSync
// durante la transform lazy al primo require: un mock globale di fs (usato dai
// test qui sotto) la corromperebbe ("Cannot find module babel.config.js"). Dopo
// questo warm-up la transform è in cache e i require nei test non toccano babel.
require('../lib/fileManager');
require('../lib/bufferManager');

/** Errore filesystem realistico con `code` impostato (es. EACCES, EROFS). */
function fsError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/** Simula: dir dati MANCANTE e mkdir che fallisce (es. read-only / permessi). */
function mockMkdirFailure(code = 'EACCES') {
  jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
    throw fsError(code, 'operation not permitted, mkdir');
  });
}

describe('fileManager — robustezza scritture (fail-soft + log-once)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // Modulo fresco a ogni test → il latch `dataDirWriteFailureLogged` riparte da false.
    jest.resetModules();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── ensureDataDir ────────────────────────────────────────────────────────

  describe('ensureDataDir()', () => {
    test('ritorna true senza creare nulla se la dir esiste già', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync');
      const { ensureDataDir } = require('../lib/fileManager');

      expect(ensureDataDir('/data/exists')).toBe(true);
      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('crea la dir e ritorna true se mancante ma creabile', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const { ensureDataDir } = require('../lib/fileManager');

      expect(ensureDataDir('/data/new')).toBe(true);
      expect(mkdirSpy).toHaveBeenCalledWith('/data/new', { recursive: true });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('NON lancia e ritorna false se mkdir fallisce, loggando una volta', () => {
      mockMkdirFailure('EACCES');
      const { ensureDataDir } = require('../lib/fileManager');

      let result;
      expect(() => { result = ensureDataDir('/ro/data'); }).not.toThrow();
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('impossibile creare la directory dati');
    });
  });

  // ── writeEvents: fail-soft ────────────────────────────────────────────────

  describe('writeEvents() — fail-soft', () => {
    test('non lancia e salta la scrittura se la dir non è creabile', () => {
      mockMkdirFailure();
      const appendSpy = jest.spyOn(fs, 'appendFileSync');
      const { writeEvents } = require('../lib/fileManager');

      expect(() => writeEvents('/ro/data', 'monthly', [{ id: 1 }])).not.toThrow();
      expect(appendSpy).not.toHaveBeenCalled(); // niente scrittura tentata
    });

    test('non lancia se appendFileSync fallisce (dir esiste ma non scrivibile)', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
        throw fsError('EROFS', 'read-only file system, open');
      });
      const { writeEvents } = require('../lib/fileManager');

      expect(() => writeEvents('/ro/data', 'monthly', [{ id: 1 }])).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('impossibile scrivere');
    });

    test('buffer vuoto → nessun accesso al filesystem', () => {
      const existsSpy = jest.spyOn(fs, 'existsSync');
      const appendSpy = jest.spyOn(fs, 'appendFileSync');
      const { writeEvents } = require('../lib/fileManager');

      writeEvents('/data', 'monthly', []);
      expect(existsSpy).not.toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
    });
  });

  // ── log-once ──────────────────────────────────────────────────────────────

  describe('log-once (throttling del journal)', () => {
    test('mkdir che fallisce di continuo → logga UNA sola volta', () => {
      mockMkdirFailure();
      const { writeEvents } = require('../lib/fileManager');

      for (let i = 0; i < 5; i++) writeEvents('/ro/data', 'monthly', [{ id: i }]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test('append che fallisce di continuo → logga UNA sola volta', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
        throw fsError('EROFS', 'read-only file system, open');
      });
      const { writeEvents } = require('../lib/fileManager');

      for (let i = 0; i < 5; i++) writeEvents('/ro/data', 'monthly', [{ id: i }]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test('una scrittura riuscita resetta il latch: un guasto successivo torna a loggare', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      let shouldFail = true;
      jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {
        if (shouldFail) throw fsError('EROFS', 'read-only file system, open');
        // successo: no-op (non tocca il disco reale)
      });
      const { writeEvents } = require('../lib/fileManager');

      writeEvents('/data', 'monthly', [{ id: 1 }]);        // guasto → log #1
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      shouldFail = false;
      writeEvents('/data', 'monthly', [{ id: 2 }]);        // successo → reset latch
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      shouldFail = true;
      writeEvents('/data', 'monthly', [{ id: 3 }]);        // nuovo guasto → log #2
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ── happy path (regressione: la scrittura reale funziona ancora) ───────────

  describe('happy path (filesystem reale)', () => {
    test('writeEvents scrive davvero le righe JSONL e readEventsFromFile le rilegge', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-fm-'));
      try {
        const { writeEvents, readEventsFromFile, getFileName, listDataFiles } = require('../lib/fileManager');
        const events = [
          { timestamp: '2026-07-23T10:00:00.000Z', path: '/a', statusCode: 200 },
          { timestamp: '2026-07-23T10:01:00.000Z', path: '/b', statusCode: 404 },
        ];

        writeEvents(tmpDir, 'monthly', events);

        const filePath = path.join(tmpDir, getFileName('monthly'));
        expect(readEventsFromFile(filePath)).toEqual(events);
        expect(listDataFiles(tmpDir)).toContain(filePath);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// ── BufferManager: nessun crash sul percorso di flush (la parte critica) ─────

describe('BufferManager.flush() — nessuna propagazione su FS non scrivibile', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('flush() esplicito (come da rotta /stats e timer) non lancia', () => {
    mockMkdirFailure();
    const BufferManager = require('../lib/bufferManager');
    // NB: non chiamiamo init() → nessun timer/handler registrato nei test.
    const bm = new BufferManager('/ro/data', { rotationMode: 'monthly', flushIntervalSeconds: 2 });
    bm.push({ id: 1 });

    expect(() => bm.flush()).not.toThrow();
  });

  test('push() in modalità flush immediato (flushIntervalSeconds=0) non lancia', () => {
    mockMkdirFailure();
    const BufferManager = require('../lib/bufferManager');
    const bm = new BufferManager('/ro/data', { rotationMode: 'monthly', flushIntervalSeconds: 0 });

    expect(() => bm.push({ id: 1 })).not.toThrow();
  });
});
