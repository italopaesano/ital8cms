# sentinel · da v4 a v5 — reputazione locale delle impronte

## Cosa cambia

Il censimento delle impronte accumulava da mesi senza che nulla lo leggesse. La
foglia `reputation` trasforma quella storia in una condizione usabile in una
regola, e il descrittore acquisisce i parametri del giudizio:

```json5
"reputation": {
  "minRequests": 20,                    // sotto questa soglia non si giudica
  "suspectShare": 0.2,
  "badShare": 0.5,
  "burstWindowSeconds": 60,
  "burstMinRequests": 30,
  "protectBrowserFingerprints": true,   // ← vedi l'avvertenza qui sotto
}
```

più `custom.census.ipRetentionDays`, la scadenza degli indirizzi conservati dal
censimento (ha effetto solo con `censusIpMode: "full"`, l'unico caso in cui
finiscono su disco).

## Perché non serve uno script

Come per lo [step precedente](./from-v3-to-v4.md): solo chiavi nuove dentro
oggetti, che il merge additivo ricorsivo del boot aggiunge da sé. Le due regole
di esempio aggiunte a `sentinelRules.default.json5` sono commentate, quindi
l'array `rules` non cambia.

## ⚠ Un valore da guardare: `protectBrowserFingerprints`

Arriva a `true`, ed è il default giusto. Un'impronta **non è una persona**: è una
famiglia di client, e «Chrome 120 su Linux» è la stessa impronta per tutti quelli
che usano quel browser. Condannarla significa chiudere fuori loro, non
l'attaccante — è il modo più probabile in cui questa funzione rovina un sito.

**Il merge non sovrascrive un valore già presente.** Se in questa installazione la
chiave esistesse già a `false` — cosa possibile solo se qualcuno l'ha scritta a
mano, visto che arriva ora — resterebbe a `false`. Se non è una scelta
consapevole, va rimessa a `true`.

## Il limite, che vale la pena rileggere prima di usare la funzione

L'impronta la controlla **chi bussa**: randomizzando l'ordine degli header ne ha
una nuova a ogni richiesta, quindi una reputazione sempre pulita. La reputazione
ferma lo scanner *pigro* — la stragrande maggioranza del traffico ostile — non un
avversario determinato.

E non è un buco silenzioso: randomizzare le impronte fa esplodere il tasso di
sfratto del censimento, che ha la sua allerta. L'evasione da questa funzione ne
accende un'altra.

## Come si applica

```bash
npm run cli -- migrate sentinel --dry-run   # mostra cosa farebbe
npm run cli -- migrate sentinel             # applica
```

Il runner applica gli step **in catena**: un'installazione ferma a v1 riceve nell
ordine la regola del canary, quella sulla coerenza di sessione, e poi questi due
allineamenti del descrittore. La `schemaVersion` avanza solo a esito riuscito di
ciascuno step.
