// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * sessionKeyManager.js
 *
 * Tooling d'INSTALLAZIONE per le chiavi di sessione (firma dei cookie koa-session).
 * Genera chiavi casuali sicure e gestisce lo step interattivo del wizard
 * (scripts/init.js, FASE 1), che permette di:
 *   - generare nuove chiavi casuali (default consigliato se le attuali non sono a posto)
 *   - generare aggiungendo un contributo di entropia digitato dall'operatore
 *   - inserire chiavi esplicite (multi-istanza, o chiavi da un gestore di segreti)
 *   - mantenere le chiavi correnti — offerta SOLO se non sono pubbliche
 *
 * La classificazione a tre livelli, la denylist dei placeholder e la soglia di
 * lunghezza minima vivono in core/sessionSecurity.js (fonte unica, condivisa con
 * il gate al boot).
 *
 * Scrittura: backup via BackupManager + editJson5 (sostituisce solo il campo
 * "keys" preservando tutti i commenti del file). I valori delle chiavi NON
 * vengono mai stampati a console né scritti nel log (sono segreti).
 */

const crypto = require('crypto');
const loadJson5 = require('../../core/loadJson5');
const editJson5 = require('../../core/editJson5');
const {
  classifySessionKeys,
  MIN_SESSION_KEY_LENGTH,
} = require('../../core/sessionSecurity');

// Numero di chiavi generate di default (primary + chiavi di verifica per la rotazione koa-session)
const DEFAULT_KEY_COUNT = 3;
// Byte di entropia per chiave (32 byte = 256 bit)
const DEFAULT_KEY_BYTES = 32;
/**
 * Lunghezza minima accettata per chiavi inserite a mano.
 *
 * Alias storico di core/sessionSecurity.MIN_SESSION_KEY_LENGTH: la soglia è ora
 * una sola per il gate al boot e per questa validazione, perché due copie dello
 * stesso numero sono due copie che possono divergere — ed è esattamente la forma
 * del difetto A2, dove una denylist e il file che doveva descrivere hanno
 * divergito senza che nulla lo intercettasse.
 */
const MIN_CUSTOM_KEY_LENGTH = MIN_SESSION_KEY_LENGTH;

/**
 * Genera un array di chiavi di sessione casuali e crittograficamente sicure.
 * Ogni chiave è codificata base64url (URL-safe: solo [A-Za-z0-9_-], nessun
 * carattere problematico nei file JSON5).
 *
 * ── Il contributo di entropia (`entropyContribution`) ───────────────────────
 * Quando l'operatore fornisce del testo, ogni chiave diventa
 * `SHA-256(randomBytes(bytes) || entropyContribution)` invece del solo
 * `randomBytes(bytes)`.
 *
 * Va detto con precisione cosa aggiunge e cosa non aggiunge. Quando il
 * generatore del sistema operativo funziona, NON aggiunge entropia misurabile:
 * `randomBytes(32)` sono già 256 bit, che è il tetto, e farci passare altro
 * materiale attraverso un hash lascia il risultato a 256 bit. Il motivo per cui
 * esiste è un altro, ed è concreto: un generatore casuale **rotto o
 * prevedibile**. È già accaduto su scala reale (il bug OpenSSL di Debian del
 * 2008 rese enumerabili le chiavi di migliaia di installazioni), e una macchina
 * virtuale o un sistema embedded al primo avvio può avere un pool quasi vuoto.
 * In quello scenario il testo digitato è l'unica cosa che distingue questa
 * installazione da tutte le altre.
 *
 * La proprietà che la costruzione DEVE avere è « mai peggio di randomBytes da
 * solo », e l'ordine degli argomenti è ciò che la garantisce: il materiale
 * casuale entra per primo e per intero, quindi un contributo vuoto o banale non
 * degrada nulla. La forma da NON scrivere è `SHA-256(entropyContribution)`:
 * derivare invece di mescolare restringerebbe lo spazio delle chiavi
 * all'entropia del testo digitato — una frase umana vale fra i 20 e i 60 bit —
 * ed è la versione catastrofica di questa stessa idea.
 *
 * Il contributo NON viene conservato da nessuna parte e la generazione NON è
 * riproducibile: per questo non si chiama « seme ». Un seme, per convenzione,
 * ricostruisce il suo output — e un operatore che lo credesse lo custodirebbe
 * come backup delle chiavi, creando un segreto di pari valore tenuto in un posto
 * meno protetto.
 *
 * Ogni chiave riceve materiale casuale FRESCO, quindi le chiavi restano
 * indipendenti fra loro anche a parità di contributo.
 *
 * @param {number} [count=DEFAULT_KEY_COUNT]  Numero di chiavi da generare
 * @param {number} [bytes=DEFAULT_KEY_BYTES]  Byte di entropia per chiave
 * @param {string} [entropyContribution='']  Testo da mescolare, non conservato
 * @returns {string[]} Array di chiavi uniche
 */
