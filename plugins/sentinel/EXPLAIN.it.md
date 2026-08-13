<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# sentinel — meccanica interna

Uso e configurazione stanno in [`README.it.md`](./README.it.md). Qui c'è il
*perché* delle scelte non ovvie, cioè quelle che rileggendo il codice fra un anno
sembrerebbero arbitrarie.

---

## 1. Il problema che ha determinato tutta l'architettura

I middleware dei plugin sono montati **dopo il router** (`index.js`, riga ~240).
Per un filtro di perimetro è fatale:

```
POST /api/adminUsers/login   →  il router matcha, l'handler esegue,
                                la catena si ferma lì.
                                Il middleware del plugin non vede nulla.
```

Un filtro che gira dopo il router non è un filtro: è un contatore. E la
superficie che non vedrebbe — `/api/*` — è esattamente quella dove vivono gli
attacchi all'autenticazione.

Ma i plugin vengono caricati **dopo** che i priority middleware sono già montati,
e in Koa non si inserisce un middleware a metà catena a posteriori.

### La soluzione: uno slot che nasce vuoto

Il pattern esisteva già, nel `reservedGate`:

1. `priorityMiddlewares.js` crea e monta il gate — quando i plugin non esistono ancora;
2. `index.js` riga ~201 inietta il pluginSys nel gate;
3. `index.js` riga ~230, **dopo** `pluginSys.initialize()`, gli passa i path riservati.

Il middleware è già al posto giusto mentre il suo contenuto arriva più tardi.
`sentinelGate` fa lo stesso: nasce come pass-through da un `if`, e riceve il
motore dopo il caricamento dei plugin.

Vale la pena notare che il `README.md` legacy di `core/priorityMiddlewares/`
descriveva questo meccanismo — «un elenco dei priority midlware che i vari plugin
potranno richiedere di installare» — anni prima che servisse.

### Posizione nella catena

```
canonical-path gate
  → bodyParser
  → session
  → maintenanceGate      503 uniforme, ha la precedenza su tutto
  → sentinelGate         ← QUI
  → reservedGate         404 mimetico sulla superficie riservata
  → router
  → [middleware dei plugin]   ← dove sentinel NON sta
  → static server
```

| Vincolo | Conseguenza |
|---|---|
| deve vedere `/api/*` | prima del router |
| deve poter esentare/osservare gli utenti loggati | dopo `session` |
| in manutenzione il 503 deve restare uniforme | dopo `maintenanceGate` — se rispondesse 404 mentre il resto dà 503, la differenza sarebbe essa stessa un'informazione |
| deve filtrare le scansioni verso il pannello | prima di `reservedGate` |

Il costo accettato è passare da `bodyParser` anche per le richieste che si
butteranno. In cambio si possono scrivere regole sul body e si ha la sessione.

> **Il default non bloccante non rende superfluo il posizionamento.** Per
> *osservare* `/api/*` bisogna comunque stare prima del router. È l'obiezione che
> verrà in mente a chiunque rilegga il codice: «se non blocca, montiamolo dopo il
> router come analytics». No.

## 2. Ripartizione fra core e plugin

Gli invarianti di sicurezza stanno nel core, l'intelligenza sta nel plugin.

| Responsabilità | Dove | Perché |
|---|---|---|
| il 404 di blocco | **core** | Un solo posto lo produce; un secondo generatore divergerebbe. |
| non decorare i path riservati a superficie chiusa | **core** | È un invariante del reserved gate, non deve dipendere dalla correttezza di un plugin. |
| esenzione `/.well-known/` | **core** | Un errore del plugin non deve poter far scadere il certificato TLS. |
| tetto di enforcement | **core** | Il kill switch deve funzionare anche con un motore impazzito. |
| matching, log, fingerprint, decoy | **plugin** | È il suo dominio. |

Il risultato: un motore sbagliato può al più **non filtrare**. Non può rendere
enumerabile il pannello, non può far cadere l'HTTPS, non può disattivare il kill
switch.

## 3. Perché `verdict.enforce` è una proposta e non un ordine

Il motore restituisce `enforce: true/false` avendo già applicato il tetto della
configurazione (`custom.mode` + `action` della regola). Il gate applica poi il
**proprio** stato come secondo tetto.

Due tetti indipendenti, entrambi in grado di fermare da soli, **nessuno dei due in
grado di forzare** contro l'altro:

| `custom.mode` | stato gate | risultato |
|---|---|---|
| `monitor` | `running` | non agisce |
| `enforce` | `monitor` | non agisce |
| `enforce` | `running` | agisce |
| `enforce` | `stopped` | motore mai interrogato |

Non è ridondanza: uno vive nei file (sopravvive al riavvio, si versiona), l'altro
è a runtime (si commuta in dieci secondi via SSH senza toccare nulla). Servono
momenti diversi.

## 4. Il 404: perché delegare invece di produrre

`reservedGate.deny()` produce un 404 in **due forme diverse** a seconda del path:

