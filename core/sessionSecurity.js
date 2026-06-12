// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * sessionSecurity.js
 *
 * Utilità RUNTIME per la sicurezza delle chiavi di sessione (le chiavi che
 * firmano i cookie koa-session, definite in
 * core/priorityMiddlewares/koaSession.json5).
 *
 * Le chiavi committate nel repository sono PLACEHOLDER condivisi: chiunque
 * cloni il progetto le conosce. In produzione vanno sostituite con chiavi
 * casuali (lo fa il wizard d'installazione tramite
 * scripts/lib/sessionKeyManager.js).
 *
 * Questo modulo è la FONTE UNICA per:
 *   - la denylist dei placeholder noti      → PLACEHOLDER_SESSION_KEYS
 *   - il predicato di (in)sicurezza         → keysAreInsecure(keys)
 *   - l'avviso al boot (box ASCII)          → checkSessionKeys(ital8Conf)
 *
 * NON dipende da inquirer né da scripts/: è importabile sia da index.js
 * (runtime) sia dal tooling d'installazione (scripts/lib/sessionKeyManager.js),
 * mantenendo la direzione di dipendenza corretta (tooling → core).
 */

const path = require('path');
const loadJson5 = require('./loadJson5');

// Percorso del file di configurazione delle sessioni
const SESSION_CONFIG_PATH = path.join(__dirname, 'priorityMiddlewares', 'koaSession.json5');

/**
 * Denylist delle chiavi placeholder note (committate nel repo o mostrate nella
 * documentazione). Se una QUALSIASI chiave attiva è presente qui, le chiavi
 * sono da considerarsi insicure.
 */
const PLACEHOLDER_SESSION_KEYS = Object.freeze([
  // Valori attualmente presenti in core/priorityMiddlewares/koaSession.json5
  'key.segretussimmmmmm',
  'fbtgnrnyrmnytmtymyt',
  'brtnrynynyny',
  // Valore di esempio storicamente mostrato nella documentazione (CLAUDE.md)
  'key.secondaryKey123',
]);

/**
 * Determina se un array di chiavi di sessione è insicuro.
 * È insicuro se: non è un array, è vuoto, oppure contiene almeno una chiave
 * presente nella denylist dei placeholder.
 *
 * @param {unknown} keys
 * @returns {boolean}
 */
function keysAreInsecure(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return true;
  return keys.some((key) => PLACEHOLDER_SESSION_KEYS.includes(key));
}

/**
 * Emette un warning visivo (box ASCII) all'avvio se le chiavi di sessione sono
 * ancora i placeholder. Stessa filosofia di httpsManager.warnMissingCertificates()
 * e demoNotice.printDemoBootWarning(): prominente, actionable, non bloccante.
 *
 * Salta del tutto se la sessione è disabilitata in configurazione (le chiavi
 * non verrebbero usate). Il server parte comunque.
 *
 * @param {object} ital8Conf - configurazione principale ital8cms
 * @param {object} [options]
 * @param {string} [options.configPath]   - override path koaSession.json5 (per test)
 * @param {object} [options.sessionConfig] - config già caricata (per test, evita l'IO)
 * @returns {boolean} true se è stato emesso il warning (chiavi insicure), false altrimenti
 */
function checkSessionKeys(ital8Conf, options = {}) {
  // Se la sessione è disabilitata, le chiavi non sono usate → nessun warning
  const sessionEnabled = !(
    ital8Conf &&
    ital8Conf.priorityMiddlewares &&
    ital8Conf.priorityMiddlewares.session === false
  );
  if (!sessionEnabled) return false;

  let sessionConfig = options.sessionConfig;
  if (!sessionConfig) {
    const configPath = options.configPath || SESSION_CONFIG_PATH;
    try {
      sessionConfig = loadJson5(configPath);
    } catch (err) {
      console.warn(`[SESSION] ⚠  Impossibile leggere koaSession.json5: ${err.message}`);
      return false;
    }
  }

  if (!keysAreInsecure(sessionConfig.keys)) return false;

  const line = '[SESSION] ══════════════════════════════════════════════════════════';
  const lines = [
    '',
    line,
    '[SESSION]  ⚠  Chiavi di sessione INSICURE (placeholder di default)',
    line,
    '[SESSION]    Le chiavi che firmano i cookie di sessione sono ancora quelle',
    '[SESSION]    committate nel repository: chiunque le conosce. Un attaccante',
    '[SESSION]    può forgiare cookie di sessione validi (impersonazione).',
    '[SESSION]',
    '[SESSION]  Opzione A — esegui il wizard (genera chiavi casuali sicure):',
    '[SESSION]',
    '[SESSION]    npm run start-configure',
    '[SESSION]',
    '[SESSION]  Opzione B — modifica a mano core/priorityMiddlewares/koaSession.json5',
    '[SESSION]    sostituendo l\'array "keys" con stringhe casuali e segrete.',
    '[SESSION]',
    '[SESSION]  ▶ Il server parte comunque (le sessioni funzionano, ma NON sono sicure).',
    line,
    '',
  ];
  console.warn(lines.join('\n'));
  return true;
}

module.exports = {
  PLACEHOLDER_SESSION_KEYS,
  keysAreInsecure,
  checkSessionKeys,
  SESSION_CONFIG_PATH,
};
