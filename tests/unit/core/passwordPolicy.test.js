/**
 * Unit test: la policy delle password × REVIEW.md → C4.
 *
 * Il difetto: tre regole diverse per la stessa cosa — e la più permissiva era
 * quella sul percorso più privilegiato.
 *
 *   scripts/lib/validators.js → password()   ≥ 8 + maiuscola + minuscola + cifra
 *   plugins/adminUsers/main.js (profilo)     ≥ 6
 *   plugins/adminUsers/userManagement.js     NESSUN controllo
 *
 * Il terzo è il punto che crea l'utente **più privilegiato del sistema**,
 * incluso il primo root: una password di un carattere veniva accettata.
 * (La scheda ne contava due; la terza, quella del wizard, l'ha trovata la misura.)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validatePassword, MIN_PASSWORD_LENGTH } = require('../../../core/passwordPolicy');

describe('la regola adottata è la più stretta delle tre', () => {
  test('accetta una password conforme', () => {
    expect(validatePassword('Zx9-montagna-Lenta')).toEqual({ valid: true, error: null });
  });

  test.each([
    ['', 'obbligatoria'],
    ['   ', 'obbligatoria'],
    [null, 'obbligatoria'],
    [undefined, 'obbligatoria'],
    ['Abc1234', 'corta'],              // 7 caratteri
    ['abcdefg1', 'maiuscola'],
    ['ABCDEFG1', 'minuscola'],
    ['Abcdefgh', 'numero'],
  ])('rifiuta %p → %s', (value, atteso) => {
    const esito = validatePassword(value);
    expect(esito.valid).toBe(false);
    expect(esito.error.toLowerCase()).toContain(atteso);
  });

  test('il minimo è 8, non 6: una di 7 è rifiutata, una di 8 passa', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(validatePassword('Abcdef1').valid).toBe(false);   // 7
    expect(validatePassword('Abcdefg1').valid).toBe(true);   // 8
  });
});

describe('la denylist, perché i requisiti di composizione non bastano', () => {
  test('`Password1` soddisfa TUTTI i requisiti e viene rifiutata comunque', () => {
    // Era l'esempio di password VALIDA nel test del wizard: un criterio di
    // composizione che approva il proprio controesempio è il motivo per cui la
    // denylist esiste.
    const esito = validatePassword('Password1');
    expect(esito.valid).toBe(false);
    expect(esito.error).toMatch(/comune/i);
  });

  test.each(['Password1', 'Welcome1', 'Qwerty123', 'Admin123', 'Letmein1'])(
    '%s è rifiutata come troppo comune', (value) => {
      expect(validatePassword(value).valid).toBe(false);
    });

  test('il confronto ignora maiuscole e minuscole', () => {
    // `PASSWORD1` non è più segreta di `password1`.
    for (const variante of ['PASSWORD123', 'PassWord123', 'password123']) {
      // (le varianti che non superano i requisiti sono rifiutate prima, ma mai accettate)
      expect(validatePassword(variante).valid).toBe(false);
    }
  });

  test('una password lunga e non comune passa, anche senza simboli', () => {
    expect(validatePassword('Montagna9Lenta').valid).toBe(true);
  });
});

// ── I tre punti usano la stessa regola ───────────────────────────────────────

describe('non esistono più tre policy', () => {
  const leggi = (rel) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

  test.each([
    ['scripts/lib/validators.js', /require\(['"]\.\.\/\.\.\/core\/passwordPolicy['"]\)/],
    ['plugins/adminUsers/main.js', /require\(['"]\.\.\/\.\.\/core\/passwordPolicy['"]\)/],
    ['plugins/adminUsers/userManagement.js', /require\(['"]\.\.\/\.\.\/core\/passwordPolicy['"]\)/],
  ])('%s importa la policy condivisa', (rel, pattern) => {
    expect(leggi(rel)).toMatch(pattern);
  });

  test('il minimo di 6 caratteri non compare più nel profilo utente', () => {
    expect(leggi('plugins/adminUsers/main.js')).not.toMatch(/newPassword\.length < 6/);
  });

  test('la creazione utente non arriva più all\'hash senza controllare', () => {
    const src = leggi('plugins/adminUsers/userManagement.js');
    const posValidazione = src.indexOf('validatePassword(password)');
    const posHash = src.indexOf('bcryptjs.hash(password');
    expect(posValidazione).toBeGreaterThan(-1);
    // Prima dell'hash: non si spendono 100 ms di bcrypt per rifiutare.
    expect(posValidazione).toBeLessThan(posHash);
  });
});
