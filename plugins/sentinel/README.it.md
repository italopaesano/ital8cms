<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# sentinel

**Filtro delle richieste in ingresso.** Valuta ogni richiesta *prima del router*,
la classifica secondo regole dichiarative in `sentinelRules.json5`, e registra
quello che vede in un log JSONL proprio.

**All'installazione non blocca nulla.** Sentinel nasce come *osservatorio*: le
regole distribuite hanno tutte `action: "monitor"`, quindi matchano, vengono
registrate, e la richiesta prosegue. L'enforcement è una promozione consapevole
che fai tu dopo aver letto i tuoi dati.

---

## Indice

- [Perché un osservatorio e non un firewall](#perché-un-osservatorio-e-non-un-firewall)
- [Le tre fasi](#le-tre-fasi-osserva--capisci--promuovi)
- [Il fingerprint delle richieste](#il-fingerprint-delle-richieste)
- [Configurazione](#configurazione)
- [Scrivere una regola](#scrivere-una-regola)
- [Le azioni](#le-azioni)
- [Contenuti fittizi (decoy)](#contenuti-fittizi-decoy)
- [Token esca (canary)](#token-esca-canary)
- [Ban immediato](#ban-immediato-escalateban)
- [Coerenza di sessione](#coerenza-di-sessione)
- [`drop` e `tarpit`](#drop-e-tarpit-le-due-azioni-che-costano-anche-a-te)
- [Reputazione locale](#reputazione-locale-delle-impronte)
- [Il control plane](#il-control-plane)
- [I dati prodotti](#i-dati-prodotti)
- [Interconnessioni](#interconnessioni)
- [Privacy](#privacy)
- [Cosa NON fa (ancora)](#cosa-non-fa-ancora)

---

## Perché un osservatorio e non un firewall

Un filtro consegnato con regole attive rompe qualcosa il primo giorno e viene
disinstallato il secondo. Il problema è che all'installazione non si sa ancora
nulla del proprio traffico: quali bot passano, quali integrazioni usano `curl`,
quale monitoraggio interroga il sito ogni minuto.

Quindi le regole distribuite non sono una *blocklist*, sono una **tassonomia**:
ognuna dà un nome a una famiglia di richieste. Dopo qualche settimana il log non
dirà «4.312 richieste bloccate» ma la **composizione** del tuo traffico ostile —
quali famiglie, in che proporzione, da quante origini, con quali impronte.

Il percorso è quello, ma **non è obbligato**: se sai già cosa vuoi, scrivi
`action: "block"` e metti `mode: "enforce"` dal primo minuto.

## Le tre fasi: osserva → capisci → promuovi

**1. Osserva.** Installi, non succede niente. Sentinel comincia a classificare il
traffico e a registrarlo in `data/sentinel-YYYY-MM-DD.jsonl`.

**2. Capisci.** Dopo una o due settimane guardi `data/ruleHits.json5`:

```json5
"php-probe": {
  hits: 4127,               // quante volte ha matchato
  authenticatedHits: 0,     // ← IL SEMAFORO
  distinctIps: 512,
  safeToPromote: true,
}
```

`authenticatedHits` è il campo che decide. Se dopo settimane di traffico reale
quella regola non ha **mai** toccato un utente autenticato, promuoverla è sicuro.
Se è diverso da zero c'è un falso positivo che non hai ancora capito.

**3. Promuovi.** Cambia `action` in `"block"` sulla regola e `mode` in
`"enforce"` in `pluginConfig.json5`.

**Se qualcosa va storto:**

```bash
npm run cli -- sentinel monitor
```

Ferma l'enforcement a caldo, senza riavvio, **senza perdere i dati** che ti
servono per capire cosa hai sbagliato. È la via di fuga, ed esiste apposta perché
questo è l'unico plugin capace di chiuderti fuori da casa tua.

## Il fingerprint delle richieste

Ogni client HTTP lascia una firma involontaria: quali header manda, in che
**ordine**, quali omette, come li compila. Chrome, Firefox, `curl` e
`python-requests` producono quattro firme diverse, e nessuna delle quattro è
configurabile senza riscrivere il client.

Questo rende la firma molto più difficile da falsificare dello User-Agent:
cambiare l'UA in curl è un flag (`curl -A "...Chrome/120"`), ma *sembrare* Chrome
richiede di replicarne l'ordine esatto degli header, l'`Accept` letterale, i
`Sec-CH-UA-*`, i `Sec-Fetch-*` — cioè di emularlo, non di spacciarsi per lui.

**Lo User-Agent non entra nel calcolo dell'impronta.** È deliberato: tenendoli
indipendenti si può confrontarli, e si ottiene il segnale che vale più di tutti:

> L'UA dichiara Chrome. La firma dice `curl`. **Uno dei due mente** — e sappiamo
> quale, perché l'UA è l'unico dei due che si cambia gratis.

Non serve decidere se `curl` sia ostile (curl legittimo è ovunque: health check,
webhook, monitoraggio). Serve accorgersi che qualcuno sta **fingendo di non
essere** curl, che è un'informazione di natura completamente diversa. È la regola
`ua-fingerprint-mismatch`, e nell'esperienza è il segnale singolo più affidabile.

La decomposizione strutturata (`fpClass`) rende le regole *predittive* invece che
reattive: gli hash non hanno intervalli, ma le **classi** sì. Una regola su
`{ coherent: false }` copre migliaia di client mai visti prima, senza conoscerne
gli hash.

Solo raccolta **passiva**: si osserva ciò che il client manda comunque. Nessun
JavaScript eseguito sul dispositivo, nessun canvas — oltre a essere la scelta
giuridicamente più sobria, è l'unica che funziona qui, perché gli scanner non
eseguono JavaScript.

## Configurazione

Tutta in `pluginConfig.json5 → custom`, commentata campo per campo. Le voci che
contano di più:

| Campo | Default | Cosa fa |
|---|---|---|
| `mode` | `"monitor"` | `"monitor"` impedisce a **qualsiasi** regola di agire, anche a quelle `block`. È un tetto, non un override. |
| `authenticatedTraffic.mode` | `"monitor"` | Gli utenti autenticati sono osservati ma non bloccati. |
| `authenticatedTraffic.enforceExemptRoles` | `[0, 1]` | Root e admin non sono mai soggetti a enforcement (restano osservati). |
| `strictValidation` | `false` | Se `true`, una regola invalida impedisce l'avvio del plugin. |
| `trustProxy` | `false` | Leggere `X-Forwarded-For`. **Attivare solo dietro un proxy fidato.** |
| `fingerprintSalt` | `""` | Vuoto = impronte confrontabili fra installazioni. Valorizzato = locali. |
| `observeOutcomes` | `true` | Osserva come finiscono le richieste lasciate passare (solo non-2xx). |
| `log.retentionDays` | `365` | |
| `log.maxTotalBytes` | `200 MB` | Tetto di dimensione, oltre alla retention a tempo. |
| `census.censusIpMode` | `"count"` | `none` / `count` / `full` — vedi [Privacy](#privacy). |
| `sessionCoherence.enabled` | `true` | Sorveglia se una sessione autenticata continua ad assomigliare a sé stessa. |
| `tarpit.maxConcurrent` | `20` | Connessioni trattenute contemporaneamente. Oltre il tetto si degrada al 404. |
| `tarpit.maxSeconds` | `30` | Durata massima. Una regola può chiedere meno, mai di più. |
| `reputation.protectBrowserFingerprints` | `true` | Le impronte da browser vero non ricevono mai un giudizio negativo. |
| `census.ipRetentionDays` | `30` | Conservazione degli **indirizzi** (solo con `censusIpMode: "full"`). |
| `alertRecipient` | `""` | Email per le allerte operative (richiede il plugin `mailer`). |

### Due tetti indipendenti sull'enforcement

1. **`custom.mode`** nel file di configurazione;
2. **lo stato del gate**, commutabile a caldo dalla CLI.

Nessuno dei due può essere scavalcato dall'altro né da una regola. Se uno dei due
dice «non agire», non si agisce.

## Scrivere una regola

```json5
{
  name: "php-probe",           // OBBLIGATORIO e univoco: è la chiave primaria
  enabled: true,
  category: "cms-probe",       // per aggregare il log per famiglia
  description: "...",
  appliesTo: "any",            // anonymous | authenticated | any
  action: "monitor",
  match: {
    extension: ["php", "phtml"],
  },
  escalate: { rateLimiterRule: "scanner" },   // opzionale
}
```

`name` è la chiave primaria: lega fra loro contatori, righe di log e azioni della
futura GUI. **Rinominarla azzera la storia della regola.**

### Ordine = priorità

**First-match-wins**: si scorre l'array dall'alto e la prima regola che matcha
decide. È la convenzione di iptables e nginx, e per un filtro la prevedibilità
vale più dell'ergonomia. Le regole `allow` vanno **in cima**.

### Condizioni

Più foglie nello stesso oggetto formano un **AND implicito**. Combinatori
espliciti: `all`, `any`, `not`.

| Foglia | Esempio |
|---|---|
| `path` | `"/wp-admin/**"` · `"regex:^/wp-"` · `["/a", "/b"]` |
| `extension` | `["php", "sql"]` |
| `method` | `["TRACE", "PROPFIND"]` |
| `userAgent` | `"regex:^curl/"` · `"empty"` · `["curl", "wget"]` |
| `header` | `{ name: "Accept-Language", present: false }` |
| `query` | `"regex:union\\s+select"` |
| `ip` | `["10.0.0.0/8", "2001:db8::/32"]` |
| `authenticated` | `true` / `false` |
| `roleIds` | `[0, 1]` |
| `fingerprint` | `["a3f9c2e1b7d4"]` |
| `fingerprintClass` | `{ coherent: false, family: "curl" }` |
| `canary` | `true` · `"known"` · `"unknown"` — vedi [token esca](#token-esca-canary) |
| `sessionAnomaly` | `true` · `["uaChanged", "scriptClient"]` — vedi [coerenza di sessione](#coerenza-di-sessione) |
| `reputation` | `true` · `["burst", "suspect", "bad"]` — vedi [reputazione](#reputazione-locale-delle-impronte) |
| `status` | `[404, 403]` — solo nella valutazione dell'esito |

**I path si scrivono senza `globalPrefix`**, che viene anteposto dal codice —
stessa convenzione di `maintenance.exemptPaths`.

**Con `hideExtension` attivo** le regole per `extension` non cambiano — una sonda
`.php` arriva sempre con l'estensione, perché i clean URL riguardano solo le
pagine del sito. Ma una regola per `path` verso una pagina interna deve coprire
**entrambe le forme** (`/segreta` e `/segreta.ejs`): con i clean URL il
visitatore può chiedere l'una o l'altra, e coprirne una sola lascia un varco.

**La querystring** viene confrontata sia nella forma grezza sia in quella
decodificata: `union\s+select` matcha anche `union+select` e `union%20select`,
che sono le forme in cui i tentativi arrivano davvero.

### Cosa il validatore rifiuta

- `name` mancante o duplicato, `action` sconosciuta, `match` vuoto
- **regex con quantificatori annidati** (`(a+)+`): sono la forma classica del
  backtracking catastrofico, e con Node — che non offre timeout sulle regex —
  una singola richiesta potrebbe bloccare l'event loop, cioè l'intero sito
- CIDR malformati, `decoy.file` con percorsi (path traversal)
- `redirect` esterno fuori dall'allowlist, e i **permanenti (301/308) verso
  l'esterno sempre**; uno `status` che non è un redirect
- header dichiarati da un `decoy` che contengono **CR/LF** (response splitting) o
  che descrivono il messaggio invece del contenuto (`Content-Length`,
  `Transfer-Encoding`, `Set-Cookie`, hop-by-hop)

Una regola invalida viene **scartata**, le altre restano in vigore. Un file
illeggibile lascia il filtro senza regole ma il sito raggiungibile: fail-closed
trasformerebbe una virgola fuori posto in un blackout.

## Le azioni

| Azione | Effetto | Stato |
|---|---|---|
| `allow` | Esenzione esplicita. Contata ma non registrata. | ✅ v1 |
| `monitor` | Matcha, registra, **lascia passare**. | ✅ v1 |
| `block` | **404**, byte-identico a un URL che non è mai esistito. | ✅ v1 |
| `throttle` | Delega a `rateLimiter` senza bloccare. | ✅ v1 |
| `drop` | **Tronca la connessione** senza rispondere (stile 444 di nginx). | ✅ v1.4 |
| `decoy` | [Contenuto fittizio](#contenuti-fittizi-decoy) al posto del 404. | ✅ v1.1 |
| `redirect` | 30x, allowlist per l'esterno, permanenti vietati fuori dal sito. | ✅ v1.1 |
| `tarpit` | [Risposta a goccia](#drop-e-tarpit-le-due-azioni-che-costano-anche-a-te), con tetto di connessioni e di durata. | ✅ v1.4 |

Il 404 di `block` non è fabbricato da questo plugin: è prodotto da
`reservedGate.deny()`, l'unico punto del progetto che genera il 404 «di
copertura», presidiato da un test che lo confronta byte per byte con un 404
autentico. Un secondo generatore divergerebbe, e la differenza renderebbe
enumerabile ciò che il filtro protegge.

## Contenuti fittizi (`decoy`)

Un *decoy* — letteralmente un'esca — è contenuto falso ma credibile servito al
posto di un errore. Uno scanner chiede `/wp-login.php`; le risposte possibili non
sono equivalenti:

| Risposta | Cosa impara chi ha bussato |
|---|---|
| `404` | «Non è WordPress.» Passa oltre. Gli è costato zero |
| `403` | «Non è WordPress **e c'è un filtro.**» Gli hai regalato un'informazione |
| decoy | «È WordPress!» Lancia l'intera batteria di exploit WP contro un sito che PHP non lo esegue nemmeno |

Il valore è **asimmetrico**: a te costa un file statico, a lui costa tempo reale.
E avvelena i suoi dati — molti scanner alimentano database di bersagli, e da qui
in poi questo sito ci figura catalogato male.

### Come si scrive la regola

```json5
{
  name: "wp-probe-decoy",
  action: "decoy",
  appliesTo: "anonymous",
  match: { path: ["/wp-login.php", "/wp-admin/**"] },
  decoy: {
    file: "wp-login.html",                        // nome semplice, senza percorsi
    status: 200,                                  // 200-599, default 200
    headers: { "X-Powered-By": "PHP/7.4.33" },    // credibilità
  },
}
```

Gli header dichiarati contano più di quanto sembri: uno scanner che li guarda
prima del corpo smaschera un finto `phpinfo()` che non dice di essere PHP.

### Dove stanno i file

```
decoys/
├── default/    forniti col plugin, VERSIONATI: un aggiornamento li sovrascrive
└── data/       i tuoi, MAI toccati, esclusi da git
```

A parità di nome **`data/` vince**: per personalizzare un decoy fornito basta
copiarlo lì. È la stessa simmetria di `x.default.json5` ↔ `x.json5`.

Distribuiti: `wp-login.html`, `phpinfo.html`, `env.txt`, `dir-listing.html` —
documentati in [`decoys/default/README.md`](./decoys/default/README.md).

### Segnaposto

Due risposte identiche hanno lo stesso hash, e uno scanner che le confronta si
accorge che il "sito" restituisce sempre la stessa pagina. I segnaposto rendono
ogni risposta diversa:

| Segnaposto | Resa |
|---|---|
| `{{now}}` | Data e ora ISO |
| `{{today}}` | `2026-08-09` |
| `{{timestamp}}` | Secondi Unix |
| `{{random:N}}` | N caratteri casuali (1–128) |
| `{{choice:a\|b\|c}}` | Una delle alternative |
| `{{path}}` `{{ip}}` | Il percorso richiesto e l'indirizzo di chi l'ha chiesto |
| `{{canary}}` | Un [token esca](#token-esca-canary): trasforma il decoy in un sensore |

Gli ultimi due sono **riflessi**: contengono stringhe scelte da chi ha fatto la
richiesta, e nei decoy HTML vengono escapati. Senza, sarebbe una XSS riflessa in
piena regola — e il bersaglio non sarebbe l'attaccante, che si autoinfetterebbe,
ma chiunque riceva da lui un link a quell'URL.

### Tre regole per chi ne scrive uno

1. **Nessuna spiegazione dentro il file.** Un commento HTML o una riga `#` che
   dice «questo è finto» viene servita insieme al resto: un decoy che si annuncia
   è *peggio* di un 404, perché ha appena rivelato che c'è un filtro. Un test
   tiene le parole rivelatrici fuori dai file distribuiti.
2. **Niente EJS, niente partial del tema.** I decoy sono serviti fuori dalla
   pipeline di rendering: non si espone il motore di template a traffico ostile,
   e il markup del tuo tema renderebbe il decoy riconoscibile a colpo d'occhio.
3. **Nessun contenuto reale** — nessun nome utente vero, nessun percorso interno
   vero, nessuna versione vera del software.

### Token esca (`{{canary}}`)

Tutto il resto del plugin ragiona per **indizi**: questo UA mente, questo client
ha collezionato quaranta 404, questo percorso somiglia a una sonda. Sono
inferenze, ed è per questo che sentinel nasce in osservazione.

Un canary no. Il token esiste **in un solo posto al mondo**: dentro il corpo di
un decoy servito a un cliente preciso, in un momento preciso. Nessun motore di
ricerca lo indicizza, nessun link ci porta, nessuno lo digita per sbaglio. Se
qualcuno lo richiede, ha **letto** il decoy e ha deciso di seguirlo — non è
un'inferenza, è una certezza. È l'unico segnale del plugin per cui un ban
immediato è difendibile.

```json5
// Nel decoy:  TELESCOPE_PATH=telescope-{{canary}}
// Nelle regole:
{
  name: "canary-token-used",
  action: "block",
  match: { canary: true },      // true | "known" | "unknown"
  escalate: { rateLimiterRule: "scanner", ban: true, banSeconds: 86400 },
}
```

| Valore | Matcha quando |
|---|---|
| `true` (o `"any"`) | La richiesta porta un token, riconosciuto o no |
| `"known"` | Il token è nostro ed è ancora in registro: **sappiamo a chi l'avevamo dato** |
| `"unknown"` | Ha la forma giusta ma non è (più) in registro: riavvio, scadenza, o un altro worker in cluster |

**Il confronto vale più del token.** Il registro ricorda a chi era stato
consegnato, e il log dice chi lo sta usando:

- **stesso client** → uno scanner che segue i link che trova. Automazione.
- **client diverso** → il contenuto del decoy è passato di mano: chi scandaglia e
  chi sfrutta sono due macchine, il che descrive un'operazione più strutturata di
  un bot che gira da solo.

**Il vincolo da non violare scrivendo un decoy:** un token va solo dove serve un
**gesto deliberato** per richiederlo — testo, o un `<a href>` da cliccare. Mai in
un `src` o in un `<link rel="stylesheet">`: quelli il browser li scarica da solo,
la trappola scatterebbe su chiunque apra la pagina, e con `ban: true` il decoy
diventerebbe un modo di bandire chi lo riceve. Un test tiene i token distribuiti
fuori da quegli attributi.

La segnalazione (log + allerta) parte **anche se la regola trappola non c'è**:
legare l'unico segnale certo del plugin alla presenza di una riga in un file
modificabile dalla GUI sarebbe fragile esattamente dove non ce lo si può
permettere. E parte **anche in osservazione**: osservare significa non agire
sulla richiesta, non tacere su ciò che si è visto.

### Ban immediato (`escalate.ban`)

`escalate` ha due intensità, e la differenza non è di grado ma di natura:

| Forma | Effetto | Quando |
|---|---|---|
| `{ rateLimiterRule }` | **Conta** un fallimento; sarà `rateLimiter` a decidere dopo quanti tentativi bloccare | Tutto ciò che resta un'inferenza: il singolo evento non prova niente, l'insistenza sì |
| `{ rateLimiterRule, ban: true }` | **Blocca subito**, saltando il conteggio | Solo dove non c'è niente da accumulare perché il primo evento è già la prova: il canary |

Il ban obbedisce ai tetti dell'enforcement — un sentinel in osservazione che fa
bandire gente da rateLimiter non sarebbe un osservatorio. Il conteggio invece
parte anche per una regola in `monitor`: è comportamento storico, ed è il motivo
per cui il file delle regole raccomanda di non dichiarare `escalate` finché la
regola è in osservazione.

### Quando il decoy non viene servito

- **File assente** (cancellato dopo l'avvio, permessi cambiati): la risposta
  degrada al 404 comune. All'avvio un avviso segnala le regole che puntano a un
  file inesistente — scoprirlo dal traffico invece che dai log sarebbe la
  peggiore delle sorprese, perché il decoy *sembra* configurato.
- **Superficie riservata chiusa** (`sentinel`/`reserved` stop): su un percorso
  riservato un decoy rivelerebbe che quel percorso esiste, cioè esattamente il
  canale di enumerazione che il reserved gate chiude. Anche lì: 404.
- **Enforcement non in vigore**: in `monitor`, o con il gate commutato, l'evento
  viene registrato e la richiesta prosegue.

Il contenuto dei file è tenuto in memoria dopo la prima lettura — chi scandisce
il sito non deve poter dettare il ritmo delle nostre letture su disco. In
`debugMode` la cache è spenta e un ricaricamento delle regole la svuota.

## Coerenza di sessione

Un cookie di sessione rubato **funziona**. È tutto il punto del furto: chi lo
presenta *è* l'utente, per il server. Nessun controllo di password lo ferma,
nessun controllo di ruolo, nessun rate limit — perché non c'è niente da
indovinare e niente da forzare.

L'unica cosa che il ladro non eredita insieme al cookie è il **client**. La
sessione era nata su un Firefox su Linux da un certo indirizzo, e da un certo
momento arriva da `python-requests`.

```json5
{
  name: "session-hijack-signal",
  action: "monitor",
  appliesTo: "authenticated",
  match: { sessionAnomaly: ["uaChanged", "scriptClient"] },   // true = una qualsiasi
}
```

| Anomalia | Cosa dice | Rumore |
|---|---|---|
| `uaChanged` | Lo User-Agent è cambiato a metà sessione | **Bassissimo**: un browser non lo cambia |
| `scriptClient` | Un cookie valido in mano a qualcosa che non è un browser. Non è un cambiamento, è uno **stato** | Basso |
| `fingerprintChanged` | È cambiata la forma degli header | Basso |
| `networkChanged` | L'indirizzo è passato a un altro blocco (/24 o /48) | Medio |
| `ipChanged` | L'indirizzo è cambiato | **Alto**: mobile ↔ WiFi |

### La linea di base non si aggiorna mai

La prima richiesta vista per una sessione fissa il riferimento, e da lì non si
tocca più.

L'alternativa sarebbe inutile: se dopo un'anomalia si adottasse il nuovo valore
come riferimento, la richiesta successiva del ladro tornerebbe «coerente» e la
sessione dirottata risulterebbe pulita **per tutto il resto della sua vita** —
cioè proprio per la parte in cui viene usata davvero. Non aggiornando, una
sessione che ha cambiato pelle resta segnalata a ogni richiesta finché non scade.

Il prezzo è dichiarato: un utente mobile che passa da rete dati a WiFi resta
marcato `ipChanged` fino al logout. Per questo la regola distribuita guarda
`uaChanged` e `scriptClient`, non `ipChanged`.

### Solo sessioni autenticate

Due ragioni che portano allo stesso posto. Una sessione anonima non ha niente da
rubare, quindi il segnale non descriverebbe nulla; e tracciarla richiederebbe di
**crearla**, cioè mandare un cookie a ogni visitatore del sito — un cambiamento
di comportamento con conseguenze (banner, informativa) sproporzionate al segnale.

L'identificativo di sessione è coniato una volta e riposto nella sessione stessa.
Non si riusa `_expire`: viene riscritto a ogni salvataggio, quindi qualunque cosa
modifichi la sessione — la rotazione del token CSRF, per dirne una — azzererebbe
la linea di base, e sarebbe un modo per un attaccante di ripulirsi da solo.

### Limite noto

Lo stato è **in memoria**. Dopo un riavvio le linee di base si perdono e la prima
richiesta successiva di ogni sessione ne fissa una nuova, su come il client
appare *in quel momento*: se il riavvio capita a dirottamento già avvenuto, la
sessione risulterà coerente. Lo stesso fra worker diversi in cluster. È un
sensore in più, non l'unico presidio sulle sessioni.

### Prima di promuovere a `block`

È la prima regola distribuita che, promossa, può **chiudere fuori un utente
autenticato**. Devono cadere tre tetti, e i default ne lasciano in piedi due:

| Tetto | Default |
|---|---|
| `custom.mode` | `monitor` — nessuna regola agisce |
| `custom.authenticatedTraffic.mode` | `monitor` — nessuna regola agisce **sugli autenticati** |
| stato del gate | `running`, commutabile con `npm run cli -- sentinel monitor` |

E i ruoli in `enforceExemptRoles` (default `[0, 1]`) restano **osservati ma mai
bloccati**, in qualsiasi configurazione.

## `drop` e `tarpit`: le due azioni che costano anche a te

Tutte le altre azioni producono una risposta e chiudono. Queste due no, ed è il
motivo per cui vanno capite prima di usarle.

### `drop` — nessuna risposta

Tronca la connessione, come il `return 444` di nginx.

| | `block` (404) | `drop` |
|---|---|---|
| Cosa impara chi bussa | Niente: è il 404 di un URL mai esistito | Che quel percorso è **trattato diversamente** |
| Costo per lui | Millisecondi | Resta in attesa fino al proprio timeout |
| Costo per te | Comporre una risposta | Praticamente zero |

Non è «meglio» del blocco: si rinuncia all'**indistinguibilità**, che è la
qualità principale del 404, in cambio di un costo maggiore per l'altro. Sono due
strumenti diversi, e il default resta `block`.

> **Dietro un reverse proxy non funziona, e fa peggio.** Il socket troncato è
> quello verso il **proxy**, non verso il client: il proxy risponde 502 — più
> rumoroso di un 404 — e si riempie i log di errori. Con `trustProxy: true`
> dichiarato, `drop` **degrada da sé al blocco**, e il validatore lo avvisa
> all'avvio.

### `tarpit` — la risposta che non finisce

La connessione resta aperta e il corpo esce un pezzetto alla volta. Uno scanner
vale per la sua **cadenza**: un 404 gli costa millisecondi, una risposta che non
finisce mai gli occupa un worker e un socket per decine di secondi.

Dove il decoy gli avvelena i **dati**, il tarpit gli consuma il **tempo**.

```json5
{
  name: "scanner-tarpit",
  action: "tarpit",
  appliesTo: "anonymous",
  match: { path: ["/wp-admin/**", "/administrator/**"] },
  tarpit: { seconds: 20 },     // una RICHIESTA: `maxSeconds` resta il tetto
}
```

**È un'arma puntata anche contro di te.** Ogni connessione trattenuta è un
socket, un descrittore di file e un timer **tuoi**: senza limiti, sotto un flusso
sostenuto sarebbe il modo più elegante di esaurire i propri descrittori — la
difesa che diventa il vettore, per la terza volta in questo plugin (le altre due
sono il censimento e il registro dei canary). Da qui tre limiti, tutti necessari:

1. **Tetto di connessioni** (`maxConcurrent`, default 20). Superato, la richiesta
   **degrada al 404 comune**: non si accoda e non si aspetta, o il tetto
   sposterebbe il consumo di risorse invece di fermarlo.
2. **Durata massima** (`maxSeconds`, default 30). Una regola può chiedere meno,
   mai di più: una durata scritta a mano nel file non deve poter tenere occupato
   un socket più a lungo di quanto hai deciso.
3. **Rilascio immediato alla chiusura.** Se il client stacca — e uno scanner con
   un timeout aggressivo stacca subito — il posto si libera in quel momento.
   Senza, basterebbe aprire e chiudere in fretta per saturare il tetto.

Allo spegnimento le connessioni trattenute vengono **troncate**: `gracefulShutdown`
aspetta le connessioni, e senza quello un riavvio durerebbe quanto il tarpit più
lungo — un fermo causato dalla propria difesa.

> Dietro un proxy vale l'avvertenza gemella di `drop`: trattieni una connessione
> del **proxy**, e l'attesa la paga la tua infrastruttura.

## Reputazione locale delle impronte

Il censimento accumula da mesi. La foglia `reputation` trasforma quella storia in
una condizione utilizzabile in una regola.

| Giudizio | Quando |
|---|---|
| `burst` | Impronta mai vista fino a poco fa, e già a decine di richieste |
| `suspect` | Quota di blocchi oltre `suspectShare` (default 20%) |
| `bad` | Quota di blocchi oltre `badShare` (default 50%) |

```json5
{
  name: "known-bad-fingerprint",
  action: "block",
  appliesTo: "anonymous",
  match: { reputation: ["bad"] },
}
```

### Le due avvertenze, che contano più della funzione

**1. Un'impronta non è una persona: è una famiglia di client.** «Chrome 120 su
Linux» è la stessa impronta per tutti quelli che usano quel browser. Se qualcuno
attacca con un Chrome perfettamente ordinario e la reputazione condanna
quell'impronta, si chiude fuori **ogni visitatore con quel browser**. È il modo
più probabile in cui questa funzione rovina un sito.

Per questo un'impronta **coerente e con profilo da browser** non riceve mai un
giudizio negativo, per quanto sporca sia la sua storia. Il prezzo è dichiarato:
chi emula Chrome alla perfezione è immune alla reputazione. È il prezzo giusto —
meglio perdere l'attaccante capace che chiudere fuori gli utenti di un browser.

**2. L'impronta la controlla chi bussa.** Chi randomizza l'ordine degli header ha
un'impronta nuova a ogni richiesta, quindi reputazione sempre pulita: questa è
una vittoria facile contro lo scanner **pigro** — la stragrande maggioranza del
traffico ostile — non una difesa da un avversario determinato.

E non è un buco silenzioso: randomizzare le impronte fa esplodere il tasso di
sfratto del censimento, che ha già la sua allerta. L'evasione da questa funzione
ne accende un'altra.

### Perché il giudizio non può alimentare sé stesso

Se la quota di blocchi determinasse il giudizio e il giudizio producesse blocchi,
il primo inciampo condannerebbe un'impronta per sempre. Le richieste decise **da
una regola che usa la reputazione** sono quindi escluse dal calcolo — da
entrambi i lati della frazione.

Escludere solo i blocchi non basterebbe, ed è un errore che si vede solo dal
vivo: mentre il giudizio è in vigore la sua regola scatta per prima, quindi
nessun'altra regola produce più blocchi. Il numeratore si ferma, il denominatore
no, e la quota **scende da sola** finché l'impronta non viene perdonata — per poi
essere ricondannata, in un'oscillazione senza fine. Il censimento tiene perciò
due contatori: `count`, tutte le richieste, e `judgedCount`, quelle giudicate nel
merito, che è il denominatore della reputazione.

### Filtro d'audience, non confine di sicurezza

Lo scenario «sito riservato a un solo ecosistema» si scrive con
`fingerprintClass`:

```json5
match: { not: { fingerprintClass: { claimedOs: "linux" } } }
```

Va capito per quello che è: l'OS dichiarato si falsifica in un secondo, quindi
non tiene fuori nessuno che non voglia esserlo. Serve a **orientare un pubblico**,
non a difendersi. Tienila in `monitor` per settimane prima di promuoverla: il
numero che conta è quanti visitatori reali verrebbero esclusi, e lo si sa solo
guardando i contatori.

## Il control plane

```bash
npm run cli -- sentinel start     # filtra secondo la configurazione
npm run cli -- sentinel monitor   # osserva e registra, non agisce  ← via di fuga
npm run cli -- sentinel stop      # kill switch: motore non interrogato
npm run cli -- status             # mostra stato + se il motore è caricato

npm run cli -- sentinel test <path>   # prova una richiesta senza inviarla
```

### Il tester

Risponde alla domanda opposta a quella che sembra. Non «quale regola scatta» —
quello si vede dal log — ma **«ho scritto questa regola e non scatta, perché?»**.
Per ogni condizione stampa **atteso accanto a osservato**, anche per le regole
che non hanno matchato.

```bash
npm run cli -- sentinel test /wp-login.php
npm run cli -- sentinel test /a.php -X POST -A "curl/8.5.0" -v
npm run cli -- sentinel test /admin/ --roles 1        # richiesta autenticata
npm run cli -- sentinel test /pagina.html --browser   # vedi sotto
```

Opzioni: `-X` metodo · `-A` User-Agent · `-H "Nome: valore"` (ripetibile) ·
`--ip` · `--query` · `--authenticated` / `--roles` · `--status` ·
`-v` per vedere anche le regole che **non** matchano · `--json`.

> **`--browser` non è un dettaglio.** Una richiesta sintetica ha *solo* gli
> header che le dai, quindi senza quel flag ogni prova ha profilo `minimal` e
> chiunque scriva `-A "Mozilla/..."` inciampa nella regola
> `ua-fingerprint-mismatch` senza capire perché. `--browser` aggiunge gli header
> che un browser manda davvero (`Accept`, `Sec-Fetch-*`, `sec-ch-ua`…), e mostra
> cosa vedrebbe il filtro davanti a un visitatore vero.

Lo stesso strumento è nella GUI, scheda **Tester** di `adminSentinel`.

**Sotto il cofano** c'è un valutatore *separato* da quello del percorso caldo:
tracciare costa allocazioni per ogni condizione, e non si fa pagare a tutto il
traffico una funzione usata qualche volta al mese. Due implementazioni della
stessa semantica però divergono, quindi un test di **conformità** verifica su
oltre duecento combinazioni che i due diano sempre lo stesso esito.

Nessun riavvio: sono commutazioni a caldo, come `public` e `reserved`.

> `status` distingue lo **stato** dalla presenza del **motore**. Un gate
> `running` senza motore non sta filtrando: il plugin è disattivato o non si è
> caricato.

## I dati prodotti

Tutto in `plugins/sentinel/data/` — non raggiungibile dal web (nessuno static
server serve `plugins/`, e `sentinel` non ha una directory `webPages/`).

| File | Contenuto |
|---|---|
| `sentinel-YYYY-MM-DD.jsonl` | Un evento per riga. **IP pieno.** |
| `fingerprintCensus.json5` | Aggregato per impronta: quante volte, da quanti IP, quota bloccata. |
| `outcomeCensus.json5` | Come finiscono le richieste lasciate passare (solo non-2xx). |
| `ruleHits.json5` | Contatori per regola — la base della promozione. |

I nomi dei campi dell'evento coincidono con quelli di `analytics` dove il
significato è lo stesso: una futura lettura unificata non richiederà traduttori.
Il fuso della rotazione è quello **locale**, come analytics.

### Perché anche l'aggregato degli esiti

Con le sole regole, sentinel saprebbe solo ciò che gli è già stato insegnato a
riconoscere. Osservando l'esito delle richieste che lascia passare, si accorge
anche di quello che nessuna regola descrive:

> «Questo client ha collezionato 198 percorsi distinti, tutti in 404, in due
> minuti.»

È la firma della scansione, e non richiede nessuna regola scritta a mano.

### Tetti e sfratti

Gli aggregati sono indicizzati da valori che l'attaccante controlla: chi
randomizza l'ordine degli header genera un'impronta nuova a **ogni** richiesta.
Senza tetto, la difesa diventa il modo di esaurire la memoria del processo. Da
qui `maxFingerprints`, i TTL e lo sweep periodico.

Il contatore delle **eviction** non è una statistica di servizio: in esercizio
normale resta a zero, e un valore che sale è esso stesso il segnale che qualcuno
sta gonfiando gli archivi apposta.

## Interconnessioni

**`rateLimiter`** (opzionale). Con `escalate: { rateLimiterRule: "scanner" }` la
regola alimenta il rate limiter, che con la sua escalation trasforma l'insistenza
in un ban IP. Sul traffico autenticato la chiave è l'**account** invece
dell'indirizzo: un account compromesso usato da una botnet su 500 IP alimenta
comunque un solo contatore.

**`mailer`** (opzionale). Allerte operative a `alertRecipient`.

**`analytics`: nessuna.** Sentinel ha il proprio log.

Entrambe le interconnessioni sono risolte in modo **lazy**, senza alcuna
`dependency` dichiarata. Se lo fossero, un `rateLimiter` disabilitato renderebbe
sentinel `incomplete` e **spegnerebbe il filtro perché manca il rate limiter**:
un'inversione di priorità inaccettabile.

## Privacy

Il log eventi conserva l'**IP pieno**: un log di sicurezza senza IP non permette
di correlare, bannare né segnalare. Base giuridica diversa da quella di
analytics: legittimo interesse alla sicurezza della rete (considerando 49 GDPR).
Retention 365 giorni.

Il censimento delle impronte ha invece tre livelli (`census.censusIpMode`):

- **`none`** — nulla sugli IP;
- **`count`** *(default)* — solo il **numero** di indirizzi distinti per impronta.
  Dà già il segnale botnet («questa impronta arriva da 500 IP») **senza
  conservare un solo indirizzo**;
- **`full`** — l'elenco. Rende il censimento un archivio di dati personali a
  lunga conservazione: valuta la retention di conseguenza.

Il fingerprint è **passivo** e a **bassa entropia**: identifica una famiglia di
client («Chrome 120 su Linux»), non una persona. Non va usato come identificatore
individuale.

Se attivi `authenticatedTraffic`, stai monitorando **persone identificate**:
dichiaralo nella tua informativa.

Lo stesso vale, in modo più diretto, per la **coerenza di sessione**: la linea di
base tiene in memoria User-Agent, impronta e indirizzo di ogni sessione
autenticata, associati allo username. Non finisce su disco e scade con la
sessione (`sessionCoherence.ttlHours`, default 24), ma è a tutti gli effetti
osservazione di una persona identificata mentre naviga. Se l'informativa del sito
non lo copre, `sessionCoherence.enabled: false` lo spegne senza toccare il resto
del filtro.

## Cosa NON fa (ancora)

Trappole di livello superiore (finto pannello che registra i tentativi) e
`challenge` (proof-of-work).
Roadmap completa e stato di avanzamento in [`TODO.md`](./TODO.md).

La lettura dei dati passa dalla GUI di [`adminSentinel`](../adminSentinel/README.it.md);
il lettore da riga di comando arriva dopo.

---

**Deep-dive sulla meccanica interna:** [`EXPLAIN.it.md`](./EXPLAIN.it.md)
