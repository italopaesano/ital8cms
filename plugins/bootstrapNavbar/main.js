
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const navbarRenderer = require('./lib/navbarRenderer');

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));
let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const pluginName = path.basename(__dirname);

// Cache for parsed navbar configurations (used in production mode)
const navbarCache = new Map();

// Debug mode flag (true = re-read files every request)
const isDebugMode = ital8Conf.debugMode >= 1;

// Serving configuration for configDir resolution (used by servingRootResolver)
const projectRoot = path.join(__dirname, '..', '..');
const servingPaths = {
  wwwPath: ital8Conf.wwwPath,
  pluginPagesPath: ital8Conf.pluginPagesPath,
  adminPagesPath: ital8Conf.adminPagesPath,
};


function loadPlugin(pluginSys, pathPluginFolder) {
  if (isDebugMode) {
    console.log(`[${pluginName}] Loaded in DEBUG mode (navbar files re-read on every request)`);
  } else {
    console.log(`[${pluginName}] Loaded in PRODUCTION mode (navbar files cached)`);
  }
}

function installPlugin() {}

function uninstallPlugin() {}

function upgradePlugin() {}

/**
 * Exposes the render() function to EJS templates via passData.plugin.bootstrapNavbar
 *
 * Usage in EJS:
 *   <%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>
 *   <%- passData.plugin.bootstrapNavbar.render({name: 'sidebar', settingsOverrides: {colorScheme: 'light'}}, passData) %>
 */
function getObjectToShareToWebPages() {
  return {
    /**
     * Renders a Bootstrap navbar from a JSON5 configuration file.
     *
     * The file is searched in the same directory as the calling EJS template.
     * File naming convention: navbar.{name}.json5
     *
     * @param {object} options - Render options
     * @param {string} options.name - Navbar name (required). Maps to navbar.{name}.json5
     * @param {string} [options.configDir] - Directory where to search for navbar config file,
     *   relative to the serving root. If omitted, searches in the same directory as the template.
     *   Examples: '/', '/shared', 'subdir'. With and without leading '/' are equivalent.
     *   Path traversal (../) outside the serving root is blocked for security.
     * @param {object} [options.settingsOverrides] - Optional overrides for settings from JSON5
     * @param {object} passData - The passData object from the EJS template (required)
     * @returns {string} - Generated HTML string, or empty string on error
     *
     * @example
     * // In EJS template (default - same directory):
     * <%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>
     *
     * // With configDir (search in /www/shared/ instead of template's directory):
     * <%- passData.plugin.bootstrapNavbar.render({name: 'main', configDir: '/shared'}, passData) %>
     *
     * // With settings overrides:
     * <%- passData.plugin.bootstrapNavbar.render({
     *   name: 'main',
     *   settingsOverrides: { colorScheme: 'light', bgClass: 'bg-dark' }
     * }, passData) %>
     */
    render: (options, passData) => {
      return navbarRenderer.render(options, passData, isDebugMode, navbarCache, { projectRoot, servingPaths });
    },
  };
}

function getRouteArray() {
  // No routes for now - prepared for future extensions
  return [];
}


module.exports = {
  loadPlugin: loadPlugin,
  installPlugin: installPlugin,
  unistallPlugin: uninstallPlugin,
  upgradePlugin: upgradePlugin,
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getObjectToShareToWebPages: getObjectToShareToWebPages,
};
