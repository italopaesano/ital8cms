/**
 * ruleValidator.js
 *
 * Validazione e COMPILAZIONE delle regole di sentinelRules.json5.
 *
 * Due lavori in un passaggio solo, perché sono lo stesso lavoro: per sapere se
 * una regex è valida bisogna compilarla, e una volta compilata tanto vale
 * conservarla. Nel percorso caldo non si costruisce mai una RegExp.
 *
 * ─── FAIL-OPEN, PER SCELTA ────────────────────────────────────────────────────
 * Una regola invalida viene SCARTATA e le altre restano in vigore; un file
 * illeggibile lascia il filtro senza regole ma il sito raggiungibile. La domanda
 * "cosa fa il filtro se il file di regole è malformato" ha due risposte possibili
 * e una sola sensata: fail-closed trasformerebbe una virgola fuori posto in un
 * blackout totale, mentre la probabilità di scrivere una regola sbagliata è cento
 * volte quella di subire un attacco nei dieci minuti in cui la si corregge.
 * Chi preferisce il rigore ha `strictValidation: true` — stessa convenzione di
 * rateLimiter, urlRedirect e csrfProtection.
 *
 * ─── IL GUARDRAIL CHE CONTA: ReDoS ────────────────────────────────────────────
 * Le regex arrivano dall'utente e vengono applicate a stringhe controllate
 * dall'attaccante. Un pattern con backtracking catastrofico — la forma classica è
 * un quantificatore dentro un quantificatore, `(a+)+` — contro un input costruito
 * ad arte blocca l'event loop, cioè l'INTERO sito, con una singola richiesta.
 * Node non offre timeout sulle regex. Le tre difese, tutte necessarie:
 *   1. rifiuto dei pattern con quantificatori annidati (qui);
 *   2. troncamento degli input prima del test (requestFingerprint / ruleMatcher);
 *   3. tetto di tempo sulla valutazione complessiva (sentinelGate).
 */

'use strict';

const { isValidCidr } = require('./ipMatcher');
const { ANOMALY_KINDS } = require('./sessionCoherence');

const VALID_ACTIONS = [
  'allow', 'monitor', 'block', 'drop', 'decoy', 'redirect', 'throttle', 'tarpit',
];

// Azioni la cui risposta è prodotta dal plugin e non dal 404 comune del core.
// Su un percorso della superficie riservata chiusa il gate le degrada a 404.
const DECORATING_ACTIONS = ['decoy', 'redirect', 'tarpit'];

const VALID_APPLIES_TO = ['anonymous', 'authenticated', 'any'];

// Valori ammessi dalla foglia `canary` (oltre a `true`, che vale "qualunque").
const VALID_CANARY_STATES = ['any', 'known', 'unknown'];

// Stati ammessi per un redirect. 301 e 308 sono permanenti e restano in cache
// nel browser: verso l'esterno sono vietati più sotto, perché un falso positivo
// dirotterebbe un utente reale per mesi e non si ripara riavviando.
const VALID_REDIRECT_STATUSES = [301, 302, 303, 307, 308];

const VALID_FP_CLASS_KEYS = [
  'family', 'claimedBrowser', 'claimedOs', 'headerProfile', 'coherent', 'isBot', 'botName',
];

/**
 * Riconosce i pattern a rischio backtracking catastrofico.
 *
 * Euristica deliberatamente GROSSOLANA: cerca un quantificatore applicato a un
 * gruppo che a sua volta contiene un quantificatore. Non riconosce ogni forma
 * patologica (il problema in generale è indecidibile) e rifiuta qualche pattern
 * innocuo, ma copre la famiglia che compare davvero nelle regole scritte a mano.
 * Un falso rifiuto costa una riscrittura; un falso permesso costa il sito.
 *
 * @param {string} source
 * @returns {boolean} true se sospetto
 */
function hasNestedQuantifier(source) {
  // (...)+ / (...)* / (...){n,} dove il gruppo contiene già + * {n,}
  return /\((?:[^()]*[+*}][^()]*)\)\s*[+*]|\((?:[^()]*[+*}][^()]*)\)\s*\{\d+,/.test(source);
}

/**
 * Compila una stringa "regex:..." in RegExp, con i controlli di sicurezza.
 *
 * @param {string} raw
 * @param {string} where - etichetta per il messaggio d'errore
 * @param {string[]} errors
 * @returns {RegExp|null}
 */
