<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione: ciclo di vita dei file di configurazione (default, stati, reset, versionamento)

> **Stato: APPROVATA** (2026-06-25) — design condiviso, **implementazione pianificata a fasi, non ancora avviata**.

## Contesto

Oggi i file di configurazione `.json5` sono committati come file "vivi": una volta modificati (a mano o via GUI admin) i valori di default originali vanno persi e non esiste un meccanismo per **conservarli** né per **ripristinarli**. Inoltre il concetto di "stato" di un plugin è parzialmente implementato e ambiguo:

- `pluginConfig.json5` ha già `active` e `isInstalled`, ma `isInstalled` non ha una semantica operativa precisa (chi lo imposta, cosa lo rende `true`).
- Il boot è **fail-fast**: un solo plugin con dipendenze non soddisfatte solleva un'eccezione (`core/pluginSys.js:222, 273, 307`) che **interrompe l'intero avvio** del CMS.
- La versione del plugin non viene mai persistita nel file vivo (`core/pluginSys.js:117-119`), quindi il rilevamento del "drift" di configurazione è di fatto inerte.

Questa decisione completa quanto rimasto aperto in [`theme-active-isinstalled.it.md`](./theme-active-isinstalled.it.md), che definiva la rimozione di `active` dai temi e rimandava la semantica operativa di `isInstalled` "a un secondo momento". Questo è quel momento, esteso a plugin, temi e config globali.

> **Scope attuale:** solo la gestione dei **default** (conservazione + ripristino) e il **modello a stati** che ne deriva. La cronologia/undo delle modifiche e la **migrazione vera** dei config tra versioni sono esplicitamente **rimandate** (vedi *Punti rimandati*).

## Decisione

### 1. Standard sidecar `x.default.json5`

Per ogni file di configurazione modificabile esiste un sidecar **`x.default.json5`** (fonte di verità, immutabile, committato) accanto al file **`x.json5`** (vivo, modificabile, generato a partire dal default).

- **Git:** i `*.default.json5` sono **versionati**; i `x.json5` vivi sono **git-ignored** e **assenti nel pacchetto distribuito**.
- **Materializzazione:** `x.json5` viene generato copiando `x.default.json5` (scrittura **atomica**, temp + `rename`).

Tre categorie di config, trattate diversamente:

| Categoria | Esempi | Trattamento |
|---|---|---|
| Ciclo di vita (plugin/temi) | `seoPages.json5`, `redirectMap.json5`, `accessControl.json5`, `pluginConfig.json5`, `themeConfig.json5` | regola default→live legata a install/reset |
| Core/globali (sempre presenti) | `ital8Config.json5`, `koaSession.json5`, `adminConfig.json5` | solo sidecar `.default` per il factory reset; nessuna semantica "installato" |
| Dati utente | `userAccount.json5`, `userRole.json5` | sidecar `.default` come **seed** (vedi §3) |

### 2. Modello a 3 stati dei plugin

Lo stato non è una seconda fonte di verità separata: è la combinazione tra **presenza del file** e flag `isInstalled`.

| Stato | Filesystem | Significato |
|---|---|---|
| **`available`** | cartella presente, **nessun** `pluginConfig.json5` | solo codice + `.default`; nessun controllo ancora eseguito |
| **`incomplete`** | `pluginConfig.json5` con `isInstalled: 0` | preso in carico, ma precondizioni non soddisfatte (dipendenze npm/plugin o configurazione) |
| **`installed`** | `pluginConfig.json5` con `isInstalled: 1` | tutte le precondizioni soddisfatte, pronto per l'attivazione |

- **`isInstalled` mantenuto**, con significato preciso: *"tutte le precondizioni sono soddisfatte"*.
- **`active` (0/1) è ortogonale** ed è significativo **solo** nello stato `installed`: un plugin pronto può essere attivo o dormiente.
- `isInstalled` è uno **stato runtime**: **non** compare in `pluginConfig.default.json5` (lo imposta il boot dopo la valutazione). Il default contiene `active`, `weight`, `dependency`, `nodeModuleDependency`, `schemaVersion`, `custom`.
- **Valutazione idempotente:** le precondizioni sono rivalutate a **ogni boot**; un plugin `incomplete` passa automaticamente a `installed` quando le dipendenze vengono risolte (es. dopo `npm install`), senza azioni manuali.

### 3. Operazioni

