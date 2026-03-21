# Piano d'Azione — Revisione Progetto ital8cms

**Data revisione:** 2026-03-21
**Stato:** In corso

---

## Come usare questo file

Ogni fase contiene una checklist di problematiche. Man mano che vengono risolte, spuntare la casella corrispondente con `[x]` e annotare il commit/data.

---

## Fase 1 — Bug critici nel core (bloccanti)

Problemi che impediscono il funzionamento corretto del sistema. Da risolvere per primi.

- [ ] **1.1 — Bug parentesi in validazione dipendenze** (`core/pluginSys.js:264`)
  - Il `||` e le parentesi sono posizionati in modo errato dentro `has()`, rendendo la validazione delle dipendenze tra plugin **completamente non funzionante**
  - Codice attuale: `if( !pluginsVersionMap.has( dependencyPluginName || !semver.satisfies(...) ) )`
  - Dovrebbe essere: `if( !pluginsVersionMap.has(dependencyPluginName) || !semver.satisfies(...) )`
  - **Impatto:** I plugin si caricano anche quando le dipendenze non sono soddisfatte

- [ ] **1.2 — Variabile globale implicita** (`index.js:12`)
  - `router = priorityMiddlewares.router` senza `const`/`let`/`var`
  - Crea una variabile globale, problematico in strict mode
  - Fix: aggiungere `const`

- [ ] **1.3 — Typo sistematico `unistallPlugin`** (11 file plugin)
  - Tutte le `main.js` dei plugin esportano `unistallPlugin` invece di `uninstallPlugin`
  - Il core (`pluginSys.js`) deve chiamare il metodo corretto — verificare quale nome usa il core per decidere se fixare il core o i plugin
  - **File coinvolti:** `admin`, `adminUsers`, `adminBootstrapNavbar`, `adminAccessControl`, `bootstrap`, `bootstrapNavbar`, `ccxt`, `dbApi`, `media`, `ostrukUtility`, `OLD_dbApi`, `exaplePlugin`

---

## Fase 2 — Pulizia dipendenze e configurazione

Rimuovere il superfluo e correggere le configurazioni.

- [ ] **2.1 — Rimuovere dipendenze fantasma da `package.json`**
  - `"fs": "^0.0.1-security"` — modulo built-in Node.js, non serve come dipendenza npm
  - `"path": "^0.12.7"` — modulo built-in Node.js, non serve come dipendenza npm
  - `"handlebars": "^4.7.8"` — mai usato nel progetto (il template engine usato è EJS)
  - Fix: rimuovere le 3 voci da `dependencies` e rieseguire `npm install`

- [ ] **2.2 — Verificare coerenza `pluginDescription.json5`**
  - Controllare che ogni plugin abbia `name` e `version` corretti
  - Verificare che le versioni dichiarate nelle `dependency` dei plugin corrispondano a versioni reali

---

## Fase 3 — Sicurezza XSS nei template

Vulnerabilita di injection HTML/JS nei template admin e pubblici.

- [ ] **3.1 — XSS via innerHTML nella lista utenti** (`plugins/adminUsers/adminWebSections/usersManagment/index.ejs:105-113`)
  - `user.username` inserito in `innerHTML` senza escaping
  - Fix: usare `textContent` per testo puro, oppure sanitizzare con `escapeHtml()`

- [ ] **3.2 — XSS via innerHTML nella vista utente** (`plugins/adminUsers/adminWebSections/usersManagment/userView.ejs:77-95`)
  - `role.name` e `role.description` inseriti in `innerHTML` senza escaping
  - Fix: sanitizzare i valori prima dell'inserimento

- [ ] **3.3 — XSS nel menu admin** (`core/admin/webPages/index.ejs:98-108`)
  - `section.label`, `section.icon`, `section.plugin` non escaped
  - `menuContainer.innerHTML = menuHTML` senza sanitizzazione
  - Fix: escape delle stringhe di configurazione