function compileRegex(raw, where, errors) {
  const source = raw.slice('regex:'.length);
  if (hasNestedQuantifier(source)) {
    errors.push(`${where}: regex con quantificatori annidati, rifiutata per rischio ReDoS (${source})`);
    return null;
  }
  try {
    return new RegExp(source, 'i');
  } catch (err) {
    errors.push(`${where}: regex non compilabile (${source}): ${err.message}`);
    return null;
  }
}

/**
 * Compila un valore che accetta sia "regex:..." sia una lista di sottostringhe.
 * @returns {RegExp|Set<string>|'empty'|null}
 */
function compileStringMatcher(value, where, errors) {
  if (value === 'empty') return 'empty';

  if (typeof value === 'string') {
    if (value.startsWith('regex:')) return compileRegex(value, where, errors);
    return new Set([value.toLowerCase()]);
  }

  if (Array.isArray(value)) {
    const plain = [];
    for (const entry of value) {
      if (typeof entry !== 'string') {
        errors.push(`${where}: voce non stringa nella lista`);
        return null;
      }
      if (entry.startsWith('regex:')) {
        errors.push(`${where}: "regex:" non è ammesso dentro una lista, usalo come valore singolo`);
        return null;
      }
      plain.push(entry.toLowerCase());
    }
    if (plain.length === 0) {
      errors.push(`${where}: lista vuota`);
      return null;
    }
    return new Set(plain);
  }

  errors.push(`${where}: valore non valido (attesa stringa, "empty" o array)`);
  return null;
}

/**
 * Compila ricorsivamente un nodo del blocco `match`.
 *
 * @returns {object|null} nodo compilato, o null se invalido
 */
