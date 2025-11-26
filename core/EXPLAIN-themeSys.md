# Sistema dei Temi - Documentazione Tecnica

**Versione:** 2.0.0
**Data:** 2025-11-26
**File Sorgente:** `core/themeSys.js`

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Architettura del Sistema](#2-architettura-del-sistema)
3. [Flusso di Inizializzazione](#3-flusso-di-inizializzazione)
4. [Validazione Temi](#4-validazione-temi)
5. [Sistema Dipendenze](#5-sistema-dipendenze)
6. [Gestione Partials](#6-gestione-partials)
7. [Asset Management](#7-asset-management)
8. [Plugin Endpoint Customization](#8-plugin-endpoint-customization)
9. [API Reference](#9-api-reference)
10. [Integrazione con pluginSys](#10-integrazione-con-pluginsys)
11. [Esempi di Utilizzo](#11-esempi-di-utilizzo)

---

## 1. Introduzione

Questo documento descrive il funzionamento tecnico interno del sistema dei temi di ital8cms.

### Collegamenti alla Documentazione

- **[themes/EXPLAIN.md](../themes/EXPLAIN.md):** Guida utente per creare temi
- **Questo documento:** Funzionamento tecnico interno (per sviluppatori avanzati)
- **[CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md](../CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md):** Stato implementazione e TODO

### Scopo

Il sistema `themeSys` è responsabile di:

1. **Validare** i temi all'avvio
2. **Gestire** il fallback automatico a "default"
3. **Risolvere** i path dei partials
4. **Servire** gli asset dei temi
5. **Personalizzare** endpoint dei plugin
6. **Verificare** le dipendenze dei temi

---

## 2. Architettura del Sistema

### 2.1 Classe `themeSys`

Il sistema è implementato come classe singleton in `core/themeSys.js`.

```javascript
class themeSys {
  constructor(theItal8Conf, thePluginSys = null) {
    this.ital8Conf = theItal8Conf;      // Configurazione globale
    this.pluginSys = thePluginSys;       // Riferimento al sistema plugin

    // Validazione tema pubblico
    // Validazione tema admin
    // Check dipendenze
  }
}
```

### 2.2 Istanziazione

La classe viene istanziata in `index.js` dopo il caricamento dei plugin:

```javascript
// In index.js
const themeSys = new themeSys(ital8Conf, pluginSys);
```

### 2.3 Disponibilità Globale

L'istanza `themeSys` è disponibile:

**Nelle pagine EJS** tramite `passData`:
```ejs
<%- passData.themeSys.getThemePartPath('head.ejs') %>
```

**Nei plugin:**
```javascript
// Passato come parametro
getRouteArray(router, pluginSys, pathPluginFolder) {
  // themeSys accessibile tramite ctx.state o passData
}
```

---

## 3. Flusso di Inizializzazione

### 3.1 Sequenza di Avvio

```
1. index.js carica ital8-conf.json
   ↓
2. Inizializza pluginSys
   ↓
3. Carica tutti i plugin attivi
   ↓
4. Istanzia themeSys(ital8Conf, pluginSys)
   ↓
5. themeSys.constructor() esegue:
   a. Valida tema pubblico (activeTheme)
   b. Fallback a "default" se non valido
   c. Check dipendenze tema pubblico
   d. Valida tema admin (adminActiveTheme)
   e. Fallback a "default" se non valido
   f. Check dipendenze tema admin
   ↓
6. Setup static servers per asset
   ↓
7. Server HTTP avviato
```

### 3.2 Constructor - Codice Dettagliato

```javascript
constructor(theItal8Conf, thePluginSys = null) {
  this.ital8Conf = theItal8Conf;
  this.pluginSys = thePluginSys;

  // ============================================
  // TEMA PUBBLICO
  // ============================================

  // Valida tema pubblico
  const publicValidation = this.validateTheme(this.ital8Conf.activeTheme);

  if (!publicValidation.valid) {
    console.warn(`[themeSys] Tema pubblico '${this.ital8Conf.activeTheme}' non valido: ${publicValidation.error}`);
    console.warn('[themeSys] Fallback al tema "default"');
    this.ital8Conf.activeTheme = 'default';
  } else {
    console.log(`[themeSys] Tema pubblico '${this.ital8Conf.activeTheme}' caricato correttamente`);
  }

  // Controlla dipendenze del tema pubblico
  if (this.pluginSys) {
    const publicDeps = this.checkDependencies(this.ital8Conf.activeTheme);
    if (!publicDeps.satisfied) {
      console.warn(`[themeSys] Dipendenze tema pubblico non soddisfatte: ${publicDeps.errors.join(', ')}`);
      // Soft fail: tema caricato comunque, ma con warning
    }
  }

  // ============================================
  // TEMA ADMIN
  // ============================================

  // Valida tema admin
  const adminValidation = this.validateTheme(this.ital8Conf.adminActiveTheme);

  if (!adminValidation.valid) {
    console.warn(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' non valido: ${adminValidation.error}`);
    console.warn('[themeSys] Fallback al tema "default"');
    this.ital8Conf.adminActiveTheme = 'default';
  } else {
    console.log(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' caricato correttamente`);
  }

  // Controlla dipendenze del tema admin (se diverso da pubblico)
  if (this.pluginSys && this.ital8Conf.adminActiveTheme !== this.ital8Conf.activeTheme) {
    const adminDeps = this.checkDependencies(this.ital8Conf.adminActiveTheme);
    if (!adminDeps.satisfied) {
      console.warn(`[themeSys] Dipendenze tema admin non soddisfatte: ${adminDeps.errors.join(', ')}`);
    }
  }
}
```

### 3.3 Output Console Tipico

```
[themeSys] Tema pubblico 'default' caricato correttamente
[themeSys] Tema admin 'default' caricato correttamente
```

O in caso di errore:

```
[themeSys] Tema pubblico 'myTheme' non valido: Partial 'head.ejs' mancante nel tema 'myTheme'
[themeSys] Fallback al tema "default"
[themeSys] Tema pubblico 'default' caricato correttamente
[themeSys] Dipendenze tema pubblico non soddisfatte: Plugin 'bootstrap' richiesto ma non attivo
```

---

## 4. Validazione Temi

### 4.1 Metodo `validateTheme(themeName)`

Verifica che un tema sia valido prima del caricamento.

```javascript
validateTheme(themeName) {
  const themePath = path.join(__dirname, '../themes', themeName);

  // 1. Controlla esistenza directory del tema
  if (!fs.existsSync(themePath)) {
    return { valid: false, error: `Directory del tema '${themeName}' non trovata` };
  }

  // 2. Controlla se è effettivamente una directory
  const stats = fs.statSync(themePath);
  if (!stats.isDirectory()) {
    return { valid: false, error: `'${themeName}' non è una directory` };
  }

  // 3. Controlla esistenza config-theme.json
  const configPath = path.join(themePath, 'config-theme.json');
  if (!fs.existsSync(configPath)) {
    return { valid: false, error: `config-theme.json mancante nel tema '${themeName}'` };
  }

  // 4. Controlla esistenza directory views
  const viewsPath = path.join(themePath, 'views');
  if (!fs.existsSync(viewsPath)) {
    return { valid: false, error: `Directory 'views' mancante nel tema '${themeName}'` };
  }

  // 5. Controlla partials obbligatori
  const requiredPartials = ['head.ejs', 'header.ejs', 'footer.ejs'];
  for (const partial of requiredPartials) {
    const partialPath = path.join(viewsPath, partial);
    if (!fs.existsSync(partialPath)) {
      return { valid: false, error: `Partial '${partial}' mancante nel tema '${themeName}'` };
    }
  }

  // Tutte le validazioni passate
  return { valid: true, error: null };
}
```

### 4.2 Controlli Effettuati

| # | Check | Errore se Manca |
|---|-------|-----------------|
| 1 | Directory tema esiste | `Directory del tema 'X' non trovata` |
| 2 | È una directory (non file) | `'X' non è una directory` |
| 3 | `config-theme.json` presente | `config-theme.json mancante` |
| 4 | Directory `views/` presente | `Directory 'views' mancante` |
| 5 | `views/head.ejs` presente | `Partial 'head.ejs' mancante` |
| 6 | `views/header.ejs` presente | `Partial 'header.ejs' mancante` |
| 7 | `views/footer.ejs` presente | `Partial 'footer.ejs' mancante` |

### 4.3 Fallback Automatico

Se un tema non passa la validazione:

1. **Warning** in console con dettaglio errore
2. **Fallback** automatico a tema "default"
3. **Continua** l'esecuzione (no crash)

**Comportamento soft-fail:** Anche se il tema configurato è invalido, il sistema non si blocca ma usa il tema di default.

---

## 5. Sistema Dipendenze

### 5.1 Tipi di Dipendenze

I temi possono dichiarare dipendenze di due tipi:

**1. Plugin Dependencies** - Plugin richiesti

```json
{
  "pluginDependency": {
    "bootstrap": "^1.0.0",
    "simpleAccess": ">=1.0.0"
  }
}
```

**2. Node Module Dependencies** - Moduli NPM richiesti

```json
{
  "nodeModuleDependency": {
    "ejs": "^3.0.0",
    "bootstrap": "^5.3.0"
  }
}
```

### 5.2 Metodo `checkDependencies(themeName)`

Verifica che tutte le dipendenze siano soddisfatte.

```javascript
checkDependencies(themeName) {
  const errors = [];
  const themePath = path.join(__dirname, '../themes', themeName);
  const configPath = path.join(themePath, 'config-theme.json');

  // Leggi configurazione tema
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {
      satisfied: false,
      errors: [`Impossibile leggere config-theme.json: ${error.message}`]
    };
  }

  // ======================================
  // CONTROLLA DIPENDENZE PLUGIN
  // ======================================
  const pluginDeps = config.pluginDependency || {};

  for (const [pluginName, versionRequired] of Object.entries(pluginDeps)) {
    // Verifica che il plugin sia attivo
    if (!this.pluginSys.isPluginActive(pluginName)) {
      errors.push(`Plugin '${pluginName}' richiesto ma non attivo`);
      continue;
    }

    // Verifica versione se specificata
    if (versionRequired && versionRequired !== '*') {
      const installedVersion = this.pluginSys.getPluginVersion(pluginName);

      if (installedVersion && !semver.satisfies(installedVersion, versionRequired)) {
        errors.push(
          `Plugin '${pluginName}' versione ${installedVersion} ` +
          `non soddisfa requisito ${versionRequired}`
        );
      }
    }
  }

  // ======================================
  // CONTROLLA DIPENDENZE MODULI NPM
  // ======================================
  const nodeDeps = config.nodeModuleDependency || {};

  for (const [moduleName, versionRequired] of Object.entries(nodeDeps)) {
    try {
      // Verifica che il modulo sia installato
      const modulePath = require.resolve(moduleName);

      // Verifica versione se specificata
      if (versionRequired && versionRequired !== '*') {
        try {
          const packageJsonPath = path.join(
            path.dirname(modulePath),
            '..',
            'package.json'
          );
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          const installedVersion = packageJson.version;

          if (installedVersion && !semver.satisfies(installedVersion, versionRequired)) {
            errors.push(
              `Modulo NPM '${moduleName}' versione ${installedVersion} ` +
              `non soddisfa requisito ${versionRequired}`
            );
          }
        } catch {
          // Se non riesce a leggere la versione, considera comunque il modulo installato
          console.warn(`[themeSys] Impossibile verificare versione del modulo '${moduleName}'`);
        }
      }
    } catch {
      errors.push(`Modulo NPM '${moduleName}' richiesto ma non installato`);
    }
  }

  return {
    satisfied: errors.length === 0,
    errors: errors
  };
}
```

### 5.3 Semantic Versioning

Le versioni seguono lo standard **semver**:

| Sintassi | Significato | Esempio |
|----------|-------------|---------|
| `^1.0.0` | Compatibile con 1.x.x (minor e patch) | `1.2.5` ✅ `2.0.0` ❌ |
| `~1.0.0` | Compatibile con 1.0.x (solo patch) | `1.0.9` ✅ `1.1.0` ❌ |
| `>=1.0.0` | Versione 1.0.0 o superiore | `1.5.0` ✅ `2.0.0` ✅ |
| `*` | Qualsiasi versione | Qualsiasi ✅ |

### 5.4 Comportamento

**Dipendenze non soddisfatte:**
- **Warning** in console
- **Tema caricato** comunque (soft fail)
- **Possibili malfunzionamenti** se dipendenze critiche

**Raccomandazione:** Installare sempre tutte le dipendenze prima di attivare un tema.

---

## 6. Gestione Partials

### 6.1 Metodo `getThemePartPath(partName)`

Risolve il path assoluto di un partial del tema pubblico.

```javascript
getThemePartPath(partName) {
  return `${__dirname}/../themes/${this.ital8Conf.activeTheme}/views/${partName}`;
}
```

**Esempio:**
```javascript
themeSys.getThemePartPath('head.ejs')
// Ritorna: /home/user/ital8cms/themes/default/views/head.ejs
```

### 6.2 Metodo `getAdminThemePartPath(partName)`

Risolve il path assoluto di un partial del tema admin.

```javascript
getAdminThemePartPath(partName) {
  return `${__dirname}/../themes/${this.ital8Conf.adminActiveTheme}/views/${partName}`;
}
```

**Esempio:**
```javascript
themeSys.getAdminThemePartPath('footer.ejs')
// Ritorna: /home/user/ital8cms/themes/default/views/footer.ejs
```

### 6.3 Utilizzo nei Template EJS

**Nelle pagine pubbliche** (es: `/www/index.ejs`):

```ejs
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>
<!-- contenuto -->
<%- include(getThemePartPath('footer', passData)) %>
```

**Nelle pagine admin** (es: `/core/admin/webPages/index.ejs`):

```ejs
<%- include(getAdminThemePartPath('head', passData)) %>
<%- include(getAdminThemePartPath('header', passData)) %>
<!-- contenuto admin -->
<%- include(getAdminThemePartPath('footer', passData)) %>
```

### 6.4 Helper Functions Globali

Le funzioni `getThemePartPath` e `getAdminThemePartPath` sono rese disponibili globalmente tramite passData:

```javascript
// In index.js
const passData = {
  themeSys: themeSys,
  // ...
};

// Funzioni helper globali per EJS
global.getThemePartPath = (partName, passData) => {
  return passData.themeSys.getThemePartPath(partName);
};

global.getAdminThemePartPath = (partName, passData) => {
  return passData.themeSys.getAdminThemePartPath(partName);
};
```

---

## 7. Asset Management

### 7.1 Cartella Asset del Tema

Ogni tema può avere una cartella `theme-resources/` contenente:

```
theme-resources/
├── css/
│   ├── theme.css
│   └── components.css
├── js/
│   └── theme.js
└── images/
    └── logo.png
```

### 7.2 Configurazione Static Server

In `index.js`, gli asset vengono serviti tramite `koa-classic-server`:

```javascript
// Serve theme assets
if (themeSys.hasAssets()) {
  app.use(koaClassicServer(
    themeSys.getAssetsPath(),
    {
      prefix: '/theme-assets',
      index: false,
      hidden: false
    }
  ));
  console.log('[Server] Theme assets serviti su /theme-assets');
}
```

### 7.3 Metodi Asset

#### `getAssetsPath()`

Restituisce il path assoluto della cartella asset del tema attivo.

```javascript
getAssetsPath() {
  return path.join(__dirname, '../themes', this.ital8Conf.activeTheme, 'theme-resources');
}
```

#### `hasAssets()`

Verifica se la cartella asset esiste.

```javascript
hasAssets() {
  const assetsPath = this.getAssetsPath();
  return fs.existsSync(assetsPath) && fs.statSync(assetsPath).isDirectory();
}
```

#### `getAssetUrl(assetPath)`

Restituisce l'URL pubblico di un asset.

```javascript
getAssetUrl(assetPath) {
  // Rimuove eventuali slash iniziali dal path
  const cleanPath = assetPath.replace(/^\/+/, '');
  return `/theme-assets/${cleanPath}`;
}
```

**Esempio:**
```javascript
themeSys.getAssetUrl('css/theme.css')
// Ritorna: /theme-assets/css/theme.css
```

### 7.4 Utilizzo nei Template

```ejs
<!-- Metodo 1: URL diretto -->
<link rel="stylesheet" href="/theme-assets/css/theme.css">
<script src="/theme-assets/js/theme.js"></script>
<img src="/theme-assets/images/logo.png" alt="Logo">

<!-- Metodo 2: Helper getAssetUrl() -->
<link rel="stylesheet" href="<%= passData.themeSys.getAssetUrl('css/theme.css') %>">
```

---

## 8. Plugin Endpoint Customization

### 8.1 Concetto

Permette ai temi di **sovrascrivere l'aspetto degli endpoint dei plugin** senza modificare il codice del plugin.

**Struttura:**
```
themes/mioTema/
└── plugins-endpoints-markup/
    └── simpleAccess/           # Nome plugin
        └── login/              # Nome endpoint
            ├── template.ejs    # Template custom
            └── style.css       # CSS custom
```

### 8.2 Metodi Principali

#### `hasCustomPluginTemplate(pluginName, endpointName, templateFile, isAdmin)`

Verifica se esiste un template personalizzato.

```javascript
hasCustomPluginTemplate(pluginName, endpointName, templateFile = 'template.ejs', isAdmin = false) {
  const customPath = this.getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin);
  return customPath !== null;
}
```

#### `getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin)`

Restituisce il path del template custom se esiste, altrimenti `null`.

```javascript
getCustomPluginTemplatePath(pluginName, endpointName, templateFile = 'template.ejs', isAdmin = false) {
  const themeName = isAdmin ? this.ital8Conf.adminActiveTheme : this.ital8Conf.activeTheme;
  const customPath = path.join(
    __dirname,
    '../themes',
    themeName,
    'plugins-endpoints-markup',
    pluginName,
    endpointName,
    templateFile
  );

  if (fs.existsSync(customPath)) {
    return customPath;
  }
  return null;
}
```

#### `resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile, isAdmin)`

Risolve quale template usare: custom o default.

```javascript
resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile = 'template.ejs', isAdmin = false) {
  const customPath = this.getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin);

  if (customPath) {
    console.log(`[themeSys] Usando template personalizzato per ${pluginName}/${endpointName}: ${customPath}`);
    return customPath;
  }

  return defaultPath;
}
```

### 8.3 Flusso di Risoluzione Template

```
Plugin carica endpoint (es: /api/simpleAccess/login)
         ↓
Plugin chiama themeSys.resolvePluginTemplatePath()
         ↓
         ┌─────────────────────────────────┐
         │ Esiste template custom?         │
         └─────────────────────────────────┘
                ↓                ↓
              Sì                No
                ↓                ↓
    themes/tema/plugins-     plugins/plugin/
    endpoints-markup/...     defaultTemplate.ejs
                ↓                ↓
         Template renderizzato
```

### 8.4 Esempio di Integrazione nel Plugin

```javascript
// In plugins/simpleAccess/main.js

getRouteArray(router, pluginSys, pathPluginFolder) {
  const themeSys = pluginSys.themeSys; // Riferimento a themeSys

  return [
    {
      method: 'get',
      path: '/login',
      func: async (ctx) => {
        // Path di default del plugin
        const defaultTemplatePath = path.join(pathPluginFolder, 'templates/login.ejs');

        // Risolve: custom o default
        const templatePath = themeSys.resolvePluginTemplatePath(
          'simpleAccess',   // Nome plugin
          'login',          // Nome endpoint
          defaultTemplatePath,
          'template.ejs',
          false             // Non admin
        );

        // Carica CSS custom se esiste
        const customCss = themeSys.getPluginCustomCss('simpleAccess', 'login');

        // Render template
        ctx.body = await ejs.renderFile(templatePath, {
          customCss: customCss,
          // altre variabili...
        });
      }
    }
  ];
}
```

### 8.5 Metodi CSS Custom

#### `getPluginCustomCss(pluginName, endpointName, cssFile, isAdmin)`

Legge il contenuto di `style.css` del tema per un endpoint.

```javascript
getPluginCustomCss(pluginName, endpointName, cssFile = 'style.css', isAdmin = false) {
  const cssPath = this.getCustomPluginAssetPath(pluginName, endpointName, cssFile, isAdmin);

  if (cssPath) {
    try {
      return fs.readFileSync(cssPath, 'utf8');
    } catch (error) {
      console.warn(`[themeSys] Errore lettura CSS personalizzato: ${error.message}`);
      return '';
    }
  }
  return '';
}
```

**Utilizzo:**
```javascript
const customCss = themeSys.getPluginCustomCss('simpleAccess', 'login');
// Ritorna contenuto di themes/tema/plugins-endpoints-markup/simpleAccess/login/style.css
```

---

## 9. API Reference

### 9.1 Metodi Path Partials

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `getThemePartPath(partName)` | `partName`: string | string | Path assoluto partial tema pubblico |
| `getAdminThemePartPath(partName)` | `partName`: string | string | Path assoluto partial tema admin |

### 9.2 Metodi Validazione

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `validateTheme(themeName)` | `themeName`: string | `{valid: boolean, error: string\|null}` | Valida struttura tema |
| `getAvailableThemes()` | - | Array | Lista temi disponibili con stato |

### 9.3 Metodi Dipendenze

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `checkDependencies(themeName)` | `themeName`: string | `{satisfied: boolean, errors: Array}` | Verifica dipendenze |
| `getThemeDependencies(themeName)` | `themeName`: string | `{plugins: {}, nodeModules: {}}` | Tutte le dipendenze |
| `themeRequiresPlugin(themeName, pluginName)` | `themeName`: string, `pluginName`: string | boolean\|string | Versione richiesta o false |
| `getActiveThemePluginDependencies()` | - | object | Dipendenze plugin tema attivo |
| `checkActiveThemeDependencies()` | - | `{satisfied: boolean, errors: Array}` | Verifica dipendenze tema attivo |

### 9.4 Metodi Metadati

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `getThemeDescription(themeName)` | `themeName`: string | object\|null | Metadati da description-theme.json |
| `getThemeVersion(themeName)` | `themeName`: string | string\|null | Versione tema |
| `getActiveThemeDescription()` | - | object\|null | Metadati tema pubblico attivo |
| `getAdminThemeDescription()` | - | object\|null | Metadati tema admin attivo |
| `themeSupportsHook(themeName, hookName)` | `themeName`: string, `hookName`: string | boolean | Verifica supporto hook |
| `getThemeFeatures(themeName)` | `themeName`: string | object | Feature del tema |

### 9.5 Metodi Asset

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `getAssetUrl(assetPath)` | `assetPath`: string | string | URL pubblico asset |
| `getAssetsPath()` | - | string | Path assoluto cartella asset |
| `hasAssets()` | - | boolean | Verifica esistenza cartella asset |

### 9.6 Metodi Plugin Customization

| Metodo | Parametri | Ritorno | Descrizione |
|--------|-----------|---------|-------------|
| `hasCustomPluginTemplate(pluginName, endpointName, templateFile, isAdmin)` | 4 params | boolean | Verifica esistenza template custom |
| `getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin)` | 4 params | string\|null | Path template custom o null |
| `resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile, isAdmin)` | 5 params | string | Risolve quale template usare |
| `hasCustomPluginAsset(pluginName, endpointName, assetFile, isAdmin)` | 4 params | boolean | Verifica esistenza asset custom |
| `getCustomPluginAssetPath(pluginName, endpointName, assetFile, isAdmin)` | 4 params | string\|null | Path asset custom o null |
| `getPluginAssetUrl(pluginName, endpointName, assetFile)` | 3 params | string | URL asset custom |
| `getPluginCustomCss(pluginName, endpointName, cssFile, isAdmin)` | 4 params | string | Contenuto CSS custom |
| `getCustomizedPlugins(isAdmin)` | `isAdmin`: boolean | Array | Lista plugin customizzati nel tema |

---

## 10. Integrazione con pluginSys

### 10.1 Dipendenza Circolare

`themeSys` dipende da `pluginSys` per verificare dipendenze:

```javascript
constructor(theItal8Conf, thePluginSys = null) {
  this.pluginSys = thePluginSys;

  if (this.pluginSys) {
    // Check dipendenze plugin
    const deps = this.checkDependencies(themeName);
  }
}
```

**Nota:** `pluginSys` è opzionale nel constructor. Se `null`, il check dipendenze plugin viene saltato.

### 10.2 Metodi pluginSys Utilizzati

| Metodo | Scopo |
|--------|-------|
| `isPluginActive(pluginName)` | Verifica se plugin è attivo |
| `getPluginVersion(pluginName)` | Ottiene versione plugin |

### 10.3 Accesso a themeSys dai Plugin

I plugin possono accedere a themeSys tramite `passData` o tramite riferimento diretto:

```javascript
// Nei plugin
getRouteArray(router, pluginSys, pathPluginFolder) {
  // Opzione 1: Tramite passData nelle route
  return [{
    method: 'get',
    path: '/example',
    func: async (ctx) => {
      const themeSys = ctx.state.passData.themeSys;
      // Usa themeSys...
    }
  }];

  // Opzione 2: Referenza diretta (se esposta)
  const themeSys = pluginSys.themeSys;
}
```

---

## 11. Esempi di Utilizzo

### 11.1 Creare un Nuovo Tema con Validazione

```javascript
// 1. Crea struttura tema
const themePath = './themes/myTheme';
fs.mkdirSync(`${themePath}/views`, { recursive: true });
fs.mkdirSync(`${themePath}/templates`);

