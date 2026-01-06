# Diagramma di Flusso - Sistema Plugin ital8cms

## Panoramica

Questo documento descrive il flusso completo del sistema plugin di ital8cms, dalla lettura delle cartelle fino all'esecuzione delle richieste HTTP.

---

## 1. Flusso di Avvio Applicazione

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.js                                  │
│                    (Entry Point)                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Carica Configurazione                               │
│         (ital8Config.json5, koaSession.json5)                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Inizializza Koa App                                 │
│         (bodyparser, session, router)                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              pluginSys.initializeAllPlugins()                    │
│         ══════════════════════════════════                       │
│              SISTEMA PLUGIN PRINCIPALE                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              themeSys.initialize()                               │
│              (Sistema Temi)                                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Avvia Server HTTP                                   │
│              (porta 3000)                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Flusso Inizializzazione Plugin System

```
┌─────────────────────────────────────────────────────────────────┐
│                 initializeAllPlugins()                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 1: DISCOVERY                                               │
│  ─────────────────                                               │
│  • Leggi cartella /plugins                                       │
│  • Per ogni sottocartella:                                       │
│    - Leggi pluginConfig.json5                                    │
│    - Leggi pluginDescription.json5                               │
│    - Verifica active === 1                                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 2: VALIDAZIONE                                             │
│  ───────────────────                                             │
│  Per ogni plugin attivo:                                         │
│  • Verifica dipendenze plugin (dependency)                       │
│  • Verifica dipendenze npm (nodeModuleDependency)                │
│  • Rileva dipendenze circolari                                   │
│  • Se errore → log e skip plugin                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 3: ORDINAMENTO                                             │
│  ───────────────────                                             │
│  Ordina plugin per:                                              │
│  1. Weight (crescente: 0, 1, 2...)                               │
│  2. Dipendenze (prima i plugin senza dipendenze)                 │
│  3. Nome alfabetico (se weight uguale)                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 4: CARICAMENTO                                             │
│  ───────────────────                                             │
│  Per ogni plugin (in ordine):                                    │
│  • require(main.js)                                              │
│  • Chiama loadPlugin(pluginSys, pathPluginFolder)                │
│  • Se isInstalled === 0 → installPlugin()                        │
│  • Se versione > installedVersion → upgradePlugin()              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 5: OBJECT SHARING                                          │
│  ─────────────────────                                           │
│  Per ogni coppia di plugin:                                      │
│  • A.getObjectToShareToOthersPlugin(B) → oggetto                 │
│  • B.setSharedObject(A, oggetto)                                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 6: REGISTRAZIONE ROUTE                                     │
│  ──────────────────────────                                      │
│  Per ogni plugin:                                                │
│  • routes = getRouteArray()                                      │
│  • Per ogni route:                                               │
│    router[method](/api/{pluginName}/{path}, handler)             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 7: REGISTRAZIONE MIDDLEWARE                                │
│  ───────────────────────────────                                 │
│  Per ogni plugin:                                                │
│  • middlewares = getMiddlewareToAdd()                            │
│  • app.use(middleware.func)                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Flusso Risoluzione Dipendenze

```
                    ┌──────────────┐
                    │   Plugin A   │
                    │  weight: 10  │
                    │  deps: [B,C] │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌──────────────┐          ┌──────────────┐
      │   Plugin B   │          │   Plugin C   │
      │  weight: 5   │          │  weight: 5   │
      │  deps: [D]   │          │  deps: []    │
      └──────┬───────┘          └──────────────┘
             │
             ▼
      ┌──────────────┐
      │   Plugin D   │
      │  weight: 0   │
      │  deps: []    │
      └──────────────┘

ORDINE DI CARICAMENTO:
1. Plugin D (weight: 0, nessuna dipendenza)
2. Plugin B (weight: 5, dipende da D già caricato)
3. Plugin C (weight: 5, nessuna dipendenza)
4. Plugin A (weight: 10, dipende da B e C già caricati)
```

### Algoritmo di Risoluzione

```
function resolveLoadOrder(plugins):
    sorted = []
    remaining = copy(plugins)

    while remaining not empty:
        for plugin in remaining (sorted by weight):
            if all dependencies in sorted:
                sorted.append(plugin)
                remaining.remove(plugin)
                break
        else:
            throw "Dipendenza circolare o mancante"

    return sorted
