# CLAUDE.md - AI Assistant Guide for ital8cms

## Project Overview

**ital8cms** is a modular, plugin-based Content Management System built on Node.js and Koa.js. The architecture emphasizes extensibility through a sophisticated plugin system that supports dynamic loading, dependency resolution, and inter-plugin communication.

- **Version:** 0.0.1-alpha.0 (Early Alpha)
- **Author:** Italo Paesano (italopaesano@protonmail.com)
- **License:** ISC
- **Primary Language:** JavaScript (CommonJS)
- **Code Comments:** Mix of Italian and English (author is Italian)

### Core Philosophy

**Zero Database Dependency:** ital8cms does not require any DBMS by default. The core system and plugins use **JSON files** for structured data storage (user accounts, roles, configurations) and **file-based storage** for web pages. Database systems like SQLite are **optional** and can be added through plugins when needed for specific use cases.

**Developer-First Approach:** ital8cms rejects the "zero-knowledge" approach of many modern CMS platforms. This is a tool **for developers, by developers**:

- **Themes require:** HTML, CSS, JavaScript, and EJS templating knowledge
- **Plugins require:** Node.js/JavaScript programming skills, understanding of Koa.js middleware
- **Configuration requires:** Manual creation and editing of JSON/JSON5 files
- **No drag-and-drop:** All customization is done through code and file manipulation

**Why this approach?**
- ✅ **Full control:** No abstractions hiding the underlying technology
- ✅ **Flexibility:** Create exactly what you need without platform limitations
- ✅ **Performance:** No overhead from visual builders or abstraction layers
- ✅ **Learning:** Understand exactly how your CMS works
- ✅ **Debugging:** Easier to trace issues in plain code vs. generated configurations

**Target audience:** Web developers comfortable with Node.js, HTML/CSS, and server-side templating. Not suitable for non-technical users looking for a WYSIWYG editor.

**JSON5 Configuration Files:** All configuration files (with .json5 extension) in the project (except `package.json` and `package-lock.json`) are processed with JSON5 and support comments, trailing commas, and other JSON5 features. Each file must have a comment on the first line:

```javascript
// This file follows the JSON5 standard - comments and trailing commas are supported
```

**Loading JSON Files:** All JSON files must be loaded using the centralized `core/loadJson5.js` module (all config files now use .json5 extension):

```javascript
const loadJson5 = require('./core/loadJson5');
const config = loadJson5('./ital8Config.json5');
```

**DO NOT** use `require()` directly for `.json5` configuration files as it doesn't support JSON5 comments. **ALWAYS** use the `loadJson5()` function for loading all configuration files.

**Why loadJson5 naming:** The file is named `loadJson5.js` and the function is `loadJson5()` to maintain **perfect symmetry** between the module name and the exported function, making imports clear and intuitive.

## Codebase Structure

```
/home/user/ital8cms/
├── index.js                      # Main application entry point
├── ital8Config.json5              # Central configuration file
├── package.json                 # Node.js dependencies
│
├── core/                        # Core CMS functionality
│   ├── admin/                   # Admin System (modular architecture)
│   │   ├── adminConfig.json5    # Central admin configuration
│   │   ├── adminSystem.js       # Admin coordinator
│   │   ├── lib/                 # Admin subsystems
│   │   │   ├── configManager.js # Config loader & validator
│   │   │   ├── adminServicesManager.js # Service discovery
│   │   │   └── symlinkManager.js # Symlink manager for plugin sections
│   │   └── webPages/           # Admin EJS templates
│   │       ├── index.ejs       # Admin dashboard (dynamic menu)
│   │       ├── systemSettings/  # Hardcoded admin sections
│   │       └── usersManagment/  # SYMLINK → plugins/adminUsers/usersManagment/
│   ├── priorityMiddlewares/    # Critical middleware configs
│   │   └── koaSession.json5     # Session configuration
│   ├── pluginSys.js            # Plugin system manager
│   ├── themeSys.js             # Theme system manager
│   └── loadJson5.js            # JSON5 file loader utility
│
├── plugins/                     # Plugin modules (each self-contained)
│   ├── dbApi/                  # Database API plugin
│   │   ├── main.js             # Plugin logic
│   │   ├── pluginConfig.json5   # Plugin configuration
│   │   ├── pluginDescription.json5 # Plugin metadata
│   │   └── dbFile/             # SQLite database files
│   ├── adminUsers/             # Admin plugin: User & Role management
│   │   ├── main.js             # Plugin logic
│   │   ├── pluginConfig.json5   # Plugin config (with isAdminPlugin flag)
│   │   ├── pluginDescription.json5 # Plugin metadata
│   │   ├── adminConfig.json5    # Admin section metadata
│   │   ├── usersManagment/     # Admin section files (served via symlink)
│   │   │   ├── index.ejs       # User list page
│   │   │   ├── userView.ejs    # View user details
│   │   │   ├── userUpsert.ejs  # Create/edit user
│   │   │   └── userDelete.ejs  # Delete user
│   │   ├── userAccount.json5    # User credentials (bcrypt hashed)
│   │   ├── userRole.json5       # Role definitions
│   │   └── userManagement.js   # User management logic
│   ├── admin/                  # Admin core functionality plugin
│   ├── bootstrap/              # Bootstrap CSS/JS integration
│   ├── media/                  # Media management
│   ├── ccxt/                   # Cryptocurrency exchange API
│   └── ostrukUtility/          # Utility functions
│
├── themes/                      # Theme templates
│   ├── default/                # Default theme
│   │   ├── views/              # Theme partials
│   │   │   ├── head.ejs        # HTML head
│   │   │   ├── header.ejs      # Header section
│   │   │   ├── nav.ejs         # Navigation
│   │   │   ├── main.ejs        # Main content area
│   │   │   ├── aside.ejs       # Sidebar
│   │   │   └── footer.ejs      # Footer + scripts
│   │   └── templates/          # Full page templates
│   └── baseExampleTheme/       # Example theme
│
└── www/                         # Public web root
    └── index.ejs               # Public homepage
```

## Technology Stack

### Backend
- **Framework:** Koa.js v3.1.1 (async/await-based web framework)
- **Routing:** @koa/router v12.0.1
- **Middleware:** koa-bodyparser, koa-session, koa-classic-server v2.1.2
- **Data Storage:** JSON files (no database required)
- **Authentication:** bcryptjs v3.0.2 (password hashing)
- **Template Engine:** EJS v3.1.9
- **Utilities:** semver v7.5.4 (dependency versioning)

### Frontend
- **UI Framework:** Bootstrap v5.3.2
- **Templating:** Server-side EJS rendering

### Development
- **Auto-reload:** nodemon v3.0.1
- **Version Control:** Git

### Optional Plugin Dependencies
- **better-sqlite3:** SQLite database (via dbApi plugin - currently disabled)
- **ccxt v4.1.70:** Cryptocurrency exchange integration (via ccxt plugin)

## Application Startup Flow

Understanding the initialization sequence is critical:

1. **Load Koa Application** (`index.js`)
2. **Initialize Priority Middlewares:**
   - Body parser (request parsing)
   - Sessions (authentication state)
   - Router (URL routing)
3. **Initialize Plugin System** (`pluginSys`)
4. **Load Active Plugins:**
   - Resolve dependencies
   - Load in dependency order
   - Call `loadPlugin()` on each
   - Add metadata to plugin objects (`pluginName`, `pathPluginFolder`)
   - Share objects between plugins
5. **Register Plugin Routes:**
   - Prefix: `/${apiPrefix}/${pluginName}`
   - Default: `/api/{pluginName}/...`
6. **Load Plugin Middlewares**
7. **Initialize Theme System** (`themeSys`)
8. **Initialize Admin System** (if `enableAdmin: true`):
   - **Phase 1:** Create AdminSystem instance
   - **Phase 2:** Link dependencies (2-way injection to avoid circular refs)
     - `adminSystem.setPluginSys(pluginSys)`
     - `pluginSys.setAdminSystem(adminSystem)`
   - **Phase 3:** Initialize AdminSystem
     - Validate existing symlinks
     - Process admin plugins (create symlinks for sections)
     - Load services from configuration
9. **Setup Static Servers:**
   - Public site: `/www` directory → `/`
   - Admin panel: `/core/admin/webPages` → `/admin`
10. **Start HTTP Server** (port 3000 by default)

## Plugin System Architecture

The plugin system is the heart of ital8cms. Understanding it is essential.

### Plugin Structure

**Minimum Required Structure:**

Every plugin must have these files:

```
plugins/myPlugin/
├── main.js                    # Plugin logic (required)
├── pluginConfig.json5          # Configuration (required)
└── pluginDescription.json5     # Metadata (required)
```

**Recommended Structure for Plugins Serving Web Pages:**

If your plugin serves HTML pages via EJS templates, use this **strongly recommended** structure:

```
plugins/myPlugin/
├── main.js                    # Plugin logic (required)
├── pluginConfig.json5          # Configuration (required)
├── pluginDescription.json5     # Metadata (required)
└── webPages/                  # ⭐ STRONGLY RECOMMENDED for EJS templates
    ├── login.ejs
    ├── profile.ejs
    └── settings.ejs
```

**Why `webPages/` is recommended:**
- ✅ **Clear organization** - Separates template files from logic
- ✅ **Consistency** - Follows pattern used in `adminUsers` (reference plugin)
- ✅ **Maintainability** - Easy to locate and manage templates
- ✅ **Scalability** - Better structure as plugin grows

**Note:** The `webPages/` directory is a **convention, not a requirement**. Plugins serving only JSON APIs (like `bootstrap`, `simpleI18n`) don't need it. You can organize your plugin differently if needed, but this structure is recommended for consistency across the project.

### Plugin main.js Exports

A plugin's `main.js` can export these functions:

```javascript
module.exports = {
  // Lifecycle hooks
  async loadPlugin(pluginSys, pathPluginFolder) {},
  async installPlugin(pluginSys, pathPluginFolder) {},
  async uninstallPlugin(pluginSys, pathPluginFolder) {},
  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {},

  // Route registration
  getRouteArray(router, pluginSys, pathPluginFolder) { return [] },

  // Middleware registration
  getMiddlewareToAdd(pluginSys, pathPluginFolder) { return [] },

  // Object sharing
  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) { return {} },
  setSharedObject(fromPlugin, sharedObject) {},

  // Template functions (local - always available)
  getObjectToShareToWebPages() { return {} },

  // Template functions (global - requires whitelist authorization)
  getGlobalFunctionsForTemplates() { return {} },

  // Page hooks
  getHooksPage(section, passData, pluginSys, pathPluginFolder) { return "" }
}
```

### pluginConfig.json5

```json
{
  "active": 1,                    // 0=disabled, 1=enabled
  "isInstalled": 1,               // Installation status
  "weight": 0,                    // Load priority (lower = earlier)
  "dependency": {                 // Plugin dependencies
    "pluginName": "^1.0.0"       // Semantic versioning
  },
  "nodeModuleDependency": {       // NPM dependencies
    "package": "^1.0.0"
  },
  "custom": {                     // Plugin-specific settings
    "setting1": "value1"
  }
}
```

### pluginDescription.json5

```json
{
  "name": "myPlugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Your Name",
  "email": "email@example.com",
  "license": "MIT"
}
```

### Plugin Loading Order

Plugins are loaded by:
1. **Weight** (ascending: 0, 1, 2...)
2. **Dependency resolution** (dependencies loaded first)
3. **Alphabetical** (if weight is equal)

### Inter-Plugin Communication

Plugins share objects via:

