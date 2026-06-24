/**
 * variantGenerator.js  (plugin: adminMedia)
 *
 * The image OPTIMIZATION ENGINE. Uses `sharp` to produce the responsive
 * variants + manifest for an image, following the naming/layout convention
 * owned by the `media` plugin (passed in as `variantResolver`).
 *
 * `sharp` is an OPTIONAL dependency: it is intentionally NOT declared in
 * adminMedia's `nodeModuleDependency` (which is fail-fast at boot). Instead we
 * require it defensively here, so the file manager keeps working without it —
 * uploads simply skip optimization until `npm install sharp` is run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Optional dependency — graceful degradation when absent.
let sharp = null;
try {
  sharp = require('sharp');
} catch (_) {
  sharp = null;
}

/** @returns {boolean} true if sharp is installed and optimization is possible */
function isAvailable() {
  return !!sharp;
}

/** Short sha256 of a file's content (for invalidation / stale detection). */
function fileHash(absFilePath) {
  const buf = fs.readFileSync(absFilePath);
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

/** Maps an output format + quality config onto a sharp pipeline. */
function applyFormat(pipeline, format, quality) {
  switch (format) {
    case 'avif': return pipeline.avif({ quality: quality.avif ?? 50 });
    case 'webp': return pipeline.webp({ quality: quality.webp ?? 78 });
    case 'jpg':
    case 'jpeg': return pipeline.jpeg({ quality: quality.jpeg ?? 80, progressive: true, mozjpeg: true });
    case 'png':  return pipeline.png({ compressionLevel: 9 });
    default:     return pipeline;
  }
}

/**
 * Generates all variants + manifest for a single image (clean-slate: any
 * existing variant folder is wiped first, so preset changes never leave stale
 * files behind).
 *
 * @param {object} args
 * @param {string} args.absFilePath        - absolute path to the original image
 * @param {object} args.variantResolver    - the media plugin's resolver
 * @param {object} args.optimizationConfig - the media plugin's imageOptimization config
 * @returns {Promise<{generated:boolean, reason?:string, manifest?:object}>}
 */
async function generateVariants({ absFilePath, variantResolver, optimizationConfig }) {
  if (!sharp) return { generated: false, reason: 'sharp-not-installed' };

  const fileName = path.basename(absFilePath);
  if (!variantResolver.isOptimizableImage(fileName, optimizationConfig.optimizableExtensions)) {
    return { generated: false, reason: 'not-optimizable' };
  }

  // Read source once; probe metadata.
  let inputBuffer, meta;
  try {
    inputBuffer = fs.readFileSync(absFilePath);
    meta = await sharp(inputBuffer, { failOn: 'none' }).metadata();
  } catch (e) {
    return { generated: false, reason: 'unreadable: ' + e.message };
  }

  const srcWidth = meta.width || 0;
  const srcHeight = meta.height || 0;
  if (!srcWidth) return { generated: false, reason: 'no-dimensions' };

  const hasAlpha = !!meta.hasAlpha;
  const fallbackFormat = hasAlpha ? 'png' : 'jpg';

  const presets = optimizationConfig.presets || {};
  const modernFormats = Array.isArray(optimizationConfig.formats) ? optimizationConfig.formats : ['avif', 'webp'];
  const quality = optimizationConfig.quality || { jpeg: 80, webp: 78, avif: 50 };
  const stripMetadata = optimizationConfig.stripMetadata !== false;

  // Formats to emit = modern formats + the raster fallback (deduplicated).
  const outputFormats = [...new Set([...modernFormats, fallbackFormat])];

  // Clean slate: remove any previous variant folder, then recreate.
  const variantFolder = variantResolver.variantFolderPathAbs(absFilePath);
  try { fs.rmSync(variantFolder, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(variantFolder, { recursive: true });

  const variants = {};
  let totalGenerated = 0;

  for (const [presetName, presetCfg] of Object.entries(presets)) {
    // No upscaling: keep only widths <= source; if none, use the source width.
    let widths = variantResolver.presetWidths(presetCfg).filter(w => w <= srcWidth);
    if (widths.length === 0) widths = [srcWidth];
    widths = [...new Set(widths)];

    variants[presetName] = [];

    for (const width of widths) {
      for (const format of outputFormats) {
        const outName = variantResolver.variantFileName(presetName, width, format);
        const outPath = path.join(variantFolder, outName);

        let pipeline = sharp(inputBuffer, { failOn: 'none' })
          .rotate() // auto-orient from EXIF before metadata is dropped
          .resize({ width, withoutEnlargement: true });
        if (!stripMetadata) pipeline = pipeline.withMetadata();
        pipeline = applyFormat(pipeline, format, quality);

        try {
          const info = await pipeline.toFile(outPath);
          variants[presetName].push({
            format,
            file: outName,
            width: info.width,
            height: info.height,
            bytes: info.size,
          });
          totalGenerated++;
        } catch (_) {
          // Skip this single variant on error; keep generating the others.
        }
      }
    }
  }

  if (totalGenerated === 0) {
    try { fs.rmSync(variantFolder, { recursive: true, force: true }); } catch (_) {}
    return { generated: false, reason: 'no-variants' };
  }

  const manifest = {
    schemaVersion: 1,
    original: {
      file: fileName,
      width: srcWidth,
      height: srcHeight,
      bytes: (meta.size != null) ? meta.size : fs.statSync(absFilePath).size,
      hash: fileHash(absFilePath),
    },
    alt: '',
    generatedAt: new Date().toISOString(),
    fallbackFormat,
    // snapshot of the widths actually requested per preset (for "regenerate" diffing)
    presets: Object.fromEntries(
      Object.entries(presets).map(([k, v]) => [k, variantResolver.presetWidths(v)])
    ),
    variants,
  };

  variantResolver.writeManifest(absFilePath, manifest);
  return { generated: true, manifest };
}

/**
 * Walks a directory tree and generates variants for every optimizable image.
 * Skips dot-prefixed entries (variant folders, .tmp, hidden).
 *
 * @param {object} args
 * @param {string} args.rootAbs             - absolute directory to walk
 * @param {object} args.variantResolver
 * @param {object} args.optimizationConfig
 * @param {boolean} [args.onlyMissing=false]- if true, skip images whose manifest
 *                                            hash already matches (only fill gaps)
 * @returns {Promise<{processed:number, generated:number, skipped:number, errors:number, reason?:string}>}
 */
async function generateForTree({ rootAbs, variantResolver, optimizationConfig, onlyMissing = false }) {
  const summary = { processed: 0, generated: 0, skipped: 0, errors: 0 };
  if (!sharp) { summary.reason = 'sharp-not-installed'; return summary; }

  async function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // variant folders, .tmp, hidden
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!variantResolver.isOptimizableImage(entry.name, optimizationConfig.optimizableExtensions)) {
        continue;
      }
      summary.processed++;
      try {
        if (onlyMissing) {
          const existing = variantResolver.readManifest(abs);
          if (existing && existing.original && existing.original.hash === fileHash(abs)) {
            summary.skipped++;
            continue;
          }
        }
        const res = await generateVariants({ absFilePath: abs, variantResolver, optimizationConfig });
        if (res.generated) summary.generated++;
        else summary.skipped++;
      } catch (_) {
        summary.errors++;
      }
    }
  }

  await walk(rootAbs);
  return summary;
}

module.exports = {
  isAvailable,
  fileHash,
  generateVariants,
  generateForTree,
};
