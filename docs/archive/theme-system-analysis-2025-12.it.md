<!-- ital8doc v1-1 · tipo: reference · lang: it · ref -->
> 🗄️ ARCHIVIATO — snapshot storico di dicembre 2025; non riflette lo stato attuale del progetto. Conservato per tracciabilità.

# Analisi Sistema dei Temi - ital8cms

**Data Ultimo Aggiornamento:** 2025-12-06
**Versione CMS:** 0.0.1-alpha.0
**Versione Documento:** 2.1.0

---

## Indice

1. [Panoramica](#1-panoramica)
2. [Collegamenti Documentazione](#2-collegamenti-documentazione)
3. [Funzionalità Implementate](#3-funzionalità-implementate)
4. [Modifiche Recenti (2025-11-26)](#4-modifiche-recenti-2025-11-26)
5. [Funzionalità in Sviluppo](#5-funzionalità-in-sviluppo)
6. [TODO Futuri](#6-todo-futuri)
7. [Changelog](#7-changelog)

---

## 1. Panoramica

Il sistema dei temi di ital8cms è **altamente maturo e funzionale**. La maggior parte delle funzionalità essenziali è già implementata e operativa.

### Stato Generale

| Componente | Stato | Completamento |
|------------|-------|---------------|
| Core themeSys.js | ✅ Completo | 95% |
| Validazione temi | ✅ Completo | 100% |
| Sistema dipendenze | ✅ Completo | 100% |
| Asset management | ✅ Completo | 100% |
| Plugin customization | ✅ Completo | 100% |
| Template system | 🚧 In definizione | 60% |
| Admin UI | ❌ Non implementato | 0% |
| Documentazione | ✅ Completo | 100% |

---

## 2. Collegamenti Documentazione

Il sistema dei temi ha **3 file di documentazione principali**:

### 📘 [themes/EXPLAIN.md](../themes/EXPLAIN.md)
**Target:** Sviluppatori che vogliono creare temi
**Contenuto:** Guida passo-passo alla creazione di temi, struttura, esempi

### 📗 [core/EXPLAIN-themeSys.md](../core/EXPLAIN-themeSys.md)
**Target:** Sviluppatori che vogliono capire il funzionamento interno
**Contenuto:** Architettura, flusso di esecuzione, API reference dettagliata

### 📙 **Questo file** (CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md)
**Target:** Team di sviluppo, tracking progetto
**Contenuto:** Stato implementazione, TODO, changelog

---

## 3. Funzionalità Implementate

### ✅ 3.1 Validazione Automatica Temi

**File:** `core/themeSys.js` linee 179-217

**Funzionalità:**
- Verifica esistenza directory tema
- Controlla presenza `config-theme.json5`
- Verifica directory `views/`
- Controlla partials obbligatori: `head.ejs`, `header.ejs`, `footer.ejs`
- Fallback automatico a tema "default" se validazione fallisce

**Utilizzo:**
```javascript
const validation = themeSys.validateTheme('myTheme');
// { valid: true, error: null } o { valid: false, error: "messaggio errore" }
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.2 Sistema Dipendenze

**File:** `core/themeSys.js` linee 60-121

**Funzionalità:**
- Verifica dipendenze da plugin (con semantic versioning)
- Verifica dipendenze da moduli NPM (con semantic versioning)
- Warning in console se dipendenze non soddisfatte
- Soft fail: tema caricato comunque

**Dichiarazione:**
```json
{
  "pluginDependency": {
    "bootstrap": "^1.0.0"
  },
  "nodeModuleDependency": {
    "ejs": "^3.0.0"
  }
}
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.3 Temi Separati (Pubblico/Admin) - ARCHITETTURA UNIFICATA

**File:** `core/themeSys.js` constructor

**Funzionalità:**
- Tema pubblico: `ital8Conf.activeTheme` (deve avere `isAdminTheme: false`)
- Tema admin: `ital8Conf.adminActiveTheme` (deve avere `isAdminTheme: true`)
- Validazione separata e controllo tipo tema
- **API Unificata:** `getThemePartPath(partName, passData)` per entrambi i contesti
- Selezione automatica del tema basata su `passData.isAdminContext`

**Utilizzo (API Unificata):**
```ejs
<!-- In QUALSIASI pagina (pubblica o admin) - stesso codice -->
<%- include(passData.themeSys.getThemePartPath('head.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('header.ejs', passData)) %>
<%- include(passData.themeSys.getThemePartPath('footer.ejs', passData)) %>

<!-- Il sistema seleziona automaticamente il tema corretto: -->
<!-- - Se passData.isAdminContext === true → usa adminActiveTheme -->
<!-- - Se passData.isAdminContext === false → usa activeTheme -->
```

**Validazione Automatica:**
- Constructor verifica che tema pubblico NON abbia `isAdminTheme: true`
- Constructor verifica che tema admin ABBIA `isAdminTheme: true`
- Fallback automatico se mismatch

**Tema Admin Dedicato:**
- `defaultAdminTheme`: tema specifico per admin con layout dashboard
- Layout: sidebar + main content area
- Partials dedicati: head, header, nav, aside, main, footer

**Test:** ✅ Testato e funzionante con nuova API unificata

---

### ✅ 3.4 Asset Management

**File:** `core/themeSys.js` linee 329-351

**Funzionalità:**
- Cartella `themeResources/` per CSS, JS, immagini
- Static server automatico su `/theme-assets/`
- Metodi helper: `getThemeResourceUrl()`, `getThemeResourcesPath()`, `hasThemeResources()`

**Struttura:**
```
themes/tema/
└── themeResources/
    ├── css/
    ├── js/
    └── images/
```

**Utilizzo:**
```ejs
<link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.5 Plugin Endpoint Customization

**File:** `core/themeSys.js` linee 370-555

**Funzionalità:**
- Sovrascrive template/CSS degli endpoint plugin senza modificare codice plugin
- Cartella `plugins-endpoints-markup/` (ex `plugins/`)
- Metodi: `resolvePluginTemplatePath()`, `getPluginCustomCss()`

**Struttura:**
```
themes/tema/
└── plugins-endpoints-markup/
    └── adminUsers/
        └── login/
            ├── template.ejs
            └── style.css
```

**Utilizzo nei plugin:**
```javascript
const templatePath = themeSys.resolvePluginTemplatePath(
  'adminUsers', 'login', defaultPath
);
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.6 Metadati Temi

**File:** `core/themeSys.js` linee 254-320

**Funzionalità:**
- File `description-theme.json5` per metadati
- Campi: name, version, author, screenshot, tags, supportedHooks, features, templates
- Metodi: `getThemeDescription()`, `getThemeVersion()`, `getThemeFeatures()`

**Struttura:**
```json
{
  "name": "default",
  "version": "1.0.0",
  "description": "Tema predefinito",
  "author": "Italo Paesano",
  "tags": ["default", "minimal"],
  "supportedHooks": ["head", "header", "footer", "script"],
  "features": {
    "theme-resources": true,
    "pluginCustomization": true
  },
  "templates": [...]
}
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.7 Lista Temi Disponibili

**File:** `core/themeSys.js` linee 219-251

**Funzionalità:**
- Scansione directory `themes/`
- Validazione automatica di ogni tema
- Ritorna array con stato di ogni tema

**Utilizzo:**
```javascript
const themes = themeSys.getAvailableThemes();
// [
//   {
//     name: "default",
//     valid: true,
//     error: null,
//     isActive: true,
//     isAdminActive: true,
//     description: {...}
//   },
//   ...
// ]
```

**Test:** ✅ Testato e funzionante

---

### ✅ 3.8 Sistema di Hook Plugin

**File:** Integrato con `pluginSys.hookPage()`

**Funzionalità:**
- Hook disponibili: `head`, `header`, `nav`, `main`, `body`, `aside`, `footer`, `script`
- I plugin iniettano contenuto tramite `getHooksPage()`
- I temi chiamano `pluginSys.hookPage()` nei partials

**Utilizzo nei temi:**
```ejs
<!-- In head.ejs -->
<%- passData.pluginSys.hookPage("head", passData) %>
```

**Utilizzo nei plugin:**
```javascript
getHooksPage(section, passData) {
  if (section === 'head') {
    return '<link rel="stylesheet" href="/my-css.css">';
  }
  return '';
}
```

**Test:** ✅ Testato e funzionante

---

## 4. Modifiche Recenti (2025-11-26)

### 📝 4.1 Rinominate Cartelle

**Modifiche alla struttura:**

| Vecchio Nome | Nuovo Nome | Motivo |
|--------------|------------|--------|
| `assets/` | `theme-resources/` | Più descrittivo |
| `plugins/` | `plugins-endpoints-markup/` | Evita confusione, plurale corretto |

**Stato:** 📋 Definito, non ancora applicato al codice

**TODO:** Aggiornare:
- `core/themeSys.js` per usare nuovi nomi
- Temi esistenti (`default`, `baseExampleTheme`)
- Test di validazione

---

### 📝 4.2 Standard Globale v1.0

**Definito:** Sistema di compatibilità tra temi

**Campi aggiunti a `config-theme.json5`:**
```json
{
  "followsGlobalStandard": "1.0",  // o false

  // Custom www path configuration
  // - wwwCustomPath: 0 = usa /www standard (root progetto)
  //                  1 = usa themes/[nomeDelTema]/www (cartella www nella root del tema)
  // IMPORTANTE: Solo queste due location sono ammesse per motivi di sicurezza
  "wwwCustomPath": 0
}
```

**Regole Standard v1.0:**
1. Includere partials obbligatori (`head`, `header`, `footer`)
2. Struttura HTML valida
3. Seguire esempio temi default/baseExampleTheme

**Stato:** 🚧 In sviluppo (logica `wwwCustomPath` implementata in `plugins/admin/pagesManagment.js`)

**TODO:**
- Aggiungere validazione `followsGlobalStandard` in `validateTheme()`
- ✅ Implementare logica `wwwCustomPath` per salvaggio pagine (completato in pagesManagment.js)
- Aggiungere warning in admin per temi non-standard

---

### 📝 4.3 Sistema Templates

**Definito:** Template come "stampi" per creare pagine web

**Convenzione:** `nomeTemplate.template.ejs`

**Metadati in `description-theme.json5`:**
```json
{
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

**Funzionamento previsto:**
1. Admin crea pagina
2. Sceglie template
3. Sistema genera `.ejs` basato sul template
4. Salva in `/www/` o `themes/tema/www/` (in base a `wwwCustomPath`)

**Stato:** 📋 Definito, non ancora implementato

**TODO:**
- Creare interfaccia admin per creazione pagine
- Implementare generazione pagine da template
- Validare presenza almeno 1 template in tema
- Implementare auto-detection icone template (`nomeTemplate-icon.svg`)

---

### 📝 4.4 Icone Tema

**Definito:** Auto-detection icone/screenshot

**File supportati:**
- `theme-icon.svg` (64x64) - Icona piccola
- `screenshot.png` (1200x900) - Preview grande

**Comportamento:** Se presenti, vengono usati. Altrimenti, ignorati (no errore).

**Stato:** 📋 Definito, non ancora implementato

**TODO:**
- Aggiornare `getAvailableThemes()` per includere info icone
- Creare interfaccia admin per visualizzare icone

---

### 📝 4.5 Documentazione Completa

**Creati/Aggiornati 3 file:**

1. ✅ `themes/EXPLAIN.md` - Guida utente (1017 righe)
2. ✅ `core/EXPLAIN-themeSys.md` - Doc tecnica (1041 righe)
3. ✅ `CLAUDE-DOC/THEME_SYSTEM_ANALYSIS.md` - Questo file

**Contenuto:**
- Spiegazione completa struttura temi
- Standard globale v1.0
- Esempi passo-passo
- API reference completa
- Flussi di esecuzione
- Best practices

**Stato:** ✅ Completato

---

## 5. Funzionalità in Sviluppo

### 🚧 5.1 Validazione Standard Globale

**Priorità:** Alta

**Descrizione:** Implementare controllo `followsGlobalStandard` nella validazione tema

**Requisiti:**
- Leggere campo da `config-theme.json5`
- Se `"1.0"`, verificare che template includano partials obbligatori
- Se `false`, permettere struttura custom

**File da modificare:**
- `core/themeSys.js` → `validateTheme()`

**Effort:** 2-3 ore

---

### 🚧 5.2 Gestione wwwCustomPath

**Priorità:** Alta

**Descrizione:** Implementare logica per salvare pagine in `/www/` o `themes/tema/www/`

**Stato:** ✅ Implementato in `plugins/admin/pagesManagment.js` (funzione `getWwwPath()`)

**Requisiti:**
- ✅ Leggere `wwwCustomPath` da `themeConfig.json5` (implementato)
- ✅ Risoluzione dinamica del path www basata sul tema attivo (implementato)
- ✅ Helper function per path corretto (`getWwwPath()` implementato)
- 📋 **TODO:** Creare `/www/README.txt` automaticamente quando si attiva tema con `wwwCustomPath: 1`

**Contenuto README.txt:**
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

**File creati/modificati:**
- ✅ `plugins/admin/pagesManagment.js` - Modulo gestione pagine con supporto wwwCustomPath
- ✅ `plugins/admin/main.js` - Integrazione routes
- 📋 TODO: Hook all'attivazione tema per creare README.txt

**Effort:** 5-7 ore → 3-4 ore completate, 1-2 ore rimanenti per README.txt automatico

---

### 🚧 5.3 Validazione Templates

**Priorità:** Media

**Descrizione:** Verificare che ogni tema abbia almeno 1 template

**Requisiti:**
- Aggiungere check in `validateTheme()`
- Scansionare cartella `templates/`
- Verificare pattern `*.template.ejs`

**File da modificare:**
- `core/themeSys.js` → `validateTheme()`

**Effort:** 1-2 ore

---

## 6. TODO Futuri

### 📋 6.1 Admin UI - Gestione Temi (Priorità Alta)

**Descrizione:** Interfaccia web per gestire temi dall'admin

**Funzionalità richieste:**
- Lista temi disponibili con screenshot
- Attiva/disattiva tema pubblico/admin
- Preview tema prima dell'attivazione
- Visualizza dipendenze e check stato
- Warning per temi non-standard

**File da creare:**
```
core/admin/webPages/themeManagement/
├── index.ejs              # Lista temi
├── preview.ejs            # Anteprima tema
└── settings.ejs           # Impostazioni tema
```

**Plugin/Route da creare:**
```
/api/admin/themes/list         GET  - Lista temi
/api/admin/themes/activate     POST - Attiva tema
/api/admin/themes/validate     POST - Valida tema
/api/admin/themes/dependencies GET  - Check dipendenze
```

**Effort:** 12-16 ore

---

### 📋 6.2 Admin UI - Creazione Pagine da Template (Priorità Alta)

**Descrizione:** Interfaccia per creare pagine web usando i template

**Funzionalità richieste:**
- Lista template disponibili con icone
- Form per inserire dati pagina (titolo, slug, ecc.)
- Preview del template
- Generazione file `.ejs` in path corretto
- Editor contenuto (HTML o WYSIWYG)

**File da creare:**
```
core/admin/webPages/pageManagement/
├── list.ejs               # Lista pagine esistenti
├── create.ejs             # Creazione nuova pagina
└── edit.ejs               # Modifica pagina esistente
```

**Plugin/Route da creare:**
```
/api/admin/pages/templates     GET  - Lista template disponibili
/api/admin/pages/create        POST - Crea pagina da template
/api/admin/pages/list          GET  - Lista pagine esistenti
/api/admin/pages/edit          POST - Modifica pagina
/api/admin/pages/delete        DELETE - Elimina pagina
```

**Effort:** 16-20 ore

---

### 📋 6.3 Migrazione Cartelle Assets/Plugins (Priorità Media)

**Descrizione:** Aggiornare codice e temi per usare nuovi nomi cartelle

**Tasks:**
1. Aggiornare `core/themeSys.js`:
   - `assets` → `theme-resources`
   - `plugins` → `plugins-endpoints-markup`

2. Rinominare cartelle nei temi esistenti:
   ```bash
   mv themes/default/assets themes/default/theme-resources
   mv themes/default/plugins themes/default/plugins-endpoints-markup
   ```

3. Aggiornare tutti i riferimenti nella documentazione

4. Testare funzionamento completo

**File da modificare:**
- `core/themeSys.js`
- `themes/default/`
- `themes/baseExampleTheme/`
- Tutti i file `.md` documentazione

**Effort:** 2-4 ore

---

### 📋 6.4 Theme Import/Export (Priorità Bassa)

**Descrizione:** Import/export temi come file `.zip`

**Funzionalità:**
- Upload tema `.zip` dall'admin
- Validazione struttura prima dell'import
- Installazione automatica
- Export tema in `.zip`
- Condivisione temi

**Effort:** 10-12 ore

---

### 📋 6.5 Theme Customizer (Priorità Bassa)

**Descrizione:** Editor visuale per personalizzare colori/font del tema

**Funzionalità:**
- Color picker per colori primari/secondari
- Selezione font da Google Fonts
- Toggle per opzioni layout
- Preview live
- Generazione CSS dinamico

**Effort:** 20-24 ore

---

### 📋 6.6 Child Themes (Priorità Bassa)

**Descrizione:** Sistema di ereditarietà tra temi

**Funzionalità:**
- Dichiarare tema parent in `config-theme.json5`
- Override selettivo di file specifici
- Merge assets parent + child

**Esempio:**
```json
{
  "parentTheme": "default",
  "overrides": {
    "views": ["header.ejs", "footer.ejs"],
    "theme-resources": ["css/custom.css"]
  }
}
```

**Effort:** 8-10 ore

---

## 7. Changelog

### [2.1.0] - 2025-12-06

**Changed:**
- ✅ Semplificato sistema `wwwCustomPath`: rimossa variabile `wwwCustomPathValue` (era ridondante)
- ✅ Aggiornati tutti i file `themeConfig.json5` (5 temi) con configurazione semplificata
- ✅ `wwwCustomPath` ora è solo un flag booleano: 0 = /www standard, 1 = themes/[tema]/www
- ✅ Aggiornata documentazione con commenti dettagliati sulla sicurezza

**Implemented:**
- ✅ Implementata gestione dinamica www path in `plugins/admin/pagesManagment.js`
- ✅ Creata funzione `getWwwPath()` che legge configurazione tema attivo
- ✅ Implementata sicurezza path (validazione contro path traversal)

**Fixed:**
- ✅ Risolto problema hardcoded path in pagesManagment.js
- ✅ Sistema ora rispetta configurazione tema per location www

### [2.0.0] - 2025-11-26

**Added:**
- ✅ Documentazione completa (3 file)
- 📋 Definizione Standard Globale v1.0
- 📋 Definizione sistema templates
- 📋 Definizione naming cartelle (`theme-resources`, `plugins-endpoints-markup`)
- 📋 Definizione auto-detection icone tema
- 📋 Definizione README.txt automatico quando `wwwCustomPath: 1`

**Changed:**
- 📋 `description-theme.json5` ora OBBLIGATORIO (era opzionale)
- 📋 Almeno 1 template OBBLIGATORIO per tema
- 📋 Nuovo campo `followsGlobalStandard` in `config-theme.json5`
- 📋 Nuovo campo `wwwCustomPath` in `config-theme.json5`
- 📋 Nuovo campo `templates` in `description-theme.json5`

**Status:**
- ✅ Documentazione: 100% completa
- 🚧 Implementazione nuove feature: 0% (tutto in fase di definizione)
- ✅ Feature esistenti: 95% stabili e funzionanti

---

### [1.0.0] - 2025-11-19

**Added:**
- ✅ Sistema validazione temi
- ✅ Fallback automatico a "default"
- ✅ Sistema dipendenze (plugin + NPM)
- ✅ Asset management
- ✅ Plugin endpoint customization
- ✅ Metadati temi
- ✅ Temi separati pubblico/admin
- ✅ Lista temi disponibili

**Status:**
- Core themeSys: 95% completo
- Documentazione: Base presente ma incompleta

---

## Riepilogo Stato Corrente

### ✅ Funzionante e Stabile

- Validazione temi completa
- Sistema dipendenze
- Asset management
- Plugin customization
- Metadati temi
- Hook system
- Temi separati pub/admin

### 📋 Definito ma Non Implementato

- Standard globale v1.0 con validazione
- Sistema templates per creazione pagine
- Gestione `wwwCustomPath`
- Auto-detection icone
- Nuovi nomi cartelle (`theme-resources`, `plugins-endpoints-markup`)

### ❌ Da Implementare

- Admin UI gestione temi
- Admin UI creazione pagine
- Import/export temi
- Theme customizer visuale
- Child themes

---

**Fine documento**

**Prossimo aggiornamento previsto:** Dopo implementazione feature 5.1, 5.3, 6.1 e 6.2

**Versione:** 2.1.0
**Data:** 2025-12-06
**Autore:** AI Assistant per ital8cms
