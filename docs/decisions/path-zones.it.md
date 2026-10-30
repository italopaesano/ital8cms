<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione: zone dello spazio URL, segnaposti di percorso e `baseline` per zona

> **Stato: DESIGN APPROVATO** — strada B e **naming completo** approvati il
> 2026-10-30. **Fase 0 chiusa, Fase 1 sbloccata.** Implementazione **non
> ancora iniziata**. Chiude alla radice [`REVIEW.md` → A1](../../REVIEW.md#a1--cambiare-adminprefix-apre-il-pannello-admin-a-chiunque)
> e, come effetto collaterale, [A3](../../REVIEW.md#a3--le-regole-hardcoded-del-controllo-accessi-non-sono-immutabili).

## Contesto

### Il difetto che ha aperto la discussione (A1)

La protezione del pannello di amministrazione è scritta come **testo letterale**
in `plugins/adminAccessControl/accessControl.default.json5`:

```json5
"hardcodedRules": {
  "/admin":    { "requiresAuth": true, "allowedRoles": [0, 1], "priority": 1000, "editable": false },
  "/admin/**": { "requiresAuth": true, "allowedRoles": [0, 1], "priority": 100,  "editable": false }
}
```

Ma la posizione reale del pannello è una **variabile**: `ital8Config.json5 →
adminPrefix`, dichiarata configurabile, modificabile dal wizard
(`scripts/lib/configWizard.js:236`) e dalla GUI System Settings. `index.js:562`
monta il file server admin su `${globalPrefix}/${adminPrefix}`.

**Nessun codice sincronizza le due cose.** Verificato: `adminPrefix` non compare
in **nessun** `.js` del plugin `adminAccessControl`. Cambiare il prefisso in
`backoffice` sposta le pagine su `/backoffice/...`, dove nessuna regola matcha —
e allora si applica la `defaultPolicy`, che di serie è:

```json5
"defaultPolicy": { "action": "allow", "redirectOnDenied": "/pluginPages/adminUsers/login.ejs" }
```

Cioè **accesso pubblico**. Verificato eseguendo il matcher reale del progetto:

```
/admin/index.ejs                      → { pattern: "/admin/**", requiresAuth: true, … }
/backoffice/index.ejs                 → null   ← nessuna regola
/backoffice/usersManagment/index.ejs  → null   ← nessuna regola
```

Tre fattori aggravanti, tutti verificati:

1. **Le pagine admin non hanno una guardia propria.** Nessun `.ejs` sotto
   `core/admin/webPages/` fa un controllo di autenticazione lato server; i due
   che leggono `session.user.roleIds` lo fanno per nascondere pulsanti.
2. **`dirListing` è acceso** sul file server admin (`index.js:563`,
   `dirListing: { enabled: true }` — è l'unico dei cinque): l'albero del
   pannello è navigabile senza indovinare i nomi delle sezioni.
3. **`adminPrefix` è pensato come sicurezza per oscurità** (`index.js:459`
   porta un commento esplicito in maiuscolo). Chi lo cambia lo fa *credendo di
   aumentare la sicurezza* e ottiene l'esatto contrario: **la mossa difensiva è
   quella che apre la porta.**

Perimetro del danno: le rotte API restano protette dal route-wrap, quindi un
anonimo non esegue azioni. Il danno è **divulgazione** — struttura del pannello,
sezioni installate, plugin presenti, endpoint, markup di ogni pagina di gestione.

### Non è un difetto isolato, è una classe

Lo spazio URL di ital8cms è governato da **sette prefissi configurabili** —
`globalPrefix`, `apiPrefix`, `adminPrefix`, `pluginPagesPrefix`, `viewsPrefix`,
`publicThemeResourcesPrefix`, `adminThemeResourcesPrefix` — più "tutto il resto"
(il sito, `wwwPath`). Di questi **solo `globalPrefix` è gestito**: `accessManager`
lo rimuove dal path prima del match (`lib/accessManager.js:196-200`), con un
commento che spiega perfettamente il perché — *«i pattern in `accessControl.json5`
sono logici (senza prefix)»*. L'equivalente per gli altri sei non è mai stato
scritto.

Censimento dei letterali di prefisso (`/admin`, `/api`, `/pluginPages`, `/views`)
scritti a mano nei file di configurazione che contengono pattern di URL:

| File | Occorrenze |
|---|---|
| `plugins/adminAccessControl/accessControl.default.json5` | 11 |
| `plugins/sentinel/sentinelRules.default.json5` | 6 |
| `plugins/seo/seoPages.default.json5` | 2 |
| `plugins/rateLimiter/protectedRoutes.default.json5` | 1 |
| **totale** | **20** |

E i consumatori di `core/patternMatcher.js` sono **otto**: `adminAccessControl`,
`seo`, `adminSeo`, `sentinel`, `rateLimiter`, `csrfProtection`, `urlRedirect`,
più `core/botDetector.js`. Ognuno può oggi scrivere `/admin` in un file e
trovarsi disallineato.

### La seconda dimensione: non solo il prefisso, anche la *forma*

`hideExtension` cambia la forma dell'URL servito: la stessa pagina risponde a
`/login.ejs` **o** a `/login` a seconda della configurazione, **per contesto**
(`wwwPath`, `pluginPagesPrefix`, `adminPrefix`, ciascuno con la propria `ext`).

Il progetto ci ha già sbattuto contro e ha tamponato **duplicando a mano ogni
regola**, con il motivo scritto nel `.default`:

```json5
// PERCHE' OGNI PAGINA HA DUE REGOLE: con `hideExtension.pluginPagesPrefix`
// attivo l'URL servito e senza estensione (`.../login`), e una regola su
// `login.ejs` non lo intercetterebbe.
"/pluginPages/adminUsers/userProfile.ejs": { "requiresAuth": true, … },
"/pluginPages/adminUsers/userProfile":     { "requiresAuth": true, … },
```

È **la stessa malattia di A1** — una regola di sicurezza scritta come letterale
contro uno spazio URL che il core può riconfigurare — con il sintomo curato e la
causa intatta.

### I due problemi distinti sotto A1

| | Natura | Cura |
|---|---|---|
| **P1** | un'**invariante di sicurezza** vive in un file mutabile | toglierla dal file |
| **P2** | le regole **scritte dall'utente** devono poter nominare i prefissi configurabili | segnaposti risolti dal CMS |

Non sono alternative in concorrenza: sono due metà. Rendere la regola *più
esprimibile* (P2) non impedisce a nessuno di **cancellarla** (P1).

### Fatto decisivo sul perimetro di enforcement

Verificato sull'ordine reale di montaggio:

```
index.js:147  priorityMiddlewares  → bodyParser · session · router
index.js:350  middleware dei plugin (incl. adminAccessControl, weight -5)
index.js:407…563  static server (www · pluginPages · risorse tema · admin)
```

e `pluginSys.#wrapHandlerWithAccessCheck` ritorna `async (ctx) => { … }`,
**senza `next`**. Conseguenza: **una rotta API che matcha termina la catena nel
router e non arriva mai ad `accessControl`.** Da questo middleware passa solo ciò
che il router non intercetta — pagine `/www`, pluginPages, risorse tema, pagine
admin, e i path `/api/*` inesistenti.

È il fatto che rende praticabile il `baseline` chiuso: chiudere per default **non**
spegne il login POST né il CSS servito via `/api/bootstrap/...`.

## Decisione

Si adotta la **strada B** (« costruire il muro ») invece della strada A
(« riparare il foglietto »): lo spazio URL diventa un **oggetto interrogabile**,
diviso in zone, e ogni zona porta il proprio **minimo d'accesso** (`baseline`)
**in codice**.

### D1 — La mappa delle zone

Una sola struttura nel core descrive la partizione dello spazio URL. Ogni zona
porta **quattro attributi** che oggi vivono in quattro posti diversi:

| Zona | Prefisso concreto da | Estensione da | `baseline` (minimo di zona) |
|---|---|---|---|
| `admin` | `adminPrefix` | `hideExtension.adminPrefix` | **chiusa** — ruoli `[0, 1]` |
| `adminThemeResources` | `adminThemeResourcesPrefix` | — | **chiusa** — ruoli `[0, 1]` |
| `views` | `viewsPrefix` | — | **chiusa** — ruoli `[0, 1]` |
| `api` | `apiPrefix` | — | **delegata** al route-wrap di `pluginSys` |
| `pluginPages` | `pluginPagesPrefix` | `hideExtension.pluginPagesPrefix` | aperta |
| `publicThemeResources` | `publicThemeResourcesPrefix` | — | aperta |
| `site` *(zona di default: tutto il resto)* | `wwwPath` | `hideExtension.wwwPath` | aperta — **configurabile** |

`globalPrefix` non è una zona: è il prefisso di deploy che precede tutte le zone,
e continua a essere rimosso prima del match come già avviene oggi.

**Il `baseline` di ogni zona sta in codice, non in un file.** È questo il punto dell'intera
decisione: la protezione del pannello non è più cancellabile, perché non c'è più
niente da cancellare. Prova del nove — con `accessControl.json5` cancellato,
svuotato o corrotto:

| | Pannello admin |
|---|---|
| oggi | aperto a tutti |
| strada A (regole iniettate in codice) | aperto — il motore non ha nulla da cui partire |
| **strada B (`baseline` di zona)** | **resta chiuso** |

### D2 — Segnaposti di percorso: vocabolario chiuso, sintassi `{{…}}`

I pattern nei file di configurazione possono nominare una zona invece del suo
prefisso concreto:

```json5
"{{admin}}/**":                                  { "requiresAuth": true, "allowedRoles": [0, 1] },
"{{pluginPages}}/adminUsers/userProfile.ejs":    { "requiresAuth": true, "allowedRoles": []     },
```

- **Vocabolario chiuso:** solo i nomi di zona della tabella D1. Nessuna
  espressione, nessun accesso arbitrario a chiavi di configurazione.
- **Nome della zona, non della chiave:** `{{admin}}`, non `{{adminPrefix}}`.
  L'argomento che decide è che lo schema « nome della chiave di config » **non
  copre tutte le zone**: la zona `site` non ha nessun `sitePrefix`. Un solo
  vocabolario di sette nomi omogenei, gli stessi della tabella D1 e della chiave
  `baseline` — vedi *Naming*.
- **Risoluzione al caricamento, non per richiesta.** Vincolo tecnico, non scelta
  di stile: `patternMatcher.getPatternInfo()` classifica il tipo e la priorità
  **dalla stringa grezza** (`regex:` → 500, `**` → 100, …). Risolvere al momento
  del match significherebbe classificare la stringa sbagliata. La risoluzione
  avviene in `loadRules()`, dove la cache delle regole esiste già: costo a
  runtime **zero**.
- **Retrocompatibilità:** i letterali (`/admin/**`) continuano a funzionare.
- **Un segnaposto sconosciuto è un errore, mai un letterale** (vedi D6).
- **Collisione dopo la risoluzione:** le regole sono un oggetto *keyed by
  pattern*, e `accessManager.loadRules()` fa già
  `{ ...customRules, ...hardcodedRules }`. Due pattern diversi che risolvono
  alla stessa stringa oggi si schiaccerebbero **in silenzio**. Va rilevato: se
  le due regole sono identiche → assorbi; se **differiscono** → errore, perché è
  un'ambiguità di sicurezza reale.

### D3 — `baseline` per zona al posto della `defaultPolicy` globale

La `defaultPolicy` odierna risponde a **una** domanda (*«nessuna regola matcha,
che faccio?»*) con **una** risposta valida per tutto lo spazio URL — che contiene
il sito pubblico, il CSS del tema e il pannello di amministrazione. Il difetto
non è che dica `allow`: è che sia **una sola**.

Il minimo d'accesso diventa un attributo **della zona**, espresso dalla chiave
`baseline` (tabella D1). Le regole nei file servono per le **eccezioni**
(« questa pagina del mio sito è per iscritti »), non per tenere in piedi la
protezione del pannello.

Conseguenza voluta: **le `hardcodedRules` diventano ridondanti.** Il `baseline`
della zona `admin` *è* l'invariante. Il blocco può restare nel `.default` come
documentazione leggibile con un commento che dichiari che non è più la fonte di
verità, oppure sparire (vedi *Punti rimandati*).

Il caso d'uso « sito privato » si ottiene senza inventare istruzioni nuove: il
`baseline` della zona `site` è configurabile, e la zona esiste già per
costruzione (è tutto ciò che non ricade in una delle sei zone nominate).

### D4 — Monotonia: le regole possono solo stringere

> **Una regola scritta in un file può solo stringere, mai allentare, il
> `baseline` della sua zona.**

Rendere privata una pagina pubblica: sì. Rendere pubblica una pagina della zona
`admin`: no. Senza questo vincolo il muro avrebbe una porticina, e una regola
scritta male — o una priorità invertita — la aprirebbe, tornando al punto di
partenza.

Effetto collaterale: chiude **A3** (« le regole hardcoded del controllo accessi
non sono immutabili »), oggi difetto aperto a sé.

Non si prevede uno **sfogo** per pagine pubbliche dentro una zona chiusa: oggi
non ne esiste nessuna (il login sta in `pluginPages`, non in `admin`). Aggiungerlo
in futuro è additivo; togliere il vincolo dopo sarebbe un breaking change di
sicurezza.

### D5 — Derivazione delle forme senza estensione (fine della duplicazione)

Si scrive **solo la forma estesa**. Quando `hideExtension` è attivo per la zona di
quel pattern, la forma senza estensione è **derivata al caricamento**:

```
Regola scritta:  "{{pluginPages}}/adminUsers/userProfile.ejs"
                        ↓  se hideExtension.pluginPagesPrefix.enabled
Regole attive:   "/pluginPages/adminUsers/userProfile.ejs"   (scritta)
                 "/pluginPages/adminUsers/userProfile"        (derivata)
```

**Derivare, non sostituire.** La forma estesa resta attiva anche a
`hideExtension` acceso: a valle il file server risponde con un **redirect** verso
la forma corta (comportamento documentato in `CLAUDE.md` → *Hide Extension*; non
verificato per esecuzione, `node_modules` assente nell'ambiente di stesura), e
una forma estesa non protetta regalerebbe a un anonimo un 301 invece di un
rifiuto — non il contenuto, ma la **conferma che la pagina esiste**. È la stessa
fuga che il progetto cura altrove con il 404 uniforme del `reservedGate`.

**È il segnaposto a rendere possibile la derivazione:** `hideExtension` è
per-contesto, quindi per sapere *quale* `ext` consultare serve sapere a quale zona
appartiene il pattern. Con un letterale `/pluginPages/...` lo si dovrebbe
indovinare dal prefisso — cioè proprio la cosa che si rompe quando il prefisso
cambia. D2 e D5 sono progettate insieme per questo.

Dettagli: si espandono **solo** i pattern che terminano con la `ext` della
propria zona (`{{admin}}/**` non si tocca); le derivate sono mostrate dalla GUI
**in sola lettura e marcate come derivate**, altrimenti l'admin le salva e
ricongela il letterale.

### D6 — Invarianti come sonde, dentro il percorso di caricamento

Le invarianti **non** si verificano sulla forma del file (*«esiste una regola con
pattern X?»*): si verificano sull'**effetto** (*«cosa risponderebbe il sistema a
questa richiesta?»*).

| Attore | URL | Verdetto atteso |
|---|---|---|
| anonimo | `{{admin}}/` | **negato** |
| anonimo | `{{admin}}/<qualsiasi>/<file>` | **negato** |
| anonimo | `{{adminThemeResources}}/<file>` | **negato** |
| anonimo | `{{views}}/<file>` | **negato** |
| ruoli `[2]` (editor) | `{{admin}}/` | **negato** |
| ruoli `[1]` (admin) | `{{admin}}/` | consentito |
| ruoli `[0]` (root) | `{{admin}}/` | consentito |
| anonimo | pagina di login | consentito |
| anonimo | `{{publicThemeResources}}/<file>` | consentito |

Perché le sonde e non i controlli sulla forma: esercitano la **vera funzione di
decisione**, quindi catturano anche una `defaultPolicy` sbagliata, una priorità
invertita e una regola custom che scavalca il `baseline` (cioè A3); sopravvivono a
qualunque rifattorizzazione interna; costano zero (funzioni pure, nessun I/O);
**e la stessa tabella diventa la suite di test di regressione**, invece di
scrivere le cose due volte.

**Dove gira il controllo: dentro `loadRules()`, non chiamato da due posti.** Le
vie d'ingresso sono **tre**, non due:

| # | Via | Coperta da |
|---|---|---|
| 1 | boot | `loadRules()` al primo caricamento |
| 2 | salvataggio dalla GUI admin | `loadRules()` sul ruleset candidato |
| 3 | **modifica del file a server acceso + reload** | `loadRules()` alla ricarica |

Mettendo il controllo nel percorso di caricamento tutte e tre sono coperte **per
costruzione**, non per diligenza. Il precedente nel progetto è
`core/sessionSecurity.js`, « fonte unica della logica di rilevamento » condivisa
fra boot e wizard; qui si va un passo oltre, perché il punto unico non è una
funzione da ricordarsi di chiamare ma il percorso stesso.

### D7 — Comportamento al fallimento: asimmetrico

| Momento | Comportamento |
|---|---|
| **boot** | box `[ACCESS]` + `process.exit` — **errore fatale**, con il file da correggere e *come* correggerlo a mano per far ripartire il CMS |
| **runtime** (reload o salvataggio GUI) | **rifiuta** il nuovo ruleset, **tiene quello vecchio in memoria**, messaggio esplicito su cosa è stato rifiutato e perché |

Mai spegnere un sito in produzione per una modifica rifiutata; ma soprattutto
**mai finire con un ruleset più debole di quello che si aveva**. Il box segue la
convenzione dei box esistenti (`[SESSION]`, `[SCHEMA]`, `[WEIGHT]`, `[STORAGE]`,
…): righe prefissate dal tag, causa, e opzioni azionabili con i comandi esatti.

**Buco già coperto, da non perdere di vista:** se `adminAccessControl` non si
carica non c'è né guardia né controllo. Oggi è coperto perché il plugin è in
`essentialPlugins` (`["adminUsers", "adminAccessControl", "admin"]` →
`[FATAL]` + exit). È un'invariante che regge per **configurazione**: basta che
qualcuno tolga il plugin da quella lista. Va presidiata da un test.

### D8 — Documentazione: stanza canonica + presidio anti-deriva

Il vocabolario va documentato in una guida completa **e** spiegato in forma
concisa dentro i file di configurazione che accettano segnaposti. Per evitare che
sei copie di prosa derivino (e che quella sbagliata finisca in un file di
sicurezza): **una stanza canonica corta, identica byte per byte**, col rimando
alla guida — non una spiegazione per file.

```json5
// ── Segnaposti di percorso ──────────────────────────────────────────
// I pattern possono usare {{admin}}, {{pluginPages}}, … al posto del
// prefisso concreto: il CMS lo risolve al caricamento leggendo le zone.
// Un segnaposto sconosciuto è un ERRORE, mai un letterale.
// Elenco completo e regole → docs/decisions/path-zones.it.md
// ────────────────────────────────────────────────────────────────────
```

Con un test che verifica che la stanza sia **presente e identica** in tutti i
file che accettano segnaposti — lo stesso genere di presidio già usato per
`middlewareOrder.test.js` e `routeContract.test.js`. L'elenco **completo** dei
segnaposti non va nella stanza (ogni estensione futura imporrebbe N modifiche):
sta nella guida, ed è stampabile dalla CLI.

## Alternative scartate

| Alternativa | Perché scartata |
|---|---|
| **A — Regole hardcoded iniettate in codice** (opzione (a) della review) | Corregge A1 ma lascia l'invariante in un file: cancellare la sezione riapre il pannello. Risolve P1 solo finché nessuno tocca il file, e non risolve P2 né i 20 letterali degli altri plugin. |
| **Normalizzare il path prima del match** (opzione (b) della review) | Funziona, ma rende il file **bugiardo**: si legge `"/admin/**"` e protegge `/backoffice`. Accettabile come meccanismo interno (è ciò che già si fa per `globalPrefix`), non come modello mentale esposto all'utente. |
| **Variabili arbitrarie — `"ital8Conf.adminPrefix/**"`** | Proposta iniziale del maintainer, scartata per **fail-open**: la stringa non inizia con `/`, quindi se il resolver non gira (typo, versione più vecchia, un consumer che legge il config grezzo — `getRulesForUI()` lo fa già) diventa un letterale che non matcha nulla → nessuna regola → `allow`. Reintrodurrebbe A1 in una forma che *sembra* corretta a chi legge il file. In più accoppia i config utente al nome di una variabile interna di `index.js`. |
| **`defaultPolicy` globale da `allow` a `deny`** | Il timore iniziale (spegnere login e CSS via API) **non** si applica: le rotte API non passano da qui. Resta però a carico dell'utente dichiarare una regola per ogni pagina del proprio sito, più le risorse tema pubbliche, `sitemap.xml`, `robots.txt`, la favicon. E l'istruzione che servirebbe per dire « questo sottoalbero è il sito » riporterebbe `allow` su quel sottoalbero: giro completo per tornare al punto di partenza, con una lista in più da mantenere. Il `baseline` per zona (D3) è la stessa idea **con il granulo giusto**. |
| **Sfogo per pagine pubbliche in zona chiusa** | Nessun caso d'uso attuale. Uno sfogo che non serve a nessuno è il buco di domani; aggiungerlo in futuro è additivo. |

## Naming

**Tutti i nomi sono approvati — la Fase 0 è chiusa e la Fase 1 può partire.**

| Concetto | Nome | Stato |
|---|---|---|
| Sintassi del segnaposto | `{{…}}` | **approvato** (2026-09-15) — segue il precedente `{{canary}}` in `plugins/sentinel/pluginConfig.default.json5` |
| La singola voce del vocabolario | `pathPlaceholder` / « segnaposto di percorso » | **approvato** (2026-09-15) |
| Registro del vocabolario | nessuno: le 7 chiavi `*Prefix` esistenti **sono** il vocabolario | **approvato** (2026-09-15), ampliabile |
| Contenuto del segnaposto | il **nome della zona** — `{{admin}}`, non `{{adminPrefix}}` | **approvato** (2026-10-30) — vedi D2 |
| La mappa dello spazio URL *(concetto)* | `pathZones` | **approvato** (2026-10-30) — alternative valutate: `urlSpace`, `pathMap`, `urlAtlas`, `siteTopology` |
| La mappa *(modulo)* | `core/pathZoneResolver.js` | **approvato** (2026-10-30) — ricalca `pluginStateResolver`, `servingRootResolver`, `ejsIncludeResolver` |
| Le invarianti *(concetto: la tabella delle sonde)* | `accessInvariants` | **approvato** (2026-10-30) — alternative: `protectionProbes`, `accessSelfCheck`, `guardVerifier` |
| Le invarianti *(modulo)* | `core/accessInvariantCheck.js` | **approvato** (2026-10-30) — ricalca `core/storageWritabilityCheck.js`, gate di boot già esistente |
| Tag del box al boot | `[ACCESS]` | **approvato** (2026-10-30) |
| Chiave del **minimo di zona** (la vede l'utente) | `baseline` | **approvato** (2026-10-30) — vedi nota |
| Nome di questo documento | `docs/decisions/path-zones.it.md` | **approvato** (2026-10-30) |

**Concetto e modulo portano nomi distinti**, per coerenza col resto del core: a
parole si dice `pathZones` e `accessInvariants`, i file si chiamano
`pathZoneResolver.js` e `accessInvariantCheck.js`. Entrambi ricalcano un modulo
che esiste già, quindi non introducono una convenzione nuova.

**Perché `baseline` e non `posture`, `defaultAccess` o `policy`.** Sotto D4 quella
chiave **non è un default che le regole scavalcano**: è un **pavimento** che le
regole possono solo alzare. `defaultAccess` inviterebbe al modello mentale
sbagliato (« posso scavalcarlo »); `policy` è vago e collide con la
`defaultPolicy` che sostituisce; `posture` è neutro ma non dice che si tratta di
un minimo. `baseline: "closed"` sulla zona `admin` si legge come « da qui non si
scende », che è esattamente il contratto di D4. *(Riserva nota e accettata: in
inglese `baseline` può anche voler dire « misura di riferimento ».)*

**Perché il nome della zona e non quello della chiave** (`{{admin}}` e non
`{{adminPrefix}}`) — l'argomento che ha deciso: lo schema « nome della chiave di
config » **non copre tutte le zone**. La zona `site` non ha nessun `sitePrefix`:
è `wwwPath` più « tutto ciò che non ricade nelle altre sei ». Nominare i
segnaposti dalle chiavi darebbe sei nomi di un tipo e uno che non può esserlo,
mentre i nomi di zona sono sette nomi omogenei — gli stessi che compaiono nella
tabella D1 e nella chiave `baseline`. Un vocabolario, non due. *(Il
disaccoppiamento dal nome interno della chiave resta un beneficio, ma minore:
rinominare `adminPrefix` sarebbe comunque un breaking change con migrazione.)*


## Moduli

Due moduli con confine netto — la separazione serve a non far dipendere il core
da un plugin:

| Modulo | Contenuto | Dipende da | Perché separato |
|---|---|---|---|
| **`core/pathZoneResolver.js`** — la mappa (`pathZones`) | zone, risoluzione `{{…}}`, derivazione delle forme senza estensione, `baseline` di ogni zona | `ital8Config` | puro e sincrono → usabile dagli **8 consumatori** di `patternMatcher` e da `runtimeGate` |
| **`core/accessInvariantCheck.js`** — le invarianti (`accessInvariants`) | tabella delle sonde + confronto dei verdetti | riceve la **funzione di decisione** come parametro | il core definisce *cosa* deve valere, il plugin fornisce *chi* decide → il plugin resta sostituibile |

L'iniezione della funzione di decisione segue il modello già usato fra
`pluginSys` e `adminSystem` (injection bidirezionale, due fasi).

**Bonus di consolidamento:** `core/priorityMiddlewares/runtimeGate.js` calcola
**già** un perimetro quasi identico per il `reservedGate`, e lo fa
**correttamente** (`runtimeGate.js:60` e `:275` leggono `adminPrefix` dal
config). Con la mappa, i due smettono di derivare lo stesso perimetro in due
modi diversi — ed è proprio la divergenza fra due derivazioni dello stesso
perimetro ad aver prodotto A1.

## Piano a fasi

| Fase | Contenuto |
|---|---|
| **0 — Conferma del naming** | ✅ **CHIUSA (2026-10-30).** Tutti i nomi approvati, vedi *Naming*. Nessun codice. |
| **1 — La mappa (modulo puro)** | `core/pathZoneResolver.js`: zone, risoluzione `{{…}}`, errore su segnaposto sconosciuto, rilevamento collisioni, derivazione delle forme senza estensione. Test unitari esaustivi, incluso `adminPrefix: "backoffice"`. **Nessun consumatore ancora collegato.** |
| **2 — `baseline` di zona in `accessManager`** | Il `baseline` entra nel motore; `defaultPolicy` globale affiancata e poi superata; monotonia (D4) applicata e testata. `hardcodedRules` diventano ridondanti. |
| **3 — Invarianti + box `[ACCESS]`** | `core/accessInvariantCheck.js`: tabella delle sonde, invocata dentro `loadRules()`; fatale al boot, rifiuto a runtime (D7); test che presidia la presenza di `adminAccessControl` in `essentialPlugins`. |
| **4 — Segnaposti nei `.default` + migrazione** | I `.default` passano dai letterali ai segnaposti; derivazione `hideExtension` sostituisce le regole duplicate; `migrations/` + bump di `schemaVersion` (vedi *Migrazione*). |
| **5 — Adozione negli altri consumatori** | `sentinel`, `seo`, `rateLimiter`, `csrfProtection`, `urlRedirect`, `botDetector`: i 20 letterali censiti passano ai segnaposti, uno plugin per volta. |
| **6 — Consolidamento `runtimeGate`** | Il `reservedGate` deriva il perimetro dalla mappa invece di ricalcolarlo. |

**Corsia trasversale (in ogni fase, non alla fine):**

| Ambito | Impatto |
|---|---|
| `CLAUDE.md` | sezioni *Sistema di controllo accessi*, *Rotte API dei plugin*, *Gestione della configurazione*, *Hide Extension*, *Riferimento ai file importanti* |
| Documentazione | `plugins/adminAccessControl/README.it.md` + `EXPLAIN.it.md`; guida del vocabolario in `docs/`; stanza canonica (D8) nei file di config interessati |
| Test | nuovi: mappa, risoluzione, collisioni, derivazione, monotonia, sonde; **parametrizzati su `adminPrefix` non di default**; aggiornati: `tests/integration/globalPrefix.test.js` (oggi usa **sempre** `adminPrefix: 'admin'`) |
| `REVIEW.md` | spuntare **A1** e **A3** solo a Fase 3 completata **con** i test di regressione |
| `CHANGELOG.md` | breaking change (progetto alpha): `defaultPolicy` globale superata dal `baseline` di zona |
| `TODO.md` | voce di tracciamento con rimando a questo documento |

## Migrazione

Portare i `.default` dai letterali ai segnaposti è un **cambio di valore**, non
un'aggiunta di chiavi: il merge additivo ricorsivo di `reconcileSchemaVersions`
**non sa applicarlo**. Serve quindi, per ogni pacchetto toccato:

- bump della `schemaVersion` del **descrittore** (`pluginConfig.default.json5` —
  per `adminAccessControl` oggi `3`), perché è il clock dell'intero pacchetto;
- uno step in `migrations/` con `reason` (obbligatorio sempre) e
  `from-vN-to-vM.md`;
- negli script, `setJson5Key`/`editJson5` e **non** un `saveJson5` dell'oggetto
  intero, che perderebbe i commenti del config vivo.

Vedi [`config-migrations.it.md`](./config-migrations.it.md). I config con una
migrazione pendente sono già esclusi dal merge additivo, quindi non c'è rischio
che il trigger venga bruciato.

**Nota sui vivi esistenti:** `accessControl.json5` è git-ignored e può essere
stato personalizzato. La retrocompatibilità dei letterali (D2) garantisce che un
vivo non migrato continui a funzionare; il `baseline` di zona (D3) garantisce che
continui a funzionare **in sicurezza** anche se non contiene più nessuna regola
sull'admin.

## Punti rimandati

- **`hardcodedRules` restano nel `.default` come documentazione o spariscono?**
  Dopo D3 sono ridondanti. Tenerle costa una possibile confusione (« a cosa
  servono se non proteggono? »); toglierle costa un passaggio di migrazione in
  più. Da decidere in Fase 2.
- **`baseline` della zona `site`: in quale file si configura?**
  (`ital8Config.json5` o il config del plugin). Il nome della chiave è deciso,
  la sua collocazione no. Il caso d'uso « sito privato » è reale ma non urgente.
- **Vocabolario estendibile dai plugin.** Deciso chiuso per v1 (D2). Un plugin
  che registra zone proprie introduce uno spazio di nomi condiviso e quindi
  collisioni fra plugin: se servirà, va progettato con un prefisso di namespace.
- **Lettura di chiavi arbitrarie da file arbitrari** (la forma generale della
  proposta iniziale). Molta più macchina — risoluzione di percorsi, cicli, tipi
  non-stringa, valori che contengono `/` o `..` — per casi d'uso che oggi non
  esistono.
- **`dirListing` sul file server admin** (`index.js:563`, l'unico acceso dei
  cinque). Non è parte di questa decisione, ma è uno dei tre fattori aggravanti
  di A1: va valutato a sé.

## Conseguenze

**Positive**

- A1 diventa **irripetibile** invece che corretto una volta: la protezione del
  pannello non sta più in un file.
- A3 si chiude come effetto collaterale della monotonia (D4).
- I 20 letterali censiti possono smettere di esistere, e un plugin nuovo eredita
  il comportamento corretto **senza dichiarare nulla**.
- La duplicazione imposta da `hideExtension` sparisce dai file di configurazione.
- « Sito privato » diventa una chiave, non un progetto.
- `runtimeGate` e `accessManager` smettono di derivare lo stesso perimetro in due
  modi diversi.

**Negative / costi**

- Intervento ampio: core + 8 plugin + una migrazione per pacchetto toccato.
- Un **breaking change** dichiarato: la `defaultPolicy` globale è superata dal
  `baseline` di zona (accettabile in alpha, da scrivere in `CHANGELOG.md`).
- La monotonia (D4) vieta un caso d'uso oggi inesistente: pagine pubbliche dentro
  una zona chiusa.
- Un nuovo concetto da imparare per chi scrive config — mitigato dalla
  retrocompatibilità dei letterali e dalla stanza canonica (D8).

## Storia

- **2026-09-07** — `REVIEW.md` registra A1 (`adminPrefix` + regole letterali) e
  A3 (regole hardcoded non immutabili) come difetti aperti.
- **2026-09-15** — Prima discussione. Il maintainer individua che il problema
  eccede `adminPrefix` e propone variabili nei pattern
  (`"ital8Conf.adminPrefix/**"`). Analisi: la proposta risolve P2 ma non P1, e
  nella forma proposta **fallisce aperto**. Approvati: vocabolario chiuso,
  sintassi `{{…}}`, `pathPlaceholder`, nessun registro, errore fatale su
  segnaposto sconosciuto, GUI sul testo grezzo, migrazione, test su
  `adminPrefix: "backoffice"`. Il maintainer propone il doppio controllo
  (boot + blocco del salvataggio da GUI) e chiede di valutare la fine della
  duplicazione `hideExtension` e una `defaultPolicy` privata.
- **2026-10-30** — Ripresa. Presentato il bivio: strada A (« riparare il
  foglietto ») contro strada B (« costruire il muro », `baseline` per zona).
  **Scelta B**, e stesa la prima versione di questo documento con quattro nomi
  ancora in sospeso.
- **2026-10-30 (secondo giro)** — Riaperti e **chiusi** i quattro nomi.
  Confermati `{{admin}}` (nome di zona, con l'argomento decisivo della zona
  `site` priva di chiave di config) e `[ACCESS]`. Affinati gli altri due:
  concetto e modulo portano nomi distinti (`pathZones` →
  `core/pathZoneResolver.js`, `accessInvariants` →
  `core/accessInvariantCheck.js`, entrambi ricalcati su moduli esistenti), e
  **`posture` è diventato `baseline`** perché D4 rende quella chiave un
  pavimento, non un default. **Fase 0 chiusa.**
