/**
 * Logger Module per ital8cms
 *
 * Sistema di logging centralizzato con supporto per livelli di log.
 *
 * Livelli disponibili (in ordine di priorità):
 * - DEBUG: Informazioni dettagliate per debugging
 * - INFO: Informazioni generali sul funzionamento
 * - WARN: Avvisi su potenziali problemi
 * - ERROR: Errori che richiedono attenzione
 *
 * Uso:
 *   const logger = require('./logger');
 *   logger.info('pluginSys', 'Plugin caricato');
 *   logger.error('pluginSys', 'Errore', errorObject);
 *
 * Configurazione:
 *   LOG_LEVEL=DEBUG npm start
 */

const path = require('path');
const fs = require('fs');
const loadJson5 = require('./loadJson5');

// Livelli di log con priorità numerica
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Colori ANSI per output colorato nel terminale
const COLORS = {
  DEBUG: '\x1b[36m',  // Cyan
  INFO: '\x1b[32m',   // Green
  WARN: '\x1b[33m',   // Yellow
  ERROR: '\x1b[31m',  // Red
  RESET: '\x1b[0m'    // Reset
};

// Carica configurazione da ital8Config.json5 se disponibile
let configLogLevel = 'INFO';
try {
  const configPath = path.join(__dirname, '..', 'ital8Config.json5');
  const config = loadJson5(configPath);
  if (config.logLevel) {
    configLogLevel = config.logLevel.toUpperCase();
  } else if (config.debugMode === 1) {
    configLogLevel = 'DEBUG';
  }
} catch (error) {
  // Configurazione non trovata, usa default
}

// Livello corrente: priorità a variabile ambiente, poi config, poi default
const currentLevel = (process.env.LOG_LEVEL || configLogLevel).toUpperCase();

// Verifica che il livello sia valido
if (!LOG_LEVELS.hasOwnProperty(currentLevel)) {
  console.warn(`[logger] Livello di log non valido: ${currentLevel}, uso INFO`);
}

/**
 * Formatta e stampa un messaggio di log
 *
 * @param {string} level - Livello del log (DEBUG, INFO, WARN, ERROR)
 * @param {string} prefix - Prefisso/modulo che genera il log
 * @param {string} message - Messaggio da loggare
 * @param {*} data - Dati aggiuntivi opzionali
 */
function log(level, prefix, message, data = null) {
  // Filtra in base al livello corrente
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) {
    return;
  }

  const timestamp = new Date().toISOString();
  const color = COLORS[level] || '';
  const reset = COLORS.RESET;

  // Formato: [timestamp] [LEVEL] [prefix] message
  const formattedMessage = `${color}[${timestamp}] [${level}] [${prefix}]${reset} ${message}`;

  // Usa console.error per ERROR, altrimenti console.log
  if (level === 'ERROR') {
    console.error(formattedMessage);
    if (data) {
      if (data instanceof Error) {
        console.error(`${color}  Stack:${reset}`, data.stack);
      } else {
        console.error(`${color}  Data:${reset}`, data);
      }
    }
  } else {
    console.log(formattedMessage);
    if (data && level === 'DEBUG') {
      console.log(`${color}  Data:${reset}`, data);
    }
  }
}

/**
 * Logger API
 */
module.exports = {
  /**
   * Log di debug - informazioni dettagliate per sviluppo
   * @param {string} prefix - Modulo che genera il log
   * @param {string} message - Messaggio
   * @param {*} data - Dati opzionali
   */
  debug: (prefix, message, data) => log('DEBUG', prefix, message, data),

  /**
   * Log informativo - funzionamento normale
   * @param {string} prefix - Modulo che genera il log
   * @param {string} message - Messaggio
   * @param {*} data - Dati opzionali
   */
  info: (prefix, message, data) => log('INFO', prefix, message, data),

  /**
   * Log di warning - potenziali problemi
   * @param {string} prefix - Modulo che genera il log
   * @param {string} message - Messaggio
   * @param {*} data - Dati opzionali
   */
  warn: (prefix, message, data) => log('WARN', prefix, message, data),

  /**
   * Log di errore - errori critici
   * @param {string} prefix - Modulo che genera il log
   * @param {string} message - Messaggio
   * @param {*} data - Dati opzionali (Error object o altri dati)
   */
  error: (prefix, message, data) => log('ERROR', prefix, message, data),

  /**
   * Ottieni il livello di log corrente
   * @returns {string} Livello corrente
   */
  getLevel: () => currentLevel,

  /**
   * Verifica se un livello è attivo
   * @param {string} level - Livello da verificare
   * @returns {boolean} true se il livello è attivo
   */
  isLevelEnabled: (level) => LOG_LEVELS[level.toUpperCase()] >= LOG_LEVELS[currentLevel]
};
