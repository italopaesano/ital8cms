# adminRateLimiter

Plugin **admin gemello** del servizio [`rateLimiter`](../rateLimiter/README.md):
fornisce la GUI nel pannello admin per monitorarlo, agire sui blocchi e
configurarlo. Segue le convenzioni *Twin Admin Plugin* e *The Three Views*
(vedi `CLAUDE.md`).

> 📖 Questo README è la guida d'uso. Per il deep-dive tecnico (propagazione
> hot-reload vs riavvio, sicurezza, interni) vedi [`EXPLAIN.md`](./EXPLAIN.md).

Sezione admin: **`rateLimiterManagement`** → `/admin/rateLimiterManagement/` (ruoli root/admin `[0,1]`).

---

## Le tre viste

| Pagina | Vista | Contenuto |
|--------|-------|-----------|
| `index.ejs` | **A — Dati** | KPI (enforcement, blocchi short/long, regole), tabella blocchi attivi (con **Sblocca**), **ban manuale**, audit log; auto-refresh |
| `rules.ejs` | **B — Editor JSON5** | Editor grezzo di `protectedRoutes.json5` (Valida / Salva) + riferimento campi |
| `settings.ejs` | **B — Editor JSON5** | Editor del blocco `custom` di `pluginConfig.json5` (Valida / Salva / **Salva e riavvia**) + riferimento campi |

Tutto passa per l'**oggetto condiviso** di `rateLimiter` (stesso processo). Se il
servizio è disattivato (`custom.enabled=false`), la GUI mostra un banner e
disabilita le azioni.

---

## API (route, ruoli `[0,1]`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET`  | `/api/adminRateLimiter/status` | `{ enabled, stats, activeBlocks, ruleNames }` |
| `GET`  | `/api/adminRateLimiter/attempts` | Coda audit (`limit`, filtri `clientId/ruleName/event`) |
| `POST` | `/api/adminRateLimiter/unblock` | `{clientId, ruleName}` → sblocca |
| `POST` | `/api/adminRateLimiter/ban` | `{clientId, ruleName, seconds, tier?}` → ban manuale |
| `GET`  | `/api/adminRateLimiter/rules` | Contenuto grezzo di `protectedRoutes.json5` |
| `POST` | `/api/adminRateLimiter/validate-rules` | Valida senza salvare |
| `POST` | `/api/adminRateLimiter/rules` | Salva (valida → backup → scrittura atomica → `reloadRules`) |
| `GET`  | `/api/adminRateLimiter/config` | Blocco `custom` serializzato |
| `POST` | `/api/adminRateLimiter/validate-config` | Valida senza salvare |
| `POST` | `/api/adminRateLimiter/config` | Salva (valida → backup → `editJson5('custom')` → `reloadConfig`) |
| `POST` | `/api/adminRateLimiter/restart` | `pluginSys.requestRestart` (i blocchi persistono) |

---

## Propagazione delle modifiche

- **Azioni live** (sblocca/ban): effetto immediato sull'engine in memoria.
- **Regole** (`protectedRoutes.json5`): salvataggio + `reloadRules()` → **a caldo**.
- **Impostazioni** (`defaults`, `enforcement`): salvataggio + `reloadConfig()` → **a caldo**.
- **Parametri infrastrutturali** (`trustProxy`, `state.flushIntervalSeconds`, `log.*`,
  `sweepIntervalSeconds`): creati al boot → richiedono **riavvio** ("Salva e riavvia").
  Sicuro perché i blocchi attivi sopravvivono al restart (stateStore di `rateLimiter`).

---

## Configurazione (`pluginConfig.json5` → `custom`)

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `auditLimit` | `100` | Numero di eventi audit mostrati nella Vista Dati |
| `autoRefreshSeconds` | `5` | Intervallo auto-refresh della dashboard |
| `maxBackupsPerFile` | `10` | Backup mantenuti per file di config modificato |

Dipendenze: `rateLimiter ^1.0.0`, `bootstrap ^1.0.0`, `simpleI18n ^1.0.0`; nodeModule: `json5`.

---

## File

| File | Scopo |
|------|-------|
| `main.js` | Route (status/attempts/unblock/ban/rules/config/restart), accesso al servizio via shared object |
| `lib/configFileManager.js` | Lettura/scrittura atomica + backup a rotazione |
| `adminWebSections/rateLimiterManagement/index.ejs` | Vista Dati (dashboard) |
| `…/rules.ejs` + `rules-editor.js` | Editor JSON5 delle regole |
| `…/settings.ejs` + `settings-editor.js` | Editor JSON5 delle impostazioni |
| `…/rateLimiter-admin.js` + `.css` | Logica/stili della dashboard |
| `tests/unit/` | Test (route + file manager) |
