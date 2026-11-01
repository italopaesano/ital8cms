# seo · da v1 a v2 — `robotsTxtRules.disallow` passa ai segnaposti

## Cosa cambia

In `custom.robotsTxtRules.disallow` i percorsi distribuiti passano dai letterali ai **segnaposti di
percorso**: il prefisso concreto lascia il posto al nome della zona, che il CMS
risolve al caricamento leggendo `ital8Config.json5`.

| Prima | Dopo |
|---|---|
| `"/admin/"` | `"{{admin}}/"` |
| `"/api/"` | `"{{api}}/"` |
| `"/pluginPages/"` | `"{{pluginPages}}/"` |

**robots.txt vive in un altro spazio di path.** Gli altri consumatori di
segnaposti *confrontano* un percorso con la richiesta in arrivo, dopo aver tolto
il `globalPrefix`. Qui i percorsi vengono **emessi** in un file che i crawler
leggono sul sito reale, quindi il `globalPrefix` va **anteposto** — e prima `seo`
non lo faceva affatto: `Disallow: /admin/` su un'istanza montata sotto `/mysite`
non escludeva niente. La correzione sta nel codice
(`lib/robotsTxtGenerator.js` → `toServedPaths`) e arriva da sé; questa migrazione
sposta solo i valori.

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
4. Scrive con `setJson5Key` sul path annidato, che preserva i commenti del vivo —
   **anche quelli DENTRO l'array**, da v3.33.0.

> **Perché « anche quelli dentro », e perché solo da v3.33.0.** Fino alla v3.32.0
> `setJson5Key` delegava a `editJson5`, che sostituiva il **blocco** dell'array e
> con esso ogni commento interno: un amministratore che aveva annotato una propria
> voce la perdeva. Ora `editJson5` ricorre **per indice** quando la lunghezza
> dell'array non cambia — e qui non cambia mai, perché lo script usa
> `declared.map(...)`, che per costruzione restituisce un array della stessa
> lunghezza. L'affermazione è quindi vera **senza riserve per questa migrazione**:
> non perché il caso difficile non esista, ma perché questa migrazione non lo
> produce. → [`json5-key-operations.it.md`](../../../docs/decisions/json5-key-operations.it.md)

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
npm run cli -- migrate seo --dry-run   # cosa farebbe
npm run cli -- migrate seo             # applica
```

## Nota

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto. Vedi
[`config-migrations.it.md`](../../../docs/decisions/config-migrations.it.md).
