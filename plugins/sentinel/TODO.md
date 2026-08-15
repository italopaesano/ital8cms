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
| ~~**5**~~ | ~~Canary (`decoy` L2) + `banClient` + allerte~~ ✅ | Il salto da difesa passiva a **sensore**: certezza di un attaccante attivo, non inferenza |
| ~~**6**~~ | ~~Coerenza di sessione~~ ✅ | Miglior segnale del blocco autenticato, ma introduce stato e foglie nuove: meglio quando la GUI può mostrarne gli effetti |
| ~~**7**~~ | ~~`drop` reale e `tarpit`~~ ✅ | Le uniche azioni che possono farti male da sole (retry aggressivi, esaurimento di file descriptor) |
| ~~**8**~~ | ~~Reputazione locale e apprendimento~~ ✅ | Poggia sul censimento, che già raccoglie i dati: qui si aggiunge solo l'inferenza |

I passi **0-3 rendono usabile** quello che c'è. I **4-5** aggiungono l'inganno.
Il **6** copre gli account. I **7-8** sono raffinamento.

### Dettaglio dei passi

**Passo 0 — Debito e attriti.** Riscrittura di `core/priorityMiddlewares/README.md`;
test di identità byte-per-byte per il blocco di sentinel (esiste per il reserved
gate, non per questo); memoizzazione del fingerprint sul socket (~~fatta~~ →
**rimossa** in C7: era un errore di categoria, vedi il piano di consolidamento);
chiusura per **decisione** — non per implementazione — delle voci §9 *prefissi
admin* e §16 *hideExtension*.

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

**Passo 5 — Canary.** ✅ Fatto. `lib/canaryRegistry.js` (conio con
`crypto.randomBytes`, memoria del destinatario, tetto LRU, riconoscimento anche
dei token scaduti come `unknown`), segnaposto `{{canary}}`, foglia `canary` nel
matcher/validatore/tracciatore, `escalate.ban`, `lib/alertDispatcher.js`, card
Canary nella GUI del twin.

Due decisioni non ovvie prese qui:
- **`unknown` non è «non è un canary».** Riavvio, scadenza o un altro worker in
  cluster tolgono il token dal registro, ma nessun visitatore reale invia per caso
  una stringa di quella forma. Da qui il prefisso riconoscibile e i tre valori
  della foglia invece di un booleano.
- **Il ban obbedisce ai tetti, il conteggio no.** Il conteggio resta il
  comportamento storico (parte anche in `monitor`); forzare un blocco è un'azione,
  e le azioni passano dai tetti dell'enforcement.

