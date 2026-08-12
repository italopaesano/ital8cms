/**
 * Migrazione sentinel v2 → v3 — regola sulla coerenza di sessione
 *
 * Inserisce `session-hijack-signal` in `sentinelRules.json5`.
 *
 * Stessa ragione dello step precedente: `rules` è un array, e il merge additivo
 * del boot tratta gli array come valori. Senza questo step, su
 * un'installazione esistente il codice della coerenza di sessione ci sarebbe e
 * non avrebbe **nessuna regola** che lo usa: le anomalie verrebbero calcolate a
 * ogni richiesta autenticata e buttate via.
 *
 * Va inserita dopo `canary-token-used` — che lo step precedente ha già messo in
 * testa alle rilevazioni — perché è così che stanno nel file distribuito, e
 * perché fra i due il canary è la certezza e questa è il segnale più forte fra
 * quelli che restano inferenze.
 */

'use strict';

const path = require('path');
const { insertRule } = require('./insertRuleText');

const RULE_NAME = 'session-hijack-signal';

const RULE_TEXT = `    // ─────────────────────────────────────────────────────────────────────────
    // SESSIONI AUTENTICATE
    // ─────────────────────────────────────────────────────────────────────────
    {
      name: "session-hijack-signal",
      enabled: true,
      category: "session",
      description:
        "Una sessione autenticata ha smesso di assomigliare a sé stessa. Un cookie rubato funziona — chi lo presenta È l'utente, per il server — ma il ladro non eredita il client: la sessione era nata su un browser e a un certo punto arriva da uno script, oppure lo User-Agent cambia a metà. Sono i due segnali con meno falsi positivi. NON guarda l'indirizzo: cambia da solo passando da rete dati a WiFi, e la linea di base non si aggiorna mai, quindi marcherebbe la sessione fino al logout.",
      action: "monitor",
      appliesTo: "authenticated",
      match: {
        sessionAnomaly: ["uaChanged", "scriptClient"],
      },
    },

`;

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 */
async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'sentinelRules.json5');

  // Dopo il canary, non semplicemente dopo la whitelist: senza l'ancora, questa
  // regola finirebbe SOPRA quella inserita dallo step precedente, e l'ordine di
  // un'installazione migrata differirebbe da quello di una nuova.
  const outcome = insertRule(rulesPath, RULE_TEXT, RULE_NAME, {
    dryRun,
    afterRule: 'canary-token-used',
  });

  if (outcome.applied) {
    logger.info('migrate', `sentinel: regola "${RULE_NAME}" inserita in sentinelRules.json5`);
  } else if (outcome.reason === 'dry-run') {
    logger.info('migrate', `sentinel (dry-run): "${RULE_NAME}" verrebbe inserita dopo la whitelist`);
  } else {
    logger.info('migrate', `sentinel: "${RULE_NAME}" ${outcome.reason}, nessuna modifica`);
  }
}

module.exports = { migrate };
