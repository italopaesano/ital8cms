# adminConfig · da v1 a v2 — sezione admin del filtro sentinel

## Cosa cambia

Il plugin `adminSentinel` introduce la sezione admin `sentinelManagement`, che va
dichiarata in due posti di `core/admin/adminConfig.json5`:

- `sections.sentinelManagement` — i metadata della sezione (label, icona, plugin
  che la gestisce);
- `menuOrder` — l'ordine con cui le voci compaiono nel menu.

## Perché serve una migrazione e non basta il boot

Il merge additivo eseguito al boot (`reconcileSchemaVersions`) scende
ricorsivamente negli oggetti e aggiunge le chiavi nuove a qualsiasi profondità:
**`sections.sentinelManagement` arriva da solo**, senza bisogno di nulla.

Gli **array** però sono trattati come valori, non come contenitori da fondere. È
la scelta giusta — fondere array significherebbe indovinare la posizione e
sovrascrivere un ordine che l'amministratore può aver personalizzato — ma ha una
conseguenza precisa qui: `menuOrder` è un array, e `core/admin/adminSystem.js`
costruisce il menu **iterando proprio quello**.

Senza questo passo, su un'installazione già esistente la sezione risulterebbe
presente nel config e **invisibile nel pannello**. Nessun errore, niente nei log:
si scoprirebbe solo quando qualcuno chiede dove sia finita la voce.

> È lo stesso difetto emerso in v2.70.1 con le regole di `accessControl`, che
> allora arrivò in produzione. Qui è colto prima.

## Cosa fa lo script

`from-v1-to-v2.js` accoda `"sentinelManagement"` a `menuOrder`, e solo questo:

- **idempotente** — se la voce c'è già, non fa nulla;
- **rispettoso dell'ordine** — non riordina le voci presenti, aggiunge in coda;
- usa `setJson5Key` e non `saveJson5` dell'oggetto intero, che perderebbe i
  commenti del config vivo.

## Come si applica

```bash
npm run cli -- migrate adminConfig --dry-run   # mostra cosa farebbe
npm run cli -- migrate adminConfig             # applica
```

Il boot **rileva** la migrazione pendente e la segnala con un box `[MIGRATE]`, ma
non la applica da solo a meno che `ital8Config.json5 → migrations.autoApply` sia
`true`. Un backup del file toccato viene creato prima dell'esecuzione.

## Come verificare l'esito

```bash
npm run cli -- status          # il server risponde
```

Poi nel pannello admin: la voce **🔭 Sentinel** compare nel menu. In alternativa,
a mano:

```bash
grep -A 20 'menuOrder' core/admin/adminConfig.json5
```

`sentinelManagement` deve comparire nell'elenco.

## Se qualcosa va storto

Il file è git-ignored e rigenerabile dal proprio `.default`:

```bash
rm core/admin/adminConfig.json5     # rigenerato al boot successivo
```

Le personalizzazioni fatte a mano su quel file andrebbero però perse: prima di
farlo, controlla il backup creato automaticamente dal runner.
