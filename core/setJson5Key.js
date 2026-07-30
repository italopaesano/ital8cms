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
 * blocco parent riusa il locator di editJson5 (`_internals`), non una seconda
 * implementazione.
 *
 * Scope: valore JSON-serializzabile scritto inline con `JSON.stringify`;
 * l'oggetto root deve avere la `{` di apertura su riga propria (vero per tutti i
 * `pluginConfig`/`themeConfig`). `afterKey` si applica al solo inserimento
 * top-level e deve avere valore scalare su riga singola.
 *
 * API:
 *   setJson5Key(filePath, key, value, { afterKey }) →
 *     Promise<{ action: 'updated'|'inserted'|'unchanged', value }>
 *     key: string | string[]
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
 * @param {string} [options.afterKey] - Inserisci dopo questa chiave (solo top-level; se assente: dopo `{`).
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
      return { action: 'unchanged', value };
    }
    await editJson5(filePath, segments.length === 1 ? leafKey : segments, value);
    return { action: 'updated', value };
  }

  // Chiave assente in un oggetto ANNIDATO → inserimento subito dopo la `{` del
  // parent, localizzata con il locator di editJson5.
  if (segments.length > 1) {
    return insertNested(filePath, segments, value, serialized);
  }

  // Chiave assente al top-level → inserimento testuale.
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split('\n');

  const braceIdx = lines.findIndex((l) => l.trim() === '{');
  if (braceIdx === -1) {
    throw new Error(`setJson5Key: "${filePath}" non ha la '{' di apertura su riga propria (inserimento non supportato)`);
  }

  // Posizione di inserimento: dopo afterKey se richiesto e presente, altrimenti dopo `{`.
  let insertAfter = braceIdx;
  if (options.afterKey) {
    const anchorRe = new RegExp(`^\\s*["']?${options.afterKey}["']?\\s*:`);
    for (let i = braceIdx + 1; i < lines.length; i++) {
      if (anchorRe.test(lines[i])) { insertAfter = i; break; }
    }
  }

  // Indentazione: ricalcata dalla prima proprietà del root, fallback 2 spazi.
  let indent = '  ';
  for (let i = braceIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)\S/);
    if (m) { indent = m[1]; break; }
  }

  const newLine = `${indent}"${leafKey}": ${serialized},`;
  lines.splice(insertAfter + 1, 0, newLine);
  const updated = lines.join('\n');

  // saveJson5 valida la stringa (json5.parse) e scrive atomico (temp + rename).
  await saveJson5(filePath, updated);

  // Sanity post-scrittura.
  const after = loadJson5(filePath);
  if (!deepEqual(after[leafKey], value)) {
    throw new Error(`setJson5Key: validazione post-scrittura fallita per la chiave "${leafKey}" in "${filePath}"`);
  }

  return { action: 'inserted', value };
}

/**
 * Inserisce una chiave dentro un oggetto ANNIDATO già esistente.
 *
 * Localizza il blocco del parent con il locator di editJson5 e scrive la nuova
 * proprietà subito dopo la sua `{`. L'indentazione è dedotta dalla prima riga
 * del blocco (fallback: due spazi in più del parent), così il file resta
 * formattato come lo trova.
 *
 * @param {string} filePath
 * @param {string[]} segments - Path completo (l'ultimo è il leaf da creare).
 * @param {*} value
 * @param {string} serialized - `JSON.stringify(value)`, già calcolato dal chiamante.
 * @returns {Promise<{action: string, value: *}>}
 */
async function insertNested(filePath, segments, value, serialized) {
  const source = await fs.readFile(filePath, 'utf8');
  const { buildCodeMask, buildDepthArray, locatePath } = editJson5._internals;

  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  const parentSegments = segments.slice(0, -1);
  const leafKey = segments[segments.length - 1];

  const parentOcc = locatePath(source, mask, depth, parentSegments, filePath);
  if (source[parentOcc.valueStart] !== '{') {
    const pathDesc = parentSegments.map((s) => `"${s}"`).join(' → ');
    throw new Error(`setJson5Key: il path ${pathDesc} in "${filePath}" non è un oggetto: impossibile inserirci una chiave`);
  }

  // Indentazione del parent (dalla sua riga) e del suo contenuto.
  let parentLineStart = parentOcc.keyStart;
  while (parentLineStart > 0 && source[parentLineStart - 1] !== '\n') parentLineStart--;
  const parentIndentRaw = source.substring(parentLineStart, parentOcc.keyStart);
  const parentIndent = /^\s*$/.test(parentIndentRaw) ? parentIndentRaw : '';

  // Prima riga non vuota dentro il blocco → ne ricalca l'indentazione.
  const insertAt = parentOcc.valueStart + 1; // subito dopo `{`
  const blockInner = source.substring(insertAt, parentOcc.valueEnd - 1);
  const innerMatch = blockInner.match(/\n([ \t]+)\S/);
  const indent = innerMatch ? innerMatch[1] : parentIndent + '  ';

  const newSource =
    source.substring(0, insertAt) +
    `\n${indent}"${leafKey}": ${serialized},` +
    source.substring(insertAt);

  await saveJson5(filePath, newSource);

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

  return { action: 'inserted', value };
}

module.exports = setJson5Key;
