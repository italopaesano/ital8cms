---
name: ital8cms-theme-creator
description: Scaffold a new ital8cms theme. Use when the user asks to create, scaffold, or generate an ital8cms theme (minimal, standard, complete with PLACEHOLDER markers, or admin). Also scaffolds the mandatory ital8doc documentation (README.it.md + English stub, optional EXPLAIN) and supports the self-contained per-theme npm dependency model (own package.json). Works both inside an ital8cms repository and standalone (outputs a self-contained theme folder ready to be dropped into `themes/`).
---

# ital8cms Theme Creator

This skill scaffolds a new theme for **ital8cms** (a Koa.js modular CMS). It produces a self-contained theme directory that can be placed in the `themes/` folder of an ital8cms project, regardless of whether this skill is run inside that project or in another working directory.

The reference theme used as inspiration for the `complete` variant is `themes/placeholderExample/` (the most feature-rich theme in the project). The `admin` variant is inspired by `themes/defaultAdminTheme/`. The `standard` variant follows the structure of `themes/default/`.

## When to use

Invoke when the user wants to:
- Create a new ital8cms theme (public or admin)
- Scaffold a minimal theme with only mandatory files
- Scaffold a standard theme with nav/main/aside partials + themeResources
- Scaffold a complete theme inspired by `placeholderExample` (multiple templates, PLACEHOLDER markers, plugin endpoints customization)
- Scaffold an admin theme (`isAdminTheme: true`)

Do **not** invoke for: editing an existing theme, creating a plugin (use `ital8cms-plugin-creator`), changing the active theme in `ital8Config.json5`, or working on theme system internals (`/core/themeSys.js`).

## Required information (ask before generating)

Before writing any file, gather these inputs from the user. **Do not guess.** Always propose 2–3 alternatives for naming when the user hasn't specified one (project convention).