// 2. Crea file obbligatori
fs.writeFileSync(`${themePath}/config-theme.json`, JSON.stringify({
  active: 1,
  isInstalled: 1,
  weight: 0,
  followsGlobalStandard: "1.0",
  wwwCustomPath: 0,
  pluginDependency: {},
  nodeModuleDependency: {}
}, null, 2));

fs.writeFileSync(`${themePath}/description-theme.json`, JSON.stringify({
  name: "myTheme",
  version: "1.0.0",
  description: "My custom theme"
}, null, 2));

// 3. Crea partials obbligatori
fs.writeFileSync(`${themePath}/views/head.ejs`, '<!DOCTYPE html>...');
fs.writeFileSync(`${themePath}/views/header.ejs`, '<body>...');
fs.writeFileSync(`${themePath}/views/footer.ejs`, '</body></html>');

// 4. Crea almeno un template
fs.writeFileSync(`${themePath}/templates/page.template.ejs`,
  '<%- include(getThemePartPath("head", passData)) %>...');

// 5. Valida tema
const validation = themeSys.validateTheme('myTheme');
if (validation.valid) {
  console.log('Tema valido!');
} else {
  console.error('Tema non valido:', validation.error);
}
```

### 11.2 Verificare Dipendenze Prima di Attivare un Tema

```javascript
// In un'interfaccia admin per cambio tema

