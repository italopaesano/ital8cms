/**
 * Migrazione adminAccessControl v3 → v4
 *
 * Porta i pattern di `accessControl.json5` dai letterali ai **segnaposti di
 * percorso** (`/admin/**` → `{{admin}}/**`), e rimuove le quattro regole in
 * forma pulita delle pagine di `pluginPages`, che ora si DERIVANO al caricamento.
 *
 * ─── PERCHE SERVE UNO SCRIPT E NON BASTA IL MERGE ─────────────────────────────
 * Il merge additivo del boot sa solo AGGIUNGERE chiavi. Qui le chiavi delle
 * regole vengono RINOMINATE e quattro vengono RIMOSSE: due operazioni che il
 * merge non sa fare, per costruzione.
 *
 * ─── COSA SUCCEDE SE NON SI APPLICA ───────────────────────────────────────────
 * L'installazione resta funzionante: i letterali continuano a essere accettati
 * (retrocompatibilità, D2 di path-zones) e il `baseline` di zona protegge il
 * pannello comunque, qualunque sia `adminPrefix`. Ma le regole esplicite sul
 * pannello diventano INERTI appena `adminPrefix` non è più quello di default:
 * puntano a un prefisso che non esiste. Il file descriverebbe una protezione che
 * non è quella in vigore — la forma residua del difetto A1.
 *
 * ─── RISCRITTA (v3.35.0) DOPO DUE DIFETTI DI PERDITA DATI ─────────────────────
 * La prima stesura faceva la cancellazione da sé, con una funzione locale
 * (`dropRuleBlock`) che usava `indexOf` invece della macchina di scansione del
 * core — che viveva venti righe più in là. Ne sono usciti due difetti,
 * entrambi riprodotti:
 *
 *   • cercava « la prima riga di chiusura dopo la chiave », quindi su una regola
 *     scritta INLINE la cancellazione arrivava alla chiusura della regola
 *     SUCCESSIVA e si portava via anche quella (misurato: 8 regole custom
 *     diventate 3 invece di 4, con `isAuthEntryPoint` di `logout` sparito e il
 *     file ancora parsabile, quindi nessun errore);
 *   • non guardava MAI il contenuto della regola, mentre questa intestazione, il
 *     registro, il CHANGELOG e il messaggio di commit promettevano il contrario:
 *     una forma pulita che l'amministratore aveva STRETTO veniva cancellata, e
 *     con `hideExtension` acceso l'URL ricadeva sul gemello più permissivo.
 *
 * Ora la cancellazione passa per `core/removeJson5Key.js`, la quinta operazione
 * dello strato JSON5 — che all'epoca non esisteva, ed è il motivo per cui era
 * stata riscritta a mano. → docs/decisions/json5-key-operations.it.md
 *
 * ─── PERCHE LE RINOMINE RESTANO TESTUALI ──────────────────────────────────────
 * Rinominare una chiave PRESERVANDO posizione e commenti non è esprimibile come
 * `setJson5Key` + `removeJson5Key`: il primo inserisce in testa al blocco o dopo
 * una chiave indicata, quindi la regola rinominata si SPOSTEREBBE e perderebbe il
 * blocco di commento che la precede — che in questo file è la parte che la
 * spiega. Sarebbe una sesta operazione (`renameJson5Key`), fuori perimetro. Per
 * le rinomine la strada testuale ha funzionato: il difetto 3 era la diagnostica
 * silenziosa, non la corruzione, e qui è corretto.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const removeJson5Key = require('../../../core/removeJson5Key');

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
 * Le forme PULITE da rimuovere, ciascuna con il proprio gemello `.ejs`.
 *
 * La forma pulita si toglie perché è un DUPLICATO: la derivazione la rigenera da
 * quella con estensione quando `hideExtension` è acceso per la zona. Quindi il
 * criterio per rimuoverla è « lo è ANCORA? », non « è ancora quella spedita »
 * (vedi `isStillADuplicate`).
 */
