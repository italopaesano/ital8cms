# rateLimiter

Plugin di **rate limiting / anti brute-force** per ital8cms. Protegge le rotte
sensibili (tipicamente il login) da tentativi ripetuti, con un motore di blocco
**a escalation**: dopo N fallimenti scatta un blocco breve; accumulando troppi
blocchi brevi si passa a un blocco lungo (giorni).

Configurabile **solo via file `.json5`**. Una futura interfaccia grafica sarà
fornita dal plugin separato `adminRateLimiter` (non incluso qui).

> 📖 Questo README è la **guida d'uso** (API, configurazione). Per il **deep-dive
> tecnico** — architettura a due livelli, motore con escalation, diagrammi di
> flusso, persistenza/audit, sicurezza — vedi [`EXPLAIN.md`](./EXPLAIN.md).

---

## Architettura: perché un "guard" e non solo un middleware

In ital8cms i middleware dei plugin vengono montati **dopo** il router
(vedi `index.js`). Per una rotta API già matchata il cui handler non chiama
`next()` — come `POST /api/adminUsers/login` — un middleware di plugin **non
viene eseguito** e quindi non può pre-bloccarla. Il blocco va perciò invocato
**dentro l'handler**, tramite l'oggetto condiviso (pull on-demand).

- **Livello 1: GUARD via oggetto condiviso.** Il consumer chiama il guard nel
  proprio handler. È il meccanismo che protegge il login.
- **Livello 2: middleware di enforcement.** Applica i *long block* come ban
  dell'IP sulle pagine fall-through (difesa in profondità) e può proteggere
  percorsi specifici via `pathPattern`, usando `core/patternMatcher.js`.

---

## Uso da un altro plugin (consumer)

La chiave di rate limit è **`IP + ruleName`**: un blocco sul login non blocca le
altre regole. Il plugin è **opzionale**: se assente/disattivo `getSharedObject`
restituisce `null` e il fallback `if (rl)` lascia il flusso invariato.

```js
// dentro un route handler del plugin consumer
const rl = pluginSys.getSharedObject('rateLimiter');

// 1) all'inizio: se l'IP è già bloccato, nega
if (rl) {
  const verdict = rl.checkCtx(ctx, 'adminLogin');
  if (verdict.blocked) {
    // verdict.retryAfterSeconds = secondi residui
    ctx.redirect('/.../login.ejs?error=rateLimited&retryAfter=' + verdict.retryAfterSeconds);
    return;
  }
}

// 2) esito dell'operazione sensibile
if (loginOk) {
  if (rl) rl.recordSuccessCtx(ctx, 'adminLogin');   // azzera i contatori
} else {
  if (rl) rl.recordFailureCtx(ctx, 'adminLogin');   // può far scattare un blocco
}
```

### API dell'oggetto condiviso

| Metodo | Descrizione |
|--------|-------------|
| `keyFromCtx(ctx)` | Restituisce l'identificatore del client (IP) dal contesto |
| `checkCtx(ctx, ruleName)` | Verdetto senza registrare nulla: `{ blocked, tier, retryAfterSeconds }` |
| `recordFailureCtx(ctx, ruleName)` | Registra un fallimento, applica l'escalation, ritorna il verdetto |
| `recordSuccessCtx(ctx, ruleName)` | Azzera ogni stato per quella chiave |
| `guardCtx(ctx, ruleName)` | "Tutto-in-uno": se bloccato scrive `429` + `Retry-After` e ritorna `true` |
| `check / recordFailure / recordSuccess(clientId, ruleName)` | Varianti con chiave esplicita (per `adminRateLimiter`) |
| `getActiveBlocks()` | Lista dei blocchi attivi |
| `getRuleNames()` | Nomi delle regole configurate |

---

## Configurazione

