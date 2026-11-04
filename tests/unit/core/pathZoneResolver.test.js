/**
 * Unit Tests per core/pathZoneResolver.js — la mappa delle zone dello spazio URL
 * (`pathZones`) e la risoluzione dei segnaposti di percorso (`pathPlaceholder`).
 *
 * Logica PURA: nessun I/O, nessun mock. Vedi docs/decisions/path-zones.it.md.
 *
 * ⚠ I casi sono parametrizzati sul PREFISSO, non scritti solo su quello di default:
 * il difetto A1 esisteva proprio perché nessun test della suite usava un
 * `adminPrefix` diverso da `"admin"` (tests/integration/globalPrefix.test.js lo
 * teneva fisso a `'admin'` in tutte le sue combinazioni).
 */

const {
  resolvePathZones,
  resolveRuleset,
  resolvePattern,
  resolvePatternList,
  zoneForPath,
  tightenAccess,
  violatesBaseline,
  ZONE_NAMES,
} = require('../../../core/pathZoneResolver');

const PatternMatcher = require('../../../core/patternMatcher');

// Helper: config globale minimale, con i soli prefissi che ci interessano.
function conf(overrides = {}) {
  return {
    apiPrefix: 'api',
    adminPrefix: 'admin',
    pluginPagesPrefix: 'pluginPages',
    viewsPrefix: 'views',
    publicThemeResourcesPrefix: 'public-theme-resources',
    adminThemeResourcesPrefix: 'admin-theme-resources',
    ...overrides,
  };
}

// Helper: hideExtension acceso per un solo contesto.
function hideExt(contextKey, ext = '.ejs') {
  return { hideExtension: { [contextKey]: { enabled: true, ext } } };
}

const ADMIN_RULE = { requiresAuth: true, allowedRoles: [0, 1], priority: 100 };

describe('ZONE_NAMES — il vocabolario è chiuso', () => {
  test('contiene esattamente le sette zone della decisione', () => {
    expect([...ZONE_NAMES].sort()).toEqual([
      'admin', 'adminThemeResources', 'api', 'pluginPages',
      'publicThemeResources', 'site', 'views',
    ]);
  });

  test('è congelato (nessun consumatore può estendere il vocabolario a runtime)', () => {
    expect(Object.isFrozen(ZONE_NAMES)).toBe(true);
  });
});

