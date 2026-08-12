/**
 * ruleTracer.js
 *
 * «Data questa richiesta, quale regola matcha — e perché.»
 *
 * ─── PERCHE UN VALUTATORE SEPARATO E NON UN FLAG ──────────────────────────────
 * La strada più corta sarebbe aggiungere un parametro `trace` a `evaluateNode` e
 * far accumulare i risultati mentre valuta. Ma `evaluateNode` gira su **ogni
 * richiesta**, per **ogni regola**, e la traccia richiede di allocare un array e
 * un oggetto per ciascuna foglia: un costo pagato per sempre da tutto il traffico
 * per una funzione usata qualche volta al mese da un amministratore.
 *
 * Quindi due funzioni: una veloce che risponde sì/no, una lenta che racconta.
 *
 * ─── IL RISCHIO DELLA DUPLICAZIONE, E COME LO SI PRESIDIA ─────────────────────
 * Due implementazioni della stessa semantica divergono: è una questione di
 * tempo. La rete è un test di **conformità** che, su una batteria di casi, esige
 * `trace(...).matched === evaluateNode(...)`. Se qualcuno aggiunge una foglia al
 * matcher e si dimentica del tracciatore, è quel test a fallire — non l'utente a
 * ricevere una spiegazione sbagliata.
 *
 * ─── PERCHE LA PARTE UTILE E IL "NON HA MATCHATO" ─────────────────────────────
 * Il caso per cui questo strumento esiste non è «quale regola scatta» — quello
 * si vede dal log. È «ho scritto questa regola e non scatta, perché?». La
 * traccia elenca quindi ogni foglia con **atteso vs osservato**, anche per le
 * regole che non hanno matchato, e dice quale condizione ha fatto fallire.
 */

'use strict';

const { buildSubject, appliesToSubject } = require('./ruleMatcher');
const { buildFingerprint, fpClassMatches } = require('./requestFingerprint');
const { ipMatchesAny } = require('./ipMatcher');
const { findCanary } = require('./canaryRegistry');

/**
 * Insieme di header che un browser moderno manda davvero, nell'ordine in cui li
 * manda.
 *
 * Serve a un tranello del tester: una richiesta sintetica ha SOLO gli header che
 * le si danno, quindi senza questo preset qualunque prova sembra un client
 * script — profilo `minimal`, e chiunque scriva `-A "Mozilla/..."` inciampa
 * nella regola sull'incoerenza UA↔impronta senza capire perché. Con
 * `browserProfile: true` si prova cosa vedrebbe il filtro davanti a un browser
 * vero.
 */
const BROWSER_HEADER_PRESET = {
  'Connection': 'keep-alive',
  'sec-ch-ua': '"Chromium";v="120", "Not:A-Brand";v="99"',
  'sec-ch-ua-platform': '"Linux"',
  'Upgrade-Insecure-Requests': '1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
};

/**
 * Costruisce un contesto Koa sintetico da una descrizione di richiesta.
 *
 * Deve somigliare abbastanza a un ctx vero da far funzionare `buildSubject` e
 * `buildFingerprint` senza che questi sappiano di essere in un test: se il
 * tester usasse una strada diversa da quella di produzione, direbbe cose vere su
 * sé stesso e false sul filtro.
 *
 * @param {object} spec
 * @param {string} [spec.path='/']
 * @param {string} [spec.method='GET']
 * @param {object} [spec.headers]
 * @param {string} [spec.query]
 * @param {string} [spec.ip]
 * @param {boolean} [spec.authenticated]
 * @param {number[]} [spec.roleIds]
 * @param {string} [spec.username]
 * @param {number} [spec.status] - per provare le regole sull'esito
 * @param {boolean} [spec.browserProfile] - aggiunge gli header che un browser manda
 * @returns {object} contesto sintetico
 */
