<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN-pluginPages.md` is a stub until release.
# Plugin Pages System — Documentazione tecnica

> Sintesi/contratto: vedi la sezione "Plugin Pages System" in `CLAUDE.md`.

## Panoramica

Il **Plugin Pages System** permette ai plugin di servire pagine web pubbliche **senza creare manualmente endpoint** in `getRouteArray()`. Usa un'architettura **a symlink** (zero duplicazione di file) e si integra col sistema temi per la personalizzazione.

- **Zero configurazione:** i plugin con una directory `webPages/` sono auto-rilevati.
- **Symlink:** fonte di verità unica, nessuna duplicazione.
- **Integrazione tema:** iniezione automatica delle personalizzazioni del tema.
- **Auto-detection:** nome plugin e pagina estratti dal path del file.

**URL:** `/{pluginPagesPrefix}/{pluginName}/{file.ejs}` (default `/pluginPages/{pluginName}/{file.ejs}`).

## Architettura

```
/plugins/myPlugin/webPages/        ← pagine del plugin (sorgente)
/pluginPages/myPlugin/             → SYMLINK a /plugins/myPlugin/webPages/
/themes/<tema>/pluginsEndpointsMarkup/myPlugin/<pagina>/   ← personalizzazioni tema
    ├── template.ejs   (opz.)   ├── style.css   ├── script.js
    ├── before-content.html     └── after-content.html
```

## Configurazione (`ital8Config.json5`)

```json5
{
  "pluginPagesPrefix": "pluginPages",            // prefisso URL (la dir fisica resta /pluginPages/)
  "indexFiles": { "pluginPagesPrefix": ["index.ejs"] },  // /pluginPages/{plugin}/ serve webPages/index.ejs
  "hideExtension": { "pluginPagesPrefix": { "enabled": false, "ext": ".ejs" } } // clean URL (koa-classic-server v2.6.1+)
}
```

Nessuna configurazione lato plugin: il sistema rileva da sé la directory `webPages/`.

## Come funziona

1. **Detection (al boot):** `PluginPagesSystem` scansiona i plugin attivi, rileva le directory `webPages/`, crea i symlink `/pluginPages/{plugin}/` → `/plugins/{plugin}/webPages/`.
2. **Request flow:** `koa-classic-server` matcha il prefisso `/pluginPages/`, risolve il symlink, carica il `.ejs`, lo renderizza con `passData`, inietta le personalizzazioni del tema, restituisce l'HTML.
3. **Iniezione personalizzazioni tema** (auto, in base a `themes/{tema}/pluginsEndpointsMarkup/{plugin}/{pagina}/`):
   - `style.css` → `<style>` nel `<head>`
   - `script.js` → `<script>` nel `<head>`
   - `before-content.html` → prima di `<main>`
   - `after-content.html` → dopo `<main>`

## Creare pagine plugin

Basta creare la directory `webPages/` nel plugin e metterci i `.ejs`. Template standard:

```ejs
<!DOCTYPE html>
<html lang="it">
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>
<%- passData.themeSys.injectPluginJs() %>
<title>My Page</title>
</head>
<body>
<%- include(passData.themeSys.getThemePartPath('header.ejs')) %>
<%- passData.themeSys.injectPluginHtmlBefore() %>
<main class="plugin-page">
  <!-- contenuto; i POST vanno verso /api/myPlugin/... (getRouteArray) -->
