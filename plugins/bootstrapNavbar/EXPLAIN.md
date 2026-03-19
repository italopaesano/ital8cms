# bootstrapNavbar - Plugin Documentation

## What It Does

**bootstrapNavbar** generates Bootstrap 5 navbars from JSON5 configuration files. Instead of writing HTML by hand, you define your navbar structure in a `.json5` file and the plugin renders it with full Bootstrap markup.

**Core capabilities:**
- Three navbar types: **horizontal** (with collapse), **vertical** (sidebar), **offcanvas** (drawer)
- Auth/role-based visibility filtering (show/hide items per user)
- Auto-active page detection (highlights current page)
- Dropdowns with dividers and per-item visibility
- Cross-directory config sharing via `configDir`
- Production caching with debug-mode bypass

## Plugin Structure

```
plugins/bootstrapNavbar/
├── main.js                    # Entry point, exposes render() to EJS templates
├── pluginConfig.json5         # Config: depends on bootstrap ^1.0.0, weight 10
├── pluginDescription.json5    # Metadata: name, version 1.0.0, author
└── lib/
    └── navbarRenderer.js      # Core rendering engine (all logic, ~478 lines)
```

**External dependency:** `core/servingRootResolver.js` — provides path isolation for the `configDir` feature.

## How It Works

### Architecture Flow

```
EJS template calls:
  passData.plugin.bootstrapNavbar.render({name: 'main'}, passData)
       │
       ▼
main.js  →  delegates to navbarRenderer.render()
       │      passing: options, passData, isDebugMode, cache, servingConfig
       ▼
navbarRenderer.render()
  1. Validates input (name, passData, filePath)
  2. Resolves config directory:
     - Default: same dir as the calling template
     - configDir: resolved relative to serving root (with path traversal protection)
  3. Loads navbar.{name}.json5 (cached in production, re-read in debug)
  4. Merges settings: defaults < file < settingsOverrides
  5. Dispatches to type-specific renderer:
     - renderHorizontal()  →  standard collapse navbar
     - renderVertical()    →  sidebar flex-column
     - renderOffcanvas()   →  drawer with toggle
  6. Returns HTML string (or '' on error)
```

### Module Responsibilities

**`main.js`** — Plugin lifecycle and API surface:
- Reads `ital8Config.json5` to determine debug mode and serving paths
- Creates the `navbarCache` Map (shared across all render calls)
- Exposes `render()` through `getObjectToShareToWebPages()`
- The exposed `render(options, passData)` wraps `navbarRenderer.render()` adding internal parameters

**`lib/navbarRenderer.js`** — All rendering logic:
- `render()` — orchestrator: config resolution, caching, settings merge, type dispatch
- `renderHorizontal()` / `renderVertical()` / `renderOffcanvas()` — HTML generators per type
- `renderItems()` — processes an array of items, filters by visibility, delegates to item renderers
- `renderNavItem()` — single link item
- `renderDropdown()` — dropdown with sub-items (hides entire dropdown if no visible sub-items)
- `renderDropdownSubItem()` — item inside dropdown (handles dividers)
- `renderSeparator()` — visual `|` between items
- `escapeHtml()` — XSS protection for labels and hrefs
- `isItemVisible()` — auth/roles check: `showWhen` → `requiresAuth` → `allowedRoles`
- `isActivePage()` — URL comparison with trailing slash normalization

## Usage in EJS Templates

```ejs
<%# Basic — searches for navbar.main.json5 in the same directory as this template %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main'}, passData) %>

<%# With configDir — searches in /www/ root instead of template's directory %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main', configDir: '/'}, passData) %>

<%# With settings overrides %>
<%- passData.plugin.bootstrapNavbar.render({
  name: 'main',
  settingsOverrides: { colorScheme: 'light', bgClass: 'bg-dark' }
}, passData) %>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.name` | string | Yes | Maps to `navbar.{name}.json5` |
| `options.configDir` | string | No | Directory relative to serving root for config lookup |
| `options.settingsOverrides` | object | No | Runtime overrides (highest priority) |
| `passData` | object | Yes | The EJS template passData object |

**Returns:** HTML string, or `''` on error (with `console.warn`).

## Configuration File Format

Files are named `navbar.{name}.json5` and placed alongside the calling template (or in a `configDir`).

