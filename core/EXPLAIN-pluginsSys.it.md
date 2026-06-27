<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN-pluginsSys.md` is a stub until release.
# Sistema Plugin - pluginSys.js

## Panoramica

Il sistema plugin (`core/pluginSys.js`) è il cuore di ital8cms. Gestisce il caricamento, l'inizializzazione e la comunicazione tra i plugin.

**Per creare un plugin**: vedere `/plugins/EXPLAIN.md` e `/plugins/exampleComplete/`

---

## Funzionalità Disponibili per i Plugin

Ogni plugin può esportare le seguenti funzioni in `main.js`:

### Funzioni del Ciclo di Vita
- `loadPlugin(pluginSys, pathPluginFolder)` - Chiamata ad ogni avvio
- `installPlugin(pluginSys, pathPluginFolder)` - Prima installazione
- `upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion)` - Aggiornamento versione
- `uninstallPlugin(pluginSys, pathPluginFolder)` - Disinstallazione

### Funzioni di Estensione
- `getRouteArray(router, pluginSys, pathPluginFolder)` - Definisce route API
- `getHooksPage(section, passData, pluginSys, pathPluginFolder)` - Inietta contenuti nelle pagine
- `getMiddlewareToAdd(pluginSys, pathPluginFolder)` - Aggiunge middleware Koa

### Funzioni di Condivisione
- `getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder)` - Espone oggetti ad altri plugin
- `setSharedObject(fromPlugin, sharedObject)` - Riceve oggetti da altri plugin
- `getObjectToShareToWebPages(pluginSys, pathPluginFolder)` - Espone oggetti ai template EJS (sintassi locale)
- `getGlobalFunctionsForTemplates()` - Espone funzioni ai template EJS (sintassi globale - richiede whitelist)

---

## 1. getRouteArray()

Restituisce un Array di route che verranno registrate sotto `/api/{pluginName}/`.

### Struttura

```js
function getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'get',      // 'get', 'post', 'put', 'del', 'all'
      path: '/endpoint',  // URL: /api/{pluginName}/endpoint
      func: async (ctx) => {
        ctx.body = { message: 'Hello' };
      }
    }
  ];
}
```

### Esempio Completo

```js
function getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    // GET - Servire file statici
    {
      method: 'get',
      path: '/css/bootstrap.min.css',
      func: async (ctx) => {
        const cssPath = path.join(__dirname, '..', '..', 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css');
        ctx.body = fs.createReadStream(cssPath);
        ctx.set('Content-Type', 'text/css');
      }
    },
    // GET - Ritornare JSON
    {
      method: 'get',
      path: '/info',
      func: async (ctx) => {
        ctx.body = { name: 'myPlugin', version: '1.0.0' };
      }
    },
    // GET - Query parameters
    {
      method: 'get',
      path: '/search',
      func: async (ctx) => {
        const query = ctx.query.q || '';
        ctx.body = { results: [], query };
      }
    },
    // POST - Body JSON
    {
      method: 'post',
      path: '/create',
      func: async (ctx) => {
        const data = ctx.request.body;
        // Validazione
        if (!data.name) {
          ctx.status = 400;
          ctx.body = { error: 'Name required' };
          return;
        }
        ctx.body = { success: true, id: 123 };
      }
    },
    // Route protetta (richiede autenticazione)
    {
      method: 'get',
      path: '/protected',
      func: async (ctx) => {
        if (!ctx.session.authenticated) {
          ctx.status = 401;
          ctx.body = { error: 'Unauthorized' };
          return;
        }
        ctx.body = { secret: 'data' };
      }
    }
  ];
}
```

---

## 2. getHooksPage()

Inietta contenuti HTML nelle sezioni delle pagine. Chiamata durante il rendering EJS.

### Sezioni Disponibili
- `head` - Dentro `<head>` (CSS, meta tags)
- `header` - Dopo apertura `<body>` (banner, notifiche)
- `body` - Nel contenuto principale
- `footer` - Prima della chiusura (footer content)
- `script` - Prima di `</body>` (JavaScript)

### Struttura

```js
function getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  if (section === 'head') {
    return '<link rel="stylesheet" href="/api/myPlugin/style.css">';
  }
  if (section === 'script') {
    return '<script src="/api/myPlugin/script.js"></script>';
  }
  return '';
}
```

### Esempio con Map (alternativo)

```js
function getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  const hookMap = new Map();

  hookMap.set('head', (data) =>
    `<link rel='stylesheet' href='/api/bootstrap/css/bootstrap.min.css'>`
  );

  hookMap.set('script', (data) =>
    `<script src="/api/bootstrap/js/bootstrap.bundle.min.js"></script>`
  );

  hookMap.set('header', (data) => {
    if (data.ctx.session.authenticated) {
      return `<div class="alert">Benvenuto ${data.ctx.session.user.username}</div>`;
    }
    return '';
  });

  const hookFn = hookMap.get(section);
  return hookFn ? hookFn(passData) : '';
}
```

---

## 3. getMiddlewareToAdd()

Aggiunge middleware Koa che verranno eseguiti per ogni richiesta.

### Struttura

```js
function getMiddlewareToAdd(pluginSys, pathPluginFolder) {
  return [
    {
      func: async (ctx, next) => {
        // Esegui prima del handler
        console.log(`${ctx.method} ${ctx.url}`);

        await next();  // Continua al prossimo middleware/handler

        // Esegui dopo il handler
        ctx.set('X-Response-Time', `${Date.now() - start}ms`);
      }
    }
  ];
}
```

### Esempio Completo

```js
function getMiddlewareToAdd(pluginSys, pathPluginFolder) {
  return [
    // Logging richieste
    {
      func: async (ctx, next) => {
        const start = Date.now();
        await next();
        const ms = Date.now() - start;
        console.log(`${ctx.method} ${ctx.url} - ${ms}ms`);
      }
    },
    // Header personalizzati
    {
      func: async (ctx, next) => {
        ctx.set('X-Powered-By', 'ital8cms');
        await next();
      }
    },
    // Rate limiting (esempio base)
    {
      func: async (ctx, next) => {
        const ip = ctx.ip;
        // Implementa logica rate limiting
        await next();
      }
    }
  ];
}
```

---

## 4. Object Sharing tra Plugin

Permette ai plugin di condividere oggetti, funzioni e dati.

### getObjectToShareToOthersPlugin()

Definisce cosa condividere con gli altri plugin.

```js
// In dbApi plugin
function getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  // Condivisione selettiva basata sul plugin richiedente
  if (forPlugin === 'admin') {
    // Admin riceve accesso completo
    return {
      db: this.db,
      query: this.query,
      exec: this.exec,
      adminFunctions: this.adminFunctions
    };
  }

  // Altri plugin ricevono accesso limitato
  return {
    db: this.db,
    query: this.query
  };
}
```

### setSharedObject()

Riceve oggetti condivisi da altri plugin.

```js
// In adminUsers plugin
let dbApi = null;

