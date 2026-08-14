/**
 * requestFingerprint.js
 *
 * Impronta passiva di una richiesta HTTP, ricavata dal MODO in cui il client
 * parla — non da quello che dichiara di essere.
 *
 * ─── L'IDEA ───────────────────────────────────────────────────────────────────
 * Ogni client HTTP lascia una firma involontaria: quali header manda, in che
 * ORDINE, quali omette, come li compila. Chrome, Firefox, curl e python-requests
 * producono quattro firme diverse, e nessuna delle quattro è configurabile senza
 * riscrivere il client.
 *
 * Questo rende la firma molto più difficile da falsificare dell'User-Agent:
 * cambiare l'UA in curl è un flag (`curl -A "...Chrome/120"`), ma sembrare Chrome
 * richiede di replicarne l'ordine esatto degli header, l'`Accept` letterale,
 * l'ordine di `Accept-Encoding`, i `Sec-CH-UA-*`, i `Sec-Fetch-*`... cioè di
 * emularlo, non di spacciarsi per lui.
 *
 * ─── LA REGOLA DI PROGETTO PIU IMPORTANTE ─────────────────────────────────────
 * L'User-Agent NON entra nel calcolo dell'impronta.
 *
 * È deliberato: se l'UA facesse parte della firma, le due cose varierebbero
 * insieme e non si potrebbero confrontare. Tenendole indipendenti si ottiene il
 * segnale che vale più di tutti gli altri messi insieme:
 *
 *     UA dichiara Chrome  +  firma da client script  →  uno dei due mente
 *
 * E sappiamo quale: l'UA, perché è l'unico dei due che si cambia gratis. Non
 * serve decidere se curl sia buono o cattivo (problema insolubile: curl legittimo
 * è ovunque); serve accorgersi che qualcuno sta *fingendo di non essere* curl,
 * che è un'informazione di natura completamente diversa.
 *
 * ─── COSA NON FA ──────────────────────────────────────────────────────────────
 * Solo raccolta PASSIVA: si osserva ciò che il client manda comunque per far
 * funzionare HTTP. Nessun codice eseguito sul dispositivo, nessun canvas, nessun
 * font enumerato. Oltre a essere la scelta giuridicamente più sobria, è anche
 * l'unica che funziona qui: gli scanner non eseguono JavaScript.
 *
 * L'impronta è a BASSA ENTROPIA: identifica una famiglia di client
 * ("Chrome 120 su Linux"), condivisa da milioni di persone. Non è un
 * identificatore individuale e non va usata come tale.
 */

'use strict';

const crypto = require('crypto');
const { detectBot } = require('../../../core/botDetector');

/**
 * Header che entrano nella firma per VALORE (non solo per presenza).
 * Scelti perché il loro contenuto esatto è caratteristico della libreria client
 * e raramente varia fra due richieste dello stesso client.
 */
const VALUE_HEADERS = ['accept', 'accept-encoding', 'connection'];

/**
 * Header la cui sola PRESENZA è discriminante: i client script quasi mai li
 * mandano, i browser quasi sempre.
 */
const BROWSER_SIGNAL_HEADERS = [
  'accept-language',
  'upgrade-insecure-requests',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-ch-ua',
];

/** Header volatili, esclusi dalla firma perché cambiano a ogni richiesta. */
const VOLATILE_HEADERS = new Set([
  'host', 'cookie', 'content-length', 'content-type', 'referer', 'referrer',
  'if-none-match', 'if-modified-since', 'range', 'authorization',
  'user-agent', // ← escluso per progetto: vedi l'intestazione del file
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto', 'x-forwarded-host',
  // Token CSRF: presente solo sulle richieste mutanti intercettate dal client
  // di `csrfProtection`, quindi la sua PRESENZA divide in due le richieste dello
  // stesso browser. È entropia pura in una firma che deve restare a bassa
  // entropia — e in una chiave di censimento, dove moltiplica le voci senza
  // aggiungere segnale. (Il nome dell'header è configurabile in csrfProtection,
  // ma il default è l'unico che si incontra: qui si copre quello.)
  'x-csrf-token',
]);

