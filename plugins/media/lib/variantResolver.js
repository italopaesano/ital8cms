/**
 * variantResolver.js  (plugin: media)
 *
 * Single source of truth for the OPTIMIZED-IMAGE VARIANT CONVENTION.
 *
 * It owns three things, so that both the reader (media) and the writer
 * (adminMedia, via the shared object) agree on the exact same layout:
 *
 *   1. Naming   — how the per-image variant folder and the variant files are named.
 *   2. Paths    — where the variant folder and the manifest live on disk.
 *   3. URLs     — the public URLs koa-classic-server serves them at.
 *   4. Manifest — read/write of the per-image manifest.json5 (atomic).
 *
 * Layout (for an original `foto.jpg` inside `{wwwPath}/{mediaDir}/sub/`):
 *
 *   sub/foto.jpg                          ← original (the only entry the GUI lists)
 *   sub/.foto.jpg.media/                  ← variant folder (dot-prefixed → hidden from GUI,
 *                                            served by koa-classic-server v3 which serves dotfiles)
 *       ├── manifest.json5                ← declares & links every derivative
 *       ├── web-1920.avif  web-1920.webp  web-1920.jpg
 *       ├── web-1280.*  web-768.*  web-480.*
 *       └── thumb-320.avif  thumb-320.webp  thumb-320.jpg
 *
 * The variant FILE names embed {preset}-{width}.{format} (NOT the original name),
 * so renaming/moving the original only touches the FOLDER name + manifest.original.file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');

// ── Convention constants ───────────────────────────────────────────────────

// Variant folder = "." + originalFileName + this suffix → ".foto.jpg.media"
const VARIANT_FOLDER_SUFFIX = '.media';

// Manifest file name (inside the variant folder)
const MANIFEST_FILENAME = 'manifest.json5';

// Image extensions eligible for optimization. GIF and BMP are intentionally
// excluded: animated GIFs would lose their animation through a still-image
// pipeline, and BMP is rare — both are served as-is, without variants.
const DEFAULT_OPTIMIZABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

// ── Naming ─────────────────────────────────────────────────────────────────

/** ".foto.jpg.media" for "foto.jpg" */
function variantFolderName(originalFileName) {
  return `.${originalFileName}${VARIANT_FOLDER_SUFFIX}`;
}

/** true if a directory entry name is a variant folder */
function isVariantFolderName(name) {
  return typeof name === 'string'
    && name.startsWith('.')
    && name.endsWith(VARIANT_FOLDER_SUFFIX)
    && name.length > 1 + VARIANT_FOLDER_SUFFIX.length;
}

/** ".foto.jpg.media" → "foto.jpg" (or null if not a variant folder) */
function originalNameFromVariantFolder(folderName) {
  if (!isVariantFolderName(folderName)) return null;
  return folderName.slice(1, folderName.length - VARIANT_FOLDER_SUFFIX.length);
}

/** "web-1920.webp" */
function variantFileName(preset, width, format) {
  return `${preset}-${width}.${format}`;
}

/** lowercase extension without the dot, e.g. "JPG" → "jpg" */
function getExtension(fileName) {
  return path.extname(fileName).toLowerCase().slice(1);
}

/** true if the file is an image we should optimize */
function isOptimizableImage(fileName, optimizableExts = DEFAULT_OPTIMIZABLE_EXTENSIONS) {
  return optimizableExts.includes(getExtension(fileName));
}

/** Normalizes a preset config (array of widths OR { widths: [...] }) to an array */
function presetWidths(presetConfig) {
  if (Array.isArray(presetConfig)) return presetConfig;
  if (presetConfig && Array.isArray(presetConfig.widths)) return presetConfig.widths;
  return [];
}

// ── Absolute paths (filesystem) ─────────────────────────────────────────────

/** Absolute path of the variant folder sitting next to an original file */
function variantFolderPathAbs(absFilePath) {
  return path.join(
    path.dirname(absFilePath),
    variantFolderName(path.basename(absFilePath))
  );
}

/** Absolute path of the manifest for an original file */
function manifestPathAbs(absFilePath) {
  return path.join(variantFolderPathAbs(absFilePath), MANIFEST_FILENAME);
}

// ── Public URLs (always forward-slash, rooted at /{mediaDir}/...) ────────────

function normalizeRel(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function joinUrl(...parts) {
  const joined = parts
    .map(p => normalizeRel(p))
    .filter(p => p.length > 0 && p !== '.')
    .join('/');
  return '/' + joined;
}

/** Public URL of the original file, e.g. "/media/sub/foto.jpg" */
function mediaPublicUrl(mediaDir, relFilePath) {
  return joinUrl(mediaDir, relFilePath);
}

/** Public URL of a variant file, e.g. "/media/sub/.foto.jpg.media/web-1920.webp" */
function variantPublicUrl(mediaDir, relFilePath, variantFile) {
  const rel = normalizeRel(relFilePath);
  const relDir = path.posix.dirname(rel);          // "sub" or "."
  const base = path.posix.basename(rel);           // "foto.jpg"
  const folder = variantFolderName(base);          // ".foto.jpg.media"
  return joinUrl(mediaDir, relDir, folder, variantFile);
}

// ── Manifest IO (the variant folder is the layout authority, so IO lives here) ─

/**
 * Reads the manifest for an original file.
 * @returns {object|null} parsed manifest, or null if missing/unreadable.
 */
function readManifest(absFilePath) {
  try {
    const mp = manifestPathAbs(absFilePath);
    if (!fs.existsSync(mp)) return null;
    return loadJson5(mp);
  } catch (_) {
    return null;
  }
}

/**
 * Atomically writes the manifest for an original file (temp + rename).
 * Ensures the variant folder exists. Writes a JSON5 header comment so the
 * file is consistent with the rest of the project's .json5 files.
 */
function writeManifest(absFilePath, manifest) {
  // TODO (manifest serving): the variant folder is dot-prefixed but still
  // served by koa-classic-server v3, so this manifest.json5 is publicly
  // reachable. Left served on purpose for now (no secrets). See media/TODO.md
  // if it ever needs to be hidden from the public serving.
  const folder = variantFolderPathAbs(absFilePath);
  fs.mkdirSync(folder, { recursive: true });
  const mp = manifestPathAbs(absFilePath);
  const header =
    '// This file follows the JSON5 standard - comments and trailing commas are supported\n' +
    '// AUTO-GENERATED by adminMedia (variantGenerator). Do not edit by hand.\n';
  const body = header + JSON.stringify(manifest, null, 2) + '\n';
  const tmp = mp + '.tmp';
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, mp);
}

module.exports = {
  // constants
  VARIANT_FOLDER_SUFFIX,
  MANIFEST_FILENAME,
  DEFAULT_OPTIMIZABLE_EXTENSIONS,
  // naming
  variantFolderName,
  isVariantFolderName,
  originalNameFromVariantFolder,
  variantFileName,
  getExtension,
  isOptimizableImage,
  presetWidths,
  // paths
  variantFolderPathAbs,
  manifestPathAbs,
  // urls
  mediaPublicUrl,
  variantPublicUrl,
  // manifest io
  readManifest,
  writeManifest,
};
