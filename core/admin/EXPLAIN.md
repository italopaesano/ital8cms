# Sistema Admin Modulare - Documentazione Tecnica

**Versione:** 1.0.0
**Data:** 2025-12-12
**Autore:** Sistema ital8cms

---

## Panoramica

Il **Sistema Admin Modulare** è un'architettura plugin-agnostica che permette ai plugin di fornire funzionalità admin attraverso un'interfaccia unificata e configurabile. Il sistema supporta sia **sezioni plugin-based** (servite dinamicamente via symlink) che **sezioni hardcoded** (file statici in `core/admin/webPages`).

### Caratteristiche Principali

- ✅ **Design plugin-agnostic:** UI admin disaccoppiata da implementazioni plugin specifiche
- ✅ **Zero duplicazione file:** Serving basato su symlink (single source of truth)
- ✅ **Service discovery:** I plugin forniscono servizi backend (auth, email, storage, ecc.)
- ✅ **Menu dinamico:** Sezioni menu generate da configurazione a runtime
- ✅ **Inizializzazione 2-fasi:** Evita dipendenze circolari tra PluginSys e AdminSystem

---

## Architettura Componenti

### Directory: `/core/admin/`

```
core/admin/
├── adminConfig.json5         # Configurazione centrale sistema admin
├── adminSystem.js            # Coordinatore principale
├── lib/                      # Sottosistemi admin
│   ├── configManager.js      # Carica e valida adminConfig.json5
│   ├── adminServicesManager.js # Service discovery (mappa servizi → plugin)
│   └── symlinkManager.js     # Gestisce symlink sezioni plugin
└── webPages/                 # Template EJS admin
    ├── index.ejs             # Dashboard admin (menu dinamico)
    ├── systemSettings/       # Sezioni hardcoded
    └── usersManagment/       # SYMLINK → plugins/adminUsers/usersManagment/
```

### Responsabilità Componenti

| Componente | File | Responsabilità |
|------------|------|----------------|
| **AdminSystem** | `adminSystem.js` | Coordinatore centrale, inizializzazione, integrazione con pluginSys |
| **ConfigManager** | `lib/configManager.js` | Carica e valida `adminConfig.json5` |
| **AdminServicesManager** | `lib/adminServicesManager.js` | Service discovery, mappa nomi servizi a plugin provider |
| **SymlinkManager** | `lib/symlinkManager.js` | Crea/rimuove symlink per sezioni plugin-based |

---

## Plugin Admin

### Convenzione Naming OBBLIGATORIA

**REGOLA CRITICA:** I plugin admin **DEVONO** iniziare con il prefisso `admin`.

✅ **Nomi validi:**
- `adminUsers` (gestione utenti)
- `adminMailer` (servizio email)
- `adminStorage` (storage file)
- `adminAnalytics` (analytics)

❌ **Nomi NON validi:**
- `usersAdmin` (prefisso sbagliato)
- `simpleAccess` (nessun prefisso admin)
- `userManagement` (nessun prefisso admin)

### Struttura Plugin Admin

```
plugins/adminUsers/
├── main.js                    # Logica plugin (standard)
├── pluginConfig.json5         # Config plugin (CON flag isAdminPlugin)
├── pluginDescription.json5    # Metadata plugin (standard)
├── adminConfig.json5          # OBBLIGATORIO: Metadata sezione admin
├── usersManagment/            # Directory sezione (nome = sectionId)
│   ├── index.ejs              # Pagina principale sezione
│   ├── userView.ejs           # Sotto-pagine
│   ├── userUpsert.ejs
│   └── userDelete.ejs
├── userAccount.json5          # File dati plugin
├── userRole.json5
└── userManagement.js          # Moduli plugin
```

### File Richiesti per Plugin Admin

#### 1. `pluginConfig.json5` - Flag Admin Plugin

