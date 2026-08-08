# Priority middlewares

I middleware che devono girare **prima di tutto il resto**, in un ordine fisso e
garantito. Vivono qui perché il loro ordine non può essere lasciato ai plugin:
`koa-session` deve stare prima del router, altrimenti `ctx.session` è `undefined`
dentro i route handler, e `bodyParser` deve stare prima di entrambi, altrimenti
lo è `ctx.request.body`.

Sorgenti: [`priorityMiddlewares.js`](./priorityMiddlewares.js) (montaggio) ·
[`runtimeGate.js`](./runtimeGate.js) (i tre gate commutabili a caldo).

---

## L'ordine

```
1.  rejectNonCanonicalPaths   opzionale, default ON    difesa in profondità
2.  bodyParser                CORE, sempre attivo
3.  session                   opzionale, default ON
4.  maintenanceGate           gate a runtime            CLI: public
5.  sentinelGate              slot pre-router           CLI: sentinel
6.  reservedGate              gate a runtime            CLI: reserved
7.  router                    CORE, sempre attivo
    ────────────────────────────────────────────────────────────────
    da qui in poi, in index.js: middleware dei plugin, poi static server
```

Ogni posizione ha una ragione, e nessuna è intercambiabile.

| # | Perché lì |
|---|---|
| 1 | Controllo puramente sintattico sul path: non gli servono né body né sessione, quindi può stare prima di tutto e scartare subito le richieste malformate. |
| 2-3 | Devono precedere il router, altrimenti `ctx.request.body` e `ctx.session` sono `undefined` negli handler. |
| 4 | Il 503 di manutenzione ha la **precedenza su tutto**: quando il sito è chiuso, deve esserlo in modo uniforme. |
| 5 | Dopo `session` (per poter leggere chi è autenticato) e dopo il maintenance (se rispondesse 404 mentre il resto dà 503, la differenza sarebbe essa stessa un'informazione). Prima del router, o non vedrebbe le rotte API. |
| 6 | Ultimo dei gate, subito prima del router: chiude per path e intercetta anche il 405 di `allowedMethods()`. |
| 7 | Ultimo, così negli handler body e sessione sono garantiti. |

## Configurazione

In `ital8Config.json5`:

```json5
{
  "rejectNonCanonicalPaths": true,     // gate 1 (default: attivo)
  "priorityMiddlewares": {
    "session": true,                   // gate 3 (default: attivo)
  },
}
```

`bodyParser` e `router` non sono configurabili: senza di loro il CMS non funziona.

Disattivare `session` rende `ctx.session` `undefined` ovunque e **spegne
l'autenticazione**: ha senso solo per un sito che non ha alcuna area riservata.

I tre gate non si configurano da qui — si commutano **a runtime** dal control
plane, senza riavvio (vedi sotto).

## I tre gate a runtime

Vivono tutti in `runtimeGate.js` perché condividono natura (commutabili a caldo,
stato persistito in `core/cliBridge/state.json5`) e insieme di prefissi.

| Gate | Comando | Stati | Risposta quando chiude |
|---|---|---|---|
| `maintenanceGate` | `public start\|stop` | running / stopped | **503** + pagina di manutenzione |
| `sentinelGate` | `sentinel start\|monitor\|stop` | running / monitor / stopped | dipende dalla regola (in v1: **404**) |
| `reservedGate` | `reserved start\|stop` | running / stopped | **404** indistinguibile da un URL mai esistito |

Due asimmetrie da conoscere:

- **maintenance ed reserved usano gli stessi prefissi in modo opposto.** Il
  maintenance li **esenta** (durante la manutenzione l'admin deve poter lavorare),
  il reserved li **prende di mira**. Da qui la convivenza nello stesso file.
- **Le esenzioni del maintenance si sospendono** quando la superficie riservata è
  chiusa: a quel punto non servono più a nessuno e resterebbe solo l'effetto
  collaterale, cioè un 404 dove tutto il resto dà 503 — una mappa della
  superficie riservata.

`sentinel` è l'unico con **tre** stati, perché fra «filtra» e «spento» serve
«osserva ma non agire»: è la via di fuga quando una regola promossa si rivela
sbagliata, e spegnere tutto perderebbe proprio i dati che servono a capire cosa è
andato storto.

## Uno slot che nasce vuoto

`sentinelGate` è di natura diversa dagli altri due: maintenance e reserved
portano dentro di sé tutta la propria logica, questo è un **guscio** che ospita
un motore fornito dal plugin `sentinel`.

Il motivo è un problema di tempi. I middleware dei plugin sono montati **dopo il
router** (in `index.js`), quindi un filtro non vedrebbe mai una rotta API già
matchata — cioè proprio la superficie dove vivono gli attacchi
all'autenticazione. Ma i plugin si caricano **dopo** che questi middleware sono
già montati, e in Koa non si inserisce un middleware a metà catena a posteriori.

La soluzione è montare qui un middleware che nasce vuoto e riceve il proprio
contenuto più tardi:

```js
// priorityMiddlewares.js — i plugin non esistono ancora
const sentinelGate = createSentinelGate({ ital8Conf, reservedGate });
app.use(sentinelGate.middleware);        // pass-through da un `if`

// index.js — dopo pluginSys.initialize()
sentinelGate.setEngine(pluginSys.getSharedObject('sentinel'));
```

Non è un'invenzione di sentinel: `reservedGate` fa lo stesso da prima, ricevendo
l'indice dei path riservati con `setReservedRoutePaths()` dopo il caricamento
delle rotte.

> **Nota storica.** La versione precedente di questo file, scritta anni fa,
> annunciava «un elenco dei priority midlware che i vari plugin potranno
> richiedere di installare». Il meccanismo è quello, ed è stato formalizzato
> quando è servito davvero.

### Perché uno slot nominato e non un hook generico

Un `getEarlyMiddlewareToAdd()` aperto a tutti i plugin sarebbe stato più
semplice, ma avrebbe aperto un varco: qualsiasi plugin potrebbe montarsi prima
del router, e si perderebbe la garanzia d'ordine che questo modulo esiste per
dare. Uno slot solo, un occupante solo, ordine deterministico.

### Cosa resta nel core anche con lo slot occupato

Gli invarianti di sicurezza non sono delegabili a un plugin:

- il **404** di blocco lo produce `reservedGate.deny()` — un unico generatore,
  presidiato da un test che lo confronta byte per byte con un 404 autentico;
- la **non-interferenza** con la superficie riservata chiusa (niente risposte
  decorate sui path riservati: rivelerebbero che esistono);
- l'esenzione di `/.well-known/` (bloccarla farebbe scadere i certificati);
- il **tetto di enforcement**, così il kill switch funziona anche con un motore
  impazzito.

Il risultato: un motore sbagliato può al più **non filtrare**.

## Aggiungere un nuovo priority middleware

1. Decidere la posizione **e scrivere perché** deve stare lì: è l'unica
   informazione che questo file esiste per conservare.
2. Se serve un file di configurazione proprio, seguire il modello di
   `koaSession.json5` (coppia `.default.json5` + vivo git-ignored).
3. Se dev'essere commutabile a runtime, farne un gate in `runtimeGate.js` e
   aggiungere la superficie al control plane (`core/cliBridge/`).
4. Se la sua logica appartiene a un plugin, usare il modello dello slot: guscio
   qui, motore iniettato in `index.js`.
5. Aggiornare la tabella dell'ordine qui sopra.

## Documentazione collegata

- [`docs/cli-control-plane.it.md`](../../docs/cli-control-plane.it.md) — i comandi
- [`plugins/sentinel/EXPLAIN.it.md`](../../plugins/sentinel/EXPLAIN.it.md) — il motore dello slot
- [`CLAUDE.md`](../../CLAUDE.md) — flusso di avvio dell'applicazione
