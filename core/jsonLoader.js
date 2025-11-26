/**
 * JSON5 Loader Module
 *
 * Centralized JSON5 file loading with support for comments and trailing commas.
 * All .json files in this project use JSON5 format.
 *
 * Usage:
 *   const loadJson = require('./core/jsonLoader');
 *   const config = loadJson('./ital8Config.json');
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
function loadJson(filePath, callerDir = null) {
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
    console.error(`[jsonLoader] Error loading JSON5 file: ${filePath}`);
    console.error(`[jsonLoader] Error details:`, error.message);
    throw error;
  }
}

module.exports = loadJson;
