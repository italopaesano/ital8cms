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
- `redirect` esterno fuori dall'allowlist, e **`301` verso l'esterno sempre**

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
| `drop` | Oggi si comporta come `block`; la chiusura sul socket arriva in v2. | ◐ v1 |
| `decoy` | Contenuto fittizio. | ⏳ v2 |
| `redirect` | 30x con allowlist e 302 forzato. | ⏳ v2 |
| `tarpit` | Risposta a goccia. | ⏳ v3 |

Il 404 di `block` non è fabbricato da questo plugin: è prodotto da
`reservedGate.deny()`, l'unico punto del progetto che genera il 404 «di
copertura», presidiato da un test che lo confronta byte per byte con un 404
autentico. Un secondo generatore divergerebbe, e la differenza renderebbe
enumerabile ciò che il filtro protegge.

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

## Cosa NON fa (ancora)

Decoy e contenuti trappola, redirect, tarpit, coerenza di sessione (cambio di
User-Agent dentro la stessa sessione = sessione rubata), reputazione locale delle
impronte, e la GUI `adminSentinel`. Roadmap completa e stato di avanzamento in
[`TODO.md`](./TODO.md).

In v1 la lettura dei dati è manuale (i file in `data/`): il lettore da riga di
comando e la dashboard arrivano dopo.

---

**Deep-dive sulla meccanica interna:** [`EXPLAIN.it.md`](./EXPLAIN.it.md)