async function activateTheme(themeName) {
  const fs = require('fs');
  const path = require('path');

  // 1. Valida tema
  const validation = themeSys.validateTheme(themeName);
  if (!validation.valid) {
    return { success: false, error: `Tema non valido: ${validation.error}` };
  }

  // 2. Verifica dipendenze
  const deps = themeSys.checkDependencies(themeName);
  if (!deps.satisfied) {
    return {
      success: false,
      error: 'Dipendenze non soddisfatte',
      details: deps.errors
    };
  }

  // 3. Leggi configurazione tema
  const themeConfigPath = path.join(__dirname, 'themes', themeName, 'config-theme.json');
  const themeConfig = JSON.parse(fs.readFileSync(themeConfigPath, 'utf8'));

  // 4. Gestisci wwwCustomPath
  if (themeConfig.wwwCustomPath === 1) {
    // Crea README.txt in /www/ root per avvisare del cambio location
    const readmePath = path.join(__dirname, 'www', 'README.txt');
    const readmeContent = `ATTENZIONE: Cartella www/ root non più utilizzata
=================================================

Il tema attualmente attivo utilizza una cartella www/ personalizzata.

Tema attivo: ${themeName}
Cartella pagine: themes/${themeName}/www/

Tutte le pagine web create dall'admin si trovano in:
/themes/${themeName}/www/

Questa cartella (/www/ nella root del progetto) NON è più utilizzata
finché rimane attivo un tema con wwwCustomPath: 1.

Per tornare alla cartella /www/ root, attivare un tema con wwwCustomPath: 0.
`;
    fs.writeFileSync(readmePath, readmeContent, 'utf8');
    console.log('[themeSys] Creato /www/README.txt - Pagine ora in themes/' + themeName + '/www/');
  } else {
    // Rimuovi README.txt se esiste (tema usa /www/ root)
    const readmePath = path.join(__dirname, 'www', 'README.txt');
    if (fs.existsSync(readmePath)) {
      fs.unlinkSync(readmePath);
      console.log('[themeSys] Rimosso /www/README.txt - Pagine tornano in /www/ root');
    }
  }

  // 5. Attiva tema
  ital8Conf.activeTheme = themeName;
  fs.writeFileSync('./ital8-conf.json', JSON.stringify(ital8Conf, null, 2));

  return { success: true, message: 'Tema attivato. Riavviare il server.' };
}
```

### 11.3 Personalizzare Endpoint Plugin

```javascript
// Nel plugin simpleAccess

