/**
 * adminBootstrapNavbar - main.js
 *
 * Admin plugin for creating and managing bootstrapNavbar navigation menus.
 * Provides a GUI editor in the admin panel for navbar JSON5 configuration files.
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));
let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const pluginName = path.basename(__dirname);

const navbarFileManager = require('./lib/navbarFileManager');
const navbarValidator = require('./lib/navbarValidator');
const navbarTemplates = require('./lib/navbarTemplates');

let myPluginSys = null;
let cachedNavbarList = null; // Cached scan results
let bootstrapUrls = null; // Shared URLs from bootstrap plugin

// Absolute path to wwwPath
const projectRoot = path.join(__dirname, '..', '..');
const wwwDir = path.join(projectRoot, ital8Conf.wwwPath);
const backupDir = path.join(__dirname, 'backups');

// Access configuration for all routes: root (0), admin (1), editor (2)
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1, 2],
};

/**
 * Performs the filesystem scan and caches results
 */
function performScan() {
  cachedNavbarList = navbarFileManager.scanNavbarFiles(wwwDir);
  console.log(`[${pluginName}] Scan complete: ${cachedNavbarList.length} navbar files found in ${wwwDir}`);
  return cachedNavbarList;
}

/**
 * Validates that a requested file is within wwwDir (security check)
 */
function resolveAndValidateFilePath(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return { valid: false, error: 'Missing file name' };
  }

  // fileName can include relative subdirectory path like "subdir/navbar.test.json5"
  const filePath = path.resolve(wwwDir, fileName);

  // Security: ensure path stays within wwwDir
  if (!filePath.startsWith(wwwDir + path.sep) && filePath !== wwwDir) {
    return { valid: false, error: 'Access denied: path outside wwwPath' };
  }

  return { valid: true, filePath };
}

/**
 * Validates a navbar name against allowed characters
 */
function isValidNavbarName(name) {
  const pattern = new RegExp(`^[${pluginConfig.custom.allowedFileNameChars}]+$`);
  return pattern.test(name);
}

/**
 * Loads role data for validation
 */
