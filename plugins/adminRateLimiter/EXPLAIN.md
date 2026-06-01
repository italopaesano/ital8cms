# Plugin adminRateLimiter — Documentazione tecnica (deep-dive)

> Guida d'uso rapida: vedi `README.md`. Servizio gestito: vedi
> [`../rateLimiter/EXPLAIN.md`](../rateLimiter/EXPLAIN.md).

## Cos'è

Plugin **admin gemello** di `rateLimiter` (convenzione *Twin Admin Plugin*:
`admin<Service>`). Il servizio resta "lean" (logica + oggetto condiviso + file
`.json5`); questo plugin possiede **solo la GUI**. Implementa le *Tre Viste*:
Dati (dashboard), Editor JSON5 Regole, Editor JSON5 Impostazioni.

## Come comunica col servizio

`adminRateLimiter` e `rateLimiter` girano nello **stesso processo**, quindi:

- **Dati e azioni live** → oggetto condiviso, tirato on-demand:
  `myPluginSys.getSharedObject('rateLimiter')`. Se `null` (servizio
  `custom.enabled=false`), la GUI mostra il banner "disattivato".
- **File di configurazione** → il path della cartella del servizio è risolto via
  `myPluginSys.getPlugin('rateLimiter').pathPluginFolder` (metadata aggiunto da
  pluginSys). Da lì si leggono/scrivono `protectedRoutes.json5` e
  `pluginConfig.json5`.

```
Browser admin ─→ /api/adminRateLimiter/*  (route, ruoli [0,1])
   ├─ live   → getSharedObject('rateLimiter') → engine in memoria   (immediato)
   └─ config → getPlugin('rateLimiter').pathPluginFolder → file .json5 + reload*()
```

> **Dipendenza.** `adminRateLimiter` dipende da `rateLimiter` (`^1.0.0`): se il
> servizio è `active:0` il gemello non si carica (dipendenza non soddisfatta). Se
> invece è attivo ma `custom.enabled=false`, il gemello si carica e mostra lo
> stato "disattivato".

## Propagazione delle modifiche (hot vs riavvio)

| Cosa | Meccanismo | Effetto |
|------|-----------|---------|
| Sblocca / Ban | `releaseBlock` / `banClient` (engine in memoria) | immediato |
| Regole (`protectedRoutes.json5`) | scrittura atomica + `reloadRules()` | a caldo |
| `defaults` + `enforcement` | scrittura + `reloadConfig()` (engine e middleware L2 leggono `custom` live) | a caldo |
| Infrastruttura (`trustProxy`, `state`, `log`, `sweepIntervalSeconds`) | creata al boot | **riavvio** ("Salva e riavvia") |

Il riavvio è sicuro: i blocchi attivi vengono persistiti dallo `stateStore` di
`rateLimiter` e ricaricati al boot.

## Scrittura dei file

- **Regole**: l'intero `protectedRoutes.json5` è di proprietà dell'utente →
  si scrive il **contenuto grezzo** dell'editor (commenti preservati), dopo
  validazione (`rl.validateRules`) e backup.
- **Impostazioni**: si modifica **solo** il blocco `custom` di
  `pluginConfig.json5` tramite `core/editJson5` (sostituzione chirurgica della
  chiave `custom`), così `active`/`isInstalled`/`weight`/`dependency` e i loro
  commenti **restano intatti**. (I commenti *dentro* il blocco custom vengono
  normalizzati: editJson5 serializza l'oggetto.)

Tutte le scritture: **backup a rotazione** (`lib/configFileManager.js`,
`maxBackupsPerFile`) → scrittura **atomica** (temp+rename) → `reload*()`.

## Validazione

La logica di validazione vive nel servizio (`rateLimiter/lib/configValidator`)
ed è riusata via shared object: `validateRules(parsed)` / `validateConfig(parsed)`.
Il flusso di salvataggio è sempre: parse JSON5 (errore di sintassi → 400) →
`validate*` (errori → 400 con lista) → backup → scrittura → `reload*`.

## Sicurezza

- Route **solo `[0,1]`** (root/admin) — il rate limiter è sensibile.
- Output dinamico **escapato** lato client (`escapeHtml` globale del tema admin):
  gli IP sono input potenzialmente controllati dall'utente (se `trustProxy`).
- Scrittura **atomica + backup**; nessuna scrittura nella cartella reale durante i test (sandbox/tmpdir).
- Le label client sono tradotte via un oggetto `i18n` iniettato dall'EJS (il JS
  client non può usare `__()`).

## File

| File | Scopo |
|------|-------|
| `main.js` | Route + accesso al servizio (shared object + folder) |
| `lib/configFileManager.js` | read/writeAtomic/backup (rotazione) |
| `adminWebSections/rateLimiterManagement/index.ejs` + `rateLimiter-admin.js` + `.css` | Vista Dati |
| `…/rules.ejs` + `rules-editor.js` | Editor Regole |
| `…/settings.ejs` + `settings-editor.js` | Editor Impostazioni |
| `tests/unit/routes.test.js` | Route (status/attempts/unblock/ban/rules/config/restart) |
| `tests/unit/configFileManager.test.js` | File manager (read/write/backup/retention) |

## Test

`npm run test:plugin --plugin=adminRateLimiter` (oppure `npx jest plugins/adminRateLimiter`).
I test usano mock dell'oggetto condiviso e sandbox tmpdir per le scritture
(mai la cartella reale del plugin/servizio).
