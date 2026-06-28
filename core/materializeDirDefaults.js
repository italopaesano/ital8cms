/**
 * materializeDirDefaults — materializza tutti i config vivi mancanti di UNA
 * directory, a partire dai rispettivi sidecar `*.default.json5`.
 *
 * È il livello "batch" sopra materializeFromDefault (vedi
 * docs/decisions/config-lifecycle.it.md §5: "il boot materializza
 * automaticamente i config di plugin/tema mancanti"). Data la cartella di un
 * plugin o di un tema, scandisce i file `*.default.json5` e, per ognuno, crea
 * il `*.json5` vivo corrispondente se manca (no-op se esiste già).
 *
 * Mappatura del nome: `x.default.json5` → `x.json5`
 *   (es. `pluginConfig.default.json5` → `pluginConfig.json5`,
 *        `seoPages.default.json5`     → `seoPages.json5`).
 *
 * Non ricorsiva: opera solo sui file diretti della directory indicata (i config
 * di un plugin/tema vivono nella sua radice). I file che non terminano in
 * `.default.json5` sono ignorati.
 *
 * Degradazione graziosa: un singolo default rotto (JSON5 non valido) NON
 * interrompe gli altri — l'errore viene raccolto in `errors` e la scansione
 * prosegue. Spetta al chiamante (il boot) decidere come presentarli.
 *
 * API:
 *   materializeDirDefaults(dir) → Promise<{ created, skipped, errors }>
 *     - created: string[]  nomi dei file vivi appena generati
 *     - skipped: string[]  nomi dei file vivi già presenti (no-op)
 *     - errors:  Array<{ file, message }>  default non materializzabili
 *
 * Throws su:
 *   - argomento non valido (dir non stringa o vuoto);
 *   - directory inesistente o non accessibile;
 *   - il path indicato non è una directory.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const materializeFromDefault = require('./materializeFromDefault');

const DEFAULT_SUFFIX = '.default.json5';

/**
 * Materializza i config vivi mancanti di una directory dai loro `.default`.
 *
 * @param {string} dir - Directory del plugin/tema (contiene i `*.default.json5`).
 * @returns {Promise<{created: string[], skipped: string[], errors: Array<{file: string, message: string}>}>}
 * @throws {Error} Se `dir` non è valido, non esiste, o non è una directory.
 */
async function materializeDirDefaults(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('materializeDirDefaults: dir must be a non-empty string');
  }

  let stat;
  try {
    stat = await fs.stat(dir);
  } catch (err) {
    throw new Error(`materializeDirDefaults: directory non accessibile: ${dir} (${err.message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`materializeDirDefaults: il path non è una directory: ${dir}`);
  }

  // Ordinati per un comportamento deterministico (log/test prevedibili).
  const entries = await fs.readdir(dir);
  const defaults = entries.filter((name) => name.endsWith(DEFAULT_SUFFIX)).sort();

  const created = [];
  const skipped = [];
  const errors = [];

  for (const defaultName of defaults) {
    const liveName = defaultName.slice(0, -DEFAULT_SUFFIX.length) + '.json5';
    const defaultPath = path.join(dir, defaultName);
    const livePath = path.join(dir, liveName);
    try {
      const result = await materializeFromDefault(defaultPath, livePath);
      if (result.created) created.push(liveName);
      else skipped.push(liveName);
    } catch (err) {
      errors.push({ file: liveName, message: err.message });
    }
  }

  return { created, skipped, errors };
}

module.exports = materializeDirDefaults;
