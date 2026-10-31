/**
 * Migrazione adminAccessControl v3 → v4
 *
 * Porta i pattern di `accessControl.json5` dai letterali ai **segnaposti di
 * percorso**: `/admin/**` diventa `{{admin}}/**`, e le quattro regole in forma
 * pulita delle pagine di `pluginPages` vengono rimosse perché ora si DERIVANO al
 * caricamento.
 *
 * ─── PERCHE SERVE UNO SCRIPT E NON BASTA IL MERGE ─────────────────────────────
 * Il merge additivo del boot sa solo AGGIUNGERE chiavi. Qui il lavoro è
 * l'opposto: le chiavi delle regole vengono RINOMINATE e quattro vengono
 * RIMOSSE. Due operazioni che il merge non sa fare, per costruzione.
 *
 * ─── COSA SUCCEDE SE NON SI APPLICA ───────────────────────────────────────────
 * L'installazione resta funzionante: i letterali continuano a essere accettati
 * (retrocompatibilità, D2) e il `baseline` di zona protegge il pannello
 * comunque, qualunque sia `adminPrefix`. Ma le regole esplicite sul pannello
 * diventano INERTI appena `adminPrefix` non è più quello di default: puntano a un
 * prefisso che non esiste. Il file descriverebbe una protezione che non è quella
 * in vigore — la forma residua del difetto A1.
 *
 * ─── PERCHE TESTUALE, E PERCHE FAIL-SOFT ──────────────────────────────────────
 * Testuale perché i commenti del file vivo sono metà del suo valore: una
 * riserializzazione dell'oggetto li perderebbe tutti (è il motivo per cui la
 * decisione D1 impone `setJson5Key`/`editJson5` al posto di `saveJson5`), e qui
 * nemmeno quelli bastano, perché le chiavi cambiano NOME.
 *
 * Fail-soft perché su un file riformattato o personalizzato gli ancoraggi non
 * combaciano. In quel caso lo script salta la singola sostituzione e la
 * DICHIARA, invece di riscrivere a tentoni un file di sicurezza. Il risultato
 * peggiore è un file che resta come era — funzionante — con un elenco di cosa
 * non è stato possibile convertire.
 *
 * Idempotente: dopo il primo passaggio gli ancoraggi non ci sono più.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Rinomine di chiave: dal letterale al segnaposto. */
const KEY_RENAMES = Object.freeze([
  ['"/admin": {', '"{{admin}}": {'],
  ['"/admin/**": {', '"{{admin}}/**": {'],
  ['"/pluginPages/adminUsers/userProfile.ejs": {', '"{{pluginPages}}/adminUsers/userProfile.ejs": {'],
  ['"/pluginPages/adminUsers/login.ejs": {', '"{{pluginPages}}/adminUsers/login.ejs": {'],
  ['"/pluginPages/adminUsers/logout.ejs": {', '"{{pluginPages}}/adminUsers/logout.ejs": {'],
  ['"/pluginPages/adminAccessControl/access-denied.ejs": {', '"{{pluginPages}}/adminAccessControl/access-denied.ejs": {'],
]);

/**
 * Le regole in forma PULITA da rimuovere: ora derivate.
 *
 * Si rimuove solo la forma pulita delle quattro pagine SPEDITE col plugin. Una
 * regola in forma pulita che l'amministratore ha aggiunto per una pagina sua non
 * viene toccata: non è un duplicato di niente.
 */
const CLEAN_FORMS_TO_DROP = Object.freeze([
  '/pluginPages/adminUsers/userProfile',
  '/pluginPages/adminUsers/login',
  '/pluginPages/adminUsers/logout',
  '/pluginPages/adminAccessControl/access-denied',
]);

/**
 * Rimuove il blocco di una regola, dalla riga della chiave alla graffa che la
 * chiude, virgola inclusa. Ritorna il testo nuovo, o `null` se l'ancoraggio non
 * combacia (file riformattato: si salta e lo si dichiara).
 */
