/**
 * Unit test di configValidator — validazione al boot di pluginConfig + protectedRoutes.
 */

'use strict';

const { validate, validatePolicy } = require('../../lib/configValidator');

/** Policy di default valida e completa. */
function validDefaults() {
  return {
    findWindowSeconds: 900,
    maxFailures: 5,
    shortBlockSeconds: 300,
    maxShortBlocks: 5,
    longBlockSeconds: 86400,
    escalationResetSeconds: 86400,
  };
}

function validCustom() {
  return { enabled: true, defaults: validDefaults() };
}

describe('configValidator — validate()', () => {
  test('config completa e valida → valid', () => {
    const result = validate(validCustom(), { rules: [{ name: 'adminLogin' }] });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('custom mancante → invalid', () => {
    expect(validate(null, {}).valid).toBe(false);
    expect(validate(undefined, {}).valid).toBe(false);
  });

  test('defaults mancante → errore', () => {
    const result = validate({ enabled: true }, { rules: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/defaults/);
  });

  test('campo defaults non numerico → errore', () => {
    const custom = validCustom();
    custom.defaults.maxFailures = 'cinque';
    expect(validate(custom, { rules: [] }).valid).toBe(false);
  });

  test('campo defaults <= 0 → errore', () => {
    const custom = validCustom();
    custom.defaults.shortBlockSeconds = 0;
    expect(validate(custom, { rules: [] }).valid).toBe(false);
  });

  test('maxShortBlocks = 0 è ammesso (escalation immediata al long block)', () => {
    const custom = validCustom();
    custom.defaults.maxShortBlocks = 0;
    expect(validate(custom, { rules: [] }).valid).toBe(true);
  });

  test('maxShortBlocks negativo → errore', () => {
    const custom = validCustom();
    custom.defaults.maxShortBlocks = -1;
    expect(validate(custom, { rules: [] }).valid).toBe(false);
  });

  test('maxShortBlocks mancante nei defaults → errore', () => {
    const custom = validCustom();
    delete custom.defaults.maxShortBlocks;
    expect(validate(custom, { rules: [] }).valid).toBe(false);
  });

  test('rules non array → warning ma valido', () => {
    const result = validate(validCustom(), {});
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/rules/);
  });

  test('regola senza name → errore', () => {
    const result = validate(validCustom(), { rules: [{ maxFailures: 3 }] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/name/);
  });

  test('regola con name vuoto → errore', () => {
    expect(validate(validCustom(), { rules: [{ name: '' }] }).valid).toBe(false);
  });

  test('nomi regola duplicati → warning', () => {
    const result = validate(validCustom(), {
      rules: [{ name: 'dup' }, { name: 'dup' }],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/duplicat/i);
  });

  test('override parziale di regola → valido', () => {
    const result = validate(validCustom(), {
      rules: [{ name: 'adminLogin', maxFailures: 3 }],
    });
    expect(result.valid).toBe(true);
  });

  test('override di regola con valore invalido → errore', () => {
    const result = validate(validCustom(), {
      rules: [{ name: 'adminLogin', maxFailures: -1 }],
    });
    expect(result.valid).toBe(false);
  });
});

describe('configValidator — validatePolicy()', () => {
  test('partial=false richiede tutti i campi', () => {
    const r = validatePolicy({ maxFailures: 5 }, 'defaults', false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('partial=true ammette campi mancanti', () => {
    const r = validatePolicy({ maxFailures: 5 }, "rule 'x'", true);
    expect(r.errors).toHaveLength(0);
  });

  test('partial=true segnala comunque valori invalidi presenti', () => {
    const r = validatePolicy({ maxFailures: 0 }, "rule 'x'", true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