1. **Theme variant** — one of:
   - `minimal` — only required files: `themeConfig.default.json5`, `themeDescription.json5`, `views/{head,header,footer}.ejs`, `templates/page.template.ejs`
   - `standard` — adds optional partials (`nav.ejs`, `main.ejs`, `aside.ejs`), `themeResources/css/theme.css`, `themeResources/js/theme.js`
   - `complete` — full placeholderExample-style: 4 templates (page, blog-post, landing, minimal), partials with PLACEHOLDER content blocks, `pluginsEndpointsMarkup/adminUsers/login/style.css`, themeResources
   - `admin` — admin theme (`isAdminTheme: true`), defaultAdminTheme-style: views with admin layout (sidebar, dashboard hooks), themeResources/js/escapeHtml.js placeholder, no `templates/` (admin themes don't have user-creatable pages)
2. **Theme name** (camelCase). Validate: matches `^[a-zA-Z][a-zA-Z0-9]*$`. Must not collide with an existing directory under `themes/` (when run inside a project).
3. **Output location** — absolute path of the destination directory. Default candidates, in order:
   - `<cwd>/themes/<themeName>` if `<cwd>/themes/` exists and looks like an ital8cms project (has `ital8Config.json5` or `package.json` with `koa-classic-server` dep)
   - `<cwd>/<themeName>` otherwise (standalone scaffold; tell the user to move it into their `themes/` folder)
   Confirm with the user before writing.
4. **Theme description** (one short sentence) for `themeDescription.json5`.
5. **Author + email + license** — if user hasn't said, ask once. Defaults: license `ISC`.
6. **Variant-specific extras**:
   - `minimal` / `standard`: nothing else.
   - `complete`: ask which subset of templates to include if the user wants fewer than the default 4. Default: all 4 (page, blog-post, landing, minimal).
   - `admin`: confirm `isAdminTheme: true`. Tell the user that admin themes are activated via `adminActiveTheme` (not `activeTheme`) in `ital8Config.json5`.
7. **npm dependency model** (optional) — most themes only need `ejs` (already a root dependency, kept in `nodeModuleDependency` for the boot check). Ask **only if** the theme pulls extra npm packages of its own; if so, pick a model (same hybrid per-package model as plugins — see [`docs/self-update.it.md`](../../../docs/self-update.it.md)):
   - **self-contained** — the theme ships its own `package.json`; packages install into `themes/<name>/node_modules` (git-ignored, resolved theme-local first). Keep those packages **out** of `nodeModuleDependency`.
   - **legacy** — declare the packages in `themeConfig.default.json5 → nodeModuleDependency` (installed at root); this is what the default template does for `ejs`.
   If no extra packages: leave the default `nodeModuleDependency: { ejs: "^6.0.0" }` and don't create a `package.json`.

## Conventions to enforce

- All config files use the `.json5` extension and a comment on line 1: `// This file follows the JSON5 standard - comments and trailing commas are supported`
- **Config lifecycle (sidecar `.default`):** the theme descriptor is committed as `themeConfig.default.json5` (source of truth); the live `themeConfig.json5` is git-ignored and materialized at boot. The `.default` has `schemaVersion` as its first key and **omits** both `isInstalled` (written at boot by `ensureThemesInstalled` for bundled themes) and `active` (removed from the schema). The static `themeDescription.json5` has **no** `.default`. See [`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md).
- **Distributing the theme as a Git repo** (installable from the admin GUI, repo named `ital8cms-theme-<name>`): the same rule is a hard contract. `themeConfig.default.json5` is **required** — the install aborts without it — and the live `themeConfig.json5` **must not be published**; if the repo ships one anyway, the install discards it and regenerates it from the `.default` (with a warning). Keeping `active` out of the `.default` matters here too: it is the one key the installer cannot strip without reserializing the file and losing its comments.
- **Evolving the config later → `migrations/`.** `schemaVersion` is the **clock** of the whole theme package. When you later change the structure of any `.default` in the theme, bump it in `themeConfig.default.json5` **and** declare the step in `migrations/migrations.json5`. A bump alone only propagates **added** keys (the boot's recursive additive merge), never renames, removals or changed values. Themes use the very same standard and the same core runner as plugins — they have no `main.js`, so there is no theme-side hook: it all goes through `migrations/`. See the "Config migrations" add-on below and [`docs/decisions/config-migrations.it.md`](../../../docs/decisions/config-migrations.it.md).
- Inside an ital8cms project, configs are loaded via `loadJson5()` — never `require()`. Themes themselves do not load config files at runtime, but follow the same JSON5 conventions.
- Naming: camelCase for theme name, files, and directories. Templates use compound names with `.template.ejs` suffix (e.g., `page.template.ejs`, `blog-post.template.ejs` is the documented exception — kebab is allowed in template basenames since the standard doc shows it).
- **PLACEHOLDER standard v1.0** (only for `complete` variant): content blocks are wrapped in EJS comment markers:
  ```
  <%# PLACEHOLDER name:fieldName type:text|html|richtext|markdown|image|... label:"..." %>
  default content
  <%# /PLACEHOLDER %>
  ```
- Templates MUST include `head.ejs`, `header.ejs`, `footer.ejs` partials and MUST NOT duplicate `<html>`, `<head>`, `<body>` tags (they are already in the partials).
- Partials use `passData.pluginSys.hookPage("section", passData)` for plugin integration (sections: `head`, `header`, `nav`, `main`, `body`, `aside`, `footer`, `script`).
- **Hooks may live in sub-partials, but every `include` must resolve.** The boot validator (`themeSys.validateThemeContent()`) searches each partial's **include tree**, not just the file, so factoring shared markup into an extra partial is fully supported: three layouts that all `include('siteFooter.ejs')`, with `hookPage("footer")` declared inside it, validate clean — and the injected content stays inside the `<footer>` the theme styles instead of rendering outside it. The counterpart is that an `include('x.ejs')` pointing at a file the theme does not ship is a **boot error**, because EJS throws at render on a missing include. Two consequences when generating: never leave a dangling `include`, and a hook counts wherever it sits in the tree of the partial that requires it.
- **Documentation (ital8doc v1-1, MANDATORY).** Every theme ships `README.it.md` — the Italian **reference** ("how do I USE / customize it?") — plus an English `README.md` **stub**. Add `EXPLAIN.it.md` (+ its `EXPLAIN.md` stub) — "why is it built this way + how do I tune it?" — **only** when the theme has non-trivial internals worth a deep-dive (an empty or README-duplicating EXPLAIN is **forbidden**). Line 1 of each doc is the ital8doc marker, line 2 the English pointer note. See [`docs/ITAL8DOC-latest.md`](../../../docs/ITAL8DOC-latest.md).
- **npm dependencies — hybrid per-theme model.** Themes follow the same per-package model as plugins: a theme that needs its own npm packages can be **self-contained** (own `package.json` → `themes/<name>/node_modules`, git-ignored) and keep those packages out of `nodeModuleDependency`, or **legacy** (declared in `nodeModuleDependency`, installed at root — the default for `ejs`). Never enable npm `workspaces`. See [`docs/self-update.it.md`](../../../docs/self-update.it.md).
- Don't add error handling, validation, or comments beyond what the variant strictly needs.

## File templates

Substitute placeholders: `{{themeName}}`, `{{themeNameLower}}` (the theme name lowercased, for the npm `name` field), `{{description}}`, `{{author}}`, `{{email}}`, `{{license}}`, `{{isAdminTheme}}` (boolean, lowercase), `{{npmPackage}}`, `{{npmRange}}`.

### `themeConfig.default.json5` (all variants)

**Generate the `.default` sidecar, NOT a live `themeConfig.json5`.** Per the config
lifecycle ([`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md)),
`themeConfig.default.json5` is the committed source of truth; the live
`themeConfig.json5` is git-ignored and **materialized at boot** from the `.default`
(`materializeMissingConfigs`). Rules for the `.default`:

