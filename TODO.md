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

---

## Decisioni in attesa del maintainer

Punti in cui il lavoro è **fermo per scelta, non per mancanza di tempo**: ognuno ha
più uscite difendibili e cambia comportamento o convenzioni, quindi la decisione
spetta al maintainer. Chi riprende in mano il progetto può partire da qui.

Le voci con un rimando hanno la trattazione completa nella sezione indicata; quelle
senza rimando sono descritte per intero qui perché non hanno una voce propria altrove.

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
- [ ] **`PATCH` e `DELETE` fra i verbi supportati dalle rotte dei plugin?**
      *(Rimasta aperta chiudendo il difetto di `loadRoutes()` in v3.0.0, §5.)*
      Oggi `ROUTER_METHOD_DISPATCH` gestisce `GET/POST/PUT/DEL/ALL`; un verbo fuori da
      questi non viene registrato e — da v3.0.0 — viene segnalato con un warning.
      Nessuna rotta del progetto li usa (censimento: solo `GET` ×66 e `POST` ×69),
      quindi non c'è urgenza. Le uscite sono due: **aggiungerli** alla mappa (una riga
      per verbo, `@koa/router` li supporta) rendendo il CMS più convenzionale per chi
      scrive API REST, oppure **lasciarli fuori** dichiarando che `DEL` è la forma
      canonica del progetto. Aggiungendoli va aggiornata anche `VALID_METHODS` in
      `core/testHelpers/routeRunner.js` — il test di coerenza lo impone.
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
- [ ] **Il valore della soglia minima di coverage in CI** → §5.
      Da fissare quando gli step del piano di rientro saranno completati: la proposta è
      **appena sotto** il valore raggiunto, come cricchetto anti-regressione e non come
      obiettivo da rincorrere.
- [ ] **I temi entrano nello scope della coverage?** → §5.
      Oggi `collectCoverageFrom` copre `core`, `plugins`, `scripts`, `bin` e `index.js`,
      ma **non** `themes/`. Il JS dei temi è poco (6 file, 395 righe) e tutto lato
      browser. Da decidere insieme ai test dei temi: includerli senza test li porterebbe
      a 0% e abbasserebbe la soglia senza dire niente di nuovo.
      **Aggiornamento (v3.5.0):** i test dei temi ora ci sono, ma verificano *struttura e
      contratti* — non eseguono il JS lato browser dei temi, che resterebbe comunque a
      0%. La decisione quindi **non** è sbloccata da v3.5.0: dipende ancora dalla scelta
      su `jsdom` vs e2e per il client-side (voce qui sotto).
- [x] ~~**Come testare i 7 temi: un test parametrico unico o `themes/<tema>/tests/`?**~~
      **Deciso dal maintainer e applicato in v3.5.0:** `themes/<tema>/tests/themeIntegrity.test.js`,
      uno per tema, per il modello self-contained — un tema distribuito porta con sé il
      proprio test. Il costo della forma (la stessa logica ripetuta sette volte) è
      risolto tenendo le **asserzioni** in `core/testHelpers/themeIntegrity.js` e
      lasciando nel tema **tre righe** che vi delegano: il file resta nel tema, il
      contratto resta uno solo. Il rischio residuo — creare un tema e dimenticare il
      file — è chiuso dallo scaffolding della skill `ital8cms-theme-creator`, che ora
      lo genera (prima aveva una regola esplicita che vietava di farlo).
- [ ] **La GUI admin client-side: `jsdom` o copertura e2e?** → §5.
      2.129 righe all'1,9%, non eseguibili da jest con `testEnvironment: 'node'`.
      I due file dual-mode di `adminSentinel` mostrano una terza via: un guard
      `typeof module` che li rende testabili **senza** cambiare ambiente.
- [ ] **Pagina segnaposto di primo avvio per `/www`** → §4.
      Voce preesistente: su un'installazione `production` pulita `GET /` risponde 404.

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

**Ultimo giro di routine: 2026-08-23** (v2.94.0) — `npm outdated` pulito e
`npm audit` a **0 vulnerabilità**, con la sola esclusione di `ccxt` per policy.

- [ ] **`ccxt`** (plugin `ccxt`), `4.5.58` → `4.5.75`: verificare se è ancora usato e
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

- [ ] Migrazione a **TypeScript**
- [ ] Configurazione via **`.env`**
- [ ] **Documentazione API** (Swagger/OpenAPI)
- [ ] **Error handling** centralizzato come middleware
- [ ] **Logging strutturato** (Winston/Bunyan)
- [ ] **Libreria di validazione** delle richieste (Joi/Yup)
- [ ] **Build frontend** (bundling degli asset)
- [ ] **Cleanup dei plugin allo shutdown** coordinato da `pluginSys`, oggi lasciato
      a ogni plugin (es. `urlRedirect/hitCounter.js` gestisce i propri segnali)
