const PatternMatcher = require('../../../../core/patternMatcher');
const { validateRules } = require('../../lib/ruleValidator');
const { buildSubject, evaluateNode } = require('../../lib/ruleMatcher');
const { buildFingerprint } = require('../../lib/requestFingerprint');
const { testRequest, traceNode, buildSyntheticCtx } = require('../../lib/ruleTracer');
const { CanaryRegistry, findCanary } = require('../../lib/canaryRegistry');

const matcher = new PatternMatcher();

// Registro condiviso dai test: un token che il registro conosce e uno che ha
// solo la forma giusta, per coprire entrambi gli stati della foglia `canary`.
const canaryRegistry = new CanaryRegistry();
const KNOWN_TOKEN = canaryRegistry.mint({ ip: '203.0.113.9', fp: 'fp-consegna', path: '/backup/' });
const UNKNOWN_TOKEN = 'a7zzzzzzzzzzzzzzzzzzzzzz';

function compileRules(raw) {
  const result = validateRules({ rules: raw });
  if (result.errors.length) throw new Error(result.errors.join('; '));
  return result.rules;
}

function subjectFor(spec) {
  const ctx = buildSyntheticCtx(spec);
  const s = buildSubject(ctx, {
    fingerprint: buildFingerprint(ctx),
    clientIp: ctx.ip,
    globalPrefix: '',
    canary: findCanary(canaryRegistry, ctx.path, ctx.querystring),
    sessionAnomalies: spec.authenticated && Array.isArray(spec.sessionAnomalies)
      ? spec.sessionAnomalies
      : [],
    reputation: Array.isArray(spec.reputation)
      ? { levels: spec.reputation, requests: 0, blockedShare: 0, ageSeconds: 0, protected: false }
      : null,
  });
  if (Number.isInteger(spec.status)) s.status = spec.status;
  return s;
}