```json5
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,

  // OBBLIGATORIO per plugin admin
  "pluginType": {
    "isAdminPlugin": true,           // Identifica come plugin admin
    "providesAuth": true,            // Opzionale: servizi forniti
    "providesUserManagement": true
  },

  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

**Campo obbligatorio:**
- `pluginType.isAdminPlugin: true` - Marca il plugin come admin plugin

#### 2. `adminConfig.json5` - Metadata Sezione Admin

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  // Metadata sezione admin
  "adminSection": {
    "sectionId": "usersManagment",     // DEVE corrispondere al nome directory
    "label": "Gestione Utenti",        // Label menu
    "icon": "👥",                      // Icona (emoji, HTML, classe CSS)
    "description": "Gestione utenti, ruoli e permessi del sistema"
  },

  // Servizi forniti da questo plugin (opzionale)
  "providesServices": ["auth"],

  // Endpoint API esposti (opzionale, per documentazione)
  "apiEndpoints": {
    "userList": "/api/adminUsers/userList",
    "userInfo": "/api/adminUsers/userInfo",
    "userCreate": "/api/adminUsers/usertUser",
    "roleList": "/api/adminUsers/roleList"
  }
}
```

**Campi obbligatori:**
- `adminSection.sectionId` - DEVE corrispondere esattamente al nome directory nella root del plugin
- `adminSection.label` - Testo visualizzato nel menu
- `adminSection.icon` - Icona per il menu

**Vincoli:**
- `sectionId` DEVE essere univoco tra tutti i plugin admin
- La directory `plugins/{pluginName}/{sectionId}/` DEVE esistere

---

## Sistema Symlink

### Principio: Zero Duplicazione

Il sistema usa symlink per servire i file delle sezioni plugin senza duplicarli.

```
Source (plugin):       plugins/adminUsers/usersManagment/
                              ↓
                        (symlink creato)
                              ↓
Destinazione (servito): core/admin/webPages/usersManagment → (symlink)
                              ↓
                       Servito da koa-classic-server
                              ↓
URL:                   /admin/usersManagment/index.ejs
```

### Workflow Creazione Symlink

1. Plugin admin caricato da `pluginSys`
2. `AdminSystem.initialize()` → chiama `onAdminPluginLoaded(plugin)`
3. `SymlinkManager.installPluginSection(plugin)` esegue:
   - Verifica `pluginType.isAdminPlugin === true`
   - Carica `adminConfig.json5`
   - Verifica esistenza directory `plugins/{pluginName}/{sectionId}/`
   - Crea symlink: `core/admin/webPages/{sectionId} → plugins/{pluginName}/{sectionId}/`

### Rimozione Symlink

- **Plugin disinstallato:** `SymlinkManager.uninstallPluginSection(plugin)` rimuove symlink
- **Plugin disabilitato** (`active: 0`): Symlink rimane, ma sezione nascosta dal menu

### Gestione Conflitti

**Symlink già esistente:**
- Stesso target → OK, skip
- Target diverso → ERRORE (conflitto tra plugin)

**Directory non-symlink già esistente:**
- ERRORE (possibile sezione hardcoded con stesso nome)

---

## Configurazione Centrale

### File: `/core/admin/adminConfig.json5`

```json5
{
  "version": "1.0.0",

  // Sezioni interfaccia admin
  "sections": {
    // SEZIONE PLUGIN-BASED (dinamica con symlink)
    "usersManagment": {
      "type": "plugin",
      "plugin": "adminUsers",     // Nome plugin che gestisce questa sezione
      "enabled": true,            // Se false, non appare nel menu
      "required": true            // Se true e plugin manca, errore all'avvio
    },

    // SEZIONE HARDCODED (statica in core/admin/webPages)
    "systemSettings": {
      "type": "hardcoded",
      "enabled": true,
      "label": "Impostazioni Sistema",
      "url": "/admin/systemSettings/index.ejs",
      "icon": "⚙️"
    }
  },

  // Ordinamento menu (dall'alto verso il basso)
  "menuOrder": [
    "usersManagment",
    "systemSettings",
    "pluginsManagment"
  ],

  // Servizi backend
  "services": {
    "auth": {
      "plugin": "adminUsers",
      "required": true
    }
  },

  // Configurazione UI
  "ui": {
    "title": "Gestione Admin",
    "welcomeMessage": "Benvenuto nella gestione di Italo8CMS",
    "theme": "defaultAdminTheme"
  }
}
```

