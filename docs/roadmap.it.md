<!-- ital8doc v1-1 · tipo: reference · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `roadmap.md` is a stub until release.
# Roadmap — ital8cms

Miglioramenti e lavori pianificati, raccolti dall'analisi del codebase. Non è un impegno di rilascio, ma una lista di direzioni.

## Documentazione (ital8doc)

- Riscrivere secondo lo standard ital8doc, usando come spunto gli archivi in `docs/archive/`:
  - sistema di logging (da `logging-system.it.md`)
  - diagramma di flusso del sistema plugin (da `plugin-system-flowchart.it.md`)
  - documentazione API (da `api-documentation.it.md`)
  - test suite → guida `docs/testing` (da `test-suite.it.md`)
  - coding style → CLAUDE.md (da `coding-style.it.md`)
- Migrare i `core/**` EXPLAIN allo schema bilingue ital8doc (oggi sono file unici in italiano, non suffissati: `EXPLAIN-pluginsSys.md`, `EXPLAIN-themeSys.md`, `EXPLAIN-pluginPages.md`, `core/admin/EXPLAIN.md`).
- Riempire gli stub `.md` inglesi alla prima pubblicazione importante.

## Miglioramenti pianificati

1. **TypeScript:** migrazione a TypeScript per la type safety.
2. **Variabili d'ambiente:** usare un file `.env` per la configurazione.
3. **Migrazioni del database:** sistema di migrazioni per i cambi di schema.
4. **Documentazione API:** aggiungere documentazione Swagger/OpenAPI.
5. **Gestione degli errori:** middleware centralizzato di error handling.
6. **Logging:** logging strutturato (Winston, Bunyan).
7. **Validazione:** libreria di validazione delle richieste (Joi, Yup).
8. **Build frontend:** bundling degli asset (webpack, esbuild).
9. **Internazionalizzazione:** supporto i18n per più lingue.
10. **Plugin Cleanup on Shutdown:** Il graceful shutdown attuale (`index.js`) chiude solo i server HTTP/HTTPS. In futuro valutare l'aggiunta di una fase di cleanup dei plugin prima della chiusura dei server (flush dati su disco, chiusura connessioni DB, rilascio risorse, ecc.). Attualmente ogni plugin gestisce il proprio cleanup in modo indipendente (es. `urlRedirect/hitCounter.js` ha i propri handler `SIGINT`/`SIGTERM`), ma un sistema centralizzato coordinato da `pluginSys` sarebbe più robusto e garantirebbe un ordine di chiusura corretto.
11. **Migrazione completa test plugin-specifici:** I test specifici dei plugin attualmente in `/tests/unit/{pluginName}/` (es. `bootstrapNavbar`, `urlRedirect`, `adminBootstrapNavbar`) dovrebbero essere migrati nelle rispettive cartelle `plugins/{pluginName}/tests/` secondo la convenzione "Testing Conventions for Plugins and Themes". In Fase 1 è stato migrato solo `bootstrapNavbar` come esempio di riferimento — gli altri vanno portati sulla stessa convenzione per completezza.
12. **Supporto E2E/Playwright per plugin e temi:** Attualmente solo unit e integration test dei plugin/temi sono scoperti automaticamente via `plugins/*/tests/` e `themes/*/tests/`. In futuro estendere la convenzione per includere test E2E con orchestrazione del server (setup/teardown automatico, fixtures condivise, helper per login programmatico, ecc.).
13. **Soglia minima di coverage con enforcement:** Aggiungere in `jest.config.js` una soglia minima di code coverage (es. 70% su branches, statements, functions, lines) con fail della CI se non raggiunta. Deve essere calcolata in modo aggregato (core + tutti i plugin attivi + tutti i temi).
14. **Scanner prescrittivo al boot (Fase 2 del testing):** Aggiungere in `pluginSys` uno scanner che al boot del server verifica per ogni plugin attivo la presenza dei test minimi richiesti: (a) un test per ogni metodo esportato da `main.js`, (b) un test per ogni rotta dichiarata in `getRouteArray()` incluso il campo `access`, (c) validazione dei file JSON5 di configurazione, (d) lifecycle hooks (`loadPlugin`, `installPlugin`, ecc.). Comportamento default: warning a console. Flag `testingStrictMode: true` in `ital8Config.json5` per promuovere i warning a fatal error. Lo stesso vale per i temi (presenza partial richiesti, schema `themeConfig.json5`, ecc.).
15. **Safety net filesystem nei test:** Aggiungere in `tests/setup.js` un hook `afterEach`/`afterAll` che verifichi che nessun test abbia creato/modificato file all'interno di `plugins/*/` o `themes/*/` reali (solo la `/core/testHelpers/pluginSandbox.js` dovrebbe essere usata per scritture). In Fase 1 è solo una convenzione documentata; in futuro diventare warning automatico e poi fatal error con `testingStrictMode: true`.
16. **Aggiornamenti dipendenze rinviati (da 2026-05-19):** Durante il bulk upgrade del 2026-05-19 sono stati intenzionalmente saltati 3 aggiornamenti che richiedono una review dedicata:
    - **`ccxt` 4.5.22 → 4.5.54** (e successive): plugin `ccxt` da rivedere a parte. Verificare se è ancora attivo/usato e se la superficie API esposta è cambiata tra le minor; testare le rotte del plugin prima del bump.
    - **`inquirer` 8.2.7 → 13.x**: dalla v9 in poi è **ESM-only** e ha API rinominata (`inquirer.prompt` → import named di `@inquirer/prompts`). Richiede rewrite di `scripts/init.js`, `scripts/lib/configWizard.js`, `scripts/lib/pluginInitRunner.js`. Le CVE di lodash transitivo sono già state chiuse via `npm audit fix`, quindi non c'è urgenza di sicurezza.
    - **`better-sqlite3`** (plugin `dbApi`, attualmente disattivo con `active: 0`): non installato nel root `package.json` e plugin non attivo. Quando si riattiverà `dbApi`, valutare la versione corrente di `better-sqlite3` (range plugin: `^9.2.2`, latest è 12.x con ABI changes) e fare un install + test mirato.
