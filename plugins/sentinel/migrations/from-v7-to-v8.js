/**
 * Migrazione sentinel v7 → v8
 *
 * Riscrive le TRE regole `regex:` distribuite perché continuino a funzionare
 * dopo l'ancoraggio delle regex in `core/patternMatcher.js` (REVIEW.md → A4).
 *
 * ─── PERCHÉ SERVE ─────────────────────────────────────────────────────────────
 * Fino alla v3.42.0 un `regex:` era compilato senza ancoraggi, quindi
 * `RegExp.test()` faceva un match di SOTTOSTRINGA. Per chi protegge URL quello
 * era un difetto — `regex:/admin/users` matchava anche `/public/admin/users` —
 * e dalla v3.43.0 il corpo è compilato come `^(?:corpo)$`.
 *
 * Ma sentinel non protegge: RILEVA, e le sue tre regole distribuite usavano il
 * match parziale DI PROPOSITO — una chiave SSH o una webshell vanno intercettate
 * in qualunque cartella, e le sequenze di risalita in qualunque punto della
 * query. Misurato: con l'ancoraggio e senza questa riscrittura tutte e tre
 * passano da `true` a `false`, cioè le tre regole di rilevamento restano nel
 * file, valide e INERTI. È lo stesso difetto dello step 6→7, per un'altra
 * strada: una regola che c'è e non osserva più niente.
 *
 * La riscrittura rende esplicito con `.*` ciò che prima era implicito
 * nell'assenza di ancoraggi. Il comportamento osservabile è identico a prima.
 *
 * ─── SOLO I DUE `path`, NON LA REGOLA SULLA QUERY ─────────────────────────────
 * Le regole che guardano `query`, `userAgent` o un header NON passano da
 * `core/patternMatcher`: sentinel le compila da sé in
 * `lib/ruleValidator.js → compileRegex()`, con `new RegExp(source, 'i')` — senza
 * ancoraggi e case-insensitive. L'ancoraggio non le riguarda, quindi toccarle
 * sarebbe stato rumore (e avrebbe suggerito che il cambiamento arrivi anche là).
 * Verificato leggendo il compilatore, non per somiglianza del prefisso `regex:`.
 *
 * ─── SI FERMA SE LE REGOLE NON SONO QUELLE DISTRIBUITE ────────────────────────
 * `rules` è un array e il merge additivo del boot lo tratta come un valore,
 * quindi serve un intervento testuale; e un intervento testuale su un file che
 * l'amministratore può aver riscritto si ancora al testo ESATTO e rinuncia se
 * non lo trova. Ogni riga è indipendente: se due su tre corrispondono, si
 * convertono quelle due e la terza viene segnalata.
 *
 * Idempotente: dopo il primo passaggio le righe di partenza non ci sono più.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Le tre righe come sono distribuite, e la loro forma ancorata.
 * `label` serve solo ai messaggi.
 */
const REWRITES = [
  {
    label: 'secret-file-probe (chiavi SSH)',
    from: '{ path: "regex:/id_(rsa|dsa|ecdsa|ed25519)$" },',
    to:   '{ path: "regex:.*/id_(rsa|dsa|ecdsa|ed25519)" },',
  },
  {
    label: 'shell-probe (webshell note)',
    from: 'path: "regex:/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\\\.(php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl)$",',
    to:   'path: "regex:.*/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\\\.(php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl)",',
  },
];

async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'sentinelRules.json5');

  if (!fs.existsSync(rulesPath)) {
    logger.info('migrate', 'sentinel: sentinelRules.json5 non esiste, nulla da riscrivere');
    return;
  }

  const before = fs.readFileSync(rulesPath, 'utf8');
  let text = before;
  const done = [];
  const skipped = [];

  for (const rewrite of REWRITES) {
    if (text.includes(rewrite.to)) continue;                 // già convertita
    if (!text.includes(rewrite.from)) { skipped.push(rewrite.label); continue; }
    text = text.replace(rewrite.from, rewrite.to);
    done.push(rewrite.label);
  }

  for (const label of skipped) {
    logger.warn('migrate',
      `sentinel: la regola "${label}" non corrisponde a quella distribuita `
      + '(modificata, riformattata o rimossa) — NESSUNA modifica su quella riga. '
      + 'Attenzione: dalla v3.43.0 le regex sono ANCORATE, quindi una regola '
      + 'che cercava una sottostringa ora non intercetta più nulla: va anteposto '
      + 'un ".*" al corpo (e aggiunto in coda, se cercava dovunque).');
  }

  if (done.length === 0) {
    logger.info('migrate', 'sentinel: nessuna delle due regole regex da riscrivere');
    return;
  }

  if (dryRun) {
    logger.info('migrate', `sentinel [dry-run]: verrebbero riscritte ${done.length} regole regex (${done.join(', ')})`);
    return;
  }

  // Scrittura atomica: temp + rename.
  const tempPath = `${rulesPath}.migrating`;
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, rulesPath);
  logger.info('migrate', `sentinel: ${done.length} regole regex ancorate (${done.join(', ')})`);
}

module.exports = migrate;
module.exports.migrate = migrate;
