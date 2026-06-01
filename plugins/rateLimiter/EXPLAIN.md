# Plugin rateLimiter — Documentazione tecnica (deep-dive)

> Questo documento spiega **il perché e il come interni** del plugin.
> Per la guida d'uso rapida (API, tabelle di configurazione) vedi `README.md`.

---

## Panoramica

`rateLimiter` è un servizio di **rate limiting / anti brute-force** per ital8cms.
Protegge le rotte sensibili (tipicamente il login) impedendo che un IP provi
credenziali all'infinito. Il blocco è **a escalation**, in stile *fail2ban*:

1. Dopo `maxFailures` fallimenti entro una finestra temporale → **short block**
   (default 5 minuti).
2. Accumulando troppi short block (`maxShortBlocks`) → **long block** (default
   24 ore): è il "ban" prolungato dell'IP.

È configurabile **solo via file `.json5`**. Una futura interfaccia grafica sarà
fornita dal plugin separato `adminRateLimiter` (fuori dallo scope di questo
plugin), che leggerà/scriverà gli stessi file e potrà usare l'API condivisa di
introspezione (`getActiveBlocks`, `getRuleNames`).

**Filosofia di design:**
- Il **motore** è puro (nessuna I/O, clock iniettabile) → testabile e
  deterministico.
- La **persistenza** e l'**audit** sono moduli separati e sostituibili.
- Il plugin è **opzionale**: i consumer lo usano con fallback `if (rl)`, quindi
  disattivarlo non rompe nulla.

---

## Il vincolo architetturale che determina tutto il design

> Questa è la sezione più importante: spiega perché il plugin **non** è un
> semplice middleware "che blocca il login".

In ital8cms l'ordine reale di montaggio dei middleware Koa (`app.use`) è:

```
bodyParser → session → maintenanceGate → router.routes() → [middleware dei plugin] → [static server koa-classic-server]
```

I middleware dei plugin (`getMiddlewareToAdd`) vengono montati in `index.js`
**dopo** `router.routes()`. Nel modello "a cipolla" di Koa, un middleware
registrato dopo il router viene raggiunto **solo se il router chiama `next()`**.

Quando una rotta API **matcha** (es. `POST /api/adminUsers/login`) e il suo
handler **non** chiama `next()` — ed è il caso del login — `@koa/router`
esegue l'handler e **non** prosegue verso i middleware a valle. Risultato:

```
POST /api/adminUsers/login
  bodyParser → session → maintenanceGate → router (MATCH! esegue l'handler e si ferma)
                                              ✗ i middleware dei plugin NON vengono eseguiti
```

