/**
 * installPluginNpmDeps — installa le dipendenze npm di UN plugin/tema
 * SELF-CONTAINED (quello che porta un proprio `package.json`) eseguendo
 * `npm install` DENTRO la sua cartella, così le deps finiscono nel suo
 * `node_modules` locale (che Node risolve con priorità rispetto alla root —
 * vedi docs/self-update.it.md, "Modello delle dipendenze npm").
 *
 * No-op sicuro se la cartella NON ha un `package.json` (plugin/tema legacy che
 * dichiara `nodeModuleDependency`): in quel caso ritorna { ran:false } senza
 * lanciare, così il chiamante può invocarla senza pre-controlli.
 *
 * Usata da:
 *   - core/pluginSys.js         → alla transizione d'installazione di un plugin
 *                                 (isInstalled non-1 → 1), prima di require(main.js).
 *   - scripts/lib/pluginDepsReconciler.js → nel ramo self-contained di deps-sync.
 *
 * Filosofia degli errori: la funzione LANCIA se `npm` fallisce; il chiamante
 * decide (il boot resta graceful — vedi pluginSys — e deps-sync accumula warning
 * non-fatali). L'ambiente npm è sanificato (vedi sanitizedNpmEnv).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Ambiente sanificato per il `npm install` annidato: rimuove le variabili di
 * "prefix" ereditate dall'npm padre (`npm run` / `postinstall`) che altrimenti
 * farebbero installare le deps nella cartella sbagliata. Proxy, registry e cache
 * restano intatti.
 * @returns {NodeJS.ProcessEnv}
 */
function sanitizedNpmEnv() {
  const env = { ...process.env };
  delete env.npm_config_local_prefix;
  delete env.npm_config_prefix;
  delete env.INIT_CWD;
  return env;
}

/**
 * Esegue `npm install` (o `npm ci`) dentro `dir` se contiene un `package.json`.
 *
 * @param {string} dir - cartella del plugin/tema.
 * @param {object} [opts]
 * @param {boolean} [opts.clean=false] - usa `npm ci` invece di `npm install`.
 * @param {'inherit'|'pipe'|'ignore'} [opts.stdio='inherit'] - stdio del processo npm.
 * @param {(subcommand: string) => void} [opts.onLog] - invocata (col nome del
 *        subcomando: 'install'|'ci') SUBITO PRIMA di lanciare npm, solo quando
 *        un `package.json` è presente. Utile per una riga di log al chiamante.
 * @returns {{ran: boolean, subcommand?: string, reason?: string}}
 *          ran=false + reason='no-package-json' se la cartella è legacy.
 * @throws {Error} se il processo `npm` esce con codice non-zero.
 */
function installPluginNpmDeps(dir, opts = {}) {
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { ran: false, reason: 'no-package-json' };
  }

  const subcommand = opts.clean === true ? 'ci' : 'install';
  if (typeof opts.onLog === 'function') opts.onLog(subcommand);

  execFileSync('npm', [subcommand, '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: opts.stdio || 'inherit',
    env: sanitizedNpmEnv(),
  });

  return { ran: true, subcommand };
}

module.exports = installPluginNpmDeps;
module.exports.installPluginNpmDeps = installPluginNpmDeps;
module.exports.sanitizedNpmEnv = sanitizedNpmEnv;