```

---

## 4. Flusso Ciclo di Vita Plugin

```
┌─────────────────────────────────────────────────────────────────┐
│                    CICLO DI VITA PLUGIN                          │
└─────────────────────────────────────────────────────────────────┘

PRIMA INSTALLAZIONE (isInstalled === 0):
═══════════════════════════════════════

    loadPlugin()
         │
         ▼
    installPlugin()    ──────►  [Crea tabelle DB]
         │                      [Copia file config]
         ▼                      [Setup iniziale]
    isInstalled = 1
    installedVersion = version


AVVIO NORMALE (isInstalled === 1, stessa versione):
══════════════════════════════════════════════════

    loadPlugin()  ──────────►  [Inizializza variabili]
                               [Connetti a servizi]
                               [Prepara risorse]


UPGRADE (version > installedVersion):
════════════════════════════════════

    loadPlugin()
         │
         ▼
    upgradePlugin(oldVer, newVer)  ──────►  [Migra schema DB]
         │                                  [Aggiorna config]
         ▼                                  [Converti dati]
    installedVersion = newVersion


DISINSTALLAZIONE:
════════════════

    uninstallPlugin()  ──────►  [Rimuovi tabelle DB]
         │                      [Elimina file temp]
         ▼                      [Pulisci risorse]
    [Plugin rimosso]
```

---

## 5. Flusso Object Sharing

```
┌─────────────────────────────────────────────────────────────────┐
│                    OBJECT SHARING FLOW                           │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐                              ┌──────────────┐
│    dbApi     │                              │ adminUsers │
│              │                              │              │
│  PROVIDER    │                              │  CONSUMER    │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  getObjectToShareToOthersPlugin             │
       │  ('adminUsers')                           │
       │                                             │
       ▼                                             │
┌──────────────┐                                     │
│ return {     │                                     │
│   db: db,    │ ────────────────────────────────────┤
│   query: fn  │        oggetto condiviso            │
│ }            │                                     │
└──────────────┘                                     │
                                                     ▼
                                            ┌──────────────┐
                                            │setSharedObject│
                                            │('dbApi', obj) │
                                            │              │
                                            │this.db = obj │
                                            └──────────────┘


CONDIVISIONE SELETTIVA:
══════════════════════

getObjectToShareToOthersPlugin(forPlugin) {
    if (forPlugin === 'admin') {
        // Admin riceve accesso completo
        return { db, query, exec, adminFunctions };
    } else {
        // Altri plugin ricevono solo lettura
        return { db, query };
    }
}
```

---

## 6. Flusso Gestione Richieste HTTP

```
┌─────────────────────────────────────────────────────────────────┐
│                    REQUEST FLOW                                  │
└─────────────────────────────────────────────────────────────────┘

    Client Request
    GET /api/myPlugin/hello
           │
           ▼
┌─────────────────────┐
│   Koa Middleware    │
│   Stack             │
├─────────────────────┤
│ • bodyparser        │
│ • session           │
│ • plugin middlewares│◄─── getMiddlewareToAdd()
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│    Koa Router       │
│                     │
│ /api/{plugin}/{path}│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Plugin Route       │
│  Handler            │
│                     │
│  async (ctx) => {   │◄─── getRouteArray()
│    ctx.body = ...   │
│  }                  │
└─────────┬───────────┘
          │
          ▼
    Client Response
```

---

## 7. Flusso Page Hooks

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAGE HOOKS FLOW                               │
└─────────────────────────────────────────────────────────────────┘

Rendering pagina EJS (es. /www/index.ejs):

┌─────────────────────────────────────────────────────────────────┐
│ <!DOCTYPE html>                                                  │
│ <html>                                                           │
│ <head>                                                           │
│   <%- await pluginSys.hookPage("head", passData) %>             │
│ </head>                                                          │
│ <body>                                                           │
│   <header>                                                       │
│     <%- await pluginSys.hookPage("header", passData) %>         │
│   </header>                                                      │
│   <main>                                                         │
│     <%- await pluginSys.hookPage("body", passData) %>           │
│   </main>                                                        │
│   <footer>                                                       │
│     <%- await pluginSys.hookPage("footer", passData) %>         │
│   </footer>                                                      │
│   <%- await pluginSys.hookPage("script", passData) %>           │
│ </body>                                                          │
│ </html>                                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    pluginSys.hookPage()                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  function hookPage(section, passData) {                          │
│    let output = '';                                              │
│                                                                  │
│    for (plugin of loadedPlugins) {                               │
│      hookMap = plugin.getHooksPage();                            │
│      if (hookMap.has(section)) {                                 │
│        output += hookMap.get(section)(passData);                 │
│      }                                                           │
│    }                                                             │
│                                                                  │
│    return output;                                                │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │ Plugin A │    │ Plugin B │    │ Plugin C │
       │ head: CSS│    │ head: CSS│    │ script:JS│
       └──────────┘    └──────────┘    └──────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    OUTPUT COMBINATO:
                    <style>A CSS</style>
                    <style>B CSS</style>
                    ...
                    <script>C JS</script>
```

