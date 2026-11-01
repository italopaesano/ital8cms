/**
 * Unit Tests: migrazione adminAccessControl v3 → v4 (Fase 4 di path-zones).
 *
 * Porta i pattern di `accessControl.json5` dai letterali ai segnaposti e rimuove
 * le quattro regole in forma pulita, ora derivate.
 *
 * I test girano su COPIE in una cartella temporanea: lo script scrive su disco.
 *
 * → docs/decisions/path-zones.it.md · plugins/adminAccessControl/migrations/
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const migrate = require('../../../plugins/adminAccessControl/migrations/from-v3-to-v4');
const loadJson5 = require('../../../core/loadJson5');
const { resolvePathZones, resolveRuleset } = require('../../../core/pathZoneResolver');

const REPO = path.join(__dirname, '../../..');
const PLUGIN = path.join(REPO, 'plugins/adminAccessControl');

/** Il `.default` COME ERA prima della Fase 4, cioè il file vivo da migrare. */
const V3_LIVE = `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "schemaVersion": 3,
  "hardcodedRules": {
    "/admin": {
      "requiresAuth": true,
      "allowedRoles": [0, 1], // root (0), admin (1)
      "priority": 1000,
      "editable": false
    },
    "/admin/**": {
      "requiresAuth": true,
      "allowedRoles": [0, 1],
      "priority": 100,
      "editable": false
    }
  },
  "customRules": {
    // Pagina profilo utente
    "/pluginPages/adminUsers/userProfile.ejs": {
      "requiresAuth": true,
      "allowedRoles": []
    },
    "/pluginPages/adminUsers/userProfile": {
      "requiresAuth": true,
      "allowedRoles": [] // idem, forma senza estensione (hideExtension attivo)
    },

    // Pagina di login
    "/pluginPages/adminUsers/login.ejs": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/pluginPages/adminUsers/login": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/pluginPages/adminUsers/logout.ejs": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/pluginPages/adminUsers/logout": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/pluginPages/adminAccessControl/access-denied.ejs": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/pluginPages/adminAccessControl/access-denied": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    }
  },
  "defaultPolicy": {
    "action": "allow",
    "redirectOnDenied": "/pluginPages/adminUsers/login.ejs"
  }
}
`;

let workDir;
const logs = { info: [], warn: [] };
const logger = {
  info: (_t, m) => logs.info.push(m),
  warn: (_t, m) => logs.warn.push(m),
};

const livePath = () => path.join(workDir, 'accessControl.json5');
const writeLive = (content) => fs.writeFileSync(livePath(), content, 'utf8');
const readLive = () => fs.readFileSync(livePath(), 'utf8');
const patternsOf = (parsed) => Object.keys({ ...parsed.customRules, ...parsed.hardcodedRules });

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-mig-'));
  logs.info = [];
  logs.warn = [];
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('conversione ai segnaposti', () => {
  test('rinomina le sei chiavi e rimuove le quattro forme pulite', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });

    expect(patternsOf(loadJson5(livePath()))).toEqual([
      '{{pluginPages}}/adminUsers/userProfile.ejs',
      '{{pluginPages}}/adminUsers/login.ejs',
      '{{pluginPages}}/adminUsers/logout.ejs',
      '{{pluginPages}}/adminAccessControl/access-denied.ejs',
      '{{admin}}',
      '{{admin}}/**',
    ]);
  });

  test('conserva i commenti: sono metà del valore del file', async () => {
    // È il motivo per cui la migrazione è TESTUALE e non riserializza l'oggetto.
    writeLive(V3_LIVE);
    const commentsBefore = (V3_LIVE.match(/^\s*\/\//gm) || []).length;
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    const commentsAfter = (readLive().match(/^\s*\/\//gm) || []).length;

    // TUTTI i commenti a riga intera sopravvivono.
    expect(commentsAfter).toBe(commentsBefore);
    expect(readLive()).toContain('Pagina profilo utente');
    expect(readLive()).toContain('Pagina di login');
    expect(readLive()).toContain('This file follows the JSON5 standard');

    // Il commento INLINE della regola rimossa se ne va con lei: era attaccato a
    // quella riga e sarebbe rimasto orfano.
    expect(V3_LIVE).toContain('idem, forma senza estensione');
    expect(readLive()).not.toContain('idem, forma senza estensione');

    // Mentre quello inline di una regola CONSERVATA resta al suo posto.
    expect(readLive()).toContain('root (0), admin (1)');
  });

  test('il file resta JSON5 valido e conserva defaultPolicy e schemaVersion', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    const parsed = loadJson5(livePath());
    expect(parsed.schemaVersion).toBe(3); // il clock è il descrittore, non questo file
    expect(parsed.defaultPolicy).toEqual({
      action: 'allow',
      redirectOnDenied: '/pluginPages/adminUsers/login.ejs',
    });
  });

  test('è IDEMPOTENTE: il secondo passaggio non cambia nulla', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    const afterFirst = readLive();
    logs.info = [];
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(readLive()).toBe(afterFirst);
    expect(logs.info.join(' ')).toContain('già convertito');
  });

  test('`dryRun` non scrive nulla', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: true });
    expect(readLive()).toBe(V3_LIVE);
    expect(logs.info.join(' ')).toContain('dry-run');
  });

  test('senza file vivo non fa nulla: lo materializzerà il boot dal .default', async () => {
    await expect(migrate({ packageDir: workDir, loadJson5, logger, dryRun: false })).resolves.toBeUndefined();
    expect(logs.info.join(' ')).toContain('non esiste');
  });
});

