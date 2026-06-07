'use strict';

/**
 * tokenManager.js — Generazione e confronto sicuro dei token CSRF.
 *
 * Il token è un valore casuale da 256 bit codificato base64url (sicuro per
 * attributi HTML e URL: alfabeto A-Z a-z 0-9 - _). Vive nella sessione koa
 * (cookie firmato), quindi non è forgiabile né leggibile cross-origin.
 */

const crypto = require('crypto');

/**
 * Genera un nuovo token CSRF casuale (256 bit, base64url).
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Confronto a tempo costante fra due stringhe (mitiga timing-attack).
 * Ritorna false — senza lanciare — per input non-stringa o di lunghezza diversa.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual richiede buffer di pari lunghezza: la disuguaglianza di
  // lunghezza è di per sé un mismatch (e non rivela nulla sul contenuto).
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

module.exports = { generateToken, safeEqual };
