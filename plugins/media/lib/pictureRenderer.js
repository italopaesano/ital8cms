/**
 * pictureRenderer.js  (plugin: media)
 *
 * Pure markup builder: turns a manifest object into responsive HTML.
 * No filesystem IO here — the caller (media/main.js) reads the manifest and
 * passes it in, so this module stays trivially testable.
 *
 *   renderPicture()  → a full <picture> with <source> per modern format
 *                      (AVIF, WebP) carrying a multi-width srcset, plus a
 *                      raster <img> fallback. Degrades to a plain <img> of the
 *                      original when no manifest/variants exist.
 *   resolveUrl()     → the URL of the single best-matching variant (by format
 *                      and/or width), or the original as fallback.
 */

'use strict';

const escapeHtml = require('../../../core/escapeHtml');
const variantResolver = require('./variantResolver');

// Modern formats emitted as <source>, in preference order (best first).
const MODERN_FORMAT_ORDER = ['avif', 'webp'];

const MIME_BY_FORMAT = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
};

/** Picks the preset to render: explicit option, else "web", else the first one. */
function pickPreset(manifest, options) {
  if (options.preset && manifest.variants[options.preset]) return options.preset;
  if (manifest.variants.web) return 'web';
  const keys = Object.keys(manifest.variants);
  return keys.length ? keys[0] : null;
}

/** Groups a flat variant list by format, each group sorted by width ascending. */
function groupByFormat(list) {
  const byFormat = {};
  for (const v of list) {
    (byFormat[v.format] = byFormat[v.format] || []).push(v);
  }
  for (const f of Object.keys(byFormat)) {
    byFormat[f].sort((a, b) => a.width - b.width);
  }
  return byFormat;
}

/** Builds a plain <img> of the original — the graceful fallback. */
function plainImg(mediaDir, relFilePath, alt, attrs) {
  const url = escapeHtml(variantResolver.mediaPublicUrl(mediaDir, relFilePath));
  return `<img src="${url}" alt="${alt}"${attrs.className} loading="${attrs.loading}" decoding="async">`;
}

/**
 * @param {object}  args
 * @param {object|null} args.manifest      - parsed manifest, or null
 * @param {string}  args.mediaDir          - media dir name (e.g. "media")
 * @param {string}  args.relFilePath       - file path relative to media dir
 * @param {object}  [args.options]         - { alt, sizes, className, loading, preset }
 * @returns {string} HTML
 */
function renderPicture({ manifest, mediaDir, relFilePath, options = {} }) {
  const alt = escapeHtml(options.alt != null ? options.alt : (manifest && manifest.alt) || '');
  const attrs = {
    className: options.className ? ` class="${escapeHtml(options.className)}"` : '',
    loading: options.loading === 'eager' ? 'eager' : 'lazy',
  };
  const sizesAttr = options.sizes ? ` sizes="${escapeHtml(options.sizes)}"` : '';

  if (!manifest || !manifest.variants) {
    return plainImg(mediaDir, relFilePath, alt, attrs);
  }

  const presetName = pickPreset(manifest, options);
  const list = presetName ? (manifest.variants[presetName] || []) : [];
  if (list.length === 0) {
    return plainImg(mediaDir, relFilePath, alt, attrs);
  }

  const byFormat = groupByFormat(list);
  const srcsetFor = (arr) => arr
    .map(v => `${escapeHtml(variantResolver.variantPublicUrl(mediaDir, relFilePath, v.file))} ${v.width}w`)
    .join(', ');

  // <source> for each modern format present
  let sources = '';
  for (const fmt of MODERN_FORMAT_ORDER) {
    if (byFormat[fmt]) {
      sources += `<source type="${MIME_BY_FORMAT[fmt]}" srcset="${srcsetFor(byFormat[fmt])}"${sizesAttr}>`;
    }
  }

  // Raster fallback <img>
  const fbFormat = manifest.fallbackFormat || 'jpg';
  const fbArr = byFormat[fbFormat] || byFormat.jpg || byFormat.png || list;
  const largest = fbArr[fbArr.length - 1];
  const imgSrc = escapeHtml(variantResolver.variantPublicUrl(mediaDir, relFilePath, largest.file));
  const imgSrcset = fbArr.length > 1 ? ` srcset="${srcsetFor(fbArr)}"` : '';
  const dims = (largest.width && largest.height) ? ` width="${largest.width}" height="${largest.height}"` : '';

  return `<picture>${sources}`
    + `<img src="${imgSrc}"${imgSrcset}${sizesAttr}${dims} alt="${alt}"${attrs.className} loading="${attrs.loading}" decoding="async">`
    + `</picture>`;
}

/**
 * Returns the URL of the best variant for the requested format/width.
 * @param {object} args - { manifest, mediaDir, relFilePath, options:{ format, width, preset } }
 * @returns {string} URL (variant, or original as fallback)
 */
function resolveUrl({ manifest, mediaDir, relFilePath, options = {} }) {
  if (!manifest || !manifest.variants) {
    return variantResolver.mediaPublicUrl(mediaDir, relFilePath);
  }
  const presetName = pickPreset(manifest, options);
  const list = presetName ? (manifest.variants[presetName] || []) : [];
  if (list.length === 0) {
    return variantResolver.mediaPublicUrl(mediaDir, relFilePath);
  }

  let pool = options.format ? list.filter(v => v.format === options.format) : list.slice();
  if (pool.length === 0) pool = list.slice();
  pool.sort((a, b) => a.width - b.width);

  let chosen;
  if (options.width) {
    chosen = pool.find(v => v.width >= options.width) || pool[pool.length - 1];
  } else {
    chosen = pool[pool.length - 1];
  }
  return variantResolver.variantPublicUrl(mediaDir, relFilePath, chosen.file);
}

module.exports = { renderPicture, resolveUrl };
