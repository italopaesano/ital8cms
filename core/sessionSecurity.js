// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * sessionSecurity.js
 *
 * Utilità RUNTIME per la sicurezza delle chiavi di sessione (le chiavi che
 * firmano i cookie koa-session, definite in
 * core/priorityMiddlewares/koaSession.json5).
 *
 * Le sessioni sono cookie FIRMATI (`signed: true`): il contenuto viaggia nel
 * browser e il server si fida di quel contenuto perché la firma torna. Chi
 * conosce le chiavi può quindi fabbricare un cookie con dentro quello che vuole
 * — `authenticated: true` e `roleIds: [0]` compresi — senza alcuna credenziale.
 *
 * Questo modulo è la FONTE UNICA per:
 *   - la classificazione a tre livelli            → classifySessionKeys(keys)
 *   - il predicato di (in)sicurezza               → keysAreInsecure(keys)
 *   - i box al boot (fatale / avviso)             → checkSessionKeys(ital8Conf)
 *   - la soglia di lunghezza minima               → MIN_SESSION_KEY_LENGTH
 *
 * NON dipende da inquirer né da scripts/: è importabile sia da index.js
 * (runtime) sia dal tooling d'installazione (scripts/lib/sessionKeyManager.js),
 * mantenendo la direzione di dipendenza corretta (tooling → core).
 *
 * ── Perché TRE livelli e non due ────────────────────────────────────────────
 * « Pubblica » e « debole » non sono lo stesso guasto, e non li sappiamo con la
 * stessa certezza:
 *
 *   fatal → la chiave è PUBBLICA. È un FATTO verificabile: quelle stringhe le
 *           abbiamo messe noi nel repository, quindi sappiamo quali sono.
 *           Chiunque può forgiare un cookie → il CMS non parte.
 *   weak  → la chiave è DEBOLE. È una STIMA: nessuno la conosce, ma è corta
 *           abbastanza da poter essere forzata. Il boot PROSEGUE con un avviso,
 *           perché rifiutare l'avvio sulla base di un'euristica che può
 *           sbagliare farebbe più danni del rischio che evita.
 *   ok    → niente da dire.
 *
 * Si può essere fatali su un fatto, non su un sospetto: è l'intera ragione per
 * cui la scala ha tre gradini invece di due.
 *
 * ── Perché l'elenco esatto NON è sostituibile dall'euristica ────────────────
 * Nessun criterio strutturale può rilevare « è nota a tutti »: la pubblicità non
 * è una proprietà della stringa, è un fatto storico esterno. Misurato sui quattro
 * placeholder che il progetto ha spedito in passato, col criterio « debole =
 * meno di MIN_SESSION_KEY_LENGTH caratteri »: tre su quattro passerebbero per
 * buone, e `key.secondaryKey123` resta indistinguibile da una chiave scelta a
 * mano (19 caratteri, quattro classi di caratteri) pur essendo stampata nella
 * storia di git. Per questo PLACEHOLDER_SESSION_KEYS vive nel livello `fatal`
 * accanto al prefisso, e non fra le deboli.
 *
 * Il modulo è PURO rispetto al processo: classifica, stampa il box, e RITORNA il
 * livello. Non chiama mai `process.exit()` — a uscire è il chiamante (index.js),
 * come fa `core/accessInvariantCheck.js` per il box [ACCESS]. Così la logica
 * resta testabile senza uccidere il worker di Jest.
 */

const path = require('path');
const loadJson5 = require('./loadJson5');

// Percorso del file di configurazione delle sessioni
const SESSION_CONFIG_PATH = path.join(__dirname, 'priorityMiddlewares', 'koaSession.json5');

/**
 * Prefisso dei placeholder CORRENTI, quelli spediti da
 * koaSession.default.json5. È un prefisso e non un valore esatto proprio perché
 * la parte dopo è irrilevante: qualunque chiave che cominci così è una chiave
 * che nessuno ha ancora scelto, quindi è pubblica per costruzione.
 *
 * Non esportato di proposito: all'esterno serve il VERDETTO
 * (classifySessionKeys), non il criterio con cui è stato prodotto.
 */
