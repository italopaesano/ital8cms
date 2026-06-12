// Questo file segue lo standard del progetto ital8cms
'use strict';

const {
  PLACEHOLDER_SESSION_KEYS,
  keysAreInsecure,
  checkSessionKeys,
} = require('../../../core/sessionSecurity');

describe('sessionSecurity.PLACEHOLDER_SESSION_KEYS', () => {
  test('contiene i placeholder del file koaSession.json5 e della documentazione', () => {
    expect(PLACEHOLDER_SESSION_KEYS).toEqual(
      expect.arrayContaining([
        'key.segretussimmmmmm',
        'fbtgnrnyrmnytmtymyt',
        'brtnrynynyny',
        'key.secondaryKey123',
      ])
    );
  });

  test('è immutabile (frozen)', () => {
    expect(Object.isFrozen(PLACEHOLDER_SESSION_KEYS)).toBe(true);
  });
});

describe('sessionSecurity.keysAreInsecure', () => {
  test('array placeholder attuale → insicuro', () => {
    expect(keysAreInsecure(['key.segretussimmmmmm', 'fbtgnrnyrmnytmtymyt', 'brtnrynynyny'])).toBe(true);
  });

  test('una sola chiave placeholder tra chiavi buone → insicuro', () => {
    expect(keysAreInsecure(['Zx9_random-secure-key-abcdef012345', 'brtnrynynyny'])).toBe(true);
  });

  test('placeholder storico della documentazione → insicuro', () => {
    expect(keysAreInsecure(['key.secondaryKey123'])).toBe(true);
  });

  test('array vuoto → insicuro', () => {
    expect(keysAreInsecure([])).toBe(true);
  });

  test('valori non-array → insicuro', () => {
    expect(keysAreInsecure(null)).toBe(true);
    expect(keysAreInsecure(undefined)).toBe(true);
    expect(keysAreInsecure('una-stringa')).toBe(true);
    expect(keysAreInsecure({})).toBe(true);
  });

  test('chiavi casuali sicure → sicuro', () => {
    expect(
      keysAreInsecure([
        'Zx9_random-secure-key-abcdef0123456789AAA',
        'Qw8-another-secure-key-zyxwvu9876543210BBB',
      ])
    ).toBe(false);
  });
});

describe('sessionSecurity.checkSessionKeys', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // loadJson5 logga su console.error quando il file non esiste: lo silenziamo
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('sessione disabilitata in config → nessun warning, ritorna false', () => {
    const result = checkSessionKeys(
      { priorityMiddlewares: { session: false } },
      { sessionConfig: { keys: ['brtnrynynyny'] } } // insicure, ma sessione off
    );
    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('chiavi insicure (sessione attiva) → warning emesso, ritorna true', () => {
    const result = checkSessionKeys(
      {},
      { sessionConfig: { keys: ['key.segretussimmmmmm'] } }
    );
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[SESSION]');
    expect(warnSpy.mock.calls[0][0]).toContain('npm run start-configure');
  });

  test('chiavi sicure → nessun warning, ritorna false', () => {
    const result = checkSessionKeys(
      {},
      { sessionConfig: { keys: ['Zx9_random-secure-key-abcdef0123456789AAA', 'Qw8-another-secure-key-BBB000111222333'] } }
    );
    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('config di sessione illeggibile (path inesistente) → nessun crash, ritorna false', () => {
    const result = checkSessionKeys({}, { configPath: '/path/che/non/esiste/koaSession.json5' });
    expect(result).toBe(false);
    // viene loggato un warning di lettura, ma la funzione non lancia
    expect(warnSpy).toHaveBeenCalled();
  });
});
