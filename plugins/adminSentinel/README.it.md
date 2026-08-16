<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# adminSentinel

Interfaccia admin del filtro delle richieste [`sentinel`](../sentinel/README.it.md).
Sezione **🔭 Sentinel** del pannello.

**Cosa risolve.** La v1 di `sentinel` era *write-only*: osservava, classificava e
registrava, ma per leggere quei dati bisognava aprire i JSONL a mano. Il percorso
*osserva → capisci → promuovi* aveva la prima fase completa e le altre due
scoperte. Questo plugin copre la seconda.

---

## Cosa mostra

### KPI

| Indicatore | Significato |
|---|---|
| **Classificate** | Richieste su cui una regola ha matchato, nella finestra scelta |
| **Applicate** | Quante hanno prodotto un'azione (0 in modalità osservazione) |
| **IP distinti** | Origini diverse |
| **Impronte** | Firme HTTP diverse viste |
| **UA incoerenti** | ⭐ Richieste il cui User-Agent dichiara un browser mentre la forma degli header dice client script. Uno dei due mente, e sappiamo quale |
| **Non classificato** | Quota di traffico che **nessuna regola descrive** — è lì che si scoprono le regole mancanti |

### Composizione per famiglia

Non «quante ne ho bloccate», che è un numero rassicurante e poco utile, ma di
cosa è fatto il traffico che bussa: sonde verso CMS estranei, file sensibili,
metodi anomali, scanner. Aggregato per `category`, con barra proporzionale.

### Token esca (canary)

L'opposto esatto dei sospetti scanner: là ci sono le inferenze, qui le certezze.
Un token esiste **solo** dentro il decoy consegnato a un client preciso — nessun
link ci porta, nessuno lo digita per sbaglio — quindi se torna indietro chi l'ha
usato ha letto il decoy e ha deciso di seguirlo.

La colonna **Stesso client** è quella da guardare: `no` significa che il
contenuto del decoy è passato di mano, cioè che chi scandaglia e chi sfrutta sono
due macchine diverse.

La card **resta nascosta** finché nessun token è stato consegnato: una card sempre
vuota su una dashboard di sicurezza insegna a smettere di guardarla, e questa è
quella che non si deve smettere di guardare.

### Coerenza delle sessioni

Le sessioni autenticate che hanno smesso di assomigliare a sé stesse: la linea di
base è come la sessione appariva alla **prima** richiesta, e non viene mai
aggiornata.

Le due anomalie in rosso — `uaChanged` e `scriptClient` — sono quelle con meno
falsi positivi: un browser non cambia User-Agent a metà sessione, e un cookie
valido in mano a `python-requests` descrive già un problema. Quelle in grigio
(`ipChanged`, `networkChanged`) sono rumorose per via del mobile.

Il contatore **Con anomalie** conta le *sessioni*, non le richieste: una sessione
dirottata produce l'anomalia a ogni richiesta successiva, e sommarle direbbe
quanto è stata attiva, non quante sessioni sono compromesse.

Anche questa card resta nascosta finché non c'è niente da mostrare.

### Sospetti scanner

Client che collezionano molti percorsi distinti falliti. **Non derivano da
nessuna regola**: nascono dall'osservazione degli esiti, ed è lì che compaiono
gli attacchi per cui una regola ancora non esiste.

### Regole

La tabella che serve per decidere. La colonna **Utenti autenticati** è il
semaforo:

| Valore | Cosa significa |
|---|---|
| `0` dopo settimane di traffico | Promuovere la regola a `block` è sicuro |
| `> 0` | C'è un falso positivo che non hai ancora capito |
| Regola **mai scattata** | Non è «sicura»: è una regola di cui non si sa niente. Promuoverla sarebbe un atto di fede |

Le regole rimosse o rinominate restano visibili marcate come *non definite*: la
loro storia è ancora su disco, e farla sparire in silenzio significherebbe
perdere settimane di osservazione senza accorgersene.

### Impronte HTTP

Una impronta vista da **molti IP distinti** è una botnet — e lo si sa senza
conservare un solo indirizzo, perché il censimento di default tiene solo il
conteggio (`censusIpMode: "count"`).

### Eventi recenti

Le ultime righe del log, filtrabili per soli eventi applicati.

---

## Le due sorgenti

| Sorgente | Cosa dà | Perché |
|---|---|---|
| Oggetto condiviso di `sentinel` | Stato vivo: statistiche in memoria, nomi delle regole | Stesso processo, costo nullo |
| File in `plugins/sentinel/data/` | Dati storici: eventi, censimenti, contatori | Un anno di eventi non può passare per la memoria del service |