### Tipi di Sezioni

#### Type: `"plugin"`
- Gestita da plugin esterno
- File in `plugins/{pluginName}/{sectionId}/`
- Servita tramite symlink
- Metadata da `plugins/{pluginName}/adminConfig.json5`

**Campi:**
- `type`: `"plugin"`
- `plugin`: Nome del plugin
- `enabled`: Mostra nel menu (true/false)
- `required`: Errore se plugin manca (true/false)

#### Type: `"hardcoded"`
- Gestita direttamente da core
- File in `core/admin/webPages/{sectionId}/`
- Nessun symlink necessario
- Metadata in `adminConfig.json5` centrale

**Campi:**
- `type`: `"hardcoded"`
- `enabled`: Mostra nel menu (true/false)
- `label`: Testo menu
- `url`: URL completo sezione
- `icon`: Icona (emoji/HTML/classe CSS)

---

## Sistema Service Discovery

### Cosa è un Servizio?

Un **servizio** è una funzionalità backend fornita da un plugin che può essere usata da altri componenti.

**Esempi:**
- `auth` - Autenticazione e autorizzazione
- `email` - Invio email
- `storage` - Storage file
- `cache` - Layer di caching
- `analytics` - Tracking analytics

### Configurazione Servizi

In `core/admin/adminConfig.json5`:
```json5
"services": {
  "auth": {
    "plugin": "adminUsers",
    "required": true
  },
  "email": {
    "plugin": "adminMailer",
    "required": false
  }
}
```

### Utilizzo Servizi

```javascript
// Ottieni plugin servizio
const authPlugin = adminSystem.getService('auth');

// Ottieni endpoint per passData (in template EJS)
const endpoints = adminSystem.getEndpointsForPassData();
```

---

## Inizializzazione 2-Fasi

### Problema: Dipendenze Circolari

```
PluginSys → necessita AdminSystem → necessita PluginSys → CIRCOLARE!
```

### Soluzione: Dependency Injection

**In `index.js`:**

```javascript
// Fase 1: Crea PluginSys (carica tutti i plugin)
const pluginSys = new PluginSys();

// Fase 2: Crea ThemeSys
const themeSys = new ThemeSys(ital8Conf, pluginSys);

// Fase 3: Crea AdminSystem (senza pluginSys nel costruttore)
let adminSystem = null;
if (ital8Conf.enableAdmin) {
  const AdminSystem = require('./core/admin/adminSystem');
  adminSystem = new AdminSystem(themeSys);

  // Fase 4: Collega dipendenze (dependency injection)
  adminSystem.setPluginSys(pluginSys);
  pluginSys.setAdminSystem(adminSystem);

  // Fase 5: Inizializza AdminSystem
  adminSystem.initialize();
}
```

### Sequenza Dettagliata

1. Costruttore `PluginSys` → Carica tutti i plugin (inclusi admin plugin)
2. Costruttore `ThemeSys` → Carica temi
3. Costruttore `AdminSystem` → Crea ConfigManager, ServicesManager, SymlinkManager
4. `adminSystem.setPluginSys()` → Collega PluginSys
5. `pluginSys.setAdminSystem()` → Collega AdminSystem
6. `adminSystem.initialize()`:
   - Valida symlink esistenti
   - Per ogni admin plugin:
     - `symlinkManager.installPluginSection()` (crea symlink)
     - `servicesManager.registerPlugin()` (registra servizi)
   - `servicesManager.loadServices()` (carica servizi da config)

---

## Menu Dinamico

### Generazione Menu in EJS

**In `core/admin/webPages/index.ejs`:**

