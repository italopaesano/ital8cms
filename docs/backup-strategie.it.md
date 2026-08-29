<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `backup-strategie.md` is a stub until release.
# Le due strategie di backup — ital8cms

In ital8cms esistono **due sistemi di backup distinti**, che scrivono nella stessa
cartella `backups/` e **non si conoscono fra loro**. Confonderli è facile — anche
perché due file sorgente si chiamano allo stesso modo — e la conseguenza pratica è
credere di avere una copia di sicurezza dove non c'è.

Questo documento li mette a confronto e descrive per intero quello **meno noto**, il
backup che il wizard di installazione fa da solo. Per gli snapshot a comando la
guida completa resta [`self-update.it.md`](./self-update.it.md).

## In una tabella

| | Snapshot dell'istanza | Backup dell'installazione |
|---|---|---|
| **Comando** | `npm run backup` | nessuno: gira dentro `npm run start-configure` |
| **Modulo** | `scripts/lib/backupEngine.js` | `scripts/lib/backupManager.js` |
| **Quando** | quando lo lanci tu | solo durante il wizard di installazione |
| **Cosa copia** | **tutta l'installazione** | pochi file, mirati |
| **Cartella** | `backups/backup-<timestamp>[_label]/` | `backups/init-<timestamp>/` |
| **Ripristino** | `npm run restore -- --latest` | automatico, solo su fallimento, solo per plugin |
| **Elencato da `backup-list`** | sì | **no** |
| **Potato dalla retention** | sì (`backup-manager`, `--keep`) | **mai** |
| **Documentazione** | [`self-update.it.md`](./self-update.it.md) | questo file |

> ⚠️ **Attenzione ai nomi.** Esistono **due file `backupManager.js`** che non hanno
> nulla in comune:
>
> - **`scripts/backupManager.js`** — è il comando `npm run backup-manager`, che
>   elenca e pota gli **snapshot**;
> - **`scripts/lib/backupManager.js`** — è la classe `BackupManager` del **wizard**,
>   quella descritta qui sotto.
>
> Il nome condiviso è il primo motivo per cui questa faccenda è difficile da tenere
> a mente. Una revisione complessiva della strategia — nomi inclusi — è aperta in
> [`../TODO.md`](../TODO.md) §8.

---

## 1. Snapshot dell'istanza (`npm run backup`)

Copia **l'intera installazione** in `backups/backup-<timestamp>/`, con `tree/` (la
copia) e `manifest.json` (versione, sha git, node, cosa include). I dati utente e i
config vivi — che sono git-ignored — **sono** nello snapshot: sono la parte che
conta preservare.

```bash
npm run backup                          # snapshot
npm run backup -- --label pre-esperimento
npm run backup-list                     # elenca
npm run restore -- --latest             # ripristina (overlay)
npm run backup-manager                  # elimina / pruna
```

È il backup **che devi usare tu** prima di un intervento rischioso. Dettagli
completi — esclusioni, overlay del restore, backup `pre-restore` di sicurezza,
gestione del server durante il ripristino — in [`self-update.it.md`](./self-update.it.md).

---

## 2. Backup dell'installazione (il wizard)

Non ha un comando proprio: gira **dentro `npm run start-configure`**, in automatico,
subito prima che il wizard modifichi qualcosa. Serve a una cosa sola — poter tornare
indietro se l'installazione va storta — e non è pensato come backup periodico.

Il `BackupManager` viene costruito **una volta** all'avvio del wizard
(`scripts/init.js`) e fissa subito un timestamp: tutti i backup di quella sessione
finiscono nella **stessa cartella**, così una sessione = una cartella.

### Cosa copia, e in quali momenti

| # | Momento | File | Dove |
|---|---|---|---|
| 1 | prima che il wizard riscriva la configurazione globale | `ital8Config.json5` | `init.js` → `backupGlobalFile()` |
| 2 | prima di sostituire le chiavi di sessione | `koaSession.json5` | `sessionKeyManager.js` → `backupGlobalFile()` |
| 3 | prima di eseguire l'`init.js` di un plugin | i file che il plugin dichiara con `getFilesToBackup()` | `pluginInitRunner.js` → `backupPluginFiles()` |

