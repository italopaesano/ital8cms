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
});
