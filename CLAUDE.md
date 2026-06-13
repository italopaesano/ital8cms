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

### Dipendenze Mantenute dal Team

Il progetto ital8cms è anche manutentore del modulo npm **`koa-classic-server`**. Questo ha un'implicazione importante per la gestione dei bug:

**Regola:** Se durante lo sviluppo di ital8cms viene individuato un bug in `koa-classic-server`, **non si deve aggirarlo** con workaround locali nel codice di ital8cms. Si deve invece **segnalarlo al maintainer (Italo Paesano)** affinché venga corretto nel modulo originale, e successivamente aggiornare la dipendenza alla versione fixata.

**Motivazione:** Aggirare i bug nelle dipendenze che controlliamo direttamente:
- ❌ Accumula debito tecnico nel codice di ital8cms
- ❌ Nasconde il problema reale nel modulo
- ❌ Lascia il bug attivo per altri utilizzatori di `koa-classic-server`
- ✅ La correzione nel modulo risolve il problema alla radice per tutti

**Procedura quando si trova un bug in `koa-classic-server`:**
1. Descrivere il bug al maintainer (root cause, comportamento atteso, sistemi affetti)
2. Attendere la release con la fix
3. Aggiornare la versione in `package.json` con `npm install koa-classic-server@x.y.z`
4. Verificare che il comportamento sia corretto senza workaround nel codice ital8cms

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
│   │       └── usersManagment/  # SYMLINK → plugins/adminUsers/adminWebSections/usersManagment/
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
│   │   ├── pluginConfig.json5   # Plugin config (with adminSections array)
│   │   ├── pluginDescription.json5 # Plugin metadata
│   │   ├── adminWebSections/   # Admin sections container directory
│   │   │   ├── usersManagment/ # Admin section files (served via symlink)
│   │   │   │   ├── index.ejs   # User list page
│   │   │   │   ├── userView.ejs # View user details
│   │   │   │   ├── userUpsert.ejs # Create/edit user
│   │   │   │   └── userDelete.ejs # Delete user
│   │   │   └── rolesManagment/ # Role management section
│   │   │       └── index.ejs   # Role management page
│   │   ├── userAccount.json5    # User credentials (bcrypt hashed)
│   │   ├── userRole.json5       # Role definitions
│   │   ├── userManagement.js   # User management logic
│   │   └── roleManagement.js   # Role management logic
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
   - Body parser (request parsing) - **CORE** (always active)
   - Sessions (authentication state) - **OPTIONAL** (configurable in `ital8Config.json5`)
   - Router (URL routing) - **CORE** (always active)
   - Order is fixed and guaranteed: bodyParser → session → router
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

  // Route registration (called without arguments by pluginSys)
  getRouteArray() { return [] },

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

// Access shared objects via pull mechanism (on-demand)
// Generic call (forPlugin = undefined — provider returns generic object)
const dbApiShared = pluginSys.getSharedObject('dbApi')

// Caller-specific call (provider can customize response for that consumer)
const dbApiForMedia = pluginSys.getSharedObject('dbApi', 'media')
```

**`getSharedObject(providerPluginName, callerName)`**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `providerPluginName` | string | Yes | Plugin that exposes the shared object |
| `callerName` | string | No | Requesting plugin name (for per-consumer customization) |

Returns `null` if plugin is not active or doesn't implement `getObjectToShareToOthersPlugin()`.

**Push vs Pull:**
- **Push** (`setSharedObject`) — Automatic during init, per-consumer customized. Best for plugin-to-plugin dependencies.
- **Pull** (`getSharedObject`) — On-demand at runtime. Best for route handlers, middleware, and framework code.

### Plugin API Routes

Routes follow pattern: `/${apiPrefix}/${pluginName}/${path}`

**CRITICAL — Route Object Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `method` | string | Yes | **MUST be UPPERCASE**: `'GET'`, `'POST'`, `'PUT'`, `'DEL'`, `'ALL'` |
| `path` | string | Yes | Route path (e.g., `'/hello'`) |
| `handler` | async function | Yes | Route handler: `async (ctx) => { ... }` |
| `access` | object | Yes | Access control (see Access Control section) |

**WARNING:** Using lowercase methods (e.g., `'get'` instead of `'GET'`) or `func` instead of `handler` will cause routes to be **silently ignored** by `pluginSys.loadRoutes()`. The route won't be registered and requests will fall through to the static file server, returning HTML instead of JSON.

```javascript
getRouteArray() {
  return [
    {
      method: 'GET',  // MUST be uppercase: 'GET', 'POST', 'PUT', 'DEL', 'ALL'
      path: '/hello',
      access: { requiresAuth: false, allowedRoles: [] },
      handler: async (ctx) => {
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
  "pluginPagesPrefix": "pluginPages",  // URL prefix (la directory fisica resta /pluginPages/)

  // File indice serviti su /pluginPages/{pluginName}/ (senza nome file)
  "indexFiles": {
    "pluginPagesPrefix": ["index.ejs"]
  },

  // Clean URLs: se enabled, /pluginPages/myPlugin/page funziona senza .ejs
  "hideExtension": {
    "pluginPagesPrefix": { "enabled": false, "ext": ".ejs" }
  }
}
```

**No plugin configuration needed!** The system auto-detects plugins with `webPages/` directory.

**Effetti pratici:**
- `indexFiles.pluginPagesPrefix`: con `["index.ejs"]`, l'URL `/pluginPages/myPlugin/` serve direttamente `webPages/index.ejs`.
- `hideExtension.pluginPagesPrefix.enabled = true`: l'URL `/pluginPages/myPlugin/page` serve `webPages/page.ejs`; i link con `.ejs` continuano a funzionare via redirect automatico (richiede `koa-classic-server` v2.6.1+).

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
      method: 'POST',
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
      method: 'GET',
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
  isAdminContext: false,         // Flag per contesto pubblico (sempre false qui)
  globalPrefix: '',              // Global prefix configurato in ital8Config.json5
  apiPrefix: 'api',              // API prefix configurato in ital8Config.json5
  pluginSys: pluginSys,          // Plugin system instance
  plugin: {                      // Shared plugin objects (da getObjectToShareToWebPages)
    bootstrap: { ... },
    myPlugin: { ... }
  },
  adminSystem: adminSystem,      // Admin system (disponibile anche in pagine pubbliche)
  filePath: '/path/to/file.ejs', // Path assoluto del template renderizzato
  href: 'http://...',            // Full request URL (ctx.href)
  query: { ... },                // URL query parameters (ctx.query)
  ctx: ctx,                      // Full Koa context
  themeSys: themeSysWrapper      // Theme system wrapper (aggiunto dopo, metodi bound)
}
```

**Nota:** il prefisso `pluginPagesPrefix` **non** è esposto nel passData. Se serve nei template, leggerlo dalla configurazione lato server o costruire URL relativi.

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

   **API pubblica:**

   | Metodo | Descrizione |
   |--------|-------------|
   | `initialize()` | Esegue scan + crea symlink + cleanup. Chiamato automaticamente a `index.js` |
   | `getPluginPagesDirectory()` | Restituisce il path assoluto della directory `/pluginPages/` |
   | `hasPublicPages(pluginName)` | `true` se il plugin ha una directory `webPages/` |
   | `getPluginsWithPublicPages()` | Array dei nomi dei plugin attivi con `webPages/` |
   | `createSymlinkForPlugin(pluginName, sourceDir)` | Crea (o verifica) il symlink per un singolo plugin |
   | `removeSymlinkForPlugin(pluginName)` | Rimuove il symlink (uso: uninstall plugin) |
   | `validateAndCleanSymlinks()` | Scansiona `/pluginPages/`, rimuove symlink rotti, orfani o di plugin disattivati. Chiamato automaticamente in `initialize()` |

   **Comportamento al boot (auto-cleanup):**
   - Crea automaticamente la directory `/pluginPages/` se assente
   - Rimuove symlink che puntano a path inesistenti
   - Rimuove symlink di plugin non più attivi
   - Se in `/pluginPages/{pluginName}` esiste un file/dir regolare (non symlink): logga errore e **non** crea il symlink (no overwrite)

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

#### ⚠️ Stato attuale dei campi `active` / `isInstalled` (da decidere)

I campi `active` e `isInstalled` in `themeConfig.json5` sono attualmente **solo cosmetici**: vengono mostrati nei badge della UI admin (`themesManagment/index.ejs`, `themeView.ejs`) ma **non guidano alcuna logica**. Il tema effettivamente attivo è determinato unicamente da `ital8Config.json5` (`activeTheme`, `adminActiveTheme`).

**Convenzione attuale (cleanup 2026-05-26):**
- `active: 1` → **solo** sul tema corrispondente a `ital8Config.json5.activeTheme` o `adminActiveTheme`
- `active: 0` → su tutti gli altri temi bundled
- `isInstalled: 1` → su tutti i temi bundled (sono installati per definizione)
- `themesInstall.js` (installazione da repo Git) forza `active: 0, isInstalled: 0` sui temi clonati

**Decisione architetturale aperta — da approfondire:**

Tre opzioni sul tavolo:

1. **Mantenere lo stato attuale come cosmetico** — `active` e `isInstalled` restano metadata visualizzati ma non funzionali. Va documentato chiaramente che la fonte di verità è `ital8Config.json5`.

2. **Allineare al flusso install** — `setActiveTheme` mantiene l'invariante: deattiva il flag nel vecchio tema, attiva nel nuovo. Aggiunge complessità (due scritture atomiche per cambio tema) ma rende i flag funzionali e coerenti.

3. **Eliminare i campi** — rimuovere `active` e `isInstalled` da `themeConfig.json5` e dalla UI. La fonte di verità diventa solo `ital8Config.json5`, eliminando ogni ambiguità.

**Vincolo:** `themesInstall.js` attualmente forza entrambi a 0 dopo il clone. Qualsiasi decisione deve essere coerente con questo flusso o modificarlo.

Per ora `setActiveTheme()` **non** tocca i flag nei `themeConfig.json5`: aggiorna solo `ital8Config.json5`. La decisione su quale opzione adottare è rimandata.

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

## Bootstrap Navbar Plugin

### Overview

The **bootstrapNavbar** plugin generates Bootstrap 5 navbars from JSON5 configuration files. It supports three navbar types, auth/role-based visibility filtering, auto-active page detection, and secure cross-directory configuration sharing.

**Key Features:**
- ✅ **Three navbar types:** horizontal (with collapse), vertical (sidebar), offcanvas (drawer)
- ✅ **JSON5-driven:** Navbar structure defined in `navbar.{name}.json5` files
- ✅ **Auth/roles visibility:** Items shown/hidden based on authentication state and user roles
- ✅ **Auto-active detection:** Current page highlighted automatically
- ✅ **Dropdowns:** Nested menus with dividers and per-item visibility
- ✅ **Separators:** Visual spacers between items
- ✅ **Settings overrides:** Runtime overrides from EJS templates
- ✅ **configDir:** Cross-directory config sharing with path traversal protection
- ✅ **Caching:** Production mode caches parsed configs; debug mode re-reads every request
- ✅ **XSS protection:** All labels and hrefs escaped; icons inserted as raw HTML (trusted)

**Plugin Structure:**

```
plugins/bootstrapNavbar/
├── main.js                    # Plugin entry point, exposes render() to templates
├── pluginConfig.json5         # Plugin configuration (depends on bootstrap ^1.0.0)
├── pluginDescription.json5    # Plugin metadata
└── lib/
    └── navbarRenderer.js      # Core rendering engine (all logic)
```

**Dependency:** `/core/servingRootResolver.js` — Utility for path isolation used by configDir feature.

### Usage in EJS Templates

The plugin exposes a single `render()` function via `passData.plugin.bootstrapNavbar`:

```ejs
<%# Basic usage — searches for navbar.main.json5 in the same directory as this template %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>

<%# With configDir — searches in /www/ root instead of template's directory %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main', configDir: '/'}, passData) %>

<%# With settings overrides — override specific settings at render time %>
<%- passData.plugin.bootstrapNavbar.render({
  name: 'main',
  settingsOverrides: { colorScheme: 'light', bgClass: 'bg-dark' }
}, passData) %>
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.name` | string | Yes | Navbar name → maps to `navbar.{name}.json5` |
| `options.configDir` | string | No | Directory relative to serving root where to search for config. If omitted, searches in template's directory |
| `options.settingsOverrides` | object | No | Runtime overrides for settings (highest priority) |
| `passData` | object | Yes | The passData object from the EJS template context |

**Returns:** HTML string, or empty string on error (with `console.warn`).

### Configuration File Format

**File naming:** `navbar.{name}.json5` (e.g., `navbar.main.json5`, `navbar.sidebar.json5`)

**File location:** Same directory as the calling EJS template (default), or configurable via `configDir`.

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  // Settings control the navbar's appearance and behavior
  "settings": {
    "type": "horizontal",         // "horizontal" | "vertical" | "offcanvas"
    "colorScheme": "dark",        // "dark" | "light" (Bootstrap data-bs-theme)
    "bgClass": "bg-primary",      // Any Bootstrap background class
    "expandAt": "lg",             // "sm" | "md" | "lg" | "xl" | "xxl" (collapse breakpoint)
    "containerClass": "container-fluid",  // Bootstrap container class
    "autoActive": true,           // Auto-detect and highlight current page
    "offcanvasAlways": false,     // true = hamburger always visible (offcanvas only)
    "position": "start",          // "start" | "end" (offcanvas direction / vertical alignment)
    "id": "navbarMain",           // HTML id for collapse/offcanvas target
  },

  // Sections organize items into left and right groups
  "sections": {
    "left": [
      // ... items (see Item Types below)
    ],
    "right": [
      // ... items
    ],
  },
}
```

**Note:** In vertical navbars, "left" = top section, "right" = bottom section (separated by `<hr>`).

### Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `type` | string | `"horizontal"` | Navbar type: `horizontal`, `vertical`, `offcanvas` |
| `colorScheme` | string | `"dark"` | Bootstrap theme: `dark` or `light` |
| `bgClass` | string | `"bg-primary"` | Bootstrap background class (e.g., `bg-dark`, `bg-danger`) |
| `expandAt` | string | `"lg"` | Breakpoint for collapse: `sm`, `md`, `lg`, `xl`, `xxl` |
| `containerClass` | string | `"container-fluid"` | Bootstrap container class |
| `autoActive` | boolean | `true` | Auto-detect current page and add `active` class |
| `offcanvasAlways` | boolean | `false` | If `true`, hamburger menu is always visible (offcanvas only) |
| `position` | string | `"start"` | Direction: `start` (left) or `end` (right) |
| `id` | string | `"navbarMain"` | HTML `id` used for collapse/offcanvas targeting |

**Settings merge priority (lowest to highest):**
1. **Built-in defaults** (hardcoded in navbarRenderer.js)
2. **JSON5 file settings** (`config.settings`)
3. **Runtime overrides** (`options.settingsOverrides`)

### Item Types

#### Regular Item (Link)

```json5
{
  "label": "Home",                    // Text displayed (HTML-escaped)
  "href": "/",                        // URL (HTML-escaped, defaults to "#")
  "icon": "<i class='bi bi-house'></i>",  // Optional: raw HTML (NOT escaped)
  "target": "_blank",                // Optional: link target attribute
  "requiresAuth": true,              // Optional: auth filter (see Visibility)
  "allowedRoles": [0, 1],            // Optional: role filter (see Visibility)
  "showWhen": "authenticated",       // Optional: shortcut filter (see Visibility)
}
```

#### Dropdown

```json5
{
  "type": "dropdown",
  "label": "Menu",
  "icon": "<i class='bi bi-list'></i>",   // Optional icon in toggle
  "requiresAuth": true,                    // Optional: filters the ENTIRE dropdown
  "items": [
    { "label": "Item 1", "href": "/item1" },
    { "type": "divider" },                 // Horizontal separator
    { "label": "Item 2", "href": "/item2", "requiresAuth": true, "allowedRoles": [0] },
  ],
}
```

**Behavior:** If all sub-items are hidden (auth filtering), the entire dropdown is hidden.

**Dropdown ID generation:** `dropdown-{settings.id}-{slugified-label}` (e.g., `dropdown-navbarMain-my-services`)

#### Separator

```json5
{ "type": "separator" }
```

Renders a visual vertical bar (`|`) between items. **Never filtered by visibility.**

#### Divider (inside dropdown only)

```json5
{ "type": "divider" }
```

Renders `<hr class="dropdown-divider">` inside a dropdown menu. **Never filtered by visibility.**

### Visibility Filtering

Items can be shown/hidden based on authentication state and user roles. Checks are applied in this order:

**1. `showWhen` (shortcut)**

| Value | Behavior |
|-------|----------|
| `"authenticated"` | Show only to logged-in users |
| `"unauthenticated"` | Show only to non-logged-in users |
| *(omitted)* | No filter |

**2. `requiresAuth`**

| Value | Behavior |
|-------|----------|
| `true` | Show only to authenticated users |
| `false` | Show only to NON-authenticated users |
| *(omitted)* | No filter |

**3. `allowedRoles`** (checked only when `requiresAuth: true`)

| Value | Behavior |
|-------|----------|
| `[0, 1]` | Show only to users with role 0 OR role 1 |
| `[]` | Show to all authenticated users (no role check) |
| *(omitted)* | Show to all authenticated users |

**Priority:** `showWhen` → `requiresAuth` → `allowedRoles`

**Examples:**

```json5
// Public item (no restrictions)
{ "label": "Home", "href": "/" }

// Only for logged-in users
{ "label": "Profile", "href": "/profile", "showWhen": "authenticated" }

// Only for guests
{ "label": "Login", "href": "/login", "showWhen": "unauthenticated" }

// Only for root and admin
{ "label": "Admin", "href": "/admin", "requiresAuth": true, "allowedRoles": [0, 1] }

// Only for root
{ "label": "System", "href": "/system", "requiresAuth": true, "allowedRoles": [0] }
```

### Auto-Active Page Detection

When `autoActive: true` (default), the plugin compares each item's `href` with the current page URL:

- Only the **pathname** is compared (query strings and fragments are ignored)
- **Trailing slashes** are normalized (`/page/` matches `/page`)
- Active items receive the `active` CSS class and `aria-current="page"` attribute
- Works in both top-level nav items and dropdown sub-items

### configDir: Cross-Directory Configuration

By default, navbar config files are searched in the **same directory** as the calling EJS template. The `configDir` parameter allows searching in a different directory, relative to the **serving root**.

```ejs
<%# Template at /www/pages/deep/home.ejs wants config from /www/shared/ %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main', configDir: '/shared'}, passData) %>
```

**Serving root resolution** (determined by `/core/servingRootResolver.js`):

| Context | Serving Root | Example |
|---------|-------------|---------|
| **www** | Entire `/www/` directory | All www files share one root |
| **pluginPages** | Per-plugin: `/pluginPages/{pluginName}/` | Each plugin isolated |
| **admin** | Per-section: `/core/admin/webPages/{sectionId}/` | Each section isolated |

**Security:**
- Path traversal (`../`) that escapes the serving root is **blocked** with a security warning
- Plugin pages cannot access other plugins' config files
- Admin sections cannot access other sections' config files
- `configDir` with or without leading `/` are equivalent (`/shared` = `shared`)

**Fallback behavior:**
- If `servingConfig` is unavailable, falls back to template's directory (with warning)
- If file not found at resolved path, returns empty string (with warning)
- Admin dashboard (`/core/admin/webPages/index.ejs`) returns empty string (no section root)

### Navbar Type Details

#### Horizontal (default)

Standard Bootstrap navbar with collapse toggle for mobile.

```
┌─────────────────────────────────────────────────┐
│ [≡] ← toggler    [Left items...]    [Right items...] │
└─────────────────────────────────────────────────┘
```

- Uses `navbar-expand-{expandAt}` for responsive collapse
- Left items in `<ul>` with `me-auto` (push right items to the end)
- Right items in separate `<ul>`
- Collapse toggle button with `data-bs-toggle="collapse"`

#### Vertical (sidebar)

Flex-column sidebar layout.

```
┌──────────────┐
│ [Left items]  │
│    ...        │
│ ──────────── │  ← <hr> (only if right items exist)
│ [Right items] │
│    ...        │
└──────────────┘
```

- Uses `flex-column align-items-stretch p-3`
- `position: "end"` adds `ms-auto` (right-align the sidebar)
- `<hr>` separator between left and right only if right items have content
- No collapse toggle (always visible)

#### Offcanvas (drawer)

Offcanvas sidebar that slides in from a side.

```
Toggle: [≡]     ┌───────────────┐
                │ ✕ Close       │
                │ [Left items]  │
                │ [Right items] │
                └───────────────┘
```

- `offcanvasAlways: true` → hamburger **always visible** (no inline expansion)
- `offcanvasAlways: false` → hamburger only below `expandAt` breakpoint
- `position: "start"` → slides from left (`offcanvas-start`)
- `position: "end"` → slides from right (`offcanvas-end`)
- Offcanvas ID: `{settings.id}-offcanvas`

### Caching Behavior

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Debug** (`debugMode >= 1`) | Re-reads JSON5 file on **every** request | Development (instant changes) |
| **Production** (`debugMode = 0`) | Reads once, caches in memory (`Map`) | Production (performance) |

- Cache key = absolute file path of the JSON5 file
- Different `configDir` values produce different cache keys
- Cache is never invalidated (server restart required for production changes)

### Example Configurations

Seven example configurations are available in `/www/navbarExamples/`:

| File | Type | Demonstrates |
|------|------|-------------|
| `navbar.main.json5` | horizontal | Main navbar with dropdown, separator, auth items |
| `navbar.horizontalLight.json5` | horizontal | Light color scheme |
| `navbar.sidebar.json5` | vertical | Sidebar with dropdown, auth, position |
| `navbar.offcanvasResponsive.json5` | offcanvas | Responsive offcanvas (collapses at breakpoint) |
| `navbar.offcanvasAlways.json5` | offcanvas | Always-visible hamburger, slides from right |
| `navbar.authHeavy.json5` | horizontal | Comprehensive auth/roles demo |
| `navbar.overridable.json5` | horizontal | Designed for settingsOverrides demo |

### Complete Example: Theme Integration

**File: `/www/index.ejs`**

```ejs
<!DOCTYPE html>
<html lang="it">
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<title>Home</title>
</head>

<body>
  <%# Render the main navbar (searches for navbar.main.json5 in /www/) %>
  <%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>

  <main class="container mt-4">
    <h1>Welcome</h1>
  </main>

  <%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

**File: `/www/navbar.main.json5`**

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "autoActive": true,
    "id": "navbarMain",
  },
  "sections": {
    "left": [
      { "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" },
      {
        "type": "dropdown",
        "label": "Pages",
        "items": [
          { "label": "About", "href": "/about.ejs" },
          { "type": "divider" },
          { "label": "Contact", "href": "/contact.ejs" },
        ],
      },
      { "type": "separator" },
      { "label": "Admin", "href": "/admin", "requiresAuth": true, "allowedRoles": [0, 1] },
    ],
    "right": [
      { "label": "Login", "href": "/pluginPages/adminUsers/login.ejs", "showWhen": "unauthenticated" },
      { "label": "Logout", "href": "/pluginPages/adminUsers/logout.ejs", "showWhen": "authenticated" },
    ],
  },
}
```

### Exported API (for testing)

`navbarRenderer.js` exports four functions:

```javascript
module.exports = {
  render,          // Main render function
  isItemVisible,   // Auth/role visibility check
  isActivePage,    // Active page URL comparison
  escapeHtml,      // HTML character escaping
};
```

### Troubleshooting

**Navbar not rendering (empty string):**
- Check that `navbar.{name}.json5` exists in the expected directory
- Verify `passData` is passed as the second argument
- Check console for `[bootstrapNavbar]` warnings

**Items not visible:**
- Check `requiresAuth`, `allowedRoles`, `showWhen` fields
- Verify user session: `ctx.session.authenticated`, `ctx.session.user.roleIds`
- Dropdown with all sub-items hidden → entire dropdown hidden

**configDir not working:**
- Ensure `servingConfig` is available (requires correct `ital8Config.json5` paths)
- Check console for security warnings (path traversal blocked)
- Admin dashboard (`index.ejs` in webPages root) does not support configDir

**Changes not reflected:**
- In production mode (`debugMode: 0`), restart server to clear cache
- In debug mode (`debugMode >= 1`), changes are immediate

### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/bootstrapNavbar/main.js` | Plugin entry point, render() exposure |
| `/plugins/bootstrapNavbar/lib/navbarRenderer.js` | Core rendering engine |
| `/plugins/bootstrapNavbar/pluginConfig.json5` | Plugin configuration |
| `/plugins/bootstrapNavbar/pluginDescription.json5` | Plugin metadata |
| `/core/servingRootResolver.js` | Path isolation utility for configDir |
| `/www/navbar.main.json5` | Primary navbar configuration |
| `/www/navbarExamples/` | 6 additional example configurations |
| `/tests/unit/bootstrapNavbar/` | Unit tests (5 files, 206 tests) |
| `/tests/unit/core/servingRootResolver.test.js` | servingRootResolver tests (22 tests) |