function buildSyntheticCtx(spec = {}) {
  const rawPath = typeof spec.path === 'string' && spec.path ? spec.path : '/';
  // Una query scritta dentro il path è l'errore più naturale del mondo quando si
  // incolla un URL dai log: si accetta e si separa, invece di far fallire il test
  // per un motivo che non c'entra con le regole.
  const [pathOnly, inlineQuery] = rawPath.split('?');

  // Gli header espliciti hanno la precedenza sul preset: chi vuole provare un
  // Accept diverso da quello di Chrome deve poterlo fare.
  const source = spec.browserProfile
    ? { ...BROWSER_HEADER_PRESET, ...(spec.headers || {}) }
    : (spec.headers || {});

  const headers = {};
  const rawHeaders = [];
  for (const [name, value] of Object.entries(source)) {
    headers[String(name).toLowerCase()] = String(value);
    rawHeaders.push(String(name), String(value));
  }

  const session = spec.authenticated
    ? {
      authenticated: true,
      user: {
        username: spec.username || 'utente-di-prova',
        roleIds: Array.isArray(spec.roleIds) ? spec.roleIds : [],
      },
    }
    : null;

  return {
    path: pathOnly || '/',
    method: String(spec.method || 'GET').toUpperCase(),
    querystring: typeof spec.query === 'string' && spec.query !== '' ? spec.query : (inlineQuery || ''),
    headers,
    session,
    status: Number.isInteger(spec.status) ? spec.status : undefined,
    ip: spec.ip || '203.0.113.1',
    get: (name) => headers[String(name).toLowerCase()],
    req: { rawHeaders, httpVersion: spec.httpVersion || '1.1', headers, socket: null },
  };
}

// ── Descrizione delle singole foglie ─────────────────────────────────────────

/**
 * Valuta una foglia e ne racconta l'esito.
 * @returns {{ leaf: string, matched: boolean, expected: *, actual: * }}
 */
function traceLeaf(leaf, node, subject, matcher) {
  const entry = (matched, expected, actual) => ({ leaf, matched, expected, actual });

  switch (leaf) {
    case 'path': {
      const patterns = Array.isArray(node.path) ? node.path : [node.path];
      const hit = patterns.find((p) => matcher.matches(subject.path, p));
      return entry(!!hit, patterns, subject.path);
    }
    case 'extension':
      return entry(!!subject.extension && node.extension.has(subject.extension),
        Array.from(node.extension), subject.extension || '(nessuna)');
    case 'method':
      return entry(node.method.has(subject.method), Array.from(node.method), subject.method);
    case 'userAgent': {
      const ua = subject.userAgent;
      if (node.userAgent === 'empty') return entry(ua === '', 'empty', ua || '(assente)');
      if (node.userAgent instanceof RegExp) return entry(node.userAgent.test(ua), String(node.userAgent), ua);
      const needles = Array.from(node.userAgent);
      return entry(needles.some((n) => ua.toLowerCase().includes(n)), needles, ua);
    }
    case 'header': {
      const spec = node.header;
      const actual = subject.headers[spec.name];
      if (spec.present === false) return entry(actual === undefined, `${spec.name} assente`, actual);
      if (spec.present === true) return entry(actual !== undefined, `${spec.name} presente`, actual);
      if (spec.value instanceof RegExp) {
        return entry(actual !== undefined && spec.value.test(String(actual)), `${spec.name} ~ ${spec.value}`, actual);
      }
      return entry(actual !== undefined && String(actual).toLowerCase() === String(spec.value).toLowerCase(),
        `${spec.name} = ${spec.value}`, actual);
    }
    case 'query': {
      const raw = subject.query;
      let decoded = null;
      try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (_e) { decoded = null; }
      const test = (s) => (node.query instanceof RegExp
        ? node.query.test(s)
        : Array.from(node.query).some((n) => s.toLowerCase().includes(n)));
      const matched = !!raw && (test(raw) || (decoded !== null && test(decoded)));
      return entry(matched,
        node.query instanceof RegExp ? String(node.query) : Array.from(node.query),
        decoded && decoded !== raw ? `${raw}  (decodificata: ${decoded})` : raw || '(vuota)');
    }
    case 'ip':
      return entry(ipMatchesAny(subject.ip, node.ip), node.ip, subject.ip);
    case 'status':
      return entry(subject.status !== null && node.status.has(subject.status),
        Array.from(node.status), subject.status === null ? '(non ancora noto)' : subject.status);
    case 'canary': {
      const found = subject.canary;
      const wantAny = node.canary === true || node.canary === 'any';
      const matched = !!found && (wantAny || found.status === node.canary);
      return entry(matched,
        wantAny ? 'un token qualsiasi' : `token ${node.canary}`,
        found ? `${found.token} (${found.status})` : '(nessun token nella richiesta)');
    }
    case 'sessionAnomaly': {
      const found = subject.sessionAnomalies || [];
      const wantAny = node.sessionAnomaly === true;
      const matched = found.length > 0
        && (wantAny || found.some((k) => node.sessionAnomaly.has(k)));
      return entry(matched,
        wantAny ? 'una anomalia qualsiasi' : Array.from(node.sessionAnomaly),
        found.length > 0
          ? found.join(', ')
          : (subject.authenticated
            ? '(nessuna anomalia)'
            : '(richiesta anonima: nessuna sessione da confrontare)'));
    }
    case 'reputation': {
      const rep = subject.reputation;
      const found = (rep && rep.levels) || [];
      const wantAny = node.reputation === true;
      const matched = found.length > 0 && (wantAny || found.some((l) => node.reputation.has(l)));
      let osservato;
      if (found.length > 0) {
        osservato = found.join(', ');
      } else if (rep && rep.protected) {
        // Il motivo più probabile per cui una regola di reputazione "non
        // scatta": l'impronta sembra un browser vero, e quelle sono protette.
        osservato = '(impronta da browser: protetta dal giudizio)';
      } else if (rep) {
        osservato = `(nessun giudizio — ${rep.requests} richieste, quota blocchi ${rep.blockedShare})`;
      } else {
        osservato = '(censimento non disponibile)';
      }
      return entry(matched, wantAny ? 'un giudizio qualsiasi' : Array.from(node.reputation), osservato);
    }
    case 'authenticated':
      return entry(subject.authenticated === node.authenticated, node.authenticated, subject.authenticated);
    case 'roleIds':
      return entry(node.roleIds.some((id) => subject.roleIds.includes(id)), node.roleIds, subject.roleIds);
    case 'fingerprint':
      return entry(node.fingerprint.has(subject.fp), Array.from(node.fingerprint), subject.fp);
    case 'fingerprintClass':
      return entry(fpClassMatches(subject.fpClass, node.fingerprintClass),
        node.fingerprintClass, subject.fpClass);
    default:
      return entry(false, null, null);
  }
}