- sotto `/api/*` → `text/plain`, corpo `"Not Found"` (9 byte), come farebbe Koa;
- altrove → la pagina HTML di `koa-classic-server` (325 byte) con i suoi 6 header
  di sicurezza.

C'è un test che confronta quella risposta **byte per byte** con un 404 autentico,
perché una risposta «quasi uguale» renderebbe la superficie enumerabile.
Fabbricando un secondo 404 dentro sentinel si sarebbe creata una copia destinata
a divergere alla prima modifica di `koa-classic-server`.

Il commento in testa a quella sezione di `runtimeGate.js` lo dice già: i punti di
enforcement devono rispondere in modo *identico*, e un solo posto che produce il
404 è l'unico modo di garantirlo.

### `Set-Cookie`: la differenza che c'era, e dove stava davvero

Per un periodo il blocco è stato riconoscibile con **una sola richiesta**, e non
dal corpo — quello era byte-identico — ma contando gli header: un 404 autentico
rispondeva con **2** `Set-Cookie`, il 404 di sentinel con **0**.

La prima diagnosi è stata sbagliata, e vale la pena tenerne traccia. Sembrava una
proprietà del *reserved gate* — stessa struttura, stesso ritorno anticipato — da
sistemare «per entrambi i gate o per nessuno». Misurandola, il confine si è
rivelato un altro: non passa fra i due gate, passa fra **chi risponde prima e chi
risponde dopo la catena dei middleware dei plugin**. La causa era il middleware
di `csrfProtection`, il cui corpo intero era `if (ctx.session) ensureToken(ctx)`:
girando dopo il router toccava la sessione di ogni richiesta che arrivasse fin lì
— asset, crawler, 404 — mentre un gate pre-router non ci passa mai.

Il rimedio non poteva stare qui. Perché sentinel emettesse lo stesso `Set-Cookie`
avrebbe dovuto **creare una sessione per ogni scanner bloccato**: firmare un
cookie per traffico ostile, in contraddizione con la scelta già presa altrove in
questo plugin (vedi `sessionCoherence.js`) di non mandare cookie a chi non ne ha.
È stato corretto all'origine: il middleware, ridondante rispetto all'hook `head`
e agli helper `csrfField()`/`csrfToken()`, è stato rimosso, e l'hook non conia più
per gli anonimi. Nessun gate è stato toccato.

Esito misurato: 404 vero e 404 di blocco rispondono entrambi **0** `Set-Cookie`,
con e senza cookie di sessione del client. In più i **decoy** — che non passavano
di lì e quindi rispondevano 0 mentre una pagina vera rispondeva 2 — hanno ora la
stessa forma di una pagina vera.

`set-cookie` è stato tolto dai volatili del test byte-per-byte, dove la sua
presenza rendeva il test cieco proprio al canale che aveva rivelato il filtro, e
c'è un test dedicato sulla parità del conteggio. Verificato che fallisce se il
middleware torna.

## 4-bis. Le risposte che il plugin produce da sé

`block` delega, perché deve essere indistinguibile. `decoy` e `redirect` no: il
loro corpo esiste solo qui. Il verdetto porta con sé una funzione `respond`, e il
gate la chiama **soltanto** dopo aver verificato tre cose in quest'ordine —
l'enforcement è davvero in vigore, la risposta non tradirebbe la superficie
riservata chiusa, `respond` esiste. Se una qualsiasi manca, 404.

L'ultima delle tre vale come regola generale, e ha già pagato due volte: fra il
Passo 4 e il Passo 7 `tarpit` era scrivibile nel file di regole pur non essendo
implementata — matchava, veniva contata e registrata, e produceva un 404. Si
poteva osservare per settimane, e il giorno in cui l'azione è arrivata è cambiato
solo l'effetto, non la configurazione né la storia della regola. Vale per
qualunque azione futura.

### Perché il renderer sta fuori dal percorso di rendering

I decoy non passano da EJS né dai partial del tema, per due ragioni indipendenti
che porterebbero alla stessa scelta anche prese una alla volta: non si espone il
motore di template a un percorso raggiungibile da traffico ostile, e il markup
del tema renderebbe il decoy riconoscibile a colpo d'occhio — un finto WordPress
con l'header del tuo sito non inganna nessuno.

### La cosa che è facile sbagliare due volte

**Primo errore: spiegare il decoy dentro il decoy.** Un commento HTML che dice
«questo file è finto» viene servito insieme al resto. Chi lo legge non solo non è
stato ingannato: ha appena scoperto che c'è un filtro, che è più di quanto gli
avrebbe detto un 404. È successo davvero durante lo sviluppo, ed è stato un test
a scoprirlo — ora `decoyRenderer.test.js` cerca le parole rivelatrici in ogni
file distribuito, e le spiegazioni stanno in `decoys/default/README.md`.

