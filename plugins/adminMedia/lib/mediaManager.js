/**
 * mediaManager.js
 *
 * Filesystem operations for the adminMedia plugin.
 * All public methods accept paths relative to mediaDirAbsolute and enforce
 * path traversal protection: no operation can escape the media root.
 *
 * Ignored entries (never listed or operated on):
 *   - .tmp/  (multer temp directory)
 *   - any entry starting with '.'
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Resolves a relative path against the media root and verifies the result
 * stays inside the root (path traversal protection).
 *
 * @param {string} mediaRoot   - Absolute path to the media directory
 * @param {string} relPath     - Relative path from the client (may contain subfolders)
 * @returns {string|null}      - Resolved absolute path, or null if traversal detected
 */
function safeResolve(mediaRoot, relPath) {
  // Normalize: remove leading slashes, collapse '..' and '.'
  const normalizedRel = path.normalize(relPath || '').replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(mediaRoot, normalizedRel);

  // Ensure the resolved path starts with the media root
  const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
  if (resolved !== mediaRoot && !resolved.startsWith(rootWithSep)) {
    return null; // Path traversal attempt
  }
  return resolved;
}

/**
 * Returns the file category based on extension.
 * @param {string} filename
 * @returns {'image'|'video'|'audio'|'unknown'}
 */
function getCategory(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio';
  return 'unknown';
}

/**
 * Returns a stat-based metadata object for a directory entry.
 * @param {string} entryPath - Absolute path
 * @param {string} name      - Entry name
 * @returns {object}
 */