describe('resolvePathZones', () => {
  test('legge i prefissi concreti dal config', () => {
    const { byName } = resolvePathZones(conf());
    expect(byName.get('admin').prefix).toBe('/admin');
    expect(byName.get('api').prefix).toBe('/api');
    expect(byName.get('pluginPages').prefix).toBe('/pluginPages');
  });

  test('un adminPrefix NON di default sposta la zona (è il cuore di A1)', () => {
    const { byName } = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
    expect(byName.get('admin').prefix).toBe('/backoffice');
  });

  test('una chiave assente ricade sul valore documentato, non su stringa vuota', () => {
    const { byName } = resolvePathZones({});
    expect(byName.get('admin').prefix).toBe('/admin');
    expect(byName.get('adminThemeResources').prefix).toBe('/admin-theme-resources');
  });

  test('una chiave vuota o di soli spazi ricade sul default', () => {
    // Un prefisso vuoto farebbe coincidere la zona con la radice del sito,
    // creando un secondo catch-all: è il caso peggiore, quindi non si accetta.
    expect(resolvePathZones(conf({ adminPrefix: '' })).byName.get('admin').prefix).toBe('/admin');
    expect(resolvePathZones(conf({ adminPrefix: '   ' })).byName.get('admin').prefix).toBe('/admin');
  });

  test.each([
    ['admin', '/admin'],
    ['/admin', '/admin'],
    ['admin/', '/admin'],
    ['/admin/', '/admin'],
    ['  admin  ', '/admin'],
    ['//admin//', '/admin'],
  ])('normalizza il prefisso %p in %p', (raw, expected) => {
    expect(resolvePathZones(conf({ adminPrefix: raw })).byName.get('admin').prefix).toBe(expected);
  });

  test('la zona `site` è la zona di default: prefisso vuoto e nessuna chiave', () => {
    const { site } = resolvePathZones(conf());
    expect(site.name).toBe('site');
    expect(site.prefix).toBe('');
    expect(site.prefixKey).toBeNull();
  });

  test('`api` ha baseline null: il suo accesso lo decide il route-wrap', () => {
    expect(resolvePathZones(conf()).byName.get('api').baseline).toBeNull();
  });

  test.each(['admin', 'adminThemeResources', 'views'])('la zona %s è chiusa ai ruoli [0,1]', (name) => {
    const zone = resolvePathZones(conf()).byName.get(name);
    expect(zone.baseline).toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test.each(['pluginPages', 'publicThemeResources', 'site'])('la zona %s è aperta', (name) => {
    const zone = resolvePathZones(conf()).byName.get(name);
    expect(zone.baseline).toEqual({ requiresAuth: false, allowedRoles: [] });
  });

  test('le zone sono ordinate per lunghezza di prefisso decrescente, `site` ultima', () => {
    const { zones } = resolvePathZones(conf());
    const lengths = zones.map((z) => z.prefix.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(zones[zones.length - 1].name).toBe('site');
  });

  test('il record di zona e il suo baseline sono congelati', () => {
    const zone = resolvePathZones(conf()).byName.get('admin');
    expect(Object.isFrozen(zone)).toBe(true);
    expect(Object.isFrozen(zone.baseline)).toBe(true);
    expect(Object.isFrozen(zone.baseline.allowedRoles)).toBe(true);
  });

  describe('estensione attiva (hideExtension)', () => {
    test('`ext` è valorizzata solo quando hideExtension è ACCESO per quel contesto', () => {
      const on = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      expect(on.byName.get('admin').ext).toBe('.ejs');
    });

    test('`ext` è null quando hideExtension è spento', () => {
      const off = resolvePathZones({ ...conf(), hideExtension: { adminPrefix: { enabled: false, ext: '.ejs' } } });
      expect(off.byName.get('admin').ext).toBeNull();
    });

    test('`ext` è null quando hideExtension manca del tutto', () => {
      expect(resolvePathZones(conf()).byName.get('admin').ext).toBeNull();
    });

    test('`ext` è null su un contesto malformato o con ext vuota', () => {
      const bad = resolvePathZones({ ...conf(), hideExtension: { adminPrefix: { enabled: true, ext: '' } } });
      expect(bad.byName.get('admin').ext).toBeNull();
      const notObj = resolvePathZones({ ...conf(), hideExtension: { adminPrefix: true } });
      expect(notObj.byName.get('admin').ext).toBeNull();
    });

    test('i contesti sono indipendenti: accenderne uno non tocca gli altri', () => {
      const { byName } = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      expect(byName.get('pluginPages').ext).toBe('.ejs');
      expect(byName.get('admin').ext).toBeNull();
      expect(byName.get('site').ext).toBeNull();
    });

    test('ogni contesto può avere la propria estensione', () => {
      const { byName } = resolvePathZones({
        ...conf(),
        hideExtension: {
          wwwPath: { enabled: true, ext: '.pug' },
          adminPrefix: { enabled: true, ext: '.ejs' },
        },
      });
      expect(byName.get('site').ext).toBe('.pug');
      expect(byName.get('admin').ext).toBe('.ejs');
    });

    test('le zone senza contesto hideExtension non hanno mai una ext', () => {
      const { byName } = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      for (const name of ['api', 'views', 'publicThemeResources', 'adminThemeResources']) {
        expect(byName.get(name).hideExtensionKey).toBeNull();
        expect(byName.get(name).ext).toBeNull();
      }
    });
  });

  describe('misconfigurazione: due zone sullo stesso prefisso', () => {
    test('viene riportata invece di far sparire una zona dentro l\'altra', () => {
      const { problems } = resolvePathZones(conf({ adminPrefix: 'api' }));
      expect(problems).toHaveLength(1);
      expect(problems[0].kind).toBe('zone-prefix-collision');
      expect(problems[0].prefix).toBe('/api');
      expect(problems[0].zones).toEqual(['admin', 'api']);
      expect(problems[0].keys).toEqual(['adminPrefix', 'apiPrefix']);
    });

    test('una configurazione sana non produce problemi', () => {
      expect(resolvePathZones(conf()).problems).toEqual([]);
      expect(resolvePathZones(conf({ adminPrefix: 'backoffice' })).problems).toEqual([]);
    });
  });

  test('lancia se ital8Conf non è un oggetto (errore del chiamante)', () => {
    expect(() => resolvePathZones(null)).toThrow(TypeError);
    expect(() => resolvePathZones('x')).toThrow(TypeError);
    expect(() => resolvePathZones([])).toThrow(TypeError);
  });
});

describe('zoneForPath', () => {
  const { zones } = resolvePathZones(conf());

  test.each([
    ['/admin', 'admin'],
    ['/admin/', 'admin'],
    ['/admin/index.ejs', 'admin'],
    ['/admin/usersManagment/userView.ejs', 'admin'],
    ['/api/adminUsers/login', 'api'],
    ['/pluginPages/x/y.ejs', 'pluginPages'],
    ['/views/x', 'views'],
    ['/admin-theme-resources/css/a.css', 'adminThemeResources'],
    ['/public-theme-resources/css/a.css', 'publicThemeResources'],
    ['/', 'site'],
    ['/about.ejs', 'site'],
    ['/media/foto.jpg', 'site'],
  ])('%p appartiene alla zona %p', (path, expected) => {
    expect(zoneForPath(path, zones).name).toBe(expected);
  });

  test.each([
    '/administrator',
    '/administrator/index.ejs',
    '/adminx',
    '/apifoo',
    '/viewsy/z',
  ])('%p NON ricade in una zona nominata: il confronto è per SEGMENTI', (path) => {
    // È la stessa semantica di `pathIsUnderSegment` in runtimeGate.js: senza di
    // essa `/administrator` erediterebbe il baseline chiuso del pannello admin,
    // e una pagina pubblica diventerebbe irraggiungibile.
    expect(zoneForPath(path, zones).name).toBe('site');
  });

  test('segue il prefisso configurato, non il letterale `/admin`', () => {
    const custom = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
    expect(zoneForPath('/backoffice/index.ejs', custom.zones).name).toBe('admin');
    // Con il pannello spostato, `/admin` è di nuovo spazio del sito.
    expect(zoneForPath('/admin/index.ejs', custom.zones).name).toBe('site');
  });

  test('un pattern wildcard appartiene alla zona del suo prefisso', () => {
    expect(zoneForPath('/admin/**', zones).name).toBe('admin');
    expect(zoneForPath('/pluginPages/*.ejs', zones).name).toBe('pluginPages');
  });

  test('un pattern regex: non ha zona determinabile dal testo', () => {
    expect(zoneForPath('regex:/admin/user/\\d+', zones)).toBeNull();
  });

  test('lancia su argomenti del tipo sbagliato', () => {
    expect(() => zoneForPath(null, zones)).toThrow(TypeError);
    expect(() => zoneForPath('/x', null)).toThrow(TypeError);
  });
});

describe('resolvePattern', () => {
  const { byName } = resolvePathZones(conf());

  test('sostituisce il segnaposto con il prefisso concreto', () => {
    expect(resolvePattern('{{admin}}/**', byName).pattern).toBe('/admin/**');
    expect(resolvePattern('{{admin}}', byName).pattern).toBe('/admin');
    expect(resolvePattern('{{pluginPages}}/adminUsers/login.ejs', byName).pattern)
      .toBe('/pluginPages/adminUsers/login.ejs');
  });

  test('segue il prefisso configurato', () => {
    const custom = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
    expect(resolvePattern('{{admin}}/**', custom.byName).pattern).toBe('/backoffice/**');
  });

  test('tollera gli spazi dentro le graffe (refuso innocuo)', () => {
    expect(resolvePattern('{{ admin }}/**', byName).pattern).toBe('/admin/**');
    expect(resolvePattern('{{admin }}', byName).pattern).toBe('/admin');
  });

  test('un letterale resta identico a sé (retrocompatibilità, D2)', () => {
    for (const p of ['/admin/**', '/admin', '/about.ejs', 'regex:/api/u/\\d+', '/content/*.ejs']) {
      expect(resolvePattern(p, byName).pattern).toBe(p);
      expect(resolvePattern(p, byName).problems).toEqual([]);
    }
  });

  test('`{{site}}` da solo è la radice del sito', () => {
    expect(resolvePattern('{{site}}', byName).pattern).toBe('/');
  });

  test('`{{site}}` come prefisso non introduce doppi slash', () => {
    expect(resolvePattern('{{site}}/about.ejs', byName).pattern).toBe('/about.ejs');
    expect(resolvePattern('{{site}}/**', byName).pattern).toBe('/**');
  });

  test('risolve più segnaposti nello stesso pattern', () => {
    expect(resolvePattern('{{admin}}{{api}}', byName).pattern).toBe('/admin/api');
  });

  test('conserva il prefisso regex: e risolve al suo interno', () => {
    expect(resolvePattern('regex:{{api}}/user/\\d+', byName).pattern).toBe('regex:/api/user/\\d+');
  });

  test('accetta anche un oggetto semplice al posto della Map', () => {
    const plain = { admin: byName.get('admin') };
    expect(resolvePattern('{{admin}}/**', plain).pattern).toBe('/admin/**');
  });

  describe('fail-closed: un segnaposto che non si risolve non diventa un letterale', () => {
    test('nome di zona sconosciuto → problema, e nessun pattern', () => {
      const r = resolvePattern('{{bogus}}/**', byName);
      expect(r.pattern).toBeNull();
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0].kind).toBe('unknown-placeholder');
      expect(r.problems[0].placeholder).toBe('bogus');
      expect(r.problems[0].known).toEqual(ZONE_NAMES);
    });

    test('il nome della CHIAVE di config non è un nome di zona', () => {
      // `{{adminPrefix}}` è l'errore che un lettore distratto commette di sicuro:
      // deve fallire rumorosamente, non silenziosamente.
      expect(resolvePattern('{{adminPrefix}}/**', byName).pattern).toBeNull();
    });

    test.each([
      '{{admin/**',
      '{admin}/**',
      '{{admin}/**',
      '{{admin}}}/**',
      '}}/**',
      '{{}}/**',
    ])('delimitatore spaiato in %p → problema, e nessun pattern', (pattern) => {
      const r = resolvePattern(pattern, byName);
      expect(r.pattern).toBeNull();
      expect(r.problems.some((p) => p.kind === 'malformed-placeholder' || p.kind === 'unknown-placeholder'))
        .toBe(true);
    });

    test.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'])(
      '%s non è una zona: il lookup non scivola sul PROTOTIPO',
      (name) => {
        // Regressione: il ramo « oggetto semplice » indicizzava senza
        // `hasOwnProperty`, quindi `{{constructor}}` pescava un valore truthy dal
        // prototipo, `zone.prefix` era `undefined` e il pattern diventava
        // `"undefined/**"` — un letterale che non matcha nessun URL, senza un fiato.
        // Stessa classe di REVIEW.md → B4.
        const plain = { admin: resolvePathZones(conf()).byName.get('admin') };
        const r = resolvePattern(`{{${name}}}/**`, plain);
        expect(r.pattern).toBeNull();
        expect(r.problems).not.toHaveLength(0);
      }
    );

    test('una mappa malformata non produce un pattern: il controllo è di FORMA', () => {
      // Non basta che la chiave esista: il valore deve essere un record di zona.
      for (const bogusMap of [{ admin: true }, { admin: {} }, { admin: { prefix: 42 } }]) {
        expect(resolvePattern('{{admin}}/**', bogusMap).pattern).toBeNull();
      }
      const asMap = new Map([['admin', { notAZone: 1 }]]);
      expect(resolvePattern('{{admin}}/**', asMap).pattern).toBeNull();
    });

    test('un pattern problematico non viene MAI restituito come stringa', () => {
      // La regressione da impedire è precisamente questa: la proposta iniziale
      // (`"ital8Conf.adminPrefix/**"`) sarebbe rimasta un letterale che non matcha
      // nessun URL → nessuna regola → defaultPolicy allow → A1 di nuovo.
      for (const bad of ['{{bogus}}', '{{admin', '{{adminPrefix}}']) {
        expect(typeof resolvePattern(bad, byName).pattern).not.toBe('string');
      }
    });
  });

  test('lancia se il pattern non è una stringa', () => {
    expect(() => resolvePattern(null, byName)).toThrow(TypeError);
    expect(() => resolvePattern(42, byName)).toThrow(TypeError);
  });
});