**Secondo errore: riflettere senza escapare.** `{{path}}` e `{{ip}}` inseriscono
nel corpo stringhe scelte da chi ha fatto la richiesta. In un decoy HTML è una
XSS riflessa in piena regola, e il bersaglio non è l'attaccante — che si
autoinfetterebbe — ma chiunque riceva da lui un link a quell'URL. L'escaping
dipende dal tipo di contenuto: in un finto `.env` sarebbe rumore visibile che
tradisce la trappola, e non c'è nessun parser di markup a valle.

### Perché il validatore è severo sugli header di un decoy

Una regola può dichiarare header per credibilità, ma non tutti. `Content-Length`
e `Transfer-Encoding` non descrivono il contenuto: descrivono **come il corpo è
inquadrato sul filo**, e un valore sbagliato produce una risposta di cui il
client non sa dove finisca — nel migliore dei casi la connessione si pianta, nel
peggiore il messaggio successivo sulla stessa connessione viene interpretato male.
`Set-Cookie` è escluso perché farebbe scrivere a un contenuto fittizio nello
stesso spazio dove vivono il cookie di sessione e quello CSRF.

CR e LF nei valori sono rifiutati **al caricamento** e non lasciati a Node, che
pure solleverebbe un'eccezione: con `strictValidation: false` diventerebbero un
500 a ogni richiesta che matcha, scoperto dal traffico invece che dall'avvio.

## 4-ter. Il canary: perché è l'unico segnale su cui si può bandire

Il resto del plugin produce **inferenze**. L'UA incoerente è un fortissimo
indizio, non una prova: esiste il proxy aziendale che riscrive gli header,
esiste il client esotico. Le sonde `.php` sono quasi sempre ostili — quasi. È il
motivo per cui l'intera architettura è costruita attorno all'osservare prima e
promuovere poi.

Il canary rompe questa simmetria. Il token esiste in un solo posto: dentro il
corpo di un decoy consegnato a un cliente preciso in un istante preciso. Non è
indicizzato, non è linkato, non è indovinabile (22 caratteri base36 da
`crypto.randomBytes`, ~113 bit). Non esiste la richiesta accidentale. Perciò
`escalate: { ban: true }` — che altrove sarebbe una pessima idea — qui è la
risposta proporzionata, e infatti è l'unico posto del file di regole distribuito
dove viene suggerito.

### Il campo che vale più del token: `sameClient`

Il registro ricorda **a chi** il token era stato consegnato. Quando torna
indietro, il confronto dice qualcosa che nessun altro dato del plugin può dire:

| Confronto | Lettura |
|---|---|
| Stesso IP o stessa impronta | Uno scanner che segue i link che trova. Automazione ordinaria |
| Client **diverso** | Il contenuto del decoy è passato di mano: chi scandaglia e chi sfrutta sono due macchine, il che descrive un'operazione più strutturata di un bot che gira da solo |

Per questo `sameClient` è un campo a sé nella dashboard e non una nota nel testo.

### Tre decisioni che sembrano dettagli e non lo sono

**Il token non si consuma, e non si rinfresca.** Non si consuma perché un attaccante
che lo usa dieci volte deve inciampare dieci volte: l'insistenza è essa stessa un
segnale, e un token monouso la trasformerebbe in silenzio dopo la prima
richiesta. Non si rinfresca perché la vita si conta dalla *consegna*: se
verificarlo ne allungasse la scadenza, basterebbe usarlo a intervalli regolari
per tenerlo vivo per sempre — cioè lasciare all'attaccante il controllo di quanta
memoria gli dedichiamo.

**`unknown` non è «non è un canary».** Un token può non essere in registro per
riavvio, scadenza o perché coniato da un altro worker. In tutti e tre i casi
resta un token: nessun visitatore reale invia per caso una stringa di quella
forma. Da qui il prefisso riconoscibile e i tre valori della foglia (`true`,
`known`, `unknown`) invece di un booleano — sono gradi di certezza diversi, e la
regola sceglie quale le basta.

**La segnalazione non passa dalle regole.** `recordCanaryTrigger` sta **fuori**
dal `if (rule)`: il caso in cui nessuna regola matcha è quello in cui la
segnalazione serve di più, perché significa che la regola trappola è stata
cancellata, rinominata, o messa dopo una `allow` che la scavalca. Legare l'unico
segnale certo del plugin alla presenza di una riga in un file modificabile dalla
GUI sarebbe fragile esattamente dove non ce lo si può permettere.

### Il vincolo di scrittura dei decoy con canary

Un token va solo dove serve un **gesto deliberato** per richiederlo: testo, o un
`<a href>` da cliccare. Mai in un `src` o in un `<link rel="stylesheet">`.

Quelli il browser li scarica **da solo**: la trappola scatterebbe su chiunque
apra la pagina, e con `ban: true` il decoy diventerebbe un modo di bandire chi lo
riceve — la trappola rivolta contro di sé. Un test in `decoyRenderer.test.js`
scandisce i file distribuiti e fallisce se un `{{canary}}` compare su una riga con
`src=` o `<link`.

## 4-quater. Le allerte: il problema non è mandarle

