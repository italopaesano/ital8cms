---
name: ital8cms-plugin-creator
description: Scaffold a new ital8cms plugin. Use when the user asks to create, scaffold, or generate an ital8cms plugin (minimal, with webPages, admin, or with global template functions). Works both inside an ital8cms repository and standalone (outputs a self-contained plugin folder ready to be dropped into `plugins/`).
---

# ital8cms Plugin Creator

This skill scaffolds a new plugin for **ital8cms** (a Koa.js modular CMS). It produces a self-contained plugin directory that can be placed in the `plugins/` folder of an ital8cms project, regardless of whether this skill is run inside that project or in another working directory.

## When to use

Invoke when the user wants to:
- Create a new ital8cms plugin
- Scaffold a plugin with web pages (`webPages/` convention)
- Scaffold an admin plugin (name starts with `admin*`, declares `adminSections`)
- Scaffold a plugin that exposes a global template function via the whitelist

Do **not** invoke for: editing an existing plugin, creating a theme, configuring `ital8Config.json5`, or managing the admin system globally.

## Required information (ask before generating)

Before writing any file, gather these inputs from the user. **Do not guess.** Always propose 2–3 alternatives for naming when the user hasn't specified one (project convention).

1. **Plugin variant** — one of:
   - `minimal` — only `main.js`, `pluginConfig.default.json5`, `pluginDescription.json5`
   - `webPages` — adds `webPages/` directory with one EJS page
   - `admin` — admin plugin (name MUST start with `admin`), adds `adminWebSections/<sectionId>/` and registers section
   - `globalFunctions` — exposes one function globally via `getGlobalFunctionsForTemplates()` (must be added to whitelist in `ital8Config.json5`)
2. **Plugin name** (camelCase). For variant `admin`, must start with `admin` (e.g., `adminMailer`). Validate:
   - Matches `^[a-zA-Z][a-zA-Z0-9]*$`
   - For admin variant: matches `^admin[A-Z][a-zA-Z0-9]*$`
3. **Output location** — absolute path of the destination directory. Default candidates, in order:
   - `<cwd>/plugins/<pluginName>` if `<cwd>/plugins/` exists and looks like an ital8cms project (has `ital8Config.json5` in the parent or `package.json` with `koa-classic-server` dep)
   - `<cwd>/<pluginName>` otherwise (standalone scaffold; tell the user to move it into their `plugins/` folder)
   Confirm with the user before writing.
4. **Plugin description** (one short sentence) for `pluginDescription.json5`.
5. **Author + email + license** — if user hasn't said, ask once and reuse. Defaults: license `ISC`.
6. **Variant-specific extras**:
   - `webPages`: name of the first page (default: `index`, becomes `index.ejs`)
   - `admin`: list of `adminSections` IDs (one or more, camelCase). For each, ask the user to also add an entry in `/core/admin/adminConfig.json5` and tell them exactly what to add (label, icon, description) — **don't** edit `adminConfig.json5` automatically unless the user explicitly asks.
   - `globalFunctions`: function name (must be a valid identifier; e.g., `__`, `t`, `formatDate`). Tell the user they MUST also add it to `globalFunctionsWhitelist` in `ital8Config.json5`, and show them the snippet.

## Conventions to enforce

- All config files use the `.json5` extension and a comment on line 1: `// This file follows the JSON5 standard - comments and trailing commas are supported`
- **Config lifecycle (sidecar `.default`):** the plugin descriptor is committed as `pluginConfig.default.json5` (source of truth); the live `pluginConfig.json5` is git-ignored and materialized at boot. The `.default` has `schemaVersion` as its first key and **omits** `isInstalled` (a runtime state written at boot). The static `pluginDescription.json5` has **no** `.default` (it is committed as-is). See [`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md).
- Inside an ital8cms project, configs are loaded via `loadJson5()` — never `require()`. The generated plugin code follows this rule.
- All routes returned from `getRouteArray()` MUST include the `access` field (`requiresAuth`, `allowedRoles`). Method strings MUST be UPPERCASE (`'GET'`, `'POST'`, `'PUT'`, `'DEL'`, `'ALL'`). Handler key MUST be `handler`, not `func`.
- Naming: camelCase for files/dirs/variables/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants.
- Don't add error handling, validation, or comments beyond what the variant strictly needs.

## File templates

Use these as the base output. Substitute placeholders `{{pluginName}}`, `{{description}}`, `{{author}}`, `{{email}}`, `{{license}}`, `{{sectionId}}`, `{{pageName}}`, `{{functionName}}`.

### `pluginDescription.json5` (all variants)

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  name: "{{pluginName}}",
  version: "0.0.1",
  description: "{{description}}",
  author: "{{author}}",
  email: "{{email}}",
  license: "{{license}}",
}
```

### `pluginConfig.default.json5`

**Generate the `.default` sidecar, NOT a live `pluginConfig.json5`.** Per the config
lifecycle ([`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md)),
`pluginConfig.default.json5` is the committed source of truth; the live
`pluginConfig.json5` is git-ignored and **materialized at boot** from the `.default`
(`materializeMissingConfigs`). Two rules for the `.default`:

- **`schemaVersion`** (integer) is the **first key** — it versions the *structure* of
  the file (bump it when you add/rename/remove keys).
- **Do NOT include `isInstalled`** — it is a runtime state written at boot by
  `pluginSys` (it tracks whether preconditions/install ran), not part of the source
  of truth.

**Minimal / webPages / globalFunctions variant:**

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  schemaVersion: 1,  // Versione della STRUTTURA del file (incrementare quando cambiano le chiavi). Vedi docs/decisions/config-lifecycle.it.md
  active: 1,
  weight: 100,
  dependency: {},
  nodeModuleDependency: {},
  custom: {},
}
```

**Admin variant** (add `adminSections`):

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  schemaVersion: 1,  // Versione della STRUTTURA del file (incrementare quando cambiano le chiavi). Vedi docs/decisions/config-lifecycle.it.md
  active: 1,
  weight: 100,

  // Plugin con nome che inizia per "admin" sono automaticamente plugin admin.
  // Array di ID delle sezioni admin gestite da questo plugin.
  // I metadata UI (label, icon, description) sono in /core/admin/adminConfig.json5.
  adminSections: [
    "{{sectionId}}",
  ],

  dependency: {},
  nodeModuleDependency: {},
  custom: {},
}
```

### `main.js` — minimal variant

```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
  },

  getRouteArray() {
    return [
      {
        method: 'GET',
        path: '/hello',
        access: { requiresAuth: false, allowedRoles: [] },
        handler: async (ctx) => {
          ctx.body = { plugin: '{{pluginName}}', message: 'hello' };
        },
      },
    ];
  },
};
```

### `main.js` — webPages variant

The page is served automatically by the Plugin Pages System at `/pluginPages/{{pluginName}}/{{pageName}}.ejs`. No GET route needed; expose POST endpoints (if any) via `getRouteArray()`.

```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
  },

  getRouteArray() {
    return [];
  },
};
```

`webPages/{{pageName}}.ejs`:

```ejs
<!DOCTYPE html>
<html lang="it">
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>
<%- passData.themeSys.injectPluginJs() %>
<title>{{pluginName}} — {{pageName}}</title>
</head>
<body>
<%- include(passData.themeSys.getThemePartPath('header.ejs')) %>
<%- passData.themeSys.injectPluginHtmlBefore() %>

