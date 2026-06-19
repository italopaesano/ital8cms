// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per core/processSafetyNet.js — rete di sicurezza a livello di processo.
 *
 * Strategia: NON emettiamo eventi reali 'uncaughtException'/'unhandledRejection'
 * (interferirebbero con jest); usiamo il dispatcher restituito da
 * installProcessSafetyNet() e mockiamo process.exit. I listener registrati su
 * process vengono tracciati e rimossi in afterEach per non leakare tra i test.
 * jest.resetModules() in beforeEach azzera il flag di rientranza handlingFatal.
 */

const MODULE_PATH = '../../../core/processSafetyNet';

let addedUncaught = [];
let addedRejection = [];

/** Installa la rete e tiene traccia dei listener aggiunti (per la pulizia). */
function installAndTrack(installFn, opts) {
  const beforeU = process.listeners('uncaughtException');
  const beforeR = process.listeners('unhandledRejection');
  const dispatcher = installFn(opts);
  addedUncaught = process.listeners('uncaughtException').filter((l) => !beforeU.includes(l));
  addedRejection = process.listeners('unhandledRejection').filter((l) => !beforeR.includes(l));
  return dispatcher;
}

beforeEach(() => {
  jest.resetModules(); // azzera handlingFatal (stato a livello di modulo)
});

afterEach(() => {
  addedUncaught.forEach((l) => process.removeListener('uncaughtException', l));
  addedRejection.forEach((l) => process.removeListener('unhandledRejection', l));
  addedUncaught = [];
  addedRejection = [];
  jest.restoreAllMocks();
});

describe('processSafetyNet.toError', () => {
  test('un Error passa invariato', () => {
    const { toError } = require(MODULE_PATH);
    const e = new Error('boom');
    expect(toError(e)).toBe(e);
  });

  test('una stringa diventa un Error con quel messaggio', () => {
    const { toError } = require(MODULE_PATH);
    const e = toError('qualcosa è andato storto');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('qualcosa è andato storto');
  });

  test('un valore non-Error/non-stringa diventa un Error (inspect)', () => {
    const { toError } = require(MODULE_PATH);
    const e = toError({ code: 42 });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('42');
  });
});

describe('processSafetyNet.warnFatalError', () => {
  test('stampa un box con tipo, messaggio, stack e nota di uscita', () => {
    const { warnFatalError } = require(MODULE_PATH);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnFatalError('uncaughtException', new Error('messaggio-di-test'));
    expect(spy).toHaveBeenCalledTimes(1);
    const out = spy.mock.calls[0][0];
    expect(out).toContain('[FATAL]');
    expect(out).toContain('uncaughtException');
    expect(out).toContain('messaggio-di-test');
    expect(out).toContain('Stack trace:');
    expect(out).toContain('exit 1');
  });
});

describe('processSafetyNet.installProcessSafetyNet', () => {
  test('registra un listener per uncaughtException e uno per unhandledRejection', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    installAndTrack(installProcessSafetyNet, { onFatal: () => {} });
    expect(addedUncaught).toHaveLength(1);
    expect(addedRejection).toHaveLength(1);
  });

  test('su errore fatale chiama onFatal con tipo + Error e stampa il box (no exit se onFatal ok)', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const onFatal = jest.fn();

    const dispatch = installAndTrack(installProcessSafetyNet, { onFatal });
    dispatch('uncaughtException', new Error('boom'));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBe('uncaughtException');
    expect(onFatal.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(onFatal.mock.calls[0][1].message).toBe('boom');
    expect(errSpy).toHaveBeenCalled();          // box stampato
    expect(exitSpy).not.toHaveBeenCalled();      // onFatal gestisce la chiusura
  });

  test('normalizza un reason non-Error (unhandledRejection con stringa)', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => {});
    const onFatal = jest.fn();

    const dispatch = installAndTrack(installProcessSafetyNet, { onFatal });
    dispatch('unhandledRejection', 'rejection-stringa');

    expect(onFatal.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(onFatal.mock.calls[0][1].message).toBe('rejection-stringa');
  });

  test('senza onFatal → process.exit(1)', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const dispatch = installAndTrack(installProcessSafetyNet, {});
    dispatch('uncaughtException', new Error('boom'));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('se onFatal lancia → process.exit(1) forzato', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const onFatal = jest.fn(() => { throw new Error('shutdown rotto'); });

    const dispatch = installAndTrack(installProcessSafetyNet, { onFatal });
    dispatch('uncaughtException', new Error('boom'));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('rientranza: un secondo errore fatale durante la gestione → exit(1) immediato', () => {
    const { installProcessSafetyNet } = require(MODULE_PATH);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    // onFatal "lento": non esce, lasciando handlingFatal = true
    const onFatal = jest.fn();

    const dispatch = installAndTrack(installProcessSafetyNet, { onFatal });
    dispatch('uncaughtException', new Error('primo'));   // handlingFatal → true
    dispatch('unhandledRejection', new Error('secondo')); // deve forzare exit

    expect(onFatal).toHaveBeenCalledTimes(1);   // il secondo NON richiama onFatal
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
