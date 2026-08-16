# adminSentinel · da v1 a v2 — cache del riepilogo della panoramica

## Cosa cambia

Una chiave nuova in `pluginConfig.json5 → custom`:

```json5
// Per quanti secondi un riepilogo già calcolato resta buono QUANDO I FILE
// SONO CAMBIATI. 0 = ricalcola sempre.
"summaryCacheSeconds": 30,
```

## Perché

`GET /api/adminSentinel/summary` ricavava i propri numeri rileggendo **tutto** il
log della finestra, e la finestra arriva a un anno perché *«Ultimo anno»* è una
voce del menu a tendina. Con la retention a 365 giorni e il tetto di 200 MB della
data dir, un aggiornamento della panoramica su quella finestra costava ~3 secondi
di CPU e ~200 MB di heap — e l'auto-aggiornamento lo ripeteva ogni 15 secondi,
per ogni scheda aperta.

Il costo non ricadeva sulla dashboard ma sul **sito**: `readFileSync` e
`JSON.parse` non cedono il controllo, quindi per tutta la durata il processo non
serviva nessun'altra richiesta. Una dashboard di sicurezza lasciata aperta
faceva più danno del traffico che stava osservando.

L'intervento è in tre parti, e solo la terza ha bisogno di questa chiave:

1. **Aggregazione in streaming** — gli eventi non vengono più raccolti in un
   array per essere contati: alimentano un accumulatore e vengono buttati subito.
2. **Cessione del controllo all'event loop** ogni 20.000 righe — il lavoro resta,
   la stalla no.
3. **Cache del riepilogo** — a timbro dei file invariato la risposta è esatta e
   si serve così com'è; a timbro cambiato è questo valore a dire per quanto resta
   buona.

## Perché non serve uno script

`custom` esiste già e `summaryCacheSeconds` è una chiave nuova al suo interno: il
merge additivo ricorsivo del boot (`reconcileSchemaVersions`) la aggiunge da sé
senza toccare i valori già presenti.

Lo step è dichiarato per due motivi. Il primo è la **contiguità della catena**:
il runner verifica che gli step coprano il salto, non che ci sia lavoro da fare,
e una catena bucata blocca anche gli step veri che venissero dopo. Il secondo è
che la chiave arrivi nel config **vivo** con il suo commento: una manopola che
esiste solo nel codice è una manopola che nessuno girerà mai.

## Come si applica

```bash
npm run cli -- migrate adminSentinel --dry-run   # mostra cosa farebbe
npm run cli -- migrate adminSentinel             # applica
```

## Cosa succede se non la applichi

Niente di rotto: senza la chiave il codice usa 30 secondi come default. Cambia
solo che il valore non è visibile né modificabile dal config vivo, e che il boot
continua a segnalare il disallineamento di `schemaVersion` con un box `[SCHEMA]`.

## Come scegliere il valore

| Valore | Effetto |
|---|---|
| `0` | Nessuna cache: ogni richiesta ricalcola. Ha senso solo per diagnosticare |
| `30` (default) | Su un sito attivo i numeri sono al più di 30 s fa; su uno tranquillo la cache resta comunque esatta e non scade |
| più alto | Meno CPU sulle finestre lunghe, numeri dichiaratamente più vecchi |

La pagina mostra sempre l'istante di calcolo accanto alla sorgente dati, quindi
alzare il valore non nasconde nulla: rende solo più visibile l'età.

Se la finestra annuale resta pesante anche con la cache, il rimedio non è alzare
ancora questo numero: è non ricavare più il riepilogo dagli eventi grezzi, cioè
far scrivere a `sentinel` un aggregato giornaliero accanto agli altri censimenti.
È un intervento sul service, non su questo plugin.