function setSharedObject(fromPlugin, sharedObject) {
  if (fromPlugin === 'dbApi') {
    dbApi = sharedObject;
    // Ora posso usare dbApi.db, dbApi.query, etc.
  }
}

async function loadPlugin(pluginSys, pathPluginFolder) {
  // Uso l'oggetto condiviso
  const users = dbApi.db.prepare('SELECT * FROM users').all();
}
```

### Flusso di Condivisione

```
Plugin A                              Plugin B
─────────                             ─────────

getObjectToShareToOthersPlugin('B')
    │
    └──────────────────────────────► setSharedObject('A', object)
                                          │
                                          ▼
                                      this.aData = object
```

### Codice in pluginSys.js

```js
// Per ogni coppia di plugin (A, B) dove A != B:
this.#activePlugins.forEach((pluginA, nomePluginA) => {
  if (pluginA.getObjectToShareToOthersPlugin) {
    this.#activePlugins.forEach((pluginB, nomePluginB) => {
      if (nomePluginA !== nomePluginB) {
        if (pluginB.setSharedObject) {
          const sharedObject = pluginA.getObjectToShareToOthersPlugin(nomePluginB);
          pluginB.setSharedObject(nomePluginA, sharedObject);
        }
      }
    });
  }
});
```

---

## 5. getObjectToShareToWebPages()

Espone dati ai template EJS tramite `passData.plugin.{pluginName}`.

```js
function getObjectToShareToWebPages(pluginSys, pathPluginFolder) {
  return {
    db: this.webDb,
    config: this.publicConfig,
    helpers: {
      formatDate: (date) => date.toLocaleDateString('it-IT'),
      truncate: (str, len) => str.length > len ? str.slice(0, len) + '...' : str
    }
  };
}
```

### Uso nei Template EJS

```ejs
<%
  const dbApi = passData.plugin.dbApi;
  const items = dbApi.db.prepare('SELECT * FROM items').all();
