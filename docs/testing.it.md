<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `testing.md` is a stub until release.
# Testing — ital8cms

## Strategia di test

**Current Status:** Jest è installato e configurato. Sono presenti test unitari, test di integrazione e test di sicurezza.

### Test Esistenti

```
tests/
├── unit/
│   ├── bootstrapNavbar/              # 5 file, 187 test
│   │   ├── escapeHtml.test.js
│   │   ├── isActivePage.test.js
│   │   ├── isItemVisible.test.js
│   │   ├── configDir.test.js
│   │   └── rendering.test.js
│   ├── urlRedirect/                  # 3 file, 101 test
│   │   ├── configValidator.test.js
│   │   ├── redirectMatcher.test.js
│   │   └── hitCounter.test.js
│   ├── adminBootstrapNavbar/         # 3 file, 131 test
│   │   ├── navbarValidator.test.js
│   │   ├── navbarFileManager.test.js
│   │   └── navbarTemplates.test.js
│   ├── core/                         # 7 file, 172 test
│   │   ├── servingRootResolver.test.js
│   │   ├── escapeHtml.test.js
│   │   ├── loadJson5.test.js
│   │   ├── saveJson5.test.js
│   │   ├── pluginPagesSystem.test.js
│   │   ├── adminServicesManager.test.js
│   │   ├── configManager.test.js
│   │   └── symlinkManager.test.js
│   ├── xss/                          # 1 file, 172 test
│   │   └── serverSideSanitization.test.js
│   ├── pluginSys.test.js             # 16 test
│   ├── themeSys.test.js              # 36 test
│   ├── accessManager.test.js         # }
│   ├── patternMatcher.test.js        # } 130 test (adminAccessControl)
│   ├── ruleValidator.test.js         # }
│   ├── libAccess.test.js             # }
│   ├── openRedirect.test.js          # 35 test
│   └── logger.test.js                # 13 test
└── integration/                      # 5 file, 140 test
    ├── httpsDiagnostics.test.js
    ├── httpsServer.test.js
    ├── pluginLoading.test.js
    ├── globalPrefix.test.js
    ├── hideExtension.test.js
    └── wwwFilesystem.test.js
```

**Totale: 34 file, 1133 test**

### Eseguire i test

```bash
# Tutti i test
npx jest --verbose

# Solo unit test
npx jest tests/unit --verbose

# Solo test HTTPS (diagnostica)
npx jest tests/integration/httpsDiagnostics.test.js --verbose

# Watch mode (sviluppo)
npx jest --watch
```

### Test di Integrazione HTTPS: httpsDiagnostics.test.js

**File:** `/tests/integration/httpsDiagnostics.test.js`

Il test diagnostico HTTPS è organizzato in 4 fasi indipendenti, ognuna con messaggi di errore actionable. Utile per diagnosticare problemi TLS su qualsiasi installazione.

**Auto-generazione certificati (`ensureTestCertificates()`):**

Il test include un `beforeAll()` globale che, se i file cert/key configurati in `ital8Config.json5` non esistono, li genera automaticamente con `openssl` (incluso SAN per `localhost` e `127.0.0.1`). **Non sovrascrive certificati già presenti.** Se `openssl` non è disponibile nel PATH, mostra istruzioni di installazione per distro.

```
tests/integration/httpsDiagnostics.test.js
│
├── beforeAll: ensureTestCertificates()   ← genera cert se mancanti
│
├── Fase 1 — Pre-flight certificati       (nessun server avviato)
│   • file cert/key esistono e leggibili
│   • PEM parseable come X.509
│   • certificato non scaduto (+ warning se < 7 giorni)
│   • coppia cert/key coerente (stessa chiave pubblica)
│   • SAN include "localhost" o "127.0.0.1" (warning se assente)
│   • diagnostica completa (output informativo)
│
├── Fase 2 — Disponibilità porte          (nessun server avviato)
│   • porta HTTP libera
│   • porta HTTPS libera
│   • porte HTTP e HTTPS diverse
│
├── Fase 3 — TLS isolato                  (server Node.js minimale, senza Koa)
│   • https.createServer() con i cert configurati
│   • handshake TLS completato (rejectUnauthorized: false)
│   • versione TLS e cipher suite (informativo)
│   • comportamento browser-like (rejectUnauthorized: true, informativo)
│
└── Fase 4 — Server completo              (spawn node index.js)
    • porte di test: HTTP 19100, HTTPS 19443 (no conflitti con prod)
    • config temporanea iniettata senza modificare ital8Config.json5 permanentemente
    • server parte senza crash (log di avvio HTTPS ricevuto)
    • log NON contiene errori di caricamento certificati
    • HTTPS risponde su 127.0.0.1:19443
    • HTTP risponde su 127.0.0.1:19100
    • comportamento AutoRedirect verificato (301 o parallelo)
    • riepilogo configurazione finale (informativo)
```