Un `mailer.send()` dentro il percorso di un evento sarebbe il moltiplicatore
dell'attacco. Gli eventi che generano allerte li **controlla chi attacca**: un
canary lo può richiedere in ciclo, la crescita del log la detta lui. Diecimila
email saturano la casella, il provider SMTP inizia a rifiutare, e l'allerta che
conta arriva mescolata a novemilanovecento copie di sé stessa.

`alertDispatcher.js` ha quindi due regole:

1. **Finestra di silenzio per genere** (default 60 minuti). Le occorrenze
   successive vengono **contate** e riportate nel messaggio dopo. «Canary
   scattato 412 volte nell'ultima ora» descrive l'attacco meglio di 412 email
   identiche.
2. **Il log non è mai soppresso.** La finestra vale solo per la posta. Un'allerta
   che esiste solo se la posta funziona manca proprio quando serve — e la posta è
   la prima cosa che smette di funzionare quando la macchina è sotto pressione.

L'invio è deliberatamente **senza `await`**: chi chiama sta servendo una
richiesta, e l'attesa della coda SMTP non deve entrare nel suo tempo di risposta.
`mailer` ha una coda persistente propria, quindi il messaggio non si perde; la
promise viene comunque intercettata, altrimenti un rifiuto diventerebbe un
unhandled rejection e la rete di sicurezza di processo chiuderebbe il server.

### Il tasso di sfratto come sensore

`checkEvictionRate()` guarda il **delta** fra due passaggi di sweep, non il
totale — il totale cresce e basta, e dopo un episodio resterebbe sopra soglia per
sempre.

Il tetto del censimento esiste perché la chiave è l'impronta, che l'attaccante
controlla. Ma in esercizio normale quel tetto non si tocca mai: il traffico vero
converge su poche decine di impronte e gli sfratti restano a zero per settimane.
Un tasso improvviso non è capacità da alzare, è la firma di chi ha capito come
funziona il censimento e sta provando a gonfiarlo. La contromisura, **misurata**,
diventa un rilevatore.

## 4-quinquies. La sessione: due trappole nell'implementazione

Il concetto è semplice — si ricorda com'era la sessione all'inizio e si confronta
— ma due dettagli hanno fatto la differenza fra un modulo che funziona e uno che
sembra funzionare.

### `toJSON()` di koa-session scarta le chiavi che iniziano con `_`

La prima versione riponeva l'identificativo in `session._sentinelSid`, seguendo
la convenzione dell'underscore per i campi interni. `Session.toJSON()` di
koa-session salta ogni chiave che comincia per underscore («skip private
stuff»): quel campo non è mai finito nel cookie.

Conseguenza: a ogni richiesta se ne coniava uno nuovo, **ogni richiesta era la
prima della sua sessione**, e nessuna anomalia poteva essere rilevata. Nessun
errore, nessun log, tutti i test verdi — il modulo girava e non diceva mai
niente. È stato colto solo facendo un login vero e guardando gli eventi.

Il secondo vincolo sul nome è arrivato dopo il primo: la sessione viaggia in un
cookie **firmato ma non cifrato**, quindi il client può decodificarne il
contenuto. Una chiave `sentinelSid` annuncerebbe l'esistenza del filtro a
chiunque guardi i propri cookie — la stessa informazione che il 404 di copertura
esiste per negare. Da qui `sid`, che è quello che scriverebbe un framework
qualsiasi.

Entrambi i vincoli hanno ora un test che li presidia, e nessuno dei due si vede
provando il modulo isolatamente.

### Perché non si riusa `_expire`

Sembra l'identificativo naturale: c'è già, è per sessione, e con
`rolling: false` non cambia. Ma viene **riscritto a ogni salvataggio** della
sessione, e la sessione si salva ogni volta che qualcosa la modifica — per
esempio la rotazione del token CSRF al login. Un attaccante che sapesse questo
avrebbe un modo per **azzerare la propria linea di base a comando**: basta
provocare una scrittura di sessione. Un identificativo coniato una volta e mai
più toccato non ha quel problema.

## 4-sexies. Il merge additivo non porta le regole nuove

`reconcileSchemaVersions` riconcilia anche le coppie **secondarie** di un plugin,
quindi vede `sentinelRules.default.json5`. Ma tratta gli array come valori: e
`rules` è un array.

Vuol dire che una regola nuova distribuita col plugin **non raggiunge mai
un'installazione esistente**. È lo stesso difetto di `menuOrder` in v2.72.0, ed è
il motivo per cui questo plugin ha una cartella `migrations/`.

Due dettagli di quegli step meritano di essere letti prima di scriverne altri:

- **L'inserimento è testuale.** `setJson5Key(path, 'rules', nuovoArray)`
  riscriverebbe l'intero array da una serializzazione, cancellando cornici di
  sezione e descrizioni: in questo file i commenti sono metà del valore. Si
  lavora sul testo con verifica differenziale, come in `lib/rulesFileEditor.js`.
