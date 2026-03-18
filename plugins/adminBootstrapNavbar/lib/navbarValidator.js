/**
 * navbarValidator.js
 *
 * Validates navbar JSON5 configuration:
 * - JSON5 syntax
 * - Required structure (settings, sections)
 * - Settings values
 * - Item structure
 * - Internal link existence
 */

const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

const VALID_TYPES = ['horizontal', 'vertical', 'offcanvas'];
const VALID_EXPAND_AT = ['sm', 'md', 'lg', 'xl', 'xxl'];
const VALID_COLOR_SCHEMES = ['dark', 'light'];
const VALID_POSITIONS = ['start', 'end'];
const VALID_SHOW_WHEN = ['authenticated', 'unauthenticated'];
const VALID_ITEM_TYPES = ['dropdown', 'separator', 'divider'];

/**
 * Validates a navbar JSON5 string
 * @param {string} content - JSON5 content string
 * @param {object} options - Validation options
 * @param {string} options.wwwDir - Absolute path to wwwPath (for link validation)
 * @param {string} options.linkValidationSeverity - "warning" or "error"
 * @param {object} [options.roleData] - Role data from userRole.json5 for role validation
 * @returns {object} - { valid: boolean, errors: string[], warnings: string[] }
 */
function validate(content, options = {}) {
  const errors = [];
  const warnings = [];

  // 1. Parse JSON5
  let config;
  try {
    config = JSON5.parse(content);
  } catch (parseErr) {
    errors.push(`JSON5 syntax error: ${parseErr.message}`);
    return { valid: false, errors, warnings };
  }

  // 2. Check required top-level structure
  if (!config.settings || typeof config.settings !== 'object') {
    errors.push('Missing or invalid "settings" object');
  }

  if (!config.sections || typeof config.sections !== 'object') {
    errors.push('Missing or invalid "sections" object');
  }

  // If structure is broken, stop here
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 3. Validate settings
  validateSettings(config.settings, errors, warnings);

  // 4. Validate sections
  if (config.sections.left && Array.isArray(config.sections.left)) {
    validateItems(config.sections.left, 'sections.left', errors, warnings, options);
  }

  if (config.sections.right && Array.isArray(config.sections.right)) {
    validateItems(config.sections.right, 'sections.right', errors, warnings, options);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates the settings object
 */
function validateSettings(settings, errors, warnings) {
  // type
  if (settings.type && !VALID_TYPES.includes(settings.type)) {
    errors.push(`settings.type: invalid value "${settings.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // id
  if (!settings.id || typeof settings.id !== 'string' || settings.id.trim() === '') {
    errors.push('settings.id: must be a non-empty string');
  }

  // colorScheme
  if (settings.colorScheme && !VALID_COLOR_SCHEMES.includes(settings.colorScheme)) {
    warnings.push(`settings.colorScheme: unexpected value "${settings.colorScheme}". Expected: ${VALID_COLOR_SCHEMES.join(', ')}`);
  }

  // expandAt
  if (settings.expandAt && !VALID_EXPAND_AT.includes(settings.expandAt)) {
    warnings.push(`settings.expandAt: unexpected value "${settings.expandAt}". Expected: ${VALID_EXPAND_AT.join(', ')}`);
  }

  // position
  if (settings.position && !VALID_POSITIONS.includes(settings.position)) {
    warnings.push(`settings.position: unexpected value "${settings.position}". Expected: ${VALID_POSITIONS.join(', ')}`);
  }

  // autoActive
  if (settings.autoActive !== undefined && typeof settings.autoActive !== 'boolean') {
    warnings.push('settings.autoActive: expected boolean value');
  }

  // offcanvasAlways
  if (settings.offcanvasAlways !== undefined && typeof settings.offcanvasAlways !== 'boolean') {
    warnings.push('settings.offcanvasAlways: expected boolean value');
  }
}

/**
 * Validates an array of items
 */
function validateItems(items, sectionPath, errors, warnings, options) {
  items.forEach((item, index) => {
    const itemPath = `${sectionPath}[${index}]`;

    // Separator and divider have no required fields
    if (item.type === 'separator' || item.type === 'divider') {
      return;
    }

    // Dropdown
    if (item.type === 'dropdown') {
      if (!item.label || typeof item.label !== 'string') {
        errors.push(`${itemPath}: dropdown must have a "label" string`);
      }
      if (!item.items || !Array.isArray(item.items)) {
        errors.push(`${itemPath}: dropdown must have an "items" array`);
      } else {
        validateItems(item.items, `${itemPath}.items`, errors, warnings, options);
      }
      validateVisibility(item, itemPath, warnings, options);
      return;
    }

    // Regular item
    if (!item.label || typeof item.label !== 'string') {
      errors.push(`${itemPath}: item must have a "label" string`);
    }

    // Validate href link
    if (item.href && typeof item.href === 'string') {
      validateInternalLink(item.href, itemPath, errors, warnings, options);
    }

    // showWhen validation
    if (item.showWhen && !VALID_SHOW_WHEN.includes(item.showWhen)) {
      warnings.push(`${itemPath}.showWhen: unexpected value "${item.showWhen}". Expected: ${VALID_SHOW_WHEN.join(', ')}`);
    }

    validateVisibility(item, itemPath, warnings, options);
  });
}

/**
 * Validates visibility fields (requiresAuth, allowedRoles)
 */
function validateVisibility(item, itemPath, warnings, options) {
  // allowedRoles should be an array of numbers
  if (item.allowedRoles !== undefined) {
    if (!Array.isArray(item.allowedRoles)) {
      warnings.push(`${itemPath}.allowedRoles: should be an array`);
    } else if (options.roleData) {
      // Validate role IDs exist
      for (const roleId of item.allowedRoles) {
        if (typeof roleId !== 'number') {
          warnings.push(`${itemPath}.allowedRoles: role ID "${roleId}" is not a number`);
        } else if (options.roleData.roles && !options.roleData.roles[String(roleId)]) {
          warnings.push(`${itemPath}.allowedRoles: role ID ${roleId} not found in userRole.json5`);
        }
      }
    }
  }

  // requiresAuth should be boolean
  if (item.requiresAuth !== undefined && typeof item.requiresAuth !== 'boolean') {
    warnings.push(`${itemPath}.requiresAuth: expected boolean value`);
  }
}

/**
 * Validates internal links (starting with /)
 */
function validateInternalLink(href, itemPath, errors, warnings, options) {
  // Only validate links starting with /
  if (!href.startsWith('/')) return;

  // Skip API routes, anchors, query-only
  if (href.startsWith('/api/')) return;
  if (href === '/') return; // Root is always valid
  if (href.startsWith('/#')) return;

  if (!options.wwwDir) return;

  // Determine the expected file path
  // Remove query string and hash
  let cleanHref = href.split('?')[0].split('#')[0];

  // Handle different serving contexts
  let filePath;
  if (cleanHref.startsWith('/admin')) {
    // Admin pages - skip validation for now
    return;
  } else if (cleanHref.startsWith('/pluginPages/')) {
    // Plugin pages - skip validation for now
    return;
  } else {
    // www pages
    filePath = path.join(options.wwwDir, cleanHref);
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    // Also try adding .ejs extension if not present
    if (!cleanHref.endsWith('.ejs') && fs.existsSync(filePath + '.ejs')) {
      return; // Found with .ejs extension
    }

    // Check if it's a directory with index.ejs
    if (fs.existsSync(path.join(filePath, 'index.ejs'))) {
      return; // Directory with index
    }

    const message = `${itemPath}.href: internal link "${href}" - target file not found`;
    if (options.linkValidationSeverity === 'error') {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
}

module.exports = {
  validate,
  VALID_TYPES,
  VALID_EXPAND_AT,
  VALID_COLOR_SCHEMES,
  VALID_POSITIONS,
  VALID_SHOW_WHEN,
};
