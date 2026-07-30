<!-- ital8doc v1-1 · tipo: decision · lang: it · rev: 1 · ref -->
# Decisione: migrazione dei file di configurazione (`migrations/`)

> **Stato: IMPLEMENTATA** (2026-07-30) — prerequisiti in v2.66.0, runner
> `migrations/` in v2.67.0 (`core/migrationRunner.js`, `npm run cli -- migrate`,
> box `[MIGRATE]`, `migrations.autoApply`).
> Estende [`config-lifecycle.it.md`](./config-lifecycle.it.md), che al §6 aveva
> definito `schemaVersion` come **solo rilevamento** del drift e rimandato la
> migrazione vera. Questo documento è quella migrazione.

## Contesto

Il ciclo di vita dei config (fasi 0–6) ha stabilito il modello `x.default.json5`
(fonte di verità, committato) → `x.json5` (vivo, git-ignored, generato). Quando la
struttura di un `.default` evolve, l'autore incrementa `schemaVersion` e al boot
`reconcileSchemaVersion` applica un **merge additivo**: aggiunge al vivo le sole
chiavi **top-level** nuove, senza toccare i valori esistenti.

Era dichiaratamente una soluzione-ponte. La verifica sul campo mostra che il ponte
non regge: **tre bump su quattro non hanno prodotto l'effetto atteso.**

| Bump reale | Cosa cambiava | Esito |
|---|---|---|
| `ital8Config` 1→2 | `rejectNonCanonicalPaths` (top-level) | ✅ propagata |
| `ital8Config` 2→3 | `maintenance.exemptPaths` (**annidata**) | ❌ non propagata |
| `adminMedia` 1→2 | `nodeModuleDependency` **svuotato** (cambio di valore) | ❌ non propagato |
| `exampleComplete` 1→2 | `custom.dataPath` (**annidata**) | ❌ non propagata |

Quattro limiti strutturali, tutti confermati leggendo `core/reconcileSchemaVersion.js:73-81`:

1. **Solo chiavi top-level.** Una chiave nuova dentro `custom` non arriva mai, se
   `custom` esiste già nel vivo — ed è lì che vivono quasi tutte le impostazioni
   di un plugin.
2. **Solo aggiunte.** Valori cambiati, rinomine e rimozioni non sono migrati; dopo
   una rinomina il vivo si ritrova **entrambe** le chiavi.
3. **Commenti non copiati.** `setJson5Key` scrive `chiave: valore`: le chiavi nuove
   arrivano mute e il file si degrada a ogni riconciliazione.
4. **Nessuna memoria.** Non esiste un "ultima versione vista": lo stato è desunto
   ogni volta confrontando due file.

### I tre workaround già presenti nel codice

Il sintomo più chiaro che il meccanismo è insufficiente: ogni fallimento ha
generato un rattoppo dedicato, fuori dal meccanismo.

| Workaround | Dove | Compensa |
|---|---|---|
| `DEFAULT_EXEMPT_PATHS` hardcoded | `core/priorityMiddlewares/runtimeGate.js` | la chiave annidata che non arriva |
| `custom.dataPath \|\| './data'` | `plugins/exampleComplete`, `plugins/analytics` | idem, per ogni default annidato |
| Pass A: force-overwrite di `nodeModuleDependency` | `scripts/lib/pluginDepsReconciler.js:124-132` | il cambio di valore che il merge non fa |

Il terzo è una migrazione vera e propria — completa, ma cablata su **una sola
chiave**, in uno script di deps, senza alcun aggancio a `schemaVersion`.

### Il buco di osservabilità

Il box `[SCHEMA]` è anti-rumore: mostra solo i `merged` con `added.length > 0` e i
`live-ahead`. Ma il merge che **non ha potuto aggiungere nulla** — perché le novità
erano annidate o erano cambi di valore — produce `added: []` e finisce in
`alignedSilently`, quindi **in silenzio**.

