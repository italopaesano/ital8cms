/**
 * ruleMatcher.js
 *
 * Valutazione delle condizioni di una regola contro una richiesta.
 *
 * ─── SEMANTICA: FIRST-MATCH-WINS ──────────────────────────────────────────────
 * Le regole si scorrono nell'ordine dell'array e la prima che matcha decide. Non
 * si usa la priorità automatica per specificità di adminAccessControl: per un
 * filtro la PREVEDIBILITA vale più dell'ergonomia, e "dall'alto verso il basso,
 * la prima che matcha" è la convenzione che chiunque conosce da iptables e nginx.
 * Le regole `allow` si mettono in cima e funzionano da whitelist.
 *
 * ─── SOGGETTO ─────────────────────────────────────────────────────────────────
 * Il matcher NON legge dal contesto Koa: riceve un "soggetto" già calcolato una
 * volta per richiesta (vedi buildSubject). Così il fingerprint, l'estensione e la
 * normalizzazione dell'IP si pagano una volta sola invece che una per regola.
 *
 * ─── REGOLE COMPILATE ─────────────────────────────────────────────────────────
 * Le regex arrivano qui già compilate da ruleValidator: nel percorso caldo non si
 * costruisce mai una RegExp. I pattern sui path passano invece da
 * core/patternMatcher.js, che ha una cache interna: va riusata UNA istanza.
 */

'use strict';

const { ipMatchesAny, normalizeIp } = require('./ipMatcher');
const { fpClassMatches, MAX_UA_LENGTH } = require('./requestFingerprint');

/**
 * ─── PERCHE SOLO L'UA E TRONCATO, E IL PERCORSO NO ────────────────────────────
 *
 * Le regex arrivano dall'amministratore e si applicano a stringhe che sceglie
 * chi bussa. Sembra ovvio troncarle tutte, e per un po' è sembrato ovvio anche
 * qui — il percorso e la querystring arrivano nelle stesse regex **interi**, e
 * misurato sull'istanza viva una querystring di **16.300 caratteri** viene
 * servita normalmente (a 16.500 è Node a rifiutare con 431): trentadue volte il
 * tetto applicato all'UA, sulla foglia che le regole di iniezione usano di più.
 *
 * Due misure hanno però ribaltato la conclusione.
 *
 * **1. Il troncamento non ferma la classe che fa danno.** Contro un pattern con
 * backtracking esponenziale — `/(a|a)*$/`, che il validatore oggi lascia
 * passare — bastano **30 caratteri per 29 secondi** di event loop bloccato. Un
 * tetto a 2048, o a 512, o a 64, è ugualmente irrilevante: quella famiglia la
 * ferma solo il rifiuto del pattern a monte, mai la lunghezza dell'input.
 *
 * **2. Il troncamento regalerebbe un'evasione universale.** Tagliare la coda
 * significa che chi imbottisce il percorso con 2048 caratteri di spazzatura e ci
 * appende `/config.php` non matcha più una regola `**\/config.php`. Vale per
 * qualunque tetto e qualunque foglia: la coda tagliata è la coda che non si
 * osserva. Si scambierebbe un rischio **condizionato** (l'amministratore ha
 * scritto un pattern catastrofico che è sopravvissuto alla validazione) con una
 * falla **incondizionata**, disponibile a chiunque contro ogni installazione.
 *
 * L'UA resta troncato perché è un caso diverso: 512 caratteri sono già il doppio
 * del più lungo UA legittimo che esista, la stessa stringa troncata alimenta
 * l'impronta (dove il tetto serve comunque), e non è la foglia dove si nascondono
 * i payload. Anche lì la coda tagliata è cieca — imbottire l'UA fino a 512 per
 * nascondere una firma funziona — ed è una scelta, non una svista.
 */

/**
 * Costruisce il soggetto da valutare, una volta per richiesta.
 *
 * @param {object} ctx - Contesto Koa
 * @param {object} deps
 * @param {object} deps.fingerprint   - { fp, fpClass } già calcolato
 * @param {string} deps.clientIp      - IP del client, già risolto (trustProxy applicato)
 * @param {string} deps.globalPrefix  - Prefisso globale da togliere dai path
 * @returns {object} soggetto
 */