describe('resolveRuleset', () => {
  test('risolve tutti i pattern conservando le regole e l\'ordine', () => {
    const zm = resolvePathZones(conf());
    const { rules, problems, derived } = resolveRuleset({
      '{{admin}}': ADMIN_RULE,
      '{{admin}}/**': ADMIN_RULE,
      '/about.ejs': { requiresAuth: false },
    }, zm);

    expect(Object.keys(rules)).toEqual(['/admin', '/admin/**', '/about.ejs']);
    expect(rules['/admin']).toBe(ADMIN_RULE);
    expect(problems).toEqual([]);
    expect(derived).toEqual([]);
  });

  test('un pattern problematico è SCARTATO e gli altri sopravvivono', () => {
    const zm = resolvePathZones(conf());
    const { rules, problems } = resolveRuleset({
      '{{admin}}/**': ADMIN_RULE,
      '{{bogus}}/**': ADMIN_RULE,
      '/ok.ejs': { requiresAuth: false },
    }, zm);

    expect(Object.keys(rules)).toEqual(['/admin/**', '/ok.ejs']);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('unknown-placeholder');
  });

  describe('collisioni dopo la risoluzione', () => {
    test('due pattern che risolvono uguale con la STESSA regola sono assorbiti', () => {
      const zm = resolvePathZones(conf());
      const { rules, problems } = resolveRuleset({
        '{{admin}}/**': ADMIN_RULE,
        '/admin/**': { ...ADMIN_RULE },
      }, zm);
      expect(Object.keys(rules)).toEqual(['/admin/**']);
      expect(problems).toEqual([]);
    });

    test('due pattern che risolvono uguale con regole DIVERSE sono un problema', () => {
      // Fixture nella zona `site`, che è APERTA: così si misura la collisione e
      // SOLO la collisione. Con una fixture permissiva in zona `admin` scatterebbe
      // anche `baseline-violation` (giustamente), e il test misurerebbe due cose.
      const zm = resolvePathZones(conf());
      const { problems } = resolveRuleset({
        '{{site}}/about.ejs': { requiresAuth: true, allowedRoles: [] },
        '/about.ejs': { requiresAuth: false, allowedRoles: [] },
      }, zm);
      expect(problems).toHaveLength(1);
      expect(problems[0].kind).toBe('collision');
      expect(problems[0].pattern).toBe('/about.ejs');
      expect(problems[0].sources).toEqual(['{{site}}/about.ejs', '/about.ejs']);
    });

    test('l\'ordine delle chiavi non cambia il verdetto', () => {
      const zm = resolvePathZones(conf());
      const a = resolveRuleset({ '/admin/**': { requiresAuth: false }, '{{admin}}/**': ADMIN_RULE }, zm);
      expect(a.problems).toHaveLength(1);
      expect(a.problems[0].kind).toBe('collision');
    });
  });

  describe('derivazione della forma senza estensione (D5)', () => {
    test('con hideExtension SPENTO non deriva nulla', () => {
      const zm = resolvePathZones(conf());
      const { rules, derived } = resolveRuleset({ '{{pluginPages}}/x.ejs': ADMIN_RULE }, zm);
      expect(Object.keys(rules)).toEqual(['/pluginPages/x.ejs']);
      expect(derived).toEqual([]);
    });

    test('con hideExtension ACCESO la forma corta nasce da sé', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { rules, derived, problems } = resolveRuleset({ '{{pluginPages}}/x.ejs': ADMIN_RULE }, zm);
      expect(Object.keys(rules)).toEqual(['/pluginPages/x.ejs', '/pluginPages/x']);
      expect(derived).toEqual(['/pluginPages/x']);
      expect(problems).toEqual([]);
    });

    test('la forma ESTESA resta attiva: senza di essa il redirect rivelerebbe la pagina', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { rules } = resolveRuleset({ '{{pluginPages}}/x.ejs': ADMIN_RULE }, zm);
      expect(rules['/pluginPages/x.ejs']).toBeDefined();
      expect(rules['/pluginPages/x.ejs'].requiresAuth).toBe(true);
    });

    test('la derivata porta la stessa regola, marcata con `derivedFrom`', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { rules } = resolveRuleset({ '{{pluginPages}}/x.ejs': ADMIN_RULE }, zm);
      expect(rules['/pluginPages/x']).toEqual({ ...ADMIN_RULE, derivedFrom: '/pluginPages/x.ejs' });
    });

    test('deriva solo nella zona il cui contesto è acceso', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const { rules, derived } = resolveRuleset({
        '{{admin}}/a.ejs': ADMIN_RULE,
        '{{pluginPages}}/b.ejs': ADMIN_RULE,
      }, zm);
      expect(derived).toEqual(['/admin/a']);
      expect(rules['/pluginPages/b']).toBeUndefined();
    });

    test('non deriva da un pattern che non finisce con l\'estensione della zona', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const { derived } = resolveRuleset({ '{{admin}}/**': ADMIN_RULE, '{{admin}}/a.css': ADMIN_RULE }, zm);
      expect(derived).toEqual([]);
    });

    test('non deriva da un pattern regex: (una regex gestisce da sé il matching)', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const { derived } = resolveRuleset({ 'regex:{{admin}}/a\\.ejs': ADMIN_RULE }, zm);
      expect(derived).toEqual([]);
    });

    test('un config NON migrato con entrambe le forme identiche non produce problemi', () => {
      // È il caso reale di accessControl.default.json5 oggi: le due regole su
      // userProfile scritte a mano. La derivata viene assorbita.
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { rules, problems } = resolveRuleset({
        '{{pluginPages}}/adminUsers/userProfile.ejs': ADMIN_RULE,
        '{{pluginPages}}/adminUsers/userProfile': { ...ADMIN_RULE },
      }, zm);
      expect(problems).toEqual([]);
      expect(Object.keys(rules)).toHaveLength(2);
    });

    test('le due forme con regole DIVERSE sono un problema: servono la stessa pagina', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { problems } = resolveRuleset({
        '{{pluginPages}}/x.ejs': ADMIN_RULE,
        '{{pluginPages}}/x': { requiresAuth: false, allowedRoles: [] },
      }, zm);
      expect(problems).toHaveLength(1);
      expect(problems[0].kind).toBe('collision');
      expect(problems[0].detail).toContain('pluginPages');
    });

    test('ciò che una persona ha scritto esplicitamente vince sulla derivata', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const explicit = { requiresAuth: true, allowedRoles: [0] };
      const { rules } = resolveRuleset({
        '{{pluginPages}}/x': explicit,
        '{{pluginPages}}/x.ejs': explicit,
      }, zm);
      expect(rules['/pluginPages/x']).toBe(explicit);
      expect(rules['/pluginPages/x'].derivedFrom).toBeUndefined();
    });

    test('la derivazione segue il prefisso configurato', () => {
      const zm = resolvePathZones({ ...conf({ adminPrefix: 'backoffice' }), ...hideExt('adminPrefix') });
      const { derived } = resolveRuleset({ '{{admin}}/a.ejs': ADMIN_RULE }, zm);
      expect(derived).toEqual(['/backoffice/a']);
    });
  });

  test('lancia su argomenti del tipo sbagliato', () => {
    const zm = resolvePathZones(conf());
    expect(() => resolveRuleset(null, zm)).toThrow(TypeError);
    expect(() => resolveRuleset([], zm)).toThrow(TypeError);
    expect(() => resolveRuleset({}, null)).toThrow(TypeError);
    expect(() => resolveRuleset({}, { zones: [] })).toThrow(TypeError);
  });
});

