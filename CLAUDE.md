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

## AI Assistant Guidelines

Lavorando su questo codebase come AI assistant — regole operative (le più critiche per prime):

1. **`loadJson5()` SEMPRE** per leggere i file `.json5` (mai `require()`/`JSON.parse()`); scritture **atomiche** (temp + `rename`).
2. **Campo `access` obbligatorio** su ogni rotta di plugin (`getRouteArray`): assenza = **errore fatale al boot**. Metodo rotta in **MAIUSCOLO**, chiave `handler` (non `func`).
3. **Naming — OBBLIGATORIO:** prima di introdurre QUALSIASI nuovo nome (variabili, funzioni, file, directory, plugin, classi, costanti) proponi **almeno 2-3 alternative** significative (4-5+ se complesso) con breve spiegazione, e **attendi l'approvazione** del maintainer. Requisito **critico**, mai saltare.
4. **`koa-classic-server` (dipendenza del team):** se trovi un bug **non aggirarlo** localmente — segnalalo al maintainer e aggiorna alla versione fixata (vedi *Dipendenze Mantenute dal Team*).
5. **Sicurezza:** password con bcrypt; valida l'input; output **escapato** (XSS); redirect **validati** (open-redirect); il CSRF è gestito dal plugin `csrfProtection`.
6. **Documentazione — standard `ital8doc` v1-1** → [`docs/ITAL8DOC-latest.md`](./docs/ITAL8DOC-latest.md). Ogni plugin/tema ha `README.it.md` (obbligatorio) + `EXPLAIN.it.md` (opzionale, se interni non banali), con stub inglese `.md`. Quando tocchi un plugin/tema/sottosistema aggiorna il **suo** doc, non CLAUDE.md.
7. **Architettura a plugin:** la maggior parte delle feature va implementata come plugin; rispetta dipendenze e ordine di caricamento; segui i pattern esistenti (rotte, middleware, hook).
8. **Test:** dopo le modifiche verifica che il server parta, il plugin carichi, le rotte rispondano e l'auth funzioni (vedi *Testing* → `docs/testing.it.md`).
9. **Temi:** considera sia il tema pubblico sia quello admin.
10. **Commenti:** l'autore usa l'italiano; per i nuovi commenti preferisci l'inglese, rispettando gli esistenti.
11. **Progetto alpha** (v0.0.1-alpha.0): breaking changes accettabili ma documentati in `CHANGELOG.md`.

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

Il sistema plugin è il cuore di ital8cms. Deep-dive completo (meccanica interna, esempi, validazione dipendenze, logging): [`core/EXPLAIN-pluginsSys.it.md`](./core/EXPLAIN-pluginsSys.it.md).

### Struttura plugin

Minima (obbligatoria): `main.js`, `pluginConfig.json5`, `pluginDescription.json5`. Convenzione **fortemente raccomandata** per plugin che servono pagine HTML: directory `webPages/` (separa logica e template, come nel plugin di riferimento `adminUsers`). Plugin solo-API (es. `bootstrap`, `simpleI18n`) non ne hanno bisogno.

### Export di `main.js`

```javascript
module.exports = {
  // ciclo di vita
  async loadPlugin(pluginSys, pathPluginFolder) {},
  async installPlugin(pluginSys, pathPluginFolder) {},
  async uninstallPlugin(pluginSys, pathPluginFolder) {},
  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {},
  getRouteArray() { return [] },                                   // rotte API
  getMiddlewareToAdd(pluginSys, pathPluginFolder) { return [] },   // middleware
  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) { return {} }, // condividi → plugin
  setSharedObject(fromPlugin, sharedObject) {},                    // ricevi condivisione
  getObjectToShareToWebPages() { return {} },                     // funzioni template LOCALI
  getGlobalFunctionsForTemplates() { return {} },                 // funzioni template GLOBALI (whitelist)
  getHooksPage(section, passData, pluginSys, pathPluginFolder) { return "" } // hook di pagina
}
```

### Config del plugin

- `pluginConfig.json5`: `active` (0/1), `isInstalled`, `weight` (priorità, minore = caricato prima), `dependency` (semver), `nodeModuleDependency`, `custom` (impostazioni specifiche).
- `pluginDescription.json5`: `name`, `version`, `description`, `author`, `email`, `license`.

