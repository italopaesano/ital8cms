---
name: ital8cms-theme-creator
description: Scaffold a new ital8cms theme. Use when the user asks to create, scaffold, or generate an ital8cms theme (minimal, standard, complete with PLACEHOLDER markers, or admin). Works both inside an ital8cms repository and standalone (outputs a self-contained theme folder ready to be dropped into `themes/`).
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
   - `minimal` — only required files: `themeConfig.json5`, `themeDescription.json5`, `views/{head,header,footer}.ejs`, `templates/page.template.ejs`
   - `standard` — adds optional partials (`nav.ejs`, `main.ejs`, `aside.ejs`), `themeResources/css/theme.css`, `themeResources/js/theme.js`, `README.md`
   - `complete` — full placeholderExample-style: 4 templates (page, blog-post, landing, minimal), partials with PLACEHOLDER content blocks, `pluginsEndpointsMarkup/adminUsers/login/style.css`, themeResources, README
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

## Conventions to enforce

- All config files use the `.json5` extension and a comment on line 1: `// This file follows the JSON5 standard - comments and trailing commas are supported`
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
- Don't add error handling, validation, or comments beyond what the variant strictly needs.

## File templates

Substitute placeholders: `{{themeName}}`, `{{description}}`, `{{author}}`, `{{email}}`, `{{license}}`, `{{isAdminTheme}}` (boolean, lowercase).

### `themeConfig.json5` (all variants)

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  active: 1,
  isInstalled: 1,
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

(For `minimal`, drop the three `include` lines.)

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

## Generation procedure

1. Confirm the gathered inputs back to the user as a single summary block (variant, name, output path, files to create). Wait for explicit confirmation before writing.
2. Verify the output directory does not already exist. If it does: stop, tell the user, do not overwrite.
3. Create the directory tree and write the files using the Write tool. Order:
   - `themeDescription.json5`
   - `themeConfig.json5`
   - `views/head.ejs`, `views/header.ejs`, `views/footer.ejs` (always)
   - `views/nav.ejs`, `views/main.ejs`, `views/aside.ejs` (standard, complete, admin)
   - `templates/*` (minimal: page only; standard: page only; complete: 1–4 templates per user choice; admin: skip)
   - `themeResources/css/theme.css`, `themeResources/js/theme.js` (standard, complete, admin)
   - `pluginsEndpointsMarkup/adminUsers/login/style.css` (complete only)
   - `README.md` only if user explicitly asked for one
4. After writing, print a short summary:
   - Files created (relative paths)
   - Manual steps the user must take:
     - Activate the theme in `ital8Config.json5` (`activeTheme` for public, `adminActiveTheme` for admin)
     - Restart the server
     - Move folder into `themes/` if scaffolded standalone
   - For `complete`: note that templates with PLACEHOLDER markers are designed to integrate with the ital8cms editor system
5. Do not modify `ital8Config.json5` automatically.
6. Do not run `npm install`, do not start the server.

## Standalone use (outside an ital8cms repo)

If the current directory does not look like an ital8cms project (no `ital8Config.json5`, no `themes/` directory), still scaffold the theme folder. Tell the user explicitly that they need to:
- Copy the generated folder into the `themes/` directory of their ital8cms installation
- Set `activeTheme` (or `adminActiveTheme` for admin themes) in `ital8Config.json5`
- Restart the server

## Things to avoid

- Don't create `README.md`, `CHANGELOG.md`, `screenshot.png`, or `theme-icon.svg` unless the user asks.
- Don't add tests (themes can have `themes/<name>/tests/` per project convention, but generating empty test scaffolding is out of scope).
- Don't add the `<html>`, `<head>`, or `<body>` tags inside a template — they belong to the partials.
- Don't generate a `templates/` directory for the `admin` variant.
- Don't generate `pluginsEndpointsMarkup/` for `minimal` or `standard` variants.
- Don't omit the JSON5 header comment on the first line of any `.json5` file.
- Don't rename or restructure partials — the names `head.ejs`, `header.ejs`, `footer.ejs`, `nav.ejs`, `main.ejs`, `aside.ejs` are required by the theme system.
- Don't modify `ital8Config.json5` automatically — always show the user the snippet to add manually.
