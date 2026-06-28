/**
 * materializeMissingConfigs — materializza i config vivi mancanti di un intero
 * CONTENITORE (es. `plugins/` o `themes/`), scandendo le sue sottocartelle
 * dirette e creando i `*.json5` mancanti dai rispettivi `*.default.json5`.
 *
 * È il livello che il boot usa su `plugins/` e `themes/`: per ogni plugin/tema
 * (una sottocartella) materializza i suoi config mancanti (vedi
 * docs/decisions/config-lifecycle.it.md §5). Costruito sopra
 * materializeDirDefaults (una cartella) e materializeFromDefault (una coppia).
 *
 * Riusabile fuori dal boot: l'installazione di UN singolo plugin/tema usa
 * direttamente materializeDirDefaults(quellaCartella); questo livello copre
 * l'intero insieme (plugins/* o themes/*) in un colpo.
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
 *   materializeMissingConfigs(containerDir) → Promise<{ created, skipped, errors }>
 *     - created: string[]  es. 'seo/pluginConfig.json5'
 *     - skipped: string[]  vivi già presenti (no-op)
 *     - errors:  Array<{ file, message }>
 *
 * Throws su:
 *   - argomento non valido (containerDir non stringa o vuoto);
 *   - contenitore inesistente / non accessibile / non directory.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const materializeDirDefaults = require('./materializeDirDefaults');

/**
 * Materializza i config mancanti di ogni sottocartella diretta del contenitore.
 *
 * @param {string} containerDir - Radice che contiene le cartelle plugin/tema (es. 'plugins').
 * @returns {Promise<{created: string[], skipped: string[], errors: Array<{file: string, message: string}>}>}
 * @throws {Error} Se `containerDir` non è valido, non esiste, o non è una directory.
 */
async function materializeMissingConfigs(containerDir) {
  if (typeof containerDir !== 'string' || containerDir.length === 0) {
    throw new Error('materializeMissingConfigs: containerDir must be a non-empty string');
  }

  let stat;
  try {
    stat = await fs.stat(containerDir);
  } catch (err) {
    throw new Error(`materializeMissingConfigs: directory non accessibile: ${containerDir} (${err.message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`materializeMissingConfigs: il path non è una directory: ${containerDir}`);
  }

  const childNames = (await fs.readdir(containerDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const created = [];
  const skipped = [];
  const errors = [];

  for (const name of childNames) {
    const childDir = path.join(containerDir, name);
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

module.exports = materializeMissingConfigs;