### Ordine di caricamento

1. **weight** crescente → 2. **risoluzione dipendenze** (prima le dipendenze) → 3. **alfabetico** (a parità di weight). I plugin caricati dopo dispongono di quelli caricati prima.

### Comunicazione tra plugin

- **Pull (runtime, on-demand):** `pluginSys.getSharedObject(providerPluginName, callerName?)` → l'oggetto condiviso, o `null` se il provider non è attivo / non implementa `getObjectToShareToOthersPlugin()`. `callerName` opzionale → il provider può personalizzare la risposta per consumer. Ideale in route handler/middleware/framework.
- **Push (al boot):** `setSharedObject(fromPlugin, sharedObject)`, automatico e per-consumer. Ideale per dipendenze plugin-to-plugin.

### Rotte API dei plugin

Pattern: `/${apiPrefix}/${pluginName}/${path}` (default `/api/{pluginName}/...`).

**⚠️ CONTRATTO CRITICO dell'oggetto rotta** — ogni rotta DEVE avere:

| Proprietà | Obbligo | Note |
|-----------|---------|------|
| `method` | sì | **MAIUSCOLO**: `'GET'`, `'POST'`, `'PUT'`, `'DEL'`, `'ALL'` |
| `path` | sì | es. `'/hello'` |
| `handler` | sì | `async (ctx) => { ... }` |
| `access` | sì | controllo accessi (vedi Access Control) |

> **WARNING:** `method` minuscolo (`'get'`) o `func` invece di `handler` → la rotta viene **silenziosamente ignorata** da `pluginSys.loadRoutes()` e la richiesta cade sul static server (HTML invece di JSON). Il campo `access` è **obbligatorio**: la sua assenza causa **errore fatale al boot** (vedi Access Control System).

```javascript
getRouteArray() {
  return [{
    method: 'GET', path: '/hello',
    access: { requiresAuth: false, allowedRoles: [] },
    handler: async (ctx) => { ctx.body = 'Hello World' }
  }]
}
```

### Page hooks

`getHooksPage(section, passData, ...)` restituisce HTML da iniettare nella pagina. Sezioni disponibili: `head`, `header`, `body`, `footer`, `script`.

### Funzioni globali nei template (whitelist)

I plugin possono esporre funzioni come helper **globali** negli EJS (senza il prefisso `passData.plugin.{nome}`). Modello a **whitelist** in 3 parti:
1. Whitelist in `ital8Config.json5 → globalFunctionsWhitelist` (per funzione: `plugin`, `description?`, `required`: `true`=fail-fast / `false`=fallback con warning).
2. Il plugin dichiara i candidati con `getGlobalFunctionsForTemplates()`.
3. `pluginSys.getGlobalFunctions()` valida e registra **solo** le funzioni autorizzate dalla whitelist.

Entrambe le sintassi funzionano sempre: globale `<%- __(...) %>` e locale `<%- passData.plugin.simpleI18n.__(...) %>`. Esempio attuale: `__()` (traduzioni, da `simpleI18n`).

## Plugin Pages System

I plugin servono pagine pubbliche **senza definire endpoint** in `getRouteArray()`: basta creare una directory `webPages/`. Il sistema (`core/pluginPagesSystem.js`) la auto-rileva e crea un **symlink** `/pluginPages/{plugin}/` → `/plugins/{plugin}/webPages/` (zero duplicazione). URL pubblico: `/pluginPages/{pluginName}/{file.ejs}` (prefisso `pluginPagesPrefix`).