- **La posizione conta più di quanto sembri.** Accodare non dà errore, ma con
  first-match-wins una regola in fondo arriva dopo `backup-probe`, che matcha
  `.tar.gz` — e uno dei decoy distribuiti consegna il token proprio dentro un
  finto `backup-….tar.gz`. Questo difetto era presente nel file distribuito dal
  Passo 5 ed è stato corretto qui: canary e sessione stanno subito dopo la
  whitelist.

Gli script di migrazione **non fanno `require` del codice del plugin**, nemmeno
di `lib/rulesFileEditor.js` che fa una cosa simile: girano su installazioni
vecchie e devono comportarsi identici fra due anni. Una rifattorizzazione futura
di quel modulo cambierebbe il comportamento di una migrazione già collaudata. La
duplicazione è deliberata.

## 4-septies. `respond` può rinunciare, e non è un errore

Fino al Passo 6 il contratto del gate era binario: `respond` scrive la risposta,
oppure lancia e si ripiega sul 404. `drop` e `tarpit` hanno introdotto un terzo
caso che non è né l'uno né l'altro — **condizioni operative previste** in cui
l'azione semplicemente non si può applicare:

- il tarpit ha il tetto delle connessioni pieno;
- il `drop` gira dietro un proxy dichiarato.

Trattarle come eccezioni avrebbe riempito i log di «risposta del motore fallita»
per un funzionamento del tutto normale — e sotto carico, cioè proprio quando il
tetto si riempie, quel rumore avrebbe coperto gli errori veri. Quindi `respond`
può restituire `false`: il gate scrive il suo 404 e non commenta.

L'invariante che rende sicura la rinuncia: **chi rinuncia deve lasciare il
contesto intatto.** Il tarpit tocca `ctx.respond` solo dopo aver verificato di
avere posto; il drop controlla il proxy prima di distruggere il socket. Se una
delle due scrivesse prima di rinunciare, il 404 del gate finirebbe su una
risposta già iniziata.

## 4-octies. Il tarpit è la terza volta che la difesa può diventare il vettore

Le prime due sono il censimento delle impronte e il registro dei canary: chiavi
controllate da chi attacca, risolte con `BoundedStore`. Il tarpit è la stessa
forma di problema in una veste diversa — qui non è la memoria a crescere ma i
**socket e i descrittori di file**, che sono una risorsa molto più scarsa.

La differenza pratica è che un tarpit senza tetto non «rallenta»: fa cadere il
sito, e lo fa con la connessione che l'attaccante apre e abbandona. Da qui i tre
limiti, e in particolare i due meno ovvi:

**Superato il tetto si degrada, non si accoda.** Accodare sposterebbe il consumo
di risorse invece di fermarlo: la richiesta in eccesso resterebbe comunque
appesa, solo in una struttura diversa. Verificato dal vivo con
`maxConcurrent: 2`: due connessioni trattenute 20 secondi, la terza chiusa con un
404 in **12 millisecondi**.

**Il posto si libera alla chiusura del client, non alla scadenza.** Uno scanner
con un timeout aggressivo stacca dopo pochi secondi. Se il posto restasse
occupato fino alla scadenza dichiarata, il tetto si riempirebbe di connessioni
che non esistono più — e saturarlo costerebbe all'attaccante quanto aprire e
chiudere in fretta, cioè niente.

### Lo spegnimento

`gracefulShutdown` aspetta che le connessioni finiscano. Con dei tarpit attivi
aspetterebbe la loro scadenza: un riavvio da trenta secondi causato dalla propria
difesa. `abortAll()` è chiamata in testa a `persistAll()`, prima ancora dei
salvataggi. Misurato: con un tarpit da 20 secondi in corso, il processo esce in
**1,7 secondi**.

### Perché `drop` non è «meglio» di `block`

Il 404 di `block` è indistinguibile da un URL mai esistito, ed è la qualità che
tutto il resto del plugin protegge (il test byte-per-byte, il reserved gate, la
regola sulle risposte decorate). `drop` **rinuncia** a quella qualità: una
connessione azzerata si nota, e dice che quel percorso è trattato diversamente
dagli altri. In cambio costa quasi nulla a noi e un timeout intero a chi bussa.

Sono due strumenti, e il default resta `block`. Per la stessa ragione `drop` è
soggetto al controllo `decorationWouldLeak`: sulla superficie riservata chiusa,
un percorso che tronca invece di rispondere 404 si è appena distinto dagli altri.

## 4-novies. La reputazione, e i due modi in cui si sbaglia

### Il primo: condannare una folla credendo di condannare una persona

Un'impronta HTTP è a **bassa entropia**: identifica «Chrome 120 su Linux», non
Mario. Tutta la documentazione del fingerprint lo dice già, ma finché il
fingerprint serviva a *descrivere* il traffico la cosa non aveva conseguenze.
Nel momento in cui serve a **condannare**, ne ha una enorme: bloccare
un'impronta da browser vero significa bloccare tutti quelli che usano quel
browser.

