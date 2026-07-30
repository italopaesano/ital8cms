---
name: ital8cms-plugin-creator
description: Scaffold a new ital8cms plugin. Use when the user asks to create, scaffold, or generate an ital8cms plugin (minimal, with webPages, admin, or with global template functions). Also scaffolds the mandatory ital8doc documentation (README.it.md + English stub, optional EXPLAIN) and supports the self-contained per-plugin npm dependency model (own package.json). Works both inside an ital8cms repository and standalone (outputs a self-contained plugin folder ready to be dropped into `plugins/`).
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
7. **Writable data directory** (optional, applies to **any** variant) — ask: *does the plugin write its own data to disk at runtime?* (event logs, JSONL, state files, caches, generated assets, per-plugin JSON stores, …). If **yes**:
   - Gather the default `dataPath` (relative to the plugin folder, default `./data`).
   - The generated plugin MUST declare that directory via `getWritablePaths()` (see the "Writable data directory" template below) so the boot gate verifies/pre-creates it.
   - If **no** (API-only, pure middleware, no disk writes of its own): omit `getWritablePaths()` and `custom.dataPath` entirely.
8. **npm dependency model** (optional, applies to **any** variant) — ask: *does the plugin need npm packages?* If **yes**, ask which model (the project uses a hybrid per-plugin model — see [`docs/self-update.it.md`](../../../docs/self-update.it.md)):
   - **self-contained** (recommended for new plugins) — the plugin ships its own `package.json`; the packages install into `plugins/<name>/node_modules` (git-ignored, preserved across updates, resolved plugin-local first by Node). `nodeModuleDependency` in `pluginConfig.default.json5` stays **empty**. Pilot: `adminMedia`.
   - **legacy** (root `node_modules`) — no `package.json`; declare the packages in `nodeModuleDependency` (name → semver range); they install into the **root** `node_modules`.
   - Gather the package name(s) and semver range(s). Ask whether any should be **optional** (graceful degradation if absent, e.g. native modules like `sharp`) → `optionalDependencies` in the self-contained model.
   If **no** npm deps (only other-plugin deps or none): keep `nodeModuleDependency: {}` and don't create a `package.json`.

## Conventions to enforce