</main>
<%- passData.themeSys.injectPluginHtmlAfter() %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs')) %>
</body>
</html>
```

Punti chiave: usa i partial del tema (`head`/`header`/`footer`); chiama i metodi `inject*()` **senza parametri** (auto-detection); i POST restano in `getRouteArray()`.

## API themeSys per le pagine plugin

In template `passData.themeSys` è un **wrapper** coi metodi già legati a `passData` (niente parametri):

- `injectPluginCss()` → `<style>…</style>` o `''`
- `injectPluginJs()` → `<script>…</script>` o `''`
- `injectPluginHtmlBefore()` → HTML o `''`
- `injectPluginHtmlAfter()` → HTML o `''`

**Auto-detection:** `themeSys.extractPluginContext(filePath)` estrae `{ pluginName, pageName }` dal path (`…/plugins/myPlugin/webPages/mypage.ejs` o `…/pluginPages/myPlugin/mypage.ejs`) e cerca le personalizzazioni in `themes/{temaAttivo}/pluginsEndpointsMarkup/myPlugin/mypage/`.

## GET vs POST

- **GET:** servite automaticamente dal Plugin Pages System (`GET /pluginPages/myPlugin/login.ejs`).
- **POST:** restano in `getRouteArray()` del plugin (`POST /api/myPlugin/login`).

## passData nelle pagine plugin

```javascript
{
  isAdminContext: false,   // sempre false in contesto pubblico
  globalPrefix: '',        // global prefix da ital8Config.json5
  apiPrefix: 'api',        // api prefix
  pluginSys,               // istanza plugin system
  plugin: { /* shared objects da getObjectToShareToWebPages */ },
  adminSystem,             // disponibile anche nelle pagine pubbliche
  filePath: '/path/.ejs',  // path assoluto del template
  href, query, ctx,        // ctx.href, ctx.query, contesto Koa
  themeSys                 // wrapper coi metodi bound
}
```

> Il prefisso `pluginPagesPrefix` **non** è esposto in passData: leggerlo dalla config lato server o costruire URL relativi.

## Architettura del sistema

**1. `PluginPagesSystem` (`core/pluginPagesSystem.js`)** — scan + gestione symlink. API pubblica:

| Metodo | Descrizione |
|--------|-------------|
| `initialize()` | scan + crea symlink + cleanup (chiamato da `index.js`) |
| `getPluginPagesDirectory()` | path assoluto di `/pluginPages/` |
| `hasPublicPages(pluginName)` | `true` se il plugin ha `webPages/` |
| `getPluginsWithPublicPages()` | nomi dei plugin attivi con `webPages/` |
| `createSymlinkForPlugin(pluginName, sourceDir)` | crea/verifica il symlink |
| `removeSymlinkForPlugin(pluginName)` | rimuove il symlink (uninstall) |
| `validateAndCleanSymlinks()` | rimuove symlink rotti/orfani/di plugin disattivati (in `initialize()`) |

**Auto-cleanup al boot:** crea `/pluginPages/` se assente; rimuove symlink verso path inesistenti o di plugin non più attivi; se in `/pluginPages/{plugin}` c'è un file/dir regolare (non symlink) logga errore e **non** sovrascrive.

**2. Estensioni `themeSys` (`core/themeSys.js`):** `extractPluginContext()`, `injectPluginCss/Js/HtmlBefore/HtmlAfter(passData)`, helper `getPluginCustomJs()`/`getPluginCustomHtml()`.

**3. Wrapper (`index.js`):** `createThemeSysWrapper()` lega i metodi a `passData` → API identica in contesto pubblico e admin, senza passare `passData` come parametro.

**Flusso di init:** `index.js` → PluginSys carica i plugin → ThemeSys carica i temi → `PluginPagesSystem.initialize()` (scan + symlink) → koa-classic-server configurato per `/pluginPages/` → `createThemeSysWrapper()` → server pronto.

## Debugging

- Verifica i symlink: `ls -la pluginPages/` (devono essere `lrwxrwxrwx … → /…/plugins/<plugin>/webPages/`).
- Test pagina: `curl http://localhost:3000/pluginPages/<plugin>/<pagina>.ejs`.
- I log `[PluginPagesSystem]` al boot riportano plugin scansionati e symlink creati/verificati.

## Best practice

- Usa i partial del tema per il layout; chiama sempre i metodi `injectPlugin*()`.
- GET semplici via Plugin Pages System; logica POST in `getRouteArray()`.
- Classi semantiche: `class="plugin-page plugin-{plugin} page-{pagina}"`.
- Form `action` verso `/api/{plugin}/{endpoint}`; evita stili inline (usa la personalizzazione CSS del tema).
