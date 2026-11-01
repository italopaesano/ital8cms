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

0. [Decisioni in attesa del maintainer](#decisioni-in-attesa-del-maintainer)
1. [Migrazione dei config](#1-migrazione-dei-config)
2. [Ciclo di vita dei config](#2-ciclo-di-vita-dei-config)
3. [Installazione di pacchetti da repo Git](#3-installazione-di-pacchetti-da-repo-git)
4. [Documentazione e scaffolding](#4-documentazione-e-scaffolding)
5. [Testing](#5-testing)
6. [Sicurezza](#6-sicurezza)
7. [Dipendenze](#7-dipendenze)
8. [Direzioni ampie](#8-direzioni-ampie)
9. [Zone dello spazio URL e segnaposti di percorso](#9-zone-dello-spazio-url-e-segnaposti-di-percorso)

---

## Decisioni in attesa del maintainer

Punti in cui il lavoro è **fermo per scelta, non per mancanza di tempo**: ognuno ha
più uscite difendibili e cambia comportamento o convenzioni, quindi la decisione
spetta al maintainer. Chi riprende in mano il progetto può partire da qui.

Le voci con un rimando hanno la trattazione completa nella sezione indicata; quelle
senza rimando sono descritte per intero qui perché non hanno una voce propria altrove.

- [x] ~~**Quattro nomi da confermare per le zone dello spazio URL** → §9.~~
      **Chiusi il 2026-10-30.** Confermati `{{admin}}` (nome di **zona**, non di chiave:
      la zona `site` non ha un `sitePrefix`, quindi lo schema « nome della chiave » non
      coprirebbe tutte le zone) e `[ACCESS]`. Affinati gli altri due: concetto e modulo
      portano nomi distinti — `pathZones` → `core/pathZoneResolver.js`,
      `accessInvariants` → `core/accessInvariantCheck.js`, entrambi ricalcati su moduli
      che esistono già. E **`posture` è diventato `baseline`**, perché D4 rende quella
      chiave un *pavimento* e non un *default*: `defaultAccess` avrebbe suggerito il
      modello mentale sbagliato. Fase 0 chiusa → Fase 1 sbloccata. Fonte:
      [`docs/decisions/path-zones.it.md`](./docs/decisions/path-zones.it.md) → *Naming*.
- [x] ~~**`urlRedirect` e `HEAD`** *(due decisioni collegate)* → §7.~~ **Deciso e
      applicato in v3.4.0.** **(a)** Il guard è esteso a `HEAD`: RFC 9110 §9.3.2
      definisce `HEAD` come `GET` senza corpo, quindi la divergenza non era una scelta
      difendibile ma un difetto. **(b)** Un `HEAD` redirezionato **incrementa** il
      contatore: quel contatore misura « quante volte una regola è stata usata », e un
      `HEAD` a cui si è risposto 301 l'ha usata; non contarlo avrebbe richiesto di
      re-introdurre un caso speciale su `HEAD`, cioè la stessa divergenza appena
      corretta, stavolta nelle statistiche. Regressione in
      `tests/unit/urlRedirect/middleware.test.js` (12 test, prima superficie del
      middleware a essere coperta). **Se il maintainer preferisce non contare i `HEAD`**
      è una riga sola nel guard del contatore, e il test che la presidia lo dice.
- [x] ~~**`PATCH` e `DELETE` fra i verbi supportati dalle rotte dei plugin?**~~
      **Deciso dal maintainer in v3.23.0: restano FUORI**, `DEL` è la forma canonica del
      progetto. Nessuna modifica al codice — `ROUTER_METHOD_DISPATCH` continua a gestire
      `GET/POST/PUT/DEL/ALL`, e un verbo fuori da questi non viene registrato con un
      warning al boot (v3.0.0). Nessuna rotta del progetto li usa (censimento: solo `GET`
      ×66 e `POST` ×69), quindi la decisione non lascia nulla in sospeso.
      Se un domani si volesse riaprirla: una riga per verbo nella mappa, e va aggiornata
      anche `VALID_METHODS` in `core/testHelpers/routeRunner.js` — il test di coerenza lo
      impone da solo.
- [x] ~~**🔴 Formula injection nell'export CSV di `adminAnalytics`** *(trovata in v3.3.0)*.~~
      **Corretta in v3.4.0** con la mitigazione convenzionale (apice anteposto), applicata
      **prima** del quoting così il prefisso finisce dentro le virgolette e la struttura
      RFC 4180 regge. `neutralizeFormula()` agisce sulle sole **stringhe**: un numero non
      può portare una formula, e prefissare un `durationMs: -5` lo renderebbe inutilizzabile
      nei calcoli. Trigger coperti: `=`, `+`, `-`, `@`, TAB, CR. I test di caratterizzazione
      sono stati riscritti come contratto. Testo originale della segnalazione:
      `exportFormatter.formatCsv()` applica correttamente il quoting RFC 4180 ma **non
      neutralizza i valori che iniziano con `=`, `+`, `-`, `@`**: aprendo l'export con
      Excel o LibreOffice quelle celle vengono interpretate come **formule**.
      **Perché conta più di una formula injection qualsiasi:** i campi `userAgent`,
      `referrer` e `path` arrivano dalle richieste HTTP, quindi il contenuto è scelto
      da **chiunque visiti il sito** — non serve alcun accesso privilegiato — mentre il
      file viene aperto da un amministratore. **Misurato:** uno `User-Agent` valorizzato
      a `=1+1` finisce nella cella come `=1+1`, e nemmeno il quoting protegge
      (`"=HYPERLINK(…)"` resta una formula).
      La mitigazione convenzionale è anteporre un apice ai valori che iniziano con quei
      caratteri; in alternativa si può esportare i campi sempre come testo. Entrambe
      **cambiano il contenuto dell'export**, quindi la scelta è del maintainer. Test di
      caratterizzazione in `plugins/adminAnalytics/tests/unit/exportFormatter.test.js`:
      falliranno alla correzione, come promemoria.
- [x] ~~**Il JSON-LD di `seo` può uscire dal tag `<script>`** *(trovata in v3.3.0)*.~~
      **Corretta in v3.4.0**: `serializeJsonLd()` escapa `<`, `>` e `&` come `\uXXXX` —
      escape JSON standard, quindi i consumatori (motori di ricerca inclusi) rileggono il
      carattere originale e nessun dato va perso. Verificato che il valore sopravvive alla
      riparsatura. Testo originale della segnalazione:
      `generateStructuredData()` inserisce l'output di `JSON.stringify` dentro
      `<script type="application/ld+json">`, e `JSON.stringify` **non escapa la
      sequenza `</script>`**, che il parser HTML interpreta prima del JSON. Un
      `siteName` valorizzato a `Sito</script><b>x</b>` chiude il tag in anticipo e
      inietta markup.
      **Severità più bassa della precedente:** il valore arriva da `seoConfig.json5`,
      scritto da un amministratore (ruoli 0/1), che può già modificare i template —
      non è quindi un'escalation, ma resta una via per introdurre markup da un campo
      che non sembra HTML. La correzione è sostituire `<` con `\u003c` nel JSON
      serializzato. Caratterizzata in
      `plugins/seo/tests/unit/robotsAndStructuredData.test.js`.
- [x] ~~**Il valore della soglia minima di coverage, e se applicarla in CI**~~
      **Deciso dal maintainer e applicato in v3.9.0.** `coverageThreshold` a
      **51 / 50 / 46 / 51** (statements/branches/functions/lines), un punto sotto il
      raggiunto, e un job CI **`coverage`** dedicato su Node 22 che esegue
      `npm run test:coverage` a ogni pull request.
      **Perché un job separato e non dentro la matrice:** le percentuali sono identiche
      **alla riga** su Node 22 e 24 (10058/19297 statements su entrambe), quindi
      calcolarle due volte costerebbe minuti senza aggiungere informazione; e il check
      fallito si chiama « Coverage ratchet » invece di confondersi con un test rotto.
      **Perché la soglia vive in `jest.config.js` e non nel workflow:** così vale anche
      in locale, e `npm run test:coverage` sulla macchina di chi sviluppa dà lo stesso
      verdetto della CI invece di scoprirlo dopo il push.
      **⚠ Chi la alzerà deve misurare OFFLINE** — i 5 test di `themesInstall.realRepo`
      si saltano da soli senza rete, quindi una macchina connessa mostra un numero più
      alto; i valori attuali vengono dal caso peggiore. Annotato nel config.
      Verificato che il cancello morda in entrambe le direzioni: exit 0 con i valori
      scelti, exit 1 con una soglia irraggiungibile.
- [ ] **Estendere il guard `typeof module` agli altri 12 file client-side admin.**
      *(Aperta in v3.22.0, dopo la decisione sulla terza via.)* Convenzione e tabella di
      adozione in [`docs/testing.it.md`](./docs/testing.it.md). Il criterio non è
      « tutti i file », è **dove c'è logica che può sbagliare in silenzio**:
      - **Priorità alta:** `adminAnalytics/settings.js` → `formToData`/`dataToForm`, cioè
        esattamente il giro form↔config che in `adminSentinel` aveva **perso dati due
        volte**. È il candidato con il precedente peggiore.
      - **Pronti, verificato:** `adminBootstrapNavbar/editor.js`,
        `adminAnalytics/settings.js` e `adminSeo/editor.js` **caricano puliti** sotto Node
        (`node -e "require(<file>)"`): per loro è due guard più il test.
      - **⚠ `adminMedia/media.js` no:** `const state = { itemsPerPage: ITEMS_PER_PAGE }` a
        livello di modulo legge una globale iniettata dall'EJS → `ReferenceError` al
        require. Va prima reso indipendente dalle globali, che è un refactor del codice di
        produzione e quindi una scelta a sé.

- [x] ~~**I temi entrano nello scope della coverage?** → §5.~~
      **Deciso dal maintainer e applicato in v3.23.0: sì, insieme al test di
      `escapeHtml.js`.** Le due cose vanno insieme — contare 395 righe senza verificare
      la più importante avrebbe aggiunto un numero senza aggiungere una verifica.
      **Il punto non era la percentuale**: finché i temi erano fuori dallo scope, il
      **livello 2 della difesa XSS** del pannello admin non era né testato né contato,
      quindi nessun numero diceva che mancava. Ora `escapeHtml.js` è a **100%** su
      statements/functions/lines (75% branch: è il tetto strutturale di un file
      dual-mode, i due guard hanno un ramo per ambiente) e ha **41 test**, fra cui il
      confronto con il gemello `core/escapeHtml.js` — se le due implementazioni
      divergessero, la difesa in profondità diventerebbe asimmetrica e nessun test lo
      avrebbe detto, perché ogni file resta valido per conto suo.
      **Costo misurato:** fra 0,21 e 0,52 punti; tutte e quattro le metriche restano
      sopra soglia con margini fra +1,25 e +1,95, quindi la soglia **non** è stata
      abbassata. Gli altri 5 file dei temi entrano a 0% e restano lì a dichiarare che
      sono cablaggio del DOM.
      La regola generale è ora scritta in `docs/testing.it.md`: si esclude dalla misura
      solo ciò che la suite **non ha il permesso** di eseguire (i plugin disattivati),
      non ciò che semplicemente non è ancora testato.
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
- [x] ~~**Pagina segnaposto di primo avvio per `/www`.**~~ **CHIUSA in v3.25.0 —
      la pagina NON si fa.** Il maintainer ha deciso di rimuovere la segnaposto
      introdotta in v3.21.0: `/www` è la cartella dell'**utente**, e un'installazione
      pulita deve trovarla **vuota**. Delle tre strade valutate nel tempo nessuna
      sopravvive: il seeding dal wizard (avrebbe funzionato solo per chi esegue
      `start-configure`, non per chi clona e lancia `npm start`), la pagina di cortesia
      servita dal core (avrebbe intercettato i 404, che è compito del file server, e
      maschererebbe quelli veri) e il file committato con eccezione in `.gitignore`
      (era un file del **progetto** in casa di chi costruisce il sito: chi lo
      sostituiva se lo ritrovava in `git status` come modificato).
      **Il 404 alla radice è quindi il comportamento voluto**, non un difetto aperto:
      su un'installazione pulita `GET /` risponde 404 finché non si crea la propria
      `index.ejs` — con `dirListing.wwwPath` a `false` di default non c'è nemmeno
      l'elenco della directory. Presidiato da `tests/integration/wwwRootClean.test.js`
      (`/www` versionata a **un solo file**, `.gitkeep`, e tutto il resto git-ignored).
      *Fonte: emersa riattivando `dirListing` dopo la release 5.2.0 di
      `koa-classic-server`; chiusa su decisione del maintainer.*

## 5. Testing

Fonte: `docs/roadmap.it.md` (punti 11–15) e osservazioni di sessione.

- [x] ~~**Flake osservato una volta** in `tests/integration/pluginNpmInstall.test.js`
      ("self-contained già installato → npm install SALTATO")~~ — **causa trovata e
      corretta** (v2.95.0). Non era contesa di porta: la suite gira `maxWorkers: 1`,
      quindi due server non sono mai vivi insieme, e questo test usa già una porta
      dedicata casuale. Il difetto era nell'**harness**: `runBoot()` si concludeva su
      `proc.on('exit')` valutando lì `started: READY.test(out)`, ma `'exit'` segnala
      la morte del processo, **non** che le pipe di stdio siano state drenate — gli
      ultimi chunk possono essere ancora in volo, quindi un boot **riuscito** poteva
      essere riportato come `started: false`. Misurato: su 200 spawn che stampano un
      marker e escono subito, in **14 casi (7%)** il marker mancava su `'exit'` ed era
      presente su `'close'`; con la correzione, 0 su 200 (Node 22 e 24). L'harness era
      duplicato **identico** anche in `bootLifecycle.test.js`, dove il ramo d'uscita è
      quello che conta di più (i gate `[FATAL]` di cui si asserisce l'output): corretto
      in entrambi.
- [x] ~~Il fallimento era **indiagnosticabile**~~ — `expect(res.started).toBe(true)`
      stampava solo «Expected: true / Received: false» e buttava via l'output del
      processo, cioè l'unica cosa che spiega l'uscita. È il motivo per cui questa voce
      è rimasta senza causa: nei log CI non c'era niente da leggere. Ora si asserisce
      sull'oggetto (`{ started, code, output }`), così il messaggio d'errore porta con
      sé stdout+stderr e il codice d'uscita.
- [ ] **Range di porte sovrapposti fra i due harness di boot** (scoperto indagando il
      punto sopra, **non** la causa di quel fallimento): `pluginNpmInstall` sceglie in
      `35000..36499`, `bootLifecycle` in `34000..35499` — 500 porte in comune. Oggi è
      innocuo perché `maxWorkers: 1` serializza la suite, ma è una mina che esplode al
      primo tentativo di riabilitare il parallelismo, ed è proprio l'ipotesi sbagliata
      che questa voce ha inseguito per mesi. Da risolvere insieme al punto sotto,
      preferibilmente allocando una porta libera dal SO (`listen(0)`) invece di
      sorteggiarla.
- [ ] **Estendere la porta dedicata a tutti i test che avviano un server** (voce
      originale, ancora valida): più test spawnano `node index.js` sulla **porta 3000**.
- [ ] **Migrare i test plugin-specifici** da `/tests/unit/{pluginName}/` a
      `plugins/{pluginName}/tests/` (convenzione già in vigore; migrato solo
      `bootstrapNavbar` come riferimento).
- [ ] **E2E/Playwright per plugin e temi**: estendere la discovery automatica oltre
      unit e integration, con orchestrazione del server.
- [x] ~~**La catena init/backup non è testabile in-process: le root sono cablate.**~~
      **Risolto in v3.7.0.** Seam aggiunto a quattro classi — `StateManager`
      (`globalStatePath`), `BackupManager` (`backupRoot` **e** `pluginsRootPath`),
      `PluginScanner` (`pluginsDir`), `ConfigWizard` (`configPath`) — come parametro
      opzionale col default invariato, la forma già usata da `themesRootPath`
      (v2.92.0) e `pluginsRootPath` (v2.98.0). L'unico chiamante
      (`scripts/init.js:163-164`) non è stato toccato. Le quattro classi passano
      **da 0% a una media del 94,6%** di righe, con il **100% delle funzioni**.
      `pluginInitRunner.js` non aveva bisogno di seam (è già parametrizzato) e resta
      da coprire.
      **Nota sul perimetro:** `getBackupPath()` e `getPluginBackupPath()` restano
      ancorati a `__dirname` di proposito — il loro punto di riferimento *è* la
      radice del progetto, e spostarlo renderebbe il path relativo a se stesso,
      perdendo l'informazione che quei metodi esistono per dare.
- [x] ~~**(D1) 🐞 `ConfigWizard.saveConfig()` distrugge i commenti di `ital8Config.json5`.**~~
      **CORRETTO in v3.13.0** — scrittura chiave per chiave con `setJson5Key`; 340 righe e
      230 commenti conservati sul file reale. Cronaca del difetto, per memoria:
      *(Trovato in v3.7.0 coprendo il wizard.)* Fa `JSON.stringify` dell'oggetto
      intero, cioè **riserializza** invece di modificare le chiavi cambiate — esattamente
      l'anti-pattern che questo stesso `CLAUDE.md` vieta (*« preferisci
      `setJson5Key`/`editJson5` a un `saveJson5` dell'oggetto intero: quest'ultimo perde
      i commenti »*), e che il codice più recente rispetta (`sessionKeyManager` usa
      `editJson5` proprio per questo).
      **Misurato sul file reale:** `ital8Config.json5` passa da **230 righe commentate su
      340 a una sola**, e da 340 a 115 righe totali. È la documentazione inline della
      configurazione centrale, e chi esegue il wizard confermando una qualsiasi modifica
      la perde tutta, in silenzio. **I valori sopravvivono** — il sito continua a
      funzionare identico — quindi non è un guasto, è una perdita di documentazione:
      per questo può passare inosservata a lungo.
      Corretto sostituendo la riscrittura con un `setJson5Key` per ogni chiave cambiata.
      Il blocco « ⚠ DIFETTO NOTO » di `tests/unit/scripts/configWizard.test.js` è diventato
      la rete di regressione che impedisce il ritorno.
- [ ] **Il backup globale è piatto: due file omonimi si sovrascrivono.**
      *(Emerso in v3.7.0.)* `BackupManager.backupGlobalFile()` usa il solo `basename`,
      quindi `a/config.json5` e `b/config.json5` finiscono sullo stesso path dentro lo
      snapshot e il secondo cancella il primo **senza dirlo**. Oggi non morde — i config
      globali salvati hanno nomi distinti (`ital8Config`, `koaSession`, `adminConfig`) —
      ma è il tipo di limite che si scopre quando serve il ripristino. Caratterizzato in
      `tests/unit/scripts/backupManager.test.js`.
- [x] ~~**(D4) `port()` accetta un input troncato da `parseInt`.**~~
      **CORRETTO in v3.16.0** con `/^\d+$/` prima del parse, insieme al gemello
      `positiveInteger()`. Cronaca, per memoria:
      *(Emerso in v3.6.0 testando i validatori del wizard.)* `parseInt('3000abc')`
      vale 3000, e il wizard ha `filter: (v) => parseInt(v)`: la porta scritta nel
      config **non è quella digitata**, e nessuno lo segnala. Stessa cosa per
      `'3000.9'` → 3000 e `'1e4'` → 1. Impatto basso (chi installa vede la porta nel
      riepilogo) ma la correzione — un `/^\d+$/` prima del parse — **rifiuterebbe un
      input oggi accettato**, quindi è una decisione, non una svista da correggere di
      nascosto. Caratterizzato in `tests/unit/scripts/validators.test.js`.
- [ ] **Quattro validatori senza chiamanti: cablarli o rimuoverli.**
      *(Censito in v3.6.0 su tutto il repo.)* `boolean`, `toBoolean`, `positiveInteger`
      e `directoryPath` non sono usati da nessuna parte. Vivi sono solo `port`
      (httpPort), `apiPrefix` (apiPrefix + adminPrefix), `required` (i due temi) e
      `username`/`email`/`password` (account **root**, via
      `plugins/adminUsers/scripts/init.js`). Due dettagli che contano se qualcuno li
      cablasse: `directoryPath` **accetta i `..` di traversal** (la regex ammette punti
      e slash) — oggi innocuo perché è codice morto, non altrettanto il giorno in cui
      guardasse un path di config; e `positiveInteger` accetta `0` mentre il suo
      messaggio dice « deve essere un numero positivo » (accettare 0 è quasi certamente
      voluto — è « disattivato » in mezzo schema del progetto — quindi è il **messaggio**
      da correggere, non il comportamento).
- [ ] **Il controllo `includes('/')` di `apiPrefix()` è irraggiungibile.**
      *(Emerso in v3.6.0.)* La regex che lo precede non ammette `/`, quindi ogni valore
      con uno slash esce prima e il messaggio dedicato — il più utile dei due — non viene
      mai mostrato. Non è un buco (il rifiuto avviene comunque), è un ramo morto.
      Fissato da un test che diventa rosso se il ramo torna raggiungibile.
- [x] ~~**Il legame « ordine di caricamento = ordine dei middleware » va documentato in `CLAUDE.md`.**~~
      **Fatto in v3.12.0**, in `CLAUDE.md` → *Ordine di caricamento* e nel commento di
      `pluginSys`, con la regola pratica enunciata: chi osserva il traffico deve avere
      un peso minore di chi lo interrompe. **Resta aperta** la domanda più grande, qui
      sotto: se separare i due concetti con una chiave dedicata.
      Testo originale:
      *(Emerso in v3.10.0 dalla review della branch.)* `index.js` monta i middleware
      dei plugin nell'ordine dell'array restituito da `getMiddlewaresToLoad()`, che è
      l'ordine di caricamento. Nessun documento lo dice, ed è per questo che cambiare
      l'ordinamento in v3.0.0 ha spostato i middleware senza che nessuno se ne
      accorgesse. La sezione *Ordine di caricamento* di `CLAUDE.md` parla solo di
      « i plugin caricati dopo dispongono di quelli caricati prima »: va aggiunto che
      il `weight` governa **anche** l'annidamento dei middleware, e che chi osserva
      il traffico deve avere un peso minore di chi lo interrompe.
      **Domanda aperta più grande — `middlewareWeight`.** Vale la pena separare i due
      concetti con una chiave dedicata, così che un plugin possa caricare tardi — perché
      dipende da altri — e montare il middleware presto? *(Aggiornata dopo v3.15.0:
      l'ordinamento topologico ha ridotto il problema ma non l'ha chiuso.
      `adminAccessControl` non carica più ultimo, carica **6°**, subito dopo la sua
      dipendenza `adminUsers` — è tutto ciò che il suo `weight: -5` può ottenere finché
      caricamento e montaggio restano lo stesso ordine. Il box `[WEIGHT]` al boot rende
      la cosa **visibile**: chi legge il box sa che quel peso non è onorato, e sa
      perché.)* Le due strade: una chiave `middlewareWeight` separata, oppure ordinare
      i middleware in un secondo passaggio dopo il caricamento — quest'ultima non
      richiede una chiave nuova ma rompe l'identità « ordine di caricamento = ordine
      dei middleware », su cui oggi si ragiona (ed è documentata).
- [x] ~~**(D3) Il `weight` ordina solo dentro il gruppo SENZA dipendenze.**~~
      **RISOLTO in v3.15.0** con l'ordinamento topologico unico + box `[WEIGHT]`.
      Cronaca, per memoria:
      *(Emerso in v3.10.0.)* `initialize()` ordina per weight i plugin senza
      dipendenze, poi accoda gli altri man mano che le dipendenze si risolvono:
      `adminAccessControl` (weight **-5**, il più basso dopo `simpleI18n`) carica
      **22° su 22**, dopo ogni plugin dependency-free. Il commento introdotto in
      v3.0.0 diceva « il weight ora ordina davvero »: **il commento è stato corretto in
      v3.12.0** e ora dichiara fin dove arriva. **Resta da decidere** se completare
      l'implementazione. La forma giusta è **un unico
      ordinamento topologico** su tutti gli installabili con il weight come
      tie-break, non un sort applicato a un sottoinsieme che la coda poi scavalca.
- [x] ~~**🔴 Il middleware di un plugin FALLITO resta montato.**~~
      **Corretto in v3.11.0.** Il push è stato spostato **dopo** `loadPlugin()`.
      Perché proprio questo registro era sfuggito al catch: rotte, hook e oggetti
      condivisi sono Map/oggetti indicizzati **per nome** — tre `delete(pluginName)` —
      mentre i middleware sono un **array posizionale senza chiave**, che la pulizia
      non sapeva raggiungere. Spostare il push toglie l'asimmetria alla radice invece
      di aggiungere una rimozione: non c'è nulla da ripulire se non è mai stato
      aggiunto, e la trappola non resta in piedi per il prossimo registro che qualcuno
      aggiungesse prima del load. Riprodotto prima di correggere (`incomplete` +
      `middleware: 1`), 3 test di regressione, tutti uccisi rimettendo il push prima.
- [x] ~~**(D2) `CLAUDE.md` promette un gate fatale su `access` che non ho trovato nel codice.**~~
      **RISOLTO in v3.14.0** — gate implementato come *salta + avvisa*, e sei punti di
      documentazione allineati. Cronaca, per memoria:
      *(Emerso in v3.10.0.)* La documentazione diceva « campo `access` obbligatorio su
      ogni rotta: assenza = **errore fatale al boot** ». In `loadRoutes` il codice reale
      era `const handler = oRoute.access ? wrap(...) : oRoute.handler` — nessun throw:
      una rotta senza `access` veniva **registrata senza controllo di autenticazione**,
      cioè funzionante e aperta. Il ramo « senza wrap » non esiste più: superato il gate,
      `access` è garantito oggetto e l'handler passa **sempre** dal wrap.
- [x] ~~**(D5) `roleManagement`: il floor `roleId >= 100` non è applicato a delete/update.**~~
      **CHIUSO in v3.17.0 senza aggiungere il floor** (decisione del maintainer:
      `isHardcoded` resta il guardiano unico); il lavoro è andato sul messaggio d'errore.
      Cronaca, per memoria:
      *(Emerso in v3.10.0.)* Il modulo conosce il confine dei ruoli custom solo in
      `getNextCustomRoleId`. `deleteCustomRole`/`updateCustomRole` si affidano al solo
      flag `isHardcoded`, che vive in un file vivo, git-ignored e modificabile a mano.
      Oggi regge — verificato che root non sia cancellabile — ma è un solo strato.
- [x] ~~**`roleManagement`: scritture non atomiche**~~ — **corretto in v3.12.0** con
      `writeJson5Atomic()` (temp + rename) su tutti e quattro i punti di scrittura.
      **Restano aperti due pezzi della stessa voce:** (a) la riscrittura passa comunque
      da `JSON.stringify`, quindi i **commenti si perdono** (`userRole.json5` ne ha 15
      su 41 righe) — preservarli richiede una modifica chiave-per-chiave che per
      l'aggiunta e la rimozione di un ruolo gli helper attuali non supportano; (b) il
      **rollback fra i due file** di `deleteCustomRole` non esiste ancora. Testo
      originale:
      *(Emerso in v3.10.0.)* `createCustomRole`, `updateCustomRole` e `deleteCustomRole`
      usano `fs.writeFileSync` + `JSON.stringify` — contro la regola 1 di `CLAUDE.md`
      (scritture atomiche temp+rename) e distruggendo i commenti dei `.json5`. Peggio:
      `deleteCustomRole` scrive `userRole.json5` e poi `userAccount.json5` **in
      sequenza**; se il secondo fallisce, il ruolo è già sparito ma ogni utente porta
      ancora il `roleId` orfano, e nessun percorso di codice ripara quello stato.
- [x] ~~**`updateCustomRole` non impone la lunghezza minima 3**~~ — **corretto in
      v3.12.0**, stesso controllo e stesso messaggio di `createCustomRole`. Verificato
      con una mutazione controllata del file vivo e ripristino con sha256.
- [x] ~~**(D6) `BackupManager.getBackupPath()`/`getPluginBackupPath()` restano ancorate a
      `__dirname`** mentre `backupRoot` è ora iniettabile.~~
      **CHIUSA in v3.18.0: si lascia com'è** (decisione del maintainer), e il rilievo è
      confluito nella revisione della strategia di backup in §8, dove ha senso.
      Cronaca, per memoria: *(emersa in v3.10.0)* con il seam in uso i due riferimenti
      disaccordano, e il valore finisce persistito in `initState.json5` come `backupPath`.
      **Avevo scritto che era « il puntatore che un restore risolverebbe »: è falso, e l'ho
      verificato.** `pluginInitRunner.js:133` usa `backupPath` solo come flag
      (`if (backupPath)`) e per stamparlo; il ripristino chiama
      `restorePlugin(plugin.name)`, che ricostruisce il path da `pluginsBackupDir` + nome,
      seguendo correttamente la radice iniettata. **Nessuno risolve quella stringa**, e
      `getPluginBackupPath()` non ha proprio chiamanti in produzione.
- [ ] **`themeSys.validateTheme()` NON accetta una root parametrica**, a differenza
      della sua gemella `validateThemeContent(themeName, themesRootPath)` (v2.92.0).
      *(Emerso in v3.5.0 scrivendo la suite di integrità dei temi.)* Cabla
      `path.join(__dirname, '../themes', themeName)`, quindi non può validare un tema
      di prova in una tmpdir: la suite dei temi la invoca sui temi **veri**, dove
      questo non morde, ma un test che voglia costruire un tema deliberatamente rotto
      senza toccare il repo oggi non può usarla. Stessa forma della correzione già
      applicata due volte (`themesRootPath` in v2.92.0, `pluginsRootPath` in v2.98.0):
      un parametro opzionale con default invariato, nessun chiamante da aggiornare.
      Lo stesso vale per `checkDependencies()` e `getAvailableThemes()`.
- [x] ~~**`pluginSys.initialize()` non è testabile in-process: la root dei plugin è cablata.**~~
      **Risolto in v2.98.0**: il costruttore accetta una root opzionale
      (`pluginsRootPath`, default invariato), sulla falsariga di
      `validateThemeContent(..., themesRootPath)` in v2.92.0. `core/pluginSys.js`
      passa da 24,5% a **67,2% di righe** e da 56% a **80,5% di funzioni**.
- [x] ~~**🐞 Il `weight` dei plugin NON è implementato, ma è documentato come contratto.**~~
      **Risolto in v3.0.0**: `initialize()` ordina i plugin installabili per `weight`
      crescente e, a parità di peso, alfabeticamente — l'ordine che `CLAUDE.md`
      dichiarava da sempre. Il tiebreak è esplicito e non affidato all'ordine di
      `fs.readdirSync()`, che non è garantito alfabetico su tutti i filesystem.
      Verificato sul boot reale: i 12 plugin **senza dipendenze** occupano ora le
      posizioni 1-12 esattamente in ordine di peso (`simpleI18n` a -10 per primo),
      mentre i 10 **con dipendenze** seguono in coda perché le dipendenze prevalgono
      sul peso, come documentato. Un `weight` non numerico vale 0 e viene segnalato.
- [x] ~~**`loadRoutes()` scarta in silenzio i metodi che non conosce.**~~
      **Risolto in v3.0.0**: la catena `if/else` è diventata la mappa
      `ROUTER_METHOD_DISPATCH`, fonte di verità unica dei verbi supportati, con un
      ramo finale che emette un warning nominando plugin, metodo e path. Un test in
      `tests/integration/routeContract.test.js` legge le chiavi della mappa e le
      confronta con `VALID_METHODS` dell'helper, così le due liste non possono più
      divergere in silenzio (era già successo).
- [x] ~~**`func` invece di `handler`: la documentazione descriveva l'esito sbagliato.**~~
      *(Scoperto in v3.0.0 verificando ciò che stavo per scrivere in `CLAUDE.md`.)*
      La nota diceva « rotta silenziosamente ignorata → la richiesta cade sul static
      server ». **Misurato, succedeva altro:** la rotta veniva **registrata** con un
      handler che avvolgeva `undefined`, e falliva alla prima richiesta con
      `TypeError: originalHandler is not a function`, cioè un **500** — peggio di una
      rotta assente, perché esiste, risponde e si rompe solo quando qualcuno la usa.
      `loadRoutes()` ora verifica che `handler` sia una funzione, salta la rotta e lo
      segnala nominando la causa; `CLAUDE.md` riporta i tre esiti reali in tabella.
- [x] ~~**🐞 `roleManagement`: il numero `0` è scambiato per un `roleId` assente.**~~
      **Corretto in v3.4.0:** il guard falsy è sostituito da `isRoleIdAbsent()`, che
      chiede « è stato fornito? » invece di « è diverso da zero? ». `0` e `"0"` ora
      convergono sullo stesso ramo, e ciò che è assente per davvero (`undefined`,
      `null`, stringa vuota — quest'ultima è ciò che invia un campo di form in bianco)
      continua a essere rifiutato come tale. I due test di caratterizzazione sono
      riscritti come contratto. **Resta fuori dalla correzione**, di proposito, il
      messaggio per un roleId non numerico: `"abc"` produce ancora « Ruolo con ID NaN
      non trovato » — brutto da leggere ma innocuo, e allargare la correzione avrebbe
      cambiato il comportamento di casi che nessuno aveva segnalato.
      Testo originale della segnalazione: *(Scoperto in v3.2.0 scrivendo i test dei ruoli.)* `updateCustomRole()` e
      `deleteCustomRole()` iniziano con `if (!roleId)`, e **`0` è falsy** — ma 0 è
      l'ID di `root`, il ruolo più privilegiato. Il rifiuto avviene comunque, quindi
      **non è un buco di sicurezza**, ma il messaggio è falso: dice « devi
      specificare il roleId » a chi l'ha specificato, e `updateCustomRole()`
      restituisce `errorType: 'all'` invece di `'roleId'`.
      **Misurato:** con `0` (numero) → « Devi specificare il roleId »; con `"0"`
      (stringa) → « Non puoi eliminare un ruolo di sistema », cioè il ramo giusto.
      La divergenza fra i due è la prova che si tratta di un errore di controllo e
      non di una scelta. Morde solo i chiamanti **da codice**: dal form admin il
      valore arriva come stringa. La correzione è distinguere « assente » da
      « zero » (`roleId === undefined || roleId === null || roleId === ''`), ma
      cambia l'`errorType` restituito in quel caso, quindi va decisa. Due test in
      `plugins/adminUsers/tests/unit/roleManagement.test.js` fissano il
      comportamento attuale e falliranno alla correzione, come promemoria.
- [ ] **`userUsert()` e `roleManagement`: i path dei file dati sono cablati.**
      *(Emerso in v3.2.0.)* `usersFilePath` e `rolesFilePath` sono costruiti su
      `__dirname`, quindi i rami che **scrivono** (creazione utente riuscita,
      creazione/aggiornamento/cancellazione di un ruolo custom) non sono
      esercitabili senza toccare i file veri del plugin. Oggi i test coprono solo i
      rami che ritornano prima della scrittura, con una rete di sicurezza che
      confronta l'hash dei file di dati a inizio e fine suite. La correzione è la
      stessa già applicata due volte — un path opzionale col default invariato,
      come `pluginsRootPath` (v2.98.0) e `themesRootPath` (v2.92.0) — e sbloccherebbe
      i rami di scrittura, che sono quelli dove nascono gli account.
      **⚠ La rete di sicurezza è un RILEVATORE, non un impedimento — verificato sul
      campo in v3.17.0.** Durante il mutation testing di D5 una mutazione che
      disattivava il guardiano `isHardcoded` in `deleteCustomRole()` ha fatto
      **eseguire davvero** la cancellazione dei quattro ruoli di sistema dal
      `userRole.json5` vivo. L'`afterAll` con i digest l'ha rilevata — è ciò che i
      fallimenti stavano dicendo — ma il danno era già scritto; il file è stato
      ripristinato dal `.default` e verificato con `md5sum -c`. Due conseguenze da
      tenere presenti finché il seam non c'è: **(a)** una mutazione che disattiva un
      guardiano di scrittura non va eseguita contro i dati veri; **(b)** `git diff` su
      questi file **non può rilevare nulla** — sono git-ignored — quindi la verifica
      va fatta col digest, mai col diff.
- [ ] **Soglia minima di coverage** con fail della CI, calcolata in modo aggregato
      (core + plugin attivi + temi). **Sbloccata a metà da v2.96.0**: lo scope della
      misura ora copre tutto il codice che la suite ha il permesso di eseguire
      (17.378 righe invece di 6.133), quindi una soglia messa oggi certificherebbe
      un numero vero. Da fissare **appena sotto** il valore raggiunto e alzare quando
      sale — un cricchetto che impedisce di tornare indietro, non un obiettivo da
      rincorrere. I temi restano fuori dallo scope: vanno aggiunti insieme ai loro test.
- [ ] **GUI admin client-side: 2.129 righe all'1,9%** *(reso visibile da v2.96.0)*.
      I file `.js` sotto `plugins/*/adminWebSections/` sono codice spedito e quasi
      del tutto non testato: `media.js` (381 righe), `editor.js` (316), `settings.js`
      (288), `sentinel-admin.js` (219), `analytics.js` (165), `rateLimiter-admin.js` (119).
      Con `testEnvironment: 'node'` non sono eseguibili da jest — servono un ambiente
      jsdom oppure una copertura e2e. Fanno eccezione i due file **dual-mode** di
      `adminSentinel` (`rule-form.js`, `sentinel-i18n.js`, 571 righe), che espongono
      `module.exports` dietro un guard e sono già sotto test: è il modello da seguire
      per rendere testabile il resto senza cambiare ambiente.
- [ ] **`bin/ital8cms-cli.js` a 0%** (399 righe) *(reso visibile da v2.96.0)*: il
      binario del control plane non ha test propri. `core/cliBridge/` è coperto,
      l'entry point no — parsing degli argomenti, dispatch dei sottocomandi e il
      comportamento con `--` mancante (che npm scarta in silenzio, vedi
      `docs/cli-control-plane.it.md`) non sono verificati da nulla.
- [ ] **`adminAnalytics` resta in gran parte scoperto** *(v3.3.0 ha coperto solo
      `exportFormatter`)*. Restano senza test `aggregator.js` (260 righe),
      `analyticsFileManager.js` (241), `chartDataBuilder.js` (143),
      `analyticsConfigValidator.js` (109), `fileSelector.js` (102) e `main.js` (480):
      **911 righe al 5,7%**. `chartDataBuilder` e `analyticsConfigValidator` sono puri
      e sono i prossimi candidati naturali; `analyticsFileManager` legge il filesystem.
- [ ] **`ostrukUtility` è un plugin boilerplate vuoto, ma è `active: 1`.**
      *(Constatato in v3.3.0 cercando cosa testare.)* Ogni funzione esportata
      restituisce `{}`, `[]` o una `Map` vuota: non c'è logica da verificare, e
      scrivergli dei test sarebbe cerimonia. Da decidere se **rimuoverlo**
      dall'installazione di default, **disattivarlo** (`active: 0`) o tenerlo come
      scheletro di riferimento — nel qual caso il posto giusto sarebbe accanto a
      `exampleComplete`, che è già inattivo e serve proprio a quello.
- [ ] **Scanner prescrittivo al boot** (Fase 2 del testing): verifica per ogni
      plugin attivo dei test minimi richiesti (un test per metodo esportato, uno per
      rotta incluso `access`, validazione dei JSON5, lifecycle hooks). Default
      warning, `testingStrictMode: true` per promuoverli a fatali.
- [ ] **`droppedComments` arriva al chiamante, ma nessun chiamante lo MOSTRA.**
      *(Metà rimanente del rilievo 5 della revisione del codice, dichiarata invece di
      lasciata implicita.)* Dalla v3.37.0 `editJson5` e `setJson5Key` restituiscono
      entrambi `droppedComments` in tutti i rami, quindi l'informazione non viene più
      **distrutta**. Ma l'audit di tutti i call site mostra che **nessuno cattura il
      valore di ritorno**: sono tutti `await setJson5Key(…)` nudi. Quindi « un commento
      perso e dichiarato » oggi è dichiarato a nessuno.
      Il consumatore naturale è **`core/migrationRunner.js`**, che ha già un logger ed è
      il contesto in cui « questa migrazione ha perso un commento, qui » interessa a un
      amministratore. Caso concreto già presente: `core/migrations/adminConfig/from-v1-to-v2.js:57`
      chiama `setJson5Key(configPath, 'menuOrder', updated)` su un **array** — se la
      lunghezza cambia, i commenti interni si perdono e nessuno lo dice. Da valutare se
      il runner debba leggere il resoconto degli step, o se ogni script debba loggarlo
      da sé (il primo è uniforme, il secondo non obbliga il runner a conoscere la forma
      di ritorno di ogni operazione).
- [ ] **🐞 `sentinel/migrations/from-v6-to-v7.js` ha la stessa famiglia di difetto
      delle rinomine testuali.** *(Emerso durante la correzione del rilievo 2 della
      revisione del codice; **fuori dal perimetro** che il maintainer aveva dato, quindi
      non toccato.)* Fa `before.replace(SHIPPED_LINE, PLACEHOLDER_LINE)`: `String.replace`
      con un pattern stringa sostituisce solo la **prima** occorrenza, e l'ancora non è
      vincolata al codice. Più difficile da innescare della versione di
      `adminAccessControl` — l'ancora è una riga **intera** con dieci spazi di
      indentazione e il blocco `{ path: […] },` completo, non una semplice chiave — ma
      il caso resta: la stessa riga presente **due volte** (una regola duplicata) ne
      vede convertita una sola, e alla riesecuzione la guardia
      `before.includes(PLACEHOLDER_LINE)` dichiara « già convertita », quindi il
      letterale residuo non viene più nominato mai.
      **`renameJson5Key` non è lo strumento giusto qui**, perché quella riga è un
      VALORE (un elemento di `match.any`), non una chiave. Lo strumento è `editJson5`
      sull'array, che dalla v3.37.0 ricorre per indice **anche dentro gli elementi** e
      ne preserva i commenti: la correzione del rilievo 1 ha reso disponibile la strada
      pulita che prima non c'era. Da valutare insieme al resto delle migrazioni di
      `sentinel`.
- [ ] **🐞 Gli harness di boot riscrivono il `ital8Config.json5` VIVO con
      `JSON.stringify`, e lo ripristinano solo in `afterAll`.** *(Emerso verificando la
      Fase 4 di path-zones: due test fallivano e la causa era lo stato lasciato da una
      run precedente interrotta.)* `spawnServer()` in `tests/integration/dirListing.test.js`
      — e lo stesso schema in `httpVerbs`, `hideExtension`, `rejectNonCanonicalPaths`,
      `httpsServer` — fotografa il file, ci scrive sopra
      `JSON.stringify(testConf, null, 2)` e lo riscrive da `originalRaw` alla fine. Due
      conseguenze: **(a)** durante la run il config vivo dello sviluppatore è
      riserializzato, cioè **senza i suoi 230 commenti**; **(b)** se la run è
      interrotta (worker ucciso, Ctrl-C, `afterAll` non eseguito) quel file **resta**
      riserializzato e puntato alle fixture — trovato così: `httpPort: 19310`
      (il `PORT_OFF` di `dirListing`), `wwwPath: "/tests/www"`, `activeTheme:
      "themeForTesting"`, zero commenti. **Seconda ricaduta il 2026-11-01**, durante
      la Fase 5 di json5-key-operations: `httpPort: 19311`, `activeTheme:
      "themeForTesting"`, `rejectNonCanonicalPaths: false`,
      `https.hotReload.debounceMs` **sparita** e `cli.socketPath` puntato a
      `/tmp/ital8cms-sentinel-int-….sock` — quest'ultimo nomina una suite che
      l'elenco qui sopra **non ha**, quindi lo schema è più diffuso di quanto
      registrato. Innescata da un `npx jest` **nudo**, che rastrella anche gli
      `.spec.js` di Playwright esclusi da `tests/jest.config.js`: la suite di
      progetto (`--config=tests/jest.config.js`) resta verde e **non** distrugge il
      vivo. E il danno è silenzioso finché non lo nota un
      test che *pretende* quei commenti (`themesManagment` → « preserva i commenti
      JSON5 »), che allora fallisce per una causa che non ha niente a che vedere con sé.
      Il ripristino dal `.default` risolve, ma nessuno sa che va fatto. Due strade:
      scrivere il config di prova in una **copia** e lanciare il server con un override
      (nessuna scrittura sul vivo), oppure registrare il ripristino su
      `process.on('exit')` invece che nel solo `afterAll`. La prima è la vera
      correzione; la seconda limita i danni. Stessa famiglia della voce qui sotto.
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

**Ultimo giro di routine: 2026-08-31** (v3.24.0) — `npm outdated` pulito e
`npm audit` a **0 vulnerabilità** su root e `plugins/adminMedia`, con la sola
esclusione di `ccxt` per policy.

⚠ **Quello zero vale meno di quanto sembri, ed è stato misurato.** La 2.3.0 di
`multer` chiude **quattro CVE** — fra cui un crash di processo da una sola
richiesta (`CVE-2026-77078`, CVSS 7.5) — e `npm audit` su una cartella con la
sola `multer@2.2.0` rispondeva `found 0 vulnerabilities`: non sono (ancora) nel
database advisory di npm. `npm outdated` le ha fatte emergere, l'audit no. Un
giro che si fermi all'audit non vede niente.

- [ ] **`ccxt`** (plugin `ccxt`), `4.5.58` → `4.5.76`: verificare se è ancora usato e
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
- [ ] **`adminMedia` — impostare `fieldArrayIndexLimit` nei `limits` di multer.**
      La 2.3.0 introduce il limite ma il suo default è **`Infinity`** (README della
      2.3.0 riga 300; il controllo in `make-middleware.js:224` gira solo se la chiave
      è dichiarata), e `adminMedia` passa `limits: { fileSize: maxSize }` e nient'altro
      (`main.js:131`). Quindi l'aggiornamento **non chiude da solo** la CVE dell'indice
      d'array (`GHSA-535w-7cp7-47q4` / `CVE-2026-82333`, CVSS 7.5): il rimedio
      ufficiale è in **due** parti, aggiornare *e* impostare il limite.
      Misurato su `append-field`: `a[4294967294]` materializza un `Array(len=4294967295)`
      (da 2³²−1 in su il nome ricade su una normale chiave d'oggetto, quindi l'indice
      utile all'attacco è proprio quello sotto il tetto), e un secondo campo con chiave
      **non** numerica sullo stesso oggetto base forza la conversione array→oggetto,
      che itera l'intera lunghezza in modo **sincrono**. Costo misurato su indici
      piccoli: 1e5 → 2,5 ms, 1e6 → 24,7 ms, 1e7 → 245 ms (lineare, ~24,5 ns per
      indice) ⇒ estrapolato al tetto, **≈ 105 s di event loop bloccato** da una sola
      richiesta. Avviene **dentro il parsing**, prima dell'handler: non serve che il
      codice di `adminMedia` legga `ctx.request.body`. Mitigazione presente oggi: la
      rotta sta dietro reserved gate + CSRF + `requiresAuth` con ruoli `[0, 1]`. Da decidere: quale
      indice massimo serve davvero ai nomi di campo del pannello (nessuna sezione usa
      la sintassi `a[n]`, quindi un valore basso sembra sufficiente) e se la chiave
      vada esposta in `pluginConfig.json5` invece che cablata.
      *Fonte: giro dipendenze v3.24.0. Non applicata lì perché è una modifica al codice
      di un plugin, cioè una scelta del maintainer — stesso trattamento di
      `urlRedirect`/`HEAD` in v2.94.0.*

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

**Conseguenza valutata e accettata:** su un'installazione `production` pulita `www/` è
vuota per progetto (git-ignored, il wizard non ci mette nulla), quindi ora `GET /`
risponde **404** invece dell'elenco di `.gitkeep`. Più onesto, ma il primo avvio perde
il suo "funziona!" accidentale. La segnaposto che lo restituiva (v3.21.0) è stata
**rimossa in v3.25.0**: il 404 è il comportamento voluto. Vedi §4 → *pagina segnaposto
di primo avvio*.

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


### ✅ `urlRedirect` — un `HEAD` su un path redirezionato non seguiva il redirect

**RISOLTO in v3.4.0.** La descrizione resta come traccia di come il difetto è stato
trovato e misurato; le scelte prese sono in fondo.

Fonte: emerso aggiornando `koa-classic-server` alla **5.3.0** (v2.94.0), che porta
`HEAD` nel default di `options.method`. **Non è un bug del modulo:** il codice è
nostro, `plugins/urlRedirect/main.js` → `getMiddlewareToAdd()`.

Il middleware si autoesclude su qualsiasi verbo diverso da `GET`
(`if (ctx.method !== 'GET') { await next(); return }`), scelta corretta finché il
server statico rifiutava `HEAD` e la richiesta finiva comunque 404. Ora che `HEAD`
è servito, il redirect viene **scavalcato**: la richiesta prosegue e il file
originale risponde 200.

Misurato su server reale, con una regola temporanea `/robots.txt → /sitemap.xml`:

```
GET  /robots.txt  → 301  (Location: /sitemap.xml)   ✅
HEAD /robots.txt  → 200  (nessun Location)          ❌ serve la risorsa da cui si sta redirezionando
```

RFC 9110 §9.3.2 vuole che `HEAD` rispecchi `GET`: stesso status, stessi header,
nessun corpo. Qui i due verbi divergono sia nello status sia in `Location`. Chi
legge il sito con `HEAD` — cache, reverse proxy, link-checker, crawler — non vede
il redirect e continua a considerare valido il vecchio URL.

- [x] Guard esteso a `HEAD` (`ctx.method !== 'GET' && ctx.method !== 'HEAD'`). Non era
      in realtà una decisione a due uscite: RFC 9110 §9.3.2 definisce `HEAD` come `GET`
      senza corpo, quindi « lasciare che `HEAD` non rediriga » significava tenere una
      violazione, non scegliere una convenzione.
- [x] Un `HEAD` redirezionato **incrementa** l'`hitCounter`. Il contatore si documenta
      da sé come « quante volte ogni regola è **usata** », e un `HEAD` a cui si è
      risposto 301 l'ha usata. L'alternativa avrebbe richiesto di scrivere un caso
      speciale su `HEAD` nel punto del conteggio — cioè re-introdurre, nelle
      statistiche, la stessa divergenza appena corretta nel redirect.
- [x] Test di regressione: `tests/unit/urlRedirect/middleware.test.js`, 12 test. È la
      **prima copertura del middleware** del plugin — i tre file preesistenti coprivano
      le librerie (`redirectMatcher`, `configValidator`, `hitCounter`) ma non il codice
      che le orchestra, ed è esattamente lì che stava il difetto. Il test esercita
      `loadPlugin()` su una **cartella plugin temporanea** con regole vere, così il
      `redirectMap.json5` vivo non serve e non viene toccato.

**Verifica anti-vacuità:** tre mutazioni applicate al codice corretto uccidono i test —
ritorno al guard solo-`GET` (4 rossi), guard rimosso del tutto (6 rossi), `HEAD` che
redirige ma non conta (1 rosso).

## 8. Direzioni ampie

Non sono debito, ma direzioni: il dettaglio vive in
[`docs/roadmap.it.md`](./docs/roadmap.it.md) e non è duplicato qui.

- [x] ~~**🐞 `touches` è scritto project-relative in 7 step su 8, e il runner lo risolve package-relative.**~~
      **CORRETTO in v3.21.0**, tutte e 7, guardate una per una come deciso. Il caso
      delicato — `sentinel`, che tocca il file **secondario** `sentinelRules.json5` — è
      risultato inerte oggi: il suo `.default` e il vivo sono entrambi a `schemaVersion: 1`
      e il descrittore è a 6 con la catena già applicata, quindi l'allineamento e le
      `protectedLivePaths` non cambiano nulla; la correzione conta per un'installazione che
      parta indietro e percorra la catena. **Presidio repo-wide** in
      `tests/integration/migrationsTouches.test.js`: per ogni `migrations.json5` del
      progetto ogni `touches` deve risolvere dalla cartella del pacchetto, e non deve
      cominciare con `plugins/`, `themes/` o `core/`.
      ⚠ **Un test esistente codificava l'errore**: `adminSentinel/tests/unit/migrationsChain.test.js`
      risolveva da `repoRoot`, quindi indice e test sbagliavano allo stesso modo e il test
      passava. Corretto anche quello. Cronaca, per memoria:
      *(Emerso in v3.20.0 dalla review; l'ottava — analytics — è corretta lì.)*
      `backupTouchedFiles` (`core/migrationRunner.js:286`) fa
      `path.join(targetObj.packageDir, relative)`. Un `touches: ["plugins/sentinel/…"]`
      risolve quindi in `plugins/sentinel/plugins/sentinel/…`, che non esiste, e il ramo
      `if (!fs.existsSync(full)) continue` lo **salta in silenzio**. La forma corretta è
      documentata (`docs/decisions/config-migrations.it.md:148`): `["pluginConfig.json5"]`.
      **Istanze da correggere:** `plugins/sentinel/migrations/migrations.json5` (5 step),
      `plugins/adminSentinel/…` (1), `core/migrations/adminConfig/…` (1 — anche lì
      `packageDir` è la cartella che ospita il config, non la radice).
      **Non è solo il backup:** `touches` guida anche `alignTouchedSchemaVersions`
      (riga 442) e le `protectedLivePaths` che escludono i file dal merge additivo
      (riga 533). Per gli step che toccano un file **secondario** — `sentinel` con
      `sentinelRules.json5` — le conseguenze sono più larghe della sola rete di backup,
      quindi vanno guardati uno per uno invece che corretti con un `sed`.
      **Presidiabile:** un test che, per ogni `migrations.json5` del repo, verifichi che
      ogni `touches` esista risolto dalla cartella del pacchetto. Ne esiste già uno per
      analytics (`plugins/analytics/tests/unit/migrationV1toV2.test.js`), da generalizzare.
- [x] ~~**`roleManagement.writeJson5Atomic()` riserializza: i ruoli perdono i commenti.**~~
      **Deciso dal maintainer e applicato in v3.21.0: i file di DATI non portano commenti.**
      Chiusa dalla parte opposta rispetto a D1, e la differenza è nella natura dei file —
      `userRole.json5` e `userAccount.json5` non sono scritti da una persona per essere
      riletti da una persona, sono scritti dal codice a ogni operazione del pannello, con
      **cancellazioni** di chiavi annidate che una scrittura chirurgica non saprebbe fare.
      Applicato: intestazione JSON5 tolta dai due `.default` (che restano JSON5 validi e
      **conservano la documentazione dei ruoli**, perché nessun codice li riscrive), con in
      testa la dichiarazione del perché; eccezione scritta in `CLAUDE.md` accanto alla
      regola generale; motivazione nella JSDoc di `writeJson5Atomic`; 3 test che
      impediscono di "correggere" l'incoerenza in una direzione sola. Cronaca, per memoria:
      *(Emerso in v3.20.0 dalla review.)* È **la stessa forma della decisione D1**, in un
      altro file. `writeJson5Atomic` fa `JSON.stringify(data, null, 2)`, quindi ogni
      creazione/modifica/cancellazione di ruolo dal pannello **azzera i commenti** di
      `userRole.json5` — misurato su copia: **15 righe con commento → 0**, e sparisce
      anche l'intestazione JSON5 che `CLAUDE.md` dichiara obbligatoria su ogni `.json5`.
      **Preesistente alla branch** (su `main` erano già quattro `fs.writeFileSync` con
      `JSON.stringify`); la v3.12.0 ha aggiunto l'atomicità senza cambiare la
      serializzazione. **È una decisione, non una svista:** per D1 il maintainer ha
      scelto la scrittura chirurgica, ma `userRole.json5` e `userAccount.json5` sono
      **dati**, non configurazione — e per i dati riserializzare è difendibile. Le due
      uscite: **applicare anche qui `setJson5Key`** chiave per chiave (coerenza con D1,
      ma su una struttura annidata `roles.<id>.<campo>` e con cancellazioni, che
      `setJson5Key` non sa fare), oppure **dichiarare che i file di dati non portano
      commenti** e togliere l'intestazione dai loro `.default` — chiudendo la
      contraddizione dalla parte opposta.
- [ ] **🔍 Rivedere la strategia di backup, e i nomi che la rendono illeggibile.**
      *(Emerso in v3.18.0, chiudendo D6.)* Sotto `backups/` convivono **due sistemi
      diversi che non si conoscono fra loro**, e la confusione comincia dai nomi.

      | | `npm run backup` | il backup del wizard |
      |---|---|---|
      | Modulo | `scripts/lib/backupEngine.js` | `scripts/lib/backupManager.js` |
      | Quando | a comando | solo dentro `npm run start-configure` |
      | Cosa copia | tutta l'installazione | `ital8Config`, `koaSession`, e i file che un plugin dichiara con `getFilesToBackup()` |
      | Cartella | `backups/backup-<timestamp>/` | `backups/init-<timestamp>/` |
      | Ripristino | `npm run restore -- --latest` | automatico, solo su fallimento, solo per plugin |
      | Visto da `backup-list` | sì | **no** |

      **⚠ Due file si chiamano `backupManager.js`** e non c'entrano niente l'uno con
      l'altro: `scripts/backupManager.js` è il comando `npm run backup-manager` (pota
      gli snapshot), `scripts/lib/backupManager.js` è la classe del wizard. Il nome
      condiviso è il primo motivo per cui la faccenda è difficile da tenere a mente.

      **I limiti concreti, misurati:**
      - **Il backup globale non ha alcun ripristino.** `ital8Config.json5` e
        `koaSession.json5` vengono copiati (`init.js:209`, `sessionKeyManager.js:148`)
        ma **nessun codice li rimette a posto**: quella copia va ripescata a mano.
      - **Gli `init-*` sono invisibili alla toolchain degli snapshot.**
        `backupEngine.listBackups()` filtra per prefisso `backup-`
        (`backupEngine.js:35`), quindi `backup-list`, `backup-manager` e `restore`
        non li vedono: non vengono elencati, non si ripristinano col comando, e
        **non vengono potati mai**.
      - **`initState.json5` registra due formati di path diversi**: quello globale è
        **relativo** (`getBackupPath()`), quello per-plugin è **assoluto** (il valore
        di ritorno di `backupPluginFiles`, `pluginInitRunner.js:86`).
      - **`getPluginBackupPath()` è codice morto**: nessun chiamante in produzione,
        solo due test.
      - **Un solo plugin dichiara `getFilesToBackup()`**: `adminUsers`
        (`userAccount.json5` + `userRole.json5`). Il meccanismo per-plugin esiste per
        un caso solo.
      - ~~**La procedura non è documentata da nessuna parte.**~~ **Scritta in v3.19.0:**
        [`docs/backup-strategie.it.md`](./docs/backup-strategie.it.md) mette i due sistemi
        a confronto, descrive per intero quello del wizard (cosa copia e quando, layout
        della cartella, ripristino e suoi limiti, come dichiarare `getFilesToBackup()` in
        un plugin) e spiega **come recuperare a mano**, visto che il backup globale non ha
        un ripristino automatico. Restano da decidere le altre voci qui sopra.

      **Cosa deciderà la revisione:** se i due sistemi restano due (e allora vanno
      distinti nei nomi e nella documentazione) oppure convergono in uno solo; che
      forma ha un path scritto in `initState.json5`; se il backup globale merita un
      ripristino o va dichiarato « copia di cortesia ». Vedi anche la voce chiusa
      **(D6)** in §5, il cui rilievo originario — `getBackupPath()` ancorata a
      `__dirname` — è stato assorbito qui: da solo non valeva un intervento, come
      parte di questa revisione sì.
- [ ] Migrazione a **TypeScript**
- [ ] Configurazione via **`.env`**
- [ ] **Documentazione API** (Swagger/OpenAPI)
- [ ] **Error handling** centralizzato come middleware
- [ ] **Logging strutturato** (Winston/Bunyan)
- [ ] **Libreria di validazione** delle richieste (Joi/Yup)
- [ ] **Build frontend** (bundling degli asset)
- [ ] **Cleanup dei plugin allo shutdown** coordinato da `pluginSys`, oggi lasciato
      a ogni plugin (es. `urlRedirect/hitCounter.js` gestisce i propri segnali)

## 9. Zone dello spazio URL e segnaposti di percorso

Fonte: [`docs/decisions/path-zones.it.md`](./docs/decisions/path-zones.it.md)
(design **approvato** il 2026-10-30, strada B — « costruire il muro »).
Chiude alla radice [`REVIEW.md`](./REVIEW.md) → **A1** e **A3**.

**Fasi 0-3 fatte** (2026-10-30/31). **A1 e A3 sono CHIUSI e spuntati in `REVIEW.md`.**
Il pannello è protetto a qualunque `adminPrefix` e anche con `accessControl.json5`
svuotato, illeggibile o cancellato; un ruleset non applicabile non fa partire il CMS
(box `[ACCESS]` + `[FATAL]`, verificato sul server reale); una modifica che non
passerebbe il boot non può essere salvata dalla GUI. Le fasi 4-6 che restano sono
**pulizia e propagazione, non correzione**.

- [x] ~~**Fase 0 — conferma del naming.**~~ **Chiusa il 2026-10-30:** tutti i nomi
      approvati (`{{admin}}`, `pathZones`/`core/pathZoneResolver.js`,
      `accessInvariants`/`core/accessInvariantCheck.js`, `[ACCESS]`, `baseline`).
- [x] ~~**Fase 1 — la mappa: `core/pathZoneResolver.js`** (modulo puro).~~
      **Fatta il 2026-10-30.** `resolvePathZones` · `resolveRuleset` · `resolvePattern` ·
      `zoneForPath` · `ZONE_NAMES`; 132 test in `tests/unit/core/pathZoneResolver.test.js`,
      parametrizzati su cinque prefissi diversi (`admin`, `backoffice`, `pannello`,
      `a-b_c`, `MixedCase`). In corso d'opera sono emersi due fail-open silenziosi non
      previsti dalla decisione (delimitatore di segnaposto spaiato, due zone sullo stesso
      prefisso concreto): aggiunti come terzo e quarto tipo di problema. Il modulo è
      poi stato **revisionato**: nove difetti di implementazione corretti, sei dei
      quali erano fail-open silenziosi (quantificatori regex scartati, estensione non
      normalizzata, `**` derivato in largo, prefisso non validato, precedenza delle
      collisioni rovesciata, derivazione solo in una direzione, chiave vuota,
      annidamento fra zone, lookup sul prototipo). Dettaglio nel registro di
      decisione → *Revisione del codice*. Nessun consumatore collegato.
- [x] ~~**Fase 2 — `baseline` di zona in `accessManager`.**~~ **Fatta il 2026-10-31.**
      `tightenAccess` + `violatesBaseline` nel core, problema `baseline-violation` al
      caricamento, `checkAccess` che ricava la zona dalla **URL richiesta** (così il
      baseline vale anche dove il controllo al caricamento non arriva: i pattern
      `regex:`). La `defaultPolicy` è **affiancata, non rimossa**: sulle zone aperte
      decide ancora lei, quindi il comportamento del sito pubblico è identico a prima
      e il cambiamento riguarda solo le tre zone chiuse. Le `hardcodedRules`
      **restano** come documentazione (decisione del maintainer), con il commento che
      dichiara che non sono più la fonte di verità. +28 test sul motore.
      **Un cambiamento da conoscere:** `GET {{adminThemeResources}}/...` da anonimo
      ora risponde 302 invece di 200 — fuga che il commento di `runtimeGate.js:232`
      già descriveva; la pagina di login non è toccata (usa il tema pubblico).
- [x] ~~**Fase 3 — invarianti + box `[ACCESS]`: `core/accessInvariantCheck.js`.**~~
      **Fatta il 2026-10-31.** Le sonde si **derivano** dalle zone invece di essere
      elencate (19 sulla configurazione distribuita), così una zona chiusa aggiunta
      domani è coperta senza toccare il file; verificano anche il verso opposto (ogni
      ruolo ammesso deve entrare, perché un pannello irraggiungibile al suo
      amministratore non è sicurezza). L'unica sonda non derivabile è la più
      importante: il login raggiungibile da anonimo, con l'URL preso da
      `defaultPolicy.redirectOnDenied` — senza, un rifiutato finisce su una pagina che
      lo rifiuta e nessuno può più autenticarsi per correggere. Al boot si **lancia**
      (la fatalità è di `pluginSys`, non un `process.exit` dal plugin); a runtime si
      rifiuta tenendo il ruleset precedente. `saveRules` esegue gli stessi controlli
      **prima di scrivere**: un file che non farebbe ripartire il CMS non può essere
      salvato. Tutti e otto i problemi sono fatali, con messaggi **diagnostici** e non
      prescrittivi. +72 test. **A1 e A3 spuntati in `REVIEW.md`.**
      **Revisionata**, con cinque difetti corretti, di cui uno era un **fail-open nel
      percorso di enforcement**: un rifiuto che non portava né redirect né status
      cadeva su `await next()` e la pagina veniva servita a chi era stato negato —
      raggiungibile con una `defaultPolicy` priva di `redirectOnDenied`, e invisibile
      alle sonde perché leggevano solo `allowed`. Ora un rifiuto deve essere
      **applicabile**, e `validateCandidate` non sostituisce più la policy viva a
      quella mancante (altrimenti salvava un file che al boot non parte). Dettaglio
      nel registro → *Revisione della Fase 3*.
- [x] ~~**Fase 4 — segnaposti nei `.default` + migrazione.**~~ **Fatta il 2026-10-31.**
      In `accessControl.default.json5` le **10 regole dichiarate diventano 6**: i
      letterali passano a `{{admin}}`/`{{pluginPages}}`, e le tre forme senza
      estensione non sono più scritte a mano ma **derivate** quando `hideExtension` è
      acceso per quella zona (D5). `migrations/` con lo step v3→v4 e bump del
      descrittore (`pluginConfig.default.json5`) a `4`: il clock è il descrittore,
      quindi la `schemaVersion` di `accessControl` resta **3** di proposito — cambiano
      i valori delle chiavi, non le chiavi. Lo script è **testuale** (un `saveJson5`
      dell'oggetto perderebbe i commenti, che qui sono la parte che spiega perché le
      `hardcodedRules` non sono più la fonte di verità), **idempotente** e
      **fail-soft**: un pattern che non riconosce lo lascia e lo segnala, e una forma
      pulita modificata dall'amministratore non viene rimossa. Verificata con la CLI
      reale (6 pattern convertiti, 3 forme pulite rimosse, ricevuta + backup), poi boot
      pulito e la prova che conta: con `adminPrefix: "backoffice"` i pattern risolvono
      a `/backoffice` e il pannello è protetto **dalla regola**, non solo dal
      `baseline`. +20 test.
      **Un test ha dovuto cambiare, ed è la lezione per la Fase 5:**
      `reservedSurfaceCoverage` leggeva i pattern **grezzi** e li confrontava con URL
      concreti — con i segnaposti non combaciano più, e il test aveva ragione a
      fallire perché misurava la *scrittura* invece dell'*effetto*. Ora passa per il
      resolver, come il motore. Reso **più fedele**, non più permissivo: i casi
      « forma senza estensione » esercitano davvero `hideExtension` acceso, e i casi
      « non riservata » girano su entrambi i ruleset. Verificato con due mutazioni
      (5 e 3 fallimenti).
- [x] ~~**Fase 5 — adozione negli altri consumatori.**~~ **Fatta il 2026-10-31.**
      `sentinel`, `rateLimiter` e `seo` convertiti ai segnaposti, più
      `resolvePatternList` nel core (terza della famiglia per cardinalità: uno,
      un record, una lista nuda). **Il risultato concettuale non era previsto
      dalla decisione:** i path vivono in **due spazi**, non uno — chi *confronta*
      una richiesta sta nello spazio **logico** (e toglie `globalPrefix`), chi
      *emette* un URL verso l'esterno sta in quello **servito** (e lo antepone).
      Accertato consumatore per consumatore prima di convertire, e ha fatto
      emergere due difetti **preesistenti**: `rateLimiter` confrontava il path
      grezzo (su un'istanza con `globalPrefix` **nessuna** esenzione combaciava, e
      l'amministratore poteva farsi limitare sul proprio pannello — il config lo
      ammetteva chiedendo di « adeguare questi percorsi a mano », cosa che coi
      segnaposti diventava impossibile), e `seo` ignorava `globalPrefix` del tutto
      (`Disallow: /admin/` sotto `/mysite` non escludeva niente). Corretti
      entrambi, il secondo su decisione del maintainer.
      I circa venti pattern di **tecnologie altrui** di `sentinel` (`/wp-admin`,
      `/phpmyadmin`, `/.env`) **restano letterali**, ed è deliberato.
      In `sentinel` la risoluzione precede la **validazione** (il validatore
      rifiuta un path che non cominci con `/`), con una guardia: senza config
      globale non si risolve niente, perché `resolvePathZones({})` ricade sui
      prefissi di default e risolverebbe `{{admin}}` a `/admin` su un'istanza
      `backoffice` — A1 riprodotto dentro la sua stessa correzione.
      Tre migrazioni, **due basate su oggetto** (`setJson5Key` su path annidato,
      che preserva i commenti) e una testuale ancorata al testo esatto dove la
      struttura non è indirizzabile. Applicate con la CLI reale su un'installazione
      ricostruita « alla v1 »: tutti i commenti conservati (51/67/326/258).
      **+27 test**, con copertura delle forme su cui uno script del genere perde
      dati — la lezione della revisione della Fase 4.
      **Due presidi hanno colto la propria cecità:** il rilevatore di D8 cercava i
      segnaposti nella sola forma-chiave e non vedeva quelli nei **valori**; e un
      mio test era **vacuo** (il valore scelto non discriminava fra uguaglianza
      esatta e match per prefisso), trovato mutando lo script.
      **🐞 Un difetto di ORDINE, trovato dal vivo:** bumpare la `schemaVersion` di
      un `.default` **prima** di dichiarare la migrazione **brucia il trigger** —
      il merge additivo allinea il vivo al primo boot, la ricevuta avanza e il
      lavoro non viene fatto. Accaduto in sessione su `rateLimiter` e `seo`.
      L'ordine è obbligatorio: prima `migrations/`, poi il bump. Nessun presidio
      lo impone (registrato fra i punti rimandati).
- [ ] **Fase 6 — consolidamento `runtimeGate`.** Il `reservedGate` deriva il perimetro
      dalla mappa invece di ricalcolarlo: oggi `runtimeGate.js:60` e `:275` leggono
      `adminPrefix` **correttamente**, `accessControl.json5` no, ed è proprio questa
      divergenza fra due derivazioni dello stesso perimetro ad aver prodotto A1.

**Punti rimandati** (dal registro di decisione, §*Punti rimandati*):

- [ ] `baseline` della zona `site`: il nome della chiave è deciso, **la sua collocazione no**
      (caso d'uso « sito privato », reale ma non urgente).
- [ ] Vocabolario **estendibile dai plugin**: chiuso per v1; aprirlo introduce uno
      spazio di nomi condiviso, quindi richiede un prefisso di namespace.
- [ ] Lettura di chiavi arbitrarie da file arbitrari (la forma generale della proposta
      iniziale): molta più macchina per casi d'uso che oggi non esistono.
- [ ] **`dirListing` acceso sul file server admin** (`index.js:563`, l'unico dei cinque).
      Non fa parte della decisione, ma è uno dei tre fattori che trasformano A1 da
      disallineamento di configurazione a esposizione dell'intero albero del pannello.

## 10. Operazioni su chiave `.json5` — `removeJson5Key` e la sostituzione per chiave

Fonte: [`docs/decisions/json5-key-operations.it.md`](./docs/decisions/json5-key-operations.it.md)
(decisioni D1-D5 prese il 2026-11-01, implementazione da fare).
Origine: revisione della **Fase 4** di [`path-zones.it.md`](./docs/decisions/path-zones.it.md).

**Il buco.** Lo strato di chirurgia testuale del core copre **quattro operazioni
su cinque**: leggere (`loadJson5`), riscrivere tutto (`saveJson5`), aggiornare una
chiave (`editJson5`), aggiungere-o-aggiornare (`setJson5Key`). **Rimuovere una
chiave non esiste** — ed è stata riscritta a mano dentro uno script di migrazione
(`dropRuleBlock`), con `indexOf` invece della macchina di scansione che viveva
venti righe più in là. Ne sono usciti due difetti di perdita dati, entrambi
riprodotti: una regola scritta **inline** faceva cancellare anche quella
**successiva** (8 regole custom diventate 3 invece di 4, con `isAuthEntryPoint`
perso), e il **contenuto non veniva mai guardato**, quindi una regola che
l'amministratore aveva **stretto** veniva cancellata e il suo URL ricadeva sul
gemello più permissivo.

- [x] ~~**Fase 1 — `core/removeJson5Key.js`** con i suoi test.~~ **Fatta il
      2026-11-01.** La scansione è stata estratta in **`core/json5Scan.js`**
      (modulo di sola lettura, nome approvato): sette funzioni, zero dipendenze
      esterne nel blocco, `editJson5.js` **da 628 a 278 righe** e la suite
      invariata a dimostrarlo. `editJson5._internals` **rimosso** — il suo unico
      consumatore di produzione era `setJson5Key.js:180`, che ora importa
      `json5Scan` direttamente. `removeJson5Key` ha la firma simmetrica ai
      fratelli, no-op su chiave assente (idempotenza), rifiuto su path ambiguo, e
      una **postcondizione in due parti verificata prima di scrivere**: il path
      non esiste più *e* tutto il resto del documento è identico — la seconda è la
      rete che impedisce al difetto storico di ripetersi in silenzio, perché una
      cancellazione che si porta via la coppia successiva lascia un file ancora
      parsabile. **40 test** e **3 mutazioni**, tutte colte; la prima stesura di
      una era *infedele* (cercava `'},'` invece di `'\n  },'`, cioè newline più
      indentazione, che è il motivo per cui il difetto saltava la propria
      chiusura) e corretta uccide il test giusto.
- [ ] **Fase 2 — sostituzione per chiave in `editJson5`.** Oggi, cambiando *una*
      chiave di un oggetto, spariscono i commenti di **tutte** le altre, anche di
      quelle il cui valore non cambia — misurato. La correzione è non ricostruire
      il blocco ma **ricorrere**: per chiave sugli oggetti, per indice sugli array
      a lunghezza invariata. Richiede di estendere `editJson5` alla navigazione
      dentro gli array per indice, oggi fuori perimetro. **`removeJson5Key` è il
      prerequisito**, non il contrario: la ricorsione ha bisogno di « rimuovi »
      per le chiavi che il nuovo valore non ha più.
- [x] ~~**Fase 3 — specifiche e documentazione.**~~ **Fatta il 2026-11-01.**
      Riscritto l'header di `editJson5` (lo *Scope* citava la perdita dei commenti
      come **limite**: sostituito, non annotato); `CLAUDE.md` aggiornato, con la
      riga sulle migrazioni che ora conosce **cinque** operazioni invece di due.
      **La sovra-affermazione della Fase 5 non andava corretta: la Fase 2 l'ha
      resa vera.** `editJson5` ricorre per indice a lunghezza invariata, e quelle
      migrazioni usano `declared.map(...)`, che per costruzione non cambia la
      lunghezza — quindi l'affermazione è vera senza riserve *per quelle
      migrazioni*, e il perché è scritto dove serve. Verificato: 5 commenti prima,
      5 dopo, i tre dentro l'array compresi. Il **test cieco** è stato sostituito
      con uno che mette i commenti *dentro* l'array: spegnendo la ricorsione per
      indice fallisce (2 fallimenti, uno per plugin).
- [x] ~~**Fase 4 — `from-v3-to-v4.js` riscritta** sopra `removeJson5Key`.~~
      **Fatta il 2026-11-01.** `dropRuleBlock` eliminata; chiusi i difetti **1**
      (la regola successiva inghiottita su una regola scritta inline), **2** (il
      contenuto mai guardato), **3** (il salto silenzioso delle rinomine), **5**
      (la diagnostica che affermava una causa non verificata) e **7** (il
      temporaneo `.migrating` non ignorato). Il criterio del confronto del corpo è
      « **è ancora un duplicato del suo gemello `.ejs`?** » e non « è ancora
      quella spedita »: i due differiscono in due casi reali e il secondo li
      sbaglia — se l'admin ha modificato il `.ejs` e non la forma pulita,
      rimuoverla farebbe produrre alla derivazione il corpo **modificato**. Le
      rinomine restano testuali, e il perché è scritto: una rinomina che preservi
      posizione e commenti sarebbe una **sesta** operazione. 21 test (+5, con le
      due riproduzioni della revisione), 2 mutazioni colte, e la migrazione
      riapplicata con la **CLI reale** su un'installazione ricostruita alla v3:
      97 commenti su 98, zero temporanei, boot pulito.
- [x] ~~**Fase 5 — RILETTURA MANUALE DI TUTTI I COMMENTI.**~~ **Fatta il
      2026-11-01.** Non era una rifinitura: era la seconda metà di D3 — la funzione
      conserva i commenti **senza giudicarli** (decisione del maintainer: « in
      questa prima fase conserverei i commenti senza fare altro e senza chiedermi
      cosa dicono »), quindi a conversione fatta qualcuno doveva rileggerli.
      **Quattro corretti**, tutti della stessa famiglia — insegnavano la forma che
      la conversione ha abbandonato: l'⚠ di `sentinelRules.default.json5` che
      diceva di scrivere i path **CON** `apiPrefix`/`pluginPagesPrefix` letterali
      (contraddicendo il blocco venti righe sotto, e avvertendo del guasto
      silenzioso che i segnaposti hanno eliminato) più, nelle stesse righe, il
      `globalPrefix` descritto come « anteposto dal codice » quando
      `ruleMatcher.js` lo **toglie**; i due esempi di sintassi di
      `accessControl.default.json5` (verificato che i segnaposti risolvono **anche
      dentro** un `regex:`); e — fuori dai config —
      `plugins/adminSeo/lib/seoFileManager.js`, che dichiarava « comments INSIDE
      the old custom block are lost (**expected**) »: la Fase 2 l'ha reso falso, e
      il « (expected) » dichiarava accettabile una perdita che non avviene più
      (misurato: 10 commenti prima, 10 dopo, `droppedComments: []`).
      Le correzioni stanno nei `.default`, i committati: un'installazione esistente
      conserva il commento vecchio nel proprio vivo finché non lo rigenera
      (`npm run cli -- reset <plugin>`), perché il merge additivo tocca i valori e
      non i commenti. Lasciati per scelta del maintainer: la prosa che situa la GUI
      in `/admin/adminAccessControl/` e il §*Contesto* del decision record, che
      resta al presente.