**Oggi un solo plugin dichiara file da salvare:** `adminUsers`, che protegge
`userAccount.json5` e `userRole.json5` — cioè gli account e i ruoli dell'intera
installazione. Il meccanismo per-plugin esiste, ma ha un caso d'uso solo.

### Com'è fatta la cartella

```
backups/
└── init-29-08-2026_05-42-11/          ← una cartella per sessione del wizard
    ├── global/
    │   ├── ital8Config.json5
    │   └── koaSession.json5
    └── plugins/
        └── adminUsers/
            ├── userAccount.json5
            └── userRole.json5
```

Dentro `plugins/<nome>/` la **struttura relativa** del plugin è preservata: un file
in una sottocartella ci finisce con la sua sottocartella.

Il timestamp è in formato italiano `DD-MM-YYYY_HH-MM-SS`.

### Quando i due profili si comportano diversamente

| | profilo `production` | profilo `demo` |
|---|---|---|
| Backup globale (1 e 2) | sì | sì |
| Backup per-plugin (3) | sì | **no** — il ramo demo non esegue l'init dei plugin |

Nella **re-init parziale** (`reinitType: 'plugins'`) la fase di configurazione
globale è saltata del tutto, quindi non viene creato alcun backup globale.

> Su una **installazione nuova** il backup del punto 1 copia un `ital8Config.json5`
> appena materializzato dal `.default`, cioè un file che non hai ancora toccato: è
> nella **re-installazione** che quella copia diventa preziosa.

### Il ripristino — e i suoi limiti

Il ripristino automatico esiste **solo per i plugin**, e solo su fallimento:

1. l'`init.js` del plugin ritorna `success: false`, oppure lancia;
2. il wizard chiede: *« Vuoi ripristinare i file dal backup? »* (default: sì);
3. se rispondi sì, `restorePlugin(<nome>)` ricopia ricorsivamente tutto il contenuto
   di `backups/init-.../plugins/<nome>/` sopra `plugins/<nome>/`.

**Tre cose che questo ripristino NON fa**, e che vanno sapute prima di averne bisogno:

- **Il backup globale non ha alcun ripristino automatico.** `ital8Config.json5` e
  `koaSession.json5` vengono copiati, ma nessun codice li rimette mai a posto: se il
  wizard li lascia in uno stato che non ti va bene, quella copia va ripescata a mano
  (vedi *Recuperare a mano*, sotto).
- **Non esiste un « annulla tutto il wizard ».** Il ripristino è per singolo plugin,
  al momento del suo fallimento.
- **Se rispondi « no », per quel plugin la domanda non torna.** I file restano dove
  sono nella cartella di backup, ma nessun comando li rimetterà a posto per te: il
  wizard passa al plugin successivo. (Se fallisce anche quello, la domanda te la
  rifà — per il suo backup.)

### Recuperare a mano

Poiché gli `init-*` sono fuori dalla toolchain degli snapshot (vedi *Limiti noti*),
il recupero è una copia manuale. Individua la cartella della sessione:

```bash
ls -1t backups/ | grep '^init-' | head -5      # le ultime sessioni del wizard
```

Poi copia indietro il file che ti serve:

```bash
# configurazione globale
cp backups/init-29-08-2026_05-42-11/global/ital8Config.json5 ./ital8Config.json5

# chiavi di sessione (invalida le sessioni aperte: chi è loggato dovrà rifare login)
cp backups/init-29-08-2026_05-42-11/global/koaSession.json5 \
   ./core/priorityMiddlewares/koaSession.json5

# account e ruoli
cp backups/init-29-08-2026_05-42-11/plugins/adminUsers/*.json5 ./plugins/adminUsers/
```

Poi riavvia il server. Se hai dei dubbi su cosa cambierebbe, confronta prima:

```bash
diff backups/init-.../global/ital8Config.json5 ital8Config.json5
```

### Dichiarare i file da salvare in un plugin

