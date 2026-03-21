# Piano d'Azione — Revisione Progetto ital8cms

**Data revisione:** 2026-03-21
**Stato:** In corso

---

## Indice Fasi

- [x] **Pre-0** — Symlink hardcoded *(completata)*
- [x] **Fase 1** — Bug critici nel core (bloccanti) *(completata)*
- [x] **Fase 2** — Pulizia dipendenze e configurazione *(completata)*
- [x] **Fase 3** — Sicurezza XSS nei template *(completata)*
- [x] **Fase 4** — Sicurezza: Open Redirect *(completata)*
- [x] **Fase 5** — Accessibilità e qualità HTML *(completata)*
- [x] **Fase 6** — Qualità codice e consistenza *(completata)*
- [ ] **Fase 7** — Robustezza del plugin system
- [ ] **Fase 8** — Test mancanti
- [ ] **Fase 9** — Documentazione

---

## Metodo di lavoro

Per **ogni singolo problema** all'interno di una fase, il flusso e il seguente:

1. **Descrizione** — Spiegazione dettagliata del problema, del contesto e dell'impatto
2. **Soluzioni proposte** — Presentazione di almeno 2 possibili approcci risolutivi con pro/contro
3. **Scelta** — Il maintainer sceglie la soluzione preferita
4. **Domande** — Se non ho almeno il 90% delle informazioni necessarie per implementare, faro domande mirate prima di procedere
5. **Implementazione** — Scrittura del codice correttivo
6. **Test/Verifica** — Verifica che la fix funzioni e non introduca regressioni
7. **Commit** — Commit della fix con messaggio descrittivo
8. **Aggiornamento checklist** — Spunta del task completato in questo file

Solo dopo aver completato tutti i task di una fase si passa alla fase successiva.

---

## Come usare questo file

Ogni fase contiene una checklist di problematiche. Man mano che vengono risolte, spuntare la casella corrispondente con `[x]` e annotare il commit/data. L'indice in cima viene aggiornato quando una fase intera e completata.

---

## Fase 1 — Bug critici nel core (bloccanti)

Problemi che impediscono il funzionamento corretto del sistema. Da risolvere per primi.

- [x] **1.1 — Bug parentesi in validazione dipendenze** (`core/pluginSys.js:264`) — `be267ad`
  - Il `||` e le parentesi sono posizionati in modo errato dentro `has()`, rendendo la validazione delle dipendenze tra plugin **completamente non funzionante**
  - **Soluzione applicata:** Separato in `pluginExists` + `versionOk` per leggibilita

- [x] **1.2 — Variabile globale implicita** (`index.js:12`) — `9764254`
  - `router = priorityMiddlewares.router` senza `const`/`let`/`var`
  - **Soluzione applicata:** Aggiunto `const`

- [x] **1.3 — Typo sistematico `unistallPlugin`** (13 file) — `f38df31`
  - Tutte le `main.js` dei plugin esportavano `unistallPlugin` invece di `uninstallPlugin`
  - **Soluzione applicata:** Rinominato in tutti gli 11 plugin + 2 file documentazione

---

## Fase 2 — Pulizia dipendenze e configurazione

Rimuovere il superfluo e correggere le configurazioni.

- [x] **2.1 — Rimuovere dipendenze fantasma da `package.json`** — `b7541d5`
  - Rimossi `fs` e `path` (moduli built-in Node.js)
  - `handlebars` mantenuto: usato da `simpleI18n` plugin

- [x] **2.2 — Verificare coerenza `pluginDescription.json5`** — `30c8a73`
  - Nomi e versioni: tutti coerenti, nessuna inconsistenza
  - **Soluzione applicata:** Rinominato campo `"licenze"` → `"license"` in 9 file

---

## Fase 3 — Sicurezza XSS nei template

Vulnerabilita di injection HTML/JS nei template admin e pubblici.

- [x] **3.0a — Utility `escapeHtml` server-side centralizzata** — `d340f94`
  - Creata `core/escapeHtml.js` come singola fonte per la sanitizzazione HTML
  - Stessa implementazione di `bootstrapNavbar/navbarRenderer.js` (già testata con 206 test)

- [x] **3.0b — Sanitizzazione server-side in tutti gli endpoint API** — `d340f94`
  - `/userList`: username escapato
  - `/userInfo`: email escapata + validazione null-check (404 se utente non esiste)
  - `/roleList`: name e description di ogni ruolo escapati
  - `roleManagement.getCustomRoles()` e `getHardcodedRoles()`: name e description escapati
  - `adminSystem.getMenuSections()`: label, description, plugin name escapati (icon intenzionalmente HTML)

- [x] **3.1 — XSS via innerHTML nella lista utenti** — `d340f94`
  - Aggiunto `escapeHtml()` client-side (defense-in-depth) + `encodeURIComponent()` per URL

- [x] **3.2 — XSS via innerHTML nella vista utente** — `d340f94`
  - Aggiunto `escapeHtml()` client-side + `encodeURIComponent()` per URL query e link

- [x] **3.3 — XSS nel menu admin** — `d340f94`
  - Aggiunto `escapeHtml()` client-side per label, title, url, plugin name

- [x] **3.4 — XSS via innerHTML in userUpsert e rolesManagment** — `d340f94`
  - Sanitizzazione ruoli con `escapeHtml()` client-side
  - Fix onclick injection: da stringhe inline a `data-attributes` sicuri

