/**
 * Migrazione adminConfig v1 → v2
 *
 * Accoda `sentinelManagement` a `menuOrder` nel config vivo.
 *
 * ─── PERCHE SERVE UNO SCRIPT E NON BASTA IL MERGE ─────────────────────────────
 * Il merge additivo del boot scende ricorsivamente negli oggetti e aggiunge le
 * chiavi nuove a qualsiasi profondità: `sections.sentinelManagement` arriva da
 * solo. Ma gli **array** sono trattati come valori, non come contenitori da
 * fondere — ed è la scelta giusta, perché fondere array significherebbe
 * indovinare la posizione e sovrascrivere l'ordine deciso dall'amministratore.
 *
 * `menuOrder` è un array, e `adminSystem` costruisce il menu iterando proprio
 * quello. Senza questo script, su un'installazione già esistente la sezione
 * sarebbe presente nel config e **invisibile nel pannello**: il tipo di difetto
 * che non dà errore, non compare nei log, e si scopre solo quando qualcuno
 * chiede «ma la voce dove sta?».
 *
 * ─── IDEMPOTENTE E RISPETTOSO DELL'ORDINE ─────────────────────────────────────
 * Se la voce c'è già non fa nulla, e non riordina quelle presenti: chi ha
 * personalizzato l'ordine del proprio menu se lo ritrova intatto, con la voce
 * nuova in coda.
 */

'use strict';

const SECTION_ID = 'sentinelManagement';

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 * @param {string} ctx.configPath - path del config VIVO
 * @param {Function} ctx.loadJson5
 * @param {Function} ctx.setJson5Key
 * @param {object} ctx.logger
 * @param {boolean} ctx.dryRun
 */
async function migrate(ctx) {
  const { configPath, loadJson5, setJson5Key, logger, dryRun } = ctx;

  const live = loadJson5(configPath);
  const menuOrder = Array.isArray(live.menuOrder) ? live.menuOrder : [];

  if (menuOrder.includes(SECTION_ID)) {
    logger.info('migrate', `adminConfig: "${SECTION_ID}" già presente in menuOrder, nessuna modifica`);
    return;
  }

  const updated = [...menuOrder, SECTION_ID];

  if (dryRun) {
    logger.info('migrate', `adminConfig (dry-run): "${SECTION_ID}" verrebbe accodato a menuOrder`);
    return;
  }

  // setJson5Key e non saveJson5 dell'oggetto intero: quest'ultimo perderebbe i
  // commenti del config vivo, che in adminConfig spiegano i tipi di sezione.
  await setJson5Key(configPath, 'menuOrder', updated);
  logger.info('migrate', `adminConfig: "${SECTION_ID}" accodato a menuOrder`);
}

module.exports = { migrate };
