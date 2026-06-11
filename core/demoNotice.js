// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * demoNotice.js
 *
 * Avvisi e badge per il PROFILO DI INSTALLAZIONE "demo" (ital8Config.json5 → demo).
 * Puramente segnaletico: NON altera il comportamento delle richieste, NON blocca
 * l'avvio, NON cambia la sicurezza. Caricato solo quando demo === true.
 *
 *   - printDemoBootWarning(): box ASCII allo startup (chiamato da index.js)
 *   - getDemoBadgeHtml():     badge "DEMO" iniettato nell'header delle pagine admin
 *                             via pluginSys.hookPage('header') (theme-agnostic)
 */

/**
 * Stampa un avviso prominente all'avvio quando il profilo demo è attivo.
 * Rispecchia lo stile del box di httpsManager.js.
 */
function printDemoBootWarning() {
  const line = '[DEMO] ══════════════════════════════════════════════════════════';
  console.log('');
  console.log(line);
  console.log('[DEMO]  ⚠  ISTANZA DEMO — NON usare in produzione');
  console.log('[DEMO]     Utenti di esempio con password condivisa e nota ("demomode").');
  console.log(line);
  console.log('');
}

/**
 * HTML del badge "DEMO" mostrato nelle pagine admin.
 * Pill discreto in basso a destra: position:fixed (non occupa spazio nel flusso)
 * e pointer-events:none (non intercetta i click).
 * @returns {string}
 */
function getDemoBadgeHtml() {
  return '<!-- ital8cms: badge profilo demo -->'
    + '<div style="position:fixed;bottom:10px;right:10px;z-index:2147483647;'
    + 'background:#b00020;color:#fff;font:600 12px/1.4 system-ui,-apple-system,sans-serif;'
    + 'padding:4px 10px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.4);'
    + 'pointer-events:none;" title="ital8cms in modalità demo — non usare in produzione">DEMO</div>';
}

module.exports = { printDemoBootWarning, getDemoBadgeHtml };
