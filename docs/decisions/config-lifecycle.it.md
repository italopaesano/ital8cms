<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione: ciclo di vita dei file di configurazione (default, stati, reset, versionamento)

> **Stato: IMPLEMENTATO** — design **APPROVATO** (2026-06-25), implementazione completata (2026-06-27). **Tutte le fasi 0–5** completate (la migrazione repo è completa; resta solo la *corsia trasversale*: doc/skill/EXPLAIN). Dettaglio in *Stato di implementazione* (in fondo).

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

I `*.default.json5` dei config "di contenuto" rappresentano lo stato **minimale/vergine** ("appena installato"): es. `seoPages` senza regole, `redirectMap` vuota. Gli esempi vivono altrove (profilo demo, documentazione), non nei default. I `pluginConfig.default.json5`/`themeConfig.default.json5` corrispondono invece ai valori di default attuali del descrittore.

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
- **Canale del reset:** *offline* (CLI che agisce sul filesystem, funziona anche a server spento — copre il caso "config corrotta, server non parte") come base, più una variante *online* (via socket al server in esecuzione, per il reset a caldo senza riavvio).
- **Reset totale, nessuna eccezione:** il reset include anche i **dati utente**. Conseguenze:
  - `userRole.default.json5` contiene i 4 ruoli hardcoded (0–3); `userAccount.default.json5` è **vuoto**.
  - Resettare `adminUsers` azzera gli account → **lockout del root** finché non viene ricreato (wizard o a mano). Mitigazione: i plugin in `essentialPlugins` (§4) richiedono **conferma rafforzata** al reset via CLI.
- **Niente reset granulare** per singolo file: il reset opera a livello di plugin. Lo sviluppatore può intervenire manualmente sul singolo file se serve.
- **Disattiva** = `active: 0`; **non** tocca i file → le modifiche restano (plugin dormiente).

### 4. Boot: da fail-fast a degradazione graziosa

