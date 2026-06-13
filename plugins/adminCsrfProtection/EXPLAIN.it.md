<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# adminCsrfProtection — Deep-dive tecnico

> Guida d'uso: vedi [`README.it.md`](./README.it.md). Servizio gestito: vedi [`../csrfProtection/EXPLAIN.it.md`](../csrfProtection/EXPLAIN.it.md).

## Cos'è

Plugin **admin gemello** di `csrfProtection` (convenzione *Twin Admin Plugin*: `admin<Service>`). Il servizio resta "lean" (logica + oggetto condiviso + config `.json5`); questo plugin possiede **solo la GUI**. Implementa le *Tre Viste* nella variante a due pagine: Dati (dashboard + tester) ed Editor JSON5 delle impostazioni.

## Come comunica col servizio

`adminCsrfProtection` e `csrfProtection` girano nello **stesso processo**, quindi:
- **Dati e azioni live** → oggetto condiviso, tirato on-demand: `pluginSys.getSharedObject('csrfProtection')`. Se `null` (servizio `custom.enabled=false`), la GUI mostra il banner "disattivato".
- **File di configurazione** → il path della cartella del servizio è risolto via `pluginSys.getPlugin('csrfProtection').pathPluginFolder`; da lì si legge/scrive `pluginConfig.json5`.

## Propagazione delle modifiche (hot vs riavvio)

- **Dati live** (stats/recent/simulate) leggono lo stato in memoria del servizio → immediato.
- **Impostazioni**: salvataggio + `reloadConfig()` → **a caldo** per la policy (metodi, originCheck, exemptPaths, failureStatus, …).
- L'unico caso che richiede **riavvio** è **abilitare il plugin da un boot disattivato** (middleware + head hook sono registrati una sola volta al boot) → usare **"Salva e riavvia"** (`pluginSys.requestRestart`).

## Note di implementazione

- Il salvataggio impostazioni usa **`core/editJson5`** per sostituire solo il blocco `custom` (preservando `active`/`dependency`/commenti). Scrittura **atomica** + backup a rotazione (`lib/configFileManager.js`, `maxBackupsPerFile`).
- Le POST fetch delle pagine admin (validate/save/simulate) sono a loro volta protette da CSRF: l'**interceptor** iniettato da `csrfProtection` aggiunge `X-CSRF-Token` in automatico (le pagine admin portano il `<meta>`), quindi il JS client non deve gestire il token.

## Test

I test sono in `tests/`: route + file manager, con mock dell'oggetto condiviso e sandbox tmpdir per le scritture (mai la cartella reale del plugin/servizio).
