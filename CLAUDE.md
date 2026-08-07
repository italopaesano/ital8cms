# CLAUDE.md — Guida per assistenti AI di ital8cms

## Panoramica del progetto

**ital8cms** è un Content Management System modulare, basato su plugin, costruito su Node.js e Koa.js. L'architettura punta sull'estensibilità tramite un sofisticato sistema di plugin che supporta caricamento dinamico, risoluzione delle dipendenze e comunicazione tra plugin.

- **Versione:** 0.0.1-alpha.0 (Early Alpha)
- **Autore:** Italo Paesano (italopaesano@protonmail.com)
- **Licenza:** ISC
- **Linguaggio principale:** JavaScript (CommonJS)
- **Commenti nel codice:** Mix di italiano e inglese (l'autore è italiano)

### Filosofia di base

**Zero dipendenza da database:** ital8cms non richiede alcun DBMS per default. Il sistema core e i plugin usano **file JSON** per l'archiviazione di dati strutturati (account utente, ruoli, configurazioni) e **archiviazione su file** per le pagine web. Sistemi di database come SQLite sono **opzionali** e possono essere aggiunti tramite plugin quando servono per casi d'uso specifici.

**Approccio Developer-First:** ital8cms rifiuta l'approccio "zero-knowledge" di molte piattaforme CMS moderne. Questo è uno strumento **per sviluppatori, fatto da sviluppatori**:

- **I temi richiedono:** conoscenza di HTML, CSS, JavaScript e templating EJS
- **I plugin richiedono:** competenze di programmazione Node.js/JavaScript, comprensione del middleware Koa.js
- **La configurazione richiede:** creazione e modifica manuale di file JSON/JSON5
- **Nessun drag-and-drop:** tutta la personalizzazione avviene tramite codice e manipolazione di file

**Perché questo approccio?**
- ✅ **Controllo completo:** nessuna astrazione che nasconde la tecnologia sottostante
- ✅ **Flessibilità:** crei esattamente ciò di cui hai bisogno senza limitazioni della piattaforma
- ✅ **Performance:** nessun overhead da visual builder o layer di astrazione
- ✅ **Apprendimento:** capisci esattamente come funziona il tuo CMS
- ✅ **Debugging:** più facile tracciare i problemi in codice semplice rispetto a configurazioni generate

**Pubblico di riferimento:** sviluppatori web a proprio agio con Node.js, HTML/CSS e templating lato server. Non adatto a utenti non tecnici in cerca di un editor WYSIWYG.

### Dipendenze Mantenute dal Team

Il progetto ital8cms è anche manutentore del modulo npm **`koa-classic-server`**. Questo ha un'implicazione importante per la gestione dei bug:

**Regola:** Se durante lo sviluppo di ital8cms viene individuato un bug in `koa-classic-server`, **non si deve aggirarlo** con workaround locali nel codice di ital8cms. Si deve invece **segnalarlo al maintainer (Italo Paesano)** affinché venga corretto nel modulo originale, e successivamente aggiornare la dipendenza alla versione fixata.

**Motivazione:** Aggirare i bug nelle dipendenze che controlliamo direttamente:
- ❌ Accumula debito tecnico nel codice di ital8cms
- ❌ Nasconde il problema reale nel modulo
- ❌ Lascia il bug attivo per altri utilizzatori di `koa-classic-server`
- ✅ La correzione nel modulo risolve il problema alla radice per tutti

**Procedura quando si trova un bug in `koa-classic-server`:**
1. Descrivere il bug al maintainer (root cause, comportamento atteso, sistemi affetti)
2. Attendere la release con la fix
3. Aggiornare la versione in `package.json` con `npm install koa-classic-server@x.y.z`
4. Verificare che il comportamento sia corretto senza workaround nel codice ital8cms

**File di configurazione JSON5:** Tutti i file di configurazione (con estensione .json5) nel progetto (eccetto `package.json` e `package-lock.json`) sono processati con JSON5 e supportano commenti, virgole finali e altre funzionalità JSON5. Ogni file deve avere un commento sulla prima riga:

```javascript
// This file follows the JSON5 standard - comments and trailing commas are supported
```

**Caricamento dei file JSON:** Tutti i file JSON devono essere caricati usando il modulo centralizzato `core/loadJson5.js` (tutti i file di configurazione ora usano l'estensione .json5):

```javascript
const loadJson5 = require('./core/loadJson5');
const config = loadJson5('./ital8Config.json5');
```

**NON** usare `require()` direttamente per i file di configurazione `.json5` perché non supporta i commenti JSON5. Usa **SEMPRE** la funzione `loadJson5()` per caricare tutti i file di configurazione.

**Perché il nome loadJson5:** Il file si chiama `loadJson5.js` e la funzione è `loadJson5()` per mantenere una **simmetria perfetta** tra il nome del modulo e la funzione esportata, rendendo gli import chiari e intuitivi.

## Linee guida per l'assistente AI

Lavorando su questo codebase come AI assistant — regole operative (le più critiche per prime):

1. **`loadJson5()` SEMPRE** per leggere i file `.json5` (mai `require()`/`JSON.parse()`); scritture **atomiche** (temp + `rename`).
2. **Campo `access` obbligatorio** su ogni rotta di plugin (`getRouteArray`): assenza = **errore fatale al boot**. Metodo rotta in **MAIUSCOLO**, chiave `handler` (non `func`).
3. **Naming — OBBLIGATORIO:** prima di introdurre QUALSIASI nuovo nome (variabili, funzioni, file, directory, plugin, classi, costanti) proponi **almeno 2-3 alternative** significative (4-5+ se complesso) con breve spiegazione, e **attendi l'approvazione** del maintainer. Requisito **critico**, mai saltare.
4. **`koa-classic-server` (dipendenza del team):** se trovi un bug **non aggirarlo** localmente — segnalalo al maintainer e aggiorna alla versione fixata (vedi *Dipendenze Mantenute dal Team*).
5. **Sicurezza:** password con bcrypt; valida l'input; output **escapato** (XSS); redirect **validati** (open-redirect); il CSRF è gestito dal plugin `csrfProtection`.
6. **Documentazione — standard `ital8doc` v1-1** → [`docs/ITAL8DOC-latest.md`](./docs/ITAL8DOC-latest.md). Ogni plugin/tema ha `README.it.md` (obbligatorio) + `EXPLAIN.it.md` (opzionale, se interni non banali), con stub inglese `.md`. Quando tocchi un plugin/tema/sottosistema aggiorna il **suo** doc, non CLAUDE.md.
7. **Architettura a plugin:** la maggior parte delle feature va implementata come plugin; rispetta dipendenze e ordine di caricamento; segui i pattern esistenti (rotte, middleware, hook).
8. **Test:** dopo le modifiche verifica che il server parta, il plugin carichi, le rotte rispondano e l'auth funzioni (vedi *Testing* → `docs/testing.it.md`).
9. **Temi:** considera sia il tema pubblico sia quello admin.
10. **Commenti:** l'autore usa l'italiano; per i nuovi commenti preferisci l'inglese, rispettando gli esistenti.
11. **Progetto alpha** (v0.0.1-alpha.0): breaking changes accettabili ma documentati in `CHANGELOG.md`.
12. **Dipendenze escluse dagli update di routine:** `ccxt` (npm + plugin `ccxt`) e `dbApi`/`better-sqlite3` (plugin `dbApi`) **non** vanno aggiornati negli aggiornamenti di routine delle dipendenze — toccarli solo in un **intervento dedicato e pianificato** (motivi: ccxt ha release molto frequenti legate alle API degli exchange; `better-sqlite3` ha build nativa e il plugin `dbApi` è disabilitato).

## Struttura del codebase

```
/home/user/ital8cms/
├── index.js                      # Punto di ingresso principale dell'applicazione
├── ital8Config.json5              # File di configurazione centrale
├── package.json                 # Dipendenze Node.js
│
├── core/                        # Funzionalità core del CMS
│   ├── admin/                   # Admin System (architettura modulare)
│   │   ├── adminConfig.json5    # Configurazione admin centrale
│   │   ├── adminSystem.js       # Coordinatore admin
│   │   ├── lib/                 # Sottosistemi admin
│   │   │   ├── configManager.js # Caricamento e validazione config
│   │   │   ├── adminServicesManager.js # Service discovery
│   │   │   └── symlinkManager.js # Gestore symlink per le sezioni dei plugin
│   │   └── webPages/           # Template EJS admin
│   │       ├── index.ejs       # Dashboard admin (menu dinamico)
│   │       ├── systemSettings/  # Sezioni admin hardcoded
│   │       └── usersManagment/  # SYMLINK → plugins/adminUsers/adminWebSections/usersManagment/
│   ├── priorityMiddlewares/    # Config dei middleware critici
│   │   └── koaSession.json5     # Configurazione della sessione
│   ├── pluginSys.js            # Gestore del sistema plugin
│   ├── themeSys.js             # Gestore del sistema temi
│   └── loadJson5.js            # Utility di caricamento file JSON5
│
├── plugins/                     # Moduli plugin (ciascuno autoconsistente)
│   ├── dbApi/                  # Plugin Database API
│   │   ├── main.js             # Logica del plugin
│   │   ├── pluginConfig.json5   # Configurazione del plugin
│   │   ├── pluginDescription.json5 # Metadata del plugin
│   │   └── dbFile/             # File del database SQLite
│   ├── adminUsers/             # Plugin admin: gestione utenti e ruoli
│   │   ├── main.js             # Logica del plugin
│   │   ├── pluginConfig.json5   # Config del plugin (con array adminSections)
│   │   ├── pluginDescription.json5 # Metadata del plugin
│   │   ├── adminWebSections/   # Directory contenitore delle sezioni admin
│   │   │   ├── usersManagment/ # File della sezione admin (serviti via symlink)
│   │   │   │   ├── index.ejs   # Pagina lista utenti
│   │   │   │   ├── userView.ejs # Visualizza dettagli utente
│   │   │   │   ├── userUpsert.ejs # Crea/modifica utente
│   │   │   │   └── userDelete.ejs # Elimina utente
│   │   │   └── rolesManagment/ # Sezione gestione ruoli
│   │   │       └── index.ejs   # Pagina gestione ruoli
│   │   ├── userAccount.json5    # Credenziali utente (hashate con bcrypt)
│   │   ├── userRole.json5       # Definizioni dei ruoli
│   │   ├── userManagement.js   # Logica gestione utenti
│   │   └── roleManagement.js   # Logica gestione ruoli
│   ├── admin/                  # Plugin funzionalità core admin
│   ├── bootstrap/              # Integrazione CSS/JS di Bootstrap
│   ├── media/                  # Gestione media
│   ├── ccxt/                   # API exchange di criptovalute
│   └── ostrukUtility/          # Funzioni di utilità
│
├── themes/                      # Template dei temi
│   ├── default/                # Tema di default
│   │   ├── views/              # Partial del tema
│   │   │   ├── head.ejs        # Head HTML
│   │   │   ├── header.ejs      # Sezione header
│   │   │   ├── nav.ejs         # Navigazione
│   │   │   ├── main.ejs        # Area contenuto principale
│   │   │   ├── aside.ejs       # Sidebar
│   │   │   └── footer.ejs      # Footer + script
│   │   └── templates/          # Template di pagina completi
│   └── baseExampleTheme/       # Tema di esempio
│
└── www/                         # Web root pubblica
    └── index.ejs               # Homepage pubblica
```

## Stack tecnologico

### Backend
- **Framework:** Koa.js v3.2.0 (web framework basato su async/await)
- **Routing:** @koa/router v15.5.0
- **Middleware:** koa-bodyparser, koa-session, koa-classic-server v5.1.0
- **Archiviazione dati:** file JSON (nessun database richiesto)
- **Autenticazione:** bcryptjs v3.0.3 (hashing delle password)
- **Template Engine:** EJS v6.0.1
- **Utilità:** semver v7.8.0 (versioning delle dipendenze)

### Frontend
- **UI Framework:** Bootstrap v5.3.8
- **Templating:** rendering EJS lato server

### Sviluppo
- **Auto-reload:** nodemon v3.1.14
- **Controllo versione:** Git

### Dipendenze opzionali dei plugin
- **better-sqlite3:** database SQLite (via plugin dbApi - attualmente disabilitato)
- **ccxt v4.1.70:** integrazione exchange di criptovalute (via plugin ccxt)

## Flusso di avvio dell'applicazione

Comprendere la sequenza di inizializzazione è fondamentale:

1. **Carica l'applicazione Koa** (`index.js`)
2. **Inizializza i Priority Middleware:**
   - Body parser (parsing delle richieste) - **CORE** (sempre attivo)
   - Sessioni (stato di autenticazione) - **OPZIONALE** (configurabile in `ital8Config.json5`)
   - Router (routing degli URL) - **CORE** (sempre attivo)
   - L'ordine è fisso e garantito: bodyParser → session → router
3. **Ciclo di vita config** (prima del caricamento plugin/temi — vedi [`docs/decisions/config-lifecycle.it.md`](./docs/decisions/config-lifecycle.it.md)):
   - **Gate di init:** se manca `ital8Config.json5` ma esiste il suo `.default` → box `[INIT]` che indirizza a `npm run start-configure` + `exit` (senza config globale non si conosce nemmeno la porta).
   - **Materializza i vivi mancanti** (`materializeMissingConfigs` su `plugins/` e `themes/`): crea i `x.json5` mancanti copiando i rispettivi `x.default.json5` (atomico, zero interazione), così i config esistono quando i plugin/temi li leggono.
   - **`isInstalled` dei temi bundled** (`ensureThemesInstalled`): i `.default` non portano `isInstalled` (stato runtime); per i temi bundled (con `.default`) il cui vivo ne è privo, persiste `isInstalled: 1`. Gemello, per i temi, della persistenza fatta da `pluginSys`.
   - **Drift di `schemaVersion`** (`reconcileSchemaVersions` su `plugins/`, `themes/` e i 3 core): se un `.default` ha `schemaVersion` più recente del vivo, **merge additivo ricorsivo** (aggiunge le chiavi nuove a qualsiasi profondità, valori esistenti intatti) + box `[SCHEMA]`. Il box segnala anche il caso `unresolved`: bump senza alcuna chiave da aggiungere su un vivo già versionato → il cambiamento è un valore, una rinomina o una rimozione, che il merge non sa applicare. Migrazione vera → `migrations/` ([`docs/decisions/config-migrations.it.md`](./docs/decisions/config-migrations.it.md)).
4. **Inizializza il sistema plugin** (`pluginSys`)
5. **Carica i plugin attivi** (boot **graceful**, vedi *Stati dei plugin* sotto):
   - Calcola lo **stato** di ogni plugin (`available`/`disabled`/`incomplete`/`installed`); carica solo gli `installed`
   - Risolve le dipendenze e carica nell'ordine delle dipendenze; un fallimento (`throw`, dep mancante/incompatibile, ciclo) → skip + marcatura `incomplete` + box `[PLUGINS]`, **mai** boot bloccato — salvo gli `essentialPlugins` (un essenziale non caricato → box `[FATAL]` + exit)
   - Persiste `isInstalled` nel `pluginConfig.json5` vivo (Variante 1); `installPlugin()` gira solo alla transizione `isInstalled` non-1→1
   - Chiama `loadPlugin()` su ciascuno; aggiunge i metadata (`pluginName`, `pathPluginFolder`); condivide oggetti tra i plugin
6. **Registra le rotte dei plugin:**
   - Prefisso: `/${apiPrefix}/${pluginName}`
   - Default: `/api/{pluginName}/...`
7. **Carica i middleware dei plugin**
8. **Inizializza il sistema temi** (`themeSys`)
9. **Inizializza l'Admin System** (se `enableAdmin: true`):
   - **Fase 1:** Crea l'istanza AdminSystem
   - **Fase 2:** Collega le dipendenze (injection bidirezionale per evitare riferimenti circolari)
     - `adminSystem.setPluginSys(pluginSys)`
     - `pluginSys.setAdminSystem(adminSystem)`
   - **Fase 3:** Inizializza AdminSystem
     - Valida i symlink esistenti
     - Processa i plugin admin (crea i symlink per le sezioni)
     - Carica i servizi dalla configurazione
9. **Configura gli static server:**
   - Sito pubblico: directory `/www` → `/`
   - Pannello admin: `/core/admin/webPages` → `/admin`
10. **Avvia il server HTTP** (porta 3000 di default)

## Architettura del sistema plugin

Il sistema plugin è il cuore di ital8cms. Deep-dive completo (meccanica interna, esempi, validazione dipendenze, logging): [`core/EXPLAIN-pluginsSys.it.md`](./core/EXPLAIN-pluginsSys.it.md).

### Struttura plugin

Minima (obbligatoria): `main.js`, `pluginConfig.json5`, `pluginDescription.json5`. Convenzione **fortemente raccomandata** per plugin che servono pagine HTML: directory `webPages/` (separa logica e template, come nel plugin di riferimento `adminUsers`). Plugin solo-API (es. `bootstrap`, `simpleI18n`) non ne hanno bisogno.

### Export di `main.js`

```javascript
module.exports = {
  // ciclo di vita
  async loadPlugin(pluginSys, pathPluginFolder) {},
  async installPlugin(pluginSys, pathPluginFolder) {},
  async uninstallPlugin(pluginSys, pathPluginFolder) {},
  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {},
  getRouteArray() { return [] },                                   // rotte API
  getMiddlewareToAdd(pluginSys, pathPluginFolder) { return [] },   // middleware
  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) { return {} }, // condividi → plugin
  setSharedObject(fromPlugin, sharedObject) {},                    // ricevi condivisione
  getObjectToShareToWebPages() { return {} },                     // funzioni template LOCALI
  getGlobalFunctionsForTemplates() { return {} },                 // funzioni template GLOBALI (whitelist)
  getHooksPage(section, passData, pluginSys, pathPluginFolder) { return "" }, // hook di pagina
  getWritablePaths(pluginSys, pathPluginFolder) { return [] }     // data dir scrivibili (gate di boot, vedi sotto)
}
```

**Data dir scrivibili (`getWritablePaths`):** un plugin che scrive dati propri su disco a runtime (data dir che crea pigramente e su cui scrive) **deve** dichiararla con `getWritablePaths(pluginSys, pathPluginFolder) → Array<{ path, purpose }>`. Al boot `pluginSys` la sonda con una scrittura **effettiva** (crea la dir + write/delete di un file temporaneo, pre-creandola); se una dir dichiarata **non** è scrivibile (FS read-only, sandbox systemd senza `ReadWritePaths=`, permessi/owner errati, disco pieno) quel plugin è **saltato in modo graceful** (box `[STORAGE]`, il boot prosegue; un `essentialPlugin` resta fatale). Il path va risolto **offline dal config** (`custom.dataPath`), perché il gate gira **prima** di `loadPlugin` e il wizard introspeziona i plugin senza caricarli; le scritture a runtime devono essere **fail-soft** (atomiche + try/catch, mai lanciare). Modulo: `core/storageWritabilityCheck.js`; riferimento reale: plugin `analytics`; esempio didattico: `plugins/exampleComplete/`.

### Config del plugin

- `pluginConfig.json5`: `schemaVersion` (intero, versione della *struttura* del file), `active` (0/1), `isInstalled`, `weight` (priorità, minore = caricato prima), `dependency` (semver), `nodeModuleDependency`, `custom` (impostazioni specifiche).
- `pluginDescription.json5`: `name`, `version`, `description`, `author`, `email`, `license`.

**Sidecar `*.default.json5` (ciclo di vita dei config):** ogni file di configurazione modificabile ha un sidecar **`x.default.json5`** committato (fonte di verità) accanto al **`x.json5`** vivo. Vale anche per i **pacchetti di terze parti** installabili da repo Git: il descrittore `.default` è **obbligatorio**, i vivi **non vanno pubblicati** (se presenti l'installazione li scarta e li rigenera dal default, con warning). Al boot i vivi mancanti sono **materializzati** dai default (`materializeMissingConfigs`); il **reset** (`npm run cli -- reset <plugin>`, offline o `--online`) li rimuove per farli rigenerare. Nei `*.default.json5` dei descrittori `schemaVersion` è la **prima chiave** e `isInstalled` è **assente** (è stato runtime, scritto al boot). **Tutti i vivi sono git-ignored** (contenuto, dati utente, descrittori `pluginConfig`/`themeConfig` e core `ital8Config`/`adminConfig`/`koaSession`) — rigenerabili dai `.default` (la migrazione repo è completa, fasi 0–5). Se un `.default` evolve la struttura (bump di `schemaVersion`), al boot `reconcileSchemaVersions` fa il **merge additivo ricorsivo** sui vivi (chiavi nuove a ogni profondità) + box `[SCHEMA]`. Il merge copre le sole **aggiunte**: per rinomine, rimozioni e cambi di valore il pacchetto dichiara una **migrazione** nella sua cartella `migrations/` (vedi *Migrazione dei config*). Oltre a `isInstalled`, è stato runtime del vivo anche **`version`** (ultima versione per cui `upgradePlugin()` è girato): assente dai `.default`. → [`docs/decisions/config-lifecycle.it.md`](./docs/decisions/config-lifecycle.it.md) · [`config-migrations.it.md`](./docs/decisions/config-migrations.it.md).

### Migrazione dei config (`migrations/`)

Il merge additivo sa solo **aggiungere** chiavi. Quando un `.default` evolve con una **rinomina, una rimozione o un cambio di valore**, il pacchetto deve dichiarare una migrazione: cartella `migrations/` (opzionale ma raccomandata) dentro il plugin o il tema, più `core/migrations/{ital8Config,adminConfig,koaSession}/` per i config globali.

- **Clock:** la `schemaVersion` del **descrittore** (`pluginConfig.default.json5` / `themeConfig.default.json5`) è la versione di struttura dell'intero pacchetto; per i core è il file stesso. Se cambi un config secondario, **bumpa anche il descrittore**, altrimenti il runner non parte. Nessuno stato da persistere: "dove sta questa installazione" **è** la `schemaVersion` del vivo.
- **Contenuto:** `migrations.json5` (indice degli `steps`), `CHANGELOG.md`, e per ogni salto `from-vN-to-vM.md` (sezioni fisse, azionabile da umano o AI), `from-vN-to-vM.js` opzionale, `from-vN-to-vM/` per i materiali.
- **Tre strategie**, derivate senza campi extra: `automatic: true` **senza** script → basta il merge ricorsivo (caso più frequente); `automatic: true` **con** script → rinomine/rimozioni/valori; `automatic: false` → umano o AI guidato dal `.md`, sbloccato da `verify()` o `--confirm-manual`. `reason` è **obbligatorio sempre**, anche nel caso automatico.
- **Esecuzione:** il boot **rileva** e basta (box `[MIGRATE]`); si applica con `npm run cli -- migrate <target>` (`--dry-run`, `--theme`, `--confirm-manual`). L'auto-apply degli step automatici richiede `ital8Config.json5 → migrations.autoApply: true` (default `false`). Backup automatico dei file in `touches` prima di ogni step.
- **La `schemaVersion` avanza solo a esito riuscito** (è una ricevuta, non un contatore di tentativi), e i config con una migrazione pendente sono **esclusi** dal merge additivo — che altrimenti li allineerebbe bruciando il trigger.
- Negli script preferisci `setJson5Key`/`editJson5` a un `saveJson5` dell'oggetto intero: quest'ultimo **perde i commenti** del config vivo.

→ [`docs/decisions/config-migrations.it.md`](./docs/decisions/config-migrations.it.md) · modulo: `core/migrationRunner.js`

### Ordine di caricamento

1. **weight** crescente → 2. **risoluzione dipendenze** (prima le dipendenze) → 3. **alfabetico** (a parità di weight). I plugin caricati dopo dispongono di quelli caricati prima.

### Stati dei plugin (boot graceful)

`pluginSys.initialize()` calcola a ogni boot lo **stato** di ciascun plugin (`pluginStateResolver` — modulo puro: `checkNpmDeps` + `resolvePluginStates` con cascata a punto fisso e rilevamento cicli). Vengono caricati **solo** i plugin `installed`. Getter: `getPluginState(name)` / `getPluginStates()`.

| Stato | Significato |
|---|---|
| `available` | nessun `pluginConfig.json5` vivo (mai preso in carico) |
| `disabled` | `active != 1` |
| `incomplete` | preso in carico ma **precondizioni mancanti** (dep npm/plugin assenti o incompatibili, ciclo, errore di `loadPlugin`) |
| `installed` | precondizioni soddisfatte → caricato |

- **Boot graceful:** un fallimento (`throw`, dep mancante/incompatibile, ciclo) **non** blocca l'avvio — il plugin è marcato `incomplete`, i suoi dipendenti cascata a `incomplete`, e un box `[PLUGINS]` riepiloga. Il boot **completa sempre**.
- **`essentialPlugins`** (lista in `ital8Config.json5`, default `adminUsers`/`adminAccessControl`/`admin`): un essenziale non caricato → box `[FATAL]` + `process.exit` (un sito con auth/access-control rotti non va servito).
- **`isInstalled` = "precondizioni soddisfatte" (Variante 1):** persistito nel vivo via `setJson5Key` (add-or-update preservando i commenti); `installPlugin()` gira solo alla transizione `isInstalled` non-1→1 (clone fresco / dipendenze appena risolte → installazione automatica). I **temi** seguono un modello più semplice: bundled (con `.default`) = installati per definizione (`ensureThemesInstalled` scrive `isInstalled: 1` al boot).

### Comunicazione tra plugin

- **Pull (runtime, on-demand):** `pluginSys.getSharedObject(providerPluginName, callerName?)` → l'oggetto condiviso, o `null` se il provider non è attivo / non implementa `getObjectToShareToOthersPlugin()`. `callerName` opzionale → il provider può personalizzare la risposta per consumer. Ideale in route handler/middleware/framework.
- **Push (al boot):** `setSharedObject(fromPlugin, sharedObject)`, automatico e per-consumer. Ideale per dipendenze plugin-to-plugin.

### Rotte API dei plugin

Pattern: `/${apiPrefix}/${pluginName}/${path}` (default `/api/{pluginName}/...`).

**⚠️ CONTRATTO CRITICO dell'oggetto rotta** — ogni rotta DEVE avere:

| Proprietà | Obbligo | Note |
|-----------|---------|------|
| `method` | sì | **MAIUSCOLO**: `'GET'`, `'POST'`, `'PUT'`, `'DEL'`, `'ALL'` |
| `path` | sì | es. `'/hello'` |
| `handler` | sì | `async (ctx) => { ... }` |
| `access` | sì | controllo accessi (vedi Sistema di controllo accessi) |

> **WARNING:** `method` minuscolo (`'get'`) o `func` invece di `handler` → la rotta viene **silenziosamente ignorata** da `pluginSys.loadRoutes()` e la richiesta cade sul static server (HTML invece di JSON). Il campo `access` è **obbligatorio**: la sua assenza causa **errore fatale al boot** (vedi Sistema di controllo accessi).

```javascript
getRouteArray() {
  return [{
    method: 'GET', path: '/hello',
    access: { requiresAuth: false, allowedRoles: [] },
    handler: async (ctx) => { ctx.body = 'Hello World' }
  }]
}
```

### Page hooks

`getHooksPage(section, passData, ...)` restituisce HTML da iniettare nella pagina. Sezioni disponibili: `head`, `header`, `body`, `footer`, `script`.

### Funzioni globali nei template (whitelist)

I plugin possono esporre funzioni come helper **globali** negli EJS (senza il prefisso `passData.plugin.{nome}`). Modello a **whitelist** in 3 parti:
1. Whitelist in `ital8Config.json5 → globalFunctionsWhitelist` (per funzione: `plugin`, `description?`, `required`: `true`=fail-fast / `false`=fallback con warning).
2. Il plugin dichiara i candidati con `getGlobalFunctionsForTemplates()`.
3. `pluginSys.getGlobalFunctions()` valida e registra **solo** le funzioni autorizzate dalla whitelist.

Entrambe le sintassi funzionano sempre: globale `<%- __(...) %>` e locale `<%- passData.plugin.simpleI18n.__(...) %>`. Esempio attuale: `__()` (traduzioni, da `simpleI18n`).

## Sistema Plugin Pages

I plugin servono pagine pubbliche **senza definire endpoint** in `getRouteArray()`: basta creare una directory `webPages/`. Il sistema (`core/pluginPagesSystem.js`) la auto-rileva e crea un **symlink** `/pluginPages/{plugin}/` → `/plugins/{plugin}/webPages/` (zero duplicazione). URL pubblico: `/pluginPages/{pluginName}/{file.ejs}` (prefisso `pluginPagesPrefix`).

Nel template si usano i partial del tema + i metodi di iniezione (senza parametri, auto-detection di plugin/pagina dal path):

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<%- passData.themeSys.injectPluginCss() %>   <%# anche injectPluginJs / injectPluginHtmlBefore / injectPluginHtmlAfter %>
```

Le personalizzazioni del tema vivono in `themes/{tema}/pluginsEndpointsMarkup/{plugin}/{pagina}/` (`style.css`, `script.js`, `before-content.html`, `after-content.html`). **GET** servite automaticamente dal sistema; **POST** restano in `getRouteArray()` (`/api/{plugin}/...`).

> 📖 Deep-dive completo (architettura symlink, API `PluginPagesSystem`, auto-cleanup al boot, passData, init flow, debugging): [`core/EXPLAIN-pluginPages.it.md`](./core/EXPLAIN-pluginPages.it.md).

## Sistema dei temi

Struttura tema: `views/` (partial `head`/`header`/`nav`/`main`/`aside`/`footer`), `templates/`, `themeResources/` (css/js/img), `themeConfig.json5` (flag `isAdminTheme`), `themeDescription.json5`.

**Configurazione** (`ital8Config.json5`): `activeTheme` (sito pubblico), `adminActiveTheme` (admin, richiede `isAdminTheme: true`), `publicThemeResourcesPrefix`, `adminThemeResourcesPrefix`.

**API unificata** — lo stesso codice funziona in contesto pubblico e admin (il sistema sceglie il tema da `passData.isAdminContext`):

```ejs
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>
<link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
<%- await pluginSys.hookPage("head", passData) %>
```

- `getThemePartPath(part)` → path del partial del tema attivo
- `getThemeResourceUrl(resource)` → URL risorsa (`/public-theme-resources/...` o `/admin-theme-resources/...`)
- `pluginSys.hookPage(section, passData)` → punti di hook dei plugin (`head`, `header`, `script`, …)

> 📖 Deep-dive (validazione, dipendenze, asset, personalizzazione endpoint plugin, API completa): [`core/EXPLAIN-themeSys.it.md`](./core/EXPLAIN-themeSys.it.md).
> Nota: il campo tema `active` è stato **rimosso** (la fonte di verità è `ital8Config.json5`); `isInstalled` resta e indica "tema pronto per l'attivazione". Decisione: [`docs/decisions/theme-active-isinstalled.it.md`](./docs/decisions/theme-active-isinstalled.it.md).
> **Ciclo di vita (config-lifecycle, Fase 5):** il descrittore è committato come `themeConfig.default.json5` (senza `isInstalled` né `active`); il vivo `themeConfig.json5` è git-ignored e materializzato al boot. Per i temi **bundled** (con `.default`) `core/ensureThemesInstalled.js` scrive `isInstalled: 1` al boot ("installati per definizione"); i temi **clonati** via `themesInstall` (senza `.default`) partono a `isInstalled: 0` (attivazione manuale dell'admin).

## Bootstrap Navbar / URL Redirect / Admin Bootstrap Navbar

Plugin documentati nei rispettivi doc (uso, configurazione, API, esempi):

- **bootstrapNavbar** — genera navbar Bootstrap 5 (`horizontal`/`vertical`/`offcanvas`) da file `navbar.{name}.json5`: visibilità per auth/ruoli, auto-active, dropdown, separatori, `settingsOverrides`, `configDir` (con protezione path-traversal), caching prod/debug. Esposto ai template: `passData.plugin.bootstrapNavbar.render({name, configDir?, settingsOverrides?}, passData)`. → [`plugins/bootstrapNavbar/EXPLAIN.md`](./plugins/bootstrapNavbar/EXPLAIN.md)
- **urlRedirect** — redirect 301/302 con pattern exact / wildcard (`*`, `**`) / `regex:`, first-match-wins (ordine array in `redirectMap.json5`), hit counter, preservazione query string. Pure middleware, intercetta solo le GET. → [`plugins/urlRedirect/README.md`](./plugins/urlRedirect/README.md)
- **adminBootstrapNavbar** — twin admin GUI (sezione `navbarsManagement`) per creare/editare/validare/preview i file navbar: editor JSON5, 5 template, file picker, soft-delete con backup. → [`plugins/adminBootstrapNavbar/README.md`](./plugins/adminBootstrapNavbar/README.md)

> Scaffolding rapido di una navbar: skill `ital8cms-bootstrapNavbar-creator`.

## Architettura del sistema admin

Architettura modulare che permette ai plugin di fornire funzionalità admin tramite un'interfaccia unificata (sezioni dinamiche via symlink + sezioni hardcoded). Deep-dive completo (symlink, service discovery, init 2-fasi, menu dinamico, API, troubleshooting): [`core/admin/EXPLAIN.it.md`](./core/admin/EXPLAIN.it.md).

### Contratti essenziali

- **Naming OBBLIGATORIO:** un plugin admin **deve** chiamarsi `admin*` (es. `adminUsers`, `adminMailer`). Il prefisso `admin` è il criterio di rilevamento automatico.
- **Sezioni:** il plugin dichiara `adminSections` (array di sectionId) in `pluginConfig.json5`. Ogni sectionId richiede la directory `plugins/{plugin}/adminWebSections/{sectionId}/`.
- **Metadata UI centralizzati:** label, icon, description e ordine menu vivono in `/core/admin/adminConfig.json5` (NON nel plugin; un `adminConfig.json5` dentro il plugin è deprecato).
- **Serving via symlink (zero duplicazione):** `core/admin/webPages/{sectionId}` → `plugins/{plugin}/adminWebSections/{sectionId}/`, servito su `/admin/{sectionId}/...`.

### Tipi di sezione (in `adminConfig.json5`)

- `"plugin"`: gestita da un plugin, servita via symlink (campi: `plugin`, `enabled`, `required`, `label`, `icon`, `description`).
- `"hardcoded"`: file statici in `core/admin/webPages/{sectionId}/` (campi: `enabled`, `label`, `url`, `icon`).

### Service discovery

I plugin forniscono servizi backend (auth, email, storage…) dichiarati in `adminConfig.json5 → services`. Uso: `adminSystem.getService('auth')`, `adminSystem.getEndpointsForPassData()`.

### API AdminSystem (in `passData.adminSystem`)

`getUI()` · `getMenuSections()` (filtrate per enabled/plugin attivo) · `getService(name)` · `getEndpointsForPassData()`.

### Init 2-fasi (anti dipendenze circolari)

PluginSys e AdminSystem si collegano via dependency injection: `adminSystem.setPluginSys()` / `pluginSys.setAdminSystem()` → poi `adminSystem.initialize()` (valida symlink, processa i plugin admin, carica i servizi).


### Best Practice per i plugin admin — Twin Admin Plugin (`admin<Name>`)

Un **service plugin** che necessita di una UI di configurazione/gestione **DOVREBBE distribuire la propria interfaccia admin come plugin admin "twin" separato**, denominato `admin` + il nome del service plugin con la prima lettera maiuscola (camelCase preservato). Il service plugin resta snello (solo logica); il twin admin possiede la GUI.

**Coppie consolidate:**

| Service plugin | Twin admin plugin |
|----------------|-------------------|
| `seo` | `adminSeo` |
| `bootstrapNavbar` | `adminBootstrapNavbar` |
| `media` | `adminMedia` |
| `analytics` | `adminAnalytics` |
| `rateLimiter` | `adminRateLimiter` |

**Divisione delle responsabilità:**

- **Service plugin** — logica di dominio, stato runtime, l'API a oggetto condiviso e i propri file di configurazione `.json5` (es. `protectedRoutes.json5`). **Nessuna UI admin.**
- **Twin admin plugin** — la/le sezione/i admin (GUI). Dipende dal service plugin (`dependency: { "<service>": "^x.y.z" }`), risolve la cartella del service via `pluginSys.getPlugin('<service>').pathPluginFolder` per leggere/scrivere i suoi file di configurazione, e recupera il suo oggetto condiviso via `pluginSys.getSharedObject('<service>')` per dati live e azioni.

**Perché separare:**
- ✅ Il service resta utilizzabile **headless** — installabile/eseguibile senza il twin admin (nessun peso della GUI, nessuna dipendenza admin).
- ✅ Chiara separazione delle responsabilità — il twin admin può essere disabilitato o rimosso in modo indipendente.
- ✅ Discovery coerente — i plugin admin sono auto-rilevati dal prefisso `admin` e servono le sezioni via symlink.

**Casi speciali:** alcuni plugin iniziali combinano service + admin in un unico plugin con nome admin (`adminUsers`, `adminAccessControl`) perché il loro dominio è esso stesso admin-centrico. Per i **nuovi** service plugin, preferisci la separazione in twin.

### Convenzioni Admin GUI — Le Tre Viste

I plugin admin che forniscono una UI dovrebbero seguire una filosofia condivisa così che il pannello resti coerente e ogni plugin rimanga sia adatto ai power-user sia accessibile. Il principio: **una sezione admin espone fino a tre "viste" coordinate sullo stesso stato/file sottostante**, aggiunte secondo necessità.

#### Le tre viste

| Vista | Scopo | Quando | Implementazione di riferimento |
|------|---------|------|--------------------------|
| **A. Data view** | Visualizzare stato/metriche (per lo più in lettura) + azioni live | **Obbligatoria** ogniqualvolta il plugin ha stato runtime o statistiche | `adminAnalytics/analyticsManagement` (card KPI + Chart.js + auto-refresh) |
| **B. Editor JSON5 raw** | Modificare direttamente il vero file `.json5` | **Sempre presente per la configurazione** | `adminAccessControl` (puro); `adminSeo/pageRules` (editor + snippet + tabella di riferimento + modal modifiche non salvate) |
| **C. Form strutturato** | Editing guidato, validato, campo per campo | Opzionale; raccomandato per config ricche/complesse | `adminSeo/globalSettings` (form a tab + toolbar JSON5 + badge di stato feature) |

- **A** è irrinunciabile quando ci sono dati da mostrare: non costringere mai un admin a leggere file raw per capire lo stato live.
- **B** è la verità di base e il fallback: sempre disponibile per la config, così un power user — o un campo che il form non copre ancora — non è mai bloccato.
- **C** è zucchero sopra B per config complesse; non sostituisce mai B.

#### Regole di coordinamento (B ↔ C)

Quando sia il form (C) sia l'editor raw (B) sono presenti, modificano lo **stesso file**:
1. **Fonte di verità unica** = il file `.json5` su disco.
2. **Validazione condivisa**, sempre **lato server** prima di qualsiasi salvataggio (riusa il validatore del service plugin stesso).
3. **Switch esplicito** tra le viste ("carica form da JSON5" / "rigenera JSON5 dal form") con un **avviso modifiche non salvate** (modal), come in `adminSeo/pageRules`.
4. **Scritture atomiche** (temp + rename) + backup dove ha senso (come in `adminBootstrapNavbar`).

#### Regole trasversali (sempre)

- **i18n** tramite l'helper globale `__()` (it/en).
- **Bootstrap 5, responsive** — i tab collassano in un `<select>` su mobile (vedi `adminSeo/globalSettings`).
- **Output XSS-escaped** per il contenuto dinamico, specialmente i dati controllati dall'utente (IP, URL) — usa `escapeHtml`.
- **Controllo accessi**: le rotte dichiarano `access` con i ruoli corretti; config sensibile → `[0, 1]` (root/admin).
- **Propagazione**: preferisci l'**hot-reload** (il service plugin espone `reload*()` sul suo oggetto condiviso); per le impostazioni create una sola volta al boot, offri **"Salva e riavvia"** (`pluginSys.requestRestart`) — sicuro quando il plugin persiste il suo stato tra i riavvii.
- **Azioni live** (se il plugin ha stato runtime) passano per l'**oggetto condiviso** (stesso processo) per effetto immediato — nessun round-trip su file.

#### Guida alle decisioni

| La sezione gestisce… | Fornisci le viste |
|----------------------|---------------|
| Solo dati/metriche | A |
| Config semplice, tabellare | B (+ assistenze) |
| Config ricca/complessa | B + C (coordinate) |
| Dati **e** config | A + B (+ C), come tab della sezione |

#### Checklist per una nuova admin GUI

- [ ] Twin admin plugin denominato `admin<Service>`, dipendente dal service plugin
- [ ] Data view con refresh live se c'è stato runtime/metriche
- [ ] Editor JSON5 raw per ogni file di configurazione modificabile (Valida + Salva)
- [ ] Form strutturato opzionale coordinato con l'editor JSON5 (validatore condiviso)
- [ ] Validazione lato server + scrittura atomica (+ backup) ad ogni salvataggio
- [ ] Label i18n, tab responsive, output escapato
- [ ] Ruoli `access` corretti su tutte le rotte
- [ ] Hot-reload via oggetto condiviso, oppure "Salva e riavvia" per le impostazioni al boot

## Strategia di archiviazione dati

### Filosofia di base: basata su file, senza database

**ital8cms NON richiede alcun sistema di gestione database (DBMS) per funzionare.** Il sistema core è progettato per funzionare interamente con file JSON per i dati strutturati e archiviazione su file per i contenuti.

### Archiviazione primaria: file JSON

**Archiviazione dati strutturati:**
- **Account utente:** `/plugins/adminUsers/userAccount.json5`
- **Ruoli utente:** `/plugins/adminUsers/userRole.json5`
- **Configurazioni dei plugin:** ogni plugin ha `pluginConfig.json5`
- **Impostazioni dell'applicazione:** `ital8Config.json5`
- **Configurazione admin:** `/core/admin/adminConfig.json5`

**Default vs vivi (ciclo di vita dei config):** ogni file di configurazione modificabile esiste come coppia **`x.default.json5`** (committato, fonte di verità) + **`x.json5`** (vivo, generato dal default al boot da `materializeMissingConfigs`). **Tutti i vivi sono git-ignored** e rigenerabili — contenuto/dati utente (`userAccount`, `userRole`, `seoPages`, `redirectMap`…), descrittori (`pluginConfig`, `themeConfig`) e core (`ital8Config`, `adminConfig`, `koaSession`); solo i `.default` sono versionati (migrazione repo completa, fasi 0–5). Il pacchetto npm è "vergine" (solo `.default`): npm ricade su `.gitignore`, quindi nessun `.npmignore` necessario. → [`docs/decisions/config-lifecycle.it.md`](./docs/decisions/config-lifecycle.it.md).

**Perché JSON?**
- ✅ Zero dipendenze - nessuna installazione di database richiesta
- ✅ Deploy semplice - basta copiare i file
- ✅ Backup facile - operazioni standard del file system
- ✅ Leggibile dall'uomo - può essere modificato manualmente se necessario
- ✅ Compatibile col controllo versione - Git può tracciare le modifiche
- ✅ Perfetto per dataset piccoli e medi

### Archiviazione dei contenuti: basata su file

**Pagine web:**
- **Template:** file EJS in `/www` e `/themes`
- **Contenuto statico:** HTML, CSS, JavaScript serviti direttamente
- **Pagine admin:** file EJS in `/core/admin/webPages`

**File media:**
- Gestiti dal plugin media
- Archiviati come file in directory specifiche del plugin

### Opzionale: database via plugin

**Quando serve un database:**
Database come SQLite possono essere aggiunti tramite plugin quando hai bisogno di:
- Query complesse con JOIN
- Ricerca full-text
- Dati relazionali con molte relazioni
- Dataset di grandi dimensioni che richiedono indicizzazione
- Transazioni ACID

**Plugin dbApi (attualmente disabilitato):**

Il plugin `dbApi` fornisce l'integrazione SQLite:

```javascript
// Enable in plugins/dbApi/pluginConfig.json5
{
  "active": 1,  // Set to 1 to enable
  "nodeModuleDependency": {
    "better-sqlite3": "^9.2.2"
  }
}
```

Poi installa la dipendenza:
```bash
npm install better-sqlite3
```

**Posizione del database quando abilitato:**
```
plugins/dbApi/dbFile/
├── mainDb.db              # Database principale dell'applicazione
├── webDb.db               # Dati condivisi col web (disponibili nei template)
└── pluginsDb/             # Database per-plugin
    ├── admin.db
    ├── media.db
    └── ...
```

**Accesso al database nei plugin (quando dbApi è attivo):**

```javascript
async loadPlugin(pluginSys, pathPluginFolder) {
  const dbApi = pluginSys.getSharedObject('dbApi')
  if (dbApi) {
    this.db = dbApi.db  // SQLite database available
  }
}
```

### Operazioni sui file JSON5

**IMPORTANTE:** Tutti i file di configurazione usano l'estensione `.json5` e **DEVONO** essere caricati usando la funzione `loadJson5()`, non `require()` o `JSON.parse()`.

**Lettura dei dati JSON5:**
```javascript
const path = require('path')
const loadJson5 = require('../../core/loadJson5')

// Read user accounts using loadJson5
const userAccountPath = path.join(pathPluginFolder, 'userAccount.json5')
const users = loadJson5(userAccountPath)
```

**Scrittura dei dati JSON5:**
```javascript
const fs = require('fs')

// Update user accounts
fs.writeFileSync(
  userAccountPath,
  JSON.stringify(users, null, 2),
  'utf8'
)
```

**Scritture atomiche (più sicure):**
```javascript
// Write to temp file first, then rename (atomic operation)
const tempPath = userAccountPath + '.tmp'
fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), 'utf8')
fs.renameSync(tempPath, userAccountPath)
```

## Autenticazione e autorizzazione

### Sistema di autenticazione (plugin adminUsers)

**Flusso di login:**
1. L'utente invia username/password a `/api/adminUsers/login` (POST)
2. Il plugin valida le credenziali rispetto a `userAccount.json5`
3. La password è verificata con bcryptjs
4. Sessione creata: `ctx.session.authenticated = true`, `ctx.session.user = userData`
5. Il cookie di sessione viene inviato al client

**Flusso di logout:**
1. L'utente accede a `/api/adminUsers/logout` (POST)
2. Sessione distrutta: `ctx.session = null`

**Gestione della sessione:**
- Cookie firmati con chiavi segrete
- Durata massima: 24 ore (86400000ms)
- Configurazione: `/core/priorityMiddlewares/koaSession.json5`

### Sistema di autorizzazione (RBAC multi-ruolo)

**Architettura multi-ruolo:**
- Gli utenti possono avere **più ruoli** simultaneamente tramite l'array `roleIds`
- I ruoli sono controllati con la logica `roleIds.includes(roleId)`
- Esempio: un utente può essere sia `admin` (1) sia avere ruoli custom

**Ruoli di sistema hardcoded (0-99):**
- **0 (root):** accesso completo al sistema, incluse le operazioni critiche
- **1 (admin):** accesso completo a tutte le risorse admin
- **2 (editor):** crea, legge, aggiorna, elimina TUTTI i contenuti (compresi quelli di altri utenti)
- **3 (selfEditor):** crea, legge, aggiorna, elimina SOLO i PROPRI contenuti

**Ruoli custom (100+):**
- Ruoli definiti dall'utente creati tramite il pannello admin
- Gestiti via `/admin/rolesManagment/`
- ID auto-incrementale a partire da 100
- Possono essere assegnati/rimossi dagli utenti dinamicamente

**Struttura dati dei ruoli:**
Situata in `/plugins/adminUsers/userRole.json5`
```json5
{
  "roles": {
    "0": { "name": "root", "description": "...", "isHardcoded": true },
    "1": { "name": "admin", "description": "...", "isHardcoded": true },
    "100": { "name": "contentModerator", "description": "...", "isHardcoded": false }
  }
}
```

**Struttura dati dell'utente:**
Situata in `/plugins/adminUsers/userAccount.json5`
```json5
{
  "username": {
    "email": "user@example.com",
    "hashPassword": "$2b$10$...",
    "roleIds": [1, 100]  // Array of role IDs
  }
}
```

### Sistema di controllo accessi (adminAccessControl)

Controllo accessi basato su pattern (esatto / wildcard `*`,`**` / `regex:`) con **priorità automatica** (il più specifico vince), regole **hardcoded immutabili** + **custom** in `accessControl.json5`, e campo **`access` obbligatorio** su ogni rotta di plugin (la sua assenza causa errore fatale al boot). Admin UI con editor JSON5 e validazione (sintassi, ruoli, conflitti, immutabilità hardcoded). → [`plugins/adminAccessControl/README.it.md`](./plugins/adminAccessControl/README.it.md) · [`EXPLAIN.it.md`](./plugins/adminAccessControl/EXPLAIN.it.md)

### SEO · Rate Limiter · Admin Rate Limiter

Plugin con documentazione propria:

- **seo** — meta tag, Open Graph, Twitter Cards, canonical, JSON-LD, generazione di `sitemap.xml`/`robots.txt`; regole per-pagina (`seoPages.json5`, pattern matching), feature toggle individuali, multilingua (Strada B3, indipendente da simpleI18n). → [`plugins/seo/EXPLAIN.md`](./plugins/seo/EXPLAIN.md)
- **rateLimiter** — anti brute-force a escalation (short→long block), chiave `IP+ruleName`, guard (oggetto condiviso, invocato nell'handler) + middleware di enforcement, stato persistente cross-restart, audit JSONL. → [`plugins/rateLimiter/README.md`](./plugins/rateLimiter/README.md) · [`EXPLAIN.md`](./plugins/rateLimiter/EXPLAIN.md)
- **adminRateLimiter** — twin admin GUI (sezione `rateLimiterManagement`): KPI, blocchi attivi, ban/unblock live, editor JSON5 di regole e impostazioni (Tre Viste). → [`plugins/adminRateLimiter/README.md`](./plugins/adminRateLimiter/README.md) · [`EXPLAIN.md`](./plugins/adminRateLimiter/EXPLAIN.md)

### CSRF Protection · Admin CSRF Protection

Protezione CSRF (difesa in profondità: token sincronizzatore per-sessione + controllo Origin/Referer, enforcement nel route-wrap del core prima del controllo auth) e il suo twin admin GUI. Documentati nei rispettivi doc:

- **csrfProtection** → [`plugins/csrfProtection/README.it.md`](./plugins/csrfProtection/README.it.md) · [`EXPLAIN.it.md`](./plugins/csrfProtection/EXPLAIN.it.md)
- **adminCsrfProtection** (sezione admin `csrfManagement`) → [`plugins/adminCsrfProtection/README.it.md`](./plugins/adminCsrfProtection/README.it.md) · [`EXPLAIN.it.md`](./plugins/adminCsrfProtection/EXPLAIN.it.md)

> Hardening correlato (difesa in profondità): `SameSite=lax` sul cookie di sessione in `core/priorityMiddlewares/koaSession.json5`.

### Controllo dell'autenticazione nel codice

```javascript
// In route handler
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}