/**
 * REGRESSIONE A1 — il presidio che mancava.
 *
 * `REVIEW.md` → A1 chiede « un test che avvii l'app con adminPrefix: "backoffice"
 * e asserisca che una GET anonima non riceva 200 ». Quello è un test di
 * INTEGRAZIONE e arriva con la Fase 2/3, quando il motore consumerà davvero
 * questa mappa. Qui si presidia il livello sottostante, che è dove il difetto
 * nasceva: il ruleset risolto deve intercettare il pannello **qualunque sia il
 * prefisso configurato**, misurato con il `patternMatcher` reale del progetto.
 */
describe('regressione A1: il pannello è intercettato con QUALUNQUE adminPrefix', () => {
  const matcher = new PatternMatcher();

  // Le regole come staranno nel .default dopo la Fase 4: segnaposti, non letterali.
  const PANEL_RULES = {
    '{{admin}}': { requiresAuth: true, allowedRoles: [0, 1], priority: 1000 },
    '{{admin}}/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100 },
  };

  test.each(['admin', 'backoffice', 'pannello', 'a-b_c', 'MixedCase'])(
    'con adminPrefix=%p ogni path del pannello trova una regola che richiede auth',
    (prefix) => {
      const zm = resolvePathZones(conf({ adminPrefix: prefix }));
      const { rules, problems } = resolveRuleset(PANEL_RULES, zm);
      expect(problems).toEqual([]);

      for (const suffix of ['', '/', '/index.ejs', '/usersManagment/index.ejs', '/a/b/c/d.ejs']) {
        const url = `/${prefix}${suffix}`;
        const rule = matcher.findMatchingRule(url, rules);
        expect(rule).not.toBeNull();
        expect(rule.requiresAuth).toBe(true);
        expect(rule.allowedRoles).toEqual([0, 1]);
      }
    }
  );

  test('il letterale `/admin/**` NON protegge un pannello spostato (il difetto)', () => {
    // Questo test documenta il comportamento ROTTO, così se qualcuno tornasse ai
    // letterali il presidio lo direbbe invece di lasciarlo passare.
    const literalRules = {
      '/admin': { requiresAuth: true, allowedRoles: [0, 1], priority: 1000 },
      '/admin/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100 },
    };
    expect(matcher.findMatchingRule('/backoffice/index.ejs', literalRules)).toBeNull();
  });

  test('le risorse del tema admin sono intercettate anche a prefisso cambiato', () => {
    const zm = resolvePathZones(conf({ adminThemeResourcesPrefix: 'risorse-admin' }));
    const { rules } = resolveRuleset({ '{{adminThemeResources}}/**': PANEL_RULES['{{admin}}/**'] }, zm);
    const rule = matcher.findMatchingRule('/risorse-admin/css/theme.css', rules);
    expect(rule).not.toBeNull();
    expect(rule.requiresAuth).toBe(true);
  });

  test('una pagina pubblica vicina di nome resta pubblica', () => {
    const zm = resolvePathZones(conf());
    const { rules } = resolveRuleset(PANEL_RULES, zm);
    // `/administrator.ejs` non deve ereditare la protezione del pannello.
    expect(matcher.findMatchingRule('/administrator.ejs', rules)).toBeNull();
  });
});

