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

const VALID_ACTIONS = [
  'allow', 'monitor', 'block', 'drop', 'decoy', 'redirect', 'throttle', 'tarpit',
];

// Azioni la cui risposta è prodotta dal plugin e non dal 404 comune del core.
// Su un percorso della superficie riservata chiusa il gate le degrada a 404.
const DECORATING_ACTIONS = ['decoy', 'redirect', 'tarpit'];

const VALID_APPLIES_TO = ['anonymous', 'authenticated', 'any'];

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
      compiled.decoy = { file: decoy.file, status: Number.isInteger(decoy.status) ? decoy.status : 200 };
    }

    if (action === 'redirect') {
      const redirect = raw.redirect || {};
      if (typeof redirect.to !== 'string' || redirect.to === '') {
        errors.push(`${where} ("${name}"): action "redirect" richiede redirect.to`);
        continue;
      }
      const isExternal = /^[a-z][a-z0-9+.-]*:\/\//i.test(redirect.to) || redirect.to.startsWith('//');
      const status = Number.isInteger(redirect.status) ? redirect.status : 302;

      if (isExternal) {
        // Il 301 viene messo in cache dal browser in modo persistente: un falso
        // positivo dirotterebbe un utente reale per mesi, e non si ripara
        // riavviando. Verso l'esterno è vietato, non sconsigliato.
        if (status === 301) {
          errors.push(`${where} ("${name}"): 301 non ammesso verso destinazioni esterne (usa 302)`);
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
      compiled.escalate = { rateLimiterRule: escalate.rateLimiterRule };
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
