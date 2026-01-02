/**
 * JSON5 Saver Module
 *
 * Saves JSON5 files preserving the standard comment header.
 * This ensures that files maintain JSON5 compatibility after being modified.
 *
 * Usage:
 *   const saveJson5 = require('./core/saveJson5');
 *   await saveJson5('./path/to/file.json5', dataObject);
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Save data to a JSON5 file preserving the standard comment header
 * @param {string} filePath - Absolute or relative path to JSON5 file
 * @param {any} data - JavaScript object to save
 * @param {string} [callerDir] - Directory of the calling file (optional, for relative paths)
 * @returns {Promise<void>}
 * @throws {Error} - If file cannot be written
 */
async function saveJson5(filePath, data, callerDir = null) {
  try {
    // Resolve path
    let resolvedPath = filePath;
    if (!path.isAbsolute(filePath) && callerDir) {
      resolvedPath = path.resolve(callerDir, filePath);
    } else if (!path.isAbsolute(filePath)) {
      resolvedPath = path.resolve(process.cwd(), filePath);
    }

    // Standard JSON5 comment header
    const json5Header = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

    // Convert data to JSON string (formatted with 2-space indentation)
    const jsonContent = JSON.stringify(data, null, 2);

    // Combine header + content
    const fileContent = json5Header + jsonContent + '\n';

    // Write file atomically (write to temp file, then rename)
    const tempPath = resolvedPath + '.tmp';
    await fs.writeFile(tempPath, fileContent, 'utf8');
    await fs.rename(tempPath, resolvedPath);

    console.log('[saveJson5] File saved successfully: ' + filePath);
  } catch (error) {
    console.error('[saveJson5] Error saving JSON5 file: ' + filePath);
    console.error('[saveJson5] Error details:', error.message);
    throw error;
  }
}

module.exports = saveJson5;