Da qui una protezione che non è un'opzione fra le altre ma la condizione perché
la funzione possa esistere: un'impronta `coherent: true` con
`headerProfile: 'browser'` **non riceve mai** un giudizio negativo, per quanto
sporca sia la sua storia. Si può disattivare, ma bisogna volerlo.

Il costo è dichiarato: chi emula Chrome alla perfezione è immune. È il costo
giusto — la reputazione è una vittoria facile contro lo scanner pigro, non uno
strumento a cui affidare la difesa da un avversario capace.

### Il secondo: il giudizio che si alimenta da solo

Se la quota di blocchi determina il giudizio e il giudizio produce blocchi, il
primo inciampo condanna per sempre. La difesa ovvia — escludere dal conteggio i
blocchi decisi da una regola di reputazione — l'ho scritta subito, con la
marcatura `usesReputation` fatta dal validatore.

**Non bastava, e si è visto solo dal vivo.** Mentre il giudizio è in vigore la
sua regola scatta *per prima*, quindi nessun'altra regola produce più blocchi: il
numeratore si ferma e il denominatore no. Nella prova su server reale la quota è
scesa da 0,73 a 0,33 nell'arco di trenta richieste, e l'impronta è stata
**perdonata proprio perché la stavamo bloccando** — per poi essere ricondannata
appena avesse ricominciato a sondare. Un'oscillazione perfettamente silenziosa.

La correzione è simmetrica: se una richiesta decisa dalla reputazione non conta
come blocco, non deve contare nemmeno come richiesta. Il censimento tiene due
contatori — `count`, tutte le richieste, e `judgedCount`, quelle giudicate **nel
merito** — e la reputazione usa il secondo come denominatore. Verificato:
26→66 richieste, `judgedCount` fermo a 20, quota stabile a 0,95.

È il tipo di difetto che un unit test sulla singola classificazione non può
vedere, perché non riguarda una classificazione ma la loro **successione**.

### La retention degli indirizzi, e cosa scade davvero

Con `censusIpMode: "full"` gli indirizzi finiscono su disco. Il TTL della voce si
conta però dall'**ultimo uso**: un'impronta sempre attiva non scade mai, e il suo
elenco di indirizzi resterebbe lì per sempre — un archivio di dati personali
senza scadenza, che è esattamente ciò che il TODO segnalava.

`ipRetentionDays` fa scadere **gli indirizzi, non il conteggio**. `ipCount`
(«questa impronta arriva da 500 origini», il segnale botnet) è una statistica, non
un dato personale, e non ha ragione di sparire con loro. La distinzione vale la
pena di essere ricordata: la retention si applica agli identificatori, non a ciò
che si è imparato da essi.

Gira solo con `full`, perché è l'unico caso in cui c'è qualcosa da conservare:
con `count` l'insieme vive in memoria per non ricontare due volte lo stesso
indirizzo, e farlo scadere gonfierebbe il conteggio dei distinti senza alcun
beneficio.

## 5. Il fingerprint: la scelta che sembra un errore

**Lo User-Agent non entra nel calcolo dell'impronta.** Rileggendo
`requestFingerprint.js` sembra una dimenticanza: l'UA è il dato più
caratterizzante che una richiesta porti con sé.

È invece il punto centrale. Se l'UA facesse parte della firma, le due cose
varierebbero insieme e sarebbero inconfrontabili. Tenendole indipendenti:

```
UA dichiara Chrome  +  firma da client script  →  uno dei due mente
```

E sappiamo quale: l'UA è l'unico dei due che si cambia con un flag. Il test
`cambiare SOLO lo User-Agent non cambia l'impronta` presidia questa proprietà.

### L'impronta è di una richiesta, non di un client

Il nome inganna, e l'errore che ne discende è costato una funzione intera.
«Impronta» suggerisce l'identità di chi bussa; il valore calcolato è invece la
**forma di una singola richiesta**. Lo stesso browser, sulla stessa connessione,
ne produce quante sono le cose che chiede. Misurato con Chromium su una pagina
con un CSS, uno script, un'immagine e una `fetch`:

| Richiesta | `accept` | `sec-fetch-dest` | impronta |
|---|---|---|---|
| navigazione | `text/html,…` | `document` | `bc13ff8a825ba577` |
| foglio di stile | `text/css,*/*;q=0.1` | `style` | `2c96521fe4b2f813` |
| script / `fetch` GET | `*/*` | `script`, `empty` | `14b440b9e2667937` |
| `fetch` POST | `*/*` | `empty` | `e582bd022cc792a6` |

Quattro impronte, un browser, una pagina. Non è rumore da correggere: è ciò che
la firma misura, e la ragione per cui `fingerprintChanged` non può funzionare
come sembra promettere (vedi `TODO.md`).

