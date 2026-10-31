/**
 * Unit Tests per core/accessInvariantCheck.js — le invarianti di accesso.
 *
 * Logica PURA: la funzione di decisione è un parametro, quindi i test la
 * sostituiscono con una funzione finta e misurano il gate, non il motore.
 *
 * → docs/decisions/path-zones.it.md (D6, D7)
 */

const {
  describeAccessInvariants,
  checkAccessInvariants,
  formatAccessProblemsBox,
  UNPRIVILEGED_PROBE_ROLE,
} = require('../../../core/accessInvariantCheck');

const { resolvePathZones } = require('../../../core/pathZoneResolver');

const LOGIN = '/pluginPages/adminUsers/login.ejs';

/** Decisione finta: nega tutto tranne gli URL elencati, e nega all'anonimo. */
function decider({ allowAnon = [], allowRoles = {} } = {}) {
  return (url, user) => {
    if (!user) return { allowed: allowAnon.includes(url) };
    const roles = user.roleIds || [];
    const allowedForUrl = allowRoles[url] || [];
    return { allowed: roles.some((r) => allowedForUrl.includes(r)) };
  };
}

/** Decisione che riproduce il comportamento corretto: zone chiuse ai ruoli [0,1]. */
function correctDecider(zoneMap, { loginReachable = true } = {}) {
  return (url, user) => {
    // Il login vive in `pluginPages`, zona APERTA: per simulare « login
    // irraggiungibile » bisogna negarlo esplicitamente, come farebbe una regola
    // custom con `requiresAuth` messa per errore su quel path.
    if (url === LOGIN) return { allowed: loginReachable };
    const zone = zoneMap.zones.find((z) => z.prefix !== '' && (url === z.prefix || url.startsWith(`${z.prefix}/`)));
    const baseline = zone ? zone.baseline : null;
    if (!baseline || baseline.requiresAuth !== true) return { allowed: true };
    if (!user) return { allowed: false };
    const roles = user.roleIds || [];
    return { allowed: roles.some((r) => baseline.allowedRoles.includes(r)) };
  };
}

describe('describeAccessInvariants — le sonde si DERIVANO dalle zone', () => {
  test('presidia ogni zona chiusa, e nessuna zona aperta', () => {
    const zm = resolvePathZones({});
    const probes = describeAccessInvariants(zm);
    const zones = new Set(probes.map((p) => p.id.split(':')[0]));
    expect([...zones].sort()).toEqual(['admin', 'adminThemeResources', 'views']);
  });

  test('una zona aggiunta domani sarebbe coperta senza toccare il file', () => {
    // Il presidio è che le sonde non siano un elenco scritto a mano: si contano
    // per zona chiusa, non per riga di tabella.
    const zm = resolvePathZones({});
    const closed = zm.zones.filter((z) => z.prefix !== '' && z.baseline && z.baseline.requiresAuth === true);
    const probes = describeAccessInvariants(zm);
    // Per zona: 2 path × (anonimo + non privilegiato) + un ruolo ammesso ciascuno.
    const expected = closed.reduce((sum, z) => sum + 4 + z.baseline.allowedRoles.length, 0);
    expect(probes).toHaveLength(expected);
  });

  test('segue il prefisso configurato, non il letterale', () => {
    const zm = resolvePathZones({ adminPrefix: 'backoffice' });
    const urls = describeAccessInvariants(zm).map((p) => p.url);
    expect(urls).toContain('/backoffice/');
    expect(urls.some((u) => u.startsWith('/admin/'))).toBe(false);
  });

  test('ogni zona chiusa è sondata alla radice E in profondità', () => {
    const zm = resolvePathZones({});
    const adminUrls = describeAccessInvariants(zm)
      .filter((p) => p.id.startsWith('admin:'))
      .map((p) => p.url);
    expect(adminUrls).toContain('/admin/');
    expect(adminUrls.some((u) => u.startsWith('/admin/invariant-probe/'))).toBe(true);
  });

  test('ogni ruolo ammesso ha la sua sonda di accesso CONSENTITO', () => {
    // Un presidio chiuso troppo non è sicurezza: è un pannello inaccessibile al suo
    // amministratore. Le sonde verificano anche questo verso.
    const zm = resolvePathZones({});
    const allows = describeAccessInvariants(zm).filter((p) => p.expect === 'allow');
    expect(allows.filter((p) => p.id.startsWith('admin:role'))).toHaveLength(2); // ruoli 0 e 1
  });

  test('il ruolo non privilegiato usato nelle sonde non è ammesso in nessuna zona chiusa', () => {
    const zm = resolvePathZones({});
    for (const zone of zm.zones) {
      if (!zone.baseline || zone.baseline.requiresAuth !== true) continue;
      expect(zone.baseline.allowedRoles).not.toContain(UNPRIVILEGED_PROBE_ROLE);
    }
  });

  test('la sonda del login c\'è solo se l\'URL è noto', () => {
    const zm = resolvePathZones({});
    expect(describeAccessInvariants(zm).some((p) => p.id.startsWith('login:'))).toBe(false);
    expect(describeAccessInvariants(zm, { loginUrl: LOGIN }).some((p) => p.id.startsWith('login:'))).toBe(true);
    expect(describeAccessInvariants(zm, { loginUrl: '' }).some((p) => p.id.startsWith('login:'))).toBe(false);
  });

  test('la zona di default non è sondata: non ha un prefisso da sondare', () => {
    const zm = resolvePathZones({});
    expect(describeAccessInvariants(zm).some((p) => p.id.startsWith('site:'))).toBe(false);
  });

  test('lancia se zoneMap non ha la forma attesa', () => {
    expect(() => describeAccessInvariants(null)).toThrow(TypeError);
    expect(() => describeAccessInvariants({})).toThrow(TypeError);
  });
});