```ejs
<%
  // Ottieni config UI admin e sezioni menu
  const adminUI = passData.adminSystem.getUI();
  const menuSections = passData.adminSystem.getMenuSections();
%>

<!-- Header -->
<a href="/<%= passData.adminPrefix %>/">
    <%= adminUI.title %>
</a>

<!-- Sezioni dinamiche -->
<% menuSections.forEach(section => { %>
    <a href="<%= section.url %>">
        <%= section.icon %> <%= section.label %>
        <% if (section.type === 'plugin') { %>
            <span class="badge">Plugin: <%= section.plugin %></span>
        <% } else { %>
            <span class="badge">Integrato</span>
        <% } %>
    </a>
<% }); %>
```

### Output `getMenuSections()`

```javascript
[
  {
    id: "usersManagment",
    label: "Gestione Utenti",
    icon: "👥",
    url: "/admin/usersManagment/index.ejs",
    type: "plugin",
    plugin: "adminUsers"
  },
  {
    id: "systemSettings",
    label: "Impostazioni Sistema",
    icon: "⚙️",
    url: "/admin/systemSettings/index.ejs",
    type: "hardcoded"
  }
]
```

### Logica Filtro

- Salta se `enabled: false`
- Salta se type plugin e plugin non attivo
- Ritorna solo sezioni che devono apparire nel menu

---

## Come Creare un Plugin Admin

### Checklist Step-by-Step

✅ **Step 1: Crea struttura plugin**
```bash
mkdir -p plugins/admin{Feature}/{sectionId}
cd plugins/admin{Feature}
```

✅ **Step 2: Crea file obbligatori**

**`main.js`:**
```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    console.log('Admin plugin loaded!');
  },

  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'get',
        path: '/myEndpoint',
        func: async (ctx) => {
          ctx.body = { message: 'Hello from admin plugin!' };
        }
      }
    ];
  }
};
```

**`pluginConfig.json5`:**
```json5
{
  "active": 1,
  "isInstalled": 0,
  "weight": 100,
  "pluginType": {
    "isAdminPlugin": true
  },
  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

**`pluginDescription.json5`:**
```json5
{
  "name": "admin{Feature}",
  "version": "1.0.0",
  "description": "Descrizione plugin admin",
  "author": "Tuo Nome",
  "email": "tua@email.com",
  "license": "MIT"
}
```

**`adminConfig.json5`:**
```json5
{
  "adminSection": {
    "sectionId": "mySection",
    "label": "La Mia Sezione",
    "icon": "🎯",
    "description": "Descrizione della mia sezione admin"
  },
  "providesServices": []
}
```

**`{sectionId}/index.ejs`:**
```ejs
<%- await include(passData.themeSys.getThemePartPath('head.ejs', passData)) %>
<%- await include(passData.themeSys.getThemePartPath('header.ejs', passData)) %>

<main>
  <h1>La Mia Sezione Admin</h1>
  <p>Contenuto della sezione...</p>
</main>

<%- await include(passData.themeSys.getThemePartPath('footer.ejs', passData)) %>
```

✅ **Step 3: Registra sezione in config centrale**

Modifica `/core/admin/adminConfig.json5`:
```json5
"sections": {
  "mySection": {
    "type": "plugin",
    "plugin": "admin{Feature}",
    "enabled": true,
    "required": false
  }
},
"menuOrder": ["usersManagment", "mySection", "systemSettings"]
```

✅ **Step 4: Riavvia server**

```bash
npm start
```

Il sistema automaticamente:
- ✅ Crea symlink per la sezione
- ✅ Registra sezione nel menu
- ✅ Rende accessibile la sezione a `/admin/mySection/index.ejs`

---

## API AdminSystem

Disponibile in `passData.adminSystem`:

```javascript
// Configurazione UI
adminSystem.getUI()
// Ritorna: { title, welcomeMessage, theme }

// Sezioni menu (filtrate per enabled e active)
adminSystem.getMenuSections()
// Ritorna: [{ id, label, icon, url, type, plugin }]