Il risultato è invertito rispetto all'utile: i casi andati bene fanno rumore, quelli
che non hanno fatto nulla passano inosservati e lasciano un vivo la cui
`schemaVersion` **dichiara di essere aggiornato mentre non lo è**. Peggio: quel
numero bruciato impedisce anche a un meccanismo futuro corretto di accorgersi del
drift.

## Decisione

Ogni plugin e ogni tema può portare una cartella **`migrations/`** che descrive,
passo per passo, come si porta un'installazione da una versione di struttura alla
successiva. Lo standard è **identico per plugin e temi** ed è esteso ai tre config
del core.

### 1. Il clock: `schemaVersion` del descrittore

`from-vN-to-vM` si riferisce alla **`schemaVersion` del descrittore** del pacchetto
(`pluginConfig.default.json5` / `themeConfig.default.json5`), promossa a *versione
di struttura dell'intero pacchetto*.

Scelta fra tre alternative (un contatore nuovo dedicato; la `version` semver di
`pluginDescription.json5`; il descrittore). Vince il descrittore perché **risolve
gratis il punto rimandato** dalla decisione precedente — *dove persistere «l'ultima
versione vista»*:

- il `x.json5` **vivo** porta la `schemaVersion` a cui quell'installazione è ferma;
- il `.default` porta quella a cui il codice è arrivato;
- la migrazione da eseguire è **esattamente il salto fra le due**, e il numero si
  aggiorna da sé a esito riuscito.

Nessun quinto asse di versione, nessun file di stato da tenere sincronizzato.

**Costo, da conoscere:** se cambia la struttura del solo `seoPages.default.json5`,
va bumpata **anche** la `schemaVersion` del descrittore per far scattare il runner.
Il descrittore è il clock del pacchetto: è una convenzione da rispettare, non un
automatismo.

**Per i tre config del core** non esiste un descrittore: lì il clock è **il file
stesso** (`ital8Config.json5` ha la propria `schemaVersion`, e così gli altri due).

### 2. Struttura

```
plugins/<nome>/                          (identico per themes/<nome>/)
├── pluginConfig.default.json5           schemaVersion: 3   ← clock del pacchetto
├── seoPages.default.json5               schemaVersion: 2
└── migrations/
    ├── migrations.json5                 indice degli step
    ├── CHANGELOG.md                     storico e motivazioni
    ├── from-v1-to-v2.md                 istruzioni leggibili (umano / AI)
    ├── from-v1-to-v2.js                 runner opzionale
    ├── from-v2-to-v3.md
    ├── from-v2-to-v3.js
    └── from-v2-to-v3/                   materiali della migrazione (opzionale)
        ├── nuovoSchema.json5
        └── convertiAsset.js
```

```
core/migrations/                         i tre config globali, una cartella ciascuno
├── ital8Config/      migrations.json5 · CHANGELOG.md · from-v2-to-v3.{md,js}
├── adminConfig/      migrations.json5 · …
└── koaSession/       migrations.json5 · …
```

La cartella viaggia **dentro** il pacchetto: è la premessa perché il meccanismo
funzioni anche per i plugin/temi di terze parti installati da repo Git.

**Opzionale ma raccomandata.** Assente → si ricade sul merge ricorsivo additivo
(comportamento attuale, migliorato). Renderla obbligatoria spezzerebbe i 41
pacchetti esistenti senza guadagno. Raccomandata **almeno dal primo aggiornamento**
del pacchetto in poi.

