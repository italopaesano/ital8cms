/**
 * Unit Tests: AccessManager × `baseline` di zona (Fase 2 di path-zones).
 *
 * Qui si misura il CAMBIAMENTO DI COMPORTAMENTO introdotto dalla Fase 2: ogni zona
 * dello spazio URL porta il proprio minimo d'accesso, scritto in codice, e una
 * regola può solo stringerlo (D3 + D4).
 *
 * Il test chiave è il primo: il pannello admin resta protetto con un `adminPrefix`
 * non di default E con le regole ancora scritte come LETTERALI `/admin` — cioè
 * esattamente la configurazione che produceva REVIEW.md → A1. La migrazione dei
 * pattern a segnaposti (Fase 4) è una pulizia, non la correzione.
 *
 * → docs/decisions/path-zones.it.md
 */

jest.mock('../../core/loadJson5', () => jest.fn());

const loadJson5 = require('../../core/loadJson5');
const AccessManager = require('../../plugins/adminAccessControl/lib/accessManager');

// Le regole COME SONO SPEDITE oggi: letterali, non segnaposti.
const LITERAL_RULES = Object.freeze({
  hardcodedRules: {
    '/admin': { requiresAuth: true, allowedRoles: [0, 1], priority: 1000, editable: false },
    '/admin/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100, editable: false },
  },
  customRules: {
    '/pluginPages/adminUsers/login.ejs': { requiresAuth: false, allowedRoles: [], isAuthEntryPoint: true },
  },
  defaultPolicy: { action: 'allow', redirectOnDenied: '/pluginPages/adminUsers/login.ejs' },
});

/** La pagina verso cui il motore manda chi rifiuta: dev'essere raggiungibile. */
const LOGIN_ENTRY = '/pluginPages/adminUsers/login.ejs';

const ANON = null;
const EDITOR = { roleIds: [2] };
const ADMIN = { roleIds: [1] };
const ROOT = { roleIds: [0] };