const PUBLIC_KEY_PREFIX = 'CHANGE_ME_';

/**
 * Lunghezza minima perché una chiave non sia considerata DEBOLE.
 *
 * Vive qui e non in scripts/ perché la soglia è la stessa per i due percorsi che
 * la usano — il gate al boot e la validazione delle chiavi inserite a mano nel
 * wizard — e due copie dello stesso numero sono due copie che possono divergere.
 * `scripts/lib/sessionKeyManager.js` la re-esporta come MIN_CUSTOM_KEY_LENGTH
 * per retrocompatibilità.
 */
const MIN_SESSION_KEY_LENGTH = 16;

/**
 * Denylist dei placeholder STORICI: valori che il progetto ha spedito in passato
 * (o mostrato nella documentazione) e che sono quindi leggibili da chiunque nella
 * storia di git. Per definizione questo elenco non cresce — i valori storici sono
 * storici — e non va confuso con PUBLIC_KEY_PREFIX, che copre quelli correnti.
 */
const PLACEHOLDER_SESSION_KEYS = Object.freeze([
  // Spediti in core/priorityMiddlewares/koaSession.json5 fino al 2026-06-12
  // (sostituiti dai CHANGE_ME_* in quella data, commit d2cd76e).
  'key.segretussimmmmmm',
  'fbtgnrnyrmnytmtymyt',
  'brtnrynynyny',
  // Valore di esempio storicamente mostrato nella documentazione (CLAUDE.md)
  'key.secondaryKey123',
]);

/**
 * Classifica un array di chiavi di sessione sui tre livelli.
 *
 * È una funzione PURA: nessun IO, nessun output, nessun effetto sul processo.
 *
 * @param {unknown} keys
 * @returns {{tier: 'fatal'|'weak'|'ok', reason: string|null, offending: string[]}}
 *   `tier`      il livello rilevato
 *   `reason`    perché, in forma azionabile:
 *                 'keys-invalid'       → non è un array, è vuoto, o contiene non-stringhe
 *                 'public-shipped'     → almeno una chiave ha il prefisso CHANGE_ME_
 *                 'public-historical'  → almeno una chiave è un placeholder storico
 *                 'too-short'          → almeno una chiave è sotto MIN_SESSION_KEY_LENGTH
 *   `offending` le chiavi che hanno determinato il verdetto (mai valori interi:
 *               per 'keys-invalid' resta vuoto, perché non c'è nulla da nominare
 *               e stampare una chiave malformata non aiuterebbe)
 */
function classifySessionKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { tier: 'fatal', reason: 'keys-invalid', offending: [] };
  }
  if (keys.some((key) => typeof key !== 'string' || key.length === 0)) {
    return { tier: 'fatal', reason: 'keys-invalid', offending: [] };
  }

  // Livello 1 — PUBBLICA. I due criteri sono entrambi fatti verificabili:
  // il prefisso copre i placeholder correnti, l'elenco quelli storici.
  const shipped = keys.filter((key) => key.startsWith(PUBLIC_KEY_PREFIX));
  if (shipped.length > 0) {
    return { tier: 'fatal', reason: 'public-shipped', offending: shipped };
  }
  const historical = keys.filter((key) => PLACEHOLDER_SESSION_KEYS.includes(key));
  if (historical.length > 0) {
    return { tier: 'fatal', reason: 'public-historical', offending: historical };
  }

  // Livello 2 — DEBOLE. Qui è una stima, quindi avvisa e lascia proseguire.
  const short = keys.filter((key) => key.length < MIN_SESSION_KEY_LENGTH);
  if (short.length > 0) {
    return { tier: 'weak', reason: 'too-short', offending: short };
  }

  return { tier: 'ok', reason: null, offending: [] };
}

