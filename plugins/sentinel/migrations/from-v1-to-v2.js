/**
 * Migrazione sentinel v1 → v2 — regola del token esca
 *
 * Inserisce `canary-token-used` in `sentinelRules.json5` sulle installazioni che
 * esistevano già quando i token esca sono stati introdotti.
 *
 * ─── PERCHE IL MERGE NON BASTA ────────────────────────────────────────────────
 * `reconcileSchemaVersions` riconcilia anche le coppie secondarie del plugin, e
 * quindi vede `sentinelRules.default.json5` ↔ `sentinelRules.json5`. Ma tratta
 * gli **array** come valori, non come contenitori da fondere — scelta giusta,
 * perché fondere array significherebbe indovinare la posizione e sovrascrivere
 * l'ordine deciso dall'amministratore. `rules` è un array, quindi una regola
 * nuova distribuita col plugin **non raggiunge mai** un'installazione esistente.
 *
 * È lo stesso difetto di `menuOrder` in v2.72.0, e ha lo stesso rimedio.
 *
 * ─── PERCHE IN TESTA E NON IN FONDO ───────────────────────────────────────────
 * Con first-match-wins una regola accodata arriva dopo `backup-probe`, che matcha
 * `.tar.gz`. Uno dei decoy distribuiti consegna il token dentro un finto
 * `backup-....tar.gz`: accodata, questa regola non lo vedrebbe mai. Va dove sta
 * nel file distribuito, cioè subito dopo la whitelist.
 */

'use strict';

const path = require('path');
const { insertRule } = require('./insertRuleText');

const RULE_NAME = 'canary-token-used';

const RULE_TEXT = `    // ─────────────────────────────────────────────────────────────────────────
    // TOKEN ESCA — il segnale più certo che questo plugin sa produrre
    // ─────────────────────────────────────────────────────────────────────────
    {
      name: "canary-token-used",
      enabled: true,
      category: "canary",
      description:
        "Qualcuno ha usato un token esca. I token esistono SOLO dentro il corpo di un decoy servito a un client specifico: nessun motore di ricerca li indicizza, nessun link ci porta, nessun utente li digita. Chi ne richiede uno ha letto il decoy e ha deciso di seguirlo. Non è un'inferenza come tutto il resto di questo file: è una certezza, e sta in cima perché non ha senso che un'altra regola la anticipi.",
      action: "monitor",
      match: {
        canary: true,   // true = qualunque token; "known" = solo quelli ancora in registro
      },
      // Quando promuovi questa regola a "block", questo è l'unico posto del file
      // in cui \`ban: true\` è difendibile: non c'è insistenza da accumulare,
      // il primo evento è già la prova. Richiede il plugin rateLimiter attivo.
      // escalate: { rateLimiterRule: "scanner", ban: true, banSeconds: 86400 },
    },

`;

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 * @param {string} ctx.packageDir - cartella del plugin
 * @param {object} ctx.logger
 * @param {boolean} ctx.dryRun
 */
async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'sentinelRules.json5');

  const outcome = insertRule(rulesPath, RULE_TEXT, RULE_NAME, { dryRun });

  if (outcome.applied) {
    logger.info('migrate', `sentinel: regola "${RULE_NAME}" inserita in sentinelRules.json5`);
  } else if (outcome.reason === 'dry-run') {
    logger.info('migrate', `sentinel (dry-run): "${RULE_NAME}" verrebbe inserita dopo la whitelist`);
  } else {
    logger.info('migrate', `sentinel: "${RULE_NAME}" ${outcome.reason}, nessuna modifica`);
  }
}

module.exports = { migrate };
