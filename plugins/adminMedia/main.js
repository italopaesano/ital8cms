/**
 * adminMedia - main.js
 *
 * Admin plugin for media file management (images, video, audio).
 * Features: upload, browse, organize folders, rename, move, delete.
 *
 * See ROADMAP.md for full feature plan and future scope.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const loadJson5 = require('../../core/loadJson5');

const pluginName = path.basename(__dirname);

// Loaded at module level for route handlers (re-read on each request in debug mode)
const pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const ital8Conf    = loadJson5(path.join(__dirname, '../../ital8Config.json5'));

// Access: root (0) and admin (1) only
const pluginAccess = { requiresAuth: true, allowedRoles: [0, 1] };

// Resolved at loadPlugin() — absolute path to the media directory
let mediaDirAbsolute = null;

// Lazy-loaded lib modules (require after loadPlugin resolves paths)
let mediaManager      = null;
let fileValidator     = null;
let filenameSanitizer = null;
let multerUpload      = null; // @koa/multer middleware instance

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    // ── Resolve media directory ────────────────────────────────────────────
    // wwwPath is relative to project root (e.g. "/www")
    // mediaDir is relative to wwwPath (e.g. "media")
    const projectRoot = path.join(pathPluginFolder, '..', '..');
    const mediaDir    = pluginConfig.custom.mediaDir || 'media';
    mediaDirAbsolute  = path.join(projectRoot, ital8Conf.wwwPath, mediaDir);

    // Create media directory if it doesn't exist
    if (!fs.existsSync(mediaDirAbsolute)) {
      fs.mkdirSync(mediaDirAbsolute, { recursive: true });
      console.log(`[${pluginName}] Media directory created: ${mediaDirAbsolute}`);
    } else {
      console.log(`[${pluginName}] Media directory found: ${mediaDirAbsolute}`);
    }

    // ── Load lib modules ───────────────────────────────────────────────────
    mediaManager      = require('./lib/mediaManager');
    fileValidator     = require('./lib/fileValidator');
    filenameSanitizer = require('./lib/filenameSanitizer');

    // ── Configure @koa/multer ──────────────────────────────────────────────
    // Files are saved to a temp dir first; after validation they are moved to
    // the correct target folder with the sanitized filename.
    const multer  = require('@koa/multer');
    const tmpDir  = path.join(mediaDirAbsolute, '.tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, tmpDir),
      filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    });

    // Use the largest allowed size as the global multer limit (per-category
    // validation is done in fileValidator after the file is on disk).
    const limits = pluginConfig.custom.fileSizeLimits;
    const maxSize = Math.max(limits.image, limits.video, limits.audio);

    multerUpload = multer({ storage, limits: { fileSize: maxSize } }).array('files', 50);

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

      // ── UPLOAD files ────────────────────────────────────────────────────
      {
        method: 'POST',
        path: '/upload',
        access: pluginAccess,
        handler: async (ctx) => {
          const targetRelPath = ctx.query.path || '';

          // Apply multer middleware to parse multipart/form-data
          await multerUpload(ctx, async () => {});

          const files   = ctx.request.files || [];
          const results = [];
          const warnings = [];

          for (const tmpFile of files) {
            const validation = fileValidator.validate(
              tmpFile.path,
              tmpFile.originalname,
              tmpFile.size,
              pluginConfig.custom.fileSizeLimits
            );

            if (!validation.valid) {
              // Delete invalid temp file and skip
              fs.unlink(tmpFile.path, () => {});
              warnings.push({ file: tmpFile.originalname, reason: validation.error });
              continue;
            }

            // Sanitize name and resolve collisions
            const sanitized = filenameSanitizer.sanitize(tmpFile.originalname);
            const targetDir  = mediaManager.resolveAbsPath(mediaDirAbsolute, targetRelPath);
            const finalName  = filenameSanitizer.resolveCollision(targetDir, sanitized);

            if (!finalName) {
              fs.unlink(tmpFile.path, () => {});
              warnings.push({ file: tmpFile.originalname, reason: 'Could not resolve filename collision' });
              continue;
            }

            // Renamed flag: notify client if name changed
            const wasRenamed = finalName !== sanitized;

            // Move from temp to target
            const finalPath = path.join(targetDir, finalName);
            fs.renameSync(tmpFile.path, finalPath);

            results.push({ name: finalName, renamed: wasRenamed, original: tmpFile.originalname });
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

      // ── RENAME file or folder ────────────────────────────────────────────
      {
        method: 'POST',
        path: '/rename',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath, newName } = ctx.request.body;
          const result = mediaManager.renameItem(mediaDirAbsolute, relPath, newName);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, isFolder: result.isFolder };
        },
      },

      // ── MOVE file ────────────────────────────────────────────────────────
      {
        method: 'POST',
        path: '/move',
        access: pluginAccess,
        handler: async (ctx) => {
          const { srcPath, destPath } = ctx.request.body;
          const result = mediaManager.moveFile(mediaDirAbsolute, srcPath, destPath);
          if (!result.success) { ctx.status = 400; ctx.body = { error: result.error }; return; }
          ctx.body = { success: true, finalName: result.finalName };
        },
      },

      // ── DELETE file ──────────────────────────────────────────────────────
      {
        method: 'POST',
        path: '/deleteFile',
        access: pluginAccess,
        handler: async (ctx) => {
          const { path: relPath } = ctx.request.body;
          const result = mediaManager.deleteFile(mediaDirAbsolute, relPath);
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

    ];
  },

  getObjectToShareToOthersPlugin(forPlugin) {
    // Future: expose media API to other plugins (media plugin v2)
    return {};
  },

  setSharedObject(fromPlugin, sharedObject) {},

  getObjectToShareToWebPages() {
    return {
      mediaDir:     pluginConfig.custom.mediaDir || 'media',
      itemsPerPage: pluginConfig.custom.itemsPerPage || 50,
    };
  },

};