---

## 8. Flusso Validazione Dipendenze npm

```
┌─────────────────────────────────────────────────────────────────┐
│              VALIDAZIONE nodeModuleDependency                    │
└─────────────────────────────────────────────────────────────────┘

pluginConfig.json5:
{
  "nodeModuleDependency": {
    "bcryptjs": "^3.0.0",
    "semver": "^7.0.0"
  }
}
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Per ogni modulo richiesto:                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. require.resolve(moduleName)                                  │
│     │                                                            │
│     ├─► ERRORE ──► Modulo mancante                               │
│     │                                                            │
│     └─► OK                                                       │
│          │                                                       │
│          ▼                                                       │
│  2. Leggi node_modules/{modulo}/package.json                     │
│     │                                                            │
│     ▼                                                            │
│  3. semver.satisfies(installed, required)                        │
│     │                                                            │
│     ├─► FALSE ──► Versione incompatibile                         │
│     │                                                            │
│     └─► TRUE ──► OK                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Se errori:                                                      │
│  • Log warning con comando npm install suggerito                 │
│  • Plugin NON viene caricato (fail-safe)                         │
│                                                                  │
│  WARN: Plugin "myPlugin" - dipendenze npm mancanti:              │
│        - bcryptjs (required: ^3.0.0)                             │
│        Esegui: npm install bcryptjs@^3.0.0                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Flusso Completo: Da Avvio a Risposta

```
┌─────────────────────────────────────────────────────────────────┐
│                 FLUSSO COMPLETO SISTEMA                          │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   npm start │
                    └──────┬──────┘
                           │
                           ▼
               ┌───────────────────────┐
               │      index.js         │
               │   Load Config         │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Initialize Koa      │
               │   + Middlewares       │
               └───────────┬───────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────┐
    │            PLUGIN SYSTEM                      │
    ├──────────────────────────────────────────────┤
    │                                              │
    │  ┌────────┐  ┌────────┐  ┌────────┐         │
    │  │ dbApi  │  │ simple │  │ admin  │  ...    │
    │  │        │  │ Access │  │        │         │
    │  └───┬────┘  └───┬────┘  └───┬────┘         │
    │      │           │           │               │
    │      └─────┬─────┴─────┬─────┘               │
    │            │           │                     │
    │      Object Sharing    Routes                │
    │                                              │
    └──────────────────────────────────────────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Theme System        │
               │   Initialize          │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   HTTP Server         │
               │   Listen :3000        │
               └───────────┬───────────┘
                           │
         ══════════════════╧══════════════════
                    SERVER RUNNING
         ═════════════════════════════════════
                           │
                           ▼
               ┌───────────────────────┐
               │   Incoming Request    │
               │   GET /api/plugin/x   │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Middleware Stack    │
               │   (session, body...)  │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Router Match        │
               │   /api/{name}/{path}  │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Plugin Handler      │
               │   Execute Logic       │
               └───────────┬───────────┘
                           │
                           ▼
               ┌───────────────────────┐
               │   Send Response       │
               │   JSON/HTML/etc       │
               └───────────────────────┘