**Porte riservate per i test:**

| Porta | Contesto | Uso |
|-------|----------|-----|
| `19100` | Jest — httpsDiagnostics Fase 4 | HTTP di test (evita conflitti con porta 3000 di produzione) |
| `19200` | Jest — httpsDiagnostics Fase 3 | TLS isolato |
| `19300` | Playwright — globalPrefix E2E | HTTP per test con `globalPrefix` non vuoto |
| `19400` | Playwright — E2E standard | HTTP per test E2E standard (porta dedicata, non collide con server di sviluppo) |
| `19443` | Jest — httpsDiagnostics Fase 4 | HTTPS di test (evita conflitti con porta 3443 di produzione) |

### Isolamento Test E2E dalla directory www/ di produzione

**REGOLA CRITICA:** I test E2E **NON devono mai dipendere** dai file presenti nella directory `/www/` di produzione. Tutti i file necessari ai test devono essere nella directory dedicata `/tests/www/`.

**Motivazione:**
- ✅ La directory `/www/` è l'area di lavoro del developer in produzione — può cambiare liberamente
- ✅ I test non si rompono quando l'utente modifica/aggiunge/rimuove pagine dal sito
- ✅ I file di test sono controllati e prevedibili
- ✅ Isolamento completo tra ambiente di test e ambiente di produzione

**Architettura:**

```
tests/www/                    ← Directory www dedicata ai test
├── index.ejs                 ← Homepage di test
├── hello_word.ejs            ← Pagina di test
├── i18n-test.ejs             ← Test internazionalizzazione
├── prova_thema.ejs           ← Test tema
├── navbar.main.json5         ← Configurazione navbar di test
├── navbarExamples/           ← Esempi navbar
├── reserved/                 ← Area protetta (richiede login)
│   └── index.ejs
├── private/                  ← Area privata (richiede login)
│   └── index.ejs
└── lib/                      ← Area libreria (richiede login)
    └── index.ejs
```

**Come funziona l'isolamento completo:**

Il `globalSetup.js` sovrascrive `ital8Config.json5` **prima** dell'avvio del server di test, applicando 4 override:

```javascript
const { TEST_WWW_PATH, E2E_TEST_HTTP_PORT } = require('./testConstants');

// In globalSetup.js — override COMPLETO della config per i test E2E
configData.wwwPath = TEST_WWW_PATH;              // '/tests/www' (isolamento da /www/)
configData.httpPort = E2E_TEST_HTTP_PORT;         // 19400 (evita conflitti con server dev su 3000)
configData.activeTheme = 'themeForTesting';       // Tema di test dedicato
configData.adminActiveTheme = 'themeForTestingAdmin';
configData.https.enabled = false;                 // HTTPS disabilitato (test verificano routing, non TLS)
```

**Perché la porta dedicata (19400) è fondamentale:**

La directory `/www/` di produzione **NON contiene `index.ejs`** (il file si chiama `__index.ejs`), mentre `/tests/www/` contiene `index.ejs`. Se il server E2E riutilizzasse un server di sviluppo già attivo sulla porta 3000 (che usa `/www/`), i test homepage fallirebbero con:
- `GET /` → "Index of /" (directory listing, nessun `index.ejs` trovato)
- `GET /index.ejs` → 404

