/**
 * navbarFileManager.js
 *
 * Handles filesystem operations for navbar configuration files:
 * - Scanning wwwPath recursively for navbar.*.json5 files
 * - Reading/writing navbar config files
 * - Backup management (create, cleanup, soft delete)
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');

/**
 * Scans a directory recursively for navbar.*.json5 files
 * @param {string} scanDir - Absolute path to scan
 * @returns {Array<object>} - Array of { name, fileName, filePath, relativePath, type }
 */
function scanNavbarFiles(scanDir) {
  const results = [];

  if (!fs.existsSync(scanDir)) {
    console.warn(`[adminBootstrapNavbar] Scan directory not found: ${scanDir}`);
    return results;
  }

  function scanRecursive(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[adminBootstrapNavbar] Cannot read directory: ${currentDir} - ${err.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        // For symlinks, check if target is directory
        if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              scanRecursive(fullPath);
            }
          } catch (err) {
            // Broken symlink, skip
          }
        } else {
          scanRecursive(fullPath);
        }
      } else if (entry.isFile() && /^navbar\.(.+)\.json5$/.test(entry.name)) {
        const match = entry.name.match(/^navbar\.(.+)\.json5$/);
        const navbarName = match[1];
        const relativePath = path.relative(scanDir, currentDir);

        // Try to read settings.type for display
        let navbarType = 'unknown';
        try {
          const config = loadJson5(fullPath);
          navbarType = (config.settings && config.settings.type) || 'horizontal';
        } catch (err) {
          // File exists but can't parse — still include it
        }

        results.push({
          name: navbarName,
          fileName: entry.name,
          filePath: fullPath,
          relativePath: relativePath || '.',
          type: navbarType,
        });
      }
    }
  }

  scanRecursive(scanDir);
  return results;
}

/**
 * Reads a navbar config file
 * @param {string} filePath - Absolute path to the file
 * @returns {object} - { success: true, content: string, parsed: object } or { success: false, error: string }
 */
function readNavbarFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
      parsed = loadJson5(filePath);
    } catch (parseErr) {
      // Return content even if parse fails (user can fix it)
      return { success: true, content, parsed: null, parseError: parseErr.message };
    }

    return { success: true, content, parsed };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Creates a backup of a file before modification
 * @param {string} filePath - Absolute path to the original file
 * @param {string} backupDir - Absolute path to the backups directory
 * @param {string} wwwDir - Absolute path to wwwPath (for relative path computation)
 * @param {number} maxBackups - Max number of backups per file
 */
function createBackup(filePath, backupDir, wwwDir, maxBackups) {
  if (!fs.existsSync(filePath)) return;

  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const relativePath = path.relative(wwwDir, path.dirname(filePath));
  const fileName = path.basename(filePath, '.json5');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Build backup filename: relativePath__fileName___timestamp.json5
  const relPart = relativePath && relativePath !== '.' ? relativePath.replace(/[/\\]/g, '__') + '__' : '';
  const backupFileName = `${relPart}${fileName}___${timestamp}.json5`;
  const backupFilePath = path.join(backupDir, backupFileName);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(backupFilePath, content, 'utf8');
    console.log(`[adminBootstrapNavbar] Backup created: ${backupFileName}`);
  } catch (err) {
    console.error(`[adminBootstrapNavbar] Backup failed: ${err.message}`);
    return;
  }

  // Cleanup old backups for this file
  cleanupBackups(backupDir, relPart + fileName, maxBackups);
}

/**
 * Removes old backups exceeding maxBackups for a specific file
 * @param {string} backupDir - Backups directory
 * @param {string} filePrefix - File prefix to match
 * @param {number} maxBackups - Max to keep
 */
function cleanupBackups(backupDir, filePrefix, maxBackups) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(filePrefix + '___') && f.endsWith('.json5'))
      .sort(); // Sorted by name = sorted by timestamp (ISO format)

    if (files.length > maxBackups) {
      const toRemove = files.slice(0, files.length - maxBackups);
      for (const f of toRemove) {
        fs.unlinkSync(path.join(backupDir, f));
        console.log(`[adminBootstrapNavbar] Old backup removed: ${f}`);
      }
    }
  } catch (err) {
    console.warn(`[adminBootstrapNavbar] Backup cleanup error: ${err.message}`);
  }
}

/**
 * Saves content to a navbar file (with backup)
 * @param {string} filePath - Absolute path to save to
 * @param {string} content - JSON5 content string
 * @param {string} backupDir - Backups directory
 * @param {string} wwwDir - wwwPath directory
 * @param {number} maxBackups - Max backups per file
 * @returns {object} - { success: true } or { success: false, error: string }
 */
function saveNavbarFile(filePath, content, backupDir, wwwDir, maxBackups) {
  try {
    // Create backup if file already exists
    if (fs.existsSync(filePath)) {
      createBackup(filePath, backupDir, wwwDir, maxBackups);
    }

    // Atomic write
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Creates a new navbar file
 * @param {string} filePath - Absolute path for the new file
 * @param {string} content - JSON5 content
 * @returns {object} - { success: true } or { success: false, error: string }
 */
function createNavbarFile(filePath, content) {
  try {
    if (fs.existsSync(filePath)) {
      return { success: false, error: `File already exists: ${path.basename(filePath)}` };
    }

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Soft-deletes a navbar file (moves to backups)
 * @param {string} filePath - Absolute path to the file
 * @param {string} backupDir - Backups directory
 * @param {string} wwwDir - wwwPath directory
 * @returns {object} - { success: true } or { success: false, error: string }
 */
function deleteNavbarFile(filePath, backupDir, wwwDir) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${path.basename(filePath)}` };
    }

    // Move to backups (soft delete)
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const relativePath = path.relative(wwwDir, path.dirname(filePath));
    const fileName = path.basename(filePath, '.json5');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const relPart = relativePath && relativePath !== '.' ? relativePath.replace(/[/\\]/g, '__') + '__' : '';
    const backupFileName = `${relPart}${fileName}___DELETED___${timestamp}.json5`;
    const backupFilePath = path.join(backupDir, backupFileName);

    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(backupFilePath, content, 'utf8');
    fs.unlinkSync(filePath);

    console.log(`[adminBootstrapNavbar] File soft-deleted: ${path.basename(filePath)} → ${backupFileName}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  scanNavbarFiles,
  readNavbarFile,
  saveNavbarFile,
  createNavbarFile,
  deleteNavbarFile,
  createBackup,
};
