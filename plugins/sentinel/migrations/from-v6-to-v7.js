/**
 * Migrazione sentinel v6 → v7
 *
 * Porta i path NOSTRI della regola `auth-surface-noise` dai letterali ai
 * segnaposti di percorso: `/api/adminUsers/login` → `{{api}}/adminUsers/login`.
 *
 * ─── SOLO I PATH NOSTRI ───────────────────────────────────────────────────────
 * La grande maggioranza dei path di `sentinelRules.json5` sono tecnologie altrui
 * — /wp-admin, /phpmyadmin, /.env — e NON vanno convertiti: non sono zone di
 * ital8cms e non seguono alcuna sua configurazione. L'unica regola distribuita
 * che nomina percorsi del CMS è `auth-surface-noise`.
 *
 * ─── SI FERMA SE LA REGOLA NON E QUELLA DISTRIBUITA ───────────────────────────
 * Stessa cautela dello step 5→6: `rules` è un array, quindi serve un intervento
 * testuale, e un intervento testuale su un file che l'amministratore può aver
 * riscritto deve ancorarsi a un testo ESATTO e rinunciare se non lo trova. Non
 * cancella e non riscrive niente a tentoni: una sostituzione uno-a-uno della
 * riga, o nessuna modifica e un avviso.
 *
 * Idempotente: dopo il primo passaggio la riga di partenza non c'è più.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** La riga come è distribuita, e la sua forma a segnaposti. */
const SHIPPED_LINE =
  '          { path: ["/api/adminUsers/login", "/api/adminUsers/logout", "/pluginPages/adminUsers/**"] },';
const PLACEHOLDER_LINE =
  '          { path: ["{{api}}/adminUsers/login", "{{api}}/adminUsers/logout", "{{pluginPages}}/adminUsers/**"] },';

async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'sentinelRules.json5');

  if (!fs.existsSync(rulesPath)) {
    logger.info('migrate', 'sentinel: sentinelRules.json5 non esiste, nulla da convertire');
    return;
  }

  const before = fs.readFileSync(rulesPath, 'utf8');

  if (before.includes(PLACEHOLDER_LINE)) {
    logger.info('migrate', 'sentinel: auth-surface-noise già convertita ai segnaposti, nessuna modifica');
    return;
  }

  if (!before.includes(SHIPPED_LINE)) {
    // Non si indovina: la regola è stata modificata, riformattata o rimossa.
    logger.warn('migrate',
      'sentinel: la riga dei path di "auth-surface-noise" non corrisponde a quella '
      + 'distribuita (regola modificata, riformattata o rimossa) — NESSUNA modifica. '
      + 'I letterali restano validi, ma non seguiranno un apiPrefix o un '
      + 'pluginPagesPrefix non di default: conviene convertirli a mano in '
      + '{{api}}/... e {{pluginPages}}/...');
    return;
  }

  if (dryRun) {
    logger.info('migrate', 'sentinel [dry-run]: i 3 path di auth-surface-noise verrebbero convertiti ai segnaposti');
    return;
  }

  // Scrittura atomica: temp + rename.
  const text = before.replace(SHIPPED_LINE, PLACEHOLDER_LINE);
  const tempPath = `${rulesPath}.migrating`;
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, rulesPath);
  logger.info('migrate', 'sentinel: i 3 path di auth-surface-noise convertiti ai segnaposti');
}

module.exports = migrate;
module.exports.migrate = migrate;
