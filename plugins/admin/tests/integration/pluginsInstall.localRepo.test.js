/**
 * Integration test del flusso completo di installazione plugin
 * (clone → materializeConfigs → validate → finalizeConfig) contro un
 * repository git **locale**, creato al volo in una temp dir.
 *
 * Perché locale e non un repo GitHub: il flusso va verificato end-to-end anche
 * offline e senza dipendere da un pacchetto pubblicato. `git clone` accetta un
 * path su disco, e la validazione dell'URL vive nell'handler della route (non
 * in runInstall), quindi il job gira identico a quello reale — stesso
 * `git clone --progress`, stesse fasi, stesse scritture su disco.
 *
 * Copre la regressione per cui un plugin conforme allo standard del ciclo di
 * vita dei config (repo che committa il solo `pluginConfig.default.json5`)
 * veniva rifiutato in validazione e la cartella clonata rimossa dal rollback.
 *
 * Side effects: installa davvero in plugins/<nome>. Il nome è distintivo e il
 * cleanup è esplicito in afterEach. L'audit log plugins/admin/pluginInstallLog.json5
 * viene scritto a ogni run (è gitignored).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const pluginsInstall = require(path.join(PROJECT_ROOT, 'plugins', 'admin', 'pluginsInstall'));
const loadJson5 = require(path.join(PROJECT_ROOT, 'core', 'loadJson5'));

const PLUGIN_NAME = 'localRepoInstallFixture';
const PLUGIN_DIR = path.join(PROJECT_ROOT, 'plugins', PLUGIN_NAME);
const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported';

let sourceRepoDir;

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} fallito: ${res.stderr && res.stderr.toString()}`);
  }
}

function writeFile(relPath, content) {
  const full = path.join(sourceRepoDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

// Costruisce un repo git locale con un plugin conforme: SOLO il `.default`,
// più un config secondario, per verificare che venga materializzato anche quello.
function buildSourceRepo({ alsoCommitLiveConfig = false } = {}) {
  writeFile('main.js', 'module.exports = { async loadPlugin() {}, getRouteArray() { return []; } };\n');
  writeFile('pluginDescription.json5', `${JSON5_HEADER}\n{ name: "${PLUGIN_NAME}", version: "0.0.1", description: "fixture", author: "jest", email: "j@e.st", license: "ISC" }\n`);
  writeFile('pluginConfig.default.json5', [
    JSON5_HEADER,
    '{',
    '  schemaVersion: 1,  // commento che deve sopravvivere all\'installazione',
    '  active: 1,',
    '  weight: 100,',
    '  dependency: {},',
    '  nodeModuleDependency: {},',
    '  custom: {',
    '    greeting: "dal default",',
    '  },',
    '}',
    '',
  ].join('\n'));
  writeFile('fixtureStore.default.json5', `${JSON5_HEADER}\n{ schemaVersion: 1, entries: [] }\n`);
  if (alsoCommitLiveConfig) {
    // Repo NON conforme: pubblica anche il vivo, con valori diversi dal default.
    writeFile('pluginConfig.json5', `${JSON5_HEADER}\n{ schemaVersion: 1, active: 1, weight: 999, dependency: {}, nodeModuleDependency: {}, custom: { greeting: "dal vivo committato" } }\n`);
  }

  git(['init', '--quiet', '--initial-branch=main'], sourceRepoDir);
  git(['config', 'user.email', 'jest@example.test'], sourceRepoDir);
  git(['config', 'user.name', 'jest'], sourceRepoDir);
  git(['add', '-A'], sourceRepoDir);
  git(['commit', '--quiet', '-m', 'fixture'], sourceRepoDir);
}

function makeJob() {
  return {
    installId: `inst_local_${Date.now().toString(36)}`,
    status: 'pending',
    repoUrl: sourceRepoDir,
    branchOrTag: null,
    wantActive: true,
    pluginName: PLUGIN_NAME,
    phases: [],
    currentPhase: null,
    warnings: [],
    error: null,
    result: null,
    progress: null,
    progressHistory: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    user: 'jest-localRepo',
  };
}

function cleanupInstalledPlugin() {
  fs.rmSync(PLUGIN_DIR, { recursive: true, force: true });
}

beforeEach(() => {
  sourceRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-srcrepo-'));
  cleanupInstalledPlugin();
});

afterEach(() => {
  fs.rmSync(sourceRepoDir, { recursive: true, force: true });
  cleanupInstalledPlugin();
});

describe('pluginsInstall — flusso completo contro un repo git locale', () => {

  test('un plugin conforme (solo .default) si installa: il vivo viene generato, non richiesto', async () => {
    buildSourceRepo();
    const job = makeJob();

    await pluginsInstall._runInstall(job, { cloneTimeoutMs: 30000, maxJobHistory: 50 });

    expect(job.error).toBeNull();
    expect(job.status).toBe('success');

    // Le fasi attese, materializeConfigs inclusa, tutte ok.
    expect(job.phases.map(p => p.name)).toEqual(
      expect.arrayContaining([
        'parseUrl', 'checkDestination', 'cloneStart', 'cloneDone',
        'materializeConfigs', 'validate', 'finalizeConfig',
      ]),
    );
    for (const ph of job.phases) expect(ph.ok).toBe(true);

    // Il vivo esiste ed è stato finalizzato; il .default resta accanto.
    expect(fs.existsSync(path.join(PLUGIN_DIR, 'pluginConfig.default.json5'))).toBe(true);
    const live = loadJson5(path.join(PLUGIN_DIR, 'pluginConfig.json5'));
    expect(live.active).toBe(1);
    expect(live.isInstalled).toBe(1);
    expect(live.custom.greeting).toBe('dal default');

    // I commenti del .default sopravvivono alla scrittura di active/isInstalled.
    expect(fs.readFileSync(path.join(PLUGIN_DIR, 'pluginConfig.json5'), 'utf8'))
      .toContain("// commento che deve sopravvivere all'installazione");

    // Anche i config secondari del pacchetto sono materializzati.
    expect(fs.existsSync(path.join(PLUGIN_DIR, 'fixtureStore.json5'))).toBe(true);

    expect(job.result.pluginName).toBe(PLUGIN_NAME);
    expect(job.result.active).toBe(true);
    expect(job.result.isInstalled).toBe(true);
  }, 30000);

  test('un repo che pubblica anche il vivo: installazione ok, warning, il default vince', async () => {
    buildSourceRepo({ alsoCommitLiveConfig: true });
    const job = makeJob();

    await pluginsInstall._runInstall(job, { cloneTimeoutMs: 30000, maxJobHistory: 50 });

    expect(job.status).toBe('success');
    expect(job.warnings.join(' ')).toContain('pluginConfig.json5');

    const live = loadJson5(path.join(PLUGIN_DIR, 'pluginConfig.json5'));
    expect(live.custom.greeting).toBe('dal default');
    expect(live.weight).toBe(100);
  }, 30000);

  test('un repo senza .default viene rifiutato e la cartella clonata rimossa', async () => {
    buildSourceRepo();
    fs.rmSync(path.join(sourceRepoDir, 'pluginConfig.default.json5'));
    git(['add', '-A'], sourceRepoDir);
    git(['commit', '--quiet', '-m', 'rimuove il default'], sourceRepoDir);
    const job = makeJob();

    await pluginsInstall._runInstall(job, { cloneTimeoutMs: 30000, maxJobHistory: 50 });

    expect(job.status).toBe('failed');
    expect(job.error).toContain('pluginConfig.default.json5');
    // Rollback: nessun residuo su disco.
    expect(fs.existsSync(PLUGIN_DIR)).toBe(false);
  }, 30000);

  test('con dipendenze npm dichiarate il plugin resta disattivato ma installato', async () => {
    buildSourceRepo();
    const configPath = path.join(sourceRepoDir, 'pluginConfig.default.json5');
    fs.writeFileSync(
      configPath,
      fs.readFileSync(configPath, 'utf8').replace('nodeModuleDependency: {},', 'nodeModuleDependency: { "left-pad": "^1.0.0" },'),
      'utf8',
    );
    git(['add', '-A'], sourceRepoDir);
    git(['commit', '--quiet', '-m', 'aggiunge dipendenza npm'], sourceRepoDir);
    const job = makeJob();

    await pluginsInstall._runInstall(job, { cloneTimeoutMs: 30000, maxJobHistory: 50 });

    expect(job.status).toBe('success');
    const live = loadJson5(path.join(PLUGIN_DIR, 'pluginConfig.json5'));
    expect(live.active).toBe(0);
    expect(live.isInstalled).toBe(1);
    expect(job.result.wasDeactivatedDueToNpmDeps).toBe(true);
  }, 30000);
});