**Passo 6 — Coerenza di sessione.** ✅ Fatto. `lib/sessionCoherence.js` (linea di
base per sessione, cinque anomalie, tetto + TTL dall'ultimo uso), foglia
`sessionAnomaly`, regola distribuita `session-hijack-signal` in monitor, card
nella GUI, `--session-anomaly` nel tester.

**`migrations/` è scattato**, ma non per il motivo previsto. Non c'è stata nessuna
rinomina: quello che il merge non sa fare è aggiungere **elementi a un array**, e
`rules` è un array — quindi le due regole distribuite nei Passi 5 e 6 non
sarebbero mai arrivate su un'installazione esistente. Stesso difetto di
`menuOrder` in v2.72.0. Due step, `v1→v2` (canary) e `v2→v3` (sessione), con
inserimento **testuale** per non perdere i commenti e verifica differenziale
prima di scrivere.

Due difetti colti strada facendo, entrambi invisibili ai test isolati:
- `koa-session.toJSON()` **scarta le chiavi che iniziano con `_`**: l'identificativo
  di sessione non finiva nel cookie, ogni richiesta sembrava la prima della sua
  sessione, e nessuna anomalia era rilevabile. Colto solo con un login vero.
- Nel file distribuito dal Passo 5 la regola del canary stava **sotto**
  `backup-probe`, che matcha `.tar.gz`: il token consegnato dentro un finto
  `backup-….tar.gz` non l'avrebbe mai raggiunta. Ora canary e sessione stanno
  subito dopo la whitelist.

**Passo 7 — `drop` reale e `tarpit`.** ✅ Fatto. `lib/tarpit.js` + `serveDrop`,
esempi commentati nel file di regole distribuito (nessuna delle due è adatta a
essere attiva di default), avviso del validatore per entrambe dietro proxy,
banner nella GUI quando il tetto rifiuta.

Ha portato con sé un cambiamento del **contratto del gate**: `respond` può ora
restituire `false` per rinunciare. Tetto pieno e drop-dietro-proxy sono
condizioni operative previste, non errori, e trattarle come eccezioni avrebbe
riempito i log di «risposta fallita» proprio sotto carico. Invariante: chi
rinuncia lascia il contesto intatto, perché il gate ci scriverà il 404.

**Passo 8 — Reputazione locale.** ✅ Fatto. `lib/reputation.js` + foglia
`reputation` (`burst` / `suspect` / `bad`), retention degli indirizzi nel
censimento, filtro d'audience documentato.

Le due protezioni contano più della funzione:
- **Un'impronta non è una persona, è una famiglia di client.** Condannare
  un'impronta da browser vero chiude fuori tutti quelli che usano quel browser:
  `protectBrowserFingerprints` lo impedisce, al prezzo dichiarato di rendere
  immune chi emula bene un browser.
- **Il giudizio non deve alimentarsi da solo.** Escludere i blocchi decisi dalla
  reputazione non bastava, e si è visto solo dal vivo: mentre il giudizio è in
  vigore la sua regola scatta per prima, il numeratore si ferma e il denominatore
  no, quindi la quota scende finché l'impronta viene perdonata — per poi essere
  ricondannata. Il censimento tiene ora `judgedCount` accanto a `count`.

### Piano di rifinitura — i tre bordi lasciati aperti

Il piano da 0 a 8 è chiuso. Restano tre cose che non erano *funzionalità
mancanti* ma **bordi non rifiniti**: una vista incompleta, una differenza nota
fra due risposte che dovrebbero essere identiche, e un percorso di avvio che
muore male. Nessuna delle tre aggiunge capacità al filtro; tutte e tre tolgono
un'asimmetria fra ciò che il progetto dichiara e ciò che fa.

Sono in quest'ordine perché è quello del rischio crescente: la prima non tocca
il percorso delle richieste, la seconda sì, la terza tocca il boot.

**Piano chiuso:** tutte e tre completate.

| # | Voce | Perché lì |
|---|---|---|
| ~~**R1**~~ ✅ | ~~Vista C — form strutturato in `adminSentinel`~~ | L'unica delle Tre Viste scoperta. Non tocca il motore: si aggiunge una scheda alla GUI e un metodo di scrittura al service |
| ~~**R2**~~ ✅ | ~~Il `Set-Cookie` sul 404 di blocco~~ | Risolta all'origine, in `csrfProtection`: nessun gate toccato |
| ~~**R3**~~ ✅ | ~~I config core non materializzati al boot~~ | Erano **due**, non tre: `ital8Config` resta escluso di proposito |

**R1 — Vista C.** Il form campo-per-campo sulle regole, coordinato con l'editor
JSON5 secondo le regole di CLAUDE.md (*Le Tre Viste*): fonte di verità unica sul
file, validazione condivisa lato server, switch esplicito fra le viste con
avviso di modifiche non salvate, scrittura atomica con backup.

Il vincolo che detta il progetto: **un form non deve mai distruggere ciò che non
sa rappresentare.** L'albero `match` ammette combinatori annidati che un form
piatto non può mostrare; quelle regole vanno preservate alla lettera e rimandate
all'editor JSON5, non riscritte in una forma semplificata.

- [x] `replaceRule()` in `rulesFileEditor.js`, con verifica differenziale
- [x] Serializzazione di una regola in JSON5 con ordine di chiavi stabile
- [x] Scheda «Form» con elenco regole + editor campo per campo
- [x] Regole con `match` complesso: preservate e in sola lettura
- [x] Avviso esplicito: salvando dal form si perdono i commenti **di quella regola**
- [x] Il nome non è modificabile dal form: è la chiave che lega contatori e log
- [x] Validazione dell'INSIEME, non della singola regola: nomi duplicati e regole
      irraggiungibili sono proprietà che esistono solo a livello di file

**R2 — `Set-Cookie` sul 404 di blocco.** ✅ **Chiusa, e senza toccare alcun gate.**

Misurato: 404 vero → **2** `Set-Cookie`, 404 di sentinel → **0**. Bastava contare
gli header per separarli, con una sola richiesta, mentre il corpo era byte-identico.

La causa non era nei gate: era il middleware di `csrfProtection`, il cui corpo
intero era `if (ctx.session) ensureToken(ctx)`. Girando dopo il router toccava la
sessione di ogni richiesta che arrivasse fin lì — asset, crawler, 404 — mentre
sentinel risponde da uno slot pre-router e non ci passa mai. Ed era **ridondante**:
l'hook `head` e gli helper `csrfField()`/`csrfToken()` coniano già per conto
proprio. Rimosso: le due risposte tornano identiche (0 cookie entrambe), e con
l'hook che non conia più per gli anonimi anche i **decoy** hanno ora la stessa
forma di una pagina vera, invece di 0 cookie contro 2.

L'ipotesi iniziale — «va fatta per entrambi i gate o per nessuno» — era sbagliata:
il confine non passa fra i due gate, passa fra *chi risponde prima* e *chi risponde
dopo* la catena dei middleware. Risolto a monte, entrambi i gate ne beneficiano
senza modifiche.

- [x] Diagnosi: la differenza nasce a valle, non nei gate
- [x] Correzione in `csrfProtection` (middleware rimosso, hook che non conia per gli anonimi)
- [x] `set-cookie` tolto dai volatili nel test byte-per-byte
- [x] Test dedicato sulla parità dei `Set-Cookie` fra 404 vero e 404 di blocco
      (verificato che fallisce se il middleware torna)

**R3 — Config core non materializzati al boot.** ✅ **Chiusa**, con due
correzioni a come la voce era scritta.

I vivi dei core sono git-ignored e dichiarati «rigenerabili dai `.default`» come
tutti gli altri, ma a crearli era solo il wizard: dopo l'installazione un
`git clean -X` o un ripristino parziale da backup li faceva sparire per sempre, e
l'avvio moriva con uno stack trace grezzo. Incontrato durante il Passo 4, con
`adminConfig.json5` assente.

Le due correzioni:

1. **Le coppie sono due, non tre.** `ital8Config.json5` va lasciato fuori: la sua
   assenza è il gate `[INIT]`, e materializzarlo in silenzio farebbe partire coi
   default un progetto mai configurato, scavalcando il wizard. C'è ora un test
   che presidia proprio questo.
2. **«Prima della riconciliazione» non bastava.** `koaSession.json5` è letto dal
   montaggio dei priority middleware, che in `index.js` gira a livello di modulo —
   prima ancora che `startApp()` parta. Serve quindi una materializzazione
   sincrona in quel punto (`materializeFromDefault.sync`), mentre per
   `adminConfig.json5`, letto da `adminSystem.initialize()`, `startApp()` va bene.

- [x] `materializeFromDefault.sync` su `koaSession`, prima dei priority middleware
- [x] `materializeFromDefault` su `adminConfig`, in `startApp()`
- [x] `ital8Config` escluso, con test che lo presidia
- [x] Box `[CONFIG]` + `exit 1` quando manca anche il `.default`
- [x] Test d'integrazione sul boot reale (verificato che falliscono senza la correzione)

---

### Piano di consolidamento — quello che il codice promette e non mantiene

> ⚠️ **DA APPROVARE.** Piano proposto dopo la revisione completa dei due plugin
> (2026-08-12, `/code-review` a livello `max` su `plugins/sentinel` e
> `plugins/adminSentinel`, più lo slot `sentinelGate` del core). **Nessuno step è
> stato eseguito.** Anche il nome del piano è da confermare: alternative proposte
> *Piano di consolidamento* / *Piano di rientro* / *Piano post-revisione*.

15 rilievi. Nove riverificati leggendo il codice riga per riga; per gli altri sei
la fonte è l'analisi della revisione, indicata voce per voce con *(da riverificare)*.

**Due schemi ricorrenti**, che contano più dei singoli difetti perché guidano le
correzioni:

1. **L'impronta è trattata come se identificasse un client, mentre identifica la
   forma di una richiesta.** Da qui C7 e C9, e in parte C2. Finché la confusione
   resta, ogni funzione costruita sull'impronta la eredita.
2. **I commenti più sicuri di sé stanno esattamente dove sono i difetti.** «Un
   client non cambia libreria a metà connessione», «un'impronta da browser non
   può ricevere un giudizio negativo», «il totale storico resta nel file», «le tre
   difese, tutte necessarie»: quattro affermazioni scritte dall'intenzione che il
   codice non mantiene. Vanno corrette **insieme** al codice, o la prossima
   lettura si fiderà di nuovo.

**Ordine: rischio crescente**, come per il piano di rifinitura. Prima ciò che è
certo, locale e già dannoso; poi il cuore del motore; le decisioni per ultime.

| # | Step | Rilievi | Rischio | Perché lì |
|---|---|---|---|---|
| ~~**C1**~~ ✅ | ~~Le azioni che non mantengono il contratto~~ | 3 | basso | Locali e indipendenti, ma **agivano male** su chi aveva già acceso `enforce` |
| ~~**C2**~~ ✅ | ~~Il giudizio non deve toccare le impronte condivise~~ | 1 | basso | Una riga, chiude una promessa scritta a caratteri cubitali |
| ~~**C3**~~ ✅ | ~~Decoy: perimetro di scrittura e contesto di escape~~ | 2 | basso | Nessuno tocca il percorso delle richieste normali |
| ~~**C4**~~ ✅ | ~~L'identità del client dietro proxy~~ | 1 | medio | Chiuso il sottoinsieme rilevabile; il resto è di rete, non di codice |
| ~~**C5**~~ ✅ | ~~La catena delle migrazioni~~ | 1 | basso | Nessun codice a runtime, ma sblocca le installazioni esistenti |
| ~~**C6**~~ ✅ | ~~Vista C: le due perdite silenziose del form~~ | 2 | basso | Solo GUI; l'invariante da ripristinare è scritta nel form stesso |
| ~~**C7**~~ ✅ | ~~L'impronta: cache per connessione~~ | 1 + test | **alto** | Percorso caldo di ogni richiesta, e va riscritto un test che oggi codifica il difetto |
| ~~**C8**~~ ✅ | ~~I contatori che mentono~~ | 2 | basso | Non cambiano decisioni, cambiano ciò che l'amministratore legge per prenderle |
| ~~**C9**~~ ✅ | ~~Le due decisioni rimaste~~ | 2 | — | Non sono correzioni: richiedono una scelta tua |

---

#### C1 — Le azioni che non mantengono il contratto ✅

- [x] **`throttle` risponde 404** *(verificato)*. È in `VALID_ACTIONS` e il README
      lo documenta come «delega a rateLimiter **senza bloccare**», ma
      `shouldEnforce` esclude solo `allow`/`monitor`, `attachResponder` non ha un
      ramo per lui, e il gate cade su `deny()`. Chi scrive una regola `throttle` e
      passa a `enforce` blocca tutto credendo di contare soltanto.
- [x] **`serveDrop` può lasciare la richiesta appesa** *(verificato)*.
      `ctx.respond = false` è assegnato **prima** del controllo sul socket e la
      funzione ritorna `true` comunque: senza socket nessuno risponde e il gate
      non scrive il 404 di ripiego. L'assegnazione va dopo il controllo, con
      `return false` quando il socket non c'è.
- [x] **Open redirect via backslash** *(verificato)*. `ruleValidator.js:631`
      considera esterno solo `scheme://` o `//`; la riga 657 rifiuta solo ciò che
      non inizia con `/`. Quindi `to: '/\evil.com'` passa **come interno**,
      saltando allowlist degli host e divieto di 301/308 — e i browser lo
      normalizzano in `//evil.com`. CLAUDE.md §*Prevenzione Open Redirect* impone
      di rifiutare entrambe le forme, e `getSafeRedirectUrl` lo fa: qui non è usato
      e questo validatore è l'unica guardia.

**Esito.** Il difetto di `throttle` era più largo di come la revisione l'aveva
descritto: `enforced` non alimenta solo il gate, ma anche il **conteggio dei
blocchi del censimento delle impronte** (`main.js`, campo `blocked:`) — da cui la
reputazione ricava `suspect`/`bad` — e la colonna enforced/observed della
dashboard. Metterlo a false solo nel verdetto avrebbe corretto il 404 lasciando in
piedi impronte condannate per blocchi mai avvenuti. La correzione è quindi in
`shouldEnforce`, con l'escalation spostata su una condizione propria: `throttle`
conta sempre, e `escalate.ban` non scatta più su di lui (documentato).

Per `serveDrop` la rinuncia senza socket riusa `dropDegraded`, lo stesso contatore
del degrado dietro proxy: in entrambi i casi il significato è «non ho potuto
troncare, risponde il gate».

Per il redirect si **rifiuta** la forma `/\` invece di normalizzarla: nessuno la
scrive per caso, quindi l'unica risposta utile è dire all'autore di scrivere ciò
che intende.

- [x] +15 test unitari (`engineActions.test.js`, che mette finalmente in uso
      `_internals`, esportato e mai usato da nessuno) + 4 sul validatore + 2
      d'integrazione su server reale
- [x] Verificato che **9 test falliscono** ripristinando i tre difetti
- [x] `README.it.md`: la riga di `throttle` diceva «senza bloccare» mentre il
      codice bloccava. Ora dice cosa fa davvero, incluse le due conseguenze
      (`enforced: false`, niente `escalate.ban`)

#### C2 — Il giudizio non deve toccare le impronte condivise ✅

- [x] **`burst` è fuori dalla guardia `protectBrowserFingerprints`** *(verificato)*.
      `levels.push('burst')` non è protetto, mentre `suspect`/`bad` lo sono. Al
      primo visitatore reale una pagina con i suoi asset produce decine di
      richieste in secondi sotto l'unica impronta condivisa «Chrome su Linux» →
      `burst`. Una regola `reputation: ['burst']` — forma suggerita dal file di
      regole distribuito — chiude fuori ogni utente di quel browser. È il caso che
      l'intestazione di `reputation.js` dichiara impossibile.

**Esito.** Come per la cache dell'impronta (C7), **c'era un test che difendeva il
difetto**: `'la protezione non tocca burst'`, motivato con «`burst` non è un
giudizio sulla condotta ma una constatazione di cadenza, e non condanna nessuno da
solo». È il ragionamento che aveva lasciato `burst` fuori dalla guardia, e non
regge: in una regola `burst` si usa come gli altri livelli, e
`match: { reputation: ['burst'] }, action: 'block'` è proprio la forma che il file
di regole distribuito suggerisce.

La guardia è ora una sola attorno a tutti e tre i livelli, perché la promessa in
testa al file è una sola. La documentazione non andava corretta — README e
`pluginConfig.default.json5` promettevano già che un'impronta da browser non
riceve **mai** un giudizio negativo: era il codice a non mantenerlo. Vi ho aggiunto
solo la menzione esplicita di `burst`, perché un lettore che ricorda il vecchio
comportamento non resti nel dubbio.

- [x] Guardia unica attorno a burst + suspect/bad
- [x] Riscritto il test che asseriva il comportamento difettoso
- [x] Test dello scenario reale: primo visitatore di un sito nuovo, 42 richieste
      in 3 secondi da impronta browser → `levels: []`; stesso traffico da impronta
      script → `burst`
- [x] Test che la disattivazione esplicita riaccende burst anche sui browser
- [x] Verificato che **2 test falliscono** ripristinando il difetto

#### C3 — Decoy: perimetro di scrittura e contesto di escape ✅

- [x] **`getWritablePaths` dichiara `decoys/data`** *(verificato: zero scritture in
      tutto il codice — solo `existsSync` + `readFileSync`)*. Su un deploy con
      filesystem immutabile il gate di storage salta **l'intero plugin di
      sicurezza** per una cartella da cui si legge soltanto, ed è proprio lo
      scenario che il box `[SENTINEL]` esiste per rendere visibile. Va dichiarata
      solo la data dir.
- [x] **`decoyRenderer` escapa solo in contesto HTML** *(riverificato: confermato il meccanismo, ridimensionata la gravità — vedi esito)*.
      `const esc = isHtml ? escapeHtml : String` — un decoy `.js` o `.json`
      riflette `{{path}}`/`{{ip}}` grezzi.

**Esito.** Il meccanismo è confermato, la gravità **ridimensionata rispetto alla
revisione**, che parlava di codice «eseguibile nell'origin del sito». Non regge
per il `.js`: un `<script src>` cross-origin esegue nell'origin di CHI INCLUDE,
quindi l'attaccante infetterebbe sé stesso, e una navigazione diretta a
`application/javascript` non esegue affatto. Il caso con conseguenze vere è
invece **`.xml`**, che i browser renderizzano e che può portare XHTML in
namespace. Per `.json` e `.js` il danno reale è un altro e non è banale: una
virgoletta nel percorso rompe il documento, e **un decoy malformato non inganna
nessuno** — fallisce nell'unica cosa per cui esiste.

Nessun decoy distribuito è in un formato a rischio (sono `.html` e `.txt`), quindi
l'esposizione riguardava solo i decoy scritti dall'amministratore.

La correzione sostituisce il booleano `isHtml` con una **tabella per estensione**:
markup → entità, JSON → escape di stringa JSON, JS → come JSON più l'apostrofo
(che in JSON sarebbe una sequenza non valida), CSS → esadecimale. `text/plain`
resta senza escape, e la motivazione originale — «in un finto `.env` l'escaping
HTML sarebbe rumore visibile» — era ed è giusta: era il *«tutto ciò che non è
HTML»* a essere sbagliato, non quel caso.

- [x] Tabella `REFLECT_ESCAPERS` + `reflectEscaperFor(ext)`; `renderTemplate`
      riceve l'escaper invece di un booleano
- [x] Test che pretende una scelta esplicita per **ogni** tipo di CONTENT_TYPES,
      così aggiungerne uno senza decidere l'escape non passa in silenzio
- [x] Il test del `.js` verifica la proprietà vera — il valore riflesso torna
      indietro intatto eseguendo davvero il decoy — invece di cercare un carattere
- [x] `decoys/data` tolta da `getWritablePaths`, con la regola generale scritta
      accanto: si dichiara una directory se e solo se esiste una scrittura che la
      riguarda
- [x] Verificato che **6 test falliscono** ripristinando i due difetti

#### C4 — L'identità del client dietro proxy ✅

- [x] **`resolveClientIp` clampa l'indice XFF a 0** *(riverificato e misurato: confermato, e con un caso peggiore di quello segnalato)*. Con
      `trustedProxyCount` maggiore della catena reale, `Math.max(0, len - hops)`
      restituisce la voce **più a sinistra**, cioè quella scritta dal client. IP di
      ban, chiave del censimento, escalation verso rateLimiter e confronto
      `sameClient` del canary diventano tutti scelti dall'attaccante. Non si deve
      mai indicizzare a sinistra di ciò che i proxy fidati hanno effettivamente
      scritto. *(Nota: `chain[index] || chain[0]` è anche codice morto — `chain` è
      già filtrata.)*

**Esito, e il limite di quanto è correggibile qui.** Misurato con sei topologie:

```
                                  hops   prima      dopo
1 proxy, catena corretta            1   203.0.113.9  203.0.113.9  ✓
1 proxy, client che mente           1   203.0.113.9  203.0.113.9  ✓
2 proxy, catena corretta            2   203.0.113.9  203.0.113.9  ✓
hops=3, catena di 1                 3   1.2.3.4 ✗    203.0.113.9  ✓ (corretto)
hops=2 ma 1 solo proxy reale        2   1.2.3.4 ✗    1.2.3.4      ✗ (NON correggibile)
hops=1, connessione DIRETTA         1   1.2.3.4 ✗    1.2.3.4      ✗ (NON correggibile)
```

**Il caso peggiore non era quello segnalato.** La revisione parlava di un
off-by-one nella configurazione; ma la riga 5 mostra che con
`trustedProxyCount: 1` **perfettamente corretto**, chi raggiunge l'app
direttamente scavalcando il proxy manda `X-Forwarded-For: 1.2.3.4` e ottiene
esattamente quello. Non serve sbagliare la configurazione: serve che la porta
dell'app sia raggiungibile.

**Perché le ultime due non si correggono a questo livello.** Nei tre casi
legittimi la catena ha `length >= hops` e l'indice `length - hops` è corretto per
costruzione. Nei due residui la catena ha *esattamente* la lunghezza attesa —
perché l'attaccante l'ha imbottita, o perché non è passata da alcun proxy — ed è
**indistinguibile dall'header soltanto** da una catena legittima. L'unico
discriminante è se il peer del socket sia davvero un proxy fidato, e per saperlo
servirebbe un elenco di indirizzi, che oggi non esiste (`trustedProxyCount` è un
numero). Vedi il seguito proposto qui sotto.

- [x] `chain.length < hops` → ripiego sul peer del socket, che non è falsificabile
- [x] Avviso una volta sola (latch): la condizione è provocabile da chi bussa, e
      un log per richiesta sarebbe un attacco al disco travestito da diagnostica
- [x] Rimosso `chain[index] || chain[0]`, morto: `chain` è già filtrata
- [x] +8 test sulle sei topologie. Verificato che **2 falliscono** ripristinando
      il clamp
- [x] `pluginConfig.default.json5`: le due avvertenze che mancavano — il numero
      dev'essere **esatto**, e `trustProxy: true` è **una promessa** («all'app si
      arriva solo dal proxy») il cui rimedio è di rete, non di configurazione

**Seguito proposto — `trustedProxies` come elenco invece che come numero.**
Sostituire (o affiancare) il conteggio con un elenco di indirizzi/CIDR dei proxy
fidati permetterebbe di verificare che il peer del socket sia davvero uno di
loro, chiudendo anche le due righe rosse qui sopra. Non è stato fatto dentro C4
perché è una **chiave di configurazione nuova** — quindi una decisione di naming e
di compatibilità che spetta al maintainer — e perché va coordinata con la voce
trasversale `keyResolver in core/`: rateLimiter risolve l'IP per conto suo, e due
elenchi di proxy che possono divergere sarebbero peggio di uno approssimativo.

#### C5 — La catena delle migrazioni ✅

- [x] **`schemaVersion: 5` ma step solo fino a 3** *(verificato)*. Il runner calcola
      `covered = pending.length === (target - liveVersion)`: non torna mai, quindi
      box `[MIGRATE]` di errore a ogni boot che nulla può chiudere e
      `migrate sentinel` che si rifiuta di girare — **anche per i due step veri**.
      Le installazioni esistenti non ricevono mai `canary-token-used` né
      `session-hijack-signal`, e continuano a calcolare dati che nessuna regola
      legge. Servono due step `automatic: true` senza script, 3→4 e 4→5, con la
      `reason` che spiega perché sono vuoti.

**Esito.** I due bump erano stati fatti nel giusto convincimento che il merge
additivo bastasse — e bastava: il passo 7 ha aggiunto `custom.tarpit`, il passo 8
`custom.reputation` e `census.ipRetentionDays`, tutte chiavi dentro oggetti. Anche
le 43 e 49 righe aggiunte al file delle regole in quegli interventi sono
**tutte commenti** (verificato: gli esempi di `drop`, `tarpit` e reputazione
restano commentati per scelta), quindi `rules` non è cambiato.

L'errore non è stato non scrivere uno script: è stato non dichiarare lo **step**.
Il runner non guarda se serva uno script, guarda se la catena copre il salto.

**Provato end-to-end** su un'installazione simulata a v1: `readPlan` passava da
`incomplete-chain` («la catena non copre l'intero salto v1 → v5») a `ok`, e
`npm run cli -- migrate sentinel -y` ha applicato **4 step su 4** portando il vivo
a v5, con `custom.tarpit` e `custom.reputation` presenti e le due regole al loro
posto (gli step sono idempotenti: «già presente, nessuna modifica»).

- [x] Due step `automatic: true` senza script, con `reason` che spiega perché
      sono vuoti e perché esistono lo stesso
- [x] `from-v3-to-v4.md` e `from-v4-to-v5.md`, più le voci nel CHANGELOG delle
      migrazioni. Il secondo avvisa su `protectBrowserFingerprints`: arriva a
      `true`, ma il merge non sovrascrive un valore già presente
- [x] **`migrationsChain.test.js`**: la catena deve coprire per intero il salto
      fino alla `schemaVersion` del descrittore, ogni salto dev'essere unitario e
      contiguo, ogni step motivato, ogni script esistente, ogni salto documentato.
      È il promemoria eseguibile che mancava — il difetto è invisibile a mano
      (due file lontani da confrontare) e si ripresenta a **ogni** bump

#### C6 — Vista C: le due perdite silenziose del form ✅

- [x] **`sessionAnomaly: true` e `reputation: true` spariscono** *(riverificato: confermato)*.
      `fillMatch` traduce la forma booleana in «niente selezionato» e `collectMatch`
      non riscrive la chiave: aprire una regola, cambiare la descrizione e salvare
      la **allarga** da «solo sessioni anomale» a «tutte». Continua a validare,
      quindi nulla se ne accorge.
- [x] **Un `query` array viene appiattito in stringa** *(riverificato: confermato, e la correzione ovvia era sbagliata — vedi esito)*.
      `['union select', 'sleep(']` diventa il letterale `union select,sleep(` e la
      regola smette di rilevare entrambi i pattern. `mUserAgent` gestisce già il
      caso array correttamente: è il modello da seguire.

Entrambi violano l'invariante scritta nell'intestazione del form: *«un form non
deve MAI distruggere ciò che non sa rappresentare»*.

**Esito.**

`true` significa «qualunque», e la cura è renderlo **rappresentabile** invece di
tollerarlo: i due elenchi hanno ora una voce **«qualunque (true)»** con valore
sentinella `*` — che non può collidere, visto che anomalie e livelli sono nomi.
Selezionandola insieme ad altre voci vince lei, perché è la più larga.

Per `query` la correzione ovvia era **sbagliata**: copiare il trattamento di
`userAgent`, cioè separare per virgola. Nella querystring la virgola è un
carattere normale (`?ids=1,2,3`), quindi `"ids=1,2,3"` — un pattern singolo
perfettamente legittimo — sarebbe stato spezzato in tre. È diventata invece
un'**area di testo con un pattern per riga**, come `path`: l'unica forma che
regge sia l'array sia la stringa con virgole.

**Verificato dal vivo**, con login vero e giro completo attraverso l'API della
GUI su una regola `{ sessionAnomaly: true, query: ['union select','sleep('],
path: '/admin/**' }`:

```
prima (vecchia mappatura) → {"path":"/admin/**","query":"union select,sleep("}
dopo  (giro no-op reale)  → identica all'originale ✓
```

- [x] Voce «qualunque» nei due elenchi + mappatura nei due versi
- [x] `mQuery` da input a textarea, un pattern per riga
- [x] Le quattro mappature estratte come **funzioni pure** ed esportate sotto
      `typeof module` (ramo che in browser non esiste): sono l'unica parte
      testabile senza un DOM, che il progetto non allestisce da nessuna parte, e
      sono esattamente dove il form ha perso dati due volte
- [x] +18 test sul giro completo file → form → file. Verificato che **6
      falliscono** ripristinando le vecchie mappature
- [x] `adminSentinel/README.it.md`: la sezione sull'invariante ora dice che
      valeva anche per i casi piccoli, con la tabella di cosa si perdeva

**Sibling non toccato, per scelta.** `userAgent` ha lo stesso difetto latente:
separa per virgola, quindi una stringa singola che ne contiene una verrebbe
spezzata. Non l'ho cambiato perché a differenza di `query` il round-trip degli
array lì **funziona**, e passare a textarea cambierebbe il significato di ciò che
è già scritto su una riga sola (`curl, wget` da due pattern a uno). È una
decisione di interfaccia su un campo che nessuno ha segnalato: la lascio a te.

#### C7 — L'impronta: cache per connessione ✅

- [x] **La memoizzazione sul socket annulla le due regole di punta** *(verificato)*.
      `buildFingerprint` memoizza sul socket TCP con chiave il solo salt. Il
      razionale — «un client non cambia libreria HTTP a metà connessione» — vale
      per la libreria, ma la `fpClass` contiene anche `headerProfile` e `coherent`,
      che si ricavano dagli header **di quella richiesta**. Su keep-alive una
      richiesta di riscaldamento con header da browser fissa
      `{coherent: true, headerProfile: 'browser'}` per tutta la connessione:
      `ua-fingerprint-mismatch` e `auth-surface-noise` si aggirano con una
      richiesta. Colpisce anche il traffico legittimo — il primo asset di una
      connessione detta il profilo di tutta la pagina.
- [x] **Riscrivere il test che codifica il difetto.**
      `requestFingerprint.test.js:128` mandava `CURL_HEADERS` e poi
      `CHROME_HEADERS` sullo stesso socket e pretendeva `expect(second).toBe(first)`.
      Non bastava correggere il codice: quel test difendeva il bug.

**Esito: la cache è stata rimossa, non ristretta.** La direzione ipotizzata
(memoizzare solo ciò che è stabile per connessione) si è rivelata un vicolo cieco
una volta misurata: *nulla* di ciò che serve è stabile per connessione tranne la
versione HTTP, che è una lettura di proprietà e non costa niente. Il resto —
ordine e valori degli header, `headerProfile`, `coherent` — dipende dalla singola
richiesta per costruzione.

**Le due misure che hanno deciso.** Server HTTP autonomo che calcola l'impronta
con e senza cache, pilotato da Chromium su una pagina con CSS, immagine, script
e `fetch` POST:

```
sock  url          impronta VERA     impronta RESA
1     /            bc13ff8a825ba577  bc13ff8a825ba577
1     /a.css       2c96521fe4b2f813  bc13ff8a825ba577 ✗
1     /c.js        14b440b9e2667937  bc13ff8a825ba577 ✗
1     /d.json      e582bd022cc792a6  bc13ff8a825ba577 ✗   (POST)
→ 3 richieste su 7 con l'impronta di un'altra
```

e l'aggiramento, con due richieste a socket grezzo sulla stessa connessione:

```
1  /index.html        vera: browser coerente=true    resa: browser coerente=true
2  /admin/config.php  vera: minimal coerente=false   resa: browser coerente=true ✗
→ `ua-fingerprint-mismatch` muto dopo una richiesta di riscaldamento
```

Dopo la correzione entrambe le misure danno **0 richieste sbagliate**.

**Il costo, misurato invece che temuto.** `buildFingerprint` costa ~11,5 µs per
una navigazione Chrome (sha256 2,0 · `detectBot` 2,8 · le 24 regex sull'UA il
resto; l'ordine degli header 0,4, il profilo 0,09). Una richiesta end-to-end
attraverso il CMS ne costa ~1000-1300, con una varianza fra due esecuzioni
identiche di ±150 µs: l'effetto della rimozione è **venti volte più piccolo del
rumore di misura**, e non è osservabile end-to-end. In assoluto: a 1000
richieste al secondo, l'1% di un core.

Una memoizzazione *corretta* resterebbe possibile e non è stata fatta: la parte
cara è quella derivata dall'UA (~70%), che si potrebbe memoizzare **con l'UA
stesso come chiave** — verificando invece di assumere, che è precisamente ciò che
mancava. Richiederebbe un nome nuovo (regola 3 del CLAUDE.md) e vale ~8 µs: se lo
si vuole, è una richiesta a sé.

> La morale, che vale oltre questo file: una cache **per connessione** di una
> proprietà **per richiesta** non è un'ottimizzazione aggressiva, è un errore di
> categoria — ed è lo schema n°1 della revisione («l'impronta trattata come se
> identificasse un client») nella sua forma più pura.

**Seguito proposto — memoizzare la sola parte derivata dall'User-Agent.** Vale
~8 µs su 11,5 e sarebbe corretta per costruzione, perché la chiave sarebbe l'UA
stesso (troncato a `MAX_UA_LENGTH`, quindi confronto limitato) e i cinque valori
che ne dipendono — `declaredFamily`, `claimedBrowser`, `claimedOs`, `isBot`,
`botName` — sono funzioni pure di quella sola stringa. Non fatta dentro C7 per
due ragioni: serve un **nome nuovo** per la chiave sul socket (regola 3 del
CLAUDE.md), e reintrodurre una cache nello stesso file dove ne è appena stata
tolta una vuole essere una decisione, non un residuo dello stesso intervento.

#### C8 — I contatori che mentono ✅

- [x] **Il censimento degli esiti conta i 3xx.** Il gate filtra i 2xx e passa
      tutto il resto; `observeOutcome` accettava qualunque non-2xx, quindi ogni
      redirect finiva fra i percorsi falliti distinti da cui si ricavano i
      «sospetti scanner» — il pannello nato per mostrare gli attacchi senza
      regola. Ora si conta **dal 400 in su**.

      **Riverificato, e il rilievo era giusto per la ragione sbagliata.** Lo
      scenario descritto — il visitatore che ricarica 25 asset in cache — **non
      si verifica in questo stack**: misurato sull'istanza viva, nessuna delle
      istanze di `koa-classic-server` gestisce le richieste condizionali (né
      `ETag` né `Last-Modified` in risposta; `If-None-Match` e
      `If-Modified-Since` ricevono 200), e le risorse dei temi vanno
      esplicitamente in `Cache-Control: no-store`. **Nessun 304 esiste.**

      Lo scenario che si verifica davvero è un altro, e pesa di più: l'area
      admin risponde **302 verso la pagina di login a ogni richiesta non
      autenticata** (verificato: `/admin/`, `/admin/usersManagment` → 302). E
      soprattutto, il caso peggiore è un sito con `urlRedirect` o
      `hideExtension` attivi, dove un crawler legittimo che segue duecento link
      vecchi colleziona duecento percorsi distinti e viene classificato come
      scanner — cioè proprio il tipo di sito che quei plugin li installa.
- [x] **`ruleHitCounter` distrugge lo storico degli IP distinti** *(verificato)*.
      `_load` ricreava un `Set` vuoto e `getSummary()` ne leggeva `size`: il
      primo flush dopo un riavvio riscriveva quel valore sopra lo storico. E non
      solo per la regola toccata — `save()` riscrive il payload **per intero**,
      quindi bastava un hit su una qualunque regola per azzerare il conteggio di
      tutte. Il commento accanto affermava l'opposto («il totale storico resta
      nel file»).

      **Scelta: un pavimento, non gli indirizzi.** Il valore letto dal file
      diventa il minimo, e `getSummary()` restituisce il massimo fra quello e
      l'insieme della sessione corrente. Il numero è così monotono e ha un
      significato dichiarabile — **il massimo osservato in una singola
      esecuzione** — che è un limite inferiore onesto e risponde alla domanda per
      cui il campo esiste: «questa regola scatta su una persona sola o su
      molte?». L'alternativa (persistere gli indirizzi per ricostruire l'insieme)
      è stata scartata: farebbe di `ruleHits.json5` un archivio di dati personali
      senza che nessuno l'abbia chiesto — esattamente ciò che `censusIpMode`
      esiste per rendere una scelta esplicita. Un test verifica che nessun
      indirizzo finisca sul file.

**Nome introdotto:** `distinctIpsBaseline`, proprietà **interna** all'entry in
memoria (il formato del file non cambia: resta la sola chiave `distinctIps`).
Alternative valutate: `distinctIpsAtLoad`, `distinctIpsHighWater`. Se preferisci
una delle altre due è una sostituzione di due righe.

**Test:** `tests/unit/counters.test.js`, 26 test — i **primi** per entrambi i
moduli, che non ne avevano nessuno. Ripristinando i due difetti, 12 falliscono.

#### C9 — Le due decisioni rimaste ✅

Non erano correzioni: erano scelte. Decise dal maintainer il 2026-08-14 sulle
raccomandazioni **(b)** e **(B)**.

##### Decisione 1 — `fingerprintChanged` confronta la CLASSE, non l'hash

- [x] **Scelta la (b):** confronto su `fpClass` invece che sull'hash. Scartate la
      (a) — una linea di base per forma di richiesta, che aggiunge stato e una
      classificazione nuova da mantenere — e la (c), rimuovere la foglia, che
      avrebbe perso l'unica cosa che `scriptClient` non dice: la **transizione**
      («questa sessione era un browser e non lo è più») invece dello stato
      («questa richiesta è script-like»).

**Quali campi, e perché tre su sette.** `headerProfile`, `family`, `coherent` —
i tre in cui la forma degli header *entra*. Fuori `claimedBrowser`, `claimedOs`,
`isBot`, `botName`: derivano dal solo User-Agent, quindi se cambiano lo dice già
`uaChanged`, e includerli avrebbe reso questa foglia un duplicato di quella.

**La misura che ha scelto i campi.** Chromium su una pagina con CSS, font,
immagine, iframe, script, `fetch` GET e POST, XHR, `sendBeacon` e submit di
form: **13 richieste, 9 impronte distinte, e tutti e sei i campi di `fpClass`
costanti**. La classe è stabile esattamente dove l'hash non lo è.

**Il prima/dopo, sull'istanza viva.** Sessione admin vera (login col form,
token dal campo `_csrf`), 6 navigazioni + 6 AJAX + 1 POST, poi la stessa sessione
che prosegue da uno script con l'UA che mente:

| | traffico admin normale | dopo il dirottamento |
|---|---|---|
| **prima** (hash) | `flagged=1`, `fingerprintChanged=1` | `fingerprintChanged=1` — **invariato** |
| **dopo** (classe) | `flagged=0`, `fingerprintChanged=0` | `flagged=1`, `fingerprintChanged=1`, `scriptClient=1` |

La riga che conta è la prima, a destra: con il confronto sull'hash l'allarme era
**già acceso prima dell'attacco**, quindi l'attacco non cambiava nulla di
osservabile. Non era un semaforo rumoroso, era un semaforo inutile.

- [x] **`x-csrf-token` fra i `VOLATILE_HEADERS`.** Va fatto comunque, e ora ha una
      ragione in più: la sua sola presenza divideva in due le richieste dello
      stesso browser, moltiplicando le voci del **censimento** senza aggiungere
      segnale.
- [x] **La descrizione della regola distribuita** non invita ad aggiungere
      `fingerprintChanged` — verificato: cita `ipChanged`/`networkChanged` e già
      con la sua avvertenza. Nulla da correggere, e il file delle regole non è
      stato toccato (per raggiungere le installazioni esistenti servirebbe una
      migrazione, sproporzionata per un testo).

**Il nome resta `fingerprintChanged`.** Un rename in `clientClassChanged` sarebbe
più preciso ma è un'altra decisione: tocca `ANOMALY_KINDS`, il validatore, i due
`<select>` della GUI, la CLI, e soprattutto vorrebbe una **migrazione** per le
regole che un amministratore avesse già scritto. Annotato qui se un giorno lo si
vuole.

##### Decisione 2 — le difese ReDoS erano tre sulla carta e una sola nei fatti

- [x] **Scelta la (B):** il commento smette di contare una difesa che non esiste,
      e si rafforza quella vera. Scartata la (A), portare la valutazione fuori
      dall'event loop: `evaluate` ha bisogno di `ctx`, delle regole compilate,
      dei censimenti e della sessione — serializzare tutto a un worker per ogni
      richiesta costerebbe più di quanto protegge.

**Cosa è risultato falso, misurando.**

1. *«tetto di tempo sulla valutazione (sentinelGate)»* — non esiste come difesa
   ReDoS. `engine.evaluate(ctx)` è **sincrona**: `Promise.resolve()` la esegue
   per intero prima che la corsa cominci, e se una regex sta ciclando è l'event
   loop a essere fermo, quindi il `setTimeout` non scatta comunque. Il tetto
   resta — protegge da un `evaluate` lento in modo *asincrono* — con il commento
   che ora dice quale caso copre.
2. *«troncamento degli input prima del test»* — copriva il solo User-Agent.
   Estenderlo a percorso e query è stato **valutato e scartato**, ed è la
   sorpresa di questo step: (i) contro un pattern esponenziale è irrilevante,
   misurato — `/(a|a)*$/` impiega **29 secondi su TRENTA caratteri**, quindi
   nessun tetto sulla lunghezza salva niente; (ii) tagliare la coda regala
   un'evasione universale — imbottisci il percorso con 2 KB di spazzatura e ci
   appendi `/config.php`, e una regola `**/config.php` non matcha più. Si
   scambierebbe un rischio *condizionato* con una falla *incondizionata*.

**Il rinforzo vero: l'euristica aveva un buco dove vive il pericolo.**
`hasNestedQuantifier` riconosceva `(a+)+`, `(a*)*`, `(?:a+)+`, `(a{2,})+` — e
**non** l'alternanza quantificata: `(a|a)*`, `(a|ab)*`, `(\s|\s)*` passavano.
Misurato, `(a|a)*$` contro 30 caratteri: 29 secondi di sito fermo. La funzione ora
riconosce entrambe le famiglie e si chiama **`hasCatastrophicBacktracking`** (il
vecchio nome sarebbe diventato una bugia). Alternative valutate:
`isBacktrackingRisk`, `hasRiskyQuantifier`.

Rifiuta anche alternanze innocue (`(foo|bar)+` non ha rami sovrapposti), ed è la
direzione d'errore già dichiarata in testa a quel file: *un falso rifiuto costa
una riscrittura, un falso permesso costa il sito*. **Nessuna regola distribuita è
toccata**: usano l'alternanza — `(rsa|dsa|…)$`, `(c99|r57|…)\.` — ma nessuna la
quantifica.

---

### ~~Aperto~~ ✅ CHIUSA — `fingerprintChanged` mentiva per costruzione

> **Risolta in C9** (2026-08-14) con la risposta (b): il confronto è passato
> dall'hash alla **classe** dell'impronta — `headerProfile`, `family`,
> `coherent`. Verificato dal vivo: sessione admin che mescola 6 navigazioni,
> 6 AJAX e una POST → `flagged=0`; la stessa sessione che prosegue da uno script
> → `flagged=1`. Prima, l'allarme era già acceso *prima* dell'attacco.
>
> Questa sezione resta come descrizione del problema e del perché la scelta è
> caduta lì. Il seguito del ragionamento è in **C9**, sopra.

Emerso analizzando l'interazione fra sentinel e `csrfProtection` (v2.81.0). Non
è un bug con un sintomo: è una foglia che **non può funzionare come promette**,
e oggi non fa danno solo perché la regola distribuita non la usa.

La revisione completa dei due plugin (2026-08-12) ha aggiunto un pezzo: la
memoizzazione dell'impronta sul socket (**C7**) **peggiorava** il quadro, perché
il profilo del primo asset di una connessione restava appiccicato a tutte le
richieste successive di quella connessione. ✅ **Rimossa.** Il rumore ora è quello
vero, e si è rivelato deterministico invece che casuale: quattro impronte per una
pagina, sempre le stesse (vedi C7).

`sessionCoherence` fissa una linea di base al primo avvistamento di una sessione
autenticata e la confronta con ogni richiesta successiva. Ma l'impronta descrive
la **forma di una richiesta**, non il client: una navigazione e una `fetch` dallo
stesso identico browser hanno `accept` diverso e `upgrade-insecure-requests`
presente solo nella prima, quindi impronte diverse. Misurato, stesso Chrome:

```
navigazione            fp = 3ba1e6a0…
fetch POST  CON csrf   fp = 8ef61e86…
fetch POST SENZA csrf  fp = 51a933d8…
```

Tutte e tre diverse. Ne segue che **ogni sessione admin che mescoli navigazioni
e AJAX — cioè ogni sessione admin — produce `fingerprintChanged` di continuo**, e
la linea di base non si aggiorna mai, quindi la marcatura resta fino al logout.

Perché non è innocuo pur non essendo attivo:
- la regola `session-hijack-signal` usa `uaChanged` e `scriptClient`, ma la sua
  **descrizione invita** ad aggiungere altre anomalie. Chi aggiunge
  `fingerprintChanged` e promuove la regola a `block` si chiude fuori dal proprio
  pannello alla prima POST;
- i contatori che l'amministratore guarda per decidere se promuovere
  (`byKind.fingerprintChanged`, `flagged`) sono gonfiati da rumore strutturale.
  Un semaforo che segna rosso sempre non è un semaforo.

Non è una correzione: è una **domanda di progetto**, e le risposte plausibili si
escludono a vicenda.

- [ ] Decidere fra: (a) **linea di base per forma di richiesta** — una per le
      navigazioni, una per le AJAX, confrontando ciascuna con la propria;
      (b) **confronto sulla sola `fpClass`** invece che sull'hash — `family`,
      `claimedBrowser`, `claimedOs` non cambiano fra navigazione e fetch, e il
      segnale che interessa («la sessione è passata da browser a script») vive lì;
      (c) **rimuovere `fingerprintChanged`** e lasciare `scriptClient`, che già
      copre il caso che conta senza il rumore.
- [ ] `x-csrf-token` fra i `VOLATILE_HEADERS` di `requestFingerprint`: toglie *una*
      delle divergenze e va fatto comunque, ma da solo **non** risolve — la
      divergenza navigazione/fetch resta.
- [ ] Finché non è deciso: la descrizione della regola distribuita non dovrebbe
      invitare ad aggiungere `fingerprintChanged` senza un avvertimento.

---

### Piano di rifinitura II — quello che la revisione del 2026-08-15 ha trovato

> **Piano chiuso:** applicata la parte che non richiedeva decisioni (v2.86.1) e,
> sulle raccomandazioni accettate dal maintainer, tutte e quattro le voci da
> decidere (v2.87.0). 10 rilievi su 10.
>
> Nome confermato dal maintainer (alternative valutate: *Piano di allineamento*,
> *Piano post-revisione II*).

Revisione completa del plugin (main + 16 moduli `lib/`, config, regole,
migrazioni, doc), successiva al piano di consolidamento. Nessun rilievo critico:
i nove step di quel piano sono stati riverificati e reggono. **10 rilievi nuovi**,
quattro dei quali verificati eseguendo il codice.

Lo schema ricorrente è, di nuovo, il secondo di quel piano — *i commenti più
sicuri di sé stanno dove sono i difetti* — con una variante che vale la pena
nominare perché si ripete: **due moduli che hanno un'idea diversa dello stesso
nome, e test che li verificano separatamente**. È il caso dell'allerta sul disco
(A1) e, in altra forma, della foglia `status` (D1).

#### Applicati — non richiedevano decisioni

- [x] **🐞 A1. L'allerta sul budget disco partiva come «INFO».** `sentinelLog`
      emetteva `kind: 'log-size-threshold'`, assente dalla tabella
      `ALERT_SEVERITY` di `alertDispatcher` → severità di ripiego, e un oggetto
      email che non distingue la riga da alzarsi a leggere. Invisibile ai test
      perché quelli del dispatcher notificavano già `diskBudget`, il nome
      giusto: si verificavano a vicenda senza che nessuno usasse ciò che l'altro
      emette. Allineato a `diskBudget` (il nome già presente in tabella, nei
      test e come default di `sendAlert`), con un test che collega i due moduli.
- [x] **A2. Le scritture del log a blocchi sotto 4 KB.** `flush()` faceva una
      `appendFileSync` **per evento**, con la motivazione — scritta in
      `EXPLAIN.it.md §11` — che una write in `O_APPEND` sotto 4 KB è atomica.
      La premessa è vera, la conclusione no: la garanzia riguarda la
      **dimensione** della write, non il numero di righe. Il prezzo si pagava
      sotto attacco, quando il buffer accumula migliaia di eventi al secondo e
      ognuno costa una syscall sincrona sull'event loop. Misurato: 1000 eventi →
      da 1000 write a **meno di 100**, file identico.
- [x] **🐞 A3. `countBraces` non conosceva i commenti a blocco.** `/* nota { */`
      sbilanciava il conteggio e la ricerca del blocco finiva altrove: la
      promozione dalla GUI falliva con «blocco testuale non individuabile» su un
      file JSON5 perfettamente valido. Falliva in modo sicuro (la verifica
      differenziale annulla la scrittura) ma dando la colpa al posto sbagliato.
      Ora lo stato del commento attraversa le righe (`scanBraces`), e
      `findRuleBlock` **salta le righe `name:` dentro un commento a blocco** —
      altrimenti una regola messa da parte commentandola verrebbe riscritta al
      posto di quella in vigore, con la GUI che dice «salvato».
- [x] **A4. In `debugMode` le regole si ricaricano al cambiamento del file**, non
      a ogni richiesta. `loadRules()` non è una rilettura: è validazione
      completa, ricompilazione di tutte le regex, un `existsSync` per decoy e
      l'emissione di **ogni avviso di validazione sul log**. Il gate sta prima
      del router, quindi girava anche per ogni immagine — e con un solo avviso in
      sospeso (la condizione normale di chi sta scrivendo regole) il log prendeva
      una riga per richiesta. Timbro `mtime`, fail-soft: file illeggibile → si
      tengono le regole già in vigore.
- [x] **A5. Avviso del validatore su `throttle` senza `escalate`.** Non produce
      una risposta (per progetto), non è enforcement, e senza destinatario non
      conta nemmeno: è una `monitor` scritta da chi credeva di limitare qualcosa,
      e siccome `monitor` è il default nemmeno il log la smentisce.
- [x] **A6. Minori.** Registrazione una sola volta degli handler `SIGTERM`/
      `SIGINT` (Node non deduplica, e una seconda `loadPlugin` ne impilerebbe
      un'altra coppia identica); parametro `info` inutilizzato in
      `observeOutcome`; rimosso `DECORATING_ACTIONS`, esportato e mai importato
      (la conoscenza vive nel gate, che riconosce una risposta decorata dalla
      presenza di `verdict.respond`, non da un elenco di nomi da tenere
      allineato a mano).
- [x] **A7. Documentazione del file delle regole distribuito.** L'elenco delle
      foglie in testa a `sentinelRules.default.json5` ometteva `canary`,
      `sessionAnomaly` e `reputation` — e due di queste sono usate dalle regole
      poco sotto. Aggiunto inoltre l'avvertimento che i path si scrivono **con**
      `apiPrefix` e `pluginPagesPrefix` (a differenza di `globalPrefix`, che il
      codice antepone): cambiarli in `ital8Config.json5` spegne in silenzio le
      regole che li nominano, oggi `auth-surface-noise`. E una nota su
      `backup-probe`, che intercetta anche gli archivi legittimi.
- [x] **Non era un difetto:** `getRulesSource()` senza `try/catch` è **corretto**.
      Il chiamante (rotta `/rules/source` di `adminSentinel`) lo cattura e
      risponde 500 con il messaggio; restituire `[]` nasconderebbe un file di
      regole rotto dietro un form vuoto, che poi ci si scrive sopra.
- [x] **+29 test.** `sentinelLog.test.js` e `rulesHotReload.test.js` (nuovi;
      `SentinelLog` non aveva test propri), più `rulesFileEditor.test.js` e
      `ruleValidator.test.js`. Suite completa verde.

#### ~~Da decidere~~ ✅ CHIUSE — quattro scelte, tutte applicate

- [x] **D1. La foglia `status` produce regole che non scattano mai.**
      → **Risolta con (a).** Avviso del validatore («questa condizione non
      scatta mai») e tracer allineato al runtime. La correzione vera era nel
      tester: `testRequest` scriveva `spec.status` sul soggetto, costruendo un
      soggetto che a runtime non esiste — ed è per questo che la foglia sembrava
      funzionare proprio nello strumento che si usa per verificarla prima di
      andare in produzione. Lo stato richiesto resta nell'eco del soggetto, ma
      non entra nella valutazione. **Il test di conformità fra i due valutatori
      lo confermava per la ragione sbagliata**: il suo `subjectFor` scriveva a
      sua volta lo status, quindi i due valutatori concordavano su una
      situazione impossibile. Ora non lo scrive più, e la conformità vale.
      La (c) — valutazione post-risposta vera — resta una voce di roadmap.
      *(verificato eseguendo)* `ruleMatcher.js` mette `status: null` nel soggetto
      con il commento «valorizzato solo nella valutazione post-risposta», e
      quella valutazione **non esiste**: `observeOutcome` aggrega e basta.
      L'unico posto che scrive `subject.status` è il tracer. Quindi:
      `match: { status: [404] }` **si valida**, il tester **conferma che
      scatterebbe**, e in produzione è morta. `README.it.md` la documenta come
      «solo nella valutazione dell'esito».
      Tre uscite, in ordine di costo: **(a)** warning del validatore + nota nel
      tracer, un'ora; **(b)** rimuovere la foglia (errore di validazione +
      migrazione per chi l'avesse scritta); **(c)** implementare la valutazione
      post-risposta, che è una funzionalità e non una correzione.
- [x] **D2. `distinctPaths` e `pathCount` diventano contatori di richieste dopo
      il tetto del campione.**
      → **Risolta con (b), in una forma più economica di quella proposta.** Il
      consiglio diceva «numeri, non stringhe: costa poco» — affermazione
      sbagliata così com'era scritta, perché il costo si moltiplica per il
      numero di client tracciati (5000) e non per uno. La forma applicata tiene
      il conto: due strutture separate, `paths` (stringhe, solo per il campione
      da MOSTRARE, ridotto a quanto se ne salva davvero: 16 e 32, non 64 e 256)
      e `pathKeys` (impronte FNV-1a a 32 bit, solo per CONTARE, tetto
      `MAX_PATH_KEYS = 1024`). La memoria per client resta nello stesso ordine
      di prima e il conteggio esatto arriva quattro volte più lontano. Al tetto
      si ferma e lo **dichiara** (`distinctPathsSaturated` / `pathCountSaturated`,
      scritti solo quando veri), fino alla tabella del twin che mostra `1024+`. *(verificato eseguendo)* Saturato il campione
      (256 per l'aggregato degli esiti, 64 per il censimento), ogni richiesta a
      un percorso fuori dal campione incrementa il contatore — **anche la
      stessa, ripetuta**. Misurato: 257 percorsi distinti + 5000 ripetizioni di
      uno solo → `distinctPaths: 5256`. Il numero è mostrato tal quale nella
      tabella «sospetti scanner» del twin, cioè nella vista su cui si decide se
      scrivere una regola. Stessa famiglia di C8, che non era arrivato qui.
      **(a)** contare solo ciò che entra nel campione — onesto, ma un vero
      scanner con 500 percorsi ne mostra 256, e il campo perde proprio la coda
      che lo rende utile; **(b)** insieme separato di hash dei percorsi, tetto
      molto più alto (numeri, non stringhe) e un campo che dichiara la
      saturazione — richiede un nome nuovo e tocca il formato del file;
      **(c)** lasciare il conteggio e rinominare il campo in ciò che davvero
      misura — costa una migrazione e non recupera il segnale.
- [x] **D3. `authenticatedTraffic.mode: "exempt"` è documentato e non
      implementato.**
      → **Risolta con (a).** Una condizione sola, in `evaluate`: con `exempt` su
      traffico autenticato non si cerca la regola, e tutto il resto del percorso
      gestiva già `rule === null`. Restano attivi coerenza di sessione, canary e
      censimento — i tre sensori che non nominano l'utente e che esentare
      sarebbe controproducente (motivazione per esteso nel config e nel README). *(verificato eseguendo)* `pluginConfig.default.json5`
      promette «le regole non si applicano affatto agli autenticati»;
      `shouldEnforce` controlla solo `!== 'enforce'`, quindi `exempt` e
      `monitor` sono identici. La differenza è reale: con `exempt` le regole
      continuano a matchare, a scrivere nel log, a incrementare i contatori e —
      per le regole `monitor` — ad alimentare `rateLimiter`. Chi lo imposta
      credendo di aver escluso gli autenticati sta ancora registrando persone
      identificate (vedi §*Privacy* del README).
      **(a)** implementarlo davvero: uscita anticipata prima della valutazione
      per il traffico autenticato; **(b)** togliere il valore dalla
      documentazione e lasciare due modalità.
- [x] **D4. `shell-probe` matcha nomi di file legittimi, e la procedura di
      promozione non può accorgersene.**
      → **Risolta con (b)**, più la migrazione **v5→v6**: il pattern richiede ora
      un'estensione eseguibile (`php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl`).
      È il primo step di migrazione che **modifica** una regola invece di
      aggiungerla, e da lì il vincolo che lo governa: se il pattern in vigore non
      è esattamente quello distribuito, non tocca niente e avvisa. Una migrazione
      che sovrascrive la scelta di un amministratore fa perdere fiducia in tutte
      quelle successive. *(verificato eseguendo)* La regola
      distribuita cerca `/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\.`:
      `/js/shell.js` e `/assets/cmd.css` matchano. Il punto non è il rumore, è
      che il semaforo documentato — «se `authenticatedHits` è zero dopo
      settimane, promuovi tranquillamente» — **non può coglierlo**, perché un
      asset chiesto da visitatori anonimi lascia quel contatore a zero. La regola
      sembra sicura da promuovere proprio mentre non lo è.
      **(a)** togliere i due termini generici `shell` e `cmd`; **(b)** richiedere
      un'estensione eseguibile (`\.(php|asp|aspx|jsp|cgi|pl)$`), che restringe
      molto ma è coerente con «ital8cms non esegue PHP»; **(c)** lasciarla e
      avvertire nella `description`. Tocca il file delle regole distribuito →
      migrazione per le installazioni esistenti (come per gli step v1→v2 e
      v2→v3).

---

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
- [x] `drop` — chiude la connessione senza risposta (stile nginx 444).
      Rinuncia all'indistinguibilità del 404 in cambio di un costo maggiore per
      chi bussa. **Degrada al blocco con `trustProxy: true`**: dietro un proxy il
      socket troncato è quello verso il proxy, che risponderebbe 502.
- [x] `decoy` — contenuto fittizio (vedi §4)
- [x] `redirect` — 30x, **permanenti vietati** verso l'esterno + allowlist di destinazioni
- [x] `tarpit` — risposta a goccia, con cap di connessioni simultanee e timeout massimo.
      Tre limiti, tutti necessari: tetto di connessioni (oltre il quale si
      **degrada** e non si accoda), durata massima non superabile dalla regola,
      e rilascio immediato alla chiusura del client. `abortAll()` allo
      spegnimento, o `gracefulShutdown` aspetterebbe il tarpit più lungo.
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
- [x] **Livello 2 — Canary / honeytoken.** Il segnaposto `{{canary}}` conia un
      token che esiste **solo** in quella risposta e ne registra il destinatario;
      la foglia `canary` (`true` / `"known"` / `"unknown"`) lo riconosce quando
      torna indietro. Se qualcuno lo usa hai la **certezza** di un attaccante
      attivo → ban immediato con `escalate: { ban: true }`.
      - Il confronto fra chi ha ricevuto il token e chi lo usa (`sameClient`) dice
        se scansione e sfruttamento sono la stessa macchina.
      - La segnalazione (log + allerta) parte anche **senza** regola trappola e
        anche in osservazione: l'unico segnale certo del plugin non deve dipendere
        da una riga in un file modificabile dalla GUI.
      - ⚠ **Vincolo:** un token va solo dove serve un gesto deliberato per
        richiederlo (testo, `<a href>`). Mai in `src` o `<link rel>`: il browser li
        scarica da solo e la trappola scatterebbe su chi riceve il decoy. Presidiato
        da un test sui file distribuiti.
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
- [x] Se `censusIpMode: "full"`, il censimento diventa un archivio di dati
      personali a lunga conservazione → **serve una retention anche per il
      censimento**, non solo per il log eventi.
      `census.ipRetentionDays` (default 30). Il TTL della voce si conta
      dall'ULTIMO uso, quindi un'impronta sempre attiva non scadeva mai e il suo
      elenco di indirizzi restava per sempre. Scadono **gli indirizzi, non il
      conteggio**: `ipCount` è una statistica (il segnale botnet), non un dato
      personale.
- [x] Firma mai vista prima + alta cadenza = sospetto → livello `burst` della
      foglia `reputation`
- [x] Reputazione locale: firma con quota di blocchi elevata → livelli `suspect`
      e `bad` della foglia `reputation`, usabili in una regola come qualsiasi
      altra condizione (anche con `escalate`).

### Enforcement per firma

- [x] Regole che matchano su `fp` esatto
- [x] Regole che matchano su `fpClass` / componenti (l'equivalente utile del
      concetto di "range": gli hash non hanno intervalli, le **classi** sì)
- [x] Scenario "sito riservato a un solo ecosistema" (es. solo Linux):
      filtro d'**audience**, non confine di sicurezza — l'OS dichiarato è
      falsificabile in un secondo. Da usare in `monitor` prima di `enforce`,
      per misurare quanti visitatori reali verrebbero esclusi.
      Non serviva codice: si scrive con `fingerprintClass`. Documentato come
      esempio commentato nel file di regole e nel README, con l'avvertenza.

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
- [x] La stessa allerta vale per il tasso di eviction anomalo (§14) e per gli
      eventi gravi (canary scattato): un unico canale di notifica, più soglie.
      Il tasso di sfratto si guarda come **delta** fra due sweep, non come totale
      (il totale cresce e basta, e resterebbe sopra soglia per sempre).

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
- [x] `banClient()` immediato per le regole gravi (es. canary token usato), via
      `escalate: { rateLimiterRule, ban: true, banSeconds }`. **Obbedisce ai tetti
      dell'enforcement**, al contrario del semplice conteggio: un sentinel in
      osservazione che fa bandire gente da rateLimiter non sarebbe un osservatorio.

### Altre interconnessioni possibili (da valutare)

- [x] `mailer`: notifica su evento grave (canary scattato, tasso di sfratto
      anomalo, budget disco). Stesso modello: lazy, opzionale, nessuna dipendenza
      dichiarata. Canale unico in `lib/alertDispatcher.js`, con **finestra di
      silenzio per genere** — senza, la notifica sarebbe il moltiplicatore
      dell'attacco, perché gli eventi che la generano li controlla chi attacca.
- [ ] Fallimenti CSRF ripetuti come segnale di automazione
      (`csrfProtection` enforce nel route-wrap, quindi a valle di sentinel:
      servirebbe un canale dedicato)

---

## 8. Monitoraggio del traffico autenticato

- [x] Osservazione sempre attiva, enforcement disattivato di default
- [x] Coerenza di sessione: **cambio di User-Agent** dentro la stessa sessione
      (segnale fortissimo di sessione rubata, quasi privo di falsi positivi)
      → anomalia `uaChanged`
- [x] Coerenza di sessione: cambio di IP / rete (più falsi positivi: mobile ↔ WiFi)
      → anomalie `ipChanged` e `networkChanged`, **fuori** dalla regola distribuita
      proprio per il rumore: la linea di base non si aggiorna mai, quindi un
      utente mobile resterebbe marcato fino al logout
- [x] UA non-browser su sessione autenticata (`python-requests` con cookie valido)
      → anomalia `scriptClient`. Non è un cambiamento ma uno **stato**: vale anche
      se il client è stato così fin dall'inizio
- [x] Cadenza di richiesta per account (via `rateLimiter` con chiave account)
      → già disponibile senza codice nuovo: `escalate` usa `user:<username>` come
      chiave sul traffico autenticato, quindi basta dichiararlo su una regola con
      `appliesTo: "authenticated"`
- [x] Nota privacy nel README: monitorare account = monitorare persone identificate,
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
- [x] Documentare i limiti noti in cluster: stato in memoria per-worker
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
- [x] **Coerenza di sessione** (primo UA/IP visto per sessione): tetto + TTL.
      Qui la scadenza si conta dall'ULTIMO uso e non dalla creazione, al contrario
      dei token canary: la chiave non è controllata da chi attacca (servirebbero
      altrettanti login validi) e una sessione attiva non deve perdere la propria
      linea di base mentre è in uso
- [x] **Osservazione degli esiti per IP**: tetto + TTL
- [x] Sweep periodico delle strutture scadute (modello: `rateLimiter` `sweepIntervalSeconds`)
- [x] **Registro dei token canary**: tetto + TTL. Ogni risposta con decoy conia un
      token, e la frequenza delle risposte la decide chi bussa: senza tetto,
      martellare un percorso con decoy sarebbe il modo più semplice di esaurire la
      memoria — la trappola diventerebbe il vettore
- [x] Contatore delle eviction esposto nelle statistiche: un tasso di eviction alto
      **è esso stesso il segnale** di un attacco che randomizza le firme
- [x] Allerta sul tasso di sfratto (delta fra due sweep, soglia
      `alerts.evictionsPerSweep`): il sensore diventa una notifica, non solo un
      numero da andare a guardare
- [x] Memoizzazione del fingerprint sul socket: con keep-alive molte richieste
      condividono la connessione e gli header cambiano poco → si evita di
      ricalcolare l'hash decine di volte per pagina *(fatto nel Passo 0)*

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