/**
 * REGRESSIONI DALLA REVISIONE DEL CODICE (2026-10-30).
 *
 * Otto difetti trovati rileggendo la Fase 1 appena scritta. Ognuno è qui con il
 * danno che faceva, perché nessuno rientri in silenzio.
 */
describe('regressioni dalla revisione', () => {
  const matcher = new PatternMatcher();

  describe('① un quantificatore regex non è un segnaposto malformato', () => {
    test.each([
      'regex:^/api/user/\\d{1,3}$',
      'regex:^/p/\\d{2}$',
      'regex:/x/[a-z]{3,}',
    ])('%s sopravvive alla risoluzione', (pattern) => {
      // Il guard sulle graffe scartava queste regex, cioè BUTTAVA VIA una regola
      // `requiresAuth` facendola ricadere nella defaultPolicy (`allow`): lo stesso
      // danno che il guard esiste per impedire, dal lato opposto.
      const { byName } = resolvePathZones(conf());
      expect(resolvePattern(pattern, byName).pattern).toBe(pattern);
    });

    test('una regola regex con quantificatore arriva nel ruleset', () => {
      const zm = resolvePathZones(conf());
      const { rules, problems } = resolveRuleset({ 'regex:^/p/\\d{2}$': ADMIN_RULE }, zm);
      expect(problems).toEqual([]);
      expect(Object.keys(rules)).toEqual(['regex:^/p/\\d{2}$']);
    });

    test('ma `{{` o `}}` doppie restano un problema anche dentro una regex', () => {
      const { byName } = resolvePathZones(conf());
      expect(resolvePattern('regex:{{api/u', byName).pattern).toBeNull();
      expect(resolvePattern('regex:/u}}', byName).pattern).toBeNull();
    });

    test('e una graffa singola FUORI da una regex resta un problema', () => {
      const { byName } = resolvePathZones(conf());
      expect(resolvePattern('{admin}/**', byName).pattern).toBeNull();
    });

    test('un segnaposto risolve anche dentro una regex con quantificatore', () => {
      const { byName } = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
      expect(resolvePattern('regex:{{admin}}/u/\\d{1,3}', byName).pattern)
        .toBe('regex:/backoffice/u/\\d{1,3}');
    });
  });

  describe('② l\'estensione si normalizza come fa koa-classic-server', () => {
    test('una ext SENZA punto è equivalente a quella col punto', () => {
      // koa-classic-server/index.cjs:30 (`normalizeExtSuffix`) accetta 'ejs' come
      // '.ejs'. Senza la stessa normalizzazione derivavamo `/pluginPages/x.`
      // invece di `/pluginPages/x`: la URL pulita che il server serve davvero non
      // matchava nessuna regola, in silenzio.
      const zm = resolvePathZones({ ...conf(), hideExtension: { pluginPagesPrefix: { enabled: true, ext: 'ejs' } } });
      expect(zm.byName.get('pluginPages').ext).toBe('.ejs');
      const { rules } = resolveRuleset({ '{{pluginPages}}/x.ejs': ADMIN_RULE }, zm);
      expect(Object.keys(rules)).toEqual(['/pluginPages/x.ejs', '/pluginPages/x']);
    });

    test('un suffisso composto è di prima classe', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix', '.html.ejs') });
      const { derived } = resolveRuleset({ '{{pluginPages}}/x.html.ejs': ADMIN_RULE }, zm);
      expect(derived).toEqual(['/pluginPages/x']);
    });

    test('una ext inutilizzabile (vuota, solo punto, non stringa) disattiva la derivazione', () => {
      for (const ext of ['', '.', 42, null]) {
        const zm = resolvePathZones({ ...conf(), hideExtension: { adminPrefix: { enabled: true, ext } } });
        expect(zm.byName.get('admin').ext).toBeNull();
      }
    });
  });

  describe('③ `**` prima dell\'estensione non ha un gemello esprimibile', () => {
    test('non si deriva un gemello PIÙ LARGO dell\'originale', () => {
      // `/admin/docs/**.ejs` → `^/admin/docs/.*\.ejs$`
      // gemello `/admin/docs/**` → `^/admin/docs/.*$`  ← matcha anche db-dump.sql
      // Con una regola permissiva il gemello apriva file che non sono pagine.
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const permissive = { requiresAuth: false, allowedRoles: [], priority: 300 };
      const { rules, derived, problems } = resolveRuleset({ '{{admin}}/docs/**.ejs': permissive }, zm);

      expect(derived).toEqual([]);
      expect(rules['/admin/docs/**']).toBeUndefined();
      // Due problemi, e sono entrambi giusti: il gemello non derivabile, e — da
      // Fase 2 — il fatto che una regola permissiva in zona `admin` allenta il
      // `baseline`. Il secondo è il presidio che rende innocuo il primo.
      expect(problems.map((p) => p.kind).sort())
        .toEqual(['baseline-violation', 'underivable-pattern']);

      // E il file che sarebbe stato esposto resta fuori da quella regola.
      expect(matcher.findMatchingRule('/admin/docs/db-dump.sql', rules)).toBeNull();
    });

    test('un `*` singolo invece ha un gemello preciso e si deriva', () => {
      // `*` è `[^/]+`: il gemello `/content/*` matcha esattamente le forme pulite.
      const zm = resolvePathZones({ ...conf(), ...hideExt('wwwPath') });
      const { derived, problems } = resolveRuleset({ '/content/*.ejs': ADMIN_RULE }, zm);
      expect(derived).toEqual(['/content/*']);
      expect(problems).toEqual([]);
    });
  });

  describe('④ un prefisso che il matcher non può rappresentare è un problema', () => {
    test('un prefisso con `*` lascerebbe la zona SCOPERTA: va detto', () => {
      // `/a*b/**` compila in `^/a[^/]+b/.*$`, che NON matcha `/a*b/index.ejs` —
      // il path letterale che il server serve. Il pannello resterebbe aperto.
      const { problems } = resolvePathZones(conf({ adminPrefix: 'a*b' }));
      expect(problems).toHaveLength(1);
      expect(problems[0].kind).toBe('zone-prefix-invalid');
      expect(problems[0].zone).toBe('admin');
      expect(problems[0].key).toBe('adminPrefix');
    });

    test('vale per ogni zona, non solo per `admin`', () => {
      // La GUI valida il charset di adminPrefix e apiPrefix
      // (plugins/admin/systemSettings.js:104) ma NON di viewsPrefix, e un
      // ital8Config.json5 scritto a mano non passa da nessun validatore: il
      // presidio sta nel punto d'uso.
      const { problems } = resolvePathZones(conf({ viewsPrefix: 'a*b' }));
      expect(problems.map((p) => p.zone)).toEqual(['views']);
    });

    test('uno spazio è un problema perché validatePattern lo rifiuta', () => {
      const { problems } = resolvePathZones(conf({ adminPrefix: 'a b' }));
      expect(problems.map((p) => p.kind)).toEqual(['zone-prefix-invalid']);
      expect(matcher.validatePattern('/a b/**').valid).toBe(false);
    });

    test('i prefissi legittimi non producono problemi', () => {
      for (const prefix of ['admin', 'backoffice', 'a-b_c', 'MixedCase', 'x2']) {
        expect(resolvePathZones(conf({ adminPrefix: prefix })).problems).toEqual([]);
      }
    });
  });

  describe('⑤ nelle collisioni vince l\'ULTIMO, come l\'object spread del chiamante', () => {
    test('una hardcoded non viene spodestata da una custom che risolve uguale', () => {
      // accessManager.loadRules() costruisce `{...customRules, ...hardcodedRules}`:
      // le hardcoded (editable: false) sovrascrivono le custom. Con « vince il
      // primo » un `{{admin}}/**` fra le custom avrebbe rovesciato la precedenza.
      const zm = resolvePathZones(conf());
      const custom = { '{{admin}}/**': { requiresAuth: false, allowedRoles: [] } };
      const hardcoded = { '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] } };
      const { rules, problems } = resolveRuleset({ ...custom, ...hardcoded }, zm);

      expect(rules['/admin/**'].requiresAuth).toBe(true);
      expect(rules['/admin/**'].allowedRoles).toEqual([0, 1]);
      expect(problems.map((p) => p.kind)).toEqual(['collision']);
    });

    test('la sovrascrittura non è comunque silenziosa', () => {
      const zm = resolvePathZones(conf());
      const { problems } = resolveRuleset({
        '{{admin}}/**': { requiresAuth: false },
        '/admin/**': { requiresAuth: true },
      }, zm);
      expect(problems).toHaveLength(1);
      expect(problems[0].sources).toEqual(['{{admin}}/**', '/admin/**']);
    });
  });

  describe('⑥ la derivazione guarda anche da PULITA a ESTESA', () => {
    test('le tre regole in forma pulita del default spedito ottengono il gemello .ejs', () => {
      // accessControl.default.json5 spedisce login, logout e userProfile in forma
      // PULITA: senza questa direzione le loro forme .ejs restavano fuori da ogni
      // regola, e un anonimo otteneva un 301 — la conferma che la pagina esiste.
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { rules, derived, problems } = resolveRuleset({
        '{{pluginPages}}/adminUsers/login': ADMIN_RULE,
        '{{pluginPages}}/adminUsers/logout': ADMIN_RULE,
        '{{pluginPages}}/adminUsers/userProfile': ADMIN_RULE,
      }, zm);

      expect(problems).toEqual([]);
      expect(derived).toEqual([
        '/pluginPages/adminUsers/login.ejs',
        '/pluginPages/adminUsers/logout.ejs',
        '/pluginPages/adminUsers/userProfile.ejs',
      ]);
      expect(rules['/pluginPages/adminUsers/login.ejs'].derivedFrom)
        .toBe('/pluginPages/adminUsers/login');
    });

    test('nessun gemello per i wildcard e per le radici, che non sono file', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const { derived } = resolveRuleset({
        '{{admin}}/**': ADMIN_RULE,
        '{{admin}}/*': ADMIN_RULE,
        '{{admin}}': ADMIN_RULE,
        '{{admin}}/sezione/': ADMIN_RULE,
      }, zm);
      expect(derived).toEqual([]);
    });

    test('nessun gemello quando l\'ultimo segmento ha già un punto', () => {
      // `koa-classic-server` matcha per suffisso, quindi `/admin/a.css` sarebbe
      // tecnicamente la forma pulita di `/admin/a.css.ejs` — ma derivare un `.ejs`
      // per ogni regola su immagini e CSS è rumore su file che non esistono.
      const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
      const { derived } = resolveRuleset({ '{{admin}}/a.css': ADMIN_RULE, '{{admin}}/b.js': ADMIN_RULE }, zm);
      expect(derived).toEqual([]);
    });

    test('la direzione pulita→estesa funziona anche nella zona `site`', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('wwwPath') });
      const { derived } = resolveRuleset({ '/riservata': ADMIN_RULE }, zm);
      expect(derived).toEqual(['/riservata.ejs']);
    });

    test('il conflitto fra le due forme è segnalato UNA volta, non una per direzione', () => {
      const zm = resolvePathZones({ ...conf(), ...hideExt('pluginPagesPrefix') });
      const { problems } = resolveRuleset({
        '{{pluginPages}}/x.ejs': ADMIN_RULE,
        '{{pluginPages}}/x': { requiresAuth: false, allowedRoles: [] },
      }, zm);
      expect(problems).toHaveLength(1);
    });
  });

  describe('⑦ un pattern vuoto non diventa la homepage', () => {
    test('una chiave vuota è un problema, non `/`', () => {
      // `{'': regola}` diventava silenziosamente `{'/': regola}`, cioè portava la
      // homepage pubblica dietro l'autenticazione senza una diagnostica.
      const zm = resolvePathZones(conf());
      const { rules, problems } = resolveRuleset({ '': { requiresAuth: true } }, zm);
      expect(rules).toEqual({});
      expect(problems.map((p) => p.kind)).toEqual(['empty-pattern']);
    });

    test('una chiave di soli spazi è lo stesso problema', () => {
      const { byName } = resolvePathZones(conf());
      expect(resolvePattern('   ', byName).problems.map((p) => p.kind)).toEqual(['empty-pattern']);
    });

    test('`{{site}}` resta la via legittima per nominare la radice', () => {
      const { byName } = resolvePathZones(conf());
      expect(resolvePattern('{{site}}', byName).pattern).toBe('/');
    });
  });

  describe('⑧ anche i prefissi ANNIDATI sono una collisione fra zone', () => {
    test('una zona annidata in un\'altra viene segnalata', () => {
      // `adminPrefix: "admin"` + `apiPrefix: "admin/api"`: il longest-match
      // consegnava `/admin/api/**` alla zona `api`, il cui baseline è `null` —
      // un pezzo di area riservata senza minimo d'accesso, in silenzio.
      const { problems, zones } = resolvePathZones(conf({ adminPrefix: 'admin', apiPrefix: 'admin/api' }));
      expect(problems).toHaveLength(1);
      expect(problems[0].kind).toBe('zone-prefix-collision');
      expect(problems[0].prefixes).toEqual(expect.arrayContaining(['/admin', '/admin/api']));
      expect(problems[0].detail).toContain('ANNIDATA');

      // Il comportamento che il problema descrive è quello reale.
      expect(zoneForPath('/admin/api/x', zones).name).toBe('api');
    });

    test('prefissi identici restano segnalati, con il dettaglio giusto', () => {
      const { problems } = resolvePathZones(conf({ adminPrefix: 'api' }));
      expect(problems).toHaveLength(1);
      expect(problems[0].prefix).toBe('/api');
      expect(problems[0].detail).toContain('stesso prefisso');
    });

    test('un prefisso che è solo un PREFISSO DI STRINGA di un altro non è annidato', () => {
      // `/api` e `/apifoo`: niente confine di segmento, nessuna sovrapposizione.
      expect(resolvePathZones(conf({ adminPrefix: 'apifoo' })).problems).toEqual([]);
    });
  });
});