### URL Redirect Plugin

#### Overview

The **urlRedirect** plugin manages URL redirects (301/302) for site migrations. It supports exact, wildcard, and regex patterns, evaluated in **first-match-wins** order (array order in `redirectMap.json5`). The plugin operates as a pure middleware (no API routes) and only intercepts GET requests.

**Key Features:**
- ✅ **Three pattern types:** exact, wildcard (* and **), regex
- ✅ **First-match-wins:** user controls priority by array order
- ✅ **Hit counter:** tracks usage per rule with periodic flush
- ✅ **Query string preservation:** configurable
- ✅ **External redirect blocking:** security flag (disabled by default)
- ✅ **Debug/production modes:** re-read vs cache (follows bootstrapNavbar pattern)
- ✅ **All features configurable:** every feature toggleable via `pluginConfig.json5`

**Plugin Structure:**

```
plugins/urlRedirect/
├── main.js                    # Entry point: loadPlugin + getMiddlewareToAdd
├── pluginConfig.json5         # Feature configuration (all toggleable)
├── pluginDescription.json5    # Plugin metadata
├── redirectMap.json5          # Redirect rules (the "database")
├── redirectHitCount.json5     # Hit counters (auto-generated)
└── lib/
    ├── redirectMatcher.js     # Matching engine (exact, wildcard, regex)
    ├── hitCounter.js          # Hit counter with periodic flush
    └── configValidator.js     # Boot-time validation
```

---

#### Redirect Rules Configuration

**File:** `plugins/urlRedirect/redirectMap.json5`

