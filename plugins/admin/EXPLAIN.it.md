<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# admin — Deep-dive tecnico

Il plugin `admin` raccoglie le funzionalità di back-office del pannello: gestione
pagine, plugin, temi, impostazioni di sistema e **installazione di plugin/temi da
repository Git**.

> ⚠️ **Copertura di questo documento.** È approfondita la sola **installazione da
> repo Git** (`pluginsInstall.js` / `themesInstall.js`), il sottosistema più
> delicato del plugin e quello riscritto nella v2.64.0. Gli altri moduli hanno per
> ora una mappa di una riga ciascuno: completarli è una voce aperta in
> [`TODO.md`](../../TODO.md).

## Mappa dei moduli

| File | Ruolo |
|---|---|
| `main.js` | punto d'ingresso: aggrega le rotte dei moduli sottostanti |
| `pluginsInstall.js` | installazione di un plugin da repo Git (clone, materializzazione, validazione, finalizzazione) |
| `themesInstall.js` | gemello per i temi, con la gestione della collisione/sovrascrittura |
| `pluginsManagment.js` | elenco, dettaglio, attivazione/disattivazione dei plugin installati |
| `themesManagment.js` | elenco, dettaglio e attivazione dei temi |
| `pagesManagment.js` | gestione delle pagine del sito |
| `systemSettings.js` | impostazioni di sistema esposte in GUI |

---

## Installazione da repository Git

### Il contratto: il `.default` è la sola fonte di verità

Un repo installabile committa **solo i sidecar `x.default.json5`**; i `x.json5`
vivi sono generati dall'installazione e **non vanno pubblicati**. È lo stesso
modello dei pacchetti bundled ([`config-lifecycle.it.md`](../../docs/decisions/config-lifecycle.it.md) §1).

| Nel repo | Esito |
|---|---|
| `pluginConfig.default.json5` presente | ✅ installazione procede |
| solo `pluginConfig.json5` vivo | ❌ **rifiutata**: manca il default |
| **entrambi** | ⚠️ il vivo viene **scartato** e rigenerato dal default (warning) |
| un `x.json5` **senza** `.default` accanto | lasciato intatto (è contenuto o stato runtime, non un config del ciclo di vita) |

Prima della v2.64.0 valeva l'opposto — l'installazione pretendeva il file **vivo** —
e un pacchetto conforme allo standard veniva **rifiutato**, con la cartella appena
clonata rimossa dal rollback. Chi mantiene plugin/temi di terze parti pubblicati
prima di quella versione deve rinominare il descrittore in `.default`, togliere
`isInstalled` (e `active` nei temi) e aggiungere `schemaVersion: 1` come prima chiave.

### Le fasi del job

L'installazione è **asincrona**: il client riceve un `installId` e fa polling sullo
stato. Ogni fase è registrata in `job.phases` e mostrata nella GUI.

```
parseUrl → checkDestination → cloneStart → cloneDone
         → materializeConfigs → validate → finalizeConfig
```

1. **`parseUrl`** — il nome del repo deve iniziare col prefisso configurato
   (`ital8cms-plugin-` / `ital8cms-theme-`); quel che segue diventa il nome del
   pacchetto e deve combaciare col campo `name` del descrittore.
2. **`checkDestination`** — la cartella di destinazione non deve esistere (per i
   temi è ammessa la sovrascrittura previa conferma esplicita).
3. **`cloneStart` / `cloneDone`** — `git clone --progress --depth 1`; l'output di
   progress su stderr è parsato riga per riga e ritrasmesso al client (throttle
   100 ms, coerente con un polling a 400 ms).
4. **`materializeConfigs`** — pretende il `.default`, scarta gli eventuali vivi
   committati per errore e materializza **tutti** i config del pacchetto, non solo
   il descrittore. Delega ai moduli core del ciclo di vita
   (`resetConfigsToDefault` + `materializeDirDefaults`).
5. **`validate`** — file richiesti, JSON5 parsabile, `name` coerente, convenzione
   admin (`adminSections` per i plugin `admin*`), `isAdminTheme` per i temi, e
   `require(main.js)` per verificare che il modulo si carichi.
6. **`finalizeConfig`** — scrive `active`/`isInstalled` (plugin) o `isInstalled: 0`
   (temi, l'attivazione resta una scelta dell'admin) con **`setJson5Key`**, che
   preserva commenti e formattazione del vivo appena materializzato.

**Rollback:** qualunque fallimento dopo il clone rimuove la cartella creata. Se
anche il rollback fallisce, il job lo dichiara esplicitamente — l'utente vedrebbe
altrimenti "failed" con i file ancora su disco, potenzialmente funzionanti al
prossimo boot.

### Perché i due moduli sono duplicati e non condivisi

`pluginsInstall.js` e `themesInstall.js` hanno strutture parallele e ripetono
diverse funzioni (parser del progress, audit log, gestione dei job,
`materializeConfigFile`). È una scelta: i due flussi divergono in punti
sostanziali — collisione con sovrascrittura solo per i temi, `adminSections` e
dipendenze npm solo per i plugin, semantica opposta di `isInstalled` — e un modulo
condiviso diventerebbe un groviglio di condizionali. La duplicazione di poche
decine di righe li tiene disaccoppiati e leggibili.

Il costo è che **una modifica va replicata in entrambi**: i test unit sono scritti
in coppia proprio per far emergere subito una divergenza.

### Sicurezza del clone

- Tre formati di URL: HTTPS pubblico, HTTPS con credenziali inline, SSH.
- **SSH è riservato al ruolo root (0).** Il clone via SSH usa la chiave del server,
  quindi eredita l'identità della macchina: senza la restrizione, un admin (ruolo 1)
  potrebbe far clonare repo a cui solo il server ha accesso — un *confused deputy*.
  HTTPS resta `[0, 1]` perché le credenziali, se servono, le porta l'admin.
- È una mitigazione **volutamente parziale**: audit log completo, whitelist di host
  e flag di disabilitazione sono voci aperte in [`TODO.md`](../../TODO.md).
- `GIT_TERMINAL_PROMPT=0` e `GIT_ASKPASS=echo` impediscono al clone di restare
  appeso in attesa di credenziali su un processo headless.
- Un lock globale ammette **una sola installazione alla volta**.

### Dry-run

Con `debugMode >= 1` la GUI espone un dry-run che simula tutte le fasi con eventi
di progress realistici, senza rete né scritture. Serve a validare il client
(progress bar, polling, rendering) senza dipendere da un repository esterno.

## Dopo l'installazione

Il pacchetto è su disco ma **non ancora caricato**: serve un riavvio. La GUI
rileva il supervisor (PM2, nodemon, o nessuno) e avverte di conseguenza, perché
senza un supervisor esterno l'endpoint di restart **ferma** il server invece di
riavviarlo.

Un plugin con dipendenze npm dichiarate viene installato **disattivato**
(`active: 0`): le dipendenze vanno risolte prima di attivarlo.

## Documenti collegati

- [`docs/decisions/config-lifecycle.it.md`](../../docs/decisions/config-lifecycle.it.md) — sidecar `.default`, stati dei plugin, boot graceful
- [`docs/decisions/config-migrations.it.md`](../../docs/decisions/config-migrations.it.md) — evoluzione dei config di un pacchetto già installato
- [`core/EXPLAIN-pluginsSys.it.md`](../../core/EXPLAIN-pluginsSys.it.md) — cosa succede al pacchetto ai boot successivi
