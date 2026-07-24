const fs = require('fs');
const os = require('os');
const path = require('path');
const backupEngine = require('../../../scripts/lib/backupEngine');

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-backup-'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'v1', 'utf8');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'inner.txt'), 'inner', 'utf8');
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), '//', 'utf8');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('backupEngine', () => {
  test('createBackup excludes node_modules by default, keeps content', () => {
    const b = backupEngine.createBackup(root, { includeGit: false, label: 'x' });
    const tree = path.join(b.dir, 'tree');
    expect(fs.existsSync(path.join(tree, 'file.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tree, 'sub', 'inner.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tree, 'node_modules'))).toBe(false);
    expect(b.manifest.includesNodeModules).toBe(false);
  });

  test('withNodeModules includes node_modules', () => {
    const b = backupEngine.createBackup(root, { includeGit: false, withNodeModules: true });
    expect(fs.existsSync(path.join(b.dir, 'tree', 'node_modules', 'pkg', 'index.js'))).toBe(true);
  });

  test('listBackups returns newest first', () => {
    backupEngine.createBackup(root, { includeGit: false, label: 'a' });
    // forza un nome/mtime successivo
    const b2 = backupEngine.createBackup(root, { includeGit: false, label: 'b' });
    const list = backupEngine.listBackups(root);
    expect(list.length).toBe(2);
    expect(list[0].name).toBe(b2.name); // il più recente
  });

  test('restore overlays snapshot back onto the project', () => {
    const b = backupEngine.createBackup(root, { includeGit: false });
    fs.writeFileSync(path.join(root, 'file.txt'), 'MODIFIED', 'utf8');
    backupEngine.restoreBackup(root, b.name);
    expect(fs.readFileSync(path.join(root, 'file.txt'), 'utf8')).toBe('v1');
  });

  test('restore does not clobber node_modules excluded from the snapshot', () => {
    const b = backupEngine.createBackup(root, { includeGit: false }); // no node_modules
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'CHANGED', 'utf8');
    backupEngine.restoreBackup(root, b.name);
    // node_modules non era nello snapshot → l'overlay non lo tocca
    expect(fs.readFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('CHANGED');
  });

  test('prune keeps the N most recent', () => {
    backupEngine.createBackup(root, { includeGit: false, label: 'a' });
    backupEngine.createBackup(root, { includeGit: false, label: 'b' });
    const b3 = backupEngine.createBackup(root, { includeGit: false, label: 'c' });
    const res = backupEngine.pruneBackups(root, 1);
    expect(res.kept).toEqual([b3.name]);
    expect(res.removed.length).toBe(2);
    expect(backupEngine.listBackups(root).length).toBe(1);
  });

  test('delete removes a backup', () => {
    const b = backupEngine.createBackup(root, { includeGit: false });
    backupEngine.deleteBackup(root, b.name);
    expect(backupEngine.listBackups(root).length).toBe(0);
  });

  test('findBackup throws on unknown name', () => {
    expect(() => backupEngine.findBackup(root, 'nope')).toThrow();
  });

  test('excludes *.sock and .tmp at top level and nested', () => {
    fs.writeFileSync(path.join(root, 'ital8cms.sock'), '');
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.writeFileSync(path.join(root, 'sub', 'nested.sock'), '');
    const b = backupEngine.createBackup(root, { includeGit: false });
    const tree = path.join(b.dir, 'tree');
    expect(fs.existsSync(path.join(tree, 'ital8cms.sock'))).toBe(false);
    expect(fs.existsSync(path.join(tree, '.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(tree, 'sub', 'nested.sock'))).toBe(false);
    expect(fs.existsSync(path.join(tree, 'sub', 'inner.txt'))).toBe(true);
  });

  test('.git excluded by default flag but included when includeGit:true', () => {
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'config'), '[core]');
    expect(fs.existsSync(path.join(backupEngine.createBackup(root, { includeGit: false }).dir, 'tree', '.git'))).toBe(false);
    expect(fs.existsSync(path.join(backupEngine.createBackup(root, { includeGit: true }).dir, 'tree', '.git', 'config'))).toBe(true);
  });

  test('backup directories are created with 0700 perms', () => {
    const b = backupEngine.createBackup(root, { includeGit: false });
    expect(fs.statSync(b.dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(b.dir, 'tree')).mode & 0o777).toBe(0o700);
  });

  test('manifest records reason, cmsVersion and nodeVersion', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.1' }));
    const b = backupEngine.createBackup(root, { includeGit: false, reason: 'pre-update' });
    expect(b.manifest).toMatchObject({ reason: 'pre-update', cmsVersion: '3.2.1', nodeVersion: process.version });
  });

  test('symlinks are copied as links, not dereferenced', () => {
    fs.symlinkSync(path.join(root, 'file.txt'), path.join(root, 'link.txt'));
    const b = backupEngine.createBackup(root, { includeGit: false });
    expect(fs.lstatSync(path.join(b.dir, 'tree', 'link.txt')).isSymbolicLink()).toBe(true);
  });
});

describe('humanSize', () => {
  test.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(backupEngine.humanSize(bytes)).toBe(expected);
  });
});