```javascript
// In providing plugin (e.g., dbApi)
getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  // Can customize what to share per requesting plugin
  if (forPlugin === 'adminUsers') {
    return { db: this.userDb }
  }
  return { db: this.sharedDb }
}

// In receiving plugin
setSharedObject(fromPlugin, sharedObject) {
  if (fromPlugin === 'dbApi') {
    this.db = sharedObject.db
  }
}

// Access shared objects in other code
const dbApiShared = pluginSys.getSharedObject('dbApi')
```

### Plugin API Routes

Routes follow pattern: `/${apiPrefix}/${pluginName}/${path}`

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'get',  // 'get', 'post', 'put', 'del', 'all'
      path: '/hello',
      func: async (ctx) => {
        ctx.body = 'Hello World'
      }
    }
  ]
}
```

Accessible at: `/api/myPlugin/hello`

### Page Hooks

Plugins can inject content into page sections:

```javascript
getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  if (section === 'head') {
    return '<link rel="stylesheet" href="/my-styles.css">'
  }
  if (section === 'header') {
    return '<div>Injected header content</div>'
  }
  if (section === 'script') {
    return '<script src="/my-script.js"></script>'
  }
  return ''
}
```

Available sections: `head`, `header`, `body`, `footer`, `script`

### Global Functions in Templates

**Feature:** Plugins can expose functions as global helpers in EJS templates, making them accessible directly without the `passData.plugin.{pluginName}` prefix.

**Architecture Overview:**

The system uses a **whitelist-based security model** with three components:
1. **Whitelist** (`ital8Config.json5`) - Authorizes which functions can be global
2. **Plugin Export** (`getGlobalFunctionsForTemplates()`) - Plugin declares global function candidates
3. **Registration** (`pluginSys.getGlobalFunctions()`) - Validates and registers functions

---

#### 1. Whitelist Configuration (ital8Config.json5)

Global functions MUST be explicitly authorized in the central configuration:

```json5
{
  "globalFunctionsWhitelist": {
    "__": {
      "plugin": "simpleI18n",
      "description": "Translation function for internationalization",
      "required": true  // true = fail-fast, false = graceful degradation
    }
    // Add more functions here as needed
  }
}
```

**Whitelist attributes:**
- `plugin` (required) - Plugin that provides the function
- `description` (optional) - Documentation for the function
- `required` (required) - Behavior if plugin is missing:
  - `true` → **CRASH STARTUP** (fail-fast) - System cannot run without this function
  - `false` → **CREATE FALLBACK** (graceful degradation) - Fallback function logs WARNING when called

---

#### 2. Plugin Standard: getGlobalFunctionsForTemplates()

Plugins export global function candidates via a dedicated method:

```javascript
module.exports = {
  // Existing standard methods...
  getObjectToShareToWebPages() {
    // LOCAL functions (available as passData.plugin.{pluginName}.{function})
    return {
      __: this.translate.bind(this),
      getCurrentLang: (ctx) => ctx?.state?.lang,
      getSupportedLangs: () => [...this.config.supportedLangs],
      getConfig: () => ({ ...this.config })
    };
  },

  // NEW: Global function candidates (must be in whitelist)
  getGlobalFunctionsForTemplates() {
    // GLOBAL functions (available directly in templates)
    // Only functions listed here can be considered for global registration
    // Final registration depends on whitelist authorization
    return {
      __: this.translate.bind(this)
    };
  }
}
```

**Key points:**
- ✅ **Explicit declaration:** Only functions returned here are candidates for global registration
- ✅ **Clear separation:** `getObjectToShareToWebPages()` = local, `getGlobalFunctionsForTemplates()` = global
- ✅ **Security:** Plugin CANNOT force global registration - must be authorized in whitelist
- ⚠️ **WARNING:** If plugin is in whitelist but doesn't implement this method, a warning is logged

---

#### 3. Registration System (pluginSys.js)

The `pluginSys.getGlobalFunctions()` method validates and registers functions:

**Flow:**
1. Read whitelist from `ital8Config.json5`
2. For each function in whitelist:
   - Check if plugin is active
   - Check if plugin implements `getGlobalFunctionsForTemplates()`
   - Check if function exists in returned object
   - Register function if all checks pass
3. Return registered functions for EJS

**Security features:**
- ✅ **Whitelist enforcement:** Only authorized functions are registered
- ✅ **Fail-fast mode:** Required functions missing = startup crash
- ✅ **Fallback mode:** Optional functions missing = fallback created
- ✅ **Clear warnings:** Missing implementations or misconfigurations are logged

---

#### 4. Usage in Templates

**Global syntax (recommended for whitelisted functions):**

```ejs
<%- __({
  it: "Ciao Mondo",
  en: "Hello World"
}, passData.ctx) %>
```

**Local syntax (always available, backward compatible):**

```ejs
<%- passData.plugin.simpleI18n.__({
  it: "Ciao Mondo",
  en: "Hello World"
}, passData.ctx) %>
```

---

#### Important Notes

- ✅ **Both syntaxes always work:** Global is convenient, local is always available
- ✅ **No breaking changes:** Existing code continues to work without modification
- ✅ **Backward compatibility guaranteed:** `getObjectToShareToWebPages()` remains the standard for local functions
- ✅ **Security first:** Whitelist prevents unauthorized global function injection
- ✅ **Extensible:** Add new global functions by:
  1. Implementing `getGlobalFunctionsForTemplates()` in plugin
  2. Adding function to whitelist in `ital8Config.json5`

---

#### Currently Supported Global Functions

- `__()` - Translation function from `simpleI18n` plugin

---

#### Example Files

- **Configuration:** `/ital8Config.json5` (globalFunctionsWhitelist section)
- **Plugin implementation:** `/plugins/simpleI18n/main.js` (getGlobalFunctionsForTemplates method)
- **Template example:** `/www/i18n-test.ejs` (side-by-side syntax comparison)

## Plugin Pages System

### Overview

The **Plugin Pages System** allows plugins to serve public web pages without manually creating route endpoints. It uses a symlink-based architecture for zero file duplication and integrates seamlessly with the theme system for customization.

**Key Features:**
- ✅ **Zero configuration:** Plugins with `webPages/` directory are auto-detected
- ✅ **Symlink-based:** Single source of truth, no file duplication
- ✅ **Theme integration:** Automatic injection of theme customizations
- ✅ **Clean API:** No redundant parameters in template calls
- ✅ **Auto-detection:** Plugin and page names extracted from file path

**URL Pattern:** `/{pluginPagesPrefix}/{pluginName}/{file.ejs}`

**Default:** `/pluginPages/{pluginName}/{file.ejs}`

### Architecture

```
/plugins/
├── myPlugin/
│   ├── main.js
│   ├── pluginConfig.json5
│   └── webPages/              ← Plugin's web pages (source)
│       ├── page1.ejs
│       └── page2.ejs
│
/pluginPages/                  ← Symlinks directory (root of project)
└── myPlugin/                  → SYMLINK to /plugins/myPlugin/webPages/

/themes/
└── default/
    └── pluginsEndpointsMarkup/
        └── myPlugin/
            ├── page1/         ← Theme customizations for page1
            │   ├── style.css
            │   ├── script.js
            │   ├── before-content.html
            │   └── after-content.html
            └── page2/
                └── style.css
```

### Configuration

**In `ital8Config.json5`:**

```json5
{
  "pluginPagesPrefix": "pluginPages"  // URL prefix (hardcoded: /pluginPages/ directory)
}
```

**No plugin configuration needed!** The system auto-detects plugins with `webPages/` directory.

### How It Works

**1. Automatic Detection**

At startup, `PluginPagesSystem`:
- Scans all active plugins
- Detects plugins with `webPages/` directory
- Creates symlinks: `/pluginPages/{pluginName}/` → `/plugins/{pluginName}/webPages/`

**2. Request Flow**

```
User requests: /pluginPages/myPlugin/page1.ejs
       ↓
koa-classic-server matches /pluginPages/ prefix
       ↓
Resolves symlink: /pluginPages/myPlugin/ → /plugins/myPlugin/webPages/
       ↓
Loads: /plugins/myPlugin/webPages/page1.ejs
       ↓
Renders with passData (ctx, pluginSys, themeSys, etc.)
       ↓
Theme customizations auto-injected
       ↓
HTML returned to user
```

**3. Theme Customization Injection**

The system auto-injects theme customizations:
- **CSS:** `themes/{theme}/pluginsEndpointsMarkup/{plugin}/{page}/style.css` → `<style>` in `<head>`
- **JS:** `themes/{theme}/pluginsEndpointsMarkup/{plugin}/{page}/script.js` → `<script>` in `<head>`
- **HTML Before:** `themes/{theme}/pluginsEndpointsMarkup/{plugin}/{page}/before-content.html` → before `<main>`
- **HTML After:** `themes/{theme}/pluginsEndpointsMarkup/{plugin}/{page}/after-content.html` → after `<main>`

### Creating Plugin Pages

**Plugin Structure (Recommended):**

```
plugins/myPlugin/
├── main.js
├── pluginConfig.json5
├── pluginDescription.json5
└── webPages/                  ← Create this directory
    ├── login.ejs
    ├── profile.ejs
    └── settings.ejs
```

**No special configuration required!** Just create the `webPages/` directory.

### Template Standard

**File: `plugins/myPlugin/webPages/mypage.ejs`**

```ejs
<!DOCTYPE html>
<html lang="it">
<%# ========== INCLUDE TEMA HEAD ========== %>
<%# Include già Bootstrap CSS, meta tags, plugin hooks, ecc. %>
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>

<%# ========== PERSONALIZZAZIONI TEMA SPECIFICHE ========== %>
<%# Auto-rileva plugin='myPlugin' e page='mypage' dal path %>
<%- passData.themeSys.injectPluginCss() %>
<%- passData.themeSys.injectPluginJs() %>

<title>My Page</title>
</head>

<body>
<%# ========== HEADER/NAV TEMA ========== %>
<%- include(passData.themeSys.getThemePartPath('header.ejs')) %>
<%- include(passData.themeSys.getThemePartPath('nav.ejs')) %>

<%# ========== HTML CUSTOM PRIMA ========== %>
<%- passData.themeSys.injectPluginHtmlBefore() %>

<%# ========== CONTENUTO PLUGIN ========== %>
<main class="plugin-page">
  <h1>My Page Content</h1>

  <%# Form POST verso API endpoint %>
  <form action="/api/myPlugin/submit" method="POST">
    <input type="text" name="field" required>
    <button type="submit">Invia</button>
  </form>
</main>

<%# ========== HTML CUSTOM DOPO ========== %>
<%- passData.themeSys.injectPluginHtmlAfter() %>

<%# ========== FOOTER TEMA ========== %>
<%# Include già Bootstrap JS, script globali, plugin hooks, ecc. %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

**Key Points:**
- ✅ Use theme partials (`head.ejs`, `header.ejs`, `footer.ejs`) for layout
- ✅ Call `inject*()` methods **without parameters** (auto-detection)
- ✅ POST endpoints remain in `getRouteArray()` as before
- ✅ Theme customizations injected automatically

### themeSys API for Plugin Pages

**Auto-Injection Methods (NO parameters needed):**

```javascript
// In template: passData.themeSys is a wrapper with methods already bound

// Inject CSS custom del tema
passData.themeSys.injectPluginCss()
// Returns: <style>...</style> or ''

// Inject JS custom del tema
passData.themeSys.injectPluginJs()
// Returns: <script>...</script> or ''

// Inject HTML prima del contenuto
passData.themeSys.injectPluginHtmlBefore()
// Returns: HTML string or ''

// Inject HTML dopo il contenuto
passData.themeSys.injectPluginHtmlAfter()
// Returns: HTML string or ''
```

**How Auto-Detection Works:**

