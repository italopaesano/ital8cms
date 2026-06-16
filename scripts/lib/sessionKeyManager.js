// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * sessionKeyManager.js
 *
 * Tooling d'INSTALLAZIONE per le chiavi di sessione (firma dei cookie koa-session).
 * Genera chiavi casuali sicure e gestisce lo step interattivo del wizard
 * (scripts/init.js, FASE 1), che permette di:
 *   - generare nuove chiavi casuali (default consigliato se le attuali sono placeholder)
 *   - inserire chiavi personalizzate
 *   - mantenere le chiavi correnti
 *
 * La denylist dei placeholder e il predicato di (in)sicurezza vivono in
 * core/sessionSecurity.js (fonte unica, condivisa con il warning al boot).
 *
 * Scrittura: backup via BackupManager + editJson5 (sostituisce solo il campo
 * "keys" preservando tutti i commenti del file). I valori delle chiavi NON
 * vengono mai stampati a console né scritti nel log (sono segreti).
 */

const crypto = require('crypto');
const loadJson5 = require('../../core/loadJson5');
const editJson5 = require('../../core/editJson5');
const { keysAreInsecure, PLACEHOLDER_SESSION_KEYS } = require('../../core/sessionSecurity');

// Numero di chiavi generate di default (primary + chiavi di verifica per la rotazione koa-session)
const DEFAULT_KEY_COUNT = 3;
// Byte di entropia per chiave (32 byte = 256 bit)
const DEFAULT_KEY_BYTES = 32;
// Lunghezza minima accettata per chiavi inserite manualmente
const MIN_CUSTOM_KEY_LENGTH = 16;

/**
 * Genera un array di chiavi di sessione casuali e crittograficamente sicure.
 * Ogni chiave è codificata base64url (URL-safe: solo [A-Za-z0-9_-], nessun
 * carattere problematico nei file JSON5).
 *
 * @param {number} [count=DEFAULT_KEY_COUNT]  Numero di chiavi da generare
 * @param {number} [bytes=DEFAULT_KEY_BYTES]  Byte di entropia per chiave
 * @returns {string[]} Array di chiavi uniche
 */
function generateSessionKeys(count = DEFAULT_KEY_COUNT, bytes = DEFAULT_KEY_BYTES) {
  const keys = [];
  while (keys.length < count) {
    const key = crypto.randomBytes(bytes).toString('base64url');
    if (!keys.includes(key)) keys.push(key); // garantisce unicità (collisione praticamente impossibile)
  }
  return keys;
}

/**
 * Step interattivo del wizard per la gestione delle chiavi di sessione.
 * Esegue backup + scrittura atomica (preservando i commenti) solo se l'utente
 * sceglie di generare o inserire nuove chiavi.
 *
 * Il default del menu è ADATTIVO: "Genera" se le chiavi correnti sono i
 * placeholder, "Mantieni" se risultano già personalizzate (evita di invalidare
 * sessioni esistenti durante una re-inizializzazione).
 *
 * @param {object} context
 * @param {object} context.logger        - InitLogger
 * @param {object} context.backupManager - BackupManager
 * @param {string} context.configPath    - path assoluto a koaSession.json5
 * @returns {Promise<{action: 'generate'|'custom'|'keep'|'skip', changed: boolean}>}
 */
async function configureSessionKeys(context) {
  const inquirer = require('inquirer').default;
  const { logger, backupManager, configPath } = context;

  logger.separator();
  console.log('\n🔑 Chiavi di sessione (firma dei cookie)\n');

  // Legge le chiavi correnti
  let currentKeys = [];
  try {
    const sessionConfig = loadJson5(configPath);
    currentKeys = Array.isArray(sessionConfig.keys) ? sessionConfig.keys : [];
  } catch (err) {
    logger.warning(`Impossibile leggere koaSession.json5: ${err.message}`);
    logger.warning('Step chiavi di sessione saltato.');
    return { action: 'skip', changed: false };
  }

  const insecure = keysAreInsecure(currentKeys);

  if (insecure) {
    console.log('⚠️  Le chiavi attuali sono PLACEHOLDER non sicure (note a chiunque cloni il repo).');
    console.log('   In produzione vanno sostituite con chiavi casuali.\n');
  } else {
    console.log('✓ Le chiavi attuali risultano già personalizzate.\n');
  }

  const { action } = await inquirer.prompt([
    {
      type: 'select',
      name: 'action',
      message: 'Come vuoi gestire le chiavi di sessione?',
      choices: [
        { name: 'Genera nuove chiavi casuali sicure (consigliato)', value: 'generate' },
        { name: 'Inserisci chiavi personalizzate', value: 'custom' },
        { name: 'Mantieni le chiavi correnti', value: 'keep' },
      ],
      default: insecure ? 'generate' : 'keep',
    },
  ]);

  if (action === 'keep') {
    if (insecure) {
      logger.warning('Chiavi placeholder mantenute: NON sicure per la produzione.');
    } else {
      logger.info('Chiavi di sessione mantenute invariate.');
    }
    return { action, changed: false };
  }

  let newKeys;
  if (action === 'generate') {
    newKeys = generateSessionKeys();
  } else {
    // Inserimento manuale: input separato da virgola, validato sulla stringa grezza
    // (evita le insidie dell'ordine filter/validate di inquirer).
    const { customRaw } = await inquirer.prompt([
      {
        type: 'input',
        name: 'customRaw',
        message: `Inserisci le chiavi separate da virgola (min ${MIN_CUSTOM_KEY_LENGTH} caratteri ciascuna):`,
        validate: (value) => {
          const keys = String(value).split(',').map((k) => k.trim()).filter(Boolean);
          if (keys.length === 0) return 'Inserisci almeno una chiave';
          for (const k of keys) {
            if (k.length < MIN_CUSTOM_KEY_LENGTH) {
              return `Ogni chiave deve avere almeno ${MIN_CUSTOM_KEY_LENGTH} caratteri (troppo corta: "${k}")`;
            }
            if (PLACEHOLDER_SESSION_KEYS.includes(k)) {
              return `La chiave "${k}" è un placeholder noto: scegline un'altra`;
            }
          }
          return true;
        },
      },
    ]);
    newKeys = String(customRaw).split(',').map((k) => k.trim()).filter(Boolean);
  }

  // Backup + scrittura atomica preservando i commenti del file
  try {
    backupManager.backupGlobalFile(configPath);
    const result = await editJson5(configPath, 'keys', newKeys);
    if (result.changed) {
      // NOTA: non stampare mai i valori delle chiavi (sono segreti, e il logger scrive su file)
      logger.success(`Chiavi di sessione aggiornate (${newKeys.length} chiavi).`);
    } else {
      logger.info('Chiavi di sessione invariate (identiche alle precedenti).');
    }
    return { action, changed: result.changed };
  } catch (err) {
    logger.error(`Errore aggiornamento chiavi di sessione: ${err.message}`);
    return { action, changed: false };
  }
}

module.exports = {
  generateSessionKeys,
  configureSessionKeys,
  DEFAULT_KEY_COUNT,
  DEFAULT_KEY_BYTES,
  MIN_CUSTOM_KEY_LENGTH,
};
