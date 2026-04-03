/**
 * SEO FILE MANAGER
 *
 * Handles read/write/backup operations for the SEO plugin configuration files:
 * - plugins/seo/pluginConfig.json5 (global settings — only the "custom" block)
 * - plugins/seo/seoPages.json5 (per-page rules)
 *
 * @module plugins/adminSeo/lib/seoFileManager
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const saveJson5 = require('../../../core/saveJson5');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// READ OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Reads the global settings (custom block) from the seo plugin's pluginConfig.json5.
 *
 * @param {string} seoPluginPath - Absolute path to the seo plugin directory
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function readGlobalSettings(seoPluginPath) {
  try {
    const configPath = path.join(seoPluginPath, 'pluginConfig.json5');
    const fullConfig = loadJson5(configPath);
    return { success: true, data: fullConfig.custom || {} };
  } catch (err) {
    return { success: false, error: `Failed to read pluginConfig.json5: ${err.message}` };
  }
}

/**
 * Reads the full pluginConfig.json5 (system + custom fields).
 *
 * @param {string} seoPluginPath - Absolute path to the seo plugin directory
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function readFullPluginConfig(seoPluginPath) {
  try {
    const configPath = path.join(seoPluginPath, 'pluginConfig.json5');
    const fullConfig = loadJson5(configPath);
    return { success: true, data: fullConfig };
  } catch (err) {
    return { success: false, error: `Failed to read pluginConfig.json5: ${err.message}` };
  }
}

/**
 * Reads seoPages.json5 content.
 *
 * @param {string} seoPluginPath - Absolute path to the seo plugin directory
 * @returns {{ success: boolean, data?: object, raw?: string, error?: string }}
 */
