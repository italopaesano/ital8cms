const { validateRules, hasNestedQuantifier } = require('../../lib/ruleValidator');
const path = require('path');
const loadJson5 = require('../../../../core/loadJson5');

const rule = (over = {}) => ({
  name: 'r1',
  action: 'monitor',
  match: { path: '/x' },
  ...over,
});

describe('identità della regola', () => {
  // `name` è la chiave primaria: lega contatori, righe di log e azioni della
  // GUI. Senza, riordinare il file scollegherebbe la storia dalle regole.
  test('name mancante → regola scartata', () => {
    const r = validateRules({ rules: [{ action: 'monitor', match: { path: '/x' } }] });
    expect(r.valid).toBe(false);
    expect(r.rules).toHaveLength(0);
    expect(r.errors[0]).toMatch(/name.*obbligatorio/i);
  });

  test('nomi duplicati → la seconda è scartata', () => {
    const r = validateRules({ rules: [rule(), rule({ match: { path: '/y' } })] });
    expect(r.valid).toBe(false);
    expect(r.rules).toHaveLength(1);
    expect(r.errors[0]).toMatch(/duplicato/i);
  });

  test('una regola invalida non trascina con sé le valide', () => {
    const r = validateRules({ rules: [rule({ name: 'ok' }), { name: 'ko', action: 'inventata', match: {} }] });
    expect(r.rules.map((x) => x.name)).toEqual(['ok']);
  });
});

