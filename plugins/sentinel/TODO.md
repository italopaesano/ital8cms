# sentinel — TODO / roadmap

Stato di avanzamento del plugin `sentinel` (filtro delle richieste in ingresso).

Legenda: `[x]` implementato · `[ ]` da implementare · `[~]` parziale
Le fasi (v1/v2/v3) sono indicative dell'ordine, non di una scadenza.

> **Stato: v1 rilasciata** — l'osservatorio funziona end-to-end (slot pre-router,
> motore delle regole, fingerprint, log, censimenti, escalation verso
> `rateLimiter`, control plane). Restano aperte le fasi v2 (inganno e GUI) e v3
> (apprendimento), più i punti elencati in §15 e §16.

> **Nota di lettura.** Questo file è la mappa delle *capacità* del plugin.
> Le decisioni di progetto e il perché delle scelte stanno in `README.it.md`
> e `EXPLAIN.it.md`; qui c'è solo cosa c'è e cosa manca.

---

## 0. Decisioni acquisite (non più in discussione)

- Nome del plugin: `sentinel`; twin admin futuro: `adminSentinel`
- Posizionamento: slot pre-router (`sentinelGate`), fra `maintenanceGate` e `reservedGate`
- Azione di blocco: **404** riusando `reservedGate.deny()`
- Modalità di default alla prima installazione: **`monitor`**
- **Nessuna** interconnessione con `analytics` (log proprio; integrazione futura eventuale)
- Log eventi: JSONL multi-file per data, **IP pieno**, retention **365 giorni**
- Interconnessione con `rateLimiter`: **sì**
- Denylist persistente propria: **no** (soluzione A — tutta la memoria nel tempo
  è delegata a `rateLimiter`). Da rivalutare in futuro se servono ban non scadenti.
- Kill switch dal control plane: **sì**
- Header diagnostico `X-Sentinel-Rule`: **sì, solo con `debugMode >= 1`**
- Deployment attuale: **processo singolo, senza reverse proxy** — entrambi gli
  scenari futuri vanno però predisposti fin da subito (vedi §13)
- Dipendenze npm: **zero** (coerente con la filosofia del progetto)
- Regole malformate: **fail-open** + `strictValidation` opzionale
- Osservazione dell'esito delle richieste lasciate passare: **in v1**
- `censusIpMode`: default **`count`**
- **Il set di regole di default non blocca nulla.** All'installazione sentinel è
  un *osservatorio*, non un filtro: classifica il traffico e lo registra, senza
  agire. L'enforcement è una promozione consapevole fatta dall'amministratore
  dopo aver letto i propri dati. Vedi §2 → *Set di regole di default*.
- Il percorso **osserva → capisci → promuovi** è quello centrale ma **non è
  obbligato**: chi ha già le idee chiare deve poter scrivere una regola in
  `block` fin dal primo minuto, senza passare dall'osservazione.
- `active: 1` nel `pluginConfig.default.json5`: con un default non bloccante
  l'installazione non può rompere nulla.
- Fuso orario della rotazione: **ora locale del server**, come `analytics`
  (verificato: `analytics/lib/fileManager.js` usa `getFullYear/getMonth/getDate`).
- Nessun **salt di fingerprint di default** distribuito col plugin.

---

## Piano di lavoro — in che ordine, e perché

Le sezioni che seguono elencano *cosa* manca. Questa dice *in che ordine
affrontarlo*, che è una decisione diversa e non deducibile dall'elenco.

### Il vincolo che detta l'ordine

La v1 è **write-only**: sentinel osserva, classifica e registra, ma per leggere
quei dati bisogna aprire i JSONL a mano e per promuovere una regola bisogna
editare un file. Il percorso *osserva → capisci → promuovi* ha la prima fase
completa e le altre due scoperte.

Aggiungere azioni adesso significherebbe **aggiungere capacità a qualcosa che
nessuno può ancora operare**: un decoy di cui non si sa se è mai scattato vale
meno di una dashboard che mostra cosa si è già intercettato.

Da qui l'inversione rispetto alla suddivisione v1/v2/v3 della §17: **prima si
rende leggibile e governabile quello che c'è, poi si aggiungono le azioni.**

| # | Passo | Perché lì |
|---|---|---|
| ~~**0**~~ | ~~Debito e attriti~~ ✅ | Chiudere le cose piccole già mature prima di aprire fronti nuovi |
| ~~**1**~~ | ~~`adminSentinel` — Vista Dati~~ ✅ | L'unico passo che aumenta il valore del lavoro già fatto invece di aggiungerne. Stabilizza il contratto dell'oggetto condiviso prima che altre feature ci si appoggino |
| ~~**2**~~ | ~~Promozione e retrocessione~~ ✅ | Completa le fasi 2 e 3. **La retrocessione conta più della promozione**: un percorso a senso unico invita a non imboccarlo mai |
| ~~**3**~~ | ~~Tester delle regole~~ ✅ | Serve appena si comincia a scrivere regole proprie, ed è il prerequisito per scrivere in sicurezza quelle dei passi successivi |
| ~~**4**~~ | ~~`redirect` + `decoy` L0/L1~~ ✅ | Gate, validatore e non-interferenza erano **già scritti e testati**: mancava solo chi produce il corpo. Miglior rapporto valore/codice nuovo |
| **5** | Canary (`decoy` L2) + `banClient` + allerte | Il salto da difesa passiva a **sensore**: certezza di un attaccante attivo, non inferenza |
| **6** | Coerenza di sessione | Miglior segnale del blocco autenticato, ma introduce stato e foglie nuove: meglio quando la GUI può mostrarne gli effetti |
| **7** | `drop` reale e `tarpit` | Le uniche azioni che possono farti male da sole (retry aggressivi, esaurimento di file descriptor) |
| **8** | Reputazione locale e apprendimento | Poggia sul censimento, che già raccoglie i dati: qui si aggiunge solo l'inferenza |