const CLEAN_FORMS = Object.freeze([
  ['/pluginPages/adminUsers/userProfile', '/pluginPages/adminUsers/userProfile.ejs'],
  ['/pluginPages/adminUsers/login', '/pluginPages/adminUsers/login.ejs'],
  ['/pluginPages/adminUsers/logout', '/pluginPages/adminUsers/logout.ejs'],
  ['/pluginPages/adminAccessControl/access-denied', '/pluginPages/adminAccessControl/access-denied.ejs'],
]);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/**
 * La forma pulita è ancora un duplicato del suo gemello `.ejs`?
 *
 * ─── PERCHE QUESTO CRITERIO, E NON « UGUALE A QUELLA SPEDITA » ────────────────
 * Sono due criteri diversi, e il secondo sbaglia due casi reali:
 *
 *   • l'amministratore ha modificato il `.ejs` e NON la forma pulita → « uguale a
 *     quella spedita » la rimuoverebbe, e la derivazione produrrebbe al suo posto
 *     il corpo MODIFICATO: un cambiamento di comportamento silenzioso;
 *   • li ha modificati ENTRAMBI allo stesso modo → è ancora un duplicato e va
 *     rimossa, ma « uguale a quella spedita » la terrebbe.
 *
 * Il criterio del gemello è aderente al MOTIVO della rimozione, quindi risponde
 * giusto in tutti e quattro i casi.
 */
function isStillADuplicate(rules, cleanKey, ejsKey) {
  const own = Object.prototype.hasOwnProperty;
  if (!own.call(rules, cleanKey)) return false;   // già rimossa, o mai esistita
  if (!own.call(rules, ejsKey)) return false;     // nessun gemello: non è un duplicato
  return deepEqual(rules[cleanKey], rules[ejsKey]);
}

/**
 * @param {object} ctx - vedi buildContext() in core/migrationRunner.js
 * @param {string} ctx.packageDir - cartella del plugin
 * @param {Function} ctx.loadJson5
 * @param {object} ctx.logger
 * @param {boolean} ctx.dryRun
 */
