/**
 * fileValidator.js
 *
 * Validates uploaded files by:
 *   1. Checking the file extension against the allowed whitelist
 *   2. Reading the actual file bytes (magic bytes) to confirm the real MIME type
 *   3. Verifying the file size is within the per-category limit
 *
 * Double validation (extension + magic bytes) prevents:
 *   - Masking a dangerous file as an image by renaming it
 *   - Serving executable content disguised with a media extension
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Allowed extensions grouped by category ───────────────────────────────────
const ALLOWED = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'],
  video: ['mp4', 'webm', 'mov'],
  audio: ['mp3', 'wav', 'ogg', 'aac', 'flac'],
};

// ── Magic byte signatures ────────────────────────────────────────────────────
// Each entry: { category, exts[], check(buf) }
// buf is a Buffer of the first 16 bytes of the file.
const MAGIC_SIGNATURES = [
  // JPEG: FF D8 FF
  { category: 'image', exts: ['jpg', 'jpeg'], check: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { category: 'image', exts: ['png'], check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  // GIF: 47 49 46 38 (GIF8)
  { category: 'image', exts: ['gif'], check: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  // WebP: RIFF????WEBP
  { category: 'image', exts: ['webp'], check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  // BMP: BM
  { category: 'image', exts: ['bmp'], check: (b) => b[0] === 0x42 && b[1] === 0x4D },
  // AVIF / HEIF: ....ftypavif or ....ftypheic — check bytes 4-7 for 'ftyp'
  { category: 'image', exts: ['avif'], check: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },

  // MP4 / MOV: ....ftyp
  { category: 'video', exts: ['mp4', 'mov'], check: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  // WebM: 1A 45 DF A3
  { category: 'video', exts: ['webm'], check: (b) => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3 },

  // MP3: ID3 tag (49 44 33) or frame sync (FF FB / FF F3 / FF F2)
  { category: 'audio', exts: ['mp3'], check: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] === 0xFB || b[1] === 0xF3 || b[1] === 0xF2)) },
  // WAV: RIFF????WAVE
  { category: 'audio', exts: ['wav'], check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45 },
  // OGG: OggS (4F 67 67 53)
  { category: 'audio', exts: ['ogg'], check: (b) => b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
  // FLAC: fLaC (66 4C 61 43)
  { category: 'audio', exts: ['flac'], check: (b) => b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43 },
  // AAC / M4A: ....ftyp (same as MP4 container — ftyp at offset 4)
  { category: 'audio', exts: ['aac'], check: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the category for a given extension, or null if not allowed.
 * @param {string} ext - lowercase, without dot
 * @returns {'image'|'video'|'audio'|null}
 */
function getCategoryByExt(ext) {
  for (const [cat, exts] of Object.entries(ALLOWED)) {
    if (exts.includes(ext)) return cat;
  }
  return null;
}

/**
 * Reads the first 16 bytes of a file into a Buffer.
 * @param {string} filePath
 * @returns {Buffer}
 */
function readMagicBytes(filePath) {
  const buf = Buffer.alloc(16);
  const fd  = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

/**
 * Checks whether the file's magic bytes are consistent with the expected category.
 * Returns true if at least one matching signature is found.
 *
 * @param {Buffer} buf       - First 16 bytes of the file
 * @param {string} ext       - Expected extension (lowercase, no dot)
 * @param {string} category  - Expected category
 * @returns {boolean}
 */
function isMagicValid(buf, ext, category) {
  const matching = MAGIC_SIGNATURES.filter(sig => sig.category === category && sig.exts.includes(ext));
  if (matching.length === 0) {
    // No specific signature for this ext/category combination — allow (best-effort)
    return true;
  }
  return matching.some(sig => {
    try { return sig.check(buf); } catch { return false; }
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates an uploaded file that has already been saved to disk by multer.
 *
 * @param {string} tmpFilePath   - Absolute path to the temp file on disk
 * @param {string} originalName  - Original filename from the client
 * @param {number} fileSize      - File size in bytes (from multer)
 * @param {object} sizeLimits    - { image: bytes, video: bytes, audio: bytes }
 * @returns {{ valid: boolean, error?: string, category?: string }}
 */
function validate(tmpFilePath, originalName, fileSize, sizeLimits) {
  // ── 1. Extension check ───────────────────────────────────────────────────
  const ext      = path.extname(originalName).toLowerCase().slice(1);
  const category = getCategoryByExt(ext);

  if (!category) {
    return { valid: false, error: `File type ".${ext}" is not allowed` };
  }

  // ── 2. Size check ────────────────────────────────────────────────────────
  const limit = sizeLimits[category];
  if (limit && fileSize > limit) {
    const limitMB = (limit / 1024 / 1024).toFixed(0);
    const fileMB  = (fileSize / 1024 / 1024).toFixed(1);
    return { valid: false, error: `File too large: ${fileMB} MB (max ${limitMB} MB for ${category})` };
  }

  // ── 3. Magic bytes check ────────────────────────────────────────────────
  let buf;
  try {
    buf = readMagicBytes(tmpFilePath);
  } catch {
    return { valid: false, error: 'Could not read file content for validation' };
  }

  if (!isMagicValid(buf, ext, category)) {
    return { valid: false, error: `File content does not match its extension ".${ext}" (possible spoofing attempt)` };
  }

  return { valid: true, category };
}

module.exports = { validate, getCategoryByExt, ALLOWED };