// Access user data
const username = ctx.session.user.username
const roleIds = ctx.session.user.roleIds  // Array of role IDs

// Check if user has specific role
if (roleIds.includes(0)) {
  // User has root role
}

if (roleIds.includes(1)) {
  // User has admin role
}

// Check if user has ANY of specified roles
const hasAdminAccess = roleIds.some(id => [0, 1].includes(id))
```

### Controllo dell'autenticazione nei template

```ejs
<% if (passData.ctx.session.authenticated) { %>
  <p>Welcome, <%= passData.ctx.session.user.username %>!</p>
<% } else { %>
  <p><a href="/api/adminUsers/login">Login</a></p>
<% } %>
```

## Pattern delle rotte API

### Rotte API standard

Tutte le rotte dei plugin hanno il prefisso: `/api/{pluginName}/...`

### Rotte del plugin AdminUsers

**Autenticazione:**
```
GET  /api/adminUsers/login         # Display login form
POST /api/adminUsers/login         # Authenticate user
GET  /api/adminUsers/logout        # Display logout confirmation
POST /api/adminUsers/logout        # End session
GET  /api/adminUsers/logged        # Check login status (JSON)
```

**Gestione utenti:**
```
GET  /api/adminUsers/userList      # List all users (protected)
GET  /api/adminUsers/userInfo      # Get user details (protected)
POST /api/adminUsers/usertUser     # Create/update user (protected)
```

**Gestione ruoli:**
```
GET  /api/adminUsers/roleList           # List all roles (hardcoded + custom)
GET  /api/adminUsers/customRoleList     # List only custom roles
GET  /api/adminUsers/hardcodedRoleList  # List only hardcoded roles
POST /api/adminUsers/createCustomRole   # Create new custom role
POST /api/adminUsers/updateCustomRole   # Update existing custom role
POST /api/adminUsers/deleteCustomRole   # Delete custom role (removes from users)
```

### Rotte del plugin Bootstrap

```
GET /api/bootstrap/css/bootstrap.min.css
GET /api/bootstrap/css/bootstrap.min.css.map
GET /api/bootstrap/js/bootstrap.bundle.min.js
GET /api/bootstrap/js/bootstrap.bundle.min.js.map
```

### Creazione di nuove rotte

1. Aggiungi la definizione della rotta nel `getRouteArray()` del plugin:

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'GET',
      path: '/my-endpoint',
      handler: async (ctx) => {
        ctx.body = { message: 'Hello' }
      }
    },
    {
      method: 'POST',
      path: '/create-item',
      handler: async (ctx) => {
        const data = ctx.request.body
        // Process data
        ctx.body = { success: true }
      }
    }
  ]
}
```