function readPageRules(seoPluginPath) {
  try {
    const filePath = path.join(seoPluginPath, 'seoPages.json5');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = loadJson5(filePath);
    return { success: true, data, raw };
  } catch (err) {
    return { success: false, error: `Failed to read seoPages.json5: ${err.message}` };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WRITE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Saves the global settings (custom block) to pluginConfig.json5.
 * Preserves the system fields (active, isInstalled, weight, dependency, etc.)
 * and only replaces the "custom" block.
 *
 * @param {string} seoPluginPath - Absolute path to the seo plugin directory
 * @param {object} customData - The new custom block
 * @param {string} backupDir - Absolute path to the backup directory
 * @param {number} maxBackups - Maximum number of backups to keep
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function saveGlobalSettings(seoPluginPath, customData, backupDir, maxBackups) {
  const configPath = path.join(seoPluginPath, 'pluginConfig.json5');
  try {
    // Read current full config
    const fullConfig = loadJson5(configPath);

    // Create backup before modification
    await createBackup(configPath, backupDir, maxBackups, 'pluginConfig');

    // Replace only the custom block
    fullConfig.custom = customData;

    // Save using saveJson5 (atomic write)
    await saveJson5(configPath, fullConfig);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to save pluginConfig.json5: ${err.message}` };
  }
}

/**
 * Saves seoPages.json5 content from a raw JSON5 string.
 * Preserves comments, trailing commas, and all JSON5 features as written.
 *
 * @param {string} seoPluginPath - Absolute path to the seo plugin directory
 * @param {string} rawContent - Raw JSON5 string (already validated by the caller)
 * @param {string} backupDir - Absolute path to the backup directory
 * @param {number} maxBackups - Maximum number of backups to keep
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function savePageRules(seoPluginPath, rawContent, backupDir, maxBackups) {
  const filePath = path.join(seoPluginPath, 'seoPages.json5');
  try {
    // Create backup before modification
    await createBackup(filePath, backupDir, maxBackups, 'seoPages');

    // Save raw JSON5 string — preserves comments and JSON5 features
    await saveJson5(filePath, rawContent);

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to save seoPages.json5: ${err.message}` };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BACKUP OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a timestamped backup of a file.
 *
 * @param {string} filePath - Path to the file to back up
 * @param {string} backupDir - Directory to store backups
 * @param {number} maxBackups - Maximum number of backups per file
 * @param {string} prefix - Backup file prefix (e.g., 'pluginConfig', 'seoPages')
 */
async function createBackup(filePath, backupDir, maxBackups, prefix) {
  try {
    // Ensure backup directory exists
    await fsPromises.mkdir(backupDir, { recursive: true });

    // Read current file content
    const content = await fsPromises.readFile(filePath, 'utf8');

    // Generate timestamped backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${prefix}_${timestamp}.json5`;
    const backupPath = path.join(backupDir, backupName);

    // Write backup
    await fsPromises.writeFile(backupPath, content, 'utf8');

    // Cleanup old backups (keep maxBackups most recent)
    await cleanupBackups(backupDir, prefix, maxBackups);
  } catch (err) {
    console.warn(`[adminSeo] Failed to create backup for ${prefix}: ${err.message}`);
  }
}

/**
 * Removes old backups exceeding maxBackups count.
 *
 * @param {string} backupDir - Backup directory path
 * @param {string} prefix - File prefix to match
 * @param {number} maxBackups - Maximum to keep
 */
async function cleanupBackups(backupDir, prefix, maxBackups) {
  try {
    const files = await fsPromises.readdir(backupDir);
    const backupFiles = files
      .filter(f => f.startsWith(prefix + '_') && f.endsWith('.json5'))
      .sort()
      .reverse(); // Newest first (ISO timestamps sort chronologically)

    // Remove excess backups
    if (backupFiles.length > maxBackups) {
      const toDelete = backupFiles.slice(maxBackups);
      for (const file of toDelete) {
        await fsPromises.unlink(path.join(backupDir, file));
      }
    }
  } catch (err) {
    console.warn(`[adminSeo] Failed to cleanup backups for ${prefix}: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PREVIEW GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generates a preview of meta tags for a given URL, using the provided config and page rules.
 *
 * @param {string} testUrl - The URL path to test (e.g., "/about.ejs")
 * @param {object} config - The global SEO config (custom block)
 * @param {object} pageRules - The seoPages rules object
 * @returns {{ matchedPattern: string|null, tags: string[], structuredData: string[] }}
 */
function generatePreview(testUrl, config, pageRules) {
  const PatternMatcher = require('../../../core/patternMatcher');
  const localMatcher = new PatternMatcher();
  const { generateMetaTags, escapeAttr, resolveValue } = require('../../seo/lib/metaTagGenerator');
  const { generateStructuredData } = require('../../seo/lib/structuredData');

  // Find matching rule
  let matchedPattern = null;
  let pageRule = null;

  if (pageRules && typeof pageRules === 'object') {
    pageRule = localMatcher.findMatchingRule(testUrl, pageRules);
    if (pageRule) {
      // Find which pattern matched
      for (const [pattern, rule] of Object.entries(pageRules)) {
        if (localMatcher.testPattern(pattern, testUrl)) {
          matchedPattern = pattern;
          break;
        }
      }
    }
  }

  // Build a mock passData for meta tag generation
  const mockPassData = {
    ctx: {
      path: testUrl,
      protocol: 'https',
      host: config.siteUrl ? new URL(config.siteUrl).host : 'localhost:3000',
      state: {},
    },
    isAdminContext: false,
  };

  // Generate meta tags
  const metaHtml = generateMetaTags(pageRule, mockPassData, config);
  const tags = metaHtml ? metaHtml.split('\n').map(t => t.trim()).filter(Boolean) : [];

  // Generate structured data
  const structuredHtml = generateStructuredData(config);
  const structuredData = structuredHtml ? structuredHtml.split('\n').map(t => t.trim()).filter(Boolean) : [];

  return { matchedPattern, tags, structuredData };
}

module.exports = {
  readGlobalSettings,
  readFullPluginConfig,
  readPageRules,
  saveGlobalSettings,
  savePageRules,
  createBackup,
  cleanupBackups,
  generatePreview,
};
