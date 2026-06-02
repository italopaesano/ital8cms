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

## Vista C — form Impostazioni (coordinato con l'editor JSON5)

La pagina Impostazioni offre **due viste sullo stesso contenuto**, con un toggle:

- **Form** (Vista C): campi strutturati raggruppati (Generale, Policy default,
  Enforcement, Logging/Stato/Risposta), con switch per i booleani, number per le
  durate, list-editor per `exemptPaths`, e badge ⟳ sui campi che richiedono il riavvio.
- **JSON5** (Vista B): la textarea grezza (già presente).

**Coordinamento (client-side, server invariato):**
- La **textarea è la fonte inviata al server** (single source of truth). Il form la
  rigenera; prima di Valida/Salva, se la vista attiva è il Form, si sincronizza
  (`gatherForm()` → `JSON.stringify` → textarea) e si invia sempre il contenuto della textarea.
- Il **toggle sincronizza esplicitamente** la vista sorgente verso quella di
  destinazione: Form→JSON rigenera la textarea; JSON→Form fa `JSON.parse` e popola
  i campi (se il parse fallisce, resta in vista JSON con un avviso).
- `gatherForm()` parte da una copia di `currentCustom`, quindi **preserva le chiavi
  non gestite dal form** (top-level e nei gruppi annidati).
- **Dirty-tracking** + `beforeunload`: avviso se si lascia la pagina con modifiche
  non salvate.

> **Nota sul parsing client.** Il contenuto di `GET /config` è `JSON.stringify` del
> blocco custom (quindi JSON puro): per il toggle basta `JSON.parse` (nessuna libreria
> JSON5 nel browser). Se l'utente digita a mano feature JSON5 (commenti, trailing
> comma) nella textarea, il toggle verso il Form avvisa; il Salva funziona comunque
> perché il server fa `JSON5.parse`. Coerente col fatto che il salvataggio normalizza
> il blocco custom (i commenti interni non vengono preservati).

La validazione e la scrittura restano quelle del server (endpoint invariati): la
Vista C è interamente lato client (EJS + `settings-editor.js`).

## Vista C — form Regole (coordinato con l'editor JSON5)

La pagina Regole ha lo stesso schema (toggle Form↔JSON5, textarea = fonte inviata),
con una differenza dovuta al fatto che `protectedRoutes.json5` è **grezzo, con commenti**:

- **Il form si popola da `rules` parse-ate lato server.** `GET /rules` ritorna sia
  `content` (grezzo) sia `rules` (array già parsato con JSON5 dal plugin admin), così
  il browser **non deve fare JSON5.parse** del file commentato.
- Una **card per regola**: `name`, `pathPattern` (opzionale) e i 6 override numerici;
  un campo **vuoto = eredita** dai defaults (omesso dall'oggetto regola). Pulsanti
  "Aggiungi regola" / "✕ rimuovi".
- **Toggle:** Form→JSON rigenera la textarea (`JSON.stringify({rules})`); JSON→Form usa
  `JSON.parse` — se la textarea contiene commenti/JSON5 non importabile, **avvisa e
  resta in vista JSON5** (il form era comunque già popolato al load dai dati del server).
- **Trade-off commenti:** salvando dal Form il file viene normalizzato (commenti persi);
  per preservare i commenti si modifica e salva dalla **vista JSON5** (contenuto grezzo).

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