- [x] **3.5 — Utility `escapeHtml()` client-side centralizzata (Soluzione B)** — `d340f94`
  - File condiviso `themes/defaultAdminTheme/themeResources/js/escapeHtml.js`
  - Incluso in `head.ejs` del tema admin per tutte le pagine
  - Defense-in-depth: la difesa primaria resta server-side

- [x] **3.6 — Test sanitizzazione XSS server-side** — `54525a5`
  - 26 test per `core/escapeHtml.js` (utility pura)
  - 172 test per sanitizzazione server-side endpoint (12 payload XSS × 7 sezioni)
  - Copertura: userList, userInfo, roleList, getCustomRoles, getHardcodedRoles, getMenuSections
  - Test idempotenza, double-encoding, scenari combinati completamente malevoli

---

## Fase 4 — Sicurezza: Open Redirect

- [x] **4.1 — Validazione `referrerTo` in login (client-side)**
  - `login.ejs`: JS client ora valida che `referrerTo` da query param sia un path interno (`/...`, no `//`, no `/\`)
  - Se non valido, mantiene il valore server-side dal Referer header

- [x] **4.2 — Validazione `referrerTo` in logout (template fix)**
  - `logout.ejs`: cambiato `<%- referrerTo %>` → `<%= referrerTo %>` (escape HTML del Referer header)

- [x] **4.3 — Validazione `referrerTo` lato server** (`plugins/adminUsers/main.js`)
  - Creata funzione `getSafeRedirectUrl(url)`:
    - Accetta solo path interni (iniziano con `/`, non con `//` o `/\`)
    - Rifiuta URL esterni (https://, http://, javascript:, data:, ftp:, ecc.)
    - Fallback a `/` se non valido
  - Applicata a: login success redirect, login error redirect (con `encodeURIComponent`), logout redirect
  - `login.ejs` e `logout.ejs`: fix XSS secondario — `<%- referrerTo %>` → `<%= referrerTo %>`

- [x] **4.4 — Test unitari Open Redirect** — 35 test
  - Path interni validi (8 test), URL esterni bloccati (10 test), edge cases (8 test)
  - Whitespace trimming (4 test), bypass attempts (5 test)

---

## Fase 5 — Accessibilità e qualità HTML

- [x] **5.1 — Attributo `lang` dinamico nel tema pubblico**
  - `themes/default/views/head.ejs`: `<html lang="en">` → `<html lang="<%= (passData.ctx.state && passData.ctx.state.lang) || 'en' %>">`
  - Usa `ctx.state.lang` impostato dal plugin `simpleI18n`

- [x] **5.2 — Attributo `lang` dinamico nel tema admin**
  - `themes/defaultAdminTheme/views/head.ejs`: `<html lang="it">` → stessa logica del 5.1

- [x] **5.3 — Rimuovere contenuto placeholder** (`userDelete.ejs`)
  - Sostituito `<h1>pagina di admin ed adessio vediamo come fare</h1>` con pagina "non ancora disponibile"
  - Rimossi anche hidden span pattern e usato `<%= %>` per escape

- [x] **5.4 — Passaggio config via variabili JS inline invece di `<span display:none>`**
  - Convertiti tutti i `<span id="apiPrefix" style="display:none">` + `getElementById` → `const apiPrefix = '<%= %>'`
  - 20 file EJS modificati + 1 file JS (`editor.js`)
  - Incluse anche variabili aggiuntive: `themeNameParam`, `currentFile`
  - Usato `<%= %>` (escaped) per prevenire XSS

- [x] **5.5 — Struttura semantica HTML nei form di visualizzazione**
  - `userView.ejs`: sostituiti `<label for>` + `<p>` → `<dl>/<dt>/<dd>` (definition list)
  - Corretto anche `<%- passData.adminPrefix %>` → `<%= passData.adminPrefix %>`

---

## Fase 6 — Qualità codice e consistenza

- [x] **6.1 — Rimuovere codice commentato** (`index.ejs`)
  - Rimosso blocco HTML commentato (form creazione utente, ~30 righe) e blocco JS commentato (~75 righe)
  - Corretto anche `<%- passData.adminPrefix %>` → `<%= passData.adminPrefix %>` nel link attivo

- [x] **6.2 — Standardizzare il passaggio di configurazione ai template**
  - Già risolto nella Fase 5 (task 5.4): tutti i file ora usano `const x = '<%= passData.x %>';`
  - Pattern unico adottato in 20 file EJS

- [x] **6.3 — Rimuovere stili inline** (`logout.ejs`)
  - `style="min-height: 100vh;"` → classe Bootstrap `vh-100`
  - `style="width: 100%;"` → classe Bootstrap `w-100`
  - `style="max-width: 400px;"` mantenuto (nessuna utility Bootstrap equivalente)

- [x] **6.4 — Rimuovere codice commentato con operatore errato** (`pluginSys.js`)
  - Rimosso intero blocco commentato (12 righe) con `=!` sbagliato
  - Il codice era obsoleto e sostituito da logica funzionante
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
| 1 — Bug critici core | ✅ Completata | `be267ad`, `9764254`, `f38df31` |
| 2 — Pulizia dipendenze | ✅ Completata | `b7541d5`, `30c8a73` |
| 3 — XSS template | ⬜ Da iniziare | |
| 4 — Open redirect | ⬜ Da iniziare | |
| 5 — Accessibilita | ⬜ Da iniziare | |
| 6 — Qualita codice | ⬜ Da iniziare | |
| 7 — Robustezza plugin sys | ⬜ Da iniziare | |
| 8 — Test mancanti | ⬜ Da iniziare | |
| 9 — Documentazione | ⬜ Da iniziare | |
