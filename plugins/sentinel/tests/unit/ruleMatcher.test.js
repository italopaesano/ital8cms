const PatternMatcher = require('../../../../core/patternMatcher');
const { validateRules } = require('../../lib/ruleValidator');
const { buildSubject, findFirstMatch, evaluateNode } = require('../../lib/ruleMatcher');

const matcher = new PatternMatcher();

/** Compila un match grezzo passando dal validatore, come fa il plugin. */
function compile(matchNode, over = {}) {
  const r = validateRules({ rules: [{ name: 'r', action: 'monitor', match: matchNode, ...over }] });
  if (r.rules.length === 0) throw new Error(`regola non compilata: ${r.errors.join('; ')}`);
  return r.rules[0];
}

function makeCtx({ path = '/', method = 'GET', headers = {}, query = '', session = null } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    path, method, querystring: query, headers: lower, session,
    get: (name) => lower[name.toLowerCase()],
    req: { rawHeaders: Object.entries(lower).flat(), httpVersion: '1.1', headers: lower },
  };
}

function subjectFor(ctx, over = {}) {
  return {
    ...buildSubject(ctx, {
      fingerprint: { fp: 'abc123', fpClass: { family: 'curl', coherent: true, headerProfile: 'minimal', isBot: false, botName: null, claimedBrowser: null, claimedOs: null } },
      clientIp: '203.0.113.44',
      globalPrefix: '',
    }),
    ...over,
  };
}

describe('buildSubject', () => {
  test('estrae l estensione dall ultimo segmento', () => {
    expect(subjectFor(makeCtx({ path: '/a/b/file.PHP' })).extension).toBe('php');
    expect(subjectFor(makeCtx({ path: '/a/b/senza-estensione' })).extension).toBe('');
  });

  // I path nelle regole si scrivono senza globalPrefix: se il confronto avvenisse
  // sul path completo, su un'istanza con prefisso TUTTE le regole smetterebbero
  // di matchare in silenzio.
  test('toglie il globalPrefix prima del confronto', () => {
    const s = buildSubject(makeCtx({ path: '/sito/wp-login.php' }), {
      fingerprint: { fp: 'x', fpClass: {} },
      clientIp: '1.2.3.4',
      globalPrefix: '/sito',
    });
    expect(s.path).toBe('/wp-login.php');
  });

  test('legge stato di autenticazione e ruoli dalla sessione', () => {
    const s = subjectFor(makeCtx({ session: { authenticated: true, user: { username: 'ada', roleIds: [1, 100] } } }));
    expect(s.authenticated).toBe(true);
    expect(s.username).toBe('ada');
    expect(s.roleIds).toEqual([1, 100]);
  });

  test('tronca uno User-Agent smisurato', () => {
    const s = subjectFor(makeCtx({ headers: { 'user-agent': 'a'.repeat(50000) } }));
    expect(s.userAgent.length).toBeLessThanOrEqual(512);
  });
});

describe('foglie', () => {
  test('path: esatto, wildcard e regex', () => {
    expect(evaluateNode(compile({ path: '/x' }).match, subjectFor(makeCtx({ path: '/x' })), matcher)).toBe(true);
    expect(evaluateNode(compile({ path: '/wp-admin/**' }).match, subjectFor(makeCtx({ path: '/wp-admin/a/b' })), matcher)).toBe(true);
    expect(evaluateNode(compile({ path: 'regex:^/wp-' }).match, subjectFor(makeCtx({ path: '/wp-login.php' })), matcher)).toBe(true);
    expect(evaluateNode(compile({ path: '/x' }).match, subjectFor(makeCtx({ path: '/y' })), matcher)).toBe(false);
  });

  test('extension', () => {
    const node = compile({ extension: ['php'] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a.php' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a.html' })), matcher)).toBe(false);
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a' })), matcher)).toBe(false);
  });

  test('method', () => {
    const node = compile({ method: ['TRACE'] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ method: 'TRACE' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ method: 'GET' })), matcher)).toBe(false);
  });

  test('userAgent: regex, lista e "empty"', () => {
    const re = compile({ userAgent: 'regex:^curl/' }).match;
    expect(evaluateNode(re, subjectFor(makeCtx({ headers: { 'user-agent': 'curl/8.5.0' } })), matcher)).toBe(true);

    const lista = compile({ userAgent: ['wget', 'curl'] }).match;
    expect(evaluateNode(lista, subjectFor(makeCtx({ headers: { 'user-agent': 'Curl/8' } })), matcher)).toBe(true);

    const vuoto = compile({ userAgent: 'empty' }).match;
    expect(evaluateNode(vuoto, subjectFor(makeCtx({})), matcher)).toBe(true);
    expect(evaluateNode(vuoto, subjectFor(makeCtx({ headers: { 'user-agent': 'x' } })), matcher)).toBe(false);
  });

  test('header: presenza, assenza e valore', () => {
    const assente = compile({ header: { name: 'Accept-Language', present: false } }).match;
    expect(evaluateNode(assente, subjectFor(makeCtx({})), matcher)).toBe(true);
    expect(evaluateNode(assente, subjectFor(makeCtx({ headers: { 'accept-language': 'it' } })), matcher)).toBe(false);

    const valore = compile({ header: { name: 'X-Test', value: 'regex:^ab' } }).match;
    expect(evaluateNode(valore, subjectFor(makeCtx({ headers: { 'x-test': 'abc' } })), matcher)).toBe(true);
  });

  // Nella querystring uno spazio arriva come `+` o `%20`: un pattern scritto in
  // modo naturale deve matchare comunque, altrimenti si scrivono regole che
  // sembrano giuste e non scattano mai.
  test('query: match sia sulla forma grezza sia su quella decodificata', () => {
    const node = compile({ query: 'regex:union\\s+select' }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ query: 'q=1 union select 2' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ query: 'q=1+union+select+2' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ query: 'q=1%20union%20select' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ query: 'q=1' })), matcher)).toBe(false);
  });

  test('query: un percent-encoding malformato non fa lanciare nulla', () => {
    const node = compile({ query: 'regex:passwd' }).match;
    expect(() => evaluateNode(node, subjectFor(makeCtx({ query: 'f=%E0%A4%A' })), matcher)).not.toThrow();
  });

  test('query: la forma codificata di un traversal viene colta', () => {
    const node = compile({ query: 'regex:(\\.\\./|/etc/passwd)' }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ query: 'f=%2Fetc%2Fpasswd' })), matcher)).toBe(true);
  });

  test('ip', () => {
    const node = compile({ ip: ['203.0.113.0/24'] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({})), matcher)).toBe(true);
    expect(evaluateNode(node, { ...subjectFor(makeCtx({})), ip: '10.0.0.1' }, matcher)).toBe(false);
  });

  test('fingerprintClass: match parziale sui soli campi indicati', () => {
    const node = compile({ fingerprintClass: { coherent: false } }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({})), matcher)).toBe(false);
    const bugiardo = { ...subjectFor(makeCtx({})), fpClass: { coherent: false, family: 'curl' } };
    expect(evaluateNode(node, bugiardo, matcher)).toBe(true);
  });

  // Lo status non esiste al momento di evaluate: una regola che lo nomina non
  // deve matchare per sbaglio prima che la risposta esista.
  test('status non matcha finché il soggetto non ne ha uno', () => {
    const node = compile({ status: [404] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({})), matcher)).toBe(false);
    expect(evaluateNode(node, { ...subjectFor(makeCtx({})), status: 404 }, matcher)).toBe(true);
  });
});