Nel template si usano i partial del tema + i metodi di iniezione (senza parametri, auto-detection di plugin/pagina dal path):

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>   <%# anche injectPluginJs / injectPluginHtmlBefore / injectPluginHtmlAfter %>
```

Le personalizzazioni del tema vivono in `themes/{tema}/pluginsEndpointsMarkup/{plugin}/{pagina}/` (`style.css`, `script.js`, `before-content.html`, `after-content.html`). **GET** servite automaticamente dal sistema; **POST** restano in `getRouteArray()` (`/api/{plugin}/...`).

> 📖 Deep-dive completo (architettura symlink, API `PluginPagesSystem`, auto-cleanup al boot, passData, init flow, debugging): [`core/EXPLAIN-pluginPages.it.md`](./core/EXPLAIN-pluginPages.it.md).

## Theme System

Struttura tema: `views/` (partial `head`/`header`/`nav`/`main`/`aside`/`footer`), `templates/`, `themeResources/` (css/js/img), `themeConfig.json5` (flag `isAdminTheme`), `themeDescription.json5`.

**Configurazione** (`ital8Config.json5`): `activeTheme` (sito pubblico), `adminActiveTheme` (admin, richiede `isAdminTheme: true`), `publicThemeResourcesPrefix`, `adminThemeResourcesPrefix`.

**API unificata** — lo stesso codice funziona in contesto pubblico e admin (il sistema sceglie il tema da `passData.isAdminContext`):

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
<%- await pluginSys.hookPage("head", passData) %>
```

- `getThemePartPath(part)` → path del partial del tema attivo
- `getThemeResourceUrl(resource)` → URL risorsa (`/public-theme-resources/...` o `/admin-theme-resources/...`)
- `pluginSys.hookPage(section, passData)` → punti di hook dei plugin (`head`, `header`, `script`, …)

> 📖 Deep-dive (validazione, dipendenze, asset, personalizzazione endpoint plugin, API completa): [`core/EXPLAIN-themeSys.it.md`](./core/EXPLAIN-themeSys.it.md).
> Nota: il campo tema `active` è stato **rimosso** (la fonte di verità è `ital8Config.json5`); `isInstalled` resta e indica "tema pronto per l'attivazione". Decisione: [`docs/decisions/theme-active-isinstalled.it.md`](./docs/decisions/theme-active-isinstalled.it.md).

## Bootstrap Navbar / URL Redirect / Admin Bootstrap Navbar

Plugin documentati nei rispettivi doc (uso, configurazione, API, esempi):

- **bootstrapNavbar** — genera navbar Bootstrap 5 (`horizontal`/`vertical`/`offcanvas`) da file `navbar.{name}.json5`: visibilità per auth/ruoli, auto-active, dropdown, separatori, `settingsOverrides`, `configDir` (con protezione path-traversal), caching prod/debug. Esposto ai template: `passData.plugin.bootstrapNavbar.render({name, configDir?, settingsOverrides?}, passData)`. → [`plugins/bootstrapNavbar/EXPLAIN.md`](./plugins/bootstrapNavbar/EXPLAIN.md)
- **urlRedirect** — redirect 301/302 con pattern exact / wildcard (`*`, `**`) / `regex:`, first-match-wins (ordine array in `redirectMap.json5`), hit counter, preservazione query string. Pure middleware, intercetta solo le GET. → [`plugins/urlRedirect/README.md`](./plugins/urlRedirect/README.md)
- **adminBootstrapNavbar** — twin admin GUI (sezione `navbarsManagement`) per creare/editare/validare/preview i file navbar: editor JSON5, 5 template, file picker, soft-delete con backup. → [`plugins/adminBootstrapNavbar/README.md`](./plugins/adminBootstrapNavbar/README.md)

> Scaffolding rapido di una navbar: skill `ital8cms-bootstrapNavbar-creator`.

## Admin System Architecture

Architettura modulare che permette ai plugin di fornire funzionalità admin tramite un'interfaccia unificata (sezioni dinamiche via symlink + sezioni hardcoded). Deep-dive completo (symlink, service discovery, init 2-fasi, menu dinamico, API, troubleshooting): [`core/admin/EXPLAIN.it.md`](./core/admin/EXPLAIN.it.md).

### Contratti essenziali

- **Naming OBBLIGATORIO:** un plugin admin **deve** chiamarsi `admin*` (es. `adminUsers`, `adminMailer`). Il prefisso `admin` è il criterio di rilevamento automatico.
- **Sezioni:** il plugin dichiara `adminSections` (array di sectionId) in `pluginConfig.json5`. Ogni sectionId richiede la directory `plugins/{plugin}/adminWebSections/{sectionId}/`.
- **Metadata UI centralizzati:** label, icon, description e ordine menu vivono in `/core/admin/adminConfig.json5` (NON nel plugin; un `adminConfig.json5` dentro il plugin è deprecato).
- **Serving via symlink (zero duplicazione):** `core/admin/webPages/{sectionId}` → `plugins/{plugin}/adminWebSections/{sectionId}/`, servito su `/admin/{sectionId}/...`.