function loadRoleData() {
  try {
    const roleFilePath = path.join(__dirname, '..', 'adminUsers', 'userRole.json5');
    return loadJson5(roleFilePath);
  } catch (err) {
    return null;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function loadPlugin(pluginSys, pathPluginFolder) {
  myPluginSys = pluginSys;

  // Initial scan
  performScan();

  // Ensure backups directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`[${pluginName}] Plugin loaded`);
}

function installPlugin() {}
function uninstallPlugin() {}
function upgradePlugin() {}

// ─── File Tree Builder ────────────────────────────────────────────────────────

/**
 * Recursively builds a file tree for a directory.
 * Returns { files: [string], dirs: { name: {files, dirs} } }
 * Follows symlinks to read their contents.
 */
function buildFileTree(dirPath) {
  const result = { files: [], dirs: {} };

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return result;
  }

  // Sort entries alphabetically
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // Resolve symlinks to determine actual type
    let isDir = false;
    let isFile = false;
    try {
      const stat = fs.statSync(fullPath);
      isDir = stat.isDirectory();
      isFile = stat.isFile();
    } catch (err) {
      // Broken symlink or permission error — skip
      continue;
    }

    if (isDir) {
      result.dirs[entry.name] = buildFileTree(fullPath);
    } else if (isFile) {
      result.files.push(entry.name);
    }
  }

  return result;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

function getRouteArray() {
  const routeArray = [];

  // GET /list - List all discovered navbar files
  routeArray.push({
    method: 'GET',
    path: '/list',
    access: pluginAccess,
    handler: async (ctx) => {
      // Use cached list
      const list = cachedNavbarList || performScan();
      ctx.body = list;
      ctx.type = 'application/json';
    },
  });

  // GET /load - Load content of a specific navbar file
  routeArray.push({
    method: 'GET',
    path: '/load',
    access: pluginAccess,
    handler: async (ctx) => {
      const fileName = ctx.query.file;
      const resolved = resolveAndValidateFilePath(fileName);
      if (!resolved.valid) {
        ctx.status = 400;
        ctx.body = { error: resolved.error };
        return;
      }

      const result = navbarFileManager.readNavbarFile(resolved.filePath);
      ctx.body = result;
      ctx.type = 'application/json';
    },
  });

  // POST /save - Save navbar content (with backup)
  routeArray.push({
    method: 'POST',
    path: '/save',
    access: pluginAccess,
    handler: async (ctx) => {
      const { file, content } = ctx.request.body;
      const resolved = resolveAndValidateFilePath(file);
      if (!resolved.valid) {
        ctx.status = 400;
        ctx.body = { error: resolved.error };
        return;
      }

      // Save
      const result = navbarFileManager.saveNavbarFile(
        resolved.filePath,
        content,
        backupDir,
        wwwDir,
        pluginConfig.custom.maxBackupsPerFile
      );

      if (result.success) {
        // Refresh scan cache
        performScan();
      }

      ctx.body = result;
      ctx.type = 'application/json';
    },
  });

  // POST /validate - Validate JSON5 content without saving
  routeArray.push({
    method: 'POST',
    path: '/validate',
    access: pluginAccess,
    handler: async (ctx) => {
      const { content } = ctx.request.body;
      if (!content || typeof content !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'Missing content' };
        return;
      }

      const roleData = loadRoleData();
      const result = navbarValidator.validate(content, {
        wwwDir,
        linkValidationSeverity: pluginConfig.custom.linkValidationSeverity,
        roleData,
      });

      ctx.body = result;
      ctx.type = 'application/json';
    },
  });

  // POST /preview - Render navbar preview HTML
  routeArray.push({
    method: 'POST',
    path: '/preview',
    access: pluginAccess,
    handler: async (ctx) => {
      const { content } = ctx.request.body;
      if (!content || typeof content !== 'string') {
        ctx.status = 400;
        ctx.body = { error: 'Missing content' };
        return;
      }

      // Parse the JSON5 content
      let config;
      try {
        const JSON5 = require('json5');
        config = JSON5.parse(content);
      } catch (parseErr) {
        ctx.body = { success: false, error: `JSON5 parse error: ${parseErr.message}` };
        return;
      }

      // Get the bootstrapNavbar renderer
      const bootstrapNavbarPlugin = myPluginSys ? myPluginSys.getPlugin('bootstrapNavbar') : null;
      if (!bootstrapNavbarPlugin) {
        ctx.body = { success: false, error: 'bootstrapNavbar plugin not available' };
        return;
      }

      // Import the navbarRenderer directly to render from config object
      const navbarRenderer = require('../bootstrapNavbar/lib/navbarRenderer');

      // Merge settings with defaults
      const settings = {
        type: 'horizontal',
        colorScheme: 'dark',
        bgClass: 'bg-primary',
        expandAt: 'lg',
        containerClass: 'container-fluid',
        autoActive: false, // Disable auto-active in preview
        offcanvasAlways: false,
        position: 'start',
        id: 'navbarPreview',
        ...(config.settings || {}),
      };

      // Render ALL items (no auth filter) with visual indicators
      const sections = config.sections || {};
      const allItemsHtml = renderPreviewWithIndicators(config, settings, navbarRenderer);

      ctx.body = {
        success: true,
        html: allItemsHtml,
        settings: {
          type: settings.type,
          colorScheme: settings.colorScheme,
          bgClass: settings.bgClass,
          expandAt: settings.expandAt,
          itemsLeft: (sections.left || []).length,
          itemsRight: (sections.right || []).length,
        },
        bootstrap: {
          css: bootstrapUrls ? bootstrapUrls.cssUrl : `/${ital8Conf.apiPrefix}/bootstrap/css/bootstrap.min.css`,
          js: bootstrapUrls ? bootstrapUrls.jsUrl : `/${ital8Conf.apiPrefix}/bootstrap/js/bootstrap.bundle.min.js`,
        },
      };
      ctx.type = 'application/json';
    },
  });

  // POST /create - Create a new navbar file
  routeArray.push({
    method: 'POST',
    path: '/create',
    access: pluginAccess,
    handler: async (ctx) => {
      const { name, mode, templateId, sourceFile } = ctx.request.body;

      if (!name || typeof name !== 'string') {
        ctx.body = { success: false, error: 'Missing navbar name' };
        return;
      }

      if (!isValidNavbarName(name)) {
        ctx.body = {
          success: false,
          error: `Invalid name. Allowed characters: ${pluginConfig.custom.allowedFileNameChars}`,
        };
        return;
      }

      const fileName = `navbar.${name}.json5`;
      const filePath = path.join(wwwDir, fileName);

      // Check if file already exists
      if (fs.existsSync(filePath)) {
        ctx.body = { success: false, error: `File ${fileName} already exists` };
        return;
      }

      let content;

      switch (mode) {
        case 'empty':
          content = navbarTemplates.generateEmpty(name);
          break;

        case 'template':
          if (!templateId) {
            ctx.body = { success: false, error: 'Missing templateId' };
            return;
          }
          content = navbarTemplates.generateFromTemplate(templateId, name);
          if (!content) {
            ctx.body = { success: false, error: `Template "${templateId}" not found` };
            return;
          }
          break;

        case 'duplicate':
          if (!sourceFile) {
            ctx.body = { success: false, error: 'Missing sourceFile' };
            return;
          }
          const sourceResolved = resolveAndValidateFilePath(sourceFile);
          if (!sourceResolved.valid) {
            ctx.body = { success: false, error: sourceResolved.error };
            return;
          }
          const sourceResult = navbarFileManager.readNavbarFile(sourceResolved.filePath);
          if (!sourceResult.success) {
            ctx.body = { success: false, error: `Cannot read source: ${sourceResult.error}` };
            return;
          }
          content = sourceResult.content;
          break;

        default:
          ctx.body = { success: false, error: 'Invalid mode. Use: empty, template, duplicate' };
          return;
      }

      const result = navbarFileManager.createNavbarFile(filePath, content);

      if (result.success) {
        performScan(); // Refresh cache
      }

      ctx.body = { ...result, fileName };
      ctx.type = 'application/json';
    },
  });

  // POST /duplicate - Duplicate an existing navbar
  routeArray.push({
    method: 'POST',
    path: '/duplicate',
    access: pluginAccess,
    handler: async (ctx) => {
      const { name, sourceFile } = ctx.request.body;

      // Delegate to create with mode=duplicate
      ctx.request.body.mode = 'duplicate';
      const createHandler = routeArray.find(r => r.path === '/create').handler;
      await createHandler(ctx);
    },
  });

  // POST /delete - Soft-delete a navbar file
  routeArray.push({
    method: 'POST',
    path: '/delete',
    access: pluginAccess,
    handler: async (ctx) => {
      const { file } = ctx.request.body;
      const resolved = resolveAndValidateFilePath(file);
      if (!resolved.valid) {
        ctx.status = 400;
        ctx.body = { error: resolved.error };
        return;
      }

      const result = navbarFileManager.deleteNavbarFile(resolved.filePath, backupDir, wwwDir);

      if (result.success) {
        performScan(); // Refresh cache
      }

      ctx.body = result;
      ctx.type = 'application/json';
    },
  });

  // GET /templates - List available templates
  routeArray.push({
    method: 'GET',
    path: '/templates',
    access: pluginAccess,
    handler: async (ctx) => {
      ctx.body = navbarTemplates.getTemplateList();
      ctx.type = 'application/json';
    },
  });

  // GET /browse-files - Browse files for the file picker (tree view)
  routeArray.push({
    method: 'GET',
    path: '/browse-files',
    access: pluginAccess,
    handler: async (ctx) => {
      const defaultExt = pluginConfig.custom.filePickerDefaultExt || '.ejs';
      const isDeveloperMode = ital8Conf.developerMode === true;

      const roots = {};

      // Always include /www/
      roots['/www'] = buildFileTree(wwwDir);

      // In developer mode, also include /pluginPages/ and /admin/
      if (isDeveloperMode) {
        const pluginPagesDir = path.join(projectRoot, ital8Conf.pluginPagesPath || '/pluginPages');
        if (fs.existsSync(pluginPagesDir)) {
          roots['/pluginPages'] = buildFileTree(pluginPagesDir);
        }

        const adminPagesDir = path.join(projectRoot, ital8Conf.adminPagesPath || '/core/admin/webPages');
        if (fs.existsSync(adminPagesDir)) {
          roots['/admin'] = buildFileTree(adminPagesDir);
        }
      }

      ctx.body = {
        roots,
        developerMode: isDeveloperMode,
        defaultExt,
      };
      ctx.type = 'application/json';
    },
  });

  // POST /refresh-scan - Re-scan filesystem
  routeArray.push({
    method: 'POST',
    path: '/refresh-scan',
    access: pluginAccess,
    handler: async (ctx) => {
      const list = performScan();
      ctx.body = { success: true, count: list.length, navbars: list };
      ctx.type = 'application/json';
    },
  });

  return routeArray;
}

