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

  // OPEN REDIRECT. `//host` è protocol-relative dichiarata e finisce nel ramo
  // esterno; `/\host` è la stessa cosa travestita — inizia con `/`, quindi senza
  // un controllo esplicito passa come INTERNA, saltando allowlist degli host e
  // divieto dei permanenti, e il browser la normalizza andando fuori sito.
  test.each([
    ['//evil.test/x'],
    ['/\\evil.test/x'],
    ['/\\\\evil.test/x'],
  ])('la destinazione protocol-relative "%s" non passa come interna', (to) => {
    const r = validateRules({ rules: [rule({ action: 'redirect', redirect: { to } })] });
    expect(r.valid).toBe(false);
    expect(r.rules).toHaveLength(0);
  });

  // Il percorso interno legittimo non deve essere toccato dalla guardia sopra:
  // un backslash PIÙ AVANTI nel path non è protocol-relative.
  test('un backslash non iniziale non rende esterna la destinazione', () => {
    const r = validateRules({ rules: [rule({ action: 'redirect', redirect: { to: '/cartella\\strana' } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].redirect.external).toBe(false);
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

describe('foglia reputation', () => {
  test('true e i tre livelli sono ammessi', () => {
    expect(validateRules({ rules: [rule({ match: { reputation: true } })] }).valid).toBe(true);
    for (const level of ['burst', 'suspect', 'bad']) {
      const r = validateRules({ rules: [rule({ match: { reputation: [level] } })] });
      expect(r.valid).toBe(true);
      expect(r.rules[0].match.reputation.has(level)).toBe(true);
    }
  });

  test('un livello inventato è rifiutato, con l\'elenco di quelli validi', () => {
    const r = validateRules({ rules: [rule({ match: { reputation: ['pessima'] } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/pessima/);
    expect(r.errors.join(' ')).toMatch(/suspect/);
  });

  // ── La marcatura che rompe l'anello di retroazione ──
  // Se i blocchi decisi da una regola di reputazione contassero nel calcolo
  // della reputazione, il primo inciampo di un'impronta la condannerebbe per
  // sempre. Il motore esclude dal contatore le regole marcate qui.
  test('una regola che usa reputation viene marcata', () => {
    const r = validateRules({ rules: [rule({ action: 'block', match: { reputation: ['bad'] } })] });
    expect(r.rules[0].usesReputation).toBe(true);
  });

  test('la marcatura vede la foglia anche annidata nei combinatori', () => {
    const r = validateRules({
      rules: [rule({ action: 'block', match: { all: [{ path: '/x' }, { any: [{ reputation: true }] }] } })],
    });
    expect(r.rules[0].usesReputation).toBe(true);
  });

  test('la marcatura vede la foglia anche dentro un not', () => {
    const r = validateRules({
      rules: [rule({ action: 'block', match: { all: [{ path: '/x' }, { not: { reputation: ['bad'] } }] } })],
    });
    expect(r.rules[0].usesReputation).toBe(true);
  });

  test('una regola che non la usa non è marcata', () => {
    const r = validateRules({ rules: [rule({ action: 'block', match: { extension: ['php'] } })] });
    expect(r.rules[0].usesReputation).toBe(false);
  });
});

describe('azioni drop e tarpit', () => {
  test('tarpit senza parametri usa i default del plugin', () => {
    const r = validateRules({ rules: [rule({ action: 'tarpit' })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].tarpit).toEqual({ seconds: null });
  });

  test('tarpit.seconds valido viene compilato', () => {
    const r = validateRules({ rules: [rule({ action: 'tarpit', tarpit: { seconds: 12 } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].tarpit.seconds).toBe(12);
  });

  test.each([[0], [-3], ['dieci']])('tarpit.seconds non valido (%p) è rifiutato', (seconds) => {
    const r = validateRules({ rules: [rule({ action: 'tarpit', tarpit: { seconds } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/tarpit\.seconds/);
  });

  // Dietro un proxy il socket troncato è quello verso il proxy, non verso il
  // client: è una configurazione legittima che fa una cosa diversa da quella
  // che chi la scrive si aspetta, e va detto all'avvio e non scoperto dal
  // traffico. Avviso, non errore.
  test('drop dietro un proxy produce un avviso', () => {
    const r = validateRules({ rules: [rule({ action: 'drop' })] }, { behindProxy: true });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/502/);
  });

  test('drop senza proxy non avvisa', () => {
    const r = validateRules({ rules: [rule({ action: 'drop' })] }, { behindProxy: false });
    expect(r.warnings.join(' ')).not.toMatch(/502/);
  });

  test('tarpit dietro un proxy produce un avviso', () => {
    const r = validateRules({ rules: [rule({ action: 'tarpit' })] }, { behindProxy: true });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/proxy/);
  });
});

describe('foglia canary', () => {
  test.each([[true], ['any'], ['known'], ['unknown']])('%s è un valore ammesso', (value) => {
    const r = validateRules({ rules: [rule({ match: { canary: value } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].match.canary).toBe(value);
  });

  test.each([['sconosciuto'], [false], [1], [null]])('%s è rifiutato', (value) => {
    const r = validateRules({ rules: [rule({ match: { canary: value } })] });
    expect(r.valid).toBe(false);
  });

  test('canary da sola è una condizione sufficiente (il match non è vuoto)', () => {
    // Se non contasse come condizione, la regola verrebbe scartata con
    // "nessuna condizione riconosciuta" — e la trappola non esisterebbe.
    const r = validateRules({ rules: [{ name: 'trappola', action: 'block', match: { canary: true } }] });
    expect(r.valid).toBe(true);
  });
});

describe('foglia sessionAnomaly', () => {
  test('true è ammesso', () => {
    const r = validateRules({ rules: [rule({ match: { sessionAnomaly: true } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].match.sessionAnomaly).toBe(true);
  });

  test('un elenco di anomalie note viene compilato in un Set', () => {
    const r = validateRules({ rules: [rule({ match: { sessionAnomaly: ['uaChanged', 'scriptClient'] } })] });
    expect(r.valid).toBe(true);
    expect(Array.from(r.rules[0].match.sessionAnomaly).sort()).toEqual(['scriptClient', 'uaChanged']);
  });

  test('una singola anomalia si può scrivere senza array', () => {
    const r = validateRules({ rules: [rule({ match: { sessionAnomaly: 'uaChanged' } })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].match.sessionAnomaly.has('uaChanged')).toBe(true);
  });

  test('un\'anomalia inventata è rifiutata, con l\'elenco di quelle valide', () => {
    // Un refuso qui produrrebbe una regola che non scatta mai, e scoprirlo
    // richiederebbe di aspettare un attacco che non viene fermato.
    const r = validateRules({ rules: [rule({ match: { sessionAnomaly: ['uaChanged', 'inventata'] } })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/inventata/);
    expect(r.errors.join(' ')).toMatch(/uaChanged/);
  });

  test.each([[false], [[]], [1]])('%p è rifiutato', (value) => {
    const r = validateRules({ rules: [rule({ match: { sessionAnomaly: value } })] });
    expect(r.valid).toBe(false);
  });

  test('sessionAnomaly da sola è una condizione sufficiente', () => {
    const r = validateRules({
      rules: [{ name: 'sessione', action: 'block', appliesTo: 'authenticated', match: { sessionAnomaly: true } }],
    });
    expect(r.valid).toBe(true);
  });
});

describe('escalate.ban — il blocco immediato', () => {
  const banRule = (over) => rule({ action: 'block', escalate: { rateLimiterRule: 'scanner', ...over } });

  test('senza ban si conta soltanto', () => {
    const r = validateRules({ rules: [banRule({})] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].escalate.ban).toBe(false);
    expect(r.rules[0].escalate.banSeconds).toBeNull();
  });

  test('con ban e durata esplicita', () => {
    const r = validateRules({ rules: [banRule({ ban: true, banSeconds: 86400 })] });
    expect(r.valid).toBe(true);
    expect(r.rules[0].escalate).toEqual({ rateLimiterRule: 'scanner', ban: true, banSeconds: 86400 });
  });

  test('ban non booleano è rifiutato', () => {
    const r = validateRules({ rules: [banRule({ ban: 'si' })] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/escalate\.ban/);
  });

  test.each([[0], [-1], [1.5], ['3600']])('banSeconds %s è rifiutato', (value) => {
    const r = validateRules({ rules: [banRule({ ban: true, banSeconds: value })] });
    expect(r.valid).toBe(false);
  });

  test('banSeconds senza ban è un avviso, non un errore', () => {
    const r = validateRules({ rules: [banRule({ banSeconds: 600 })] });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/non ha effetto/);
  });

  // Il ban richiede l'enforcement: dichiararlo su una regola che non agisce
  // significa crederlo attivo mentre non scatterà mai.
  test.each([['monitor'], ['allow']])('ban su una regola "%s" avvisa che non avrà effetto', (action) => {
    const r = validateRules({
      rules: [rule({ action, escalate: { rateLimiterRule: 'scanner', ban: true } })],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/non avrà mai effetto/);
  });

  test('nessun avviso su una regola che agisce', () => {
    const r = validateRules({ rules: [banRule({ ban: true })] });
    expect(r.warnings.join(' ')).not.toMatch(/non avrà mai effetto/);
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