function buildSubject(ctx, deps) {
  const { fingerprint, clientIp, globalPrefix } = deps;

  // I path nelle regole si scrivono SENZA globalPrefix — stessa convenzione di
  // maintenance.exemptPaths in runtimeGate.js. Se il confronto avvenisse sul path
  // completo, su un'istanza con globalPrefix valorizzato TUTTE le regole
  // smetterebbero di matchare in silenzio.
  let comparablePath = ctx.path;
  if (globalPrefix && comparablePath.startsWith(globalPrefix)) {
    comparablePath = comparablePath.slice(globalPrefix.length) || '/';
  }

  const lastSegment = comparablePath.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  const extension = dotIndex > 0 ? lastSegment.slice(dotIndex + 1).toLowerCase() : '';

  const rawUa = ctx.get ? (ctx.get('User-Agent') || '') : '';
  const session = ctx.session || null;

  return {
    // Percorso e querystring NON sono troncati, di proposito: vedi la nota in
    // testa al file. Tagliare la coda regalerebbe un'evasione a chiunque, e non
    // fermerebbe comunque la classe di pattern che fa danno.
    path: comparablePath,
    method: (ctx.method || '').toUpperCase(),
    extension,
    // L'UA sì: 512 caratteri sono il doppio del più lungo UA legittimo, e la
    // stessa stringa troncata alimenta l'impronta.
    userAgent: rawUa.length > MAX_UA_LENGTH ? rawUa.slice(0, MAX_UA_LENGTH) : rawUa,
    headers: ctx.headers || {},
    query: ctx.querystring || '',
    ip: normalizeIp(clientIp),
    authenticated: !!(session && session.authenticated),
    roleIds: (session && session.user && Array.isArray(session.user.roleIds)) ? session.user.roleIds : [],
    username: (session && session.user && session.user.username) || null,
    fp: fingerprint.fp,
    fpClass: fingerprint.fpClass,
    status: null,          // valorizzato solo nella valutazione post-risposta
    // Token esca trovato nella richiesta, cercato UNA volta da chi costruisce il
    // soggetto (il registro dei token non è affare del matcher). `null` = nessuno.
    canary: deps.canary || null,
    // Anomalie della sessione, calcolate una volta per richiesta da chi
    // costruisce il soggetto. Array vuoto anche sul traffico anonimo: una
    // regola su questa foglia non deve poter scattare dove sessione non c'è.
    sessionAnomalies: Array.isArray(deps.sessionAnomalies) ? deps.sessionAnomalies : [],
    // Giudizio sulla storia locale dell'impronta, calcolato una volta per
    // richiesta sulla voce di censimento PRECEDENTE a questa richiesta.
    reputation: deps.reputation || null,
    _queryDecoded: undefined, // memo di decodedQuery: una decodifica per richiesta
  };
}

// ── Foglie ───────────────────────────────────────────────────────────────────

function matchPath(subject, value, matcher) {
  const patterns = Array.isArray(value) ? value : [value];
  return patterns.some((p) => typeof p === 'string' && matcher.matches(subject.path, p));
}

function matchExtension(subject, compiledSet) {
  if (!subject.extension) return false;
  return compiledSet.has(subject.extension);
}

function matchMethod(subject, compiledSet) {
  return compiledSet.has(subject.method);
}

/**
 * `userAgent` accetta tre forme:
 *   "empty"          → nessun UA (nessun browser lo omette)
 *   RegExp compilata → test diretto
 *   Set di sottostringhe minuscole → contains
 */
function matchUserAgent(subject, compiled) {
  if (compiled === 'empty') return subject.userAgent === '';
  if (compiled instanceof RegExp) return compiled.test(subject.userAgent);
  if (compiled instanceof Set) {
    const ua = subject.userAgent.toLowerCase();
    for (const needle of compiled) {
      if (ua.includes(needle)) return true;
    }
  }
  return false;
}

function matchHeader(subject, spec) {
  const actual = subject.headers[spec.name];

  if (spec.present === false) return actual === undefined;
  if (spec.present === true) return actual !== undefined;

  if (actual === undefined) return false;
  const value = String(actual);
  if (spec.value instanceof RegExp) return spec.value.test(value);
  if (typeof spec.value === 'string') return value.toLowerCase() === spec.value.toLowerCase();
  return true;
}