Rules are defined as an array of objects. They are evaluated **in array order** — the first matching rule is applied. To control priority, reorder the rules.

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "redirects": [
    // Exact match
    { "from": "/old-page", "to": "/new-page", "type": 301 },

    // Wildcard single (*) — matches one path segment
    { "from": "/blog/*", "to": "/articles/*" },

    // Wildcard recursive (**) — matches everything including /
    { "from": "/old-docs/**", "to": "/docs/**" },

    // Regex with capture groups
    { "from": "regex:^/product/(\\d+)\\.html$", "to": "/products/$1" },

    // Temporary redirect (302)
    { "from": "/promo", "to": "/offers", "type": 302 },

    // External redirect (requires allowExternalRedirects: true)
    { "from": "/old-shop", "to": "https://shop.example.com" },
  ],
}
```

**Rule fields:**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `from` | Yes | string | Source URL pattern (exact, wildcard, or regex) |
| `to` | Yes | string | Destination URL (supports `*`, `**`, `$1`-`$N` substitutions) |
| `type` | No | number | HTTP status code: `301` (permanent, default) or `302` (temporary) |

---

#### Pattern Types

| Type | Syntax | Example | Matches |
|------|--------|---------|---------|
| Exact | `/path` | `/about` | Only `/about` |
| Wildcard `*` | `/prefix/*` | `/blog/*` | `/blog/post` (one segment, no `/`) |
| Wildcard `**` | `/prefix/**` | `/docs/**` | `/docs/a/b/c` (everything) |
| Regex | `regex:pattern` | `regex:^/p/(\d+)$` | `/p/42` (with capture group `$1`) |

---

#### Configuration Reference

All features are toggled in `pluginConfig.json5` → `custom`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableHitCounter` | boolean | `true` | Track redirect usage counts |
| `hitCounterFlushInterval` | number | `30` | Seconds between disk writes (0 = immediate) |
| `preserveQueryString` | boolean | `true` | Append original query string to destination |
| `normalizeTrailingSlash` | boolean | `true` | `/page/` matches `/page` |
| `caseSensitive` | boolean | `true` | Case-sensitive URL matching |
| `enablePatternMatching` | boolean | `true` | Enable `*` and `**` wildcards |
| `enableRegex` | boolean | `true` | Enable `regex:` patterns |
| `allowExternalRedirects` | boolean | `false` | Allow redirects to other domains |
| `enableLogging` | boolean | `true` | Log each redirect to console |
| `strictValidation` | boolean | `false` | Crash on boot if validation errors |

---

#### Behavior Details

**Only GET requests** are intercepted. POST, PUT, DELETE pass through.

**Debug vs production:** In debug mode (`debugMode >= 1`), `redirectMap.json5` is re-read on every request. In production (`debugMode: 0`), it is cached at boot.

**Disabled patterns:** If a rule uses wildcard but `enablePatternMatching: false`, the rule is **skipped with a warning** (not treated as literal). Same for regex with `enableRegex: false`.

**Redirect chains:** Single hop only. If `/a` → `/b` and `/b` → `/c`, the plugin redirects to `/b`; the browser makes a new request. Loop detection warns at boot for direct loops (A→B→A).

**Hit counter** stores data in `redirectHitCount.json5` with `hitCount`, `firstHit`, and `lastHit` per rule. Flush to disk is periodic (configurable). SIGTERM/SIGINT triggers a final flush.

**Shared objects:** Exposes `getRedirectRules()`, `getHitCounts()`, `getRuleCount()` for future admin plugin integration.

---

#### Validation at Boot

| Check | Severity | Behavior |
|-------|----------|----------|
| Missing `from`/`to` | ERROR | Rule skipped |
| Invalid `type` | WARNING | Defaults to 301 |
| Duplicate `from` | WARNING | First wins |
| Invalid regex | ERROR | Rule skipped |
| Pattern with feature disabled | WARNING | Rule skipped |
| External URL with feature disabled | WARNING | Rule skipped |
| Direct loop (A→B→A) | WARNING | Logged |

With `strictValidation: true`, all warnings become errors (server crashes).

---

#### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/urlRedirect/main.js` | Plugin entry point, middleware |
| `/plugins/urlRedirect/lib/redirectMatcher.js` | URL matching engine |
| `/plugins/urlRedirect/lib/hitCounter.js` | Hit counter with periodic flush |
| `/plugins/urlRedirect/lib/configValidator.js` | Boot-time rule validation |
| `/plugins/urlRedirect/pluginConfig.json5` | Feature configuration |
| `/plugins/urlRedirect/redirectMap.json5` | Redirect rules |
| `/plugins/urlRedirect/redirectHitCount.json5` | Hit counters (auto-generated) |
| `/plugins/urlRedirect/README.md` | Plugin documentation |
| `/tests/unit/urlRedirect/` | Unit tests (3 files, 101 tests) |

### Admin Bootstrap Navbar Plugin

#### Overview

The **adminBootstrapNavbar** plugin provides a complete admin interface for managing navbar JSON5 configuration files used by the `bootstrapNavbar` plugin. It allows administrators to create, edit, validate, preview, duplicate, and delete navbar configurations through a GUI editor in the admin panel.

**Key Features:**
- ✅ **GUI editor** with JSON5 syntax and quick-insert toolbar
- ✅ **Live preview** with Bootstrap rendering (shows all items including auth-filtered ones with indicators)
- ✅ **JSON5 validation** with internal link checking and role verification
- ✅ **File picker** to create navbar items from existing EJS/HTML pages
- ✅ **5 predefined templates** (horizontalBase, horizontalComplete, sidebar, offcanvasResponsive, offcanvasAlways)
- ✅ **3 creation modes:** from scratch, from template, from duplication
- ✅ **Soft-delete** with backup (files moved to `backups/` directory)
- ✅ **Automatic backup** on save with configurable retention
- ✅ **Recursive scanning** for `navbar.*.json5` files in `/www/`
- ✅ **Path traversal protection** on all file operations
- ✅ **XSS prevention** via HTML escaping in preview rendering

**Plugin Structure:**

```
plugins/adminBootstrapNavbar/
├── main.js                    # Plugin entry point, routes, preview renderer
├── pluginConfig.json5         # Plugin configuration
├── pluginDescription.json5    # Plugin metadata
├── backups/                   # Backup storage (soft-deletes + save backups)
├── lib/
│   ├── navbarFileManager.js   # Filesystem operations (scan, read, write, backup, delete)
│   ├── navbarTemplates.js     # Predefined navbar templates (5 templates)
│   └── navbarValidator.js     # JSON5 validation engine
└── adminWebSections/
    └── navbarsManagement/     # Admin UI pages
        ├── index.ejs          # Navbar list (table with actions)
        ├── create.ejs         # Create new navbar (3 modes)
        ├── edit.ejs           # JSON5 editor with toolbar and preview
        ├── editor.css         # Editor styles
        └── editor.js          # Client-side editor logic
```

**Dependencies:** `bootstrap ^1.0.0`, `bootstrapNavbar ^1.0.0`, `simpleI18n ^1.0.0`

---

#### Configuration

**In `pluginConfig.json5` → `custom`:**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maxBackupsPerFile` | number | `10` | Maximum backup files kept per navbar file |
| `linkValidationSeverity` | string | `"warning"` | `"warning"` or `"error"` for internal link checks |
| `allowedFileNameChars` | string | `"a-zA-Z0-9_-"` | Regex character class for valid navbar names |
| `filePickerDefaultExt` | string | `".ejs"` | Default filter in the file picker |

---

#### API Endpoints

All routes require authentication with roles: root (0), admin (1), or editor (2).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/adminBootstrapNavbar/list` | List all discovered navbar files |
| `GET` | `/api/adminBootstrapNavbar/load?file={name}` | Load content of a specific navbar file |
| `POST` | `/api/adminBootstrapNavbar/save` | Save navbar content (with backup) |
| `POST` | `/api/adminBootstrapNavbar/validate` | Validate JSON5 content without saving |
| `POST` | `/api/adminBootstrapNavbar/preview` | Render navbar preview HTML |
| `POST` | `/api/adminBootstrapNavbar/create` | Create a new navbar file (modes: empty, template, duplicate) |
| `POST` | `/api/adminBootstrapNavbar/duplicate` | Duplicate an existing navbar |
| `POST` | `/api/adminBootstrapNavbar/delete` | Soft-delete a navbar file (move to backups) |
| `GET` | `/api/adminBootstrapNavbar/templates` | List available templates |
| `GET` | `/api/adminBootstrapNavbar/browse-files` | Browse files for the file picker (tree view) |
| `POST` | `/api/adminBootstrapNavbar/refresh-scan` | Re-scan filesystem for navbar files |

---

#### Library Modules

**navbarFileManager.js** — Filesystem operations:
- `scanNavbarFiles(scanDir)` — Recursive scan for `navbar.*.json5` (skips hidden dirs, node_modules)
- `readNavbarFile(filePath)` — Returns `{ success, content, parsed, parseError }`
- `saveNavbarFile(filePath, content, backupDir, wwwDir, maxBackups)` — Atomic write with backup
- `createNavbarFile(filePath, content)` — Creates new file (error if exists)
- `deleteNavbarFile(filePath, backupDir, wwwDir)` — Soft-delete (moves to backups with DELETED marker)
- `createBackup(filePath, backupDir, wwwDir, maxBackups)` — Creates timestamped backup with cleanup

**navbarValidator.js** — Validation engine:
- `validate(content, options)` — Returns `{ valid, errors[], warnings[] }`
- Validates: JSON5 syntax, required structure, settings values, item structure, visibility fields, internal links, role IDs
- Exports constants: `VALID_TYPES`, `VALID_EXPAND_AT`, `VALID_COLOR_SCHEMES`, `VALID_POSITIONS`, `VALID_SHOW_WHEN`

**navbarTemplates.js** — Template system:
- `getTemplateList()` — Returns `[{ id, label: {it, en}, description: {it, en} }]`
- `generateFromTemplate(templateId, navbarName)` — Returns JSON5 string or null
- `generateEmpty(navbarName)` — Returns minimal empty navbar JSON5 string

---

#### Admin UI Pages

**Navbar List** (`/admin/navbarsManagement/index.ejs`):
- Table showing all navbar files with name, type badge, path, action buttons
- Actions: Edit, Duplicate, Delete with confirmation
- Refresh Scan and New Navbar buttons

**Create Navbar** (`/admin/navbarsManagement/create.ejs`):
- Three creation modes: From scratch, From template, From duplication
- Template selector with i18n labels and descriptions
- Supports URL pre-fill parameters (`?mode=&name=&source=`)

**Edit Navbar** (`/admin/navbarsManagement/edit.ejs`):
- Full JSON5 text editor with toolbar
- Quick-insert: Item, Dropdown, Separator, Divider, From File
- Section selector (left/right) for snippet insertion
- Icon helper with live preview
- Validate, Preview, and Save action buttons
- Auto-preview on load, snippet insert, template replace, and save
- Preview shows auth indicators: 🔒 (requires auth) and 👁 (unauthenticated only)
- File picker modal with tree view, extension filter, and label auto-generation

---

#### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/adminBootstrapNavbar/main.js` | Plugin entry point, routes, preview renderer |
| `/plugins/adminBootstrapNavbar/lib/navbarFileManager.js` | Filesystem operations |
| `/plugins/adminBootstrapNavbar/lib/navbarTemplates.js` | Predefined templates |
| `/plugins/adminBootstrapNavbar/lib/navbarValidator.js` | Validation engine |
| `/plugins/adminBootstrapNavbar/pluginConfig.json5` | Plugin configuration |
| `/plugins/adminBootstrapNavbar/pluginDescription.json5` | Plugin metadata |
| `/plugins/adminBootstrapNavbar/README.md` | Internal plugin documentation |
| `/core/admin/adminConfig.json5` | Admin section registration |
| `/tests/unit/adminBootstrapNavbar/` | Unit tests (3 files, 131 tests) |

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
├── adminWebSections/          # Admin sections container directory
│   ├── usersManagment/        # Admin section directory (name = sectionId)
│   │   ├── index.ejs          # Main section page
│   │   ├── userView.ejs       # Sub-pages
│   │   ├── userUpsert.ejs
│   │   └── userDelete.ejs
│   └── rolesManagment/        # Second admin section directory
│       └── index.ejs          # Role management page
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
  // Ogni sezione DEVE avere una directory corrispondente in adminWebSections/ del plugin
  // I metadata UI (label, icon, description) sono centralizzati in /core/admin/adminConfig.json5
  // Es. plugins/adminUsers/adminWebSections/usersManagment/ e plugins/adminUsers/adminWebSections/rolesManagment/
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
Source (plugin):       plugins/adminUsers/adminWebSections/usersManagment/
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
     - Verify directory `plugins/{pluginName}/adminWebSections/{sectionId}/` exists
     - Create symlink: `core/admin/webPages/{sectionId} → plugins/{pluginName}/adminWebSections/{sectionId}/`

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
mkdir -p plugins/admin{Feature}/adminWebSections/{sectionId}
```

✅ **Step 2: Create required files**
- [ ] `main.js` with `loadPlugin()`, `getRouteArray()`, etc.
- [ ] `pluginConfig.json5` with `adminSections` array
- [ ] `pluginDescription.json5`
- [ ] `adminWebSections/{sectionId}/index.ejs` (section directory with EJS files)

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

### Admin Plugin Best Practice — Twin Admin Plugin (`admin<Name>`)

A **service plugin** that needs a configuration/management UI **SHOULD ship its admin interface as a separate "twin" admin plugin**, named `admin` + the service plugin name with a capitalized first letter (camelCase preserved). The service plugin stays lean (logic only); the admin twin owns the GUI.

**Established pairs:**

| Service plugin | Twin admin plugin |
|----------------|-------------------|
| `seo` | `adminSeo` |
| `bootstrapNavbar` | `adminBootstrapNavbar` |
| `media` | `adminMedia` |
| `analytics` | `adminAnalytics` |
| `rateLimiter` | `adminRateLimiter` |

**Division of responsibilities:**

- **Service plugin** — domain logic, runtime state, the shared-object API, and its own `.json5` config files (e.g. `protectedRoutes.json5`). **No admin UI.**
- **Twin admin plugin** — the admin section(s) (GUI). It depends on the service plugin (`dependency: { "<service>": "^x.y.z" }`), resolves the service's folder via `pluginSys.getPlugin('<service>').pathPluginFolder` to read/write its config files, and pulls its shared object via `pluginSys.getSharedObject('<service>')` for live data and actions.

**Why split:**
- ✅ The service stays usable **headless** — installable/runnable without the admin twin (no GUI weight, no admin dependencies).
- ✅ Clear separation of concerns — the admin twin can be disabled or removed independently.
- ✅ Consistent discovery — admin plugins are auto-detected by the `admin` prefix and serve sections via symlink.

**Special cases:** a few early plugins combine service + admin in a single admin-named plugin (`adminUsers`, `adminAccessControl`) because their domain is itself admin-centric. For **new** service plugins, prefer the twin split.

### Admin GUI Conventions — The Three Views ("Le Tre Viste")

Admin plugins that provide a UI should follow a shared philosophy so the panel stays consistent and every plugin remains both power-user-friendly and approachable. The principle: **an admin section exposes up to three coordinated "views" over the same underlying state/file**, added as needed.

#### The three views

| View | Purpose | When | Reference implementation |
|------|---------|------|--------------------------|
| **A. Data view** | Visualize state/metrics (read-mostly) + live actions | **Mandatory** whenever the plugin has runtime state or statistics | `adminAnalytics/analyticsManagement` (KPI cards + Chart.js + auto-refresh) |
| **B. Raw JSON5 editor** | Edit the real `.json5` file directly | **Always present for configuration** | `adminAccessControl` (pure); `adminSeo/pageRules` (editor + snippets + reference table + unsaved modal) |
| **C. Structured form** | Guided, validated, field-by-field editing | Optional; recommended for rich/complex config | `adminSeo/globalSettings` (tabbed form + JSON5 toolbar + feature-status badges) |

- **A** is non-negotiable when there is data to show: never force an admin to read raw files to understand live state.
- **B** is the ground truth and the fallback: always available for config, so a power user — or a field the form doesn't cover yet — is never blocked.
- **C** is sugar on top of B for complex configs; it never replaces B.

#### Coordination rules (B ↔ C)

When both the form (C) and the raw editor (B) are present, they edit the **same file**:
1. **Single source of truth** = the `.json5` file on disk.
2. **Shared validation**, always **server-side** before any save (reuse the service plugin's own validator).
3. **Explicit switching** between views ("load form from JSON5" / "regenerate JSON5 from form") with an **unsaved-changes warning** (modal), as in `adminSeo/pageRules`.
4. **Atomic writes** (temp + rename) + backups where it makes sense (as in `adminBootstrapNavbar`).

#### Cross-cutting rules (always)

- **i18n** via the `__()` global helper (it/en).
- **Bootstrap 5, responsive** — tabs collapse to a `<select>` on mobile (see `adminSeo/globalSettings`).
- **XSS-escaped** dynamic output, especially user-controlled data (IPs, URLs) — use `escapeHtml`.
- **Access control**: routes declare `access` with the right roles; sensitive config → `[0, 1]` (root/admin).
- **Propagation**: prefer **hot-reload** (the service plugin exposes `reload*()` on its shared object); for settings created once at boot, offer **"Save & restart"** (`pluginSys.requestRestart`) — safe when the plugin persists its state across restart.
- **Live actions** (if the plugin has runtime state) go through the **shared object** (same process) for immediate effect — no file round-trip.

#### Decision guide

| The section manages… | Provide views |
|----------------------|---------------|
| Only data/metrics | A |
| Simple, tabular config | B (+ assists) |
| Rich/complex config | B + C (coordinated) |
| Data **and** config | A + B (+ C), as section tabs |

#### Checklist for a new admin GUI

- [ ] Twin admin plugin named `admin<Service>`, depending on the service plugin
- [ ] Data view with live refresh if there is runtime state/metrics
- [ ] Raw JSON5 editor for every editable config file (Validate + Save)
- [ ] Optional structured form coordinated with the JSON5 editor (shared validator)
- [ ] Server-side validation + atomic write (+ backup) on every save
- [ ] i18n labels, responsive tabs, escaped output
- [ ] Correct `access` roles on all routes
- [ ] Hot-reload via shared object, or "Save & restart" for boot-time settings

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

### Access Control System (adminAccessControl plugin)

The **adminAccessControl** plugin provides a comprehensive, pattern-based access control system for managing permissions across all pages and routes in ital8cms. It features automatic priority resolution, mandatory route protection, and a user-friendly admin interface.

**Key Features:**
- ✅ **Pattern Matching:** Exact, wildcard (*,**), and regex patterns
- ✅ **Automatic Priority:** More specific patterns automatically win conflicts
- ✅ **Mandatory Access Field:** All plugin routes MUST declare access requirements
- ✅ **Hybrid Architecture:** JSON rules for pages + code-level protection for plugin routes
- ✅ **Admin UI:** Visual editor with JSON5 syntax support
- ✅ **Boot Validation:** Comprehensive validation prevents misconfigurations
- ✅ **Immutable Hardcoded Rules:** Core protections cannot be modified

---

#### Architecture Overview

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| **AccessManager** | `lib/accessManager.js` | Core access control logic, middleware creation, rule loading |
| **PatternMatcher** | `lib/patternMatcher.js` | Pattern matching engine with automatic priority calculation |
| **RuleValidator** | `lib/ruleValidator.js` | Comprehensive validation (syntax, roles, conflicts, patterns) |
| **Configuration** | `accessControl.json5` | Central configuration file (hardcoded + custom rules) |
| **Admin UI** | `adminWebSections/adminAccessControl/index.ejs` | Visual editor for managing access rules |
| **Access Denied Page** | `webPages/access-denied.ejs` | Custom 403 page for authenticated users without permission |

**Flow:**

```
Request → AccessManager Middleware → Pattern Matcher → Rule Matched?
                                           ↓                ↓ no
                                        yes ↓           Apply Default Policy
                                           ↓
                              Check Authentication → Check Roles → Allow/Deny
```

---

#### Configuration File: accessControl.json5

**Location:** `/plugins/adminAccessControl/accessControl.json5`

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "version": "1.0.0",

  // HARDCODED RULES (immutable, cannot be modified via UI)
  "hardcodedRules": {
    "/admin/**": {
      "requiresAuth": true,
      "allowedRoles": [0, 1],  // Only root (0) and admin (1)
      "priority": 100,          // Optional: system auto-calculates if omitted
      "editable": false
    }
  },

  // CUSTOM RULES (user-defined, managed via admin UI)
  "customRules": {
    // Example: Protect specific pages
    "/my-protected-page": {
      "requiresAuth": true,
      "allowedRoles": [0, 1, 102]  // root, admin, custom role 102
    },

    // Example: Public page override
    "/public/**": {
      "requiresAuth": false,
      "allowedRoles": []
    },

    // Example: Regex pattern
    "regex:^/download/.*\\.pdf$": {
      "requiresAuth": true,
      "allowedRoles": [0, 1, 2]  // root, admin, editor
    }
  },

  // DEFAULT POLICY (when no rule matches)
  "defaultPolicy": {
    "action": "allow",  // "allow" | "deny" | "requireAuth"
    "redirectOnDenied": "/pluginPages/adminUsers/login.ejs"
  }
}
```

**Rule Fields:**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `requiresAuth` | Yes | Boolean | Whether authentication is required |
| `allowedRoles` | Yes | Array\<Number\> | Role IDs that can access (empty = all authenticated users) |
| `priority` | No | Number | Manual priority (auto-calculated if omitted) |
| `editable` | No | Boolean | Marks hardcoded rules (false = immutable) |

---

#### Pattern Matching with Automatic Priority

The system supports three pattern types with automatic priority resolution:

**1. Exact Match** (Priority: 1000)
```json5
"/admin/users": { ... }
```
Matches only: `/admin/users`

**2. Wildcard - Single Level** `*` (Priority: 300)
```json5
"/admin/*": { ... }
```
Matches: `/admin/users`, `/admin/settings`
Does NOT match: `/admin/users/edit` (multiple levels)

**3. Wildcard - Recursive** `**` (Priority: 100)
```json5
"/admin/**": { ... }
```
Matches: `/admin/users`, `/admin/users/edit`, `/admin/settings/general` (all levels)

**4. Regex** (Priority: 500)
```json5
"regex:^/download/.*\\.pdf$": { ... }
```
Matches: `/download/file.pdf`, `/download/document.pdf`
Prefix `regex:` is **mandatory**

**Priority Resolution:**

When multiple patterns match the same URL, the most specific pattern wins:

```
Exact (1000) > Regex (500) > Wildcard-Single (300) > Wildcard-Recursive (100)
```

**Example:**
```json5
{
  "/admin/**": { requiresAuth: true, allowedRoles: [0, 1] },           // Priority: 100
  "/admin/users": { requiresAuth: true, allowedRoles: [0, 1, 2] },     // Priority: 1000 (WINS!)
  "regex:^/admin/.*": { requiresAuth: true, allowedRoles: [0] }        // Priority: 500
}
```

For URL `/admin/users`, the exact match wins (priority 1000).

---

#### Mandatory Access Field for Plugin Routes

**CRITICAL:** All plugin routes **MUST** include an `access` field. Missing this field causes a **fatal boot error**.

**Standard Route Format:**

```javascript
// In plugins/myPlugin/main.js
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    // PUBLIC ROUTE
    {
      method: 'GET',
      path: '/public-page',
      access: {
        requiresAuth: false,
        allowedRoles: []  // Empty = everyone (no authentication needed)
      },
      handler: async (ctx) => {
        ctx.body = 'Public content';
      }
    },

    // AUTHENTICATED ROUTE (all logged-in users)
    {
      method: 'GET',
      path: '/user-dashboard',
      access: {
        requiresAuth: true,
        allowedRoles: []  // Empty = all authenticated users
      },
      handler: async (ctx) => {
        ctx.body = `Welcome, ${ctx.session.user.username}!`;
      }
    },

    // ADMIN-ONLY ROUTE
    {
      method: 'POST',
      path: '/admin/delete-user',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1]  // Only root (0) and admin (1)
      },
      handler: async (ctx) => {
        // Delete user logic
      }
    },

    // ROLE-SPECIFIC ROUTE
    {
      method: 'GET',
      path: '/editor/content',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1, 2, 103]  // root, admin, editor, custom role 103
      },
      handler: async (ctx) => {
        // Editor-specific content
      }
    }
  ];
}
```

**Common Patterns:**

| Access Pattern | Configuration |
|----------------|---------------|
| Public (no auth) | `{ requiresAuth: false, allowedRoles: [] }` |
| All authenticated | `{ requiresAuth: true, allowedRoles: [] }` |
| Admin only | `{ requiresAuth: true, allowedRoles: [0, 1] }` |
| Root only | `{ requiresAuth: true, allowedRoles: [0] }` |
| Specific roles | `{ requiresAuth: true, allowedRoles: [0, 1, 102, 105] }` |

---

#### Admin UI for Managing Access Rules

**Access:** `http://localhost:3000/admin/adminAccessControl/`
**Requires:** Root (0) or Admin (1) role

**Features:**

1. **JSON5 Editor:**
   - Single textarea for complete `accessControl.json5` file
   - Syntax highlighting and validation
   - Comments and trailing commas supported

2. **Real-Time Validation:**
   - Syntax checking before save
   - Role existence verification
   - Pattern validity testing
   - Conflict detection

3. **Hardcoded Rules Protection:**
   - Hardcoded rules displayed but cannot be modified
   - UI prevents submission if hardcoded rules changed
   - Server-side validation enforces immutability

4. **Pattern Documentation:**
   - Built-in reference for pattern syntax
   - Priority explanation
   - Example rules

5. **Test Access Simulator:** *(Future Feature)*
   - Test URL against current rules
   - See which rule matches
   - Preview access decision

**Editing Workflow:**

1. Navigate to `/admin/adminAccessControl/`
2. Edit `customRules` section in the JSON5 editor
3. Click "Save Changes"
4. System validates:
   - JSON5 syntax
   - Required fields present
   - Roles exist in `userRole.json5`
   - Patterns are valid
   - No conflicts with plugin routes
   - Hardcoded rules unchanged
5. If valid: Rules saved, middleware auto-reloads
6. If invalid: Error message displayed, changes rejected

---

#### Validation System

**Boot-Time Validation:**

When the server starts, `RuleValidator` performs comprehensive checks:

1. **JSON5 Syntax:** File parses without errors
2. **Required Fields:** `requiresAuth`, `allowedRoles` present in all rules
3. **Pattern URLs:** No invalid characters, regex compiles successfully
4. **Role Existence:** All role IDs exist in `/plugins/adminUsers/userRole.json5`
5. **Plugin Route Conflicts:** Custom rules DO NOT define routes owned by plugins
6. **Hardcoded Rules:** Immutable rules have `editable: false`

**If validation fails:** Server **DOES NOT START**, errors logged to console.

**Runtime Validation (Admin UI):**

When saving from admin interface, additional checks:

1. All boot-time validations
2. **Hardcoded Immutability:** Submitted hardcodedRules match original (byte-for-byte JSON comparison)
3. **No Breaking Changes:** Modifications won't break active sessions

**If validation fails:** Changes rejected, error message shown, file unchanged.

---

#### Default Policy

When a URL doesn't match any pattern, the **defaultPolicy** determines access:

**Action Types:**

| Action | Behavior |
|--------|----------|
| `"allow"` | Everyone can access (default) |
| `"deny"` | Nobody can access (403 for all) |
| `"requireAuth"` | Only authenticated users (redirect if not logged in) |

**Example:**

```json5
"defaultPolicy": {
  "action": "requireAuth",
  "redirectOnDenied": "/pluginPages/adminUsers/login.ejs"
}
```

With `"requireAuth"`, unauthenticated users visiting any unmatched URL are redirected to login.

---

#### Access Denied Page

**Location:** `/plugins/adminAccessControl/webPages/access-denied.ejs`
**URL:** `/pluginPages/adminAccessControl/access-denied.ejs`

**Shown When:**
- User is **authenticated** but lacks required role
- Alternative to 403 status code
- Provides user-friendly explanation

**Content:**
- User information (username, current roles)
- Required roles for the requested page
- Link to homepage
- Admin note (if user is admin)

---

#### Migration Guide: Adding Access Field to Existing Plugins

**Before:** (Old plugin without access field)
```javascript
getRouteArray() {
  return [
    {
      method: 'GET',
      path: '/my-route',
      handler: async (ctx) => { /* ... */ }
    }
  ];
}
```

**After:** (With mandatory access field)
```javascript
getRouteArray() {
  return [
    {
      method: 'GET',
      path: '/my-route',
      access: {
        requiresAuth: false,  // or true if authentication needed
        allowedRoles: []      // or [0, 1, ...] for specific roles
      },
      handler: async (ctx) => { /* ... */ }
    }
  ];
}
```

**Steps:**

1. **Identify Route Type:** Public, authenticated, or role-restricted?
2. **Add Access Field:** Choose appropriate configuration
3. **Test Server Start:** Ensure no validation errors
4. **Test Access:** Verify permissions work as expected

---

#### Testing Access Control

**Manual Testing:**

1. **Start Server:**
   ```bash
   node index.js
   ```
   Check for validation errors in console

2. **Test Public Routes:**
   ```bash
   curl http://localhost:3000/api/myPlugin/public-route
   ```
   Should return 200 OK

3. **Test Protected Routes (Unauthenticated):**
   ```bash
   curl http://localhost:3000/api/adminUsers/userList
   ```
   Should redirect to login or return 401

4. **Test Protected Routes (Authenticated without Role):**
   - Login as user without required role
   - Access protected route
   - Should redirect to access-denied.ejs

5. **Test Admin UI:**
   - Login as admin (role 0 or 1)
   - Navigate to `/admin/adminAccessControl/`
   - Modify customRules
   - Save and verify changes applied

6. **Test Pattern Matching:**
   - Add wildcard rule: `"/test/**": { requiresAuth: true, allowedRoles: [] }`
   - Access `/test/page1` → should require auth
   - Access `/test/page1/subpage` → should require auth
   - Access `/other/page` → follows default policy

**Automated Testing:** *(Recommended for production)*

```javascript
// Example test suite (using Jest)
describe('Access Control System', () => {
  test('Public route allows unauthenticated access', async () => {
    const response = await request(app).get('/api/myPlugin/public');
    expect(response.status).toBe(200);
  });

  test('Protected route redirects unauthenticated users', async () => {
    const response = await request(app).get('/api/adminUsers/userList');
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('login');
  });

  test('Admin-only route denies non-admin users', async () => {
    // Login as regular user (role 3)
    const response = await request(app)
      .get('/api/adminUsers/deleteUser')
      .set('Cookie', regularUserCookie);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('access-denied');
  });
});
```

---

#### Troubleshooting

**Server Won't Start:**

```
Error: adminAccessControl: Configuration validation failed.
  - customRules["regex:^/invalid["]: Invalid regex pattern