%>

<ul>
<% items.forEach(item => { %>
  <li><%= passData.plugin.myPlugin.helpers.truncate(item.name, 50) %></li>
<% }); %>
</ul>
```

---

## 6. getGlobalFunctionsForTemplates()

**NUOVO STANDARD (2026-01-04)**: Espone funzioni candidate per l'uso globale nei template EJS.

### Differenza tra Local e Global

#### LOCAL (getObjectToShareToWebPages)
```js
// Disponibile sempre come passData.plugin.{pluginName}.{function}
getObjectToShareToWebPages() {
  return {
    __: this.translate.bind(this),
    getCurrentLang: (ctx) => ctx?.state?.lang,
    getSupportedLangs: () => [...this.supportedLangs],
    getConfig: () => ({ ...this.config })
  };
}
```

```ejs
<!-- Sintassi locale (sempre disponibile) -->
<%- passData.plugin.simpleI18n.__(translations, passData.ctx) %>
<%- passData.plugin.simpleI18n.getCurrentLang(passData.ctx) %>
```

#### GLOBAL (getGlobalFunctionsForTemplates)
```js
// Candidati per uso globale (richiedono autorizzazione whitelist)
getGlobalFunctionsForTemplates() {
  return {
    __: this.translate.bind(this)  // SOLO funzioni destinate all'uso globale
  };
}
```

```ejs
<!-- Sintassi globale (se autorizzata in whitelist) -->
<%- __(translations, passData.ctx) %>
```

### Sistema di Whitelist

Le funzioni globali DEVONO essere autorizzate in `ital8Config.json5`:

```json5
{
  "globalFunctionsWhitelist": {
    "__": {
      "plugin": "simpleI18n",
      "description": "Translation function for internationalization",
      "required": true  // true = crash startup, false = fallback
    }
  }
}
```

**Attributi whitelist:**
- `plugin` (obbligatorio) - Plugin che fornisce la funzione
- `description` (opzionale) - Documentazione
- `required` (obbligatorio) - Comportamento se plugin mancante:
  - `true` → **CRASH STARTUP** (fail-fast)
  - `false` → **CREA FALLBACK** (graceful degradation)

### Flusso di Registrazione

```
1. pluginSys.getGlobalFunctions() legge whitelist da ital8Config.json5
                    ↓
2. Per ogni funzione in whitelist:
   - Verifica se plugin è attivo
   - Chiama plugin.getGlobalFunctionsForTemplates()
   - Verifica se funzione esiste nell'oggetto ritornato
                    ↓
3. Registra funzione se tutti i controlli passano
                    ↓