`buildFingerprint` ha avuto per un periodo una memoizzazione sul socket, scritta
sulla premessa — vera — che un client non cambi libreria HTTP a metà connessione.
La premessa non regge la conclusione, perché ciò che si stava memoizzando non
dipendeva dalla libreria ma dagli header di quella richiesta. Con la cache, sulla
stessa pagina **3 richieste su 7 ricevevano l'impronta di un'altra**, e una
richiesta di riscaldamento con header da browser rendeva `coherent: true` tutto
il resto della connessione: `ua-fingerprint-mismatch` e `auth-surface-noise` si
aggiravano con una richiesta sola.

La cache è stata rimossa. Il ricalcolo integrale costa ~11 µs su una richiesta
che ne costa ~1000 end-to-end — a 1000 richieste al secondo, l'1% di un core.
Una memoizzazione *corretta* resta possibile: la parte cara è quella derivata
dall'UA (~70% del totale), e avrebbe come chiave l'UA stesso — cioè verificherebbe
invece di assumere. Non si è pagata quella complessità per quel margine.

### Perché solo il livello HTTP

| Livello | Perché non c'è |
|---|---|
| TLS (JA3/JA4) | Node non espone il ClientHello; servirebbe un hook sotto `httpsManager`, e funzionerebbe solo terminando il TLS in proprio (non dietro nginx). |
| TCP/IP (p0f) | Richiede raw socket, fuori dallo userland Node. |
| Attivo JS (canvas, font) | **Strumento sbagliato per questa minaccia:** funziona solo su client che eseguono JavaScript, cioè proprio quelli che il filtro non deve fermare. Ed è la categoria giuridicamente più esposta. |

Il livello HTTP è l'unico che qui produca valore, ed è gratis: `ctx.req.rawHeaders`
conserva l'ordine di arrivo.

### Perché la coerenza è valutata in modo conservativo

`coherent: false` scatta solo su `claimedBrowser !== null && headerProfile ===
'minimal'`. Il profilo `partial` **non** è considerato una menzogna: ci finiscono
browser vecchi, proxy che riscrivono gli header e client legittimi atipici. Un
falso allarme su questo segnale svaluterebbe l'unico segnale davvero affidabile
del plugin.

## 6. La querystring viene confrontata due volte

`matchQuery` prova la forma grezza e, se non matcha, quella decodificata.

Il motivo è emerso scrivendo i test: nella querystring uno spazio arriva come `+`
o `%20`, quindi un pattern scritto in modo naturale — `union\s+select` — **non
matcherebbe mai** `union+select`, che è esattamente la forma in cui i tentativi
si presentano. Chiedere a chi scrive le regole di prevedere ogni codifica
significa garantire regole che sembrano giuste e non scattano mai.

Qui è sicuro perché non si instrada nulla, si osserva soltanto: non esiste la
classe di bug «decido sul decodificato, agisco sul grezzo».

## 7. ReDoS: tre difese, tutte necessarie

Le regex arrivano dall'utente e vengono applicate a stringhe controllate
dall'attaccante. Un pattern con backtracking catastrofico — `(a+)+` — contro un
input costruito ad arte blocca l'event loop, cioè **l'intero sito**, con una
singola richiesta. Node non offre timeout sulle regex.

1. **Rifiuto al caricamento** dei pattern con quantificatori annidati
   (`ruleValidator.hasNestedQuantifier`). Euristica grossolana e volutamente
   pessimista: rifiuta anche qualche pattern innocuo, ma un falso rifiuto costa
   una riscrittura mentre un falso permesso costa il sito.
2. **Troncamento degli input** a 512 caratteri prima del test.
3. **Tetto di tempo** di 250 ms sulla valutazione complessiva, nel gate: scaduto,
   si lascia passare.

## 8. Fail-open ovunque

| Situazione | Comportamento |
|---|---|
| `sentinelRules.json5` illeggibile | nessuna regola, sito raggiungibile, errore loggato |
| una regola invalida | scartata, le altre restano |
| il motore lancia | pass-through, errore loggato **una volta sola** |
| il motore si impianta | pass-through dopo 250 ms |
| errore di I/O sul log | scrittura saltata, segnalata una volta |
| state file corrotto | `sentinel: 'running'` |

La ragione è una sola, ripetuta: la probabilità di scrivere una regola sbagliata
è molto maggiore di quella di subire un attacco nei minuti in cui la si corregge.
Un filtro che fallisce fail-closed trasforma una virgola fuori posto in un
blackout.

Il **latch log-once** non è cosmesi: il motore gira su ogni richiesta, e senza
latch un filesystem in sola lettura riempirebbe il journal — trasformando un
guasto in un secondo guasto.

## 9. Gli aggregati sono un vettore di attacco contro sé stessi

Tutte le chiavi degli archivi sono controllate dall'attaccante:

| Archivio | Chiave | Come la si moltiplica |
|---|---|---|
| censimento impronte | fingerprint | randomizzando l'ordine degli header |
| aggregato esiti | IP | con una botnet |