I passi **0-3 rendono usabile** quello che c'è. I **4-5** aggiungono l'inganno.
Il **6** copre gli account. I **7-8** sono raffinamento.

### Dettaglio dei passi

**Passo 0 — Debito e attriti.** Riscrittura di `core/priorityMiddlewares/README.md`;
test di identità byte-per-byte per il blocco di sentinel (esiste per il reserved
gate, non per questo); memoizzazione del fingerprint sul socket; chiusura per
**decisione** — non per implementazione — delle voci §9 *prefissi admin* e §16
*hideExtension*.

**Passo 1 — `adminSentinel`, Vista Dati.** Plugin twin con `dependency:
{ sentinel: "^1.0.0" }` — qui la dipendenza **è** legittima, al contrario di
quella verso `rateLimiter`: il twin senza il service non ha ragione di esistere.
Mostra KPI per categoria, top regole con `authenticatedHits` in evidenza, top
impronte, sospetti scanner da `getSuspectedScanners()`, timeline, contatore
delle eviction. Il lettore dei JSONL fa la **fusione degli shard**, così il
giorno del cluster non si riscrive.

**Passo 2 — Promozione e retrocessione.** `setRuleAction(name, action)` e
`setMode(mode)` sull'oggetto condiviso, editor JSON5 raw, pulsanti sulla Vista
Dati. ⚠ Usare `setJson5Key`/`editJson5` e **mai** un `saveJson5` dell'oggetto
intero: perderebbe i commenti, che nel file delle regole sono metà del valore.

**Passo 3 — Tester delle regole.** Funzione pura che restituisce verdetto **e
traccia** delle foglie che hanno matchato. Il costo vero è la traccia:
`evaluateNode` oggi restituisce un booleano e va istrumentata con una funzione
separata, non con un flag che appesantisca il percorso caldo. Riusabile come
lettore CLI (`sentinel test <path>`), chiudendo in parte la voce §15.

**Passo 4 — `redirect` + `decoy` L0/L1.** ✅ Fatto. `lib/decoyRenderer.js`
(risoluzione con precedenza a `decoys/data/`, segnaposto, tipo dall'estensione,
cache spenta in debug) + `serveDecoy`/`serveRedirect` in `main.js`, attaccate al
verdetto **solo quando l'enforcement è in vigore**. Il validatore ha imparato
`decoy.headers` (rifiuta CR/LF, `Content-Length`, `Transfer-Encoding`,
`Set-Cookie`, hop-by-hop) e gli stati fuori intervallo. Corredo distribuito:
`wp-login.html`, `phpinfo.html`, `env.txt`, `dir-listing.html`.

Due cose emerse strada facendo, entrambe scoperte da un test:
- le spiegazioni **non possono stare dentro i file serviti** (vedi §4);
- `308` verso l'esterno è vietato quanto `301` — è il 301 dei metodi non-GET, con
  la stessa cache persistente nel browser.

