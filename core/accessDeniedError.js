/**
 * ACCESS DENIED ERROR — la sentinella che ferma il rendering di un template
 *
 * Esiste per un difetto preciso (REVIEW.md → A6): la guardia che i template
 * possono chiamare per proteggersi — `passData.plugin.adminAccessControl.check()`
 * — faceva `ctx.redirect(...)` e poi `return`. Ma quel `return` esce dalla
 * FUNZIONE, non dal template: l'EJS proseguiva, e `index.js` assegnava
 * `ctx.body` in modo incondizionato. Risultato: status 302 con **la pagina
 * protetta renderizzata per intero nel corpo**. Un browser segue il redirect e
 * non mostra nulla; `curl` senza `-L` legge tutto il contenuto.
 *
 * ─── PERCHÉ UN'ECCEZIONE E PERCHÉ STA NEL CORE ───────────────────────────────
 * Un'eccezione è l'unico meccanismo che interrompe davvero l'esecuzione di un
 * template EJS dall'interno di una funzione chiamata dal template. L'alternativa
 * — restituire un booleano e chiedere `<% if (!check(...)) return %>` — sposta la
 * responsabilità su chi scrive il template, cioè esattamente ciò che una guardia
 * esiste per evitare. (Quella forma resta comunque disponibile come `canAccess`,
 * per chi vuole decidere da sé: per esempio mostrare un messaggio invece di
 * redirigere.)
 *
 * Vive in `core/` e non nel plugin perché serve a DUE lati che non si conoscono:
 * la lancia `plugins/adminAccessControl`, la intercetta `index.js` nei tre punti
 * che renderizzano EJS. Un plugin non è il posto da cui il core importa.
 *
 * ─── IL REDIRECT È GIÀ IMPOSTATO QUANDO SI ARRIVA QUI ────────────────────────
 * La guardia imposta `ctx.redirect(...)` *prima* di lanciare, quindi chi
 * intercetta non deve fabbricare una risposta: deve solo **non assegnare il
 * corpo**. Lo status 302 e lo `Location` sono già quelli giusti, e il corpo è
 * quello che `ctx.redirect()` scrive da sé.
 *
 * @module core/accessDeniedError
 */

'use strict';

class AccessDeniedError extends Error {
  /**
   * @param {object} [details]
   * @param {string} [details.reason]     - 'auth' (non autenticato) | 'role' (ruolo insufficiente)
   * @param {string} [details.redirectTo] - Dove la guardia ha già rediretto
   * @param {string} [details.path]       - Il path della richiesta negata
   */
  constructor({ reason, redirectTo, path } = {}) {
    super(`accesso negato dal template (${reason || 'motivo non specificato'})`);
    this.name = 'AccessDeniedError';
    this.reason = reason || null;
    this.redirectTo = redirectTo || null;
    this.path = path || null;
  }
}

module.exports = AccessDeniedError;