4. Ritorna oggetto con funzioni globali per EJS
```

### Sicurezza

- ✅ **Whitelist enforcement**: Solo funzioni autorizzate vengono registrate
- ✅ **Fail-fast mode**: Funzioni required mancanti = crash startup
- ✅ **Fallback mode**: Funzioni optional mancanti = funzione fallback creata
- ✅ **Warning chiari**: Implementazioni mancanti o errori di configurazione vengono loggati

### Esempio Completo: simpleI18n

```js
// plugins/simpleI18n/main.js
module.exports = {
  // ... altre funzioni ...

  // Funzioni LOCALI (sempre disponibili)
  getObjectToShareToWebPages() {
    return {
      __: this.translate.bind(this),
      getCurrentLang: (ctx) => ctx?.state?.lang || this.config.defaultLang,
      getSupportedLangs: () => [...this.config.supportedLangs],
      getConfig: () => ({ ...this.config })
    };
  },

  // Funzioni GLOBALI (richiedono whitelist)
  getGlobalFunctionsForTemplates() {
    return {
      __: this.translate.bind(this)  // Solo __ è destinata all'uso globale
    };
  },

  translate(translationObj, ctx = null) {
    const currentLang = ctx?.state?.lang || this.config.defaultLang;
    return translationObj[currentLang] || translationObj[this.config.defaultLang];
  }
};
```

### Uso nei Template

```ejs
<!-- SINTASSI GLOBALE (comoda per funzioni comuni) -->
<h1><%- __({ it: "Benvenuto", en: "Welcome" }, passData.ctx) %></h1>

