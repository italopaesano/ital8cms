<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# adminSentinel — deep-dive

> Guida d'uso: [`README.it.md`](./README.it.md). Service gestito:
> [`sentinel`](../sentinel/README.it.md).

Questo documento risponde a *«perché è fatto così?»* e *«come lo regolo?»*. Le
scelte qui sotto sono quasi tutte conseguenze di **due vincoli** che valgono per
ogni riga del plugin.

---

## I due vincoli

### 1. Il twin legge molto, e legge da un posto che può essere enorme

`sentinel` produce un log JSONL con retention a un anno e un tetto di 200 MB, più
tre archivi aggregati. Il twin è l'unico che li rilegge, e lo fa nello **stesso
processo che serve il sito**: non c'è un worker, non c'è una coda. Ogni scelta di
lettura è quindi anche una scelta sulla latenza del sito.

Da qui: nessuna funzione di questo plugin materializza il log in memoria
(`forEachEventSince` consegna un evento per volta), la lettura cede il controllo
all'event loop, e ciò che si può non ricalcolare non si ricalcola.

### 2. Il twin scrive sullo stesso file che altri tre punti stanno scrivendo

`sentinelRules.json5` è modificabile dall'editor raw, dal form, dal pulsante
«promuovi» della panoramica e da `npm run cli`. Sono quattro strade verso un file
solo, con tempi diversissimi: il pulsante scrive un attimo dopo aver letto,
l'editor raw può tenere il testo in pancia per mezz'ora.

