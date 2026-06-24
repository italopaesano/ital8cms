/**
 * adminMedia - main.js
 *
 * Admin twin of the `media` service. Owns the media management GUI plus the
 * write side of the optimized-image pipeline:
 *   • upload, browse, organize folders, rename, move, delete
 *   • generate responsive variants + manifest at upload time (sharp)
 *   • maintenance: regenerate variants / generate missing ones
 *
 * The variant SCHEMA (naming/layout) and the media DIRECTORY are owned by the
 * `media` service plugin and pulled here via its shared object. `sharp` is an
 * OPTIONAL dependency (see lib/variantGenerator.js): the file manager keeps
 * working without it, only optimization is skipped.
 *
 * See ROADMAP.md for the full feature plan.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const loadJson5 = require('../../core/loadJson5');

const mediaManager      = require('./lib/mediaManager');
const fileValidator     = require('./lib/fileValidator');
const filenameSanitizer = require('./lib/filenameSanitizer');
const variantGenerator  = require('./lib/variantGenerator');

const pluginName = path.basename(__dirname);

const pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const ital8Conf    = loadJson5(path.join(__dirname, '../../ital8Config.json5'));

// The media DIRECTORY lives in the GLOBAL ital8Config.json5 (read by both media
// and adminMedia). Needed before loadPlugin() for multer setup and for the
// value exposed to admin pages.
const mediaDir         = ital8Conf.mediaDir || 'media';
const projectRoot      = path.join(__dirname, '..', '..');
const mediaDirAbsolute = path.join(projectRoot, ital8Conf.wwwPath, mediaDir);

// Access: root (0) and admin (1) only
const pluginAccess = { requiresAuth: true, allowedRoles: [0, 1] };

// Pulled from the media plugin's shared object in loadPlugin().
let variantResolver    = null;
let optimizationConfig = null;

// @koa/multer middleware instance (configured in loadPlugin)
let multerUpload = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True when variants can actually be generated (media wired + sharp present). */
function optimizationReady() {
  return !!(variantResolver && optimizationConfig && variantGenerator.isAvailable());
}

/** Human-readable reason why optimization is not available (for API errors). */
function optimizationUnavailableReason() {
  if (!variantResolver || !optimizationConfig) return 'media service unavailable';
  if (!variantGenerator.isAvailable()) return "'sharp' not installed; run: npm install sharp";
  return 'unknown';
}

/**
 * Generate (or regenerate) variants for a file or a whole subtree.
 * @param {string} relPath - file or folder, relative to the media root ('' = root)
 * @param {boolean} onlyMissing - skip images whose manifest hash already matches
 */
