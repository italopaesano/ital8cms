# rateLimiter · da v1 a v2 — `exemptPaths` passa ai segnaposti

## Cosa cambia

In `custom.enforcement.exemptPaths` i percorsi distribuiti passano dai letterali ai **segnaposti di
percorso**: il prefisso concreto lascia il posto al nome della zona, che il CMS
risolve al caricamento leggendo `ital8Config.json5`.

| Prima | Dopo |
|---|---|
| `"/admin/**"` | `"{{admin}}/**"` |
| `"/public-theme-resources/**"` | `"{{publicThemeResources}}/**"` |
| `"/admin-theme-resources/**"` | `"{{adminThemeResources}}/**"` |

**Qui la posta è più alta che altrove.** `exemptPaths` esiste per non
auto-bloccare l'amministratore sul pannello: un letterale che smette di
combaciare non produce « una regola che non protegge » ma « l'amministratore si
fa limitare sul proprio pannello », cioè gli toglie lo strumento con cui
correggerebbe la cosa.

Nella stessa versione il middleware ha smesso di confrontare il path **grezzo** e
toglie il `globalPrefix` prima del match, come già facevano `accessManager` e
`sentinel`: il commento che chiedeva di « adeguare questi percorsi se usi un
globalPrefix non vuoto » è stato rimosso perché non serve più.

## Perché

Un letterale è **testo**; il prefisso a cui punta è una **variabile**. Nessun
codice teneva allineate le due cose, quindi cambiare `adminPrefix` (o
`apiPrefix`, o `pluginPagesPrefix`) lasciava quei percorsi a puntare a un
prefisso che non esiste più — e il file continuava a descrivere un comportamento
diverso da quello in vigore. È la classe di difetto registrata in
[`REVIEW.md`](../../../REVIEW.md) → **A1**, chiusa da
[`path-zones.it.md`](../../../docs/decisions/path-zones.it.md).

## Perché serve una migrazione e non basta il boot

Il merge additivo di `reconcileSchemaVersions` sa solo **aggiungere chiavi**. Qui
le chiavi sono le stesse e cambiano i **valori dentro un array** — e gli array il
merge li tratta come valori opachi, giustamente: fonderli significherebbe
indovinare l'ordine e sovrascrivere le scelte dell'amministratore.

## Cosa fa lo script

1. Legge il config **vivo**.
2. Converte un elemento **solo se è esattamente uno di quelli distribuiti**.
3. Lascia tutto il resto dov'è e com'è — percorsi aggiunti, modificati,
   riordinati — e **dichiara** ciò che non ha convertito.
4. Scrive con `setJson5Key` sul path annidato, che preserva i commenti del vivo.

È **idempotente**: i segnaposti non sono fra i letterali da convertire, quindi
una seconda esecuzione non fa niente.

## Cosa si perde

Niente. L'ordine dell'array è preservato, e i letterali continuano a essere
accettati dal motore (retrocompatibilità, D2 della decisione): un elemento non
convertito resta funzionante, semplicemente non segue la configurazione.

## Se preferisci non applicarla

Puoi: i letterali restano validi. Il costo è che quei percorsi non seguiranno un
prefisso non di default, e che il file descriverà qualcosa di diverso da ciò che
accade. Per convertirli a mano basta sostituire il prefisso col nome della zona
fra doppie graffe.

## Verifica

```bash
npm run cli -- migrate rateLimiter --dry-run   # cosa farebbe
npm run cli -- migrate rateLimiter             # applica
```

## Nota

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto. Vedi
[`config-migrations.it.md`](../../../docs/decisions/config-migrations.it.md).
