/**
 * JSON5 Loader Module
 *
 * Centralized JSON5 file loading with support for comments and trailing commas.
 * All configuration files in this project use JSON5 format (.json5 extension).
 *
 * Usage:
 *   const loadJson5 = require('./core/loadJson5');
 *   const config = loadJson5('./ital8Config.json5');
 */

const json5 = require('json5');
const fs = require('fs');
const path = require('path');

/**
 * Load and parse a JSON5 file
 * @param {string} filePath - Absolute or relative path to JSON5 file
 * @param {string} [callerDir] - Directory of the calling file (optional, for relative paths)
 * @returns {any} - Parsed JSON5 object
 * @throws {Error} - If file cannot be read or parsed
 */
function loadJson5(filePath, callerDir = null) {
  try {
    // Se il path è relativo e abbiamo callerDir, risolvi relativo a callerDir
    let resolvedPath = filePath;
    if (!path.isAbsolute(filePath) && callerDir) {
      resolvedPath = path.resolve(callerDir, filePath);
    } else if (!path.isAbsolute(filePath)) {
      // Se non è assoluto e non abbiamo callerDir, usa la directory corrente
      resolvedPath = path.resolve(process.cwd(), filePath);
    }

    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    return json5.parse(fileContent);
  } catch (error) {
    console.error(`[loadJson5] Error loading JSON5 file: ${filePath}`);
    console.error(`[loadJson5] Error details:`, error.message);
    throw error;
  }
}

module.exports = loadJson5;