describe('fail-soft: un file di sicurezza non si riscrive a tentoni', () => {
  const REFORMATTED = `{
  "hardcodedRules": { "/admin/**" : { "requiresAuth": true, "allowedRoles": [0,1] } },
  "customRules": {},
  "defaultPolicy": { "action": "allow", "redirectOnDenied": "/l" }
}
`;

  test('su un file riformattato lascia tutto INTATTO', async () => {
    writeLive(REFORMATTED);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(readLive()).toBe(REFORMATTED);
  });

  test('e DICHIARA i pattern che non ha potuto convertire', async () => {
    writeLive(REFORMATTED);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(logs.warn.join(' ')).toContain('ancoraggio testuale non combacia');
    expect(logs.warn.join(' ')).toContain('/admin/**');
  });

  test('DISTINGUE « esiste ma riformattata » da « non esiste »', async () => {
    // È il difetto 5 della revisione, e la correzione sta tutta qui: la prima
    // stesura dava LO STESSO messaggio nei due casi — « l'ancoraggio non combacia
    // (file riformattato o personalizzato) » — anche per una regola semplicemente
    // ASSENTE, mandando a cercare un problema di formattazione che non c'era.
    //
    // In REFORMATTED `/admin/**` C'È (riformattata) e `/admin` NON c'è.
    writeLive(REFORMATTED);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });

    // Quella che esiste: WARN, con il rimando alla conversione a mano.
    expect(logs.warn.join(' ')).toContain('/admin/**');
    expect(logs.warn.join(' ')).toContain('a mano');

    // Quella che non esiste: INFO, e NON un avviso sul formato.
    expect(logs.info.join(' ')).toContain('non esistono in questo file');
    expect(logs.warn.join(' ')).not.toContain('riformattato o personalizzato');
  });

  test('NON dice « già convertito » quando non ha convertito niente', async () => {
    // Difetto della prima stesura, trovato in collaudo: il messaggio ottimista
    // arrivava prima dell'avviso, quindi un file interamente riformattato
    // sembrava a posto e i pattern da sistemare non comparivano.
    writeLive(REFORMATTED);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(logs.info.join(' ')).not.toContain('già convertito');
  });

  test('una regola in forma pulita AGGIUNTA dall\'admin non viene toccata', async () => {
    // Si rimuovono solo i duplicati delle quattro pagine SPEDITE: una regola su
    // una pagina dell'amministratore non è il duplicato di niente.
    const withCustom = V3_LIVE.replace(
      `    "/pluginPages/adminAccessControl/access-denied": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    }`,
      `    "/pluginPages/adminAccessControl/access-denied": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },
    "/area-riservata": {
      "requiresAuth": true,
      "allowedRoles": [100]
    }`
    );
    writeLive(withCustom);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    const parsed = loadJson5(livePath());
    expect(parsed.customRules['/area-riservata']).toEqual({ requiresAuth: true, allowedRoles: [100] });
  });
});