```

---

## 10. Diagramma Stati Plugin

```
┌─────────────────────────────────────────────────────────────────┐
│                    STATI DEL PLUGIN                              │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │  INACTIVE   │
                    │  active: 0  │
                    └──────┬──────┘
                           │
                    (utente attiva)
                           │
                           ▼
                    ┌─────────────┐
       ┌────────────┤   ACTIVE    │
       │            │  active: 1  │
       │            └──────┬──────┘
       │                   │
       │         ┌─────────┴─────────┐
       │         │                   │
       │         ▼                   ▼
       │  ┌─────────────┐    ┌─────────────┐
       │  │ NOT INSTALLED│    │  INSTALLED  │
       │  │isInstalled:0│    │isInstalled:1│
       │  └──────┬──────┘    └──────┬──────┘
       │         │                   │
       │    installPlugin()          │
       │         │                   │
       │         └─────────┬─────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │             │
       │            ▼             ▼
       │     ┌──────────┐  ┌──────────┐
       │     │  LOADED  │  │ UPGRADE  │
       │     │          │  │ NEEDED   │
       │     └──────────┘  └────┬─────┘
       │                        │
       │                 upgradePlugin()
       │                        │
       │                        ▼
       │                 ┌──────────┐
       │                 │  LOADED  │
       │                 │ (updated)│
       │                 └──────────┘
       │
  (utente disattiva)
       │
       ▼
┌─────────────┐
│  INACTIVE   │
│  active: 0  │
└─────────────┘
```

---

## 11. Sequenza Temporale

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIMELINE AVVIO                                │
└─────────────────────────────────────────────────────────────────┘

t=0ms    ├── Avvio node index.js
         │
t=10ms   ├── Caricamento configurazioni
         │
t=50ms   ├── Inizializzazione Koa
         │
t=100ms  ├── PLUGIN SYSTEM START
         │   ├── Discovery plugins (10ms)
         │   ├── Validazione dipendenze (20ms)
         │   ├── Ordinamento (5ms)
         │   ├── Caricamento plugin (100ms)
         │   │   ├── dbApi.loadPlugin()
         │   │   ├── adminUsers.loadPlugin()
         │   │   ├── admin.loadPlugin()
         │   │   └── ...
         │   ├── Object sharing (30ms)
         │   ├── Registrazione route (20ms)
         │   └── Registrazione middleware (10ms)
         │
t=300ms  ├── PLUGIN SYSTEM END
         │
t=310ms  ├── Theme system init
         │
t=350ms  ├── HTTP Server listening
         │
         └── READY ✓
```

---

## 12. Gestione Errori

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING                                │
└─────────────────────────────────────────────────────────────────┘

ERRORE: Dipendenza plugin mancante
────────────────────────────────
Plugin A richiede Plugin B (non attivo)
    │
    ▼
┌─────────────────────┐
│ WARN: Skipping A    │
│ Missing dep: B      │
└─────────────────────┘
    │
    ▼
Sistema continua senza Plugin A


ERRORE: Dipendenza npm mancante
───────────────────────────────
Plugin richiede bcryptjs (non installato)
    │
    ▼
┌─────────────────────┐
│ ERROR: npm missing  │
│ Run: npm install... │
└─────────────────────┘
    │
    ▼
Sistema continua senza Plugin


ERRORE: Dipendenza circolare
────────────────────────────
A → B → C → A
    │
    ▼
┌─────────────────────┐
│ ERROR: Circular dep │
│ A → B → C → A       │
└─────────────────────┘
    │
    ▼
Tutti i plugin nel ciclo skippati


ERRORE: Sintassi in main.js
───────────────────────────
require(main.js) throws
    │
    ▼
┌─────────────────────┐
│ ERROR: Parse error  │
│ in plugin X         │
└─────────────────────┘
    │
    ▼
Sistema continua senza Plugin X
```

---

## 13. Riferimenti File Sorgente

| Componente | File | Funzione Principale |
|------------|------|---------------------|
| Plugin System | `core/pluginSys.js` | `initializeAllPlugins()` |
| Theme System | `core/themeSys.js` | `initialize()` |
| Entry Point | `index.js` | Avvio applicazione |
| Logger | `core/logger.js` | `info()`, `error()`, etc |

---

## 14. Note per Sviluppatori

### Aggiungere un Nuovo Plugin

1. Crea cartella in `/plugins/`
2. Aggiungi `main.js`, `pluginConfig.json5`, `pluginDescription.json5`
3. Imposta `"active": 1` in config
4. Riavvia server

### Debugging

```bash
# Abilita log debug
LOG_LEVEL=DEBUG npm start

# Oppure in ital8Config.json5
{ "logLevel": "DEBUG" }
```

### Test Plugin Loading

```bash
npm run test:integration
```

---

**Versione**: 1.0.0
**Data**: 2025-11-19
**Compatibile con**: ital8cms 0.0.1-alpha.0
