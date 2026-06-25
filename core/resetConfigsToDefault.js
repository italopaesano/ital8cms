/**
 * resetConfigsToDefault — riporta i config di UNA cartella (plugin/tema) allo
 * stato di default cancellando i file vivi `x.json5` che hanno un sidecar
 * `x.default.json5`. È l'inverso di materializeDirDefaults.
 *
 * Modello del ciclo di vita (docs/decisions/config-lifecycle.it.md §3): il reset
 * NON riscrive i default sui vivi — li RIMUOVE. Al boot successivo
 * materializeMissingConfigs li rigenera dai default (riportando anche `active`
 * al valore di default). Così il "vero" stato di default resta una sola fonte:
 * i `*.default.json5`.
 *
 * Granularità a livello di cartella (un plugin/tema), non di singolo file
 * (doc §3: "niente reset granulare per singolo file").
 *
 * Cosa tocca / cosa NON tocca:
 *   - Cancella SOLO i `x.json5` che hanno un `x.default.json5` accanto.
 *   - NON tocca i `*.default.json5` (sono la fonte di verità).
 *   - NON tocca file senza default (codice, log runtime, ecc.).
 *
 * Sicurezza: `dryRun` per ispezionare cosa verrebbe rimosso senza toccare il
 * disco. Il flag `userDataFiles` nel risultato segnala i reset che azzerano dati
 * utente (es. `userAccount.json5`) — il chiamante (CLI) lo usa per un avviso
 * rafforzato.
 *
 * API:
 *   resetConfigsToDefault(dir, { dryRun=false }) → Promise<{ removed, absent, userDataFiles, errors }>
 *     - removed:       string[]  vivi rimossi (o che verrebbero rimossi se dryRun)
 *     - absent:        string[]  default senza vivo (niente da fare)
 *     - userDataFiles: string[]  sottoinsieme di removed che è dato utente
 *     - errors:        Array<{ file, message }>
 *
 * Throws su: argomento non valido, dir inesistente / non directory.
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

const DEFAULT_SUFFIX = '.default.json5';

// File i cui reset azzerano DATI UTENTE (non semplice configurazione): meritano
// un avviso rafforzato lato CLI (rischio lockout, vedi doc §3).
const USER_DATA_LIVE_FILES = new Set(['userAccount.json5', 'userRole.json5']);

/**
 * Riporta i config di una cartella ai default rimuovendo i vivi.
 *
 * @param {string} dir - Cartella di un plugin/tema.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Se true, non cancella nulla (solo report).
 * @returns {Promise<{removed: string[], absent: string[], userDataFiles: string[], errors: Array<{file: string, message: string}>}>}
 * @throws {Error} Se `dir` non è valido, non esiste, o non è una directory.
 */
async function resetConfigsToDefault(dir, options = {}) {
  const dryRun = options.dryRun === true;

  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('resetConfigsToDefault: dir must be a non-empty string');
  }

  let stat;
  try {
    stat = await fs.stat(dir);
  } catch (err) {
    throw new Error(`resetConfigsToDefault: directory non accessibile: ${dir} (${err.message})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`resetConfigsToDefault: il path non è una directory: ${dir}`);
  }

  const entries = await fs.readdir(dir);
  const defaults = entries.filter((name) => name.endsWith(DEFAULT_SUFFIX)).sort();

  const removed = [];
  const absent = [];
  const userDataFiles = [];
  const errors = [];

  for (const defaultName of defaults) {
    const liveName = defaultName.slice(0, -DEFAULT_SUFFIX.length) + '.json5';
    const livePath = path.join(dir, liveName);

    let liveExists = false;
    try {
      await fs.access(livePath);
      liveExists = true;
    } catch (_) {
      liveExists = false;
    }

    if (!liveExists) {
      absent.push(liveName);
      continue;
    }

    try {
      if (!dryRun) await fs.unlink(livePath);
      removed.push(liveName);
      if (USER_DATA_LIVE_FILES.has(liveName)) userDataFiles.push(liveName);
    } catch (err) {
      errors.push({ file: liveName, message: err.message });
    }
  }

  return { removed, absent, userDataFiles, errors };
}

module.exports = resetConfigsToDefault;
