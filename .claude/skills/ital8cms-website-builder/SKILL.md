---
name: ital8cms-website-builder
description: Build a complete ital8cms website end-to-end. Use when the user asks to create a website, scaffold a site, or set up multiple pages on ital8cms. The skill first asks whether to use an existing theme or scaffold a new one (delegating to `ital8cms-theme-creator`), then generates pages under `/www/` (or `themes/<theme>/www/` if `wwwCustomPath: 1`) that respect the chosen theme's templates and partials.
---

# ital8cms Website Builder

This skill orchestrates the full creation of an **ital8cms** website: it picks (or scaffolds) a theme, then generates the user's pages in the public web root, basing each page on a template provided by the active theme.

It is the higher-level companion of two existing skills:
- `ital8cms-theme-creator` — for theme scaffolding (delegated when the user wants a new theme)
- `ital8cms-plugin-creator` — for plugins (out of scope here)

This skill does **not** reimplement theme scaffolding or plugin creation; it composes them.

## When to use

Invoke when the user wants to:
- Build a new ital8cms website from scratch
- Create the homepage and a set of public pages (about, contact, blog landing, etc.)
- Bootstrap a site with a chosen theme in one guided pass

Do **not** invoke for:
- Editing a single existing page (direct edit)
- Creating a single plugin (use `ital8cms-plugin-creator`)
- Creating only a theme with no pages (use `ital8cms-theme-creator` directly)
- Admin pages (those come from admin plugins, not the public web root)
- Changing global settings unrelated to themes/pages

## High-level flow

1. Project sanity check
2. Theme step — choose existing OR scaffold new
3. (Optional) activate the theme in `ital8Config.json5`
4. Resolve the public web root (`/www` vs `themes/<theme>/www`)
5. Page-creation loop, one page at a time, each based on a template offered by the theme
6. Final summary with manual follow-up steps

Each step is **confirm-before-write**. Never modify `ital8Config.json5` without explicit user approval.

## Step 1 — Project sanity check

Verify the current working directory looks like an ital8cms project:
- Contains `ital8Config.json5` at the root
- Contains a `themes/` directory
- Contains a `www/` directory (or will, if `wwwCustomPath: 1` is later chosen)
- `package.json` includes `koa-classic-server` (best-effort, optional check)

If any of these is missing, stop and ask the user to confirm they are in the right repository. Do not scaffold a project from nothing — that is out of scope.

Read `ital8Config.json5` with the project's `loadJson5()` convention in mind, but for the skill itself a plain Read of the file is enough (it is JSON5 with comments — parse mentally, do not `require()` it).

Capture from the config: `activeTheme`, `wwwPath`, `apiPrefix`, `adminPrefix`, `pluginPagesPrefix`.

## Step 2 — Theme step

Ask the user **one** question with two clear options:

> Vuoi usare un tema già esistente oppure crearne uno nuovo per questo sito?
> A) Usa un tema esistente
> B) Crea un nuovo tema (delego allo skill `ital8cms-theme-creator`)

### 2A — Use an existing theme

List the available **public** themes (skip admin themes — those with `isAdminTheme: true`):

- For each theme directory, read its config preferring the live `themes/<name>/themeConfig.json5`, falling back to `themes/<name>/themeConfig.default.json5` when the live is absent. Per the config lifecycle ([`docs/decisions/config-lifecycle.it.md`](../../../docs/decisions/config-lifecycle.it.md)) the live config is git-ignored and materialized at boot, so in a fresh checkout (server not yet started) only the committed `.default` exists. `isAdminTheme` is present in both.
- Filter where `isAdminTheme` is `false` (or absent — treat as `false`).
- For each candidate, also read `themes/<name>/themeDescription.json5` to grab the human description.
- Present them as a numbered list with name + description.

Ask the user to pick one by name. Validate the name exists. Store it as `<selectedTheme>`.

### 2B — Create a new theme

Tell the user that you will hand off to the `ital8cms-theme-creator` skill, and instruct them to invoke `/ital8cms-theme-creator` (or to confirm so you can spawn it). Do **not** re-implement the theme scaffolding logic — it lives in that skill and must stay there.

