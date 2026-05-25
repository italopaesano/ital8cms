---
name: ital8cms-simpleI18n-integrator
description: Integrate the ital8cms `simpleI18n` plugin into websites (www pages, plugin webPages) or, only when necessary, into theme partials. Use when the user asks to add translations / internationalization / i18n / multilingua to an ital8cms site, configure supported languages, add a language switcher, or wire up the `__()` global helper into existing EJS templates. Does NOT scaffold the plugin itself (it ships with ital8cms).
---

# ital8cms simpleI18n Integrator

This skill helps **use** the `simpleI18n` plugin that ships with ital8cms. It does **not** create the plugin (it's already in `plugins/simpleI18n/`). It modifies existing EJS templates, the plugin's `pluginConfig.json5` (language list), and — only when strictly necessary — theme partials, to deliver a working multilingual setup.

## When to use

Invoke when the user wants to:
- Add translations to one or more pages (www/, plugin webPages, admin pages)
- Configure the list of supported languages and the default language
- Add a language switcher (links with `?lang=xx`)
- Set the `<html lang="...">` attribute correctly per request
- Wire up the global `__()` helper in templates that don't yet use it
- Migrate hardcoded strings in existing pages to multilingual translation objects
- Integrate i18n into a theme partial (head.ejs / nav.ejs / footer.ejs) — **only when the user explicitly wants the theme to ship translations**, otherwise prefer page-level integration

Do **not** invoke for: creating the plugin itself (it's already part of ital8cms), creating a new plugin/theme/site (use the other ital8cms skills), modifying the plugin's `main.js` translation engine, or implementing i18n for non-ital8cms projects.

## What ships with ital8cms (already there, do NOT recreate)

- Plugin source: `plugins/simpleI18n/main.js`, `plugins/simpleI18n/pluginConfig.json5`, `plugins/simpleI18n/pluginDescription.json5`
- Plugin weight `-10` (loads early, before bootstrapNavbar and most others)
- Middleware that populates `ctx.state.lang` from (1) query string `?lang=xx`, (2) `Accept-Language` header, (3) `defaultLang`
- Global helper `__()` registered via `globalFunctionsWhitelist` in `ital8Config.json5` (whitelist entry is `required: true` — server crashes at startup if plugin is missing)
- Local helper `passData.plugin.simpleI18n.__()` (legacy syntax, still supported)
- Translation file `/www/i18n-test.ejs` as a working reference (do not edit unless asked)

**Verify before generating:** open `plugins/simpleI18n/pluginConfig.json5` to see the current `defaultLang` and `supportedLangs`. Open `ital8Config.json5` and confirm `globalFunctionsWhitelist.__` exists and points to `simpleI18n`. If either is missing, flag it to the user before proceeding.

## Required information (ask before generating)

Before editing any file, gather these inputs. **Do not guess.**

1. **Target scope** — one of:
   - `page` — integrate i18n into one or more specific EJS files (recommended default)
   - `theme` — integrate i18n into a theme's shared partials (head.ejs / nav.ejs / footer.ejs). Only choose this when the user wants every page that uses the theme to inherit the i18n setup. Confirm by asking which partials.
   - `config` — only update `supportedLangs` / `defaultLang` in `plugins/simpleI18n/pluginConfig.json5` (no template edits)
2. **Target files** (for `page` and `theme`) — absolute paths to the EJS files to modify. Ask for the list. Do not pattern-match `**/*.ejs` and bulk-edit unless the user explicitly confirms.
3. **Languages** — confirm or change the current `supportedLangs` and `defaultLang`. Use ISO 639-1 lowercase codes (`en`, `it`, `es`, `fr`, `de`, `pt`, `ja`, `zh`, …). If the user names languages in natural form ("italian", "english"), ask them to confirm the ISO codes you plan to use.
4. **Translations to provide** — for each user-facing string the skill will wrap, ask the user for the translated versions in every supported language. Do not auto-translate or invent translations. If the user supplies only one language, ask whether to fall back on `defaultLang` for the others or wait for translations.
5. **Language switcher** — ask if the user wants a switcher inserted, and if yes:
   - Where: inline in a specific page, in `nav.ejs`, in `header.ejs`, in `footer.ejs`
   - Style: plain text links, Bootstrap nav-items, dropdown, flag emojis (the user picks — never default to flags as some users dislike conflating language with nationality)
   - Preserve other query params? Default yes (use the helper snippet below).
6. **Translation key** — optional but recommended. Ask the user if they want each translation object to include a `"key"` field (used as fallback identifier when a translation is missing). Default: omit unless requested.
7. **Handlebars variables** — if the user has dynamic content inside translatable strings (e.g., "Hello {{name}}"), confirm they want to use the `var: { name: "..." }` syntax handled by the plugin's Handlebars compiler.

If the user gives a vague brief ("make my site multilingual"), do not start editing. Ask one focused follow-up to lock down: which pages, which languages, where the switcher goes. Then enumerate the strings you intend to wrap and confirm before writing.

## Conventions to enforce

- The plugin is loaded weight `-10`, so `ctx.state.lang` is **always defined** in routes and templates that run after the middleware. Use `passData.ctx.state.lang` (not `passData.ctx.query.lang`) to read the active language.
- Prefer the **global syntax** `<%- __({...}, passData.ctx) %>` for new code. Use the local syntax `<%- passData.plugin.simpleI18n.__({...}, passData.ctx) %>` only when the user has a documented reason or when working in a context where the global function isn't registered (rare).
- Use `<%- ... %>` (unescaped) when the translation contains HTML the user wants rendered; use `<%= ... %>` only when you want EJS to escape the output. The plugin itself does not escape — match the surrounding template's convention. When uncertain, use `<%- %>` because the typical pattern in the codebase is to keep translations as plain text (no HTML injection risk from a static JSON5 dict).
- Translation objects MUST include every language in `supportedLangs`. If a language is missing, the plugin falls back to `defaultLang`, then to the first available language, then to `[key-name]` placeholder. Provide complete translation objects to avoid visible fallbacks in production.
- Do not invent translations. If the user supplies "Welcome" only in English, ask before populating the other locales (suggest leaving them missing or copying English as a placeholder marked with a TODO comment in the surrounding `<%# %>` EJS comment).
- Language codes are lowercase ISO 639-1. Match the codes already in `pluginConfig.json5` exactly — case-sensitive.
- The `<html lang="...">` attribute should be set to `<%= passData.ctx.state.lang %>` (not the default config language) so it reflects the per-request detected language.
- Query string parameter name comes from `pluginConfig.json5` → `custom.queryStringParam` (default `"lang"`). Use the configured value, don't hardcode `?lang=` if the user has customized it.
- When editing theme partials, **never** introduce hardcoded strings that depend on a specific language — wrap them in `__()` calls so the theme stays language-agnostic.
- Don't add a `key` field to translation objects unless the user opted in (most existing code in `/www/` and reference plugins omits it).

## Working snippets

Substitute placeholders: `{{lang}}` (active lang), each language code (`{{it}}`, `{{en}}`, etc.) and the user-provided translations.

### Set `<html lang>` per request

```ejs
<!DOCTYPE html>
<html lang="<%= passData.ctx.state.lang %>">
```

If the file is a theme `head.ejs` partial that opens `<html>`, place it there. Otherwise place it at the top of the page template that owns the document.

### Translate a string (global syntax, recommended)

```ejs
<h1><%- __({
  it: "Benvenuto",
  en: "Welcome",
  es: "Bienvenido",
  fr: "Bienvenue",
  de: "Willkommen"
}, passData.ctx) %></h1>
```

### Translate a string (local syntax, fallback)

```ejs
<h1><%- passData.plugin.simpleI18n.__({
  it: "Benvenuto",
  en: "Welcome"
}, passData.ctx) %></h1>
```

### Translation with a key (optional)

```ejs
<p><%- __({
  key: "homepage_intro",
  it: "Questa è la nostra home page",
  en: "This is our home page"
}, passData.ctx) %></p>
```

### Translation with Handlebars variables

```ejs
<p><%- __({
  it: "Ciao {{name}}, hai {{count}} messaggi",
  en: "Hello {{name}}, you have {{count}} messages",
  var: { name: passData.ctx.session.user.username, count: 5 }
}, passData.ctx) %></p>
```

### Language switcher (plain links, preserves other query params)

```ejs
<%
  // Build a URL preserving existing query params, swapping/adding ?lang=xx
  const buildLangUrl = (lang) => {
    const params = new URLSearchParams(passData.ctx.querystring || '');
    params.set('lang', lang);
    return passData.ctx.path + '?' + params.toString();
  };
  const supported = passData.plugin.simpleI18n.getSupportedLangs();
  const current = passData.ctx.state.lang;
%>
<nav class="lang-switcher" aria-label="Language">
  <% supported.forEach((lang) => { %>
    <a href="<%= buildLangUrl(lang) %>"
       class="<%= lang === current ? 'active' : '' %>"
       lang="<%= lang %>"
       hreflang="<%= lang %>"><%= lang.toUpperCase() %></a>
  <% }); %>
</nav>
```

### Language switcher (Bootstrap navbar dropdown — only if the page uses Bootstrap)

```ejs
<%
  const buildLangUrl = (lang) => {
    const params = new URLSearchParams(passData.ctx.querystring || '');
    params.set('lang', lang);
    return passData.ctx.path + '?' + params.toString();
  };
  const supported = passData.plugin.simpleI18n.getSupportedLangs();
  const current = passData.ctx.state.lang;
%>
<li class="nav-item dropdown">
  <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
    <%= current.toUpperCase() %>
  </a>
  <ul class="dropdown-menu dropdown-menu-end">
    <% supported.forEach((lang) => { %>
      <li>
        <a class="dropdown-item <%= lang === current ? 'active' : '' %>"
           href="<%= buildLangUrl(lang) %>"
           hreflang="<%= lang %>"><%= lang.toUpperCase() %></a>
      </li>
    <% }); %>
  </ul>
</li>
```

### Configure supported languages (edit only — do not rewrite the file)

In `plugins/simpleI18n/pluginConfig.json5`, modify only the `custom` block. Keep `active`, `weight`, `dependency`, `nodeModuleDependency` untouched.

```json5
"custom": {
  "defaultLang": "en",
  "supportedLangs": ["en", "it", "es", "fr", "de"],
  "enableQueryString": true,
  "queryStringParam": "lang",
  "enableBrowserDetection": true,
  "debugMode": false
}
```

### Verify whitelist entry (read-only check, no edit unless missing)

In `ital8Config.json5`, the `globalFunctionsWhitelist` MUST contain:

```json5
"globalFunctionsWhitelist": {
  "__": {
    "plugin": "simpleI18n",
    "description": "Translation function for internationalization",
    "required": true
  }
}
```

If it's missing or different, alert the user. Do not add/edit it without explicit confirmation — `required: true` makes startup crash if mistyped.

## Integration procedure

1. **Inspect the current state.** Read `plugins/simpleI18n/pluginConfig.json5` and `ital8Config.json5` (the `globalFunctionsWhitelist` section). Report to the user:
   - Current `defaultLang` and `supportedLangs`
   - Whether the `__` whitelist entry is present and correctly configured
   - Whether the plugin is active (`active: 1`)
   If anything looks wrong, flag it and stop until the user confirms how to proceed.
2. **Confirm scope and target files** (page / theme / config). For pages, list the absolute paths. For theme, list the partials (head/nav/footer).
3. **Enumerate the strings to wrap.** For each target file, identify the user-facing strings and present them in a numbered list. Ask the user to provide translations for every string in every `supportedLangs` language. Do not invent translations.
4. **Summarize the planned changes** back to the user (files to edit, switcher placement, config changes, list of strings + translations) and **wait for explicit confirmation** before writing.
5. **Apply edits** using the `Edit` tool (never rewrite a whole file via `Write` when you're modifying an existing template — it loses formatting and surrounding code). For multiple edits in one file, prefer multiple targeted `Edit` calls over one large diff.
6. **If editing `pluginConfig.json5`**, modify only the `custom` block. Preserve the JSON5 header comment on line 1 and the existing structure. Use `loadJson5()`-compatible syntax (comments and trailing commas allowed).
7. **Print a final summary:**
   - Files modified (absolute paths)
   - URLs to test for each language (e.g., `http://localhost:3000/about.ejs?lang=it`)
   - Reminder that in production mode (`debugMode: 0`) the server must be restarted to pick up changes to `pluginConfig.json5`; template changes are picked up on the next request regardless of debug mode
   - Any strings the user left un-translated, flagged as TODOs

## Things to avoid

- Don't create or modify `plugins/simpleI18n/main.js` — the translation engine ships with ital8cms.
- Don't recreate `plugins/simpleI18n/pluginDescription.json5` or change `weight`/`active`/`dependency`/`nodeModuleDependency` in the plugin config — these are infrastructure fields, not i18n settings.
- Don't add languages to `supportedLangs` without translations to back them up — the plugin will fall back to `defaultLang` and the user will see English (or whatever the default is) on a Spanish URL.
- Don't auto-translate strings. Always ask the user for the translated copy. If the user is okay with placeholder values, mark them with an EJS `<%# TODO: translate to xx %>` comment.
- Don't hardcode `<html lang="en">` — always use `<%= passData.ctx.state.lang %>`.
- Don't bulk-wrap every string in a template without asking — some strings (e.g., dynamic database content, code samples, brand names) shouldn't be translated.
- Don't introduce the local syntax `passData.plugin.simpleI18n.__()` in new code unless the user explicitly requests it or the global helper isn't available (e.g., a context where the whitelist hasn't been processed).
- Don't add `"key"` fields to every translation object — they're optional and most reference code in `/www/` omits them. Add them only if the user opts in.
- Don't touch the `__` entry in `globalFunctionsWhitelist` without explicit confirmation — it's `required: true` and a typo crashes startup.
- Don't introduce client-side i18n libraries (i18next, vue-i18n, etc.) — the plugin is server-side rendering only. If the user needs client-side, that's out of scope for this skill.
- Don't edit theme partials when a page-level edit would suffice. Theme edits affect every page that uses the theme — only do this when the user explicitly wants that scope (typically for `<html lang>` in `head.ejs` and a global language switcher in `nav.ejs`/`footer.ejs`).
- Don't generate a `README.md` or any documentation file alongside the edits.