describe('guardrail ReDoS', () => {
  test.each([
    ['(a+)+', true],
    ['(x*)*', true],
    ['([a-z]+)+b', true],
    ['^curl/', false],
    ['/wp-(admin|login)', false],
    ['\\.php$', false],
  ])('hasNestedQuantifier(%s) → %s', (source, expected) => {
    expect(hasNestedQuantifier(source)).toBe(expected);
  });

  test('una regex con quantificatori annidati viene rifiutata', () => {
    const r = validateRules({ rules: [rule({ match: { userAgent: 'regex:(a+)+b' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ReDoS/);
  });

  test('una regex non compilabile viene rifiutata', () => {
    const r = validateRules({ rules: [rule({ match: { userAgent: 'regex:([unbalanced' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non compilabile/);
  });
});

describe('compilazione delle condizioni', () => {
  test('le regex arrivano compilate: nel percorso caldo non se ne costruiscono', () => {
    const r = validateRules({ rules: [rule({ match: { userAgent: 'regex:^curl/' } })] });
    expect(r.rules[0].match.userAgent).toBeInstanceOf(RegExp);
  });

  test('extension normalizza il punto iniziale e la maiuscola', () => {
    const r = validateRules({ rules: [rule({ match: { extension: ['.PHP', 'asp'] } })] });
    expect(Array.from(r.rules[0].match.extension).sort()).toEqual(['asp', 'php']);
  });

  test('method viene portato in maiuscolo', () => {
    const r = validateRules({ rules: [rule({ match: { method: ['trace'] } })] });
    expect(r.rules[0].match.method.has('TRACE')).toBe(true);
  });

  test('un match vuoto è un errore (matcherebbe tutto)', () => {
    const r = validateRules({ rules: [rule({ match: {} })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nessuna condizione/);
  });

  test('i path devono iniziare con "/" e non portare globalPrefix', () => {
    const r = validateRules({ rules: [rule({ match: { path: 'wp-admin' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/globalPrefix/);
  });

  test('CIDR malformato → regola scartata', () => {
    const r = validateRules({ rules: [rule({ match: { ip: ['10.0.0.0/99'] } })] });
    expect(r.valid).toBe(false);
  });

  test('chiavi sconosciute in fingerprintClass → regola scartata', () => {
    const r = validateRules({ rules: [rule({ match: { fingerprintClass: { inventata: true } } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sconosciute/);
  });

  test('i combinatori annidati vengono compilati ricorsivamente', () => {
    const r = validateRules({
      rules: [rule({ match: { all: [{ path: '/a' }, { not: { ip: ['10.0.0.0/8'] } }] } })],
    });
    expect(r.valid).toBe(true);
    expect(r.rules[0].match.all).toHaveLength(2);
  });
});

describe('parametri delle azioni', () => {
  test('decoy con percorso nel nome file → rifiutato (path traversal)', () => {
    const r = validateRules({ rules: [rule({ action: 'decoy', decoy: { file: '../../etc/passwd' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nome di file semplice/);
  });

  // Il 301 viene messo in cache dal browser in modo persistente: un falso
  // positivo dirotterebbe un utente reale per mesi e non si ripara riavviando.
  test('301 verso l esterno è vietato, non sconsigliato', () => {
    const r = validateRules(
      { rules: [rule({ action: 'redirect', redirect: { to: 'https://esempio.test/x', status: 301 } })] },
      { allowedRedirectHosts: ['esempio.test'] },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/301/);
  });

  test('un redirect esterno fuori allowlist è rifiutato', () => {
    const r = validateRules(
      { rules: [rule({ action: 'redirect', redirect: { to: 'https://altrove.test/x' } })] },
      { allowedRedirectHosts: [] },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/allowedRedirectHosts/);
  });

  test('un redirect interno è sempre ammesso', () => {
    const r = validateRules({ rules: [rule({ action: 'redirect', redirect: { to: '/non-disponibile' } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].redirect.status).toBe(302);
  });

  // Il 308 è il 301 dei metodi non-GET: stessa cache persistente nel browser,
  // stesso danno irreparabile su un falso positivo.
  test('308 verso l esterno è vietato quanto il 301', () => {
    const r = validateRules(
      { rules: [rule({ action: 'redirect', redirect: { to: 'https://esempio.test/x', status: 308 } })] },
      { allowedRedirectHosts: ['esempio.test'] },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/308/);
  });

  test('301 verso una destinazione INTERNA resta ammesso', () => {
    const r = validateRules({ rules: [rule({ action: 'redirect', redirect: { to: '/altrove', status: 301 } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].redirect.status).toBe(301);
  });

  test('uno status che non è un redirect viene rifiutato', () => {
    const r = validateRules({ rules: [rule({ action: 'redirect', redirect: { to: '/x', status: 200 } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/redirect\.status/);
  });

  // La destinazione finisce nell'header Location: un LF la chiude e ne apre un
  // altro (response splitting).
  test('redirect.to con caratteri di controllo → rifiutato', () => {
    const r = validateRules({
      rules: [rule({ action: 'redirect', redirect: { to: '/x\r\nSet-Cookie: a=b' } })],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/caratteri di controllo/);
  });
});

describe('header dichiarati da un decoy', () => {
  const decoyRule = (decoy) => rule({ action: 'decoy', decoy: { file: 'fake.html', ...decoy } });

  test('gli header validi vengono compilati', () => {
    const r = validateRules({
      rules: [decoyRule({ headers: { 'X-Powered-By': 'PHP/7.4.33', 'X-Request-Id': 42 } })],
    });
    expect(r.valid).toBe(true);
    // Un numero è comodo da scrivere in JSON5 e diventa comunque una stringa.
    expect(r.rules[0].decoy.headers).toEqual({ 'X-Powered-By': 'PHP/7.4.33', 'X-Request-Id': '42' });
  });

  test('senza headers la mappa è vuota, non undefined', () => {
    const r = validateRules({ rules: [decoyRule({})] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].decoy.headers).toEqual({});
  });

  // CR/LF in un valore chiudono l'header e ne aprono un altro, o aprono un
  // secondo messaggio HTTP.
  test.each([
    ['\r\nSet-Cookie: sid=1'],
    ['valore\nX-Altro: 1'],
    ['valore\u0000'],
  ])('un valore con caratteri di controllo (%j) è rifiutato', (value) => {
    const r = validateRules({ rules: [decoyRule({ headers: { 'X-Test': value } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/caratteri di controllo/);
  });

  test.each([
    ['Content-Length'],
    ['content-length'],
    ['Transfer-Encoding'],
    ['Set-Cookie'],
    ['Connection'],
  ])('%s non può essere dichiarato da una regola', (name) => {
    const r = validateRules({ rules: [decoyRule({ headers: { [name]: '0' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non può essere dichiarato/);
  });

  test('Content-Type invece è ammesso: serve alla credibilità', () => {
    const r = validateRules({ rules: [decoyRule({ headers: { 'Content-Type': 'text/html' } })] });
    expect(r.valid).toBe(true);
  });

  test('un nome di header non valido è rifiutato', () => {
    const r = validateRules({ rules: [decoyRule({ headers: { 'X Powered By': 'php' } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nome di header/);
  });

  test('headers non oggetto è rifiutato', () => {
    const r = validateRules({ rules: [decoyRule({ headers: ['X-Powered-By: php'] })] });
    expect(r.valid).toBe(false);
  });

  test('un decoy.status fuori intervallo è rifiutato', () => {
    const r = validateRules({ rules: [decoyRule({ status: 999 })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/decoy\.status/);
  });

  test('un decoy.status plausibile passa (401 per un finto login protetto)', () => {
    const r = validateRules({ rules: [decoyRule({ status: 401 })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].decoy.status).toBe(401);
  });

  test('escalate verso una regola rateLimiter inesistente → avviso, non errore', () => {
    const r = validateRules(
      { rules: [rule({ escalate: { rateLimiterRule: 'inesistente' } })] },
      { knownRateLimiterRules: ['scanner'] },
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/inesistente/);
  });
});

describe('coerenza dell insieme', () => {
  // Con first-match-wins è un errore facile da fare e impossibile da notare
  // guardando la singola regola.
  test('avvisa quando una allow precedente rende irraggiungibile una regola', () => {
    const r = validateRules({
      rules: [
        { name: 'a', action: 'allow', match: { path: '/x' } },
        { name: 'b', action: 'monitor', match: { path: '/x' } },
      ],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/non scattare mai/);
  });
});

describe('input degenere', () => {
  test.each([
    [null],
    [{}],
    [{ rules: 'non-un-array' }],
  ])('non lancia e restituisce zero regole: %p', (input) => {
    expect(() => validateRules(input)).not.toThrow();
    expect(validateRules(input).rules).toHaveLength(0);
  });
});

describe('set di regole distribuito', () => {
  const shipped = loadJson5(path.join(__dirname, '../../sentinelRules.default.json5'));

  test('il file distribuito è valido così com è', () => {
    const r = validateRules(shipped, { allowedRedirectHosts: [] });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.rules.length).toBeGreaterThan(0);
  });

  // La promessa fatta a chi installa: all'inizio non succede niente.
  test('NESSUNA regola distribuita blocca: il default è un osservatorio', () => {
    const r = validateRules(shipped);
    const attive = r.rules.filter((x) => x.action !== 'monitor' && x.action !== 'allow');
    expect(attive).toEqual([]);
  });

  test('ogni regola distribuita ha una categoria e una descrizione', () => {
    const r = validateRules(shipped);
    for (const x of r.rules) {
      expect(x.category).not.toBe('uncategorized');
      expect(x.description.length).toBeGreaterThan(10);
    }
  });
});