async function migrate(ctx) {
  const { packageDir, loadJson5, logger, dryRun } = ctx;
  const rulesPath = path.join(packageDir, 'accessControl.json5');

  if (!fs.existsSync(rulesPath)) {
    // Nessun vivo: il boot lo materializzerà dal `.default`, che è già a v4.
    logger.info('migrate', 'adminAccessControl: accessControl.json5 non esiste, nulla da convertire');
    return;
  }

  // ── 1. Si decide COSA rimuovere sull'oggetto, PRIMA di toccare il testo ────
  //
  // L'oggetto deserializzato è l'unica fonte che risponde a « questa regola è
  // ancora un duplicato? ». Si legge prima delle rinomine, così le chiavi sono
  // ancora quelle originali e il confronto non deve inseguirle.
  const rules = loadJson5(rulesPath).customRules || {};
  const toRemove = [];
  const keptBecauseCustomised = [];
  for (const [cleanKey, ejsKey] of CLEAN_FORMS) {
    if (!Object.prototype.hasOwnProperty.call(rules, cleanKey)) continue;
    if (isStillADuplicate(rules, cleanKey, ejsKey)) toRemove.push(cleanKey);
    else keptBecauseCustomised.push(cleanKey);
  }

  if (keptBecauseCustomised.length > 0) {
    logger.warn('migrate',
      'adminAccessControl: queste regole in forma pulita NON sono state rimosse perche '
      + `non sono piu identiche al loro gemello .ejs: ${keptBecauseCustomised.join(', ')}. `
      + 'Toglierle cambierebbe il comportamento del tuo sito, perche la derivazione '
      + 'rigenererebbe al loro posto il corpo della regola con estensione. Restano dove '
      + 'sono: se la differenza non ti serve piu, rimuovile a mano.');
  }

  // ── 2. Rinomine, sul testo ─────────────────────────────────────────────────
  const before = fs.readFileSync(rulesPath, 'utf8');
  let text = before;
  const renamed = [];
  const notFound = [];
  const alreadyDone = [];

  for (const [from, to] of KEY_RENAMES) {
    // Si guarda la SINGOLA chiave, non tutto il file. La prima stesura faceva
    // `if (text.includes(to)) continue` — quindi un `{{admin}}` scritto a mano in
    // una regola QUALSIASI sopprimeva la conversione del letterale `/admin`, e
    // senza nominarlo: ne' convertito ne' dichiarato (difetto 3).
    if (text.includes(to)) { alreadyDone.push(to); continue; }
    if (!text.includes(from)) { notFound.push(from); continue; }
    text = text.replace(from, to);
    renamed.push(from);
  }

  // Diagnostica che NON afferma una causa non verificata (difetto 5). La prima
  // stesura diceva « l'ancoraggio non combacia (file riformattato o
  // personalizzato) » anche per una regola semplicemente ASSENTE, mandando a
  // cercare un problema di formattazione che non c'era.
  if (notFound.length > 0) {
    const stillLiteral = notFound.filter((anchor) => {
      const key = anchor.slice(1, anchor.indexOf('": {'));
      return Object.prototype.hasOwnProperty.call(rules, key)
        || Object.prototype.hasOwnProperty.call(loadJson5(rulesPath).hardcodedRules || {}, key);
    });
    const absent = notFound.filter((a) => !stillLiteral.includes(a));

    if (absent.length > 0) {
      logger.info('migrate',
        `adminAccessControl: queste regole non esistono in questo file, quindi non c'era `
        + `niente da convertire: ${absent.map((a) => a.slice(1, a.indexOf('": {'))).join(', ')}`);
    }
    if (stillLiteral.length > 0) {
      logger.warn('migrate',
        'adminAccessControl: queste regole ESISTONO ma il loro ancoraggio testuale non '
        + `combacia, quindi restano letterali: ${stillLiteral.map((a) => a.slice(1, a.indexOf('": {'))).join(', ')}. `
        + 'Il file e stato riformattato: convertile a mano sostituendo il prefisso col '
        + 'nome della zona fra doppie graffe.');
    }
  }

  if (alreadyDone.length === KEY_RENAMES.length && toRemove.length === 0) {
    logger.info('migrate', 'adminAccessControl: accessControl.json5 già convertito, nessuna modifica');
    return;
  }

  if (dryRun) {
    logger.info('migrate',
      `adminAccessControl [dry-run]: ${renamed.length} pattern da rinominare, `
      + `${toRemove.length} forme pulite da rimuovere`
      + (keptBecauseCustomised.length > 0 ? `, ${keptBecauseCustomised.length} conservate perche personalizzate` : ''));
    return;
  }

  // ── 3. Si scrive il testo rinominato: una volta ────────────────────────────
  if (text !== before) {
    const tempPath = `${rulesPath}.migrating`;
    fs.writeFileSync(tempPath, text, 'utf8');
    fs.renameSync(tempPath, rulesPath);
  }

  // ── 4. Le rimozioni, via removeJson5Key ───────────────────────────────────
  //
  // Una scrittura per regola, e non si può fare altrimenti: `removeJson5Key`
  // lavora sul file. Accettabile qui e non in una primitiva, perche ogni
  // scrittura e atomica, ogni stato intermedio e JSON5 valido, lo step e sotto
  // backup del runner, e la ricevuta `schemaVersion` avanza solo a esito
  // riuscito — quindi una catena interrotta riprende da dove si e fermata, e
  // questo script e idempotente.
  const removed = [];
  for (const cleanKey of toRemove) {
    const outcome = await removeJson5Key(rulesPath, ['customRules', cleanKey]);
    if (outcome.changed) removed.push(cleanKey);
  }

  logger.info('migrate',
    `adminAccessControl: ${renamed.length} pattern convertiti ai segnaposti, `
    + `${removed.length} forme pulite rimosse (ora derivate)`);
}

module.exports = migrate;
module.exports.migrate = migrate;
