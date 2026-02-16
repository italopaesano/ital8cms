/**
 * navbarRenderer.js
 *
 * Core rendering engine for Bootstrap navbars.
 * Generates HTML for horizontal, vertical and offcanvas navbar types
 * from JSON5 configuration files.
 *
 * Supports:
 * - Sections (left/right) for item positioning
 * - Dropdowns with nested items and dividers
 * - Separators between items
 * - Auth/roles-based visibility filtering
 * - Auto-active page detection
 * - Icons (HTML generic)
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');

// Default settings applied when not specified in the JSON5 file
const DEFAULT_SETTINGS = {
  type: 'horizontal',         // horizontal | vertical | offcanvas
  colorScheme: 'dark',        // dark | light
  bgClass: 'bg-primary',      // Bootstrap background class
  expandAt: 'lg',             // sm | md | lg | xl | xxl
  containerClass: 'container-fluid',
  autoActive: true,            // auto-detect active page
  offcanvasAlways: false,      // true = hamburger always visible
  position: 'start',           // start | end (offcanvas direction / vertical position)
  id: 'navbarMain',            // HTML id for collapse/offcanvas target
};

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Checks if a menu item should be visible based on auth/roles
 * @param {object} item - Menu item with optional requiresAuth, allowedRoles, showWhen
 * @param {object} ctx - Koa context (for session access)
 * @returns {boolean} - true if item should be shown
 */
function isItemVisible(item, ctx) {
  const session = ctx.session || {};
  const isAuthenticated = !!session.authenticated;
  const userRoleIds = (session.user && session.user.roleIds) || [];

  // showWhen shortcut
  if (item.showWhen === 'authenticated' && !isAuthenticated) return false;
  if (item.showWhen === 'unauthenticated' && isAuthenticated) return false;

  // requiresAuth check
  if (item.requiresAuth === true && !isAuthenticated) return false;
  if (item.requiresAuth === false && isAuthenticated) return false;

  // allowedRoles check (only when requiresAuth is true and roles are specified)
  if (item.requiresAuth === true && item.allowedRoles && item.allowedRoles.length > 0) {
    const hasRole = userRoleIds.some(roleId => item.allowedRoles.includes(roleId));
    if (!hasRole) return false;
  }

  return true;
}

/**
 * Checks if the given href matches the current page URL
 * @param {string} itemHref - Menu item href
 * @param {string} currentHref - Current full URL (passData.href)
 * @returns {boolean} - true if active
 */
function isActivePage(itemHref, currentHref) {
  if (!itemHref || !currentHref) return false;

  try {
    // Parse the current URL to get the pathname
    const currentUrl = new URL(currentHref);
    const currentPath = currentUrl.pathname;

    // Normalize both paths (remove trailing slashes)
    const normalizedItemHref = itemHref.replace(/\/+$/, '') || '/';
    const normalizedCurrentPath = currentPath.replace(/\/+$/, '') || '/';

    return normalizedItemHref === normalizedCurrentPath;
  } catch (e) {
    // If URL parsing fails, do simple string comparison
    return itemHref === currentHref;
  }
}

/**
 * Renders a single nav item (link)
 * @param {object} item - Item configuration
 * @param {object} settings - Navbar settings
 * @param {string} currentHref - Current page URL
 * @returns {string} - HTML string
 */
function renderNavItem(item, settings, currentHref) {
  const isActive = settings.autoActive && isActivePage(item.href, currentHref);
  const activeClass = isActive ? ' active' : '';
  const ariaCurrent = isActive ? ' aria-current="page"' : '';
  const target = item.target ? ` target="${escapeHtml(item.target)}"` : '';
  const icon = item.icon ? `${item.icon} ` : '';
  const href = escapeHtml(item.href || '#');
  const label = escapeHtml(item.label || '');

  return `<li class="nav-item">` +
    `<a class="nav-link${activeClass}" href="${href}"${ariaCurrent}${target}>${icon}${label}</a>` +
    `</li>`;
}

/**
 * Renders a dropdown item inside a dropdown menu
 * @param {object} subItem - Sub-item configuration
 * @param {object} settings - Navbar settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - HTML string
 */
function renderDropdownSubItem(subItem, settings, currentHref, ctx) {
  // Divider
  if (subItem.type === 'divider') {
    return `<li><hr class="dropdown-divider"></li>`;
  }

  // Check visibility
  if (!isItemVisible(subItem, ctx)) return '';

  const isActive = settings.autoActive && isActivePage(subItem.href, currentHref);
  const activeClass = isActive ? ' active' : '';
  const target = subItem.target ? ` target="${escapeHtml(subItem.target)}"` : '';
  const icon = subItem.icon ? `${subItem.icon} ` : '';
  const href = escapeHtml(subItem.href || '#');
  const label = escapeHtml(subItem.label || '');

  return `<li>` +
    `<a class="dropdown-item${activeClass}" href="${href}"${target}>${icon}${label}</a>` +
    `</li>`;
}