### 3. `migrations.json5`

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  schemaVersion: 1,          // versiona QUESTO file (è un config come gli altri)

  steps: [
    {
      from: 1,
      to: 2,
      title: "custom.dataPath introdotto",
      automatic: true,
      reason: "Sola aggiunta di una chiave con default sano: il merge additivo basta, nessun valore esistente viene toccato.",
      touches: ["pluginConfig.json5"],
    },
    {
      from: 2,
      to: 3,
      title: "mediaDir spostato sotto il service plugin",
      automatic: false,
      reason: "Il valore va riconciliato col mediaDir del plugin `media`, che può essere stato personalizzato: nessuna regola meccanica sicura.",
      doc: "from-v2-to-v3.md",
      touches: ["pluginConfig.json5", "mediaIndex.json5"],
    },
  ],
}
```

| Campo | Obbligo | Note |
|---|---|---|
| `from` / `to` | sì | interi contigui; i buchi nella catena sono un errore di validazione |
| `title` | sì | una riga, compare nel box `[MIGRATE]` e nella GUI |
| `automatic` | sì | dichiarazione dell'autore: "questo salto è meccanico e sicuro" |
| `reason` | **sì, sempre** | anche quando `automatic: true` — obbliga a motivare *perché* è sicuro, non solo che lo è. È il primo posto dove guarda chi indaga un comportamento inatteso |
| `script` | no | assente ⇒ basta il merge additivo (vedi §4) |
| `doc` | sì se `automatic: false` | il `.md` che guida l'operatore |
| `touches` | sì | file toccati: guida il backup mirato e il dry-run, e definisce di quali `schemaVersion` lo step è responsabile |

### 4. Le tre strategie di uno step

Il runner le deriva senza campi aggiuntivi:

| `automatic` | `script` | Esecutore | Copre |
|---|---|---|---|
| `true` | assente | **merge ricorsivo additivo** del core | sole aggiunte di chiavi, anche annidate |
| `true` | presente | lo script | rinomine, rimozioni, cambi di valore, conversioni |
| `false` | — | umano o AI, guidato dal `.md` | quel che richiede giudizio |

**Script e merge sono complementari nello stesso step:** lo script fa ciò che il
merge non sa fare e **lascia** che le semplici aggiunte le completi il merge, che
gira comunque dopo. Gli script restano corti e non ricopiano le chiavi nuove.

Ne segue una regola di validazione: **ogni salto del clock deve avere il suo step
dichiarato**. Oggi un `.default` con `schemaVersion` bumpata non distingue "basta il
merge" da "l'autore ha dimenticato la migrazione"; dichiarare lo step anche quando è
banale elimina l'ambiguità, ed è la sua *assenza* a diventare un difetto rilevabile.

### 5. Contratto dello script

```javascript
module.exports = {
  async migrate(context) {
    // context = {
    //   packageDir,   path assoluto del plugin/tema
    //   stepDir,      path di from-vN-to-vM/ se esiste, altrimenti null
    //   loadJson5, saveJson5, setJson5Key,   utility core (scritture atomiche)
    //   logger,       logger del progetto, mai console.log
    //   dryRun,       se true: NON scrivere, solo riportare
    // }
    // ritorna { changed: [...], notes: [...] }
  },

  // opzionale: postcondizione verificata dal runner dopo migrate()
  async verify(context) { return { ok: true }; },
};
```

Cinque regole non negoziabili — è **codice di terze parti che gira sui config
dell'utente**:

1. **Idempotente.** Rieseguito su un pacchetto già migrato non deve fare danni: è
   l'unica difesa contro un'interruzione a metà (crash, disco pieno, kill).
2. **Nessun `process.exit`, nessun side effect al `require`** (stessa regola già in
   vigore per `main.js`, che `validateClonedPlugin` carica in validazione).
3. **Deve poter fallire senza rompere il boot.** Il runner cattura, segnala, **non**
   avanza la `schemaVersion`, lascia il pacchetto allo stato precedente.
4. **`dryRun` va rispettato**, altrimenti l'anteprima mente ed è peggio che inutile.
5. **Scritture solo dentro `packageDir`.** Uno script che tocca `ital8Config.json5` o
   un altro plugin è fuori mandato.

**Preferisci `setJson5Key`/`editJson5` a una riserializzazione integrale.** Un
`saveJson5(configPath, oggettoModificato)` riscrive il file da capo e **perde tutti i
commenti** del vivo — lo stesso difetto che il progetto ha appena eliminato altrove.
Va bene per un file di dati; per un config commentato, modifica le singole chiavi.

### 6. `from-vN-to-vM.md` — per l'umano o per l'AI

Sezioni **fisse** (è ciò che rende il file azionabile invece che descrittivo: un'AI
che lo riceve deve trovare sempre la stessa struttura). Tipo ital8doc: `guide`.

```markdown
<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
# from v2 to v3 — mediaDir spostato sotto il service plugin

