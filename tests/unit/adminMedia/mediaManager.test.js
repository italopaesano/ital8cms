/**
 * Unit tests for adminMedia/lib/mediaManager.js
 *
 * Covers:
 *   - resolveAbsPath(): path resolution
 *   - listDirectory(): listing, sorting, filtering, error cases
 *   - createFolder(): creation, duplicate, traversal, invalid names
 *   - renameItem(): file rename, folder rename, traversal, collision
 *   - moveFile(): move, auto-rename on collision, errors
 *   - deleteFile(): delete, errors (not found, directory, traversal)
 *   - deleteFolder(): empty-only, recursive, root protection, traversal
 *   - buildFolderTree(): empty, nested, hidden exclusion
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const {
  resolveAbsPath,
  listDirectory,
  createFolder,
  renameItem,
  moveFile,
  deleteFile,
  deleteFolder,
  buildFolderTree,
} = require('../../../plugins/adminMedia/lib/mediaManager');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'admedia-mgr-'));
}

function touch(filePath, content = '') {
  fs.writeFileSync(filePath, content);
}

// ══ resolveAbsPath() ══════════════════════════════════════════════════════════

describe('resolveAbsPath()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('returns root when relPath is empty', () => {
    expect(resolveAbsPath(root, '')).toBe(root);
  });

  test('resolves valid sub-path', () => {
    fs.mkdirSync(path.join(root, 'sub'));
    const result = resolveAbsPath(root, 'sub');
    expect(result).toBe(path.join(root, 'sub'));
  });

  test('falls back to mediaRoot when absolute path escapes root', () => {
    // Absolute paths outside root make safeResolve return null → falls back to mediaRoot
    const result = resolveAbsPath(root, '/etc/passwd');
    expect(result).toBe(root);
  });
});

// ══ listDirectory() ═══════════════════════════════════════════════════════════

describe('listDirectory()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('returns success with empty entries for empty directory', () => {
    const r = listDirectory(root, '');
    expect(r.success).toBe(true);
    expect(r.data.entries).toEqual([]);
  });

  test('lists files and folders with metadata', () => {
    touch(path.join(root, 'photo.jpg'));
    fs.mkdirSync(path.join(root, 'subfolder'));
    const r = listDirectory(root, '');
    expect(r.success).toBe(true);
    const names = r.data.entries.map(e => e.name);
    expect(names).toContain('photo.jpg');
    expect(names).toContain('subfolder');
  });

  test('folders appear before files in listing', () => {
    touch(path.join(root, 'aaa.jpg'));
    fs.mkdirSync(path.join(root, 'zzz'));
    const r = listDirectory(root, '');
    expect(r.data.entries[0].type).toBe('folder');
    expect(r.data.entries[1].type).toBe('file');
  });

  test('entries are sorted alphabetically within type group', () => {
    touch(path.join(root, 'zebra.jpg'));
    touch(path.join(root, 'apple.png'));
    const r = listDirectory(root, '');
    const fileEntries = r.data.entries.filter(e => e.type === 'file');
    expect(fileEntries[0].name).toBe('apple.png');
    expect(fileEntries[1].name).toBe('zebra.jpg');
  });

  test('excludes hidden files (starting with dot)', () => {
    touch(path.join(root, '.hidden'));
    touch(path.join(root, 'visible.jpg'));
    const r = listDirectory(root, '');
    const names = r.data.entries.map(e => e.name);
    expect(names).not.toContain('.hidden');
    expect(names).toContain('visible.jpg');
  });

  test('excludes .tmp directory', () => {
    fs.mkdirSync(path.join(root, '.tmp'));
    touch(path.join(root, 'file.jpg'));
    const r = listDirectory(root, '');
    const names = r.data.entries.map(e => e.name);
    expect(names).not.toContain('.tmp');
  });

  test('file entry has correct metadata shape', () => {
    touch(path.join(root, 'photo.jpg'), 'data');
    const r = listDirectory(root, '');
    const entry = r.data.entries.find(e => e.name === 'photo.jpg');
    expect(entry).toBeDefined();
    expect(entry.type).toBe('file');
    expect(entry.category).toBe('image');
    expect(typeof entry.size).toBe('number');
    expect(typeof entry.modified).toBe('string');
  });

  test('folder entry has correct metadata shape', () => {
    fs.mkdirSync(path.join(root, 'myfolder'));
    const r = listDirectory(root, '');
    const entry = r.data.entries.find(e => e.name === 'myfolder');
    expect(entry).toBeDefined();
    expect(entry.type).toBe('folder');
    expect(entry.category).toBe('folder');
    expect(entry.size).toBeNull();
  });

  test('lists subdirectory contents', () => {
    fs.mkdirSync(path.join(root, 'sub'));
    touch(path.join(root, 'sub', 'file.mp4'));
    const r = listDirectory(root, 'sub');
    expect(r.success).toBe(true);
    expect(r.data.entries[0].name).toBe('file.mp4');
    expect(r.data.entries[0].category).toBe('video');
  });

  test('returns 404 for non-existent path', () => {
    const r = listDirectory(root, 'nonexistent');
    expect(r.success).toBe(false);
    expect(r.status).toBe(404);
  });

  test('returns 400 when path points to a file', () => {
    touch(path.join(root, 'file.jpg'));
    const r = listDirectory(root, 'file.jpg');
    expect(r.success).toBe(false);
    expect(r.status).toBe(400);
  });

  test('returns 403 when absolute path escapes root', () => {
    // Absolute paths outside the root trigger the null check in safeResolve → 403
    const r = listDirectory(root, '/etc/passwd');
    expect(r.success).toBe(false);
    expect(r.status).toBe(403);
  });
});

// ══ createFolder() ════════════════════════════════════════════════════════════

describe('createFolder()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('creates a new folder successfully', () => {
    const r = createFolder(root, '', 'photos');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'photos'))).toBe(true);
  });

  test('creates folder inside subdirectory', () => {
    fs.mkdirSync(path.join(root, 'sub'));
    const r = createFolder(root, 'sub', 'nested');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'sub', 'nested'))).toBe(true);
  });

  test('returns error if folder already exists', () => {
    fs.mkdirSync(path.join(root, 'existing'));
    const r = createFolder(root, '', 'existing');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/i);
  });

  test('returns error for empty folder name', () => {
    const r = createFolder(root, '', '');
    expect(r.success).toBe(false);
  });

  test('strips invalid characters from folder name', () => {
    const r = createFolder(root, '', 'my folder!@#');
    expect(r.success).toBe(true);
    // Spaces become underscores, specials stripped
    const created = fs.readdirSync(root)[0];
    expect(created).toMatch(/^my_folder/);
  });

  test('returns error when name contains only invalid characters', () => {
    const r = createFolder(root, '', '!@#$%^');
    expect(r.success).toBe(false);
  });

  test('returns error when parent path escapes root (absolute path)', () => {
    // Absolute paths outside root trigger safeResolve null → traversal error
    const r = createFolder(root, '/etc', 'folder');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });
});

// ══ renameItem() ══════════════════════════════════════════════════════════════

describe('renameItem()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('renames a file successfully', () => {
    touch(path.join(root, 'old.jpg'));
    const r = renameItem(root, 'old.jpg', 'new.jpg');
    expect(r.success).toBe(true);
    expect(r.isFolder).toBe(false);
    expect(fs.existsSync(path.join(root, 'new.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'old.jpg'))).toBe(false);
  });

  test('renames a folder successfully', () => {
    fs.mkdirSync(path.join(root, 'old-dir'));
    const r = renameItem(root, 'old-dir', 'new-dir');
    expect(r.success).toBe(true);
    expect(r.isFolder).toBe(true);
    expect(fs.existsSync(path.join(root, 'new-dir'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'old-dir'))).toBe(false);
  });

  test('returns isFolder: false for file rename', () => {
    touch(path.join(root, 'file.png'));
    const r = renameItem(root, 'file.png', 'renamed.png');
    expect(r.isFolder).toBe(false);
  });

  test('returns isFolder: true for folder rename', () => {
    fs.mkdirSync(path.join(root, 'dir'));
    const r = renameItem(root, 'dir', 'newdir');
    expect(r.isFolder).toBe(true);
  });

  test('returns error when source does not exist', () => {
    const r = renameItem(root, 'nonexistent.jpg', 'new.jpg');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('returns error when destination name already exists', () => {
    touch(path.join(root, 'a.jpg'));
    touch(path.join(root, 'b.jpg'));
    const r = renameItem(root, 'a.jpg', 'b.jpg');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/i);
  });

  test('returns error when new name contains path separator', () => {
    touch(path.join(root, 'file.jpg'));
    const r = renameItem(root, 'file.jpg', 'sub/file.jpg');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/separator/i);
  });

  test('returns error when source path escapes root (absolute path)', () => {
    const r = renameItem(root, '/etc/passwd', 'new');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });

  test('normalizes file name: lowercase and underscore for spaces', () => {
    touch(path.join(root, 'old.jpg'));
    renameItem(root, 'old.jpg', 'My New Photo.jpg');
    // sanitized: my_new_photo.jpg
    expect(fs.existsSync(path.join(root, 'my_new_photo.jpg'))).toBe(true);
  });
});

// ══ moveFile() ════════════════════════════════════════════════════════════════

describe('moveFile()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('moves a file to another folder', () => {
    touch(path.join(root, 'photo.jpg'));
    fs.mkdirSync(path.join(root, 'dest'));
    const r = moveFile(root, 'photo.jpg', 'dest');
    expect(r.success).toBe(true);
    expect(r.finalName).toBe('photo.jpg');
    expect(fs.existsSync(path.join(root, 'dest', 'photo.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'photo.jpg'))).toBe(false);
  });

  test('auto-renames on collision (_1 suffix)', () => {
    touch(path.join(root, 'photo.jpg'));
    fs.mkdirSync(path.join(root, 'dest'));
    touch(path.join(root, 'dest', 'photo.jpg'));
    const r = moveFile(root, 'photo.jpg', 'dest');
    expect(r.success).toBe(true);
    expect(r.finalName).toBe('photo_1.jpg');
    expect(fs.existsSync(path.join(root, 'dest', 'photo_1.jpg'))).toBe(true);
  });

  test('returns error when source file not found', () => {
    fs.mkdirSync(path.join(root, 'dest'));
    const r = moveFile(root, 'missing.jpg', 'dest');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('returns error when destination folder not found', () => {
    touch(path.join(root, 'photo.jpg'));
    const r = moveFile(root, 'photo.jpg', 'nonexistent');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('returns error when trying to move a folder', () => {
    fs.mkdirSync(path.join(root, 'mydir'));
    fs.mkdirSync(path.join(root, 'dest'));
    const r = moveFile(root, 'mydir', 'dest');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/folder/i);
  });

  test('returns error when source path escapes root (absolute path)', () => {
    fs.mkdirSync(path.join(root, 'dest'));
    const r = moveFile(root, '/etc/passwd', 'dest');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });

  test('returns error when destination path escapes root (absolute path)', () => {
    touch(path.join(root, 'photo.jpg'));
    const r = moveFile(root, 'photo.jpg', '/tmp');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });
});

// ══ deleteFile() ══════════════════════════════════════════════════════════════

describe('deleteFile()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('deletes an existing file', () => {
    touch(path.join(root, 'file.jpg'));
    const r = deleteFile(root, 'file.jpg');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'file.jpg'))).toBe(false);
  });

  test('deletes a file in a subdirectory', () => {
    fs.mkdirSync(path.join(root, 'sub'));
    touch(path.join(root, 'sub', 'clip.mp4'));
    const r = deleteFile(root, 'sub/clip.mp4');
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'sub', 'clip.mp4'))).toBe(false);
  });

  test('returns error when file does not exist', () => {
    const r = deleteFile(root, 'nonexistent.jpg');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('returns error when path points to a directory', () => {
    fs.mkdirSync(path.join(root, 'mydir'));
    const r = deleteFile(root, 'mydir');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/directory/i);
  });

  test('returns error when path escapes root (absolute path)', () => {
    const r = deleteFile(root, '/etc/passwd');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });
});

// ══ deleteFolder() ════════════════════════════════════════════════════════════

describe('deleteFolder()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('deletes an empty folder (non-recursive)', () => {
    fs.mkdirSync(path.join(root, 'empty'));
    const r = deleteFolder(root, 'empty', false);
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'empty'))).toBe(false);
  });

  test('returns error when trying to delete non-empty folder without recursive', () => {
    fs.mkdirSync(path.join(root, 'full'));
    touch(path.join(root, 'full', 'file.jpg'));
    const r = deleteFolder(root, 'full', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not empty/i);
  });

  test('deletes non-empty folder recursively', () => {
    fs.mkdirSync(path.join(root, 'full'));
    touch(path.join(root, 'full', 'file.jpg'));
    fs.mkdirSync(path.join(root, 'full', 'sub'));
    touch(path.join(root, 'full', 'sub', 'nested.png'));
    const r = deleteFolder(root, 'full', true);
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(root, 'full'))).toBe(false);
  });

  test('returns error when folder does not exist', () => {
    const r = deleteFolder(root, 'nonexistent', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('returns error when path points to a file', () => {
    touch(path.join(root, 'file.jpg'));
    const r = deleteFolder(root, 'file.jpg', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not a directory/i);
  });

  test('returns error when trying to delete media root', () => {
    const r = deleteFolder(root, '', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/root/i);
  });

  test('returns error when trying to delete media root with dot', () => {
    const r = deleteFolder(root, '.', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/root/i);
  });

  test('returns error when path escapes root (absolute path)', () => {
    const r = deleteFolder(root, '/etc', false);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal/i);
  });
});

// ══ buildFolderTree() ═════════════════════════════════════════════════════════

describe('buildFolderTree()', () => {
  let root;
  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('returns empty array for empty directory', () => {
    expect(buildFolderTree(root)).toEqual([]);
  });

  test('returns empty array when only files exist (no folders)', () => {
    touch(path.join(root, 'photo.jpg'));
    expect(buildFolderTree(root)).toEqual([]);
  });

  test('returns top-level folders', () => {
    fs.mkdirSync(path.join(root, 'photos'));
    fs.mkdirSync(path.join(root, 'videos'));
    const tree = buildFolderTree(root);
    expect(tree.length).toBe(2);
    const names = tree.map(n => n.name);
    expect(names).toContain('photos');
    expect(names).toContain('videos');
  });

  test('each node has name, path, and children fields', () => {
    fs.mkdirSync(path.join(root, 'myfolder'));
    const tree = buildFolderTree(root);
    expect(tree[0]).toHaveProperty('name', 'myfolder');
    expect(tree[0]).toHaveProperty('path', 'myfolder');
    expect(tree[0]).toHaveProperty('children');
    expect(Array.isArray(tree[0].children)).toBe(true);
  });

  test('builds nested folder tree', () => {
    fs.mkdirSync(path.join(root, 'a'));
    fs.mkdirSync(path.join(root, 'a', 'b'));
    fs.mkdirSync(path.join(root, 'a', 'b', 'c'));
    const tree = buildFolderTree(root);
    expect(tree[0].name).toBe('a');
    expect(tree[0].children[0].name).toBe('b');
    expect(tree[0].children[0].children[0].name).toBe('c');
  });

  test('child path includes parent prefix', () => {
    fs.mkdirSync(path.join(root, 'parent'));
    fs.mkdirSync(path.join(root, 'parent', 'child'));
    const tree = buildFolderTree(root);
    expect(tree[0].children[0].path).toBe('parent/child');
  });

  test('excludes hidden directories', () => {
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.mkdirSync(path.join(root, 'visible'));
    const tree = buildFolderTree(root);
    const names = tree.map(n => n.name);
    expect(names).not.toContain('.hidden');
    expect(names).toContain('visible');
  });

  test('excludes .tmp directory', () => {
    fs.mkdirSync(path.join(root, '.tmp'));
    fs.mkdirSync(path.join(root, 'media'));
    const tree = buildFolderTree(root);
    const names = tree.map(n => n.name);
    expect(names).not.toContain('.tmp');
    expect(names).toContain('media');
  });

  test('folders sorted alphabetically', () => {
    fs.mkdirSync(path.join(root, 'zzz'));
    fs.mkdirSync(path.join(root, 'aaa'));
    fs.mkdirSync(path.join(root, 'mmm'));
    const tree = buildFolderTree(root);
    expect(tree.map(n => n.name)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  test('files in folders are not included in tree', () => {
    fs.mkdirSync(path.join(root, 'photos'));
    touch(path.join(root, 'photos', 'photo.jpg'));
    const tree = buildFolderTree(root);
    expect(tree[0].children).toEqual([]);
  });

  test('returns empty array on traversal attempt', () => {
    // safeResolve returns null → buildFolderTree returns []
    const tree = buildFolderTree(root, '../../etc');
    expect(Array.isArray(tree)).toBe(true);
    expect(tree).toEqual([]);
  });
});
