/**
 * keyResolver.js
 *
 * Estrae un identificatore stabile del client (tipicamente l'IP) dal contesto Koa.
 * Questo identificatore è la prima metà della chiave di rate limit (IP + ruleName).
 *
 * IMPORTANTE (sicurezza): l'header X-Forwarded-For è falsificabile dal client.
 * Va usato SOLO quando ital8cms è dietro un reverse proxy fidato che lo imposta
 * (es. nginx). Per questo la lettura dell'header è dietro il flag `trustProxy`.
 */

'use strict';

/**
 * Restituisce l'identificatore del client a partire dal contesto Koa.
 *
 * @param {object} ctx - Contesto Koa
 * @param {object} [options]
 * @param {boolean} [options.trustProxy=false] - Se true, legge X-Forwarded-For
 * @returns {string} - IP del client (o 'unknown' se non determinabile)
 */
function resolveClientId(ctx, options = {}) {
  const trustProxy = options.trustProxy === true;

  if (trustProxy && ctx && ctx.headers) {
    const xff = ctx.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      // X-Forwarded-For: "client, proxy1, proxy2" → il primo è il client originale
      const first = xff.split(',')[0].trim();
      if (first) {
        return first;
      }
    }
  }

  // Fallback: IP della socket. ctx.ip dipende da app.proxy in Koa; se non
  // impostato restituisce l'indirizzo remoto reale della connessione.
  const ip = (ctx && (ctx.ip || (ctx.request && ctx.request.ip))) || '';
  return ip || 'unknown';
}

module.exports = { resolveClientId };