describe('combinatori', () => {
  test('più foglie nello stesso oggetto = AND implicito', () => {
    const node = compile({ extension: ['php'], method: ['GET'] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a.php', method: 'GET' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a.php', method: 'POST' })), matcher)).toBe(false);
  });

  test('any = OR', () => {
    const node = compile({ any: [{ path: '/a' }, { path: '/b' }] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/b' })), matcher)).toBe(true);
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/c' })), matcher)).toBe(false);
  });

  test('not nega', () => {
    const node = compile({ all: [{ path: '/a' }, { not: { ip: ['203.0.113.0/24'] } }] }).match;
    expect(evaluateNode(node, subjectFor(makeCtx({ path: '/a' })), matcher)).toBe(false);
    expect(evaluateNode(node, { ...subjectFor(makeCtx({ path: '/a' })), ip: '10.0.0.1' }, matcher)).toBe(true);
  });
});

describe('findFirstMatch', () => {
  const rules = validateRules({
    rules: [
      { name: 'allow-locale', action: 'allow', match: { ip: ['127.0.0.0/8'] } },
      { name: 'php', action: 'monitor', match: { extension: ['php'] } },
      { name: 'tutto-il-resto', action: 'monitor', match: { path: '/**' } },
    ],
  }).rules;

  // Con first-match-wins l'ordine È la priorità: la prima che matcha decide,
  // non la più specifica.
  test('vince la prima che matcha, non la più specifica', () => {
    const s = { ...subjectFor(makeCtx({ path: '/a.php' })), ip: '127.0.0.1' };
    expect(findFirstMatch(rules, s, matcher).name).toBe('allow-locale');
  });

  test('senza la allow in testa vince la regola successiva', () => {
    expect(findFirstMatch(rules, subjectFor(makeCtx({ path: '/a.php' })), matcher).name).toBe('php');
  });

  test('null se nessuna regola matcha', () => {
    const soloPhp = validateRules({ rules: [{ name: 'php', action: 'monitor', match: { extension: ['php'] } }] }).rules;
    expect(findFirstMatch(soloPhp, subjectFor(makeCtx({ path: '/a.html' })), matcher)).toBe(null);
  });

  test('le regole disabilitate vengono saltate', () => {
    const spente = validateRules({ rules: [{ name: 'php', enabled: false, action: 'monitor', match: { extension: ['php'] } }] }).rules;
    expect(findFirstMatch(spente, subjectFor(makeCtx({ path: '/a.php' })), matcher)).toBe(null);
  });

  test('appliesTo filtra per tipo di traffico', () => {
    const soloAnonimi = validateRules({
      rules: [{ name: 'a', action: 'monitor', appliesTo: 'anonymous', match: { path: '/x' } }],
    }).rules;
    const anonimo = subjectFor(makeCtx({ path: '/x' }));
    const loggato = subjectFor(makeCtx({ path: '/x', session: { authenticated: true, user: { username: 'ada', roleIds: [1] } } }));
    expect(findFirstMatch(soloAnonimi, anonimo, matcher)).not.toBe(null);
    expect(findFirstMatch(soloAnonimi, loggato, matcher)).toBe(null);
  });
});