### `pluginConfig.json5` → `custom`

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `enabled` | `true` | Interruttore globale del plugin |
| `trustProxy` | `false` | Legge l'IP da `X-Forwarded-For` (solo dietro reverse proxy fidato) |
| `defaults.findWindowSeconds` | `900` | Finestra per accumulare i fallimenti |
| `defaults.maxFailures` | `5` | Fallimenti nella finestra → short block |
| `defaults.shortBlockSeconds` | `300` | Durata short block (5 min) |
| `defaults.maxShortBlocks` | `5` | Short block prima dell'escalation a long block |
| `defaults.longBlockSeconds` | `86400` | Durata long block (24h) |
| `defaults.escalationResetSeconds` | `86400` | Inattività dopo cui si azzera la memoria di escalation |
| `state.flushIntervalSeconds` | `30` | Intervallo di salvataggio dello stato (`0` = immediato) |
| `log.enabled` | `true` | Audit log JSONL |
| `log.rotateWhenBytes` | `1048576` | Soglia di rotazione del log |
| `log.retentionDays` | `30` | Giorni di retention degli archivi |
| `response.status` | `429` | Status usato da `guardCtx` |
| `response.retryAfterHeader` | `true` | Header `Retry-After` in `guardCtx` |
| `enforcement.enabled` | `true` | Abilita il middleware di enforcement (Livello 2) |
| `enforcement.globalLongBlock` | `true` | IP con long block attivo → negato su tutte le pagine fall-through |
| `enforcement.status` | `429` | Status del diniego dell'enforcement |
| `enforcement.redirectTo` | `""` | Pagina di redirect al posto dello status (vuoto = status) |
| `enforcement.exemptPaths` | `["/admin/**", ...]` | Percorsi sempre esenti (pattern PatternMatcher) |
| `sweepIntervalSeconds` | `60` | Pulizia periodica dei blocchi scaduti |
| `enableLogging` | `true` | Log a console degli eventi |
| `strictValidation` | `false` | Se `true`, errori di validazione fanno crashare il boot |

### `protectedRoutes.json5`

Array di regole identificate da `name`. I campi di policy sono opzionali e
sovrascrivono i `defaults`.

```json5
{
  "rules": [
    { "name": "adminLogin", "maxFailures": 5, "shortBlockSeconds": 300 },
  ],
}
```

---

## Livello 2 — enforcement (middleware)

Il middleware gira **dopo il router**, quindi agisce sulle richieste che cadono
attraverso il router (pagine statiche/EJS), non sulle rotte API già matchate
(coperte dal guard del Livello 1). Nega l'accesso quando:

1. **`globalLongBlock`** — l'IP ha un *long block* attivo su una qualsiasi
   regola: viene negato su tutte le pagine fall-through (ban prolungato dell'IP).
2. **`pathPattern`** — una regola di `protectedRoutes.json5` dichiara un
   `pathPattern`; se il percorso richiesto matcha (PatternMatcher: `*`/`**`/`regex:`)
   e l'IP è bloccato per quella regola (short o long), l'accesso è negato.

I percorsi in `enforcement.exemptPaths` passano sempre (di default l'area admin e
le risorse dei temi, per evitare l'auto-blocco e permettere lo styling di
un'eventuale pagina di blocco).

```json5
// protectedRoutes.json5 — esempio di regola protetta anche a livello di pagina
{
  "rules": [
    { "name": "downloadArea", "pathPattern": "/downloads/**", "maxFailures": 10 },
  ],
}
```

---

## Persistenza e log

- **Stato attivo:** in memoria + snapshot periodico (atomico) in
  `state/activeBlocks.json5` → i blocchi sopravvivono ai riavvii. Flush anche su
  `SIGTERM`/`SIGINT`.
- **Audit:** `logs/attempts.jsonl` (append-only, JSONL). Rotazione in
  `logs/archive/` oltre `rotateWhenBytes`; archivi più vecchi di `retentionDays`
  cancellati automaticamente.

Le directory `state/` e `logs/` sono runtime e **gitignored** (ricreate al boot).

---

## File

| File | Scopo |
|------|-------|
| `main.js` | Entry point, loadPlugin, oggetto condiviso (guard API) |
| `lib/rateLimitEngine.js` | Motore con escalation (puro, testabile) |
| `lib/keyResolver.js` | Estrazione IP/chiave dal contesto Koa |
| `lib/attemptLog.js` | Audit JSONL + rotazione + retention |
| `lib/stateStore.js` | Persistenza dello stato attivo |
| `lib/configValidator.js` | Validazione al boot |
| `protectedRoutes.json5` | Regole per rotta (per `ruleName`) |
| `tests/` | Suite di test (7 file, 77 test): motore, keyResolver, configValidator, attemptLog, stateStore, integrazione `main.js` (guard L1 + middleware L2) |