/**
 * Determina se un array di chiavi di sessione è insicuro, a qualunque livello.
 * Conservata come predicato booleano per i chiamanti a cui basta il sì/no (il
 * wizard, che deve solo decidere la voce preselezionata).
 *
 * @param {unknown} keys
 * @returns {boolean} true se le chiavi NON sono a posto (fatal oppure weak)
 */
function keysAreInsecure(keys) {
  return classifySessionKeys(keys).tier !== 'ok';
}

/** Riga di cornice dei box, nello stile degli altri box del progetto. */
function boxRule() {
  return '[SESSION] ' + '═'.repeat(58);
}

/** Le due righe che indirizzano alla soluzione: identiche nei due box. */
function remedyLines() {
  return [
    '[SESSION]  Opzione A — esegui il wizard (genera chiavi casuali sicure):',
    '[SESSION]',
    '[SESSION]      npm run start-configure',
    '[SESSION]',
    '[SESSION]  Opzione B — modifica a mano core/priorityMiddlewares/koaSession.json5',
    '[SESSION]    sostituendo l\'array "keys" con stringhe casuali e segrete.',
  ];
}

/**
 * Box del livello FATALE: le chiavi sono pubbliche (o assenti/malformate), quindi
 * il CMS non deve servire il sito. Stessa filosofia del box [ACCESS]: dire cosa
 * non va, perché è grave, e come si sblocca.
 *
 * @param {{reason: string, offending: string[]}} verdict
 * @returns {string} il box, già formattato (non stampato)
 */
function formatFatalKeysBox(verdict) {
  const rule = boxRule();
  const lines = [
    '',
    rule,
    '[SESSION]  ⚠  CHIAVI DI SESSIONE PUBBLICHE — il CMS non parte',
    rule,
  ];

  if (verdict.reason === 'keys-invalid') {
    lines[2] = '[SESSION]  ⚠  CHIAVI DI SESSIONE ASSENTI O MALFORMATE — il CMS non parte';
    lines.push('[SESSION]    L\'array "keys" è vuoto, non è un array, oppure contiene');
    lines.push('[SESSION]    valori che non sono stringhe non vuote. Senza chiavi valide');
    lines.push('[SESSION]    koa-session non può firmare nulla.');
  } else if (verdict.reason === 'public-shipped') {
    lines.push('[SESSION]    Le chiavi che firmano i cookie di sessione sono ancora i');
    lines.push(`[SESSION]    segnaposti spediti col progetto (prefisso ${PUBLIC_KEY_PREFIX}):`);
    lines.push('[SESSION]    chiunque legga il repository le conosce, e con quelle può');
    lines.push('[SESSION]    forgiare un cookie valido da amministratore — senza password.');
  } else {
    lines.push('[SESSION]    Le chiavi che firmano i cookie di sessione sono fra quelle che');
    lines.push('[SESSION]    il progetto ha spedito in passato: restano leggibili nella');
    lines.push('[SESSION]    storia di git, quindi sono pubbliche quanto i segnaposti');
    lines.push('[SESSION]    correnti. Con quelle si forgia un cookie da amministratore.');
  }

  if (verdict.offending.length > 0) {
    lines.push('[SESSION]');
    lines.push(verdict.offending.length === 1
      ? '[SESSION]  Chiavi interessate: 1 fra quelle configurate.'
      : `[SESSION]  Chiavi interessate: ${verdict.offending.length} fra quelle configurate.`);
  }

  lines.push('[SESSION]');
  lines.push(...remedyLines());
  lines.push('[SESSION]');
  lines.push('[SESSION]  ▶ Il boot si ferma qui: un sito servito con chiavi pubbliche non è');
  lines.push('[SESSION]    protetto in alcun senso, e lasciarlo partire darebbe per sicuro');
  lines.push('[SESSION]    ciò che non lo è.');
  lines.push(rule);
  lines.push('');
  return lines.join('\n');
}

