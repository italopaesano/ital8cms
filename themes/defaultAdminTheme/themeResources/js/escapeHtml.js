/**
 * Client-side HTML escaping utility (defense-in-depth).
 * Primary sanitization MUST happen server-side in API endpoints.
 * This is an additional safety layer for client-side DOM manipulation.
 */
(function(global) {
  'use strict';

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.escapeHtml = escapeHtml;

  // ── Esportazione per i test ─────────────────────────────────────────────────
  // In browser `module` non esiste e questo ramo non gira. Sotto Node espone la
  // funzione, che è pura e non tocca il DOM: è la convenzione del progetto per il
  // JS client-side (docs/testing.it.md → *JS client-side della GUI admin*).
  //
  // Qui il test serve più che altrove: questa funzione è il LIVELLO 2 della
  // difesa XSS del pannello admin — il gemello client di `core/escapeHtml.js` —
  // e finché non era misurata nessun numero diceva che non c'era.
  if (typeof module !== 'undefined' && module.exports) module.exports = { escapeHtml };
})(typeof window !== 'undefined' ? window : this);
