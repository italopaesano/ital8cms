/**
 * sentinel-i18n.js — le etichette tradotte, lato client.
 *
 * ─── PERCHE UN FILE A SE ──────────────────────────────────────────────────────
 * Il JS di pagina non può chiamare `__()`, che è un helper dei template: le
 * etichette gliele passa l'EJS in `SN_I18N`, una per pagina, con solo le chiavi
 * che quella pagina usa. Qui vive la funzione che le legge, condivisa dalle
 * quattro pagine della sezione invece di essere ricopiata in ciascuna — ed è
 * l'unica parte di questo giro che si possa mettere sotto test senza un DOM.
 *
 * ─── PERCHE I SEGNAPOSTO E NON LA CONCATENAZIONE ──────────────────────────────
 * `'Regola "' + nome + '": ' + prima + ' → ' + dopo` funziona in italiano e
 * decide l'ordine delle parole per tutte le lingue che verranno. Con
 * `'Regola "{rule}": {from} → {to}'` l'ordine appartiene alla traduzione, che è
 * di chi traduce.
 */

(function (global) {
  'use strict';

  /**
   * @param {string} key - chiave in SN_I18N
   * @param {object} [vars] - valori dei segnaposto `{nome}`
   * @returns {string}
   */
  function snT(key, vars) {
    const labels = global.SN_I18N || {};
    const template = Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;
    if (!vars) return template;

    // Un segnaposto senza valore resta scritto com'è: si vede QUALE manca,
    // invece di trovarsi un buco nella frase e doverlo indovinare.
    return String(template).replace(/\{(\w+)\}/g, function (intero, nome) {
      return Object.prototype.hasOwnProperty.call(vars, nome) ? String(vars[nome]) : intero;
    });
  }

  global.snT = snT;

  // In browser `module` non esiste e questo ramo non gira; sotto Node permette
  // di verificare il riempimento dei segnaposto senza allestire un DOM.
  if (typeof module !== 'undefined' && module.exports) module.exports = { snT };
}(typeof window !== 'undefined' ? window : globalThis));
