<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 2 · ref -->
> 🌐 Italian reference edition (always up to date). English `self-update.md` is a stub until release.
# Self-update, backup & restore — ital8cms

Sistema di **aggiornamento del CMS** e di **backup/restore**, guidato da terminale
(script esterni al processo del server). Uno script esterno non è il server:
può fermarlo, allineare i file, reinstallare le dipendenze e lasciare che tu lo
riavvii — senza il problema di un processo che tenta di aggiornare se stesso.

## Comandi

```bash
npm run update            # aggiorna all'ultima release GitHub (o --tag <v>)
npm run backup            # crea uno snapshot dell'installazione in backups/
npm run backup-list       # elenca gli snapshot
npm run backup-manager    # gestisce gli snapshot (elimina/pruna; interattivo)
npm run restore           # ripristina da uno snapshot (--latest | --name <n>)
npm run deps-sync         # riconcilia le dipendenze npm di plugin/temi
```

Tutti accettano `--help`. Gli script di backup/restore usano **solo built-in di
Node** (niente dipendenze npm): restano usabili anche se `node_modules` è rotto —
esattamente quando serve un restore.

## `npm run update` — flusso

Strategia **B (git)**: `git fetch --tags && git checkout <tag>` allinea i file
**tracciati** alla release (gestisce aggiunte/rinomine/rimozioni) e **non tocca**
i file untracked/ignored — i tuoi dati (config vivi, `www/`, media, account,
`node_modules`, plugin installati a mano). Rete di sicurezza in stile C: backup
pre-update + `node_modules` vecchio conservato per un **rollback offline**.

| Fase | Cosa fa |
|------|---------|
| PREFLIGHT | git disponibile · è un repo git · nessun lock · server sotto supervisor? → **stop + istruzioni** · working tree **tracciato** pulito (modifiche locali a file ufficiali → stop) |
| DISCOVER | ultima release semver via `git ls-remote` (o `--tag` esplicito) + confronto con la versione corrente |
| CONFIRM | conferma (salvo `--yes`); `--dry-run` mostra il piano ed esce |
| FETCH | `git fetch --tags` — **prima** dello stop: un errore di rete non lascia il server giù |
| BACKUP | snapshot pre-update |
| STOP | ferma il server self-managed (SIGTERM → `gracefulShutdown`) |
| APPLY | sposta `node_modules` da parte (rollback offline) · `git checkout <tag>` |
| DEPS | `npm install` (o `--clean` → `npm ci`); il **postinstall** del target lancia `deps-sync` |
| SMOKE | `node --check index.js` + risoluzione dei moduli core |
| ROLLBACK | su errore in APPLY/DEPS/SMOKE → `git checkout <ref-vecchio>` + ripristino di `node_modules` (offline) |
| FINALIZE | successo → libera lo spazio del rollback · **istruzioni di riavvio** |

**Simmetria:** lo script **non riavvia mai** da sé. A fine update stampa
`Riavvia con: npm start`. Coerente col caso supervisor (vedi sotto).

**Flag:** `--tag <v>` (versione esplicita) · `--clean` (`npm ci`) · `--dry-run` · `--yes`.

### systemd / pm2 / supervisor

Se il server è avviato sotto un supervisor (rilevato via `status.supervisor` sul
socket del control plane), l'updater **non lo ferma** (verrebbe riavviato):
si arresta e ti chiede di fermarlo a mano —
`sudo systemctl stop <servizio>` (o `pm2 stop <app>`) — poi rilanci l'update, e a
fine lavoro riavvii con lo stesso supervisor. Solo lo scenario **self-managed**
(bare `node index.js`) viene fermato/riavviato automaticamente (v1).

### Convenzione dei tag di release

I tag `vX.Y.Z[-pre]` sono confrontati con semver. La convenzione prerelease
"parola-numero" (`beta-3`) è **normalizzata** in "parola.numero" (`beta.3`) per il
solo confronto, così i tag storici e quelli nuovi ordinano coerentemente (il tag
originale è usato per il checkout). I tag non-semver sono segnalati e ignorati nel
calcolo della latest; `--tag` esplicito bypassa la discovery.

## Backup / restore

Uno snapshot è una **cartella** in `backups/<timestamp>/` con `tree/` (la copia)
e `manifest.json` (versione, sha git, node, cosa include). Esclusi di default:
`node_modules` (`--with-node-modules` per includerli), `backups/`, `.git`
(`--no-git`), `*.sock`. I dati utente e i config vivi (git-ignored) **sono**
nello snapshot: sono la parte che conta preservare.