2. La rotta diventa disponibile su: `/api/yourPlugin/my-endpoint`

## Gestione della configurazione

### Configurazione principale: ital8Config.json5

```json
{
  "apiPrefix": "api",                 // API route prefix (change if needed)
  "adminPrefix": "admin",             // Admin panel path
  "enableAdmin": true,                // Enable/disable admin panel
  "viewsPrefix": "views",             // Views route prefix
  "baseThemePath": "../",             // Theme path base
  "activeTheme": "default",           // Public theme
  "adminActiveTheme": "default",      // Admin theme
  "wwwPath": "/www",                  // Public web root
  "debugMode": 1,                     // Debug level (0=off, 1=on)
  "httpPort": 3000,                   // HTTP port

  // HTTPS configuration (see "HTTPS Configuration" section for full docs)
  "https": {
    "enabled": false,                         // true = abilita HTTPS
    "port": 443,                              // Porta HTTPS
    "AutoRedirectHttpPortToHttpsPort": false, // true = redirect 301 HTTP→HTTPS
    "certFile": "./certs/fullchain.pem",      // Certificato server
    "keyFile": "./certs/privkey.pem",         // Chiave privata
    "caFile": "",                             // CA intermedia (opzionale)
    "tlsOptions": {},                         // Opzioni TLS avanzate (opzionale)
  },

  // Hide file extension from URLs (clean URLs, requires koa-classic-server v2.6.1+)
  "hideExtension": {
    "wwwPath":            { "enabled": false, "ext": ".ejs" },
    "pluginPagesPrefix":  { "enabled": false, "ext": ".ejs" },
    "adminPrefix":        { "enabled": false, "ext": ".ejs" }
  },

  // Priority Middlewares Configuration
  "priorityMiddlewares": {
    "session": true             // Optional middleware (true=enabled, false=disabled)
  }
}
```