**Passo 5 — Canary.** Token nel decoy + regola trappola + `banClient()` immediato
+ notifica `mailer` (che chiude anche l'allerta sul tasso di eviction, §6).

**Passo 6 — Coerenza di sessione.** `BoundedStore` per sessione con tetto e TTL
(le sessioni costano nulla da creare: altra chiave controllata dall'attaccante),
foglia `sessionAnomaly`, cadenza per account. **È qui che scatta `migrations/`**:
aggiungere foglie è additivo e il merge del boot lo copre, ma una rinomina o una
rimozione va dichiarata *nello stesso passo*, bumpando la `schemaVersion` del
**descrittore** (regola dell'orologio).

**Passi 7-8.** Vedi §3 e §5.

### Trasversali, da fare quando servono e non come passo a sé

| Voce | Quando |
|---|---|
| `migrations/` | Al primo cambio non additivo dello schema — realisticamente al passo 6 |
| `keyResolver` in `core/` | Quando `trustProxy` verrà davvero attivato: oggi sentinel ha la sua versione, che conta da destra, e consolidarle a freddo è churn |
| Limiti in cluster documentati | Insieme al passo 1, dove il lettore fa già la fusione degli shard |
| Retention del censimento | Solo se qualcuno attiva `censusIpMode: "full"` |
| Salt nel wizard | Quando si toccherà `sessionKeyManager` per altro |
| Punto cieco `bodyParser`, profilo `demo`, HTTP/2, `app.proxy` | Voci di **vigilanza**: si chiudono con una decisione scritta, non con codice |

---

## 1. Infrastruttura

- [x] `sentinelGate` in `core/priorityMiddlewares/runtimeGate.js` (guscio pre-router)
- [x] Montaggio del gate fra `maintenanceGate` e `reservedGate` in `priorityMiddlewares.js`
- [x] Iniezione del motore dopo `pluginSys.initialize()` in `index.js`
- [x] Riuso di `reservedGate.deny()` per il 404 (nessuna fabbricazione locale)
- [x] Regola di non-interferenza: superficie riservata chiusa → degrado a `deny()`
      (niente decoy, niente redirect sui path riservati)
- [x] Box `[SENTINEL]` al boot se il plugin è attivo ma lo slot è rimasto vuoto
- [x] `getWritablePaths()` per le due data dir (`data/`, `decoys/data/`)
- [ ] Riscrittura di `core/priorityMiddlewares/README.md` (chiude `TODO.md:92` della root)
- [x] Kill switch dal control plane: `npm run cli -- sentinel start|stop`
      (riusa `handleRuntimeSurfaceToggle`; via di fuga se una regola chiude tutti fuori)
- [x] `sentinel` in `npm run cli -- status`
- [x] Verificato: nessuna finestra scoperta al boot — i server HTTP partono
      (`index.js:518`) dopo il caricamento dei plugin (`index.js:206`)

---

## 2. Motore delle regole

- [x] Caricamento di `sentinelRules.json5` (+ `.default.json5`), cache in prod / re-read in debug
- [x] Semantica **first-match-wins** sull'ordine dell'array
- [x] **Fail-OPEN su regole malformate**: file illeggibile o regola invalida → il filtro
      non si attiva, box di avviso, il sito resta raggiungibile. Un filtro che
      fallisce fail-closed trasforma un errore di battitura in un blackout.
- [x] `strictValidation` (convenzione già usata da `rateLimiter`, `urlRedirect`,
      `csrfProtection`): se `true`, un errore di validazione impedisce l'avvio del plugin
- [x] Validatore delle regole con guardrail **ReDoS** (cap lunghezza input, pattern rifiutati al load)
- [x] Regex pre-compilate una sola volta
- [x] Short-circuit per estensione (`Set`, O(1)) prima delle regex
- [x] Riuso di `core/patternMatcher.js` per i pattern sui path
- [x] **Convenzione `globalPrefix`**: i path nelle regole si scrivono SENZA
      `globalPrefix`, che viene anteposto dal codice — come già fa
      `maintenance.exemptPaths` in `runtimeGate.js`
- [x] Hot-reload via oggetto condiviso (`reloadRules()`, `reloadConfig()`);
      swap atomico dell'array compilato, nessuna race con le richieste in volo
- [x] Contatore di hit per regola (chi scatta davvero? serve a potare le regole morte).
      Modello: `urlRedirect/lib/hitCounter.js`
- [ ] `migrations/` + bump di `schemaVersion` del descrittore quando cambia la
      struttura di `sentinelRules.json5` (regola del clock: il descrittore è l'orologio)

### Condizioni di match

- [x] `path` (esatto / wildcard / `regex:`)
- [x] `extension` (php, asp, aspx, jsp, cgi, env, git, sql, bak, …)
- [x] `method` (incluse le anomale: TRACE, PROPFIND, DEBUG)
- [x] `userAgent` (regex / lista / `empty`)
- [x] `header` (presenza / assenza / valore)
- [x] `query` (pattern sulla querystring)
- [x] `ip` / `cidr` (allowlist e denylist) — **IPv4 e IPv6**, con normalizzazione
      degli indirizzi IPv4-mapped (`::ffff:1.2.3.4`) che `ctx.ip` può restituire
- [x] `authenticated` / `roleIds`
- [x] `fingerprint` / `fingerprintClass` (vedi §5)
- [x] Combinatori `all` / `any` / `not`
- [x] `appliesTo`: `anonymous` | `authenticated` | `any`

### Set di regole di default — un osservatorio, non un filtro

**Decisione: il set di default non blocca nulla.** Tutte le regole fornite hanno
`action: "monitor"`. All'installazione sentinel comincia semplicemente ad
analizzare il traffico; l'amministratore legge i propri dati e poi decide cosa
promuovere a `block`.

Conseguenza sul modello: le regole di default non sono una *blocklist*, sono una
**tassonomia del traffico**. Ogni regola è un classificatore che dà un nome a una
famiglia di richieste.

- [x] `sentinelRules.default.json5` — tutte le regole in `monitor`, commentate una
      per una con cosa osservano e perché
- [x] Campo `category` sulle regole (`scanner`, `cms-probe`, `sensitive-file`,
      `anomalous-method`, `ua-mismatch`, `traversal`, …): serve ad aggregare il log
      per famiglia invece che per singolo nome di regola
- [~] Bucket implicito **`unclassified`** nelle statistiche: il censimento
      registra OGNI impronta, anche quando nessuna regola ha matchato (`count` −
      `matchedCount` = traffico non classificato), ma manca ancora una vista che
      lo presenti come tale
- [x] Flusso di **promozione `monitor` → `block`** come percorso principale del
      prodotto, non come dettaglio di configurazione — ma **mai obbligatorio**:
      una regola può nascere direttamente in `block` se chi la scrive sa cosa fa.
      Le tre fasi sono un percorso guidato offerto, non un vincolo imposto.
      *Fatto nel passo 2: pulsante per riga che propone sempre il gesto opposto,
      con conferma nominata quando la regola ha colpito utenti autenticati.*
- [x] Indicatori di confidenza calcolati dal log a supporto della promozione:
      quanti hit, quanti IP distinti, quota da bot riconosciuti, e soprattutto
      **quanti utenti autenticati sarebbero stati colpiti** (se > 0, non promuovere).
      In `data/ruleHits.json5`, campo `safeToPromote`.
- [x] Tester delle regole: data una richiesta d'esempio, dice quale regola matcha
      e perché. Valutatore separato da quello del percorso caldo (tracciare costa
      allocazioni per ogni condizione), con test di conformità su 200+ casi che
      impedisce ai due di divergere. Disponibile in GUI e da CLI
      (`sentinel test <path>`), con `--browser` per non inciampare nel profilo
      `minimal` di una richiesta sintetica.

> **Nota architetturale.** Il fatto che il default non blocchi *non* rende
> superfluo lo slot pre-router: per osservare il traffico verso `/api/*` bisogna
> stare prima del router, perché una rotta matchata non prosegue nella catena.
> Un middleware normale (post-router) vedrebbe solo le pagine — cioè proprio non
> la superficie dove vivono gli attacchi all'autenticazione.

---

## 3. Azioni

- [x] `allow` — esenzione esplicita (in cima all'elenco fa da whitelist)
- [x] `monitor` — matcha, logga, **lascia passare** (dry-run per-regola)
- [x] `block` — **404** via `reservedGate.deny()`, byte-identico a un URL inesistente
- [x] `throttle` — delega a `rateLimiter` senza bloccare subito
- [ ] `drop` — chiude la connessione senza risposta (stile nginx 444)
- [x] `decoy` — contenuto fittizio (vedi §4)
- [x] `redirect` — 30x, **permanenti vietati** verso l'esterno + allowlist di destinazioni
- [ ] `tarpit` — risposta a goccia, con cap di connessioni simultanee e timeout massimo
- [ ] `challenge` — proof-of-work / cookie challenge *(valutazione futura)*

### Modalità globale

- [x] `mode: "monitor" | "enforce"` — **default `monitor` alla prima installazione**
- [x] `authenticatedTraffic.mode`: `exempt` | `monitor` | `enforce` — default `monitor`
- [x] `enforceExemptRoles` — ruoli mai soggetti a enforcement (default `[0, 1]`)
- [x] `X-Sentinel-Rule` sulla risposta **solo** con `debugMode >= 1`

---

## 4. Evoluzione delle trappole

Scala progressiva: ogni livello presuppone il precedente.

- [x] **Livello 0 — Decoy statico.** File preparati serviti al posto dell'errore:
      `wp-login.html`, `phpinfo.html`, `env.txt`, `dir-listing.html`.
      Servito **fuori dalla pipeline EJS** (né motore di template esposto, né
      markup del tema che renda il decoy riconoscibile).
- [x] **Livello 1 — Decoy parametrico.** Versioni, path e timestamp finti generati
      al volo: due richieste non danno risposte identiche, il decoy non è
      riconoscibile da un hash del contenuto.
      Segnaposto: `{{now}}` `{{today}}` `{{timestamp}}` `{{random:N}}`
      `{{choice:a|b|c}}` `{{path}}` `{{ip}}` — gli ultimi due escapati nei decoy
      HTML (sono stringhe scelte dall'attaccante: senza escape è una XSS riflessa
      a danno di chi riceve da lui il link).
- [x] **Nessuna spiegazione dentro il file servito.** Un commento che dice
      «questo è finto» rivela il filtro a chi bussa. Le descrizioni stanno in
      `decoys/default/README.md`; un test cerca le parole rivelatrici nei file
      distribuiti.
- [ ] **Livello 2 — Canary / honeytoken.** Il decoy contiene credenziali o URL
      fasulli; una regola trappola sorveglia quegli URL. Se qualcuno li usa hai la
      **certezza** di un attaccante attivo (non un'inferenza) → ban immediato via
      `rateLimiter.banClient()`.
- [ ] **Livello 3 — Finto pannello di amministrazione.** Login fittizio che risponde
      sempre "credenziali errate" e registra i tentativi: rivela quali liste di
      credenziali ti prendono di mira, e se compaiono username reali hai la prova
      di una fuga di dati.
      ⚠ **Vincolo assoluto:** mai salvare le password in chiaro — sono spesso
      credenziali reali rubate ad altri siti. Solo hash o impronta (lunghezza,
      classi di caratteri, presenza in liste note).
- [ ] **Livello 4 — Sessione trappola persistente.** L'attaccante marcato riceve una
      versione fittizia e coerente del sito fra richieste successive.
      *Costoso, alto rischio di effetti collaterali: valutare con attenzione.*
- [ ] **Livello 5 — Istanza sandbox separata.** Il traffico ostile viene deviato su
      un'installazione isolata e monitorata. È infrastruttura, non più plugin.
      *Punto d'arrivo teorico, fuori dallo scope del plugin.*

### Organizzazione dei file dei decoy

```
decoys/
├── README.md      ← spiega la distinzione fra le due cartelle
├── default/       ← decoy forniti col plugin, VERSIONATI (sovrascritti dagli update)
└── data/          ← decoy personalizzati dall'utente, MAI toccati (git-ignored)
```

- [x] `decoys/README.md` che spiega la distinzione
- [x] Risoluzione con precedenza a `decoys/data/` sul file omonimo in `decoys/default/`
- [x] `decoys/data/` git-ignored nel contenuto ma presente nel repo (solo il README)
- [x] Simmetria con la filosofia `x.default.json5` ↔ `x.json5` del ciclo di vita
      dei config: il default è la fonte di verità versionata, il vivo è dell'utente

### Contromisure attive — non implementate per scelta

- [ ] **Zip / gzip bomb — `off` di default, mai nei preset.**
      Non è difesa ma ritorsione: con un falso positivo manda in crash il browser
      di un utente reale, e in diversi ordinamenti configura danneggiamento di
      sistema informatico altrui.
      Scenario d'uso ipotetico e circoscritto: attaccante **specifico e
      identificato**, attivazione mirata su di lui, preferibilmente su indicazione
      delle autorità competenti. Mai come regola generale, mai attiva di default.
      Se implementata: opt-in esplicito + avviso nel README + log dedicato
      (in uno scenario simile la tracciabilità di chi ha attivato cosa e quando
      è parte della difesa, non un dettaglio).

---

## 5. Fingerprinting delle richieste

L'obiettivo non è solo bloccare per firma, ma **capire su cosa si basa l'attaccante**
e accumulare statistiche locali sulle firme viste.

### Raccolta (passiva)

- [x] Fingerprint HTTP da `ctx.req.rawHeaders`: **nomi e ordine** degli header
      (Node preserva l'ordine di arrivo — segnale forte e gratuito)
- [x] Versione del protocollo (`ctx.req.httpVersion`), HTTP/1.1 vs HTTP/2
- [x] Valori normalizzati di `Accept`, `Accept-Encoding`, `Accept-Language`, `Connection`
- [x] Presenza/assenza degli header `Sec-CH-UA-*`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests`
- [x] Hash stabile della firma (**salato**, come `sessionSalt` di analytics) → `fp`
- [x] Decomposizione strutturata → `fpClass` (famiglia client, OS dichiarato,
      browser dichiarato, profilo header) — matchabile senza conoscere l'hash
- [x] **Coerenza UA ↔ fingerprint**: UA che dichiara Chrome ma firma da `curl`
      = menzogna quasi certa. È il segnale singolo più affidabile.

### Statistiche e reputazione locale

- [x] Censimento aggregato delle firme, archivio separato dal log eventi:
      `firstSeen`, `lastSeen`, `count`, path distinti, quota bloccata
- [x] `censusIpMode`: **`none` | `count` | `full`** (default `count`)
      - `none` → nessuna informazione sugli IP
      - `count` → solo il **numero** di IP distinti per firma: dà già il segnale
        botnet (una firma su 500 IP) senza conservare alcun indirizzo
      - `full` → elenco degli IP per firma: correlazione completa firma↔IP
- [ ] Se `censusIpMode: "full"`, il censimento diventa un archivio di dati
      personali a lunga conservazione → **serve una retention anche per il
      censimento**, non solo per il log eventi
- [ ] Firma mai vista prima + alta cadenza = sospetto
- [ ] Reputazione locale: firma con quota di blocchi elevata → escalation automatica *(v3)*

### Enforcement per firma

- [x] Regole che matchano su `fp` esatto
- [x] Regole che matchano su `fpClass` / componenti (l'equivalente utile del
      concetto di "range": gli hash non hanno intervalli, le **classi** sì)
- [ ] Scenario "sito riservato a un solo ecosistema" (es. solo Linux):
      filtro d'**audience**, non confine di sicurezza — l'OS dichiarato è
      falsificabile in un secondo. Da usare in `monitor` prima di `enforce`,
      per misurare quanti visitatori reali verrebbero esclusi.

### Fuori scope (motivato)

- [ ] ~~Fingerprint TLS (JA3/JA4)~~ — richiede il ClientHello grezzo, che Node non
      espone; servirebbe un hook sotto `httpsManager`, e funzionerebbe **solo** se
      ital8cms termina il TLS (non dietro reverse proxy). Verificato: `httpsManager`
      usa `https` classico, senza HTTP/2. Rivalutare solo se emerge il caso d'uso.
- [ ] ~~Fingerprint TCP/IP (p0f-style)~~ — richiede accesso ai raw socket, non
      disponibile dallo userland Node.
- [ ] ~~Fingerprint attivo lato browser (canvas, font, WebGL)~~ — **strumento sbagliato
      per questa minaccia**: funziona solo su client che eseguono JS, cioè proprio
      quelli che il filtro non deve fermare, ed è la categoria giuridicamente più
      esposta (accesso al terminale dell'utente, non semplice osservazione).

---

## 6. Log degli eventi

- [x] JSONL multi-file con rotazione per data (`sentinel-YYYY-MM-DD.jsonl`),
      stessa logica di `analytics`: `none` / `daily` / `weekly` / `monthly`
- [x] `retentionDays: 365` con pulizia all'avvio
- [x] **IP pieno** conservato (scelta esplicita: un log di sicurezza senza IP è inutile)
- [x] Schema evento con nomi di campo **compatibili con quelli di analytics** dove il
      significato coincide → una futura lettura da parte di analytics non richiederà traduttori
- [x] Buffer con flush breve (default 1s) + flush garantito su SIGTERM/SIGINT
- [x] Scritture atomiche e **fail-soft**: un errore di I/O non deve mai impedire il
      blocco né rompere la risposta
- [x] **Invariante:** `sentinel` non deve avere una directory `webPages/`
      (altrimenti il Plugin Pages System creerebbe un symlink verso la cartella del plugin)
- [x] Nota nel README sulla base giuridica: IP pieni per 365 giorni a fini di
      sicurezza (legittimo interesse, considerando 49 GDPR)

- [x] **Tetto di dimensione** oltre alla retention temporale (`maxFileBytes` +
      budget totale della data dir, eviction dal più vecchio). Sotto attacco un
      file giornaliero può crescere di gigabyte: un disco pieno non rompe sentinel,
      rompe **l'intero sito**. La retention a tempo da sola non protegge da questo.
- [x] Fuso orario della rotazione per data allineato a quello di `analytics`:
      **ora locale del server** (verificato in `analytics/lib/fileManager.js`)
- [x] **Allerta di soglia prima del limite.** Al superamento di una percentuale
      configurabile del budget disco (es. 70%), notifica — via `mailer` se
      disponibile, comunque nel log applicativo. Avvisare *prima* di dover
      cancellare dati, non dopo.
      Destinatario: **campo di configurazione esplicito** (`alertRecipient`) —
      **soluzione provvisoria e consapevole**, da rendere più robusta più avanti
      (vedi §15, API di lookup utenti). Non dedotto dagli account. Motivi:
      `adminUsers.getObjectToShareToOthersPlugin()`
      oggi restituisce `{}` — non esiste alcuna API per risolvere l'email di root —
      e comunque un indirizzo operativo (monitoraggio, on-call) è spesso diverso
      dall'account amministrativo. Vedi §7 per l'aggancio a `mailer`.
- [ ] La stessa allerta vale per il tasso di eviction anomalo (§14) e per gli
      eventi gravi (canary scattato): un unico canale di notifica, più soglie.

### Osservazione dell'esito (non solo dei blocchi) — **in v1**

- [x] Per le richieste **lasciate passare**, `await next()` e osservazione dello
      status finale: permette di scoprire pattern di attacco per cui non esiste
      ancora una regola (es. «questo IP ha collezionato 40 404 diversi in un minuto»)
- [x] **Osservare solo gli esiti non-2xx.** Un 200 non è un segnale; 404/403/500 sì.
      Taglia il volume di circa il 99% e conserva tutto il valore.
- [x] Solo aggregato, non una riga di log per richiesta (il volume sarebbe quello
      di analytics)
- [x] Attivabile/disattivabile: ha un costo su ogni richiesta servita
- [x] Nota: durante la manutenzione (`public stop`) il 503 arriva **prima** di
      sentinel, quindi non c'è osservazione. Comportamento corretto, da documentare.

---

## 7. Interconnessione con `rateLimiter`

- [x] `escalate: { rateLimiterRule: "<nome>" }` per-regola (assente = nessuna escalation)
- [x] Risoluzione **lazy** di `getSharedObject('rateLimiter')`, fallback `null`
- [x] **Nessuna** `dependency` dichiarata verso `rateLimiter`
      (altrimenti rateLimiter assente ⇒ sentinel `incomplete` ⇒ firewall spento)
- [x] Chiave per account (`user:<username>`) invece dell'IP sul traffico autenticato:
      coglie un account compromesso anche se distribuito su molti IP
- [ ] `banClient()` immediato per le regole gravi (es. canary token usato)

### Altre interconnessioni possibili (da valutare)

- [ ] `mailer`: notifica su evento grave (canary scattato, attacco massivo).
      Stesso modello: lazy, opzionale, nessuna dipendenza dichiarata.
- [ ] Fallimenti CSRF ripetuti come segnale di automazione
      (`csrfProtection` enforce nel route-wrap, quindi a valle di sentinel:
      servirebbe un canale dedicato)

---

## 8. Monitoraggio del traffico autenticato

- [ ] Osservazione sempre attiva, enforcement disattivato di default
- [ ] Coerenza di sessione: **cambio di User-Agent** dentro la stessa sessione
      (segnale fortissimo di sessione rubata, quasi privo di falsi positivi)
- [ ] Coerenza di sessione: cambio di IP / rete (più falsi positivi: mobile ↔ WiFi)
- [ ] UA non-browser su sessione autenticata (`python-requests` con cookie valido)
- [ ] Cadenza di richiesta per account (via `rateLimiter` con chiave account)
- [ ] Nota privacy nel README: monitorare account = monitorare persone identificate,
      va dichiarato nell'informativa del sito

---

## 9. Esenzioni obbligatorie (nel codice, non nel config utente)

- [x] `/.well-known/acme-challenge/` — bloccarlo impedisce il rinnovo Let's Encrypt
      e fa cadere l'HTTPS dopo 90 giorni, con una causa che nessuno collegherà al filtro
- [x] ~~Prefissi admin quando la superficie riservata è aperta~~ — **archiviata,
      non implementata**: la preoccupazione era di non chiudere fuori gli
      amministratori, ma il problema è già risolto altrove e meglio, da
      `authenticatedTraffic.mode: "monitor"` più `enforceExemptRoles: [0, 1]`.
      Bloccare una scansione **anonima** verso `/admin/*` è invece desiderabile:
      esentare quei prefissi renderebbe il pannello l'unico posto dove il filtro
      non guarda.
- [x] `curl` **in quanto tale** non è ostile (health check, webhook, monitoraggio,
      consumer API): va colpito `curl che chiede /wp-login.php`, non `curl`
- [x] La firma bot generica `\bbot\b` matcha Googlebot: mai usarla per bloccare

---

## 10. Documentazione e test

- [x] `README.it.md` + stub inglese (ital8doc v1-1, obbligatorio)
- [x] `EXPLAIN.it.md` (meccanica dello slot, coerenza del 404, fingerprinting)
- [ ] Test: il 404 di `block` è byte-identico a un 404 autentico (estende il test esistente)
- [x] Test: superficie riservata chiusa → nessun decoy né redirect sui path riservati
- [x] Test: plugin disabilitato → gate pass-through, nessun impatto
- [x] Test: guardrail ReDoS sul validatore
- [x] Test: regole malformate → fail-open, il sito resta raggiungibile
- [x] Voce in `CHANGELOG.md` (progetto alpha: breaking change ammessi ma documentati)

---

## 11. Twin admin (`adminSentinel`) — fase successiva

- [~] **Interfaccia costruita sulle tre fasi** (osserva → capisci → promuovi):
      è la spina dorsale della GUI, non un accessorio. La Vista Dati mostra in
      quale fase si trova ogni regola e cosa serve per passare alla successiva
      (colonna «utenti autenticati» + indicatore di promuovibilità); il *gesto*
      per promuovere arriva col passo 2.
- [~] Sezione admin con le **Tre Viste** — Viste A e B fatte, C (form strutturato) aperta
- [x] Vista Dati: richieste filtrate, top regole, top IP, top fingerprint, timeline
- [x] Editor JSON5 raw di `sentinelRules.json5` (validazione lato server + scrittura atomica,
      backup prima di ogni salvataggio, testo salvato senza riformattazione)
- [ ] Form strutturato coordinato con l'editor (validatore condiviso col service plugin)
- [x] Tester delle regole nella GUI (incolla una richiesta → dice cosa matcherebbe)
- [~] Azioni live via oggetto condiviso: promozione/retrocessione e passaggio
      `monitor` ↔ `enforce` **fatti** (senza riavvio); il ban immediato arriva col
      passo 5, insieme ai canary token

---

## 12. Prerequisiti trasversali

- [x] Promuovere `analytics/lib/botDetector.js` in `core/` (precedente: `patternMatcher.js`,
      `escapeHtml.js`) — evita due liste di firme UA destinate a divergere
- [ ] Valutare la promozione in `core/` della risoluzione dell'identità client
      (oggi `rateLimiter/lib/keyResolver.js`): sentinel non può dipendere da
      rateLimiter, quindi o si duplica o si condivide. Stesso precedente.

---

## 13. Predisposizione per scenari futuri

Oggi: processo singolo, nessun reverse proxy. Entrambe le cose possono cambiare,
e le decisioni che le rendono indolori vanno prese **ora**, non dopo.

### Reverse proxy

- [x] `trustProxy: false` di default (stessa convenzione di `rateLimiter`)
- [x] Quando `true`, l'IP reale si legge da `X-Forwarded-For`; da valutare
      `trustedProxyCount` per prendere la voce giusta **da destra** invece della
      prima da sinistra (la prima è scrivibile dal client: con la sola lettura
      "primo valore" un attaccante può attribuire i propri blocchi a un IP altrui
      o aggirare un ban cambiando header a ogni richiesta)
- [x] Documentare che dietro un proxy il fingerprint TLS è impossibile e quello
      HTTP può essere degradato (alcuni proxy normalizzano o riordinano gli header)
- [ ] Coerenza con `app.proxy` di Koa se in futuro venisse impostato

### Cluster multi-processo

- [x] **Nessun read-modify-write su file condivisi.** Il censimento delle firme e
      i contatori vanno scritti in shard per processo e uniti in lettura.
- [x] Nomi di file con suffisso di istanza: `sentinel-YYYY-MM-DD.<instanceId>.jsonl`,
      `fingerprintCensus.<instanceId>.json5`. Con un processo solo il suffisso è
      costante e il comportamento è identico a oggi: costo zero adesso, nessuna
      riscrittura dopo.
- [ ] Lettura = merge di tutti gli shard (il twin admin lo fa già trasparentemente)
- [ ] Documentare i limiti noti in cluster: stato in memoria per-worker
      (censimento a caldo, coerenza di sessione) e escalation `rateLimiter`
      per-worker — limitazione che `rateLimiter` ha già oggi
- [x] `append` di una singola riga JSONL è atomico su POSIX sotto i 4 KB:
      scrivere **riga per riga**, non blocchi bufferizzati di dimensione arbitraria

---

## 14. Autodifesa: limiti di risorsa

Sentinel accumula aggregati **indicizzati da valori che l'attaccante controlla**.
Ogni struttura di questo tipo è una potenziale via di esaurimento delle risorse
*contro sentinel stesso*: chi randomizza l'ordine degli header genera una firma
nuova ad ogni richiesta e fa crescere il censimento senza limite, in memoria e su
disco. Stessa forma di problema che `rateLimiter` risolve con lo sweep periodico.

- [x] **Censimento delle firme**: tetto massimo di firme tracciate + eviction LRU
- [ ] **Coerenza di sessione** (primo UA/IP visto per sessione): tetto + TTL
- [x] **Osservazione degli esiti per IP**: tetto + TTL
- [x] Sweep periodico delle strutture scadute (modello: `rateLimiter` `sweepIntervalSeconds`)
- [x] Contatore delle eviction esposto nelle statistiche: un tasso di eviction alto
      **è esso stesso il segnale** di un attacco che randomizza le firme
- [ ] Memoizzazione del fingerprint sul socket: con keep-alive molte richieste
      condividono la connessione e gli header cambiano poco → si evita di
      ricalcolare l'hash decine di volte per pagina

### Salt del fingerprint

Decisione: **nessun salt di default distribuito col plugin.** Un placeholder
condiviso sarebbe il peggiore dei mondi — dà l'illusione della separazione senza
fornirla, perché tutte le installazioni avrebbero la stessa firma per lo stesso
client.

- [x] `fingerprintSalt` vuoto nel `.default.json5`
- [x] Se valorizzato → firme locali, non confrontabili fra installazioni
- [x] Se vuoto → firme deterministiche, confrontabili: apre a set di regole
      condivisibili fra siti («questa firma è uno scanner noto»). Legittimo:
      il fingerprint HTTP è a **bassa entropia** — identifica una famiglia di
      client (Chrome 120 su Linux), non una persona.
- [ ] Generazione opzionale nel wizard, riusando `scripts/lib/sessionKeyManager.js`

---

## 15. Rimandato a versioni future

- [~] **Lettore da riga di comando** dei dati (`npm run cli -- sentinel report` o
      script dedicato). La lettura dei dati resta compito del twin; da CLI c'è
      però `sentinel test`, che copre il caso più urgente — capire perché una
      regola non scatta mentre la si sta scrivendo in SSH.
- [ ] **API di lookup utenti in `adminUsers`** — oggi
      `getObjectToShareToOthersPlugin()` restituisce `{}`. Servirebbe qualcosa come
      `getUsersByRole(roleId)` per risolvere l'email di root senza leggere
      direttamente `userAccount.json5` di un altro plugin. Utile a sentinel per le
      allerte, e probabilmente ad altri.
- [ ] **Denylist persistente propria** (vedi §0: oggi soluzione A)
- [ ] **Modalità apprendimento**: dopo N giorni di osservazione, proporre
      automaticamente un set di regole basato su quanto visto

---

## 16. Punti aperti / da rivalutare

- [ ] **Punto cieco `bodyParser`** — sentinel sta a valle di `bodyParser`, quindi una
      richiesta con body malformato riceve 400 da bodyParser e sentinel non la vede
      né la registra. Valutare se intercettare quel caso (e come, senza spostare
      sentinel a monte e perdere sessione e body).
- [x] **Interazione con `hideExtension`** — verificato, **nessuna modifica al
      codice necessaria**. Le regole per `extension` non sono toccate: una sonda
      `.php` arriva sempre con l'estensione, perché il clean URL riguarda solo le
      pagine del sito. Le regole per `path` verso pagine interne invece **devono
      coprire entrambe le forme** (`/segreta` e `/segreta.ejs`) — stessa lezione
      imparata da `adminAccessControl` in v2.70.1. Documentato in
      `sentinelRules.default.json5` e nel README, non risolvibile nel codice
      perché dipende da come l'amministratore scrive le proprie regole.
- [ ] **Profilo `demo`** — decidere se sentinel debba comportarsi diversamente
      (probabilmente no, ma va deciso esplicitamente)
- [ ] **HTTP/2** — oggi `httpsManager` non lo abilita. Se un domani lo facesse,
      la logica di fingerprint sugli header va rivista (pseudo-header e HPACK).
