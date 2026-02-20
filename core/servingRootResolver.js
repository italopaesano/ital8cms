/**
 * servingRootResolver.js
 *
 * Utility module that determines the "serving root" directory for a given file path
 * based on which serving context it belongs to (www, pluginPages, admin).
 *
 * WHY THIS EXISTS:
 * Components like bootstrapNavbar need to resolve relative paths (e.g., configDir)
 * within the boundaries of their serving context. This utility provides root isolation
 * so that path resolution cannot escape the designated serving area.
 *
 * ROOT ISOLATION RULES:
 *
 *   - www:          Root = the entire wwwPath directory (e.g., /www/)
 *                   All www files share one root. configDir can point anywhere inside /www/.
 *
 *   - pluginPages:  Root = the specific plugin's directory (e.g., /pluginPages/myPlugin/)
 *                   Each plugin is isolated from other plugins. A plugin page cannot
 *                   reference config files from another plugin's directory.
 *
 *   - admin:        Root = the specific section directory (e.g., /core/admin/webPages/usersManagment/)
 *                   Each section is isolated. Files at admin root level (e.g., index.ejs
 *                   in /core/admin/webPages/) return null because they don't belong to
 *                   any section and configDir is NOT supported for them.
 *
 * SECURITY:
 *   This module only computes the root — it does NOT perform path traversal validation.
 *   Consumers must validate that resolved paths stay within the returned root.
 *
 * USAGE:
 *   const resolveServingRoot = require('./core/servingRootResolver');
 *   const rootInfo = resolveServingRoot(filePath, projectRoot, servingPaths);
 *   // rootInfo = { root: '/abs/path', context: 'www' } or null
 */

const path = require('path');

/**
 * Determines the serving root directory for a given file path.
 *
 * @param {string} filePath - Absolute path to the file being rendered
 * @param {string} projectRoot - Absolute path to the project root directory
 * @param {Object} servingPaths - Serving path configuration from ital8Config.json5
 * @param {string} servingPaths.wwwPath - Filesystem path for www relative to project root (e.g., '/www')
 * @param {string} servingPaths.pluginPagesPath - Filesystem path for plugin pages relative to project root (e.g., '/pluginPages')
 * @param {string} servingPaths.adminPagesPath - Filesystem path for admin pages relative to project root (e.g., '/core/admin/webPages')
 * @returns {Object|null} Object with { root, context } or null if context cannot be determined
 *   - root {string}: Absolute path to the serving root directory
 *   - context {string}: 'www' | 'pluginPages' | 'admin'
 *   Returns null when:
 *   - filePath doesn't belong to any known serving context
 *   - File is at admin root level (not inside any section — configDir not supported)
 *   - File is directly in pluginPages root without a plugin subdirectory
 */
function resolveServingRoot(filePath, projectRoot, servingPaths) {
  const { wwwPath, pluginPagesPath, adminPagesPath } = servingPaths;

  // Build absolute serving paths from project root
  const absAdmin = path.join(projectRoot, adminPagesPath);
  const absPluginPages = path.join(projectRoot, pluginPagesPath);
  const absWww = path.join(projectRoot, wwwPath);

  // ── Check admin first (most specific path: /core/admin/webPages) ──────────
  // Admin files are isolated per-section. Files at admin root level return null
  // because they don't belong to any section and configDir is not supported.
  if (filePath.startsWith(absAdmin + path.sep)) {
    const relativePath = filePath.substring(absAdmin.length + 1);
    const firstSep = relativePath.indexOf(path.sep);

    if (firstSep === -1) {
      // File directly in admin root (e.g., /core/admin/webPages/index.ejs)
      // No section = no isolation boundary = configDir not supported
      return null;
    }

    // Extract section name (first directory segment after admin base path)
    const sectionName = relativePath.substring(0, firstSep);
    return {
      root: path.join(absAdmin, sectionName),
      context: 'admin'
    };
  }

  // ── Check pluginPages (per-plugin isolation) ──────────────────────────────
  // Each plugin gets its own root. A page in pluginA cannot access pluginB's files.
  if (filePath.startsWith(absPluginPages + path.sep)) {
    const relativePath = filePath.substring(absPluginPages.length + 1);
    const firstSep = relativePath.indexOf(path.sep);

    if (firstSep === -1) {
      // File directly in pluginPages root without a plugin subdirectory
      // This shouldn't happen normally (pluginPages/ contains plugin directories, not files)
      return null;
    }

    const pluginName = relativePath.substring(0, firstSep);
    return {
      root: path.join(absPluginPages, pluginName),
      context: 'pluginPages'
    };
  }

  // ── Check www (entire wwwPath directory is the root) ──────────────────────
  // All www files share one root — no per-subdirectory isolation.
  if (filePath.startsWith(absWww + path.sep) || filePath === absWww) {
    return {
      root: absWww,
      context: 'www'
    };
  }

  // Unknown context — filePath doesn't match any known serving path
  return null;
}

module.exports = resolveServingRoot;
