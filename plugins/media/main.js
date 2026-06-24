/**
 * media - main.js
 *
 * Media SERVICE plugin. It does NOT serve bytes over HTTP — that is already
 * handled by koa-classic-server, since the media directory lives inside wwwPath.
 * Instead it provides the "intelligent" layer on top of the stored files:
 *
 *   • read API for templates (passData.plugin.media.*) and other plugins:
 *       - renderPicture(relPath, opts)  → responsive <picture> markup
 *       - getMediaUrl(relPath, opts)    → URL of the best variant
 *       - getMediaMetadata(relPath)     → the image manifest (sizes, alt, variants)
 *   • OWNS the media directory setting (mediaDir) and the variant SCHEMA
 *     (imageOptimization), sharing both with the adminMedia twin so that the
 *     reader (here) and the writer (adminMedia) agree on the exact layout.
 *
 * The actual variant generation (sharp) lives in the adminMedia twin.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const variantResolver = require('./lib/variantResolver');
const pictureRenderer = require('./lib/pictureRenderer');

const pluginName = path.basename(__dirname);

// Resolved at MODULE LEVEL (not in loadPlugin): pluginSys calls
// getObjectToShareToWebPages()/getObjectToShareToOthersPlugin() BEFORE
// loadPlugin(), so the exposed API must not depend on loadPlugin state.
const pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const ital8Conf    = loadJson5(path.join(__dirname, '../../ital8Config.json5'));

const custom             = pluginConfig.custom || {};
const mediaDir           = ital8Conf.mediaDir || 'media'; // owned globally in ital8Config.json5
const optimizationConfig = custom.imageOptimization || {};

const projectRoot      = path.join(__dirname, '..', '..');
const mediaDirAbsolute = path.join(projectRoot, ital8Conf.wwwPath, mediaDir);

// ── Internal: read a manifest by file path relative to the media dir ─────────
function readManifest(relFilePath) {
  const absFile = path.join(mediaDirAbsolute, String(relFilePath || ''));
  return variantResolver.readManifest(absFile);
}

// ── Read API (exposed to templates and other plugins) ───────────────────────

/** Responsive <picture> markup for an image (falls back to plain <img>). */
function renderPicture(relFilePath, options = {}) {
  return pictureRenderer.renderPicture({
    manifest: readManifest(relFilePath),
    mediaDir,
    relFilePath,
    options,
  });
}

/** URL of the best-matching variant (by format/width), or the original. */
function getMediaUrl(relFilePath, options = {}) {
  return pictureRenderer.resolveUrl({
    manifest: readManifest(relFilePath),
    mediaDir,
    relFilePath,
    options,
  });
}

/** The image's manifest (sizes, alt, variants), or null if not generated. */
function getMediaMetadata(relFilePath) {
  return readManifest(relFilePath);
}

// Object shared with EJS templates: passData.plugin.media.*
const readApi = { renderPicture, getMediaUrl, getMediaMetadata, mediaDir };

module.exports = {

  pluginName,
  pluginConfig,

  async loadPlugin(pluginSys, pathPluginFolder) {
    // media OWNS the media directory: ensure it exists at boot.
    if (!fs.existsSync(mediaDirAbsolute)) {
      fs.mkdirSync(mediaDirAbsolute, { recursive: true });
      console.log(`[${pluginName}] Media directory created: ${mediaDirAbsolute}`);
    }
  },

  async installPlugin() {},
  async uninstallPlugin() {},
  async upgradePlugin() {},

  getRouteArray() { return []; },

  getHooksPage() { return new Map(); },

  // Functions available in EJS templates as passData.plugin.media.*
  getObjectToShareToWebPages() {
    return readApi;
  },

  // Shared with other plugins. The adminMedia twin additionally receives the
  // variant schema + resolver + resolved paths it needs to GENERATE variants.
  getObjectToShareToOthersPlugin(forPlugin) {
    if (forPlugin === 'adminMedia') {
      return {
        ...readApi,
        variantResolver,
        optimizationConfig,
        mediaDir,
        mediaDirAbsolute,
      };
    }
    return readApi;
  },

  setSharedObject(fromPlugin, sharedObject) {},

};