### Tipi di sezione (in `adminConfig.json5`)

- `"plugin"`: gestita da un plugin, servita via symlink (campi: `plugin`, `enabled`, `required`, `label`, `icon`, `description`).
- `"hardcoded"`: file statici in `core/admin/webPages/{sectionId}/` (campi: `enabled`, `label`, `url`, `icon`).

### Service discovery

I plugin forniscono servizi backend (auth, email, storage…) dichiarati in `adminConfig.json5 → services`. Uso: `adminSystem.getService('auth')`, `adminSystem.getEndpointsForPassData()`.

### API AdminSystem (in `passData.adminSystem`)

`getUI()` · `getMenuSections()` (filtrate per enabled/plugin attivo) · `getService(name)` · `getEndpointsForPassData()`.

### Init 2-fasi (anti dipendenze circolari)

PluginSys e AdminSystem si collegano via dependency injection: `adminSystem.setPluginSys()` / `pluginSys.setAdminSystem()` → poi `adminSystem.initialize()` (valida symlink, processa i plugin admin, carica i servizi).


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

### Access Control System (adminAccessControl)

Controllo accessi basato su pattern (esatto / wildcard `*`,`**` / `regex:`) con **priorità automatica** (il più specifico vince), regole **hardcoded immutabili** + **custom** in `accessControl.json5`, e campo **`access` obbligatorio** su ogni rotta di plugin (la sua assenza causa errore fatale al boot). Admin UI con editor JSON5 e validazione (sintassi, ruoli, conflitti, immutabilità hardcoded). → [`plugins/adminAccessControl/README.it.md`](./plugins/adminAccessControl/README.it.md) · [`EXPLAIN.it.md`](./plugins/adminAccessControl/EXPLAIN.it.md)

### SEO · Rate Limiter · Admin Rate Limiter

Plugin con documentazione propria:

