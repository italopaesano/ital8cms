# adminAccessControl · da v3 a v4 — pattern ai segnaposti di percorso

## Cosa cambia

In `accessControl.json5` i pattern passano dai letterali ai **segnaposti di
percorso**, e le regole in forma pulita delle pagine di `pluginPages` spariscono
perché ora si **derivano**.

| Prima (v3) | Dopo (v4) |
|---|---|
| `"/admin"` · `"/admin/**"` | `"{{admin}}"` · `"{{admin}}/**"` |
| `".../login.ejs"` **e** `".../login"` | solo `"{{pluginPages}}/adminUsers/login.ejs"` |
| `".../logout.ejs"` **e** `".../logout"` | solo `"{{pluginPages}}/adminUsers/logout.ejs"` |
| `".../userProfile.ejs"` **e** `".../userProfile"` | solo `"{{pluginPages}}/adminUsers/userProfile.ejs"` |
| `".../access-denied.ejs"` **e** `".../access-denied"` | solo `"{{pluginPages}}/adminAccessControl/access-denied.ejs"` |

Dieci regole dichiarate diventano **sei**. Il ruleset *in vigore* resta
identico: con `hideExtension.pluginPagesPrefix` attivo le quattro forme pulite
vengono ricostruite al caricamento (verificato: 10 pattern attivi, 4 derivati,
zero problemi).

## Perché serve una migrazione e non basta il boot

Il merge additivo del boot sa solo **aggiungere** chiavi. Qui il lavoro è
l'opposto: le chiavi delle regole vengono **rinominate** e quattro vengono
**rimosse**. Due operazioni che il merge non sa fare, per costruzione — ed è la
ragione per cui esiste il meccanismo delle migrazioni.

Per lo stesso motivo `accessControl.default.json5` conserva la propria
`schemaVersion: 3`: bumparla farebbe scattare la riconciliazione additiva su una
coppia che non ha nulla da aggiungere, con un `unresolved` fuorviante. Il clock
è la `schemaVersion` del **descrittore**, che passa da 3 a 4.

## Cosa succede se non si applica

**L'installazione resta funzionante.** I letterali continuano a essere accettati
(retrocompatibilità dichiarata in D2) e il `baseline` di zona protegge il
pannello comunque, qualunque sia `adminPrefix`.

Ma le regole esplicite sul pannello diventano **inerti** appena `adminPrefix` non
è più quello di default: puntano a un prefisso che non esiste. Il file
descriverebbe una protezione che non è quella in vigore — la forma residua del
difetto **A1** di `REVIEW.md`. Non è un buco di sicurezza, è un file che mente.

## Cosa fa lo script

`from-v3-to-v4.js`, automatico e **idempotente**:

1. rinomina le sei chiavi elencate sopra;
2. rimuove il blocco delle quattro regole in forma pulita, portandosi via anche
   la riga di commento che le accompagnava (altrimenti resterebbe orfana);
3. scrive in modo **atomico** (temp + `rename`).

Tocca **solo** le quattro pagine spedite col plugin. Una regola in forma pulita
che l'amministratore ha aggiunto per una pagina sua non viene toccata: non è il
duplicato di niente.

### Perché testuale, e perché fail-soft

**Testuale** perché i commenti del file vivo sono metà del suo valore — 91 righe
su un file appena materializzato — e una riserializzazione dell'oggetto li
perderebbe tutti. È il motivo per cui la decisione D1 impone
`setJson5Key`/`editJson5` al posto di `saveJson5`; qui nemmeno quelli bastano,
perché le chiavi cambiano **nome**.

**Fail-soft** perché su un file riformattato o personalizzato gli ancoraggi non
combaciano. In quel caso lo script salta la singola sostituzione e la
**dichiara**, invece di riscrivere a tentoni un file di sicurezza. Il risultato
peggiore possibile è un file che resta come era — funzionante — accompagnato
dall'elenco di ciò che va convertito a mano.

## Come si applica

```bash
npm run cli -- migrate adminAccessControl --dry-run   # mostra cosa farebbe
npm run cli -- migrate adminAccessControl             # applica
```

Il runner crea un backup dei file in `touches` prima dello step, e avanza la
`schemaVersion` del descrittore **solo a esito riuscito**: è una ricevuta, non un
contatore di tentativi.

Con `ital8Config.json5 → migrations.autoApply: true` lo step viene applicato dal
boot; di default (`false`) il boot lo **rileva** e basta, con il box `[MIGRATE]`.

## Se preferisci non applicarla

Non succede nulla di rotto, per le ragioni in *Cosa succede se non si applica*.
La `schemaVersion` del descrittore vivo resta a 3 e il box `[MIGRATE]` continuerà
a segnalare lo step pendente a ogni boot. Per convertire a mano basta rinominare
le sei chiavi e cancellare le quattro regole in forma pulita: il risultato è
quello che lo script produce.
