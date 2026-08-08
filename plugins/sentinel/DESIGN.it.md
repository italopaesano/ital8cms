# sentinel — progettazione di dettaglio

> **Documento temporaneo.** Precede l'implementazione e serve a rendere
> rivedibile il progetto prima che diventi codice. Al momento dell'implementazione
> i suoi contenuti confluiranno in `README.it.md` (uso e configurazione) ed
> `EXPLAIN.it.md` (meccanica interna), secondo lo standard ital8doc v1-1, e questo
> file verrà rimosso.
>
> Le decisioni già prese e lo stato di avanzamento stanno in [`TODO.md`](./TODO.md).

Indice:
1. [Contratto dello slot `sentinelGate`](#1-contratto-dello-slot-sentinelgate)
2. [Schema di `sentinelRules.json5`](#2-schema-di-sentinelrulesjson5)
3. [Set osservativo di default](#3-set-osservativo-di-default)
4. [Schema dell'evento JSONL e del censimento](#4-schema-dellevento-jsonl-e-del-censimento)
5. [Suddivisione in fasi](#5-suddivisione-in-fasi)

---

## 1. Contratto dello slot `sentinelGate`

### 1.1 Principio di ripartizione

La separazione fra core e plugin non è arbitraria: **gli invarianti di sicurezza
stanno nel core, l'intelligenza sta nel plugin.**

| Responsabilità | Dove | Perché |
|---|---|---|
| Produrre il 404 di blocco | **core** (`reservedGate.deny()`) | Un solo posto produce il 404 di tutto il sito. Se lo producesse il plugin, una sua divergenza renderebbe la superficie enumerabile. |
| Non decorare i path riservati a superficie chiusa | **core** | È un invariante del `reservedGate`, non deve dipendere dalla correttezza di un plugin. |
| Esenzioni non negoziabili (ACME) | **core** | Un errore del plugin non deve poter far scadere il certificato TLS. |
| Tetto di enforcement (stato del gate) | **core** | Il kill switch deve funzionare anche con un motore impazzito. |
| Matching, classificazione, log, fingerprint | **plugin** | È il dominio del plugin. |
| Corpo delle risposte decoy/redirect/tarpit | **plugin** | Richiede i suoi file e la sua configurazione. |

### 1.2 Fabbrica del gate

```js
// core/priorityMiddlewares/runtimeGate.js
function createSentinelGate({ ital8Conf, reservedGate, initialState = 'running' })
```

Restituisce:

```js
{
  middleware,                 // (ctx, next) => Promise<void>
  setEngine(engine | null),   // iniettato da index.js dopo pluginSys.initialize()
  hasEngine(),                // → boolean
  setState(state),            // 'running' | 'monitor' | 'stopped'
  getState(),                 // → state
  isClosed(),                 // → state === 'stopped'
}
```

Tre stati, corrispondenti ai tre comandi CLI:

| Stato | Comportamento |
|---|---|
| `running` | Il motore decide; il gate applica. Configurazione dichiarata nei file. |
| `monitor` | Il motore decide ma **nessuna azione viene applicata**. Osservazione e log restano attivi. È «riportami alla fase 1». |
| `stopped` | Il motore non viene nemmeno interrogato. Pass-through puro. Vero kill switch. |

### 1.3 Contratto del motore

Fornito dal plugin via `getObjectToShareToOthersPlugin()`; `index.js` lo passa a
`setEngine()`. Tutti i metodi sono opzionali tranne `evaluate`.

```js
{
  /**
   * Valuta la richiesta. Chiamato PRIMA di next().
   * NON deve scrivere sulla risposta né chiamare next().
   * Può essere async (la risoluzione di un decoy legge da disco).
   *
   * @returns {Verdict|null}  null = nessuna regola ha matchato
   */
  async evaluate(ctx),

  /**
   * Chiamato DOPO next(), solo per le richieste lasciate passare e solo
   * quando lo status finale NON è 2xx (il filtro sugli esiti lo fa il gate).
   * Deve essere fail-soft: non lancia mai, non ritarda la risposta.
   */
  observeOutcome(ctx, { startedAt, verdict }),

  /** Notifica dei cambi di stato del gate (per il log e le statistiche). */
  onGateState(state),
}
```

### 1.4 Il verdetto

```js
{
  action:   'allow' | 'monitor' | 'block' | 'drop'
          | 'decoy' | 'redirect' | 'throttle' | 'tarpit',
  ruleName: 'php-probe',       // chiave primaria della regola
  category: 'cms-probe',
  enforce:  false,             // il MOTORE ha già applicato il proprio tetto
                               // (mode globale + action della regola)
  respond:  async (ctx) => {}, // solo per decoy/redirect/tarpit; assente altrimenti
}
```

**`enforce` è una proposta, non un ordine.** Il gate applica il proprio stato
come ulteriore tetto: con `state === 'monitor'` un `enforce: true` viene ignorato.
Due tetti indipendenti (config e runtime), entrambi in grado di fermare
l'enforcement da soli, nessuno dei due in grado di forzarlo contro l'altro.

### 1.5 Algoritmo del middleware

```
1.  state === 'stopped'        → next()
2.  !hasEngine()               → next()
3.  path esente (ACME, ...)    → next()                     [invariante core]
4.  verdict = await engine.evaluate(ctx)
      · eccezione              → log una volta + next()      [fail-open]
      · timeout superato       → log + next()                [fail-open]
5.  verdict null | allow | monitor
                               → passThrough()
6.  enforced = verdict.enforce && state === 'running'
      · !enforced              → passThrough()
7.  debugMode ≥ 1              → ctx.set('X-Sentinel-Rule', verdict.ruleName)
8.  azione:
      · block | drop           → reservedGate.deny(ctx)
      · decoy|redirect|tarpit  → se reservedGate.isClosed()
                                   && reservedGate.isReservedPath(ctx.path)
                                 → reservedGate.deny(ctx)     [non-interferenza]
                                 altrimenti → await verdict.respond(ctx)

passThrough():
    startedAt = Date.now()
    await next()
    se ctx.status non è 2xx  → engine.observeOutcome(ctx, { startedAt, verdict })
```

Note sull'algoritmo:

- **Il passo 3 sta nel core** e non è configurabile dal plugin: nessuna regola,
  per quanto sbagliata, può bloccare il rinnovo del certificato.
- **Il passo 4 è protetto due volte:** try/catch e un tetto di tempo. Un motore
  che lancia o che si impianta non può portarsi dietro il sito. L'errore viene
  loggato una volta sola (non una volta per richiesta) per non trasformare un
  bug in un attacco al disco.
- **`drop` produce oggi lo stesso 404 di `block`** (v1); la chiusura vera della
  connessione arriva in v2, quando sarà maneggiata sul socket con le sue cautele.
- **L'osservazione dell'esito è filtrata dal gate** (solo non-2xx), così il motore
  non riceve nemmeno le chiamate che scarterebbe.

### 1.6 Punti di innesto

| File | Modifica |
|---|---|
| `core/priorityMiddlewares/runtimeGate.js` | aggiunge `createSentinelGate`, esportata accanto alle due esistenti |
| `core/priorityMiddlewares/priorityMiddlewares.js` | crea il gate dopo `reservedGate`, lo monta **fra** maintenance e reserved, lo restituisce |
| `index.js` | dopo `pluginSys.initialize()`: `sentinelGate.setEngine(pluginSys.getSharedObject('sentinel'))`; box `[SENTINEL]` se il plugin è attivo ma lo slot è vuoto |
| `core/cliBridge/handlers.js` | terza superficie `sentinel` con tre verbi (`start`/`stop`/`monitor`) |
| `core/cliBridge/stateFile.js` | terzo campo di stato, **fail-open** in caso di file corrotto (come `public`, al contrario di `reserved`) |

Il fail-open sullo state file merita una riga: se il file di stato è illeggibile,
`public` torna `running` e `reserved` torna `stopped`, perché per la superficie
riservata il rischio è opposto. Per `sentinel` il rischio somiglia a quello di
`public`: un file corrotto non deve spegnere il filtro — ma nemmeno accenderlo su
`running` se non lo era. Default `running`, coerente con `active: 1` e con un
comportamento che di suo non blocca nulla.

---

## 2. Schema di `sentinelRules.json5`

### 2.1 Struttura del file

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  schemaVersion: 1,

  rules: [
    // valutate NELL'ORDINE: first-match-wins
  ],
}
```

### 2.2 Struttura di una regola

```json5
{
  // ── Identità ──────────────────────────────────────────────────────────
  name:        "php-probe",   // OBBLIGATORIO, univoco. Chiave primaria: lega
                              // fra loro contatori, log e azioni della GUI.
                              // Rinominarla azzera la sua storia.
  enabled:     true,
  category:    "cms-probe",   // per aggregare il log per famiglia
  description: "Richieste verso file .php su un CMS che non esegue PHP",

  // ── Ambito ────────────────────────────────────────────────────────────
  appliesTo:   "any",         // "anonymous" | "authenticated" | "any"

  // ── Condizioni ────────────────────────────────────────────────────────
  match: { /* vedi 2.3 */ },

  // ── Azione ────────────────────────────────────────────────────────────
  action:      "monitor",     // allow | monitor | block | drop
                              // | decoy | redirect | throttle | tarpit

  // ── Parametri dell'azione (solo quelli pertinenti) ────────────────────
  decoy:    { file: "wp-login.html", status: 200 },
  redirect: { to: "/not-available", status: 302 },
  escalate: { rateLimiterRule: "scanner" },
}
```

### 2.3 Il blocco `match`

Un nodo è **una foglia** (una condizione) oppure **un combinatore** (`all`, `any`,
`not`). Un oggetto con più foglie equivale a un `all` implicito.

```json5
// AND implicito
match: { extension: ["php"], appliesTo: "anonymous" }

// esplicito
match: {
  all: [
    { path: "/wp-admin/**" },
    { not: { ip: ["192.168.0.0/16"] } },
  ],
}

match: { any: [ { extension: ["php"] }, { path: "/xmlrpc.php" } ] }
```

**Foglie disponibili**

| Foglia | Forma | Note |
|---|---|---|
| `path` | `"/wp-admin/**"` · `"regex:^/wp-"` | Via `core/patternMatcher.js`. **Senza `globalPrefix`**, anteposto dal codice. |
| `extension` | `["php", "asp"]` | Ultimo segmento del path. Lookup su `Set`, valutata prima delle regex. |
| `method` | `["TRACE", "PROPFIND"]` | Maiuscolo. |
| `userAgent` | `"regex:^curl/"` · `"empty"` · `["curl", "wget"]` | Input troncato a 512 caratteri prima del test (guardrail ReDoS). |
| `header` | `{ name: "Accept-Language", present: false }` · `{ name: "X-Foo", value: "regex:..." }` | Nome case-insensitive. |
| `query` | `"regex:union\\s+select"` | Sulla querystring grezza. |
| `ip` | `["10.0.0.0/8", "2001:db8::/32"]` | IPv4 + IPv6, con normalizzazione degli IPv4-mapped. |
| `authenticated` | `true` / `false` | |
| `roleIds` | `[0, 1]` | Vero se l'utente ha **almeno uno** dei ruoli. |
| `fingerprint` | `["a3f9c2e1…"]` | Hash esatto. |
| `fingerprintClass` | `{ family: "curl", coherent: false }` | Match parziale sui componenti: tutte le chiavi indicate devono corrispondere. |
| `status` | `[404, 403]` | **Solo nell'osservazione dell'esito**, ignorata in `evaluate`. |

### 2.4 Precedenza — le tre regole che decidono tutto

1. **First-match-wins.** Si scorre l'array dall'alto; la prima regola `enabled`
   che matcha produce il verdetto. Le `allow` si mettono in cima.
2. **La modalità globale è un tetto, non un override.** `mode: "monitor"`
   impedisce a qualsiasi regola di agire, `block` incluse. `mode: "enforce"` non
   promuove nulla: una regola in `monitor` resta osservativa.
3. **Lo stato del gate è un secondo tetto**, indipendente dal primo e commutabile
   a caldo dalla CLI senza toccare i file.

Conseguenza pratica: per fermare tutto l'enforcement ci sono **due** interruttori
indipendenti, e nessuno dei due può essere scavalcato dall'altro né da una regola.

### 2.5 Validazione

Errori (regola scartata; con `strictValidation: true` il plugin non si attiva):

- `name` mancante, non stringa, o duplicato
- `action` sconosciuta
- `match` assente o vuoto
- regex non compilabile
- regex con **nesting di quantificatori** (`(a+)+`, `(a*)*`): sospetta di
  backtracking catastrofico, rifiutata al load
- CIDR malformato
- `decoy.file` che esce dalla cartella dei decoy (path traversal)
- `redirect.to` esterno con destinazione fuori dall'allowlist
- `redirect.status: 301` verso l'esterno (vietato: la cache persistente del
  browser rende irreparabile un falso positivo)

Avvisi (regola mantenuta):

- regola irraggiungibile perché preceduta da una `allow` più generica
- `escalate` verso una regola inesistente in `protectedRoutes.json5`
- regola in `block` con zero hit registrati (candidata a essere rimossa)

---

## 3. Set osservativo di default

Tutte le regole sono `action: "monitor"`: all'installazione **non viene bloccato
nulla**. Il file è una tassonomia del traffico, non una blocklist.

| # | `name` | `category` | Cosa osserva |
|---|---|---|---|
| 1 | `sensitive-file-probe` | `sensitive-file` | `.env`, `.git/*`, `.htaccess`, `config.*`, chiavi private |
| 2 | `php-probe` | `cms-probe` | Qualsiasi richiesta `.php` — ital8cms non esegue PHP, quindi il segnale è puro |
| 3 | `foreign-cms-probe` | `cms-probe` | `/wp-*`, `/administrator`, `/drupal`, `/typo3`, `/joomla` |
| 4 | `db-admin-probe` | `cms-probe` | `/phpmyadmin`, `/adminer`, `/pma`, `/mysql` |
| 5 | `backup-probe` | `sensitive-file` | `.sql`, `.bak`, `.zip`, `.tar.gz`, `.dump` sui path radice |
| 6 | `anomalous-method` | `anomalous-method` | `TRACE`, `TRACK`, `DEBUG`, `PROPFIND`, `CONNECT` |
| 7 | `ua-absent` | `ua-anomaly` | Nessun `User-Agent`: nessun browser lo omette |
| 8 | `ua-fingerprint-mismatch` | `ua-mismatch` | UA che dichiara un browser, firma da client script — il segnale più affidabile |
| 9 | `traversal-attempt` | `traversal` | `../`, `%2e%2e` nella **querystring** (il path è già coperto dal gate canonico) |
| 10 | `shell-probe` | `scanner` | Nomi di webshell noti (`c99`, `r57`, `shell.php`, `wso`) |
| 11 | `auth-surface-noise` | `scanner` | Richieste agli endpoint di autenticazione con firma non-browser, `appliesTo: "anonymous"` |

Le esenzioni non compaiono nel file: ACME e prefissi admin sono precondizioni nel
core (§1.5, passo 3), non decisioni configurabili.

**Come si legge il risultato.** Dopo qualche settimana, `category` dice la
composizione del traffico ostile, `name` dice quale regola vale la pena
promuovere, e il numero di **utenti autenticati colpiti** dice se promuoverla è
sicuro. Il traffico anomalo che nessuna regola descrive finisce nel bucket
`unclassified`: è lì che si scoprono le regole mancanti.

---

## 4. Schema dell'evento JSONL e del censimento

### 4.1 Evento

`data/sentinel-YYYY-MM-DD.jsonl` — una riga per evento, ora locale del server
(stessa convenzione di `analytics`).

```jsonc
{
  // ── Campi con lo stesso nome e significato di analytics ──
  "timestamp":       "2026-08-08T14:22:31.004Z",
  "path":            "/wp-login.php",
  "method":          "GET",
  "statusCode":      404,
  "durationMs":      2,
  "referrer":        null,
  "userAgent":       "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
  "isBot":           false,
  "botName":         null,
  "sessionHash":     null,
  "isAuthenticated": false,
  "isAdmin":         false,

  // ── Campi propri di sentinel ──
  "ip":         "203.0.113.44",        // PIENO
  "ruleName":   "ua-fingerprint-mismatch",
  "category":   "ua-mismatch",
  "action":     "monitor",
  "enforced":   false,                 // false = avrebbe agito, ma era in osservazione
  "matchedOn":  "fingerprintClass",
  "fp":         "a3f9c2e1b7d4",
  "fpClass":    { "family": "curl", "claimedBrowser": "chrome",
                  "claimedOs": "windows", "headerProfile": "minimal",
                  "coherent": false },
  "username":   null,                  // valorizzato solo se autenticato
  "escalated":  false
}
```

Un evento viene scritto quando una regola matcha (qualsiasi azione tranne
`allow`, che viene solo contata). Le richieste che non matchano nulla **non
producono righe**: contribuiscono solo agli aggregati.

### 4.2 Censimento delle firme

`data/fingerprintCensus.json5` — aggregato, riscritto periodicamente.

```json5
{
  schemaVersion: 1,
  updatedAt: "2026-08-08T14:30:00.000Z",
  evictions: 0,            // > 0 con firme randomizzate: è esso stesso un segnale

  fingerprints: {
    "a3f9c2e1b7d4": {
      firstSeen:    "2026-07-02T08:11:00.000Z",
      lastSeen:     "2026-08-08T14:22:31.004Z",
      count:        4127,
      ipCount:      512,   // censusIpMode: "count" — nessun indirizzo conservato
      ips:          [],    // popolato solo con censusIpMode: "full"
      pathCount:    88,
      matchedCount: 4127,  // quante volte una regola ha matchato
      blockedCount: 0,
      class: { family: "curl", claimedBrowser: "chrome", coherent: false },
    },
  },
}
```

`ipCount: 512` su una singola firma è il segnale botnet, ottenuto **senza
conservare un solo indirizzo**. Il segnale inverso — un IP con molte firme — si
ricava dall'aggregato per IP degli esiti.

### 4.3 Aggregato degli esiti

`data/outcomeCensus.json5` — alimentato dall'osservazione post-`next()`, solo
esiti non-2xx, con TTL ed eviction.

```json5
{
  schemaVersion: 1,
  window: "rolling-24h",
  byClient: {
    "203.0.113.44": {
      firstSeen: "...", lastSeen: "...",
      total: 213,
      byStatus: { "404": 207, "403": 6 },
      distinctPaths: 198,   // 198 path diversi tutti in 404 = scansione,
                            // senza che nessuna regola la descriva
    },
  },
}
```

### 4.4 Limiti di risorsa

Ogni struttura indicizzata da valori controllati dall'attaccante ha tetto,
eviction LRU, TTL e sweep periodico. Il contatore delle eviction è esposto nelle
statistiche perché un tasso anomalo *è* l'indicatore di un avversario che
randomizza le firme per gonfiare il censimento.

| Struttura | Tetto proposto | TTL |
|---|---|---|
| `fingerprintCensus` | 10.000 firme | 90 giorni dall'ultimo avvistamento |
| `outcomeCensus` | 5.000 client | 24 ore |
| Coerenza di sessione (v2) | 5.000 sessioni | durata della sessione Koa |

---

## 5. Suddivisione in fasi

### v1 — l'osservatorio

Obiettivo: **installi, non succede niente, e dopo una settimana sai chi bussa.**

- Slot `sentinelGate` nel core + montaggio + iniezione + box `[SENTINEL]`
- Tre verbi CLI (`sentinel start | stop | monitor`) e stato in `status`
- Motore delle regole: caricamento, validazione con guardrail ReDoS, first-match-wins,
  hot-reload, contatore di hit per regola
- Azioni: `allow`, `monitor`, `block` (404 via `deny()`), `throttle`
- Fingerprint HTTP + `fpClass` + controllo di coerenza UA↔firma
- Log eventi JSONL con rotazione, retention 365 giorni, tetto di dimensione,
  allerta di soglia
- Censimento firme (`censusIpMode: "count"`) e aggregato degli esiti
- Osservazione degli esiti non-2xx
- Escalation verso `rateLimiter` (lazy, opzionale)
- Set osservativo di default (11 regole in `monitor`)
- Limiti di risorsa con sweep
- `getWritablePaths()`, scritture atomiche fail-soft
- `README.it.md` + `EXPLAIN.it.md` + stub inglesi + test + `CHANGELOG.md`

### v2 — l'inganno e la GUI

- `decoy` livelli 0-2 (statico, parametrico, canary token) con `decoys/default` + `decoys/data`
- `redirect` con allowlist e 302 forzato; `drop` vero sul socket
- Coerenza di sessione (cambio UA/IP dentro la stessa sessione)
- Monitoraggio del traffico autenticato con chiave per account su `rateLimiter`
- Allerte via `mailer`
- **`adminSentinel`**: Tre Viste, interfaccia costruita sulle tre fasi,
  promozione **e retrocessione** in un gesto, tester delle regole

### v3 — l'apprendimento

- `tarpit` con cap di connessioni e timeout
- Reputazione locale delle firme → escalation automatica
- Modalità apprendimento: proposta automatica di regole dopo N giorni
- Decoy livello 3 (finto pannello, con le cautele su credenziali e privacy)

### Prerequisiti trasversali (prima di v1)

- Promuovere `analytics/lib/botDetector.js` in `core/`
- Valutare la promozione in `core/` della risoluzione dell'identità client
  (oggi `rateLimiter/lib/keyResolver.js`), con lettura corretta di
  `X-Forwarded-For` da destra quando `trustProxy` è attivo