describe('checkAccessInvariants', () => {
  test('una decisione corretta non produce violazioni', () => {
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(correctDecider(zm), zm, { loginUrl: LOGIN });
    expect(r.problems).toEqual([]);
    expect(r.probed).toBe(19);
  });

  test('una decisione che APRE una zona chiusa è colta', () => {
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(() => ({ allowed: true }), zm, { loginUrl: LOGIN });
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems.every((p) => p.kind === 'invariant-violation')).toBe(true);
    expect(r.problems.every((p) => p.expected === 'deny' && p.actual === 'allow')).toBe(true);
  });

  test('una decisione che CHIUDE troppo è colta anch\'essa', () => {
    // Negare a tutti supera il controllo « l'anonimo non entra » ma fallisce quello
    // « l'admin entra »: un pannello irraggiungibile non è una configurazione valida.
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(() => ({ allowed: false }), zm, { loginUrl: LOGIN });
    const denied = r.problems.filter((p) => p.expected === 'allow');
    expect(denied.length).toBeGreaterThan(0);
  });

  test('il LOOP DI REDIRECT è colto: il login non raggiungibile da anonimo', () => {
    // È la violazione peggiore della famiglia: chi viene rifiutato è mandato a una
    // pagina che lo rifiuta, e nessuno può più autenticarsi per correggere.
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(correctDecider(zm, { loginReachable: false }), zm, { loginUrl: LOGIN });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].url).toBe(LOGIN);
    expect(r.problems[0].expected).toBe('allow');
    expect(r.problems[0].detail).toContain('loop di redirect');
  });

  test('una decisione che LANCIA è essa stessa una violazione', () => {
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(() => { throw new Error('rotta'); }, zm, { loginUrl: LOGIN });
    expect(r.problems.length).toBe(r.probed);
    expect(r.problems[0].actual).toBe('throw');
    expect(r.problems[0].detail).toContain('rotta');
  });

  test('un verdetto malformato è trattato come « negato »', () => {
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(() => undefined, zm, { loginUrl: LOGIN });
    // Tutte le sonde `allow` falliscono, nessuna `deny`.
    expect(r.problems.every((p) => p.expected === 'allow')).toBe(true);
  });

  test('le violazioni nominano la sonda, l\'URL e l\'attore', () => {
    const zm = resolvePathZones({});
    const r = checkAccessInvariants(decider({}), zm, { loginUrl: LOGIN });
    const anon = r.problems.find((p) => p.roleIds === null && p.expected === 'allow');
    expect(anon.probe).toContain('login');
    expect(anon.url).toBe(LOGIN);
  });

  test('lancia se la decisione non è una funzione', () => {
    const zm = resolvePathZones({});
    expect(() => checkAccessInvariants(null, zm)).toThrow(TypeError);
  });
});