getRouteArray(router, pluginSys, pathPluginFolder) {
  const themeSys = pluginSys.themeSys;

  return [{
    method: 'get',
    path: '/login',
    func: async (ctx) => {
      const defaultPath = path.join(pathPluginFolder, 'templates/login.ejs');

      // Risolve template (custom o default)
      const templatePath = themeSys.resolvePluginTemplatePath(
        'simpleAccess',
        'login',
        defaultPath
      );

      // Carica CSS custom
      const customCss = themeSys.getPluginCustomCss('simpleAccess', 'login');

      // Render
      ctx.body = await ejs.renderFile(templatePath, {
        bootstrapCss: '<link...>',
        bootstrapJs: '<script...>',
        customCss: customCss,
        referrerTo: ctx.query.referrerTo || '/'
      });
    }
  }];
}
```

### 11.4 Utilizzare Asset del Tema

```ejs
<!-- In views/head.ejs -->
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Il Mio Sito</title>

    <!-- CSS del tema -->
    <link rel="stylesheet" href="<%= passData.themeSys.getAssetUrl('css/theme.css') %>">
    <link rel="stylesheet" href="<%= passData.themeSys.getAssetUrl('css/responsive.css') %>">

    <!-- Hook plugin -->
    <%- passData.pluginSys.hookPage("head", passData) %>