```javascript
// themeSys.extractPluginContext(filePath) extracts:
// /plugins/myPlugin/webPages/mypage.ejs → { pluginName: 'myPlugin', pageName: 'mypage' }
// /pluginPages/myPlugin/mypage.ejs → { pluginName: 'myPlugin', pageName: 'mypage' }

// Then searches for customizations in:
// themes/{activeTheme}/pluginsEndpointsMarkup/myPlugin/mypage/
```

### Theme Customization Structure

**Directory Structure:**

```
themes/myTheme/
└── pluginsEndpointsMarkup/
    └── myPlugin/
        └── mypage/
            ├── template.ejs         ← OPTIONAL: Override complete template
            ├── style.css            ← CSS custom (injected in <head>)
            ├── script.js            ← JS custom (injected in <head>)
            ├── before-content.html  ← HTML before <main>
            └── after-content.html   ← HTML after <main>
```

**Example Customizations:**

**File: `themes/default/pluginsEndpointsMarkup/myPlugin/mypage/style.css`**

```css
/* CSS custom per myPlugin/mypage */
.plugin-page {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 2rem;
}

.plugin-page h1 {
  color: white;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}
```

**File: `themes/default/pluginsEndpointsMarkup/myPlugin/mypage/script.js`**

```javascript
// JS custom per myPlugin/mypage
console.log('myPlugin/mypage - theme customization loaded');

document.addEventListener('DOMContentLoaded', function() {
  // Client-side validation example
  const form = document.querySelector('form');
  if (form) {
    form.addEventListener('submit', function(e) {
      // Custom validation logic
    });
  }
});
```

**File: `themes/default/pluginsEndpointsMarkup/myPlugin/mypage/before-content.html`**

```html
<!-- HTML iniettato prima del <main> -->
<div class="theme-banner">
  <p>🎨 Personalizzato dal tema default</p>
</div>
```

### GET vs POST Separation

**GET Requests:** Served automatically via Plugin Pages System

```
GET /pluginPages/myPlugin/login.ejs → Rendered by koa-classic-server
```

**POST Requests:** Remain in plugin's `getRouteArray()`

```javascript
// In plugins/myPlugin/main.js
getRouteArray() {
  return [
    {
      method: 'post',
      path: '/login',
      handler: async (ctx) => {
        const { username, password } = ctx.request.body;
        // Authentication logic
        ctx.redirect('/dashboard');
      }
    }
  ];
}
```

**URL:** `POST /api/myPlugin/login`

**Pattern:**
- **GET pages:** `/pluginPages/myPlugin/page.ejs` (automatic)
- **POST logic:** `/api/myPlugin/endpoint` (manual in getRouteArray)

### Migration from Old System

**Before (manual endpoint):**

```javascript
// plugins/myPlugin/main.js
getRouteArray() {
  return [
    {
      method: 'get',
      path: '/mypage',
      handler: async (ctx) => {
        const templatePath = path.join(__dirname, 'webPages', 'mypage.ejs');

        // Prepare data
        const data = {
          apiPrefix: ital8Conf.apiPrefix,
          bootstrapCss: '...',
          bootstrapJs: '...',
          customCss: themeSys.getPluginCustomCss(...),
          // ...
        };

        ctx.body = await ejs.renderFile(templatePath, data);
      }
    }
  ];
}
```

**After (automatic):**

```javascript
// NO CODE NEEDED in main.js for GET!

// Template includes theme partials directly
// plugins/myPlugin/webPages/mypage.ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>
<!-- content -->
<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
```

**Benefits:**
- ✅ **Less code:** No manual route handling for GET
- ✅ **Cleaner:** Separation of concerns (logic vs presentation)
- ✅ **Consistent:** Same pattern for all plugin pages
- ✅ **Maintainable:** Theme resources managed in one place

### passData in Plugin Pages

**Available in all plugin page templates:**

```javascript
{
  isAdminContext: false,         // Flag per contesto pubblico
  globalPrefix: '',              // Global prefix (es. '')
  apiPrefix: 'api',              // API prefix
  pluginPagesPrefix: 'pluginPages', // Plugin pages prefix
  pluginSys: pluginSys,          // Plugin system instance
  plugin: {                      // Shared plugin objects
    bootstrap: { ... },
    myPlugin: { ... }
  },
  themeSys: themeSysWrapper,     // Theme system wrapper (methods bound)
  adminSystem: adminSystem,      // Admin system (anche in pagine pubbliche)
  filePath: '/path/to/file.ejs', // Current template path
  href: 'http://...',            // Full request URL
  query: { ... },                // URL query parameters
  ctx: ctx                       // Full Koa context
}
```

**themeSys Wrapper:**

The `themeSys` in passData is a wrapper with methods already bound to passData, eliminating the need to pass passData as a parameter:

```ejs
<%# OLD (if calling underlying methods directly): %>
<%# <%- themeSys.injectPluginCss(passData) %> %>

<%# NEW (wrapper with bound methods): %>
<%- passData.themeSys.injectPluginCss() %>
```

### System Architecture

**Components:**

1. **PluginPagesSystem** (`/core/pluginPagesSystem.js`)
   - Scans plugins for `webPages/` directory
   - Creates/manages symlinks in `/pluginPages/`
   - Provides API for plugin page operations

2. **themeSys Extensions** (`/core/themeSys.js`)
   - `extractPluginContext(filePath)` - Auto-detection
   - `injectPluginCss(passData)` - CSS injection
   - `injectPluginJs(passData)` - JS injection
   - `injectPluginHtmlBefore(passData)` - HTML before
   - `injectPluginHtmlAfter(passData)` - HTML after
   - `getPluginCustomJs()` - Helper for reading JS
   - `getPluginCustomHtml()` - Helper for reading HTML

3. **Wrapper System** (`/index.js`)
   - `createThemeSysWrapper()` - Binds methods to passData
   - Eliminates redundant parameter passing
   - Consistent API across public and admin contexts

**Initialization Flow:**

```
index.js startup
       ↓
PluginSys loads all plugins
       ↓
ThemeSys loads themes
       ↓
PluginPagesSystem.initialize()
  - Scan all active plugins
  - Detect webPages/ directories
  - Create symlinks
       ↓
koa-classic-server configured for /pluginPages/
       ↓
createThemeSysWrapper() creates bound methods
       ↓
Server ready
```

### Debugging

**Check symlinks created:**

```bash
ls -la /path/to/project/pluginPages/
```

**Expected output:**
```
lrwxrwxrwx myPlugin -> /path/to/plugins/myPlugin/webPages/
lrwxrwxrwx anotherPlugin -> /path/to/plugins/anotherPlugin/webPages/
```

**Test page access:**

```bash
curl http://localhost:3000/pluginPages/myPlugin/mypage.ejs
```

**Check logs:**

```
[PluginPagesSystem] Starting initialization...
[PluginPagesSystem] Created symlink: myPlugin → /path/to/plugins/myPlugin/webPages
[PluginPagesSystem] Initialization complete: 6 plugins scanned, 2 symlinks created/verified
✓ Plugin Pages System initialized
[PluginPagesSystem] Plugin pages servite da /pluginPages/ -> /path/to/pluginPages
```

### Best Practices

1. **✅ Use theme partials:** Include `head.ejs`, `header.ejs`, `footer.ejs` from theme
2. **✅ Call inject methods:** Always call `injectPlugin*()` methods for theme customization
3. **✅ Keep GET simple:** Use Plugin Pages System for simple GET pages
4. **✅ Use endpoints for POST:** Keep POST logic in `getRouteArray()`
5. **✅ Semantic class names:** Use `class="plugin-page plugin-{pluginName} page-{pageName}"`
6. **✅ Form actions:** Point to `/api/{pluginName}/{endpoint}` for POST
7. **⚠️ Avoid inline styles:** Use theme CSS customization instead
8. **⚠️ Don't duplicate:** Let theme partials handle global CSS/JS

### Example: Complete Login Page

**File: `plugins/adminUsers/webPages/login.ejs`**

```ejs
<!DOCTYPE html>
<html lang="it">
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>
<%- passData.themeSys.injectPluginJs() %>
<title>Login</title>
</head>

<body>
<%- include(passData.themeSys.getThemePartPath('header.ejs')) %>
<%- passData.themeSys.injectPluginHtmlBefore() %>

<main class="plugin-page plugin-adminUsers page-login">
  <div class="container">
    <h1>Login</h1>

    <% if (passData.query.error) { %>
      <div class="alert alert-danger">Credenziali non valide</div>
    <% } %>

    <form action="/<%= passData.apiPrefix %>/adminUsers/login" method="POST">
      <input type="hidden" name="referrerTo" value="<%= passData.ctx.headers.referer || '/' %>">

      <div class="mb-3">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required>
      </div>

      <div class="mb-3">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
      </div>

      <button type="submit" class="btn btn-primary">Accedi</button>
    </form>
  </div>
</main>

<%- passData.themeSys.injectPluginHtmlAfter() %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

**Accessed at:** `http://localhost:3000/pluginPages/adminUsers/login.ejs`

**Form posts to:** `http://localhost:3000/api/adminUsers/login` (handled by getRouteArray)

### Reference Files

- **Core System:** `/core/pluginPagesSystem.js`
- **Theme Extensions:** `/core/themeSys.js` (lines 874-1064)
- **Integration:** `/index.js` (lines 57-81, 145-185)
- **Configuration:** `/ital8Config.json5` (pluginPagesPrefix)
- **Template Example:** `/docs/examples/pluginPageTemplate.ejs`

## Theme System

### Theme Structure

```
themes/myTheme/
├── views/                    # Reusable partials
│   ├── head.ejs             # HTML head section
│   ├── header.ejs           # Page header
│   ├── nav.ejs              # Navigation
│   ├── main.ejs             # Main content
│   ├── aside.ejs            # Sidebar
│   └── footer.ejs           # Footer + closing tags
├── templates/               # Complete page templates
│   └── page.ejs
├── themeResources/          # Static assets (CSS, JS, images, fonts)
│   ├── css/
│   │   └── theme.css
│   └── js/
│       └── theme.js
├── themeConfig.json5         # Theme configuration (including isAdminTheme flag)
└── themeDescription.json5    # Theme metadata
```

### Theme Configuration

#### In `ital8Config.json5`:

```json
{
  "activeTheme": "placeholderExample",        // Public site theme
  "adminActiveTheme": "defaultAdminTheme",    // Admin panel theme (must have isAdminTheme: true)
  "baseThemePath": "../",                     // Relative path base

  // Theme resources URL prefixes
  "publicThemeResourcesPrefix": "public-theme-resources",
  "adminThemeResourcesPrefix": "admin-theme-resources"
}
```

#### In `themes/myTheme/themeConfig.json5`:

```json
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,

  // IMPORTANT: Specifies if this is an admin theme
  // Public themes: isAdminTheme: false
  // Admin themes: isAdminTheme: true
  "isAdminTheme": false,  // or true for admin themes

  "pluginDependency": {
    "bootstrap": "^1.0.0"
  }
}
```

### Using Theme Partials in EJS