### Complete Schema

```json5
// This file follows the JSON5 standard
{
  "settings": {
    "type": "horizontal",           // "horizontal" | "vertical" | "offcanvas"
    "colorScheme": "dark",          // "dark" | "light"  (Bootstrap data-bs-theme)
    "bgClass": "bg-primary",        // Any Bootstrap bg class
    "expandAt": "lg",               // "sm" | "md" | "lg" | "xl" | "xxl"
    "containerClass": "container-fluid",
    "autoActive": true,             // Highlight current page
    "offcanvasAlways": false,       // Hamburger always visible (offcanvas only)
    "position": "start",            // "start" | "end"
    "id": "navbarMain",             // HTML id for collapse/offcanvas target
  },
  "sections": {
    "left": [ /* items */ ],
    "right": [ /* items */ ],
  },
}
```

### Settings Defaults and Merge Priority

All settings have built-in defaults (defined in `navbarRenderer.js` as `DEFAULT_SETTINGS`):

| Setting | Default |
|---------|---------|
| `type` | `"horizontal"` |
| `colorScheme` | `"dark"` |
| `bgClass` | `"bg-primary"` |
| `expandAt` | `"lg"` |
| `containerClass` | `"container-fluid"` |
| `autoActive` | `true` |
| `offcanvasAlways` | `false` |
| `position` | `"start"` |
| `id` | `"navbarMain"` |

**Merge order** (lowest → highest priority):
1. Built-in defaults
2. JSON5 file `settings`
3. `options.settingsOverrides`

### Item Types

**Regular item (link):**
```json5
{
  "label": "Home",                          // Text (HTML-escaped)
  "href": "/",                              // URL (HTML-escaped, defaults to "#")
  "icon": "<i class='bi bi-house'></i>",    // Raw HTML (NOT escaped — trusted)
  "target": "_blank",                       // Optional link target
  "requiresAuth": true,                     // Auth filter
  "allowedRoles": [0, 1],                   // Role filter
  "showWhen": "authenticated",              // Shortcut filter
}
```

**Dropdown:**
```json5
{
  "type": "dropdown",
  "label": "Menu",
  "icon": "<i class='bi bi-list'></i>",
  "requiresAuth": true,                     // Filters the ENTIRE dropdown
  "items": [
    { "label": "Item 1", "href": "/item1" },
    { "type": "divider" },                   // Horizontal line
    { "label": "Item 2", "href": "/item2", "requiresAuth": true },
  ],
}
```

If all sub-items are hidden by visibility filtering, the entire dropdown is hidden.

Dropdown IDs are auto-generated: `dropdown-{settings.id}-{slugified-label}`

**Separator:**
```json5
{ "type": "separator" }
```
Renders `|` between items. Never filtered by visibility.

**Divider (dropdown only):**
```json5
{ "type": "divider" }
```
Renders `<hr class="dropdown-divider">`. Never filtered by visibility.

## Visibility Filtering

Items can be conditionally shown/hidden. Checks are applied in this priority order:

### 1. `showWhen` (shortcut)

| Value | Shows to |
|-------|----------|
| `"authenticated"` | Logged-in users only |
| `"unauthenticated"` | Guests only |
| *(omitted)* | Everyone |

### 2. `requiresAuth`

| Value | Shows to |
|-------|----------|
| `true` | Authenticated users only |
| `false` | NON-authenticated users only |
| *(omitted)* | Everyone |

### 3. `allowedRoles` (only when `requiresAuth: true`)

| Value | Shows to |
|-------|----------|
| `[0, 1]` | Users with role 0 OR role 1 |
| `[]` or omitted | All authenticated users |

**Auth data source:** `ctx.session.authenticated` and `ctx.session.user.roleIds` (array).

Role check uses `userRoleIds.some(roleId => item.allowedRoles.includes(roleId))` — user needs at least one matching role.

### Examples

```json5
// Public (everyone)
{ "label": "Home", "href": "/" }

// Logged-in users only
{ "label": "Profile", "href": "/profile", "showWhen": "authenticated" }

// Guests only
{ "label": "Login", "href": "/login", "showWhen": "unauthenticated" }

// Admin only (root + admin roles)
{ "label": "Admin", "href": "/admin", "requiresAuth": true, "allowedRoles": [0, 1] }

// Root only
{ "label": "System", "href": "/system", "requiresAuth": true, "allowedRoles": [0] }
```

