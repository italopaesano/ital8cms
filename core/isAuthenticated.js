/**
 * IS AUTHENTICATED — una sola definizione di « autenticato »
 *
 * Esiste perché ce n'erano due (REVIEW.md → C5), in due punti che decidono la
 * stessa cosa con criteri diversi:
 *
 *   core/pluginSys.js (route-wrap)          → `!ctx.session || !ctx.session.authenticated`
 *   adminAccessControl (middleware pagine)  → `ctx.session?.user || null`
 *
 * Uno guarda il **flag**, l'altro l'**oggetto**. Oggi coincidono, perché il login
 * imposta entrambi i campi insieme e il logout azzera l'intera sessione. Ma è
 * una coincidenza **mantenuta a mano**: nulla impedisce che un giorno
 * `ctx.session.user` venga impostato senza `authenticated` — per ricordare
 * l'ultimo username in un form, o durante un flusso a due fattori. In quel
 * momento il controllo delle **pagine** considererebbe autenticato qualcuno che
 * il controllo delle **rotte** rifiuta: due superfici dello stesso sito con due
 * idee diverse di chi sei.
 *
 * La definizione qui è la più stretta delle due e pretende **entrambi** i campi:
 * un oggetto utente senza il flag non è una sessione autenticata, e un flag senza
 * l'oggetto non permette di decidere alcun ruolo.
 *
 * @module core/isAuthenticated
 */

'use strict';

/**
 * La sessione è autenticata?
 *
 * @param {object} ctx - Contesto Koa
 * @returns {boolean}
 */
function isAuthenticated(ctx) {
  const session = ctx && ctx.session;
  if (!session || session.authenticated !== true) return false;
  return !!session.user;
}

/**
 * L'utente della sessione, **solo se** la sessione è autenticata.
 *
 * Da usare al posto di `ctx.session?.user || null`: quella forma restituisce
 * l'oggetto anche quando il flag non c'è, che è precisamente la divergenza di C5.
 *
 * @param {object} ctx - Contesto Koa
 * @returns {object|null}
 */
function sessionUser(ctx) {
  return isAuthenticated(ctx) ? ctx.session.user : null;
}

module.exports = { isAuthenticated, sessionUser };