function compileMatchNode(node, where, errors) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${where}: nodo match non valido`);
    return null;
  }

  const out = {};
  let conditionCount = 0;

  // ── Combinatori ──
  for (const combinator of ['all', 'any']) {
    if (node[combinator] !== undefined) {
      if (!Array.isArray(node[combinator]) || node[combinator].length === 0) {
        errors.push(`${where}.${combinator}: atteso un array non vuoto`);
        return null;
      }
      const children = [];
      for (let i = 0; i < node[combinator].length; i++) {
        const child = compileMatchNode(node[combinator][i], `${where}.${combinator}[${i}]`, errors);
        if (!child) return null;
        children.push(child);
      }
      out[combinator] = children;
      conditionCount++;
    }
  }

  if (node.not !== undefined) {
    const child = compileMatchNode(node.not, `${where}.not`, errors);
    if (!child) return null;
    out.not = child;
    conditionCount++;
  }

  // ── Foglie ──
  if (node.path !== undefined) {
    const patterns = Array.isArray(node.path) ? node.path : [node.path];
    for (const p of patterns) {
      if (typeof p !== 'string' || p === '') {
        errors.push(`${where}.path: pattern non valido`);
        return null;
      }
      if (p.startsWith('regex:') && hasNestedQuantifier(p.slice(6))) {
        errors.push(`${where}.path: regex con quantificatori annidati, rifiutata per rischio ReDoS`);
        return null;
      }
      if (!p.startsWith('regex:') && !p.startsWith('/')) {
        errors.push(`${where}.path: i path si scrivono a partire da "/" e SENZA globalPrefix (ricevuto: ${p})`);
        return null;
      }
    }
    out.path = patterns;
    conditionCount++;
  }

  if (node.extension !== undefined) {
    const list = Array.isArray(node.extension) ? node.extension : [node.extension];
    const set = new Set();
    for (const ext of list) {
      if (typeof ext !== 'string' || ext === '') {
        errors.push(`${where}.extension: voce non valida`);
        return null;
      }
      // Si accetta sia "php" sia ".php": la seconda forma è un errore frequente
      // e correggerla in silenzio è meglio che scartare la regola.
      set.add(ext.replace(/^\./, '').toLowerCase());
    }
    out.extension = set;
    conditionCount++;
  }

  if (node.method !== undefined) {
    const list = Array.isArray(node.method) ? node.method : [node.method];
    const set = new Set();
    for (const m of list) {
      if (typeof m !== 'string' || m === '') {
        errors.push(`${where}.method: voce non valida`);
        return null;
      }
      set.add(m.toUpperCase());
    }
    out.method = set;
    conditionCount++;
  }

  if (node.userAgent !== undefined) {
    const compiled = compileStringMatcher(node.userAgent, `${where}.userAgent`, errors);
    if (!compiled) return null;
    out.userAgent = compiled;
    conditionCount++;
  }

  if (node.query !== undefined) {
    const compiled = compileStringMatcher(node.query, `${where}.query`, errors);
    if (!compiled || compiled === 'empty') {
      if (compiled === 'empty') errors.push(`${where}.query: "empty" non è supportato qui`);
      return null;
    }
    out.query = compiled;
    conditionCount++;
  }

  if (node.header !== undefined) {
    const spec = node.header;
    if (!spec || typeof spec !== 'object' || typeof spec.name !== 'string' || spec.name === '') {
      errors.push(`${where}.header: atteso { name, present } oppure { name, value }`);
      return null;
    }
    const compiled = { name: spec.name.toLowerCase() };
    if (spec.present !== undefined) {
      if (typeof spec.present !== 'boolean') {
        errors.push(`${where}.header.present: atteso boolean`);
        return null;
      }
      compiled.present = spec.present;
    } else if (spec.value !== undefined) {
      if (typeof spec.value !== 'string') {
        errors.push(`${where}.header.value: attesa stringa`);
        return null;
      }
      if (spec.value.startsWith('regex:')) {
        const re = compileRegex(spec.value, `${where}.header.value`, errors);
        if (!re) return null;
        compiled.value = re;
      } else {
        compiled.value = spec.value;
      }
    } else {
      errors.push(`${where}.header: serve "present" oppure "value"`);
      return null;
    }
    out.header = compiled;
    conditionCount++;
  }

  if (node.ip !== undefined) {
    const list = Array.isArray(node.ip) ? node.ip : [node.ip];
    for (const cidr of list) {
      if (typeof cidr !== 'string' || !isValidCidr(cidr)) {
        errors.push(`${where}.ip: notazione CIDR non valida (${cidr})`);
        return null;
      }
    }
    out.ip = list;
    conditionCount++;
  }

  if (node.status !== undefined) {
    const list = Array.isArray(node.status) ? node.status : [node.status];
    const set = new Set();
    for (const s of list) {
      if (!Number.isInteger(s) || s < 100 || s > 599) {
        errors.push(`${where}.status: codice HTTP non valido (${s})`);
        return null;
      }
      set.add(s);
    }
    out.status = set;
    conditionCount++;
  }

  if (node.canary !== undefined) {
    // `true` sta per "qualunque token". Gli stati sono due gradi di certezza:
    // `known` è un token che abbiamo coniato noi e di cui sappiamo il
    // destinatario; `unknown` ha la forma giusta ma non è (più) in registro —
    // riavvio, scadenza, o un worker diverso in cluster.
    if (node.canary !== true && !VALID_CANARY_STATES.includes(node.canary)) {
      errors.push(
        `${where}.canary: atteso true oppure uno fra ${VALID_CANARY_STATES.join(', ')}`
      );
      return null;
    }
    out.canary = node.canary;
    conditionCount++;
  }

  if (node.sessionAnomaly !== undefined) {
    if (node.sessionAnomaly === true) {
      out.sessionAnomaly = true;
    } else {
      const list = Array.isArray(node.sessionAnomaly) ? node.sessionAnomaly : [node.sessionAnomaly];
      const unknown = list.filter((kind) => !ANOMALY_KINDS.includes(kind));
      if (list.length === 0 || unknown.length > 0) {
        errors.push(
          `${where}.sessionAnomaly: atteso true oppure uno o più fra ${ANOMALY_KINDS.join(', ')}` +
          (unknown.length ? ` (sconosciute: ${unknown.join(', ')})` : '')
        );
        return null;
      }
      out.sessionAnomaly = new Set(list);
    }
    conditionCount++;
  }

  if (node.authenticated !== undefined) {
    if (typeof node.authenticated !== 'boolean') {
      errors.push(`${where}.authenticated: atteso boolean`);
      return null;
    }
    out.authenticated = node.authenticated;
    conditionCount++;
  }

  if (node.roleIds !== undefined) {
    if (!Array.isArray(node.roleIds) || node.roleIds.some((id) => !Number.isInteger(id))) {
      errors.push(`${where}.roleIds: atteso un array di interi`);
      return null;
    }
    out.roleIds = node.roleIds;
    conditionCount++;
  }

  if (node.fingerprint !== undefined) {
    const list = Array.isArray(node.fingerprint) ? node.fingerprint : [node.fingerprint];
    if (list.some((fp) => typeof fp !== 'string' || fp === '')) {
      errors.push(`${where}.fingerprint: atteso un hash o un array di hash`);
      return null;
    }
    out.fingerprint = new Set(list);
    conditionCount++;
  }

  if (node.fingerprintClass !== undefined) {
    const spec = node.fingerprintClass;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push(`${where}.fingerprintClass: atteso un oggetto`);
      return null;
    }
    const unknown = Object.keys(spec).filter((k) => !VALID_FP_CLASS_KEYS.includes(k));
    if (unknown.length > 0) {
      errors.push(`${where}.fingerprintClass: chiavi sconosciute (${unknown.join(', ')})`);
      return null;
    }
    out.fingerprintClass = { ...spec };
    conditionCount++;
  }

  if (conditionCount === 0) {
    errors.push(`${where}: nessuna condizione riconosciuta (un match vuoto matcherebbe tutto)`);
    return null;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER DICHIARATI DALLE REGOLE (decoy)
// ─────────────────────────────────────────────────────────────────────────────

/** Nome di header valido secondo RFC 7230 (token). */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Header che una regola non può dichiarare.
 *
 * Due famiglie, per due motivi diversi:
 *   - `content-length` / `transfer-encoding` descrivono come il corpo è
 *     inquadrato sul filo. Un valore sbagliato non produce una pagina sbagliata,
 *     produce una risposta che il client non sa dove finisca: nel migliore dei
 *     casi la connessione si pianta, nel peggiore il prossimo messaggio sulla
 *     stessa connessione viene interpretato male (request smuggling).
 *   - `set-cookie` fa scrivere al decoy nello stesso spazio dove vivono il
 *     cookie di sessione e quello CSRF. Un contenuto fittizio non deve poter
 *     toccare lo stato di autenticazione di nessuno.
 * Gli hop-by-hop restanti sono di competenza del server, non del contenuto.
 */
const FORBIDDEN_RESPONSE_HEADERS = [
  'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  'upgrade', 'te', 'trailer', 'proxy-authenticate', 'set-cookie',
];

const MAX_DECLARED_HEADERS = 20;
const MAX_HEADER_VALUE_LENGTH = 1024;

/**
 * Valida gli header dichiarati da una regola e li restituisce normalizzati.
 *
 * ─── PERCHE UNA REGOLA PUO DICHIARARE HEADER ──────────────────────────────────
 * Servono alla credibilità del decoy. Un finto `phpinfo()` senza
 * `X-Powered-By: PHP/8.1.2` è smascherato dal primo scanner che guarda gli
 * header invece del corpo — e uno scanner che si accorge dell'inganno non è solo
 * un decoy sprecato: gli ha detto che c'è un filtro.
 *
 * ─── PERCHE LA VALIDAZIONE E SEVERA ───────────────────────────────────────────
 * CR e LF dentro un valore sono response splitting: chiudono l'header e ne
 * aprono un altro, o aprono direttamente un secondo messaggio HTTP. Node oggi
 * solleva un'eccezione su header con caratteri illegali, ma affidarsi a quello
 * significa che un file di regole malformato diventa un 500 a runtime invece di
 * un errore al caricamento — e con `strictValidation: false` sarebbe un 500 per
 * ogni richiesta che matcha, scoperto dal traffico e non dall'avvio.
 *
 * @returns {object|null} mappa normalizzata, oppure null se ci sono errori
 */
function compileResponseHeaders(rawHeaders, where, errors) {
  if (rawHeaders === undefined || rawHeaders === null) return {};

  if (typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    errors.push(`${where}: deve essere un oggetto { "Nome-Header": "valore" }`);
    return null;
  }

  const entries = Object.entries(rawHeaders);
  if (entries.length > MAX_DECLARED_HEADERS) {
    errors.push(`${where}: troppi header (${entries.length}, massimo ${MAX_DECLARED_HEADERS})`);
    return null;
  }

  const out = {};
  let failed = false;

  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name)) {
      errors.push(`${where}: "${name}" non è un nome di header valido`);
      failed = true;
      continue;
    }
    if (FORBIDDEN_RESPONSE_HEADERS.includes(name.toLowerCase())) {
      errors.push(`${where}: l'header "${name}" non può essere dichiarato da una regola`);
      failed = true;
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      errors.push(`${where}: il valore di "${name}" deve essere una stringa o un numero`);
      failed = true;
      continue;
    }
    const text = String(value);
    if (text.length > MAX_HEADER_VALUE_LENGTH) {
      errors.push(`${where}: il valore di "${name}" supera ${MAX_HEADER_VALUE_LENGTH} caratteri`);
      failed = true;
      continue;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(text)) {
      errors.push(`${where}: il valore di "${name}" contiene caratteri di controllo (response splitting)`);
      failed = true;
      continue;
    }
    out[name] = text;
  }

  return failed ? null : out;
}