### Hide Extension (Clean URLs)

La funzionalità `hideExtension` sfrutta `koa-classic-server` v2.6.1+ per servire le pagine senza l'estensione del file nell'URL. Ciascuna delle tre istanze koa-classic-server che renderizzano EJS può essere configurata in modo indipendente.

**Configurazione in `ital8Config.json5`:**

```json5
{
  "hideExtension": {
    "wwwPath":            { "enabled": false, "ext": ".ejs" },
    "pluginPagesPrefix":  { "enabled": false, "ext": ".ejs" },
    "adminPrefix":        { "enabled": false, "ext": ".ejs" }
  }
}
```

**Campi:**

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `enabled` | boolean | `true` = nasconde l'estensione, `false` = mostra l'estensione (default) |
| `ext` | string | Estensione da nascondere, incluso il punto (es. `".ejs"`, `".pug"`) |

**Contesti:**

| Chiave | Istanza koa-classic-server | Esempio URL (abilitato) |
|-----|----------------------------|----------------------|
| `wwwPath` | Pagine pubbliche (`/www`) | `/about` invece di `/about.ejs` |
| `pluginPagesPrefix` | Pagine dei plugin (`/pluginPages/`) | `/pluginPages/adminUsers/login` invece di `/pluginPages/adminUsers/login.ejs` |
| `adminPrefix` | Pagine admin (`/admin/`) | `/admin/usersManagment/index` invece di `/admin/usersManagment/index.ejs` |