## Auto-Active Page Detection

When `autoActive: true` (default), the current URL is compared against each item's `href`:

- Only the **pathname** is compared (query strings and fragments ignored)
- Trailing slashes are normalized (`/page/` matches `/page`)
- Active items get `class="... active"` and `aria-current="page"`
- Works in both top-level and dropdown sub-items
- Falls back to simple string comparison if URL parsing fails

## configDir: Cross-Directory Config Sharing

By default, the plugin searches for `navbar.{name}.json5` in the **same directory** as the calling EJS template. The `configDir` option allows searching in a different directory relative to the **serving root**.

```ejs
<%# Template at /www/pages/deep/home.ejs wants config from /www/shared/ %>
<%- passData.plugin.bootstrapNavbar.render({name: 'main', configDir: '/shared'}, passData) %>
```

### Serving Root Resolution

The serving root is determined by `core/servingRootResolver.js` based on which context the template belongs to:

| Context | Serving Root | Isolation |
|---------|-------------|-----------|
| **www** | `/www/` | Shared — all www files use one root |
| **pluginPages** | `/pluginPages/{pluginName}/` | Per-plugin — plugins cannot access each other's files |
| **admin** | `/core/admin/webPages/{sectionId}/` | Per-section — sections isolated from each other |

### Security

- Path traversal (`../`) that escapes the serving root is **blocked** with a security warning
- `configDir` with and without leading `/` are equivalent (`/shared` = `shared`)
- If `servingConfig` is unavailable, falls back to template's directory (with warning)
- Admin dashboard root-level files (`index.ejs` in webPages root) return empty string — `configDir` not supported there

## Navbar Types

### Horizontal (default)

Standard Bootstrap navbar with responsive collapse.

```
┌─────────────────────────────────────────────────────┐
│ [≡] toggler      [Left items...]      [Right items] │
└─────────────────────────────────────────────────────┘
```

- `navbar-expand-{expandAt}` for responsive collapse
- Left items in `<ul class="navbar-nav me-auto">`
- Right items in separate `<ul class="navbar-nav">`
- Collapse toggle with `data-bs-toggle="collapse"`

### Vertical (sidebar)

Flex-column sidebar layout.

```
┌──────────────┐
│ [Left items]  │
│    ...        │
│ ──────────── │  ← <hr> (only if right items exist)
│ [Right items] │
└──────────────┘
```

- CSS: `flex-column align-items-stretch p-3`
- `position: "end"` adds `ms-auto` (right-aligns sidebar)
- `<hr>` separator only if right section has rendered content
- No collapse toggle (always visible)
- "left" = top section, "right" = bottom section

### Offcanvas (drawer)

Offcanvas sidebar that slides in from a side.

```
Toggle: [≡]     ┌───────────────┐
                │ ✕ Close       │
                │ [Left items]  │
                │ [Right items] │
                └───────────────┘
```

- `offcanvasAlways: true` → hamburger **always** visible (no `navbar-expand-*`)
- `offcanvasAlways: false` → hamburger only below `expandAt` breakpoint
- `position: "start"` → slides from left (`offcanvas-start`)
- `position: "end"` → slides from right (`offcanvas-end`)
- Offcanvas ID: `{settings.id}-offcanvas`

## Caching

| Mode | Behavior | Use Case |
|------|----------|----------|
| Debug (`debugMode >= 1`) | Re-reads JSON5 on **every** request | Development |
| Production (`debugMode = 0`) | Reads once, caches in `Map` | Production |

- Cache key = absolute file path
- Different `configDir` values produce different cache keys
- Cache never invalidated (server restart required for production changes)

## XSS Protection

- **Labels and hrefs** are HTML-escaped via `escapeHtml()` (replaces `&`, `<`, `>`, `"`, `'`)
- **Icons** are inserted as **raw HTML** (not escaped) — they are trusted content defined by the developer in JSON5 config files
- Non-string inputs to `escapeHtml()` return empty string

## Exported API

`navbarRenderer.js` exports four functions (three exposed for unit testing):

