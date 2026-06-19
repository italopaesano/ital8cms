// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * processSafetyNet.js
 *
 * Rete di sicurezza a livello di PROCESSO: registra gli handler globali per gli
 * errori che sfuggono a OGNI try/catch e a OGNI listener 'error':
 *   - 'uncaughtException'  → eccezione sincrona arrivata in cima all'event loop
 *   - 'unhandledRejection' → promise rifiutata senza .catch()
 *
 * Senza questi handler Node termina il processo con uno stack trace grezzo,
 * scavalcando il graceful shutdown. Qui invece:
 *   1. stampiamo un box diagnostico chiaro (warnFatalError), stessa filosofia di
 *      httpsManager.warnPrivilegedPort() / sessionSecurity.checkSessionKeys();
 *   2. deleghiamo la chiusura ordinata al callback onFatal iniettato da index.js
 *      (che riusa gracefulShutdown se i server sono già su, altrimenti esce);
 *   3. usciamo SEMPRE con codice 1, MAI con respawn dal qui.
 *
 * Filosofia: uncaughtException e unhandledRejection sono trattati ENTRAMBI come
 * FATALI. Dopo un errore non gestito lo stato del processo è potenzialmente
 * incoerente: proseguire è peggio di un riavvio pulito (a cura del supervisor).
 *
 * NB: è una RETE DI SICUREZZA, non un sostituto della gestione locale. Ogni
 * punto che può fallire dovrebbe comunque gestire il proprio errore nel posto
 * giusto (try/catch, .on('error'), box di boot dedicati). Questo modulo cattura
 * solo ciò che è sfuggito a tutto il resto.
 */

const util = require('util');

// Guard di rientranza: se un SECONDO errore fatale arriva mentre stiamo già
// gestendo il primo (es. la chiusura stessa lancia), forziamo l'uscita per
// evitare loop infiniti / handler ricorsivi.
let handlingFatal = false;

/**
 * Stampa un box ASCII prominente per un errore fatale non gestito.
 * Una sola chiamata a console.error (un solo write) → robusto anche subito
 * prima di un process.exit().
 *
 * @param {'uncaughtException'|'unhandledRejection'} kind - tipo di evento
 * @param {Error} err - errore già normalizzato a Error dal chiamante
 */
function warnFatalError(kind, err) {
  const line = '[FATAL] ' + '═'.repeat(58);
  const message = (err && err.message) ? err.message : String(err);
  const stack = (err && err.stack) ? String(err.stack) : String(err);
  const stackLines = stack.split('\n').map((l) => '[FATAL]    ' + l);

  const lines = [
    '',
    line,
    `[FATAL]  🔴  Errore fatale non gestito (${kind})`,
    line,
    `[FATAL]    ${message}`,
    '[FATAL]',
    "[FATAL]    Errore sfuggito a ogni try/catch e listener 'error'. ital8cms si",
    '[FATAL]    arresta in modo ordinato: proseguire con uno stato potenzialmente',
    '[FATAL]    incoerente è peggio di un riavvio pulito (a cura del supervisor).',
    '[FATAL]',
    '[FATAL]  Stack trace:',
    ...stackLines,
    '[FATAL]',
    '[FATAL]  ▶ Chiusura ordinata dei server e uscita (exit 1).',
    line,
    '',
  ];
  console.error(lines.join('\n'));
}

/**
 * Normalizza il "reason" di una rejection (che può NON essere un Error) a Error.
 * @param {unknown} reason
 * @returns {Error}
 */
function toError(reason) {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error(util.inspect(reason));
}

/**
 * Registra gli handler globali di processo (uncaughtException + unhandledRejection).
 * Idempotente nei suoi effetti pratici, ma va chiamata UNA volta sola, il più
 * presto possibile in index.js, così da coprire anche la fase di boot.
 *
 * @param {object} [options]
 * @param {(kind: string, err: Error) => void} [options.onFatal] - callback per la
 *   chiusura ordinata. Riceve il tipo di evento e l'errore normalizzato. Se
 *   assente, o se lancia a sua volta, si ricade su process.exit(1).
 * @returns {(kind: string, rawError: unknown) => void} il dispatcher registrato
 *   (utile per i test).
 */
function installProcessSafetyNet(options = {}) {
  const onFatal = typeof options.onFatal === 'function' ? options.onFatal : null;

  const handleFatal = (kind, rawError) => {
    const err = toError(rawError);

    // Seconda occorrenza durante la gestione → uscita forzata immediata.
    if (handlingFatal) {
      try {
        console.error(`[FATAL] Secondo errore fatale durante la chiusura (${kind}): ${err.message}`);
      } catch (_) { /* nulla: stiamo comunque uscendo */ }
      process.exit(1);
      return;
    }
    handlingFatal = true;

    warnFatalError(kind, err);

    if (!onFatal) {
      process.exit(1);
      return;
    }

    try {
      onFatal(kind, err);
    } catch (shutdownError) {
      console.error(
        '[FATAL] Errore durante la chiusura ordinata, uscita forzata:',
        (shutdownError && shutdownError.message) ? shutdownError.message : shutdownError
      );
      process.exit(1);
    }
  };

  process.on('uncaughtException', (err) => handleFatal('uncaughtException', err));
  process.on('unhandledRejection', (reason) => handleFatal('unhandledRejection', reason));

  return handleFatal;
}

module.exports = { installProcessSafetyNet, warnFatalError, toError };
