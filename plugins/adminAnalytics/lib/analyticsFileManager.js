/**
 * ANALYTICS FILE MANAGER
 *
 * Read/write operations for plugins/analytics/pluginConfig.json5.
 *
 * Design goal: preserve all inline comments in the file at every save.
 * Strategy:
 *   - Per-tab saves  → read the raw file text, replace each changed field
 *                      value surgically with a regex, write back the raw text.
 *   - Textarea saves → the caller already holds the raw JSON5 string;
 *                      validate it and write it as-is (comments untouched).
 *
 * All writes are atomic: temp file + fs.rename.
 *
 * @module plugins/adminAnalytics/lib/analyticsFileManager
 */

'use strict';

const fs          = require('fs');
const fsPromises  = require('fs').promises;
const path        = require('path');
const json5       = require('json5');
const loadJson5   = require('../../../core/loadJson5');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialises a primitive value to a JSON5-compatible literal.
 *
 * @param {boolean|number|string} value
 * @returns {string}
 */
function primitiveToLiteral(value) {
  if (typeof value === 'string')  return JSON.stringify(value); // adds quotes + escaping
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  return JSON.stringify(value);
}

/**
 * Replaces the value of a single top-level field inside a raw JSON5 string,
 * preserving all surrounding text and comments.
 *
 * Handles two cases:
 *  - string values  → replaces the quoted string `"..."` (even if it contains commas)
 *  - boolean/number → replaces the token up to the next comma or line ending
 *
 * The trailing comma (if present) is kept intact.
 *
 * @param {string} raw        - Full raw JSON5 file content
 * @param {string} fieldName  - Key to update (must be inside the "custom" block)
 * @param {boolean|number|string} newValue
 * @returns {string} Updated raw content
 */
function updateFieldInRaw(raw, fieldName, newValue) {
  const newLiteral = primitiveToLiteral(newValue);

  let regex;
  if (typeof newValue === 'string') {
    // Match:  "fieldName"   :   "anything here"
    regex = new RegExp(`("${fieldName}"\\s*:\\s*)"[^"]*"`, 'm');
  } else {
    // Match:  "fieldName"   :   <token until comma or newline>
    regex = new RegExp(`("${fieldName}"\\s*:\\s*)[^,\\n\\r]+`, 'm');
  }

  return raw.replace(regex, (_match, keyPart) => `${keyPart}${newLiteral}`);
}

// ─── read ─────────────────────────────────────────────────────────────────────

/**
 * Reads plugins/analytics/pluginConfig.json5.
 * Returns both the parsed custom block (for the form) and the raw text (for the textarea).
 *
 * @param {string} analyticsPluginPath - Absolute path to the analytics plugin directory
 * @returns {{ success: boolean, data?: object, raw?: string, error?: string }}
 */
function readSettings(analyticsPluginPath) {
  try {
    const configPath = path.join(analyticsPluginPath, 'pluginConfig.json5');
    const raw        = fs.readFileSync(configPath, 'utf8');
    const full       = json5.parse(raw);
    return { success: true, data: full.custom || {}, raw };
  } catch (err) {
    return { success: false, error: `Failed to read pluginConfig.json5: ${err.message}` };
  }
}

// ─── write (per-tab, surgical) ────────────────────────────────────────────────

/**
 * Saves individual fields from a tab into plugins/analytics/pluginConfig.json5
 * while preserving all comments.
 *
 * @param {string} analyticsPluginPath
 * @param {object} customData          - The complete new custom block (all 8 fields)
 * @param {string} backupDir
 * @param {number} maxBackups
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function saveSettings(analyticsPluginPath, customData, backupDir, maxBackups) {
  const configPath = path.join(analyticsPluginPath, 'pluginConfig.json5');
  try {
    // Read current raw file
    let raw = await fsPromises.readFile(configPath, 'utf8');

    // Create backup before any modification
    await createBackup(configPath, backupDir, maxBackups);

    // Surgical replacement for every known custom field
    const fields = [
      'gdprCompliance',
      'sessionSalt',
      'useAnalyticsCookie',
      'analyticsCookieName',
      'rotationMode',
      'retentionDays',
      'dataPath',
      'flushIntervalSeconds',
    ];

    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(customData, field)) {
        raw = updateFieldInRaw(raw, field, customData[field]);
      }
    }

    // Atomic write
    await atomicWrite(configPath, raw);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to save pluginConfig.json5: ${err.message}` };
  }
}

// ─── write (textarea / raw JSON5 string) ─────────────────────────────────────

/**
 * Saves the full raw JSON5 string from the textarea editor.
 * Comments and formatting are preserved as written by the user.
 * The caller must have already validated the string (json5.parse succeeds).
 *
 * @param {string} analyticsPluginPath
 * @param {string} rawContent  - Validated raw JSON5 string
 * @param {string} backupDir
 * @param {number} maxBackups
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function saveRawSettings(analyticsPluginPath, rawContent, backupDir, maxBackups) {
  const configPath = path.join(analyticsPluginPath, 'pluginConfig.json5');
  try {
    await createBackup(configPath, backupDir, maxBackups);
    await atomicWrite(configPath, rawContent);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to save pluginConfig.json5: ${err.message}` };
  }
}

// ─── backup ───────────────────────────────────────────────────────────────────

async function createBackup(filePath, backupDir, maxBackups) {
  try {
    await fsPromises.mkdir(backupDir, { recursive: true });
    const content   = await fsPromises.readFile(filePath, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `analyticsConfig_${timestamp}.json5`);
    await fsPromises.writeFile(backupPath, content, 'utf8');
    await cleanupBackups(backupDir, maxBackups);
  } catch (err) {
    console.warn(`[analyticsFileManager] Failed to create backup: ${err.message}`);
  }
}

async function cleanupBackups(backupDir, maxBackups) {
  try {
    const files = await fsPromises.readdir(backupDir);
    const backups = files
      .filter(f => f.startsWith('analyticsConfig_') && f.endsWith('.json5'))
      .sort()
      .reverse();
    for (const file of backups.slice(maxBackups)) {
      await fsPromises.unlink(path.join(backupDir, file));
    }
  } catch (err) {
    console.warn(`[analyticsFileManager] Failed to cleanup backups: ${err.message}`);
  }
}

// ─── atomic write ─────────────────────────────────────────────────────────────

async function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp';
  await fsPromises.writeFile(tmpPath, content, 'utf8');
  await fsPromises.rename(tmpPath, filePath);
}

// ─── storage info ─────────────────────────────────────────────────────────────

/**
 * Returns information about the analytics data directory for the Info tab.
 *
 * @param {string} dataDir - Absolute path to the analytics data directory
 * @returns {{ fileCount: number, totalBytes: number, oldestFile: string|null, newestFile: string|null }}
 */
function readStorageInfo(dataDir) {
  try {
    if (!fs.existsSync(dataDir)) {
      return { fileCount: 0, totalBytes: 0, oldestFile: null, newestFile: null };
    }
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort();

    let totalBytes = 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(dataDir, f));
        totalBytes += stat.size;
      } catch (_) { /* skip unreadable */ }
    }

    return {
      fileCount:  files.length,
      totalBytes,
      oldestFile: files.length > 0 ? files[0]             : null,
      newestFile: files.length > 0 ? files[files.length - 1] : null,
    };
  } catch (err) {
    return { fileCount: 0, totalBytes: 0, oldestFile: null, newestFile: null, error: err.message };
  }
}

module.exports = {
  readSettings,
  saveSettings,
  saveRawSettings,
  readStorageInfo,
};