La porta dedicata 19400 + `reuseExistingServer: false` in `playwright.config.js` garantiscono che il server E2E parta sempre con la config di test modificata.

**Il flusso completo:**

```
npm test
  ├─ jest (unit + integration) — usa ital8Config.json5 originale
  │   └─ tests/setup.js ripristina config a versione git tra i test
  │
  └─ npx playwright test (E2E)
       ├─ 1. globalSetup.js:
       │     ├─ Backup ital8Config.json5 → .test-bak
       │     ├─ Override: wwwPath, httpPort, themes, HTTPS off
       │     ├─ Backup userAccount.json5 → .test-bak
       │     └─ Aggiunta 4 utenti di test
       │
       ├─ 2. Server avviato: node index.js (porta 19400, www di test)
       │
       ├─ 3. Test E2E eseguiti su http://localhost:19400
       │
       └─ 4. globalTeardown.js:
             ├─ Ripristino ital8Config.json5 da backup
             └─ Ripristino userAccount.json5 da backup
```

Il `globalPrefixSetup.js` applica gli stessi override (compreso `wwwPath = TEST_WWW_PATH`) più `globalPrefix` e `httpPort = 19300`.

**Costanti centralizzate in `testConstants.js`:**

```javascript
const TEST_WWW_PATH = '/tests/www';    // Directory www di test
const E2E_TEST_HTTP_PORT = 19400;                // Porta HTTP dedicata E2E
```

**Quando aggiungere nuovi file a tests/www/:**

Se un nuovo test E2E necessita di una pagina web specifica:
1. Creare il file EJS in `tests/www/` (NON in `/www/`)
2. Aggiornare questa documentazione se la struttura cambia significativamente
3. Verificare che il file segua le convenzioni dei template (inclusione dei partial del tema, ecc.)

**Quando NON servono file in tests/www/:**

I seguenti path sono serviti da altre directory e NON necessitano di file nella www di test:
- `/api/*` → serviti dai route handler dei plugin
- `/admin/*` → serviti da `core/admin/webPages/`
- `/pluginPages/*` → serviti da `plugins/{pluginName}/webPages/`
- `/public-theme-resources/*` → serviti dalla directory del tema
- `/admin-theme-resources/*` → serviti dalla directory del tema admin

### Aggiungere Nuovi Test

**Unit test per un nuovo plugin:**
```
tests/unit/myPlugin/
└── myFeature.test.js
```

**Convenzioni:**
- Unit test: testano funzioni pure esportate dal modulo (`module.exports`)
- Integration test: testano comportamento end-to-end (spawn server, richieste HTTP reali)
- E2E test: usano Playwright, serviti dalla directory `tests/www/` (MAI dalla `/www/` di produzione)
- Ogni test deve essere indipendente e non modificare file permanentemente

## Convenzioni di test per plugin e temi

### Panoramica

Oltre ai test del core in `/tests/`, **ogni plugin e ogni tema può dichiarare i propri test** in una cartella dedicata. Jest li rileva automaticamente e li esegue come parte della suite complessiva.

**Principi:**
- ✅ **Co-locazione:** i test stanno vicino al codice che testano, nella stessa directory del plugin/tema
- ✅ **Zero configurazione:** basta creare la cartella `tests/` — Jest la trova automaticamente via pattern globale
- ✅ **Filtraggio plugin inattivi:** i test di plugin con `active: 0` vengono esclusi automaticamente
- ✅ **Helper condivisi:** mock factories e utilities in `/core/testHelpers/` per evitare duplicazione
- ✅ **Isolamento filesystem:** i test che scrivono su disco usano `createPluginSandbox()` (mai nella cartella reale del plugin)

### Struttura delle directory

```
plugins/myPlugin/
├── main.js
├── pluginConfig.json5
├── pluginDescription.json5
└── tests/                     # ⭐ scoperta automatica da Jest
    ├── unit/                  # test di funzioni pure esportate
    │   └── feature.test.js
    ├── integration/           # test end-to-end (opzionale)
    │   └── lifecycle.test.js
    └── fixtures/              # fixtures locali del plugin
        └── sampleConfig.json5
```