- **seo** — meta tag, Open Graph, Twitter Cards, canonical, JSON-LD, generazione di `sitemap.xml`/`robots.txt`; regole per-pagina (`seoPages.json5`, pattern matching), feature toggle individuali, multilingua (Strada B3, indipendente da simpleI18n). → [`plugins/seo/EXPLAIN.md`](./plugins/seo/EXPLAIN.md)
- **rateLimiter** — anti brute-force a escalation (short→long block), chiave `IP+ruleName`, guard (oggetto condiviso, invocato nell'handler) + middleware di enforcement, stato persistente cross-restart, audit JSONL. → [`plugins/rateLimiter/README.md`](./plugins/rateLimiter/README.md) · [`EXPLAIN.md`](./plugins/rateLimiter/EXPLAIN.md)
- **adminRateLimiter** — twin admin GUI (sezione `rateLimiterManagement`): KPI, blocchi attivi, ban/unblock live, editor JSON5 di regole e impostazioni (Tre Viste). → [`plugins/adminRateLimiter/README.md`](./plugins/adminRateLimiter/README.md) · [`EXPLAIN.md`](./plugins/adminRateLimiter/EXPLAIN.md)

### CSRF Protection · Admin CSRF Protection

Protezione CSRF (difesa in profondità: token sincronizzatore per-sessione + controllo Origin/Referer, enforcement nel route-wrap del core prima del controllo auth) e il suo twin admin GUI. Documentati nei rispettivi doc:

- **csrfProtection** → [`plugins/csrfProtection/README.it.md`](./plugins/csrfProtection/README.it.md) · [`EXPLAIN.it.md`](./plugins/csrfProtection/EXPLAIN.it.md)
- **adminCsrfProtection** (sezione admin `csrfManagement`) → [`plugins/adminCsrfProtection/README.it.md`](./plugins/adminCsrfProtection/README.it.md) · [`EXPLAIN.it.md`](./plugins/adminCsrfProtection/EXPLAIN.it.md)

> Hardening correlato (difesa in profondità): `SameSite=lax` sul cookie di sessione in `core/priorityMiddlewares/koaSession.json5`.

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

Configurazione completa spostata in [`docs/https.it.md`](./docs/https.it.md).

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

### Avvio

```bash
npm install        # dipendenze
npm start          # avvio con auto-reload (nodemon)
```
Server su `http://localhost:3000`.

### Creare plugin / temi (usa le skill di scaffolding)

- **Plugin:** skill `ital8cms-plugin-creator` (minimal / con webPages / admin / con funzioni globali). Riferimento completo: `plugins/exampleComplete/` + `core/EXPLAIN-pluginsSys.it.md`. Struttura minima: `main.js` + `pluginConfig.json5` + `pluginDescription.json5`; aggiungi `webPages/` per le pagine HTML (vedi *Plugin Pages System*).
- **Tema:** skill `ital8cms-theme-creator`. Deep-dive: `core/EXPLAIN-themeSys.it.md`. Attivazione: `activeTheme`/`adminActiveTheme` in `ital8Config.json5`.
- **Altre skill:** `ital8cms-bootstrapNavbar-creator` (navbar), `ital8cms-simpleI18n-integrator` (i18n), `ital8cms-website-builder` (sito completo).

### Pagine admin

Crea `core/admin/webPages/{sezione}/index.ejs` (per i plugin admin: via `adminWebSections/` + symlink, vedi *Admin System Architecture*). Usa gli stessi partial del tema (`getThemePartPath`): con `passData.isAdminContext === true` viene caricato automaticamente il tema admin.

### Gestione utenti

Pannello admin: `/admin/usersManagment/` (utenti) e `/admin/rolesManagment/` (ruoli). Dati in `plugins/adminUsers/userAccount.json5` e `userRole.json5`.

### Operazioni dati (JSON5)

```javascript
const loadJson5 = require('../../core/loadJson5')
const data = loadJson5(path.join(pathPluginFolder, 'data.json5'))
// scrittura ATOMICA (temp + rename):
fs.writeFileSync(dataPath + '.tmp', JSON.stringify(data, null, 2), 'utf8')
fs.renameSync(dataPath + '.tmp', dataPath)
```
Database opzionale via plugin `dbApi` (vedi *Data Storage Strategy*).

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

Ricette pratiche — aggiungere una rotta API, un page hook (`getHooksPage`), un middleware (`getMiddlewareToAdd`), condividere oggetti tra plugin (`getObjectToShareToOthersPlugin`/`getSharedObject`), inizializzare lo storage dati: i **contratti** sono nella sezione *Plugin System Architecture* (sopra); l'**esempio completo di riferimento** è il plugin `plugins/exampleComplete/` che dimostra tutti i metodi del sistema plugin; il deep-dive è in `core/EXPLAIN-pluginsSys.it.md`.

Per lo storage JSON5: leggere con `loadJson5()`, scrivere in modo **atomico** (temp + `rename`) — vedi *Data Storage Strategy*.

## Testing

Strategia, convenzioni, helper e isolamento dei test: spostato in [`docs/testing.it.md`](./docs/testing.it.md).

## Demo Install Profile

Spostato in [`docs/demo-profile.it.md`](./docs/demo-profile.it.md).

## Deployment Guidelines

Spostato in [`docs/deployment.it.md`](./docs/deployment.it.md).

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

### File dei plugin

Ogni plugin documenta i propri file nel rispettivo `README.it.md`/`EXPLAIN.it.md` (vedi i puntatori nelle sezioni dei plugin sopra). Utility core trasversali: `core/patternMatcher.js` (pattern matching condiviso), `core/servingRootResolver.js` (isolamento path), `core/editJson5.js` (modifica chirurgica di chiavi JSON5), `core/loadJson5.js`, `core/logger.js`, `core/escapeHtml.js`, `core/sessionSecurity.js`.

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

Spostato in [`docs/roadmap.it.md`](./docs/roadmap.it.md).

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

---

**Last Updated:** 2026-06-13
**Version:** 2.16.0
**Maintained By:** AI Assistant (based on codebase analysis)
**Standard documentazione:** ital8doc v1-1 → [`docs/ITAL8DOC-latest.md`](./docs/ITAL8DOC-latest.md)

**Changelog:** spostato in [`CHANGELOG.md`](./CHANGELOG.md).
