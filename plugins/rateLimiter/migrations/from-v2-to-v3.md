# rateLimiter · da v2 a v3 — il tetto delle voci tracciate diventa configurabile

## Cosa cambia

Una chiave nuova in `custom`:

```json5
custom: {
  // ...
  maxTrackedEntries: 10000,
}
```

Nient'altro. Nessuna chiave rinominata, rimossa o cambiata di valore.

## Perché

Il motore tiene in memoria una voce per ogni coppia `IP|regola` che ha fallito, e un tetto serve
perché quella mappa non cresca senza limite sotto un attacco distribuito. Il tetto esisteva già
dalla v3.49.0, ma era una **costante nel codice**: 10 000 voci, non negoziabili.

È il valore sbagliato per due installazioni opposte. Chi ospita molte regole su molti indirizzi lo
raggiunge in esercizio normale e comincia a perdere contatori che gli servono; chi gira su una
macchina piccola potrebbe volerlo molto più basso di quanto il codice decida per lui. Un tetto di
sicurezza che l'amministratore non può toccare è un tetto che prima o poi è quello sbagliato.

Il default resta **10 000**, cioè esattamente il comportamento di prima: chi non tocca la chiave non
vede alcun cambiamento.

## Perché NON serve uno script

Questa migrazione è dichiarata `automatic: true` **senza** script, e la ragione è la stessa per cui
esiste il merge additivo del boot: una chiave **nuova** il boot la sa aggiungere da sé, a qualunque
profondità, lasciando intatti i valori esistenti. Uno script non avrebbe nulla da fare.

Lo step è dichiarato comunque — e non è una formalità. Il `migrationRunner` verifica che la catena
copra **l'intero** salto fra la `schemaVersion` del vivo e quella del `.default`: un salto senza step
dichiarato fa stampare al boot

```
[MIGRATE]  1 pacchetto/i con migrazioni non valide (ignorate):
   • plugins/rateLimiter: la catena non copre l'intero salto v2 → v3: mancano gli step per 1 versione/i
```

L'esito pratico sarebbe corretto comunque (il merge aggiunge la chiave), ma l'avviso dice che la
catena è rotta — e un box che grida al lupo su un aggiornamento sano insegna a non leggerlo.

## Cosa si perde

Niente.

## Verifica

Dopo il boot, nel vivo:

```bash
grep maxTrackedEntries plugins/rateLimiter/pluginConfig.json5
```

Dev'esserci, a `10000` (o al valore che hai scelto). E `schemaVersion` dev'essere a `3`.

## Nota

Il tetto non si applica mai alla voce **appena creata**: sfrattare quella che si sta scrivendo
renderebbe il contatore dei tentativi azzerabile a comando, cioè trasformerebbe una difesa in una
scorciatoia. Vale la pena saperlo se si imposta un `maxTrackedEntries` molto basso.
