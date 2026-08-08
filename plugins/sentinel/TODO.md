# sentinel — TODO / roadmap

Stato di avanzamento del plugin `sentinel` (filtro delle richieste in ingresso).

Legenda: `[x]` implementato · `[ ]` da implementare · `[~]` parziale
Le fasi (v1/v2/v3) sono indicative dell'ordine, non di una scadenza.

> **Nota di lettura.** Questo file è la mappa delle *capacità* del plugin.
> Le decisioni di progetto e il perché delle scelte stanno in `README.it.md`
> e `EXPLAIN.it.md`; qui c'è solo cosa c'è e cosa manca.

---

## 1. Infrastruttura

- [ ] `sentinelGate` in `core/priorityMiddlewares/runtimeGate.js` (guscio pre-router)
- [ ] Montaggio del gate fra `maintenanceGate` e `reservedGate` in `priorityMiddlewares.js`
- [ ] Iniezione del motore dopo `pluginSys.initialize()` in `index.js`
- [ ] Riuso di `reservedGate.deny()` per il 404 (nessuna fabbricazione locale)
- [ ] Regola di non-interferenza: superficie riservata chiusa → degrado a `deny()`
      (niente decoy, niente redirect sui path riservati)
- [ ] Box `[SENTINEL]` al boot se il plugin è attivo ma lo slot è rimasto vuoto
- [ ] `getWritablePaths()` per la data dir (gate di scrivibilità al boot)
- [ ] Riscrittura di `core/priorityMiddlewares/README.md` (chiude `TODO.md:92` della root)
- [ ] Kill switch dal control plane: `npm run cli -- sentinel start|stop`
      (riusa `handleRuntimeSurfaceToggle`; via di fuga se una regola chiude tutti fuori)

---

## 2. Motore delle regole

- [ ] Caricamento di `sentinelRules.json5` (+ `.default.json5`), cache in prod / re-read in debug
- [ ] Semantica **first-match-wins** sull'ordine dell'array
- [ ] Validatore delle regole con guardrail **ReDoS** (cap lunghezza input, pattern rifiutati al load)
- [ ] Regex pre-compilate una sola volta
- [ ] Short-circuit per estensione (`Set`, O(1)) prima delle regex
- [ ] Riuso di `core/patternMatcher.js` per i pattern sui path
- [ ] Hot-reload via oggetto condiviso (`reloadRules()`, `reloadConfig()`)

### Condizioni di match

- [ ] `path` (esatto / wildcard / `regex:`)
- [ ] `extension` (php, asp, aspx, jsp, cgi, env, git, sql, bak, …)
- [ ] `method` (incluse le anomale: TRACE, PROPFIND, DEBUG)
- [ ] `userAgent` (regex / lista / `empty`)
- [ ] `header` (presenza / assenza / valore)
- [ ] `query` (pattern sulla querystring)
- [ ] `ip` / `cidr` (allowlist e denylist)
- [ ] `authenticated` / `roleIds`
- [ ] `fingerprint` / `fingerprintClass` (vedi §5)
- [ ] Combinatori `all` / `any` / `not`
- [ ] `appliesTo`: `anonymous` | `authenticated` | `any`

---

## 3. Azioni

