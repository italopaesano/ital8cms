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

## API

Tutte sotto `/api/adminSentinel/`, tutte con `requiresAuth: true` e
`allowedRoles: [0, 1]` — la mappa del proprio traffico e le regole del filtro non
vanno esposte a chiunque.

```
GET  /status                        stato vivo + effectivelyEnforcing + dataDir
GET  /summary?days=7                KPI, composizione, timeline, quota non classificata
GET  /rules                         contatori per regola + indicatore di promuovibilità
GET  /fingerprints?limit=50         censimento delle impronte
GET  /scanners?minPaths=20          sospetti scanner
GET  /events?limit=100&...          eventi recenti (ruleName, category, ip, enforcedOnly)
POST /flush                         forza il salvataggio degli archivi prima di leggerli
```

## Sicurezza dell'interfaccia

Ogni contenuto dinamico passa da `escapeHtml()` prima di finire in `innerHTML`:
qui si stampano IP, percorsi e User-Agent, cioè **stringhe scelte
dall'attaccante**. Una dashboard di sicurezza che si fa iniettare HTML dai propri
dati è un bersaglio, non uno strumento.

---

## Cosa NON fa ancora

È la **Vista Dati**, la prima delle [Tre Viste](../../CLAUDE.md). Mancano:

- editor JSON5 delle regole (Vista B) e form strutturato (Vista C);
- **promozione e retrocessione in un gesto** — oggi si edita
  `sentinelRules.json5` a mano;
- tester delle regole nella GUI.

Sono i passi 2 e 3 del piano di lavoro in
[`plugins/sentinel/TODO.md`](../sentinel/TODO.md).