Stessa struttura per i temi in `themes/myTheme/tests/`.

### Nomi dei file

- Test: `*.test.js` o `*.spec.js` (match Jest standard)
- Fixtures: qualsiasi nome, tipicamente `.json5` per coerenza con il resto del progetto

### Helper di test condivisi (`/core/testHelpers/`)

Gli helper condivisi sono disponibili come modulo importabile. Tutti gli export sono accessibili via l'entry point `index.js`:

```javascript
const {
  createCtxMock,
  createPluginSysMock,
  createThemeSysMock,
  createAdminSystemMock,
  runRoute,
  runMiddleware,
  runPageHook,
  validateRoute,
  loadFixture,
  createPluginSandbox
} = require('../../../core/testHelpers');
```

**Path relativo** da un file `plugins/myPlugin/tests/unit/foo.test.js`: `../../../core/testHelpers`.

#### Factory di mock

| Factory | Scopo | Parametri principali |
|---------|-------|----------------------|
| `createCtxMock(options)` | Mock del context Koa | `method`, `path`, `query`, `body`, `session`, `headers`, `state` |
| `createPluginSysMock(options)` | Mock del PluginSys | `sharedObjects`, `plugins`, `hookReturns`, `themeSys`, `globalFunctions` |
| `createThemeSysMock(options)` | Mock del ThemeSys wrapper | `publicTheme`, `adminTheme`, `customizations`, `getThemePartPath` |
| `createAdminSystemMock(options)` | Mock dell'AdminSystem | `ui`, `menuSections`, `services`, `endpoints` |

Tutti i metodi restituiti sono `jest.fn()` — permettono asserzioni come `expect(mock.hookPage).toHaveBeenCalledWith(...)`.

#### Runner

| Runner | Scopo |
|--------|-------|
| `runRoute(route, ctx)` | Valida struttura rotta (method, path, access, handler) ed esegue handler |
| `runMiddleware(middleware, ctx, next?)` | Esegue un middleware; se `next` omesso viene creato come `jest.fn()` |
| `runPageHook(plugin, section, passData, pluginSys?, pathPluginFolder?)` | Esegue `getHooksPage()` del plugin per una sezione |
| `validateRoute(route)` | Ritorna array di problemi senza eseguire l'handler |

#### Utility

| Utility | Scopo |
|---------|-------|
| `loadFixture(name)` | Carica una fixture JSON5 da `/core/testHelpers/fixtures/` (condivisa tra più plugin) |
| `createPluginSandbox(pluginName, options)` | Crea dir temporanea in `os.tmpdir()` con scaffolding plugin |

### Isolamento del filesystem (`createPluginSandbox`)

**REGOLA CRITICA:** i test **NON devono mai scrivere** dentro la cartella reale del plugin (es. `plugins/myPlugin/data.json5`). Questo contaminerebbe l'ambiente di sviluppo e rompererebbe il determinismo dei test.

Usare sempre `createPluginSandbox()` per operazioni su filesystem:

```javascript
const { createPluginSandbox } = require('../../../core/testHelpers');

describe('myPlugin file operations', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createPluginSandbox('myPlugin', {
      pluginConfig: { custom: { setting: 'value' } },
      withPluginPages: true,
      withAdminSections: ['mySection']
    });
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  test('writes data file', () => {
    sandbox.writeJson5('data.json5', { items: [1, 2, 3] });
    expect(sandbox.exists('data.json5')).toBe(true);
    const content = sandbox.readFile('data.json5');
    expect(content).toContain('items');
  });
});
```

**API del sandbox:**
- `sandbox.path` — path assoluto della directory plugin isolata
- `sandbox.pluginConfigPath`, `sandbox.pluginDescriptionPath` — path ai file generati
- `sandbox.writeFile(relativePath, content)` — scrive file arbitrario
- `sandbox.writeJson5(relativePath, obj)` — scrive file JSON5 con header standard
- `sandbox.readFile(relativePath)` / `sandbox.exists(relativePath)`
- `sandbox.cleanup()` — **sempre** in `afterEach` / `afterAll`

### Comandi npm