**Conseguenza:** un middleware di plugin **non può pre-bloccare** il `POST /login`.
Il controllo del rate limit va quindi invocato **dentro l'handler** della rotta
sensibile. Questo è esattamente il motivo per cui in ital8cms le rotte API si
proteggono col campo `access` (wrappato dentro l'handler da `pluginSys`), mentre
le **pagine** (che "cadono attraverso" il router) si proteggono con un
middleware come `adminAccessControl`.

Da qui i **due livelli** del plugin:

| Livello | Meccanismo | Copre | Quando gira |
|---------|-----------|-------|-------------|
| **1 — Guard** | Oggetto condiviso, chiamato dentro l'handler | Rotte API sensibili (login) | Dentro l'handler della rotta matchata |
| **2 — Enforcement** | Middleware (`getMiddlewareToAdd`) | Pagine fall-through (ban globale dell'IP) | Dopo il router, sulle richieste non matchate |

I due livelli sono complementari: il Livello 1 conta i fallimenti e decide i
blocchi (solo l'handler conosce l'esito del login); il Livello 2 applica il *long
block* come ban dell'IP sul resto del sito.

---

## Struttura file

```
plugins/rateLimiter/
├── main.js                    # Entry point: loadPlugin, getMiddlewareToAdd (L2),
│                              #   getObjectToShareToOthersPlugin (L1), loadRules, resolvePolicy
├── pluginConfig.json5         # Policy di default, enforcement, logging, stato, proxy
├── pluginDescription.json5    # Metadata
├── protectedRoutes.json5      # Regole per "ruleName" (+ pathPattern opzionale per L2)
├── README.md                  # Guida d'uso rapida
├── EXPLAIN.md                 # Questo documento
├── .gitignore                 # Ignora state/ e logs/ (artefatti runtime)
├── state/                     # (runtime) activeBlocks.json5 — snapshot dello stato
├── logs/                      # (runtime) attempts.jsonl + archive/ — audit
└── lib/
    ├── rateLimitEngine.js     # Motore con escalation (puro, clock iniettabile)
    ├── keyResolver.js         # Estrazione IP/chiave dal contesto Koa
    ├── attemptLog.js          # Audit JSONL + rotazione + retention
    ├── stateStore.js          # Persistenza dello stato attivo (scrittura atomica)
    └── configValidator.js     # Validazione al boot
```

---

## Flusso di avvio (`loadPlugin`)

```
loadPlugin(pluginSys, pathPluginFolder)
  1. Legge pluginConfig.json5 → custom
  2. Se custom.enabled === false → log e return (engine resta null → guard disattivo)
  3. Valida custom + protectedRoutes.json5 (configValidator)
       - warning loggati; se !valid && strictValidation → throw (crash boot)
  4. Se custom.log.enabled → crea AttemptLog e init() (crea logs/ + logs/archive/)
  5. Crea RateLimitEngine con:
       - resolvePolicy(ruleName)  → merge defaults + override regola
       - onEvent(ev)              → log a console (se enableLogging) + AttemptLog.append
  6. Crea StateStore e init():
       - crea state/, carica state/activeBlocks.json5 nello engine, avvia il timer di flush,
         registra gli handler SIGTERM/SIGINT
  7. Avvia il timer di sweep (rimozione periodica dei blocchi scaduti)
  8. Log di riepilogo della policy attiva
```

**Nota sull'ordine di invocazione:** `getMiddlewareToAdd()` viene chiamato da
`index.js` **dopo** che tutti i plugin sono stati caricati, quindi quando il
middleware del Livello 2 viene costruito `engine`/`custom` sono già inizializzati.

---

## Il motore (`lib/rateLimitEngine.js`)

### Modello dati

Lo stato vive in una `Map` in memoria, **una voce per chiave** `IP|ruleName`:

```js
{
  clientId,         // IP del client (es. "203.0.113.7")
  ruleName,         // nome della regola (es. "adminLogin")
  failureCount,     // fallimenti nella finestra corrente
  windowStartAt,    // inizio della finestra di conteggio (epoch ms, 0 = nessuna)
  lastFailureAt,    // ultimo fallimento (epoch ms)
  shortBlockCount,  // quanti short block accumulati (memoria di escalation)
  blockedUntil,     // fine del blocco (epoch ms, 0 = non bloccato)
  tier,             // 'none' | 'short' | 'long'
}
```

> I timestamp sono in **epoch ms** (machine-readable). L'audit leggibile è
> separato (`attempts.jsonl`, con timestamp ISO).

### Macchina a stati (escalation)

```
NORMAL ──fail (count < max nella finestra)─────────────► NORMAL  (count++)
NORMAL ──fail (count == max, shortBlocks < maxShort)───► SHORT_BLOCK
SHORT_BLOCK ──blocco scaduto───────────────────────────► NORMAL  (count=0, RICORDA shortBlocks)
NORMAL ──fail (count == max, shortBlocks >= maxShort)──► LONG_BLOCK
LONG_BLOCK  ──blocco scaduto───────────────────────────► NORMAL  (reset TOTALE)
qualsiasi ──success────────────────────────────────────► voce rimossa (reset totale)
```

### `_applyExpiry(entry, policy, now)` — il cuore della correttezza

Viene chiamato da `check`, `recordFailure`, `checkClientLongBlock` e `sweep`
**prima** di leggere/scrivere lo stato. Gestisce due scadenze:

1. **Fine di un blocco attivo** (`blockedUntil <= now`):
   - se `tier === 'long'` → **reset totale** (anche `shortBlockCount = 0`);
   - se `tier === 'short'` → azzera solo la finestra (`failureCount`,
     `windowStartAt`), **mantiene** `shortBlockCount` (serve per escalare).
2. **Reset della memoria di escalation per inattività**: se la voce non è
   bloccata e `now - lastFailureAt > escalationResetSeconds` → azzera tutto
   (`shortBlockCount` incluso). Dopo un lungo periodo di quiete, fedina pulita.

Questo design rende il motore **lazy**: lo stato si "auto-ripara" al primo
accesso dopo una scadenza, senza bisogno di job esterni. Lo `sweep` periodico
serve solo a liberare RAM rimuovendo le voci ormai pulite.

### `recordFailure(clientId, ruleName)` — passo per passo

```
now = clock()
policy = resolvePolicy(ruleName)
entry = state.get(key) || nuova voce
_applyExpiry(entry, policy, now)

se entry è ANCORA bloccata (blockedUntil > now):
    → ritorna il verdetto corrente SENZA incrementare   (non si "punisce" durante il blocco)

# gestione finestra (findtime)
se windowStartAt == 0 OR (now - windowStartAt) > findWindowSeconds:
    windowStartAt = now; failureCount = 1      # nuova finestra
altrimenti:
    failureCount += 1
lastFailureAt = now

se failureCount >= maxFailures:
    se shortBlockCount < maxShortBlocks:
        tier='short'; blockedUntil = now + shortBlockSeconds; shortBlockCount++;
        failureCount=0; windowStartAt=0;   evento='shortBlock'
    altrimenti:
        tier='long';  blockedUntil = now + longBlockSeconds;
        failureCount=0; windowStartAt=0;   evento='longBlock'
altrimenti:
    evento='failure'

dirty = true
onEvent({ event, clientId, ruleName, tier, ... , at: now })
ritorna il verdetto
```

Punti chiave:
- **Finestra `findtime`**: i fallimenti devono concentrarsi entro
  `findWindowSeconds`; se diluiti nel tempo, la finestra riparte e non scatta il
  blocco (mitiga il "low and slow").
- Dopo aver applicato un blocco la finestra viene **azzerata**: il conteggio
  ricomincia da capo al prossimo ciclo.
- `shortBlockCount` è la **memoria di escalation**: sopravvive agli short block e
  determina quando si passa al long block.

### Altri metodi

| Metodo | Scopo |
|--------|-------|
| `check(clientId, ruleName)` | Verdetto senza side-effect sui contatori (applica solo le scadenze). `{ blocked, tier, retryAfterSeconds }` |
| `recordSuccess(clientId, ruleName)` | Rimuove la voce (reset totale). Emette evento `success` |
| `checkClientLongBlock(clientId)` | **(Livello 2)** true se l'IP ha un *long block* attivo su una qualsiasi regola. Restituisce il blocco con `retryAfter` maggiore |
| `getActiveBlocks()` | Lista dei blocchi attivi (per introspezione/admin) |
| `sweep()` | Applica le scadenze e cancella le voci ormai pulite (gestione RAM) |
| `serialize()` / `load(obj)` | Snapshot ↔ ripristino dello stato (usati da `stateStore`) |

---

## Diagrammi di flusso

### Livello 1 — richiesta di login (`POST /api/adminUsers/login`)

```
handler adminUsers
  rl = pluginSys.getSharedObject('rateLimiter')      # null se plugin disattivo
  ┌─ if (rl):
  │    verdict = rl.checkCtx(ctx, 'adminLogin')
  │    if (verdict.blocked):
  │        redirect login.ejs?error=rateLimited&retryAfter=N   ← STOP
  │
  ├─ autenticate(username, password)?
  │    ├─ SÌ → rl?.recordSuccessCtx()  (azzera contatori) → set session → redirect
  │    └─ NO → rl?.recordFailureCtx()  → engine: count++ / short / long
  │             → append JSONL
  │             → redirect login.ejs?error=invalid
```

### Livello 2 — pagina fall-through (es. `GET /qualcosa`)

```
middleware enforcement (gira dopo il router, solo su richieste non matchate)
  urlPath = ctx.path
  ┌─ per ogni pattern in exemptPaths: se matcha → next() (ESENTE)   # es. /admin/**
  │
  ├─ clientId = keyResolver(ctx)
  ├─ if (globalLongBlock): engine.checkClientLongBlock(clientId)  → blocked? → verdict
  ├─ else per ogni regola con pathPattern che matcha urlPath: engine.check(clientId, rule) → blocked? → verdict
  │
  └─ if (verdict.blocked):
        redirectTo? → ctx.redirect(redirectTo)
        else        → ctx.status = enforcement.status (429); Retry-After; body
     else:
        next()  → la pagina viene servita
```

---

## Identificazione del client (`lib/keyResolver.js`)

La prima metà della chiave è l'**IP** del client. Due modalità:

- `trustProxy: false` (default) → usa `ctx.ip` (indirizzo della socket).
  In ital8cms `app.proxy` non è impostato, quindi `ctx.ip` è l'IP reale della
  connessione.
- `trustProxy: true` → legge il **primo** valore di `X-Forwarded-For`
  (`"client, proxy1, proxy2"` → `client`).

> ⚠️ **Sicurezza:** `X-Forwarded-For` è **falsificabile** dal client. Va abilitato
> **solo** se ital8cms è dietro un reverse proxy fidato (es. nginx) che imposta
> l'header. Altrimenti un attaccante può cambiare IP ad ogni richiesta e aggirare
> il rate limit. Con `trustProxy: false` questo non è possibile.

Fallback finale: `ctx.ip` / `ctx.request.ip` / `'unknown'`.

---

## Persistenza dello stato (`lib/stateStore.js`)

Lo stato "caldo" vive in memoria; `stateStore` lo rende **durevole**:

- **Boot:** crea `state/`, legge `state/activeBlocks.json5` (via `loadJson5`) e lo
  carica nello engine (`engine.load`). Subito dopo `engine.dirty = false` (lo
  stato appena letto coincide col disco).
- **Flush periodico:** ogni `flushIntervalSeconds` (default 30s) scrive su disco
  **solo se `engine.dirty`**. Scrittura **atomica**: scrive su `*.tmp` e poi
  `rename`. Il timer usa `unref()` per non tenere vivo il processo.
- **Shutdown:** registra handler `SIGTERM`/`SIGINT` che fanno un **flush finale**.
  `gracefulShutdown` di ital8cms non chiama `process.exit` in modo sincrono
  (aspetta `server.close`), e Node esegue **tutti** i listener del segnale: il
  flush sincrono di `stateStore` completa prima dell'uscita → i blocchi
  sopravvivono al riavvio.
- `flushIntervalSeconds: 0` → nessun timer (scrittura demandata allo shutdown).

Questo segue lo stesso pattern di `urlRedirect/lib/hitCounter.js`.

---

## Audit log (`lib/attemptLog.js`)

Traccia immutabile di fallimenti e blocchi, in formato **JSONL** (una riga JSON
per evento → append-friendly, niente riscrittura dell'intero file).

- **Append:** `fs.appendFileSync` di `JSON.stringify(record) + '\n'`. Il record
  ha `ts` ISO + i campi dell'evento.
- **Rotazione:** prima di ogni append, se il file supera `rotateWhenBytes`
  (default 1 MB) viene rinominato in `logs/archive/attempts-<timestamp>.jsonl`.
- **Retention:** all'init e ad ogni rotazione, gli archivi con `mtime` più vecchio
  di `retentionDays` (default 30) vengono cancellati.
- **Resilienza:** ogni errore di I/O è degradato a `logger.warn` — il logging non
  deve **mai** interrompere il flusso di autenticazione.

Esempio di righe (`attempts.jsonl`):

```json
{"ts":"2026-06-01T08:11:16.495Z","event":"failure","clientId":"127.0.0.1","ruleName":"adminLogin","tier":"none","failureCount":1,"shortBlockCount":0,"blockedUntil":null,"retryAfterSeconds":0}
{"ts":"2026-06-01T08:11:16.546Z","event":"shortBlock","clientId":"127.0.0.1","ruleName":"adminLogin","tier":"short","failureCount":0,"shortBlockCount":1,"blockedUntil":1780301776546,"retryAfterSeconds":300}
```

---

## Configurazione

### `pluginConfig.json5` → `custom`

```json5
{
  "enabled": true,                 // off → l'oggetto condiviso è null
  "trustProxy": false,             // leggi IP da X-Forwarded-For (solo dietro proxy fidato)

  "defaults": {                    // policy ereditata da ogni regola
    "findWindowSeconds": 900,      // finestra di conteggio dei fallimenti
    "maxFailures": 5,              // fallimenti nella finestra → short block
    "shortBlockSeconds": 300,      // durata short block
    "maxShortBlocks": 5,           // short block prima dell'escalation a long
    "longBlockSeconds": 86400,     // durata long block
    "escalationResetSeconds": 86400, // inattività dopo cui si azzera shortBlockCount
  },

  "state":  { "flushIntervalSeconds": 30 },         // snapshot dello stato
  "log":    { "enabled": true, "rotateWhenBytes": 1048576, "retentionDays": 30 },
  "response": { "status": 429, "retryAfterHeader": true },  // usata da guardCtx

  "enforcement": {                 // LIVELLO 2 (middleware)
    "enabled": true,
    "globalLongBlock": true,       // IP con long block → negato su tutte le pagine fall-through
    "status": 429,
    "redirectTo": "",              // vuoto = usa lo status; altrimenti redirige
    "exemptPaths": ["/admin/**", "/public-theme-resources/**", "/admin-theme-resources/**"],
  },

  "sweepIntervalSeconds": 60,      // pulizia periodica blocchi scaduti
  "enableLogging": true,           // log a console degli eventi
  "strictValidation": false,       // true = crash boot su errori di validazione
}
```

### `protectedRoutes.json5`

Array di regole identificate da `name`. I campi di policy sono **opzionali** e
sovrascrivono i `defaults`. Il `resolvePolicy(ruleName)` fa il merge:
`override ?? defaults` per ogni campo.

```json5
{
  "rules": [
    { "name": "adminLogin", "maxFailures": 5, "shortBlockSeconds": 300 },
    // L2: protegge anche una pagina via pathPattern
    { "name": "downloadArea", "pathPattern": "/downloads/**", "maxFailures": 10 },
  ],
}
```

> In **debug mode** (`debugMode >= 1` in `ital8Config.json5`) il file viene
> riletto ad ogni chiamata (modifiche immediate). In produzione è in cache.

---

## API dell'oggetto condiviso

Esposta via `getObjectToShareToOthersPlugin(forPlugin)` e tirata on-demand con
`pluginSys.getSharedObject('rateLimiter')`. **Restituisce `null`** se il plugin è
disattivato → i consumer saltano il guard con `if (rl)`.

| Metodo | Tipo | Descrizione |
|--------|------|-------------|
| `keyFromCtx(ctx)` | ctx-aware | Identificatore del client (IP) dal contesto |
| `checkCtx(ctx, ruleName)` | ctx-aware | Verdetto senza registrare: `{ blocked, tier, retryAfterSeconds }` |
| `recordFailureCtx(ctx, ruleName)` | ctx-aware | Registra un fallimento, applica l'escalation |
| `recordSuccessCtx(ctx, ruleName)` | ctx-aware | Azzera lo stato per la chiave |
| `guardCtx(ctx, ruleName)` | ctx-aware | "Tutto-in-uno": se bloccato scrive `429` + `Retry-After` e ritorna `true` |
| `check / recordFailure / recordSuccess(clientId, ruleName)` | per-chiave | Varianti con IP esplicito |
| `getActiveBlocks()` | introspezione | Lista dei blocchi attivi |
| `getRuleNames()` | introspezione | Nomi delle regole configurate |

### API per il plugin admin (`adminRateLimiter`)

| Metodo | Tipo | Descrizione |
|--------|------|-------------|
| `releaseBlock(clientId, ruleName)` | azione live | Sblocca una chiave specifica (→ evento `release`) |
| `releaseAllForClient(clientId)` | azione live | Rimuove tutti i blocchi di un IP (→ evento `releaseAll`) |
| `banClient(clientId, ruleName, {tier?, seconds?})` | azione live | Ban manuale (→ evento `manualBlock`) |
| `getStats()` | dati | `{ enabled, enforcementEnabled, activeBlocks, shortBlocks, longBlocks, ruleCount }` |
| `getRecentAttempts({limit?, clientId?, ruleName?, event?})` | dati | Coda dell'audit log (dal più recente) |
| `getConfig()` | dati | Copia profonda di `custom` |
| `validateRules(rulesData)` / `validateConfig(custom)` | validazione | Riuso del `configValidator` prima del salvataggio |
| `reloadRules()` / `reloadConfig()` | hot-reload | Ricarica regole / config (defaults + enforcement) a caldo, senza riavvio |

Le azioni live agiscono sull'**engine in memoria** (effetto immediato). L'enforcement
L2 e le policy effettive leggono `custom` in modo **live**, quindi `reloadConfig()`
ha effetto senza riavvio (i parametri infrastrutturali — timer flush/sweep,
rotazione/retention log — restano quelli creati al boot).

> **Pull, non push.** I consumer usano `getSharedObject` (pull a runtime), non
> l'oggetto ricevuto via `setSharedObject` al boot. Motivo: al momento del push
> iniziale `engine` può essere ancora `null` (l'ordine di caricamento dei plugin
> non è garantito), mentre a runtime — quando l'handler gira — è sempre pronto.

---

## Integrazione di un consumer

### Come è cablato `adminUsers` (riferimento)

Nel handler `POST /login` di `plugins/adminUsers/main.js`:

```js
const rl = myPluginSys && myPluginSys.getSharedObject('rateLimiter');
if (rl) {
  const verdict = rl.checkCtx(ctx, 'adminLogin');
  if (verdict.blocked) {
    ctx.redirect(`/${ital8Conf.pluginPagesPrefix}/${pluginName}/login.ejs?error=rateLimited&retryAfter=${verdict.retryAfterSeconds}&referrerTo=${encodeURIComponent(getSafeRedirectUrl(referrerTo))}`);
    return;
  }
}
if (await libAccess.autenticate(username, password)) {
  if (rl) rl.recordSuccessCtx(ctx, 'adminLogin');
  /* ... login riuscito ... */
} else {
  if (rl) rl.recordFailureCtx(ctx, 'adminLogin');
  /* ... redirect error=invalid ... */
}
```

`login.ejs` mostra un messaggio dedicato su `?error=rateLimited` ("Troppi
tentativi falliti. Riprova tra N minuti.").

### Come proteggere una nuova rotta sensibile (altro plugin)

1. Aggiungi una regola in `protectedRoutes.json5`:
   `{ "name": "miaRotta", "maxFailures": 3, "shortBlockSeconds": 600 }`
2. Nel tuo handler:
   ```js
   const rl = pluginSys.getSharedObject('rateLimiter');
   if (rl && rl.guardCtx(ctx, 'miaRotta')) return;   // 429 già scritto se bloccato
   // ... operazione sensibile ...
   if (ok) rl?.recordSuccessCtx(ctx, 'miaRotta');
   else    rl?.recordFailureCtx(ctx, 'miaRotta');
   ```
3. (Opzionale, L2) aggiungi `pathPattern` alla regola per negare anche le pagine
   GET correlate quando l'IP è bloccato per quella regola.

---

## Considerazioni di sicurezza

- **IP spoofing:** vedi `keyResolver` — `trustProxy` solo dietro proxy fidato.
- **Auto-lockout:** l'enforcement (L2) esenta di default `/admin/**` e le risorse
  dei temi, per non chiudere fuori l'amministratore e permettere lo styling di
  un'eventuale pagina di blocco. Adegua `exemptPaths` se usi un `globalPrefix`
  non vuoto o prefissi diversi.
- **Pagina di login sempre visibile:** la regola `adminLogin` **non** ha
  `pathPattern`, così la pagina di login resta raggiungibile e mostra il
  messaggio di blocco; il ban prolungato dell'IP è comunque applicato dal
  `globalLongBlock` sulle altre pagine.
- **Enumerazione utenti:** un fallimento viene registrato sia per password
  errata sia per utente inesistente → il rate limit non distingue i due casi
  (nessun leak via timing del rate limiter).
- **DoS sullo stato:** la chiave è `IP + ruleName`; lo `sweep` periodico e i
  reset per scadenza/inattività mantengono limitata la dimensione della Map.

---

## Test

Suite completa co-locata in `tests/` (7 file, 99 test). I test che toccano il
filesystem usano una directory temporanea (`os.tmpdir()` / sandbox): **mai** la
cartella reale del plugin.

| File | Copre |
|------|-------|
| `tests/unit/rateLimitEngine.test.js` | Motore con clock iniettata: soglia/short block, nessun incremento durante il blocco, scadenze, escalation a long block, `findtime`, reset escalation, `success`/`sweep`/`getActiveBlocks`, `checkClientLongBlock`, `serialize`/`load`, eventi, escalation immediata (`maxShortBlocks=0`), isolamento IP/regola, policy per-regola |
| `tests/unit/keyResolver.test.js` | Risoluzione IP: `ctx.ip`, fallback, `trustProxy` + `X-Forwarded-For` (catena, trim, header assente/vuoto, ignorato se off) |
| `tests/unit/configValidator.test.js` | Validazione: defaults completi/invalidi, `maxShortBlocks=0` ammesso, regole (name mancante/vuoto/duplicato, override parziali), `validatePolicy` |
| `tests/unit/attemptLog.test.js` | JSONL: creazione dir, forma del record (`ts` ISO, niente `at`), append multipli, rotazione per dimensione, retention |
| `tests/unit/stateStore.test.js` | Persistenza: init vuoto, load round-trip, flush atomico solo se dirty, timer (0 = assente), register/remove handler SIGTERM/SIGINT |
| `tests/integration/pluginIntegration.test.js` | `main.js` end-to-end via sandbox: API guard (L1) + middleware enforcement (L2: globalLongBlock, exemptPaths, IP pulito, pathPattern) |
| `tests/integration/disabledPlugin.test.js` | `enabled=false` → oggetto condiviso `null` + middleware `[]` |

Esecuzione: `npm run test:plugin --plugin=rateLimiter` (oppure
`npx jest plugins/rateLimiter`).

---

## Dipendenze

**Utility core condivise:**
- `core/loadJson5.js` — lettura JSON5
- `core/logger.js` — logging a livelli
- `core/patternMatcher.js` — matching dei path nel middleware L2 (`*`, `**`, `regex:`)

**Node.js built-in:** `fs`, `path`.

**Nessuna dipendenza npm** e **nessuna dipendenza da altri plugin** (i consumer
dipendono opzionalmente da `rateLimiter`, non viceversa).

---

## Limitazioni note e sviluppi futuri

- **Single-process:** lo stato è in memoria. In deploy multi-processo (es. PM2
  cluster mode) i worker non condividerebbero i contatori → servirebbe uno store
  condiviso (Redis o file con lock). ital8cms gira a processo singolo di default,
  quindi oggi non è un problema.
- **`adminRateLimiter` (GUI):** plugin separato futuro per gestire regole,
  vedere i blocchi attivi e l'audit log da interfaccia. Userà l'API di
  introspezione già esposta.
- **Allow/deny list:** esenzioni o ban permanenti per IP/CIDR.
- **Chiave per-account:** opzionalmente combinare IP + username.
- **Cleanup centralizzato dei plugin allo shutdown:** oggi ogni plugin registra
  i propri handler `SIGINT`/`SIGTERM` (qui in `stateStore`); un coordinamento via
  `pluginSys` sarebbe più robusto (vedi Future Improvements in `CLAUDE.md`).