/**
 * Valida e compila l'intero file delle regole.
 *
 * @param {object} rulesData - contenuto di sentinelRules.json5
 * @param {object} [options]
 * @param {string[]} [options.knownRateLimiterRules] - per l'avviso su escalate
 * @param {string[]} [options.allowedRedirectHosts]  - allowlist dei redirect esterni
 * @returns {{ valid: boolean, rules: Array<object>, errors: string[], warnings: string[] }}
 */
function validateRules(rulesData, options = {}) {
  const errors = [];
  const warnings = [];
  const rules = [];

  if (!rulesData || typeof rulesData !== 'object') {
    return { valid: false, rules: [], errors: ['sentinelRules.json5: contenuto non valido'], warnings };
  }

  const rawRules = rulesData.rules;
  if (!Array.isArray(rawRules)) {
    return { valid: false, rules: [], errors: ['sentinelRules.json5: la chiave "rules" deve essere un array'], warnings };
  }

  const seenNames = new Set();
  const knownRlRules = options.knownRateLimiterRules || null;
  const allowedHosts = options.allowedRedirectHosts || [];
  const behindProxy = options.behindProxy === true;

  for (let i = 0; i < rawRules.length; i++) {
    const raw = rawRules[i];
    const where = `rules[${i}]`;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${where}: regola non valida`);
      continue;
    }

    // ── Identità ──
    // `name` è la chiave primaria: lega fra loro contatori, righe di log e azioni
    // della GUI. Senza, riordinare il file scollegherebbe la storia dalle regole.
    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      errors.push(`${where}: "name" obbligatorio (chiave primaria della regola)`);
      continue;
    }
    const name = raw.name.trim();
    if (seenNames.has(name)) {
      errors.push(`${where}: nome duplicato "${name}" — i nomi devono essere univoci`);
      continue;
    }

    // ── Azione ──
    const action = raw.action;
    if (!VALID_ACTIONS.includes(action)) {
      errors.push(`${where} ("${name}"): action sconosciuta "${action}" (ammesse: ${VALID_ACTIONS.join(', ')})`);
      continue;
    }

    if (raw.appliesTo !== undefined && !VALID_APPLIES_TO.includes(raw.appliesTo)) {
      errors.push(`${where} ("${name}"): appliesTo non valido "${raw.appliesTo}"`);
      continue;
    }

    // ── Condizioni ──
    const match = compileMatchNode(raw.match, `${where} ("${name}").match`, errors);
    if (!match) continue;

    // ── Parametri dell'azione ──
    const compiled = {
      name,
      enabled: raw.enabled !== false,
      category: typeof raw.category === 'string' ? raw.category : 'uncategorized',
      description: typeof raw.description === 'string' ? raw.description : '',
      appliesTo: raw.appliesTo || 'any',
      action,
      match,
    };

    if (action === 'decoy') {
      const decoy = raw.decoy || {};
      if (typeof decoy.file !== 'string' || decoy.file === '') {
        errors.push(`${where} ("${name}"): action "decoy" richiede decoy.file`);
        continue;
      }
      // Path traversal: il nome del decoy non deve poter uscire dalla cartella.
      if (decoy.file.includes('..') || decoy.file.includes('/') || decoy.file.includes('\\')) {
        errors.push(`${where} ("${name}"): decoy.file deve essere un nome di file semplice, senza percorsi`);
        continue;
      }
      // Uno stato fuori dall'intervallo delle risposte non è un decoy poco
      // credibile, è una risposta che Node rifiuta di emettere.
      const decoyStatus = decoy.status === undefined ? 200 : decoy.status;
      if (!Number.isInteger(decoyStatus) || decoyStatus < 200 || decoyStatus > 599) {
        errors.push(`${where} ("${name}"): decoy.status deve essere un intero fra 200 e 599`);
        continue;
      }
      const decoyHeaders = compileResponseHeaders(decoy.headers, `${where} ("${name}").decoy.headers`, errors);
      if (decoyHeaders === null) continue;

      compiled.decoy = { file: decoy.file, status: decoyStatus, headers: decoyHeaders };
    }

    if (action === 'redirect') {
      const redirect = raw.redirect || {};
      if (typeof redirect.to !== 'string' || redirect.to === '') {
        errors.push(`${where} ("${name}"): action "redirect" richiede redirect.to`);
        continue;
      }
      // La destinazione finisce nell'header Location: CR, LF e caratteri di
      // controllo sono response splitting, esattamente come negli header
      // dichiarati da un decoy.
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1f\x7f]/.test(redirect.to)) {
        errors.push(`${where} ("${name}"): redirect.to contiene caratteri di controllo`);
        continue;
      }

      const isExternal = /^[a-z][a-z0-9+.-]*:\/\//i.test(redirect.to) || redirect.to.startsWith('//');
      const status = redirect.status === undefined ? 302 : redirect.status;

      if (!VALID_REDIRECT_STATUSES.includes(status)) {
        errors.push(
          `${where} ("${name}"): redirect.status non valido (${status}); ` +
          `ammessi: ${VALID_REDIRECT_STATUSES.join(', ')}`
        );
        continue;
      }

      if (isExternal) {
        // I redirect permanenti vengono messi in cache dal browser: un falso
        // positivo dirotterebbe un utente reale per mesi, e non si ripara
        // riavviando. Verso l'esterno sono vietati, non sconsigliati.
        if (status === 301 || status === 308) {
          errors.push(`${where} ("${name}"): ${status} non ammesso verso destinazioni esterne (usa 302)`);
          continue;
        }
        let host = null;
        try { host = new URL(redirect.to.startsWith('//') ? `https:${redirect.to}` : redirect.to).host; }
        catch (_err) { host = null; }
        if (!host || !allowedHosts.includes(host)) {
          errors.push(`${where} ("${name}"): destinazione esterna "${redirect.to}" non presente in custom.allowedRedirectHosts`);
          continue;
        }
      } else if (!redirect.to.startsWith('/')) {
        errors.push(`${where} ("${name}"): redirect.to deve iniziare con "/" o essere un URL assoluto autorizzato`);
        continue;
      }

      compiled.redirect = { to: redirect.to, status, external: isExternal };
    }

    if (action === 'tarpit') {
      const tarpitSpec = raw.tarpit || {};
      if (tarpitSpec.seconds !== undefined
          && (!Number.isFinite(tarpitSpec.seconds) || tarpitSpec.seconds <= 0)) {
        errors.push(`${where} ("${name}"): tarpit.seconds deve essere un numero positivo`);
        continue;
      }
      // La durata dichiarata qui è una RICHIESTA: `custom.tarpit.maxSeconds` la
      // limita comunque. Una regola non deve poter tenere occupato un socket più
      // a lungo di quanto l'amministratore abbia deciso.
      compiled.tarpit = {
        seconds: Number.isFinite(tarpitSpec.seconds) ? tarpitSpec.seconds : null,
      };
    }

    // ── Avvisi sulle due azioni che si comportano diversamente dalle altre ──
    // Nessuna delle due è un errore: sono configurazioni legittime che però
    // fanno una cosa diversa da quella che chi le scrive si aspetta, e scoprirlo
    // dal traffico invece che dall'avvio è il modo peggiore.
    if (action === 'drop' && behindProxy) {
      warnings.push(
        `regola "${name}": action "drop" con custom.trustProxy attivo — il socket ` +
        'troncato è quello verso il proxy, non verso il client, che riceverebbe un 502. ' +
        'A runtime degrada al blocco (404)'
      );
    }
    if (action === 'tarpit' && behindProxy) {
      warnings.push(
        `regola "${name}": action "tarpit" dietro un proxy trattiene una connessione ` +
        'del PROXY, non del client; molti proxy chiudono da sé dopo il proprio timeout ' +
        'e l\'attesa la paga la tua infrastruttura'
      );
    }

    if (raw.escalate !== undefined) {
      const escalate = raw.escalate || {};
      if (typeof escalate.rateLimiterRule !== 'string' || escalate.rateLimiterRule === '') {
        errors.push(`${where} ("${name}"): escalate.rateLimiterRule deve essere una stringa`);
        continue;
      }
      if (knownRlRules && !knownRlRules.includes(escalate.rateLimiterRule)) {
        warnings.push(
          `regola "${name}": escalate verso "${escalate.rateLimiterRule}", che non esiste in ` +
          'protectedRoutes.json5 del plugin rateLimiter (l\'escalation userà i default)'
        );
      }

      // ── Ban immediato ──
      // `escalate` senza `ban` CONTA un fallimento e lascia decidere a
      // rateLimiter dopo quanti tentativi bloccare. Con `ban: true` si salta il
      // conteggio e si blocca subito: è la risposta giusta a un canary usato —
      // dove non c'è niente da accumulare, il primo evento è già la prova — e
      // quella sbagliata ovunque ci sia un margine di inferenza.
      const ban = escalate.ban === true;
      if (escalate.ban !== undefined && typeof escalate.ban !== 'boolean') {
        errors.push(`${where} ("${name}"): escalate.ban deve essere true o false`);
        continue;
      }
      if (escalate.banSeconds !== undefined
          && (!Number.isInteger(escalate.banSeconds) || escalate.banSeconds <= 0)) {
        errors.push(`${where} ("${name}"): escalate.banSeconds deve essere un intero positivo`);
        continue;
      }
      if (escalate.banSeconds !== undefined && !ban) {
        warnings.push(
          `regola "${name}": escalate.banSeconds è dichiarato ma escalate.ban è falso — ` +
          'il valore non ha effetto'
        );
      }
      // Un ban su una regola che non agisce non scatterebbe mai (l'enforcement è
      // la precondizione), e crederlo attivo è peggio che non averlo scritto.
      if (ban && (action === 'monitor' || action === 'allow')) {
        warnings.push(
          `regola "${name}": escalate.ban su una regola "${action}" non avrà mai effetto — ` +
          'il ban richiede che l\'azione sia applicata'
        );
      }
      compiled.escalate = {
        rateLimiterRule: escalate.rateLimiterRule,
        ban,
        banSeconds: Number.isInteger(escalate.banSeconds) ? escalate.banSeconds : null,
      };
    }

    seenNames.add(name);
    rules.push(compiled);
  }

  // ── Avvisi di coerenza dell'insieme ──
  // Una regola preceduta da una `allow` che matcha lo stesso terreno non scatterà
  // mai: con first-match-wins è un errore di ordinamento facile da fare e
  // impossibile da notare guardando la singola regola.
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].action !== 'allow') continue;
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[j].action === 'allow') continue;
      if (nodeIsBroaderOrEqual(rules[i].match, rules[j].match)) {
        warnings.push(
          `regola "${rules[j].name}" potrebbe non scattare mai: la regola allow "${rules[i].name}" ` +
          'la precede e copre le stesse condizioni'
        );
      }
    }
  }

  return { valid: errors.length === 0, rules, errors, warnings };
}

/**
 * Confronto strutturale grossolano fra due nodi match, usato SOLO per l'avviso
 * di regola irraggiungibile. Riconosce il caso frequente (stesso identico
 * insieme di path) e tace su tutto il resto: un avviso mancato non fa danni, un
 * falso allarme insegna a ignorare gli avvisi.
 */
function nodeIsBroaderOrEqual(a, b) {
  if (!a || !b) return false;
  if (!Array.isArray(a.path) || !Array.isArray(b.path)) return false;
  if (Object.keys(a).length !== 1 || Object.keys(b).length !== 1) return false;
  return b.path.every((p) => a.path.includes(p));
}

/**
 * Emette gli esiti della validazione sui log, con lo stesso stile degli altri
 * plugin che validano un file di regole.
 */
function logValidationResults(result, logger, prefix) {
  for (const warning of result.warnings) logger.warn(prefix, warning);
  for (const error of result.errors) logger.error(prefix, error);
}

module.exports = {
  validateRules,
  compileMatchNode,
  hasNestedQuantifier,
  logValidationResults,
  VALID_ACTIONS,
  DECORATING_ACTIONS,
  VALID_APPLIES_TO,
};