- I `throw` che bloccano l'avvio (`core/pluginSys.js:222, 273, 307`) diventano **skip + marcatura `isInstalled: 0` (incomplete) + warning**; il boot **completa sempre** con un **box di riepilogo** dei plugin rimasti indietro e del motivo.
- **Propagazione a cascata:** se A dipende da B e B è `incomplete`, A viene marcato `incomplete` (non attivabile), senza interrompere il boot.
- **Plugin critici — lista centralizzata `essentialPlugins`** in `ital8Config.json5`, con commento che ne segnala la pericolosità in caso di modifica. Lista iniziale: **`adminUsers`** (auth), **`adminAccessControl`** (senza, il campo `access` obbligatorio sulle rotte non è applicato), **`admin`** (core del pannello). `csrfProtection` resta **opzionale** (degrada con warning). Doppio uso:
  1. **Boot:** un plugin essenziale che fallisce → box `[FATAL]` + `process.exit` (un sito con auth o access control rotti non deve essere servito).
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
- Il campo `schemaVersion` va su **tutti i config versionabili** (descrittori, core e config di contenuto), così ogni file può evolvere la propria struttura in modo indipendente.
- In questa decisione si implementa **solo il rilevamento** del drift (confronto `schemaVersion` default↔live → warning). La migrazione vera è rimandata.
- **Comportamento provvisorio del boot** quando un `x.json5` vivo esiste già ma il suo `.default` ha una `schemaVersion` più recente (struttura cambiata): **merge additivo** delle sole chiavi nuove del default (senza toccare i valori esistenti) **+ warning**. È una soluzione-ponte: il comportamento ideale (controllo pre-aggiornamento + scelta esplicita dell'utente su come procedere) sarà definito quando si stabiliranno le procedure di aggiornamento.

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
| Utility core di materializzazione (una coppia default→live) | `materializeFromDefault` |
| Utility core di materializzazione (una cartella plugin/tema) | `materializeDirDefaults` |
| Utility core di materializzazione (un contenitore: `plugins/`/`themes/`) | `materializeMissingConfigs` |
| Utility core di reset (rimuove i vivi di una cartella) | `resetConfigsToDefault` |
| Utility core upsert di una chiave JSON5 (add-or-update, preserva i commenti) | `setJson5Key` |
| Modulo puro: precondizioni + stati + cascata | `pluginStateResolver` (`checkNpmDeps`, `resolvePluginStates`) |

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

## Stato di implementazione

Aggiornato al 2026-06-27 (Fase 5 completata) · branch `claude/dazzling-darwin-g8wmbd` (PR #306).

### Completato

**Fase 0 — generazione `.default` + untrack (parziale)**
- Generati i `*.default.json5` dai vivi attuali (descrittori: copia − `isInstalled` + `schemaVersion`; contenuto/dati: stato minimale/vergine). Tool one-shot `scripts/generateConfigDefaults.js`, con verifica `loadJson5` su ogni output. `ccxt` escluso per policy (`ccxt.json5`/`customExchangesKey.json5`).
- Untrack (`git rm --cached`) + git-ignore dei vivi di **contenuto** (`seoPages`, `redirectMap`, `accessControl`, `protectedRoutes`) e **dati utente** (`userAccount`, `userRole`) — rigenerati al boot dai `.default`.
- `pluginInstallLog` riclassificato come **audit log runtime** → git-ignored e `.default` rimosso (creato on-demand da `pluginsInstall.js`, come `themeInstallLog`).
- **Ancora da fare** (dipende dalle fasi successive): untrack dei **descrittori** (`pluginConfig`/`themeConfig` → Fase 2) e dei **core** (`ital8Config`/`adminConfig`/`koaSession` → Fase 3); `.npmignore`/pacchetto vergine (a untrack completo).

**Fase 1 — materializzazione + reset**
- Materializzazione a 3 livelli: `core/materializeFromDefault.js` (coppia), `core/materializeDirDefaults.js` (una cartella), `core/materializeMissingConfigs.js` (un contenitore), agganciata al boot in `index.js` **prima** di `pluginSys.initialize()`.
- Reset: `core/resetConfigsToDefault.js` + comando `ital8cms-cli reset <target>` **offline** (filesystem, a server spento) e **`--online`** (via socket, con restart).
- Test unit per ogni modulo + verifica di boot e di "clone fresco" (cancellazione dei vivi → rigenerazione dai `.default`).

**Fase 2 — stati + boot graceful**
- `core/setJson5Key.js` (upsert di una chiave top-level, preserva i commenti) e `core/pluginStateResolver.js` (puro: `checkNpmDeps` + `resolvePluginStates` con cascata e rilevamento cicli).
- Refactor di `pluginSys.initialize()`: stati `available`/`disabled`/`incomplete`/`installed`; i `throw` (npm/dipendenze/cicli/load-error) → skip + marcatura + box `[PLUGINS]`; cascata sui dipendenti; il boot **completa sempre**. Nuovi getter `getPluginState()`/`getPluginStates()`.
- `isInstalled` (Variante 1): "precondizioni ok", **persistito** via `setJson5Key`; `installPlugin()` solo alla transizione `isInstalled` non-1→1 (clone fresco / dipendenze appena risolte).
- `essentialPlugins` in `ital8Config.json5`: un essenziale non caricato → box `[FATAL]` + exit; reset CLI con **conferma rafforzata** (offline e `--online`).
- Untrack dei **`pluginConfig`** vivi (i `.default` restano fonte di verità; `isInstalled` scritto al boot). Clone-fresco completo verificato (rigenerazione + installazione + `isInstalled` persistito); suite 80 suite / 2182 test verdi.

**Fase 3 — gate di init + untrack dei core**
- **Gate di init** in `index.js`: se manca `ital8Config.json5` ma esiste il suo `.default` → box `[INIT]` che indirizza a `npm run start-configure` + `exit` (nessuna pagina web: senza config globale non si conosce nemmeno la porta).
- Il wizard (`scripts/init.js`, FASE 1) **materializza** i core mancanti dai `.default` (`ital8Config`, `koaSession`, `adminConfig`) prima di configurarli.
- Untrack (`git rm --cached`) + git-ignore dei **core** (`ital8Config.json5`, `adminConfig.json5`, `koaSession.json5`); i rispettivi `.default` restano la fonte di verità. Niente `.npmignore`: npm ricade su `.gitignore`, quindi i vivi sono già esclusi dal pacchetto.
- Verifica: gate (`ital8Config` rinominato → box `[INIT]` + exit 1); clone-fresco dei core (cancellati i 3 → boot mostra `[INIT]`; wizard simulato li materializza → boot up, 20 plugin); suite 80 suite / 2182 test verdi.

**Fase 4 — `schemaVersion` (solo rilevamento) + merge additivo (soluzione-ponte)**
- `core/reconcileSchemaVersion.js` (coppia singola): confronta `schemaVersion` default↔vivo; se il default è più avanti, **merge additivo** (aggiunge solo le chiavi top-level nuove, preserva i valori esistenti) e allinea `schemaVersion`. Stati: `aligned` / `merged` / `live-ahead` (anomalo) / `no-live` / `no-default-version`. Volutamente parziale: rinomine/rimozioni richiedono migrazione vera (rimandata).
- `core/reconcileSchemaVersions.js` (scansione + boot): applica il reconcile ai contenitori e alle coppie esplicite dei core, e riepiloga in un box `[SCHEMA]` **anti-rumore** (solo drift significativi con chiavi nuove + casi `live-ahead`; il semplice bump di `schemaVersion` su un vivo pre-versionamento resta silenzioso). Non lancia sui singoli errori (raccolti in `errors`): il boot non si ferma.
- Hook al boot in `index.js` dopo la materializzazione, **scope `plugins/` + i 3 core** (tutti git-ignored → la riconciliazione additiva non sporca il working tree); `themes/` escluso finché i `themeConfig` restano tracciati (→ Fase 5).
- Verifica: 9 + 6 nuovi test unit; boot reale (cores allineati silenziosamente, nessun box, working tree pulito); suite 82 suite / 2197 test verdi.

**Fase 5 — allineamento temi**
- `core/ensureThemesInstalled.js`: step di boot che allinea i temi al modello dei plugin. Un tema **bundled** (riconosciuto dalla presenza di `themeConfig.default.json5`) è "installato per definizione" ma il `.default` non porta `isInstalled` (stato runtime). Dopo la materializzazione, per ogni tema bundled il cui vivo ne è privo, persiste `isInstalled: 1` via `setJson5Key` (dopo `schemaVersion`, come `pluginSys`). **Non distruttivo** (solo se assente); i temi clonati via `themesInstall` (senza `.default`) restano intatti a `isInstalled: 0` (attivazione manuale dell'admin).
- `index.js`: aggancio di `ensureThemesInstalled` dopo la materializzazione; **`themes/` aggiunto allo scope di `reconcileSchemaVersions`** (sbloccato dall'untrack: i vivi dei temi sono ora git-ignored).
- **Untrack** (`git rm --cached`) + git-ignore di `themes/*/themeConfig.json5`; i `.default` restano committati. **Completa la migrazione repo** (descrittori plugin + temi tutti untrackati).
- Verifica: 10 nuovi test unit (`ensureThemesInstalled`) + `themesManagment.test.js` reso robusto al clone fresco (asserzioni di base sul `.default` committato); suite 83 suite / 2207 test verdi; boot reale pulito; E2E clone-fresco temi (cancellati 2 `themeConfig` → rigenerati dai `.default` con `schemaVersion:1` + `isInstalled:1`).

### Decisioni emerse in implementazione (integrano il design)
- **Reset online = reset + restart** (self-respawn/supervisor), non hot-reload "senza riavvio" puro: realizza l'intento riusando l'infrastruttura di restart esistente; l'hot-reload per-plugin resta una miglioria futura.
- **Conferma rafforzata `essentialPlugins`**: rimandata alla Fase 2 (lì vive la lista). In Fase 1 il reset usa conferma base + **avviso lockout** quando tocca dati utente (`userAccount`/`userRole`).
- **`pluginInstallLog`** è un log runtime, non configurazione → nessun `.default`, git-ignored come `themeInstallLog`.
- **`accessControl.default`** conserva l'esempio `customRules.userProfile` (regola di sicurezza *funzionale*, protegge la pagina profilo): svuotarlo esporrebbe la pagina. Spostare quella protezione "dove appartiene" (è `adminUsers` a possedere la pagina) è una miglioria architetturale separata.
- **`isInstalled` persistito (Variante 1, scelta dal maintainer):** lo stato vive nel file (non solo in memoria), scritto dal boot. Ha richiesto `setJson5Key` (add-or-update preservando i commenti) e l'untrack dei descrittori. `installPlugin()` è agganciato alla transizione `isInstalled` non-1→1: così la presenza/valore di `isInstalled` traccia anche il setup one-shot, senza un flag separato.
- **Untrack dei `themeConfig` spostato alla Fase 5 → poi RISOLTO in Fase 5:** in Fase 2 i temi non avevano ancora la gestione di `isInstalled`; untrackati allora sarebbero risultati senza `isInstalled` (rompendo `tests/unit/admin/themesManagment.test.js`). Si erano quindi untrackati solo i `pluginConfig`, lasciando i `themeConfig` tracciati con `isInstalled:1`. In **Fase 5** `ensureThemesInstalled` ripristina `isInstalled:1` al boot per i temi bundled, sbloccando l'untrack dei `themeConfig` (e il test è stato reso robusto al clone fresco, asserendo sul `.default`).
- **Tema "bundled" = ha un `.default` (Fase 5):** il criterio per distinguere un tema distribuito con ital8cms (sempre installato) da uno clonato a runtime via `themesInstall` (attivazione manuale, `isInstalled:0`) è la **presenza di `themeConfig.default.json5`**. `ensureThemesInstalled` agisce solo sui bundled, lasciando intatti i clonati — coerente con `themesInstall` che NON genera un `.default`. Non si è introdotto il modello a 4 stati dei plugin per i temi: il design (Fase 5) li vuole più semplici ("presenza = preso in carico"), e `isInstalled` dei temi è un flag gestito (1 per i bundled, 0→admin per i clonati), non una precondizione calcolata dalle dipendenze.
- **Scope del reconcile `schemaVersion` (Fase 4) = solo config git-ignored:** il merge additivo *scrive* sul vivo, quindi al boot toccherebbe file tracciati. È limitato a `plugins/` + i 3 core (tutti git-ignored) così la riconciliazione non sporca il working tree in un checkout pulito. `themes/` entrerà nello scope in Fase 5, insieme all'untrack dei `themeConfig` — stessa motivazione del punto precedente.
- **`schemaVersion` come merge additivo (soluzione-ponte), non migrazione vera:** la Fase 4 risolve solo le *aggiunte* di chiavi e segnala il drift; rinomine/rimozioni e la persistenza de "l'ultima versione vista" restano *Punti rimandati*. Il box `[SCHEMA]` invita esplicitamente a rivedere i valori dei campi aggiunti.

### Mappa fasi → stato
| Fase | Stato |
|---|---|
| 0 — `.default` + migrazione repo | ✅ generazione + untrack contenuto/dati + `pluginConfig` + core + `themeConfig` (migrazione repo completa). `.npmignore` non necessario: npm ricade su `.gitignore`, i vivi sono già esclusi dal pacchetto |
| 1 — materializzazione + reset | ✅ completata |
| 2 — stati + boot graceful | ✅ completata |
| 3 — gate di init + untrack core | ✅ completata |
| 4 — `schemaVersion` (solo detection) | ✅ completata |
| 5 — allineamento temi | ✅ completata |

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