After the theme is scaffolded, the new theme name becomes `<selectedTheme>` and the flow resumes at Step 3.

If for any reason the theme-creator skill cannot be invoked, stop and report the situation — do not silently generate a half-broken theme inline.

## Step 3 — Activate the theme (optional)

Read `activeTheme` from `ital8Config.json5`. If it already equals `<selectedTheme>`, skip this step.

Otherwise, ask:

> `activeTheme` in `ital8Config.json5` è attualmente `<currentTheme>`. Vuoi che lo aggiorni a `<selectedTheme>`?

If the user says yes, edit **only** the `activeTheme` line, preserving every other line, comment, and the JSON5 header on line 1. Use the Edit tool with a narrow `old_string` (the existing `activeTheme` line) and a matching `new_string`. Never rewrite the whole file.

If the user says no, remember to mention in the final summary that the theme must be activated manually for the new pages to render with it.

Do **not** touch `adminActiveTheme` — this skill works on public themes only.

## Step 4 — Resolve the public web root

Read `themes/<selectedTheme>/themeConfig.json5` (falling back to `themeConfig.default.json5` if the live file is absent — see the lifecycle note in Step 2A) and check `wwwCustomPath`:

- `wwwCustomPath: 0` (or absent) → pages go under the project's `wwwPath` (default `/www`, read from `ital8Config.json5`).
- `wwwCustomPath: 1` → pages go under `themes/<selectedTheme>/www/`. Create that directory if it does not exist.

Store the result as `<publicRoot>`. State the resolved absolute path back to the user before writing anything.

Only these two locations are permitted (project convention, see `themes/EXPLAIN.md` and `ital8cms-theme-creator`). Do not invent a third location.

## Step 5 — Page-creation loop

Inspect `themes/<selectedTheme>/templates/`:
- Every file matching `*.template.ejs` is a template that the user can base a page on.
- Read each one to understand its content scaffolding (especially PLACEHOLDER markers, if present — see `themes/PLACEHOLDER_Standard_ital8cms.md`).
- Build a short list: filename → `displayName` (from `themeDescription.json5` if available, else the filename without `.template.ejs`).

If the theme has **no** templates (rare — possible for very minimal themes), fall back to a stub page that just includes `head.ejs`, `header.ejs`, a `<main>` with one `<h1>`, and `footer.ejs`.

Then loop, one page at a time, until the user says "basta" / "no more" / "done":

1. Ask for the **page file name** (without extension). Validate: matches `^[a-zA-Z][a-zA-Z0-9_-]*$`. Reject names that collide with an existing file under `<publicRoot>` unless the user explicitly approves overwrite.
2. Ask for the **page title** (used in the `<title>` if the theme partial reads it, and/or in the first `<h1>`). Optional — if the user does not care, use the page name as title.
3. Ask which **template** to base it on (skip if the theme has only one template).
4. Ask for a brief description of the page content (one or two sentences). Use this only to seed the default content of any free-text PLACEHOLDER blocks or the `<main>` body — do not invent extensive copy.
5. Confirm the destination path (e.g., `<publicRoot>/about.ejs`) and write the file.

### Page generation rules

- Start from the chosen template's contents.
- **Never** add `<html>`, `<head>`, or `<body>` tags — those are owned by the partials (`head.ejs`, `header.ejs`, `footer.ejs`). The template must already include them; copy that include structure verbatim.
- Keep the three partial `include` calls at the same positions the template uses:
  ```ejs
  <%- include( passData.themeSys.getThemePartPath( 'head.ejs' ) ) %>
  <%- include( passData.themeSys.getThemePartPath( 'header.ejs' ) ) %>
  ...
  <%- include( passData.themeSys.getThemePartPath( 'footer.ejs' ) ) %>
  ```
