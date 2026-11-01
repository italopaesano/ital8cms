/**
 * setJson5Key — imposta (update-or-insert) una chiave in un file `.json5`,
 * preservando commenti, formattazione e trailing comma.
 *
 * Complementare a editJson5 (che solo *aggiorna* una chiave già esistente e non
 * la crea). Serve allo stato runtime del ciclo di vita config: il boot deve
 * scrivere `isInstalled` nel `pluginConfig.json5` vivo anche quando il campo non
 * c'è ancora (clone fresco: il vivo è materializzato dal `.default`, che
 * `isInstalled` NON lo contiene — vedi config-lifecycle §2).
 *
 * Comportamento:
 *   - Chiave già presente → delega a editJson5 (aggiornamento chirurgico).
 *   - Chiave assente → inserimento testuale come nuova proprietà, dopo la chiave
 *     `afterKey` se indicata e trovata (es. dopo `schemaVersion`), altrimenti
 *     subito dopo la `{` di apertura dell'oggetto che la ospita.
 *
 * CHIAVI ANNIDATE: `key` accetta una stringa (chiave top-level) oppure un ARRAY
 * di segmenti (`['custom', 'dataPath']`). L'inserimento annidato è il requisito
 * del merge RICORSIVO di `reconcileSchemaVersion`: quasi tutte le impostazioni
 * di un plugin vivono sotto `custom`, e finché si sapevano scrivere solo le
 * chiavi top-level un nuovo default annidato non raggiungeva mai le
 * installazioni esistenti (vedi docs/decisions/config-migrations.it.md).
 * Il parent deve già esistere ed essere un oggetto: se manca, va inserito lui
 * (con il proprio contenuto) al livello in cui manca. La localizzazione del
 * blocco parent riusa il locator di `core/json5Scan.js`, non una seconda
 * implementazione.
 *
 * Scope: valore JSON-serializzabile scritto inline con `JSON.stringify`;
 * l'oggetto root deve avere la `{` di apertura su riga propria (vero per tutti i
 * `pluginConfig`/`themeConfig`). `afterKey` si applica al solo inserimento
 * top-level e deve avere valore scalare su riga singola.
 *
 * API:
 *   setJson5Key(filePath, key, value, { afterKey }) →
 *     Promise<{ action: 'updated'|'inserted'|'unchanged', value, droppedComments }>
 *     key: string | string[]
 *
 * `droppedComments` è il resoconto di `editJson5` PROPAGATO, non scartato: è `[]`
 * su `unchanged` e su `inserted` (un inserimento non sostituisce niente, quindi
 * non può aver perso commenti), e su `updated` porta ciò che la sostituzione non
 * ha potuto preservare. Scartarlo rendeva la perdita di nuovo **silenziosa**
 * proprio attraverso l'API che il boot e le migrazioni usano.
 * ⚠ Oggi **nessun chiamante lo consuma**: l'informazione è disponibile, ma perché
 * arrivi a una persona serve che un chiamante la mostri — registrato in TODO.md.
 *
 * Throws su: argomenti non validi; file mancante / JSON5 non valido; root non
 * oggetto; parent inesistente o non-oggetto; `{` di apertura non su riga propria;
 * valore non serializzabile; fallimento della validazione post-scrittura.
 */

'use strict';

const fs = require('fs').promises;
const json5 = require('json5');
const loadJson5 = require('./loadJson5');
const editJson5 = require('./editJson5');
const json5Scan = require('./json5Scan');
const saveJson5 = require('./saveJson5');

function deepEqual(a, b) {
  return json5.stringify(a) === json5.stringify(b);
}

/**
 * Imposta una chiave, top-level o annidata (update-or-insert).
 *
 * @param {string} filePath - Path del file `.json5`.
 * @param {string|string[]} key - Nome della chiave, o path di segmenti annidati.
 * @param {*} value - Valore JSON-serializzabile.
 * @param {object} [options]
 * @param {string} [options.afterKey] - Inserisci dopo questa chiave (a qualunque
 *   livello da v3.32.0; se assente o non trovata: in testa al blocco).
 * @returns {Promise<{action: string, value: *}>}
 */
