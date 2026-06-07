'use strict';

/**
 * clientInterceptor.js — Genera lo <script> (inline) iniettato nell'<head>.
 *
 * Lato browser, patcha window.fetch e XMLHttpRequest per aggiungere
 * automaticamente l'header CSRF a TUTTE le richieste same-origin con metodo
 * mutante (POST/PUT/DELETE/PATCH). Il token NON è incorporato nello script:
 * viene letto a runtime dal <meta> → un solo punto di verità, e lo script è
 * identico su ogni pagina (cache-friendly).
 *
 * Lo script è inserito nell'<head> (prima degli script di pagina) così la patch
 * è attiva prima di qualsiasi fetch/XHR applicativo.
 */

/**
 * @param {{metaName?: string, headerName?: string}} [opts]
 * @returns {string} markup `<script>…</script>`
 */
function getInterceptorScript(opts = {}) {
  const metaName = opts.metaName || 'csrf-token';
  const headerName = opts.headerName || 'X-CSRF-Token';

  // Serializzati come stringhe JS sicure (provengono dalla config, non da input utente).
  const META = JSON.stringify(metaName);
  const HEADER = JSON.stringify(headerName);

  return `<script>
(function () {
  "use strict";
  var META_NAME = ${META};
  var HEADER_NAME = ${HEADER};
  var MUTATING = /^(POST|PUT|DELETE|PATCH)$/i;

  function readToken() {
    var el = document.querySelector('meta[name="' + META_NAME + '"]');
    return el ? el.getAttribute('content') : '';
  }
  function isSameOrigin(url) {
    try { return new URL(url, window.location.href).origin === window.location.origin; }
    catch (e) { return true; } // URL relativa → same-origin
  }

  // ── window.fetch ──
  if (window.fetch) {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
      init = init || {};
      var method = (init.method || (input && typeof input !== 'string' && input.method) || 'GET').toUpperCase();
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (MUTATING.test(method) && isSameOrigin(url)) {
        var token = readToken();
        if (token) {
          var headers = new Headers((init.headers) || (input && typeof input !== 'string' && input.headers) || {});
          if (!headers.has(HEADER_NAME)) headers.set(HEADER_NAME, token);
          init.headers = headers;
        }
      }
      return _fetch.call(this, input, init);
    };
  }

  // ── XMLHttpRequest ──
  if (window.XMLHttpRequest) {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__csrfMethod = method;
      this.__csrfUrl = url;
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (this.__csrfMethod && MUTATING.test(this.__csrfMethod) && isSameOrigin(this.__csrfUrl)) {
          var token = readToken();
          if (token) this.setRequestHeader(HEADER_NAME, token);
        }
      } catch (e) { /* setRequestHeader può lanciare se lo stato è errato: ignora */ }
      return _send.apply(this, arguments);
    };
  }
})();
</script>`;
}

module.exports = { getInterceptorScript };
