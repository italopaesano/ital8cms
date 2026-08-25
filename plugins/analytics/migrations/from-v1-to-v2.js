/**
 * Migrazione analytics v1 → v2 — `weight` da 5 a -8
 *
 * ─── COSA È SUCCESSO ─────────────────────────────────────────────────────────
 * Fino alla v2.99.0 `pluginSys` caricava i plugin nell'ordine di
 * `fs.readdirSync()`, cioè alfabetico sulla gran parte dei filesystem. In quel
 * mondo `analytics` capitava secondo e `urlRedirect` dodicesimo — quindi il
 * middleware di analytics avvolgeva quello di urlRedirect **per caso**.
 *
 * In v3.0.0 il caricamento è passato all'ordine per `weight`, che è il contratto
 * che `CLAUDE.md` dichiarava da sempre. Corretto in sé, ma l'ordine di
 * caricamento è **anche** l'ordine in cui `index.js` fa `app.use()` dei
 * middleware (`getMiddlewaresToLoad()` → `forEach` → `app.use`), e quel legame non
 * era documentato da nessuna parte. Con `analytics: 5` e `urlRedirect: 1`,
 * urlRedirect ha cominciato a montare per primo.
 *
 * ─── PERCHÉ IL SITO SE NE ACCORGE ────────────────────────────────────────────
 * Il middleware di urlRedirect, su una regola che matcha, fa `ctx.redirect()` e
 * ritorna **senza chiamare `next()`** — giustamente: la risposta è completa. Ma
 * un middleware che *osserva* deve stare più esterno di uno che interrompe,
 * altrimenti non vede ciò che viene interrotto.
 *
 * MISURATO: con analytics a valle, il 100% dei 301/302 spariva dal log analytics
 * e dalla dashboard admin. Non un errore visibile — semplicemente traffico che
 * non risultava mai esistito.
 *
 * ─── PERCHÉ SI CAMBIA IL WEIGHT E NON IL CODICE ──────────────────────────────
 * Il meccanismo ora è giusto: l'ordine è deciso da un valore dichiarato invece
 * che dall'ordine di lettura di una directory. È il valore a essere sbagliato —
 * `5` non è mai stato scelto pensando all'ordine dei middleware, perché prima
 * non lo governava. `-8` dice quello che analytics ha bisogno di essere: dopo
 * `simpleI18n` (-10), che popola `ctx.state.lang`, e prima di chiunque possa
 * interrompere una richiesta.
 *
 * Il plugin non ha dipendenze, quindi anticiparne il caricamento è privo di
 * effetti collaterali (verificato: `dependency: {}`, `nodeModuleDependency: {}`).
 *
 * ─── PERCHÉ SERVE UNA MIGRAZIONE ─────────────────────────────────────────────
 * Il merge additivo del boot sa solo AGGIUNGERE chiavi: `weight` esiste già nel
 * config vivo, quindi il nuovo valore distribuito nel `.default` non lo
 * raggiungerebbe mai. Senza questo step, ogni installazione esistente resta con
 * `weight: 5` e continua a perdere i redirect dalle statistiche.
 *
 * ─── COSA QUESTO SCRIPT NON FA, DELIBERATAMENTE ──────────────────────────────
 * Se il `weight` in vigore non è esattamente `5` — cioè se l'amministratore l'ha
 * già scelto lui — non tocca niente e lo dice. Chi ha messo un valore proprio ha
 * fatto una scelta, e una migrazione che gliela sovrascrive perché « sa di
 * saperne di più » è il modo di far perdere fiducia in tutte le migrazioni
 * successive.
 *
 * Idempotente: eseguito due volte, la seconda non trova nulla da fare.
 */

'use strict';

const path = require('path');

const loadJson5 = require('../../../core/loadJson5');
const editJson5 = require('../../../core/editJson5');

/** Il valore distribuito fino alla v1: solo questo viene sostituito. */
const OLD_WEIGHT = 5;

/** Il valore nuovo: dopo simpleI18n (-10), prima di chiunque interrompa. */
const NEW_WEIGHT = -8;

/**
 * @param {object} ctx - Contesto fornito da core/migrationRunner.js
 * @param {string} ctx.packageDir - Cartella del plugin
 * @param {object} ctx.logger
 * @param {boolean} ctx.dryRun
 */
async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const configPath = path.join(packageDir, 'pluginConfig.json5');

  const current = loadJson5(configPath);

  if (current.weight === NEW_WEIGHT) {
    logger.info('migrate', 'analytics: weight già a -8, nulla da fare');
    return;
  }

  if (current.weight !== OLD_WEIGHT) {
    // Valore personalizzato: si lascia com'è e si scrive cosa guardare.
    logger.warning('migrate',
      `analytics: weight personalizzato (${JSON.stringify(current.weight)}) — NON modificato.\n` +
      `   Perché conta: il middleware di analytics deve montare PRIMA di urlRedirect\n` +
      `   (weight ${OLD_WEIGHT >= 0 ? '1' : '1'}), altrimenti i redirect 301/302 non compaiono\n` +
      `   nelle statistiche. Se il valore in uso è maggiore di 1, va abbassato a mano.`);
    return;
  }

  if (dryRun) {
    logger.info('migrate', `analytics (dry-run): weight passerebbe da ${OLD_WEIGHT} a ${NEW_WEIGHT}`);
    return;
  }

  // `editJson5` sostituisce la sola chiave preservando i commenti del file vivo;
  // un `saveJson5` dell'oggetto intero li perderebbe (CLAUDE.md, *Migrazione dei config*).
  await editJson5(configPath, 'weight', NEW_WEIGHT);

  logger.info('migrate',
    `analytics: weight ${OLD_WEIGHT} → ${NEW_WEIGHT} — il middleware torna a monte di urlRedirect`);
}

module.exports = { migrate, OLD_WEIGHT, NEW_WEIGHT };