async function setJson5Key(filePath, key, value, options = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('setJson5Key: filePath must be a non-empty string');
  }
  const segments = Array.isArray(key) ? key : [key];
  if (segments.length === 0 || segments.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new Error('setJson5Key: key must be a non-empty string or an array of non-empty strings');
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    throw new Error(`setJson5Key: value is not serializable: ${e.message}`);
  }
  if (serialized === undefined) {
    throw new Error('setJson5Key: value is not JSON-serializable (undefined/function)');
  }

  // Carica e valida (loadJson5: messaggi chiari su not-found / sintassi).
  const parsed = loadJson5(filePath);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`setJson5Key: il file "${filePath}" non contiene un oggetto JSON5 al root`);
  }

  // Naviga fino al parent del leaf, validando che ogni intermedio esista e sia
  // un oggetto: la creazione di segmenti intermedi mancanti è volutamente fuori
  // scope (chi chiama deve inserire il sottoalbero al livello in cui manca).
  let parent = parsed;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = parent[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const pathDesc = segments.slice(0, i + 1).map((s) => `"${s}"`).join(' → ');
      throw new Error(
        `setJson5Key: il path ${pathDesc} in "${filePath}" non esiste o non è un oggetto ` +
        '(la creazione dei segmenti intermedi non è supportata)'
      );
    }
    parent = next;
  }
  const leafKey = segments[segments.length - 1];

  // Chiave già presente → aggiornamento via editJson5 (preserva tutto, e sa già
  // navigare i path annidati).
  if (Object.prototype.hasOwnProperty.call(parent, leafKey)) {
    if (deepEqual(parent[leafKey], value)) {
      return { action: 'unchanged', value, droppedComments: [] };
    }
    // Il resoconto di editJson5 viene PROPAGATO, non scartato. Scartarlo
    // rendeva la perdita di commenti di nuovo silenziosa proprio attraverso
    // l'API che boot e migrazioni usano — cioè l'opposto del motivo per cui
    // `droppedComments` esiste: « un commento perso in silenzio è il difetto,
    // uno perso e dichiarato è una conseguenza ».
    const outcome = await editJson5(filePath, segments.length === 1 ? leafKey : segments, value);
    return { action: 'updated', value, droppedComments: outcome.droppedComments };
  }

  // ── Chiave assente → inserimento testuale ─────────────────────────────────
  //
  // UN SOLO meccanismo per top-level e annidato. Fino alla v3.32.0 erano due:
  // il top-level lavorava per RIGHE (`split('\n')` + `findIndex` + `splice`) e
  // l'annidato per OFFSET, e si comportavano in modo diverso — `afterKey` era
  // onorato solo dal primo, e solo il secondo deduceva l'indentazione dal blocco.
  // Ora il punto d'inserimento lo calcola `json5Scan.findInsertionPoint`, che è
  // la gemella di `findRemovalSpan`: entrambe sono ANALISI, lo splice sta qui.
  const source = await fs.readFile(filePath, 'utf8');
  const mask = json5Scan.buildCodeMask(source);
  const depth = json5Scan.buildDepthArray(source, mask);

  const point = json5Scan.findInsertionPoint(
    source, mask, depth, segments.slice(0, -1), options.afterKey || null, filePath
  );

  let insertion = `\n${point.indent}"${leafKey}": ${serialized},`;
  // Blocco che era vuoto: senza questo la `}` resterebbe sulla riga della chiave
  // appena inserita (`{ "k": 1,}` — valido, ma questi file li legge una persona).
  if (point.blockIsEmpty) insertion += `\n${point.parentIndent}`;

  const updated = source.substring(0, point.offset)
    + (point.needsComma ? ',' : '')
    + insertion
    + source.substring(point.offset);

  // saveJson5 valida la stringa (json5.parse) e scrive atomico (temp + rename).
  await saveJson5(filePath, updated);

  // Sanity post-scrittura: il valore deve essere leggibile al path richiesto.
  const after = loadJson5(filePath);
  let actual = after;
  for (const seg of segments) {
    actual = (actual === null || typeof actual !== 'object') ? undefined : actual[seg];
  }
  if (!deepEqual(actual, value)) {
    const pathDesc = segments.map((s) => `"${s}"`).join(' → ');
    throw new Error(`setJson5Key: validazione post-scrittura fallita per il path ${pathDesc} in "${filePath}"`);
  }

  // Un inserimento non sostituisce niente, quindi non può aver perso commenti:
  // `[]` è il valore giusto, non un segnaposto. La forma di ritorno resta
  // comunque la STESSA nei tre rami, così chi la consuma non deve sapere quale
  // ha girato.
  return { action: 'inserted', value, droppedComments: [] };
}

module.exports = setJson5Key;