/**
 * FASE 2 — il `baseline` di zona entra nel motore (D3) e la monotonia diventa
 * codice (D4). Qui le due funzioni pure; il comportamento del motore è in
 * `tests/unit/accessManagerBaseline.test.js`.
 */
describe('tightenAccess — il più stretto fra regola e baseline', () => {
  const CLOSED = { requiresAuth: true, allowedRoles: [0, 1] };
  const OPEN = { requiresAuth: false, allowedRoles: [] };

  test('una regola APERTA in zona chiusa non vince: vince il baseline', () => {
    expect(tightenAccess({ requiresAuth: false, allowedRoles: [] }, CLOSED))
      .toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test('una regola SOTTOSPECIFICATA (ruoli []) viene completata dal baseline', () => {
    // `allowedRoles: []` significa « qualsiasi autenticato »: il baseline la
    // restringe ai suoi ruoli, in silenzio, perché l'autore non ha concesso nulla.
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [] }, CLOSED))
      .toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test('una regola più STRETTA vince: [0] è un sottoinsieme di [0,1]', () => {
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [0] }, CLOSED))
      .toEqual({ requiresAuth: true, allowedRoles: [0] });
  });

  test('una regola che concede un ruolo VIETATO non lo ottiene', () => {
    // La trappola che l'intersezione avrebbe aperto: [2] ∩ [0,1] = [], che il
    // motore rileggerebbe come « qualsiasi autenticato » — un ALLENTAMENTO
    // ottenuto da un'operazione che doveva stringere.
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [2] }, CLOSED))
      .toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test('un ruolo vietato non si cola nemmeno dentro un elenco misto', () => {
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [0, 2] }, CLOSED).allowedRoles)
      .toEqual([0, 1]);
  });

  test('in zona APERTA la regola passa intatta', () => {
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [3] }, OPEN))
      .toEqual({ requiresAuth: true, allowedRoles: [3] });
  });

  test('con baseline null (zona `api`) decide solo la regola', () => {
    expect(tightenAccess({ requiresAuth: true, allowedRoles: [5] }, null))
      .toEqual({ requiresAuth: true, allowedRoles: [5] });
    expect(tightenAccess({ requiresAuth: false, allowedRoles: [] }, undefined))
      .toEqual({ requiresAuth: false, allowedRoles: [] });
  });

  test('un baseline che impone auth ma non ruoli lascia i ruoli alla regola', () => {
    const authOnly = { requiresAuth: true, allowedRoles: [] };
    expect(tightenAccess({ requiresAuth: false, allowedRoles: [7] }, authOnly))
      .toEqual({ requiresAuth: true, allowedRoles: [7] });
  });

  test('non restituisce mai un riferimento agli array di partenza', () => {
    const roles = [0];
    const out = tightenAccess({ requiresAuth: true, allowedRoles: roles }, CLOSED);
    expect(out.allowedRoles).not.toBe(roles);
    expect(out.allowedRoles).not.toBe(CLOSED.allowedRoles);
  });

  test('tollera regole malformate senza lanciare', () => {
    expect(tightenAccess({}, CLOSED)).toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
    expect(tightenAccess({ requiresAuth: 'yes', allowedRoles: 'x' }, CLOSED))
      .toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test('lancia se il requisito non è un oggetto (errore del chiamante)', () => {
    expect(() => tightenAccess(null, CLOSED)).toThrow(TypeError);
  });

  test('è idempotente: ristringere un requisito già stretto non lo cambia', () => {
    const once = tightenAccess({ requiresAuth: false, allowedRoles: [] }, CLOSED);
    expect(tightenAccess(once, CLOSED)).toEqual(once);
  });
});

