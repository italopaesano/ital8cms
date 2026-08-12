<!-- ital8doc v1-1 · tipo: reference · lang: it -->
# TODO — ital8cms

Lavori **aperti e rimandati**, raccolti dai registri di decisione (`docs/decisions/`),
dalla roadmap e dal debito emerso durante gli interventi. Ogni voce indica la
**fonte**, così è sempre ricostruibile il perché.

Distinzione con gli altri due registri:

| File | Cosa contiene |
|---|---|
| **`TODO.md`** (questo) | lavori aperti e spuntabili, con la loro origine |
| [`docs/roadmap.it.md`](./docs/roadmap.it.md) | direzioni ampie, non impegni di rilascio |
| [`CHANGELOG.md`](./CHANGELOG.md) | ciò che è già stato fatto |

---

## Indice

1. [Migrazione dei config](#1-migrazione-dei-config)
2. [Ciclo di vita dei config](#2-ciclo-di-vita-dei-config)
3. [Installazione di pacchetti da repo Git](#3-installazione-di-pacchetti-da-repo-git)
4. [Documentazione e scaffolding](#4-documentazione-e-scaffolding)
5. [Testing](#5-testing)
6. [Sicurezza](#6-sicurezza)
7. [Dipendenze](#7-dipendenze)
8. [Direzioni ampie](#8-direzioni-ampie)

---

## 1. Migrazione dei config

Fonte: [`docs/decisions/config-migrations.it.md`](./docs/decisions/config-migrations.it.md) → *Punti rimandati*.
Lo standard `migrations/` è implementato (v2.67.0); quel che segue è rimasto fuori.

- [ ] **Rimuovere i tre workaround** resi superflui dal merge ricorsivo. Erano nati
      per compensare i limiti del vecchio merge top-level, e sono tuttora nel codice:
  - [ ] `DEFAULT_EXEMPT_PATHS` hardcoded in `core/priorityMiddlewares/runtimeGate.js`
        (compensava `maintenance.exemptPaths`, chiave annidata che non arrivava)
  - [ ] i fallback `custom.dataPath || './data'` in `plugins/exampleComplete/main.js`
        e `plugins/analytics/main.js`
  - [ ] il *Pass A* di `scripts/lib/pluginDepsReconciler.js`, che force-sovrascrive
        `nodeModuleDependency` dal default: è una migrazione vera, cablata su una
        sola chiave e fuori dal meccanismo. Va valutato se sostituirla con una
        migrazione dichiarata in `plugins/adminMedia/migrations/`
  > ⚠️ Da fare **con cautela**: ogni rimozione va verificata su un'installazione
  > aggiornata (vivo indietro rispetto al default), non solo su un clone fresco —
  > è il caso che i workaround coprivano.
- [ ] **GUI admin per le migrazioni** (oggi: CLI + box `[MIGRATE]` al boot).
      Candidata a seguire le *Tre Viste*: data view degli step pendenti + esecuzione.
- [ ] **Rollback di una migrazione applicata.** Oggi si ripristina a mano dal backup
      `*.backup-vN-<timestamp>` che il runner crea prima di ogni step.
- [ ] **Campo `reversible` negli step**: previsto in bozza ed escluso finché non
      esiste un meccanismo di rollback che lo onori.

## 2. Ciclo di vita dei config

Fonte: [`docs/decisions/config-lifecycle.it.md`](./docs/decisions/config-lifecycle.it.md) → *Punti rimandati*.

- [ ] **Reset via GUI web** dedicata (oggi solo `npm run cli -- reset <target>`).
- [ ] **Semantica delle "scelte di configurazione obbligatorie"** come precondizione
      dello stato `installed` di un plugin: da definire con precisione.
- [ ] **Cronologia/undo delle modifiche** ai config (backup rotazionale on-write):
      già prototipato in `plugins/adminBootstrapNavbar/lib/navbarFileManager.js`,
      da valutare come promozione a utility del core.
- [x] ~~**I tre config core vivi non vengono materializzati al boot.**~~ **RISOLTO.**
      Il boot ora materializza `core/priorityMiddlewares/koaSession.json5` e
      `core/admin/adminConfig.json5` dai rispettivi `.default`; se manca anche il
      `.default` esce con un box `[CONFIG]` invece dello stack trace.
      Due precisazioni rispetto a come la voce era scritta: le coppie sono **due**,
      non tre — `ital8Config.json5` resta escluso di proposito, perché la sua
      assenza è il gate `[INIT]` e rigenerarlo scavalcherebbe il wizard — e
      `koaSession` non poteva essere materializzato «prima della riconciliazione»,
      perché lo legge il montaggio dei priority middleware, che gira a livello di
      modulo: di qui la variante sincrona `materializeFromDefault.sync`.
      *Fonte: incontrato durante il Passo 4 di `sentinel`. Chiuso come R3 del
      «Piano di rifinitura».*

## 3. Installazione di pacchetti da repo Git

Fonte: intervento v2.64.0 (canonizzazione del `.default`).

- [ ] **Rigenerare e ripushare i due repo GitHub di test dei temi** —
      `italopaesano/ital8cms-theme-themePublicForTest` e
      `…-themeAdminForTest` — con `bash scripts/generateTestThemes.sh` (già
      aggiornato allo standard `.default`). Sono pacchetti creati prima della regola,
      quindi oggi fuori standard.
      **Finché non è fatto:** i 5 test di installazione in
      `plugins/admin/tests/integration/themesInstall.realRepo.test.js` restano
      **skippati** con un warning esplicito a ogni run. Il rilevamento della
      conformità del remoto è automatico: si riattivano da soli dopo il push, senza
      toccare codice.
- [ ] **Verificare lo stesso per il repo di test dei plugin**, se pubblicato
      (`scripts/generateTestPlugins.sh` è già allineato).

## 4. Documentazione e scaffolding

- [x] ~~**Le skill di scaffolding non conoscono `migrations/`**~~ — fatto (v2.69.0).
      `ital8cms-plugin-creator` e `ital8cms-theme-creator` hanno ora la regola nelle
      *Conventions*, un add-on dedicato e la nota obbligatoria nel riepilogo finale.
      Scelta esplicita: **non** si scaffolda `migrations/` per un pacchetto nuovo
      (a `schemaVersion: 1` non c'è nulla da cui migrare), ma la skill deve dire
      cosa fare al primo cambio di struttura.
- [x] **`core/priorityMiddlewares/README.md`**: nota legacy di 10 righe, fuori
      standard ital8doc, che non documenta né il maintenance gate né gli altri
      priority middleware. Riscrittura come task dedicato.
      *(Fonte: CHANGELOG v2.63.0, "Gap noto".)*
      → **Fatto** in v2.71.1: ordine completo dei sette middleware con la ragione
      di ogni posizione, i tre gate a runtime con le loro asimmetrie, il modello
      dello slot pre-router, e la procedura per aggiungerne uno nuovo.
- [ ] **Completare la documentazione del plugin `admin`.** `EXPLAIN.it.md` (creato
      in v2.69.0) copre a fondo la sola **installazione da repo Git**; gli altri
      moduli — `pluginsManagment`, `themesManagment`, `pagesManagment`,
      `systemSettings` — hanno per ora una riga di mappa ciascuno. Manca inoltre il
      `README.it.md` del plugin, obbligatorio per ital8doc.
      *(Il vecchio `EXPLAIN.md` era un placeholder di 15 righe con uno schema di
      `pluginConfig` obsoleto; sostituito dallo stub inglese standard.)*
- [ ] **Confermare il nome `_internals`** in `core/editJson5.js` — proprietà di
      export interna, introdotta in v2.66.0 per condividere il locator testuale con
      `setJson5Key` senza duplicarlo. Rinominabile senza impatto esterno.
- [ ] **Riempire gli stub `.md` inglesi** (plugin, temi, core EXPLAIN, guide) alla
      prima pubblicazione importante. *(Fonte: `docs/roadmap.it.md`.)*
- [ ] **Pagina segnaposto di primo avvio per `/www`.** Su un'installazione
      `production` pulita `www/` è vuota per progetto (git-ignored, il wizard non ci
      mette nulla: «www vuota» è una scelta dichiarata in `scripts/init.js`). Da
      quando `dirListing.wwwPath` è `false` di default, `GET /` risponde **404**: più
      onesto di prima — l'elenco mostrava `.gitkeep` — ma il primo avvio perde il suo
      «funziona!» accidentale, e un 404 alla radice si legge come «è rotto».
      Da valutare: un `index.ejs` di benvenuto seminato dal wizard nel solo profilo
      `production` (il profilo `demo` già popola `www` da `.demoData/`), oppure una
      pagina di cortesia servita solo quando `www` è priva di indice.
      *Fonte: emerso riattivando `dirListing` dopo la release 5.2.0 di
      `koa-classic-server`.*

## 5. Testing

Fonte: `docs/roadmap.it.md` (punti 11–15) e osservazioni di sessione.

- [ ] **Flake osservato una volta** in `tests/integration/pluginNpmInstall.test.js`
      ("self-contained già installato → npm install SALTATO"), durante una suite
      completa. Non riprodotto in 5 esecuzioni mirate né in 2 baseline. Più test
      spawnano `node index.js` sulla **porta 3000**: la causa probabile è contesa
      di porta. Mitigazione già applicata al test dell'upgrade (porta dedicata);
      valutare di estenderla a tutti i test che avviano un server.
- [ ] **Migrare i test plugin-specifici** da `/tests/unit/{pluginName}/` a
      `plugins/{pluginName}/tests/` (convenzione già in vigore; migrato solo
      `bootstrapNavbar` come riferimento).
- [ ] **E2E/Playwright per plugin e temi**: estendere la discovery automatica oltre
      unit e integration, con orchestrazione del server.
- [ ] **Soglia minima di coverage** con fail della CI, calcolata in modo aggregato
      (core + plugin attivi + temi).
- [ ] **Scanner prescrittivo al boot** (Fase 2 del testing): verifica per ogni
      plugin attivo dei test minimi richiesti (un test per metodo esportato, uno per
      rotta incluso `access`, validazione dei JSON5, lifecycle hooks). Default
      warning, `testingStrictMode: true` per promuoverli a fatali.
- [ ] **Safety net filesystem nei test**: hook che verifichi che nessun test scriva
      dentro `plugins/*/` o `themes/*/` reali (oggi è solo una convenzione).

## 6. Sicurezza

Fonte: `docs/roadmap.it.md` punto 17 — *Modello di sicurezza completo per il clone Git*.

La mitigazione attuale (URL SSH riservati al ruolo root) è **volutamente parziale**.
Da affrontare in una review dedicata:

- [ ] **Audit log dei cloni** con utente, URL, protocollo, esito, timestamp.
      *(Parzialmente presente: `pluginInstallLog.json5` / `themeInstallLog.json5`.)*
- [ ] **Scenari multi-tenant**: la restrizione a role 0 non basta se più clienti
      condividono lo stesso utente di sistema e la stessa chiave SSH.
- [ ] **Flag di configurazione** per disabilitare del tutto SSH a livello di sistema
      (`allowSshClone`), indipendentemente dal ruolo.
- [ ] **Host whitelist** opzionale (es. solo `github.com`/`gitlab.com`).
- [ ] **Affidabilità headless dell'SSH**: `GIT_SSH_COMMAND` con `BatchMode=yes` e
      `StrictHostKeyChecking` per errori deterministici quando la chiave manca, ha
      passphrase senza agent, o l'host non è in `known_hosts`.
- [ ] **Supporto PAT/token gestiti** come alternativa granulare alla chiave del
      server (credenziali per-installazione invece dell'identità della macchina).

## 7. Dipendenze

Fonte: `docs/roadmap.it.md` punto 16 — aggiornamenti rinviati dal bulk del 2026-05-19.

**Ultimo giro di routine: 2026-08-12** (v2.84.0) — `npm outdated` pulito e
`npm audit` a **0 vulnerabilità**, con la sola esclusione di `ccxt` per policy.

- [ ] **`ccxt`** (plugin `ccxt`), `4.5.58` → `4.5.73`: verificare se è ancora usato e
      se la superficie API è cambiata fra le minor; testare le rotte prima del bump.
      *Escluso dagli update di routine per policy (CLAUDE.md regola 12): release molto
      frequenti legate alle API degli exchange.*
- [x] ~~**`inquirer` 8.2.7 → 13.x**~~ — **già fatto in un intervento precedente**: la
      dipendenza dichiarata è `^14.0.2` (installata `14.0.2`). Il passaggio è avvenuto
      senza il rewrite verso `@inquirer/prompts` che questa voce dava per necessario:
      `scripts/init.js` e `scripts/lib/configWizard.js` usano
      `require('inquirer').default` e continuano a chiamare `inquirer.prompt([...])`,
      cioè l'interop CommonJS del pacchetto ESM. Voce rimasta indietro rispetto al
      codice.
- [ ] **`better-sqlite3`** (plugin `dbApi`, oggi `active: 0`): alla riattivazione,
      valutare la versione corrente (range del plugin `^9.2.2`, latest 12.x con
      cambi di ABI) con install e test mirati.
      *Escluso dagli update di routine per policy (CLAUDE.md regola 12): build nativa
      e plugin disabilitato.*

### 🐞 `koa-classic-server` — `dirListing.enabled: false` disabilitava anche la risoluzione del file indice → **CORRETTO in v5.2.0**

Fonte: intervento *superficie riservata / assetto vetrina*.
**Dipendenza mantenuta dal team → corretta nel modulo, NON aggirata (CLAUDE.md regola 4).**

- [x] **Segnalato al maintainer** (Italo Paesano) → **release `5.2.0`**.
- [x] `npm install koa-classic-server@5.2.0` (`package.json` → `^5.2.0`). Suite completa verde.
- [x] **Fix verificato in entrambe le direzioni** con una riproduzione mirata, prima sulla
      5.1.0 e poi sulla 5.2.0 (cartella con indice + cartella senza, così si distingue
      «l'indice è tornato» da «il listing è stato riacceso», che sarebbe una regressione):

      dirListing.enabled: false        5.1.0    5.2.0
        /            (con indice)       404  →   200 ✅
        /sotto/      (con indice)       404  →   200 ✅
        /pagina.ejs  (file diretto)     200      200
        /senza-indice/ (nessun indice)   —       404 ✅ (nessun listing: lo switch fa
                                                         ancora il suo mestiere)

**Riattivazione completata**, con una deviazione dal progetto originale:

- [x] `index.js`, static server di `/www`: legge la chiave invece del `true` cablato.
      Forma scelta: `ital8Conf.dirListing?.wwwPath === true` (non `!== false`) — chiave
      assente ⇒ spento, coerente col default: una chiave di sicurezza non si accende
      per omissione.
- [x] `ital8Config.default.json5`: chiave `dirListing: { wwwPath: false }`,
      `schemaVersion` 4 → 5. **Default `false`, non `true`**: con l'elenco acceso la
      radice di un sito senza `index.ejs` è essa stessa un elenco e `/media/` enumera
      ogni file caricato (misurato). Aggiunta top-level ⇒ il merge additivo la propaga
      alle installazioni esistenti, nessuna migrazione.
- [x] ~~`handlePublicOnly`: terzo passo~~ → **NON si fa, ed è la decisione**. `admin` e
      `reserved` sono *stato di superficie*; `dirListing.wwwPath` è una *preferenza del
      sito* che la macro non possiede. Una macro reversibile che modifica in modo
      permanente una chiave altrui o non la ripristina (e `off` non riporta
      l'installazione dov'era) o la ripristina a un valore fisso (e può **accendere**
      l'elenco dove era stato spento apposta). Il default `false` rende comunque il
      passo inutile in vetrina. Motivazione scritta nel codice e nel doc.
- [x] `docs/cli-control-plane.it.md`: l'avviso è diventato la spiegazione del perché
      quel passo non esiste.
- [x] `tests/integration/dirListing.test.js` (+8): entrambi i valori, su server reale,
      interrogando sia directory **con** indice sia **senza** — «l'indice è tornato» e
      «l'elenco è stato riacceso» sono esiti diversi e solo il primo è voluto.

**Conseguenza da valutare a parte:** su un'installazione `production` pulita `www/` è
vuota per progetto (git-ignored, il wizard non ci mette nulla), quindi ora `GET /`
risponde **404** invece dell'elenco di `.gitkeep`. Più onesto, ma il primo avvio perde
il suo "funziona!" accidentale. Vedi §4 → *pagina segnaposto di primo avvio*.

**Root cause** — in `node_modules/koa-classic-server/index.cjs`, ramo directory:

```js
if (stat.isDirectory()) {
    if (options.dirListing.enabled) {
        // ...trailing-slash redirect...
        // ricerca del file indice (options.index) → serve il file trovato
        // nessun indice → mostra il listing
    } else {
        await sendErrorPage(ctx, 404);   // ← l'indice non viene MAI cercato
    }
}
```

La ricerca dell'indice vive **dentro** il ramo `enabled`, quindi `enabled: false`
cortocircuita a 404 prima di guardare `options.index`.

**Comportamento atteso:** `dirListing.enabled` dovrebbe governare **solo il fallback
listing**. Con `enabled: false` e `index: ["index.ejs"]` una directory che contiene
l'indice deve servirlo (200); il 404 deve scattare **solo** quando nessun indice
corrisponde.

**Riproduzione minima** (verificata):

```js
kcs(dir, { index: ['index.ejs'], dirListing: { enabled: true  }, /* … */ }) // GET / → 200, serve index.ejs
kcs(dir, { index: ['index.ejs'], dirListing: { enabled: false }, /* … */ }) // GET / → 404 ❌
```

**Sistemi affetti:** qualunque sito che voglia servire una homepage **senza**
esporre il directory listing — cioè la configurazione normale di un sito in
produzione. Oggi le due cose non sono separabili.

## 8. Direzioni ampie

Non sono debito, ma direzioni: il dettaglio vive in
[`docs/roadmap.it.md`](./docs/roadmap.it.md) e non è duplicato qui.

- [ ] Migrazione a **TypeScript**
- [ ] Configurazione via **`.env`**
- [ ] **Documentazione API** (Swagger/OpenAPI)
- [ ] **Error handling** centralizzato come middleware
- [ ] **Logging strutturato** (Winston/Bunyan)
- [ ] **Libreria di validazione** delle richieste (Joi/Yup)
- [ ] **Build frontend** (bundling degli asset)
- [ ] **Cleanup dei plugin allo shutdown** coordinato da `pluginSys`, oggi lasciato
      a ogni plugin (es. `urlRedirect/hitCounter.js` gestisce i propri segnali)