**Retrocompatibilità:** Quando abilitata, i link esistenti con l'estensione (es. `/about.ejs`) continuano a funzionare tramite redirect automatico fornito da `koa-classic-server`.

**Non applicata a:** le istanze delle risorse del tema (pubblico e admin) poiché servono asset statici (CSS, JS, immagini) le cui estensioni dovrebbero restare visibili.

**Uso futuro:** Il campo `ext` per-contesto permette template engine diversi per contesto (es. `wwwPath` che usa `".pug"` mentre `adminPrefix` usa `".ejs"`).

### Configurazione dei Priority Middleware

I priority middleware vengono caricati **prima di ogni altra cosa** in un ordine fisso e garantito. Forniscono l'infrastruttura di base per l'intera applicazione.

**Configurazione in `ital8Config.json5`:**

```json5
{
  "priorityMiddlewares": {
    "session": true  // Gestione sessioni (true = attivo, false = disattivato)
  }
}
```

**Tipi di middleware:**

| Middleware | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| `bodyParser` | **CORE** | Sempre attivo | Effettua il parsing del corpo delle richieste (JSON, form data). **Hardcoded, non configurabile**. |
| `session` | **OPZIONALE** | `true` | Gestisce le sessioni utente (koa-session). Richiesto per l'autenticazione. |
| `router` | **CORE** | Sempre attivo | Sistema di routing principale (@koa/router). **Hardcoded, non configurabile**. |