function buildEntryMeta(entryPath, name) {
  const stat     = fs.statSync(entryPath);
  const isDir    = stat.isDirectory();
  const category = isDir ? 'folder' : getCategory(name);
  return {
    name,
    type:     isDir ? 'folder' : 'file',
    category,
    size:     isDir ? null : stat.size,
    modified: stat.mtime.toISOString(),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves a relative path to an absolute path inside the media root.
 * Used externally (e.g. in main.js for upload target resolution).
 *
 * @param {string} mediaRoot
 * @param {string} relPath
 * @returns {string|null}
 */
function resolveAbsPath(mediaRoot, relPath) {
  return safeResolve(mediaRoot, relPath) || mediaRoot;
}

/**
 * Lists all files and folders inside a relative path.
 *
 * @param {string} mediaRoot
 * @param {string} relPath
 * @returns {{ success: boolean, data?: object, error?: string, status?: number }}
 */
function listDirectory(mediaRoot, relPath) {
  const absPath = safeResolve(mediaRoot, relPath);
  if (!absPath) return { success: false, status: 403, error: 'Path traversal detected' };
  if (!fs.existsSync(absPath)) return { success: false, status: 404, error: 'Directory not found' };
  if (!fs.statSync(absPath).isDirectory()) return { success: false, status: 400, error: 'Not a directory' };

  const entries = fs.readdirSync(absPath, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.')) // skip hidden and .tmp
    .map(d => buildEntryMeta(path.join(absPath, d.name), d.name))
    .sort((a, b) => {
      // Folders first, then files; alphabetical within each group
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return { success: true, data: { path: relPath, entries } };
}

/**
 * Creates a new subfolder.
 *
 * @param {string} mediaRoot
 * @param {string} relPath   - Parent folder (relative)
 * @param {string} name      - New folder name
 * @returns {{ success: boolean, error?: string }}
 */
function createFolder(mediaRoot, relPath, name) {
  if (!name || typeof name !== 'string') return { success: false, error: 'Folder name required' };

  // Sanitize folder name: alphanumeric, spaces, hyphens, underscores only
  const safeName = name.trim().replace(/[^a-zA-Z0-9 _\-]/g, '').replace(/\s+/g, '_');
  if (!safeName) return { success: false, error: 'Folder name contains only invalid characters' };

  const parentAbs = safeResolve(mediaRoot, relPath);
  if (!parentAbs) return { success: false, error: 'Path traversal detected' };

  const newFolderAbs = path.join(parentAbs, safeName);

  // Prevent resolving the joined path outside the media root
  const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
  if (!newFolderAbs.startsWith(rootWithSep)) return { success: false, error: 'Path traversal detected' };

  if (fs.existsSync(newFolderAbs)) return { success: false, error: 'Folder already exists' };

  fs.mkdirSync(newFolderAbs);
  return { success: true };
}

/**
 * Renames a file or folder.
 *
 * @param {string} mediaRoot
 * @param {string} relPath   - Current path (relative, includes item name)
 * @param {string} newName   - New name (basename only, no path separators)
 * @returns {{ success: boolean, isFolder?: boolean, error?: string }}
 */
function renameItem(mediaRoot, relPath, newName) {
  if (!newName || typeof newName !== 'string') return { success: false, error: 'New name required' };
  if (newName.includes('/') || newName.includes('\\')) return { success: false, error: 'Name cannot contain path separators' };

  const srcAbs = safeResolve(mediaRoot, relPath);
  if (!srcAbs) return { success: false, error: 'Path traversal detected' };
  if (!fs.existsSync(srcAbs)) return { success: false, error: 'Item not found' };

  const isFolder = fs.statSync(srcAbs).isDirectory();
  const parentDir = path.dirname(srcAbs);

  // For files: sanitize the new name; for folders: strip special chars
  let safeName;
  if (isFolder) {
    safeName = newName.trim().replace(/[^a-zA-Z0-9 _\-]/g, '').replace(/\s+/g, '_');
  } else {
    // Preserve extension, sanitize base
    const ext  = path.extname(newName).toLowerCase();
    const base = path.basename(newName, ext);
    const safeBase = base.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '');
    safeName = safeBase + ext;
  }

  if (!safeName) return { success: false, error: 'New name contains only invalid characters' };

  const destAbs = path.join(parentDir, safeName);

  // Traversal check on destination
  const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
  if (destAbs !== mediaRoot && !destAbs.startsWith(rootWithSep)) {
    return { success: false, error: 'Path traversal detected' };
  }

  if (fs.existsSync(destAbs) && destAbs !== srcAbs) return { success: false, error: 'An item with this name already exists' };

  fs.renameSync(srcAbs, destAbs);
  return { success: true, isFolder };
}

/**
 * Moves a file to a different folder.
 * If a file with the same name exists at destination, auto-renames.
 *
 * @param {string} mediaRoot
 * @param {string} srcRelPath  - Source file (relative)
 * @param {string} destRelPath - Destination folder (relative)
 * @returns {{ success: boolean, finalName?: string, error?: string }}
 */
function moveFile(mediaRoot, srcRelPath, destRelPath) {
  const srcAbs  = safeResolve(mediaRoot, srcRelPath);
  const destDir = safeResolve(mediaRoot, destRelPath);

  if (!srcAbs)  return { success: false, error: 'Path traversal detected (source)' };
  if (!destDir) return { success: false, error: 'Path traversal detected (destination)' };
  if (!fs.existsSync(srcAbs))  return { success: false, error: 'Source file not found' };
  if (!fs.existsSync(destDir)) return { success: false, error: 'Destination folder not found' };
  if (fs.statSync(srcAbs).isDirectory()) return { success: false, error: 'Cannot move a folder (use rename)' };

  const { resolveCollision } = require('./filenameSanitizer');
  const baseName  = path.basename(srcAbs);
  const finalName = resolveCollision(destDir, baseName);
  const destAbs   = path.join(destDir, finalName);

  // Verify destination doesn't escape media root
  const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
  if (!destAbs.startsWith(rootWithSep)) return { success: false, error: 'Path traversal detected' };

  fs.renameSync(srcAbs, destAbs);
  return { success: true, finalName };
}

/**
 * Deletes a single file.
 *
 * @param {string} mediaRoot
 * @param {string} relPath - File path (relative)
 * @returns {{ success: boolean, error?: string }}
 */
function deleteFile(mediaRoot, relPath) {
  const absPath = safeResolve(mediaRoot, relPath);
  if (!absPath) return { success: false, error: 'Path traversal detected' };
  if (!fs.existsSync(absPath)) return { success: false, error: 'File not found' };
  if (fs.statSync(absPath).isDirectory()) return { success: false, error: 'Path points to a directory; use deleteFolder' };

  fs.unlinkSync(absPath);
  return { success: true };
}

/**
 * Deletes a folder, either empty-only or recursively.
 *
 * @param {string} mediaRoot
 * @param {string} relPath    - Folder path (relative)
 * @param {boolean} recursive - If false, only deletes empty folders
 * @returns {{ success: boolean, error?: string }}
 */
function deleteFolder(mediaRoot, relPath, recursive) {
  const absPath = safeResolve(mediaRoot, relPath);
  if (!absPath) return { success: false, error: 'Path traversal detected' };
  if (!fs.existsSync(absPath)) return { success: false, error: 'Folder not found' };
  if (!fs.statSync(absPath).isDirectory()) return { success: false, error: 'Path is not a directory' };

  // Prevent deleting the media root itself
  if (path.resolve(absPath) === path.resolve(mediaRoot)) {
    return { success: false, error: 'Cannot delete the media root directory' };
  }

  if (!recursive) {
    const contents = fs.readdirSync(absPath);
    if (contents.length > 0) return { success: false, error: 'Folder is not empty; use recursive delete' };
    fs.rmdirSync(absPath);
  } else {
    fs.rmSync(absPath, { recursive: true, force: true });
  }

  return { success: true };
}

/**
 * Builds a recursive folder tree (no files — used for the move picker).
 *
 * @param {string} mediaRoot
 * @param {string} [relPath=''] - Starting path (relative)
 * @returns {Array<{ name: string, path: string, children: Array }>}
 */
function buildFolderTree(mediaRoot, relPath = '') {
  const absPath = safeResolve(mediaRoot, relPath);
  if (!absPath || !fs.existsSync(absPath)) return [];

  return fs.readdirSync(absPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => {
      const childRelPath = relPath ? `${relPath}/${d.name}` : d.name;
      return {
        name:     d.name,
        path:     childRelPath,
        children: buildFolderTree(mediaRoot, childRelPath),
      };
    });
}

module.exports = {
  resolveAbsPath,
  listDirectory,
  createFolder,
  renameItem,
  moveFile,
  deleteFile,
  deleteFolder,
  buildFolderTree,
};