Un plugin che ha uno script di inizializzazione (`plugins/<nome>/scripts/init.js`)
può dichiarare quali suoi file vanno salvati prima che quello script giri:

```javascript
/**
 * File da mettere al sicuro prima dell'inizializzazione.
 * Chiamata PRIMA di run(): se run() fallisce, il wizard offre di ripristinarli.
 *
 * @param {string} pathPluginFolder - Cartella del plugin
 * @returns {string[]} Path ASSOLUTI dei file
 */
function getFilesToBackup(pathPluginFolder) {
  return [
    path.join(pathPluginFolder, 'userAccount.json5'),
    path.join(pathPluginFolder, 'userRole.json5'),
  ]
}

module.exports = { getFilesToBackup, run /* … */ }
```

Note pratiche:

- I path devono essere **assoluti** e stare **dentro** la cartella del plugin: il
  backup ne calcola il relativo rispetto a `plugins/<nome>/`.
- Un file **inesistente** non è un errore: viene saltato con un warning.
- La funzione è **opzionale**. Senza, il plugin viene inizializzato **senza rete**:
  se il suo `init.js` fallisce a metà, non c'è niente da ripristinare.
- Se il backup stesso fallisce, il wizard **prosegue lo stesso** con un warning
  (« Continuo senza backup… »): l'inizializzazione non si ferma per un backup
  mancato.

---

## Limiti noti

Sono limiti **misurati sul codice**, non ipotesi. Una revisione complessiva è aperta
in [`../TODO.md`](../TODO.md) §8, *Rivedere la strategia di backup*.

1. **Il backup globale non ha ripristino.** Copiato, mai rimesso a posto da codice.
2. **Gli `init-*` sono invisibili alla toolchain degli snapshot.**
   `backupEngine.listBackups()` filtra per prefisso `backup-`, quindi `backup-list`,
   `backup-manager` e `restore` **non li vedono**: non compaiono negli elenchi, non
   si ripristinano col comando, e **non vengono potati mai** — crescono a ogni
   esecuzione del wizard finché non li togli tu.
3. **`initState.json5` registra due formati di path diversi**: quello del backup
   globale è **relativo** alla radice del progetto, quello per-plugin è **assoluto**.
4. **`getPluginBackupPath()` non ha chiamanti** in produzione: è codice morto.
5. **Un solo plugin** usa il meccanismo per-plugin (`adminUsers`).
6. **I due sistemi condividono `backups/`** senza conoscersi, e due file sorgente
   condividono il nome `backupManager.js`.

## Cosa fare, in pratica

- **Prima di un intervento rischioso** (aggiornamento, esperimento, modifica manuale
  dei config): usa `npm run backup`. È l'unico dei due sistemi pensato per questo, ed
  è l'unico con un ripristino a comando.
- **Non contare sul backup del wizard** come copia di sicurezza: è una rete per
  l'installazione, non un backup.
- **Ogni tanto svuota gli `init-*`** che non ti servono più: nessuna retention li
  tocca.
- **Se il wizard ha fatto un danno**, la cartella `init-<timestamp>` di quella
  sessione contiene gli originali: recuperali a mano come sopra.

## Riferimenti nel codice

| File | Ruolo |
|---|---|
| `scripts/lib/backupManager.js` | classe `BackupManager` — il backup del wizard |
| `scripts/init.js` | costruisce il `BackupManager`, backup di `ital8Config.json5` |
| `scripts/lib/sessionKeyManager.js` | backup di `koaSession.json5` prima della rotazione delle chiavi |
| `scripts/lib/pluginInitRunner.js` | backup per-plugin, domanda di ripristino, `restorePlugin()` |
| `scripts/lib/stateManager.js` | scrive `backupPath` in `scripts/initState.json5` |
| `plugins/adminUsers/scripts/init.js` | l'unico `getFilesToBackup()` esistente |
| `scripts/lib/backupEngine.js` | l'**altro** sistema: snapshot dell'istanza |
| `scripts/backupManager.js` | comando `npm run backup-manager` (pota gli snapshot) |