**Ordine di caricamento (fisso, non modificabile):**
```
1. bodyParser  → Parse request body
2. session     → Initialize ctx.session (if enabled)
3. router      → Route matching and handler execution
```

**Perché questo ordine:**
- `bodyParser` DEVE essere primo → altrimenti `ctx.request.body` è undefined nei route handler
- `session` DEVE precedere `router` → altrimenti `ctx.session` è undefined nei route handler
- `router` DEVE essere ultimo → può usare body e sessione in sicurezza in tutti i route handler

**Disabilitare i middleware opzionali:**

```json5
{
  "priorityMiddlewares": {
    "session": false  // Disable session management
  }
}
```

⚠️ **Attenzione:** Disabilitare `session` comporterà:
- `ctx.session` `undefined` in tutto il codice
- Il fallimento dei plugin di autenticazione (come `adminUsers`)
- Il login del pannello admin smetterà di funzionare

**Disabilitare solo se:** la tua applicazione non necessita affatto di autenticazione utente.

### Configurazione HTTPS

Configurazione completa spostata in [`docs/https.it.md`](./docs/https.it.md).

### Configurazione della sessione: core/priorityMiddlewares/koaSession.json5

**IMPORTANTE:** Le chiavi (`keys`) firmano i cookie di sessione (`signed: true`). I valori committed nel repo sono **placeholder condivisi**: chiunque cloni il progetto li conosce e potrebbe forgiare cookie di sessione validi (impersonazione). **Vanno sostituiti con chiavi casuali in produzione.**

```json5
{
  "keys": [ /* placeholder committati — sostituire con chiavi casuali */ ],
  "CONFIG": {
    "key": "koa:sess",
    "maxAge": 86400000,               // 24 hours
    "autoCommit": true,
    "overwrite": true,
    "httpOnly": true,
    "signed": true,
    "rolling": false,
    "renew": false,
    "sameSite": "lax"                 // difesa in profondità anti-CSRF
  }
}
```

#### Rotazione automatica delle chiavi (install + boot)

Due meccanismi coordinati gestiscono la sicurezza delle chiavi:

**1. Wizard d'installazione (`npm run start-configure`)** — In FASE 1 (configurazione globale) il wizard propone uno step dedicato alle chiavi di sessione (`scripts/lib/sessionKeyManager.js`):

- Menu a tre voci: **Genera nuove chiavi casuali** / **Inserisci chiavi personalizzate** / **Mantieni le chiavi correnti**.
- **Default adattivo:** "Genera" se le chiavi correnti sono i placeholder, "Mantieni" se già personalizzate (evita di invalidare sessioni esistenti in una re-init).
- Generazione: **3 chiavi** `crypto.randomBytes(32).toString('base64url')` (256-bit, URL-safe).
- Scrittura tramite `core/editJson5` (sostituisce **solo** il campo `keys`, preservando tutti i commenti) con backup preventivo via `BackupManager`. I valori delle chiavi **non** vengono mai loggati.
- Gira sia per il profilo `production` sia `demo`; saltato solo nella re-init `plugins`.

**2. Avviso al boot (`core/sessionSecurity.js → checkSessionKeys()`)** — All'avvio del server (`index.js`), se la sessione è attiva e le chiavi sono ancora placeholder, viene emesso un box ASCII di warning (stile `httpsManager.warnMissingCertificates()`). Il server parte comunque (non bloccante). Salta da sé se la sessione è disabilitata.

**Fonte unica della logica di rilevamento** (`core/sessionSecurity.js`): la denylist `PLACEHOLDER_SESSION_KEYS` e il predicato `keysAreInsecure(keys)` sono condivisi tra il wizard (install-time) e il warning al boot (runtime), mantenendo la direzione di dipendenza corretta (tooling → core).

### Configurazione specifica del plugin

Il `pluginConfig.json5` di ogni plugin:

```json
{
  "custom": {
    "myPluginSetting": "value",
    "featureEnabled": true,
    "maxItems": 100
  }
}
```

Accesso nel codice:

```javascript
const loadJson5 = require('../../core/loadJson5')
const path = require('path')
const config = loadJson5(path.join(__dirname, 'pluginConfig.json5'))
const mySetting = config.custom.myPluginSetting
```

## Riferimento dell'oggetto passData

L'oggetto `passData` è disponibile in tutti i template EJS e contiene:

```javascript
{
  apiPrefix: "api",              // API route prefix
  adminPrefix: "admin",          // Admin path (only in admin pages)
  pluginSys: pluginSys,          // Plugin system instance
  plugin: {                      // Plugin shared objects
    dbApi: { db: ... },
    adminUsers: { ... },
    // ... other plugins
  },
  themeSys: themeSys,            // Theme system instance
  filePath: "/path/to/file.ejs", // Current template path
  href: "http://...",            // Full request URL
  query: { ... },                // URL query parameters
  ctx: ctx                       // Full Koa context
}
```

### Uso comune di passData

```ejs
<!-- Access plugin shared objects -->
<% const db = passData.plugin.dbApi.db %>

<!-- Check authentication -->
<% if (passData.ctx.session.authenticated) { %>
  <!-- Authenticated content -->
<% } %>

<!-- Access query parameters -->
<% const page = passData.query.page || 1 %>

<!-- Get current URL -->
<p>Current URL: <%= passData.href %></p>

<!-- Call plugin hooks -->
<%- await passData.pluginSys.hookPage('header', passData) %>
```

## Flussi di sviluppo

### Avvio

```bash
npm install        # dipendenze (+ postinstall: deps-sync per i plugin self-contained)
npm start          # avvio in produzione (node index.js)
npm run dev        # avvio con auto-reload (nodemon) — sviluppo
```
Server su `http://localhost:3000`.

> **Aggiornamento del CMS / backup:** `npm run update` (self-update da release
> GitHub, strada B/git), `npm run backup` / `restore` / `backup-list` /
> `backup-manager`, `npm run deps-sync`. Modello **ibrido per-plugin** delle
> dipendenze npm (plugin con `package.json` proprio → `node_modules` locale;
> pilota `adminMedia`). → [`docs/self-update.it.md`](./docs/self-update.it.md).