```

**Solution:** Fix regex syntax in `accessControl.json5`

---

**Plugin Route Conflict:**

```
FATAL: Rule conflict detected! Pattern "/api/myPlugin/**" in customRules
matches plugin route "/api/myPlugin/endpoint" (plugin: myPlugin).
```

**Solution:** Remove pattern from customRules - plugin routes must declare `access` in their code

---

**Hardcoded Rules Modification Attempt:**

```
Cannot modify hardcodedRules section. This section is read-only.
```

**Solution:** Only edit `customRules` section. Hardcoded rules protect critical system paths.

---

**Role Not Found:**

```
customRules["/my-page"]: Role 999 not found in userRole.json5 (WARNING)
```

**Solution:** Ensure role ID exists in `/plugins/adminUsers/userRole.json5`

---

**Pattern Not Matching:**

If a pattern doesn't match as expected:

1. Check pattern syntax:
   - Exact: no wildcards or regex prefix
   - Wildcard: use `*` (single level) or `**` (recursive)
   - Regex: prefix with `regex:` and escape special chars
2. Verify priority: more specific patterns win
3. Test with access simulator (coming soon)
4. Check console logs for AccessManager decisions

---

#### Best Practices

1. **✅ Use Hardcoded Rules for Critical Paths:**
   ```json5
   "hardcodedRules": {
     "/admin/**": { requiresAuth: true, allowedRoles: [0, 1], editable: false }
   }
   ```

2. **✅ Prefer Specific Patterns Over Broad Wildcards:**
   ```json5
   // GOOD: Specific control
   "/admin/users": { allowedRoles: [0, 1, 2] },
   "/admin/settings": { allowedRoles: [0, 1] }

   // OK but less precise:
   "/admin/**": { allowedRoles: [0, 1] }
   ```

3. **✅ Always Add Access Field to Plugin Routes:**
   - Never omit the field
   - Be explicit about requirements
   - Test during development

4. **✅ Use Custom Roles for Granular Permissions:**
   ```json5
   {
     "requiresAuth": true,
     "allowedRoles": [0, 1, 102, 105]  // Include custom roles for flexibility
   }
   ```

5. **✅ Document Pattern Intent:**
   ```json5
   // Protect all download URLs requiring editor role
   "regex:^/download/.*\\.pdf$": {
     "requiresAuth": true,
     "allowedRoles": [0, 1, 2]  // root, admin, editor
   }
   ```

6. **⚠️ Don't Define Plugin Routes in JSON:**
   - Plugin routes managed in code via `access` field
   - JSON rules for non-plugin pages only

7. **⚠️ Test Default Policy:**
   - Understand fallback behavior
   - Set appropriate action (`allow`, `deny`, `requireAuth`)

---

#### API Endpoints

**adminAccessControl Plugin Routes:**

```
GET  /api/adminAccessControl/rules
     Returns all rules (hardcoded + custom)
     Access: { requiresAuth: true, allowedRoles: [0, 1] }

GET  /api/adminAccessControl/rules-json
     Returns accessControl.json5 as string
     Access: { requiresAuth: true, allowedRoles: [0, 1] }

POST /api/adminAccessControl/rules
     Saves modified rules (validates before save)
     Body: { jsonContent: "..." }
     Access: { requiresAuth: true, allowedRoles: [0, 1] }

POST /api/adminAccessControl/test-access (Future)
     Tests URL against current rules
     Body: { url: "/test", userId: 1 }
     Access: { requiresAuth: true, allowedRoles: [0, 1] }
```

---

#### File Locations

| File | Path | Purpose |
|------|------|---------|
| Plugin Main | `/plugins/adminAccessControl/main.js` | Plugin logic, middleware, endpoints |
| Configuration | `/plugins/adminAccessControl/accessControl.json5` | Access rules (hardcoded + custom) |
| Access Manager | `/plugins/adminAccessControl/lib/accessManager.js` | Core access control logic |
| Pattern Matcher | `/plugins/adminAccessControl/lib/patternMatcher.js` | Pattern matching engine |
| Rule Validator | `/plugins/adminAccessControl/lib/ruleValidator.js` | Validation engine |
| Admin UI | `/plugins/adminAccessControl/adminWebSections/adminAccessControl/index.ejs` | Visual editor |
| Access Denied Page | `/plugins/adminAccessControl/webPages/access-denied.ejs` | Custom 403 page |
| Plugin Config | `/plugins/adminAccessControl/pluginConfig.json5` | Plugin configuration |
| Admin Registration | `/core/admin/adminConfig.json5` | Admin section metadata |

---

#### Future Enhancements

- [ ] **Access Simulator:** Test URLs against rules in admin UI
- [ ] **Audit Log:** Track access attempts and denials
- [ ] **IP-Based Rules:** Allow/deny based on IP address
- [ ] **Time-Based Rules:** Restrict access by time of day/week
- [ ] **Rate Limiting:** Per-route request throttling
- [ ] **EJS Template Function:** `passData.accessControl.check()` for page-level control
- [ ] **Export/Import Rules:** Backup and restore access configurations
- [ ] **Visual Rule Builder:** GUI for creating rules without JSON editing

---

### SEO Plugin

#### Overview

The **seo** plugin manages SEO (Search Engine Optimization) for ital8cms. It injects meta tags, Open Graph, Twitter Cards, canonical URLs, and structured data (JSON-LD) into the `<head>` of all pages via the hook system. It also generates `sitemap.xml` and `robots.txt` as physical files in the wwwPath directory.

**Key Features:**
- ✅ **Feature toggles:** Every feature individually disableable (meta tags, OG, Twitter, canonical, JSON-LD, sitemap, robots.txt)
- ✅ **Per-page rules:** SEO rules in `seoPages.json5` with pattern matching (exact, wildcard, regex)
- ✅ **Multilingual support:** Strada B3 — independent from simpleI18n, reads `ctx.state.lang` if available
- ✅ **Sitemap auto-scan:** Scans only wwwPath directory + manual extra pages
- ✅ **Diff before overwrite:** Only updates files when content changes
- ✅ **Admin auto-noindex:** Automatically injects `noindex, nofollow` on admin pages
- ✅ **Debug mode:** Re-reads `seoPages.json5` on every request
- ✅ **On-demand regeneration:** API endpoint for sitemap/robots.txt regeneration
- ✅ **Zero dependencies:** No required plugin dependencies

**Plugin Structure:**

```
plugins/seo/
├── main.js                    # Plugin entry point
├── pluginConfig.json5         # Configuration + defaults + feature toggles
├── pluginDescription.json5    # Plugin metadata
├── seoPages.json5             # Per-page SEO rules (pattern matching)
└── lib/
    ├── metaTagGenerator.js    # Meta tags, OG, Twitter Cards, canonical URL
    ├── structuredData.js      # JSON-LD (Organization, WebSite)
    ├── sitemapGenerator.js    # sitemap.xml generation (auto-scan + extras)
    └── robotsTxtGenerator.js  # robots.txt generation
```

**Weight:** 5 (after simpleI18n -10, before bootstrapNavbar 10)

---

#### Multilingual Support (Strada B3)

The plugin is **completely independent** from simpleI18n. Text fields in `seoPages.json5` support two formats:

**Format 1 — Simple string (monolingual site):**
```json5
"title": "Azienda XYZ - Soluzioni innovative"
```

**Format 2 — Multilingual object:**
```json5
"title": { "it": "Azienda XYZ - Soluzioni", "en": "XYZ Corp - Solutions" }
```

**Resolution cascade:**
1. If value is a string → used as-is
2. If value is a multilingual object:
   a. If `ctx.state.lang` exists (simpleI18n active) → uses matching language
   b. Otherwise → uses first available language in the object

**Growth path:**
- Monolingual, no i18n → use simple strings. Works.
- Preparing for multilingual → convert to objects `{ "it": "..." }`. Works (first language fallback).
- Activate simpleI18n → add `"en": "..."` to objects. Works automatically.

---

#### Configuration (pluginConfig.json5)

All settings are in the `custom` block:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `siteName` | string | `""` | Site name (used in OG, structured data) |
| `siteUrl` | string | `""` | Base URL (e.g., `"https://www.example.com"`) |
| `enableMetaTags` | boolean | `true` | `<meta name="description">`, keywords, robots |
| `enableOpenGraph` | boolean | `true` | `<meta property="og:*">` tags |
| `enableTwitterCards` | boolean | `true` | `<meta name="twitter:*">` tags |
| `enableCanonicalUrl` | boolean | `true` | `<link rel="canonical">` |
| `enableStructuredData` | boolean | `true` | JSON-LD `<script>` (Organization + WebSite) |
| `enableSitemap` | boolean | `true` | Generate `sitemap.xml` in wwwPath |
| `enableRobotsTxt` | boolean | `true` | Generate `robots.txt` in wwwPath |
| `canonicalCleanUrl` | boolean | `true` | Remove `.ejs` extension from canonical URLs |
| `defaultDescription` | string | `""` | Fallback description |
| `defaultKeywords` | string | `""` | Fallback keywords |
| `defaultRobots` | string | `"index, follow"` | Fallback robots directive |
| `defaultOgType` | string | `"website"` | Fallback OG type |
| `defaultOgImage` | string | `""` | Fallback OG image path |
| `twitterCardType` | string | `"summary_large_image"` | Twitter Card type |
| `twitterHandle` | string | `""` | Twitter/X handle |
| `sitemapAutoScan` | boolean | `true` | Auto-scan wwwPath for .ejs files |
| `sitemapDefaultChangefreq` | string | `"monthly"` | Default sitemap changefreq |
| `sitemapDefaultPriority` | number | `0.5` | Default sitemap priority (0.0-1.0) |
| `sitemapExclude` | array | `[...]` | Patterns to exclude from auto-scan |
| `sitemapExtraPages` | array | `[]` | Manual extra pages for sitemap |

---

#### Per-Page Rules (seoPages.json5)

Rules use the same pattern matching system as adminAccessControl (via `/core/patternMatcher.js`):

| Pattern Type | Priority | Example | Matches |
|-------------|----------|---------|---------|
| Exact | 1000 | `"/about.ejs"` | Only `/about.ejs` |
| Regex | 500 | `"regex:^/product/\\d+$"` | `/product/42` |
| Wildcard single | 300 | `"/blog/*.ejs"` | `/blog/post.ejs` |
| Wildcard recursive | 100 | `"/admin/**"` | `/admin/users/edit` |

**Supported fields per page:**

```json5
{
  "/path": {
    "title": "..." | { "it": "...", "en": "..." },
    "description": "..." | { "it": "...", "en": "..." },
    "keywords": "..." | { "it": "...", "en": "..." },
    "robots": "index, follow",
    "ogType": "website",
    "ogImage": "/path/to/image.jpg",
    "twitterCardType": "summary_large_image",
    "sitemap": { "priority": 0.8, "changefreq": "weekly" },
    // or
    "sitemap": false  // Exclude from sitemap
  }
}
```

---

#### Sitemap Generation

- **Auto-scan:** Scans only the wwwPath directory for `.ejs` files
- **Index files:** Detected via `ital8Config.json5` → `indexFiles.wwwPath` array, mapped to directory URL
- **Clean URLs:** If `canonicalCleanUrl: true`, extensions removed from sitemap URLs
- **Exclusion:** Patterns in `sitemapExclude` + `"sitemap": false` in seoPages.json5
- **Extra pages:** Added from `sitemapExtraPages` config
- **Physical file:** Generated at `{wwwPath}/sitemap.xml`
- **Diff check:** Only overwrites if content changed (atomic write: temp + rename)

---

#### robots.txt Generation

- **Physical file:** Generated at `{wwwPath}/robots.txt`
- **Configurable:** User-Agent, Allow, Disallow rules in `robotsTxtRules`
- **Auto sitemap link:** Appended if `enableSitemap: true` and `siteUrl` is set
- **Diff check:** Only overwrites if content changed

---

#### API Endpoint

```
POST /api/seo/regenerate
  Regenerates sitemap.xml and robots.txt
  Returns: { sitemap: { changed, pages }, robotsTxt: { changed } }
  Access: { requiresAuth: true, allowedRoles: [0, 1] }
```

---

#### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/seo/main.js` | Plugin entry point |
| `/plugins/seo/pluginConfig.json5` | Configuration + defaults |
| `/plugins/seo/seoPages.json5` | Per-page SEO rules |
| `/plugins/seo/lib/metaTagGenerator.js` | Meta tags, OG, Twitter, canonical |
| `/plugins/seo/lib/structuredData.js` | JSON-LD generation |
| `/plugins/seo/lib/sitemapGenerator.js` | Sitemap generation |
| `/plugins/seo/lib/robotsTxtGenerator.js` | robots.txt generation |
| `/core/patternMatcher.js` | Shared pattern matching utility |

---

#### Future Enhancements

- [ ] **X-Robots-Tag HTTP headers** — Alternative to meta robots for non-HTML files (v2)
- [ ] **BreadcrumbList structured data** — Navigation breadcrumbs in JSON-LD
- [ ] **LocalBusiness structured data** — For local businesses with physical address
- [ ] **Additional schema.org types** — Article, Product, FAQ, Event
- [ ] **Plugin `adminSeo`** — Admin UI for managing SEO rules and settings
- [ ] **hreflang tags** — Advanced multilingual SEO with alternate language links
- [ ] **Canonical for paginated pages** — Handle pagination correctly
- [ ] **Social preview** — Test OG/Twitter previews in admin panel
- [ ] **Auto-detect protected pages** — Read accessControl rules to exclude auth-required pages from sitemap

---

### Rate Limiter Plugin

#### Overview

The **rateLimiter** plugin protects sensitive routes (typically the login) from brute-force attacks via an **escalating block engine** (fail2ban-style): after N failed attempts within a window an IP gets a **short block** (e.g. 5 minutes); after accumulating too many short blocks it escalates to a **long block** (e.g. days). It is configurable **only via `.json5` files** — a future `adminRateLimiter` plugin will add a GUI (out of scope here).

**Key Features:**
- ✅ **Escalation:** short block → (after `maxShortBlocks`) long block
- ✅ **Keyed by `IP + ruleName`:** a block on login does not block other rules
- ✅ **Two enforcement layers:** guard (shared object) + middleware
- ✅ **State survives restart:** in-memory + periodic atomic snapshot to `state/activeBlocks.json5`
- ✅ **Audit trail:** append-only `logs/attempts.jsonl` with size rotation + retention cleanup
- ✅ **Optional & graceful:** consumers use `if (rl)` fallback; if disabled, `getSharedObject` returns `null`
- ✅ **Proxy-aware:** optional `trustProxy` to read `X-Forwarded-For`

**Plugin Structure:**

```
plugins/rateLimiter/
├── main.js                    # loadPlugin, getMiddlewareToAdd (L2), getObjectToShareToOthersPlugin (L1)
├── pluginConfig.json5         # defaults, enforcement, logging, state, proxy
├── pluginDescription.json5
├── protectedRoutes.json5      # per-rule policy overrides (keyed by ruleName)
├── state/                     # runtime: activeBlocks.json5 (gitignored)
├── logs/                      # runtime: attempts.jsonl + archive/ (gitignored)
└── lib/
    ├── rateLimitEngine.js     # escalation engine (pure, clock-injectable)
    ├── keyResolver.js         # client IP/key from ctx (proxy handling)
    ├── attemptLog.js          # JSONL audit + rotation + retention
    ├── stateStore.js          # active-state persistence (atomic write)
    └── configValidator.js     # boot validation
```

#### ⚠️ Why a guard, not just a middleware

Plugin middlewares (`getMiddlewareToAdd`) are mounted **after the router** (see `index.js`). For an already-matched API route whose handler does not call `next()` — exactly the case of `POST /api/adminUsers/login` — **the plugin middleware never runs**. So a pre-route blocking middleware **cannot** guard the login API. The block must be invoked **inside the handler**, via the shared object. (This mirrors why API routes use the `access` field while pages use the `adminAccessControl` middleware.)

#### Level 1 — Guard (shared object)

Consumer plugins pull the shared object on-demand and invoke the guard inside their handler. Key = `IP + ruleName`.

```javascript
const rl = pluginSys.getSharedObject('rateLimiter'); // null if plugin inactive
if (rl) {
  const verdict = rl.checkCtx(ctx, 'adminLogin');     // { blocked, tier, retryAfterSeconds }
  if (verdict.blocked) { /* redirect with error=rateLimited&retryAfter=... */ return; }
}
// ... attempt the sensitive operation ...
if (ok) { if (rl) rl.recordSuccessCtx(ctx, 'adminLogin'); }   // reset counters
else    { if (rl) rl.recordFailureCtx(ctx, 'adminLogin'); }   // may trigger a block
```

**Shared object API:** `keyFromCtx(ctx)`, `checkCtx(ctx, ruleName)`, `recordFailureCtx(ctx, ruleName)`, `recordSuccessCtx(ctx, ruleName)`, `guardCtx(ctx, ruleName)` (writes 429 + `Retry-After`, returns `true` if blocked), plus key-based variants `check/recordFailure/recordSuccess(clientId, ruleName)`, `getActiveBlocks()`, `getRuleNames()`.