- [ ] `allow` — esenzione esplicita (in cima all'elenco fa da whitelist)
- [ ] `monitor` — matcha, logga, **lascia passare** (dry-run per-regola)
- [ ] `block` — **404** via `reservedGate.deny()`, byte-identico a un URL inesistente
- [ ] `throttle` — delega a `rateLimiter` senza bloccare subito
- [ ] `drop` — chiude la connessione senza risposta (stile nginx 444)
- [ ] `decoy` — contenuto fittizio (vedi §4)
- [ ] `redirect` — 30x, **302 forzato** per l'esterno + allowlist di destinazioni
- [ ] `tarpit` — risposta a goccia, con cap di connessioni simultanee e timeout massimo
- [ ] `challenge` — proof-of-work / cookie challenge *(valutazione futura)*

### Modalità globale

- [ ] `mode: "monitor" | "enforce"` — **default `monitor` alla prima installazione**
- [ ] `authenticatedTraffic.mode`: `exempt` | `monitor` | `enforce` — default `monitor`
- [ ] `enforceExemptRoles` — ruoli mai soggetti a enforcement (default `[0, 1]`)

---

## 4. Evoluzione delle trappole

Scala progressiva: ogni livello presuppone il precedente.

- [ ] **Livello 0 — Decoy statico.** File preparati serviti al posto dell'errore:
      finto `wp-login.php`, finto `phpinfo()`, finto `.env`, finto listing.
      Servito **fuori dalla pipeline EJS** (né motore di template esposto, né
      markup del tema che renda il decoy riconoscibile).
- [ ] **Livello 1 — Decoy parametrico.** Versioni, path e timestamp finti generati
      al volo: due richieste non danno risposte identiche, il decoy non è
      riconoscibile da un hash del contenuto.
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

### Contromisure attive — non implementate per scelta

- [ ] **Zip / gzip bomb — `off` di default, mai nei preset.**
      Non è difesa ma ritorsione: con un falso positivo manda in crash il browser
      di un utente reale, e in diversi ordinamenti configura danneggiamento di
      sistema informatico altrui.
      Scenario d'uso ipotetico e circoscritto: attaccante **specifico e
      identificato**, attivazione mirata su di lui, preferibilmente su indicazione
      delle autorità competenti. Mai come regola generale, mai attiva di default.
      Se implementata: richiede opt-in esplicito + avviso nel README + log dedicato.

---

## 5. Fingerprinting delle richieste

L'obiettivo non è solo bloccare per firma, ma **capire su cosa si basa l'attaccante**
e accumulare statistiche locali sulle firme viste.

### Raccolta (passiva)

- [ ] Fingerprint HTTP da `ctx.req.rawHeaders`: **nomi e ordine** degli header
      (Node preserva l'ordine di arrivo — segnale forte e gratuito)
- [ ] Versione del protocollo (`ctx.req.httpVersion`), HTTP/1.1 vs HTTP/2
- [ ] Valori normalizzati di `Accept`, `Accept-Encoding`, `Accept-Language`, `Connection`
- [ ] Presenza/assenza degli header `Sec-CH-UA-*`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests`
- [ ] Hash stabile della firma (**salato**, come `sessionSalt` di analytics) → `fp`
- [ ] Decomposizione strutturata → `fpClass` (famiglia client, OS dichiarato,
      browser dichiarato, profilo header) — matchabile senza conoscere l'hash
- [ ] **Coerenza UA ↔ fingerprint**: UA che dichiara Chrome ma firma da `curl`
      = menzogna quasi certa. È il segnale singolo più affidabile.

### Statistiche e reputazione locale

- [ ] Censimento aggregato delle firme (store separato dal log eventi):
      `firstSeen`, `lastSeen`, `count`, IP distinti, path distinti, quota bloccata
- [ ] Nessun IP nel censimento (solo conteggi) → profilo privacy leggero, retention lunga
- [ ] Firma mai vista prima + alta cadenza = sospetto
- [ ] Reputazione locale: firma con quota di blocchi elevata → escalation automatica *(v3)*

### Enforcement per firma

- [ ] Regole che matchano su `fp` esatto
- [ ] Regole che matchano su `fpClass` / componenti (l'equivalente utile del
      concetto di "range": gli hash non hanno intervalli, le **classi** sì)
- [ ] Scenario "sito riservato a un solo ecosistema" (es. solo Linux):
      filtro d'**audience**, non confine di sicurezza — l'OS dichiarato è
      falsificabile in un secondo. Da usare in `monitor` prima di `enforce`,
      per misurare quanti visitatori reali verrebbero esclusi.

### Fuori scope (motivato)

- [ ] ~~Fingerprint TLS (JA3/JA4)~~ — richiede il ClientHello grezzo, che Node non
      espone; servirebbe un hook sotto `httpsManager`, e funzionerebbe **solo** se
      ital8cms termina il TLS (non dietro nginx). Rivalutare solo se emerge il caso d'uso.
- [ ] ~~Fingerprint TCP/IP (p0f-style)~~ — richiede accesso ai raw socket, non
      disponibile dallo userland Node.
- [ ] ~~Fingerprint attivo lato browser (canvas, font, WebGL)~~ — **strumento sbagliato
      per questa minaccia**: funziona solo su client che eseguono JS, cioè proprio
      quelli che il filtro non deve fermare, ed è la categoria giuridicamente più
      esposta (accesso al terminale dell'utente, non semplice osservazione).

---

## 6. Log degli eventi

- [ ] JSONL multi-file con rotazione per data (`sentinel-YYYY-MM-DD.jsonl`),
      stessa logica di `analytics`: `none` / `daily` / `weekly` / `monthly`
- [ ] `retentionDays` con pulizia all'avvio
- [ ] **IP pieno** conservato (scelta esplicita: un log di sicurezza senza IP è inutile)
- [ ] Schema evento con nomi di campo **compatibili con quelli di analytics** dove il
      significato coincide → una futura lettura da parte di analytics non richiederà traduttori
- [ ] Buffer con flush breve (default 1s) + flush garantito su SIGTERM/SIGINT
- [ ] Scritture atomiche e **fail-soft**: un errore di I/O non deve mai impedire il
      blocco né rompere la risposta
- [ ] **Invariante:** `sentinel` non deve avere una directory `webPages/`
      (altrimenti il Plugin Pages System creerebbe un symlink verso la cartella del plugin)

---

## 7. Interconnessione con `rateLimiter`

- [ ] `escalate: { rateLimiterRule: "<nome>" }` per-regola (assente = nessuna escalation)
- [ ] Risoluzione **lazy** di `getSharedObject('rateLimiter')`, fallback `null`
- [ ] **Nessuna** `dependency` dichiarata verso `rateLimiter`
      (altrimenti rateLimiter assente ⇒ sentinel `incomplete` ⇒ firewall spento)
- [ ] Chiave per account (`user:<username>`) invece dell'IP sul traffico autenticato:
      coglie un account compromesso anche se distribuito su molti IP
- [ ] `banClient()` immediato per le regole gravi (es. canary token usato)

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

- [ ] `/.well-known/acme-challenge/` — bloccarlo impedisce il rinnovo Let's Encrypt
      e fa cadere l'HTTPS dopo 90 giorni, con una causa che nessuno collegherà al filtro
- [ ] Prefissi admin quando la superficie riservata è aperta
- [ ] `curl` **in quanto tale** non è ostile (health check, webhook, monitoraggio,
      consumer API): va colpito `curl che chiede /wp-login.php`, non `curl`
- [ ] La firma bot generica `\bbot\b` matcha Googlebot: mai usarla per bloccare

---

## 10. Documentazione e test

- [ ] `README.it.md` + stub inglese (ital8doc v1-1, obbligatorio)
- [ ] `EXPLAIN.it.md` (meccanica dello slot, coerenza del 404, fingerprinting)
- [ ] Test: il 404 di `block` è byte-identico a un 404 autentico (estende il test esistente)
- [ ] Test: superficie riservata chiusa → nessun decoy né redirect sui path riservati
- [ ] Test: plugin disabilitato → gate pass-through, nessun impatto
- [ ] Test: guardrail ReDoS sul validatore
- [ ] Voce in `CHANGELOG.md` (progetto alpha: breaking change ammessi ma documentati)

---

## 11. Twin admin (`adminSentinel`) — fase successiva

- [ ] Sezione admin con le **Tre Viste**
- [ ] Vista Dati: richieste filtrate, top regole, top IP, top fingerprint, timeline
- [ ] Editor JSON5 raw di `sentinelRules.json5` (validazione lato server + scrittura atomica)
- [ ] Form strutturato coordinato con l'editor (validatore condiviso col service plugin)
- [ ] Azioni live via oggetto condiviso: toggle regola, ban immediato, passaggio
      `monitor` ↔ `enforce` senza riavvio

---

## 12. Prerequisiti trasversali

- [ ] Promuovere `analytics/lib/botDetector.js` in `core/` (precedente: `patternMatcher.js`,
      `escapeHtml.js`) — evita due liste di firme UA destinate a divergere