I dati storici si leggono **senza materializzarli**: `forEachEventSince` consegna
un evento per volta a chi aggrega, e non trattiene niente. La stessa ragione per
cui non passano dall'oggetto condiviso vale dentro questo plugin — un anno di
eventi non deve stare in memoria nemmeno qui. Vedi *Il costo della panoramica*.

La data dir è risolta dal `custom.dataPath` del service via
`pluginSys.getPlugin('sentinel')`, non cablata: un percorso personalizzato
continua a funzionare.

### Fusione degli shard

Il lettore legge **tutti** i file che corrispondono al prefisso e li unisce. Oggi
il suffisso di istanza è vuoto e la fusione è trasparente; il giorno in cui
ital8cms girasse in cluster, ogni worker scriverebbe sul proprio shard e la
dashboard funzionerebbe senza una riga di modifica.

Un limite dichiarato: fondendo, `ipCount` prende il **massimo** fra gli shard
invece della somma, perché lo stesso indirizzo può essere stato visto da due
worker. Con un processo solo non si presenta.

---

## Osservazione ≠ enforcement

Il badge in alto distingue **due condizioni indipendenti**:

- `custom.mode` nella configurazione di `sentinel`;
- lo **stato del gate**, commutabile a caldo con `npm run cli -- sentinel monitor`.

`mode: enforce` con il gate su `monitor` **non sta bloccando**. Mostrare solo il
primo dei due sarebbe la stessa trappola diagnostica di «admin: running» accanto
a un pannello che risponde 404.

---

## Configurazione

`pluginConfig.json5 → custom`:

| Campo | Default | Cosa fa |
|---|---|---|
| `windowDays` | `7` | Finestra della panoramica |
| `eventLimit` | `100` | Righe nella tabella eventi |
| `scannerThreshold` | `20` | Percorsi distinti falliti per essere un sospetto scanner |
| `autoRefreshSeconds` | `15` | Auto-aggiornamento; `0` lo disattiva |
| `summaryCacheSeconds` | `30` | Quanto resta buono un riepilogo già calcolato **quando i file sono cambiati**; `0` ricalcola sempre (vedi *Il costo della panoramica*) |
| `maxBackupsPerFile` | `10` | Backup di `sentinelRules.json5` conservati prima dei salvataggi dall'editor raw |

### Il costo della panoramica

Il riepilogo si ricava da **tutto** il log della finestra, e la finestra arriva a
un anno perché *«Ultimo anno»* è una voce del menu. Lettura e parsing sono
sincroni: finché girano, il processo non serve nessun'altra richiesta — quindi il
conto non lo paga la dashboard, lo paga il **sito**.

Tre cose lo tengono a bada, e vale la pena sapere quale fa cosa:

| | Cosa fa | Effetto misurato su 273 MB / 600.000 eventi |
|---|---|---|
| **Streaming** | Gli eventi alimentano un accumulatore e vengono buttati subito, invece di essere raccolti in un array per poi contarli | heap **da +280 MB a +21 MB** |
| **Cessione del controllo** | Ogni 20.000 righe il lettore lascia girare l'event loop | stalla massima **da ~4,5 s a 74 ms** |
| **Cache** | A file invariati il riepilogo non si ricalcola | secondo aggiornamento **da ~4,5 s a ~1 ms** |

