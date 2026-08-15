/**
 * Migrazione sentinel v5 → v6 — `shell-probe` richiede un'estensione eseguibile
 *
 * Restringe il pattern della regola `shell-probe` in `sentinelRules.json5`:
 *
 *   prima   /(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\.
 *   dopo    /(c99|…|webshell)\.(php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl)$
 *
 * ─── PERCHE UNA MIGRAZIONE E NON SOLO IL FILE DISTRIBUITO ─────────────────────
 * `rules` è un array, e il merge additivo del boot tratta gli array come valori:
 * una modifica al file distribuito non raggiunge mai un'installazione esistente.
 * È la stessa ragione degli step v1→v2 e v2→v3 — con una differenza che conta:
 * quelli AGGIUNGEVANO una regola, questo ne CAMBIA una che l'amministratore
 * potrebbe aver già promosso a `block`.
 *
 * ─── PERCHE VALE LA PENA CAMBIARLA ────────────────────────────────────────────
 * Il pattern si fermava al punto, quindi `/js/shell.js` e `/assets/cmd.css`
 * matchavano: nomi di file ordinari — terminali web, moduli CLI, componenti di
 * documentazione. Il problema non è il rumore nel log, è che il percorso di
 * promozione documentato **non può accorgersene**: dice di guardare
 * `authenticatedHits` e promuovere se è zero, e un asset chiesto dai visitatori
 * anonimi lo lascia a zero per sempre. La regola appariva quindi come la più
 * sicura da promuovere proprio mentre promuoverla avrebbe restituito 404 su una
 * pagina pubblica — con una diagnosi che parte dal posto sbagliato, perché il
 * 404 di `block` è indistinguibile da un file mancante.
 *
 * ─── COSA QUESTO SCRIPT NON FA, DELIBERATAMENTE ───────────────────────────────
 * Se il pattern in vigore non è **esattamente** quello distribuito, non tocca
 * niente e lo dice. Un amministratore che ha adattato la propria regola ha fatto
 * una scelta, e una migrazione che gliela sovrascrive perché «sa di saperne di
 * più» è il modo di far perdere fiducia in tutte le migrazioni successive. Nel
 * dubbio si lascia il file com'è e si scrive nel log cosa andrebbe guardato.
 *
 * Idempotente: eseguito due volte, la seconda non trova nulla da fare.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

const RULE_NAME = 'shell-probe';

/** Il pattern distribuito fino alla v5, come valore PARSATO. */
const OLD_PATTERN = 'regex:/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\.';

/** Il pattern della v6, come valore PARSATO. */
const NEW_PATTERN =
  'regex:/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\.(php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl)$';

/**
 * Sostituisce il valore di una stringa quotata su una riga, conservando il tipo
 * di virgolette e il rientro.
 *
 * Si lavora sulla riga e non sul file intero perché il valore vecchio potrebbe
 * comparire anche in un commento — nel file distribuito i pattern vengono
 * citati nelle descrizioni — e sostituirlo lì sarebbe una modifica silenziosa a
 * un testo che nessuno ha chiesto di cambiare.
 *
 * @param {string} line
 * @param {string} newValueSource - già nella forma da scrivere nel file
 * @returns {string|null} la riga nuova, o null se non c'è una stringa da sostituire
 */
