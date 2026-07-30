/**
 * Unit Tests per core/migrationRunner.js — esecuzione delle migrazioni di
 * configurazione dichiarate in `migrations/` (docs/decisions/config-migrations.it.md).
 *
 * Il clock è la `schemaVersion` del descrittore: il vivo dice dove sta
 * l'installazione, il `.default` dove è arrivato il codice, e la differenza è la
 * catena da percorrere. I test costruiscono pacchetti finti in una tmpdir con la
 * stessa struttura di un plugin reale.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const migrationRunner = require('../../../core/migrationRunner');
const loadJson5 = require('../../../core/loadJson5');

const HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported';

let root;
let logSpy;
let warnSpy;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrationRunner-'));
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'themes'), { recursive: true });
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

/**
 * Crea un plugin con descrittore vivo + default e, se richiesto, la cartella
 * migrations/ con il suo indice.
 */
function makePlugin(name, { liveVersion, defaultVersion, liveExtra = '', defaultExtra = '', steps, files = {} }) {
  const dir = path.join(root, 'plugins', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pluginConfig.default.json5'),
    `${HEADER}\n{\n  "schemaVersion": ${defaultVersion},\n  "active": 1,\n${defaultExtra}}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'pluginConfig.json5'),
    `${HEADER}\n{\n  "schemaVersion": ${liveVersion},\n  "active": 1,\n${liveExtra}}\n`, 'utf8');

  if (steps) {
    const mdir = path.join(dir, migrationRunner.MIGRATIONS_DIR);
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(mdir, migrationRunner.MIGRATIONS_INDEX),
      `${HEADER}\n{ schemaVersion: 1, steps: ${JSON.stringify(steps, null, 2)} }\n`, 'utf8');
    for (const [fileName, content] of Object.entries(files)) {
      const full = path.join(mdir, fileName);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }
  return dir;
}

const autoStep = (from, to, extra = {}) => ({
  from, to, title: `step ${from}→${to}`, automatic: true,
  reason: 'Sola aggiunta di chiavi: il merge additivo basta.',
  touches: ['pluginConfig.json5'], ...extra,
});

const target = (name) => migrationRunner.resolveTarget(root, name);

describe('readPlan', () => {
  test('vivo allineato al default → aligned, nessuno step', () => {
    makePlugin('p', { liveVersion: 2, defaultVersion: 2, steps: [autoStep(1, 2)] });
    expect(migrationRunner.readPlan(target('p')).status).toBe('aligned');
  });

  test('senza cartella migrations/ → no-migrations (resta il merge additivo del boot)', () => {
    makePlugin('p', { liveVersion: 1, defaultVersion: 2 });
    const plan = migrationRunner.readPlan(target('p'));
    expect(plan.status).toBe('no-migrations');
    expect(plan.hasMigrationsDir).toBe(false);
  });

  test('seleziona i soli step nel salto da percorrere', () => {
    makePlugin('p', {
      liveVersion: 2, defaultVersion: 4,
      steps: [autoStep(1, 2), autoStep(2, 3), autoStep(3, 4)],
    });
    const plan = migrationRunner.readPlan(target('p'));
    expect(plan.status).toBe('ok');
    expect(plan.pending.map((s) => `${s.from}->${s.to}`)).toEqual(['2->3', '3->4']);
  });

  test('catena che non copre l\'intero salto → incomplete-chain', () => {
    makePlugin('p', { liveVersion: 1, defaultVersion: 3, steps: [autoStep(1, 2)] });
    const plan = migrationRunner.readPlan(target('p'));
    expect(plan.status).toBe('incomplete-chain');
    expect(plan.errors[0]).toMatch(/non copre l'intero salto/);
  });
});

describe('validazione di migrations.json5', () => {
  const invalid = (steps) => {
    makePlugin('bad', { liveVersion: 1, defaultVersion: 2, steps });
    return migrationRunner.readPlan(target('bad'));
  };

  test('reason mancante → invalido, anche su uno step automatico', () => {
    const plan = invalid([{ from: 1, to: 2, title: 't', automatic: true, touches: [] }]);
    expect(plan.status).toBe('invalid');
    expect(plan.errors.join(' ')).toMatch(/"reason" è obbligatorio/);
  });

  test('step manuale senza doc → invalido', () => {
    const plan = invalid([{ from: 1, to: 2, title: 't', automatic: false, reason: 'r', touches: [] }]);
    expect(plan.status).toBe('invalid');
    expect(plan.errors.join(' ')).toMatch(/deve indicare il file "doc"/);
  });

  test('script dichiarato ma assente → invalido', () => {
    const plan = invalid([autoStep(1, 2, { script: 'manca.js' })]);
    expect(plan.status).toBe('invalid');
    expect(plan.errors.join(' ')).toMatch(/script dichiarato ma non trovato/);
  });

  test('salto non unitario → invalido', () => {
    const plan = invalid([{ ...autoStep(1, 2), to: 3 }]);
    expect(plan.status).toBe('invalid');
    expect(plan.errors.join(' ')).toMatch(/salto non unitario/);
  });

  test('catena con un buco → invalido', () => {
    makePlugin('gap', {
      liveVersion: 1, defaultVersion: 4,
      steps: [autoStep(1, 2), autoStep(3, 4)],
    });
    const plan = migrationRunner.readPlan(target('gap'));
    expect(plan.status).toBe('invalid');
    expect(plan.errors.join(' ')).toMatch(/catena non contigua/);
  });

  test('automatic senza script è legittimo: le sole aggiunte le fa il merge', () => {
    makePlugin('ok', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
      steps: [autoStep(1, 2)],
    });
    expect(migrationRunner.readPlan(target('ok')).status).toBe('ok');
  });
});

describe('runMigrations', () => {
  test('step automatico senza script: il merge aggiunge la chiave e la versione avanza', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "showBanner": true, "dataPath": "./data" },\n',
      liveExtra: '  "custom": { "showBanner": false },\n',
      steps: [autoStep(1, 2)],
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.errors).toEqual([]);
    expect(res.applied).toHaveLength(1);
    expect(res.applied[0].added).toEqual(['custom.dataPath']);
    const live = loadJson5(path.join(root, 'plugins/p/pluginConfig.json5'));
    expect(live.schemaVersion).toBe(2);
    expect(live.custom).toEqual({ showBanner: false, dataPath: './data' }); // scelta utente intatta
  });

  test('step con script: rinomina una chiave, cosa che il merge non sa fare', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuovoNome": 7 },\n',
      liveExtra: '  "custom": { "vecchioNome": 7 },\n',
      steps: [autoStep(1, 2, { script: 'from-v1-to-v2.js', reason: 'Rinomina: serve uno script.' })],
      files: {
        'from-v1-to-v2.js': `
module.exports = {
  async migrate(ctx) {
    if (ctx.dryRun) return { changed: [], notes: ['dry-run'] };
    const cfg = ctx.loadJson5(ctx.configPath);
    const value = cfg.custom.vecchioNome;
    delete cfg.custom.vecchioNome;
    cfg.custom.nuovoNome = value;
    await ctx.saveJson5(ctx.configPath, cfg);
    return { changed: ['custom.nuovoNome'] };
  },
};
`,
      },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.errors).toEqual([]);
    const live = loadJson5(path.join(root, 'plugins/p/pluginConfig.json5'));
    expect(live.custom.nuovoNome).toBe(7);
    expect(live.custom.vecchioNome).toBeUndefined();
    expect(live.schemaVersion).toBe(2);
  });

  test('dry-run: nessuna scrittura, nessun backup, versione ferma', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
      steps: [autoStep(1, 2)],
    });
    const before = fs.readFileSync(path.join(root, 'plugins/p/pluginConfig.json5'), 'utf8');

    const res = await migrationRunner.runMigrations(target('p'), { dryRun: true });

    expect(res.dryRun).toBe(true);
    expect(res.applied).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'plugins/p/pluginConfig.json5'), 'utf8')).toBe(before);
    expect(fs.readdirSync(path.join(root, 'plugins/p')).filter((f) => f.includes('.backup-'))).toEqual([]);
  });

  test('backup dei file in touches prima di toccarli', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
      steps: [autoStep(1, 2)],
    });

    await migrationRunner.runMigrations(target('p'));

    const backups = fs.readdirSync(path.join(root, 'plugins/p')).filter((f) => f.includes('.backup-v1-'));
    expect(backups).toHaveLength(1);
    expect(loadJson5(path.join(root, 'plugins/p', backups[0])).schemaVersion).toBe(1);
  });

  test('script che lancia → la versione NON avanza (è una ricevuta, non un tentativo)', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      steps: [autoStep(1, 2, { script: 'from-v1-to-v2.js' })],
      files: { 'from-v1-to-v2.js': 'module.exports = { async migrate() { throw new Error("boom"); } };\n' },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.errors.join(' ')).toMatch(/boom/);
    expect(res.stopped.needs).toBe('error');
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(1);
  });

  test('script e merge sono complementari: una chiave del default rimossa dallo script viene ripristinata', async () => {
    // Lo script non deve preoccuparsi delle aggiunte: il merge additivo gira DOPO
    // e completa ciò che manca rispetto al default. Qui lo si verifica al limite —
    // anche una rimozione accidentale di una chiave ancora dichiarata nel default
    // viene sanata, e la postcondizione strutturale passa.
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "richiesta": 1 },\n',
      liveExtra: '  "custom": { "richiesta": 1 },\n',
      steps: [autoStep(1, 2, { script: 'from-v1-to-v2.js' })],
      files: {
        'from-v1-to-v2.js': `
module.exports = {
  async migrate(ctx) {
    const cfg = ctx.loadJson5(ctx.configPath);
    delete cfg.custom.richiesta;
    await ctx.saveJson5(ctx.configPath, cfg);
  },
};
`,
      },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.errors).toEqual([]);
    const live = loadJson5(path.join(root, 'plugins/p/pluginConfig.json5'));
    expect(live.custom.richiesta).toBe(1);
    expect(live.schemaVersion).toBe(2);
  });

  test('catena multi-step: si ferma allo step manuale e non applica i successivi', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 4,
      steps: [
        autoStep(1, 2),
        { from: 2, to: 3, title: 'richiede giudizio', automatic: false, reason: 'Serve riconciliare a mano.', doc: 'from-v2-to-v3.md', touches: [] },
        autoStep(3, 4),
      ],
      files: { 'from-v2-to-v3.md': '# guida\n' },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.applied.map((a) => a.step)).toEqual(['from-v1-to-v2']);
    expect(res.stopped.step).toBe('from-v2-to-v3');
    expect(res.stopped.needs).toBe('manual');
    // Si è fermata a v2: lo step automatico 3→4 NON è stato applicato.
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(2);
  });

  test('--confirm-manual sblocca lo step manuale e la catena riprende', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 3,
      steps: [
        { from: 1, to: 2, title: 'manuale', automatic: false, reason: 'r', doc: 'd.md', touches: [] },
        autoStep(2, 3),
      ],
      files: { 'd.md': '# guida\n' },
    });

    const res = await migrationRunner.runMigrations(target('p'), { confirmManual: true });

    expect(res.stopped).toBeNull();
    expect(res.applied).toHaveLength(2);
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(3);
  });

  test('verify() che passa sblocca lo step manuale senza --confirm-manual', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      liveExtra: '  "custom": { "fattoAMano": true },\n',
      steps: [{ from: 1, to: 2, title: 'manuale', automatic: false, reason: 'r', doc: 'd.md', script: 'v.js', touches: [] }],
      files: {
        'd.md': '# guida\n',
        'v.js': `
module.exports = {
  async migrate() {},
  async verify(ctx) {
    const cfg = ctx.loadJson5(ctx.configPath);
    return { ok: cfg.custom && cfg.custom.fattoAMano === true };
  },
};
`,
      },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.stopped).toBeNull();
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(2);
  });

  test('verify() che fallisce ferma la catena segnalando il motivo', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      steps: [{ from: 1, to: 2, title: 'manuale', automatic: false, reason: 'r', doc: 'd.md', script: 'v.js', touches: [] }],
      files: {
        'd.md': '# guida\n',
        'v.js': 'module.exports = { async migrate() {}, async verify() { return { ok: false, detail: "non ancora fatto" }; } };\n',
      },
    });

    const res = await migrationRunner.runMigrations(target('p'));

    expect(res.stopped.needs).toBe('verify-failed');
    expect(res.stopped.detail).toBe('non ancora fatto');
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(1);
  });

  test('allinea anche la schemaVersion dei file secondari dichiarati in touches', async () => {
    const dir = makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      steps: [autoStep(1, 2, { touches: ['pluginConfig.json5', 'store.json5'] })],
    });
    fs.writeFileSync(path.join(dir, 'store.default.json5'), `${HEADER}\n{ "schemaVersion": 5, "entries": [] }\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'store.json5'), `${HEADER}\n{ "schemaVersion": 1, "entries": [] }\n`, 'utf8');

    await migrationRunner.runMigrations(target('p'));

    expect(loadJson5(path.join(dir, 'store.json5')).schemaVersion).toBe(5);
  });
});