// ─── Preview Renderer ────────────────────────────────────────────────────────

/**
 * Renders a navbar preview showing ALL items with visibility indicators.
 * Items that would be filtered by auth/roles are shown with visual markers.
 */
function renderPreviewWithIndicators(config, settings, navbarRenderer) {
  const sections = config.sections || {};

  // Render items with indicators using the existing renderer functions
  const leftHtml = renderPreviewItems(sections.left || [], settings);
  const rightHtml = renderPreviewItems(sections.right || [], settings);

  // Build the navbar HTML based on type
  const colorSchemeAttr = `data-bs-theme="${escapeHtml(settings.colorScheme)}"`;

  if (settings.type === 'vertical') {
    const positionClass = settings.position === 'end' ? 'ms-auto' : '';
    return `<nav class="navbar ${escapeHtml(settings.bgClass)} flex-column align-items-stretch p-3 ${positionClass}" ${colorSchemeAttr} id="${escapeHtml(settings.id)}">
  <ul class="navbar-nav flex-column">${leftHtml}</ul>
  ${rightHtml ? `<hr class="my-2"><ul class="navbar-nav flex-column">${rightHtml}</ul>` : ''}
</nav>`;
  }

  if (settings.type === 'offcanvas') {
    return `<nav class="navbar navbar-expand-${escapeHtml(settings.expandAt)} ${escapeHtml(settings.bgClass)}" ${colorSchemeAttr}>
  <div class="${escapeHtml(settings.containerClass)}">
    <span class="navbar-text text-muted small me-2">[Offcanvas]</span>
    <ul class="navbar-nav me-auto">${leftHtml}</ul>
    <ul class="navbar-nav">${rightHtml}</ul>
  </div>
</nav>`;
  }

  // Horizontal (default)
  return `<nav class="navbar navbar-expand-${escapeHtml(settings.expandAt)} ${escapeHtml(settings.bgClass)}" ${colorSchemeAttr}>
  <div class="${escapeHtml(settings.containerClass)}">
    <ul class="navbar-nav me-auto">${leftHtml}</ul>
    <ul class="navbar-nav">${rightHtml}</ul>
  </div>
</nav>`;
}