Senza tetto, una `Map` che cresce con l'attacco esaurisce la memoria: la difesa
diventa il vettore. `BoundedStore` impone tetto, TTL e sfratto LRU, con sweep
periodico — la stessa disciplina che `rateLimiter` applica ai blocchi scaduti.

Dettaglio dell'LRU: l'ordine di inserimento di una `Map` è garantito, ma
riscrivere una chiave **non** la sposta in fondo. Da qui il `delete` +
`set` a ogni accesso in `touch()`: rende la prima chiave iterata sempre la meno
usata di recente, e lo sfratto O(1).

**Il contatore di sfratti è un sensore.** In esercizio normale resta a zero per
settimane, perché il traffico vero converge su poche decine di impronte. Un tasso
di sfratto improvviso significa che qualcuno sta producendo chiavi a raffica: la
contromisura si comporta da rilevatore.

## 10. Il tetto di dimensione del log

`retentionDays` protegge dal log che invecchia, non da quello che **cresce**.
Sotto attacco un file giornaliero può prendere gigabyte in poche ore, e un disco
pieno non rompe sentinel: rompe l'intero sito, con una causa che nessuno
collegherebbe al plugin di sicurezza.

Da qui `maxTotalBytes` con sfratto dal più vecchio, e l'allerta a `alertAtPercent`
che scatta **prima**: avvisare mentre si stanno già cancellando dati è inutile.

L'ultimo file non viene mai eliminato: è quello su cui si sta scrivendo, e
cancellarlo perderebbe gli eventi dell'attacco in corso — cioè proprio quelli per
cui il budget è stato superato.

## 11. Scritture riga per riga, non a blocchi

`SentinelLog.flush()` fa una `appendFileSync` **per evento** invece di un unico
batch. Sembra inefficiente ed è deliberato: su POSIX una `write` in `O_APPEND`
sotto i 4 KB è atomica, quindi due processi che scrivono sullo stesso file non
possono interlacciare una riga. Un batch di dimensione arbitraria perderebbe
quella garanzia proprio nello scenario cluster per cui esiste `instanceId`.

## 12. Perché `allow-loopback` è disattivata di default

In produzione è utile: health check e cron arrivano dalla macchina stessa.

Ma in **sviluppo** tutto il traffico è loopback. Con la regola attiva — e in cima,
dove first-match-wins la rende sovrana — sentinel appena installato non
osserverebbe nulla: si prova qualche URL strano, non compare niente nel log, e si
conclude che il plugin è rotto. Per un plugin il cui unico compito iniziale è
mostrarti il tuo traffico, è il peggior esordio possibile.

Emerso provando il plugin sul server reale, non ragionandoci sopra.

## 13. Mappa dei file

| File | Ruolo |
|---|---|
| `main.js` | ciclo di vita, motore, oggetto condiviso |
| `lib/requestFingerprint.js` | impronta passiva e sua decomposizione |
| `lib/ruleMatcher.js` | soggetto + valutazione delle condizioni |
| `lib/ruleValidator.js` | validazione **e** compilazione (regex precompilate) |
| `lib/ipMatcher.js` | CIDR IPv4/IPv6, con normalizzazione degli IPv4-mapped |
| `lib/boundedStore.js` | mappa con tetto, TTL e sfratto LRU |
| `lib/census.js` | censimento impronte + aggregato esiti |
| `lib/sentinelLog.js` | JSONL, rotazione, retention, tetto di dimensione |
| `lib/ruleHitCounter.js` | contatori per regola (base della promozione) |
| `lib/ruleTracer.js` | valutatore che spiega, usato dal tester |
| `lib/rulesFileEditor.js` | modifica chirurgica dell'`action` preservando i commenti |
| `lib/decoyRenderer.js` | risoluzione, resa e tipo dei contenuti fittizi |
| `lib/canaryRegistry.js` | conio dei token esca, memoria del destinatario, riconoscimento |
| `lib/sessionCoherence.js` | linea di base per sessione autenticata e sue anomalie |
| `lib/tarpit.js` | risposta a goccia, con tetto di connessioni, di durata e abort |
| `lib/reputation.js` | giudizio sulla storia locale di un'impronta |
| `migrations/` | step che portano le regole nuove sulle installazioni esistenti |
| `lib/alertDispatcher.js` | canale unico delle allerte, con finestra di silenzio per genere |

Nel core: `createSentinelGate` in `core/priorityMiddlewares/runtimeGate.js`,
montaggio in `priorityMiddlewares.js`, iniezione del motore in `index.js`,
comandi in `core/cliBridge/{handlers,stateFile}.js` e `bin/ital8cms-cli.js`.

## 14. Una trappola nota per chi svilupperà qui

`ctx.ip` in ascolto dual-stack (la configurazione di default) restituisce
`::ffff:151.38.1.1`, non `151.38.1.1`. Un matcher CIDR che non normalizza fallisce
il confronto con `151.38.0.0/16`, e **una allowlist che non funziona è peggio di
una allowlist assente**. `ipMatcher.normalizeIp` esiste per questo, ed è coperto
dai test.