/**
 * Il confronto avviene sulla querystring GREZZA e, se questa non matcha, sulla
 * sua forma DECODIFICATA.
 *
 * Serve perché nella querystring uno spazio arriva come `+` o `%20`: un pattern
 * scritto in modo naturale — `union\s+select` — non matcherebbe mai
 * `union+select`, che è esattamente la forma in cui i tentativi di SQL injection
 * si presentano. Chiedere a chi scrive le regole di prevedere ogni codifica
 * significherebbe garantire regole che sembrano giuste e non scattano mai.
 *
 * Provare entrambe le forme costa una decodifica per richiesta (solo quando una
 * regola guarda davvero la query) ed è sicuro: qui non si instrada nulla, si
 * osserva soltanto, quindi non esiste la classe di bug "decido sul decodificato,
 * agisco sul grezzo".
 */
function decodedQuery(subject) {
  if (subject._queryDecoded !== undefined) return subject._queryDecoded;
  let decoded = null;
  try {
    decoded = decodeURIComponent(subject.query.replace(/\+/g, ' '));
  } catch (_err) {
    // Percent-encoding malformato: è già di per sé un segnale, e la forma grezza
    // resta comunque confrontabile.
    decoded = null;
  }
  subject._queryDecoded = decoded === subject.query ? null : decoded;
  return subject._queryDecoded;
}

function matchQuery(subject, compiled) {
  if (!subject.query) return false;

  const decoded = decodedQuery(subject);

  if (compiled instanceof RegExp) {
    return compiled.test(subject.query) || (decoded !== null && compiled.test(decoded));
  }
  if (compiled instanceof Set) {
    const raw = subject.query.toLowerCase();
    const dec = decoded === null ? null : decoded.toLowerCase();
    for (const needle of compiled) {
      if (raw.includes(needle)) return true;
      if (dec !== null && dec.includes(needle)) return true;
    }
  }
  return false;
}

/**
 * La richiesta porta con sé un token esca?
 *
 * Il token viene cercato **una volta per richiesta** e memoizzato sul soggetto:
 * la scansione tocca percorso e querystring, e rifarla per ogni regola sarebbe
 * un costo pagato da tutto il traffico per una condizione che quasi nessuna
 * richiesta soddisfa.
 *
 * `subject.canary` è `null` (nessun token) oppure
 * `{ token, status: 'known'|'unknown', deliveredTo }`. Il valore atteso dalla
 * regola è `true` (qualunque token) o la stringa dello stato richiesto: sono due
 * gradi di certezza diversi e la regola sceglie quale le basta.
 */
function matchCanary(subject, expected) {
  if (!subject.canary) return false;
  if (expected === true || expected === 'any') return true;
  return subject.canary.status === expected;
}

/**
 * La sessione ha smesso di assomigliare a sé stessa?
 *
 * `subject.sessionAnomalies` è calcolato una volta per richiesta da chi
 * costruisce il soggetto, ed è un array vuoto sia quando non ci sono anomalie
 * sia quando la richiesta non è autenticata — così una regola su questa foglia
 * non può mai scattare sul traffico anonimo, che sessione non ne ha.
 *
 * `true` = una qualsiasi; un elenco = una qualsiasi fra quelle nominate.
 */
function matchSessionAnomaly(subject, expected) {
  const found = subject.sessionAnomalies;
  if (!Array.isArray(found) || found.length === 0) return false;
  if (expected === true) return true;
  return found.some((kind) => expected.has(kind));
}

/**
 * La storia locale di questa impronta dice qualcosa?
 *
 * `subject.reputation.levels` è calcolato una volta per richiesta da chi
 * costruisce il soggetto, a partire dalla voce di censimento **precedente** a
 * questa richiesta: altrimenti la richiesta in corso influenzerebbe il giudizio
 * su sé stessa.
 */
function matchReputation(subject, expected) {
  const found = subject.reputation && subject.reputation.levels;
  if (!Array.isArray(found) || found.length === 0) return false;
  if (expected === true) return true;
  return found.some((level) => expected.has(level));
}

function matchStatus(subject, compiledSet) {
  // Ha senso solo nella valutazione dell'esito: in `evaluate` lo status non
  // esiste ancora, e una regola che lo nomina non deve matchare per sbaglio.
  if (subject.status === null) return false;
  return compiledSet.has(subject.status);
}

