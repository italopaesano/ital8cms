# Claude Code Prompt: Fix DT_UNKNOWN handling in koa-classic-server

## Context

koa-classic-server v2.4.0 introduced `isFileOrSymlinkToFile()` and `isDirOrSymlinkToDir()` helpers to fix symlink handling in `findIndexFile()`. This fix works correctly when `dirent.isSymbolicLink()` returns `true` (standard symlinks).

However, there is a **remaining bug** on filesystems where `readdir({ withFileTypes: true })` returns dirents with `DT_UNKNOWN` (UV_DIRENT_UNKNOWN = 0). On these filesystems, **all** `dirent.is*()` methods return `false`, causing `isFileOrSymlinkToFile()` to miss valid files.

## Affected Environments

This occurs on:
- **NixOS with buildFHSEnv** (chroot-like environment for Playwright e2e tests) — files appear with unknown type through the FHS overlay
- **overlayfs** (used by Docker for image layers)
- **some FUSE filesystems** (e.g. sshfs, s3fs, rclone mount)
- **NFS** (some NFS implementations don't support `d_type`)
- **ecryptfs** (encrypted home directories on Linux)
- Any filesystem that doesn't fill `dirent.d_type` in the kernel's `getdents64` syscall

## Symptoms

When all files in a served directory have `DT_UNKNOWN`:

1. **`GET /` shows directory listing instead of rendering index file** — `findIndexFile()` gets an empty `fileNames` array because all dirents fail both `isFile()` and `isSymbolicLink()` checks, so it falls through to `show_dir()`

2. **`GET /index.ejs` returns 200 (this works correctly)** — The direct file path uses `fs.promises.stat()` at line 248 which always works regardless of `d_type`. However, if the user's directory listing leads them to believe the file doesn't exist, this creates confusion.

3. **Directory listing may show empty or partial results** — In `show_dir()`, line 570 checks `if (type !== 1 && type !== 2 && type !== 3)` using the internal Symbol(type) property. When type is 0 (DT_UNKNOWN), entries are skipped with `console.error("Unknown file type:", type)`.

## Root Cause Analysis

### Bug 1: `isFileOrSymlinkToFile()` doesn't handle DT_UNKNOWN

```javascript
// Current code (v2.4.0) — index.cjs lines 145-156
async function isFileOrSymlinkToFile(dirent, dirPath) {
    if (dirent.isFile()) return true;        // DT_UNKNOWN: false
    if (dirent.isSymbolicLink()) {           // DT_UNKNOWN: false
        try {
            const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
            return realStat.isFile();
        } catch {
            return false;
        }
    }
    return false;  // ← DT_UNKNOWN falls here — BUG: should try stat()
}
```

**Fix needed:** When `!isFile() && !isSymbolicLink() && !isDirectory()` (i.e., type is unknown), fall back to `fs.promises.stat()` to determine the actual type.

### Bug 2: `isDirOrSymlinkToDir()` has the same problem

```javascript
// Current code (v2.4.0) — index.cjs lines 162-173
async function isDirOrSymlinkToDir(dirent, dirPath) {
    if (dirent.isDirectory()) return true;   // DT_UNKNOWN: false
    if (dirent.isSymbolicLink()) {           // DT_UNKNOWN: false
        try {
            const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
            return realStat.isDirectory();
        } catch {
            return false;
        }
    }
    return false;  // ← DT_UNKNOWN falls here — BUG
}
```

### Bug 3: `show_dir()` skips DT_UNKNOWN entries

```javascript
// Current code — index.cjs lines 561-573
let a_sy = Object.getOwnPropertySymbols(dir[0]);
const sy_type = a_sy[0];

for (const item of dir) {
    const s_name = item.name.toString();
    const type = item[sy_type];

    if (type !== 1 && type !== 2 && type !== 3) {
        console.error("Unknown file type:", type);  // ← type 0 hits this
        continue;  // ← BUG: valid file skipped
    }
    // ...
}
```

**Fix needed:** When type is 0 (DT_UNKNOWN), use `fs.promises.stat()` on the full path to determine the effective type, then set `effectiveType` accordingly.

## Proof of Concept

Node.js `Dirent` with type 0 (DT_UNKNOWN) causes all `is*()` methods to return `false`:

```javascript
const fs = require('fs');
const d = new fs.Dirent('test.ejs', 0);  // Node.js 18+
console.log(d.isFile());         // false
console.log(d.isDirectory());    // false
console.log(d.isSymbolicLink()); // false
// But fs.statSync('/actual/path/test.ejs').isFile() → true
```

## Task

1. **Read and understand the current code** in `index.cjs`, specifically:
   - `isFileOrSymlinkToFile()` (lines 145-156)
   - `isDirOrSymlinkToDir()` (lines 162-173)
   - `findIndexFile()` (lines 291-342)
   - `show_dir()` (lines 488-754, especially lines 561-573 and 586-596)

2. **Read the existing symlink tests** in `__tests__/symlink.test.js` to understand the current test patterns

3. **Add new tests** to `__tests__/symlink.test.js` (or a new file `__tests__/dt-unknown.test.js`) that simulate `DT_UNKNOWN` behavior. The tests should:

   a. **Mock `readdir` to return Dirents with type 0** — On Node.js 18+, you can create `new fs.Dirent('filename', 0)` directly. For older versions, you may need to monkey-patch the Symbol(type) property.

   b. **Test `findIndexFile()` with DT_UNKNOWN dirents** — Verify that index files with type 0 are still found (by falling back to `stat()`)

   c. **Test `show_dir()` with DT_UNKNOWN dirents** — Verify that entries with type 0 appear in the directory listing with correct type resolution (files shown as files, directories shown as DIR)

   d. **Integration test: simulate a DT_UNKNOWN filesystem** — Create a temporary directory, serve it with koa-classic-server, but mock `fs.promises.readdir` to return DT_UNKNOWN dirents while keeping `fs.promises.stat` working normally. Verify:
      - `GET /` serves the index file (not directory listing)
      - `GET /filename.ext` serves the file (200, not 404)
      - Directory listing shows all entries with correct types

4. **Fix the bugs** in `isFileOrSymlinkToFile()`, `isDirOrSymlinkToDir()`, and `show_dir()`:
   - Add a DT_UNKNOWN fallback that calls `fs.promises.stat()` when none of `isFile()`, `isSymbolicLink()`, `isDirectory()` returns true
   - In `show_dir()`, resolve type 0 entries via `stat()` instead of skipping them
   - Preserve the zero-overhead optimization for regular files (type 1) — only call `stat()` when type is unknown

5. **Ensure all existing tests still pass** — The fixes must not break current behavior for regular files or standard symlinks

## Suggested Test Structure

```javascript
describe('DT_UNKNOWN filesystem support (NixOS buildFHSEnv, overlayfs, FUSE)', () => {

  // Helper: create Dirent with DT_UNKNOWN (type 0)
  // Node.js 18+: new fs.Dirent(name, 0)

  describe('isFileOrSymlinkToFile with DT_UNKNOWN', () => {
    test('should return true for DT_UNKNOWN entry pointing to a regular file');
    test('should return false for DT_UNKNOWN entry pointing to a directory');
    test('should return false for DT_UNKNOWN entry pointing to nothing (broken)');
  });

  describe('isDirOrSymlinkToDir with DT_UNKNOWN', () => {
    test('should return true for DT_UNKNOWN entry pointing to a directory');
    test('should return false for DT_UNKNOWN entry pointing to a regular file');
  });

  describe('findIndexFile with DT_UNKNOWN entries', () => {
    test('should find index.html when all dirents have DT_UNKNOWN type');
    test('should find index.ejs via string pattern when type is unknown');
    test('should find index.ejs via RegExp pattern when type is unknown');
    test('should not find index in directory with only subdirectories (all DT_UNKNOWN)');
  });

  describe('show_dir with DT_UNKNOWN entries', () => {
    test('should list files with DT_UNKNOWN as their resolved type (FILE/DIR)');
    test('should not skip entries or log "Unknown file type: 0"');
    test('should show correct mime types for DT_UNKNOWN files');
    test('should show correct sizes for DT_UNKNOWN files');
  });

  describe('integration: full request with DT_UNKNOWN filesystem', () => {
    // Mock readdir to return DT_UNKNOWN, keep stat working normally
    test('GET / serves index file instead of directory listing');
    test('GET /somefile.txt serves the file with 200');
    test('directory listing shows all entries correctly');
  });
});
```

## Suggested Fix Pattern

```javascript
async function isFileOrSymlinkToFile(dirent, dirPath) {
    if (dirent.isFile()) return true;
    if (dirent.isSymbolicLink()) {
        try {
            const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
            return realStat.isFile();
        } catch {
            return false;
        }
    }
    // NEW: Handle DT_UNKNOWN (type 0) — filesystem doesn't report d_type
    // This occurs on overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs
    if (!dirent.isDirectory() && !dirent.isBlockDevice() && !dirent.isCharacterDevice() && !dirent.isFIFO() && !dirent.isSocket()) {
        try {
            const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
            return realStat.isFile();
        } catch {
            return false;
        }
    }
    return false;
}
```

**Performance note:** The DT_UNKNOWN fallback only triggers when `d_type` is genuinely unknown (type 0). On standard filesystems (ext4, btrfs, xfs, APFS, NTFS), `d_type` is always filled correctly, so the existing fast paths (`isFile()`, `isSymbolicLink()`) handle everything and the new `stat()` fallback is never reached.

## Reference

- **Reported by:** ital8cms project (consumer of koa-classic-server)
- **Node.js Dirent docs:** https://nodejs.org/api/fs.html#class-fsdirent
- **Linux d_type documentation:** `man 2 getdents` — "Currently, only some filesystems (among them: Btrfs, ext2, ext3, and ext4) have full support for returning the file type in d_type. All applications must properly handle a return of DT_UNKNOWN."
- **Existing symlink tests:** `__tests__/symlink.test.js` (10 test suites, all passing)
- **Existing fix (v2.4.0):** `isFileOrSymlinkToFile()` / `isDirOrSymlinkToDir()` helpers
