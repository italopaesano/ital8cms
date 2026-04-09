/**
 * filenameSanitizer.js
 *
 * Sanitizes filenames before saving to disk and resolves name collisions.
 *
 * Sanitization rules:
 *   - Lowercase the entire name
 *   - Replace spaces with underscores
 *   - Remove any character that is not: a-z, 0-9, _ - .
 *   - Collapse consecutive underscores / hyphens into one
 *   - Truncate base name to MAX_BASE_LENGTH characters
 *   - Preserve the original extension (lowercased)
 *   - If the result is empty, fall back to 'file'
 *
 * Collision resolution:
 *   - If the sanitized name already exists in the target directory,
 *     append a numeric suffix: photo.jpg → photo_1.jpg → photo_2.jpg …
 *   - Up to MAX_SUFFIX attempts; returns null if all are taken (edge case).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_BASE_LENGTH = 200;
const MAX_SUFFIX      = 9999;

/**
 * Sanitizes a filename, preserving the extension.
 *
 * @param {string} originalName - Original filename from the client
 * @returns {string}            - Sanitized filename (always safe for disk)
 */
function sanitize(originalName) {
  const ext      = path.extname(originalName).toLowerCase();         // e.g. '.jpg'
  const baseName = path.basename(originalName, path.extname(originalName));

  let safe = baseName
    .toLowerCase()
    .replace(/\s+/g, '_')                    // spaces → underscores
    .replace(/[^a-z0-9_\-]/g, '')           // remove disallowed chars
    .replace(/_{2,}/g, '_')                  // collapse consecutive underscores
    .replace(/-{2,}/g, '-')                  // collapse consecutive hyphens
    .replace(/^[_\-]+|[_\-]+$/g, '');       // trim leading/trailing _ -

  // Truncate
  if (safe.length > MAX_BASE_LENGTH) safe = safe.slice(0, MAX_BASE_LENGTH);

  // Fallback if nothing remains
  if (!safe) safe = 'file';

  return safe + ext;
}

/**
 * Resolves a filename collision in a given directory by appending a suffix.
 *
 * @param {string} dirAbsPath     - Absolute path of the target directory
 * @param {string} sanitizedName  - Already-sanitized filename
 * @returns {string|null}         - A non-colliding filename, or null if all tried
 */
function resolveCollision(dirAbsPath, sanitizedName) {
  const targetPath = path.join(dirAbsPath, sanitizedName);

  // No collision — use as-is
  if (!fs.existsSync(targetPath)) return sanitizedName;

  const ext      = path.extname(sanitizedName);
  const baseName = path.basename(sanitizedName, ext);

  for (let i = 1; i <= MAX_SUFFIX; i++) {
    const candidate     = `${baseName}_${i}${ext}`;
    const candidatePath = path.join(dirAbsPath, candidate);
    if (!fs.existsSync(candidatePath)) return candidate;
  }

  return null; // Extremely unlikely — all suffixes taken
}

module.exports = { sanitize, resolveCollision };