The `adminUsers` login handler is already wired to rule `adminLogin` with the `if (rl)` fallback; `login.ejs` shows a localized "too many attempts, retry in N minutes" message on `?error=rateLimited`.

#### Level 2 — Enforcement (middleware)

A `getMiddlewareToAdd()` middleware acting on **fall-through** requests (pages, not matched API routes). It denies access when:
1. `enforcement.globalLongBlock` (default `true`): the IP has an active **long block** on any rule → denied site-wide (the prolonged IP ban).
2. a rule declares a `pathPattern` (PatternMatcher: `*`/`**`/`regex:`) that matches the request path **and** the IP is blocked for that rule (short or long).

`enforcement.exemptPaths` always pass (default: `/admin/**` + theme resources, to avoid self-lockout). Response is `enforcement.status` (default `429`) + `Retry-After`, or `enforcement.redirectTo` if set.

#### Configuration (`pluginConfig.json5` → `custom`)

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Global on/off (off → shared object is `null`) |
| `trustProxy` | `false` | Read client IP from `X-Forwarded-For` (only behind a trusted proxy) |
| `defaults.findWindowSeconds` | `900` | Window to accumulate failures |
| `defaults.maxFailures` | `5` | Failures in window → short block |
| `defaults.shortBlockSeconds` | `300` | Short block duration |
| `defaults.maxShortBlocks` | `5` | Short blocks before escalating to long block |
| `defaults.longBlockSeconds` | `86400` | Long block duration |
| `defaults.escalationResetSeconds` | `86400` | Inactivity after which escalation memory resets |
| `state.flushIntervalSeconds` | `30` | State snapshot interval (`0` = immediate) |
| `log.enabled` / `log.rotateWhenBytes` / `log.retentionDays` | `true` / `1048576` / `30` | JSONL audit + rotation + retention |
| `response.status` / `response.retryAfterHeader` | `429` / `true` | `guardCtx` response |
| `enforcement.enabled` / `globalLongBlock` / `status` / `redirectTo` / `exemptPaths` | `true` / `true` / `429` / `""` / `[...]` | Level 2 middleware |
| `sweepIntervalSeconds` | `60` | Periodic cleanup of expired blocks |
| `enableLogging` | `true` | Console log of events |
| `strictValidation` | `false` | Crash boot on validation errors |

**`protectedRoutes.json5`** — array of rules identified by `name`; policy fields are optional and override `defaults`. Optional `pathPattern` activates Level 2 page enforcement for that rule.

#### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/rateLimiter/main.js` | Entry point, Level 2 middleware, Level 1 shared object |
| `/plugins/rateLimiter/lib/rateLimitEngine.js` | Escalation engine |
| `/plugins/rateLimiter/lib/keyResolver.js` | Client IP/key resolution |
| `/plugins/rateLimiter/lib/attemptLog.js` | JSONL audit + rotation + retention |
| `/plugins/rateLimiter/lib/stateStore.js` | Active-state persistence |
| `/plugins/rateLimiter/lib/configValidator.js` | Boot validation |
| `/plugins/rateLimiter/protectedRoutes.json5` | Per-rule policy |
| `/plugins/rateLimiter/tests/` | Test suite (7 files, 77 tests): engine, keyResolver, configValidator, attemptLog, stateStore, main.js integration |

#### Future Enhancements

- [ ] **Plugin `adminRateLimiter`** — Admin UI to manage rules, view active blocks and the audit log
- [ ] **Distributed state** — Shared store for multi-process (PM2 cluster) deployments (current state is in-memory, single-process)
- [ ] **Allow/deny lists** — Per-IP/CIDR exemptions and permanent bans
- [ ] **Per-account keying** — Optionally key by username in addition to IP

---

### Admin Rate Limiter Plugin

#### Overview

The **adminRateLimiter** plugin is the **twin admin GUI** for the `rateLimiter` service (see *Twin Admin Plugin* + *The Three Views* conventions). It adds the `rateLimiterManagement` admin section to monitor blocks, act on them live, and edit the rate limiter's configuration. All routes require root/admin roles `[0, 1]`.

It runs in the **same process** as `rateLimiter`, so it pulls live data/actions via the shared object (`pluginSys.getSharedObject('rateLimiter')`) and resolves the service's folder for config files via `pluginSys.getPlugin('rateLimiter').pathPluginFolder`. If the service is present but disabled (`custom.enabled=false`), the GUI shows a "disabled" banner.

#### The three views (one section, three pages)

| Page | View | Content |
|------|------|---------|
| `index.ejs` | **A — Data** | KPI cards, active-blocks table (with Unblock), manual-ban form, audit log; auto-refresh |
| `rules.ejs` | **B — Raw JSON5 editor** | `protectedRoutes.json5` (Validate / Save) + field reference |
| `settings.ejs` | **B — Raw JSON5 editor** | `pluginConfig.json5` → `custom` block (Validate / Save / Save & restart) |

#### API endpoints (roles `[0, 1]`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/adminRateLimiter/status` | `{ enabled, stats, activeBlocks, ruleNames }` |
| `GET` | `/api/adminRateLimiter/attempts` | Audit tail (`limit`, `clientId/ruleName/event` filters) |
| `POST` | `/api/adminRateLimiter/unblock` | `{clientId, ruleName}` → `releaseBlock` |
| `POST` | `/api/adminRateLimiter/ban` | `{clientId, ruleName, seconds, tier?}` → `banClient` |
| `GET` / `POST` | `/api/adminRateLimiter/rules` | Load / save `protectedRoutes.json5` (save: validate → backup → atomic write → `reloadRules`) |
| `POST` | `/api/adminRateLimiter/validate-rules` | Validate rules without saving |
| `GET` / `POST` | `/api/adminRateLimiter/config` | Load / save the `custom` block (save: validate → backup → `editJson5('custom')` → `reloadConfig`) |
| `POST` | `/api/adminRateLimiter/validate-config` | Validate config without saving |
| `POST` | `/api/adminRateLimiter/restart` | `pluginSys.requestRestart` (active blocks persist) |

#### Propagation

- **Live actions** (unblock/ban) act on the in-memory engine → immediate.
- **Rules** and **defaults/enforcement** save + `reloadRules()`/`reloadConfig()` → **hot**, no restart.
- **Infrastructural params** (`trustProxy`, `state.flushIntervalSeconds`, `log.*`, `sweepIntervalSeconds`) are boot-time → **"Save & restart"** (`requestRestart`); safe because the rateLimiter stateStore persists blocks across restart.

#### Implementation notes

- Settings save uses **`core/editJson5`** to surgically replace only the `custom` block, preserving `active`/`dependency`/comments elsewhere. Rules save writes the raw editor content (comments preserved).
- Validation is **reused** from the service via `validateRules`/`validateConfig` on the shared object. Writes are atomic (`lib/configFileManager.js`) with rotating backups (`maxBackupsPerFile`).
- **Config:** `custom.auditLimit` (100), `custom.autoRefreshSeconds` (5), `custom.maxBackupsPerFile` (10). Dependencies: `rateLimiter ^1.0.0`, `bootstrap ^1.0.0`, `simpleI18n ^1.0.0`; node module `json5`.

---

### CSRF Protection Plugin

#### Overview

The **csrfProtection** plugin defends against **Cross-Site Request Forgery** on every state-changing route (POST/PUT/DELETE/PATCH), the login included. It implements **defense in depth** with two independent layers and enforces them **centrally in the core route-wrap** (not per-handler), so coverage is transparent across all `/api/*` routes.

**Why CSRF is a real risk here:** authorization for every API route is established solely by the session cookie (`pluginSys.#wrapHandlerWithAccessCheck` checks `ctx.session`). With no server-side token or Origin check, the app relied entirely on the browser's implicit `SameSite=Lax` default — which (a) is a client-side mitigation, not an app control, and (b) does **not** cover the same-site sub-domain vector. This plugin closes that gap.

**Key Features:**
- ✅ **Synchronizer token (per-session):** random 256-bit token in `ctx.session.csrfToken` (signed cookie → not forgeable, not readable cross-origin), **rotated on login**
- ✅ **Origin/Referer check:** dynamic same-origin (rebuilt from request Host, proxy-aware), with optional allowlist; **token-fallback** when both headers are absent
- ✅ **Central enforcement:** validated inside the core route-wrap, **before** the auth check → covers public mutating routes like `POST /login`
- ✅ **Transparent client integration:** a page-hook injects a `<meta>` token + an interceptor that patches **both `fetch` and `XMLHttpRequest`** to add `X-CSRF-Token` on same-origin mutating requests; global helpers `csrfField()`/`csrfToken()` for classic forms
- ✅ **Optional & graceful:** if disabled, the shared object returns `null` and the core wrap skips validation
- ✅ **Exemptions:** `exemptPaths` (pattern via `core/patternMatcher.js`) for future webhooks / server-to-server APIs

**Plugin Structure:**

```
plugins/csrfProtection/
├── main.js                    # lifecycle, middleware (ensure token), head hook, shared object, global helpers
├── pluginConfig.json5         # custom config (all toggleable)
├── pluginDescription.json5
└── lib/
    ├── tokenManager.js        # generateToken (base64url 256-bit) + safeEqual (constant-time)
    ├── originValidator.js     # expected origin (proxy-aware) + Origin/Referer validation
    ├── requestGuard.js        # evaluate(ctx, custom, matcher) — pure validation logic
    ├── configValidator.js     # boot-time config validation
    └── clientInterceptor.js   # inline <script> that patches fetch + XMLHttpRequest
```

#### Architecture & token lifecycle

```
1. GENERATE  → plugin middleware (runs before page render): ensures ctx.session.csrfToken
2. DELIVER   → getHooksPage('head'): <meta name="csrf-token"> + fetch/XHR interceptor;
               csrfField()/csrfToken() global helpers for classic forms
3. VALIDATE  → core: pluginSys.#wrapHandlerWithAccessCheck pulls the shared object and
               calls csrf.validateRequest(ctx) on mutating methods, BEFORE the auth check
4. ROTATE    → adminUsers login handler: if (csrf) csrf.rotateToken(ctx) after success
```

**Why a core hook and not (only) a middleware:** plugin middlewares are mounted **after** the router (see `index.js`), so they cannot pre-block an already-matched API route like `POST /login`. Validation must run inside the route-wrap (which executes within the router). The plugin middleware only generates the token for page rendering. *(Same architectural lesson as `rateLimiter`.)*

**Request token source:** header `X-CSRF-Token` (fetch/XHR/multipart upload) **or** body `_csrf` (classic urlencoded forms, parsed by bodyParser before the router). For multipart uploads the body isn't parsed at wrap-time, so the token must arrive via the header (the interceptor handles this).

#### Configuration (`pluginConfig.json5` → `custom`)

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Off → shared object is `null`, core wrap skips validation |
| `protectedMethods` | `["POST","PUT","DELETE","PATCH"]` | Mutating methods to protect (`DEL`≡`DELETE`) |
| `tokenHeaderName` | `"X-CSRF-Token"` | Header used by fetch/XHR |
| `tokenFieldName` | `"_csrf"` | Hidden field used by classic forms |
| `metaName` | `"csrf-token"` | `<meta>` name the interceptor reads |
| `trustProxy` | `false` | Read `X-Forwarded-Host/Proto` (only behind a trusted proxy) |
| `originCheck.enabled` | `true` | Enable the Origin/Referer layer |
| `originCheck.allowedOrigins` | `[]` | Extra allowed origins beyond same-origin |
| `exemptPaths` | `[]` | Patterns exempt from protection (`core/patternMatcher`) |
| `failureStatus` | `403` | HTTP status on validation failure |
| `enableLogging` | `true` | Console-log blocked requests |
| `strictValidation` | `false` | Crash boot on config validation errors |

#### Shared-object API (pull via `pluginSys.getSharedObject('csrfProtection')`)

`validateRequest(ctx)` → `{ ok, status?, error?, reason? }` (used by the core wrap) · `ensureToken(ctx)` · `rotateToken(ctx)` · `getToken(ctx)`. For the admin twin (`adminCsrfProtection`): `getStats()` (counters + flags), `getRecentBlocks(limit)` (in-memory audit), `simulate(input)` (CSRF tester), `getConfig()`, `validateConfig(newCustom)`, `reloadConfig()` (hot-reload after a Save).

#### Template helpers

```ejs
<%# Classic form — hidden input with the token %>
<form method="POST" action="/api/adminUsers/login">
  <%- csrfField(passData) %>
  ...
</form>

<%# Raw token (for custom JS / meta) %>
<script>const token = '<%= csrfToken(passData) %>';</script>
```

Both are whitelisted in `ital8Config.json5 → globalFunctionsWhitelist` (`required: false` → if the plugin is off, the fallback renders `''`). Fetch/XHR need **no** code change: the injected interceptor adds the header automatically.

#### Why the related `SameSite=lax` hardening is necessary

Even with token + Origin check, setting `sameSite: 'lax'` explicitly on the session cookie (`core/priorityMiddlewares/koaSession.json5`) adds value:
1. **Defense in depth, zero cost:** a second, independent barrier. If a route ever bypassed the wrap or the interceptor regressed, Lax still reduces cookie attachment on cross-**site** POSTs.
2. **Determinism:** removes reliance on the browser's implicit "Lax-by-default", which varies by browser/version. The behavior is now explicit and documented in the cookie itself.
3. **Covers methods the token doesn't:** the token guards only mutating methods; any future GET-based sensitive action would be unprotected by the token → there SameSite is the only barrier.

⚠️ **Precise scope:** `SameSite=lax` does **not** stop the *same-site sub-domain* vector (Lax cookies are sent to same-site origins) — that is covered by the **token**. The `__Host-` prefix (which would block sub-domain cookie-tossing) is **not** applied because it requires Secure + `path=/` and would break plain-HTTP (port 3000) and local dev; consider it in HTTPS-only deployments.

#### Reference Files

| File | Purpose |
|------|---------|
| `/plugins/csrfProtection/main.js` | Lifecycle, middleware, head hook, shared object, global helpers |
| `/plugins/csrfProtection/lib/tokenManager.js` | Token generation + constant-time compare |
| `/plugins/csrfProtection/lib/originValidator.js` | Origin/Referer validation (proxy-aware) |
| `/plugins/csrfProtection/lib/requestGuard.js` | Pure request-validation logic |
| `/plugins/csrfProtection/lib/clientInterceptor.js` | fetch/XHR interceptor script |
| `/core/pluginSys.js` | Enforcement hook in `#wrapHandlerWithAccessCheck` |
| `/core/priorityMiddlewares/koaSession.json5` | `SameSite=lax` hardening |
| `/tests/e2e/csrfHelper.js` | E2E helpers (token extraction + `postWithCsrf`) |

#### Future Enhancements

- [x] **Twin admin plugin `adminCsrfProtection`** — GUI (Data view + JSON5 editor) — *implemented, see below*
- [ ] **Per-request token rotation** (currently per-session) as an opt-in stricter mode
- [ ] **`__Host-` cookie prefix** as an opt-in for HTTPS-only deployments
- [ ] **CSP-friendly delivery** — option to serve the interceptor as an external script (for strict `Content-Security-Policy` without inline scripts)

---

### Admin CSRF Protection Plugin

#### Overview

The **adminCsrfProtection** plugin is the **twin admin GUI** for the `csrfProtection` service (see *Twin Admin Plugin* + *The Three Views* conventions). It adds the `csrfManagement` admin section to monitor CSRF blocks, test the policy, and edit the protection settings. All routes require root/admin roles `[0, 1]`.

It runs in the **same process** as `csrfProtection`, so it pulls live data/actions via the shared object (`pluginSys.getSharedObject('csrfProtection')`) and resolves the service's folder for the config file via `pluginSys.getPlugin('csrfProtection').pathPluginFolder`. If the service is present but disabled (`custom.enabled=false`), the GUI shows a "disabled" banner.

#### The two views (one section, two pages)

| Page | View | Content |
|------|------|---------|
| `index.ejs` | **A — Data** | KPI cards (origin-check, total blocks, blocks by reason, exemptions) + **recent CSRF blocks** table + **CSRF tester** (simulate a request); auto-refresh |
| `settings.ejs` | **B — Raw JSON5 editor** | `pluginConfig.json5 → custom` (Validate / Save / Save & restart) + field reference |

The **CSRF tester** (`simulate`) lets you input method + path + request Origin + token-present and see the exact verdict (`allowed` / `blocked` + reason) — instructive for understanding exemptions and the Origin layer.

#### API endpoints (roles `[0, 1]`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/adminCsrfProtection/status` | `{ enabled, stats }` |
| `GET` | `/api/adminCsrfProtection/recent` | Recent blocks (`limit` query) |
| `POST` | `/api/adminCsrfProtection/simulate` | CSRF tester → verdict |
| `GET` / `POST` | `/api/adminCsrfProtection/config` | Load / save the `custom` block (save: validate → backup → `editJson5('custom')` → `reloadConfig`) |
| `POST` | `/api/adminCsrfProtection/validate-config` | Validate config without saving |
| `POST` | `/api/adminCsrfProtection/restart` | `pluginSys.requestRestart` (for enabling the plugin from disabled) |

#### Propagation

- **Live data** (stats/recent/simulate) read the in-memory state of the service → immediate.
- **Settings** save + `reloadConfig()` → **hot** for the policy (methods, originCheck, exemptPaths, failureStatus, …). The only case needing a restart is **enabling the plugin from a disabled boot** (middleware + head hook are registered once at boot) → use **"Save & restart"**.

#### Implementation notes

- Settings save uses **`core/editJson5`** to replace only the `custom` block (preserving `active`/`dependency`/comments). Atomic writes + rotating backups (`lib/configFileManager.js`, `maxBackupsPerFile`).
- The admin pages' own `fetch` POSTs (validate/save/simulate) are protected by CSRF too: the **interceptor** injected by `csrfProtection` adds `X-CSRF-Token` automatically (admin pages carry the `<meta>`), so the client JS needs no token handling.
- **Config:** `custom.auditLimit` (100), `custom.autoRefreshSeconds` (5), `custom.maxBackupsPerFile` (10). Dependencies: `csrfProtection ^1.0.0`, `bootstrap ^1.0.0`, `simpleI18n ^1.0.0`; node module `json5`.

