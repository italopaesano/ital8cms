# sentinel · da v3 a v4 — tetti di drop e tarpit

## Cosa cambia

Il plugin impara due azioni che costano risorse **anche a chi le usa**: `drop`
tronca la connessione senza rispondere, `tarpit` la trattiene a gocce. Entrambe
hanno bisogno di tetti, perché ogni connessione trattenuta è un socket e un timer
nostri:

```json5
"tarpit": {
  "maxConcurrent": 50,   // oltre questo numero si degrada al 404 comune
  "maxSeconds": 30,      // durata massima, qualunque cosa chieda la regola
  "intervalMs": 1000,    // cadenza delle gocce
}
```

## Perché non serve uno script

Sono chiavi nuove **dentro un oggetto**, e il merge additivo ricorsivo del boot
(`reconcileSchemaVersions`) sa aggiungerle da sé, lasciando intatti i valori già
presenti. È il caso più frequente e più tranquillo di migrazione: dichiarata per
tenere la catena contigua, non perché ci sia lavoro da fare.

`sentinelRules.default.json5` è cresciuto di 43 righe nello stesso intervento, ma
sono **tutte commenti**: gli esempi di regola per `drop` e `tarpit` restano
commentati per scelta — il set distribuito non deve agire su nessuno finché
l'amministratore non ha guardato i propri dati — quindi l'array `rules` non è
cambiato e non c'è nulla da inserire.

## Perché allora esiste questo step

Perché il runner non guarda se serva uno script: guarda se la **catena copre il
salto**. Il passo 7 aveva bumpato la `schemaVersion` del descrittore senza
dichiarare nulla, convinto — a ragione — che il merge bastasse. Ma con il
descrittore a v5 e gli step fermi a v3, `pending.length` non poteva mai
uguagliare `target - liveVersion`, e ogni installazione riceveva un box
`[MIGRATE]` di errore a ogni avvio che nulla poteva chiudere.

Peggio: `npm run cli -- migrate sentinel` si rifiutava di girare del tutto,
**inclusi i due step veri** (v1→v2 e v2→v3). Una catena bucata non ferma solo sé
stessa, ferma tutto quello che viene dopo.

## Come si applica

```bash
npm run cli -- migrate sentinel --dry-run   # mostra cosa farebbe
npm run cli -- migrate sentinel             # applica
```

## Se usi `drop` dietro un reverse proxy

Non funziona, e il validatore lo dice: il socket troncato sarebbe quello verso il
proxy, che risponderebbe `502` al client — più rumoroso di un `404`. Con
`trustProxy: true` l'azione degrada da sé al blocco comune.
