# Analisi Completa del Sistema Plugin - ital8cms

**Data Analisi:** 2025-11-19
**Versione CMS:** 0.0.1-alpha.0
**Analizzato da:** Claude AI Assistant

---

## Indice

1. [Executive Summary](#executive-summary)
2. [Architettura del Sistema Plugin](#architettura-del-sistema-plugin)
3. [Flusso di Caricamento Dettagliato](#flusso-di-caricamento-dettagliato)
4. [Struttura di un Plugin](#struttura-di-un-plugin)
5. [Meccanismo di Gestione delle Dipendenze](#meccanismo-di-gestione-delle-dipendenze)
6. [Sistema di Condivisione degli Oggetti](#sistema-di-condivisione-degli-oggetti)
7. [Sistema di Routing](#sistema-di-routing)
8. [Sistema di Hook delle Pagine](#sistema-di-hook-delle-pagine)
9. [Sistema di Middleware](#sistema-di-middleware)
10. [Bug e Problemi Identificati](#bug-e-problemi-identificati)
11. [Funzionalità Mancanti](#funzionalità-mancanti)
12. [Raccomandazioni per Miglioramenti](#raccomandazioni-per-miglioramenti)
13. [Roadmap Proposta](#roadmap-proposta)

---

## Executive Summary

Il sistema plugin di **ital8cms** è un'architettura modulare sofisticata che permette l'estensione dinamica del CMS attraverso componenti auto-contenuti. Il sistema implementa:

- ✅ **Dependency Resolution**: Gestione automatica delle dipendenze tra plugin
- ✅ **Semantic Versioning**: Controllo compatibilità versioni con semver
- ✅ **Object Sharing**: Condivisione di oggetti tra plugin e template engine
- ✅ **Dynamic Routing**: Sistema di routing dinamico per ogni plugin
- ✅ **Page Hooks**: Iniezione di codice in punti specifici delle pagine
- ✅ **Middleware Support**: Registrazione di middleware personalizzati
- ✅ **Lifecycle Management**: Hook per installazione, caricamento, aggiornamento

### Criticità Principali Identificate

1. **Bug critico** nella funzione di controllo dipendenze (core/pluginSys.js:153-163)
2. **Mancanza** di controllo dipendenze circolari → rischio loop infiniti
3. **Assenza** di gestione errori durante il caricamento dei plugin
4. **Incompletezza** del sistema di upgrade dei plugin
5. **Documentazione** API non standardizzata

---

## Architettura del Sistema Plugin

### Componenti Principali

Il sistema plugin è implementato nella classe `pluginSys` in `/core/pluginSys.js`:

```
pluginSys (Class)
│
├── #activePlugins (Map)           # Plugin caricati e attivi
├── #pluginsToActive (Map)         # Plugin in attesa di dipendenze
├── #routes (Map)                  # Routing table per plugin
├── #hooksPage (Map)               # Hook per iniezione contenuti
├── #pluginsMiddlewares (Array)    # Middleware da caricare
└── #objectToShareToWebPages (Obj) # Oggetti condivisi con EJS
```

### Pattern Architetturale

Il sistema utilizza un pattern **Plugin-Based Architecture** con:

- **Inversion of Control (IoC)**: Il core chiama i plugin tramite interfaccia standard
- **Dependency Injection**: Gli oggetti condivisi sono iniettati tra plugin
- **Event-Driven Hooks**: I plugin si registrano a eventi specifici del ciclo di vita

---

## Flusso di Caricamento Dettagliato

### Sequenza di Inizializzazione

```
1. Costruttore pluginSys
   │
   ├─> 2. Scansione cartella /plugins
   │      └─> fs.readdirSync() filtra solo directory
   │
   ├─> 3. Per ogni plugin trovato:
   │      ├─> Legge pluginConfig.json5
   │      ├─> Legge pluginDescription.json5
   │      └─> Verifica active === 1
   │
   ├─> 4. Costruisce pluginsVersionMap
   │      └─> Map(pluginName => version)
   │
   ├─> 5. Divide plugin in due gruppi:
   │      ├─> Senza dipendenze → #activePlugins (caricati subito)
   │      └─> Con dipendenze → #pluginsToActive (in attesa)
   │
   ├─> 6. Carica plugin senza dipendenze
   │      └─> caricatePlugin(pluginName)
   │
   ├─> 7. Valida dipendenze rimanenti
   │      ├─> Controlla esistenza plugin
   │      ├─> Controlla compatibilità versione (semver)
   │      └─> ⚠️ MANCA: controllo dipendenze circolari
   │
   ├─> 8. Loop caricamento con dipendenze
   │      └─> while(#pluginsToActive.size != 0)
   │         ├─> Per ogni plugin in attesa
   │         ├─> Se dipendenze soddisfatte
   │         │   ├─> caricatePlugin()
   │         │   └─> Rimuovi da #pluginsToActive
   │         └─> Ripeti fino a lista vuota
   │
   └─> 9. Sistema pronto
       └─> Tutti i plugin attivi con dipendenze risolte
```

### Dettaglio della Funzione `caricatePlugin(pluginName)`

```javascript
caricatePlugin(pluginName) {

  // 1. Caricamento Configurazione e Codice
  const pluginConfig = require(`../plugins/${pluginName}/pluginConfig.json5`)
  const plugin = require(`../plugins/${pluginName}/main.js`)

  // 2. Registrazione Immediata
  this.#activePlugins.set(pluginName, plugin)

  // 3. ⭐ CONDIVISIONE OGGETTI (Fase Critica)
  // Ogni plugin esistente condivide con il nuovo plugin
  this.#activePlugins.forEach((plugin0, nomePlugin0) => {
    if (plugin0.getObjectToShareToOthersPlugin) {
      this.#activePlugins.forEach((plugin1, nomePlugin1) => {
        if (nomePlugin0 !== nomePlugin1) {
          if (plugin1.setSharedObject) {
            plugin1.setSharedObject(
              nomePlugin0,
              plugin0.getObjectToShareToOthersPlugin(nomePlugin1)
            )
          }
        }
      })
    }
  })

  // 4. Installazione (se necessario)
  if (pluginConfig.isInstalled == 0) {
    plugin.installPlugin()
    pluginConfig.isInstalled = 1
    // Aggiorna pluginConfig.json5 su filesystem
    fs.promises.writeFile(
      `${__dirname}/../plugins/${pluginName}/pluginConfig.json5`,
      JSON.stringify(pluginConfig, null, 2)
    )
  }

  // 5. Registrazione Route
  if (plugin.getRouteArray) {
    this.#routes.set(pluginName, plugin.getRouteArray())
  }

  // 6. Registrazione Hook Pagine
  if (plugin.getHooksPage) {
    this.#hooksPage.set(pluginName, plugin.getHooksPage())
  }

  // 7. Oggetti per Template Engine
  if (plugin.getObjectToShareToWebPages) {
    this.#objectToShareToWebPages[pluginName] =
      plugin.getObjectToShareToWebPages()
  }

  // 8. Registrazione Middleware
  if (plugin.getMiddlewareToAdd) {
    this.#pluginsMiddlewares.push(plugin.getMiddlewareToAdd)
  }

  // 9. Hook di Caricamento
  plugin.loadPlugin()
}
```

---

## Struttura di un Plugin

### File Obbligatori

Ogni plugin **DEVE** avere questa struttura:

```
plugins/
└── nomePlugin/
    ├── main.js                   # ⚠️ OBBLIGATORIO - Logica plugin
    ├── pluginConfig.json5        # ⚠️ OBBLIGATORIO - Configurazione
    └── pluginDescription.json5   # ⚠️ OBBLIGATORIO - Metadati
```

### main.js - Interfaccia Standard

```javascript
module.exports = {

  // === LIFECYCLE HOOKS ===

  loadPlugin: function() {
    // Chiamato ogni volta che il CMS si avvia
    // Usato per: inizializzazione, apertura connessioni DB, setup
  },

  installPlugin: function() {
    // Chiamato UNA VOLTA al primo caricamento
    // Usato per: creazione tabelle DB, file iniziali, configurazione
  },

  uninstallPlugin: function() {
    // Chiamato quando il plugin viene disinstallato
    // Usato per: cleanup, rimozione dati, chiusura connessioni
  },

  upgradePlugin: function(oldVersion, newVersion) {
    // ⚠️ NON IMPLEMENTATO NEL CORE
    // Dovrebbe essere chiamato quando version cambia
    // Usato per: migrazioni DB, aggiornamenti schema
  },

  // === SHARING SYSTEM ===

  getObjectToShareToOthersPlugin: function(forPlugin) {
    // Ritorna oggetti/API da condividere con altri plugin
    // Parametro 'forPlugin' permette personalizzazione per destinatario
    return {
      myApi: { /* ... */ }
    }
  },

  setSharedObject: function(fromPlugin, sharedObject) {
    // Riceve oggetti condivisi da altri plugin
    // fromPlugin: nome del plugin che sta condividendo
    // sharedObject: l'oggetto condiviso
  },

  getObjectToShareToWebPages: function() {
    // Ritorna oggetti disponibili in EJS templates
    // Accessibili tramite: passData.plugin.nomePlugin.*
    return {
      data: { /* ... */ }
    }
  },

  // === ROUTING ===

  getRouteArray: function() {
    // Ritorna array di route definition
    return [
      {
        method: 'GET',  // 'GET', 'POST', 'PUT', 'DEL', 'ALL'
        path: '/myPath',  // Diventa: /api/nomePlugin/myPath
        handler: async (ctx) => {
          ctx.body = 'Response'
        }
      }
    ]
  },

  // === PAGE HOOKS ===

  getHooksPage: function() {
    // Ritorna Map di hook per iniettare HTML nelle pagine
    const hooks = new Map()
    hooks.set('head', (passData) => '<link rel="stylesheet" href="...">')
    hooks.set('script', (passData) => '<script src="..."></script>')
    return hooks
  },

  // === MIDDLEWARE ===

  getMiddlewareToAdd: function() {
    // Ritorna array di middleware Koa
    return [
      {
        func: async (ctx, next) => {
          // Middleware logic
          await next()
        }
      }
    ]
  }
}
```

### pluginConfig.json5

```json
{
  "active": 1,
  "isInstalled": 0,
  "weight": 100,
  "dependency": {
    "otherPlugin": "^1.0.0",
    "anotherPlugin": ">=2.0.0 <3.0.0"
  },
  "nodeModuleDependency": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  },
  "custom": {
    "mySetting": "value",
    "enableFeature": true
  }
}
```

#### Spiegazione Campi:

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `active` | 0/1 | Plugin attivo (1) o disabilitato (0) |
| `isInstalled` | 0/1 | Flag installazione (auto-gestito) |
| `weight` | number | Priorità caricamento (0=prima, 100=dopo) |
| `dependency` | object | Dipendenze da altri plugin (semver) |
| `nodeModuleDependency` | object | ⚠️ NON VERIFICATO - Dipendenze npm |
| `custom` | object | Configurazioni custom del plugin |

### pluginDescription.json5

```json
{
  "name": "myPlugin",
  "version": "1.2.3",
  "description": "Descrizione del plugin",
  "author": "Nome Autore",
  "email": "email@example.com",
  "license": "MIT"
}
```

---

## Meccanismo di Gestione delle Dipendenze

### Sistema di Risoluzione

Il sistema utilizza **semantic versioning** (semver) per controllare la compatibilità:

```javascript
// Esempio: plugin A richiede plugin B versione "^1.2.0"
// Compatibili: 1.2.0, 1.2.1, 1.3.0, 1.999.999
// NON compatibili: 2.0.0, 1.1.0, 0.9.0

const versionRequest = "^1.2.0"
const installedVersion = "1.5.0"

if (semver.satisfies(installedVersion, versionRequest)) {
  // ✅ Compatibile
}
```

### Algoritmo di Ordinamento

```
1. Ordine per Weight (crescente)
   ├─> weight: 0 caricato per primo
   ├─> weight: 50 caricato secondo
   └─> weight: 100 caricato terzo

2. Ordine per Dipendenze
   ├─> Se A dipende da B, allora B viene caricato prima
   └─> Risoluzione ricorsiva

3. Ordine Alfabetico (fallback)
   └─> Se weight uguale e nessuna dipendenza
```

### Esempio Pratico

```json
// Plugin: dbApi
{
  "weight": 0,
  "dependency": {}
}

// Plugin: simpleAccess
{
  "weight": 10,
  "dependency": {
    "dbApi": "^1.0.0",
    "bootstrap": "^1.0.0"
  }
}

// Plugin: admin
{
  "weight": 20,
  "dependency": {
    "simpleAccess": "^1.0.0"
  }
}
```

**Ordine di caricamento:**
1. `dbApi` (weight: 0, no dependencies)
2. `bootstrap` (weight: 0, no dependencies)
3. `simpleAccess` (weight: 10, dipende da dbApi e bootstrap)
4. `admin` (weight: 20, dipende da simpleAccess)

---

## Sistema di Condivisione degli Oggetti

### Concetto Fondamentale

I plugin possono **condividere oggetti** tra loro in modo bidirezionale:

```
Plugin A                    Plugin B
   │                           │
   ├──> getObjectToShare() ───>│
   │                           │
   │<─── setSharedObject() <───┤
```

### Esempio Reale: dbApi

Il plugin `dbApi` condivide database SQLite con altri plugin:

```javascript
// dbApi/main.js

function getObjectToShareToOthersPlugin(pluginName) {
  // Crea un database DEDICATO per ogni plugin
  return {
    db: new betterSqlite3(
      `${__dirname}/dbFile/pluginsDb/${pluginName}.db`,
      { verbose: console.log }
    )
  }
}
```

```javascript
// simpleAccess/main.js

let db  // Variabile locale per il database

function setSharedObject(fromPlugin, sharedObject) {
  if (fromPlugin === 'dbApi') {
    this.db = sharedObject.db  // Riceve il database dedicato
  }
}

function loadPlugin() {
  // Ora può usare this.db
  const users = this.db.prepare('SELECT * FROM users').all()
}
```

### Flusso Completo di Condivisione

```
1. dbApi viene caricato per primo (weight: 0)
   └─> Apre mainDb, webDb, testDb

2. simpleAccess viene caricato (dipende da dbApi)
   │
   ├─> Sistema chiama: dbApi.getObjectToShareToOthersPlugin('simpleAccess')
   │   └─> dbApi crea database: pluginsDb/simpleAccess.db
   │   └─> Ritorna: { db: SQLiteInstance }
   │
   └─> Sistema chiama: simpleAccess.setSharedObject('dbApi', { db: ... })
       └─> simpleAccess salva riferimento al database

3. simpleAccess.loadPlugin() viene chiamato
   └─> Può ora usare this.db per query
```

### Condivisione con Template Engine

I plugin possono anche condividere oggetti con i template EJS:

```javascript
// Plugin: dbApi
function getObjectToShareToWebPages() {
  return {
    db: webDb  // Database specifico per il web
  }
}
```

```ejs
<!-- In qualsiasi template EJS -->
<%
  const db = passData.plugin.dbApi.db
  const articles = db.prepare('SELECT * FROM articles').all()
%>

<% articles.forEach(article => { %>
  <h2><%= article.title %></h2>
<% }) %>
```

---

## Sistema di Routing

### Struttura delle Route

Ogni plugin può definire le proprie route che vengono automaticamente prefissate:

```
Pattern Completo:
/${apiPrefix}/${pluginName}/${pluginPath}

Esempio:
/api/simpleAccess/login
 │    │             │
 │    │             └─> path definito nel plugin
 │    └──────────────> nome del plugin
 └───────────────────> apiPrefix da ital8Config.json5
```

### Definizione Route in un Plugin

```javascript
// plugins/myPlugin/main.js

function getRouteArray() {
  return [
    {
      method: 'GET',
      path: '/items',  // Diventa: /api/myPlugin/items
      handler: async (ctx) => {
        ctx.body = { items: [] }
      }
    },
    {
      method: 'POST',
      path: '/items',  // Diventa: /api/myPlugin/items
      handler: async (ctx) => {
        const data = ctx.request.body
        // Salva item
        ctx.body = { success: true }
      }
    },
    {
      method: 'GET',
      path: '/items/:id',  // Diventa: /api/myPlugin/items/:id
      handler: async (ctx) => {
        const id = ctx.params.id
        ctx.body = { id, name: 'Item' }
      }
    }
  ]
}
```

### Caricamento Route nel Router

```javascript
// core/pluginSys.js

loadRoutes(router, prefix = "") {
  for (const [pluginName, routeArray] of this.#routes) {
    for (const route of routeArray) {
      const fullPath = `${prefix}/${pluginName}${route.path}`

      if (route.method == 'GET') {
        router.get(fullPath, route.handler)
      } else if (route.method == 'POST') {
        router.post(fullPath, route.handler)
      } else if (route.method == 'PUT') {
        router.put(fullPath, route.handler)
      } else if (route.method == 'DEL') {
        router.del(fullPath, route.handler)
      } else if (route.method == 'ALL') {
        router.all(fullPath, route.handler)
      }
    }
  }
}
```

### Metodi HTTP Supportati

| Metodo | Descrizione | Esempio Uso |
|--------|-------------|-------------|
| `GET` | Recupera risorse | Lista utenti, dettaglio articolo |
| `POST` | Crea nuove risorse | Crea utente, login |
| `PUT` | Aggiorna risorse | Modifica utente |
| `DEL` | Elimina risorse | Cancella utente |
| `ALL` | Match tutti i metodi | Middleware catch-all |

---

## Sistema di Hook delle Pagine

### Concetto

I plugin possono **iniettare HTML/JavaScript/CSS** in punti specifici delle pagine:

```html
<!DOCTYPE html>
<html>
<head>
  <!-- HOOK: head -->
  <%- await pluginSys.hookPage('head', passData) %>
</head>
<body>
  <header>
    <!-- HOOK: header -->
    <%- await pluginSys.hookPage('header', passData) %>
  </header>

  <main>
    <!-- HOOK: body -->
    <%- await pluginSys.hookPage('body', passData) %>
  </main>

  <footer>
    <!-- HOOK: footer -->
    <%- await pluginSys.hookPage('footer', passData) %>
  </footer>

  <!-- HOOK: script -->
  <%- await pluginSys.hookPage('script', passData) %>
</body>
</html>
```

### Definizione Hook in un Plugin

```javascript
// plugins/bootstrap/main.js

function getHooksPage() {
  const hooks = new Map()

  hooks.set('head', (passData) => {
    return `
      <link
        href="/api/bootstrap/css/bootstrap.min.css"
        rel="stylesheet"
      >
    `
  })

  hooks.set('script', (passData) => {
    return `
      <script src="/api/bootstrap/js/bootstrap.min.js"></script>
    `
  })

  return hooks
}
```

### Output Generato

```html
<!-- START bootstrap part -->
<link href="/api/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<!-- END bootstrap part -->

<!-- START myPlugin part -->
<link href="/custom-styles.css" rel="stylesheet">
<!-- END myPlugin part -->
```

### Hook Disponibili (Standard)

| Hook | Posizione | Uso Tipico |
|------|-----------|------------|
| `head` | Dentro `<head>` | CSS, meta tag, font |
| `header` | Dentro `<header>` | Navigazione, logo |
| `body` | Dentro `<main>` | Contenuto principale |
| `footer` | Dentro `<footer>` | Copyright, link |
| `script` | Fine `<body>` | JavaScript, librerie |

### Implementazione Core

```javascript
// core/pluginSys.js

hookPage(hook, passData) {
  let stringToReturn = ""

  for (const [nomePlugin, fnMap] of this.#hooksPage) {
    if (fnMap.has(hook)) {
      stringToReturn += `\n<!-- START ${nomePlugin} part -->\n`

      const fnToExec = fnMap.get(hook)
      stringToReturn += fnToExec(passData)

      stringToReturn += `\n<!-- END ${nomePlugin} part -->\n`
    }
  }

  return stringToReturn
}
```

---

## Sistema di Middleware

### Concetto

I plugin possono registrare **middleware Koa** che vengono eseguiti per ogni richiesta:

```
Request → Middleware 1 → Middleware 2 → Route Handler → Response
              ↓              ↓
          (Plugin A)    (Plugin B)
```

### Definizione Middleware in un Plugin

```javascript
// plugins/myPlugin/main.js

function getMiddlewareToAdd() {
  return [
    {
      func: async (ctx, next) => {
        // Pre-processing
        console.log(`[${new Date()}] ${ctx.method} ${ctx.url}`)

        // Passa al middleware successivo
        await next()

        // Post-processing
        console.log(`Response status: ${ctx.status}`)
      }
    },
    {
      func: async (ctx, next) => {
        // Esempio: Aggiungi header custom
        ctx.set('X-Powered-By', 'ital8cms')
        await next()
      }
    }
  ]
}
```

### Caricamento Middleware

```javascript
// index.js (main application)

const middlewares = pluginSys.getMiddlewaresToLoad()

middlewares.forEach(middlewareGetter => {
  const middlewareArray = middlewareGetter()
  middlewareArray.forEach(middleware => {
    app.use(middleware.func)
  })
})
```

### Esempio Reale: simpleAccess

Il plugin `simpleAccess` usa middleware per proteggere le route:

```javascript
function getMiddlewareToAdd() {
  return [
    {
      func: async (ctx, next) => {
        const protectedPrefixes = ['/reserved', '/private', '/lib']

        const isProtected = protectedPrefixes.some(
          prefix => ctx.path.startsWith(prefix)
        )

        if (isProtected && !ctx.session.authenticated) {
          ctx.status = 401
          ctx.body = 'Unauthorized'
          return
        }

        await next()
      }
    }
  ]
}
```

---

## Bug e Problemi Identificati

### 🔴 CRITICO - Bug nella Funzione `isPluginDependenciesSatisfied`

**Location:** `core/pluginSys.js:153-163`

**Problema:**

```javascript
function isPluginDependenciesSatisfied(pluginsListMap, dependencyMap) {

  dependencyMap.forEach((version, pluginName) => {
    if (!pluginsListMap.has(pluginName)) {
      return false  // ❌ BUG: Questo return non esce dalla funzione!
    }
  })

  return true  // ⚠️ Ritorna sempre true anche se dipendenze mancanti
}
```

**Spiegazione:**
Il `return false` dentro `forEach` **non esce dalla funzione esterna**, ma solo dalla callback del forEach. La funzione ritorna **sempre `true`** anche quando le dipendenze non sono soddisfatte.

**Conseguenza:**
Il loop `while(this.#pluginsToActive.size != 0)` può diventare **infinito** se ci sono dipendenze non soddisfatte.

**Fix Proposto:**

```javascript
function isPluginDependenciesSatisfied(pluginsListMap, dependencyMap) {
  for (const [pluginName, version] of dependencyMap) {
    if (!pluginsListMap.has(pluginName)) {
      return false  // ✅ Questo funziona correttamente
    }
  }
  return true
}
```

---

### 🟠 ALTO - Assenza Controllo Dipendenze Circolari

**Problema:**
Non c'è controllo per dipendenze circolari:

```
Plugin A dipende da → Plugin B
Plugin B dipende da → Plugin A
```

**Conseguenza:**
Loop infinito nel `while(this.#pluginsToActive.size != 0)` (righe 140-150).

**Fix Proposto:**

```javascript
// Aggiungi controllo prima del loop
function detectCircularDependencies(pluginsToActive) {
  const visited = new Set()
  const recursionStack = new Set()

  function hasCycle(pluginName) {
    visited.add(pluginName)
    recursionStack.add(pluginName)

    const dependencies = pluginsToActive.get(pluginName)
    if (dependencies) {
      for (const [depName] of dependencies) {
        if (!visited.has(depName)) {
          if (hasCycle(depName)) return true
        } else if (recursionStack.has(depName)) {
          return true  // Ciclo trovato!
        }
      }
    }

    recursionStack.delete(pluginName)
    return false
  }

  for (const [pluginName] of pluginsToActive) {
    if (!visited.has(pluginName)) {
      if (hasCycle(pluginName)) {
        throw new Error(`Circular dependency detected involving: ${pluginName}`)
      }
    }
  }
}
```

---

### 🟠 MEDIO - Mancanza Gestione Errori

**Problema:**
Non ci sono try-catch durante:
- Caricamento `require()` dei plugin
- Chiamata `installPlugin()`, `loadPlugin()`
- Scrittura file `pluginConfig.json5`

**Conseguenza:**
Un errore in un plugin **blocca l'intero sistema**.

**Fix Proposto:**

```javascript
const caricatePlugin = (pluginName) => {
  try {
    const pluginConfig = require(`../plugins/${pluginName}/pluginConfig.json5`)
    const plugin = require(`../plugins/${pluginName}/main.js`)

    // ... resto del codice

    if (pluginConfig.isInstalled == 0) {
      try {
        plugin.installPlugin()
      } catch (error) {
        console.error(`Error installing plugin ${pluginName}:`, error)
        throw error
      }
    }

    try {
      plugin.loadPlugin()
    } catch (error) {
      console.error(`Error loading plugin ${pluginName}:`, error)
      throw error
    }

  } catch (error) {
    console.error(`Fatal error with plugin ${pluginName}:`, error)
    // Opzione: continua con altri plugin invece di crashare
    this.#activePlugins.delete(pluginName)
  }
}
```

---

### 🟡 MEDIO - Sistema di Upgrade Non Implementato

**Problema:**
La funzione `upgradePlugin()` è definita nell'interfaccia ma **mai chiamata**.

**Mancanza:**
Non c'è controllo della versione precedente vs nuova versione.

**Implementazione Proposta:**

```javascript
// In caricatePlugin(), dopo aver caricato config e description

const currentVersion = pluginConfig.version || '0.0.0'
const newVersion = require(`../plugins/${pluginName}/pluginDescription.json5`).version

if (semver.gt(newVersion, currentVersion)) {
  // Nuova versione installata!
  if (plugin.upgradePlugin) {
    try {
      plugin.upgradePlugin(currentVersion, newVersion)

      // Aggiorna versione in config
      pluginConfig.version = newVersion
      fs.promises.writeFile(
        `${__dirname}/../plugins/${pluginName}/pluginConfig.json5`,
        JSON.stringify(pluginConfig, null, 2)
      )
    } catch (error) {
      console.error(`Error upgrading plugin ${pluginName}:`, error)
      throw error
    }
  }
}
```

---

### 🟡 BASSO - Validazione `nodeModuleDependency` Non Implementata

**Problema:**
Il campo `nodeModuleDependency` in `pluginConfig.json5` **non viene controllato**.

**Implementazione Proposta:**

```javascript
// Prima di caricare il plugin
const nodeModules = pluginConfig.nodeModuleDependency || {}

for (const [moduleName, versionRange] of Object.entries(nodeModules)) {
  try {
    const modulePackage = require(`${moduleName}/package.json`)
    if (!semver.satisfies(modulePackage.version, versionRange)) {
      throw new Error(
        `Plugin ${pluginName} requires ${moduleName}@${versionRange} ` +
        `but found ${modulePackage.version}`
      )
    }
  } catch (error) {
    throw new Error(
      `Plugin ${pluginName} requires module ${moduleName} ` +
      `which is not installed`
    )
  }
}
```

---

### 🟡 BASSO - Inconsistenza Nomi Funzioni

**Problema:**
Documentazione menziona `getFnInPageMap()` ma il codice usa `getHooksPage()`.

**File:** `plugins/EXPLAIN.md:111` vs implementazione reale

**Fix:**
Aggiornare documentazione per usare il nome corretto: `getHooksPage()`

---

### 🟡 BASSO - Parametri Mancanti nelle Funzioni Plugin

**Problema:**
Alcune funzioni sono chiamate con parametri che non vengono passati:

```javascript
// Definizione in EXPLAIN.md
loadPlugin(pluginSys, pathPluginFolder)

// Chiamata reale in core/pluginSys.js:81
plugin.loadPlugin()  // ❌ Nessun parametro!
```

**Conseguenza:**
I plugin non possono accedere a `pluginSys` o al proprio path durante il load.

**Fix Proposto:**

```javascript
// In caricatePlugin()
plugin.loadPlugin(this, path.join(__dirname, '..', 'plugins', pluginName))
```

---

## Funzionalità Mancanti

### 1. Sistema di Eventi

**Mancanza:** Non esiste un event bus per comunicazione tra plugin.

**Proposta:**

```javascript
class pluginSys {
  #eventBus = new EventEmitter()

  emit(eventName, data) {
    this.#eventBus.emit(eventName, data)
  }

  on(eventName, callback) {
    this.#eventBus.on(eventName, callback)
  }
}

// Uso nei plugin
pluginSys.on('user.login', (user) => {
  console.log(`User logged in: ${user.username}`)
})

pluginSys.emit('user.login', { username: 'john' })
```

---

### 2. Hot Reload dei Plugin

**Mancanza:** Impossibile ricaricare plugin senza riavviare il server.

**Proposta:**

```javascript
async reloadPlugin(pluginName) {
  // 1. Unload plugin
  const plugin = this.#activePlugins.get(pluginName)
  if (plugin.unloadPlugin) {
    await plugin.unloadPlugin()
  }

  // 2. Clear require cache
  const pluginPath = require.resolve(`../plugins/${pluginName}/main.js`)
  delete require.cache[pluginPath]

  // 3. Reload plugin
  caricatePlugin(pluginName)
}
```

---

### 3. Plugin Marketplace / Repository

**Mancanza:** Nessun sistema per installare plugin da repository esterni.

**Proposta:**

```javascript
async installPluginFromRepo(pluginUrl) {
  // 1. Download plugin zip
  // 2. Extract to /plugins
  // 3. Validate structure
  // 4. Load plugin
}
```

---

### 4. Permessi e Sicurezza dei Plugin

**Mancanza:** Nessun sistema di permessi per limitare cosa può fare un plugin.

**Proposta:**

```javascript
// pluginConfig.json5
{
  "permissions": {
    "filesystem": false,
    "database": true,
    "network": false
  }
}

// Enforcement nel core
if (plugin.permissions.filesystem === false) {
  // Blocca accesso a fs
}
```

---

### 5. Logging Standardizzato

**Mancanza:** Ogni plugin fa logging a modo suo.

**Proposta:**

```javascript
// Fornire logger a ogni plugin
function loadPlugin() {
  const logger = this.logger  // Iniettato dal core

  logger.info('Plugin loaded')
  logger.error('Something went wrong')
  logger.debug('Debug info')
}
```

---

### 6. Testing Framework

**Mancanza:** Nessun sistema per testare plugin in isolamento.

**Proposta:**

```javascript
// test/pluginTest.js
const { testPlugin } = require('../core/pluginTester')

testPlugin('myPlugin', {
  mockDependencies: {
    'dbApi': mockDbApi
  },
  testCases: [
    {
      name: 'Should create user',
      test: async (plugin) => {
        const result = await plugin.createUser('test')
        assert.equal(result.success, true)
      }
    }
  ]
})
```

---

### 7. API Versioning

**Mancanza:** Nessuna gestione delle versioni API.

**Proposta:**

```javascript
// Supporto per /api/v1/plugin/path e /api/v2/plugin/path

getRouteArray() {
  return [
    {
      apiVersion: 'v1',  // Nuovo campo
      method: 'GET',
      path: '/items',
      handler: async (ctx) => { /* v1 logic */ }
    },
    {
      apiVersion: 'v2',
      method: 'GET',
      path: '/items',
      handler: async (ctx) => { /* v2 logic */ }
    }
  ]
}
```

---

### 8. Configurazione GUI

**Mancanza:** Le configurazioni plugin sono solo in JSON, nessuna UI.

**Proposta:**

Admin panel con form per modificare `custom` object in `pluginConfig.json5`.

---

### 9. Sandboxing

**Mancanza:** Plugin hanno accesso completo al sistema.

**Proposta:**
Eseguire plugin in VM isolate o worker threads.

---

### 10. Dependency Graph Visualizer

**Mancanza:** Difficile capire le dipendenze tra plugin.

**Proposta:**

```javascript
getDependencyGraph() {
  // Genera DOT format o JSON per visualizzare grafo dipendenze
}
```

---

## Raccomandazioni per Miglioramenti

### Priorità ALTA

#### 1. Fixare Bug Critico in `isPluginDependenciesSatisfied`

**Azione:** Riscrivere la funzione usando `for...of` invece di `forEach`.

**Impatto:** Previene loop infiniti.

---

#### 2. Implementare Controllo Dipendenze Circolari

**Azione:** Aggiungere algoritmo di cycle detection.

**Impatto:** Previene deadlock nel caricamento plugin.

---

#### 3. Aggiungere Try-Catch Globale

**Azione:** Wrappare tutte le chiamate ai plugin in try-catch.

**Impatto:** Un plugin con errori non blocca l'intero sistema.

---

#### 4. Implementare Sistema di Upgrade

**Azione:** Controllare versione e chiamare `upgradePlugin()` quando necessario.

**Impatto:** Permette migrazioni smooth tra versioni.

---

### Priorità MEDIA

#### 5. Passare Parametri alle Funzioni Plugin

**Azione:** Passare `pluginSys` e `pathPluginFolder` a tutte le funzioni lifecycle.

**Impatto:** Plugin hanno accesso a API del core.

---

#### 6. Validare `nodeModuleDependency`

**Azione:** Controllare che moduli npm richiesti siano installati.

**Impatto:** Errori più chiari se mancano dipendenze.

---

#### 7. Standardizzare Logging

**Azione:** Fornire logger centralizzato a tutti i plugin.

**Impatto:** Log più consistenti e facili da analizzare.

---

#### 8. Aggiungere Event Bus

**Azione:** Implementare EventEmitter per comunicazione inter-plugin.

**Impatto:** Disaccoppiamento tra plugin.

---

### Priorità BASSA

#### 9. Documentazione API

**Azione:** Generare docs automatiche da JSDoc.

**Impatto:** Più facile per sviluppatori creare plugin.

---

#### 10. Test Suite

**Azione:** Scrivere test per core e plugin principali.

**Impatto:** Maggiore affidabilità.

---

## Roadmap Proposta

### Fase 1: Stabilizzazione (1-2 settimane)

- [ ] Fix bug `isPluginDependenciesSatisfied`
- [ ] Implementa controllo dipendenze circolari
- [ ] Aggiungi error handling completo
- [ ] Scrivi test per caricamento plugin
- [ ] Documenta API con JSDoc

**Deliverable:** Sistema plugin stabile e affidabile

---

### Fase 2: Funzionalità Core (2-3 settimane)

- [ ] Implementa sistema di upgrade
- [ ] Valida `nodeModuleDependency`
- [ ] Passa parametri corretti a funzioni plugin
- [ ] Aggiungi event bus
- [ ] Implementa logging centralizzato

**Deliverable:** Sistema plugin con feature complete

---

### Fase 3: Developer Experience (2-3 settimane)

- [ ] CLI per creare nuovi plugin
- [ ] Template plugin con best practices
- [ ] Documentazione completa
- [ ] Testing framework per plugin
- [ ] Hot reload in development

**Deliverable:** Facile creare e testare plugin

---

### Fase 4: Sicurezza e Scalabilità (3-4 settimane)

- [ ] Sistema permessi plugin
- [ ] Sandboxing / isolamento
- [ ] Performance monitoring
- [ ] Plugin marketplace
- [ ] API versioning

**Deliverable:** Sistema production-ready

---

## Conclusioni

Il sistema plugin di **ital8cms** è una **solida base** con ottime idee architetturali:

✅ **Punti di Forza:**
- Dependency resolution automatico
- Semantic versioning
- Object sharing flessibile
- Hook system potente
- Architettura modulare pulita

❌ **Punti Critici:**
- Bug in `isPluginDependenciesSatisfied` → **fix immediato necessario**
- Mancanza controllo cicli → **rischio loop infiniti**
- Assenza error handling → **sistema fragile**
- Upgrade system incompleto → **difficile manutenzione**

🎯 **Raccomandazione Principale:**

Concentrarsi su **Fase 1 (Stabilizzazione)** prima di aggiungere nuove feature. Un sistema stabile è più importante di un sistema con molte funzionalità ma instabile.

---

## Appendice A: Pattern di Esempio

### Plugin Template Completo

```javascript
// plugins/examplePlugin/main.js

const fs = require('fs')
const path = require('path')

// Configurazione
let pluginConfig = require(`${__dirname}/pluginConfig.json5`)
const pluginName = path.basename(__dirname)

// Variabili condivise
const sharedObject = {}

// === LIFECYCLE ===

function loadPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Loading...`)

  // Accedi a oggetti condivisi da altri plugin
  const db = sharedObject.dbApi?.db

  if (db) {
    // Inizializza database
    db.exec(`
      CREATE TABLE IF NOT EXISTS my_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `)
  }
}

function installPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Installing...`)

  // Setup iniziale (solo prima volta)
  const dataPath = path.join(pathPluginFolder, 'data')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath)
  }
}

function uninstallPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Uninstalling...`)

  // Cleanup
  const db = sharedObject.dbApi?.db
  if (db) {
    db.exec('DROP TABLE IF EXISTS my_table')
  }
}

function upgradePlugin(oldVersion, newVersion, pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Upgrading from ${oldVersion} to ${newVersion}`)

  // Migrazioni
  const db = sharedObject.dbApi?.db
  if (db) {
    if (semver.lt(oldVersion, '2.0.0') && semver.gte(newVersion, '2.0.0')) {
      // Migrazione per v2
      db.exec('ALTER TABLE my_table ADD COLUMN new_field TEXT')
    }
  }
}

// === SHARING ===

function getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  // Personalizza per plugin specifici
  if (forPlugin === 'admin') {
    return {
      getStats: () => {
        const db = sharedObject.dbApi?.db
        return db.prepare('SELECT COUNT(*) as count FROM my_table').get()
      }
    }
  }

  return {}
}

function setSharedObject(fromPlugin, object) {
  sharedObject[fromPlugin] = object
}

function getObjectToShareToWebPages(pluginSys, pathPluginFolder) {
  return {
    pluginName: pluginName,
    version: require('./pluginDescription.json5').version
  }
}

// === ROUTING ===

function getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'GET',
      path: '/items',
      handler: async (ctx) => {
        const db = sharedObject.dbApi?.db
        const items = db.prepare('SELECT * FROM my_table').all()
        ctx.body = { items }
      }
    },
    {
      method: 'POST',
      path: '/items',
      handler: async (ctx) => {
        const { name } = ctx.request.body

        if (!name) {
          ctx.status = 400
          ctx.body = { error: 'Name required' }
          return
        }

        const db = sharedObject.dbApi?.db
        const result = db.prepare('INSERT INTO my_table (name) VALUES (?)').run(name)

        ctx.body = {
          success: true,
          id: result.lastInsertRowid
        }
      }
    }
  ]
}

// === HOOKS ===

function getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  const hooks = new Map()

  hooks.set('head', (passData) => {
    return `<link rel="stylesheet" href="/api/${pluginName}/styles.css">`
  })

  hooks.set('script', (passData) => {
    return `<script src="/api/${pluginName}/client.js"></script>`
  })

  hooks.set('header', (passData) => {
    if (passData.ctx.session.authenticated) {
      return `<div class="plugin-badge">${pluginName} active</div>`
    }
    return ''
  })

  return hooks
}

// === MIDDLEWARE ===

function getMiddlewareToAdd(pluginSys, pathPluginFolder) {
  return [
    {
      func: async (ctx, next) => {
        // Log requests
        if (ctx.path.startsWith(`/api/${pluginName}`)) {
          console.log(`[${pluginName}] ${ctx.method} ${ctx.path}`)
        }
        await next()
      }
    }
  ]
}

// === EXPORTS ===

module.exports = {
  loadPlugin,
  installPlugin,
  uninstallPlugin,
  upgradePlugin,
  getObjectToShareToOthersPlugin,
  setSharedObject,
  getObjectToShareToWebPages,
  getRouteArray,
  getHooksPage,
  getMiddlewareToAdd,
  pluginName,
  pluginConfig
}
```

---

## Appendice B: File di Configurazione Completi

### pluginConfig.json5 (Esempio Completo)

```json
{
  "active": 1,
  "isInstalled": 0,
  "weight": 50,
  "dependency": {
    "dbApi": "^1.0.0",
    "bootstrap": ">=1.0.0 <2.0.0"
  },
  "nodeModuleDependency": {
    "lodash": "^4.17.21",
    "axios": "^1.6.0"
  },
  "custom": {
    "enableCache": true,
    "cacheTimeout": 3600,
    "maxItems": 100,
    "features": {
      "notifications": true,
      "analytics": false
    },
    "apiKeys": {
      "service1": "xxx",
      "service2": "yyy"
    }
  }
}
```

### pluginDescription.json5 (Esempio Completo)

```json
{
  "name": "examplePlugin",
  "version": "2.1.0",
  "description": "An example plugin demonstrating all features",
  "author": "Italo Paesano",
  "email": "italopaesano@protonmail.com",
  "license": "MIT",
  "homepage": "https://github.com/user/plugin",
  "repository": {
    "type": "git",
    "url": "https://github.com/user/plugin.git"
  },
  "keywords": [
    "cms",
    "plugin",
    "example"
  ],
  "screenshots": [
    "screenshot1.png",
    "screenshot2.png"
  ],
  "changelog": {
    "2.1.0": "Added caching support",
    "2.0.0": "Breaking: Changed API structure",
    "1.0.0": "Initial release"
  }
}
```

---

**Fine Report**

Per domande o chiarimenti, contattare: italopaesano@protonmail.com