/**
 * Tetto alla lunghezza di una stringa prima di darla in pasto a una regex.
 * Un User-Agent di 8 KB contro una regex con backtracking sfavorevole blocca
 * l'event loop, cioè l'INTERO sito, con una singola richiesta. Node non offre
 * timeout sulle regex: il troncamento è la difesa praticabile.
 */
const MAX_UA_LENGTH = 512;

/** Famiglie di client riconoscibili dall'UA dichiarato. */
const CLIENT_FAMILY_SIGNATURES = [
  { pattern: /^curl\//i,             family: 'curl' },
  { pattern: /^wget\//i,             family: 'wget' },
  { pattern: /^python-requests\//i,  family: 'python' },
  { pattern: /^python-urllib/i,      family: 'python' },
  { pattern: /^Go-http-client\//i,   family: 'go' },
  { pattern: /^Java\//i,             family: 'java' },
  { pattern: /^Apache-HttpClient/i,  family: 'java' },
  { pattern: /^okhttp\//i,           family: 'okhttp' },
  { pattern: /^axios\//i,            family: 'node' },
  { pattern: /^node-fetch/i,         family: 'node' },
  { pattern: /libwww-perl/i,         family: 'perl' },
  { pattern: /^PostmanRuntime/i,     family: 'postman' },
];

const BROWSER_SIGNATURES = [
  // Ordine: i più specifici prima. Edge e Chrome dichiarano entrambi "Chrome".
  { pattern: /\bEdg(?:e|A|iOS)?\//i, browser: 'edge' },
  { pattern: /\bOPR\//i,             browser: 'opera' },
  { pattern: /\bFirefox\//i,         browser: 'firefox' },
  { pattern: /\bChrome\//i,          browser: 'chrome' },
  { pattern: /\bSafari\//i,          browser: 'safari' },
];

const OS_SIGNATURES = [
  { pattern: /Windows NT/i,            os: 'windows' },
  { pattern: /\bAndroid\b/i,           os: 'android' },   // prima di Linux: gli UA Android dicono anche "Linux"
  { pattern: /(iPhone|iPad|iPod)/i,    os: 'ios' },
  { pattern: /Mac OS X|Macintosh/i,    os: 'macos' },
  { pattern: /\bCrOS\b/i,              os: 'chromeos' },
  { pattern: /\bLinux\b|\bX11\b/i,     os: 'linux' },
  { pattern: /\bFreeBSD\b/i,           os: 'freebsd' },
];

function truncateUa(userAgent) {
  if (typeof userAgent !== 'string') return '';
  return userAgent.length > MAX_UA_LENGTH ? userAgent.slice(0, MAX_UA_LENGTH) : userAgent;
}

function matchFirst(signatures, value, key) {
  for (const sig of signatures) {
    if (sig.pattern.test(value)) return sig[key];
  }
  return null;
}

/**
 * Estrae i nomi degli header NELL'ORDINE DI ARRIVO.
 *
 * `ctx.req.rawHeaders` è un array piatto [nome, valore, nome, valore, ...] che
 * Node conserva nell'ordine originale, a differenza di `ctx.headers` che è un
 * oggetto (chiavi minuscole, ordine non garantito). L'ordine è metà del valore
 * della firma e si ottiene gratis: è il motivo per cui il fingerprint HTTP è
 * l'unico dei quattro livelli possibili (HTTP, TLS, TCP, JS) che qui conviene.
 *
 * @param {object} req - `ctx.req`
 * @returns {string[]} nomi in minuscolo, nell'ordine di arrivo
 */
function extractHeaderOrder(req) {
  const raw = req && req.rawHeaders;
  if (!Array.isArray(raw)) {
    // Ripiego: senza rawHeaders si perde l'ordine ma non l'insieme.
    return req && req.headers ? Object.keys(req.headers).sort() : [];
  }
  const names = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = String(raw[i]).toLowerCase();
    if (!VOLATILE_HEADERS.has(name)) names.push(name);
  }
  return names;
}

/**
 * Classifica la "forma" degli header, indipendentemente da cosa dichiara l'UA.
 *
 *   browser → manda i segnali che solo un browser manda
 *   partial → negozia contenuto ma senza i segnali da browser
 *   minimal → l'essenziale e nulla più: tipico dei client script
 *
 * @param {object} headers - `ctx.headers` (chiavi minuscole)
 * @returns {'browser'|'partial'|'minimal'}
 */
function classifyHeaderProfile(headers) {
  let browserSignals = 0;
  for (const name of BROWSER_SIGNAL_HEADERS) {
    if (headers[name] !== undefined) browserSignals++;
  }

  const accept = String(headers['accept'] || '');
  const acceptsHtml = accept.includes('text/html');

  if (browserSignals >= 3 || (acceptsHtml && browserSignals >= 2)) return 'browser';
  if (browserSignals >= 1 || (accept !== '' && accept !== '*/*')) return 'partial';
  return 'minimal';
}

/**
 * ─── PERCHE QUI NON C'E ALCUNA CACHE ──────────────────────────────────────────
 *
 * C'è stata, memoizzata sul socket: con keep-alive una pagina porta decine di
 * richieste sulla stessa connessione, e il ragionamento era «un client non
 * cambia libreria HTTP a metà connessione, quindi l'impronta è la stessa».
 *
 * La premessa è vera e la conclusione no, perché l'impronta non descrive il
 * client: descrive la FORMA DI UNA RICHIESTA. Lo stesso Chrome manda header
 * diversi per una navigazione, un foglio di stile e una `fetch` — `accept`
 * cambia, `sec-fetch-dest` cambia, `upgrade-insecure-requests` c'è solo nella
 * prima — e sono richieste con impronte legittimamente diverse sulla stessa
 * connessione. Misurato con Chromium su una pagina con un CSS, un'immagine, uno
 * script e una POST: **3 richieste su 7 ricevevano l'impronta di un'altra**, e
 * una sola connessione ne portava quattro distinte dichiarandone una.
 *
 * Il costo era peggiore di un dato sbagliato: la prima richiesta di una
 * connessione dettava `headerProfile` e `coherent` per tutte le successive.
 * Bastava una richiesta di riscaldamento con header da browser perché tutto il
 * resto della connessione — scansione con UA falso compresa — risultasse
 * `{ headerProfile: 'browser', coherent: true }`. `ua-fingerprint-mismatch` e
 * `auth-surface-noise` si aggiravano con una richiesta.
 *
 * Il ricalcolo integrale costa **~11 µs** su una richiesta che ne costa ~1000
 * end-to-end: lo 0,8%, sotto il rumore di misura. Una memoizzazione corretta
 * sarebbe possibile — la parte cara è quella derivata dall'User-Agent (~70%),
 * che si potrebbe memoizzare con l'UA STESSO come chiave, cioè verificando
 * invece di assumere — ma non si paga quella complessità per quel margine.
 *
 * La morale che vale oltre questo file: una cache per connessione di una
 * proprietà per richiesta non è un'ottimizzazione aggressiva, è un errore di
 * categoria. Se un giorno se ne rivuole una, la chiave deve contenere tutto ciò
 * da cui il valore dipende.
 */

/**
 * Costruisce l'impronta di una richiesta.
 *
 * @param {object} ctx - Contesto Koa
 * @param {object} [options]
 * @param {string} [options.salt] - Se valorizzato, l'hash diventa locale
 *   all'installazione e non confrontabile con quello di altri siti. Se vuoto
 *   (default) le firme sono deterministiche e quindi condivisibili — utile per
 *   set di regole comuni, legittimo perché la firma è a bassa entropia.
 * @returns {{ fp: string, fpClass: object }}
 */
function buildFingerprint(ctx, options = {}) {
  const salt = typeof options.salt === 'string' ? options.salt : '';
  const headers = (ctx && ctx.headers) || {};
  const req = (ctx && ctx.req) || {};

  const headerOrder = extractHeaderOrder(req);
  const httpVersion = req.httpVersion || '1.1';

  // ── Stringa di firma ──
  // Composta SENZA User-Agent, per poterla confrontare con quello che l'UA dichiara.
  const parts = [
    `v:${httpVersion}`,
    `h:${headerOrder.join(',')}`,
  ];
  for (const name of VALUE_HEADERS) {
    parts.push(`${name}:${headers[name] === undefined ? '' : String(headers[name]).toLowerCase()}`);
  }
  for (const name of BROWSER_SIGNAL_HEADERS) {
    parts.push(`${name}?${headers[name] === undefined ? '0' : '1'}`);
  }

  const signature = parts.join('|');
  const fp = crypto.createHash('sha256')
    .update(salt + signature)
    .digest('hex')
    .slice(0, 16);

  // ── Decomposizione strutturata ──
  // È l'equivalente utile del concetto di "intervallo di impronte": gli hash non
  // hanno intervalli, ma le CLASSI sì. Una regola su `fpClass` copre migliaia di
  // client mai visti prima, senza conoscerne gli hash: descrive un comportamento
  // invece di inseguire valori.
  const ua = truncateUa(ctx && ctx.get ? ctx.get('User-Agent') : headers['user-agent']);
  const declaredFamily = ua ? matchFirst(CLIENT_FAMILY_SIGNATURES, ua, 'family') : null;
  const claimedBrowser = ua ? matchFirst(BROWSER_SIGNATURES, ua, 'browser') : null;
  const claimedOs = ua ? matchFirst(OS_SIGNATURES, ua, 'os') : null;
  const headerProfile = classifyHeaderProfile(headers);
  const { isBot, botName } = detectBot(ua);

  // Famiglia effettiva: l'UA quando è onesto (un client script non ha motivo di
  // dichiararsi tale se vuole nascondersi), altrimenti la forma degli header.
  let family = declaredFamily;
  if (!family) {
    family = headerProfile === 'browser' ? 'browser-like'
      : headerProfile === 'minimal' ? 'script-like'
        : 'unknown';
  }

  // ── Coerenza ──
  // Incoerente = l'UA dichiara un browser ma la forma degli header è quella di
  // un client script. Conservativo di proposito: `partial` NON è considerato una
  // menzogna, perché browser vecchi, proxy che riscrivono e client legittimi
  // atipici finiscono lì. Si segnala solo il caso netto.
  const coherent = !(claimedBrowser !== null && headerProfile === 'minimal');

  return {
    fp,
    fpClass: {
      family,
      claimedBrowser,
      claimedOs,
      headerProfile,
      coherent,
      isBot,
      botName,
    },
  };
}

/**
 * Verifica se una fpClass soddisfa un criterio parziale.
 * Tutte le chiavi indicate nel criterio devono corrispondere; quelle assenti
 * non vengono considerate. Permette regole del tipo
 * `{ coherent: false }` oppure `{ family: "curl", claimedOs: "windows" }`.
 *
 * @param {object} fpClass
 * @param {object} criteria
 * @returns {boolean}
 */
function fpClassMatches(fpClass, criteria) {
  if (!fpClass || !criteria || typeof criteria !== 'object') return false;
  for (const [key, expected] of Object.entries(criteria)) {
    if (fpClass[key] !== expected) return false;
  }
  return true;
}

module.exports = {
  buildFingerprint,
  fpClassMatches,
  classifyHeaderProfile,
  extractHeaderOrder,
  MAX_UA_LENGTH,
};