Da qui: la **scrittura vera la fa il service**, il twin non conosce il formato; e
dove il twin manda testo (l'editor raw) c'è una precondizione sull'`mtime`.

---

## Perché il riepilogo ha una cache, e perché ne ha due livelli

Il costo di `/summary` è proporzionale alla finestra, e la finestra arriva a un
anno perché *«Ultimo anno»* è una voce del menu. Con l'auto-aggiornamento la
stessa domanda viene rifatta ogni quindici secondi, per ogni scheda aperta,
ottenendo quasi sempre lo stesso numero.

I due livelli **non sono la stessa cosa**, ed è la distinzione che rende la cache
accettabile su una dashboard di sicurezza:

| Livello | Condizione | Cosa si sta servendo |
|---|---|---|
| 1 | il **timbro** dei file è identico | la risposta che il ricalcolo produrrebbe, bit per bit. Non è vecchia, è **esatta** |
| 2 | timbro cambiato, calcolo recente | qualcosa di un po' vecchio, entro `summaryCacheSeconds` |

Il livello 1 non ha limite di età perché non ne ha bisogno: se i file non sono
cambiati, non esiste un numero diverso da restituire. Su un sito tranquillo è il
caso normale, e l'auto-aggiornamento smette di costare.

Il livello 2 esiste solo per i siti attivi, dove il log cresce di continuo e il
livello 1 non scatterebbe mai. Lì i numeri **sono** più vecchi dell'istante, e la
pagina lo dichiara con `computedAt` accanto alla sorgente dati.

### Il timbro (`windowStamp`)

Numero di file, mtime più recente, byte totali — solo `stat`, qualche
millisecondo. Comprende **anche gli archivi delle impronte**, non solo il log,
perché `/summary` riporta la quota non classificata, che nasce da lì: un timbro
cieco agli archivi terrebbe buona una quota ormai superata.

Limite dichiarato: due riscritture dello stesso file nello stesso millisecondo e
con la stessa dimensione sarebbero indistinguibili. Per il log non può succedere
(si appende, la dimensione cresce); per un archivio riscritto intero è
teoricamente possibile, e il livello 2 lo limita comunque nel tempo.

### Cosa la cache NON risolve

Il **primo** calcolo della finestra annuale su un log grosso costa comunque
secondi di CPU, spezzettati. Toglierlo del tutto significa non ricavare più il
riepilogo dagli eventi grezzi, cioè far scrivere a `sentinel` un aggregato
giornaliero accanto agli altri tre censimenti — un intervento sul service.

---

## Perché la lettura cede il controllo

`readFileSync` e `JSON.parse` sono sincroni: finché girano, il processo non serve
nessun'altra richiesta. Non è un problema della dashboard, è un problema del
**sito**, e si presenta proprio quando il log è grosso — cioè sotto attacco, cioè
quando si sta guardando la dashboard.

`forEachEventSince` cede ogni `LINES_PER_SLICE` righe (20.000). Il conteggio
attraversa i file invece di ripartire da capo a ogni file, altrimenti trecento
file da poche righe scorrerebbero senza cedere mai. Il tempo totale non cala — è
CPU, e va pagata — ma smette di essere una stalla unica: le altre richieste
passano in mezzo.

Misurato su 273 MB / 600.000 eventi: stalla massima **da ~4,5 s a 74 ms**, heap
**da +280 MB a +21 MB**.

---

## Perché l'accumulatore invece di un array di eventi

Tutti i numeri del riepilogo sono calcolabili **una richiesta per volta**: nessuno
ha bisogno di vedere l'insieme. Tenere gli eventi era quindi memoria spesa per
niente.

L'unica parte che cresce col traffico sono le mappe per IP e per impronta, e non
si può evitare: `distinctIps` e `distinctFingerprints` sono cardinalità, e una
cardinalità esatta si paga tenendo l'insieme. Restano comunque un ordine di
grandezza sotto agli eventi che le producono.

`summarize(events)` resta come involucro sottile per chi ha davvero un array —
i test, e chiunque aggreghi un insieme piccolo. Il percorso della dashboard non
passa di lì.

---

## La guardia sulla sovrascrittura

`/rules/raw` e `/rules/source` restituiscono l'`mtime` del file; il client lo
rimanda come `knownMtime` al salvataggio, e il server risponde **409** se nel
frattempo il file è cambiato.

**L'mtime basta** perché la finestra da coprire è lunga — i minuti di una
modifica, non i microsecondi fra due syscall — e perché il dato viaggiava già:
`readRaw` lo restituiva e nessuno lo guardava.

**La precondizione è opzionale**, come `If-Match`: chi non manda `knownMtime`
salva come prima. Il client la manda sempre; chi chiama l'API da uno script non
si trova un contratto cambiato sotto i piedi, e sa di rinunciarci.

Sull'editor raw il conflitto viene rilevato **prima** della validazione: dire a un
testo vecchio che è valido lo incoraggerebbe solo a essere scritto sopra a quello
nuovo.

Il pulsante «promuovi» della panoramica **non** ha la guardia, di proposito: legge
la tabella e scrive un attimo dopo, e la scrittura è chirurgica su una chiave
sola, verificata dal service prima di toccare il file. Una precondizione lì
aggiungerebbe un giro senza chiudere una finestra che praticamente non esiste.

---

## Le tre risposte che l'interfaccia distingue, e prima no

| Esito | HTTP | Cosa mostra la GUI |
|---|---|---|
| Regole non valide | 400 con `errors[]` | elenco degli errori del validatore **del motore** |
| File cambiato sotto | 409 con `conflict` | conferma che nomina la conseguenza («salvare cancella quella modifica») |
| Scrittura fallita | 500 con `error` | il motivo vero (ENOSPC, EACCES…) |

Prima erano una cosa sola: qualunque `saved: false` diventava «Salvataggio
rifiutato», e un disco pieno arrivava all'utente travestito da errore di
validazione **senza un messaggio**, mandandolo a cercare nel posto sbagliato.

---

## Perché la fusione degli shard esiste già

I nomi dei file portano un suffisso di istanza (`sentinel-2026-08-08.w1.jsonl`)
oggi vuoto, perché il processo è uno solo. Il lettore legge comunque **tutti** i
file che corrispondono al prefisso e li unisce: il giorno in cui ital8cms girasse
in cluster, ogni worker scriverebbe sul proprio shard e la dashboard funzionerebbe
senza una riga di modifica.

Le voci di fusione partono da contatori **espliciti a zero** e non dalla copia
della prima voce incontrata. La differenza si vede solo con uno shard parziale —
troncato, di schema più vecchio, scritto a metà — ma lì è netta: prima una prima
voce incompleta produceva `NaN` sui contatori e un `TypeError` sugli esiti. È il
ramo che serve al cluster, cioè quello che nessuno eserciterà finché non servirà
davvero: meglio che sia tollerante quanto il resto del lettore.

Limiti noti della fusione, dichiarati perché non sono difetti ma scelte:

- `ipCount` prende il **massimo** fra shard invece della somma: lo stesso
  indirizzo può essere stato visto da due worker, e sommare sovrastimerebbe.
- `distinctPathsSaturated` si propaga in **OR**, `safeToPromote` si ricalcola in
  **AND**: fondere due misure parziali non può produrre più certezza di quanta ne
  avesse la meno certa delle due.

---

## Il freno del `/flush`

Forzare il salvataggio degli archivi prima di leggerli è giusto: senza, la
dashboard mostrerebbe dati vecchi di un minuto senza dirlo. Ma la GUI lo chiede a
ogni aggiornamento, quindi ogni 15 secondi per ogni scheda aperta, e ogni flush
serializza per intero tre archivi che possono contenere diecimila impronte e
cinquemila client — contro un service che, per conto suo, li salva una volta al
minuto.

`FLUSH_MIN_INTERVAL_MS` (10 s) collassa la moltiplicazione senza cambiare nulla
per la singola scheda (che si aggiorna ogni 15). La risposta dichiara
`flushed: false` invece di fingere: non è un rifiuto, è «gli archivi sono già
stati scritti pochi istanti fa».

---

## `enabled` significa una cosa sola

Le rotte di lettura lo ricavavano dalla sola esistenza della data dir, `/status`
dall'oggetto condiviso. Con `sentinel.custom.enabled: false` il plugin resta
**registrato** — quindi la data dir si risolve — e la stessa installazione
rispondeva sia «attivo» sia «non attivo». Peggio, `/rules` marcava ogni regola
come «rimossa», perché senza oggetto condiviso non arrivava nessuna definizione e
i contatori su disco diventavano tutti orfani.

Adesso `enabled` è sempre «il service è disponibile». I dati storici continuano a
essere restituiti: il log su disco non smette di esistere quando il filtro viene
spento, e nasconderlo impedirebbe di guardare cosa era successo prima di
spegnerlo. `/rules` porta `definitionsAvailable`, e senza definizioni le righe
hanno `defined: null` — un verdetto che nessuno ha emesso non si inventa.

---

## Il form e ciò che non conosce

L'invariante dichiarata in `rule-form.js` è: **un form non deve mai distruggere
ciò che non sa rappresentare.** Vale su tre livelli, aggiunti in tre momenti
diversi perché il difetto si è ripresentato ogni volta un gradino più su:

1. **L'albero `match`** con combinatori annidati (`all`/`any`/`not`) viene
   conservato alla lettera e mostrato in sola lettura.
2. **Le forme piccole**: `sessionAnomaly: true` ha la sua voce «qualunque» nei
   multi-select, e i campi a pattern multipli (`path`, `query`, `userAgent`) sono
   aree di testo **una riga per pattern** — non separate da virgole, perché la
   virgola compare dentro i valori: in una querystring (`?ids=1,2,3`), in uno
   User-Agent (`Android 10, wv`), in un quantificatore regex (`{1,3}`).
3. **Le chiavi di primo livello**: `mergeRuleFields` parte dalla regola **sul
   file** e sovrascrive solo `FORM_OWNED_KEYS`. Prima la regola veniva
   ricostruita da zero, il che è corretto finché l'elenco del form e lo schema del
   file coincidono — una coincidenza da mantenere a mano.

Le funzioni pure di queste mappature sono esportate sotto `typeof module`, ramo
che in browser non esiste: sono l'unica parte testabile senza un DOM, e sono
precisamente dove il form ha perso dati.

---

## Etichette lato client

Il JS di pagina non può chiamare `__()`, che è un helper dei template. Ogni EJS
dichiara `SN_I18N` con le sole chiavi che la sua pagina usa; `sentinel-i18n.js`
espone `snT(key, vars)`, condivisa dalle quattro pagine.

Due dettagli che non sono cosmetici:

- Le etichette passano da **`JSON.stringify`** e dal tag di output non escapato.
  Con quello escapato ogni apostrofo italiano arriverebbe a schermo come `&#39;`,
  ed è il motivo per cui il gemello `adminRateLimiter` ha solo etichette senza
  apostrofi. Il minore viene neutralizzato a parte.
- Le stringhe usano **segnaposto** (`{rule}`, `{n}`) e non la concatenazione:
  `'Regola "' + nome + '": ' + prima` funziona in italiano e decide l'ordine
  delle parole per tutte le lingue che verranno.

Un test verifica che ogni chiave usata dal JS esista fra le etichette della sua
pagina, e che non ci siano etichette dichiarate e mai usate: `t('chiaveSbagliata')`
non lancia, stampa la chiave, e altrimenti lo scoprirebbe un utente.

---

## Regolazioni

| Voglio… | Tocco |
|---|---|
| numeri più freschi su un sito molto attivo | `summaryCacheSeconds` più basso (`0` = ricalcola sempre) |
| meno CPU sulle finestre lunghe | `summaryCacheSeconds` più alto; la pagina dichiara comunque l'età |
| meno traffico verso il server | `autoRefreshSeconds` più alto, o l'interruttore in pagina |
| una finestra di default diversa | `windowDays` |
| vedere tutti i client censiti, non solo i sospetti | `GET /scanners?minPaths=0` |
| più cronologia dei salvataggi raw | `maxBackupsPerFile` |

---

## Riferimenti

- Contratto dell'oggetto condiviso: [`sentinel/EXPLAIN.it.md`](../sentinel/EXPLAIN.it.md)
- Convenzioni Twin Admin Plugin e Le Tre Viste: `CLAUDE.md`
- Ciclo di vita dei config e migrazioni: [`docs/decisions/config-lifecycle.it.md`](../../docs/decisions/config-lifecycle.it.md) · [`config-migrations.it.md`](../../docs/decisions/config-migrations.it.md)