/**
 * Renders a dropdown menu
 * @param {object} item - Dropdown item with nested items array
 * @param {object} settings - Navbar settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - HTML string
 */
function renderDropdown(item, settings, currentHref, ctx) {
  const icon = item.icon ? `${item.icon} ` : '';
  const label = escapeHtml(item.label || '');
  const dropdownId = `dropdown-${escapeHtml(settings.id)}-${label.replace(/\s+/g, '-').toLowerCase()}`;

  // Render sub-items
  const subItemsHtml = (item.items || [])
    .map(subItem => renderDropdownSubItem(subItem, settings, currentHref, ctx))
    .filter(html => html !== '')
    .join('\n        ');

  // If no visible sub-items, don't render the dropdown
  if (!subItemsHtml.trim()) return '';

  return `<li class="nav-item dropdown">
      <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false" id="${dropdownId}">
        ${icon}${label}
      </a>
      <ul class="dropdown-menu" aria-labelledby="${dropdownId}">
        ${subItemsHtml}
      </ul>
    </li>`;
}

/**
 * Renders a separator (visual spacer between nav items)
 * @returns {string} - HTML string
 */
function renderSeparator() {
  return `<li class="nav-item"><span class="nav-link disabled px-1">|</span></li>`;
}

/**
 * Renders a list of items into nav-items HTML
 * @param {Array} items - Array of item configurations
 * @param {object} settings - Navbar settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - HTML string of all items
 */
function renderItems(items, settings, currentHref, ctx) {
  if (!Array.isArray(items)) return '';

  return items
    .map(item => {
      // Check visibility for non-dropdown, non-separator items
      if (item.type !== 'separator' && item.type !== 'divider') {
        if (!isItemVisible(item, ctx)) return '';
      }

      // Separator
      if (item.type === 'separator') {
        return renderSeparator();
      }

      // Dropdown
      if (item.type === 'dropdown') {
        return renderDropdown(item, settings, currentHref, ctx);
      }

      // Regular nav item
      return renderNavItem(item, settings, currentHref);
    })
    .filter(html => html !== '')
    .join('\n      ');
}

/**
 * Renders a horizontal navbar (standard Bootstrap navbar with collapse)
 * @param {object} config - Full navbar configuration
 * @param {object} settings - Merged settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - Complete HTML
 */
function renderHorizontal(config, settings, currentHref, ctx) {
  const sections = config.sections || {};
  const leftItems = renderItems(sections.left || [], settings, currentHref, ctx);
  const rightItems = renderItems(sections.right || [], settings, currentHref, ctx);

  const expandClass = `navbar-expand-${escapeHtml(settings.expandAt)}`;
  const colorSchemeAttr = `data-bs-theme="${escapeHtml(settings.colorScheme)}"`;

  return `<nav class="navbar ${expandClass} ${escapeHtml(settings.bgClass)}" ${colorSchemeAttr}>
  <div class="${escapeHtml(settings.containerClass)}">
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#${escapeHtml(settings.id)}" aria-controls="${escapeHtml(settings.id)}" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="${escapeHtml(settings.id)}">
      <ul class="navbar-nav me-auto mb-2 mb-${escapeHtml(settings.expandAt)}-0">
      ${leftItems}
      </ul>
      <ul class="navbar-nav mb-2 mb-${escapeHtml(settings.expandAt)}-0">
      ${rightItems}
      </ul>
    </div>
  </div>
</nav>`;
}

/**
 * Renders a vertical navbar (sidebar)
 * @param {object} config - Full navbar configuration
 * @param {object} settings - Merged settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - Complete HTML
 */
function renderVertical(config, settings, currentHref, ctx) {
  const sections = config.sections || {};
  const leftItems = renderItems(sections.left || [], settings, currentHref, ctx);
  const rightItems = renderItems(sections.right || [], settings, currentHref, ctx);

  const colorSchemeAttr = `data-bs-theme="${escapeHtml(settings.colorScheme)}"`;
  const positionClass = settings.position === 'end' ? 'ms-auto' : '';

  return `<nav class="navbar ${escapeHtml(settings.bgClass)} flex-column align-items-stretch p-3 ${positionClass}" ${colorSchemeAttr} id="${escapeHtml(settings.id)}">
  <ul class="navbar-nav flex-column">
    ${leftItems}
  </ul>
  ${rightItems ? `<hr class="my-2">
  <ul class="navbar-nav flex-column">
    ${rightItems}
  </ul>` : ''}
</nav>`;
}