/**
 * Box del livello DEBOLE: nessuno conosce le chiavi, ma sono corte. Avviso
 * prominente e non bloccante — stessa filosofia di
 * httpsManager.warnMissingCertificates() e demoNotice.printDemoBootWarning().
 *
 * @param {{offending: string[]}} verdict
 * @returns {string} il box, già formattato (non stampato)
 */
function formatWeakKeysBox(verdict) {
  const rule = boxRule();
  const lines = [
    '',
    rule,
    '[SESSION]  ⚠  Chiavi di sessione DEBOLI (troppo corte)',
    rule,
    verdict.offending.length === 1
      ? `[SESSION]    1 chiave è sotto i ${MIN_SESSION_KEY_LENGTH} caratteri minimi.`
      : `[SESSION]    ${verdict.offending.length} chiavi sono sotto i ${MIN_SESSION_KEY_LENGTH} caratteri minimi.`,
    '[SESSION]    Non sono pubbliche — nessuno le conosce — ma sono abbastanza',
    '[SESSION]    corte da poter essere forzate provando: chi ci riesce può',
    '[SESSION]    forgiare cookie di sessione validi.',
    '[SESSION]',
    ...remedyLines(),
    '[SESSION]',
    '[SESSION]  ▶ Il server parte comunque (le sessioni funzionano).',
    rule,
    '',
  ];
  return lines.join('\n');
}

/**
 * Controlla le chiavi di sessione VIVE e stampa il box del livello rilevato.
 *
 * Salta del tutto se la sessione è disabilitata in configurazione (le chiavi non
 * verrebbero usate).
 *
 * NON termina il processo: ritorna il livello, e sta al chiamante decidere. Su
 * `'fatal'` index.js esce con 1; vedi la nota sulla purezza in testa al modulo.
 *
 * @param {object} ital8Conf - configurazione principale ital8cms
 * @param {object} [options]
 * @param {string} [options.configPath]    - override path koaSession.json5 (per test)
 * @param {object} [options.sessionConfig] - config già caricata (per test, evita l'IO)
 * @returns {'fatal'|'weak'|'ok'} il livello rilevato. `'ok'` anche quando la
 *   sessione è disabilitata o il config è illeggibile: in entrambi i casi non c'è
 *   una chiave da giudicare, e un file illeggibile è già segnalato da chi lo legge
 *   per davvero (il montaggio dei priority middleware, che fallirebbe comunque).
 */
function checkSessionKeys(ital8Conf, options = {}) {
  // Se la sessione è disabilitata, le chiavi non sono usate → niente da dire
  const sessionEnabled = !(
    ital8Conf &&
    ital8Conf.priorityMiddlewares &&
    ital8Conf.priorityMiddlewares.session === false
  );
  if (!sessionEnabled) return 'ok';

  let sessionConfig = options.sessionConfig;
  if (!sessionConfig) {
    const configPath = options.configPath || SESSION_CONFIG_PATH;
    try {
      sessionConfig = loadJson5(configPath);
    } catch (err) {
      console.warn(`[SESSION] ⚠  Impossibile leggere koaSession.json5: ${err.message}`);
      return 'ok';
    }
  }

  const verdict = classifySessionKeys(sessionConfig.keys);

  if (verdict.tier === 'fatal') {
    console.error(formatFatalKeysBox(verdict));
    return 'fatal';
  }
  if (verdict.tier === 'weak') {
    console.warn(formatWeakKeysBox(verdict));
    return 'weak';
  }
  return 'ok';
}

module.exports = {
  PLACEHOLDER_SESSION_KEYS,
  MIN_SESSION_KEY_LENGTH,
  classifySessionKeys,
  keysAreInsecure,
  checkSessionKeys,
  formatFatalKeysBox,
  formatWeakKeysBox,
  SESSION_CONFIG_PATH,
};