/**
 * Renders items for preview with visibility indicators
 */
function renderPreviewItems(items, settings) {
  if (!Array.isArray(items)) return '';

  return items.map(item => {
    if (item.type === 'separator') {
      return '<li class="nav-item"><span class="nav-link disabled px-1">|</span></li>';
    }

    if (item.type === 'divider') {
      return '<li><hr class="dropdown-divider"></li>';
    }

    const indicator = getVisibilityIndicator(item);
    const indicatorClass = indicator.class;
    const indicatorBadge = indicator.badge;

    if (item.type === 'dropdown') {
      const icon = item.icon ? `${item.icon} ` : '';
      const label = escapeHtml(item.label || '');
      const subItems = (item.items || []).map(subItem => {
        if (subItem.type === 'divider') {
          return '<li><hr class="dropdown-divider"></li>';
        }
        const subIndicator = getVisibilityIndicator(subItem);
        const subIcon = subItem.icon ? `${subItem.icon} ` : '';
        const subLabel = escapeHtml(subItem.label || '');
        return `<li><a class="dropdown-item ${subIndicator.class}" href="#">${subIcon}${subLabel}${subIndicator.badge}</a></li>`;
      }).join('');

      return `<li class="nav-item dropdown ${indicatorClass}">
        <a class="nav-link dropdown-toggle ${indicatorClass}" href="#" role="button" data-bs-toggle="dropdown">${icon}${label}${indicatorBadge}</a>
        <ul class="dropdown-menu">${subItems}</ul>
      </li>`;
    }

    // Regular item
    const icon = item.icon ? `${item.icon} ` : '';
    const label = escapeHtml(item.label || '');
    return `<li class="nav-item"><a class="nav-link ${indicatorClass}" href="#">${icon}${label}${indicatorBadge}</a></li>`;
  }).join('\n');
}

/**
 * Returns visibility indicator for preview
 */
function getVisibilityIndicator(item) {
  if (item.showWhen === 'authenticated' || item.requiresAuth === true) {
    const roles = (item.allowedRoles && item.allowedRoles.length > 0)
      ? ` [${item.allowedRoles.join(',')}]`
      : '';
    return {
      class: 'preview-auth-required',
      badge: ` <span class="badge bg-warning text-dark ms-1" title="Requires authentication${roles}">&#x1F512;</span>`,
    };
  }

  if (item.showWhen === 'unauthenticated' || item.requiresAuth === false) {
    return {
      class: 'preview-unauth-only',
      badge: ' <span class="badge bg-info text-dark ms-1" title="Visible only to non-authenticated users">&#x1F441;</span>',
    };
  }

  return { class: '', badge: '' };
}

/**
 * Simple HTML escape for preview rendering
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

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  loadPlugin,
  installPlugin,
  unistallPlugin: uninstallPlugin,
  upgradePlugin,
  getRouteArray,
  pluginConfig,
  getObjectToShareToWebPages: () => ({}),
  getObjectToShareToOthersPlugin: () => ({}),
  setSharedObject: (fromPlugin, sharedObject) => {
    if (fromPlugin === 'bootstrap') {
      bootstrapUrls = sharedObject;
    }
  },
};
