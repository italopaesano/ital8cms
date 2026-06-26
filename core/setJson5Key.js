/**
 * setJson5Key — imposta (update-or-insert) una chiave **top-level** in un file
 * `.json5`, preservando commenti, formattazione e trailing comma.
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
 *     subito dopo la `{` di apertura dell'oggetto root.
 *
 * Scope (volutamente minimale): SOLO chiavi top-level; valore JSON-serializzabile
 * scritto inline con `JSON.stringify`; l'oggetto root deve avere la `{` di
 * apertura su riga propria (vero per tutti i `pluginConfig`/`themeConfig`).
 * `afterKey` deve avere valore scalare su riga singola.
 *
 * API:
 *   setJson5Key(filePath, key, value, { afterKey }) →
 *     Promise<{ action: 'updated'|'inserted'|'unchanged', value }>
 *
 * Throws su: argomenti non validi; file mancante / JSON5 non valido; root non
 * oggetto; `{` di apertura non su riga propria; valore non serializzabile;
 * fallimento della validazione post-scrittura.
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
 * Imposta una chiave top-level (update-or-insert).
 *
 * @param {string} filePath - Path del file `.json5`.
 * @param {string} key - Nome della chiave top-level.
 * @param {*} value - Valore JSON-serializzabile.
 * @param {object} [options]
 * @param {string} [options.afterKey] - Inserisci dopo questa chiave (se assente: dopo `{`).
 * @returns {Promise<{action: string, value: *}>}
 */
async function setJson5Key(filePath, key, value, options = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('setJson5Key: filePath must be a non-empty string');
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('setJson5Key: key must be a non-empty string');
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

  // Chiave già presente → aggiornamento via editJson5 (preserva tutto).
  if (Object.prototype.hasOwnProperty.call(parsed, key)) {
    if (deepEqual(parsed[key], value)) {
      return { action: 'unchanged', value };
    }
    await editJson5(filePath, key, value);
    return { action: 'updated', value };
  }

  // Chiave assente → inserimento testuale.
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

  const newLine = `${indent}"${key}": ${serialized},`;
  lines.splice(insertAfter + 1, 0, newLine);
  const updated = lines.join('\n');

  // saveJson5 valida la stringa (json5.parse) e scrive atomico (temp + rename).
  await saveJson5(filePath, updated);

  // Sanity post-scrittura.
  const after = loadJson5(filePath);
  if (!deepEqual(after[key], value)) {
    throw new Error(`setJson5Key: validazione post-scrittura fallita per la chiave "${key}" in "${filePath}"`);
  }

  return { action: 'inserted', value };
}

module.exports = setJson5Key;