Oltre a `npm test` che esegue tutto, sono disponibili script per filtrare per scope:

```bash
# Tutto: core + plugin + temi (quelli attivi)
npm test

# Solo core del progetto (tests/unit/ e tests/integration/)
npm run test:core

# Solo un plugin specifico
npm run test:plugin --plugin=bootstrapNavbar

# Solo i temi
npm run test:themes
```

**Nota:** `test:plugin` richiede il flag `--plugin=<nomePlugin>`. Il wrapper (`scripts/testRunner.js`) controlla che il plugin esista e emette un warning se la cartella `tests/` è assente.

### Contratto di qualità (consigliato, Fase 1)

In Fase 1 il contratto è **descrittivo**. Un plugin "ben testato" dovrebbe avere:
- Un test unitario per ogni metodo pubblico esportato da `main.js` (`loadPlugin`, `getRouteArray`, `getHooksPage`, ecc.)
- Un test per ogni rotta dichiarata in `getRouteArray()`, incluso il rispetto del contratto `access` (`requiresAuth`, `allowedRoles`)
- Validazione della struttura di `pluginConfig.json5` e `pluginDescription.json5`
- Coverage dei lifecycle hooks (`installPlugin`, `uninstallPlugin`, `upgradePlugin` se implementati)

Per i temi:
- Presenza dei partial richiesti (`head`, `header`, `nav`, `main`, `aside`, `footer`)
- Validità sintattica dei file `.ejs` (parse-only)
- Validazione di `themeConfig.json5`
- Correttezza delle chiamate a `pluginSys.hookPage()`

**Fase 2 (futura):** il contratto diventerà **prescrittivo** con uno scanner al boot del server in `pluginSys` che verifica automaticamente la presenza dei test minimi e emette warning (o fatal error se `testingStrictMode: true`). Vedi sezione "Future Improvements".

### Esempio di riferimento: bootstrapNavbar

Il plugin `bootstrapNavbar` è stato migrato alla nuova convenzione ed è l'**esempio ufficiale** da consultare:

```
plugins/bootstrapNavbar/tests/unit/
├── escapeHtml.test.js      # test funzione pura XSS sanitization
├── isActivePage.test.js    # test detection pagina attiva
├── isItemVisible.test.js   # test filtri visibilità auth/role
├── configDir.test.js       # test risoluzione configDir
└── rendering.test.js       # test pipeline completa di rendering
```

**5 file di test, 187 test, 100% pass rate.**

Eseguibile con: `npm run test:plugin --plugin=bootstrapNavbar`

### Come Jest filtra i plugin/temi inattivi

Il file `tests/jest.config.js` legge all'avvio tutti i `pluginConfig.json5` e `themeConfig.json5`, e aggiunge dinamicamente a `testPathIgnorePatterns` i path dei plugin/temi con `active: 0`. Disattivando un plugin nel config, i suoi test vengono saltati automaticamente senza modifiche al codice.

### File di riferimento

| File | Scopo |
|------|-------|
| `/core/testHelpers/index.js` | Entry point, re-export di tutti gli helper |
| `/core/testHelpers/pluginSysMock.js` | Factory `createPluginSysMock` |
| `/core/testHelpers/ctxMock.js` | Factory `createCtxMock` |
| `/core/testHelpers/themeSysMock.js` | Factory `createThemeSysMock` |
| `/core/testHelpers/adminSystemMock.js` | Factory `createAdminSystemMock` |
| `/core/testHelpers/routeRunner.js` | `runRoute`, `validateRoute` |
| `/core/testHelpers/middlewareRunner.js` | `runMiddleware` |
| `/core/testHelpers/hooksPageRunner.js` | `runPageHook` |
| `/core/testHelpers/fixtureLoader.js` | `loadFixture` per fixtures condivise |
| `/core/testHelpers/pluginSandbox.js` | `createPluginSandbox` per isolamento FS |
| `/scripts/testRunner.js` | Wrapper per `test:core`, `test:plugin`, `test:themes` |
| `/tests/jest.config.js` | Config Jest con filtro plugin/temi inattivi |