describe('violatesBaseline — solo gli allentamenti ATTIVI', () => {
  const CLOSED = { requiresAuth: true, allowedRoles: [0, 1] };

  test('negare l\'autenticazione in una zona che la impone è una violazione', () => {
    expect(violatesBaseline({ requiresAuth: false, allowedRoles: [] }, CLOSED)).toBe(true);
  });

  test('concedere un ruolo che il baseline non ammette è una violazione', () => {
    expect(violatesBaseline({ requiresAuth: true, allowedRoles: [2] }, CLOSED)).toBe(true);
    expect(violatesBaseline({ requiresAuth: true, allowedRoles: [0, 2] }, CLOSED)).toBe(true);
  });

  test('essere SOTTOSPECIFICATI non è una violazione', () => {
    // Chi scrive `allowedRoles: []` non ha concesso nulla di vietato: ha scritto
    // « serve il login ». `tightenAccess` completa, senza rumore.
    expect(violatesBaseline({ requiresAuth: true, allowedRoles: [] }, CLOSED)).toBe(false);
  });

  test('essere più stretti non è una violazione', () => {
    expect(violatesBaseline({ requiresAuth: true, allowedRoles: [0] }, CLOSED)).toBe(false);
  });

  test('in zona aperta o senza baseline non c\'è niente da allentare', () => {
    expect(violatesBaseline({ requiresAuth: false }, { requiresAuth: false, allowedRoles: [] })).toBe(false);
    expect(violatesBaseline({ requiresAuth: false }, null)).toBe(false);
  });
});