function generateSessionKeys(count = DEFAULT_KEY_COUNT, bytes = DEFAULT_KEY_BYTES, entropyContribution = '') {
  const contribution = typeof entropyContribution === 'string' ? entropyContribution : '';
  const keys = [];
  while (keys.length < count) {
    const random = crypto.randomBytes(bytes);
    const key = contribution.length === 0
      ? random.toString('base64url')
      : crypto.createHash('sha256').update(random).update(contribution, 'utf8').digest('base64url');
    if (!keys.includes(key)) keys.push(key); // garantisce unicità (collisione praticamente impossibile)
  }
  return keys;
}

/**
 * Step interattivo del wizard per la gestione delle chiavi di sessione.
 * Esegue backup + scrittura atomica (preservando i commenti) solo se l'utente
 * sceglie di generare o inserire nuove chiavi.
 *
 * Il default del menu è ADATTIVO: "Genera" se le chiavi correnti non sono a
 * posto, "Mantieni" se lo sono (evita di invalidare le sessioni esistenti
 * durante una re-inizializzazione — compresa quella dell'amministratore che sta
 * eseguendo il wizard).
 *
 * "Mantieni" NON viene offerta quando le chiavi correnti sono PUBBLICHE: in quel
 * caso mantenerle è l'unica scelta che il gate al boot rifiuterebbe comunque, e
 * una voce di menu che produce un'installazione che non parte è una voce da non
 * mostrare. Quando invece le chiavi sono soltanto DEBOLI la voce resta, perché
 * il livello debole è una stima e la decisione spetta a chi installa.
 *
 * @param {object} context
 * @param {object} context.logger        - InitLogger
 * @param {object} context.backupManager - BackupManager
 * @param {string} context.configPath    - path assoluto a koaSession.json5
 * @returns {Promise<{action: 'generate'|'generate-with-entropy'|'custom'|'keep'|'skip', changed: boolean}>}
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

  const verdict = classifySessionKeys(currentKeys);
  const insecure = verdict.tier !== 'ok';

  if (verdict.tier === 'fatal') {
    console.log('⚠️  Le chiavi attuali sono PUBBLICHE: chiunque legga il repository le');
    console.log('   conosce, e con quelle può forgiare un cookie da amministratore.');
    console.log('   Con queste chiavi il CMS NON parte: vanno sostituite adesso.\n');
  } else if (verdict.tier === 'weak') {
    console.log(`⚠️  Le chiavi attuali sono DEBOLI (sotto i ${MIN_SESSION_KEY_LENGTH} caratteri minimi).`);
    console.log('   Nessuno le conosce, ma sono abbastanza corte da poter essere forzate.\n');
  } else {
    console.log('✓ Le chiavi attuali risultano già personalizzate.\n');
  }

  // "Mantieni" solo se il gate al boot le accetterebbe (vedi la nota sopra).
  const choices = [
    { name: 'Genera nuove chiavi casuali sicure (consigliato)', value: 'generate' },
    { name: 'Genera aggiungendo un contributo di entropia digitato da te', value: 'generate-with-entropy' },
    { name: 'Inserisci chiavi esplicite (multi-istanza, o da un gestore di segreti)', value: 'custom' },
  ];
  if (verdict.tier !== 'fatal') {
    choices.push({ name: 'Mantieni le chiavi correnti', value: 'keep' });
  }

  const { action } = await inquirer.prompt([
    {
      type: 'select',
      name: 'action',
      message: 'Come vuoi gestire le chiavi di sessione?',
      choices,
      default: insecure ? 'generate' : 'keep',
    },
  ]);

  if (action === 'keep') {
    // Il messaggio segue il LIVELLO, non il solo sì/no. Il ramo `fatal` non è
    // raggiungibile dal menu — la voce non viene offerta — ma resta presidiato:
    // un chiamante programmatico potrebbe forzare l'azione, e dire « deboli » di
    // chiavi pubbliche sarebbe la stessa classe di difetto di A2, un messaggio
    // che rassicura su ciò che non ha verificato.
    if (verdict.tier === 'fatal') {
      logger.warning('Chiavi PUBBLICHE mantenute: con queste il CMS non parte.');
    } else if (verdict.tier === 'weak') {
      logger.warning('Chiavi deboli mantenute: sotto la lunghezza minima raccomandata.');
    } else {
      logger.info('Chiavi di sessione mantenute invariate.');
    }
    return { action, changed: false };
  }

  let newKeys;
  if (action === 'generate') {
    newKeys = generateSessionKeys();
  } else if (action === 'generate-with-entropy') {
    // Il contributo è mescolato al materiale casuale, non lo sostituisce: vedi la
    // nota su generateSessionKeys. Non viene conservato né ristampato, e non è
    // richiesto che sia segreto — l'input non è mascherato di proposito, perché
    // mascherarlo suggerirebbe che valga la pena custodirlo.
    const { contribution } = await inquirer.prompt([
      {
        type: 'input',
        name: 'contribution',
        message: 'Digita del testo libero da mescolare (non viene salvato, non è riproducibile):',
        validate: (value) => (String(value).trim().length > 0 ? true : 'Inserisci almeno un carattere'),
      },
    ]);
    newKeys = generateSessionKeys(DEFAULT_KEY_COUNT, DEFAULT_KEY_BYTES, String(contribution));
  } else {
    // Inserimento manuale: input separato da virgola, validato sulla stringa grezza
    // (evita le insidie dell'ordine filter/validate di inquirer).
    const { customRaw } = await inquirer.prompt([
      {
        type: 'input',
        name: 'customRaw',
        message: `Inserisci le chiavi separate da virgola (min ${MIN_CUSTOM_KEY_LENGTH} caratteri ciascuna):`,
        // Validazione DELEGATA a classifySessionKeys: è lo stesso giudizio che
        // darà il gate al boot, quindi è impossibile che il wizard accetti
        // chiavi che l'avvio poi rifiuta. Prima questa logica era riscritta qui
        // — ed era rimasta scoperta sul prefisso CHANGE_ME_, che quindi passava
        // la validazione pur essendo la stringa pubblica per eccellenza.
        validate: (value) => {
          const keys = String(value).split(',').map((k) => k.trim()).filter(Boolean);
          if (keys.length === 0) return 'Inserisci almeno una chiave';
          const check = classifySessionKeys(keys);
          if (check.tier === 'ok') return true;
          const nominate = check.offending.length > 0 ? `: ${check.offending.join(', ')}` : '';
          switch (check.reason) {
            case 'public-shipped':
              return `Chiave pubblica — è un segnaposto spedito col progetto${nominate}`;
            case 'public-historical':
              return `Chiave pubblica — è un segnaposto storico, leggibile nella storia di git${nominate}`;
            case 'too-short':
              return `Ogni chiave deve avere almeno ${MIN_SESSION_KEY_LENGTH} caratteri (troppo corta${nominate})`;
            default:
              return 'Chiavi non valide: servono stringhe non vuote';
          }
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