**Unified API - works for both public and admin contexts:**

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('header.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('nav.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('main.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('aside.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs', passData)) %>
```

**The same code works in both public and admin templates!** The system automatically:
- Uses `activeTheme` (public) when `passData.isAdminContext === false`
- Uses `adminActiveTheme` (admin) when `passData.isAdminContext === true`

### Theme Resources (CSS, JS, Images)

```ejs
<!-- Unified API - works for both public and admin contexts -->
<link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css', passData) %>">
<script src="<%= passData.themeSys.getThemeResourceUrl('js/theme.js', passData) %>"></script>
```

**Automatic URL generation:**
- Public context: `/public-theme-resources/css/theme.css`
- Admin context: `/admin-theme-resources/css/theme.css`

### Plugin Hook Integration

Themes call `pluginSys.hookPage()` to allow plugins to inject content:

```ejs
<!-- In head.ejs -->
<%- await pluginSys.hookPage("head", passData) %>

<!-- In header.ejs -->
<%- await pluginSys.hookPage("header", passData) %>

<!-- In footer.ejs -->
<%- await pluginSys.hookPage("script", passData) %>
```

## Admin System Architecture

### Overview

The **Admin System** is a modular architecture that allows plugins to provide admin functionality through a unified, configuration-driven interface. It supports both **plugin-based sections** (dynamically served via symlinks) and **hardcoded sections** (static files in `core/admin/webPages`).

**Key Features:**
- ✅ **Plugin-agnostic design:** Admin UI decoupled from specific plugin implementations
- ✅ **Zero file duplication:** Symlink-based serving (single source of truth)
- ✅ **Service discovery:** Plugins provide backend services (auth, email, storage, etc.)
- ✅ **Dynamic menu generation:** Menu sections built from configuration at runtime
- ✅ **2-phase initialization:** Avoids circular dependencies between PluginSys and AdminSystem

### Architecture Components

**Directory:** `/core/admin/`

| Component | File | Responsibility |
|-----------|------|----------------|
| **AdminSystem** | `adminSystem.js` | Central coordinator, initialization, integration with pluginSys |
| **ConfigManager** | `lib/configManager.js` | Loads and validates `adminConfig.json5` |
| **AdminServicesManager** | `lib/adminServicesManager.js` | Service discovery, maps service names to plugin providers |
| **SymlinkManager** | `lib/symlinkManager.js` | Creates/removes symlinks for plugin-based admin sections |

### Admin Plugin Structure

**CRITICAL NAMING CONVENTION:** Admin plugins **MUST** start with the prefix `admin`.

✅ **Valid names:** `adminUsers`, `adminMailer`, `adminStorage`
❌ **Invalid names:** `usersAdmin`, `adminUsers`, `userManagement`

**Complete admin plugin structure:**

```
plugins/adminUsers/
├── main.js                    # Plugin logic (standard)
├── pluginConfig.json5         # Plugin configuration (with adminSections array)
├── pluginDescription.json5    # Plugin metadata (standard)
├── usersManagment/            # Admin section directory (name = sectionId)
│   ├── index.ejs              # Main section page
│   ├── userView.ejs           # Sub-pages
│   ├── userUpsert.ejs
│   └── userDelete.ejs
├── rolesManagment/            # Second admin section directory
│   └── index.ejs              # Role management page
├── userAccount.json5          # Plugin data files
├── userRole.json5
├── userManagement.js          # Plugin modules
└── roleManagement.js          # Role management module
```

**Important Notes:**
- ❌ **NO** `adminConfig.json5` file in plugin (deprecated)
- ✅ Section IDs declared in `pluginConfig.json5` (`adminSections` array)
- ✅ UI metadata (label, icon, description) in `/core/admin/adminConfig.json5`

### pluginConfig.json5 - Admin Plugin Configuration

**CRITICAL NAMING CONVENTION:** Admin plugins **MUST** start with the prefix `admin`.

✅ **Valid names:** `adminUsers`, `adminMailer`, `adminStorage`
❌ **Invalid names:** `usersAdmin`, `adminUsers`, `userManagement`

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,

  // ℹ️ CONVENZIONE: Plugin con nome che inizia per "admin" sono automaticamente plugin admin
  // Non è necessario alcun flag esplicito (es. isAdminPlugin)

  // Array di ID delle sezioni admin gestite da questo plugin
  // Ogni sezione DEVE avere una directory corrispondente nella root del plugin
  // I metadata UI (label, icon, description) sono centralizzati in /core/admin/adminConfig.json5
  // Es. plugins/adminUsers/usersManagment/ e plugins/adminUsers/rolesManagment/
  "adminSections": [
    "usersManagment",
    "rolesManagment"
  ],

  "dependency": {
    "bootstrap": "^1.0.0"
  },
  "nodeModuleDependency": {
    "bcryptjs": "^3.0.2",
    "ejs": "^3.1.9"
  },
  "custom": {}
}
```

**Required fields for admin plugins:**
- `adminSections` - Array of section IDs (strings) - can be empty if plugin provides no admin UI
- Each section ID MUST:
  - Match a directory name in plugin root
  - Have corresponding metadata in `/core/admin/adminConfig.json5`

**Constraints:**
- `sectionId` must be unique across all admin plugins
- Directory `plugins/{pluginName}/{sectionId}/` MUST exist for each section
- Plugin name MUST start with `admin` prefix
- UI metadata (label, icon, description) MUST be defined in central `adminConfig.json5`

### Central Configuration: adminConfig.json5

**Location:** `/core/admin/adminConfig.json5`

```json5
{
  "version": "1.0.0",

  // Admin sections configuration
  "sections": {
    // PLUGIN-BASED SECTIONS (dynamic, served via symlink)
    "usersManagment": {
      "type": "plugin",
      "plugin": "adminUsers",     // Plugin that manages this section
      "enabled": true,            // Show in menu
      "required": true,           // Error if plugin missing
      "label": "Gestione Utenti", // Text shown in menu
      "icon": "👥",               // Icon (emoji, HTML, or CSS class)
      "description": "Gestione utenti e permessi del sistema"
    },

    "rolesManagment": {
      "type": "plugin",
      "plugin": "adminUsers",
      "enabled": true,
      "required": true,
      "label": "Gestione Ruoli Custom",
      "icon": "🏷️",
      "description": "Creazione e gestione ruoli personalizzati"
    },

    // HARDCODED SECTION (static files in core/admin/webPages)
    "systemSettings": {
      "type": "hardcoded",
      "enabled": true,
      "label": "Impostazioni Sistema",
      "url": "/admin/systemSettings/index.ejs",
      "icon": "⚙️"
    }
  },

  // Menu order (top to bottom)
  "menuOrder": [
    "usersManagment",
    "rolesManagment",
    "systemSettings",
    "pluginsManagment"
  ],

  // Backend services
  "services": {
    "auth": {
      "plugin": "adminUsers",
      "required": true
    }
  },

  // UI configuration
  "ui": {
    "title": "Gestione Admin",
    "welcomeMessage": "Benvenuto nella gestione di Italo8CMS",
    "theme": "defaultAdminTheme"
  }
}
```

### Section Types

**Type: `"plugin"`**
- Managed by external plugin
- Files located in `plugins/{pluginName}/{sectionId}/`
- Served via symlink
- Section IDs declared in plugin's `pluginConfig.json5` (`adminSections` array)
- UI metadata centralized in `/core/admin/adminConfig.json5`

**Fields:**
- `type`: `"plugin"`
- `plugin`: Plugin name
- `enabled`: Show in menu (true/false)
- `required`: Error if plugin missing (true/false)
- `label`: Text shown in menu
- `icon`: Icon (emoji, HTML, or CSS class)
- `description`: Brief description of the section

**Type: `"hardcoded"`**
- Managed directly by core
- Files in `core/admin/webPages/{sectionId}/`
- No symlink needed
- Metadata in central `adminConfig.json5`

**Fields:**
- `type`: `"hardcoded"`
- `enabled`: Show in menu (true/false)
- `label`: Menu text
- `url`: Full URL to section
- `icon`: Icon (emoji/HTML/CSS class)

### Symlink System for Plugin Sections

**Principle:** Zero file duplication, single source of truth.

```
Source (plugin):       plugins/adminUsers/usersManagment/
                              ↓
                        (symlink created)
                              ↓
Destination (served):  core/admin/webPages/usersManagment → (symlink)
                              ↓
                       Served by koa-classic-server
                              ↓
URL:                   /admin/usersManagment/index.ejs
```

**Symlink Creation Workflow:**

1. Plugin admin loaded by `pluginSys`
2. `AdminSystem.initialize()` → `onAdminPluginLoaded(plugin)`
3. `SymlinkManager.installPluginSection(plugin)`:
   - Verify plugin name starts with `'admin'` (automatic detection)
   - Read `adminSections` array from `pluginConfig.json5`
   - For each section ID in the array:
     - Verify directory `plugins/{pluginName}/{sectionId}/` exists
     - Create symlink: `core/admin/webPages/{sectionId} → plugins/{pluginName}/{sectionId}/`

**Symlink Removal:**
- Plugin uninstalled: `SymlinkManager.uninstallPluginSection(plugin)`
- Plugin disabled (`active: 0`): Symlink remains, but section hidden from menu

**Conflict Handling:**
- Symlink exists → Same target: OK, skip | Different target: ERROR
- Non-symlink directory exists → ERROR (possible hardcoded section conflict)

### Service Discovery System

**What is a Service?**
A service is a backend functionality provided by a plugin that can be used by other components.

**Examples:**
- `auth` - Authentication and authorization
- `email` - Email sending
- `storage` - File storage
- `cache` - Caching layer
- `analytics` - Analytics tracking

**Service Configuration:**

In `core/admin/adminConfig.json5`:
```json5
"services": {
  "auth": {
    "plugin": "adminUsers",
    "required": true
  },
  "email": {
    "plugin": "adminMailer",
    "required": false
  }
}
```

**Using Services:**

```javascript
// Get service plugin
const authPlugin = adminSystem.getService('auth');

// Get endpoints for passData (in EJS templates)
const endpoints = adminSystem.getEndpointsForPassData();
```

### 2-Phase Initialization (Avoiding Circular Dependencies)

**Problem:**
```
PluginSys → needs AdminSystem → needs PluginSys → CIRCULAR!
```

**Solution:** Dependency Injection with 2-phase init

**In `index.js`:**

```javascript
// Phase 1: Create PluginSys (loads all plugins)
const pluginSys = new PluginSys();

// Phase 2: Create ThemeSys
const themeSys = new ThemeSys(ital8Conf, pluginSys);

// Phase 3: Create AdminSystem (without pluginSys in constructor)
let adminSystem = null;
if (ital8Conf.enableAdmin) {
  const AdminSystem = require('./core/admin/adminSystem');
  adminSystem = new AdminSystem(themeSys);

  // Phase 4: Link dependencies (dependency injection)
  adminSystem.setPluginSys(pluginSys);
  pluginSys.setAdminSystem(adminSystem);

  // Phase 5: Initialize AdminSystem
  adminSystem.initialize();
}
```

**Detailed sequence:**

1. `PluginSys` constructor → Loads all plugins (including admin plugins)
2. `ThemeSys` constructor → Loads themes
3. `AdminSystem` constructor → Creates ConfigManager, ServicesManager, SymlinkManager
4. `adminSystem.setPluginSys()` → Links PluginSys
5. `pluginSys.setAdminSystem()` → Links AdminSystem
6. `adminSystem.initialize()`:
   - Validates existing symlinks
   - For each admin plugin:
     - `symlinkManager.installPluginSection()` (creates symlink)
     - `servicesManager.registerPlugin()` (registers services)
   - `servicesManager.loadServices()` (loads services from config)

### Dynamic Menu Generation

**In `core/admin/webPages/index.ejs`:**

```ejs
<%
  // Get admin UI config and menu sections
  const adminUI = passData.adminSystem.getUI();
  const menuSections = passData.adminSystem.getMenuSections();
%>

<!-- Header -->
<a href="/<%= passData.adminPrefix %>/">
    <%= adminUI.title %>
</a>

<!-- Dynamic sections -->
<% menuSections.forEach(section => { %>
    <a href="<%= section.url %>">
        <%= section.icon %> <%= section.label %>
        <% if (section.type === 'plugin') { %>
            <span class="badge">Plugin: <%= section.plugin %></span>
        <% } else { %>
            <span class="badge">Integrato</span>
        <% } %>
    </a>
<% }); %>
```

**`getMenuSections()` returns:**
```javascript
[
  {
    id: "usersManagment",
    label: "Gestione Utenti",
    icon: "👥",
    url: "/admin/usersManagment/index.ejs",
    type: "plugin",
    plugin: "adminUsers"
  },
  {
    id: "systemSettings",
    label: "Impostazioni Sistema",
    icon: "⚙️",
    url: "/admin/systemSettings/index.ejs",
    type: "hardcoded"
  }
]
```

**Filtering logic:**
- Skip if `enabled: false`
- Skip if plugin type and plugin not active
- Return only sections that should appear in menu

### AdminSystem API

Available in `passData.adminSystem`:

```javascript
// UI configuration
adminSystem.getUI()
// Returns: { title, welcomeMessage, theme }

// Menu sections (filtered by enabled and active status)
adminSystem.getMenuSections()
// Returns: [{ id, label, icon, url, type, plugin }]

// Get service by name
adminSystem.getService('auth')
// Returns: plugin object providing the service

// Get API endpoints for EJS templates
adminSystem.getEndpointsForPassData()
// Returns: { serviceName: { endpoint1, endpoint2, ... } }
```

### Creating an Admin Plugin - Checklist

✅ **Step 1: Create plugin structure with "admin" prefix**
```bash
# IMPORTANT: Plugin name MUST start with "admin"
mkdir -p plugins/admin{Feature}/{sectionId}
```

✅ **Step 2: Create required files**
- [ ] `main.js` with `loadPlugin()`, `getRouteArray()`, etc.
- [ ] `pluginConfig.json5` with `adminSections` array
- [ ] `pluginDescription.json5`
- [ ] `{sectionId}/index.ejs` (section directory with EJS files)

✅ **Step 3: Configure `pluginConfig.json5`**
```json5
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,

  // ℹ️ CONVENZIONE: Plugin con nome che inizia per "admin" sono automaticamente plugin admin
  // Array di ID delle sezioni admin gestite da questo plugin
  "adminSections": [
    "mySection"
    // Add more section IDs if needed
  ],

  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

✅ **Step 4: Register sections in central config**

Edit `/core/admin/adminConfig.json5`:
```json5
"sections": {
  "mySection": {
    "type": "plugin",
    "plugin": "admin{Feature}",
    "enabled": true,
    "required": false,
    "label": "My Section",       // Text shown in menu
    "icon": "🎯",                // Icon (emoji, HTML, or CSS class)
    "description": "Description of my section"
  }
},
"menuOrder": [..., "mySection"]
```

✅ **Step 5: Restart server**
- Symlinks created automatically for each section in adminSections array
- Sections appear in menu
- Accessible at `/admin/{sectionId}/index.ejs`

## Data Storage Strategy

### Core Philosophy: File-Based, Database-Free

**ital8cms does NOT require any database management system (DBMS) to function.** The core system is designed to work entirely with JSON files for structured data and file-based storage for content.

### Primary Storage: JSON Files

**Structured Data Storage:**
- **User accounts:** `/plugins/adminUsers/userAccount.json5`
- **User roles:** `/plugins/adminUsers/userRole.json5`
- **Plugin configurations:** Each plugin has `pluginConfig.json5`
- **Application settings:** `ital8Config.json5`
- **Admin configuration:** `/core/admin/adminConfig.json5`

**Why JSON?**
- ✅ Zero dependencies - no database installation required
- ✅ Simple deployment - just copy files
- ✅ Easy backup - standard file system operations
- ✅ Human-readable - can be edited manually if needed
- ✅ Version control friendly - Git can track changes
- ✅ Perfect for small to medium data sets

### Content Storage: File-Based

**Web Pages:**
- **Templates:** EJS files in `/www` and `/themes`
- **Static content:** HTML, CSS, JavaScript served directly
- **Admin pages:** EJS files in `/core/admin/webPages`

**Media Files:**
- Managed by media plugin
- Stored as files in plugin-specific directories

### Optional: Database via Plugins

**When you need a database:**
Databases like SQLite can be added through plugins when you need:
- Complex queries with JOINs
- Full-text search
- Relational data with many relationships
- Large datasets requiring indexing
- ACID transactions

**dbApi Plugin (currently disabled):**

The `dbApi` plugin provides SQLite integration:

```javascript
// Enable in plugins/dbApi/pluginConfig.json5
{
  "active": 1,  // Set to 1 to enable
  "nodeModuleDependency": {
    "better-sqlite3": "^9.2.2"
  }
}
```

Then install the dependency:
```bash
npm install better-sqlite3
```

**Database location when enabled:**
```
plugins/dbApi/dbFile/
├── mainDb.db              # Main application database
├── webDb.db               # Web-shared data (available in templates)
└── pluginsDb/             # Per-plugin databases
    ├── admin.db
    ├── media.db
    └── ...
```

**Accessing database in plugins (when dbApi is active):**

```javascript
async loadPlugin(pluginSys, pathPluginFolder) {
  const dbApi = pluginSys.getSharedObject('dbApi')
  if (dbApi) {
    this.db = dbApi.db  // SQLite database available
  }
}
```

### JSON5 File Operations

**IMPORTANT:** All configuration files use the `.json5` extension and **MUST** be loaded using the `loadJson5()` function, not `require()` or `JSON.parse()`.

**Reading JSON5 data:**
```javascript
const path = require('path')
const loadJson5 = require('../../core/loadJson5')

// Read user accounts using loadJson5
const userAccountPath = path.join(pathPluginFolder, 'userAccount.json5')
const users = loadJson5(userAccountPath)
```

**Writing JSON5 data:**
```javascript
const fs = require('fs')

// Update user accounts
fs.writeFileSync(
  userAccountPath,
  JSON.stringify(users, null, 2),
  'utf8'
)
```

**Atomic writes (safer):**
```javascript
// Write to temp file first, then rename (atomic operation)
const tempPath = userAccountPath + '.tmp'
fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), 'utf8')
fs.renameSync(tempPath, userAccountPath)
```

## Authentication & Authorization

### Authentication System (adminUsers plugin)

**Login Flow:**
1. User submits username/password to `/api/adminUsers/login` (POST)
2. Plugin validates credentials against `userAccount.json5`
3. Password verified with bcryptjs
4. Session created: `ctx.session.authenticated = true`, `ctx.session.user = userData`
5. Session cookie sent to client

**Logout Flow:**
1. User accesses `/api/adminUsers/logout` (POST)
2. Session destroyed: `ctx.session = null`

**Session Management:**
- Signed cookies with secret keys
- Max age: 24 hours (86400000ms)
- Configuration: `/core/priorityMiddlewares/koaSession.json5`

### Authorization System (Multi-Role RBAC)

**Multi-Role Architecture:**
- Users can have **multiple roles** simultaneously via `roleIds` array
- Roles are checked using `roleIds.includes(roleId)` logic
- Example: A user can be both `admin` (1) and have custom roles

**Hardcoded System Roles (0-99):**
- **0 (root):** Full system access, including critical operations
- **1 (admin):** Full access to all admin resources
- **2 (editor):** Create, read, update, delete ALL content (including other users' content)
- **3 (selfEditor):** Create, read, update, delete ONLY OWN content

**Custom Roles (100+):**
- User-defined roles created through admin panel
- Managed via `/admin/rolesManagment/`
- Auto-increment ID starting at 100
- Can be assigned/removed from users dynamically

**Role Data Structure:**
Located in `/plugins/adminUsers/userRole.json5`
```json5
{
  "roles": {
    "0": { "name": "root", "description": "...", "isHardcoded": true },
    "1": { "name": "admin", "description": "...", "isHardcoded": true },
    "100": { "name": "contentModerator", "description": "...", "isHardcoded": false }
  }
}
```

**User Data Structure:**
Located in `/plugins/adminUsers/userAccount.json5`
```json5
{
  "username": {
    "email": "user@example.com",
    "hashPassword": "$2b$10$...",
    "roleIds": [1, 100]  // Array of role IDs
  }
}
```

### Access Control Middleware

Protected URL prefixes:
- `/reserved` - Requires authentication
- `/private` - Requires authentication
- `/lib` - Requires authentication

Returns 401 Unauthorized if not logged in.

### Checking Authentication in Code

```javascript
// In route handler
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}

