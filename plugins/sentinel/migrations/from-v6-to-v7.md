# sentinel · da v6 a v7 — i path NOSTRI di `auth-surface-noise` ai segnaposti

## Cosa cambia

Nella regola `auth-surface-noise`, la lista dei path passa dai letterali ai
**segnaposti di percorso**:

| Prima | Dopo |
|---|---|
| `"/api/adminUsers/login"` | `"{{api}}/adminUsers/login"` |
| `"/api/adminUsers/logout"` | `"{{api}}/adminUsers/logout"` |
| `"/pluginPages/adminUsers/**"` | `"{{pluginPages}}/adminUsers/**"` |

**Nient'altro.** I circa venti pattern di tecnologie altrui — `/wp-admin/**`,
`/phpmyadmin/**`, `/.env`, `/typo3/**` — restano letterali, ed è giusto: non
sono zone di ital8cms e non seguono alcuna sua configurazione. I segnaposti
servono ai percorsi **nostri**.

## Perché

`auth-surface-noise` è la sola regola distribuita che nomina percorsi del CMS, e
li nominava come **testo** mentre `apiPrefix` e `pluginPagesPrefix` sono
**variabili** di `ital8Config.json5`. Chi li cambia ottiene una regola che non
osserva più niente, e nulla lo segnala: la regola resta nel file, valida e
inerte. È la classe di difetto registrata in
[`REVIEW.md`](../../../REVIEW.md) → **A1**, chiusa da
[`path-zones.it.md`](../../../docs/decisions/path-zones.it.md).

Da v3.30.0 `loadRules()` risolve i segnaposti **prima** della validazione: il
validatore rifiuta un path che non cominci con `/`, quindi un `{{api}}/…` non
arriverebbe mai in fondo. Il validatore continua così a vedere solo path
concreti — ed è giusto che sia lui a giudicarli, perché è lui che conosce ReDoS
e forma.

## Perché serve una migrazione e non basta il boot

`rules` è un array, e il merge additivo del boot lo tratta come un valore
opaco — come per gli step 1→2, 2→3 e 5→6 di questo stesso pacchetto.

## Cosa fa lo script

Una sostituzione **uno-a-uno** della riga, ancorata al suo testo esatto. Come lo
step 5→6, **rinuncia senza toccare nulla** se non trova quel testo: la regola
può essere stata modificata, riformattata o rimossa, e un intervento testuale su
un file che l'amministratore può aver riscritto deve ancorarsi a un testo certo
invece di riscrivere a tentoni. In quel caso emette un avviso che nomina i
percorsi da convertire a mano.

È **idempotente**: dopo il primo passaggio la riga di partenza non esiste più, e
lo script riconosce quella convertita.

## Cosa si perde

Niente. I letterali continuano a essere accettati dal motore
(retrocompatibilità, D2), quindi una regola non convertita resta funzionante:
semplicemente non segue la configurazione.

## Se preferisci non applicarla

Puoi. `auth-surface-noise` è distribuita in `action: "monitor"`, quindi il costo
immediato è solo di osservazione — ma è esattamente l'osservazione su cui si
decide se promuoverla, e una regola che non matcha produce zero hit, cioè
sembra innocua per il motivo sbagliato.

## Verifica

```bash
npm run cli -- migrate sentinel --dry-run
npm run cli -- migrate sentinel
npm run cli -- sentinel test /api/adminUsers/login   # la regola deve comparire
```

## Nota

`sentinelRules.default.json5` conserva la propria `schemaVersion: 1`: il clock è
il descrittore, e bumpare anche il secondario farebbe scattare una
riconciliazione additiva che non ha nulla da aggiungere, segnalando un
`unresolved` fuorviante.
