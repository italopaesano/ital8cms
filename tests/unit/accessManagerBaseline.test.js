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
  test('la `defaultPolicy` configurata continua a decidere sul sito', () => {
    for (const [action, expected] of [['allow', true], ['deny', false]]) {
      const am = managerWith({
        ital8Conf: {},
        access: { ...LITERAL_RULES, defaultPolicy: { action, redirectOnDenied: '/login' } },
      });
      expect(am.checkAccess('/qualsiasi-pagina.ejs', ANON).allowed).toBe(expected);
    }
  });

  test('`requireAuth` come defaultPolicy rende privato il sito, ed è una scelta dell\'admin', () => {
    const am = managerWith({
      access: { ...LITERAL_RULES, defaultPolicy: { action: 'requireAuth', redirectOnDenied: '/login' } },
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
  test('una regola che NEGA l\'auth in zona admin non apre il pannello', () => {
    const am = managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '/admin/**': { requiresAuth: false, allowedRoles: [] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(am.checkAccess('/admin/segreto.ejs', ANON).allowed).toBe(false);
    expect(am.rulesetProblems.map((p) => p.kind)).toContain('baseline-violation');
  });

  test('una regola che CONCEDE un ruolo vietato non lo concede davvero', () => {
    const am = managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '/admin/**': { requiresAuth: true, allowedRoles: [2] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(am.checkAccess('/admin/x.ejs', EDITOR).allowed).toBe(false);
    expect(am.checkAccess('/admin/x.ejs', ADMIN).allowed).toBe(true);
    expect(am.rulesetProblems.map((p) => p.kind)).toContain('baseline-violation');
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

  test('un segnaposto sconosciuto non diventa un letterale: la regola è scartata e segnalata', () => {
    const am = managerWith({
      access: {
        hardcodedRules: {},
        customRules: { '{{bogus}}/**': { requiresAuth: true, allowedRoles: [0] } },
        defaultPolicy: { action: 'allow', redirectOnDenied: '/login' },
      },
    });
    expect(Object.keys(am.rules)).toEqual([]);
    expect(am.rulesetProblems.map((p) => p.kind)).toEqual(['unknown-placeholder']);
  });

  test('i problemi della mappa delle zone arrivano in `rulesetProblems`', () => {
    const am = managerWith({ ital8Conf: { adminPrefix: 'a*b' } });
    expect(am.rulesetProblems.map((p) => p.kind)).toContain('zone-prefix-invalid');
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