describe('equivalenza: il ruleset IN VIGORE non cambia', () => {
  test('con hideExtension attivo il file migrato produce gli stessi pattern di prima', async () => {
    // È il punto della Fase 4: dieci regole dichiarate diventano sei, e le quattro
    // che mancano vengono DERIVATE. Se non fosse vero, la migrazione toglierebbe
    // protezione invece di toglierne la duplicazione.
    const conf = loadJson5(path.join(REPO, 'ital8Config.default.json5'));
    conf.hideExtension.pluginPagesPrefix.enabled = true;
    const zm = resolvePathZones(conf);

    writeLive(V3_LIVE);
    const before = loadJson5(livePath());
    const beforeResolved = resolveRuleset({ ...before.customRules, ...before.hardcodedRules }, zm);

    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    const after = loadJson5(livePath());
    const afterResolved = resolveRuleset({ ...after.customRules, ...after.hardcodedRules }, zm);

    expect(Object.keys(afterResolved.rules).sort()).toEqual(Object.keys(beforeResolved.rules).sort());
    expect(afterResolved.problems).toEqual([]);
    expect(afterResolved.derived).toHaveLength(4);
  });

  test('il file migrato coincide, per chiavi, col `.default` spedito', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(patternsOf(loadJson5(livePath())).sort())
      .toEqual(patternsOf(loadJson5(path.join(PLUGIN, 'accessControl.default.json5'))).sort());
  });
});