<main class="plugin-page plugin-{{pluginName}} page-{{pageName}}">
  <h1>{{pluginName}}</h1>
</main>

<%- passData.themeSys.injectPluginHtmlAfter() %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

### `main.js` — admin variant

For each `sectionId` declared in `adminSections`, create `adminWebSections/<sectionId>/index.ejs`. The admin system creates the symlink at boot.

```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
  },

  getRouteArray() {
    return [
      {
        method: 'GET',
        path: '/list',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
          ctx.body = { items: [] };
        },
      },
    ];
  },
};
```

`adminWebSections/{{sectionId}}/index.ejs`:

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<title>{{sectionId}}</title>
</head>
<body>
<%- include(passData.themeSys.getThemePartPath('header.ejs')) %>

<main class="admin-section">
  <h1>{{sectionId}}</h1>
</main>

<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

After generation, **show** the user the snippet to add manually in `/core/admin/adminConfig.json5`:

```json5
sections: {
  // ... existing sections ...
  "{{sectionId}}": {
    type: "plugin",
    plugin: "{{pluginName}}",
    enabled: true,
    required: false,
    label: "TODO label",
    icon: "TODO icon",
    description: "TODO description",
  },
},
menuOrder: [
  // ... existing entries ...
  "{{sectionId}}",
],
```

### `main.js` — globalFunctions variant

```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
  },

  getRouteArray() {
    return [];
  },

  getObjectToShareToWebPages() {
    return {
      {{functionName}}: this.{{functionName}}.bind(this),
    };
  },

  getGlobalFunctionsForTemplates() {
    return {
      {{functionName}}: this.{{functionName}}.bind(this),
    };
  },

  {{functionName}}(...args) {
    return '';
  },
};
```

After generation, **show** the user the snippet to add manually to `globalFunctionsWhitelist` in `ital8Config.json5`:

```json5
globalFunctionsWhitelist: {
  // ... existing entries ...
  "{{functionName}}": {
    plugin: "{{pluginName}}",
    description: "TODO description",
    required: false,
  },
},
```

## Generation procedure

1. Confirm the gathered inputs back to the user as a single summary block (variant, name, output path, files to create). Wait for explicit confirmation before writing.
2. Verify the output directory does not already exist. If it does: stop, tell the user, do not overwrite.
3. Create the directory tree and write the files using the Write tool. Order: `pluginDescription.json5`, `pluginConfig.default.json5`, `main.js`, then variant-specific files. **Do not** write a live `pluginConfig.json5` — it is materialized at boot from the `.default`.
4. After writing, print a short summary:
   - Files created (relative paths)
   - Manual steps the user must take (admin section registration, whitelist entry, moving the folder into `plugins/` if scaffolded standalone, restarting the server)
   - URL where the new plugin will be reachable, computed from variant:
     - minimal/admin: `/api/{{pluginName}}/...` (and `/admin/{{sectionId}}/index.ejs` for admin)
     - webPages: `/pluginPages/{{pluginName}}/{{pageName}}.ejs`
5. Do not run `npm install`, do not start the server, do not modify `ital8Config.json5` or `/core/admin/adminConfig.json5` automatically.

## Standalone use (outside an ital8cms repo)

If the current directory does not look like an ital8cms project, still scaffold the plugin folder (do not require any specific surrounding structure). Tell the user explicitly that they need to:
- Copy the generated folder into the `plugins/` directory of their ital8cms installation
- `active: 1` is already set in `pluginConfig.default.json5`; on restart the server materializes the live `pluginConfig.json5` from it and writes `isInstalled` — no manual file step needed

## Things to avoid

- Don't create `README.md`, `CHANGELOG.md`, or other docs unless the user asks.
- Don't add tests unless the user asks (the project has a `plugins/<name>/tests/` convention, but generating empty test scaffolding is out of scope here).
- Don't add a `webPages/` directory to the minimal/admin/globalFunctions variants.
- Don't omit the `access` field from any route — the ital8cms boot validation will fail.
- Don't use lowercase HTTP methods or `func` instead of `handler` — routes will be silently ignored.
