'use strict';

const { validate } = require('../../lib/configValidator');

function baseCustom(over = {}) {
  return Object.assign({
    enabled: true,
    protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    tokenHeaderName: 'X-CSRF-Token',
    tokenFieldName: '_csrf',
    metaName: 'csrf-token',
    trustProxy: false,
    originCheck: { enabled: true, allowedOrigins: [] },
    exemptPaths: [],
    failureStatus: 403,
    enableLogging: true,
    strictValidation: false,
  }, over);
}

describe('csrfProtection · configValidator', () => {
  test('configurazione di default valida senza errori/warning', () => {
    const res = validate(baseCustom());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  test('custom assente → non valido', () => {
    expect(validate(undefined).valid).toBe(false);
    expect(validate(null).valid).toBe(false);
  });

  test('protectedMethods non array → errore', () => {
    const res = validate(baseCustom({ protectedMethods: 'POST' }));
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/protectedMethods/);
  });

  test('metodo non riconosciuto → warning (non bloccante)', () => {
    const res = validate(baseCustom({ protectedMethods: ['POST', 'FOO'] }));
    expect(res.valid).toBe(true);
    expect(res.warnings.join()).toMatch(/FOO/);
  });

  test('DEL è accettato (normalizzato a DELETE)', () => {
    const res = validate(baseCustom({ protectedMethods: ['POST', 'DEL'] }));
    expect(res.warnings.join()).not.toMatch(/DEL/);
  });

  test('campo stringa vuoto → errore', () => {
    expect(validate(baseCustom({ tokenHeaderName: '' })).valid).toBe(false);
    expect(validate(baseCustom({ tokenFieldName: '   ' })).valid).toBe(false);
    expect(validate(baseCustom({ metaName: 123 })).valid).toBe(false);
  });

  test('originCheck non oggetto → errore', () => {
    expect(validate(baseCustom({ originCheck: 'yes' })).valid).toBe(false);
  });

  test('allowedOrigins non array → errore', () => {
    expect(validate(baseCustom({ originCheck: { enabled: true, allowedOrigins: 'x' } })).valid).toBe(false);
  });

  test('allowedOrigins con origin sospetto → warning', () => {
    const res = validate(baseCustom({ originCheck: { enabled: true, allowedOrigins: ['example.com'] } }));
    expect(res.valid).toBe(true);
    expect(res.warnings.join()).toMatch(/example\.com/);
  });

  test('exemptPaths non array → errore', () => {
    expect(validate(baseCustom({ exemptPaths: '/x' })).valid).toBe(false);
  });

  test('failureStatus fuori range → warning', () => {
    const res = validate(baseCustom({ failureStatus: 200 }));
    expect(res.valid).toBe(true);
    expect(res.warnings.join()).toMatch(/failureStatus/);
  });
});