## Perché
## Cosa cambia nei file      (tabella: file · chiave · prima · dopo)
## Passi
## Come verificare che sia andata a buon fine
## Se qualcosa va storto
```

`CHANGELOG.md` della cartella è il registro cronologico con le **motivazioni**
trasversali; rimanda ai `.md` degli step per il dettaglio tecnico, non lo duplica.

### 7. Ordine di esecuzione e allineamento

```
per ogni pacchetto (nell'ordine delle dipendenze calcolato da pluginSys):
  gap = default.schemaVersion − vivo.schemaVersion
  per ogni step, in ordine e uno alla volta:
    automatic: false  → STOP: segnala, non allineare
    script presente   → esegui; se lancia → STOP, non allineare
    merge additivo ricorsivo (completa le aggiunte, in entrambi i casi)
    verifica: ogni chiave del .default esiste nel vivo? (§8)
    ✓ solo ora allinea schemaVersion (descrittore + file in `touches`)
```

- **La `schemaVersion` è una ricevuta, non un contatore di tentativi.** Allinearla
  quando lo step fallisce brucia il trigger: al boot dopo l'installazione risulta
  aggiornata e lo step non riparte più, lasciando uno stato a metà che il sistema
  crede sano. È esattamente il difetto che oggi ha `reconcileSchemaVersion`
  (allinea anche con `added: []`) e che va corretto **prima** di questo lavoro.
- **Il merge additivo va tenuto lontano dai file con una migrazione pendente.** Non
  basta che la migrazione giri prima: se il rilevamento è passivo (default), il
  merge la trova comunque e allinea `schemaVersion` per conto suo — bruciando lo
  stesso trigger, in silenzio e a ogni boot. `reportPendingMigrations` restituisce
  quindi `protectedLivePaths` (descrittore **e** file secondari dichiarati in
  `touches`) e `reconcileSchemaVersions` li salta via `skipLivePaths`.
  *Verificato sul campo:* senza questa protezione, un plugin fixture con una
  rinomina dichiarata perdeva la migrazione al primo avvio del server.
- **Uno step alla volta**, allineando a ogni passo riuscito: un'interruzione lascia
  uno stato coerente e ripartibile.
- **Chi allinea i file secondari:** lo step che gira è responsabile di **tutti** i
  file in `touches`, descrittore incluso, e ne allinea le `schemaVersion`. Il merge
  additivo passa dopo e completa i file che lo step non ha dichiarato.
- **Catena interrotta:** se uno step in mezzo è `automatic: false`, il resto **non**
  viene applicato, anche se gli step successivi sarebbero automatici. Va detto
  esplicitamente all'admin, altrimenti vedrà "aggiornato a v2" e crederà di aver
  finito.
- **Ordine fra pacchetti:** si riusa l'ordinamento che `pluginSys` già calcola
  (weight → dipendenze → alfabetico). Una migrazione di `adminMedia` può leggere dal
  plugin `media` da cui dipende: costa poco ed evita una classe di bug sottili.

### 8. Verifica automatica: confronto strutturale, nessun campo in più

Dopo uno step automatico, il runner verifica che **ogni chiave del `.default`
esista nel vivo**, ricorsivamente. È la stessa traversata che il merge ricorsivo
già fa, quindi costa quasi nulla, e non aggiunge sintassi al formato.

Limite da conoscere: la verifica vede la **struttura**, non i **valori**. Avrebbe
intercettato al primo boot `maintenance.exemptPaths` e `custom.dataPath`, ma **non**
`nodeModuleDependency` svuotato (la chiave c'è in entrambi, cambia il contenuto). Non
è grave — i cambi di valore sono per definizione competenza di uno script, quindi
coperti dall'altro ramo — ma non va scambiata per una garanzia completa.

### 9. Step manuali: come si marcano "fatti"

Se `automatic: false`, per definizione non esiste uno script che *effettui* il
lavoro; può però esistere uno script che lo **verifichi**.

| | Come funziona |
|---|---|
| **`verify()`** *(default)* | l'operatore esegue i passi del `.md`, poi lancia `migrate`; il runner chiama la `verify()` del contratto e allinea **solo se passa** |
| **`--confirm-manual`** *(fallback)* | quando `verify()` non è scrivibile (la correttezza dipende dal dominio): l'operatore dichiara di aver fatto, il sistema allinea |
| Script parziale | `automatic: false` + script che fa la parte meccanica; umano/AI completa; poi una delle due sopra |

Modificare a mano la `schemaVersion` del vivo resta possibile ma è **sconsigliato**:
nessun controllo, nessuna traccia.

### 10. Chi esegue, e quando

Tre livelli, dal più prudente. La tensione da governare: eseguire **codice arbitrario
di terze parti, senza supervisione, sui config che contengono dati utente**.

| Livello | Comportamento | Chi decide |
|---|---|---|
| **Rilevamento** (sempre) | il boot confronta le `schemaVersion`, trova gli step pendenti, emette il box `[MIGRATE]` distinguendo automatici e manuali | nessuno: è passivo |
| **Esecuzione su richiesta** | `npm run cli -- migrate <target>`, con `--dry-run` e conferma | l'admin |
| **Esecuzione al boot** | applica i soli step `automatic: true` | `ital8Config.json5 → migrations.autoApply`, **default `false`** |

Il rilevamento passivo dà il grosso del valore con rischio nullo. Un boot che
modifica i config da sé, in silenzio, è precisamente ciò che rende impossibile
capire cosa è successo quando qualcosa si rompe.

**Backup obbligatorio** dei file in `touches` prima di toccarli, a ogni livello
(`BackupManager` esiste già).

### 11. Errori e degradazione

Coerente con il boot graceful già in vigore: un `migrations.json5` malformato, o con
buchi nella catena (`1→2` poi `3→4`), produce un **warning** nel box `[MIGRATE]`;
quel pacchetto resta alla sua `schemaVersion` e **il boot prosegue**. Non si blocca
l'avvio per un pacchetto con le migrazioni scritte male.

### 12. Divisione dei ruoli con `upgradePlugin()`

| | Migra | Guidato da | Runner |
|---|---|---|---|
| `migrations/` | **config e dati** del pacchetto | `schemaVersion` | modulo del **core** |
| `upgradePlugin()` | logica **di codice** all'upgrade di release | `pluginDescription.version` | `pluginSys` |

Il runner sta nel core, non in `pluginSys`, per una ragione dirimente: **i temi non
hanno `main.js`, quindi non hanno `upgradePlugin()`**. Se le migrazioni dei config
passassero da lì, i temi resterebbero scoperti e lo standard non sarebbe "valido sia
per i temi che per i plugin". Un runner del core li copre entrambi con lo stesso
codice.

## Naming (approvato)

| Cosa | Nome |
|---|---|
| Cartella + indice | `migrations/` · `migrations/migrations.json5` |
| Modulo core | `core/migrationRunner.js` |
| Comando CLI | `npm run cli -- migrate <target>` (`--dry-run`, `--confirm-manual`) |
| Box al boot | `[MIGRATE]` |
| Policy | `ital8Config.json5 → migrations.autoApply` (default `false`) |

## Prerequisiti — ✅ COMPLETATI (v2.66.0)

Tre correzioni al meccanismo esistente, indipendenti da `migrations/` ma bloccanti
per esso. Realizzate in un intervento separato **prima** del runner.

1. **Merge ricorsivo** — ✅ `reconcileSchemaVersion` scende ora nei sotto-oggetti e
   riporta i path in notazione puntata (`custom.dataPath`). Un sottoalbero
   interamente mancante viene inserito in blocco senza discendervi; gli array
   restano valori dell'utente e non vengono fusi elemento per elemento. Ha richiesto
   di estendere `setJson5Key` ai path annidati (`['custom','dataPath']`), riusando il
   locator testuale di `editJson5` invece di duplicarlo — la parte più delicata del
   modulo, dove una seconda implementazione divergerebbe in silenzio.
2. **`upgradePlugin()` riparato** — ✅ la `version` è ora persistita nel
   `pluginConfig.json5` vivo, **solo a esito riuscito**, con semantica "ultima
   versione per cui l'upgrade è stato eseguito". La prima installazione non è un
   upgrade: registra la versione di partenza senza invocare l'hook. La chiave
   `version` è stata rimossa dai 7 `.default` che la portavano (è stato runtime,
   come `isInstalled`).
3. **Box `[SCHEMA]` invertito** — ✅ nuova categoria `unresolved`: un merge con
   `added: []` su un vivo **già versionato** (`from >= 1`) viene segnalato, perché
   significa che il bump riguarda un valore, una rinomina o una rimozione — cose che
   il merge non sa applicare. Il caso `from === 0` (vivo pre-versionamento) resta
   silenzioso: è il rumore che il box deve evitare. Prima erano indistinguibili e
   tacevano entrambi.

Il punto 3 è anche il presupposto tecnico del §7: finché `reconcileSchemaVersion`
allineava la `schemaVersion` a vuoto **senza dirlo**, bruciava il trigger di
qualunque migrazione. Ora il caso è visibile; quando il runner esisterà, dovrà
comunque girare **prima** della riconciliazione.

## Conseguenze

- Rinomine, rimozioni e cambi di valore diventano migrabili: cade il limite "solo
  aggiunte" che ha reso inefficaci 3 bump su 4.
- I tre workaround esistenti diventano rimovibili (in un intervento successivo, non
  in questo).
- Gli autori di plugin/temi di terze parti hanno un percorso di aggiornamento
  standard, che viaggia dentro il pacchetto e sopravvive all'installazione da Git.
- Il `.md` per step rende la migrazione complessa **delegabile a un'AI** con un
  formato prevedibile, invece che a prosa libera.
- Il descrittore diventa il clock del pacchetto: convenzione nuova da documentare
  nelle skill di scaffolding e nei doc dei plugin.

## Punti rimandati

- **Rimozione dei tre workaround** una volta che il merge ricorsivo è in produzione.
- **GUI admin** per le migrazioni (per ora CLI + box al boot).
- **Rollback** di una migrazione applicata (oggi: ripristino dal backup).
- **`reversible`** come campo dello step: previsto in bozza, escluso da questa
  decisione finché non esiste un meccanismo di rollback che lo onori.

## Storia

Maturata in una sessione di brainstorming iterativo (luglio 2026) partita da due
problemi segnalati dal maintainer sull'installazione dei plugin da GUI; il primo
(config vivi vs `.default`) è stato risolto nella Fase 6 di
[`config-lifecycle.it.md`](./config-lifecycle.it.md), il secondo — il versionamento
dei file di configurazione — ha prodotto questa decisione. Struttura della cartella,
formato dell'indice, contratto dello script e naming approvati esplicitamente dal
maintainer; la regola "`script` assente + `automatic: true`" è una **correzione del
maintainer** a una mia asserzione sbagliata (avevo classificato quel caso come
contraddizione: è invece il caso più frequente, e il merge additivo lo copre da
solo).
