---
name: ital8cms-bootstrapNavbar-creator
description: Scaffold a Bootstrap navbar configuration file (navbar.<name>.json5) for the ital8cms `bootstrapNavbar` plugin. Use when the user asks to create, scaffold, or generate a navbar config (horizontal, vertical, or offcanvas). Optionally inserts the render() call into an EJS template. Does NOT scaffold the plugin itself (it ships with ital8cms).
---

# ital8cms bootstrapNavbar Config Creator

This skill scaffolds a JSON5 navbar configuration file consumed by the `bootstrapNavbar` plugin. The plugin is part of ital8cms — this skill only generates the `navbar.<name>.json5` file (and, on request, the EJS render call), not the plugin itself.

## When to use

Invoke when the user wants to:
- Create a new navbar configuration (`navbar.<name>.json5`)
- Generate a horizontal, vertical (sidebar), or offcanvas (drawer) navbar
- Add auth/role-based visibility filtering to navbar items
- Build a navbar with dropdowns, separators, dividers, and Bootstrap icons
- Insert the `render()` call into an existing EJS template

Do **not** invoke for: editing an existing navbar config (just open and modify it), creating the `bootstrapNavbar` plugin (it's a core ital8cms plugin), creating other plugins/themes, or generating navbars for non-ital8cms projects.

## Required information (ask before generating)

Before writing any file, gather these inputs from the user. **Do not guess.**

1. **Navbar name** — short camelCase identifier, becomes `navbar.<name>.json5` and the HTML `id="<settings.id>"`. Validate `^[a-zA-Z][a-zA-Z0-9]*$`. Examples: `main`, `sidebar`, `adminTop`.
2. **Navbar type** — one of:
   - `horizontal` — standard Bootstrap navbar with mobile collapse toggle (most common)
   - `vertical` — flex-column sidebar, always visible, "left" = top / "right" = bottom (separated by `<hr>`)
   - `offcanvas` — drawer that slides in from a side; can be responsive or always-hamburger
3. **Output location** — absolute path of the destination directory where `navbar.<name>.json5` will be written. Suggest, in order:
   - The directory of an EJS template the user mentioned (the plugin's default lookup location)
   - `<projectRoot>/www/` if the user just says "the main site"
   - For admin or plugin pages: the corresponding `core/admin/webPages/<section>/` or `plugins/<plugin>/webPages/` directory
   Confirm with the user before writing. The plugin auto-detects the calling template's directory; `configDir` is only needed for cross-directory sharing.
4. **Bootstrap appearance settings** — confirm or accept defaults:
   - `colorScheme`: `"dark"` (default) or `"light"`
   - `bgClass`: any Bootstrap bg-* class (default `"bg-primary"`; common: `"bg-dark"`, `"bg-light"`, `"bg-body-tertiary"`)
   - `expandAt` (horizontal/offcanvas only): `sm`/`md`/`lg`/`xl`/`xxl` — breakpoint at which the navbar collapses (default `"lg"`)
   - `containerClass`: default `"container-fluid"`
   - `autoActive`: default `true` (auto-highlight current page)
   - `position` (vertical/offcanvas only): `"start"` (default) or `"end"`
   - `offcanvasAlways` (offcanvas only): default `false`; `true` = hamburger always visible regardless of breakpoint
5. **Items for `left` and `right` sections** — for each item, ask:
   - Item type: regular link, dropdown, or separator
   - `label` (string, required for links and dropdowns)
   - `href` (string, required for links; not for dropdowns/separators)
   - `icon` (optional, raw HTML; if user mentions a Bootstrap Icon name like `house`, expand to `<i class='bi bi-house'></i>`)
   - Visibility filter: none / `showWhen: "authenticated"` / `showWhen: "unauthenticated"` / `requiresAuth: true` + `allowedRoles: [...]`
   - For dropdowns: nested `items` array (links and `{ "type": "divider" }`)
6. **Optionally — insert render() into an EJS template?** Ask if the user wants the skill to also insert `<%- passData.plugin.bootstrapNavbar.render({name: '<name>'}, passData) %>` into a template. If yes, ask for the template path and where (top of `<body>`, after `<header>`, etc.).

If the user gives a vague brief ("make me a main navbar with home, about, login"), ask one focused follow-up to fill the visibility/auth details — do not invent role IDs or auth rules.

## Conventions to enforce

- File name MUST be exactly `navbar.<name>.json5` (the plugin's `render({name: '<name>'})` resolves to this filename).
- First line MUST be the JSON5 header comment: `// This file follows the JSON5 standard - comments and trailing commas are supported`
- The config has exactly two top-level keys: `settings` and `sections`.
- `sections` has exactly two keys: `left` and `right` (either can be an empty array).
- Settings `id` defaults to `"navbar<PascalCaseName>"` (e.g., name `main` → `id: "navbarMain"`); used as the HTML id and as the dropdown id namespace.
- HTTP method strings, role IDs, and auth flags are case-sensitive — copy them verbatim.
- Use double-quoted JSON5 keys/strings (matches the existing examples in `/www/navbarExamples/`).
- Icons are inserted as **raw HTML** (the renderer does not escape them). Only use trusted icon snippets (Bootstrap Icons, FontAwesome, emoji).
- Labels and hrefs ARE escaped by the renderer — no manual escaping needed.
- Don't add comments inside the generated JSON5 unless the user explicitly asks (the file should look like a clean config, not a tutorial). Exception: the mandatory header line.

## Visibility filter cheat sheet (used when building items)

Priority order applied by the renderer: `showWhen` → `requiresAuth` → `allowedRoles`.

| User intent | Fields to set |
|-------------|---------------|
| Visible to everyone | (no visibility fields) |
| Only logged-in users | `"showWhen": "authenticated"` |
| Only guests | `"showWhen": "unauthenticated"` |
| Logged-in with specific roles | `"requiresAuth": true, "allowedRoles": [0, 1]` |
| Logged-in, any role | `"requiresAuth": true, "allowedRoles": []` |

Hardcoded ital8cms role IDs: `0` root, `1` admin, `2` editor, `3` selfEditor. Custom roles start at `100`. Ask the user before assigning role IDs — never guess.

## File templates

Substitute placeholders: `{{name}}` (camelCase), `{{idName}}` (`navbar<PascalCaseName>`), `{{bgClass}}`, `{{colorScheme}}`, `{{expandAt}}`, `{{containerClass}}`, `{{position}}`, plus item-specific values.

### Horizontal navbar

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "{{colorScheme}}",
    "bgClass": "{{bgClass}}",
    "expandAt": "{{expandAt}}",
    "containerClass": "{{containerClass}}",
    "autoActive": true,
    "id": "{{idName}}",
  },

  "sections": {
    "left": [
      // items here
    ],

    "right": [
      // items here
    ],
  },
}
```

### Vertical (sidebar) navbar

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "vertical",
    "colorScheme": "{{colorScheme}}",
    "bgClass": "{{bgClass}}",
    "autoActive": true,
    "position": "{{position}}",
    "id": "{{idName}}",
  },

  "sections": {
    // In vertical navbars, "left" = top section, "right" = bottom section (separated by <hr>)
    "left": [
      // items here
    ],

    "right": [
      // items here
    ],
  },
}
```

### Offcanvas (drawer) navbar

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "offcanvas",
    "colorScheme": "{{colorScheme}}",
    "bgClass": "{{bgClass}}",
    "expandAt": "{{expandAt}}",
    "containerClass": "{{containerClass}}",
    "autoActive": true,
    "offcanvasAlways": false,
    "position": "{{position}}",
    "id": "{{idName}}",
  },

  "sections": {
    "left": [
      // items here
    ],

    "right": [
      // items here
    ],
  },
}
```

### Item snippets

**Regular link:**
```json5
{ "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" }
```

**Link with auth (admin/root only):**
```json5
{ "label": "Admin", "href": "/admin", "icon": "<i class='bi bi-shield-lock'></i>", "requiresAuth": true, "allowedRoles": [0, 1] }
```

**Link visible only when logged in / only when logged out:**
```json5
{ "label": "Profile", "href": "/pluginPages/adminUsers/userProfile.ejs", "showWhen": "authenticated" }
{ "label": "Login",   "href": "/pluginPages/adminUsers/login.ejs",       "showWhen": "unauthenticated" }
```

**Dropdown:**
```json5
{
  "type": "dropdown",
  "label": "Pages",
  "icon": "<i class='bi bi-file-earmark'></i>",
  "items": [
    { "label": "About", "href": "/about.ejs" },
    { "label": "Contact", "href": "/contact.ejs" },
    { "type": "divider" },
    { "label": "Blog", "href": "/blog.ejs" },
  ],
}
```

**Separator (visual `|` between items, only between top-level items):**
```json5
{ "type": "separator" }
```

**Divider (only valid inside a dropdown's `items` array):**
```json5
{ "type": "divider" }
```

### EJS render call (only if user opts in)

```ejs
<%- passData.plugin.bootstrapNavbar.render({name: '{{name}}'}, passData) %>
```

With cross-directory lookup (config not in same dir as template):
```ejs
<%- passData.plugin.bootstrapNavbar.render({name: '{{name}}', configDir: '/'}, passData) %>
```

With runtime setting overrides (rare — use only if user asks):
```ejs
<%- passData.plugin.bootstrapNavbar.render({
  name: '{{name}}',
  settingsOverrides: { colorScheme: 'light', bgClass: 'bg-light' }
}, passData) %>
```

## Generation procedure

1. Summarize the gathered inputs back to the user (navbar name, type, output path, full settings, full items list, optional EJS insertion). Wait for explicit confirmation before writing.
2. Verify the target file does not already exist. If it does: stop, tell the user, do not overwrite (suggest a different `<name>` or removing the existing file).
3. Write `navbar.<name>.json5` to the chosen output directory using the Write tool.
4. If the user opted in to template insertion: read the target EJS, Edit it to add the render call at the agreed location, and confirm the insertion point in the summary.
5. Print a short final summary:
   - File created (absolute path)
   - URL pattern where the navbar will appear (the template that includes it)
   - Reminder that production mode caches the config: in production (`debugMode: 0`) the server must be restarted to pick up changes; in debug mode changes are live.
   - If any item references a route that doesn't exist yet (e.g., `/admin/...` when the user hasn't set up admin), flag it as a TODO.

## Things to avoid

- Don't create or modify the `bootstrapNavbar` plugin source files — they ship with ital8cms.
- Don't include `weight`, `dependency`, or any `pluginConfig.json5`-style fields in the navbar config — this is a config file consumed by the plugin, not a plugin manifest.
- Don't invent role IDs (custom roles `100+`) — ask the user; for hardcoded roles use only `0`, `1`, `2`, `3`.
- Don't add comments inside the generated config beyond the mandatory JSON5 header line (unless explicitly requested).
- Don't add `divider` items at the top level of `sections.left` / `sections.right` — they only render correctly inside a dropdown's `items` array. Use `separator` at the top level instead.
- Don't add `separator` items inside a dropdown's `items` array — use `divider` there.
- Don't escape icon HTML — the renderer treats icons as trusted raw HTML by design.
- Don't omit the `id` setting — it's used as the HTML id and to namespace dropdown ids; missing or duplicate ids break Bootstrap collapse/dropdown JS.
- Don't generate a `README.md` or any documentation file alongside the config.