/** Istanzia un AccessManager vero, con config iniettati per path. */
function managerWith({ ital8Conf = {}, access = LITERAL_RULES, accessThrows = false } = {}) {
  loadJson5.mockImplementation((p) => {
    const file = String(p);
    if (file.endsWith('ital8Config.json5')) return ital8Conf;
    if (file.endsWith('accessControl.json5')) {
      if (accessThrows) throw new Error('config illeggibile');
      return access;
    }
    throw new Error(`loadJson5 non atteso: ${file}`);
  });
  return new AccessManager({}, '/fake/plugins/adminAccessControl');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('A1 — il pannello resta protetto con qualunque adminPrefix', () => {
  test.each(['admin', 'backoffice', 'pannello', 'a-b_c'])(
    'con adminPrefix=%p un anonimo NON entra, pur con le regole letterali `/admin`',
    (prefix) => {
      const am = managerWith({ ital8Conf: { adminPrefix: prefix } });
      for (const suffix of ['', '/', '/index.ejs', '/usersManagment/index.ejs', '/a/b/c.ejs']) {
        const result = am.checkAccess(`/${prefix}${suffix}`, ANON);
        expect(result.allowed).toBe(false);
        expect(result.redirect).toBe('/pluginPages/adminUsers/login.ejs');
      }
    }
  );

  test('un editor (ruolo 2) non entra nel pannello spostato', () => {
    const am = managerWith({ ital8Conf: { adminPrefix: 'backoffice' } });
    expect(am.checkAccess('/backoffice/', EDITOR).allowed).toBe(false);
  });

  test('admin e root entrano, nel pannello spostato come in quello di default', () => {
    for (const prefix of ['admin', 'backoffice']) {
      const am = managerWith({ ital8Conf: { adminPrefix: prefix } });
      expect(am.checkAccess(`/${prefix}/`, ADMIN).allowed).toBe(true);
      expect(am.checkAccess(`/${prefix}/`, ROOT).allowed).toBe(true);
    }
  });

  test('il motivo del rifiuto nomina il baseline quando nessuna regola matcha', () => {
    const am = managerWith({ ital8Conf: { adminPrefix: 'backoffice' } });
    expect(am.checkAccess('/backoffice/', ANON).reason).toContain('baseline');
  });

  test('una pagina pubblica vicina di nome NON eredita la protezione', () => {
    // `/administrator.ejs` sta nella zona `site`: il confronto è per segmenti.
    const am = managerWith({ ital8Conf: { adminPrefix: 'admin' } });
    expect(am.checkAccess('/administrator.ejs', ANON).allowed).toBe(true);
  });

  test('le risorse del tema admin sono protette, a qualunque prefisso', () => {
    const am = managerWith({ ital8Conf: { adminThemeResourcesPrefix: 'risorse-admin' } });
    expect(am.checkAccess('/risorse-admin/css/theme.css', ANON).allowed).toBe(false);
    expect(am.checkAccess('/risorse-admin/css/theme.css', ADMIN).allowed).toBe(true);
  });
});

describe('la protezione non dipende più dal contenuto del file', () => {
  // È il punto dell'intera decisione: prima, in ognuno di questi tre casi, il
  // pannello si apriva a chiunque.
  const DEGRADED = [
    ['regole SVUOTATE', { access: { hardcodedRules: {}, customRules: {}, defaultPolicy: { action: 'allow', redirectOnDenied: '/x' } } }],
    ['sezioni ASSENTI', { access: { defaultPolicy: { action: 'allow', redirectOnDenied: '/x' } } }],
    ['file ILLEGGIBILE', { accessThrows: true }],
  ];

  test.each(DEGRADED)('con %s il pannello resta protetto', (_label, setup) => {
    const am = managerWith({ ital8Conf: { adminPrefix: 'admin' }, ...setup });
    expect(am.checkAccess('/admin/usersManagment/index.ejs', ANON).allowed).toBe(false);
    expect(am.checkAccess('/admin/usersManagment/index.ejs', ADMIN).allowed).toBe(true);
  });

  test.each(DEGRADED)('con %s il sito pubblico continua a essere servito', (_label, setup) => {
    const am = managerWith({ ital8Conf: { adminPrefix: 'admin' }, ...setup });
    expect(am.checkAccess('/about.ejs', ANON).allowed).toBe(true);
    expect(am.checkAccess('/', ANON).allowed).toBe(true);
  });
});

describe('le zone APERTE non cambiano comportamento', () => {
  // ⚠ `redirectOnDenied` punta alla pagina di login SPEDITA, che `LITERAL_RULES`
  // esenta: senza quell'esenzione una defaultPolicy chiusa renderebbe irraggiungibile
  // il login stesso, e la sonda la rifiuterebbe. Vedi il blocco « sito privato ».
  const LOGIN = '/pluginPages/adminUsers/login.ejs';

  test('la `defaultPolicy` configurata continua a decidere sul sito', () => {
    for (const [action, expected] of [['allow', true], ['deny', false]]) {
      const am = managerWith({
        ital8Conf: {},
        access: { ...LITERAL_RULES, defaultPolicy: { action, redirectOnDenied: LOGIN } },
      });
      expect(am.checkAccess('/qualsiasi-pagina.ejs', ANON).allowed).toBe(expected);
    }
  });

  test('`requireAuth` come defaultPolicy rende privato il sito, ed è una scelta dell\'admin', () => {
    const am = managerWith({
      access: { ...LITERAL_RULES, defaultPolicy: { action: 'requireAuth', redirectOnDenied: LOGIN } },
    });
    expect(am.checkAccess('/pagina.ejs', ANON).allowed).toBe(false);
    expect(am.checkAccess('/pagina.ejs', EDITOR).allowed).toBe(true);
  });

  test('un varco di autenticazione in `pluginPages` resta pubblico', () => {
    const am = managerWith({});
    expect(am.checkAccess('/pluginPages/adminUsers/login.ejs', ANON).allowed).toBe(true);
  });

  test('una pagina di `pluginPages` senza regola segue la defaultPolicy, non un baseline', () => {
    const am = managerWith({});
    expect(am.checkAccess('/pluginPages/qualcosa/pagina.ejs', ANON).allowed).toBe(true);
  });
});

describe('monotonia a runtime (D4) — una regola può solo stringere', () => {
  test.each([
    ['nega l\'auth in zona admin', { requiresAuth: false, allowedRoles: [] }],
    ['concede un ruolo vietato', { requiresAuth: true, allowedRoles: [2] }],
  ])('una regola che %s non fa partire il CMS (Fase 3)', (_label, rule) => {
    // In Fase 2 una regola così veniva neutralizzata dal baseline e segnalata; da
    // Fase 3 è FATALE, perché il comportamento vivo differirebbe da ciò che il file
    // dichiara. Che la neutralizzazione funzioni resta provato dai test di
    // `tightenAccess` in tests/unit/core/pathZoneResolver.test.js.
    expect(() => managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '/admin/**': rule },
        defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
      },
    })).toThrow(/controllo accessi non applicabile/);
  });

  test('una regola più STRETTA invece vale: solo root', () => {
    const am = managerWith({
      access: {
        hardcodedRules: LITERAL_RULES.hardcodedRules,
        customRules: { '/admin/pericoloso.ejs': { requiresAuth: true, allowedRoles: [0] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(am.checkAccess('/admin/pericoloso.ejs', ROOT).allowed).toBe(true);
    expect(am.checkAccess('/admin/pericoloso.ejs', ADMIN).allowed).toBe(false);
    expect(am.rulesetProblems).toEqual([]);
  });

  test('una regola sottospecificata (ruoli []) viene completata dal baseline', () => {
    const am = managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '/admin/**': { requiresAuth: true, allowedRoles: [] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(am.checkAccess('/admin/x.ejs', EDITOR).allowed).toBe(false); // il baseline impone [0,1]
    expect(am.checkAccess('/admin/x.ejs', ADMIN).allowed).toBe(true);
    expect(am.rulesetProblems).toEqual([]); // sottospecificare non è una violazione
  });

  test('la zona si ricava dalla URL, non dal pattern: una regex non può allentare', () => {
    // Al caricamento la zona di un `regex:` non è determinabile dal testo, quindi
    // la violazione non si VEDE lì. A runtime però il motore ricava la zona dalla
    // URL richiesta, e il baseline si applica comunque. I due livelli coprono
    // insiemi diversi, ed è il motivo per cui ci sono entrambi.
    const am = managerWith({
      access: {
        hardcodedRules: {},
        customRules: { 'regex:^/admin/.*$': { requiresAuth: false, allowedRoles: [] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(am.rulesetProblems).toEqual([]); // non rilevabile al caricamento…
    expect(am.checkAccess('/admin/x.ejs', ANON).allowed).toBe(false); // …ma non vale comunque
  });
});

describe('risoluzione dei segnaposti dentro il motore', () => {
  test('una regola scritta con `{{admin}}` segue il prefisso configurato', () => {
    const am = managerWith({
      ital8Conf: { adminPrefix: 'backoffice' },
      access: {
        hardcodedRules: {},
        customRules: { '{{admin}}/solo-root.ejs': { requiresAuth: true, allowedRoles: [0] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(Object.keys(am.rules)).toContain('/backoffice/solo-root.ejs');
    expect(am.checkAccess('/backoffice/solo-root.ejs', ADMIN).allowed).toBe(false);
    expect(am.checkAccess('/backoffice/solo-root.ejs', ROOT).allowed).toBe(true);
  });

  test('un segnaposto sconosciuto non fa partire il CMS', () => {
    expect(() => managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '{{bogus}}/**': { requiresAuth: true, allowedRoles: [0] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
      },
    })).toThrow(/controllo accessi non applicabile/);
  });

  test('anche un problema della MAPPA DELLE ZONE è fatale', () => {
    // `adminPrefix: "a*b"` lascerebbe la zona scoperta: il difetto non sta nel file
    // delle regole ma in ital8Config.json5, e il box lo attribuisce a quel file.
    expect(() => managerWith({ ital8Conf: { adminPrefix: 'a*b' } }))
      .toThrow(/controllo accessi non applicabile/);
  });

  test('`reloadRules()` ricalcola regole e problemi', () => {
    const am = managerWith({});
    expect(am.rulesetProblems).toEqual([]);
    loadJson5.mockImplementation((p) => (String(p).endsWith('ital8Config.json5')
      ? { adminPrefix: 'admin' }
      : {
        hardcodedRules: {},
        customRules: { '{{bogus}}/**': { requiresAuth: true } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      }));
    am.reloadRules();
    expect(am.rulesetProblems.map((p) => p.kind)).toEqual(['unknown-placeholder']);
  });
});

/**
 * FASE 3 — il comportamento asimmetrico al fallimento (D7) e il presidio
 * pre-scrittura sul salvataggio dalla GUI.
 */
describe('fallimento asimmetrico: fatale al boot, rifiuto a runtime', () => {
  const BROKEN = {
    hardcodedRules: {},
    customRules: { '{{bogus}}/**': { requiresAuth: true, allowedRoles: [0] } },
    defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
  };

  test('al BOOT lancia, e non chiama process.exit', () => {
    // La fatalità appartiene a `pluginSys`, che per un plugin in `essentialPlugins`
    // emette `[FATAL]` e termina. Un `process.exit` da dentro un plugin
    // scavalcherebbe quella macchina.
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit non deve essere chiamato da un plugin');
    });
    expect(() => managerWith({ access: BROKEN })).toThrow(/controllo accessi non applicabile/);
    expect(exit).not.toHaveBeenCalled();
  });

  test('l\'errore del boot porta con sé i problemi, per chi lo intercetta', () => {
    let caught = null;
    try { managerWith({ access: BROKEN }); } catch (err) { caught = err; }
    expect(Array.isArray(caught.ital8AccessProblems)).toBe(true);
    expect(caught.ital8AccessProblems.map((p) => p.kind)).toContain('unknown-placeholder');
  });

  test('al boot il box è stampato come ERRORE, non come avviso', () => {
    try { managerWith({ access: BROKEN }); } catch (_) { /* atteso */ }
    const emitted = console.error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(emitted).toContain('[ACCESS]');
    expect(emitted).toContain('il CMS non parte');
  });

  test('a RUNTIME non lancia: rifiuta il candidato e tiene il ruleset precedente', () => {
    const am = managerWith({});
    const before = Object.keys(am.rules);
    expect(before.length).toBeGreaterThan(0);

    loadJson5.mockImplementation((p) => (String(p).endsWith('ital8Config.json5') ? {} : BROKEN));
    const outcome = am.reloadRules();

    expect(outcome.accepted).toBe(false);
    expect(Object.keys(am.rules)).toEqual(before); // ← il punto di D7
    expect(am.checkAccess('/admin/x.ejs', ANON).allowed).toBe(false);
  });

  test('a runtime il box è un AVVISO e dice che il file non è stato toccato', () => {
    const am = managerWith({});
    loadJson5.mockImplementation((p) => (String(p).endsWith('ital8Config.json5') ? {} : BROKEN));
    am.reloadRules();
    const emitted = console.warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(emitted).toContain('resta in vigore il ruleset precedente');
  });

  test('un file diventato ILLEGGIBILE a runtime non fa perdere il ruleset vivo', () => {
    const am = managerWith({});
    const before = Object.keys(am.rules);
    loadJson5.mockImplementation((p) => {
      if (String(p).endsWith('ital8Config.json5')) return {};
      throw new Error('illeggibile');
    });
    const outcome = am.reloadRules();
    expect(outcome.accepted).toBe(false);
    expect(Object.keys(am.rules)).toEqual(before);
  });

  test('un ruleset sano a runtime viene invece accettato', () => {
    const am = managerWith({});
    loadJson5.mockImplementation((p) => (String(p).endsWith('ital8Config.json5') ? {} : {
      hardcodedRules: LITERAL_RULES.hardcodedRules,
      customRules: {
        ...LITERAL_RULES.customRules,
        '/admin/solo-root.ejs': { requiresAuth: true, allowedRoles: [0] },
      },
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));
    const outcome = am.reloadRules();
    expect(outcome.accepted).toBe(true);
    expect(am.rulesetProblems).toEqual([]);
    expect(am.checkAccess('/admin/solo-root.ejs', ADMIN).allowed).toBe(false);
    expect(am.checkAccess('/admin/solo-root.ejs', ROOT).allowed).toBe(true);
  });
});

describe('saveRules: un file che non farebbe ripartire il CMS non può essere salvato', () => {
  const fs = require('fs');

  function managerForSave() {
    const am = managerWith({});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
    return am;
  }

  test('rifiuta PRIMA di scrivere, e non scrive affatto', () => {
    // Senza questo presidio la sequenza era: valida (col validatore della GUI, che
    // non conosce zone né segnaposti) → SCRIVE → ricarica → la ricarica rifiuta →
    // la GUI dice « salvato » → al riavvio successivo il CMS non parte.
    const am = managerForSave();
    const result = am.saveRules(JSON.stringify({
      hardcodedRules: {},
      customRules: { '{{bogus}}/**': { requiresAuth: true } },
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));

    expect(result.success).toBe(false);
    expect(result.problems.map((p) => p.kind)).toContain('unknown-placeholder');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  test('rifiuta una regola che allenta il baseline di zona', () => {
    const am = managerForSave();
    const result = am.saveRules(JSON.stringify({
      hardcodedRules: {},
      customRules: { '/admin/**': { requiresAuth: false, allowedRoles: [] } },
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));
    expect(result.success).toBe(false);
    expect(result.problems.map((p) => p.kind)).toContain('baseline-violation');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('rifiuta un ruleset che rende irraggiungibile la pagina di login', () => {
    // La risoluzione da sola non lo vedrebbe: il ruleset è perfettamente valido.
    // Lo vede solo la sonda, misurando l'EFFETTO.
    const am = managerForSave();
    const result = am.saveRules(JSON.stringify({
      hardcodedRules: {},
      customRules: { [LOGIN_ENTRY]: { requiresAuth: true, allowedRoles: [0] } },
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));
    expect(result.success).toBe(false);
    expect(result.problems.map((p) => p.kind)).toContain('invariant-violation');
    expect(result.problems.find((p) => p.kind === 'invariant-violation').detail)
      .toContain('loop di redirect');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('rifiuta JSON5 malformato senza scrivere', () => {
    const am = managerForSave();
    const result = am.saveRules('{ questo non è JSON5 valido {{{');
    expect(result.success).toBe(false);
    expect(result.problems.map((p) => p.kind)).toEqual(['json5-syntax']);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('un ruleset sano viene scritto', () => {
    const am = managerForSave();
    const result = am.saveRules(JSON.stringify({
      hardcodedRules: LITERAL_RULES.hardcodedRules,
      customRules: LITERAL_RULES.customRules,
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));
    expect(result.success).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalled();
  });

  test('`validateCandidate` non tocca il ruleset vivo', () => {
    const am = managerWith({});
    const before = Object.keys(am.rules);
    am.validateCandidate(JSON.stringify({
      hardcodedRules: {}, customRules: { '{{bogus}}/**': {} },
      defaultPolicy: { action: 'allow', redirectOnDenied: LOGIN_ENTRY },
    }));
    expect(Object.keys(am.rules)).toEqual(before);
  });
});

describe('presidio: la fatalità del boot dipende da `essentialPlugins`', () => {
  test('`adminAccessControl` è fra gli essentialPlugins del config spedito', () => {
    // `loadRules` LANCIA invece di chiamare `process.exit`, quindi la terminazione la
    // decide `pluginSys`: lo fa solo per i plugin in questa lista. Togliendo questo
    // nome, un controllo accessi non applicabile non spegnerebbe il boot — il plugin
    // verrebbe soltanto saltato, e il sito servito SENZA GUARDIA. L'invariante regge
    // per configurazione, quindi va presidiata qui.
    const realLoadJson5 = jest.requireActual('../../core/loadJson5');
    const conf = realLoadJson5(require('path').join(__dirname, '../../ital8Config.default.json5'));
    expect(Array.isArray(conf.essentialPlugins)).toBe(true);
    expect(conf.essentialPlugins).toContain('adminAccessControl');
  });
});