- **`schemaVersion`** (integer) is the **first key** — it versions the *structure* of
  the file (bump it when you add/rename/remove keys).
- **Do NOT include `isInstalled`** — it is a runtime state. For bundled themes (those
  with a `.default`) the boot step `ensureThemesInstalled` writes `isInstalled: 1`
  into the live file ("installed by definition").
- **Do NOT include `active`** — it was **removed** from the theme schema
  ([`theme-active-isinstalled.it.md`](../../../docs/decisions/theme-active-isinstalled.it.md)).
  The active theme is determined solely by `activeTheme`/`adminActiveTheme` in
  `ital8Config.json5`.

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  schemaVersion: 1,  // Versione della STRUTTURA del file (incrementare quando cambiano le chiavi). Vedi docs/decisions/config-lifecycle.it.md
  weight: 100,

  // Custom www path configuration
  // - wwwCustomPath: 0 = usa /www standard (root progetto)
  //                  1 = usa themes/[nomeDelTema]/www (cartella www nella root del tema)
  // IMPORTANTE: Solo queste due location sono ammesse per motivi di sicurezza
  wwwCustomPath: 0,

  // Tema pubblico (false) o amministrativo (true).
  // I temi admin sono usati solo nelle pagine di amministrazione e attivati via `adminActiveTheme`.
  isAdminTheme: {{isAdminTheme}},

  pluginDependency: {
    bootstrap: "^1.0.0",
  },
  nodeModuleDependency: {
    ejs: "^6.0.0",
  },
}
```

### `themeDescription.json5` — minimal / standard

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  name: "{{themeName}}",
  version: "0.1.0",
  description: "{{description}}",
  author: "{{author}}",
  email: "{{email}}",
  license: "{{license}}",
  tags: [],
  supportedHooks: ["head", "header", "nav", "main", "body", "aside", "footer", "script"],
  features: {
    themeResources: true,
    responsive: true,
  },
  templates: [
    {
      file: "page.template.ejs",
      displayName: "Pagina Standard",
      description: "Template generico per pagine web",
    },
  ],
}
```

### `themeDescription.json5` — complete

Reference: `themes/placeholderExample/themeDescription.json5`. Include all 4 templates listed in the `templates` array (or the subset the user picked) and a `partials` array describing the editable partials. Set `features.placeholderStandard: true`.

### `themeDescription.json5` — admin