// Access user data
const username = ctx.session.user.username
const roleIds = ctx.session.user.roleIds  // Array of role IDs

// Check if user has specific role
if (roleIds.includes(0)) {
  // User has root role
}

if (roleIds.includes(1)) {
  // User has admin role
}

// Check if user has ANY of specified roles
const hasAdminAccess = roleIds.some(id => [0, 1].includes(id))
```

### Checking Authentication in Templates

```ejs
<% if (passData.ctx.session.authenticated) { %>
  <p>Welcome, <%= passData.ctx.session.user.username %>!</p>
<% } else { %>
  <p><a href="/api/adminUsers/login">Login</a></p>
<% } %>
```

## API Route Patterns

### Standard API Routes

All plugin routes are prefixed: `/api/{pluginName}/...`

### AdminUsers Plugin Routes

**Authentication:**
```
GET  /api/adminUsers/login         # Display login form
POST /api/adminUsers/login         # Authenticate user
GET  /api/adminUsers/logout        # Display logout confirmation
POST /api/adminUsers/logout        # End session
GET  /api/adminUsers/logged        # Check login status (JSON)
```

**User Management:**
```
GET  /api/adminUsers/userList      # List all users (protected)
GET  /api/adminUsers/userInfo      # Get user details (protected)
POST /api/adminUsers/usertUser     # Create/update user (protected)
```

**Role Management:**
```
GET  /api/adminUsers/roleList           # List all roles (hardcoded + custom)
GET  /api/adminUsers/customRoleList     # List only custom roles
GET  /api/adminUsers/hardcodedRoleList  # List only hardcoded roles
POST /api/adminUsers/createCustomRole   # Create new custom role
POST /api/adminUsers/updateCustomRole   # Update existing custom role
POST /api/adminUsers/deleteCustomRole   # Delete custom role (removes from users)
```

### Bootstrap Plugin Routes

```
GET /api/bootstrap/css/bootstrap.min.css
GET /api/bootstrap/css/bootstrap.min.css.map
GET /api/bootstrap/js/bootstrap.min.js
GET /api/bootstrap/js/bootstrap.min.js.map
```

### Creating New Routes

1. Add route definition in plugin's `getRouteArray()`:

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'get',
      path: '/my-endpoint',
      func: async (ctx) => {
        ctx.body = { message: 'Hello' }
      }
    },
    {
      method: 'post',
      path: '/create-item',
      func: async (ctx) => {
        const data = ctx.request.body
        // Process data
        ctx.body = { success: true }
      }
    }
  ]
}
```

2. Route becomes available at: `/api/yourPlugin/my-endpoint`

## Configuration Management

### Main Configuration: ital8Config.json5

```json
{
  "apiPrefix": "api",                 // API route prefix (change if needed)
  "adminPrefix": "admin",             // Admin panel path
  "enableAdmin": true,                // Enable/disable admin panel
  "viewsPrefix": "views",             // Views route prefix
  "baseThemePath": "../",             // Theme path base
  "activeTheme": "default",           // Public theme
  "adminActiveTheme": "default",      // Admin theme
  "wwwPath": "/www",                  // Public web root
  "debugMode": 1,                     // Debug level (0=off, 1=on)
  "httpPort": 3000,                   // HTTP port
  "useHttps": false,                  // Enable HTTPS
  "httpsPort": "",                    // HTTPS port
  "AutoRedirectHttpPortToHttpsPort": false
}
```

