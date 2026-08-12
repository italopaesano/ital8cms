# sentinel · da v2 a v3 — regola sulla coerenza di sessione

## Cosa cambia

Il plugin impara a sorvegliare le **sessioni autenticate**: la prima richiesta di
una sessione fissa una linea di base (User-Agent, impronta, indirizzo) e le
successive vengono confrontate con quella. La foglia `sessionAnomaly` espone il
risultato alle regole.

Perché serva a qualcosa occorre una regola che la guardi:

```json5
{
  name: "session-hijack-signal",
  action: "monitor",
  appliesTo: "authenticated",
  match: { sessionAnomaly: ["uaChanged", "scriptClient"] },
}
```

## Perché serve una migrazione e non basta il boot

Stessa ragione dello [step precedente](./from-v1-to-v2.md): `rules` è un array, e
il merge additivo del boot tratta gli array come valori.

Qui però la conseguenza è più netta. Il canary, senza la sua regola, resta
comunque segnalato (log e allerta partono a prescindere). Le anomalie di
sessione no: verrebbero **calcolate a ogni richiesta autenticata e buttate via**,
perché nessuna regola le guarda. Lavoro fatto e gettato, in silenzio.

## Cosa fa lo script

`from-v2-to-v3.js` inserisce la regola con lo stesso meccanismo dello step
precedente (testuale, idempotente, con verifica differenziale e scrittura
atomica), ma con un'**ancora esplicita**: va inserita *dopo*
`canary-token-used`.

Senza l'ancora finirebbe subito dopo la whitelist, cioè **sopra** la regola
inserita dallo step precedente, e un'installazione migrata avrebbe le due regole
in ordine inverso rispetto a una nuova. Nessuna delle due posizioni è sbagliata
nei fatti — una richiesta che porta un canary *e* ha una sessione anomala è
un'eventualità remota — ma una divergenza fra installazione migrata e
installazione fresca è il genere di differenza che poi confonde chi debugga.

Se `canary-token-used` non c'è (è stata cancellata dall'amministratore), si
ricade sulla posizione di default: dopo la whitelist.

## Cosa NON fa

Non tocca `pluginConfig.json5`. Il blocco `custom.sessionCoherence` è
un'**aggiunta** di chiavi dentro un oggetto, e quella il merge additivo del boot
la sa fare da solo: arriva senza bisogno di uno script.

## Come si applica

```bash
npm run cli -- migrate sentinel --dry-run   # mostra cosa farebbe
npm run cli -- migrate sentinel             # applica
```

Il runner applica gli step **in catena**: un'installazione ferma a v1 riceve
prima la regola del canary e poi questa, nell'ordine giusto. La `schemaVersion`
avanza solo a esito riuscito di ciascuno step.

## Prima di promuoverla a `block`

Questa è la prima regola distribuita che, promossa, può **chiudere fuori un
utente autenticato**. Prima che agisca devono cadere tre tetti, e i default ne
lasciano in piedi due:

| Tetto | Default | Effetto |
|---|---|---|
| `custom.mode` | `monitor` | nessuna regola agisce |
| `custom.authenticatedTraffic.mode` | `monitor` | nessuna regola agisce **sugli autenticati** |
| stato del gate | `running` | commutabile a caldo con `npm run cli -- sentinel monitor` |

E i ruoli in `authenticatedTraffic.enforceExemptRoles` (default `[0, 1]` —
root e admin) restano **osservati ma mai bloccati**, in ogni configurazione.
