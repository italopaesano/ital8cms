# Guida alla Creazione di Temi - ital8cms

**Versione:** 2.0.0
**Data:** 2025-11-26
**Standard Globale:** v1.0

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Struttura di un Tema](#2-struttura-di-un-tema)
3. [File Obbligatori](#3-file-obbligatori)
4. [Standard Globale v1.0](#4-standard-globale-v10)
5. [Cartelle del Tema](#5-cartelle-del-tema)
6. [Templates](#6-templates)
7. [Creazione Passo-Passo](#7-creazione-passo-passo)
8. [Esempi](#8-esempi)
9. [Checklist](#9-checklist)

---

## 1. Introduzione

Il sistema dei temi di **ital8cms** separa la presentazione dalla logica applicativa, permettendo di personalizzare completamente l'aspetto del CMS senza modificare il codice core.

### Collegamenti alla Documentazione

- **Questa guida:** Come creare un tema (guida utente)
- **[core/EXPLAIN-themeSys.md](../core/EXPLAIN-themeSys.md):** Funzionamento tecnico del sistema (per sviluppatori avanzati)
- **[CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md](../CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md):** Stato implementazione e TODO

### Caratteristiche Principali

✅ **Temi separati** per sito pubblico e pannello admin
✅ **Validazione automatica** con fallback al tema "default"
✅ **Sistema di hook** per integrazione con i plugin
✅ **Asset management** (CSS, JS, immagini)
✅ **Template system** per creare pagine web
✅ **Plugin endpoint customization** per personalizzare l'aspetto degli endpoint
✅ **Gestione dipendenze** da plugin e moduli NPM

---

## 2. Struttura di un Tema

```
themes/nomeDelTema/
├── themeConfig.json               # OBBLIGATORIO - Configurazione
├── themeDescription.json          # OBBLIGATORIO - Metadati
├── README.md                      # Documentazione del tema
├── theme-icon.svg                 # OPZIONALE - Icona tema (64x64)
├── screenshot.png                 # OPZIONALE - Anteprima tema (1200x900)
│
├── views/                         # OBBLIGATORIO
│   ├── head.ejs                  # OBBLIGATORIO - <head> HTML
│   ├── header.ejs                # OBBLIGATORIO - Apertura <body>
│   ├── footer.ejs                # OBBLIGATORIO - Footer + chiusura HTML
│   ├── nav.ejs                   # OPZIONALE - Navigazione
│   ├── main.ejs                  # OPZIONALE - Contenuto principale
│   └── aside.ejs                 # OPZIONALE - Sidebar
│
├── templates/                     # OBBLIGATORIO - Almeno 1 template
│   ├── page.template.ejs         # Template pagina standard
│   ├── page-icon.svg             # OPZIONALE - Icona template
│   ├── article.template.ejs      # Template articolo blog
│   └── article-icon.svg          # OPZIONALE - Icona template
│
├── theme-resources/               # OPZIONALE - Asset statici
│   ├── css/
│   │   └── theme.css
│   ├── js/
│   │   └── theme.js
│   └── images/
│       └── logo.png
│
├── plugins-endpoints-markup/      # OPZIONALE - Override endpoint plugin
│   └── nomePlugin/               # Es: simpleAccess
│       └── nomeEndpoint/         # Es: login
│           ├── template.ejs      # Template personalizzato
│           └── style.css         # CSS personalizzato
│
└── www/                           # OPZIONALE - Solo se wwwCustomPath: 1
    └── index.ejs                 # Pagine create dai template
```

---

## 3. File Obbligatori

### 3.1 themeConfig.json

File di configurazione del tema.

```json
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,

  // Standard Globale
  "followsGlobalStandard": "1.0",  // "1.0" = rispetta standard | false = custom

  // Path salvaggio pagine
  "wwwCustomPath": 0,  // 0 = /www/ root | 1 = themes/tema/www/

  // Dipendenze plugin (semantic versioning)
  "pluginDependency": {
    "bootstrap": "^1.0.0"
  },

  // Dipendenze moduli NPM
  "nodeModuleDependency": {
    "ejs": "^3.0.0"
  }
}
```

#### Campi Spiegati

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `active` | number | 1 = attivo, 0 = disattivo |
| `isInstalled` | number | Stato installazione |
| `weight` | number | Priorità caricamento (più basso = prima) |
| `followsGlobalStandard` | string/boolean | Versione standard rispettato (`"1.0"`) o `false` |
| `wwwCustomPath` | number | 0 = pagine in `/www/`, 1 = pagine in `themes/tema/www/` |
| `pluginDependency` | object | Plugin richiesti (nome: versione semver) |
| `nodeModuleDependency` | object | Moduli NPM richiesti (nome: versione semver) |

#### followsGlobalStandard

**Valore `"1.0"`** - Tema rispetta lo standard globale:
- Le pagine create vanno in `/www/` (se `wwwCustomPath: 0`)
- Compatibilità garantita con altri temi standard
- I template seguono la struttura standard

**Valore `false`** - Tema custom:
- Le pagine create vanno in `themes/nomeDelTema/www/` (raccomandato `wwwCustomPath: 1`)
- Compatibilità NON garantita con altri temi
- Migrazione manuale necessaria se si cambia tema

#### wwwCustomPath

**Valore `0`** - Pagine in `/www/` root:
- Tutte le pagine create dai template vanno nella cartella globale
- Utile per temi standard-compliant
- Cambiare tema non "perde" le pagine

**Valore `1`** - Pagine in `themes/nomeDelTema/www/`:
- Pagine isolate nella cartella del tema
- Utile per temi custom con strutture specifiche
- Cambiare tema richiede migrazione manuale
- **Importante:** All'attivazione, viene creato `/www/README.txt` nella root che avvisa che le pagine sono ora in `themes/nomeTema/www/`

#### README.txt Automatico

Quando si attiva un tema con `wwwCustomPath: 1`, il sistema crea automaticamente un file `/www/README.txt` nella root del progetto con questo contenuto:

```
ATTENZIONE: Cartella www/ root non più utilizzata
=================================================

Il tema attualmente attivo utilizza una cartella www/ personalizzata.

Tema attivo: [nomeDelTema]
Cartella pagine: themes/[nomeDelTema]/www/

Tutte le pagine web create dall'admin si trovano in:
/themes/[nomeDelTema]/www/

Questa cartella (/www/ nella root del progetto) NON è più utilizzata
finché rimane attivo un tema con wwwCustomPath: 1.

Per tornare alla cartella /www/ root, attivare un tema con wwwCustomPath: 0.
```

Questo evita confusione su dove cercare le pagine del sito.

---

### 3.2 themeDescription.json

Metadati del tema visualizzati nell'admin.

```json
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "name": "nomeDelTema",
  "version": "1.0.0",
  "description": "Descrizione del tema",
  "author": "Nome Autore",
  "email": "email@example.com",
  "license": "ISC",
  "tags": ["responsive", "minimal", "bootstrap"],

  // Hook supportati dal tema
  "supportedHooks": [
    "head",
    "header",
    "nav",
    "main",
    "body",
    "aside",
    "footer",
    "script"
  ],

  // Feature del tema
  "features": {
    "theme-resources": true,
    "pluginCustomization": true,
    "responsive": true
  },

  // Metadati templates
  "templates": [
    {
      "file": "page.template.ejs",
      "displayName": "Pagina Standard",
      "description": "Template per pagine generiche",
      "icon": "page-icon.svg"
    },
    {
      "file": "article.template.ejs",
      "displayName": "Articolo Blog",
      "description": "Template per articoli con data e autore",
      "icon": "article-icon.svg"
    }
  ]
}
```

#### Campo templates

Definisce i template disponibili per creare pagine.

Definiti in `themeDescription.json`:
```json
{
  "templates": [
    {
      "file": "article.template.ejs",
      "displayName": "Articolo Blog",
      "description": "Template per articoli con data e autore",
      "icon": "article-icon.svg"
    }
  ]
}
```

**Se presente:** Admin mostra nome e descrizione user-friendly
**Se assente:** Admin mostra solo il nome file del template

---

### 3.3 views/ - Partials Obbligatori

I partials sono componenti riutilizzabili della pagina.

#### views/head.ejs (OBBLIGATORIO)

Sezione `<head>` HTML con hook per i plugin.

```ejs
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Titolo Sito</title>

    <!-- Hook per plugin (es: Bootstrap CSS) -->
    <%- passData.pluginSys.hookPage("head", passData) %>
</head>
```

#### views/header.ejs (OBBLIGATORIO)

Apertura `<body>` e header della pagina.

```ejs
<body>
    <!-- Hook per plugin (es: banner, notifiche) -->
    <%- passData.pluginSys.hookPage("header", passData) %>

    <!-- Includi altri partials opzionali -->
    <%- include('nav.ejs') %>
    <%- include('main.ejs') %>
    <%- include('aside.ejs') %>
```

#### views/footer.ejs (OBBLIGATORIO)

Footer e chiusura HTML.

```ejs
<footer>
    <%- passData.pluginSys.hookPage("footer", passData) %>
</footer>

<!-- Hook per JavaScript -->
<%- passData.pluginSys.hookPage("script", passData) %>
</body>
</html>
```

---

### 3.4 templates/ - Almeno 1 Template

I template sono "stampi" per creare pagine web tramite l'admin.

#### Naming Convention

**Formato:** `nomeTemplate.template.ejs`

**Esempi validi:**
- ✅ `page.template.ejs`
- ✅ `article.template.ejs`
- ✅ `product.template.ejs`

**Esempi NON validi:**
- ❌ `page-template.ejs`
- ❌ `page.ejs`
- ❌ `pageTemplate.ejs`

#### Esempio: page.template.ejs

```ejs
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>

<main class="container">
    <h1>Titolo Pagina</h1>
    <div class="content">
        <!-- Contenuto della pagina -->
    </div>
</main>

<%- include(getThemePartPath('footer', passData)) %>
```

---

## 4. Standard Globale v1.0

Lo **Standard Globale** definisce le regole che un tema deve seguire per garantire compatibilità tra temi diversi.

### 4.1 Regole dello Standard

Un tema che dichiara `"followsGlobalStandard": "1.0"` DEVE:

**1. Includere i partials fondamentali**

Ogni template DEVE includere almeno:
```ejs
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>
<!-- contenuto pagina -->
<%- include(getThemePartPath('footer', passData)) %>
```

**2. NON duplicare tag HTML nei template**

**IMPORTANTE:** I tag HTML (`<html>`, `<head>`, `<body>`) devono essere SOLO nei partials, MAI nei template!

**✅ CORRETTO:**
```ejs
<!-- template: page.template.ejs -->
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>

<h1>Hello world</h1>

<%- include(getThemePartPath('footer', passData)) %>
```

**❌ SBAGLIATO:**
```ejs
<!-- template: page.template.ejs -->
<html>
<head>
  <%- include(getThemePartPath('head', passData)) %>
</head>
<body>
  <header>
    <%- include(getThemePartPath('header', passData)) %>
  </header>

  <h1>Hello world</h1>

  <%- include(getThemePartPath('footer', passData)) %>
</body>
</html>
```

**Perché è sbagliato?**
- `head.ejs` contiene già `<!DOCTYPE html><html><head>...`
- `header.ejs` contiene già `<body>...`
- `footer.ejs` contiene già `...</body></html>`
- Aggiungere altri tag HTML crea duplicati e HTML invalido!

**Regola:** I template devono SOLO includere i partials e aggiungere il contenuto specifico della pagina. La struttura HTML completa è già nei partials.

**3. Questo è tutto!**

Lo standard è volutamente **minimale e flessibile**. Non impone strutture dati specifiche in `passData`, permettendo massima libertà creativa.

### 4.2 Responsabilità dello Sviluppatore

È **responsabilità dello sviluppatore del tema** scegliere:

- ✅ Se rispettare lo standard (`followsGlobalStandard: "1.0"`)
- ✅ Dove salvare le pagine (`wwwCustomPath: 0` o `1`)
- ✅ Documentare eventuali requisiti specifici del tema

### 4.3 Warning in Amministrazione

Quando si attiva un tema con `followsGlobalStandard: false`, l'admin mostra:

```
⚠️ ATTENZIONE: Tema Non-Standard

Questo tema NON rispetta lo standard globale di ital8cms.

Le pagine create saranno salvate in:
  /themes/nomeDelTema/www/

Conseguenze:
• Le pagine NON saranno compatibili con altri temi
• Cambiare tema richiederà migrazione manuale
• È responsabilità del sistemista gestire la migrazione

Continuare?
```

---

## 5. Cartelle del Tema

### 5.1 views/ - Partials Riutilizzabili

**Scopo:** Componenti della pagina condivisi tra template.

**File obbligatori:**
- `head.ejs`
- `header.ejs`
- `footer.ejs`

**File opzionali comuni:**
- `nav.ejs` - Navigazione
- `main.ejs` - Area contenuto principale
- `aside.ejs` - Sidebar
- `breadcrumb.ejs` - Breadcrumb
- Qualsiasi altro partial personalizzato

**Hook disponibili nei partials:**

| Hook | Posizione | Uso Tipico |
|------|-----------|------------|
| `head` | Dentro `<head>` | CSS, meta tag, favicon |
| `header` | Dopo `<body>` | Banner, notifiche globali |
| `nav` | Dentro `<nav>` | Menu items |
| `main` | Dentro `<main>` | Contenuto principale |
| `body` | Dopo `<main>` | Sezioni extra, widget |
| `aside` | Dentro `<aside>` | Sidebar widgets |
| `footer` | Dentro `<footer>` | Copyright, link footer |
| `script` | Prima di `</body>` | JavaScript files |

---

### 5.2 templates/ - Stampi per Pagine

**Scopo:** Template utilizzati dall'admin per creare nuove pagine web.

**Convenzione:** `nomeTemplate.template.ejs`

**Funzionamento:**
1. Admin crea nuova pagina
2. Sceglie un template dalla lista
3. Sistema genera file .ejs basato sul template
4. File salvato in `/www/` o `themes/tema/www/` (dipende da `wwwCustomPath`)

**Icone template (opzionali):**
- Nome: `nomeTemplate-icon.svg`
- Posizione: Stessa cartella `templates/`
- Esempio: `article-icon.svg` per `article.template.ejs`

**Metadati template:**

Se mancano metadati, l'admin mostra solo il nome file.

**Esempi di template:**

```ejs
<!-- article.template.ejs - Articolo blog -->
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>

<article class="blog-post">
    <header>
        <h1 class="post-title">Titolo Articolo</h1>
        <time class="post-date">26 Novembre 2025</time>
        <p class="post-author">Autore</p>
    </header>

    <div class="post-content">
        <!-- Contenuto articolo -->
    </div>
</article>

<%- include(getThemePartPath('footer', passData)) %>
```

```ejs
<!-- product.template.ejs - Scheda prodotto -->
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>

<div class="product-page">
    <div class="product-gallery">
        <!-- Immagini prodotto -->
    </div>

    <div class="product-info">
        <h1 class="product-name">Nome Prodotto</h1>
        <p class="product-price">€ 99,00</p>
        <div class="product-description">
            <!-- Descrizione prodotto -->
        </div>
        <button class="btn-buy">Acquista</button>
    </div>
</div>

<%- include(getThemePartPath('footer', passData)) %>
```

---

### 5.3 theme-resources/ - Asset Statici

**Scopo:** File CSS, JavaScript, immagini del tema.

**Struttura consigliata:**
```
theme-resources/
├── css/
│   ├── theme.css
│   ├── components.css
│   └── responsive.css
├── js/
│   ├── theme.js
│   └── animations.js
└── images/
    ├── logo.png
    ├── background.jpg
    └── icons/
```

**URL di accesso:**

Gli asset sono serviti automaticamente su `/theme-assets/`

```ejs
<!-- Nel template EJS -->
<link rel="stylesheet" href="/theme-assets/css/theme.css">
<script src="/theme-assets/js/theme.js"></script>
<img src="/theme-assets/images/logo.png" alt="Logo">
```

**Metodo helper:**

```ejs
<!-- Usando themeSys.getAssetUrl() -->
<link rel="stylesheet" href="<%= passData.themeSys.getAssetUrl('css/theme.css') %>">
```

---

### 5.4 plugins-endpoints-markup/ - Personalizzazione Endpoint Plugin

**Scopo:** Sovrascrivere template e CSS degli endpoint dei plugin senza modificare il codice del plugin.

**Struttura:**
```
plugins-endpoints-markup/
└── nomePlugin/           # Nome del plugin (es: simpleAccess)
    └── nomeEndpoint/     # Nome dell'endpoint (es: login)
        ├── template.ejs  # Template personalizzato
        └── style.css     # CSS personalizzato
```

**Esempio: Personalizzare login di simpleAccess**

```
plugins-endpoints-markup/
└── simpleAccess/
    └── login/
        ├── template.ejs
        └── style.css
```

**Funzionamento:**

1. Plugin `simpleAccess` carica endpoint `/api/simpleAccess/login`
2. Sistema controlla: "Esiste template custom nel tema?"
3. **Se SÌ:** Usa `themes/tema/plugins-endpoints-markup/simpleAccess/login/template.ejs`
4. **Se NO:** Usa template di default del plugin

**Esempio template custom:**

```ejs
<!-- plugins-endpoints-markup/simpleAccess/login/template.ejs -->
<!DOCTYPE html>
<html lang="it">
<head>
    <title>Login - Tema Personalizzato</title>
    <%- bootstrapCss %>
    <style><%- customCss || '' %></style>
</head>
<body class="login-page">
    <div class="login-container">
        <h1>Benvenuto</h1>
        <form method="POST" action="/api/simpleAccess/login">
            <input type="hidden" name="referrerTo" value="<%- referrerTo %>">
            <input type="text" name="username" placeholder="Username" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Accedi</button>
        </form>
    </div>
    <%- bootstrapJs %>
</body>
</html>
```

**Variabili disponibili (esempio simpleAccess):**
- `bootstrapCss` - Link CSS Bootstrap
- `bootstrapJs` - Script JS Bootstrap
- `apiPrefix` - Variabile apiPrefix client-side
- `referrerTo` - URL di ritorno dopo login
- `customCss` - Contenuto di `style.css` del tema

---

### 5.5 www/ - Pagine Generate (Opzionale)

**Presente solo se:** `wwwCustomPath: 1` in `config-theme.json`

**Scopo:** Contenere le pagine web create dai template, isolate per questo tema.

Se `wwwCustomPath: 0`, le pagine vanno in `/www/` nella root del progetto.

---

## 6. Templates

### 6.1 Scopo dei Template

I template sono **stampi** utilizzati dall'interfaccia di amministrazione per creare pagine web.

**Flusso:**
1. Admin → "Crea nuova pagina"
2. Admin → Sceglie template (es: "Articolo Blog")
3. Sistema → Genera file .ejs basato su `article.template.ejs`
4. File salvato → `/www/nuova-pagina.ejs` (o `themes/tema/www/`)

### 6.2 Requisiti

**Ogni tema DEVE avere almeno 1 template.**

Esempio minimo: `page.template.ejs` per pagine generiche.

### 6.3 Tipologie di Template

**Template generici:**
- `page.template.ejs` - Pagina standard
- `landing-page.template.ejs` - Landing page

**Template contenuti:**
- `article.template.ejs` - Articolo blog/news
- `portfolio-item.template.ejs` - Item portfolio
- `case-study.template.ejs` - Case study

**Template e-commerce:**
- `product.template.ejs` - Scheda prodotto
- `category.template.ejs` - Categoria prodotti

**Template aziendali:**
- `about.template.ejs` - Chi siamo
- `contact.template.ejs` - Contatti
- `team-member.template.ejs` - Membro team

---

## 7. Creazione Passo-Passo

### Step 1: Crea la Struttura Base

```bash
cd themes/
mkdir mioTema
cd mioTema

# Crea cartelle obbligatorie
mkdir views
mkdir templates

# Crea cartelle opzionali
mkdir theme-resources
mkdir theme-resources/css
mkdir theme-resources/js
mkdir theme-resources/images
```

### Step 2: Crea themeConfig.json

```bash
nano themeConfig.json
```

```json
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,
  "followsGlobalStandard": "1.0",
  "wwwCustomPath": 0,
  "pluginDependency": {
    "bootstrap": "^1.0.0"
  },
  "nodeModuleDependency": {
    "ejs": "^3.0.0"
  }
}
```

### Step 3: Crea themeDescription.json

```bash
nano themeDescription.json
```

```json
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "name": "mioTema",
  "version": "1.0.0",
  "description": "Il mio tema personalizzato per ital8cms",
  "author": "Il Tuo Nome",
  "email": "tua@email.com",
  "license": "ISC",
  "tags": ["custom", "responsive"],
  "supportedHooks": [
    "head",
    "header",
    "footer",
    "script"
  ],
  "features": {
    "theme-resources": true,
    "pluginCustomization": false,
    "responsive": true
  },
  "templates": [
    {
      "file": "page.template.ejs",
      "displayName": "Pagina Standard",
      "description": "Template per pagine generiche",
      "icon": "page-icon.svg"
    }
  ]
}
```

### Step 4: Crea Partials Obbligatori

**views/head.ejs:**
```bash
nano views/head.ejs
```

```ejs
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Il Mio Sito</title>

    <!-- CSS del tema -->
    <link rel="stylesheet" href="/theme-assets/css/theme.css">

    <!-- Hook per plugin -->
    <%- passData.pluginSys.hookPage("head", passData) %>
</head>
```

**views/header.ejs:**
```bash
nano views/header.ejs
```

```ejs
<body>
    <!-- Hook per plugin (banner, notifiche) -->
    <%- passData.pluginSys.hookPage("header", passData) %>

    <header>
        <h1>Il Mio Sito</h1>
        <nav>
            <a href="/">Home</a>
            <a href="/about">Chi Siamo</a>
            <a href="/contact">Contatti</a>
        </nav>
    </header>
```

**views/footer.ejs:**
```bash
nano views/footer.ejs
```

```ejs
    <footer>
        <p>&copy; 2025 Il Mio Sito. Tutti i diritti riservati.</p>
        <%- passData.pluginSys.hookPage("footer", passData) %>
    </footer>

    <!-- JavaScript del tema -->
    <script src="/theme-assets/js/theme.js"></script>

    <!-- Hook per plugin JavaScript -->
    <%- passData.pluginSys.hookPage("script", passData) %>
</body>
</html>
```

### Step 5: Crea Almeno un Template

**templates/page.template.ejs:**
```bash
nano templates/page.template.ejs
```

```ejs
<%- include(getThemePartPath('head', passData)) %>
<%- include(getThemePartPath('header', passData)) %>

<main class="page-content">
    <h1>Titolo Pagina</h1>
    <div class="content">
        <!-- Qui va il contenuto della pagina -->
        <p>Contenuto della pagina...</p>
    </div>
</main>

<%- include(getThemePartPath('footer', passData)) %>
```

### Step 6: Crea Asset del Tema (Opzionale)

**theme-resources/css/theme.css:**
```css
/* Stili del tema */
body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
}

header {
    background: #333;
    color: white;
    padding: 1rem;
}

nav a {
    color: white;
    margin: 0 1rem;
    text-decoration: none;
}

.page-content {
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1rem;
}

footer {
    background: #f0f0f0;
    padding: 1rem;
    text-align: center;
    margin-top: 3rem;
}
```

**theme-resources/js/theme.js:**
```javascript
// JavaScript del tema
console.log('Tema caricato!');
```

### Step 7: Crea Screenshot e Icona (Opzionale)

```bash
# Aggiungi le immagini nella root del tema
cp path/to/screenshot.png .
cp path/to/theme-icon.svg .
```

**Dimensioni consigliate:**
- `screenshot.png`: 1200x900px
- `theme-icon.svg`: 64x64px (vettoriale)

### Step 8: Attiva il Tema

Modifica `ital8Config.json` nella root del progetto:

```json
{
  "activeTheme": "mioTema",
  "adminActiveTheme": "mioTema"
}
```

### Step 9: Riavvia il Server

```bash
npm start
```

Il tema sarà caricato e validato all'avvio!

---

## 8. Esempi

### 8.1 Tema Minimalista

Tema con solo i file obbligatori.

```
themes/minimal/
├── themeConfig.json
├── themeDescription.json
├── views/
│   ├── head.ejs
│   ├── header.ejs
│   └── footer.ejs
└── templates/
    └── page.template.ejs
```

### 8.2 Tema Blog Completo

Tema con tutti i componenti.

```
themes/blog/
├── themeConfig.json
├── themeDescription.json
├── screenshot.png
├── theme-icon.svg
├── views/
│   ├── head.ejs
│   ├── header.ejs
│   ├── footer.ejs
│   ├── nav.ejs
│   └── aside.ejs
├── templates/
│   ├── page.template.ejs
│   ├── article.template.ejs
│   ├── article-icon.svg
│   ├── category.template.ejs
│   └── author.template.ejs
├── theme-resources/
│   ├── css/
│   │   ├── theme.css
│   │   └── blog.css
│   ├── js/
│   │   └── theme.js
│   └── images/
│       └── default-post.jpg
└── plugins-endpoints-markup/
    └── simpleAccess/
        └── login/
            ├── template.ejs
            └── style.css
```

### 8.3 Tema E-commerce

Tema con template prodotti.

```
themes/shop/
├── themeConfig.json
├── themeDescription.json
├── views/
│   ├── head.ejs
│   ├── header.ejs
│   ├── footer.ejs
│   └── product-card.ejs
├── templates/
│   ├── product.template.ejs
│   ├── category.template.ejs
│   └── cart.template.ejs
└── theme-resources/
    ├── css/
    │   ├── shop.css
    │   └── product.css
    └── js/
        └── cart.js
```

---

## 9. Checklist

### Creazione Tema Base

- [ ] Creare directory `themes/nomeDelTema/`
- [ ] Creare `themeConfig.json` con configurazione corretta
- [ ] Creare `themeDescription.json` con metadati
- [ ] Creare `views/head.ejs` con hook "head"
- [ ] Creare `views/header.ejs` con hook "header"
- [ ] Creare `views/footer.ejs` con hook "footer" e "script"
- [ ] Creare almeno 1 template in `templates/`
- [ ] Decidere `followsGlobalStandard` (true o false)
- [ ] Decidere `wwwCustomPath` (0 o 1)
- [ ] Testare che i partials includano correttamente gli hook
- [ ] Attivare tema in `ital8Config.json`
- [ ] Riavviare server e verificare caricamento

### Opzionali

- [ ] Aggiungere `screenshot.png` (1200x900)
- [ ] Aggiungere `theme-icon.svg` (64x64)
- [ ] Creare partials opzionali (`nav.ejs`, `aside.ejs`, ecc.)
- [ ] Creare template aggiuntivi (article, product, ecc.)
- [ ] Aggiungere icone per template (`nomeTemplate-icon.svg`)
- [ ] Aggiungere metadati templates in `themeDescription.json`
- [ ] Creare cartella `theme-resources/` con CSS/JS
- [ ] Personalizzare endpoint plugin in `plugins-endpoints-markup/`
- [ ] Creare `README.md` con documentazione tema

### Validazione

- [ ] Tema carica senza errori all'avvio
- [ ] Partials obbligatori sono presenti
- [ ] Template creano pagine correttamente
- [ ] Asset (CSS/JS) vengono serviti su `/theme-assets/`
- [ ] Hook plugin funzionano correttamente
- [ ] Dipendenze plugin/NPM sono soddisfatte
- [ ] Se `followsGlobalStandard: "1.0"`, struttura rispetta lo standard

---

## Link Utili

- **Documentazione Tecnica:** [core/EXPLAIN-themeSys.md](../core/EXPLAIN-themeSys.md)
- **Stato Implementazione:** [CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md](../CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md)
- **Tema Esempio:** `themes/default/` e `themes/baseExampleTheme/`

---

**Fine della guida utente**

**Versione:** 2.0.0
**Data:** 2025-11-26
**Autore:** AI Assistant per ital8cms