```javascript
module.exports = {
  render,          // Main render function
  isItemVisible,   // Auth/role visibility check
  isActivePage,    // Active page URL comparison
  escapeHtml,      // HTML character escaping
};
```

## Example Configuration

**`/www/navbar.main.json5`** — the primary site navbar:

```json5
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
      { "label": "Bootstrap Test", "href": "/test_bootstrap.ejs", "icon": "<i class='bi bi-bootstrap'></i>" },
      {
        "type": "dropdown",
        "label": "Pages",
        "icon": "<i class='bi bi-file-earmark'></i>",
        "items": [
          { "label": "Hello World", "href": "/hello_word.ejs" },
          { "label": "i18n Test", "href": "/i18n-test.ejs" },
          { "type": "divider" },
          { "label": "Theme Test", "href": "/prova_thema.ejs" },
        ],
      },
      { "type": "separator" },
      { "label": "Admin", "href": "/admin", "icon": "<i class='bi bi-gear'></i>", "requiresAuth": true, "allowedRoles": [0, 1] },
    ],
    "right": [
      { "label": "Login", "href": "/pluginPages/adminUsers/login.ejs", "icon": "<i class='bi bi-box-arrow-in-right'></i>", "showWhen": "unauthenticated" },
      { "label": "Profile", "href": "/pluginPages/adminUsers/userProfile.ejs", "icon": "<i class='bi bi-person-circle'></i>", "showWhen": "authenticated" },
      { "label": "Logout", "href": "/pluginPages/adminUsers/logout.ejs", "icon": "<i class='bi bi-box-arrow-right'></i>", "showWhen": "authenticated" },
    ],
  },
}
```

## Additional Example Configurations

Seven examples are available in `/www/navbarExamples/`:

| File | Type | Demonstrates |
|------|------|-------------|
| `navbar.horizontalLight.json5` | horizontal | Light color scheme, md breakpoint |
| `navbar.sidebar.json5` | vertical | Sidebar with dropdowns, role filters |
| `navbar.offcanvasResponsive.json5` | offcanvas | Responsive (hamburger below breakpoint) |
| `navbar.offcanvasAlways.json5` | offcanvas | Always-visible hamburger, slides from right |
| `navbar.authHeavy.json5` | horizontal | All auth features: showWhen, requiresAuth, allowedRoles, custom roles |
| `navbar.overridable.json5` | horizontal | Designed for settingsOverrides demo |

Each example has a corresponding `.ejs` page that renders it.

## Tests

**Location:** `/tests/unit/bootstrapNavbar/` — 5 files, 206 tests

| File | Tests | Coverage |
|------|-------|----------|
| `escapeHtml.test.js` | 36 | HTML escaping, non-string inputs, XSS scenarios |
| `isItemVisible.test.js` | 68 | Auth filtering, role checks, multi-role users, edge cases |
| `isActivePage.test.js` | 44 | URL matching, trailing slashes, query strings, edge cases |
| `configDir.test.js` | ~58 | Cross-directory resolution, path traversal security, contexts |
| `rendering.test.js` | ~150+ | Full pipeline: validation, caching, settings merge, all 3 types, items, dropdowns, separators, visibility |

**Related:** `/tests/unit/core/servingRootResolver.test.js` — 22 tests for the path isolation utility.

```bash
# Run all bootstrapNavbar tests
npx jest tests/unit/bootstrapNavbar --verbose

# Run servingRootResolver tests
npx jest tests/unit/core/servingRootResolver.test.js --verbose
```

## File Reference

| File | Purpose |
|------|---------|
| `plugins/bootstrapNavbar/main.js` | Plugin entry point, `render()` exposure |
| `plugins/bootstrapNavbar/lib/navbarRenderer.js` | Core rendering engine |
| `plugins/bootstrapNavbar/pluginConfig.json5` | Plugin config (depends on bootstrap ^1.0.0) |
| `plugins/bootstrapNavbar/pluginDescription.json5` | Plugin metadata |
| `core/servingRootResolver.js` | Path isolation for `configDir` |
| `www/navbar.main.json5` | Primary navbar configuration |
| `www/navbarExamples/` | 6 additional example configurations |
| `tests/unit/bootstrapNavbar/` | Unit tests (5 files, 206 tests) |
| `tests/unit/core/servingRootResolver.test.js` | servingRootResolver tests (22 tests) |
