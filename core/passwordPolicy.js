/**
 * PASSWORD POLICY — una sola regola, per tutti i punti che scrivono una password
 *
 * Esiste perché ce n'erano **tre**, non due come riportava la scheda
 * (REVIEW.md → C4):
 *
 *   scripts/lib/validators.js → password()   ≥ 8 + maiuscola + minuscola + cifra
 *   plugins/adminUsers/main.js (profilo)     ≥ 6
 *   plugins/adminUsers/userManagement.js     NESSUN controllo
 *
 * E il punto **senza alcun controllo** è quello che crea l'utente più
 * privilegiato del sistema: l'admin che crea un utente, **incluso il primo
 * root**. Una password di un carattere veniva accettata senza obiezioni.
 *
 * ─── LA REGOLA ADOTTATA È LA PIÙ STRETTA DELLE TRE ───────────────────────────
 * Quella del wizard, che già oggi protegge l'account root al primo avvio: ≥ 8
 * caratteri (il minimo assoluto indicato dal NIST), almeno una maiuscola, una
 * minuscola e una cifra. Adottarla altrove non indebolisce nessun percorso
 * esistente — li allinea tutti al più severo.
 *
 * ─── E UNA DENYLIST, COME LA SCHEDA CHIEDEVA ─────────────────────────────────
 * I requisiti di composizione da soli non bastano: `Password1` li soddisfa tutti
 * ed è fra le password più usate al mondo. Il confronto è case-insensitive,
 * perché `PASSWORD1` non è più segreta di `password1`.
 *
 * Nota che vale più dell'elenco: l'esempio di password **valida** nel test del
 * wizard era proprio `Password1`. Un criterio di composizione che approva il
 * proprio controesempio è il motivo per cui la denylist serve.
 *
 * @module core/passwordPolicy
 */

'use strict';

/** Minimo assoluto indicato dal NIST. Sotto gli 8 non si scende. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Le password più diffuse che **superano** i requisiti di composizione, più le
 * classiche che non li superano (presenti per dare un messaggio migliore di
 * « serve una maiuscola » a chi scrive `password`).
 *
 * Non è un dizionario: è una denylist corta e mirata, perché un elenco lungo
 * dentro il codice invecchia e dà l'illusione della completezza. Il confronto è
 * sulla forma minuscola.
 */
const COMMON_PASSWORDS = Object.freeze(new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'passw0rd', 'p@ssword1', 'p@ssw0rd', 'passsword1',
  'qwerty123', 'qwerty1234', 'qwertyui', 'qwerty123456',
  '12345678', '123456789', '1234567890', '123123123',
  'iloveyou1', 'letmein1', 'welcome1', 'welcome123', 'admin123',
  'administrator', 'adminadmin', 'root1234', 'rootroot',
  'abcd1234', 'abc12345', 'a1234567', 'test1234', 'changeme1',
  'football1', 'baseball1', 'dragon123', 'monkey123', 'sunshine1',
  'princess1', 'superman1', 'trustno1', 'master123', 'shadow123',
]));

/**
 * Valida una password secondo la politica del progetto.
 *
 * @param {string} password
 * @returns {{valid: boolean, error: string|null}}
 */
function validatePassword(password) {
  if (password === undefined || password === null || String(password).trim() === '') {
    return { valid: false, error: 'Password obbligatoria' };
  }

  const value = String(password);

  if (value.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password troppo corta (minimo ${MIN_PASSWORD_LENGTH} caratteri)` };
  }
  if (!/[A-Z]/.test(value)) {
    return { valid: false, error: 'Password deve contenere almeno una lettera maiuscola' };
  }
  if (!/[a-z]/.test(value)) {
    return { valid: false, error: 'Password deve contenere almeno una lettera minuscola' };
  }
  if (!/[0-9]/.test(value)) {
    return { valid: false, error: 'Password deve contenere almeno un numero' };
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return {
      valid: false,
      error: 'Password troppo comune: è fra quelle più usate al mondo e verrebbe indovinata subito',
    };
  }

  return { valid: true, error: null };
}

module.exports = { validatePassword, MIN_PASSWORD_LENGTH, COMMON_PASSWORDS };