- **Reset** = cancellare i `x.json5` del plugin → torna `available` → rigenerati dai `.default` al boot successivo. Il reset reimposta anche `active` al valore di default.
- **Reset totale, nessuna eccezione:** il reset include anche i **dati utente**. Conseguenze:
  - `userRole.default.json5` contiene i 4 ruoli hardcoded (0–3); `userAccount.default.json5` è **vuoto**.
  - Resettare `adminUsers` azzera gli account → **lockout del root** finché non viene ricreato (wizard o a mano). Mitigazione: i plugin in `essentialPlugins` (§4) richiedono **conferma rafforzata** al reset via CLI.
- **Niente reset granulare** per singolo file: il reset opera a livello di plugin. Lo sviluppatore può intervenire manualmente sul singolo file se serve.
- **Disattiva** = `active: 0`; **non** tocca i file → le modifiche restano (plugin dormiente).

### 4. Boot: da fail-fast a degradazione graziosa

- I `throw` che bloccano l'avvio (`core/pluginSys.js:222, 273, 307`) diventano **skip + marcatura `isInstalled: 0` (incomplete) + warning**; il boot **completa sempre** con un **box di riepilogo** dei plugin rimasti indietro e del motivo.
- **Propagazione a cascata:** se A dipende da B e B è `incomplete`, A viene marcato `incomplete` (non attivabile), senza interrompere il boot.
- **Plugin critici — lista centralizzata `essentialPlugins`** in `ital8Config.json5`, con commento che ne segnala la pericolosità in caso di modifica. Doppio uso:
  1. **Boot:** un plugin essenziale che fallisce → box `[FATAL]` + `process.exit` (un sito con auth/CSRF rotti non deve essere servito).
  2. **Reset CLI:** il reset di un plugin essenziale richiede **conferma rafforzata**.
- I plugin **non** essenziali degradano in modo grazioso (skip).

### 5. Gate di inizializzazione al boot

- Se manca `ital8Config.json5` (presente solo `ital8Config.default.json5`) → **box ASCII in console** ("esegui `npm run start-configure`") + `process.exit`. **Non** una pagina web (senza config globale non si conosce nemmeno la porta; coerente con lo stile di `core/sessionSecurity.js` e `core/processSafetyNet.js`).
- Il gate riguarda **solo il config globale**; i config di plugin/tema si **auto-materializzano** dopo.
- Aggancio: `index.js:34` (dove `ital8Config.json5` è già caricato con `process.exit(1)` in caso di errore) + il wizard esistente `scripts/init.js`.

**Confine di materializzazione:**
- Il **wizard** (`npm run start-configure`) materializza i config **core/globali** (`ital8Config`, `koaSession`, `adminConfig`) — richiedono scelte non indovinabili (chiavi di sessione, utente root, profilo).
- Il **boot** materializza automaticamente i config di **plugin/tema** mancanti (default sani, zero interazione).

### 6. Versionamento di schema

- Campo JSON5 **`schemaVersion`** in ogni config versionabile, **intero incrementale** a partire da `1`, come prima chiave dell'oggetto, con commento esplicativo a destra.
- L'incremento è **delegato allo sviluppatore**, da effettuare quando cambia la **struttura** del file (aggiunta/rinomina/rimozione di chiavi) — decisione semantica che solo l'umano può qualificare.
- **Hash del default scartato:** misurerebbe anche i *valori*, non la sola *struttura* → falsi positivi di drift.
- Distinto da `pluginDescription.version` (versione del **codice** del plugin). `upgradePlugin(old, new)` resta il **luogo** delle migrazioni; `schemaVersion` per-file indica **quali file** sono fuori allineamento.
- In questa decisione si implementa **solo il rilevamento** del drift (confronto `schemaVersion` default↔live → warning). La migrazione vera è rimandata.

### 7. Temi

