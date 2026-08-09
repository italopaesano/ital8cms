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
    path: comparablePath,
    method: (ctx.method || '').toUpperCase(),
    extension,
    // Troncato: è la stringa che finisce nelle regex, e un UA smisurato contro un
    // pattern sfavorevole bloccherebbe l'event loop dell'intero sito.
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
  'status', 'canary', 'authenticated', 'roleIds', 'fingerprint', 'fingerprintClass',
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
