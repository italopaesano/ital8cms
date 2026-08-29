# analytics · da v1 a v2 — `weight` da 5 a -8

## Cosa cambia

Una sola chiave in `pluginConfig.json5`:

```json5
"weight": 5   →   "weight": -8
```

## Perché

L'ordine di caricamento dei plugin è **anche** l'ordine in cui `index.js` monta i
loro middleware:

```js
const middlewaresToLoad = pluginSys.getMiddlewaresToLoad();
middlewaresToLoad.forEach((midlwareFn) => {
  midlwareFn(app).forEach((middleware) => app.use(middleware));
});
```

Quel legame non era documentato da nessuna parte, ed è il cuore della faccenda.

Fino alla **v2.99.0** `pluginSys` caricava i plugin nell'ordine di
`fs.readdirSync()` — alfabetico sulla gran parte dei filesystem. In quel mondo
`analytics` capitava **secondo** e `urlRedirect` **dodicesimo**, quindi il
middleware di analytics avvolgeva quello di urlRedirect *per caso*.

In **v3.0.0** il caricamento è passato all'ordine per `weight`, che è il contratto
che `CLAUDE.md` dichiarava da sempre. Il meccanismo è corretto — l'ordine ora è
deciso da un valore dichiarato invece che dall'ordine di lettura di una directory
— ma con `analytics: 5` e `urlRedirect: 1` l'effetto è stato questo:

| | `analytics` | `urlRedirect` |
|---|---|---|
| prima (alfabetico) | **#2** | #12 |
| dopo (per weight) | #9 | **#7** |

## Cosa si rompeva

Il middleware di `urlRedirect`, su una regola che matcha, fa `ctx.redirect()` e
ritorna **senza chiamare `next()`** — giustamente, la risposta è completa. Ma un
middleware che *osserva* deve stare più esterno di uno che *interrompe*,
altrimenti non vede ciò che viene interrotto.

**Misurato:** il 100% dei 301/302 spariva dal log analytics e dalla dashboard
admin. Non un errore visibile — semplicemente traffico che non risultava mai
esistito. Sono i redirect di una migrazione da vecchio sito: esattamente le
pagine di cui si vorrebbe sapere se qualcuno le chiede ancora.

## Perché si cambia il valore e non il codice

Il valore `5` non è mai stato scelto pensando all'ordine dei middleware, perché
prima non lo governava. `-8` dice quello che analytics ha bisogno di essere:

- **dopo `simpleI18n` (-10)**, che popola `ctx.state.lang`;
- **prima di chiunque possa interrompere una richiesta**.

Il plugin non ha dipendenze (`dependency: {}`, `nodeModuleDependency: {}`), quindi
anticiparne il caricamento non ha effetti collaterali.

## Perché serve una migrazione e non basta il boot

Il merge additivo di `reconcileSchemaVersions` sa solo **aggiungere** chiavi.
`weight` esiste già nel config vivo, quindi il nuovo valore distribuito nel
`.default` non lo raggiungerebbe mai: senza questo step ogni installazione
esistente resta a `5` e continua a perdere i redirect dalle statistiche.

## Cosa lo script NON fa

Se il `weight` in vigore non è **esattamente** `5` — cioè se l'amministratore l'ha
già scelto lui — non tocca niente e scrive un warning che spiega cosa guardare.
Chi ha messo un valore proprio ha fatto una scelta, e una migrazione che gliela
sovrascrive è il modo di far perdere fiducia in tutte le migrazioni successive.

Idempotente: eseguito due volte, la seconda non trova nulla da fare.

## Verifica dopo l'applicazione

```bash
npm run cli -- migrate analytics --dry-run   # cosa farebbe
npm run cli -- migrate analytics             # applica
```

Poi, sul server avviato, l'ordine di caricamento deve mostrare `analytics` prima
di `urlRedirect`, e un `GET` su un path redirezionato deve comparire nel log
analytics.