> **Control plane CLI (`ital8cms-cli`):** pilota un'istanza **in esecuzione** via
> socket UNIX locale (tipicamente in SSH). `npm run cli -- status` /
> `admin start|stop` (attiva/disattiva l'area admin, con riavvio) /
> `public start|stop` (manutenzione del sito pubblico, senza riavvio) /
> `reserved start|stop` (superficie riservata, senza riavvio) /
> `publicOnly on|off` (assetto sito vetrina, con riavvio) /
> `reset <target>` (offline o `--online`). Config: `ital8Config.json5 → cli` e
> `maintenance`. Sorgenti: `bin/ital8cms-cli.js` + `core/cliBridge/`.
> → [`docs/cli-control-plane.it.md`](./docs/cli-control-plane.it.md).
>
> Quattro punti da ricordare (verificati sul campo, vedi la guida):
> 1. **Il `--` con `npm run`:** i posizionali passano anche senza, ma i **flag**
>    (`--json`, `--theme`, …) sono intercettati da npm e **scartati in silenzio**
>    (`npm run cli reset X --theme` agisce su `plugins/X`, non su `themes/X`).
>    Usa **sempre** `--`. Il binario globale `ital8cms-cli` esiste solo dopo
>    `npm link` / `npm install -g .`.
> 2. **`admin`/`public`/`reserved`/`publicOnly` sono gruppi di sottocomandi:**
>    `admin stop`, non `stop`.
> 3. **`public stop` è montato prima del router** → 503 anche su `/api/*` e
>    `/pluginPages/*`; restano esenti i due prefissi admin più i percorsi in
>    `maintenance.exemptPaths` (default: pagina di login + endpoint di
>    autenticazione, così un admin sloggato può rientrare; `[]` = massima chiusura).
> 4. **`reserved` CONTIENE `admin`:** `reserved stop` rende il pannello
>    irraggiungibile anche con `enableAdmin: true` (`status` lo dichiara).

#### Superficie riservata (`reserved`) — perimetro derivato

Tutto ciò che sta **dietro l'autenticazione** si chiude con un comando, e il
perimetro **si deriva da dichiarazioni già obbligatorie** invece di essere un
elenco da mantenere:

| Sorgente | Criterio | Enforcement |
|---|---|---|
| `access.requiresAuth: true` | rotta autenticata | route-wrap di `pluginSys` |
| `access.isAuthEntryPoint: true` | rotta **pubblica** che appartiene comunque alla superficie riservata (login, logout, sonde) | route-wrap di `pluginSys` |
| regola di `accessControl.json5` con `requiresAuth`/`isAuthEntryPoint` | pagina riservata | middleware di `adminAccessControl` |
| prefissi `adminPrefix` / `adminThemeResourcesPrefix` + indice dei path riservati | pannello, risorse tema admin, e il **405** di `allowedMethods()` | `createReservedGate` |

Un plugin nuovo eredita il comportamento **senza dichiarare nulla**: `access` è già
obbligatorio. Il marcatore `isAuthEntryPoint` serve **solo** alle rotte/pagine
pubbliche per necessità. **La risposta è sempre 404** (mai 403, mai redirect) e
**nella forma che il sito userebbe per quella famiglia di path**: `text/plain` di
Koa sotto `apiPrefix` (nessuno static server serve `/api/*`), pagina HTML del file
server altrove. Un test d'integrazione confronta byte per byte con un 404
autentico: una risposta "quasi uguale" rende comunque enumerabile la superficie.
Con anche `public stop` le esenzioni del maintenance gate sono **sospese** → 503
uniforme. Nei template: `passData.reservedClosed`.

Modulo: `core/priorityMiddlewares/runtimeGate.js` (ospita entrambi i gate a runtime:
il maintenance **esenta** i due prefissi admin, il reserved li **prende di mira**).

### Creare plugin / temi (usa le skill di scaffolding)

- **Plugin:** skill `ital8cms-plugin-creator` (minimal / con webPages / admin / con funzioni globali). Riferimento completo: `plugins/exampleComplete/` + `core/EXPLAIN-pluginsSys.it.md`. Struttura minima: `main.js` + `pluginConfig.json5` + `pluginDescription.json5`; aggiungi `webPages/` per le pagine HTML (vedi *Sistema Plugin Pages*).
- **Tema:** skill `ital8cms-theme-creator`. Deep-dive: `core/EXPLAIN-themeSys.it.md`. Attivazione: `activeTheme`/`adminActiveTheme` in `ital8Config.json5`.
- **Altre skill:** `ital8cms-bootstrapNavbar-creator` (navbar), `ital8cms-simpleI18n-integrator` (i18n), `ital8cms-website-builder` (sito completo).

### Pagine admin

Crea `core/admin/webPages/{sezione}/index.ejs` (per i plugin admin: via `adminWebSections/` + symlink, vedi *Architettura del sistema admin*). Usa gli stessi partial del tema (`getThemePartPath`): con `passData.isAdminContext === true` viene caricato automaticamente il tema admin.

### Gestione utenti

Pannello admin: `/admin/usersManagment/` (utenti) e `/admin/rolesManagment/` (ruoli). Dati in `plugins/adminUsers/userAccount.json5` e `userRole.json5`.

### Operazioni dati (JSON5)

```javascript
const loadJson5 = require('../../core/loadJson5')
const data = loadJson5(path.join(pathPluginFolder, 'data.json5'))
// scrittura ATOMICA (temp + rename):
fs.writeFileSync(dataPath + '.tmp', JSON.stringify(data, null, 2), 'utf8')
fs.renameSync(dataPath + '.tmp', dataPath)
```
Database opzionale via plugin `dbApi` (vedi *Strategia di archiviazione dati*).

## Convenzioni di codice e best practice

### Convenzioni di naming

- **Variabili/Funzioni:** camelCase (`myVariable`, `myFunction`)
- **Classi:** PascalCase (`PluginSystem`, `ThemeSystem`)
- **File/Directory:** camelCase (`myPlugin`, `userManagement`)
- **Costanti:** UPPER_SNAKE_CASE (`MAX_ITEMS`, `API_PREFIX`)

#### Convenzione per i nomi di file composti

Per i file con più parti semantiche, segui l'**ordine naturale delle parole inglesi** (sostantivo + descrittore):

**Pattern:** `{primaryNoun}{descriptor}.{extension}`

**Esempi:**
```
✅ CORRECT:
pluginConfig.json5          // "plugin configuration" - natural order
pluginDescription.json5     // "plugin description" - natural order
userAccount.json5           // "user account" - natural order
sessionManager.js          // "session manager" - natural order
ital8Config.json5           // "ital8 configuration" - natural order

❌ INCORRECT:
configPlugin.json          // "configuration plugin" - unnatural
descriptionPlugin.json     // "description plugin" - unnatural
accountUser.json           // "account user" - unnatural
managerSession.js          // "manager session" - unnatural
```

**Perché questa convenzione:**
- ✅ Segue la semantica naturale dell'inglese ("plugin config" non "config plugin")
- ✅ Raggruppa alfabeticamente i file correlati (tutti i file del plugin insieme)
- ✅ Corrisponde ai pattern di naming moderni di JavaScript (`package.json`, `tsconfig.json`)
- ✅ Più leggibile e intuitiva per gli sviluppatori

#### Nomi significativi e intuitivi

**REQUISITO CRITICO:** Ogni nome nel codebase (variabili, funzioni, file, directory, classi, costanti, ecc.) DEVE essere scelto con cura e avere un significato simbolico il più intuitivo possibile.

**Processo per aggiungere nuovi nomi:**

1. **Non usare mai nomi placeholder** come `temp`, `data`, `obj`, `thing`, ecc. a meno che non rappresentino davvero concetti temporanei o generici
2. **Proponi sempre alternative** prima di implementare:
   - Quando devi introdurre un nuovo nome, **proponi SEMPRE almeno 2-3 alternative** significative (o più quando appropriato) al maintainer del progetto
   - Per i casi semplici: 2-3 alternative sono di solito sufficienti
   - Per naming complessi o critici: proponi 4-5+ alternative per offrire più scelta
   - Fornisci una breve spiegazione di cosa rappresenta ciascuna alternativa
   - Attendi la scelta del maintainer prima di procedere con l'implementazione
3. **Solo dopo l'approvazione** dovresti continuare a scrivere il codice con il nome scelto

**Esempi:**

```javascript
// ❌ BAD - Generic, unclear names
let data = getUserInfo()
function processData(obj) { ... }
const temp = calculateValue()

// ✅ GOOD - Descriptive, meaningful names
let userProfile = getUserInfo()
function validateUserCredentials(credentials) { ... }
const monthlyRevenue = calculateValue()
```

**Perché è importante:**
- ✅ **Leggibilità:** il codice diventa autodocumentante
- ✅ **Manutenibilità:** più facile capire l'intento a distanza di mesi
- ✅ **Collaborazione:** altri sviluppatori capiscono immediatamente lo scopo
- ✅ **Debugging:** nomi chiari rendono molto più facile tracciare i problemi
- ✅ **Ricercabilità:** nomi significativi sono più facili da trovare nel codebase

**Quando proponi alternative:**

Prima di creare:
- Un nuovo plugin: proponi nomi di plugin (es. `userAuth`, `simpleLogin`, `accessControl`)
- Una nuova variabile: proponi nomi di variabili (es. `userSession`, `activeUser`, `currentAccount`)
- Un nuovo file: proponi nomi di file (es. `sessionManager.js`, `authHandler.js`, `userValidator.js`)
- Una nuova funzione: proponi nomi di funzioni (es. `validateUserEmail()`, `checkEmailFormat()`, `verifyEmailAddress()`)

**Formato per le proposte:**

Quando proponi nomi al maintainer, usa questo formato:

```
I need to create [what you're naming]. Here are my suggestions:

Option 1: [name1] - [brief explanation]
Option 2: [name2] - [brief explanation]
Option 3: [name3] - [brief explanation]
[Option 4, 5, etc. - add more alternatives when appropriate for complex cases]

Which would you prefer, or would you like to suggest a different name?
```

### Pattern JavaScript

- **Sistema di moduli:** CommonJS (`require`, `module.exports`)
- **Async:** Usa sempre `async/await`, mai callback
- **Middleware:** `async (ctx, next) => { await next() }`

### Organizzazione dei file

- **Logica core:** directory `/core`
- **Estensioni:** directory `/plugins` (autoconsistenti)
- **UI:** directory `/themes` (componibili)
- **Pubblico:** directory `/www` (statico + EJS)

### Commenti

- Molti commenti sono in italiano (lingua madre dell'autore)
- I nomi di API e variabili sono in inglese
- Quando aggiungi commenti, preferisci l'inglese per la collaborazione internazionale
- Documenta accuratamente la logica complessa

### Gestione degli errori

```javascript
// Good: Try-catch for database operations
try {
  const result = db.prepare('SELECT * FROM items').all()
  ctx.body = result
} catch (error) {
  console.error('Database error:', error)
  ctx.status = 500
  ctx.body = { error: 'Internal server error' }
}

// Good: Validation
if (!username || !password) {
  ctx.status = 400
  ctx.body = { error: 'Username and password required' }
  return
}
```

### Best practice di sicurezza

1. **Password:** Usa sempre l'hashing bcrypt
```javascript
const bcrypt = require('bcryptjs')
const hashedPassword = await bcrypt.hash(password, 10)
const isValid = await bcrypt.compare(password, hashedPassword)
```

2. **Sessioni:** Cambia le chiavi di sessione di default in produzione

3. **Validazione dell'input:** Valida tutto l'input dell'utente
```javascript
// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) {
  return { error: 'Invalid email format' }
}

// Username validation
if (!/^[a-zA-Z0-9_-]{3,}$/.test(username)) {
  return { error: 'Invalid username' }
}
```

4. **SQL Injection:** Usa prepared statement
```javascript
// Good
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)

// Bad - vulnerable to SQL injection
const user = db.prepare(`SELECT * FROM users WHERE id = ${userId}`).get()
```

5. **Rotte protette:** Controlla l'autenticazione
```javascript
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}
```

6. **Prevenzione XSS nei template EJS**

Il progetto usa una strategia di **difesa in profondità** con due livelli:

**Livello 1 — Sanitizzazione lato server (difesa primaria):**

Tutti gli endpoint API che restituiscono dati controllati dall'utente DEVONO effettuare l'escape dell'HTML prima di inviarli ai template:

```javascript
const escapeHtml = require('../../core/escapeHtml');

// In route handler — escape before sending to template
ctx.body = {
  username: escapeHtml(user.username),
  email: escapeHtml(user.email)
};
```

**Livello 2 — Sanitizzazione lato client (difesa in profondità):**

Il tema admin include `escapeHtml.js` globalmente via `head.ejs`. Usalo quando inserisci contenuto dinamico tramite `innerHTML`:

```javascript
// Client-side — always escape before innerHTML
element.innerHTML = `<td>${escapeHtml(userData.username)}</td>`;
```

**Regole dei tag EJS:**

| Tag | Uso | Sicuro da XSS? |
|-----|-------|-----------|
| `<%= value %>` | Output con escape HTML | ✅ Sì |
| `<%- value %>` | Output HTML raw (senza escape) | ❌ No — usalo solo per HTML fidato (include del tema, hook dei plugin) |

```ejs
<%# SAFE — escaped output %>
<p>Welcome, <%= passData.ctx.session.user.username %></p>

<%# SAFE — trusted theme include %>
<%- include(passData.themeSys.getThemePartPath('head.ejs')) %>

<%# DANGEROUS — never use <%- with user data %>
<%# <%- userInput %> → XSS vulnerability! %>
```

**Passaggio della config al JS client — usa variabili JS, NON span nascosti:**

```ejs
<%# CORRECT — JS variable with escaped output %>
<script>
  const apiPrefix = '<%= passData.apiPrefix %>';
</script>

<%# WRONG — hidden span pattern (deprecated) %>
<%# <span id="apiPrefix" style="display:none"><%= passData.apiPrefix %></span> %>
```

**File di utilità:**
- Lato server: `/core/escapeHtml.js`
- Lato client: `/themes/defaultAdminTheme/themeResources/js/escapeHtml.js`

7. **Prevenzione Open Redirect**

Tutti gli URL di redirect provenienti dall'input dell'utente DEVONO essere validati:

```javascript
// Use getSafeRedirectUrl() from adminUsers plugin
function getSafeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return '/';
  const trimmed = url.trim();
  // Must start with / but not // or /\ (protocol-relative URLs)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return trimmed;
  }
  return '/'; // Fallback to safe default
}
```

## Attività comuni

Ricette pratiche — aggiungere una rotta API, un page hook (`getHooksPage`), un middleware (`getMiddlewareToAdd`), condividere oggetti tra plugin (`getObjectToShareToOthersPlugin`/`getSharedObject`), inizializzare lo storage dati: i **contratti** sono nella sezione *Architettura del sistema plugin* (sopra); l'**esempio completo di riferimento** è il plugin `plugins/exampleComplete/` che dimostra tutti i metodi del sistema plugin; il deep-dive è in `core/EXPLAIN-pluginsSys.it.md`.

Per lo storage JSON5: leggere con `loadJson5()`, scrivere in modo **atomico** (temp + `rename`) — vedi *Strategia di archiviazione dati*.

## Testing

Strategia, convenzioni, helper e isolamento dei test: spostato in [`docs/testing.it.md`](./docs/testing.it.md).

## Profilo di installazione demo

Spostato in [`docs/demo-profile.it.md`](./docs/demo-profile.it.md).

## Linee guida per il deployment

Spostato in [`docs/deployment.it.md`](./docs/deployment.it.md).

## Riferimento ai file importanti

### File di configurazione

- `/ital8Config.json5` - Configurazione principale dell'applicazione
- `/core/admin/adminConfig.json5` - Configurazione del sistema admin
- `/core/priorityMiddlewares/koaSession.json5` - Configurazione della sessione
- `/plugins/*/pluginConfig.json5` - Configurazione per-plugin
- `/plugins/*/pluginDescription.json5` - Metadata del plugin
- `/plugins/*/adminConfig.json5` - Metadata della sezione del plugin admin (per i plugin admin)

### Punti di ingresso

- `/index.js` - Bootstrap dell'applicazione
- `/core/pluginSys.js` - Gestore del sistema plugin
- `/core/themeSys.js` - Gestore del sistema temi
- `/core/admin/adminSystem.js` - Coordinatore del sistema admin
- `/core/loadJson5.js` - Utility di caricamento file JSON5 (throw-only: messaggi chiari che distinguono "file non trovato"/"sintassi JSON5 non valida"; `warnConfigError()` per il box `[CONFIG]` al boot)
- `/core/materializeFromDefault.js` - Ciclo di vita config: materializza un `x.json5` vivo da una coppia `x.default.json5`→`x.json5` (atomico; no-op se il vivo esiste)
- `/core/materializeDirDefaults.js` - Materializza i config vivi mancanti di UNA cartella (plugin/tema)
- `/core/materializeMissingConfigs.js` - Materializza i vivi mancanti di un contenitore (`plugins/`/`themes/`); invocata al boot
- `/core/resetConfigsToDefault.js` - Reset: rimuove i vivi di una cartella (rigenerati dai default al boot); usata dal comando CLI `ital8cms-cli reset`
- `/core/setJson5Key.js` - Ciclo di vita config: upsert (add-or-update) di una chiave in un `.json5` preservando i commenti (usata dal boot per scrivere `isInstalled`/`version`); accetta anche **path annidati** (`['custom','dataPath']`); complementare a `editJson5` (che solo aggiorna)
- `/core/pluginStateResolver.js` - Ciclo di vita config: modulo **puro** per gli stati dei plugin — `checkNpmDeps` + `resolvePluginStates` (cascata a punto fisso + rilevamento cicli); usato da `pluginSys.initialize()`
- `/core/reconcileSchemaVersion.js` - Ciclo di vita config: drift di `schemaVersion` per UNA coppia default↔vivo + **merge additivo ricorsivo** (aggiunge le chiavi nuove a ogni profondità, preserva i valori)
- `/core/reconcileSchemaVersions.js` - Ciclo di vita config: scansione di contenitori/coppie + box `[SCHEMA]` anti-rumore; invocata al boot (salta i config con una migrazione pendente, via `skipLivePaths`)
- `/core/migrationRunner.js` - Migrazione dei config: scoperta/validazione degli step in `migrations/`, esecuzione della catena (backup, script, merge, postcondizione strutturale, ricevuta `schemaVersion`), box `[MIGRATE]` al boot
- `/core/ensureThemesInstalled.js` - Ciclo di vita config (Fase 5): scrive `isInstalled: 1` al boot sui temi **bundled** (con `.default`) il cui vivo ne è privo; gemello, per i temi, della persistenza fatta da `pluginSys`
- `/core/servingRootResolver.js` - Utility di isolamento del path di serving
- `/core/patternMatcher.js` - Utility di pattern matching degli URL (esatto, wildcard, regex) — condivisa dai plugin adminAccessControl e seo
- `/core/sessionSecurity.js` - Sicurezza delle chiavi di sessione: denylist dei placeholder, `keysAreInsecure()`, warning al boot `checkSessionKeys()` (fonte di verità unica)
- `/core/processSafetyNet.js` - Rete di sicurezza a livello di processo: handler globali `uncaughtException`/`unhandledRejection` → box `[FATAL]` + chiusura ordinata (`installProcessSafetyNet()`, `warnFatalError()`); installata early in `index.js`
- `/scripts/lib/sessionKeyManager.js` - Tooling install-time per le chiavi di sessione: `generateSessionKeys()` + step interattivo del wizard `configureSessionKeys()`

### Sistema admin

- `/core/admin/adminConfig.json5` - Configurazione admin centrale
- `/core/admin/adminSystem.js` - Coordinatore admin
- `/core/admin/lib/configManager.js` - Caricamento e validazione config
- `/core/admin/lib/adminServicesManager.js` - Service discovery
- `/core/admin/lib/symlinkManager.js` - Gestore symlink
- `/core/admin/webPages/index.ejs` - Dashboard admin (menu dinamico)
- `/core/admin/webPages/systemSettings/` - UI impostazioni di sistema
- `/core/admin/webPages/usersManagment/` - Symlink → plugins/adminUsers/adminWebSections/usersManagment/

### Autenticazione e gestione utenti

- `/plugins/adminUsers/userAccount.json5` - Credenziali utente
- `/plugins/adminUsers/userRole.json5` - Definizioni dei ruoli
- `/plugins/adminUsers/main.js` - Logica di autenticazione
- `/plugins/adminUsers/adminWebSections/usersManagment/` - File UI gestione utenti
- `/plugins/adminUsers/adminWebSections/rolesManagment/` - File UI gestione ruoli

### File dei plugin

Ogni plugin documenta i propri file nel rispettivo `README.it.md`/`EXPLAIN.it.md` (vedi i puntatori nelle sezioni dei plugin sopra). Utility core trasversali: `core/patternMatcher.js` (pattern matching condiviso), `core/servingRootResolver.js` (isolamento path), `core/editJson5.js` (modifica chirurgica di chiavi JSON5 — update-only), `core/setJson5Key.js` (upsert di una chiave, anche annidata, preserva i commenti), `core/loadJson5.js`, `core/logger.js`, `core/escapeHtml.js`, `core/sessionSecurity.js`, `core/processSafetyNet.js`.

### Database

- `/plugins/dbApi/dbFile/mainDb.db` - Database principale
- `/plugins/dbApi/dbFile/webDb.db` - Database condiviso col web
- `/plugins/dbApi/dbFile/pluginsDb/*.db` - Database per-plugin

## Debugging e troubleshooting

### Abilitare la modalità debug

In `ital8Config.json5`:
```json
{
  "debugMode": 1
}
```

### Verificare il caricamento dei plugin

I plugin loggano durante il caricamento:
```
Loading plugin: admin
Loading plugin: adminUsers
Loading plugin: bootstrap
Plugin loaded: admin
Plugin loaded: adminUsers
Plugin loaded: bootstrap
```

### Problemi comuni

**Plugin che non si carica:**
- Verifica che `pluginConfig.json5` abbia `"active": 1`
- Verifica che `pluginDescription.json5` esista
- Controlla che le dipendenze siano soddisfatte
- Cerca errori di sintassi in `main.js`

**Rotte che non funzionano:**
- Verifica che il plugin sia attivo e caricato
- Controlla il path della rotta in `getRouteArray()`
- Accedi su `/api/{pluginName}/{path}`
- Verifica che un middleware non stia bloccando la richiesta

**Errori del database:**
- Assicurati che il plugin dbApi sia attivo
- Controlla i permessi del file del database
- Verifica che la tabella esista prima di interrogarla
- Usa try-catch per le operazioni sul database

**Problemi di autenticazione:**
- Verifica che le chiavi di sessione siano impostate
- Controlla che l'utente esista in `userAccount.json5`
- Assicurati che la password sia hashata con bcrypt
- Verifica che il cookie di sessione venga inviato

**Tema che non si renderizza:**
- Verifica che il tema esista nella directory `/themes`
- Controlla `activeTheme` in `ital8Config.json5`
- Assicurati che tutti i partial richiesti esistano
- Cerca errori di sintassi EJS

### Debugging con VSCode

Configurazione di launch (`.vscode/launch.json`):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/index.js",
      "restart": true,
      "runtimeExecutable": "nodemon",
      "console": "integratedTerminal"
    }
  ]
}
```

## Miglioramenti futuri

Direzioni ampie in [`docs/roadmap.it.md`](./docs/roadmap.it.md); i lavori **aperti e spuntabili** (punti rimandati dalle decisioni + debito emerso dagli interventi, ciascuno con la sua fonte) in [`TODO.md`](./TODO.md).

## Comandi di riferimento rapido

```bash
# Development
npm install                    # Install dependencies (+ postinstall: deps-sync)
npm run dev                    # Start with auto-reload (nodemon)
npm start                      # Start (node index.js)

