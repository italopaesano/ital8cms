# Changelog delle migrazioni di `sentinel`

Storico degli step dichiarati in [`migrations.json5`](./migrations.json5), dal
più recente.

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto.

---

## v5 → v6 — `shell-probe` richiede un'estensione eseguibile

**Con script** (`from-v5-to-v6.js`), automatico e idempotente. È il primo step
che **modifica** una regola invece di aggiungerne una.

Il pattern si fermava al punto e intercettava nomi di file ordinari —
`/js/shell.js`, `/assets/cmd.css`. Il problema non è il rumore: è che il percorso
di promozione documentato (*«promuovi se `authenticatedHits` è zero»*) non può
cogliere un falso positivo su traffico anonimo, quindi la regola sembrava la più
sicura da promuovere proprio mentre non lo era.

⚠ Se il pattern in vigore **non è esattamente quello distribuito**, lo script non
tocca niente e scrive un avviso: un pattern personalizzato è una scelta
dell'amministratore.

→ [`from-v5-to-v6.md`](./from-v5-to-v6.md)

## v4 → v5 — reputazione locale delle impronte

**Nessuno script:** `custom.reputation` e `custom.census.ipRetentionDays` sono
chiavi dentro oggetti, coperte dal merge additivo del boot. Le regole di esempio
aggiunte al file distribuito sono commentate, quindi `rules` non cambia.

Dichiarato **retroattivamente** nel consolidamento C5, insieme allo step
precedente: vedi lì il perché.

⚠ `protectBrowserFingerprints` arriva a `true` ed è il default giusto; il merge
non sovrascrive un valore già presente, quindi chi l'avesse a `false` resta a
`false`.

→ [`from-v4-to-v5.md`](./from-v4-to-v5.md)

## v3 → v4 — tetti di drop e tarpit

**Nessuno script:** `custom.tarpit` è un blocco di chiavi nuove dentro un
oggetto, coperto dal merge additivo del boot. Le 43 righe aggiunte al file delle
regole sono tutte commenti (gli esempi di `drop` e `tarpit` restano commentati per
scelta), quindi `rules` non cambia.

Dichiarato **retroattivamente** nel consolidamento C5. I passi 7 e 8 avevano
bumpato la `schemaVersion` del descrittore senza dichiarare nulla, convinti — a
ragione — che il merge bastasse. Ma il runner non guarda se serva uno script:
guarda se la catena **copre il salto**. Con il descrittore a v5 e gli step fermi a
v3, ogni installazione riceveva un box `[MIGRATE]` di errore a ogni avvio che
nulla poteva chiudere, e `migrate sentinel` si rifiutava di girare **inclusi i due
step veri**. Una catena bucata non ferma solo sé stessa.

→ [`from-v3-to-v4.md`](./from-v3-to-v4.md)

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