### Session Configuration: core/priorityMiddlewares/koaSession.json5

**IMPORTANT:** Change session keys in production!

```json
{
  "keys": [
    "key.segretussimmmmmm",           // PRIMARY: Change this!
    "key.secondaryKey123"             // SECONDARY: Change this!
  ],
  "CONFIG": {
    "key": "koa:sess",
    "maxAge": 86400000,               // 24 hours
    "autoCommit": true,
    "overwrite": true,
    "httpOnly": true,
    "signed": true,
    "rolling": false,
    "renew": false
  }
}
```

### Plugin-Specific Configuration

Each plugin's `pluginConfig.json5`:

```json
{
  "custom": {
    "myPluginSetting": "value",
    "featureEnabled": true,
    "maxItems": 100
  }
}
```

Access in code:

```javascript
const loadJson5 = require('../../core/loadJson5')
const path = require('path')
const config = loadJson5(path.join(__dirname, 'pluginConfig.json5'))
const mySetting = config.custom.myPluginSetting
```

## passData Object Reference

The `passData` object is available in all EJS templates and contains:

```javascript
{
  apiPrefix: "api",              // API route prefix
  adminPrefix: "admin",          // Admin path (only in admin pages)
  pluginSys: pluginSys,          // Plugin system instance
  plugin: {                      // Plugin shared objects
    dbApi: { db: ... },
    adminUsers: { ... },
    // ... other plugins
  },
  themeSys: themeSys,            // Theme system instance
  filePath: "/path/to/file.ejs", // Current template path
  href: "http://...",            // Full request URL
  query: { ... },                // URL query parameters
  ctx: ctx                       // Full Koa context
}
```

### Common passData Usage

```ejs
<!-- Access plugin shared objects -->
<% const db = passData.plugin.dbApi.db %>

<!-- Check authentication -->
<% if (passData.ctx.session.authenticated) { %>
  <!-- Authenticated content -->
<% } %>

<!-- Access query parameters -->
<% const page = passData.query.page || 1 %>

<!-- Get current URL -->
<p>Current URL: <%= passData.href %></p>

<!-- Call plugin hooks -->
<%- await passData.pluginSys.hookPage('header', passData) %>
```

## Development Workflows

### Starting Development

```bash
npm install        # Install dependencies
npm start          # Start with auto-reload (nodemon)
```

Server runs on: `http://localhost:3000`

### Creating a New Plugin

1. **Create plugin directory:**
```bash
mkdir plugins/myPlugin
```

2. **Create main.js:**
```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    console.log('MyPlugin loaded!')
  },

  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'get',
        path: '/hello',
        func: async (ctx) => {
          ctx.body = 'Hello from myPlugin!'
        }
      }
    ]
  }
}
```

3. **Create pluginConfig.json5:**
```json
{
  "active": 1,
  "isInstalled": 0,
  "weight": 100,
  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

4. **Create pluginDescription.json5:**
```json
{
  "name": "myPlugin",
  "version": "1.0.0",
  "description": "My new plugin",
  "author": "Your Name",
  "email": "your@email.com",
  "license": "MIT"
}
```

5. **Restart server** - Plugin will auto-load

6. **Access route:** `http://localhost:3000/api/myPlugin/hello`

---

### Creating a Plugin with Web Pages (Recommended Structure)

If your plugin needs to serve HTML pages (not just JSON APIs), follow this **strongly recommended** structure using the `webPages/` directory convention.

**1. Create plugin with webPages directory:**
```bash
mkdir -p plugins/myWebPlugin/webPages
```

**2. Create main.js with template rendering:**
```javascript
const path = require('path');
const ejs = require('ejs');

let myPluginSys = null;

module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    myPluginSys = pluginSys; // Store reference for themeSys access
    console.log('MyWebPlugin loaded!');
  },

  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'get',
        path: '/mypage',
        func: async (ctx) => {
          // ⭐ Default template in webPages/ directory (RECOMMENDED)
          const defaultTemplate = path.join(__dirname, 'webPages', 'mypage.ejs');

          // Check for theme customization (optional but recommended)
          let templatePath = defaultTemplate;
          let customCss = '';

          if (myPluginSys) {
            const themeSys = myPluginSys.getThemeSys();
            if (themeSys) {
              // Allow theme to override template
              templatePath = themeSys.resolvePluginTemplatePath(
                'myWebPlugin',
                'mypage',
                defaultTemplate,
                'template.ejs'
              );
              // Load custom CSS from theme
              customCss = themeSys.getPluginCustomCss('myWebPlugin', 'mypage');
            }
          }

          // Prepare data for template
          const data = {
            message: 'Hello from template!',
            customCss, // Pass custom CSS for inline inclusion
            timestamp: new Date().toISOString()
          };

          // Render and return HTML
          ctx.body = await ejs.renderFile(templatePath, data);
          ctx.set('Content-Type', 'text/html');
        }
      }
    ];
  }
};
```

**3. Create EJS template in webPages/:**

Create `plugins/myWebPlugin/webPages/mypage.ejs`:
```ejs
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Page</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 2rem;
    }
    /* Include custom CSS from theme (if exists) */
    <%- customCss || '' %>
  </style>
</head>
<body>
  <h1><%= message %></h1>
  <p>Page rendered at: <%= timestamp %></p>
</body>
</html>
```

**4. Create pluginConfig.json5:**
```json5
{
  "active": 1,
  "isInstalled": 0,
  "weight": 100,
  "dependency": {},
  "nodeModuleDependency": {
    "ejs": "^3.1.9"  // Required for template rendering
  },
  "custom": {}
}
```

**5. Create pluginDescription.json5:**
```json5
{
  "name": "myWebPlugin",
  "version": "1.0.0",
  "description": "Plugin that serves web pages",
  "author": "Your Name",
  "email": "your@email.com",
  "license": "MIT"
}
```

**6. Final directory structure:**
```
plugins/myWebPlugin/
├── main.js                    # Plugin logic (required)
├── pluginConfig.json5          # Configuration (required)
├── pluginDescription.json5     # Metadata (required)
└── webPages/                  # ⭐ STRONGLY RECOMMENDED
    ├── mypage.ejs             # Template 1
    ├── profile.ejs            # Template 2
    └── settings.ejs           # Template 3
```

**7. Restart server and access:**
- URL: `http://localhost:3000/api/myWebPlugin/mypage`

**Why this structure is strongly recommended:**

| Benefit | Description |
|---------|-------------|
| **Organization** | Clear separation between logic (main.js) and presentation (webPages/) |
| **Consistency** | Follows the pattern used in `adminUsers` plugin (official reference) |
| **Maintainability** | Easy to locate and manage all templates in one directory |
| **Scalability** | As your plugin grows, templates remain organized |
| **Theme Support** | Easier integration with themeSys customization features |
| **Best Practice** | Recognized convention across the ital8cms ecosystem |

**Note:** This is a **convention, not a strict requirement**. You can organize your plugin differently, but using `webPages/` is strongly encouraged for plugins that serve HTML pages. Plugins serving only JSON APIs (like `simpleI18n`, `bootstrap`) don't need this directory.

---

### Creating a New Theme

1. **Copy default theme:**
```bash
cp -r themes/default themes/myTheme
```

2. **Modify theme files** in `themes/myTheme/views/`

3. **Activate theme** in `ital8Config.json5`:
```json
{
  "activeTheme": "myTheme"
}
```

4. **Restart server**

### Adding Admin Pages

1. **Create EJS file** in `/core/admin/webPages/`:
```bash
mkdir -p core/admin/webPages/myFeature
```

2. **Create page** at `core/admin/webPages/myFeature/index.ejs`:
```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('header.ejs', passData)) %>

<main>
  <h1>My Feature</h1>
  <!-- Your content -->
</main>

<%- include(passData.themeSys.getThemePartPath('footer.ejs', passData)) %>
```

**Note:** The same `getThemePartPath()` method works for admin pages because `passData.isAdminContext === true` automatically loads the admin theme partials.

3. **Access:** `http://localhost:3000/admin/myFeature/`

### User Management

**Access admin panel:**
- URL: `http://localhost:3000/admin`
- Login required (use adminUsers plugin)

**User management interface:**
- `http://localhost:3000/admin/usersManagment/`
- List users, add, edit, delete
- Manage custom roles at `http://localhost:3000/admin/rolesManagment/`

**Default users** (check `plugins/adminUsers/userAccount.json5`):
```json5
{
  "username": {
    "password": "$2a$10$hashedPassword",
    "email": "user@example.com",
    "roleIds": [0]  // Array of role IDs (supports multiple roles)
  }
}
```

### Data Operations

**Primary Method: JSON5 Files**

```javascript
const fs = require('fs')
const path = require('path')
const loadJson5 = require('../../core/loadJson5')

// Read JSON5 data
const dataPath = path.join(pathPluginFolder, 'data.json5')
const data = loadJson5(dataPath)

// Modify data
data.items.push({ name: 'New Item', created_at: new Date().toISOString() })

// Save JSON5 data (atomic write)
const tempPath = dataPath + '.tmp'
fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8')
fs.renameSync(tempPath, dataPath)

// Query data (using native JavaScript)
const item = data.items.find(item => item.id === 1)
const filteredItems = data.items.filter(item => item.name.includes('search'))
```

**Optional: Database Operations (requires dbApi plugin)**

```javascript
// Check if dbApi plugin is active
const dbApi = pluginSys.getSharedObject('dbApi')
if (!dbApi) {
  console.log('dbApi plugin not available, using JSON storage')
  return
}

const db = dbApi.db

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

// Insert data
const insert = db.prepare('INSERT INTO items (name) VALUES (?)')
insert.run('Item 1')

// Query data
const stmt = db.prepare('SELECT * FROM items')
const items = stmt.all()

// Query with parameters
const item = db.prepare('SELECT * FROM items WHERE id = ?').get(1)
```

## Code Conventions & Best Practices

### Naming Conventions