async function runGeneration(relPath, onlyMissing) {
  const absPath = mediaManager.resolveAbsPath(mediaDirAbsolute, relPath || '');
  if (!fs.existsSync(absPath)) return { ok: false, status: 404, error: 'Path not found' };

  if (fs.statSync(absPath).isDirectory()) {
    const summary = await variantGenerator.generateForTree({
      rootAbs: absPath, variantResolver, optimizationConfig, onlyMissing,
    });
    return { ok: true, summary };
  }

  // Single file
  if (onlyMissing) {
    const existing = variantResolver.readManifest(absPath);
    if (existing && existing.original && existing.original.hash === variantGenerator.fileHash(absPath)) {
      return { ok: true, summary: { processed: 1, generated: 0, skipped: 1, errors: 0 } };
    }
  }
  const res = await variantGenerator.generateVariants({ absFilePath: absPath, variantResolver, optimizationConfig });
  return {
    ok: true,
    summary: { processed: 1, generated: res.generated ? 1 : 0, skipped: res.generated ? 0 : 1, errors: 0, reason: res.reason },
  };
}

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    // media owns the dir, but ensure it exists defensively.
    if (!fs.existsSync(mediaDirAbsolute)) {
      fs.mkdirSync(mediaDirAbsolute, { recursive: true });
    }

    // ── Pull variant schema + resolver from the media service ──────────────
    const mediaShared = pluginSys.getSharedObject('media', pluginName);
    if (mediaShared) {
      variantResolver    = mediaShared.variantResolver || null;
      optimizationConfig = mediaShared.optimizationConfig || null;
    }
    if (!variantResolver) {
      console.warn(`[${pluginName}] media shared object unavailable — variant optimization disabled`);
    } else if (!variantGenerator.isAvailable()) {
      console.warn(`[${pluginName}] 'sharp' not installed — image optimization disabled. Run: npm install sharp`);
    }

    // ── Configure @koa/multer ──────────────────────────────────────────────
    // Files are saved to a temp dir first; after validation they are moved to
    // the target folder with the sanitized filename.
    const multer = require('@koa/multer');
    const tmpDir = path.join(mediaDirAbsolute, '.tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, tmpDir),
      filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    });

    // Use the largest allowed size as the global multer limit (per-category
    // validation is done in fileValidator after the file is on disk).
    const limits  = pluginConfig.custom.fileSizeLimits;
    const maxSize = Math.max(limits.image, limits.video, limits.audio);
    multerUpload  = multer({ storage, limits: { fileSize: maxSize } }).array('files', 50);

    console.log(`[${pluginName}] Plugin loaded — media dir: ${mediaDirAbsolute}`);
  },

  // ── Routes ────────────────────────────────────────────────────────────────
  getRouteArray() {
    return [

      // ── LIST directory contents ──────────────────────────────────────────
      {
        method: 'GET',
        path: '/list',
        access: pluginAccess,
        handler: async (ctx) => {
          const relPath = ctx.query.path || '';
          const result  = mediaManager.listDirectory(mediaDirAbsolute, relPath);
          if (!result.success) {
            ctx.status = result.status || 400;
            ctx.body   = { error: result.error };
            return;
          }
          ctx.body = result.data;
        },
      },

      // ── UPLOAD files (+ generate optimized variants) ─────────────────────
      {
        method: 'POST',
        path: '/upload',
        access: pluginAccess,
        handler: async (ctx) => {
          const targetRelPath = ctx.query.path || '';

          // Apply multer middleware to parse multipart/form-data
          await multerUpload(ctx, async () => {});

          const files    = ctx.request.files || [];
          const results  = [];
          const warnings = [];

          for (const tmpFile of files) {
            const validation = fileValidator.validate(
              tmpFile.path,
              tmpFile.originalname,
              tmpFile.size,
              pluginConfig.custom.fileSizeLimits
            );

            if (!validation.valid) {
              fs.unlink(tmpFile.path, () => {});
              warnings.push({ file: tmpFile.originalname, reason: validation.error });
              continue;
            }

            const sanitized = filenameSanitizer.sanitize(tmpFile.originalname);
            const targetDir = mediaManager.resolveAbsPath(mediaDirAbsolute, targetRelPath);
            const finalName = filenameSanitizer.resolveCollision(targetDir, sanitized);

            if (!finalName) {
              fs.unlink(tmpFile.path, () => {});
              warnings.push({ file: tmpFile.originalname, reason: 'Could not resolve filename collision' });
              continue;
            }

            const wasRenamed = finalName !== sanitized;

            // Move from temp to target
            const finalPath = path.join(targetDir, finalName);
            fs.renameSync(tmpFile.path, finalPath);

            // Generate optimized variants (best-effort; degrades gracefully).
            let optimization = null;
            if (optimizationReady()) {
              try {
                const res = await variantGenerator.generateVariants({
                  absFilePath: finalPath, variantResolver, optimizationConfig,
                });
                optimization = res.generated ? { generated: true } : { generated: false, reason: res.reason };
              } catch (e) {
                optimization = { generated: false, reason: 'error: ' + e.message };
              }
            }

            results.push({ name: finalName, renamed: wasRenamed, original: tmpFile.originalname, optimization });
          }

          ctx.body = { uploaded: results, warnings };
        },
      },

      // ── CREATE FOLDER ────────────────────────────────────────────────────
      {
        method: 'POST',
        path: '/createFolder',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath, name } = ctx.request.body;
          const result = mediaManager.createFolder(mediaDirAbsolute, relPath || '', name);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true };
        },
      },

      // ── RENAME file or folder (variant-aware) ────────────────────────────
      {
        method: 'POST',
        path: '/rename',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath, newName } = ctx.request.body;
          const result = mediaManager.renameItem(mediaDirAbsolute, relPath, newName, variantResolver);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, isFolder: result.isFolder };
        },
      },

      // ── MOVE file (variant-aware) ────────────────────────────────────────
      {
        method: 'POST',
        path: '/move',
        access: pluginAccess,
        handler: async (ctx) => {
          const { srcPath, destPath } = ctx.request.body;
          const result = mediaManager.moveFile(mediaDirAbsolute, srcPath, destPath, variantResolver);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, finalName: result.finalName };
        },
      },

      // ── DELETE file (variant-aware) ──────────────────────────────────────
      {
        method: 'POST',
        path: '/deleteFile',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath } = ctx.request.body;
          const result = mediaManager.deleteFile(mediaDirAbsolute, relPath, variantResolver);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true };
        },
      },

      // ── DELETE folder ────────────────────────────────────────────────────
      {
        method: 'POST',
        path: '/deleteFolder',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath, recursive } = ctx.request.body;
          const result = mediaManager.deleteFolder(mediaDirAbsolute, relPath, !!recursive);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true };
        },
      },

      // ── FOLDER TREE (for move picker) ────────────────────────────────────
      {
        method: 'GET',
        path: '/tree',
        access: pluginAccess,
        handler: async (ctx) => {
          const tree = mediaManager.buildFolderTree(mediaDirAbsolute);
          ctx.body = tree;
        },
      },

      // ── REGENERATE variants (file or subtree) ────────────────────────────
      {
        method: 'POST',
        path: '/regenerateVariants',
        access: pluginAccess,
        handler: async (ctx) => {
          if (!optimizationReady()) {
            ctx.status = 400;
            ctx.body = { error: optimizationUnavailableReason() };
            return;
          }
          const relPath = (ctx.request.body && ctx.request.body.path) || '';
          const result  = await runGeneration(relPath, false);
          if (!result.ok) { ctx.status = result.status || 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, summary: result.summary };
        },
      },

      // ── GENERATE MISSING variants (fill gaps; e.g. files added via FTP) ───
      {
        method: 'POST',
        path: '/generateMissing',
        access: pluginAccess,
        handler: async (ctx) => {
          if (!optimizationReady()) {
            ctx.status = 400;
            ctx.body = { error: optimizationUnavailableReason() };
            return;
          }
          const relPath = (ctx.request.body && ctx.request.body.path) || '';
          const result  = await runGeneration(relPath, true);
          if (!result.ok) { ctx.status = result.status || 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, summary: result.summary };
        },
      },

    ];
  },

  getObjectToShareToOthersPlugin(forPlugin) {
    return {};
  },

  setSharedObject(fromPlugin, sharedObject) {},

  getObjectToShareToWebPages() {
    return {
      mediaDir, // from global ital8Config, surfaced here for the admin UI
      itemsPerPage: pluginConfig.custom.itemsPerPage || 50,
      optimizationAvailable: variantGenerator.isAvailable(), // sharp installed?
    };
  },

};