describe('reportPendingMigrations (rilevamento al boot)', () => {
  test('elenca le migrazioni pendenti nel box senza eseguirle', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
      steps: [autoStep(1, 2)],
    });

    const summary = await migrationRunner.reportPendingMigrations(root);

    expect(summary.pending).toHaveLength(1);
    expect(summary.applied).toEqual([]);
    expect(warnSpy.mock.calls[0][0]).toContain('[MIGRATE]');
    // passivo: nulla è stato scritto
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(1);
  });

  test('con autoApply applica gli step automatici', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
      steps: [autoStep(1, 2)],
    });

    const summary = await migrationRunner.reportPendingMigrations(root, { autoApply: true });

    expect(summary.applied).toHaveLength(1);
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(2);
  });

  test('con autoApply NON tocca un pacchetto la cui catena contiene step manuali', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      steps: [{ from: 1, to: 2, title: 'manuale', automatic: false, reason: 'r', doc: 'd.md', touches: [] }],
      files: { 'd.md': '# guida\n' },
    });

    const summary = await migrationRunner.reportPendingMigrations(root, { autoApply: true });

    expect(summary.applied).toEqual([]);
    expect(summary.pending).toHaveLength(1);
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).schemaVersion).toBe(1);
  });

  test('migrations.json5 non valido → segnalato, pacchetto lasciato fermo, nessun throw', async () => {
    makePlugin('bad', {
      liveVersion: 1, defaultVersion: 2,
      steps: [{ from: 1, to: 2, title: 't', automatic: true, touches: [] }], // reason mancante
    });

    const summary = await migrationRunner.reportPendingMigrations(root);

    expect(summary.invalid).toHaveLength(1);
    expect(summary.invalid[0].label).toBe('plugins/bad');
    expect(loadJson5(path.join(root, 'plugins/bad/pluginConfig.json5')).schemaVersion).toBe(1);
  });

  // Il merge additivo è il primo a incontrare il drift e allineerebbe
  // schemaVersion: così facendo brucerebbe il trigger della migrazione, che al
  // boot dopo non partirebbe più — rinomine e rimozioni perse per sempre.
  // `protectedLivePaths` è ciò che glielo impedisce.
  test('i config con una migrazione pendente sono protetti dal merge additivo', async () => {
    const dir = makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      steps: [autoStep(1, 2, { touches: ['pluginConfig.json5', 'store.json5'] })],
    });
    fs.writeFileSync(path.join(dir, 'store.default.json5'), `${HEADER}\n{ "schemaVersion": 2 }\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'store.json5'), `${HEADER}\n{ "schemaVersion": 1 }\n`, 'utf8');

    const summary = await migrationRunner.reportPendingMigrations(root);

    // Sia il descrittore sia i file secondari dichiarati in touches.
    expect(summary.protectedLivePaths).toEqual(expect.arrayContaining([
      path.join(dir, 'pluginConfig.json5'),
      path.join(dir, 'store.json5'),
    ]));

    // Il merge, informato, li salta: le versioni restano indietro e la migrazione
    // resta applicabile.
    const reconcileSchemaVersions = require('../../../core/reconcileSchemaVersions');
    const res = await reconcileSchemaVersions({
      containers: [path.join(root, 'plugins')],
      skipLivePaths: summary.protectedLivePaths,
    });

    expect(res.skipped.map((s) => s.label)).toEqual(expect.arrayContaining(['p/pluginConfig.json5', 'p/store.json5']));
    expect(loadJson5(path.join(dir, 'pluginConfig.json5')).schemaVersion).toBe(1);
    expect(loadJson5(path.join(dir, 'store.json5')).schemaVersion).toBe(1);
  });

  test('senza migrazioni pendenti il merge non salta nulla', async () => {
    makePlugin('p', {
      liveVersion: 1, defaultVersion: 2,
      defaultExtra: '  "custom": { "nuova": 1 },\n',
      liveExtra: '  "custom": {},\n',
    }); // nessuna cartella migrations/

    const summary = await migrationRunner.reportPendingMigrations(root);
    expect(summary.protectedLivePaths).toEqual([]);

    const reconcileSchemaVersions = require('../../../core/reconcileSchemaVersions');
    await reconcileSchemaVersions({
      containers: [path.join(root, 'plugins')],
      skipLivePaths: summary.protectedLivePaths,
    });

    // Il fallback additivo ha fatto il suo lavoro.
    expect(loadJson5(path.join(root, 'plugins/p/pluginConfig.json5')).custom.nuova).toBe(1);
  });

  test('nessuna migrazione pendente → nessun box', async () => {
    makePlugin('p', { liveVersion: 2, defaultVersion: 2, steps: [autoStep(1, 2)] });

    const summary = await migrationRunner.reportPendingMigrations(root);

    expect(summary.pending).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// La postcondizione confronta la STRUTTURA (ogni chiave del default esiste nel
// vivo?), non i valori: è la stessa traversata del merge ricorsivo riusata come
// rete di sicurezza. Testata direttamente perché, nel flusso completo, il merge
// gira prima e in pratica non la fa quasi mai scattare — che è il segno che
// funziona.
describe('verifica strutturale (postcondizione)', () => {
  const check = migrationRunner._findMissingKeys;

  test('vivo completo → nessuna mancanza', () => {
    expect(check({ a: 1, b: { c: 2 } }, { a: 9, b: { c: 9 } })).toEqual([]);
  });

  test('rileva le chiavi mancanti a ogni profondità, in notazione puntata', () => {
    expect(check({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } })).toEqual(['a', 'b.d']);
  });

  test('ignora schemaVersion e non si lamenta delle chiavi in PIÙ nel vivo', () => {
    expect(check({ schemaVersion: 2, a: 1 }, { a: 1, isInstalled: 1, version: '1.0.0' })).toEqual([]);
  });

  test('non guarda i valori: un valore diverso non è una mancanza', () => {
    expect(check({ nodeModuleDependency: {} }, { nodeModuleDependency: { multer: '^1.4.5' } })).toEqual([]);
  });

  test('un parent non-oggetto nel vivo conta come mancanza del ramo', () => {
    expect(check({ a: { b: 1 } }, { a: 'scalare' })).toEqual(['a.b']);
  });
});

describe('resolveTarget', () => {
  test('risolve un plugin, un tema e un config del core', () => {
    makePlugin('p', { liveVersion: 1, defaultVersion: 1 });
    fs.mkdirSync(path.join(root, 'themes', 't'), { recursive: true });

    expect(migrationRunner.resolveTarget(root, 'p').kind).toBe('plugin');
    expect(migrationRunner.resolveTarget(root, 't', { theme: true }).kind).toBe('theme');

    const core = migrationRunner.resolveTarget(root, 'ital8Config');
    expect(core.kind).toBe('core');
    expect(core.migrationsDir).toBe(path.join(root, 'core', 'migrations', 'ital8Config'));
  });

  test('target inesistente → null', () => {
    expect(migrationRunner.resolveTarget(root, 'nonEsiste')).toBeNull();
  });
});