</head>
```

```ejs
<!-- In views/footer.ejs -->
    <footer>
        <img src="<%= passData.themeSys.getAssetUrl('images/logo.png') %>" alt="Logo">
        <p>&copy; 2025 Il Mio Sito</p>
    </footer>

    <!-- JavaScript tema -->
    <script src="<%= passData.themeSys.getAssetUrl('js/theme.js') %>"></script>

    <!-- Hook plugin -->
    <%- passData.pluginSys.hookPage("script", passData) %>
</body>
</html>
```

### 11.5 Ottenere Lista Temi Disponibili

```javascript
// In un endpoint admin

{
  method: 'get',
  path: '/themes/list',
  func: async (ctx) => {
    const themes = themeSys.getAvailableThemes();

    /* Ritorna:
    [
      {
        name: "default",
        valid: true,
        error: null,
        isActive: true,
        isAdminActive: true,
        description: { name: "default", version: "1.0.0", ... }
      },
      {
        name: "myTheme",
        valid: false,
        error: "Partial 'head.ejs' mancante nel tema 'myTheme'",
        isActive: false,
        isAdminActive: false,
        description: null
      }
    ]
    */

    ctx.body = themes;
  }
}
```

---

## Link Utili

- **Guida Utente:** [themes/EXPLAIN.md](../themes/EXPLAIN.md)
- **Stato Implementazione:** [CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md](../CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md)
- **File Sorgente:** `core/themeSys.js`
- **Temi Esempio:** `themes/default/` e `themes/baseExampleTheme/`

---

**Fine documentazione tecnica**

**Versione:** 2.0.0
**Data:** 2025-11-26
**Autore:** AI Assistant per ital8cms