/**
 * Renders an offcanvas navbar
 * @param {object} config - Full navbar configuration
 * @param {object} settings - Merged settings
 * @param {string} currentHref - Current page URL
 * @param {object} ctx - Koa context
 * @returns {string} - Complete HTML
 */
function renderOffcanvas(config, settings, currentHref, ctx) {
  const sections = config.sections || {};
  const leftItems = renderItems(sections.left || [], settings, currentHref, ctx);
  const rightItems = renderItems(sections.right || [], settings, currentHref, ctx);

  const offcanvasId = `${escapeHtml(settings.id)}-offcanvas`;
  const offcanvasPosition = settings.position === 'end' ? 'offcanvas-end' : 'offcanvas-start';
  const colorSchemeAttr = `data-bs-theme="${escapeHtml(settings.colorScheme)}"`;

  // If offcanvasAlways is true, don't add navbar-expand-* (hamburger always visible)
  // If false, use navbar-expand-{expandAt} (collapses below breakpoint)
  const expandClass = settings.offcanvasAlways ? '' : `navbar-expand-${escapeHtml(settings.expandAt)}`;

  return `<nav class="navbar ${expandClass} ${escapeHtml(settings.bgClass)}" ${colorSchemeAttr}>
  <div class="${escapeHtml(settings.containerClass)}">
    <button class="navbar-toggler" type="button" data-bs-toggle="offcanvas" data-bs-target="#${offcanvasId}" aria-controls="${offcanvasId}" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="offcanvas ${offcanvasPosition}" tabindex="-1" id="${offcanvasId}" aria-labelledby="${offcanvasId}-label">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title" id="${offcanvasId}-label">&nbsp;</h5>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body">
        <ul class="navbar-nav me-auto mb-2 mb-${escapeHtml(settings.expandAt)}-0">
        ${leftItems}
        </ul>
        <ul class="navbar-nav mb-2 mb-${escapeHtml(settings.expandAt)}-0">
        ${rightItems}
        </ul>
      </div>
    </div>
  </div>
</nav>`;
}

/**
 * Main render function. Reads a navbar.{name}.json5 file and generates HTML.
 *
 * @param {object} options - Render options
 * @param {string} options.name - Navbar name (matches navbar.{name}.json5)
 * @param {object} [options.settingsOverrides] - Optional overrides for settings
 * @param {object} passData - The passData object from the EJS template
 * @param {boolean} isDebugMode - If true, re-reads file on every call (no cache)
 * @param {Map} cache - Cache map for parsed navbar configs
 * @returns {string} - Generated HTML string, or empty string on error
 */
function render(options, passData, isDebugMode, cache) {
  const { name } = options;

  if (!name) {
    console.warn('[bootstrapNavbar] render() called without a name');
    return '';
  }

  if (!passData || !passData.filePath) {
    console.warn('[bootstrapNavbar] render() called without passData or passData.filePath');
    return '';
  }

  // Resolve the directory of the calling EJS template
  const templateDir = path.dirname(passData.filePath);
  const navbarFileName = `navbar.${name}.json5`;
  const navbarFilePath = path.join(templateDir, navbarFileName);

  // Cache key based on full file path
  const cacheKey = navbarFilePath;

  // Try cache first (production mode)
  let config;
  if (!isDebugMode && cache.has(cacheKey)) {
    config = cache.get(cacheKey);
  } else {
    // Read and parse the JSON5 file
    if (!fs.existsSync(navbarFilePath)) {
      console.warn(`[bootstrapNavbar] File not found: ${navbarFilePath}`);
      return '';
    }

    try {
      config = loadJson5(navbarFilePath);
    } catch (error) {
      console.error(`[bootstrapNavbar] Error parsing ${navbarFilePath}:`, error.message);
      return '';
    }

    // Cache in production mode
    if (!isDebugMode) {
      cache.set(cacheKey, config);
    }
  }

  // Merge settings: defaults < file settings < runtime overrides
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(config.settings || {}),
    ...(options.settingsOverrides || {}),
  };

  const currentHref = passData.href || '';
  const ctx = passData.ctx || {};

  // Render based on type
  switch (settings.type) {
    case 'vertical':
      return renderVertical(config, settings, currentHref, ctx);

    case 'offcanvas':
      return renderOffcanvas(config, settings, currentHref, ctx);

    case 'horizontal':
    default:
      return renderHorizontal(config, settings, currentHref, ctx);
  }
}

module.exports = {
  render,
  // Exported for testing
  isItemVisible,
  isActivePage,
  escapeHtml,
};
