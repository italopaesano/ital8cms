
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
     * @param {object} [options.settingsOverrides] - Optional overrides for settings from JSON5
     * @param {object} passData - The passData object from the EJS template (required)
     * @returns {string} - Generated HTML string, or empty string on error
     *
     * @example
     * // In EJS template:
     * <%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>
     *
     * // With settings overrides:
     * <%- passData.plugin.bootstrapNavbar.render({
     *   name: 'main',
     *   settingsOverrides: { colorScheme: 'light', bgClass: 'bg-dark' }
     * }, passData) %>
     */
    render: (options, passData) => {
      return navbarRenderer.render(options, passData, isDebugMode, navbarCache);
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
