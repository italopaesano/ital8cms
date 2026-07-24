/**
 * Integrazione: esegue i VERI entrypoint (scripts/*.js) come processi figli,
 * puntati a una root usa-e-getta via ITAL8CMS_PROJECT_ROOT. Valida wiring,
 * output, exit code e guardie — senza toccare il repo reale né la rete
 * (i test di update usano un remote bare locale).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');

function run(script, args, root, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (root) env.ITAL8CMS_PROJECT_ROOT = root; else delete env.ITAL8CMS_PROJECT_ROOT;
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', script), ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function git(cwd, args) {
  return require('child_process').execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('--help exits 0', () => {
  test.each(['backup.js', 'restore.js', 'depsSync.js', 'update.js'])('%s --help', (s) => {
    expect(run(s, ['--help'], null).code).toBe(0);
  });
});

describe('backup → list → restore roundtrip', () => {
  let root;
  beforeEach(() => { root = tmp('ital8-cli-bk-'); fs.writeFileSync(path.join(root, 'data.txt'), 'v1'); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('creates, lists, restores, prunes', () => {
    const bk = run('backup.js', ['--no-git', '--label', 'ci', '--json'], root);
    expect(bk.code).toBe(0);
    expect(JSON.parse(bk.out).ok).toBe(true);

    const list = JSON.parse(run('backupList.js', ['--json'], root).out);
    expect(list.backups.length).toBe(1);

    fs.writeFileSync(path.join(root, 'data.txt'), 'MODIFIED');
    const res = run('restore.js', ['--latest', '--yes'], root);
    expect(res.code).toBe(0);
    expect(fs.readFileSync(path.join(root, 'data.txt'), 'utf8')).toBe('v1');

    // prune tutto e verifica
    expect(run('backupManager.js', ['prune', '0', '--yes'], root).code).toBe(0);
    expect(JSON.parse(run('backupList.js', ['--json'], root).out).backups.length).toBe(0);
  });

  test('restore --name with path traversal is rejected (matched against real backups only)', () => {
    // con almeno un backup reale presente, un nome-traversal non combacia con nessuna cartella
    expect(run('backup.js', ['--no-git', '--json'], root).code).toBe(0);
    const r = run('restore.js', ['--name', '../../etc/passwd', '--yes'], root);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/non trovato/i);
  });

  test('restore with no backups errors cleanly', () => {
    const r = run('restore.js', ['--latest', '--yes'], root);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/nessun backup/i);
  });
});

describe('deps-sync (dry-run) on a throwaway root', () => {
  let root;
  beforeEach(() => {
    root = tmp('ital8-cli-ds-');
    const p = path.join(root, 'plugins', 'legacyOne');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'pluginConfig.default.json5'),
      '// t\n{\n  "active": 1,\n  "nodeModuleDependency": { "leftpad": "^1.0.0" },\n}\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('reports the legacy dep without installing', () => {
    const r = run('depsSync.js', ['--dry-run', '--json'], root);
    expect(r.code).toBe(0);
    const rep = JSON.parse(r.out).report;
    expect(rep.legacy).toEqual([{ container: 'plugins', name: 'legacyOne', wouldInstall: ['leftpad@^1.0.0'], dryRun: true }]);
  });
});

describe('update guards (offline, local bare remote)', () => {
  let base, remote, work;
  beforeAll(() => {
    base = tmp('ital8-cli-up-');
    remote = path.join(base, 'remote.git');
    work = path.join(base, 'work');
    fs.mkdirSync(remote); git(remote, ['init', '--bare', '-b', 'main']);
    fs.mkdirSync(work); git(work, ['init', '-b', 'main']);
    git(work, ['config', 'user.email', 't@e.x']); git(work, ['config', 'user.name', 'T']);
    git(work, ['remote', 'add', 'origin', remote]);
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    git(work, ['add', '-A']); git(work, ['commit', '-m', 'v1']); git(work, ['tag', 'v1.0.0']);
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.1.0' }));
    git(work, ['add', '-A']); git(work, ['commit', '-m', 'v1.1.0']); git(work, ['tag', 'v1.1.0']);
    git(work, ['push', 'origin', 'main', '--tags']);
    git(work, ['checkout', '--detach', 'v1.0.0']);
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  test('non-git dir → refuses', () => {
    const ng = tmp('ital8-cli-nogit-');
    const r = run('update.js', ['--dry-run', '--yes'], ng);
    fs.rmSync(ng, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/non-git/i);
  });

  test('clean tree → dry-run discovers the newer release', () => {
    const r = run('update.js', ['--dry-run', '--yes'], work);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1\.1\.0/);
    expect(r.out).toMatch(/dry-run/i);
  });

  test('dirty tracked tree → refuses', () => {
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dirty: true }));
    const r = run('update.js', ['--dry-run', '--yes'], work);
    git(work, ['checkout', '--', 'package.json']); // ripristina
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/modifiche locali/i);
  });

  test('existing lock → refuses', () => {
    const lock = path.join(work, '.update.lock');
    fs.writeFileSync(lock, 'stale');
    const r = run('update.js', ['--dry-run', '--yes'], work);
    fs.rmSync(lock, { force: true });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/lock/i);
  });
});