# Production
npm install --production       # Install production dependencies only
npm start                      # Run application (node index.js)
pm2 start index.js             # Run with PM2 process manager

# CLI control plane — drives a RUNNING instance (see docs/cli-control-plane.it.md)
# NOTE: always keep the `--`; without it npm silently drops flags (--json, --theme, …)
npm run cli -- status          # pid, uptime, ports, admin/reserved/public state
npm run cli -- admin start     # enable the admin area  (rewrites enableAdmin + restarts)
npm run cli -- admin stop      # disable the admin area (rewrites enableAdmin + restarts)
npm run cli -- public stop     # public site in maintenance: 503 (no restart)
npm run cli -- public start    # public site back online  (no restart)
npm run cli -- reserved stop   # everything behind auth (login, admin panel): 404 (no restart)
npm run cli -- reserved start  # reserved surface reachable again (no restart)
npm run cli -- publicOnly on   # showcase layout: reserved stop + admin stop + dir listing off (restarts)
npm run cli -- publicOnly off  # back to the normal layout (restarts)
npm run cli -- reset <target>  # plugin/theme configs back to defaults (add --theme for themes)
npm run cli -- migrate <target> # apply pending config migrations (--dry-run, --theme, --confirm-manual)

# Update / backup (terminal-driven; see docs/self-update.it.md)
npm run update                 # Self-update to the latest GitHub release (git)
npm run backup                 # Snapshot the install into backups/
npm run backup-list            # List snapshots
npm run backup-manager         # Manage snapshots (delete / prune)
npm run restore                # Restore from a snapshot (--latest | --name <n>)
npm run deps-sync              # Reconcile plugin/theme npm deps

# Database
# Access via better-sqlite3 in plugin code
# Files: /plugins/dbApi/dbFile/*.db

# Git
git status                     # Check status
git add .                      # Stage changes
git commit -m "message"        # Commit changes
git push                       # Push to remote
```

---

**Last Updated:** 2026-06-27
**Version:** 2.18.0
**Maintained By:** AI Assistant (based on codebase analysis)
**Standard documentazione:** ital8doc v1-1 → [`docs/ITAL8DOC-latest.md`](./docs/ITAL8DOC-latest.md)

**Changelog:** spostato in [`CHANGELOG.md`](./CHANGELOG.md).
