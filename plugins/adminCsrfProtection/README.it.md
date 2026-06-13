<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# adminCsrfProtection

GUI **admin gemella** del servizio [`csrfProtection`](../csrfProtection/README.it.md): aggiunge la sezione admin `csrfManagement` per monitorare i blocchi CSRF, testare la policy e modificare le impostazioni. Tutte le route richiedono i ruoli root/admin `[0, 1]`. Segue le convenzioni *Twin Admin Plugin* e *The Three Views* (vedi CLAUDE.md).

> 📖 Deep-dive (come comunica col servizio, propagazione hot vs riavvio, note implementative): vedi [`EXPLAIN.it.md`](./EXPLAIN.it.md).

Gira nello **stesso processo** di `csrfProtection`: tira dati/azioni live via oggetto condiviso (`pluginSys.getSharedObject('csrfProtection')`) e risolve la cartella del servizio per il file di config via `pluginSys.getPlugin('csrfProtection').pathPluginFolder`. Se il servizio è presente ma disabilitato (`custom.enabled=false`), la GUI mostra un banner "disattivato".

## Le due viste (una sezione, due pagine)

| Pagina | Vista | Contenuto |
|--------|-------|-----------|
| `index.ejs` | **A — Dati** | KPI (origin-check, blocchi totali, blocchi per motivo, esenzioni) + tabella **blocchi CSRF recenti** + **CSRF tester** (simula una richiesta); auto-refresh |
| `settings.ejs` | **B — Editor JSON5** | `pluginConfig.json5 → custom` (Valida / Salva / Salva e riavvia) + riferimento campi |

Il **CSRF tester** (`simulate`) permette di inserire metodo + path + Origin della richiesta + token-presente e vedere il verdetto esatto (`allowed` / `blocked` + motivo) — istruttivo per capire esenzioni e layer Origin.

## API (route, ruoli `[0, 1]`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET` | `/api/adminCsrfProtection/status` | `{ enabled, stats }` |
| `GET` | `/api/adminCsrfProtection/recent` | Blocchi recenti (query `limit`) |
| `POST` | `/api/adminCsrfProtection/simulate` | CSRF tester → verdetto |
| `GET` / `POST` | `/api/adminCsrfProtection/config` | Carica / salva il blocco `custom` (salva: valida → backup → `editJson5('custom')` → `reloadConfig`) |
| `POST` | `/api/adminCsrfProtection/validate-config` | Valida la config senza salvare |
| `POST` | `/api/adminCsrfProtection/restart` | `pluginSys.requestRestart` (per abilitare il plugin da spento) |

## Configurazione (`pluginConfig.json5` → `custom`)

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `auditLimit` | `100` | Eventi audit mostrati nella Vista Dati |
| `autoRefreshSeconds` | `5` | Intervallo auto-refresh della dashboard |
| `maxBackupsPerFile` | `10` | Backup mantenuti per file di config modificato |

Dipendenze: `csrfProtection ^1.0.0`, `bootstrap ^1.0.0`, `simpleI18n ^1.0.0`; nodeModule: `json5`.

## File

| File | Scopo |
|------|-------|
| `main.js` | Route (status/recent/simulate/config/validate-config/restart), accesso al servizio via shared object |
| `lib/configFileManager.js` | Scrittura atomica + backup a rotazione |
| `adminWebSections/csrfManagement/index.ejs` | Vista Dati + CSRF tester |
| `adminWebSections/csrfManagement/settings.ejs` | Editor JSON5 + JS/CSS |