---

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
GET /api/bootstrap/js/bootstrap.bundle.min.js
GET /api/bootstrap/js/bootstrap.bundle.min.js.map
```

### Creating New Routes

1. Add route definition in plugin's `getRouteArray()`:

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'GET',
      path: '/my-endpoint',
      handler: async (ctx) => {
        ctx.body = { message: 'Hello' }
      }
    },
    {
      method: 'POST',
      path: '/create-item',
      handler: async (ctx) => {
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

  // HTTPS configuration (see "HTTPS Configuration" section for full docs)
  "https": {
    "enabled": false,                         // true = abilita HTTPS
    "port": 443,                              // Porta HTTPS
    "AutoRedirectHttpPortToHttpsPort": false, // true = redirect 301 HTTP→HTTPS
    "certFile": "./certs/fullchain.pem",      // Certificato server
    "keyFile": "./certs/privkey.pem",         // Chiave privata
    "caFile": "",                             // CA intermedia (opzionale)
    "tlsOptions": {},                         // Opzioni TLS avanzate (opzionale)
  },

  // Hide file extension from URLs (clean URLs, requires koa-classic-server v2.6.1+)
  "hideExtension": {
    "wwwPath":            { "enabled": false, "ext": ".ejs" },
    "pluginPagesPrefix":  { "enabled": false, "ext": ".ejs" },
    "adminPrefix":        { "enabled": false, "ext": ".ejs" }
  },

  // Priority Middlewares Configuration
  "priorityMiddlewares": {
    "session": true             // Optional middleware (true=enabled, false=disabled)
  }
}
```

### Hide Extension (Clean URLs)

The `hideExtension` feature leverages `koa-classic-server` v2.6.1+ to serve pages without the file extension in the URL. Each of the three EJS-rendering koa-classic-server instances can be configured independently.

**Configuration in `ital8Config.json5`:**

```json5
{
  "hideExtension": {
    "wwwPath":            { "enabled": false, "ext": ".ejs" },
    "pluginPagesPrefix":  { "enabled": false, "ext": ".ejs" },
    "adminPrefix":        { "enabled": false, "ext": ".ejs" }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | `true` = hide extension, `false` = show extension (default) |
| `ext` | string | Extension to hide, including the dot (e.g., `".ejs"`, `".pug"`) |

**Contexts:**

| Key | koa-classic-server Instance | URL Example (enabled) |
|-----|----------------------------|----------------------|
| `wwwPath` | Public pages (`/www`) | `/about` instead of `/about.ejs` |
| `pluginPagesPrefix` | Plugin pages (`/pluginPages/`) | `/pluginPages/adminUsers/login` instead of `/pluginPages/adminUsers/login.ejs` |
| `adminPrefix` | Admin pages (`/admin/`) | `/admin/usersManagment/index` instead of `/admin/usersManagment/index.ejs` |

**Backward compatibility:** When enabled, existing links with the extension (e.g., `/about.ejs`) continue to work via automatic redirect provided by `koa-classic-server`.

**Not applied to:** Theme resource instances (public and admin) since they serve static assets (CSS, JS, images) whose extensions should remain visible.

**Future use:** The per-context `ext` field allows different template engines per context (e.g., `wwwPath` using `".pug"` while `adminPrefix` uses `".ejs"`).

### Priority Middlewares Configuration

Priority middlewares are loaded **before everything else** in a fixed, guaranteed order. They provide foundational infrastructure for the entire application.

**Configuration in `ital8Config.json5`:**

```json5
{
  "priorityMiddlewares": {
    "session": true  // Gestione sessioni (true = attivo, false = disattivato)
  }
}
```

**Middleware Types:**

| Middleware | Type | Default | Description |
|-----------|------|---------|-------------|
| `bodyParser` | **CORE** | Always active | Parses request bodies (JSON, form data). **Hardcoded, non-configurable**. |
| `session` | **OPTIONAL** | `true` | Manages user sessions (koa-session). Required for authentication. |
| `router` | **CORE** | Always active | Main routing system (@koa/router). **Hardcoded, non-configurable**. |

**Loading Order (fixed, non-modifiable):**
```
1. bodyParser  → Parse request body
2. session     → Initialize ctx.session (if enabled)
3. router      → Route matching and handler execution
```

**Why This Order:**
- `bodyParser` MUST be first → Otherwise `ctx.request.body` is undefined in route handlers
- `session` MUST be before `router` → Otherwise `ctx.session` is undefined in route handlers
- `router` MUST be last → Can safely use body and session in all route handlers

**Disabling Optional Middlewares:**

```json5
{
  "priorityMiddlewares": {
    "session": false  // Disable session management
  }
}
```

⚠️ **Warning:** Disabling `session` will cause:
- `ctx.session` to be `undefined` in all code
- Authentication plugins (like `adminUsers`) to fail
- Admin panel login to stop working

**Only disable if:** Your application doesn't need user authentication at all.

### HTTPS Configuration

#### Overview

ital8cms supports HTTPS natively through Node.js's built-in `https` module. All HTTPS settings are grouped in the `https` block of `ital8Config.json5`. The three legacy flat variables (`useHttps`, `httpsPort`, `AutoRedirectHttpPortToHttpsPort`) have been removed.

#### Configuration Block

```json5
// In ital8Config.json5
{
  "httpPort": 3000,

  "https": {
    "enabled": false,                         // true = abilita HTTPS
    "port": 443,                              // Porta HTTPS (default 443)
    "AutoRedirectHttpPortToHttpsPort": false, // true = redirect 301 HTTP→HTTPS
    "certFile": "./certs/fullchain.pem",      // Percorso certificato server
    "keyFile": "./certs/privkey.pem",         // Percorso chiave privata
    "caFile": "",                             // CA intermedia (opzionale, "" = disabilitato)
    "tlsOptions": {},                         // Opzioni TLS avanzate (opzionale)
  },
}
```

#### Fields Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | `true` = abilita HTTPS, `false` = HTTP puro |
| `port` | number | Yes | Porta HTTPS (tipicamente 443) |
| `AutoRedirectHttpPortToHttpsPort` | boolean | Yes | Se `true`, il server HTTP su `httpPort` risponde solo con redirect 301 verso HTTPS |
| `certFile` | string | If enabled | Percorso al certificato server (es. `fullchain.pem` di Let's Encrypt). Assoluto o relativo alla root del progetto. |
| `keyFile` | string | If enabled | Percorso alla chiave privata (es. `privkey.pem`). Assoluto o relativo. |
| `caFile` | string | No | Percorso alla CA intermedia (es. `chain.pem`). Stringa vuota `""` = disabilitato. |
| `tlsOptions` | object | No | Opzioni raw passate a `https.createServer()`. Vengono unite **prima** di certFile/keyFile/caFile, che hanno sempre priorità. Utile per `ciphers`, `secureProtocol`, `requestCert`, ecc. |

#### Behavioral Scenarios

**Scenario 1: `enabled: false` (default)**

Solo HTTP su `httpPort`.

```
httpPort:3000 → App Koa completa
```

**Scenario 2: `enabled: true` + `AutoRedirectHttpPortToHttpsPort: false`**

Due server paralleli: HTTPS completo + HTTP completo.

```
httpPort:3000  → App Koa completa (HTTP)
https.port:443 → App Koa completa (HTTPS)
```

**Scenario 3: `enabled: true` + `AutoRedirectHttpPortToHttpsPort: true`**

HTTPS completo + HTTP minimale che redirige.

```
httpPort:3000  → redirect 301 → https://hostname[:port]/path
https.port:443 → App Koa completa (HTTPS)
```

La porta 443 viene **omessa** dall'URL di redirect (standard HTTP). Porte non-standard (es. 8443) vengono incluse.

**Scenario 4: `enabled: true` + certificati mancanti o illeggibili**

Fallback automatico a HTTP puro + warning visivo prominente con istruzioni actionable.

```
[HTTPS] ══════════════════════════════════════════════════════════
[HTTPS]  ⚠  HTTPS abilitato ma certificati mancanti
[HTTPS] ══════════════════════════════════════════════════════════
[HTTPS]    certFile: ./certs/fullchain.pem  ← non trovato
[HTTPS]    keyFile:  ./certs/privkey.pem  ← non trovato
[HTTPS]
[HTTPS]  Opzione A — genera un certificato self-signed (sviluppo locale):
[HTTPS]
[HTTPS]    mkdir -p certs
[HTTPS]    openssl req -x509 -newkey rsa:2048 \
[HTTPS]      -keyout certs/privkey.pem \
[HTTPS]      -out certs/fullchain.pem \
[HTTPS]      -days 365 -nodes \
[HTTPS]      -subj "/CN=localhost" \
[HTTPS]      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
[HTTPS]
[HTTPS]  Opzione B — disabilita HTTPS in ital8Config.json5:
[HTTPS]
[HTTPS]    "https": { "enabled": false }
[HTTPS]
[HTTPS]  ▶ Avvio in HTTP puro sulla porta 3000 (fallback)
[HTTPS] ══════════════════════════════════════════════════════════
httpPort:3000 → App Koa completa (HTTP - fallback)
```

**Comportamento di dettaglio:**
- Se manca **solo** il cert → `← non trovato` appare solo sulla riga `certFile`, il titolo usa il singolare
- Se manca **solo** la key → `← non trovato` appare solo sulla riga `keyFile`
- Se mancano **entrambi** → entrambe le righe annotate, titolo al plurale
- Errori di altro tipo (permessi, file corrotto) → `console.error` generico (catch separato)

#### Let's Encrypt Setup (esempio pratico)

```json5
"https": {
  "enabled": true,
  "port": 443,
  "AutoRedirectHttpPortToHttpsPort": true,
  "certFile": "/etc/letsencrypt/live/example.com/fullchain.pem",
  "keyFile": "/etc/letsencrypt/live/example.com/privkey.pem",
  "caFile": "/etc/letsencrypt/live/example.com/chain.pem",
  "tlsOptions": {},
},
```

#### Self-Signed Certificate (sviluppo locale)

```bash
# Genera certificato self-signed con SAN (richiesto da Chrome >= 58)
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

**Nota:** il flag `-addext "subjectAltName=..."` è necessario perché i browser moderni (Chrome ≥ 58, Firefox, Safari) rifiutano i certificati che hanno solo `CN=localhost` senza Subject Alternative Name (SAN). Senza SAN il browser mostra `ERR_CERT_COMMON_NAME_INVALID` anche se Node.js accetta la connessione.

```json5
"https": {
  "enabled": true,
  "port": 3443,
  "AutoRedirectHttpPortToHttpsPort": false,
  "certFile": "./certs/fullchain.pem",
  "keyFile": "./certs/privkey.pem",
  "caFile": "",
  "tlsOptions": {},
},
```

Accesso: `https://localhost:3443` (browser mostrerà warning per self-signed, normale in sviluppo).

#### Implementation Notes

- `http` e `https` sono moduli built-in di Node.js — nessuna dipendenza npm aggiuntiva
- La logica di avvio è centralizzata in `core/httpsManager.js`, esportata come `start(app, router, ital8Conf)` e chiamata da `index.js`
- `app.callback()` viene chiamato invece di `app.listen()` per poter passare l'app Koa sia a `http.createServer()` che a `https.createServer()`
- `tlsOptions` viene unito con spread (`...tlsOptions`) **prima** di `cert`/`key`/`ca`, garantendo che i percorsi file abbiano sempre priorità
- **Warning certificati mancanti** (`warnMissingCertificates()` in `httpsManager.js`):
  - Effettua un controllo `fs.existsSync()` **pre-emptivo** prima di tentare `readFileSync()`
  - Distingue quale file è assente (`certFile`, `keyFile`, o entrambi) — annotazione `← non trovato` solo sul file mancante
  - Emette un box ASCII visivo con bordi `═══`, difficile da ignorare nello scroll del terminale
  - Include il comando `openssl` esatto con SAN e lo snippet per disabilitare HTTPS
  - Il server **continua ad avviarsi** in HTTP puro (fallback — comportamento invariato)
  - Errori diversi da "file not found" (permessi, corruzione) passano al `catch` generico separato

---

### Session Configuration: core/priorityMiddlewares/koaSession.json5

**IMPORTANT:** Le chiavi (`keys`) firmano i cookie di sessione (`signed: true`). I valori committed nel repo sono **placeholder condivisi**: chiunque cloni il progetto li conosce e potrebbe forgiare cookie di sessione validi (impersonazione). **Vanno sostituiti con chiavi casuali in produzione.**

```json5
{
  "keys": [ /* placeholder committati — sostituire con chiavi casuali */ ],
  "CONFIG": {
    "key": "koa:sess",
    "maxAge": 86400000,               // 24 hours
    "autoCommit": true,
    "overwrite": true,
    "httpOnly": true,
    "signed": true,
    "rolling": false,
    "renew": false,
    "sameSite": "lax"                 // difesa in profondità anti-CSRF
  }
}
```

#### Rotazione automatica delle chiavi (install + boot)

Due meccanismi coordinati gestiscono la sicurezza delle chiavi:

**1. Wizard d'installazione (`npm run start-configure`)** — In FASE 1 (configurazione globale) il wizard propone uno step dedicato alle chiavi di sessione (`scripts/lib/sessionKeyManager.js`):

- Menu a tre voci: **Genera nuove chiavi casuali** / **Inserisci chiavi personalizzate** / **Mantieni le chiavi correnti**.
- **Default adattivo:** "Genera" se le chiavi correnti sono i placeholder, "Mantieni" se già personalizzate (evita di invalidare sessioni esistenti in una re-init).
- Generazione: **3 chiavi** `crypto.randomBytes(32).toString('base64url')` (256-bit, URL-safe).
- Scrittura tramite `core/editJson5` (sostituisce **solo** il campo `keys`, preservando tutti i commenti) con backup preventivo via `BackupManager`. I valori delle chiavi **non** vengono mai loggati.
- Gira sia per il profilo `production` sia `demo`; saltato solo nella re-init `plugins`.

**2. Avviso al boot (`core/sessionSecurity.js → checkSessionKeys()`)** — All'avvio del server (`index.js`), se la sessione è attiva e le chiavi sono ancora placeholder, viene emesso un box ASCII di warning (stile `httpsManager.warnMissingCertificates()`). Il server parte comunque (non bloccante). Salta da sé se la sessione è disabilitata.

