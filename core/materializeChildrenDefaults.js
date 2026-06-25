/**
 * materializeChildrenDefaults — materializza i config vivi mancanti di OGNI
 * sottocartella diretta di una radice, dai rispettivi `*.default.json5`.
 *
 * È il livello che il boot usa su `plugins/` e `themes/`: per ogni
 * plugin/tema (una sottocartella) materializza i suoi config mancanti
 * (vedi docs/decisions/config-lifecycle.it.md §5). Costruito sopra
 * materializeDirDefaults (una cartella) e materializeFromDefault (una coppia).
 *
 * Riusabile fuori dal boot: l'installazione di UN singolo plugin/tema usa
 * direttamente materializeDirDefaults(quellaCartella); questo livello serve
 * quando si vuole coprire l'intero insieme (plugins/* o themes/*) in un colpo.
 *
 * Solo i FIGLI diretti (profondità 1): ogni sottocartella = un plugin/tema; i
 * config vivono nella sua radice. Le entry-file nella radice sono ignorate.
 *
 * Degradazione graziosa: un default rotto (o una sottocartella problematica)
 * non interrompe le altre — gli errori sono raccolti in `errors`.
 *
 * I nomi nei risultati sono prefissati con la sottocartella (`seo/pluginConfig.json5`)
 * per restare leggibili e non collidere tra plugin diversi.
 *
 * API:
 *   materializeChildrenDefaults(rootDir) → Promise<{ created, skipped, errors }>
 *     - created: string[]  es. 'seo/pluginConfig.json5'
 *     - skipped: string[]  vivi già presenti (no-op)
 *     - errors:  Array<{ file, message }>
 *
 * Throws su:
 *   - argomento non valido (rootDir non stringa o vuoto);
 *   - radice inesistente / non accessibile / non directory.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const materializeDirDefaults = require('./materializeDirDefaults');

/**
 * Materializza i default mancanti di ogni sottocartella diretta di `rootDir`.
 *
 * @param {string} rootDir - Radice che contiene le cartelle plugin/tema (es. 'plugins').
 * @returns {Promise<{created: string[], skipped: string[], errors: Array<{file: string, message: string}>}>}
 * @throws {Error} Se `rootDir` non è valido, non esiste, o non è una directory.
 */
async function materializeChildrenDefaults(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('materializeChildrenDefaults: rootDir must be a non-empty string');
  }

  let stat;
  try {
    stat = await fs.stat(rootDir);
  } catch (err) {
    throw new Error(`materializeChildrenDefaults: directory non accessibile: ${rootDir} (${err.message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`materializeChildrenDefaults: il path non è una directory: ${rootDir}`);
  }

  const childNames = (await fs.readdir(rootDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const created = [];
  const skipped = [];
  const errors = [];

  for (const name of childNames) {
    const childDir = path.join(rootDir, name);
    try {
      const summary = await materializeDirDefaults(childDir);
      for (const f of summary.created) created.push(`${name}/${f}`);
      for (const f of summary.skipped) skipped.push(`${name}/${f}`);
      for (const e of summary.errors) errors.push({ file: `${name}/${e.file}`, message: e.message });
    } catch (err) {
      // Una sottocartella problematica non deve fermare le altre.
      errors.push({ file: `${name}/`, message: err.message });
    }
  }

  return { created, skipped, errors };
}

module.exports = materializeChildrenDefaults;
