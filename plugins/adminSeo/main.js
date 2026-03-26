/**
 * adminSeo - main.js
 *
 * Admin plugin for managing SEO plugin settings via GUI.
 * Provides interfaces for:
 * - Global SEO settings (pluginConfig.json5 custom block)
 * - Per-page SEO rules (seoPages.json5)
 * - Meta tag preview for test URLs
 * - Sitemap & robots.txt regeneration
 */

const path = require('path');
const JSON5 = require('json5');
const loadJson5 = require('../../core/loadJson5');
const seoFileManager = require('./lib/seoFileManager');
const seoConfigValidator = require('./lib/seoConfigValidator');

const pluginName = path.basename(__dirname);

let myPluginSys = null;
let seoPluginPath = null;
let backupDir = null;
let maxBackups = 10;

// Access configuration for all routes: root (0), admin (1), editor (2)
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1, 2],
};

module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    myPluginSys = pluginSys;

    // Resolve path to the seo plugin directory
    seoPluginPath = path.join(pathPluginFolder, '..', 'seo');
    backupDir = path.join(pathPluginFolder, 'backups');

    // Load our own config for maxBackups
    const ownConfig = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
    maxBackups = ownConfig.custom?.maxBackupsPerFile || 10;

    console.log(`[${pluginName}] Plugin loaded — managing SEO config at ${seoPluginPath}`);
  },

  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // GLOBAL SETTINGS
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Load global settings (custom block only)
      {
        method: 'get',
        path: '/load-settings',
        access: pluginAccess,
        func: async (ctx) => {
          const result = seoFileManager.readGlobalSettings(seoPluginPath);
          if (!result.success) {
            ctx.status = 500;
            ctx.body = { success: false, error: result.error };
            return;
          }
          ctx.body = { success: true, data: result.data };
        },
      },

      // Load global settings as raw JSON5 text (for JSON5 editor)
      {
        method: 'get',
        path: '/load-settings-raw',
        access: pluginAccess,
        func: async (ctx) => {
          const result = seoFileManager.readFullPluginConfig(seoPluginPath);
          if (!result.success) {
            ctx.status = 500;
            ctx.body = { success: false, error: result.error };
            return;
          }
          // Return only the custom block as JSON5-formatted string
          ctx.body = { success: true, content: JSON.stringify(result.data.custom, null, 2) };
        },
      },

      // Validate global settings
      {
        method: 'post',
        path: '/validate-settings',
        access: pluginAccess,
        func: async (ctx) => {
          const { data } = ctx.request.body;
          if (!data || typeof data !== 'object') {
            ctx.body = { valid: false, errors: ['Request body must contain a "data" object'], warnings: [] };
            return;
          }
          const result = seoConfigValidator.validateGlobalSettings(data);
          ctx.body = result;
        },
      },

      // Save global settings
      {
        method: 'post',
        path: '/save-settings',
        access: pluginAccess,
        func: async (ctx) => {
          const { data } = ctx.request.body;
          if (!data || typeof data !== 'object') {
            ctx.status = 400;
            ctx.body = { success: false, error: 'Request body must contain a "data" object' };
            return;
          }

          // Validate before save
          const validation = seoConfigValidator.validateGlobalSettings(data);
          if (!validation.valid) {
            ctx.status = 400;
            ctx.body = { success: false, errors: validation.errors, warnings: validation.warnings };
            return;
          }

          const result = await seoFileManager.saveGlobalSettings(seoPluginPath, data, backupDir, maxBackups);
          if (!result.success) {
            ctx.status = 500;
            ctx.body = { success: false, error: result.error };
            return;
          }

          ctx.body = { success: true, warnings: validation.warnings };
        },
      },

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PAGE RULES
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Load page rules
      {
        method: 'get',
        path: '/load-page-rules',
        access: pluginAccess,
        func: async (ctx) => {
          const result = seoFileManager.readPageRules(seoPluginPath);
          if (!result.success) {
            ctx.status = 500;
            ctx.body = { success: false, error: result.error };
            return;
          }
          ctx.body = { success: true, data: result.data, raw: result.raw };
        },
      },

      // Validate page rules (accepts JSON5 string)
      {
        method: 'post',
        path: '/validate-page-rules',
        access: pluginAccess,
        func: async (ctx) => {
          const { content } = ctx.request.body;
          if (typeof content !== 'string') {
            ctx.body = { valid: false, errors: ['Request body must contain a "content" string (JSON5)'], warnings: [] };
            return;
          }

          // Parse JSON5 first
          let parsed;
          try {
            parsed = JSON5.parse(content);
          } catch (err) {
            ctx.body = { valid: false, errors: [`JSON5 syntax error: ${err.message}`], warnings: [] };
            return;
          }

          const result = seoConfigValidator.validatePageRules(parsed);
          ctx.body = result;
        },
      },

      // Save page rules (accepts JSON5 string)
      {
        method: 'post',
        path: '/save-page-rules',
        access: pluginAccess,
        func: async (ctx) => {
          const { content } = ctx.request.body;
          if (typeof content !== 'string') {
            ctx.status = 400;
            ctx.body = { success: false, error: 'Request body must contain a "content" string (JSON5)' };
            return;
          }

          // Parse JSON5
          let parsed;
          try {
            parsed = JSON5.parse(content);
          } catch (err) {
            ctx.status = 400;
            ctx.body = { success: false, error: `JSON5 syntax error: ${err.message}` };
            return;
          }

          // Validate before save
          const validation = seoConfigValidator.validatePageRules(parsed);
          if (!validation.valid) {
            ctx.status = 400;
            ctx.body = { success: false, errors: validation.errors, warnings: validation.warnings };
            return;
          }

          const result = await seoFileManager.savePageRules(seoPluginPath, parsed, backupDir, maxBackups);
          if (!result.success) {
            ctx.status = 500;
            ctx.body = { success: false, error: result.error };
            return;
          }

          ctx.body = { success: true, warnings: validation.warnings };
        },
      },

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PREVIEW & REGENERATION
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Preview meta tags for a test URL
      {
        method: 'post',
        path: '/preview',
        access: pluginAccess,
        func: async (ctx) => {
          const { testUrl, config, pageRules } = ctx.request.body;
          if (!testUrl || typeof testUrl !== 'string') {
            ctx.status = 400;
            ctx.body = { success: false, error: 'testUrl is required' };
            return;
          }

          // Use provided config/pageRules or load from disk
          let effectiveConfig = config;
          let effectivePageRules = pageRules;

          if (!effectiveConfig) {
            const settingsResult = seoFileManager.readGlobalSettings(seoPluginPath);
            effectiveConfig = settingsResult.success ? settingsResult.data : {};
          }
          if (!effectivePageRules) {
            const rulesResult = seoFileManager.readPageRules(seoPluginPath);
            effectivePageRules = rulesResult.success ? rulesResult.data : {};
          }

          const preview = seoFileManager.generatePreview(testUrl, effectiveConfig, effectivePageRules);
          ctx.body = { success: true, preview };
        },
      },

      // Trigger sitemap & robots.txt regeneration (proxy to seo plugin)
      {
        method: 'post',
        path: '/regenerate',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1], // Only root and admin
        },
        func: async (ctx) => {
          // Use the seo plugin's shared object to trigger regeneration
          const seoShared = myPluginSys.getSharedObject('seo', pluginName);
          if (!seoShared || !seoShared.regenerate) {
            ctx.status = 500;
            ctx.body = { success: false, error: 'SEO plugin not available or does not expose regenerate()' };
            return;
          }

          const report = seoShared.regenerate();
          ctx.body = { success: true, report };
        },
      },

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // CONSTANTS (for client-side form building)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      {
        method: 'get',
        path: '/constants',
        access: pluginAccess,
        func: async (ctx) => {
          ctx.body = {
            validChangefreq: seoConfigValidator.VALID_CHANGEFREQ,
            validOgTypes: seoConfigValidator.VALID_OG_TYPES,
            validTwitterCardTypes: seoConfigValidator.VALID_TWITTER_CARD_TYPES,
            validPageRuleFields: seoConfigValidator.VALID_PAGE_RULE_FIELDS,
          };
        },
      },
    ];
  },
};
