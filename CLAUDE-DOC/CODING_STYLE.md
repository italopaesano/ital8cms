# CODING_STYLE.md - Guida allo Stile di Programmazione e Documentazione

## Indice
1. [Filosofia del Progetto](#filosofia-del-progetto)
2. [Stile di Programmazione JavaScript](#stile-di-programmazione-javascript)
3. [Convenzioni di Naming](#convenzioni-di-naming)
4. [Stile dei Commenti](#stile-dei-commenti)
5. [Struttura dei File](#struttura-dei-file)
6. [Pattern di Codice](#pattern-di-codice)
7. [Stile di Documentazione](#stile-di-documentazione)
8. [File EXPLAIN.md](#file-explainmd)
9. [Esempi Pratici](#esempi-pratici)

---

## Filosofia del Progetto

ital8cms è un progetto **italiano** con:
- **Commenti in italiano** nel codice
- **Documentazione in italiano** (file EXPLAIN.md, README.md)
- **Nomi di variabili e funzioni in inglese** (per compatibilità internazionale)
- **Architettura modulare** basata su plugin
- **Semplicità e chiarezza** come principi guida

**Nota importante per collaboratori internazionali:**
> Quando si aggiungono commenti, è preferibile usare l'italiano per mantenere la coerenza con lo stile del progetto. Tuttavia, commenti in inglese sono accettati se necessario per la collaborazione internazionale.

---

## Stile di Programmazione JavaScript

### 1. Dichiarazione delle Variabili

**Preferire `const` quando possibile, altrimenti `let`. MAI usare `var`:**

```javascript
// ✅ CORRETTO
const pluginName = path.basename(__dirname);
let pluginConfig = require('./pluginConfig.json5'); // let perchè questa variabile può cambiare di valore
const sharedObject = {};

// ❌ EVITARE
var myVariable = 'value'; // NON usare var
```

**Convenzione:**
- `const` per valori che non cambiano
- `let` per valori che possono cambiare
- Aggiungere commento quando si usa `let` per spiegare perché

### 2. Array e Oggetti

**Usare `Array()` e `Object()` per le inizializzazioni esplicite:**

```javascript
// ✅ PREFERITO nel progetto
const routeArray = Array();
const middlewareArray = Array();
const sharedObject = {};

// ⚠️ Anche valido ma meno usato
const routes = [];
const middleware = [];
```

### 3. Map e Set

**Preferire `Map()` invece di oggetti quando si tratta di collezioni:**

```javascript
// ✅ CORRETTO - Uso di Map per collezioni
const HookMap = new Map();
HookMap.set('body', (passData) => '<h3>ciao a tutti</h3>');
HookMap.set('footer', (passData) => '<b>sono nel footer</b>');

const activePlugins = new Map(); // plugin attivi
const routes = new Map(); // mappa delle rotte
```

### 4. Funzioni

**Mix di funzioni tradizionali e arrow functions:**

```javascript
// ✅ Funzioni tradizionali per export
function loadPlugin() {
  console.log('Plugin loaded');
}

function getRouteArray() {
  const routeArray = Array();
  return routeArray;
}

// ✅ Arrow functions per callback e funzioni interne
const caricatePlugin = (pluginName) => {
  const pluginConfig = require(`../plugins/${pluginName}/pluginConfig.json5`);
  // ...
};

middlewareArray.forEach((middleware) => {
  app.use(middleware);
});

// ✅ Arrow functions inline
HookMap.set('head', (passData) => '<link href="style.css">');
```

**Quando usare quale:**
- **Funzioni tradizionali**: per funzioni principali da esportare
- **Arrow functions**: per callback, iterazioni, funzioni inline
- **Arrow functions con `const`**: per mantenere il contesto `this`

### 5. Async/Await

**Sempre usare async/await per operazioni asincrone:**

```javascript
// ✅ CORRETTO
async function loadPlugin() {
  const data = await fs.promises.readFile('file.json');
  // ...
}

// ✅ CORRETTO - Middleware Koa
async (ctx, next) => {
  if (!ctx.session.authenticated) {
    ctx.status = 401;
    return;
  }
  await next();
}

// ✅ CORRETTO - Route handler
{
  method: 'GET',
  path: '/users',
  handler: async (ctx) => {
    const users = await db.prepare('SELECT * FROM users').all();
    ctx.body = users;
  }
}
```

### 6. Template Literals

**Usare template literals per stringhe multi-linea e interpolazione:**

```javascript
// ✅ CORRETTO
const pluginConfig = require(`${__dirname}/pluginConfig.json5`);
const basePath = path.join(__dirname, '..', 'plugins');

// ✅ CORRETTO - Multi-line
const html = `
  <div class="container">
    <h1>Titolo</h1>
  </div>
`;

// ✅ CORRETTO - Con variabili
const route = `/${apiPrefix}/${pluginName}/users`;
```

### 7. Classi

**Usare classi ES6 con variabili private (#):**

```javascript
// ✅ CORRETTO
class pluginSys {

  #pluginsMiddlewares = Array(); // Variabile privata
  #hooksPage; // variabile privata
  #routes; // variabile privata
  #objectToShareToWebPages = {}; // variabile privata
  #activePlugins = new Map(); // Mappa che conterrà i plugin attivi

  constructor() {
    this.#hooksPage = new Map();
    this.#routes = new Map();
  }

  // Metodi pubblici
  loadRoutes(router, apiPrefix) {
    // ...
  }

  // Metodi privati
  #validatePlugin(pluginName) {
    // ...
  }
}
```

**Convenzioni per le classi:**
- Usare `#` per variabili e metodi privati
- Nomi delle classi in PascalCase (ma lowercase per i nomi dei file)
- Commenti dettagliati per variabili private

### 8. Module Exports

**Esportare oggetti con tutte le funzioni del plugin:**

```javascript
// ✅ CORRETTO - Export completo
module.exports = {
  loadPlugin: loadPlugin,
  installPlugin: installPlugin,
  unistallPlugin: unistallPlugin,
  upgradePlugin: upgradePlugin,
  getObjectToShareToWebPages: getObjectToShareToWebPages,
  getObjectToShareToOthersPlugin: getObjectToShareToOthersPlugin,
  setSharedObject: setSharedObject,
  pluginName: pluginName,
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getHooksPage: getHooksPage,
  getMiddlewareToAdd: getMiddlewareToAdd
}

// ⚠️ Anche valido (shorthand)
module.exports = {
  loadPlugin,
  installPlugin,
  // ...
}
```

---

## Convenzioni di Naming

### 1. Variabili e Funzioni

**Usare camelCase:**

```javascript
// ✅ CORRETTO
const pluginName = 'myPlugin';
const sharedObject = {};
const apiPrefix = 'api';

function loadPlugin() { }
function getRouteArray() { }
function setSharedObject() { }
```

### 2. Classi

**Usare PascalCase (ma file in lowercase):**

```javascript
// ✅ CORRETTO - Nome classe
class PluginSystem { }
class ThemeSystem { }

// ✅ CORRETTO - Nome file: pluginSys.js, themeSys.js
const pluginSys = require('./core/pluginSys');
const themeSys = require('./core/themeSys');
```

### 3. Costanti

**Usare camelCase (non UPPER_CASE come in altri progetti):**

```javascript
// ✅ PREFERITO nel progetto
const ital8Conf = require('./ital8Config.json5');
const apiPrefix = ital8Conf.apiPrefix;

// ⚠️ Meno comune nel progetto
const API_PREFIX = 'api';
```

### 4. File e Directory

**Usare kebab-case o camelCase:**

```javascript
// ✅ CORRETTO - Directory
plugins/
themes/
core/admin/webPages/
priorityMiddlewares/

// ✅ CORRETTO - File
main.js
pluginConfig.json5
pluginDescription.json5
ital8Config.json5
pluginSys.js
themeSys.js
```

### 5. Nomi dei Plugin

**Senza spazi o caratteri speciali:**

```javascript
// ✅ CORRETTO
plugins/dbApi/
plugins/adminUsers/
plugins/exaplePlugin/
plugins/ostrukUtility/

// ❌ EVITARE
plugins/db-api/  // preferire camelCase
plugins/simple access/  // NO spazi
plugins/admin@2/  // NO caratteri speciali
```

---

## Stile dei Commenti

### 1. Commenti in Italiano

**Tutti i commenti sono in italiano:**

```javascript
// ✅ CORRETTO - Commenti in italiano
const pluginName = path.basename(__dirname); // restituisce il nome della directory che contiene il file corrente

// ATTENZIONE USO LA FUNZIONE FRECCIA PER MANTENERE il this locale
const caricatePlugin = (pluginName) => {
  // carico il plugin
};

// Variabile privata che contiene l'elenco dei middleware dei plugin da aggiungere
#pluginsMiddlewares = Array();
```

### 2. Commenti Esplicativi

**Commentare abbondantemente il codice complesso:**

```javascript
// ✅ CORRETTO - Commenti dettagliati
// setto i plugin attivi prima del loading e dell'install in modo che,
// una volta caricati gli oggetti condivisi, questi potranno essere utilizzati
// nel loading e nell'install
this.#activePlugins.set(pluginName, plugin);

// adesso crea e carico gli oggetti condivisi fra i plugin:
// ogni plugin chiamerà la funzione getObjectToShareToOthersPlugin(pluginName)
// passando il proprio nome come parametro ed ottenendo l'oggetto a lui destinato
this.#activePlugins.forEach((plugin0, nomePlugin0) => {
  // ...
});
```

### 3. Commenti TODO e NOTE

**Usare commenti speciali per note importanti:**

```javascript
// DA MIGLIORARE PER LA SICUREZZA
ctx: ctx,

// OLD -> mi sa che non serve più
// baseThemePath: `${ital8Conf.baseThemePath}`,

// TODO: implementare validazione
// ATTENZIONE: questo middleware blocca l'accesso
```

### 4. Commenti Multi-linea

**Usare `//` per ogni linea invece di `/* */`:**

```javascript
// ✅ PREFERITO
// Questo è un commento
// multi-linea che spiega
// cosa fa questa funzione

// ⚠️ Meno usato
/*
  Questo è un commento
  multi-linea
*/
```

### 5. Commenti di Sezione

**Usare `//START` e `//END` per delimitare sezioni:**

```javascript
// ✅ CORRETTO
//START CARICO GLI OGGETTI CONDIVISI
this.#activePlugins.forEach((plugin0, nomePlugin0) => {
  // ...
});
//END CARICO GLI OGGETTI CONDIVISI

//START ADESSO CARICO LA PARTE DI ADMIN SE RICHIESTA
if (ital8Conf.enableAdmin) {
  // ...
}
```

### 6. Commenti Inline

**Aggiungere spiegazioni accanto al codice:**

```javascript
// ✅ CORRETTO
let pluginConfig = require('./pluginConfig.json5'); // let perchè questa variabile può cambiare di valore
const sharedObject = {}; // oggetto che avrà gli oggetti condiviso con gli altri plugin

middlewareArray.push( // ritorna un array di middleware
  async (ctx, next) => {
    // ...
  }
);
```

---

## Struttura dei File

### 1. Struttura di un Plugin

**Ogni plugin deve avere questa struttura:**

```
plugins/myPlugin/
├── main.js                    # Logica del plugin (OBBLIGATORIO)
├── pluginConfig.json5         # Configurazione (OBBLIGATORIO)
├── pluginDescription.json5    # Metadata (OBBLIGATORIO)
├── EXPLAIN.md                 # Documentazione (CONSIGLIATO)
├── lib/                       # Librerie interne (OPZIONALE)
│   └── myLib.js
└── custom/                    # File personalizzati (OPZIONALE)
    └── customFile.js
```

### 2. Struttura di main.js

**Ordine standard delle sezioni:**

```javascript
// 1. IMPORT E REQUIRE
const fs = require('fs');
const path = require('path');

// 2. CONFIGURAZIONE E VARIABILI GLOBALI
let pluginConfig = require(`${__dirname}/pluginConfig.json5`);
const pluginName = path.basename(__dirname);
const sharedObject = {};

// 3. FUNZIONI LIFECYCLE
function loadPlugin() { }
function installPlugin() { }
function unistallPlugin() { }
function upgradePlugin() { }

// 4. FUNZIONI DI CONDIVISIONE
function getObjectToShareToWebPages() { }
function getObjectToShareToOthersPlugin(pluginName) { }
function setSharedObject(pluginName, object) { }

// 5. FUNZIONI DI ROUTING E MIDDLEWARE
function getRouteArray() { }
function getMiddlewareToAdd(app) { }
function getHooksPage() { }

// 6. MODULE EXPORTS
module.exports = {
  loadPlugin,
  installPlugin,
  // ... tutte le funzioni
}
```

### 3. File di Configurazione JSON

**Sempre formattati con 2 spazi di indentazione:**

```json
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,
  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

---

## Pattern di Codice

### 1. Pattern per Route Array

**Struttura standard:**

```javascript
function getRouteArray() {
  const routeArray = Array();

  routeArray.push({
    method: 'GET', // 'GET', 'POST', 'PUT', 'DEL', 'ALL'
    path: '/users', // verrà prefissato con /api/pluginName
    handler: async (ctx) => {
      // logica della route
      ctx.body = { message: 'OK' };
    }
  });

  return routeArray;
}
```

**Nota importante sui path:**
> Il path finale sarà: `/${apiPrefix}/${pluginName}/users`
> Quindi NON includere `/api/pluginName` nel path

### 2. Pattern per Middleware

**Struttura standard:**

```javascript
function getMiddlewareToAdd(app) {
  const middlewareArray = Array();

  middlewareArray.push(
    async (ctx, next) => {
      // logica del middleware
      console.log(`${ctx.method} ${ctx.url}`);
      await next();
    }
  );

  return middlewareArray;
}
```

### 3. Pattern per Hooks

**Usare Map per gli hooks di pagina:**

```javascript
function getHooksPage() {
  const HookMap = new Map();

  HookMap.set('head', (passData) =>
    '<link rel="stylesheet" href="/my-style.css">'
  );

  HookMap.set('body', (passData) =>
    '<h3>Contenuto inserito nel body</h3>'
  );

  HookMap.set('footer', (passData) =>
    '<b>Contenuto nel footer</b>'
  );

  HookMap.set('script', (passData) =>
    '<script src="/my-script.js"></script>'
  );

  return HookMap;
}
```

**Sezioni disponibili:**
- `head` - Inserito nel `<head>` della pagina
- `header` - Inserito all'inizio del `<body>`
- `body` - Inserito nel contenuto principale
- `footer` - Inserito prima della chiusura del `<body>`
- `script` - Inserito prima della chiusura del `</body>`

### 4. Pattern per Object Sharing

**Condivisione tra plugin:**

```javascript
// Plugin che condivide (es: dbApi)
function getObjectToShareToOthersPlugin(pluginName) {
  // Posso personalizzare cosa condividere in base al plugin richiedente
  if (pluginName === 'adminUsers') {
    return { db: this.userDb };
  }
  return { db: this.mainDb };
}

// Plugin che riceve
function setSharedObject(pluginName, object) {
  if (pluginName === 'dbApi') {
    sharedObject[pluginName] = object;
    this.db = object.db; // Salvo riferimento locale
  }
}
```

**Condivisione con le pagine web:**

```javascript
function getObjectToShareToWebPages() {
  return {
    myFunction: () => { /* ... */ },
    myData: this.data,
    myConfig: this.config
  };
}

// Accessibile in EJS come:
// passData.plugin.pluginName.myFunction()
```

### 5. Pattern per Validazione

**Validazione email e username:**

```javascript
// ✅ Pattern usato nel progetto
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  return { error: 'Formato email non valido' };
}

// Username: solo alfanumerici, underscore, trattino, minimo 3 caratteri
if (!/^[a-zA-Z0-9_-]{3,}$/.test(username)) {
  return { error: 'Username non valido' };
}

// No spazi
if (/\s/.test(username)) {
  return { error: 'Username non può contenere spazi' };
}
```

### 6. Pattern per Database

**Uso di better-sqlite3:**

```javascript
// ✅ Ottenere il database
const dbApi = pluginSys.getSharedObject('dbApi');
const db = dbApi.db;

// ✅ Creare tabelle
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ✅ Insert con prepared statement
const stmt = db.prepare('INSERT INTO users (username, email) VALUES (?, ?)');
const result = stmt.run(username, email);

// ✅ Select
const users = db.prepare('SELECT * FROM users').all();
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
```

### 7. Pattern per Autenticazione

**Controllo sessione:**

```javascript
// ✅ In middleware
async (ctx, next) => {
  if (!ctx.session || !ctx.session.authenticated) {
    ctx.status = 401;
    ctx.body = { message: 'Accesso negato' };
    return;
  }
  await next();
}

// ✅ In route handler
handler: async (ctx) => {
  if (!ctx.session.authenticated) {
    ctx.status = 401;
    return;
  }
  // ... logica protetta
}

// ✅ In template EJS
<% if (passData.ctx.session.authenticated) { %>
  <p>Benvenuto <%= passData.ctx.session.user.username %></p>
<% } %>
```

---

## Stile di Documentazione

### 1. File EXPLAIN.md per ogni Plugin/Tema

**Ogni plugin/tema DEVE avere un file EXPLAIN.md:**

```
plugins/myPlugin/
├── EXPLAIN.md              # ← OBBLIGATORIO
├── main.js
├── pluginConfig.json5
└── pluginDescription.json5
```

### 2. Lingua della Documentazione

**Documentazione in ITALIANO:**

```markdown
# EXPLAIN.md

Questo plugin permette di gestire gli utenti del sistema.

## Funzionalità

- Creazione utenti
- Modifica utenti
- Eliminazione utenti

## Configurazione

Nel file `pluginConfig.json5` è possibile configurare...
```

### 3. Esempi di Codice

**Sempre includere esempi con blocchi di codice:**

````markdown
## Esempio di utilizzo

```js
const result = db.prepare('SELECT * FROM users').all();
console.log(result);
```

```json
{
  "active": 1,
  "custom": {
    "maxUsers": 100
  }
}
```
````

### 4. Note e Attenzioni

**Usare +++ per evidenziare note importanti:**

```markdown
+++ ATTENZIONE +++
Il path finale sarà prefissato con `${api_prefix}/${moduleName}`

+++ NOTA IMPORTANTE +++
Modificare le chiavi di sessione in produzione!
```

### 5. Struttura Standard di EXPLAIN.md

**Template consigliato:**

```markdown
# Nome del Plugin/Tema

Breve descrizione di cosa fa.

## Funzionalità

- Funzionalità 1
- Funzionalità 2
- Funzionalità 3

## Configurazione

### pluginConfig.json5

```json
{
  "active": 1,
  "custom": {
    "setting1": "valore1"
  }
}
```

Spiegazione dei parametri custom.

## Utilizzo

Come usare questo plugin/tema.

### Esempio

```js
// Codice di esempio
```

## Dipendenze

- `pluginName`: ^1.0.0 - descrizione
- `anotherPlugin`: ^2.0.0 - descrizione

## Note

Note aggiuntive e considerazioni.
```

---

## File EXPLAIN.md

### Esempio Completo: plugins/EXPLAIN.md

Il file `plugins/EXPLAIN.md` è la documentazione principale del sistema di plugin:

```markdown
il sistema di plugin funziona nel seguente modo:

1) ogni plugin ha la sua directory nella cartella plugins

2) il nome del plugin corrisponde col nome della directory che corrisponde
   anche al valore "name" all'interno di pluginDescription.json5 e tale nome
   dovrà essere senza spazi o caratteri speciali

3) all'interno di ogni cartella del plugin ci sarà un file con nome main.js
   che sarà il file che verrà caricato e poi eseguito

4) all'interno del file main.js ci saranno le seguenti funzioni:
   loadPlugin(), installPlugin(), unistallPlugin(), upgradePlugin(),
   getObjectToShare(), getRouteArray(), getMiddlewareToAdd()

# [continua con esempi di codice...]
```

### Esempio Completo: themes/EXPLAIN.md

```markdown
funzionamento dei temi,

il file config-theme.json5 contiene il file di configurazione del tema corrente

Es:

```json
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,
  "wwwCustomPath": 1,
  "pluginDependency": {},
  "nodeModuleDependency": {}
}
```
```

---

## Esempi Pratici

### Esempio 1: Plugin Completo

**File: plugins/exaplePlugin/main.js**

```javascript
const fs = require('fs');
const path = require('path');

let pluginConfig = require(`${__dirname}/pluginConfig.json5`); // let perchè può cambiare
const pluginName = path.basename(__dirname);
const sharedObject = {}; // oggetti condivisi con altri plugin

function loadPlugin() {
  console.log(`${pluginName} caricato!`);
}

function installPlugin() {
  // Logica di installazione
}

function unistallPlugin() {
  // Logica di disinstallazione
}

function upgradePlugin() {
  // Logica di aggiornamento
}

function getMiddlewareToAdd(app) {
  const middlewareArray = Array();

  // Esempio di middleware che logga le richieste
  middlewareArray.push(
    async (ctx, next) => {
      console.log(`${ctx.method} ${ctx.url}`);
      await next();
    }
  );

  return middlewareArray;
}

function getObjectToShareToWebPages() {
  return {
    greeting: 'Ciao dal plugin!'
  };
}

function getObjectToShareToOthersPlugin(pluginName) {
  // Personalizza cosa condividere per ogni plugin
  return {
    version: '1.0.0'
  };
}

function setSharedObject(pluginName, object) {
  sharedObject[pluginName] = object;
}

function getRouteArray() {
  const routeArray = Array();

  routeArray.push({
    method: 'GET',
    path: '/hello',
    handler: async (ctx) => {
      ctx.body = { message: 'Hello World!' };
    }
  });

  return routeArray;
}

function getHooksPage() {
  const HookMap = new Map();

  HookMap.set('head', (passData) =>
    '<meta name="my-plugin" content="active">'
  );

  return HookMap;
}

module.exports = {
  loadPlugin: loadPlugin,
  installPlugin: installPlugin,
  unistallPlugin: unistallPlugin,
  upgradePlugin: upgradePlugin,
  getObjectToShareToWebPages: getObjectToShareToWebPages,
  getObjectToShareToOthersPlugin: getObjectToShareToOthersPlugin,
  setSharedObject: setSharedObject,
  pluginName: pluginName,
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getHooksPage: getHooksPage,
  getMiddlewareToAdd: getMiddlewareToAdd
}
```

### Esempio 2: Route con Autenticazione

```javascript
function getRouteArray() {
  const routeArray = Array();

  // Route pubblica
  routeArray.push({
    method: 'GET',
    path: '/public',
    handler: async (ctx) => {
      ctx.body = { message: 'Accessibile a tutti' };
    }
  });

  // Route protetta
  routeArray.push({
    method: 'GET',
    path: '/private',
    handler: async (ctx) => {
      // Controllo autenticazione
      if (!ctx.session || !ctx.session.authenticated) {
        ctx.status = 401;
        ctx.body = { error: 'Non autenticato' };
        return;
      }

      // Logica per utenti autenticati
      ctx.body = {
        message: 'Dati riservati',
        user: ctx.session.user.username
      };
    }
  });

  // Route POST
  routeArray.push({
    method: 'POST',
    path: '/create',
    handler: async (ctx) => {
      const { name, email } = ctx.request.body;

      // Validazione
      if (!name || !email) {
        ctx.status = 400;
        ctx.body = { error: 'Parametri mancanti' };
        return;
      }

      // Elaborazione
      const db = sharedObject.dbApi.db;
      const stmt = db.prepare('INSERT INTO items (name, email) VALUES (?, ?)');
      const result = stmt.run(name, email);

      ctx.body = {
        success: true,
        id: result.lastInsertRowid
      };
    }
  });

  return routeArray;
}
```

### Esempio 3: Middleware di Protezione

```javascript
function getMiddlewareToAdd(app) {
  const middlewareArray = Array();

  // Middleware che protegge prefix specifici
  middlewareArray.push(
    async (ctx, next) => {
      // Lista dei prefix protetti
      const protectedPrefixes = ['/reserved', '/private', '/admin'];

      // Controlla se il path richiede autenticazione
      if (protectedPrefixes.some(prefix => ctx.path.startsWith(prefix))) {
        if (!ctx.session || !ctx.session.authenticated) {
          ctx.status = 401;
          ctx.body = {
            message: 'Accesso negato. Effettua il login per accedere.'
          };
          return; // Interrompe la catena di middleware
        }
      }

      await next(); // Passa al prossimo middleware
    }
  );

  // Middleware per logging
  middlewareArray.push(
    async (ctx, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      console.log(`${ctx.method} ${ctx.url} - ${ms}ms`);
    }
  );

  return middlewareArray;
}
```

### Esempio 4: Hook Page Avanzato

```javascript
function getHooksPage() {
  const HookMap = new Map();

  // Inietta CSS nel head
  HookMap.set('head', (passData) => {
    return `
      <link rel="stylesheet" href="/${passData.apiPrefix}/myPlugin/css/style.css">
      <meta name="my-plugin" content="v1.0">
    `;
  });

  // Inietta contenuto nell'header
  HookMap.set('header', (passData) => {
    // Mostra info solo se l'utente è loggato
    if (passData.ctx.session && passData.ctx.session.authenticated) {
      const username = passData.ctx.session.user.username;
      return `
        <div class="user-info">
          <p>Benvenuto, ${username}!</p>
        </div>
      `;
    }
    return ''; // Nessun contenuto se non loggato
  });

  // Inietta JavaScript prima della chiusura del body
  HookMap.set('script', (passData) => {
    return `
      <script>
        console.log('MyPlugin caricato!');
        const apiPrefix = '${passData.apiPrefix}';
      </script>
      <script src="/${passData.apiPrefix}/myPlugin/js/script.js"></script>
    `;
  });

  return HookMap;
}
```

### Esempio 5: Condivisione Oggetti tra Plugin

```javascript
// Plugin Provider (es: dbApi)
function getObjectToShareToOthersPlugin(pluginName) {
  // Creo database isolato per ogni plugin
  const pluginDbPath = path.join(__dirname, 'dbFile', 'pluginsDb', `${pluginName}.db`);
  const db = new Database(pluginDbPath);

  // Condivido oggetti diversi in base al plugin richiedente
  if (pluginName === 'adminUsers') {
    return {
      db: db,
      userDb: this.userDb,
      hashPassword: this.hashPassword
    };
  }

  // Default: condivido solo il database
  return { db: db };
}

// Plugin Consumer
function setSharedObject(pluginName, object) {
  // Ricevo oggetti da altri plugin
  if (pluginName === 'dbApi') {
    sharedObject.dbApi = object;
    this.db = object.db; // Riferimento locale
  }

  if (pluginName === 'adminUsers') {
    sharedObject.adminUsers = object;
    this.auth = object;
  }
}

function loadPlugin() {
  // Uso gli oggetti condivisi
  const db = sharedObject.dbApi.db;

  // Creo tabella
  db.exec(`
    CREATE TABLE IF NOT EXISTS my_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);
}
```

---

## Checklist per Nuovi Plugin

Quando crei un nuovo plugin, assicurati di:

- [ ] Creare directory con nome senza spazi o caratteri speciali
- [ ] Creare `main.js` con tutte le funzioni richieste
- [ ] Creare `pluginConfig.json5` con configurazione corretta
- [ ] Creare `pluginDescription.json5` con metadata
- [ ] Creare `EXPLAIN.md` con documentazione in italiano
- [ ] Usare commenti in italiano nel codice
- [ ] Usare `const` quando possibile, `let` con commento se necessario
- [ ] Usare `Array()` per inizializzare array
- [ ] Usare `Map()` per collezioni
- [ ] Usare `async/await` per operazioni asincrone
- [ ] Commentare abbondantemente il codice complesso
- [ ] Testare il plugin dopo l'implementazione

---

## Checklist per Nuovi Temi

Quando crei un nuovo tema, assicurati di:

- [ ] Creare directory nella cartella `themes/`
- [ ] Creare cartella `views/` con i partial:
  - [ ] `head.ejs`
  - [ ] `header.ejs`
  - [ ] `nav.ejs`
  - [ ] `main.ejs`
  - [ ] `aside.ejs`
  - [ ] `footer.ejs`
- [ ] Creare `config-theme.json5`
- [ ] Creare `README.md` o `EXPLAIN.md`
- [ ] Includere hooks di plugin nei partial
- [ ] Testare il tema attivandolo in `ital8Config.json5`

---

## Risorse Aggiuntive

### File di Riferimento

- `/plugins/EXPLAIN.md` - Documentazione completa del sistema plugin
- `/plugins/exaplePlugin/` - Plugin di esempio
- `/themes/EXPLAIN.md` - Documentazione del sistema temi
- `/themes/baseExampleTheme/` - Tema di esempio minimale
- `/themes/default/` - Tema completo di riferimento

### Documentazione Esterna

- [Koa.js Documentation](https://koajs.com/)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [EJS Documentation](https://ejs.co/)
- [Bootstrap 5 Documentation](https://getbootstrap.com/docs/5.3/)

---

**Ultima modifica:** 2025-11-19
**Versione:** 1.0.0
**Autore:** Italo Paesano + AI Assistant
