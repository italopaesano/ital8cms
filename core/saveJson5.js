/**
 * JSON5 Saver Module
 *
 * Saves JSON5 files with atomic write (temp file + rename).
 *
 * Accepts two input types:
 *
 *   - string: treated as raw JSON5 content. Validated via json5.parse()
 *             to ensure it is parseable, then written to disk as-is,
 *             preserving comments, trailing commas, and all JSON5 features.
 *
 *   - object: serialized with JSON.stringify (2-space indentation) and
 *             prefixed with the standard JSON5 comment header. Produces
 *             valid JSON5 (JSON is a subset of JSON5).
 *
 * Usage:
 *   const saveJson5 = require('./core/saveJson5');
 *
 *   // Save raw JSON5 string (preserves comments)
 *   await saveJson5('./path/to/file.json5', rawJson5String);
 *
 *   // Save object (serialized to clean JSON with JSON5 header)
 *   await saveJson5('./path/to/file.json5', dataObject);
 */

const fs = require('fs').promises;
const path = require('path');
const json5 = require('json5');

// Standard header prepended when saving from object
const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

/**
 * Save data to a JSON5 file.
 *
 * @param {string} filePath  - Absolute or relative path to the JSON5 file
 * @param {string|any} data  - Raw JSON5 string OR any serializable value (object, array, etc.)
 * @param {string} [callerDir] - Base directory for resolving relative paths (optional)
 * @returns {Promise<void>}
 * @throws {Error} - If the string is not valid JSON5, or if the file cannot be written
 */
async function saveJson5(filePath, data, callerDir = null) {
  try {
    // ── Path resolution ─────────────────────────────────────────────────────
    let resolvedPath = filePath;
    if (!path.isAbsolute(filePath) && callerDir) {
      resolvedPath = path.resolve(callerDir, filePath);
    } else if (!path.isAbsolute(filePath)) {
      resolvedPath = path.resolve(process.cwd(), filePath);
    }

    // ── Build file content based on input type ───────────────────────────────
    let fileContent;

    if (typeof data === 'string') {
      // Raw JSON5 string — validate first, then save as-is
      json5.parse(data); // throws SyntaxError if invalid
      fileContent = data;
    } else {
      // Object/array — serialize to clean JSON with standard JSON5 header
      fileContent = JSON5_HEADER + JSON.stringify(data, null, 2) + '\n';
    }

    // ── Atomic write (temp file + rename) ────────────────────────────────────
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