// Ottieni servizio per nome
adminSystem.getService('auth')
// Ritorna: plugin object che fornisce il servizio

// Ottieni endpoint API per template EJS
adminSystem.getEndpointsForPassData()
// Ritorna: { serviceName: { endpoint1, endpoint2, ... } }
```

---

## Troubleshooting

### Errore: "path argument must be of type string. Received undefined"

**Causa:** Plugin object non ha `pathPluginFolder`

**Soluzione:** Verifica che `pluginSys.js` aggiunga metadata al plugin:
```javascript
plugin.pluginName = pluginName;
plugin.pathPluginFolder = pathPluginFolder;
```

### Errore: "ENOENT: no such file or directory, symlink"

**Causa:** Path symlink sbagliato

**Soluzione:** Verifica in `symlinkManager.js`:
```javascript
this.adminWebPagesPath = path.join(__dirname, '../webPages');
```

### Sezione non appare nel menu

**Cause possibili:**
1. `enabled: false` in `adminConfig.json5` → Imposta `enabled: true`
2. Plugin non attivo (`active: 0`) → Attiva plugin
3. Section ID non in `menuOrder` → Aggiungi a `menuOrder`
4. Plugin non ha `isAdminPlugin: true` → Aggiungi flag

### Symlink non creato

**Verifica:**
1. Directory `plugins/{pluginName}/{sectionId}/` esiste
2. `adminConfig.json5` ha `sectionId` corretto
3. `pluginType.isAdminPlugin: true` in `pluginConfig.json5`
4. Nessun errore durante `adminSystem.initialize()`

### Conflitto symlink

**Errore:** "Section symlink already exists, pointing to different location"

**Causa:** Due plugin tentano di usare stesso `sectionId`

**Soluzione:** Cambia `sectionId` in uno dei due plugin

---

## Note Implementative

### Tema Admin

- Il tema usato per il rendering dei file `.ejs` di amministrazione è sempre quello specificato in `ital8Config.json5` → `adminActiveTheme`
- Il template engine è sempre `.ejs`
- Il tema admin DEVE avere `isAdminTheme: true` in `themeConfig.json5`

### Path Symlink

```javascript
// Corretto (da core/admin/lib/symlinkManager.js)
this.adminWebPagesPath = path.join(__dirname, '../webPages');
// Risulta in: /path/to/core/admin/webPages

// Sbagliato
this.adminWebPagesPath = path.join(__dirname, '../../webPages');
// Risulterebbe in: /path/to/core/webPages (path errato!)
```

### Serving File Admin

I file admin sono serviti da `koa-classic-server` in `index.js`:

```javascript
koaClassicServer(app, {
  staticPath: './core/admin/webPages',
  defaultExt: '.ejs',
  urlPrefix: '/admin'
});
```

---

## Riferimenti Rapidi

### File Chiave

- `/core/admin/adminConfig.json5` - Config centrale
- `/core/admin/adminSystem.js` - Coordinatore
- `/core/admin/lib/configManager.js` - Loader config
- `/core/admin/lib/adminServicesManager.js` - Service discovery
- `/core/admin/lib/symlinkManager.js` - Gestore symlink
- `/plugins/{pluginName}/adminConfig.json5` - Metadata sezione plugin

### Convenzioni Naming

- Plugin admin: `admin{Feature}` (es. `adminUsers`, `adminMailer`)
- Section ID: camelCase (es. `usersManagment`, `systemSettings`)
- File config: `{noun}{descriptor}.json5` (es. `adminConfig.json5`, `pluginConfig.json5`)

### URL Pattern

```
Plugin section:     /admin/{sectionId}/index.ejs
Hardcoded section:  /admin/{sectionId}/index.ejs
API endpoint:       /api/{pluginName}/{endpoint}
```

---

**Fine Documentazione**

Per ulteriori dettagli, consulta `/CLAUDE.md` (documentazione completa) o il codice sorgente in `/core/admin/`.