- **Variables/Functions:** camelCase (`myVariable`, `myFunction`)
- **Classes:** PascalCase (`PluginSystem`, `ThemeSystem`)
- **Files/Directories:** camelCase (`myPlugin`, `userManagement`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_ITEMS`, `API_PREFIX`)

#### Compound File Names Convention

For files with multiple semantic parts, follow the **natural English word order** (noun + descriptor):

**Pattern:** `{primaryNoun}{descriptor}.{extension}`

**Examples:**
```
✅ CORRECT:
pluginConfig.json5          // "plugin configuration" - natural order
pluginDescription.json5     // "plugin description" - natural order
userAccount.json5           // "user account" - natural order
sessionManager.js          // "session manager" - natural order
ital8Config.json5           // "ital8 configuration" - natural order

❌ INCORRECT:
configPlugin.json          // "configuration plugin" - unnatural
descriptionPlugin.json     // "description plugin" - unnatural
accountUser.json           // "account user" - unnatural
managerSession.js          // "manager session" - unnatural
```

**Why this convention:**
- ✅ Follows natural English semantics ("plugin config" not "config plugin")
- ✅ Groups related files alphabetically (all plugin files together)
- ✅ Matches modern JavaScript naming patterns (`package.json`, `tsconfig.json`)
- ✅ More readable and intuitive for developers

#### Meaningful and Intuitive Names

**CRITICAL REQUIREMENT:** Every name in the codebase (variables, functions, files, directories, classes, constants, etc.) MUST be chosen with care and have a symbolic meaning that is as intuitive as possible.

**Process for Adding New Names:**

1. **Never use placeholder names** like `temp`, `data`, `obj`, `thing`, etc. unless they truly represent temporary or generic concepts
2. **Always propose alternatives** before implementing:
   - When you need to introduce a new name, **ALWAYS propose at least 2-3 meaningful alternatives** (or more when appropriate) to the project maintainer
   - For simple cases: 2-3 alternatives are usually sufficient
   - For complex or critical naming: propose 4-5+ alternatives to provide more choice
   - Provide a brief explanation of what each alternative represents
   - Wait for the maintainer's choice before proceeding with implementation
3. **Only after approval** should you continue writing the code with the chosen name

**Examples:**

```javascript
// ❌ BAD - Generic, unclear names
let data = getUserInfo()
function processData(obj) { ... }
const temp = calculateValue()

// ✅ GOOD - Descriptive, meaningful names
let userProfile = getUserInfo()
function validateUserCredentials(credentials) { ... }
const monthlyRevenue = calculateValue()
```

**Why this matters:**
- ✅ **Readability:** Code becomes self-documenting
- ✅ **Maintainability:** Easier to understand intent months later
- ✅ **Collaboration:** Other developers immediately understand purpose
- ✅ **Debugging:** Clear names make tracing issues much easier
- ✅ **Searchability:** Meaningful names are easier to find in the codebase

**When proposing alternatives:**

Before creating:
- A new plugin: propose plugin names (e.g., `userAuth`, `simpleLogin`, `accessControl`)
- A new variable: propose variable names (e.g., `userSession`, `activeUser`, `currentAccount`)
- A new file: propose file names (e.g., `sessionManager.js`, `authHandler.js`, `userValidator.js`)
- A new function: propose function names (e.g., `validateUserEmail()`, `checkEmailFormat()`, `verifyEmailAddress()`)

**Format for proposals:**

When proposing names to the maintainer, use this format:

```
I need to create [what you're naming]. Here are my suggestions:

Option 1: [name1] - [brief explanation]
Option 2: [name2] - [brief explanation]
Option 3: [name3] - [brief explanation]
[Option 4, 5, etc. - add more alternatives when appropriate for complex cases]

Which would you prefer, or would you like to suggest a different name?
```

### JavaScript Patterns

- **Module System:** CommonJS (`require`, `module.exports`)
- **Async:** Always use `async/await`, never callbacks
- **Middleware:** `async (ctx, next) => { await next() }`

### File Organization

- **Core logic:** `/core` directory
- **Extensions:** `/plugins` directory (self-contained)
- **UI:** `/themes` directory (composable)
- **Public:** `/www` directory (static + EJS)

### Comments

- Many comments are in Italian (author's native language)
- API and variable names are in English
- When adding comments, prefer English for international collaboration
- Document complex logic thoroughly

### Error Handling

```javascript
// Good: Try-catch for database operations
try {
  const result = db.prepare('SELECT * FROM items').all()
  ctx.body = result
} catch (error) {
  console.error('Database error:', error)
  ctx.status = 500
  ctx.body = { error: 'Internal server error' }
}

// Good: Validation
if (!username || !password) {
  ctx.status = 400
  ctx.body = { error: 'Username and password required' }
  return
}
```

### Security Best Practices

1. **Passwords:** Always use bcrypt hashing
```javascript
const bcrypt = require('bcryptjs')
const hashedPassword = await bcrypt.hash(password, 10)
const isValid = await bcrypt.compare(password, hashedPassword)
```

2. **Sessions:** Change default session keys in production

3. **Input Validation:** Validate all user input
```javascript
// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) {
  return { error: 'Invalid email format' }
}

// Username validation
if (!/^[a-zA-Z0-9_-]{3,}$/.test(username)) {
  return { error: 'Invalid username' }
}
```

4. **SQL Injection:** Use prepared statements
```javascript
// Good
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)

// Bad - vulnerable to SQL injection
const user = db.prepare(`SELECT * FROM users WHERE id = ${userId}`).get()
```

5. **Protected Routes:** Check authentication
```javascript
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}
```

## Common Tasks

### Task: Add a New API Endpoint

```javascript
// In plugins/myPlugin/main.js
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'post',
      path: '/create-item',
      func: async (ctx) => {
        // Get request body
        const { name, description } = ctx.request.body

        // Validate
        if (!name) {
          ctx.status = 400
          ctx.body = { error: 'Name required' }
          return
        }

        // Process
        const db = pluginSys.getSharedObject('dbApi').db
        const stmt = db.prepare('INSERT INTO items (name, description) VALUES (?, ?)')
        const result = stmt.run(name, description)

        // Respond
        ctx.body = {
          success: true,
          id: result.lastInsertRowid
        }
      }
    }
  ]
}
```

### Task: Add Content to Every Page

```javascript
// In your plugin's main.js
getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  if (section === 'header') {
    // Check if user is logged in
    if (passData.ctx.session.authenticated) {
      const username = passData.ctx.session.user.username
      return `<div class="user-info">Logged in as: ${username}</div>`
    }
  }
  return ''
}
```

### Task: Initialize Plugin Data Storage

**Option 1: JSON5 File (Recommended for most plugins)**

```javascript
// In your plugin's loadPlugin() or installPlugin()
async loadPlugin(pluginSys, pathPluginFolder) {
  const fs = require('fs')
  const path = require('path')
  const loadJson5 = require('../../core/loadJson5')

  // Define data file path
  this.dataPath = path.join(pathPluginFolder, 'data.json5')

  // Initialize with default data if file doesn't exist
  if (!fs.existsSync(this.dataPath)) {
    const defaultData = {
      items: [],
      settings: {
        created_at: new Date().toISOString()
      }
    }
    fs.writeFileSync(
      this.dataPath,
      JSON.stringify(defaultData, null, 2),
      'utf8'
    )
  }

  // Load data using loadJson5
  this.data = loadJson5(this.dataPath)
}