- **`restore`** ripristina in **overlay** (i file dello snapshot sovrascrivono i
  correnti; ciò che non è nello snapshot — es. `node_modules` — resta intatto).
  Prima crea un backup di sicurezza `pre-restore`, gestisce il gate supervisor e
  ferma il server self-managed, poi stampa le istruzioni di riavvio.
- **`backup-manager`** elimina/pruna (retention). `backup-list` è sola lettura.

## Modello delle dipendenze npm (ibrido, per-plugin)

Node risolve `require('lib')` risalendo l'albero: `plugins/x/node_modules` **prima**
della root. Questo abilita due modelli, coesistenti per costruzione:

- **Plugin/tema self-contained** — ha un proprio `package.json`; le sue deps
  vivono in `plugins/x/node_modules` (git-ignored, preservate dagli update, mai
  "pruned" dall'install di root). Installate da `npm install` **dentro** la cartella.
  Pilota: **`adminMedia`** (`@koa/multer`+`multer` come `dependencies`, `sharp`
  come `optionalDependencies`).
- **Plugin/tema legacy** — nessun `package.json`; dichiara `nodeModuleDependency`
  in `pluginConfig`; le deps vivono nel `node_modules` di **root**.

### `deps-sync` (fase 6.5 dell'update)

`npm run deps-sync` riconcilia entrambi i rami, per i soli plugin **attivi**
(mirroring del boot gate; i disabilitati come `dbApi`/`ccxt` sono saltati):

- self-contained → `npm install` (o `--clean` → `npm ci`) dentro la cartella;
- legacy → `npm install --no-save <pkg>@<range>` a root per i moduli mancanti/
  incompatibili (il `package.json` di root è di git: un `--save` verrebbe
  sovrascritto dal prossimo checkout di release);
- **realign**: per ogni plugin/tema con config vivo, riallinea
  `nodeModuleDependency` del vivo dal `.default`. Necessario perché il merge
  additivo dello schema non tocca le chiavi esistenti: fixa il boot gate quando
  una release cambia i range o **svuota** il campo (migrazione self-contained).

Errori **warn-non-fatali** (un dep non risolto → il plugin resta `incomplete`, il
boot resta graceful). È cablato anche come **`postinstall`** di root: `npm install`
sincronizza da sé le deps plugin-local (`--postinstall` esce sempre 0, non fa mai
fallire l'install).

### Perché il `node_modules` plugin-local funziona (risoluzione di Node)

Un dubbio ricorrente: se il plugin viene `require`ato *dentro* `index.js`/`pluginSys`,
il suo `node_modules` — sepolto in una sottocartella stratificata — non viene forse
ignorato, facendo mancare le dipendenze? **No.** La risoluzione dei moduli di Node
**non** è relativa a *chi innesca* il require, ma a **dove sta fisicamente il file**
che esegue `require('lib')`: Node costruisce `module.paths` risalendo l'albero delle
cartelle a partire dalla directory del file stesso (`__dirname`) e si ferma alla
**prima** corrispondenza. Quando `plugins/adminMedia/main.js` fa
`require('@koa/multer')`, l'ordine di ricerca è:

```
plugins/adminMedia/node_modules   ← per PRIMO (priorità massima)
plugins/node_modules
node_modules                       ← root, solo come fallback
… (risale fino a /node_modules)
```

Il fatto che il caricamento sia *innescato* da `core/pluginSys.js` (via
`require(path.join(..., 'plugins', pluginName, 'main.js'))`) è irrilevante: conta solo
che `main.js` e i suoi sotto-moduli vivano **dentro** la cartella del plugin. Il
`node_modules` plugin-local ha quindi **priorità** su quello di root, non è affatto
inutile.

### Spigoli e vincoli del modello per-plugin (impatti da conoscere)

La meccanica base è solida, ma il modello ibrido introduce **7 comportamenti
spigolosi** che si rompono in silenzio se ignorati. Sono precondizioni/vincoli, non
difetti — vanno rispettati e (in prospettiva) coperti da test di regressione.

1. **Il `require` DEVE partire da un file interno al plugin.** La risoluzione risale
   da `__dirname` del file che chiama `require`. Se una dipendenza del plugin venisse
   `require`ata da un file **core** (es. `core/qualcosa.js` che fa `require('sharp')`
   per conto del plugin), Node risalirebbe da `core/` e **non** vedrebbe
   `plugins/x/node_modules`. Regola: **ogni plugin fa i propri require a casa propria**
   (in `main.js` o nei suoi `lib/*.js`), mai delegandoli al core.

2. **Doppia istanza / problema del singleton.** Se lo stesso modulo esiste sia in root
   sia nel plugin (magari a versioni diverse), Node carica **due copie distinte** in
   memoria. Innocuo per librerie "foglia" (`multer`, `sharp`: nessuna identità
   attraversa il confine), ma è un bug sottile se un plugin impacchetta la propria copia
   del **framework** (`koa`, `@koa/router`) e passa oggetti con controlli `instanceof`
   attraverso il confine plugin↔core. Regola: **i plugin non bundlano il framework** —
   lo usano da root.

3. **Nessun hoisting/dedup con root.** Il `node_modules` plugin-local non è deduplicato
   con quello di root: due versioni della stessa lib = **doppio peso su disco** +
   possibile *version-skew*. È il prezzo (voluto) dell'isolamento; va messo in conto
   nel dimensionamento del deploy.

4. **Moduli nativi (sharp, better-sqlite3).** Il binario nativo è compilato/scaricato
   **dentro** il `node_modules` del plugin. Dopo un **major di Node** l'ABI cambia e
   serve ricompilare (`npm run deps-sync -- --clean`). Per questo `sharp` è dichiarato
   in `optionalDependencies`: se il build fallisce, il boot resta **graceful** (plugin
   `incomplete`) invece di crashare.

5. **`deps-sync` tocca solo i plugin ATTIVI** (mirroring del boot gate; `dbApi`/`ccxt`
   disabilitati sono saltati). Conseguenza non ovvia: se **attivi** un plugin
   self-contained *dopo* aver già installato, resterà `incomplete` finché non rilanci
   `npm run deps-sync` (o `npm install`). Va comunicato all'utente al momento
   dell'attivazione.

6. **Landmine `npm workspaces`.** Se in `package.json` di root si aggiungesse
   `"workspaces": ["plugins/*"]`, npm farebbe **hoisting** di tutto in root e il modello
   per-plugin **salterebbe del tutto** (le deps finirebbero in root, non più isolate).
   Regola: **non abilitare workspaces** senza riprogettare consapevolmente il modello.

7. **`postinstall` = esecuzione di script arbitrari.** `deps-sync` come `postinstall`
   di root lancia `npm install` dentro ogni plugin self-contained, e ogni install
   esegue i lifecycle script delle **sue** dipendenze. È il normale rischio
   supply-chain di npm, ma con **più punti d'ingresso** (uno per plugin
   self-contained). Da considerare nella valutazione di sicurezza delle dipendenze.

## Precondizioni e limiti (v1)

- **Deploy da clone git** (per la strada B). Deploy da tarball/npm non ancora
  supportato dall'updater.
- Auto-stop/riavvio solo **self-managed**; sotto supervisor, stop/start manuali.
- `npm start` è `node index.js`; l'auto-reload da sviluppo è su `npm run dev`
  (nodemon). Se rimetti nodemon a mano, evita di aggiornare mentre è in watch.
- `restore` è **overlay** (non rimuove i file creati dopo lo snapshot).
- `.update.lock` in root impedisce update concorrenti.

## Architettura (moduli)

```
scripts/
├── update.js            # orchestratore update
├── backup.js · backupList.js · backupManager.js · restore.js
├── depsSync.js          # entrypoint deps-sync (+ --postinstall)
└── lib/
    ├── updateEngine.js         # git + discovery/selezione release (selectLatest puro)
    ├── backupEngine.js         # snapshot/list/prune/restore (fs.cpSync)
    ├── pluginDepsReconciler.js # riconciliazione a due rami + realign (riusa checkNpmDeps)
    ├── serverControl.js        # status/stop via unix socket (no dep npm)
    └── cliArgs.js              # parser argomenti minimale
```

Riusi: `core/pluginStateResolver.checkNpmDeps` (stati npm), `core/setJson5Key`
(realign preservando i commenti), il control plane socket del `cliBridge`
(`status.supervisor`), `gracefulShutdown` di `index.js` (SIGTERM).

Test: `tests/unit/updateSystem/` (cliArgs, updateEngine, backupEngine) e
`tests/integration/updateSystem/gitApply.test.js` (checkout reale che preserva i
file untracked, su repo usa-e-getta).