- All config files use the `.json5` extension and a comment on line 1: `// This file follows the JSON5 standard - comments and trailing commas are supported`
- **Config lifecycle (sidecar `.default`):** the plugin descriptor is committed as `pluginConfig.default.json5` (source of truth); the live `pluginConfig.json5` is git-ignored and materialized at boot. The `.default` has `schemaVersion` as its first key and **omits** `isInstalled` (a runtime state written at boot). The static `pluginDescription.json5` has **no** `.default` (it is committed as-is). See [`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md).
- **Distributing the plugin as a Git repo** (installable from the admin GUI, repo named `ital8cms-plugin-<name>`): the same rule is a hard contract. `pluginConfig.default.json5` is **required** — the install aborts without it — and the live `pluginConfig.json5` **must not be published**; if the repo ships one anyway, the install discards it and regenerates it from the `.default` (with a warning). The installer materializes *every* `.default` in the folder, so a plugin's secondary config files travel the same way: ship `myStore.default.json5`, never the live twin.
- **Evolving the config later → `migrations/`.** `schemaVersion` is not just a number to bump: it is the **clock** of the whole package. When you later change the structure of *any* `.default` in the plugin, bump the **descriptor's** `schemaVersion` and declare the step in `migrations/migrations.json5`. Existing installations get the change through that declaration — a bump alone only propagates **added** keys (the boot's recursive additive merge), never renames, removals or changed values. See the "Config migrations" add-on below and [`docs/decisions/config-migrations.it.md`](../../../docs/decisions/config-migrations.it.md).
- Inside an ital8cms project, configs are loaded via `loadJson5()` — never `require()`. The generated plugin code follows this rule.
- All routes returned from `getRouteArray()` MUST include the `access` field (`requiresAuth`, `allowedRoles`). Method strings MUST be UPPERCASE (`'GET'`, `'POST'`, `'PUT'`, `'DEL'`, `'ALL'`). Handler key MUST be `handler`, not `func`.
- Naming: camelCase for files/dirs/variables/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants.
- **Documentation (ital8doc v1-1, MANDATORY).** Every plugin ships `README.it.md` — the Italian **reference** ("how do I USE it?") — plus an English `README.md` **stub**. Add `EXPLAIN.it.md` (+ its `EXPLAIN.md` stub) — "why is it built this way + how do I tune it?" — **only** when the plugin has non-trivial internals worth a deep-dive; an empty or README-duplicating EXPLAIN is **forbidden**. Line 1 of each doc is the ital8doc marker, line 2 the English pointer note. See [`docs/ITAL8DOC-latest.md`](../../../docs/ITAL8DOC-latest.md).
- **npm dependencies — hybrid per-plugin model.** For new plugins prefer **self-contained** (own `package.json` → `plugins/<name>/node_modules`, git-ignored) and keep `nodeModuleDependency` **empty**; the **legacy** model (declared in `nodeModuleDependency`, installed at root) still works. A plugin-local dependency MUST be `require`d **from inside the plugin** (`main.js` / its `lib/*.js`), never delegated to a `core/*` file, and plugins MUST NOT bundle the framework (`koa`, `@koa/router`) nor enable npm `workspaces`. See [`docs/self-update.it.md`](../../../docs/self-update.it.md).
- **Admin GUI (admin variant): prefer the twin pattern + follow the Three Views.** A service plugin that needs a management UI should ship it as a separate twin named `admin<Service>`; an admin section exposes up to three coordinated views (Data view / raw JSON5 editor / structured form) on the same file/state. See CLAUDE.md → *Twin Admin Plugin* and *Le Tre Viste* (details in the admin-variant template below).
- **Writable data directories → declare them with `getWritablePaths()`.** Any plugin that writes its own data to disk at runtime (a data dir it creates lazily and writes to) MUST expose `getWritablePaths(pluginSys, pathPluginFolder) → Array<{ path, purpose }>`. At boot, `pluginSys` calls it while loading the plugin (via `core/storageWritabilityCheck.js`) and probes each path with a **real** write (creates the dir + writes/deletes a temp file). If a declared dir is **not** writable (read-only FS, systemd sandbox without `ReadWritePaths=`, wrong owner/permissions, full disk), that plugin is **skipped gracefully** with a clear `[STORAGE]` box and the boot proceeds (an *essential* plugin still aborts the boot). If writable, the probe **pre-creates** the dir so the first write is smooth. Two rules: (1) `getWritablePaths()` MUST resolve its paths **offline from config** (read `pluginConfig.json5 → custom.dataPath`), because the gate runs *before* `loadPlugin()` and the setup wizard introspects plugins without loading them — do **not** rely on state set inside `loadPlugin()`; (2) runtime writes to that dir MUST be **fail-soft** (atomic temp+rename, wrapped in try/catch that logs and skips — never throw), so a later write failure degrades quietly instead of crashing the server.
- Don't add error handling, validation, or comments beyond what the variant strictly needs.

## File templates

Use these as the base output. Substitute placeholders `{{pluginName}}`, `{{pluginNameLower}}` (the plugin name lowercased, for the npm `name` field), `{{description}}`, `{{author}}`, `{{email}}`, `{{license}}`, `{{sectionId}}`, `{{pageName}}`, `{{functionName}}`, `{{npmPackage}}`, `{{npmRange}}`.

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

> **Twin admin pattern (recommended).** If this admin GUI is the management face of a
> separate **service** plugin (domain logic, runtime state, its own `.json5` files, a
> shared object), scaffold it as a twin named `admin<Service>` (service `seo` → twin
> `adminSeo`; `media` → `adminMedia`). The twin **depends on** the service
> (`dependency: { "<service>": "^x.y.z" }`), resolves the service folder via
> `pluginSys.getPlugin('<service>').pathPluginFolder` to read/write its config files, and
> pulls its shared object via `pluginSys.getSharedObject('<service>')` for live data and
> actions. Keep the service plugin **headless** (no admin UI). Combine service + admin in a
> single `admin*` plugin **only** when the domain is itself admin-centric (like `adminUsers`,
> `adminAccessControl`). See CLAUDE.md → *Best Practice per i plugin admin — Twin Admin Plugin*.
>
> **The Three Views (admin GUI convention).** A section exposes up to three coordinated
> views on the same underlying `.json5`/state, added as needed:
> **A. Data view** — live state/metrics + live actions (**mandatory** if the plugin has
> runtime state/stats);
> **B. raw JSON5 editor** — edits the real `.json5` file (**always present for config** — the
> single source of truth and the power-user fallback);
> **C. structured form** — optional guided editing for rich config, coordinated with B via a
> **shared server-side validator** (explicit "load form ↔ regenerate JSON5" switch with an
> unsaved-changes warning).
> Cross-cutting, always: i18n via the global `__()` helper, Bootstrap-5 responsive (tabs
> collapse to a `<select>` on mobile), **XSS-escaped** output for dynamic/user data, correct
> `access` roles (sensitive config → `[0, 1]`), atomic writes (temp + rename) + backup where it
> makes sense, and hot-reload via the shared object (or "Save & restart" for boot-time settings).
> See CLAUDE.md → *Convenzioni Admin GUI — Le Tre Viste*.

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

### Writable data directory (`getWritablePaths`) — optional add-on

Apply this **only** when the user confirmed (input #7) that the plugin writes its own data to disk. It composes with **any** variant. Two edits to the base templates:

**1. Add `dataPath` to `custom` in `pluginConfig.default.json5`:**

```json5
  custom: {
    // Directory (relativa alla cartella del plugin) dove il plugin scrive a runtime.
    // Dichiarata via getWritablePaths(): al boot viene sondata/pre-creata.
    dataPath: "{{dataPath}}",  // default: "./data"
  },
```

**2. Add `getWritablePaths()` to `main.js`** (and export it if the plugin uses the named-export style like `plugins/exampleComplete`):

```javascript
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

// ... inside module.exports (or as a named function that you export):

  /**
   * Dichiara le data dir che il plugin deve poter scrivere a runtime.
   * Il gate di boot (core/storageWritabilityCheck.js) la sonda con una scrittura
   * effettiva e la pre-crea; se non scrivibile, QUESTO plugin è saltato in modo
   * graceful (box [STORAGE], il boot prosegue). Risolve il path OFFLINE dal
   * config, perché il gate gira PRIMA di loadPlugin (e il wizard introspeziona i
   * plugin senza caricarli): non affidarti a stato impostato in loadPlugin().
   */
  getWritablePaths(pluginSys, pathPluginFolder) {
    const folder = pathPluginFolder || __dirname;
    let dataPath;
    try {
      const custom = loadJson5(path.join(folder, 'pluginConfig.json5')).custom || {};
      dataPath = custom.dataPath || './data';
    } catch (_) {
      return [];
    }
    return [{ path: path.resolve(folder, dataPath), purpose: '{{pluginName}} data storage' }];
  },
```

**Runtime writes must be fail-soft.** Whenever the plugin actually writes into that dir, use atomic writes (temp + `rename`) wrapped in `try/catch` that logs and skips — never let a write error propagate (it would 500 a request or crash the process). Reference: the `analytics` plugin (`plugins/analytics/lib/fileManager.js` + `getWritablePaths` in its `main.js`).

### Documentation (ital8doc) — README mandatory, EXPLAIN optional

Per the **ital8doc v1-1** standard ([`docs/ITAL8DOC-latest.md`](../../../docs/ITAL8DOC-latest.md)),
**always** generate the Italian reference `README.it.md` **and** its English `README.md`
stub. Generate `EXPLAIN.it.md` (+ `EXPLAIN.md` stub) **only** when the plugin has
non-trivial internals worth explaining — never an empty or README-duplicating EXPLAIN.

`README.it.md` (reference — where you write; fill the TODOs from the actual plugin):

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# {{pluginName}}

{{description}}

## Cosa fa

- TODO: elenco funzionalità

## Uso / Quick start

TODO: esempio minimo funzionante (URL della rotta / pagina).

## API / Contratto

TODO: rotte (`/api/{{pluginName}}/...`), oggetto condiviso, funzioni template.

## Configurazione

TODO: tabella dei campi `custom` di `pluginConfig.json5` (riferimento canonico).

## File

TODO: mappa sintetica dei file del plugin.

## Dipendenze

TODO: dipendenze verso altri plugin (`dependency`) e npm (self-contained `package.json` oppure `nodeModuleDependency`).
```

`README.md` (English stub — the GitHub face; never left empty):

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `README.it.md`. The English edition will be filled in at release.
# {{pluginName}}

> English translation pending. Authoritative version: [`README.it.md`](./README.it.md).
```

`EXPLAIN.it.md` (**only** for non-trivial internals):

```markdown
<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# {{pluginName}} — Deep-dive tecnico
> Guida d'uso: vedi README.it.md

## Perché è fatto così

TODO: filosofia + vincolo architetturale portante (il cuore dell'EXPLAIN).

## Architettura

TODO: componenti, modello dati, macchine a stati.

## Regolazione & estensione

TODO: tuning consapevole (conseguenze delle scelte di config), trade-off, come estenderlo.
```

`EXPLAIN.md` (English stub, paired with the above):

```markdown
<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `EXPLAIN.it.md`. The English edition will be filled in at release.
# {{pluginName}} — Technical deep-dive

> English translation pending. Authoritative version: [`EXPLAIN.it.md`](./EXPLAIN.it.md).
```

### Config migrations (`migrations/`) — not for a new plugin, but say so

**Do NOT scaffold `migrations/` for a brand-new plugin.** A plugin at
`schemaVersion: 1` has no installation in the wild to migrate *from*, so an empty
migrations folder is noise.

**Do tell the user, in the final summary, what to do at the first structural
change** — it is the single most-missed step, and getting it wrong means existing
installations silently keep the old config:

> When you later change the structure of any `.default` in this plugin (add,
> rename or remove a key, or change a default value), bump `schemaVersion` in
> `pluginConfig.default.json5` **and** declare the step in `migrations/migrations.json5`.
> Adding a key would also travel on its own via the boot's recursive merge, but
> renames, removals and changed values reach existing installations **only** through
> a declared migration.

The shape, for when that moment comes:

```
plugins/<name>/migrations/
├── migrations.json5        index of the steps
├── CHANGELOG.md            what changed and why
├── from-v1-to-v2.md        human/AI-actionable instructions (fixed sections)
├── from-v1-to-v2.js        optional script
└── from-v1-to-v2/          optional materials for that step
```

```json5
// migrations.json5
{
  schemaVersion: 1,
  steps: [
    {
      from: 1, to: 2,
      title: "custom.dataPath introdotto",
      automatic: true,
      // MANDATORY even when automatic: say WHY it is safe, not just that it is.
      reason: "Sola aggiunta di una chiave con default sano: il merge additivo basta.",
      // script: "from-v1-to-v2.js",   // omit when the additive merge is enough
      touches: ["pluginConfig.json5"],
    },
  ],
}
```

Three strategies, derived with no extra fields: `automatic: true` **without**
`script` → the recursive additive merge is enough (added keys only — the common
case); `automatic: true` **with** `script` → renames, removals, changed values;
`automatic: false` → a human or an AI follows the `.md`, and the chain resumes via
`verify()` or `--confirm-manual`. Scripts must be **idempotent** and must respect
`ctx.dryRun`; prefer `ctx.setJson5Key` over rewriting the whole file with
`saveJson5`, which loses the live config's comments.

Applied with `npm run cli -- migrate <plugin>`; the boot only *reports* pending
migrations in a `[MIGRATE]` box.

### Self-contained npm dependencies (`package.json`) — optional add-on

Apply **only** when the user chose the **self-contained** npm model (input #8) — the
plugin needs npm packages and should carry them plugin-local. Composes with **any**
variant. Two parts:

**1. Create `package.json` in the plugin folder.** The packages install into
`plugins/{{pluginName}}/node_modules` via `npm install` run **inside** the folder, and
Node resolves them plugin-local first:

```json
{
  "name": "ital8cms-plugin-{{pluginNameLower}}",
  "version": "0.0.1",
  "description": "{{description}}",
  "private": true,
  "license": "{{license}}",
  "author": "{{author}} <{{email}}>",
  "dependencies": {
    "{{npmPackage}}": "{{npmRange}}"
  }
}
```

Put in `optionalDependencies` (instead of `dependencies`) any package whose absence
should degrade gracefully rather than block the plugin (native modules like `sharp`);
the plugin code must guard the `require`. Reference: `adminMedia`.

**2. Keep `nodeModuleDependency` EMPTY in `pluginConfig.default.json5`:**

```json5
  // Self-contained: le dipendenze npm sono in package.json (→ plugins/{{pluginName}}/node_modules).
  // nodeModuleDependency resta VUOTO: il boot gate del modello-root non deve controllare deps plugin-local.
  nodeModuleDependency: {},
```

The `require` MUST happen from inside the plugin (`main.js` or its `lib/*.js`), never from
a `core/*` file; don't bundle the framework (`koa`, `@koa/router`) — use it from root.

For the **legacy** model instead, skip the `package.json` and declare the packages in
`nodeModuleDependency` (they install into the **root** `node_modules`):

```json5
  nodeModuleDependency: {
    "{{npmPackage}}": "{{npmRange}}",
  },
```

## Generation procedure

1. Confirm the gathered inputs back to the user as a single summary block (variant, name, output path, files to create). Wait for explicit confirmation before writing.
2. Verify the output directory does not already exist. If it does: stop, tell the user, do not overwrite.
3. Create the directory tree and write the files using the Write tool. Order: `pluginDescription.json5`, `pluginConfig.default.json5`, `main.js`, then variant-specific files, then the **documentation** — `README.it.md` + `README.md` stub (always), plus `EXPLAIN.it.md` + `EXPLAIN.md` stub **only** if the plugin has non-trivial internals. If the user chose the self-contained npm model (input #8), also write `package.json` (and keep `nodeModuleDependency` empty). If the user confirmed a writable data directory (input #7), apply the "Writable data directory" add-on (`custom.dataPath` + `getWritablePaths()`). **Do not** create the data directory yourself — the boot gate pre-creates it. **Do not** write a live `pluginConfig.json5` — it is materialized at boot from the `.default`.
4. After writing, print a short summary:
   - Files created (relative paths), including the docs (`README.it.md` + stub, and EXPLAIN pair if generated) and `package.json` if self-contained
   - Manual steps the user must take (admin section registration, whitelist entry, moving the folder into `plugins/` if scaffolded standalone, restarting the server; **for the self-contained model: run `npm install` inside the plugin folder** so its `node_modules` is populated, or run root `npm install` / `npm run deps-sync` which reconciles active plugins)
   - Reminder to fill the `README.it.md` TODOs (and EXPLAIN, if generated) — a shipped-but-empty README is out of ital8doc spec
   - If a writable data directory was declared: note that it is created/verified automatically at boot, and that on a read-only/sandboxed host the plugin will be skipped with a `[STORAGE]` message until the directory is made writable
   - **The config-migration note** (see the "Config migrations" add-on): at the first structural change of any `.default`, bump `schemaVersion` **and** declare the step in `migrations/` — otherwise renames, removals and changed values never reach existing installations
   - URL where the new plugin will be reachable, computed from variant:
     - minimal/admin: `/api/{{pluginName}}/...` (and `/admin/{{sectionId}}/index.ejs` for admin)
     - webPages: `/pluginPages/{{pluginName}}/{{pageName}}.ejs`
5. Do not run `npm install`, do not start the server, do not modify `ital8Config.json5` or `/core/admin/adminConfig.json5` automatically.

## Standalone use (outside an ital8cms repo)

If the current directory does not look like an ital8cms project, still scaffold the plugin folder (do not require any specific surrounding structure). Tell the user explicitly that they need to:
- Copy the generated folder into the `plugins/` directory of their ital8cms installation
- `active: 1` is already set in `pluginConfig.default.json5`; on restart the server materializes the live `pluginConfig.json5` from it and writes `isInstalled` — no manual file step needed
- If the plugin is **self-contained** (has its own `package.json`), run `npm install` inside the plugin folder (or root `npm install` / `npm run deps-sync`) so its `node_modules` is populated before the plugin loads

## Things to avoid

- Do generate the ital8doc docs: `README.it.md` + its `README.md` stub are **mandatory**; add `EXPLAIN.it.md` (+ stub) **only** for non-trivial internals (empty/redundant EXPLAIN is forbidden). Don't create `CHANGELOG.md` or other docs unless the user asks.
- Don't ship an English `README.md`/`EXPLAIN.md` with real content — it's a **stub** (marker + pointer to the `.it.md`); the reference is always the `.it.md`.
- Don't fill `nodeModuleDependency` when using the self-contained model — keep it empty (the deps live in the plugin's `package.json`). Conversely, don't create a `package.json` for the legacy model.
- Don't `require()` a plugin-local dependency from a `core/*` file, don't bundle the framework (`koa`, `@koa/router`), and don't enable npm `workspaces` — all three break Node's plugin-local resolution.
- Don't add tests unless the user asks (the project has a `plugins/<name>/tests/` convention, but generating empty test scaffolding is out of scope here).
- Don't add a `webPages/` directory to the minimal/admin/globalFunctions variants.
- Don't omit the `access` field from any route — the ital8cms boot validation will fail.
- Don't use lowercase HTTP methods or `func` instead of `handler` — routes will be silently ignored.
- Don't scaffold a `migrations/` folder for a brand-new plugin (nothing to migrate from at `schemaVersion: 1`) — but don't stay silent about it either: the summary must tell the user what to do at the first structural change.
- Don't add `getWritablePaths()` to a plugin that doesn't write its own data to disk (API-only, pure middleware) — it's only for plugins with a runtime data directory.
- Don't make `getWritablePaths()` depend on state set inside `loadPlugin()` — it runs *before* `loadPlugin` and offline in the wizard; resolve paths from `custom.dataPath` in the config.
- Don't create the data directory during scaffolding — the boot gate creates/verifies it (and creating it early would mask a non-writable-host problem).