Misurato anche sull'istanza viva (81,8 MB di log, richieste HTTP autenticate): la
stessa panoramica ripetuta tre volte passa da **775 / 722 / 725 ms** a
**715 / 5,8 / 5,3 ms**, e la latenza peggiore di un endpoint leggero interrogato
*durante* il calcolo scende da **645 ms** (su un calcolo da 693 ms: chi arriva
all'inizio aspetta praticamente tutto) a **178 ms**, con tutte le richieste
servite mentre la panoramica lavorava. Prima il sito si fermava, adesso rallenta.

La cache ha due livelli, e il primo non è un compromesso:

1. **Timbro dei file identico** → la risposta in cache è *esattamente* quella che
   il ricalcolo produrrebbe. Non è vecchia, è esatta: si serve senza limiti di
   età. Il timbro costa una `readdir` e qualche `stat` (~1 ms), e comprende anche
   gli archivi delle impronte, perché la quota non classificata nasce da lì.
2. **Timbro cambiato ma calcolo recente** → qui sì che i numeri sono un po'
   vecchi, ed è `summaryCacheSeconds` a dire quanto. Serve sui siti attivi, dove
   il log cresce di continuo e il primo livello non scatterebbe mai.

Le richieste in volo si fondono: **tre schede aperte fanno un calcolo, non tre**.

La pagina mostra sempre l'istante di calcolo accanto alla sorgente dati. Servire
un riepilogo di trenta secondi fa va benissimo; farlo credere dell'istante no.

> **Limite dichiarato.** Il *primo* calcolo della finestra annuale su un log
> grosso costa comunque secondi di CPU, spezzettati. Toglierlo del tutto vuol
> dire non ricavare più il riepilogo dagli eventi grezzi, cioè far scrivere a
> `sentinel` un aggregato giornaliero accanto agli altri censimenti: è un
> intervento sul service, non su questo plugin.

## API

Tutte sotto `/api/adminSentinel/`, tutte con `requiresAuth: true` e
`allowedRoles: [0, 1]` — la mappa del proprio traffico e le regole del filtro non
vanno esposte a chiunque.

```
GET  /status                        stato vivo + effectivelyEnforcing + dataDir
GET  /summary?days=7                KPI, composizione, timeline, quota non classificata
                                    (+ computedAt: quando i numeri sono stati calcolati)
GET  /rules                         contatori + azione in vigore + indicatore di promuovibilità
GET  /fingerprints?limit=50         censimento delle impronte
GET  /scanners?minPaths=20          sospetti scanner
GET  /events?limit=100&...          eventi recenti (ruleName, category, ip, enforcedOnly)
POST /flush                         forza il salvataggio degli archivi prima di leggerli

POST /rules/action                  { ruleName, action } — promuovi o retrocedi
POST /mode                          { mode: "monitor"|"enforce" }
GET  /rules/raw                     testo del file + elenco dei backup
POST /rules/validate                { content } — valida senza salvare
POST /rules/save                    { content } — valida, fa il backup, salva, ricarica
POST /rules/test                    { spec } — prova una richiesta e spiega l'esito

GET  /rules/source                  le regole come stanno sul FILE (per il form)
POST /rules/fields                  { ruleName, rule } — salva una regola dal form
```

Le POST richiedono il token CSRF, iniettato automaticamente nelle pagine admin
dall'hook `head` di `csrfProtection`: il `fetch` del browser lo aggiunge da sé.

## Sicurezza dell'interfaccia

Ogni contenuto dinamico passa da `escapeHtml()` prima di finire in `innerHTML`:
qui si stampano IP, percorsi e User-Agent, cioè **stringhe scelte
dall'attaccante**. Una dashboard di sicurezza che si fa iniettare HTML dai propri
dati è un bersaglio, non uno strumento.

---

## Promozione e retrocessione

Nella tabella delle regole ogni riga ha un pulsante che propone **il passo
opposto** a quello attuale: `⏻ promuovi` su una regola in osservazione,
`↩ retrocedi` su una in blocco.

**La retrocessione conta più della promozione.** Se disfare richiedesse di aprire
un editor JSON5 alle tre di notte, nessuno promuoverebbe niente: per questo il
pulsante che retrocede è vistoso quanto quello che promuove, non nascosto in un
menu. E resta comunque la via più rapida, dalla riga di comando:

```bash
npm run cli -- sentinel monitor    # ferma TUTTO l'enforcement, senza perdere i dati
```

Promuovere una regola che ha già colpito utenti autenticati chiede conferma
nominando il numero: è la mossa che chiude fuori qualcuno.

L'interruttore globale in alto commuta fra osservazione ed enforcement, con la
stessa logica: propone sempre l'altra modalità, e attivare l'enforcement chiede
conferma ricordando come annullarlo.

**La scrittura la fa il service, non questo plugin.** In `sentinel` stanno la
conoscenza del formato del file e l'obbligo di ricaricare dopo ogni modifica: se
la facesse il twin, prima o poi qualcuno scriverebbe senza ricaricare e la GUI
direbbe «salvato» mentre il filtro continua col vecchio.

## Editor JSON5 (Vista B)

Scheda **Regole (JSON5)**: il file grezzo, con validazione separata dal
salvataggio.

- **Il testo viene salvato esattamente come lo scrivi**, commenti compresi. La
  validazione controlla, non riformatta: se il salvataggio passasse da
  `parse` → `stringify` sparirebbero commenti, indentazione e ordine delle
  chiavi — e in `sentinelRules.json5` i commenti sono la descrizione di cosa
  osserva ogni regola.
- **Validazione lato server** con il validatore **del service**: riusarlo invece
  di riscriverne uno è la sola garanzia che ciò che la GUI accetta e ciò che il
  motore accetta restino la stessa cosa.
- **Backup prima di ogni salvataggio** (ultimi 10). L'editor raw è l'unica
  operazione della GUI che può distruggere il file in un colpo solo.
- Un salvataggio rifiutato **non tocca il file su disco**.
- Avviso di modifiche non salvate uscendo dalla pagina.

Le modifiche entrano in vigore **subito**: il server chiama `reloadRules()` dopo
la scrittura, nessun riavvio.

## Form strutturato (Vista C)

Scheda **Regole (form)**: le stesse regole dell'editor JSON5, campo per campo.
Stesso file, stessa validazione — quella del motore, lato server — e nessuna
cache locale: dopo ogni salvataggio il file viene riletto, così quello che vedi
è quello che c'è su disco.

### La regola che ha determinato il progetto

**Un form non deve mai distruggere ciò che non sa rappresentare.**

L'albero `match` ammette combinatori annidati (`all` / `any` / `not`) che un form
piatto non può mostrare. La tentazione sarebbe appiattirli; il risultato sarebbe
che aprire una regola e salvarla *senza toccare niente* la cambia — il modo più
efficace di far perdere fiducia a uno strumento.

Qui invece un `match` non rappresentabile viene **conservato alla lettera** e
mostrato in sola lettura, con un rimando all'editor JSON5. Tutto il resto della
regola resta modificabile e salvabile senza rischio.

La regola vale anche per i **casi piccoli**, ed è lì che era stata infranta due
volte (corretto nel consolidamento C6). Due forme legittime del file tornavano
indietro diverse da come erano entrate:

| Nel file | Come si presentava | Come tornava indietro |
|---|---|---|
| `sessionAnomaly: true` (= qualunque) | niente selezionato | la chiave **spariva** |
| `reputation: true` | niente selezionato | la chiave **spariva** |
| `query: ["union select", "sleep("]` | `union select,sleep(` | l'unica stringa `"union select,sleep("` |

La prima **allargava** la regola senza dirlo — da «solo le sessioni anomale» a
«tutte» — e continuava a validare, quindi nulla se ne accorgeva. Ora `true` ha la
sua voce **«qualunque»** nei due elenchi, e `query` è un'area di testo con **un
pattern per riga** come `path`: non separata da virgole, perché in una querystring
la virgola è un carattere normale (`?ids=1,2,3`) e spezzerebbe in due un pattern
che ne contiene una.

### Cosa si perde salvando dal form

I commenti scritti **dentro quella regola**. Il form conosce i campi, non i
commenti, e riscrive il blocco testuale della regola che stai salvando. Restano
intatti i commenti delle altre regole, le cornici di sezione e l'intestazione del
file.

È una perdita reale, quindi l'interfaccia la dichiara **prima** del salvataggio
invece di lasciarla scoprire dopo. Per una regola i cui commenti contano, c'è
l'editor JSON5. Il posto giusto dove spiegare cosa osserva una regola resta
comunque il campo `description`, che sopravvive al form.

### Cosa il form non lascia fare

**Rinominare.** Il nome è la chiave che lega contatori, righe di log e
promozioni: cambiarlo azzera la storia della regola. Si può fare, ma
dall'editor JSON5 — cioè con la consapevolezza di quello che si sta facendo.

## Tester (scheda «Tester»)

Prova una richiesta contro le regole in vigore, **senza inviarla davvero**.
Modulo per percorso, metodo, IP, User-Agent, query string, autenticazione e
ruoli; l'esito elenca ogni condizione con **atteso accanto a osservato**.

L'interruttore **«Simula un browser reale»** conta più di quanto sembri: senza,
la richiesta sintetica ha solo gli header che le dai e appare sempre come un
client script — chiunque incolli uno User-Agent di Chrome inciampa nella regola
sull'incoerenza senza capire perché.

Le **anomalie di sessione** si dichiarano invece di essere calcolate: la domanda
è «se questa sessione avesse cambiato client, la mia regola la prenderebbe?», e
riprodurre la storia di una sessione vera in una prova sintetica non avrebbe
senso. Valgono solo con «Richiesta autenticata» attiva, come a runtime.

Lo stesso strumento è disponibile da riga di comando
(`npm run cli -- sentinel test <path>`), che è spesso dove serve: la domanda
«perché questa regola non scatta?» arriva mentre si sta scrivendo il file in SSH.

## Cosa NON fa ancora

Le Tre Viste ci sono tutte. Restano aperti i punti del *piano di rifinitura* in
[`plugins/sentinel/TODO.md`](../sentinel/TODO.md).