const LEAF_KEYS = [
  'path', 'extension', 'method', 'userAgent', 'header', 'query',
  'ip', 'status', 'canary', 'sessionAnomaly', 'reputation',
  'authenticated', 'roleIds', 'fingerprint', 'fingerprintClass',
];

/**
 * Valuta un nodo raccontando ogni passo.
 *
 * @returns {{ matched: boolean, entries: Array<object> }}
 */
function traceNode(node, subject, matcher, label = 'match') {
  const entries = [];
  let matched = true;

  if (Array.isArray(node.all)) {
    const children = node.all.map((child, i) => traceNode(child, subject, matcher, `${label}.all[${i}]`));
    const ok = children.every((c) => c.matched);
    entries.push({ leaf: 'all', matched: ok, children: children.map((c) => c.entries) });
    if (!ok) matched = false;
  }

  if (Array.isArray(node.any)) {
    const children = node.any.map((child, i) => traceNode(child, subject, matcher, `${label}.any[${i}]`));
    const ok = children.some((c) => c.matched);
    entries.push({ leaf: 'any', matched: ok, children: children.map((c) => c.entries) });
    if (!ok) matched = false;
  }

  if (node.not !== undefined) {
    const child = traceNode(node.not, subject, matcher, `${label}.not`);
    entries.push({ leaf: 'not', matched: !child.matched, children: [child.entries] });
    if (child.matched) matched = false;
  }

  for (const leaf of LEAF_KEYS) {
    if (node[leaf] === undefined) continue;
    const result = traceLeaf(leaf, node, subject, matcher);
    entries.push(result);
    if (!result.matched) matched = false;
  }

  // Un nodo senza condizioni non matcha (stesso presidio di evaluateNode).
  if (entries.length === 0) matched = false;

  return { matched, entries };
}