Drop the `templates` array (admin themes don't expose user-creatable templates). Add `adminFeatures: { dashboardHooks: true }`.

### `views/head.ejs` — all variants

```ejs
<!DOCTYPE html>
<html lang="<%= (passData.ctx.state && passData.ctx.state.lang) || 'en' %>">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{themeName}}</title>
    <link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
    <%- passData.pluginSys.hookPage("head", passData); %>
</head>
```

(For `minimal`, omit the `<link>` line if `themeResources/` is not generated.)

### `views/header.ejs` — minimal / standard

```ejs
<body>
    <%- passData.pluginSys.hookPage("header", passData); %>
    <%- include('nav.ejs') %>
    <%- include('main.ejs') %>
    <%- include('aside.ejs') %>
```

**For `minimal`, drop the three `include` lines** — `nav.ejs`, `main.ejs` and `aside.ejs` are not generated for that variant, so leaving them makes EJS throw at render and the boot validator reports one error per dangling include.

### `views/header.ejs` — complete

```ejs
<body class="{{themeName}}-theme">
    <%# PLACEHOLDER name:headerContent type:html editor:simple label:"Contenuto Header" %>
    <div class="site-header">
        <h1>{{themeName}}</h1>
        <p>Contenuto header personalizzabile</p>
    </div>
    <%# /PLACEHOLDER %>
    <%- passData.pluginSys.hookPage("header", passData); %>
    <div class="page-wrapper">
        <%- include('nav.ejs') %>
        <div class="content-wrapper">
            <%- include('main.ejs') %>
            <%- include('aside.ejs') %>
        </div>
    </div>
```

### `views/footer.ejs` — minimal / standard

```ejs
<footer>
    <%- passData.pluginSys.hookPage("footer", passData); %>
</footer>
<%- passData.pluginSys.hookPage("script", passData); %>
</body>
</html>
```

### `views/footer.ejs` — complete

```ejs
<footer role="contentinfo" class="{{themeName}}-footer">
    <div class="footer-container">
        <%# PLACEHOLDER name:footerDescription type:text maxlength:500 label:"Descrizione Footer" %>
        <p class="footer-description">Sistema di gestione contenuti modulare e plugin-based</p>
        <%# /PLACEHOLDER %>
        <%# PLACEHOLDER name:footerContent type:html editor:simple label:"Contenuto Footer" %>
        <p>© <%= new Date().getFullYear() %> {{themeName}}</p>
        <%# /PLACEHOLDER %>
        <%- passData.pluginSys.hookPage("footer", passData); %>
    </div>
</footer>
<%- passData.pluginSys.hookPage("script", passData); %>
</body>
</html>
```

### `views/nav.ejs` (standard / complete)

Standard:
```ejs
<nav>
    <%- passData.pluginSys.hookPage("nav", passData); %>
</nav>
```

Complete:
```ejs
<nav class="{{themeName}}-nav" role="navigation" aria-label="Navigazione principale">
    <%# PLACEHOLDER name:mainNavigation type:html editor:simple label:"Menu Navigazione Principale" %>
    <%# /PLACEHOLDER %>
    <%- passData.pluginSys.hookPage("nav", passData); %>
</nav>
```

### `views/main.ejs` (standard / complete)

```ejs
<main>
    <%- passData.pluginSys.hookPage("main", passData); %>
</main>
<%- passData.pluginSys.hookPage("body", passData); %>
```

### `views/aside.ejs` — standard

```ejs
<aside>
    <%- passData.pluginSys.hookPage("aside", passData); %>
</aside>
```

### `views/aside.ejs` — complete

```ejs
<aside class="{{themeName}}-sidebar" role="complementary">
    <div class="sidebar-container">
        <%# PLACEHOLDER name:sidebarWidget1 type:html editor:wysiwyg label:"Widget Sidebar 1" %>
        <%# /PLACEHOLDER %>
        <%# PLACEHOLDER name:sidebarWidget2 type:html editor:wysiwyg label:"Widget Sidebar 2" %>
        <%# /PLACEHOLDER %>
        <%# PLACEHOLDER name:sidebarWidget3 type:html editor:simple label:"Widget Sidebar 3" %>
        <%# /PLACEHOLDER %>
    </div>
    <%- passData.pluginSys.hookPage("aside", passData); %>
</aside>
```

### `templates/page.template.ejs` — minimal / standard

```ejs
<%- include( passData.themeSys.getThemePartPath('head.ejs') ) %>
<%- include( passData.themeSys.getThemePartPath('header.ejs') ) %>

<div class="container my-5">
    <h1>Hello world</h1>
</div>

<%- include( passData.themeSys.getThemePartPath('footer.ejs') ) %>
```

### Templates — complete variant

Generate (full content drawn from `themes/placeholderExample/templates/`):
- `page.template.ejs` — with PLACEHOLDER blocks for hero, title, markdown body, sidebar image, CTA
- `blog-post.template.ejs` — title, date, author, featured image, markdown body
- `landing.template.ejs` — multiple HTML sections
- `minimal.template.ejs` — only title + body

Each MUST include the three partials at top/bottom and MUST NOT add `<html>`, `<head>`, `<body>` tags.

If the file content for these is not in the skill's prompt context, copy them verbatim from `themes/placeholderExample/templates/` (when running inside the ital8cms repo). When running standalone, generate equivalent placeholder content following the same PLACEHOLDER standard.

### `themeResources/css/theme.css` (standard / complete / admin)

Provide a starter stylesheet (one line of CSS variables + a body rule). For `complete`, copy/adapt from `themes/placeholderExample/themeResources/css/theme.css`. Don't generate hundreds of lines unless the user asks.

```css
/* {{themeName}} theme */
:root {
    --primary: #0a1f44;
    --accent: #43c6ac;
}
body {
    font-family: system-ui, -apple-system, sans-serif;
    margin: 0;
    padding: 0;
}
```

### `themeResources/js/theme.js` (standard / complete / admin)

```javascript
// {{themeName}} theme JS
console.log('{{themeName}} theme loaded');
```

### Admin variant — partials

Use the layout from `themes/defaultAdminTheme/views/`:
- `head.ejs` — includes admin meta + `escapeHtml.js` script tag (path: `themeResources/js/escapeHtml.js`, leave as a stub or copy from defaultAdminTheme)
- `header.ejs` — `<body class="admin-body">`, admin header, includes nav.ejs, opens admin-container with sidebar (aside.ejs) and main.admin-main, with the auto Page Header logic
- `nav.ejs` — admin navbar, hookPage("nav")
- `aside.ejs` — admin sidebar, hookPage("aside")
- `footer.ejs` — closes admin-main, admin-container, admin footer

For brevity in this skill: when running inside the ital8cms repo, copy verbatim from `themes/defaultAdminTheme/views/` and substitute "ital8cms - Amministrazione" with `{{themeName}}`. When running standalone, replicate the structure as documented above.

Do NOT generate `templates/` for the admin variant.

### `pluginsEndpointsMarkup/` — complete variant

Create a single example file demonstrating the pattern:

`pluginsEndpointsMarkup/adminUsers/login/style.css`:
```css
/* Custom styling for adminUsers login page */
.plugin-page.plugin-adminUsers.page-login {
    max-width: 480px;
    margin: 4rem auto;
}
```

Tell the user (in the post-generation summary) that other endpoints can be customized by adding `pluginsEndpointsMarkup/<pluginName>/<pageName>/{style.css,script.js,before-content.html,after-content.html,template.ejs}`.

### Documentation (ital8doc) — README mandatory, EXPLAIN optional

Per the **ital8doc v1-1** standard ([`docs/ITAL8DOC-latest.md`](../../../docs/ITAL8DOC-latest.md)),
**always** generate the Italian reference `README.it.md` **and** its English `README.md`
stub. Generate `EXPLAIN.it.md` (+ `EXPLAIN.md` stub) **only** when the theme has
non-trivial internals worth explaining — never an empty or README-duplicating EXPLAIN.

`README.it.md` (reference — where you write; fill the TODOs from the actual theme):

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# {{themeName}}

{{description}}

## Cosa offre

- TODO: layout, partial, template, feature (es. PLACEHOLDER, responsive).

## Attivazione

TODO: `activeTheme: "{{themeName}}"` (o `adminActiveTheme` se admin) in `ital8Config.json5`, poi riavvio.

## Struttura

TODO: `views/` (partial), `templates/`, `themeResources/`, eventuale `pluginsEndpointsMarkup/`.

## Personalizzazione

TODO: dove mettere mani (CSS/JS in `themeResources/`, blocchi PLACEHOLDER, override endpoint plugin).

## Dipendenze

TODO: `pluginDependency` e npm (self-contained `package.json` oppure `nodeModuleDependency`).
```

`README.md` (English stub — the GitHub face; never left empty):

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `README.it.md`. The English edition will be filled in at release.
# {{themeName}}

> English translation pending. Authoritative version: [`README.it.md`](./README.it.md).
```

`EXPLAIN.it.md` + `EXPLAIN.md` stub follow the same pattern as the plugin skill (tipo `EXPLAIN`), generated **only** for non-trivial internals.

### Config migrations (`migrations/`) — not for a new theme, but say so

**Do NOT scaffold `migrations/` for a brand-new theme**: at `schemaVersion: 1` there
is no installation in the wild to migrate *from*.

**Do tell the user, in the final summary, what to do at the first structural change:**

> When you later change the structure of `themeConfig.default.json5` (add, rename or
> remove a key, or change a default value), bump `schemaVersion` **and** declare the
> step in `migrations/migrations.json5`. Adding a key would also travel on its own
> via the boot's recursive merge, but renames, removals and changed values reach
> existing installations **only** through a declared migration.

Same shape and same rules as plugins — `migrations.json5` (with `reason` **mandatory
on every step**, including automatic ones), a `from-vN-to-vM.md` with fixed sections,
an optional idempotent `from-vN-to-vM.js`, and an optional folder for materials.
Applied with `npm run cli -- migrate <theme> --theme`; the boot only *reports*
pending migrations in a `[MIGRATE]` box. Full standard:
[`docs/decisions/config-migrations.it.md`](../../../docs/decisions/config-migrations.it.md).

### Self-contained npm dependencies (`package.json`) — optional add-on

Apply **only** when the user chose the **self-contained** npm model (input #7) — the
theme pulls npm packages of its own and should carry them theme-local. Two parts:

**1. Create `package.json` in the theme folder** (packages install into
`themes/{{themeName}}/node_modules` via `npm install` inside the folder, resolved
theme-local first by Node):

```json
{
  "name": "ital8cms-theme-{{themeNameLower}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "private": true,
  "license": "{{license}}",
  "author": "{{author}} <{{email}}>",
  "dependencies": {
    "{{npmPackage}}": "{{npmRange}}"
  }
}
```

**2. Keep those packages OUT of `nodeModuleDependency`** in `themeConfig.default.json5`
(the root-model boot gate must not check theme-local deps). Note: `ejs` stays in
`nodeModuleDependency` because it is a **root** dependency of the CMS, not a theme-local
one.

For the **legacy** model instead, skip the `package.json` and add the packages to
`nodeModuleDependency` alongside `ejs`.

## Generation procedure

1. Confirm the gathered inputs back to the user as a single summary block (variant, name, output path, files to create). Wait for explicit confirmation before writing.
2. Verify the output directory does not already exist. If it does: stop, tell the user, do not overwrite.
3. Create the directory tree and write the files using the Write tool. Order:
   - `themeDescription.json5`
   - `themeConfig.default.json5` (NOT a live `themeConfig.json5` — it is materialized at boot)
   - `views/head.ejs`, `views/header.ejs`, `views/footer.ejs` (always)
   - `views/nav.ejs`, `views/main.ejs`, `views/aside.ejs` (standard, complete, admin)
   - `templates/*` (minimal: page only; standard: page only; complete: 1–4 templates per user choice; admin: skip)
   - `themeResources/css/theme.css`, `themeResources/js/theme.js` (standard, complete, admin)
   - `pluginsEndpointsMarkup/adminUsers/login/style.css` (complete only)
   - **Documentation** — `README.it.md` + `README.md` stub (always), plus `EXPLAIN.it.md` + `EXPLAIN.md` stub only if the theme has non-trivial internals
   - `package.json` only if the user chose the self-contained npm model (input #7)
4. After writing, print a short summary:
   - Files created (relative paths), including the docs (`README.it.md` + stub, and EXPLAIN pair if generated) and `package.json` if self-contained
   - Manual steps the user must take:
     - Activate the theme in `ital8Config.json5` (`activeTheme` for public, `adminActiveTheme` for admin)
     - Restart the server
     - Move folder into `themes/` if scaffolded standalone
     - If self-contained: run `npm install` inside the theme folder (or root `npm install` / `npm run deps-sync`) so its `node_modules` is populated
   - Reminder to fill the `README.it.md` TODOs (and EXPLAIN, if generated) — a shipped-but-empty README is out of ital8doc spec
   - **The config-migration note** (see the "Config migrations" add-on): at the first structural change of `themeConfig.default.json5`, bump `schemaVersion` **and** declare the step in `migrations/` — otherwise renames, removals and changed values never reach existing installations
   - For `complete`: note that templates with PLACEHOLDER markers are designed to integrate with the ital8cms editor system
5. Do not modify `ital8Config.json5` automatically.
6. Do not run `npm install`, do not start the server.

## Standalone use (outside an ital8cms repo)

If the current directory does not look like an ital8cms project (no `ital8Config.json5`, no `themes/` directory), still scaffold the theme folder. Tell the user explicitly that they need to:
- Copy the generated folder into the `themes/` directory of their ital8cms installation
- Set `activeTheme` (or `adminActiveTheme` for admin themes) in `ital8Config.json5`
- Restart the server
- If the theme is **self-contained** (has its own `package.json`), run `npm install` inside the theme folder (or root `npm install` / `npm run deps-sync`) so its `node_modules` is populated

## Things to avoid

- Do generate the ital8doc docs: `README.it.md` + its `README.md` stub are **mandatory**; add `EXPLAIN.it.md` (+ stub) **only** for non-trivial internals (empty/redundant EXPLAIN is forbidden). Don't create `CHANGELOG.md`, `screenshot.png`, or `theme-icon.svg` unless the user asks.
- Don't ship an English `README.md`/`EXPLAIN.md` with real content — it's a **stub** (marker + pointer to the `.it.md`); the reference is always the `.it.md`.
- Don't scaffold a `migrations/` folder for a brand-new theme (nothing to migrate from at `schemaVersion: 1`) — but don't stay silent about it either: the summary must tell the user what to do at the first structural change.
- Don't move `ejs` out of `nodeModuleDependency` (it's a root dependency); only a theme's own extra npm packages go into a self-contained `package.json`, and don't enable npm `workspaces`.
- **Do** generate `themes/<name>/tests/themeIntegrity.test.js` — three lines that delegate to the shared suite (`describeThemeIntegrity(__dirname)` from `core/testHelpers/themeIntegrity.js`). Copy it verbatim from any existing theme. It is **not** empty scaffolding: it wires the new theme into the contract suite that every theme runs (structure, required hooks, resolvable includes, `getThemePartPath()`/`getThemeResourceUrl()` targets, the `.default`/live descriptor pair), and it is what `npm run test:themes` collects. Skipping it is how a theme silently drops out of coverage. Don't write theme-specific tests beyond that unless the user asks.
- Don't add the `<html>`, `<head>`, or `<body>` tags inside a template — they belong to the partials.
- Don't generate a `templates/` directory for the `admin` variant.
- Don't generate `pluginsEndpointsMarkup/` for `minimal` or `standard` variants.
- Don't omit the JSON5 header comment on the first line of any `.json5` file.
- Don't add `active` (removed from the theme schema) or `isInstalled` (runtime state, written at boot) to `themeConfig.default.json5`; don't write a live `themeConfig.json5` (it is materialized at boot).
- Don't rename the standard partials — the names `head.ejs`, `header.ejs`, `footer.ejs`, `nav.ejs`, `main.ejs`, `aside.ejs` are required by the theme system. Adding **extra** sub-partials alongside them is allowed (the validator follows includes), just don't generate them unasked.
- Don't leave an `include()` pointing at a file the chosen variant doesn't generate — most easily done by forgetting to drop the `nav`/`main`/`aside` includes from `views/header.ejs` in the **minimal** variant. It is a render-time crash, and the boot validator now names it.
- Don't modify `ital8Config.json5` automatically — always show the user the snippet to add manually.