describe('formatAccessProblemsBox — diagnostico, non prescrittivo', () => {
  const box = (problems, opts) => formatAccessProblemsBox(problems, opts).join('\n');

  test('ogni riga porta il tag [ACCESS]', () => {
    const lines = formatAccessProblemsBox([{ kind: 'collision', pattern: '/x' }], { fatal: true });
    expect(lines.every((l) => l.startsWith('[ACCESS]'))).toBe(true);
  });

  test('al boot dice che il CMS non parte; a runtime che resta il ruleset precedente', () => {
    expect(box([{ kind: 'collision' }], { fatal: true })).toContain('il CMS non parte');
    expect(box([{ kind: 'collision' }], { fatal: false })).toContain('resta in vigore il ruleset precedente');
    expect(box([{ kind: 'collision' }], { fatal: false })).toContain('NON è stato modificato');
  });

  test('i problemi di ZONA sono attribuiti a ital8Config.json5, non al file delle regole', () => {
    // Mandare chi legge a cercare un prefisso dentro accessControl.json5 sarebbe un
    // messaggio diagnostico che punta al file sbagliato.
    const out = box([{ kind: 'zone-prefix-invalid', zone: 'admin', key: 'adminPrefix', prefix: '/a*b' }],
      { fatal: true, rulesFile: 'plugins/adminAccessControl/accessControl.json5' });
    expect(out).toContain('── ital8Config.json5');
    expect(out).not.toContain('── plugins/adminAccessControl/accessControl.json5');
  });

  test('i problemi del ruleset sono attribuiti al file delle regole', () => {
    const out = box([{ kind: 'collision', pattern: '/x' }], { fatal: true, rulesFile: 'plug/accessControl.json5' });
    expect(out).toContain('── plug/accessControl.json5');
  });

  test('una violazione di invariante non è attribuita a un file: è un effetto', () => {
    const out = box([{ kind: 'invariant-violation', url: '/admin/', expected: 'deny', actual: 'allow' }], { fatal: true });
    expect(out).toContain('effetto del ruleset');
  });

  test('NON prescrive una correzione', () => {
    const out = box([
      { kind: 'collision', pattern: '/x', sources: ['a', 'b'], detail: 'due pattern risolvono allo stesso URL' },
      { kind: 'baseline-violation', pattern: '/admin/**', zone: 'admin', detail: 'la regola nega l\'autenticazione' },
    ], { fatal: true });
    // Il box dichiara esplicitamente che la correzione non è sua.
    expect(out).toContain('la\n[ACCESS]  correzione resta una scelta di chi conosce l\'intento');
    expect(out).not.toMatch(/scrivi|sostituisci con|usa invece/i);
  });

  test('l\'unica eccezione è unknown-placeholder, dove la risposta è CHIUSA', () => {
    const out = box([{ kind: 'unknown-placeholder', pattern: '{{x}}/**', known: ['admin', 'site'] }], { fatal: true });
    expect(out).toContain('nomi di zona validi: admin, site');
  });

  test('nomina il pattern, la zona, le chiavi e le sorgenti quando ci sono', () => {
    const out = box([
      { kind: 'collision', pattern: '/x', sources: ['{{admin}}/x', '/x'] },
      { kind: 'zone-prefix-collision', prefixes: ['/a', '/a/b'], zones: ['admin', 'api'], keys: ['adminPrefix', 'apiPrefix'] },
    ], { fatal: true });
    expect(out).toContain('pattern "/x"');
    expect(out).toContain('da {{admin}}/x e /x');
    expect(out).toContain('prefissi /a e /a/b');
    expect(out).toContain('chiavi adminPrefix e apiPrefix');
  });

  test('il plurale è corretto anche con un problema solo', () => {
    expect(box([{ kind: 'collision' }], { fatal: true })).toContain('1 problema nel');
    expect(box([{ kind: 'collision' }, { kind: 'collision' }], { fatal: true })).toContain('2 problemi nel');
  });
});