// Helper method to save data
saveData() {
  const tempPath = this.dataPath + '.tmp'
  fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8')
  fs.renameSync(tempPath, this.dataPath)
}
```

**Option 2: SQLite Database (Only when needed)**

```javascript
// Only if dbApi plugin is active
async loadPlugin(pluginSys, pathPluginFolder) {
  const dbApi = pluginSys.getSharedObject('dbApi')
  if (!dbApi) {
    console.log('dbApi not available, consider using JSON storage')
    return
  }

  const db = dbApi.db

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS my_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create index
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_my_table_name
    ON my_table(name)
  `)
}
```

### Task: Add Middleware

```javascript
// In your plugin's main.js
getMiddlewareToAdd(pluginSys, pathPluginFolder) {
  return [
    {
      func: async (ctx, next) => {
        // Log all requests
        console.log(`${ctx.method} ${ctx.url}`)
        await next()
      }
    },
    {
      func: async (ctx, next) => {
        // Add custom header
        ctx.set('X-Powered-By', 'ital8cms')
        await next()
      }
    }
  ]
}
```

### Task: Share Data Between Plugins

```javascript
// Provider plugin (e.g., myDataPlugin)
module.exports = {
  data: { items: [] },

  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    return {
      data: this.data,
      addItem: (item) => this.data.items.push(item),
      getItems: () => this.data.items
    }
  }
}

// Consumer plugin
module.exports = {
  myDataApi: null,

  setSharedObject(fromPlugin, sharedObject) {
    if (fromPlugin === 'myDataPlugin') {
      this.myDataApi = sharedObject
    }
  },

  async loadPlugin(pluginSys, pathPluginFolder) {
    // Use shared API
    this.myDataApi.addItem({ name: 'Test' })
    const items = this.myDataApi.getItems()
  }
}
```

## Testing Strategy

**Current Status:** No formal testing framework configured.

### Recommendations for Testing

1. **Add Jest or Mocha:**
```bash
npm install --save-dev jest
```

2. **Create test directory:**
```
tests/
├── unit/
│   ├── plugins/
│   └── core/
└── integration/
    └── api/
```

3. **Write tests for:**
- Plugin loading and dependency resolution
- Authentication flows
- API endpoints
- Database operations
- Theme rendering

4. **Update package.json:**
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

## Deployment Guidelines

### Pre-Production Checklist

- [ ] Change session keys in `core/priorityMiddlewares/koaSession.json5`
- [ ] Set appropriate `httpPort` or enable HTTPS
- [ ] Review and secure admin path (`adminPrefix`)
- [ ] Enable authentication for admin routes
- [ ] Set `debugMode: 0` in production
- [ ] Review user roles and permissions
- [ ] Backup database files
- [ ] Set up proper logging
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up SSL certificates if using HTTPS

### Production Deployment

1. **Install dependencies:**
```bash
npm install --production
```

2. **Run application:**
```bash
node index.js
```

3. **Use process manager (recommended):**
```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start index.js --name ital8cms

# Auto-restart on reboot
pm2 startup
pm2 save
```

4. **Reverse proxy (nginx example):**
```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

### Environment-Based Configuration

**Future Enhancement:** Consider using environment variables:

```javascript
// Load from .env file
const httpPort = process.env.HTTP_PORT || 3000
const debugMode = process.env.DEBUG_MODE === 'true' ? 1 : 0
```

## Important Files Reference

### Configuration Files

- `/ital8Config.json5` - Main application configuration
- `/core/admin/adminConfig.json5` - Admin system configuration
- `/core/priorityMiddlewares/koaSession.json5` - Session configuration
- `/plugins/*/pluginConfig.json5` - Per-plugin configuration
- `/plugins/*/pluginDescription.json5` - Plugin metadata
- `/plugins/*/adminConfig.json5` - Admin plugin section metadata (for admin plugins)

### Entry Points

- `/index.js` - Application bootstrap
- `/core/pluginSys.js` - Plugin system manager
- `/core/themeSys.js` - Theme system manager
- `/core/admin/adminSystem.js` - Admin system coordinator
- `/core/loadJson5.js` - JSON5 file loader utility

### Admin System

- `/core/admin/adminConfig.json5` - Central admin configuration
- `/core/admin/adminSystem.js` - Admin coordinator
- `/core/admin/lib/configManager.js` - Config loader & validator
- `/core/admin/lib/adminServicesManager.js` - Service discovery
- `/core/admin/lib/symlinkManager.js` - Symlink manager
- `/core/admin/webPages/index.ejs` - Admin dashboard (dynamic menu)
- `/core/admin/webPages/systemSettings/` - System settings UI
- `/core/admin/webPages/usersManagment/` - Symlink → plugins/adminUsers/usersManagment/

### Authentication & User Management

- `/plugins/adminUsers/userAccount.json5` - User credentials
- `/plugins/adminUsers/userRole.json5` - Role definitions
- `/plugins/adminUsers/main.js` - Authentication logic
- `/plugins/adminUsers/adminConfig.json5` - Admin section metadata
- `/plugins/adminUsers/usersManagment/` - User management UI files

### Databases

- `/plugins/dbApi/dbFile/mainDb.db` - Main database
- `/plugins/dbApi/dbFile/webDb.db` - Web-shared database
- `/plugins/dbApi/dbFile/pluginsDb/*.db` - Per-plugin databases

## Debugging & Troubleshooting

### Enable Debug Mode

In `ital8Config.json5`:
```json
{
  "debugMode": 1
}
```

### Check Plugin Loading

Plugins log during load:
```
Loading plugin: admin
Loading plugin: adminUsers
Loading plugin: bootstrap
Plugin loaded: admin
Plugin loaded: adminUsers
Plugin loaded: bootstrap
```

### Common Issues

**Plugin not loading:**
- Check `pluginConfig.json5` has `"active": 1`
- Verify `pluginDescription.json5` exists
- Check dependencies are satisfied
- Look for syntax errors in `main.js`

**Routes not working:**
- Verify plugin is active and loaded
- Check route path in `getRouteArray()`
- Access at `/api/{pluginName}/{path}`
- Check middleware isn't blocking request

**Database errors:**
- Ensure dbApi plugin is active
- Check database file permissions
- Verify table exists before querying
- Use try-catch for database operations

**Authentication issues:**
- Verify session keys are set
- Check user exists in `userAccount.json5`
- Ensure password is bcrypt hashed
- Check session cookie is being sent

**Theme not rendering:**
- Verify theme exists in `/themes` directory
- Check `activeTheme` in `ital8Config.json5`
- Ensure all required partials exist
- Look for EJS syntax errors

### VSCode Debugging

Launch configuration (`.vscode/launch.json`):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/index.js",
      "restart": true,
      "runtimeExecutable": "nodemon",
      "console": "integratedTerminal"
    }
  ]
}
```

## Future Improvements

Based on the codebase analysis, consider these enhancements:

1. **Testing:** Add Jest/Mocha for unit and integration tests
2. **TypeScript:** Migrate to TypeScript for type safety
3. **Environment Variables:** Use .env for configuration
4. **Database Migrations:** Implement migration system for schema changes
5. **API Documentation:** Add Swagger/OpenAPI documentation
6. **Error Handling:** Centralized error handling middleware
7. **Logging:** Structured logging (Winston, Bunyan)
8. **Validation:** Request validation library (Joi, Yup)
9. **Build Process:** Frontend asset bundling (webpack, esbuild)
10. **Internationalization:** i18n support for multiple languages

## Quick Reference Commands

```bash
# Development
npm install                    # Install dependencies
npm start                      # Start with auto-reload
node index.js                  # Start without auto-reload

# Production
npm install --production       # Install production dependencies only
node index.js                  # Run application
pm2 start index.js             # Run with PM2 process manager

# Database
# Access via better-sqlite3 in plugin code
# Files: /plugins/dbApi/dbFile/*.db

# Git
git status                     # Check status
git add .                      # Stage changes
git commit -m "message"        # Commit changes
git push                       # Push to remote
```

## AI Assistant Guidelines

When working on this codebase as an AI assistant:

1. **Understand Plugin Architecture:** This is a plugin-based system. Most features should be implemented as plugins.

2. **Respect Dependencies:** Check plugin dependencies and loading order before making changes.

3. **Use Existing Patterns:** Follow established patterns for routes, middleware, and hooks.

4. **Security First:** Always hash passwords, validate input, use prepared statements.

5. **Test Changes:** After modifications, verify:
   - Server starts without errors
   - Plugin loads successfully
   - Routes are accessible
   - Authentication still works

6. **Documentation:** Update this file when adding significant features or changing architecture.

7. **Italian Comments:** Author uses Italian comments. When adding comments, prefer English for international collaboration, but respect existing Italian comments.

8. **Version Control:** This is an alpha project (v0.0.1-alpha.0). Breaking changes are acceptable but should be documented.

9. **Configuration Changes:** When modifying configuration, update relevant JSON5 files and document changes. **ALWAYS use `loadJson5()` to read configuration files, never use `require()` or `JSON.parse()`.**

10. **Theme Changes:** If modifying themes, ensure both public and admin themes are considered.

11. **Naming Convention - MANDATORY:** **ALWAYS propose at least 2-3 meaningful name alternatives** (or more when appropriate) before introducing any new name (variables, functions, files, directories, plugins, classes, constants, etc.). For complex or critical naming decisions, propose 4-5+ alternatives to provide more choice. Provide a brief explanation for each option and wait for the maintainer's approval before proceeding with implementation. This is a **CRITICAL REQUIREMENT** and must never be skipped.

---

**Last Updated:** 2026-01-03
**Version:** 1.6.0
**Maintained By:** AI Assistant (based on codebase analysis)

**Changelog:**
- v1.6.0 (2026-01-03): **NEW FEATURE** - Implemented Global Functions system for EJS templates. Key changes:
  - **REFACTORING (2026-01-04):** Separated local and global function exports with new plugin standard
    - Added `getGlobalFunctionsForTemplates()` method to plugin standard
    - Plugins now explicitly declare global function candidates via dedicated method
    - `getObjectToShareToWebPages()` remains for local functions (backward compatible)
    - Clear separation: local vs global function exports
    - Implemented whitelist-based security system in `ital8Config.json5`
    - Whitelist attributes: `plugin`, `description`, `required` (fail-fast or graceful degradation)
    - `pluginSys.getGlobalFunctions()` now uses new method and validates against whitelist
    - Removed `#validateWhitelistViolations()` (no longer needed)
    - Updated `simpleI18n` plugin to implement new method
    - Eliminated spurious warnings for functions meant only for local use
    - **Files modified:**
      - `core/pluginSys.js` - Refactored to use `getGlobalFunctionsForTemplates()`
      - `plugins/simpleI18n/main.js` - Added new method
      - `CLAUDE.md` - Complete documentation update with whitelist system
  - **Global Functions Architecture (Initial Implementation 2026-01-03):**
    - Added `getGlobalFunctions()` method to `pluginSys.js`
    - Plugins can now expose functions as global helpers in templates
    - Functions accessible directly without `passData.plugin.{pluginName}` prefix
    - Fully backward compatible - local syntax (`passData.plugin.{pluginName}.{function}`) remains available
  - **simpleI18n Global Function:**
    - Translation function `__()` now available globally in all EJS templates
    - New syntax: `<%- __({ it: "Ciao", en: "Hello" }, passData.ctx) %>`
    - Old syntax still works: `<%- passData.plugin.simpleI18n.__({ it: "Ciao", en: "Hello" }, passData.ctx) %>`
  - **Implementation:**
    - Modified `index.js` to call `pluginSys.getGlobalFunctions()` and spread results into EJS locals
    - Applied to both public and admin template rendering
    - Updated `/www/i18n-test.ejs` with side-by-side comparison of both syntaxes
  - **Documentation:**
    - Added "Global Functions in Templates" section to CLAUDE.md
    - Documented both syntaxes with examples
    - Added notes about whitelist security system, fail-fast vs graceful degradation
    - Complete architectural documentation with 4 subsections
- v1.5.0 (2025-12-27): **BREAKING CHANGE** - Simplified admin plugin standard with automatic detection, multi-section support, and centralized UI metadata. Key changes:
  - **New Admin Plugin Convention:**
    - Admin plugins are now **automatically detected** by naming convention (name starts with "admin")
    - Removed `pluginType.isAdminPlugin` flag - no longer needed
    - Removed separate `adminConfig.json5` file from plugins
    - Plugin declares only section IDs in `pluginConfig.json5` via `adminSections` array (strings, not objects)
  - **Centralized UI Metadata:**
    - All UI metadata (label, icon, description) moved to `/core/admin/adminConfig.json5`
    - Better separation of concerns: plugin declares "what sections", admin config declares "how to display them"
    - Easier to update UI labels/icons without modifying plugin files
  - **Multi-Section Support:**
    - Plugins can provide multiple admin sections via `adminSections` array
    - Example: `adminUsers` provides both `usersManagment` and `rolesManagment` sections
  - **SymlinkManager Updates:**
    - Updated to detect admin plugins by naming convention (`pluginName.startsWith('admin')`)
    - Processes array of strings (section IDs) instead of array of objects
    - Creates/removes symlinks for each section automatically
  - **Multi-Role Permission System Implementation:**
    - Restructured role data architecture with hardcoded roles (0-99) and custom roles (100+)
    - Users can now have multiple roles via `roleIds` array (replaced single `roleId`)
    - Created `roleManagement.js` module with CRUD operations for custom roles
    - Added 5 new API endpoints for role management
    - Implemented checkbox-based multi-role selection UI in `userUpsert.ejs`
    - Created new `rolesManagment` admin section for managing custom roles
  - **Files Modified:**
    - Updated `/core/admin/lib/symlinkManager.js` - multi-section support
    - Updated `/core/admin/adminConfig.json5` - registered both admin sections
    - Updated `/plugins/adminUsers/pluginConfig.json5` - added `adminSections` array
    - Removed `/plugins/adminUsers/adminConfig.json5` - deprecated
  - **Documentation:**
    - Updated all examples to reflect new standard
    - Updated "Creating an Admin Plugin" checklist
    - Added clear warnings about naming convention requirement
- v1.4.0 (2025-12-12): **MAJOR FEATURE** - Implemented modular Admin System architecture. Key changes:
  - **New Admin System Components:**
    - Created `/core/admin/adminSystem.js` - Central coordinator
    - Created `/core/admin/lib/configManager.js` - Config loader & validator
    - Created `/core/admin/lib/adminServicesManager.js` - Service discovery system
    - Created `/core/admin/lib/symlinkManager.js` - Symlink manager for plugin sections
    - Created `/core/admin/adminConfig.json5` - Central admin configuration
  - **Admin Plugin Architecture:**
    - Admin plugins MUST start with `admin` prefix (e.g., `adminUsers`, `adminMailer`)
    - Automatic detection by naming convention
    - Section files in plugin root directory (e.g., `plugins/adminUsers/usersManagment/`)
  - **Symlink-Based Serving:**
    - Plugin sections served via symlinks: `core/admin/webPages/{sectionId} → plugins/{plugin}/{sectionId}/`
    - Zero file duplication, single source of truth
    - Automatic symlink creation during plugin initialization
  - **Plugin Renamed:**
    - `adminUsers` → `adminUsers` (admin plugin for user management)
    - All API endpoints updated: `/api/adminUsers/` → `/api/adminUsers/`
    - Files moved: `core/admin/webPages/usersManagment/` → `plugins/adminUsers/usersManagment/`
  - **2-Phase Initialization:**
    - Dependency injection pattern to avoid circular dependencies
    - Phase 1: Create instances | Phase 2: Link dependencies | Phase 3: Initialize
  - **Service Discovery:**
    - Backend services (auth, email, storage) mapped to plugin providers
    - Configured in `adminConfig.json5` services section
  - **Dynamic Menu Generation:**
    - Menu sections generated from configuration at runtime
    - Supports both plugin-based and hardcoded sections
    - Filtered by enabled status and plugin active state
  - **Plugin System Enhancements:**
    - Added `pluginName` and `pathPluginFolder` metadata to plugin objects
    - New methods: `getAllPlugins()`, `getPlugin(pluginName)`, `setAdminSystem()`
  - **Updated Application Startup Flow:**
    - Added Admin System initialization step (if `enableAdmin: true`)
    - 2-phase dependency injection between PluginSys and AdminSystem
- v1.3.0 (2025-12-11): **BREAKING CHANGE** - Converted all configuration files from `.json` to `.json5` extension. Key changes:
  - All configuration files now use `.json5` extension to reflect JSON5 format support
  - Updated all documentation examples to use `loadJson5()` function
  - Added clear warnings about not using `require()` for `.json5` files
  - Improved code examples to demonstrate proper JSON5 file loading
  - Total of 38 configuration files converted
  - Files excluded: `package.json`, `package-lock.json`, `.vscode/launch.json`
- v1.2.0 (2025-11-26): **BREAKING CHANGE** - Updated naming convention from kebab-case to camelCase for all files and directories. Key changes:
  - `ital8-conf.json` → `ital8Config.json`
  - `config-plugin.json` → `pluginConfig.json`
  - `description-plugin.json` → `pluginDescription.json`
  - All file/directory examples updated to use pure camelCase
  - Added compound file names convention (noun + descriptor pattern)
  - Maintained PascalCase for classes and UPPER_SNAKE_CASE for constants
- v1.1.1 (2025-11-25): Clarified that at least 2-3 alternatives should be proposed, but more (4-5+) when appropriate for complex cases
- v1.1.0 (2025-11-25): Added mandatory naming conventions requiring proposal of meaningful alternatives before implementation
- v1.0.0 (2025-11-19): Initial comprehensive documentation