<!-- SINTASSI LOCALE (sempre disponibile, più verbosa) -->
<p><%- passData.plugin.simpleI18n.__({ it: "Ciao", en: "Hello" }, passData.ctx) %></p>
<p>Lingua: <%= passData.plugin.simpleI18n.getCurrentLang(passData.ctx) %></p>
```

### Note Importanti

- ✅ **Entrambe le sintassi funzionano sempre**: Globale è comoda, locale è sempre disponibile
- ✅ **Backward compatibility garantita**: Codice esistente continua a funzionare
- ✅ **Separazione chiara**: getObjectToShareToWebPages = locale, getGlobalFunctionsForTemplates = globale
- ✅ **Security first**: Whitelist previene iniezioni non autorizzate di funzioni globali

---

## 7. Ciclo di Vita Plugin

> **Esecuzione asincrona (hardening boot, punto 2).** I hook di lifecycle
> `loadPlugin()` / `installPlugin()` / `upgradePlugin()` possono essere `async` e
> il framework li **attende (`await`)** durante l'avvio. Conseguenze per chi scrive
> un plugin:
> - il caricamento è **sequenziale e in ordine di dipendenza**: quando il tuo
>   `loadPlugin()` viene eseguito, i plugin da cui dipendi sono già caricati e i
>   loro oggetti condivisi sono disponibili (`pluginSys.getSharedObject(...)`);
> - se il tuo hook **lancia o rigetta**, l'avvio si interrompe in modo pulito con
>   `[BOOT] Avvio fallito: ...` ed exit 1 (errore **fatale al boot**, non più un
>   `unhandledRejection` silenzioso): per i problemi non recuperabili, fallisci
>   presto e con un messaggio chiaro;
> - meccanica interna: il caricamento non avviene più nel **costruttore** di
>   `pluginSys` ma nel metodo **`async initialize()`**, awaitato da `index.js`
>   (`const pluginSys = new (...)(ital8Conf); await pluginSys.initialize();`).

### loadPlugin()

Chiamata **ogni volta** che il server si avvia. Inizializza il plugin.

```js
async function loadPlugin(pluginSys, pathPluginFolder) {
  // Carica configurazione
  this.config = require('./pluginConfig.json5');

  // Inizializza variabili
  this.counter = 0;
  this.loadedAt = new Date();

  // Connetti a servizi
  this.db = pluginSys.getSharedObject('dbApi').db;

  console.log('MyPlugin loaded!');
}
```

### installPlugin()

Chiamata **una sola volta**, alla **transizione `isInstalled` non-1 → 1** (clone fresco, o dipendenze appena risolte che portano il plugin a `installed`). Esegue il setup iniziale. Vedi *Stati dei plugin e boot graceful* sotto per come lo stato e `isInstalled` sono calcolati e persistiti (Variante 1).

```js
async function installPlugin(pluginSys, pathPluginFolder) {
  const db = pluginSys.getSharedObject('dbApi').db;

  // Crea tabelle
  db.exec(`
    CREATE TABLE IF NOT EXISTS my_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Inserisci dati iniziali
  db.prepare('INSERT INTO my_items (name) VALUES (?)').run('Default Item');

  console.log('MyPlugin installed!');

  // NB: non serve scrivere isInstalled a mano — il boot lo persiste a 1 nel
  // pluginConfig.json5 vivo via setJson5Key (vedi "Stati dei plugin" sotto).
}
```

### upgradePlugin()

Chiamata quando la versione in `pluginDescription.json5` è maggiore di `installedVersion` in `pluginConfig.json5`.

```js
async function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
  const db = pluginSys.getSharedObject('dbApi').db;

  // Migrazione da 1.0.0 a 1.1.0
  if (oldVersion === '1.0.0' && newVersion === '1.1.0') {
    db.exec('ALTER TABLE my_items ADD COLUMN description TEXT');
  }

  // Migrazione da 1.1.0 a 2.0.0
  if (oldVersion === '1.1.0' && newVersion === '2.0.0') {
    db.exec('CREATE INDEX idx_items_name ON my_items(name)');
  }

  console.log(`MyPlugin upgraded: ${oldVersion} → ${newVersion}`);

  // installedVersion verrà aggiornato automaticamente
}
```

### uninstallPlugin()

Chiamata quando il plugin viene disinstallato. Pulisce risorse.

```js
async function uninstallPlugin(pluginSys, pathPluginFolder) {
  const db = pluginSys.getSharedObject('dbApi').db;

  // Rimuovi tabelle
  db.exec('DROP TABLE IF EXISTS my_items');

  // Elimina file temporanei
  const tempDir = path.join(pathPluginFolder, 'temp');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }

  console.log('MyPlugin uninstalled!');
}
```

---

## 7. Sistema di Validazione Dipendenze

### Dipendenze Plugin

In `pluginConfig.json5`:

```json
{
  "dependency": {
    "dbApi": "^1.0.0",
    "adminUsers": "^1.0.0"
  }
}
```

Il sistema verifica:
- Il plugin dipendenza esiste ed è attivo
- La versione soddisfa il requisito semver

### Dipendenze npm (nodeModuleDependency)

```json
{
  "nodeModuleDependency": {
    "bcryptjs": "^3.0.0",
    "semver": "^7.0.0"
  }
}
```

Il sistema verifica:
- Il modulo npm è installato
- La versione soddisfa il requisito semver

Se mancano dipendenze, il plugin **non viene caricato** e viene mostrato un warning con il comando npm da eseguire:

```
WARN: Plugin "myPlugin" - dipendenze npm mancanti:
      - bcryptjs (required: ^3.0.0)
      Esegui: npm install bcryptjs@^3.0.0
```

### Rilevamento Dipendenze Circolari

Il sistema rileva automaticamente cicli come `A → B → C → A` e li segnala:

```
ERROR: Dipendenza circolare rilevata: pluginA → pluginB → pluginC → pluginA
```

---

## 8. Ordine di Caricamento

I plugin vengono caricati in base a:

1. **Weight** (crescente: 0, 1, 2...)
2. **Dipendenze** (prima i plugin senza dipendenze)
3. **Nome alfabetico** (se weight uguale)

```json
// pluginConfig.json5
{
  "weight": 0    // Caricato prima (es. dbApi)
}

{
  "weight": 10   // Caricato dopo (es. admin)
}
```

---

## 9. Stati dei plugin e boot graceful (ciclo di vita config)

Dalla Fase 2 del *ciclo di vita config* ([`docs/decisions/config-lifecycle.it.md`](../docs/decisions/config-lifecycle.it.md)), `pluginSys.initialize()` non si limita a "caricare i plugin attivi": calcola a ogni boot uno **stato** per ciascun plugin e carica **solo** quelli pronti, senza mai bloccare l'avvio (boot **graceful**).

### Gli stati

| Stato | Significato | Caricato? |
|---|---|---|
| `available` | Nessun `pluginConfig.json5` vivo: il plugin esiste su disco ma non è mai stato "preso in carico". | No |
| `disabled` | `active != 1` nel `pluginConfig.json5`. | No |
| `incomplete` | Preso in carico (`active: 1`) ma con **precondizioni mancanti**: dipendenza npm assente/incompatibile, dipendenza plugin assente/incompatibile/`incomplete`, ciclo, oppure `loadPlugin()` ha lanciato. | No |
| `installed` | Precondizioni soddisfatte → `loadPlugin()` eseguito con successo. | Sì |

Getter pubblici: `getPluginState(name)` → la stringa di stato; `getPluginStates()` → la mappa completa `{ name: state }`.

### `pluginStateResolver` (modulo puro)

La logica di calcolo degli stati vive in [`core/pluginStateResolver.js`](./pluginStateResolver.js), un modulo **puro** (nessun I/O, nessun side effect) → testabile in isolamento. Espone:

- **`checkNpmDeps(deps, resolveInstalledVersion)`** — verifica le `nodeModuleDependency` contro le versioni installate (la risoluzione della versione è **iniettata**: il modulo resta puro). Ritorna l'esito + l'elenco di mancanti/incompatibili.
- **`resolvePluginStates(candidates)`** — dati i candidati (con `active`, deps npm già valutate, deps plugin), risolve lo stato di ciascuno con una **cascata a punto fisso**: se A dipende da B e B è `incomplete`, A diventa `incomplete`; si itera finché lo stato non si stabilizza. Include il **rilevamento dei cicli** (un ciclo → tutti i suoi membri `incomplete`). Ogni `incomplete` porta una `reason` (`npm` / `dep-missing` / `dep-version` / `dep-incomplete` / `circular`).

### Boot graceful

Un fallimento di un plugin **non** interrompe l'avvio:
- il plugin che lancia / ha precondizioni mancanti è marcato `incomplete` e **saltato**;
- i suoi dipendenti cascata a `incomplete`;
- un box `[PLUGINS]` riepiloga a fine boot quali plugin non sono stati caricati e perché;
- il boot **completa sempre** e il server parte.

### `essentialPlugins` — l'eccezione fatale

Alcuni plugin sono **essenziali**: un sito con autenticazione / controllo accessi rotti non va servito. La lista vive in `ital8Config.json5 → essentialPlugins` (default: `adminUsers`, `adminAccessControl`, `admin`). Se un essenziale **non** raggiunge lo stato `installed`, il boot emette un box `[FATAL]` e fa `process.exit` — è esattamente il caso in cui NON vogliamo servire il sito (non graceful).

### `isInstalled` = "precondizioni soddisfatte" (Variante 1)

`isInstalled` **non** è una scelta dell'utente: è lo **stato runtime** "precondizioni soddisfatte", persistito nel `pluginConfig.json5` vivo dal boot (Variante 1, scelta dal maintainer). Meccanica:
- al boot, dopo aver calcolato lo stato, `pluginSys` scrive `isInstalled` nel vivo via [`core/setJson5Key.js`](./setJson5Key.js) (add-or-update preservando i commenti);
- `installPlugin()` è agganciato alla **transizione `isInstalled` non-1 → 1**: gira quando un plugin diventa `installed` per la prima volta (clone fresco) o dopo che dipendenze appena risolte lo portano a `installed`. Così la presenza/valore di `isInstalled` traccia anche il setup one-shot, **senza un flag separato**.

Il `*.default.json5` del descrittore **non** contiene `isInstalled` (è stato runtime): è scritto solo nel vivo, al boot.

### Relazione con materializzazione e `schemaVersion`

Prima ancora di `initialize()`, il boot (`index.js`) **materializza** i `pluginConfig.json5` vivi mancanti dai rispettivi `.default` (`materializeMissingConfigs`) e **riconcilia** gli eventuali drift di `schemaVersion` (`reconcileSchemaVersions`, merge additivo + box `[SCHEMA]`). Quindi, quando `initialize()` legge i config, questi esistono e sono strutturalmente allineati. Dettaglio completo nel [decision record](../docs/decisions/config-lifecycle.it.md).

---

## 10. Sistema di Logging

Il plugin system usa il logger centralizzato (`core/logger.js`):

```js
const logger = require('./logger');

logger.debug('PluginSys', 'Dettaglio debug');
logger.info('PluginSys', 'Plugin caricato', { name: 'myPlugin' });
logger.warn('PluginSys', 'Attenzione', { issue: '...' });
logger.error('PluginSys', 'Errore critico', error);
```

### Livelli di Log

- `DEBUG` - Dettagli per sviluppo
- `INFO` - Informazioni generali
- `WARN` - Avvisi (dipendenze mancanti, etc.)
- `ERROR` - Errori critici

Configura il livello in `ital8Config.json5`:

```json
{
  "logLevel": "INFO"
}
```

O via variabile ambiente:

```bash
LOG_LEVEL=DEBUG npm start
```

---

## 11. Accesso al Plugin System

### Nei Plugin

```js
async function loadPlugin(pluginSys, pathPluginFolder) {
  // Ottieni oggetto condiviso da altro plugin
  const dbApi = pluginSys.getSharedObject('dbApi');

  // Accedi alla configurazione
  const apiPrefix = pluginSys.apiPrefix;
}
```

### Nei Template EJS

```ejs
<%
  // Accedi al plugin system
  const pluginSys = passData.pluginSys;

  // Chiama hook
  const headerContent = await pluginSys.hookPage('header', passData);
%>

<%- headerContent %>
```

---

## 12. Esempio Plugin Completo

Vedi `/plugins/exampleComplete/` per un esempio completo che dimostra tutte le funzionalità:

- Tutte le funzioni del ciclo di vita
- Route API (GET, POST, validazione, auth)
- Page hooks
- Middleware
- Object sharing

Per attivarlo:
1. Modifica `plugins/exampleComplete/pluginConfig.json5`: `"active": 1`
2. Riavvia il server
3. Visita `http://localhost:3000/api/exampleComplete/demo`

---

## 13. Best Practices

### Sicurezza

```js
// Valida sempre l'input
if (!data.name || typeof data.name !== 'string') {
  ctx.status = 400;
  ctx.body = { error: 'Invalid name' };
  return;
}

// Usa prepared statements
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// Verifica autenticazione
if (!ctx.session.authenticated) {
  ctx.status = 401;
  return;
}
```

### Performance

```js
// Inizializza risorse pesanti in loadPlugin
async function loadPlugin(pluginSys, pathPluginFolder) {
  this.preparedStatements = {
    getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
    listUsers: db.prepare('SELECT * FROM users LIMIT ?')
  };
}

// Riusa nelle route
{
  method: 'get',
  path: '/user/:id',
  func: async (ctx) => {
    const user = this.preparedStatements.getUser.get(ctx.params.id);
    ctx.body = user;
  }
}
```

### Gestione Errori

```js
{
  method: 'post',
  path: '/create',
  func: async (ctx) => {
    try {
      const result = db.prepare('INSERT INTO items (name) VALUES (?)').run(name);
      ctx.body = { success: true, id: result.lastInsertRowid };
    } catch (error) {
      logger.error('MyPlugin', 'Errore creazione item', error);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  }
}
```

---

## Riferimenti

- **Diagramma di flusso (obsoleto, spunto)**: `../docs/archive/plugin-system-flowchart.it.md`
- **Documentazione API (obsoleto, spunto)**: `../docs/archive/api-documentation.it.md`
- **Sistema di logging (obsoleto, spunto)**: `../docs/archive/logging-system.it.md`
- **Test suite (obsoleto, spunto)**: `../docs/archive/test-suite.it.md`
- **Plugin di esempio**: `plugins/exampleComplete/`

---

**Versione**: 2.0.0
**Ultimo aggiornamento**: 2025-11-19