// ── Nodo ─────────────────────────────────────────────────────────────────────

/**
 * Valuta un nodo del blocco `match`.
 *
 * Un nodo è un combinatore (`all` / `any` / `not`) oppure un insieme di foglie.
 * Più foglie nello stesso oggetto formano un AND implicito: è la forma più
 * frequente e scriverla senza cerimonie tiene le regole leggibili.
 *
 * @param {object} node    - nodo compilato
 * @param {object} subject
 * @param {object} matcher - istanza condivisa di PatternMatcher (cache regex)
 * @returns {boolean}
 */
function evaluateNode(node, subject, matcher) {
  if (!node || typeof node !== 'object') return false;

  if (Array.isArray(node.all)) {
    if (!node.all.every((child) => evaluateNode(child, subject, matcher))) return false;
  }
  if (Array.isArray(node.any)) {
    if (!node.any.some((child) => evaluateNode(child, subject, matcher))) return false;
  }
  if (node.not !== undefined) {
    if (evaluateNode(node.not, subject, matcher)) return false;
  }

  if (node.path !== undefined && !matchPath(subject, node.path, matcher)) return false;
  if (node.extension !== undefined && !matchExtension(subject, node.extension)) return false;
  if (node.method !== undefined && !matchMethod(subject, node.method)) return false;
  if (node.userAgent !== undefined && !matchUserAgent(subject, node.userAgent)) return false;
  if (node.header !== undefined && !matchHeader(subject, node.header)) return false;
  if (node.query !== undefined && !matchQuery(subject, node.query)) return false;
  if (node.ip !== undefined && !ipMatchesAny(subject.ip, node.ip)) return false;
  if (node.status !== undefined && !matchStatus(subject, node.status)) return false;
  if (node.canary !== undefined && !matchCanary(subject, node.canary)) return false;
  if (node.sessionAnomaly !== undefined && !matchSessionAnomaly(subject, node.sessionAnomaly)) return false;
  if (node.reputation !== undefined && !matchReputation(subject, node.reputation)) return false;

  if (node.authenticated !== undefined && subject.authenticated !== node.authenticated) return false;
  if (node.roleIds !== undefined && !node.roleIds.some((id) => subject.roleIds.includes(id))) return false;

  if (node.fingerprint !== undefined && !node.fingerprint.has(subject.fp)) return false;
  if (node.fingerprintClass !== undefined && !fpClassMatches(subject.fpClass, node.fingerprintClass)) return false;

  // Un nodo che non contiene alcuna condizione riconosciuta non deve matchare
  // tutto: il validatore lo scarta a monte, questo è il presidio di sicurezza.
  return hasAnyCondition(node);
}

const CONDITION_KEYS = [
  'all', 'any', 'not',
  'path', 'extension', 'method', 'userAgent', 'header', 'query', 'ip',
  'status', 'canary', 'sessionAnomaly', 'reputation',
  'authenticated', 'roleIds', 'fingerprint', 'fingerprintClass',
];

function hasAnyCondition(node) {
  return CONDITION_KEYS.some((key) => node[key] !== undefined);
}

/**
 * Verifica se una regola si applica al tipo di traffico corrente.
 * @param {object} rule
 * @param {object} subject
 * @returns {boolean}
 */
function appliesToSubject(rule, subject) {
  if (rule.appliesTo === 'anonymous') return !subject.authenticated;
  if (rule.appliesTo === 'authenticated') return subject.authenticated;
  return true; // "any" o assente
}

/**
 * Scorre le regole compilate e restituisce la prima che matcha.
 *
 * @param {Array<object>} rules   - regole compilate, nell'ordine di dichiarazione
 * @param {object} subject
 * @param {object} matcher        - istanza condivisa di PatternMatcher
 * @returns {object|null} la regola, o null
 */
function findFirstMatch(rules, subject, matcher) {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!appliesToSubject(rule, subject)) continue;
    if (evaluateNode(rule.match, subject, matcher)) return rule;
  }
  return null;
}

module.exports = {
  buildSubject,
  evaluateNode,
  findFirstMatch,
  appliesToSubject,
  hasAnyCondition,
  CONDITION_KEYS,
};