- [ ] **3.4 — XSS via query parameter** (`plugins/adminUsers/adminWebSections/usersManagment/userUpsert.ejs:33-35`)
  - `urlParams.get('username')` inserito nel DOM senza validazione
  - Fix: sanitizzare il valore del parametro

- [ ] **3.5 — Valutare creazione utility `escapeHtml()` centralizzata**
  - Creare un helper riutilizzabile per i template client-side
  - Oppure adottare una libreria come DOMPurify per il sanitize lato client

---

## Fase 4 — Sicurezza: Open Redirect

- [ ] **4.1 — Validazione `referrerTo` in login** (`plugins/adminUsers/webPages/login.ejs:86-88`)
  - Il parametro URL `referrerTo` viene usato come destinazione redirect senza validazione
  - Un attaccante puo creare: `/login.ejs?referrerTo=https://attacker.com`
  - Fix: validare che il redirect sia verso un URL interno (stesso dominio, path relativo)

- [ ] **4.2 — Validazione `referrerTo` in logout** (`plugins/adminUsers/webPages/logout.ejs`)
  - Stesso problema del login
  - Fix: stessa validazione del punto 4.1

- [ ] **4.3 — Validazione `referrerTo` lato server** (`plugins/adminUsers/main.js`)
  - Verificare che anche il backend validi la destinazione del redirect post-login/logout

---

## Fase 5 — Accessibilita e qualita HTML

- [ ] **5.1 — Attributo `lang` dinamico nel tema pubblico** (`themes/default/views/head.ejs:2`)
  - Attualmente hardcoded `<html lang="en">`
  - Fix: `<html lang="<%= passData.ctx.state?.lang || 'en' %>">`

- [ ] **5.2 — Attributo `lang` dinamico nel tema admin** (`themes/defaultAdminTheme/views/head.ejs:2`)
  - Attualmente hardcoded `<html lang="it">`
  - Fix: stessa logica del punto 5.1

- [ ] **5.3 — Rimuovere contenuto placeholder** (`plugins/adminUsers/adminWebSections/usersManagment/userDelete.ejs:19`)
  - Contiene `<h1>pagina di admin ed adessio vediamo come fare</h1>` — testo placeholder con typo
  - Fix: sostituire con contenuto reale o rimuovere la pagina se non pronta

- [ ] **5.4 — Passaggio config via `<span display:none>` invece di `<script>`**
  - Diversi template usano `<span style="display:none">` per passare configurazione al JS client
  - Screen reader li annunciano ugualmente
  - Fix: usare `<script type="application/json">` o variabili JS inline

- [ ] **5.5 — Struttura semantica HTML nei form di visualizzazione**
  - `userView.ejs`: usa `<p>` con `for` attribute (semanticamente scorretto)
  - Fix: usare `<div>`, `<span>` o definition list (`<dl>/<dt>/<dd>`)

---

## Fase 6 — Qualita codice e consistenza

- [ ] **6.1 — Rimuovere codice commentato** (`plugins/adminUsers/adminWebSections/usersManagment/index.ejs:132-159`)
  - Grosso blocco di JS commentato per form di creazione utente
  - Fix: rimuovere (e gia in git history se servisse)

- [ ] **6.2 — Standardizzare il passaggio di configurazione ai template**
  - Tre pattern diversi in uso: hidden span, fetch API, attributi EJS diretti
  - Decidere un pattern unico e applicarlo ovunque

- [ ] **6.3 — Rimuovere stili inline** (`plugins/adminUsers/webPages/logout.ejs:37`)
  - `style="width: 100%; max-width: 400px;"` mischiato con classi Bootstrap
  - Fix: usare utility Bootstrap o classi CSS personalizzate

- [ ] **6.4 — Verificare operatore errato in codice commentato** (`core/pluginSys.js:364`)
  - `if( nomePlugin0 =! nomePlugin1)` — operatore `=!` sbagliato (dovrebbe essere `!==`)
  - Se il codice e commentato e non in uso, rimuoverlo; se deve essere riattivato, fixare