describe('coerenza della dichiarazione', () => {
  test('lo step dichiarato combacia con la schemaVersion del descrittore', () => {
    // Il clock: il `.default` del descrittore deve essere alla versione di arrivo
    // dell'ultimo step, altrimenti il runner non partirebbe mai.
    const steps = loadJson5(path.join(PLUGIN, 'migrations/migrations.json5')).steps;
    const descriptor = loadJson5(path.join(PLUGIN, 'pluginConfig.default.json5'));
    expect(descriptor.schemaVersion).toBe(steps[steps.length - 1].to);
  });

  test('ogni step ha un `reason` e il suo `.md`', () => {
    const steps = loadJson5(path.join(PLUGIN, 'migrations/migrations.json5')).steps;
    for (const step of steps) {
      expect(typeof step.reason).toBe('string');
      expect(step.reason.length).toBeGreaterThan(50);
      expect(fs.existsSync(path.join(PLUGIN, `migrations/from-v${step.from}-to-v${step.to}.md`))).toBe(true);
      if (step.script) {
        expect(fs.existsSync(path.join(PLUGIN, 'migrations', step.script))).toBe(true);
      }
    }
  });

  test('`accessControl.default.json5` NON è stato bumpato, ed è voluto', () => {
    // Bumparlo farebbe scattare la riconciliazione additiva su una coppia che non
    // ha nulla da aggiungere — qui si rinomina e si rimuove — con un `unresolved`
    // fuorviante. Il clock è il descrittore.
    expect(loadJson5(path.join(PLUGIN, 'accessControl.default.json5')).schemaVersion).toBe(3);
  });

  test('il `.default` spedito non contiene più letterali di prefisso', () => {
    const shipped = loadJson5(path.join(PLUGIN, 'accessControl.default.json5'));
    for (const pattern of patternsOf(shipped)) {
      expect(pattern.startsWith('{{')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regressione: i due difetti di PERDITA DATI trovati in revisione
// ─────────────────────────────────────────────────────────────────────────────
//
// Entrambi venivano da `dropRuleBlock`, la cancellazione scritta a mano dentro
// questo script quando `removeJson5Key` non esisteva ancora. Entrambi erano
// passati con 16 test verdi, perché i test provavano lo script contro l'input da
// cui era stato scritto — il `.default` appena spedito.
//
// Questi due riproducono le forme su cui perdeva dati, e girano sulla versione
// riscritta sopra `core/removeJson5Key.js`.
// → docs/decisions/json5-key-operations.it.md (Fase 4)
describe('regressione: i difetti di perdita dati della prima stesura', () => {
  test('REGOLA INLINE: la regola SUCCESSIVA non viene inghiottita', async () => {
    // Il difetto 1. `dropRuleBlock` cercava « la prima riga di chiusura dopo la
    // chiave »: su una regola scritta inline la cancellazione arrivava alla
    // chiusura di quella SUCCESSIVA. Misurato allora: 8 regole custom diventate
    // 3 invece di 4, con `isAuthEntryPoint` di logout sparito e il file ancora
    // parsabile — quindi nessun errore da nessuna parte.
    //
    // È raggiungibile dal percorso supportato dal prodotto: `saveRules()` scrive
    // la stringa grezza dell'amministratore, proprio per conservarne la forma.
    const inlineLogin = V3_LIVE.replace(
      `    "/pluginPages/adminUsers/login": {
      "requiresAuth": false,
      "allowedRoles": [],
      "isAuthEntryPoint": true
    },`,
      '    "/pluginPages/adminUsers/login": { "requiresAuth": false, "allowedRoles": [], "isAuthEntryPoint": true },'
    );
    expect(inlineLogin).not.toBe(V3_LIVE);   // l'ancoraggio del fixture esiste

    writeLive(inlineLogin);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });

    const after = loadJson5(livePath());
    // QUATTRO forme con estensione, non tre: logout.ejs deve essere ancora qui.
    expect(Object.keys(after.customRules)).toEqual([
      '{{pluginPages}}/adminUsers/userProfile.ejs',
      '{{pluginPages}}/adminUsers/login.ejs',
      '{{pluginPages}}/adminUsers/logout.ejs',
      '{{pluginPages}}/adminAccessControl/access-denied.ejs',
    ]);
    // E con il suo marcatore: senza, `reserved stop` tornerebbe a servire logout.
    expect(after.customRules['{{pluginPages}}/adminUsers/logout.ejs'].isAuthEntryPoint).toBe(true);
  });

  test('FORMA PULITA STRETTA dall admin: conservata, e dichiarata', async () => {
    // Il difetto 2. `dropRuleBlock` riceveva il nome della chiave e nient'altro,
    // quindi non poteva distinguere la regola distribuita da una modificata —
    // mentre commento, registro, CHANGELOG e messaggio di commit promettevano il
    // contrario. Con `hideExtension` acceso l'URL ricadeva sul gemello derivato
    // (`allowedRoles: []` = qualunque autenticato): una restrizione a root/admin
    // allentata in silenzio.
    const narrowed = V3_LIVE.replace(
      '      "allowedRoles": [] // idem, forma senza estensione (hideExtension attivo)',
      '      "allowedRoles": [0, 1] // STRETTO dall\'amministratore'
    );
    expect(narrowed).not.toBe(V3_LIVE);

    writeLive(narrowed);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });

    const after = loadJson5(livePath());
    // La regola stretta è ancora qui, col suo valore.
    expect(after.customRules['/pluginPages/adminUsers/userProfile']).toEqual({
      requiresAuth: true,
      allowedRoles: [0, 1],
    });
    // E lo DICHIARA, nominando la conseguenza di toglierla.
    expect(logs.warn.join(' ')).toContain('/pluginPages/adminUsers/userProfile');
    expect(logs.warn.join(' ')).toContain('cambierebbe il comportamento');
    // Le altre tre sono state rimosse: la cautela è per-regola, non globale.
    expect(after.customRules['/pluginPages/adminUsers/login']).toBeUndefined();
    expect(after.customRules['/pluginPages/adminUsers/logout']).toBeUndefined();
  });

  test('il criterio è « ancora un duplicato », non « ancora quella spedita »', async () => {
    // Se l'amministratore ha modificato il gemello `.ejs` e NON la forma pulita,
    // rimuoverla cambierebbe il comportamento: la derivazione produrrebbe al suo
    // posto il corpo MODIFICATO. « Uguale a quella spedita » sbaglierebbe qui.
    const ejsModified = V3_LIVE.replace(
      `    "/pluginPages/adminUsers/userProfile.ejs": {
      "requiresAuth": true,
      "allowedRoles": []
    },`,
      `    "/pluginPages/adminUsers/userProfile.ejs": {
      "requiresAuth": true,
      "allowedRoles": [0, 1, 2] // ALLARGATO dall'amministratore
    },`
    );
    expect(ejsModified).not.toBe(V3_LIVE);

    writeLive(ejsModified);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });

    const after = loadJson5(livePath());
    expect(after.customRules['/pluginPages/adminUsers/userProfile']).toBeDefined();
    expect(logs.warn.join(' ')).toContain('/pluginPages/adminUsers/userProfile');
  });

  test('non lascia dietro il temporaneo .migrating', async () => {
    writeLive(V3_LIVE);
    await migrate({ packageDir: workDir, loadJson5, logger, dryRun: false });
    expect(fs.readdirSync(workDir).filter((f) => f.endsWith('.migrating'))).toEqual([]);
  });
});
