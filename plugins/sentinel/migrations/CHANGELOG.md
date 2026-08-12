# Changelog delle migrazioni di `sentinel`

Storico degli step dichiarati in [`migrations.json5`](./migrations.json5), dal
più recente.

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto.

---

## v2 → v3 — regola sulla coerenza di sessione

**Aggiunge** `session-hijack-signal` a `sentinelRules.json5`, dopo
`canary-token-used`.

Serve perché `rules` è un array e il merge additivo del boot non tocca gli array:
senza lo step, le anomalie di sessione verrebbero calcolate a ogni richiesta
autenticata e buttate via, perché nessuna regola le guarderebbe.

Il blocco `custom.sessionCoherence` del descrittore **non** ha bisogno di script:
è un'aggiunta di chiavi dentro un oggetto, e il merge la copre.

→ [`from-v2-to-v3.md`](./from-v2-to-v3.md)

## v1 → v2 — regola del token esca

**Aggiunge** `canary-token-used` a `sentinelRules.json5`, subito dopo la
whitelist.

Stessa ragione: `rules` è un array. La posizione conta — accodata, la regola
sarebbe arrivata dopo `backup-probe`, che matcha `.tar.gz`, e uno dei decoy
distribuiti consegna il token proprio dentro un finto `backup-….tar.gz`.

Dichiarato **retroattivamente**: la regola era stata distribuita nel `.default`
un intervento prima, senza accorgersi che gli array non vengono propagati. Le
installazioni nuove l'avevano, quelle esistenti no.

→ [`from-v1-to-v2.md`](./from-v1-to-v2.md)