---

## Fase 7 — Robustezza del plugin system

- [ ] **7.1 — Validazione percorsi in `pluginSys.js`**
  - Verificare che il caricamento plugin gestisca correttamente path con spazi o caratteri speciali

- [ ] **7.2 — Gestione errori nel caricamento plugin**
  - Un plugin che crasha durante `loadPlugin()` non dovrebbe bloccare l'intero server
  - Verificare che ci sia try-catch adeguato

- [ ] **7.3 — Verificare che `getSharedObject()` gestisca plugin non esistenti**
  - Deve restituire `null`/`undefined` senza crash

---

## Fase 8 — Test mancanti

- [ ] **8.1 — Test per `pluginSys.js`**
  - Nessun test unitario per il modulo piu critico del sistema
  - Priorita: test per caricamento plugin, risoluzione dipendenze, condivisione oggetti

- [ ] **8.2 — Test per `themeSys.js`**
  - Nessun test per il sistema temi
  - Priorita: test per `getThemePartPath()`, `injectPlugin*()`, `extractPluginContext()`

- [ ] **8.3 — Test per `index.js` (avvio server)**
  - Test di integrazione per verificare che il server si avvii senza errori con configurazione default

- [ ] **8.4 — Test per `adminUsers` (autenticazione)**
  - Test per login/logout, gestione sessioni, validazione credenziali

- [ ] **8.5 — Test per `adminAccessControl`**
  - I test del `ruleValidator` esistono gia
  - Mancano test per `accessManager.js` e `patternMatcher.js` (verificare copertura attuale)

---

## Fase 9 — Documentazione

- [ ] **9.1 — Aggiornare CLAUDE.md dopo le correzioni**
  - Aggiornare conteggio test
  - Documentare eventuali breaking change (es. rinomina `unistallPlugin` → `uninstallPlugin`)
  - Aggiornare changelog

- [ ] **9.2 — Documentare pattern di sicurezza per template**
  - Aggiungere sezione in CLAUDE.md su come gestire XSS nei template EJS
  - Documentare l'uso della utility `escapeHtml()` (se creata in Fase 3.5)

---

## Riepilogo priorita

| Fase | Priorita | Rischio | Effort stimato |
|------|----------|---------|----------------|
| 1 — Bug critici core | CRITICA | Funzionamento rotto | Basso |
| 2 — Pulizia dipendenze | ALTA | Confusione/bloat | Basso |
| 3 — XSS template | ALTA | Sicurezza | Medio |
| 4 — Open redirect | ALTA | Sicurezza | Basso |
| 5 — Accessibilita | MEDIA | UX/compliance | Basso |
| 6 — Qualita codice | MEDIA | Manutenibilita | Basso |
| 7 — Robustezza plugin sys | MEDIA | Stabilita | Medio |
| 8 — Test mancanti | MEDIA | Regressioni | Alto |
| 9 — Documentazione | BASSA | Onboarding | Medio |

---

## Progresso

| Fase | Stato | Commit/Note |
|------|-------|-------------|
| Pre-0: Symlink hardcoded | ✅ Completata | `c2c56c8` — relative symlinks + gitignore |
| 1 — Bug critici core | ⬜ Da iniziare | |
| 2 — Pulizia dipendenze | ⬜ Da iniziare | |
| 3 — XSS template | ⬜ Da iniziare | |
| 4 — Open redirect | ⬜ Da iniziare | |
| 5 — Accessibilita | ⬜ Da iniziare | |
| 6 — Qualita codice | ⬜ Da iniziare | |
| 7 — Robustezza plugin sys | ⬜ Da iniziare | |
| 8 — Test mancanti | ⬜ Da iniziare | |
| 9 — Documentazione | ⬜ Da iniziare | |