describe('resolveRuleset — la monotonia è rilevata al caricamento', () => {
  test('una regola che nega l\'auth in zona chiusa è un problema', () => {
    const zm = resolvePathZones(conf());
    const { problems } = resolveRuleset({ '{{admin}}/**': { requiresAuth: false, allowedRoles: [] } }, zm);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('baseline-violation');
    expect(problems[0].zone).toBe('admin');
    expect(problems[0].detail).toContain('nega');
  });

  test('una regola che concede un ruolo vietato è un problema', () => {
    const zm = resolvePathZones(conf());
    const { problems } = resolveRuleset({ '{{admin}}/**': { requiresAuth: true, allowedRoles: [2] } }, zm);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('baseline-violation');
    expect(problems[0].ruleAccess.allowedRoles).toEqual([2]);
    expect(problems[0].baseline).toEqual({ requiresAuth: true, allowedRoles: [0, 1] });
  });

  test('le regole legittime non producono problemi', () => {
    const zm = resolvePathZones(conf());
    const { problems } = resolveRuleset({
      '{{admin}}/**': { requiresAuth: true, allowedRoles: [0, 1] },
      '{{admin}}/root-only.ejs': { requiresAuth: true, allowedRoles: [0] },
      '{{admin}}/any-logged.ejs': { requiresAuth: true, allowedRoles: [] },
      '{{pluginPages}}/adminUsers/login.ejs': { requiresAuth: false, allowedRoles: [] },
      '/about.ejs': { requiresAuth: false, allowedRoles: [] },
    }, zm);
    expect(problems).toEqual([]);
  });

  test('la violazione è segnalata una volta, non anche per la regola derivata', () => {
    const zm = resolvePathZones({ ...conf(), ...hideExt('adminPrefix') });
    const { problems, derived } = resolveRuleset(
      { '{{admin}}/x.ejs': { requiresAuth: false, allowedRoles: [] } }, zm
    );
    expect(derived).toEqual(['/admin/x']);
    expect(problems.filter((p) => p.kind === 'baseline-violation')).toHaveLength(1);
  });

  test('segue il prefisso configurato: la zona si riconosce comunque', () => {
    const zm = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
    const { problems } = resolveRuleset({ '{{admin}}/**': { requiresAuth: false } }, zm);
    expect(problems.map((p) => p.kind)).toEqual(['baseline-violation']);
  });

  test('il config SPEDITO non produce violazioni', () => {
    // Presidio contro una regressione del .default: i varchi pubblici (login,
    // logout, access-denied) vivono in `pluginPages`, zona APERTA, quindi il loro
    // `requiresAuth: false` è legittimo. Se qualcuno spostasse un varco in una
    // zona chiusa, questo test lo direbbe.
    const realConf = require('../../../core/loadJson5')(
      require('path').join(__dirname, '../../../ital8Config.default.json5')
    );
    const realRules = require('../../../core/loadJson5')(
      require('path').join(__dirname, '../../../plugins/adminAccessControl/accessControl.default.json5')
    );
    const zm = resolvePathZones(realConf);
    const merged = { ...realRules.customRules, ...realRules.hardcodedRules };
    const { problems } = resolveRuleset(merged, zm);
    expect(problems).toEqual([]);
    expect(zm.problems).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolvePatternList — la variante per gli array (Fase 5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Terza della famiglia per cardinalità. I test che contano sono quelli sulle
// proprietà che la distinguono: NON deriva, SCARTA ciò che non risolve, e lascia
// intatti i letterali estranei — quest'ultima è vitale perché `sentinel` ha una
// ventina di pattern di tecnologie altrui (`/wp-admin/**`, `/phpmyadmin/**`) che
// non sono zone di ital8cms e non devono diventare problemi.
describe('resolvePatternList', () => {
  test('risolve i segnaposti e lascia intatti i letterali', () => {
    const zm = resolvePathZones(conf());
    const out = resolvePatternList(
      ['{{admin}}/**', '{{api}}/adminUsers/login', '/wp-admin/**', '/.env'],
      zm
    );
    expect(out.patterns).toEqual(['/admin/**', '/api/adminUsers/login', '/wp-admin/**', '/.env']);
    expect(out.problems).toEqual([]);
  });

  test('segue un adminPrefix non di default', () => {
    const zm = resolvePathZones(conf({ adminPrefix: 'backoffice' }));
    expect(resolvePatternList(['{{admin}}/**'], zm).patterns).toEqual(['/backoffice/**']);
  });

  test('un segnaposto ignoto SCARTA il pattern e lo dichiara', () => {
    const zm = resolvePathZones(conf());
    const out = resolvePatternList(['{{admin}}/**', '{{nonEsiste}}/x'], zm);
    // Il fail-closed del modulo: un segnaposto irrisolto non diventa un letterale.
    expect(out.patterns).toEqual(['/admin/**']);
    expect(out.problems.map((p) => p.kind)).toEqual(['unknown-placeholder']);
  });

  test('un nome del PROTOTIPO non pesca dalla catena', () => {
    // Stessa classe di REVIEW.md → B4: `{{constructor}}` non deve diventare
    // "undefined/x", che è un letterale che non matcha nulla.
    const zm = resolvePathZones(conf());
    const out = resolvePatternList(['{{constructor}}/x', '{{toString}}/y'], zm);
    expect(out.patterns).toEqual([]);
    expect(out.problems.map((p) => p.kind)).toEqual(['unknown-placeholder', 'unknown-placeholder']);
  });

  test('NON deriva le forme senza estensione, anche con hideExtension acceso', () => {
    // Deliberato: una lista nuda non dichiara cosa significhi appartenervi, e
    // aggiungere elementi non richiesti a una lista di semantica ignota è peggio
    // che non aggiungerli. Chi deve coprire entrambe le forme usa `**`.
    const zm = resolvePathZones(conf(hideExt('pluginPagesPrefix')));
    const out = resolvePatternList(['{{pluginPages}}/adminUsers/login.ejs'], zm);
    expect(out.patterns).toEqual(['/pluginPages/adminUsers/login.ejs']);
  });

  test('conserva l ordine, che per alcuni chiamanti è semantico', () => {
    // `urlRedirect` è first-match-wins, e un riordino cambierebbe quale regola
    // vince. Qui non c'è riordino da nessuna parte: si fissa che resti così.
    const zm = resolvePathZones(conf());
    const out = resolvePatternList(['/z', '{{admin}}/a', '/b', '{{api}}/c'], zm);
    expect(out.patterns).toEqual(['/z', '/admin/a', '/b', '/api/c']);
  });

  test('una lista vuota è valida e non è un problema', () => {
    const zm = resolvePathZones(conf());
    expect(resolvePatternList([], zm)).toEqual({ patterns: [], problems: [] });
  });

  test('i path sono LOGICI: globalPrefix non entra', () => {
    // globalPrefix è il prefisso di deploy, non una zona. Chi confronta con
    // ctx.path lo toglie prima; chi emette un URL lo antepone.
    const zm = resolvePathZones(conf({ globalPrefix: '/mysite' }));
    expect(resolvePatternList(['{{admin}}/**'], zm).patterns).toEqual(['/admin/**']);
  });

  test('un elemento non-stringa è un file malformato, non un pattern malformato', () => {
    const zm = resolvePathZones(conf());
    expect(() => resolvePatternList(['/ok', 123], zm)).toThrow(TypeError);
    expect(() => resolvePatternList(['/ok', null], zm)).toThrow(/stringa/);
  });

  test('rifiuta argomenti che non sono quelli attesi', () => {
    const zm = resolvePathZones(conf());
    expect(() => resolvePatternList('/admin/**', zm)).toThrow(/must be an array/);
    expect(() => resolvePatternList(['/x'], {})).toThrow(/resolvePathZones/);
    expect(() => resolvePatternList(['/x'], null)).toThrow(/resolvePathZones/);
  });

  test('un pattern regex: con quantificatori NON è scartato', () => {
    // La trappola trovata in revisione sulla Fase 1: `\d{1,3}` ha graffe singole
    // legittime, e un controllo indiscriminato buttava via la regola.
    const zm = resolvePathZones(conf());
    const out = resolvePatternList(['regex:^/ip/\\d{1,3}$'], zm);
    expect(out.patterns).toEqual(['regex:^/ip/\\d{1,3}$']);
    expect(out.problems).toEqual([]);
  });
});