**Fonte unica della logica di rilevamento** (`core/sessionSecurity.js`): la denylist `PLACEHOLDER_SESSION_KEYS` e il predicato `keysAreInsecure(keys)` sono condivisi tra il wizard (install-time) e il warning al boot (runtime), mantenendo la direzione di dipendenza corretta (tooling → core).

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
        method: 'GET',
        path: '/hello',
        handler: async (ctx) => {
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
        method: 'GET',
        path: '/mypage',
        handler: async (ctx) => {
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

6. **XSS Prevention in EJS Templates**

The project uses a **defense-in-depth** strategy with two layers:

**Layer 1 — Server-side sanitization (primary defense):**

All API endpoints that return user-controlled data MUST escape HTML before sending to templates:

```javascript
const escapeHtml = require('../../core/escapeHtml');

// In route handler — escape before sending to template
ctx.body = {
  username: escapeHtml(user.username),
  email: escapeHtml(user.email)
};
```

**Layer 2 — Client-side sanitization (defense-in-depth):**

Admin theme includes `escapeHtml.js` globally via `head.ejs`. Use it when inserting dynamic content via `innerHTML`:

```javascript
// Client-side — always escape before innerHTML
element.innerHTML = `<td>${escapeHtml(userData.username)}</td>`;
```

**EJS Tag Rules:**

| Tag | Usage | XSS Safe? |
|-----|-------|-----------|
| `<%= value %>` | Output with HTML escaping | ✅ Yes |
| `<%- value %>` | Output raw HTML (no escaping) | ❌ No — use only for trusted HTML (theme includes, plugin hooks) |

```ejs
<%# SAFE — escaped output %>
<p>Welcome, <%= passData.ctx.session.user.username %></p>

<%# SAFE — trusted theme include %>
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>

<%# DANGEROUS — never use <%- with user data %>
<%# <%- userInput %> → XSS vulnerability! %>
```

**Passing config to client JS — use JS variables, NOT hidden spans:**

```ejs
<%# CORRECT — JS variable with escaped output %>
<script>
  const apiPrefix = '<%= passData.apiPrefix %>';
</script>

<%# WRONG — hidden span pattern (deprecated) %>
<%# <span id="apiPrefix" style="display:none"><%= passData.apiPrefix %></span> %>
```

**Utility files:**
- Server-side: `/core/escapeHtml.js`
- Client-side: `/themes/defaultAdminTheme/themeResources/js/escapeHtml.js`

7. **Open Redirect Prevention**

All redirect URLs from user input MUST be validated:

```javascript
// Use getSafeRedirectUrl() from adminUsers plugin
function getSafeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return '/';
  const trimmed = url.trim();
  // Must start with / but not // or /\ (protocol-relative URLs)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return trimmed;
  }
  return '/'; // Fallback to safe default
}
```

## Common Tasks

### Task: Add a New API Endpoint

```javascript
// In plugins/myPlugin/main.js
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'POST',
      path: '/create-item',
      handler: async (ctx) => {
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
      handler: async (ctx, next) => {
        // Log all requests
        console.log(`${ctx.method} ${ctx.url}`)
        await next()
      }
    },
    {
      handler: async (ctx, next) => {
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

**Current Status:** Jest è installato e configurato. Sono presenti test unitari, test di integrazione e test di sicurezza.

### Test Esistenti

```
tests/
├── unit/
│   ├── bootstrapNavbar/              # 5 file, 187 test
│   │   ├── escapeHtml.test.js
│   │   ├── isActivePage.test.js
│   │   ├── isItemVisible.test.js
│   │   ├── configDir.test.js
│   │   └── rendering.test.js
│   ├── urlRedirect/                  # 3 file, 101 test
│   │   ├── configValidator.test.js
│   │   ├── redirectMatcher.test.js
│   │   └── hitCounter.test.js
│   ├── adminBootstrapNavbar/         # 3 file, 131 test
│   │   ├── navbarValidator.test.js
│   │   ├── navbarFileManager.test.js
│   │   └── navbarTemplates.test.js
│   ├── core/                         # 7 file, 172 test
│   │   ├── servingRootResolver.test.js
│   │   ├── escapeHtml.test.js
│   │   ├── loadJson5.test.js
│   │   ├── saveJson5.test.js
│   │   ├── pluginPagesSystem.test.js
│   │   ├── adminServicesManager.test.js
│   │   ├── configManager.test.js
│   │   └── symlinkManager.test.js
│   ├── xss/                          # 1 file, 172 test
│   │   └── serverSideSanitization.test.js
│   ├── pluginSys.test.js             # 16 test
│   ├── themeSys.test.js              # 36 test
│   ├── accessManager.test.js         # }
│   ├── patternMatcher.test.js        # } 130 test (adminAccessControl)
│   ├── ruleValidator.test.js         # }
│   ├── libAccess.test.js             # }
│   ├── openRedirect.test.js          # 35 test
│   └── logger.test.js                # 13 test
└── integration/                      # 5 file, 140 test
    ├── httpsDiagnostics.test.js
    ├── httpsServer.test.js
    ├── pluginLoading.test.js
    ├── globalPrefix.test.js
    ├── hideExtension.test.js
    └── wwwFilesystem.test.js
```

**Totale: 34 file, 1133 test**

### Eseguire i test

```bash
# Tutti i test
npx jest --verbose

# Solo unit test
npx jest tests/unit --verbose

# Solo test HTTPS (diagnostica)
npx jest tests/integration/httpsDiagnostics.test.js --verbose

# Watch mode (sviluppo)
npx jest --watch
```

### Test di Integrazione HTTPS: httpsDiagnostics.test.js

**File:** `/tests/integration/httpsDiagnostics.test.js`

Il test diagnostico HTTPS è organizzato in 4 fasi indipendenti, ognuna con messaggi di errore actionable. Utile per diagnosticare problemi TLS su qualsiasi installazione.

**Auto-generazione certificati (`ensureTestCertificates()`):**

Il test include un `beforeAll()` globale che, se i file cert/key configurati in `ital8Config.json5` non esistono, li genera automaticamente con `openssl` (incluso SAN per `localhost` e `127.0.0.1`). **Non sovrascrive certificati già presenti.** Se `openssl` non è disponibile nel PATH, mostra istruzioni di installazione per distro.

```
tests/integration/httpsDiagnostics.test.js
│
├── beforeAll: ensureTestCertificates()   ← genera cert se mancanti
│
├── Fase 1 — Pre-flight certificati       (nessun server avviato)
│   • file cert/key esistono e leggibili
│   • PEM parseable come X.509
│   • certificato non scaduto (+ warning se < 7 giorni)
│   • coppia cert/key coerente (stessa chiave pubblica)
│   • SAN include "localhost" o "127.0.0.1" (warning se assente)
│   • diagnostica completa (output informativo)
│
├── Fase 2 — Disponibilità porte          (nessun server avviato)
│   • porta HTTP libera
│   • porta HTTPS libera
│   • porte HTTP e HTTPS diverse
│
├── Fase 3 — TLS isolato                  (server Node.js minimale, senza Koa)
│   • https.createServer() con i cert configurati
│   • handshake TLS completato (rejectUnauthorized: false)
│   • versione TLS e cipher suite (informativo)
│   • comportamento browser-like (rejectUnauthorized: true, informativo)
│
└── Fase 4 — Server completo              (spawn node index.js)
    • porte di test: HTTP 19100, HTTPS 19443 (no conflitti con prod)
    • config temporanea iniettata senza modificare ital8Config.json5 permanentemente
    • server parte senza crash (log di avvio HTTPS ricevuto)
    • log NON contiene errori di caricamento certificati
    • HTTPS risponde su 127.0.0.1:19443
    • HTTP risponde su 127.0.0.1:19100
    • comportamento AutoRedirect verificato (301 o parallelo)
    • riepilogo configurazione finale (informativo)
```

**Porte riservate per i test:**

| Porta | Contesto | Uso |
|-------|----------|-----|
| `19100` | Jest — httpsDiagnostics Fase 4 | HTTP di test (evita conflitti con porta 3000 di produzione) |
| `19200` | Jest — httpsDiagnostics Fase 3 | TLS isolato |
| `19300` | Playwright — globalPrefix E2E | HTTP per test con `globalPrefix` non vuoto |
| `19400` | Playwright — E2E standard | HTTP per test E2E standard (porta dedicata, non collide con server di sviluppo) |
| `19443` | Jest — httpsDiagnostics Fase 4 | HTTPS di test (evita conflitti con porta 3443 di produzione) |

### Isolamento Test E2E dalla directory www/ di produzione

**REGOLA CRITICA:** I test E2E **NON devono mai dipendere** dai file presenti nella directory `/www/` di produzione. Tutti i file necessari ai test devono essere nella directory dedicata `/tests/www/`.

**Motivazione:**
- ✅ La directory `/www/` è l'area di lavoro del developer in produzione — può cambiare liberamente
- ✅ I test non si rompono quando l'utente modifica/aggiunge/rimuove pagine dal sito
- ✅ I file di test sono controllati e prevedibili
- ✅ Isolamento completo tra ambiente di test e ambiente di produzione

**Architettura:**

```
tests/www/                    ← Directory www dedicata ai test
├── index.ejs                 ← Homepage di test
├── hello_word.ejs            ← Pagina di test
├── i18n-test.ejs             ← Test internazionalizzazione
├── prova_thema.ejs           ← Test tema
├── navbar.main.json5         ← Configurazione navbar di test
├── navbarExamples/           ← Esempi navbar
├── reserved/                 ← Area protetta (richiede login)
│   └── index.ejs
├── private/                  ← Area privata (richiede login)
│   └── index.ejs
└── lib/                      ← Area libreria (richiede login)
    └── index.ejs
```

**Come funziona l'isolamento completo:**

Il `globalSetup.js` sovrascrive `ital8Config.json5` **prima** dell'avvio del server di test, applicando 4 override:

```javascript
const { TEST_WWW_PATH, E2E_TEST_HTTP_PORT } = require('./testConstants');

// In globalSetup.js — override COMPLETO della config per i test E2E
configData.wwwPath = TEST_WWW_PATH;              // '/tests/www' (isolamento da /www/)
configData.httpPort = E2E_TEST_HTTP_PORT;         // 19400 (evita conflitti con server dev su 3000)
configData.activeTheme = 'themeForTesting';       // Tema di test dedicato
configData.adminActiveTheme = 'themeForTestingAdmin';
configData.https.enabled = false;                 // HTTPS disabilitato (test verificano routing, non TLS)
```

**Perché la porta dedicata (19400) è fondamentale:**

La directory `/www/` di produzione **NON contiene `index.ejs`** (il file si chiama `__index.ejs`), mentre `/tests/www/` contiene `index.ejs`. Se il server E2E riutilizzasse un server di sviluppo già attivo sulla porta 3000 (che usa `/www/`), i test homepage fallirebbero con:
- `GET /` → "Index of /" (directory listing, nessun `index.ejs` trovato)
- `GET /index.ejs` → 404

La porta dedicata 19400 + `reuseExistingServer: false` in `playwright.config.js` garantiscono che il server E2E parta sempre con la config di test modificata.

**Il flusso completo:**

```
npm test
  ├─ jest (unit + integration) — usa ital8Config.json5 originale
  │   └─ tests/setup.js ripristina config a versione git tra i test
  │
  └─ npx playwright test (E2E)
       ├─ 1. globalSetup.js:
       │     ├─ Backup ital8Config.json5 → .test-bak
       │     ├─ Override: wwwPath, httpPort, themes, HTTPS off
       │     ├─ Backup userAccount.json5 → .test-bak
       │     └─ Aggiunta 4 utenti di test
       │
       ├─ 2. Server avviato: node index.js (porta 19400, www di test)
       │
       ├─ 3. Test E2E eseguiti su http://localhost:19400
       │
       └─ 4. globalTeardown.js:
             ├─ Ripristino ital8Config.json5 da backup
             └─ Ripristino userAccount.json5 da backup
```

Il `globalPrefixSetup.js` applica gli stessi override (compreso `wwwPath = TEST_WWW_PATH`) più `globalPrefix` e `httpPort = 19300`.

**Costanti centralizzate in `testConstants.js`:**

```javascript
const TEST_WWW_PATH = '/tests/www';    // Directory www di test
const E2E_TEST_HTTP_PORT = 19400;                // Porta HTTP dedicata E2E
```

**Quando aggiungere nuovi file a tests/www/:**

Se un nuovo test E2E necessita di una pagina web specifica:
1. Creare il file EJS in `tests/www/` (NON in `/www/`)
2. Aggiornare questa documentazione se la struttura cambia significativamente
3. Verificare che il file segua le convenzioni dei template (inclusione dei partial del tema, ecc.)

**Quando NON servono file in tests/www/:**

I seguenti path sono serviti da altre directory e NON necessitano di file nella www di test:
- `/api/*` → serviti dai route handler dei plugin
- `/admin/*` → serviti da `core/admin/webPages/`
- `/pluginPages/*` → serviti da `plugins/{pluginName}/webPages/`
- `/public-theme-resources/*` → serviti dalla directory del tema
- `/admin-theme-resources/*` → serviti dalla directory del tema admin

### Aggiungere Nuovi Test

**Unit test per un nuovo plugin:**
```
tests/unit/myPlugin/
└── myFeature.test.js
```

**Convenzioni:**
- Unit test: testano funzioni pure esportate dal modulo (`module.exports`)
- Integration test: testano comportamento end-to-end (spawn server, richieste HTTP reali)
- E2E test: usano Playwright, serviti dalla directory `tests/www/` (MAI dalla `/www/` di produzione)
- Ogni test deve essere indipendente e non modificare file permanentemente

## Testing Conventions for Plugins and Themes

### Overview

Oltre ai test del core in `/tests/`, **ogni plugin e ogni tema può dichiarare i propri test** in una cartella dedicata. Jest li rileva automaticamente e li esegue come parte della suite complessiva.

**Principi:**
- ✅ **Co-locazione:** i test stanno vicino al codice che testano, nella stessa directory del plugin/tema
- ✅ **Zero configurazione:** basta creare la cartella `tests/` — Jest la trova automaticamente via pattern globale
- ✅ **Filtraggio plugin inattivi:** i test di plugin con `active: 0` vengono esclusi automaticamente
- ✅ **Helper condivisi:** mock factories e utilities in `/core/testHelpers/` per evitare duplicazione
- ✅ **Isolamento filesystem:** i test che scrivono su disco usano `createPluginSandbox()` (mai nella cartella reale del plugin)

### Directory structure

```
plugins/myPlugin/
├── main.js
├── pluginConfig.json5
├── pluginDescription.json5
└── tests/                     # ⭐ scoperta automatica da Jest
    ├── unit/                  # test di funzioni pure esportate
    │   └── feature.test.js
    ├── integration/           # test end-to-end (opzionale)
    │   └── lifecycle.test.js
    └── fixtures/              # fixtures locali del plugin
        └── sampleConfig.json5
```

Stessa struttura per i temi in `themes/myTheme/tests/`.

### File naming

- Test: `*.test.js` o `*.spec.js` (match Jest standard)
- Fixtures: qualsiasi nome, tipicamente `.json5` per coerenza con il resto del progetto

### Shared Test Helpers (`/core/testHelpers/`)

Gli helper condivisi sono disponibili come modulo importabile. Tutti gli export sono accessibili via l'entry point `index.js`:

```javascript
const {
  createCtxMock,
  createPluginSysMock,
  createThemeSysMock,
  createAdminSystemMock,
  runRoute,
  runMiddleware,
  runPageHook,
  validateRoute,
  loadFixture,
  createPluginSandbox
} = require('../../../core/testHelpers');
```

**Path relativo** da un file `plugins/myPlugin/tests/unit/foo.test.js`: `../../../core/testHelpers`.

#### Mock Factories

| Factory | Scopo | Parametri principali |
|---------|-------|----------------------|
| `createCtxMock(options)` | Mock del context Koa | `method`, `path`, `query`, `body`, `session`, `headers`, `state` |
| `createPluginSysMock(options)` | Mock del PluginSys | `sharedObjects`, `plugins`, `hookReturns`, `themeSys`, `globalFunctions` |
| `createThemeSysMock(options)` | Mock del ThemeSys wrapper | `publicTheme`, `adminTheme`, `customizations`, `getThemePartPath` |
| `createAdminSystemMock(options)` | Mock dell'AdminSystem | `ui`, `menuSections`, `services`, `endpoints` |

Tutti i metodi restituiti sono `jest.fn()` — permettono asserzioni come `expect(mock.hookPage).toHaveBeenCalledWith(...)`.

#### Runners

| Runner | Scopo |
|--------|-------|
| `runRoute(route, ctx)` | Valida struttura rotta (method, path, access, handler) ed esegue handler |
| `runMiddleware(middleware, ctx, next?)` | Esegue un middleware; se `next` omesso viene creato come `jest.fn()` |
| `runPageHook(plugin, section, passData, pluginSys?, pathPluginFolder?)` | Esegue `getHooksPage()` del plugin per una sezione |
| `validateRoute(route)` | Ritorna array di problemi senza eseguire l'handler |

#### Utilities

| Utility | Scopo |
|---------|-------|
| `loadFixture(name)` | Carica una fixture JSON5 da `/core/testHelpers/fixtures/` (condivisa tra più plugin) |
| `createPluginSandbox(pluginName, options)` | Crea dir temporanea in `os.tmpdir()` con scaffolding plugin |

### Filesystem isolation (`createPluginSandbox`)

**REGOLA CRITICA:** i test **NON devono mai scrivere** dentro la cartella reale del plugin (es. `plugins/myPlugin/data.json5`). Questo contaminerebbe l'ambiente di sviluppo e rompererebbe il determinismo dei test.

Usare sempre `createPluginSandbox()` per operazioni su filesystem:

```javascript
const { createPluginSandbox } = require('../../../core/testHelpers');

describe('myPlugin file operations', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createPluginSandbox('myPlugin', {
      pluginConfig: { custom: { setting: 'value' } },
      withPluginPages: true,
      withAdminSections: ['mySection']
    });
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  test('writes data file', () => {
    sandbox.writeJson5('data.json5', { items: [1, 2, 3] });
    expect(sandbox.exists('data.json5')).toBe(true);
    const content = sandbox.readFile('data.json5');
    expect(content).toContain('items');
  });
});
```

**API del sandbox:**
- `sandbox.path` — path assoluto della directory plugin isolata
- `sandbox.pluginConfigPath`, `sandbox.pluginDescriptionPath` — path ai file generati
- `sandbox.writeFile(relativePath, content)` — scrive file arbitrario
- `sandbox.writeJson5(relativePath, obj)` — scrive file JSON5 con header standard
- `sandbox.readFile(relativePath)` / `sandbox.exists(relativePath)`
- `sandbox.cleanup()` — **sempre** in `afterEach` / `afterAll`

### Comandi npm

Oltre a `npm test` che esegue tutto, sono disponibili script per filtrare per scope:

```bash
# Tutto: core + plugin + temi (quelli attivi)
npm test

# Solo core del progetto (tests/unit/ e tests/integration/)
npm run test:core

# Solo un plugin specifico
npm run test:plugin --plugin=bootstrapNavbar

# Solo i temi
npm run test:themes
```

**Nota:** `test:plugin` richiede il flag `--plugin=<nomePlugin>`. Il wrapper (`scripts/testRunner.js`) controlla che il plugin esista e emette un warning se la cartella `tests/` è assente.

### Contratto di qualità (consigliato, Fase 1)

In Fase 1 il contratto è **descrittivo**. Un plugin "ben testato" dovrebbe avere:
- Un test unitario per ogni metodo pubblico esportato da `main.js` (`loadPlugin`, `getRouteArray`, `getHooksPage`, ecc.)
- Un test per ogni rotta dichiarata in `getRouteArray()`, incluso il rispetto del contratto `access` (`requiresAuth`, `allowedRoles`)
- Validazione della struttura di `pluginConfig.json5` e `pluginDescription.json5`
- Coverage dei lifecycle hooks (`installPlugin`, `uninstallPlugin`, `upgradePlugin` se implementati)

Per i temi:
- Presenza dei partial richiesti (`head`, `header`, `nav`, `main`, `aside`, `footer`)
- Validità sintattica dei file `.ejs` (parse-only)
- Validazione di `themeConfig.json5`
- Correttezza delle chiamate a `pluginSys.hookPage()`

**Fase 2 (futura):** il contratto diventerà **prescrittivo** con uno scanner al boot del server in `pluginSys` che verifica automaticamente la presenza dei test minimi e emette warning (o fatal error se `testingStrictMode: true`). Vedi sezione "Future Improvements".

### Esempio di riferimento: bootstrapNavbar

Il plugin `bootstrapNavbar` è stato migrato alla nuova convenzione ed è l'**esempio ufficiale** da consultare:

```
plugins/bootstrapNavbar/tests/unit/
├── escapeHtml.test.js      # test funzione pura XSS sanitization
├── isActivePage.test.js    # test detection pagina attiva
├── isItemVisible.test.js   # test filtri visibilità auth/role
├── configDir.test.js       # test risoluzione configDir
└── rendering.test.js       # test pipeline completa di rendering
```

**5 file di test, 187 test, 100% pass rate.**

Eseguibile con: `npm run test:plugin --plugin=bootstrapNavbar`

### Come Jest filtra i plugin/temi inattivi

Il file `tests/jest.config.js` legge all'avvio tutti i `pluginConfig.json5` e `themeConfig.json5`, e aggiunge dinamicamente a `testPathIgnorePatterns` i path dei plugin/temi con `active: 0`. Disattivando un plugin nel config, i suoi test vengono saltati automaticamente senza modifiche al codice.

### Reference files

| File | Scopo |
|------|-------|
| `/core/testHelpers/index.js` | Entry point, re-export di tutti gli helper |
| `/core/testHelpers/pluginSysMock.js` | Factory `createPluginSysMock` |
| `/core/testHelpers/ctxMock.js` | Factory `createCtxMock` |
| `/core/testHelpers/themeSysMock.js` | Factory `createThemeSysMock` |
| `/core/testHelpers/adminSystemMock.js` | Factory `createAdminSystemMock` |
| `/core/testHelpers/routeRunner.js` | `runRoute`, `validateRoute` |
| `/core/testHelpers/middlewareRunner.js` | `runMiddleware` |
| `/core/testHelpers/hooksPageRunner.js` | `runPageHook` |
| `/core/testHelpers/fixtureLoader.js` | `loadFixture` per fixtures condivise |
| `/core/testHelpers/pluginSandbox.js` | `createPluginSandbox` per isolamento FS |
| `/scripts/testRunner.js` | Wrapper per `test:core`, `test:plugin`, `test:themes` |
| `/tests/jest.config.js` | Config Jest con filtro plugin/temi inattivi |

## Demo Install Profile

### Overview

ital8cms supporta due **profili di installazione**, scelti **una-tantum** all'avvio del wizard (`npm run start-configure`). La scelta non è commutabile a runtime: per cambiare profilo si reinstalla da capo.

| Profilo | Utente root | Directory `www/` | Flag `demo` |
|---------|-------------|------------------|-------------|
| **Production** (default) | creato interattivamente da terminale | vuota (l'utente la popola) | `false` |
| **Demo** | seed automatico (`demoRoot`) | popolata con contenuti di esempio | `true` |

Il profilo **demo** serve a **provare il sistema** con un CMS già pre-popolato: utenti di esempio (uno per ruolo), contenuti `www/` di esempio, password unica e nota. **Non è una base di produzione.**

> ⚠️ **Sicurezza:** un'installazione demo ha utenti noti con password condivisa (`demomode`). Non esporla mai in produzione.

### Il flag `demo` (runtime)

`ital8Config.json5 → demo` (boolean, default `false`). È **puramente segnaletico**: non altera il comportamento delle richieste, non blocca l'avvio, non cambia la sicurezza. Quando `true`:

- **Avviso al boot** — box ASCII allo startup (`core/demoNotice.js → printDemoBootWarning()`), chiamato da `index.js` solo se `demo === true` (footprint zero altrimenti).
- **Badge admin** — pill discreto "DEMO" in basso a destra nelle pagine admin, iniettato **theme-agnostic** dentro `pluginSys.hookPage('header')` (gated `this.#ital8Conf.demo && passData.isAdminContext`), via `core/demoNotice.js → getDemoBadgeHtml()`. Nessun tema da modificare.
- `passData.demo` è esposto nei tre builder di `index.js` (public, pluginPages, admin) per uso nei template.

### Seeding: due convenzioni (copia-file)

Il seeding demo è **install-time only** (`scripts/lib/demoSeeder.js`, invocato dal ramo demo del wizard). Mai caricato dal runtime del server → impatto sul codice di produzione nullo. Usa **due convenzioni complementari di copia-file** (merge + overwrite, con backup dei file sovrascritti in `backups/demo-<timestamp>/<relpath>`):

**(A) File co-locato `*.demo.json5`** — override di un singolo file dati di un plugin/core:

```
plugins/<p>/userAccount.demo.json5  →  copiato su  plugins/<p>/userAccount.json5
```

Regola: ogni `X.demo.json5` trovato sotto `plugins/` (scan ricorsivo, esclusi `node_modules`, `tests`, `scripts`, dir nascoste) viene copiato sul gemello `X.json5`. Esempio di riferimento: `plugins/adminUsers/userAccount.demo.json5` e `userRole.demo.json5`.

**(B) Mirror `.demoData/`** — contenuti bulk senza un singolo file-target (pagine, immagini, fixture multi-file):

```
.demoData/www/...      →  www/...
.demoData/plugins/<p>/ →  plugins/<p>/...
.demoData/themes/<t>/  →  themes/<t>/...
```

Solo i top-level `www`, `plugins`, `themes` vengono copiati. `.demoData/` è **contenuto spedito** (committato in git, NON gitignorato).

### Hook opzionale `seedDemo(context)`

Per plugin che richiedono seeding **programmatico** (es. INSERT in un DB invece di copiare un JSON), si espone una funzione **opzionale** in `plugins/<p>/scripts/init.js` (l'area install-time, **non** `main.js`):

```javascript
// plugins/<p>/scripts/init.js
module.exports = {
  getQuestions, run,                 // flusso production (esistente)

  // OPZIONALE: seeding programmatico per il profilo demo
  async seedDemo(context) {
    const { pathPluginFolder, logger, projectRoot } = context;
    // ... crea dati di esempio ...
    return { success: true, message: 'Seed demo creato' };
  }
};
```

Il `demoSeeder` invoca `seedDemo()` su ogni plugin che lo espone. Un errore nell'hook viene loggato come warning e **non** interrompe il seeding.

### Best practice per autori di plugin/temi

Per rendere un plugin/tema "demo-ready":
- **File dati** (un override puntuale) → spedisci `<file>.demo.json5` accanto al file reale (convenzione A).
- **Contenuti multipli** (pagine, asset) → mettili sotto `.demoData/plugins/<tuoPlugin>/` o `.demoData/themes/<tuoTema>/` (convenzione B).
- **Logica di seeding** (DB, generazione dinamica) → implementa `seedDemo(context)` in `scripts/init.js`.
- ⚠️ Il seeding demo **sovrascrive** i file reali (con backup): pensa il contenuto demo come usa-e-getta.

### Reference Files

| File | Scopo |
|------|-------|
| `/ital8Config.json5` | Flag `demo` (default `false`) |
| `/core/demoNotice.js` | Avviso al boot + HTML del badge admin |
| `/core/pluginSys.js` | Iniezione del badge in `hookPage('header')` |
| `/index.js` | `passData.demo` (3 builder) + avviso al boot |
| `/scripts/init.js` | Domanda profilo + ramo demo del wizard |
| `/scripts/lib/demoSeeder.js` | Motore di seeding (convenzioni A + B + hook) |
| `/plugins/adminUsers/userAccount.demo.json5` | Utenti demo di esempio (password `demomode`) |
| `/plugins/adminUsers/userRole.demo.json5` | Ruoli demo (4 hardcoded + 2 custom) |
| `/.demoData/www/` | Contenuti `www/` di esempio (convenzione B) |
| `/tests/unit/demoSeeder.test.js` | Unit test del seeder (12 test, filesystem isolato) |

## Deployment Guidelines

### Pre-Production Checklist

- [ ] Change session keys in `core/priorityMiddlewares/koaSession.json5` (il wizard `npm run start-configure` le genera casuali; un warning al boot avvisa se restano i placeholder)
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
- `/core/servingRootResolver.js` - Serving root path isolation utility
- `/core/patternMatcher.js` - URL pattern matching utility (exact, wildcard, regex) — shared by adminAccessControl and seo plugins
- `/core/sessionSecurity.js` - Session key security: placeholder denylist, `keysAreInsecure()`, boot warning `checkSessionKeys()` (single source of truth)
- `/scripts/lib/sessionKeyManager.js` - Install-time session key tooling: `generateSessionKeys()` + interactive wizard step `configureSessionKeys()`

### Admin System

- `/core/admin/adminConfig.json5` - Central admin configuration
- `/core/admin/adminSystem.js` - Admin coordinator
- `/core/admin/lib/configManager.js` - Config loader & validator
- `/core/admin/lib/adminServicesManager.js` - Service discovery
- `/core/admin/lib/symlinkManager.js` - Symlink manager
- `/core/admin/webPages/index.ejs` - Admin dashboard (dynamic menu)
- `/core/admin/webPages/systemSettings/` - System settings UI
- `/core/admin/webPages/usersManagment/` - Symlink → plugins/adminUsers/adminWebSections/usersManagment/

### Authentication & User Management

- `/plugins/adminUsers/userAccount.json5` - User credentials
- `/plugins/adminUsers/userRole.json5` - Role definitions
- `/plugins/adminUsers/main.js` - Authentication logic
- `/plugins/adminUsers/adminWebSections/usersManagment/` - User management UI files
- `/plugins/adminUsers/adminWebSections/rolesManagment/` - Role management UI files

### Bootstrap Navbar Plugin

- `/plugins/bootstrapNavbar/main.js` - Plugin entry point
- `/plugins/bootstrapNavbar/lib/navbarRenderer.js` - Core rendering engine
- `/core/servingRootResolver.js` - Path isolation utility for configDir
- `/www/navbar.main.json5` - Primary navbar configuration
- `/www/navbarExamples/` - Example navbar configurations (6 files)

### Admin Bootstrap Navbar Plugin

- `/plugins/adminBootstrapNavbar/main.js` - Plugin entry point, routes, preview renderer
- `/plugins/adminBootstrapNavbar/lib/navbarFileManager.js` - Filesystem operations
- `/plugins/adminBootstrapNavbar/lib/navbarTemplates.js` - Predefined templates
- `/plugins/adminBootstrapNavbar/lib/navbarValidator.js` - Validation engine
- `/plugins/adminBootstrapNavbar/pluginConfig.json5` - Plugin configuration
- `/plugins/adminBootstrapNavbar/README.md` - Internal plugin documentation

### URL Redirect Plugin

- `/plugins/urlRedirect/main.js` - Plugin entry point, middleware
- `/plugins/urlRedirect/lib/redirectMatcher.js` - URL matching engine
- `/plugins/urlRedirect/lib/hitCounter.js` - Hit counter with periodic flush
- `/plugins/urlRedirect/lib/configValidator.js` - Boot-time rule validation
- `/plugins/urlRedirect/redirectMap.json5` - Redirect rules
- `/plugins/urlRedirect/redirectHitCount.json5` - Hit counters (auto-generated)

### SEO Plugin

- `/plugins/seo/main.js` - Plugin entry point
- `/plugins/seo/pluginConfig.json5` - Configuration + defaults + feature toggles
- `/plugins/seo/seoPages.json5` - Per-page SEO rules (pattern matching)
- `/plugins/seo/lib/metaTagGenerator.js` - Meta tags, OG, Twitter, canonical
- `/plugins/seo/lib/structuredData.js` - JSON-LD generation (Organization, WebSite)
- `/plugins/seo/lib/sitemapGenerator.js` - Sitemap generation (auto-scan + extras)
- `/plugins/seo/lib/robotsTxtGenerator.js` - robots.txt generation

### Rate Limiter Plugin

- `/plugins/rateLimiter/main.js` - Entry point, Level 2 middleware, Level 1 shared object
- `/plugins/rateLimiter/lib/rateLimitEngine.js` - Escalation engine (short → long block)
- `/plugins/rateLimiter/lib/keyResolver.js` - Client IP/key resolution (proxy handling)
- `/plugins/rateLimiter/lib/attemptLog.js` - JSONL audit log + rotation + retention
- `/plugins/rateLimiter/lib/stateStore.js` - Active-state persistence (survives restart)
- `/plugins/rateLimiter/lib/configValidator.js` - Boot-time validation
- `/plugins/rateLimiter/protectedRoutes.json5` - Per-rule policy (keyed by ruleName)
- `/plugins/rateLimiter/pluginConfig.json5` - Defaults, enforcement, logging, proxy

### Admin Rate Limiter Plugin

- `/plugins/adminRateLimiter/main.js` - Routes (status/attempts/unblock/ban/rules/config/restart), shared-object access
- `/plugins/adminRateLimiter/lib/configFileManager.js` - Atomic write + rotating backups
- `/plugins/adminRateLimiter/adminWebSections/rateLimiterManagement/` - GUI (index/rules/settings + JS/CSS)
- `/core/admin/adminConfig.json5` - Admin section registration (rateLimiterManagement)

### CSRF Protection Plugin

- `/plugins/csrfProtection/main.js` - Lifecycle, ensure-token middleware, head hook (meta + interceptor), shared object, global helpers
- `/plugins/csrfProtection/lib/tokenManager.js` - Token generation (base64url) + constant-time compare
- `/plugins/csrfProtection/lib/originValidator.js` - Origin/Referer validation (Host dynamic, proxy-aware)
- `/plugins/csrfProtection/lib/requestGuard.js` - Pure `evaluate(ctx, custom, matcher)` validation logic
- `/plugins/csrfProtection/lib/clientInterceptor.js` - Inline fetch/XHR interceptor script
- `/plugins/csrfProtection/pluginConfig.json5` - Feature configuration
- `/core/pluginSys.js` - Enforcement hook inside `#wrapHandlerWithAccessCheck`
- `/core/priorityMiddlewares/koaSession.json5` - `SameSite=lax` hardening
- `/tests/e2e/csrfHelper.js` - E2E token helpers (`getCsrfToken`, `fetchCsrfToken`, `postWithCsrf`)

### Admin CSRF Protection Plugin

- `/plugins/adminCsrfProtection/main.js` - Routes (status/recent/simulate/config/validate-config/restart), shared-object access
- `/plugins/adminCsrfProtection/lib/configFileManager.js` - Atomic write + rotating backups
- `/plugins/adminCsrfProtection/adminWebSections/csrfManagement/` - GUI (index = Data view + tester, settings = JSON5 editor + JS/CSS)
- `/core/admin/adminConfig.json5` - Admin section registration (csrfManagement)

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

1. **TypeScript:** Migrate to TypeScript for type safety
2. **Environment Variables:** Use .env for configuration
3. **Database Migrations:** Implement migration system for schema changes
4. **API Documentation:** Add Swagger/OpenAPI documentation
5. **Error Handling:** Centralized error handling middleware
6. **Logging:** Structured logging (Winston, Bunyan)
7. **Validation:** Request validation library (Joi, Yup)
8. **Build Process:** Frontend asset bundling (webpack, esbuild)
9. **Internationalization:** i18n support for multiple languages
10. **Plugin Cleanup on Shutdown:** Il graceful shutdown attuale (`index.js`) chiude solo i server HTTP/HTTPS. In futuro valutare l'aggiunta di una fase di cleanup dei plugin prima della chiusura dei server (flush dati su disco, chiusura connessioni DB, rilascio risorse, ecc.). Attualmente ogni plugin gestisce il proprio cleanup in modo indipendente (es. `urlRedirect/hitCounter.js` ha i propri handler `SIGINT`/`SIGTERM`), ma un sistema centralizzato coordinato da `pluginSys` sarebbe più robusto e garantirebbe un ordine di chiusura corretto.
11. **Migrazione completa test plugin-specifici:** I test specifici dei plugin attualmente in `/tests/unit/{pluginName}/` (es. `bootstrapNavbar`, `urlRedirect`, `adminBootstrapNavbar`) dovrebbero essere migrati nelle rispettive cartelle `plugins/{pluginName}/tests/` secondo la convenzione "Testing Conventions for Plugins and Themes". In Fase 1 è stato migrato solo `bootstrapNavbar` come esempio di riferimento — gli altri vanno portati sulla stessa convenzione per completezza.
12. **Supporto E2E/Playwright per plugin e temi:** Attualmente solo unit e integration test dei plugin/temi sono scoperti automaticamente via `plugins/*/tests/` e `themes/*/tests/`. In futuro estendere la convenzione per includere test E2E con orchestrazione del server (setup/teardown automatico, fixtures condivise, helper per login programmatico, ecc.).
13. **Soglia minima di coverage con enforcement:** Aggiungere in `jest.config.js` una soglia minima di code coverage (es. 70% su branches, statements, functions, lines) con fail della CI se non raggiunta. Deve essere calcolata in modo aggregato (core + tutti i plugin attivi + tutti i temi).
14. **Scanner prescrittivo al boot (Fase 2 del testing):** Aggiungere in `pluginSys` uno scanner che al boot del server verifica per ogni plugin attivo la presenza dei test minimi richiesti: (a) un test per ogni metodo esportato da `main.js`, (b) un test per ogni rotta dichiarata in `getRouteArray()` incluso il campo `access`, (c) validazione dei file JSON5 di configurazione, (d) lifecycle hooks (`loadPlugin`, `installPlugin`, ecc.). Comportamento default: warning a console. Flag `testingStrictMode: true` in `ital8Config.json5` per promuovere i warning a fatal error. Lo stesso vale per i temi (presenza partial richiesti, schema `themeConfig.json5`, ecc.).
15. **Safety net filesystem nei test:** Aggiungere in `tests/setup.js` un hook `afterEach`/`afterAll` che verifichi che nessun test abbia creato/modificato file all'interno di `plugins/*/` o `themes/*/` reali (solo la `/core/testHelpers/pluginSandbox.js` dovrebbe essere usata per scritture). In Fase 1 è solo una convenzione documentata; in futuro diventare warning automatico e poi fatal error con `testingStrictMode: true`.
16. **Aggiornamenti dipendenze rinviati (da 2026-05-19):** Durante il bulk upgrade del 2026-05-19 sono stati intenzionalmente saltati 3 aggiornamenti che richiedono una review dedicata:
    - **`ccxt` 4.5.22 → 4.5.54** (e successive): plugin `ccxt` da rivedere a parte. Verificare se è ancora attivo/usato e se la superficie API esposta è cambiata tra le minor; testare le rotte del plugin prima del bump.
    - **`inquirer` 8.2.7 → 13.x**: dalla v9 in poi è **ESM-only** e ha API rinominata (`inquirer.prompt` → import named di `@inquirer/prompts`). Richiede rewrite di `scripts/init.js`, `scripts/lib/configWizard.js`, `scripts/lib/pluginInitRunner.js`. Le CVE di lodash transitivo sono già state chiuse via `npm audit fix`, quindi non c'è urgenza di sicurezza.
    - **`better-sqlite3`** (plugin `dbApi`, attualmente disattivo con `active: 0`): non installato nel root `package.json` e plugin non attivo. Quando si riattiverà `dbApi`, valutare la versione corrente di `better-sqlite3` (range plugin: `^9.2.2`, latest è 12.x con ABI changes) e fare un install + test mirato.
17. **Modello di sicurezza completo per il clone Git (temi e plugin) — da approfondire:** L'installazione di temi/plugin da repository Git (`plugins/admin/themesInstall.js`, `plugins/admin/pluginsInstall.js`) supporta tre formati di URL: HTTPS pubblico, HTTPS con credenziali inline e SSH. Il clone via SSH usa la **chiave SSH del server** (`~/.ssh/` dell'utente che esegue il processo Node), quindi eredita l'identità della macchina. Per evitare un **confused deputy** (un admin role 1 che fa clonare al server repo privati a cui solo la chiave del server ha accesso) la prima mitigazione implementata è: **gli URL SSH sono riservati al ruolo root (role 0)**, mentre HTTPS resta `[0, 1]` (chi ha credenziali le porta inline, nessuna escalation). Questa è una **soluzione minima e volutamente parziale**: l'intera questione va affrontata con più calma. Aspetti da valutare in una review dedicata:
    - **Audit log** di ogni clone (utente, URL, protocollo, esito, timestamp) su file dedicato, oggi assente.
    - **Scenari multi-tenant** (un'installazione ital8cms gestita per più clienti): la restrizione a role 0 potrebbe non bastare se più clienti condividono lo stesso utente di sistema/chiave SSH.
    - **Flag di configurazione** opzionale (es. `themesInstall.allowSshClone`, `pluginsInstall.allowSshClone` in `ital8Config.json5`) per disabilitare completamente SSH a livello di sistema, indipendentemente dal ruolo.
    - **Host whitelist** opzionale (es. solo `github.com`/`gitlab.com`) per limitare verso quali host la chiave del server può essere usata.
    - **Affidabilità headless dell'SSH**: oggi il clone eredita `process.env` (incluso `SSH_AUTH_SOCK`); valutare `GIT_SSH_COMMAND` con `BatchMode=yes`/`StrictHostKeyChecking` per messaggi d'errore deterministici quando la chiave manca, ha passphrase senza agent, o l'host non è in `known_hosts`.
    - **Supporto PAT/token gestiti** come alternativa più granulare alla chiave del server (credenziali per-installazione invece dell'identità della macchina).

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

**Last Updated:** 2026-06-12
**Version:** 2.15.0
**Maintained By:** AI Assistant (based on codebase analysis)

**Changelog:** spostato in [`CHANGELOG.md`](./CHANGELOG.md).