17. **Modello di sicurezza completo per il clone Git (temi e plugin) — da approfondire:** L'installazione di temi/plugin da repository Git (`plugins/admin/themesInstall.js`, `plugins/admin/pluginsInstall.js`) supporta tre formati di URL: HTTPS pubblico, HTTPS con credenziali inline e SSH. Il clone via SSH usa la **chiave SSH del server** (`~/.ssh/` dell'utente che esegue il processo Node), quindi eredita l'identità della macchina. Per evitare un **confused deputy** (un admin role 1 che fa clonare al server repo privati a cui solo la chiave del server ha accesso) la prima mitigazione implementata è: **gli URL SSH sono riservati al ruolo root (role 0)**, mentre HTTPS resta `[0, 1]` (chi ha credenziali le porta inline, nessuna escalation). Questa è una **soluzione minima e volutamente parziale**: l'intera questione va affrontata con più calma. Aspetti da valutare in una review dedicata:
    - **Audit log** di ogni clone (utente, URL, protocollo, esito, timestamp) su file dedicato, oggi assente.
    - **Scenari multi-tenant** (un'installazione ital8cms gestita per più clienti): la restrizione a role 0 potrebbe non bastare se più clienti condividono lo stesso utente di sistema/chiave SSH.
    - **Flag di configurazione** opzionale (es. `themesInstall.allowSshClone`, `pluginsInstall.allowSshClone` in `ital8Config.json5`) per disabilitare completamente SSH a livello di sistema, indipendentemente dal ruolo.
    - **Host whitelist** opzionale (es. solo `github.com`/`gitlab.com`) per limitare verso quali host la chiave del server può essere usata.
    - **Affidabilità headless dell'SSH**: oggi il clone eredita `process.env` (incluso `SSH_AUTH_SOCK`); valutare `GIT_SSH_COMMAND` con `BatchMode=yes`/`StrictHostKeyChecking` per messaggi d'errore deterministici quando la chiave manca, ha passphrase senza agent, o l'host non è in `known_hosts`.
    - **Supporto PAT/token gestiti** come alternativa più granulare alla chiave del server (credenziali per-installazione invece dell'identità della macchina).