function dropRuleBlock(text, pattern) {
  const keyAnchor = `    "${pattern}": {`;
  const start = text.indexOf(keyAnchor);
  if (start === -1) return null;

  // La chiusura è la prima `    },` o `    }` a inizio riga dopo la chiave: le
  // regole non sono annidate, quindi non serve contare le graffe.
  const closeWithComma = text.indexOf('\n    },', start);
  const closeBare = text.indexOf('\n    }', start);
  if (closeWithComma === -1 && closeBare === -1) return null;

  let end;
  if (closeWithComma !== -1 && (closeBare === -1 || closeWithComma <= closeBare)) {
    end = closeWithComma + '\n    },'.length;
  } else {
    end = closeBare + '\n    }'.length;
  }

  // Si porta via anche la riga di commento immediatamente precedente, se c'è e se
  // parla della forma senza estensione: altrimenti resterebbe orfana.
  let from = start;
  const beforeLines = text.slice(0, start).split('\n');
  const prev = beforeLines[beforeLines.length - 2];
  if (prev !== undefined && /^\s*\/\/.*(senza estensione|hideExtension|idem)/i.test(prev)) {
    from = start - (prev.length + 1);
  }

  return text.slice(0, from) + text.slice(end + 1);
}

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 * @param {string} ctx.packageDir - cartella del plugin
 * @param {object} ctx.logger
 * @param {boolean} ctx.dryRun
 */
async function migrate(ctx) {
  const { packageDir, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'accessControl.json5');

  if (!fs.existsSync(rulesPath)) {
    // Nessun vivo: il boot lo materializzerà dal `.default`, che è già a v4.
    logger.info('migrate', 'adminAccessControl: accessControl.json5 non esiste, nulla da convertire');
    return;
  }

  const before = fs.readFileSync(rulesPath, 'utf8');
  let text = before;
  const renamed = [];
  const skipped = [];

  for (const [from, to] of KEY_RENAMES) {
    if (text.includes(to)) continue;          // già convertito
    if (!text.includes(from)) { skipped.push(from); continue; }
    text = text.replace(from, to);
    renamed.push(from);
  }

  const dropped = [];
  for (const pattern of CLEAN_FORMS_TO_DROP) {
    const next = dropRuleBlock(text, pattern);
    if (next === null) continue;              // assente o già rimossa
    text = next;
    dropped.push(pattern);
  }

  // L'avviso sugli ancoraggi mancati va PRIMA del ritorno anticipato. Su un file
  // interamente riformattato nulla combacia, quindi nulla cambia — e dire « già
  // convertito » sarebbe falso due volte: non è convertito, e i pattern che
  // richiedono una mano non verrebbero nominati.
  if (skipped.length > 0) {
    logger.warn('migrate', 'adminAccessControl: questi pattern NON sono stati convertiti perche '
      + `l'ancoraggio non combacia (file riformattato o personalizzato): ${skipped.join(', ')}. `
      + 'Restano validi come letterali, ma non seguiranno un adminPrefix non di default: '
      + 'conviene convertirli a mano.');
  }

  if (text === before) {
    logger.info('migrate', skipped.length > 0
      ? 'adminAccessControl: accessControl.json5 NON modificato — nessun ancoraggio combaciava'
      : 'adminAccessControl: accessControl.json5 già convertito, nessuna modifica');
    return;
  }

  if (dryRun) {
    logger.info('migrate', `adminAccessControl [dry-run]: ${renamed.length} pattern da rinominare, `
      + `${dropped.length} forme pulite da rimuovere`);
  } else {
    // Scrittura atomica: temp + rename.
    const tempPath = `${rulesPath}.migrating`;
    fs.writeFileSync(tempPath, text, 'utf8');
    fs.renameSync(tempPath, rulesPath);
    logger.info('migrate', `adminAccessControl: ${renamed.length} pattern convertiti ai segnaposti, `
      + `${dropped.length} forme pulite rimosse (ora derivate)`);
  }

}

module.exports = migrate;
module.exports.migrate = migrate;