describe('buildSyntheticCtx', () => {
  test('separa la query scritta dentro il path', () => {
    // Incollare un URL completo dai log è l'errore più naturale del mondo: si
    // accetta invece di far fallire il test per un motivo che non c'entra.
    const ctx = buildSyntheticCtx({ path: '/cerca?q=1&x=2' });
    expect(ctx.path).toBe('/cerca');
    expect(ctx.querystring).toBe('q=1&x=2');
  });

  test('la query esplicita prevale su quella inline', () => {
    const ctx = buildSyntheticCtx({ path: '/a?vecchia=1', query: 'nuova=2' });
    expect(ctx.querystring).toBe('nuova=2');
  });

  test('normalizza gli header in minuscolo ma conserva rawHeaders', () => {
    const ctx = buildSyntheticCtx({ headers: { 'User-Agent': 'curl/8' } });
    expect(ctx.headers['user-agent']).toBe('curl/8');
    expect(ctx.req.rawHeaders).toEqual(['User-Agent', 'curl/8']);
  });

  test('costruisce una sessione quando la richiesta è autenticata', () => {
    const ctx = buildSyntheticCtx({ authenticated: true, roleIds: [1] });
    expect(ctx.session.authenticated).toBe(true);
    expect(ctx.session.user.roleIds).toEqual([1]);
  });

  test('metodo in maiuscolo e default sensati', () => {
    const ctx = buildSyntheticCtx({ method: 'post' });
    expect(ctx.method).toBe('POST');
    expect(buildSyntheticCtx({}).path).toBe('/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IL TEST CHE CONTA: due implementazioni della stessa semantica divergono, è
// solo questione di tempo. Se qualcuno aggiunge una foglia al matcher e si
// dimentica del tracciatore, deve fallire QUESTO — non l'utente a ricevere una
// spiegazione sbagliata.
// ─────────────────────────────────────────────────────────────────────────────
describe('conformità fra il valutatore veloce e quello che racconta', () => {
  const NODES = [
    { path: '/a.php' },
    { path: '/wp-admin/**' },
    { path: 'regex:^/wp-' },
    { extension: ['php'] },
    { extension: ['sql', 'bak'] },
    { method: ['GET'] },
    { method: ['POST'] },
    { userAgent: 'regex:^curl/' },
    { userAgent: 'empty' },
    { userAgent: ['curl', 'wget'] },
    { header: { name: 'Accept-Language', present: false } },
    { header: { name: 'X-Test', value: 'abc' } },
    { query: 'regex:union\\s+select' },
    { ip: ['203.0.113.0/24'] },
    { ip: ['10.0.0.0/8'] },
    { authenticated: true },
    { authenticated: false },
    { roleIds: [1] },
    { fingerprintClass: { coherent: false } },
    { fingerprintClass: { family: 'curl' } },
    { status: [404] },
    { canary: true },
    { canary: 'known' },
    { canary: 'unknown' },
    { sessionAnomaly: true },
    { sessionAnomaly: ['uaChanged'] },
    { sessionAnomaly: ['ipChanged', 'scriptClient'] },
    { reputation: true },
    { reputation: ['bad'] },
    { reputation: ['burst', 'suspect'] },
    { extension: ['php'], method: ['GET'] },
    { all: [{ path: '/a.php' }, { method: ['GET'] }] },
    { any: [{ path: '/nope' }, { extension: ['php'] }] },
    { not: { ip: ['203.0.113.0/24'] } },
    { all: [{ extension: ['php'] }, { not: { authenticated: true } }] },
  ];

  const SPECS = [
    { path: '/a.php', method: 'GET', headers: { 'User-Agent': 'curl/8.5.0' } },
    { path: '/wp-admin/setup.php', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
    { path: '/senza-estensione', method: 'GET', headers: {} },
    { path: '/dump.sql', method: 'GET', headers: { 'X-Test': 'abc', 'Accept-Language': 'it' } },
    { path: '/cerca', query: 'q=1+union+select+2', headers: { 'User-Agent': 'curl/8' } },
    { path: '/a.php', authenticated: true, roleIds: [1], headers: { 'User-Agent': 'curl/8' } },
    { path: '/a.php', ip: '10.1.2.3', headers: {} },
    { path: '/a.php', status: 404, headers: {} },
    { path: `/backup-${KNOWN_TOKEN}.tar.gz`, headers: {} },
    { path: `/telescope-${UNKNOWN_TOKEN}`, headers: {} },
    { path: '/pannello', authenticated: true, sessionAnomalies: ['uaChanged'], headers: {} },
    { path: '/pannello', authenticated: true, headers: {} },
    // Anomalie dichiarate su una richiesta ANONIMA: devono essere ignorate da
    // entrambi i valutatori allo stesso modo, o la foglia scatterebbe dove
    // sessione non c'è.
    { path: '/pannello', sessionAnomalies: ['uaChanged'], headers: {} },
    { path: '/scansione', reputation: ['bad'], headers: {} },
    { path: '/scansione', reputation: ['burst'], headers: {} },
  ];

  for (const node of NODES) {
    for (const spec of SPECS) {
      const label = `${JSON.stringify(node)} su ${spec.path}`;
      test(`stesso esito: ${label}`, () => {
        const compiled = compileRules([{ name: 'r', action: 'monitor', match: node }])[0].match;
        const subject = subjectFor(spec);
        expect(traceNode(compiled, subject, matcher).matched)
          .toBe(evaluateNode(compiled, subject, matcher));
      });
    }
  }
});

describe('testRequest', () => {
  const rules = compileRules([
    { name: 'allow-locale', action: 'allow', match: { ip: ['127.0.0.0/8'] } },
    { name: 'php-probe', action: 'monitor', match: { extension: ['php'] } },
    { name: 'solo-anonimi', action: 'monitor', appliesTo: 'anonymous', match: { path: '/riservato' } },
    { name: 'spenta', enabled: false, action: 'monitor', match: { path: '/spenta' } },
  ]);

  const run = (spec) => testRequest(spec, rules, matcher, { canaryRegistry });

  test('riporta la regola vincente', () => {
    const r = run({ path: '/x.php' });
    expect(r.matched.ruleName).toBe('php-probe');
    expect(r.matched.action).toBe('monitor');
  });

  test('first-match-wins: la allow in cima vince sulle successive', () => {
    const r = run({ path: '/x.php', ip: '127.0.0.1' });
    expect(r.matched.ruleName).toBe('allow-locale');
  });

  // Le regole dopo la vincitrice a runtime non sarebbero nemmeno valutate:
  // dirlo evita di far credere che siano state scartate nel merito.
  test('marca come short-circuited le regole dopo la vincitrice', () => {
    const r = run({ path: '/x.php', ip: '127.0.0.1' });
    const php = r.evaluated.find((e) => e.ruleName === 'php-probe');
    expect(php.shortCircuited).toBe(true);
  });

  test('nessun match → matched null, ma le regole restano elencate', () => {
    const r = run({ path: '/pagina-normale' });
    expect(r.matched).toBeNull();
    expect(r.evaluated.length).toBe(4);
  });

  test('dice perché una regola è stata saltata', () => {
    const spenta = run({ path: '/spenta' }).evaluated.find((e) => e.ruleName === 'spenta');
    expect(spenta.skipped).toMatch(/disabilitata/);

    const soloAnonimi = run({ path: '/riservato', authenticated: true })
      .evaluated.find((e) => e.ruleName === 'solo-anonimi');
    expect(soloAnonimi.skipped).toMatch(/appliesTo/);
  });

  // Il caso d'uso principale: «ho scritto questa regola e non scatta, perché?»
  test('per ogni condizione dice atteso e osservato', () => {
    const r = run({ path: '/pagina.html' });
    const php = r.evaluated.find((e) => e.ruleName === 'php-probe');
    expect(php.matched).toBe(false);
    const ext = php.entries.find((e) => e.leaf === 'extension');
    expect(ext.matched).toBe(false);
    expect(ext.expected).toEqual(['php']);
    expect(ext.actual).toBe('html');
  });

  test('riporta il soggetto calcolato, impronta compresa', () => {
    const r = run({ path: '/x.php', headers: { 'User-Agent': 'curl/8.5.0' } });
    expect(r.subject.extension).toBe('php');
    expect(r.subject.fp).toBeTruthy();
    expect(r.subject.fpClass.family).toBe('curl');
  });

  test('coglie l incoerenza UA ↔ impronta', () => {
    const r = run({
      path: '/x.php',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    });
    expect(r.subject.fpClass.coherent).toBe(false);
  });

  test('la query decodificata è mostrata accanto a quella grezza', () => {
    const conQuery = compileRules([{ name: 'q', action: 'monitor', match: { query: 'regex:union\\s+select' } }]);
    const r = testRequest({ path: '/a', query: 'x=1+union+select+2' }, conQuery, matcher, {});
    const entry = r.evaluated[0].entries.find((e) => e.leaf === 'query');
    expect(entry.matched).toBe(true);
    expect(String(entry.actual)).toContain('decodificata');
  });

  test('senza regole non lancia', () => {
    expect(() => testRequest({ path: '/x' }, [], matcher, {})).not.toThrow();
  });
});

describe('testRequest — globalPrefix', () => {
  test('il prefisso viene tolto prima del confronto, come a runtime', () => {
    const rules = compileRules([{ name: 'r', action: 'monitor', match: { path: '/segreta' } }]);
    const r = testRequest({ path: '/sito/segreta' }, rules, matcher, { globalPrefix: '/sito' });
    expect(r.matched).not.toBeNull();
    expect(r.subject.path).toBe('/segreta');
  });
});
