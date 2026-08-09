# sentinel · da v1 a v2 — regola del token esca

## Cosa cambia

Il plugin introduce i **token esca** (canary): il segnaposto `{{canary}}` dentro
un decoy conia un token che esiste solo in quella risposta, e la foglia `canary`
lo riconosce quando torna indietro.

Perché tutto questo produca una riga di log, un contatore e un percorso di
promozione serve una regola in `sentinelRules.json5`:

```json5
{ name: "canary-token-used", action: "monitor", match: { canary: true } }
```

## Perché serve una migrazione e non basta il boot

`reconcileSchemaVersions` riconcilia anche le coppie secondarie di un plugin, e
quindi **vede** `sentinelRules.default.json5` ↔ `sentinelRules.json5`. Ma tratta
gli **array come valori**, non come contenitori da fondere.

È la scelta giusta — fondere array significherebbe indovinare la posizione e
sovrascrivere l'ordine deciso dall'amministratore, che in un file di regole *è*
la priorità — ma ha una conseguenza precisa: `rules` è un array, quindi **una
regola nuova distribuita col plugin non raggiunge mai un'installazione
esistente**.

> È lo stesso difetto di `menuOrder` in v2.72.0.

Da notare: il *segnale* del canary non dipende da questa regola. La riga di log
di allerta e la notifica partono comunque, per scelta esplicita — l'unico segnale
certo del plugin non deve dipendere da una riga di un file modificabile dalla
GUI. Quello che manca senza la regola è la classificazione dell'evento, il
contatore, e la possibilità di promuoverla a `block` con `escalate.ban`.

## Cosa fa lo script

`from-v1-to-v2.js` inserisce la regola in `sentinelRules.json5`:

- **idempotente** — se una regola con quel nome c'è già, non fa nulla;
- **inserimento testuale**, non `setJson5Key(path, 'rules', …)`: quello
  riscriverebbe l'intero array da una serializzazione, cancellando le cornici di
  sezione e le descrizioni — metà del valore del file;
- **verifica differenziale** prima di scrivere: si parsa il testo risultante e si
  pretende che ci sia esattamente una regola in più, con il nome atteso, nella
  posizione attesa, e tutte le altre intatte e nello stesso ordine. Se non torna,
  il file non viene toccato;
- **scrittura atomica** (temp + rename).

### Dove viene inserita, e perché non in fondo

Subito **dopo la whitelist**, cioè in testa alla sezione delle rilevazioni — la
stessa posizione che ha nel file distribuito.

Accodarla sarebbe stato un errore silenzioso: con first-match-wins una regola in
fondo arriva dopo `backup-probe`, che matcha `.tar.gz`, e uno dei decoy
distribuiti consegna il token proprio dentro un finto `backup-….tar.gz`. La
regola esisterebbe e non scatterebbe mai su metà dei casi.

## Come si applica

```bash
npm run cli -- migrate sentinel --dry-run   # mostra cosa farebbe
npm run cli -- migrate sentinel             # applica
```

Il boot **rileva** la migrazione pendente e la segnala con un box `[MIGRATE]`, ma
non la applica da solo a meno che `ital8Config.json5 → migrations.autoApply` sia
`true`. Un backup del file toccato viene creato prima dell'esecuzione.

## Se preferisci non applicarla

Nessun danno: il filtro continua a funzionare esattamente come prima, e i token
esca restano comunque segnalati nel log e via allerta. Puoi aggiungere la regola
a mano dall'editor JSON5 di `adminSentinel`, ricordandoti di metterla **sopra**
`backup-probe`.