/**
 * Prova una richiesta contro l'intero insieme di regole.
 *
 * Riporta **tutte** le regole valutate, non solo quella che ha vinto: il caso
 * d'uso principale è capire perché una regola *non* scatta.
 *
 * @param {object} spec               - descrizione della richiesta
 * @param {Array<object>} rules       - regole compilate
 * @param {object} matcher            - istanza di PatternMatcher
 * @param {object} [options]
 * @param {string} [options.salt]
 * @param {string} [options.globalPrefix]
 * @param {object} [options.canaryRegistry] - per riconoscere un token nella prova
 * @returns {object}
 */
function testRequest(spec, rules, matcher, options = {}) {
  const ctx = buildSyntheticCtx(spec);
  const fingerprint = buildFingerprint(ctx, { salt: options.salt || '' });
  const subject = buildSubject(ctx, {
    fingerprint,
    clientIp: ctx.ip,
    globalPrefix: options.globalPrefix || '',
    // Il tester deve vedere i token veri: incollare l'URL di un canary appena
    // scattato e capire perché la regola ha (o non ha) reagito è esattamente il
    // caso d'uso. Cercarlo qui, e non nel matcher, tiene la ricerca a una sola
    // volta per prova come a runtime.
    canary: findCanary(options.canaryRegistry, ctx.path, ctx.querystring),
    // Le anomalie di sessione si DICHIARANO nella prova, non si calcolano: la
    // domanda del tester è «se questa sessione avesse cambiato User-Agent, la
    // mia regola la prenderebbe?», e per rispondere non serve — né sarebbe
    // possibile — riprodurre la storia di una sessione vera.
    // Restano vincolate all'autenticazione, come a runtime.
    sessionAnomalies: spec.authenticated && Array.isArray(spec.sessionAnomalies)
      ? spec.sessionAnomalies
      : [],
    // Come le anomalie di sessione, il giudizio di reputazione si DICHIARA nella
    // prova: dipende da mesi di censimento, e una richiesta sintetica non ne ha.
    reputation: Array.isArray(spec.reputation)
      ? { levels: spec.reputation, requests: 0, blockedShare: 0, ageSeconds: 0, protected: false }
      : null,
  });
  if (Number.isInteger(spec.status)) subject.status = spec.status;

  const evaluated = [];
  let winner = null;

  for (const rule of rules) {
    if (rule.enabled === false) {
      evaluated.push({ ruleName: rule.name, action: rule.action, matched: false, skipped: 'disabilitata' });
      continue;
    }
    if (!appliesToSubject(rule, subject)) {
      evaluated.push({
        ruleName: rule.name,
        action: rule.action,
        matched: false,
        skipped: `appliesTo: ${rule.appliesTo} (richiesta ${subject.authenticated ? 'autenticata' : 'anonima'})`,
      });
      continue;
    }

    const trace = traceNode(rule.match, subject, matcher);
    evaluated.push({
      ruleName: rule.name,
      action: rule.action,
      category: rule.category,
      matched: trace.matched,
      skipped: null,
      entries: trace.entries,
      // First-match-wins: le regole dopo la vincitrice non vengono nemmeno
      // valutate a runtime, e dirlo evita di far credere che siano state scartate.
      shortCircuited: winner !== null,
    });

    if (trace.matched && winner === null) winner = rule;
  }

  return {
    subject: {
      path: subject.path,
      method: subject.method,
      extension: subject.extension || null,
      userAgent: subject.userAgent || null,
      query: subject.query || null,
      ip: subject.ip,
      authenticated: subject.authenticated,
      roleIds: subject.roleIds,
      status: subject.status,
      canary: subject.canary,
      sessionAnomalies: subject.sessionAnomalies,
      reputation: subject.reputation,
      fp: subject.fp,
      fpClass: subject.fpClass,
    },
    matched: winner
      ? { ruleName: winner.name, action: winner.action, category: winner.category }
      : null,
    evaluated,
  };
}

module.exports = {
  testRequest, traceNode, traceLeaf, buildSyntheticCtx, LEAF_KEYS, BROWSER_HEADER_PRESET,
};