- If the template uses PLACEHOLDER markers (`<%# PLACEHOLDER ... %> ... <%# /PLACEHOLDER %>`), preserve them. Only replace the inner default content when the user provided a clear value for that field; otherwise leave the template's default.
- If the template has no PLACEHOLDER blocks, replace the obvious `<h1>` placeholder text with the user's page title, and put the user's short description inside the existing `<main>` / content container.
- Do not introduce new partials, do not change include paths, do not add `<script>` tags or inline CSS — theme assets are loaded by the partials.
- Do not localise content with `__()` unless the theme being used already does so in its template (e.g., if `themes/default/templates/page.template.ejs` uses `__()`, follow the pattern; otherwise emit plain text).

### Homepage handling

If the user wants a homepage:
- File name should be `index` (becomes `index.ejs`), which matches `indexFiles.wwwPath` in `ital8Config.json5`.
- If `<publicRoot>/index.ejs` already exists, ask the user whether to overwrite or rename the new one. Never overwrite silently.
- If `<publicRoot>/__index.ejs` exists (sample shipped by the project), leave it alone — it is intentionally name-shadowed.

## Step 6 — Final summary

Print a single, short summary:

- Theme used: `<selectedTheme>` (existing / newly scaffolded)
- Public root: `<publicRoot>` (absolute path)
- Pages created (relative paths, one per line)
- Whether `activeTheme` was updated or still needs a manual edit
- Reminder to restart the server (`npm start` or `node index.js`) so the changes take effect
- If `wwwCustomPath: 1` was used, remind the user that pages live inside the theme folder and travel with the theme

Do **not**:
- Run `npm install`
- Start or restart the server
- Edit `package.json`
- Touch unrelated config files

## Things to enforce

- All config files use the `.json5` extension and a comment on line 1: `// This file follows the JSON5 standard - comments and trailing commas are supported`. Never use `require()` for `.json5` files; use a plain Read.
- Naming: camelCase for theme/page names, files, and directories (kebab-case is tolerated only for template basenames per project convention).
- Confirm-before-write for every file. Show the user a one-line summary of each page before creating it.
- No `<html>`, `<head>`, or `<body>` tags inside generated pages.
- No assumption that any plugin is active. The skill must work even if `bootstrapNavbar`, `simpleI18n`, etc. are not loaded — do not insert `__()` calls or navbar invocations unless the chosen template already does.
- If `themes/<selectedTheme>/` does not contain `views/head.ejs`, `views/header.ejs`, `views/footer.ejs`, stop and report — the theme is malformed.
- Do not generate `pluginPages/` files or admin pages. This skill is strictly for `/www/` (or `themes/<theme>/www/`).
- Do not call `ital8cms-plugin-creator` from this skill — plugins are outside its scope.

## Things to avoid

- Don't ask more than 3 questions in a single round. Keep prompts short and proceed step by step.
- Don't generate placeholder pages "for later" — only the pages the user explicitly asks for.
- Don't auto-create a navbar config (`navbar.*.json5`) unless the user asks. The `bootstrapNavbar` plugin will work without one once the user adds it.
- Don't fabricate copy. If the user provides no content for a section, keep the template's default.
- Don't create `README.md`, sitemaps, or `robots.txt`. The `seo` plugin handles `sitemap.xml` and `robots.txt` automatically when active.
- Don't try to "improve" the chosen theme. Theme edits belong to `ital8cms-theme-creator` (or manual work).

## Standalone use

If the current directory is not an ital8cms project, this skill cannot operate — it depends on `themes/<theme>/templates/*.template.ejs` and on writing into a real `www/`. In that case, stop, explain, and suggest:
1. Cloning or opening an ital8cms project first.
2. Optionally invoking `ital8cms-theme-creator` standalone to scaffold a theme folder to drop in later.

## Quick checklist for the agent running this skill

- [ ] Confirm cwd is an ital8cms project
- [ ] Ask: existing theme or new one?
- [ ] If new: invoke `ital8cms-theme-creator` and wait for completion
- [ ] Offer to update `activeTheme` (narrow Edit only)
- [ ] Resolve `<publicRoot>` from `wwwCustomPath` + `wwwPath`
- [ ] List the theme's templates; for each requested page, pick one
- [ ] Loop: name → title → template → short content → write
- [ ] Print the final summary; do not start the server