Stesso modello dei plugin, con una differenza: **niente `active` locale** (l'attivazione resta in `ital8Config.json5` → `activeTheme`/`adminActiveTheme`, come da decisione precedente). Presenza di `themeConfig.json5` = preso in carico; reset = cancellazione → rigenerazione dal default.

## Naming (approvato)

| Concetto | Nome scelto |
|---|---|
| Stato 1 (codice presente, non preso in carico) | `available` |
| Stato 2 (preso in carico, precondizioni mancanti) | `incomplete` |
| Stato 3 (precondizioni soddisfatte) | `installed` |
| Lista plugin critici in `ital8Config.json5` | `essentialPlugins` |
| Suffisso sidecar default | `x.default.json5` |
| Campo versione di schema | `schemaVersion` |

> Naming ancora da fissare in fase implementativa: l'utility core di materializzazione (candidati: `materializeFromDefault` · `ensureLiveConfig` · `hydrateConfig`).

## Piano a fasi

| Fase | Contenuto |
|---|---|
| **0 — Fondamenta + migrazione repo** | Congelare elenco file e tassonomia; generare i `.default` dai live attuali con `schemaVersion: 1`; `.gitignore` + untrack dei live; `.npmignore`/build per il pacchetto. *(Nessun nuovo comportamento.)* |
| **1 — Materializzazione + reset** | Utility core di materializzazione atomica + reset; hook al boot per i config plugin/tema mancanti; comando di reset in `bin/ital8cms-cli.js`. *(Obiettivo originale: conservare/ripristinare i default.)* |
| **2 — Stati + boot graceful** | `isInstalled` = precondizioni OK; `throw`→skip+marca+warning; propagazione a cascata; `essentialPlugins` + logica critico/opzionale; box di riepilogo. |
| **3 — Gate di init** | Box ASCII se manca `ital8Config.json5` + exit. |
| **4 — `schemaVersion` (solo rilevamento)** | Campo nei `.default`; utility di confronto default↔live → warning di drift. |
| **5 — Allineamento temi** | `themeConfig.default.json5`; presenza = preso in carico; nessun `active` locale. |

**Corsia trasversale (in ogni fase, non alla fine):**

| Ambito | Impatto censito |
|---|---|
| `CLAUDE.md` | sezioni "Config del plugin", "Strategia di archiviazione", "Sistema dei temi", "Flusso di avvio", "Riferimento file" |
| Skill (5) | `ital8cms-plugin-creator` e `ital8cms-theme-creator` devono generare i `.default` + `schemaVersion`; verificare `bootstrapNavbar-creator`, `simpleI18n-integrator`, `website-builder` |
| Documentazione (~30 file) | deep-dive `core/EXPLAIN-pluginsSys.it.md`, `core/EXPLAIN-themeSys.it.md`, `core/admin/EXPLAIN.it.md`; README/EXPLAIN dei plugin; **evolvere** `docs/decisions/theme-active-isinstalled.it.md` |
| Test (~20 + nuovi) | `tests/integration/pluginLoading.test.js` (critico), `themeSys`, `editJson5`/`saveJson5`/`loadJson5`; nuovi test per materializzazione, reset, boot-graceful, gate, drift |
| `CHANGELOG.md` | breaking changes (progetto alpha) |

*(Riferimento quantitativo: ~73 occorrenze di `isInstalled` nel codebase al momento della decisione.)*

## Punti rimandati

- **Migrazione vera** dei config al cambio di `schemaVersion` (oltre il semplice warning): meccanismo, dove persistere "l'ultima versione vista" (candidato: `scripts/lib/stateManager.js`), aggancio a `upgradePlugin()`.
- **Reset via GUI web** dedicata (per ora solo CLI).
- Semantica esatta delle "scelte di configurazione obbligatorie" come precondizione dello stato `installed`.
- Cronologia/undo delle modifiche (backup rotazionale on-write): già prototipato in `plugins/adminBootstrapNavbar/lib/navbarFileManager.js`, da eventualmente promuovere a utility core in un intervento separato.

## Conseguenze

- I default non si perdono più: sono sempre recuperabili dai `*.default.json5` versionati.
- Il CMS diventa robusto a plugin non installabili (degradazione graziosa), salvo i plugin `essentialPlugins`.
- La distribuzione cambia filosofia: pacchetto "vergine" (solo `.default`) inizializzato al primo `npm run start-configure`. Va documentato in `CHANGELOG.md`.
- La semantica di `isInstalled` rimasta aperta in `theme-active-isinstalled.it.md` è ora definita.

## Storia

Decisione maturata in una sessione di brainstorming iterativo (giugno 2026): dallo standard sidecar `x.default.json5`, al modello a stati legato al ciclo di vita, fino alla degradazione graziosa del boot e al versionamento di schema delegato allo sviluppatore. Naming degli stati approvato esplicitamente dal maintainer.