function replaceQuotedValue(line, newValueSource) {
  const match = line.match(/^(\s*(?:["']?path["']?\s*:\s*))(["'])(.*)\2(\s*,?\s*)$/);
  if (!match) return null;
  const [, head, quote, , tail] = match;
  return `${head}${quote}${newValueSource}${quote}${tail}`;
}

/** Come JSON5 scriverebbe questa stringa dentro virgolette doppie. */
function toSourceString(value) {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Elenca i path in notazione puntata dove due strutture differiscono.
 * Copia deliberata (vedi l'intestazione di `insertRuleText.js`): una migrazione
 * deve continuare a comportarsi identica anche se il codice del plugin cambia.
 */
function describeDifference(a, b, prefix = '') {
  if (a === b) return [];
  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object'
    && Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) return [prefix || '<root>'];

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const key of keys) {
    const childPrefix = Array.isArray(a) ? `${prefix}[${key}]` : (prefix ? `${prefix}.${key}` : key);
    out.push(...describeDifference(a[key], b[key], childPrefix));
  }
  return out;
}

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 */
async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'sentinelRules.json5');

  if (!fs.existsSync(rulesPath)) {
    logger.info('migrate', 'sentinel: sentinelRules.json5 assente, nessuna modifica');
    return;
  }

  const original = fs.readFileSync(rulesPath, 'utf8');
  const before = JSON5.parse(original);
  const rules = Array.isArray(before.rules) ? before.rules : [];
  const index = rules.findIndex((r) => r && r.name === RULE_NAME);

  if (index === -1) {
    logger.info('migrate', `sentinel: regola "${RULE_NAME}" non presente, nessuna modifica`);
    return;
  }

  const current = rules[index].match && rules[index].match.path;

  if (current === NEW_PATTERN) {
    logger.info('migrate', `sentinel: "${RULE_NAME}" è già ristretta, nessuna modifica`);
    return;
  }

  if (current !== OLD_PATTERN) {
    // Pattern personalizzato: non si tocca. Lo step si considera comunque
    // riuscito — non c'è niente di rotto da riparare — ma va detto, perché
    // quell'installazione conserva i falsi positivi se il pattern se li porta.
    logger.warn('migrate',
      `sentinel: "${RULE_NAME}" ha un pattern personalizzato, lasciato invariato. ` +
      'Se contiene "shell" o "cmd" seguiti dal solo punto, intercetta anche file ' +
      'legittimi come /js/shell.js: valuta di aggiungere un\'estensione eseguibile');
    return;
  }

  const lines = original.split('\n');
  const oldSource = toSourceString(OLD_PATTERN);
  const targetLine = lines.findIndex((line) => line.includes(oldSource) && /["']?path["']?\s*:/.test(line));

  if (targetLine === -1) {
    throw new Error(
      `sentinel: il pattern di "${RULE_NAME}" è quello atteso ma non è stato ` +
      'individuato nel testo del file — scrittura annullata');
  }

  const updatedLine = replaceQuotedValue(lines[targetLine], toSourceString(NEW_PATTERN));
  if (updatedLine === null) {
    throw new Error(`sentinel: riga "path" di "${RULE_NAME}" non riscrivibile — scrittura annullata`);
  }

  lines[targetLine] = updatedLine;
  const updated = lines.join('\n');

  // ── Verifica differenziale, come in ogni scrittura testuale del plugin ──
  let after;
  try {
    after = JSON5.parse(updated);
  } catch (err) {
    throw new Error(`sentinel: la modifica avrebbe prodotto JSON5 non valido: ${err.message}`);
  }

  const diff = describeDifference(before, after);
  const expected = `rules[${index}].match.path`;
  if (diff.length !== 1 || diff[0] !== expected) {
    throw new Error(
      `sentinel: la modifica avrebbe toccato più di quanto previsto ` +
      `(atteso ${expected}, rilevato ${diff.length === 0 ? 'nulla' : diff.join(', ')}) — scrittura annullata`);
  }

  if (dryRun) {
    logger.info('migrate', `sentinel (dry-run): "${RULE_NAME}" verrebbe ristretta alle estensioni eseguibili`);
    return;
  }

  const tempPath = `${rulesPath}.tmp`;
  fs.writeFileSync(tempPath, updated, 'utf8');
  fs.renameSync(tempPath, rulesPath);

  logger.info('migrate', `sentinel: "${RULE_NAME}" ora richiede un'estensione eseguibile`);
}

module.exports = { migrate, OLD_PATTERN, NEW_PATTERN, RULE_NAME };
