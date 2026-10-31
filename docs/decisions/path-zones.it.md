<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione: zone dello spazio URL, segnaposti di percorso e `baseline` per zona

> **Stato: IN IMPLEMENTAZIONE** — design e naming approvati il 2026-10-30.
> **Fasi 0-3 completate. A1 e A3 sono CHIUSI e spuntati in `REVIEW.md`.** Un
> ruleset non applicabile non fa più partire il CMS; una modifica che non
> passerebbe il boot non può essere salvata dalla GUI. Restano le fasi 4-6
> (migrazione dei `.default`, adozione negli altri consumatori, consolidamento
> `runtimeGate`) — **pulizia e propagazione, non correzione**. Dettaglio in
> *Stato di implementazione*. Chiude alla radice [`REVIEW.md` → A1](../../REVIEW.md#a1--cambiare-adminprefix-apre-il-pannello-admin-a-chiunque)
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
| **1 — La mappa (modulo puro)** | ✅ **FATTA (2026-10-30).** `core/pathZoneResolver.js`: zone, risoluzione `{{…}}`, errore su segnaposto sconosciuto, rilevamento collisioni, derivazione delle forme senza estensione. Test unitari esaustivi, incluso `adminPrefix: "backoffice"`. **Nessun consumatore ancora collegato.** |
| **2 — `baseline` di zona in `accessManager`** | ✅ **FATTA (2026-10-31).** Il `baseline` entra nel motore; `defaultPolicy` globale affiancata e poi superata; monotonia (D4) applicata e testata. `hardcodedRules` diventano ridondanti. |
| **3 — Invarianti + box `[ACCESS]`** | ✅ **FATTA (2026-10-31).** `core/accessInvariantCheck.js`: sonde invocate dentro `loadRules()`; fatale al boot, rifiuto a runtime (D7); test che presidia la presenza di `adminAccessControl` in `essentialPlugins`. |
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

## Stato di implementazione

| Fase | Stato |
|---|---|
| 0 — Conferma del naming | ✅ **chiusa** (2026-10-30) |
| 1 — La mappa (`core/pathZoneResolver.js`) | ✅ **implementata e revisionata** (2026-10-30) — 132 test |
| 2 — `baseline` in `accessManager` | ✅ **implementata** (2026-10-31) — +28 test sul motore |
| 3 — Invarianti + box `[ACCESS]` | ✅ **implementata e revisionata ×2** (2026-10-31) — +72 test |
| 4 — Segnaposti nei `.default` + migrazione | ⬜ da fare |
| 5 — Adozione negli altri consumatori | ⬜ da fare |
| 6 — Consolidamento `runtimeGate` | ⬜ da fare |

> ⚠️ **A1 e A3 sono chiusi da qui, non dalla Fase 4.** Le regole nei `.default`
> sono ancora letterali, e il pannello è già protetto a qualunque `adminPrefix`
> perché il `baseline` della zona vive in codice. La migrazione dei pattern a
> segnaposti resta utile — rende il file leggibile e coerente — ma non è ciò che
> corregge il difetto. In `REVIEW.md` le due voci si spuntano a **Fase 3**
> completata, quando un ruleset non capito smetterà anche di far partire il sito.

### Fase 1 — cosa è stato scritto

- **`core/pathZoneResolver.js`** (476 righe, modulo puro, zero dipendenze).
  API: `resolvePathZones(ital8Conf)` · `resolveRuleset(rules, zoneMap)` ·
  `resolvePattern(pattern, zonesByName)` · `zoneForPath(pathOrPattern, zones)` ·
  `ZONE_NAMES`.
- **`tests/unit/core/pathZoneResolver.test.js`** — 132 test, **parametrizzati sul
  prefisso** (`admin`, `backoffice`, `pannello`, `a-b_c`, `MixedCase`), non scritti
  sul solo default: A1 esisteva proprio perché nessun test della suite usava un
  `adminPrefix` diverso da `"admin"`.
- **Nessun consumatore collegato**, come previsto dal piano: il comportamento del
  CMS a questa fase è **invariato**.

### Fase 2 — cosa è stato scritto

- **`core/pathZoneResolver.js`**: due funzioni pure in più —
  `tightenAccess(requirement, baseline)` (il più stretto fra i due) e
  `violatesBaseline(requirement, baseline)` (solo gli allentamenti **attivi**) — più
  il controllo di monotonia al caricamento in `resolveRuleset`, che emette il
  problema `baseline-violation`.
- **`plugins/adminAccessControl/lib/accessManager.js`**: costruisce `this.pathZones`
  nel costruttore, risolve il ruleset in `loadRules()`, conserva i problemi in
  `this.rulesetProblems` e li segnala; `checkAccess()` ricava la zona dalla **URL
  richiesta** e applica `tightenAccess`.
- **`plugins/adminAccessControl/accessControl.default.json5`**: le `hardcodedRules`
  **restano** (decisione del maintainer) ma il commento ora dichiara che sono
  **documentazione e non più la fonte di verità**, con il perché e le conseguenze.
- **Test**: `tests/unit/accessManagerBaseline.test.js` (28, nuovo) +
  `tests/unit/core/pathZoneResolver.test.js` (155).

**La formulazione che tiene insieme D3 e D4.** Una regola sola copre sia « nessuna
regola matcha » sia la monotonia:

> Il requisito effettivo = **il più stretto fra** ciò che dicono la regola (o la
> `defaultPolicy`) **e** il `baseline` della zona.

| Situazione | Esito |
|---|---|
| nessuna regola + zona **chiusa** | decide il `baseline` → **A1** |
| nessuna regola + zona **aperta** | decide la `defaultPolicy` → resta dell'amministratore |
| regola più **lasca** del `baseline` | vince il `baseline` → **A3** |
| regola più **stretta** | vince la regola |

**Perché la `defaultPolicy` non è stata rimossa.** Sulle zone aperte è ancora lei a
decidere, e resta la fonte di `redirectOnDenied`. Conseguenza misurata: sulle zone
aperte il comportamento è **identico** a prima (`tightenAccess` con un baseline
aperto restituisce la regola intatta), quindi il cambiamento riguarda **solo** le tre
zone chiuse. Superarla del tutto richiede il `baseline` della zona `site`
configurabile, che è un punto rimandato.

**La trappola dei ruoli, e perché non si intersecano.** Nel motore
`allowedRoles: []` significa « qualsiasi utente autenticato », non « nessuno »
(`checkAccess` controlla i ruoli solo se l'elenco è non vuoto). Intersecare `[2]` con
un baseline `[0, 1]` darebbe `[]`, che il motore rileggerebbe come « chiunque sia
autenticato »: un **allentamento** ottenuto da un'operazione che doveva stringere.
Quindi la regola restringe solo se elenca un **sottoinsieme non vuoto** del baseline;
in ogni altro caso vince il baseline. E si distingue il **sottospecificato**
(`allowedRoles: []` in zona chiusa — l'autore non ha concesso nulla di vietato:
completato in silenzio) dall'**allentamento attivo** (`requiresAuth: false`, o un
ruolo che il baseline non ammette: segnalato).

**Due livelli, e coprono insiemi diversi.** Il controllo al **caricamento** non vede
le violazioni dei pattern `regex:`, perché la zona di una regex non è determinabile
leggendone il testo. Quello a **runtime** sì, perché ricava la zona dalla URL
richiesta e non dal pattern. Il primo dice « questa regola non può valere » in
anticipo; il secondo garantisce che non valga. Presidiato da un test.

#### Il risultato misurato

A1 si chiude **prima** della migrazione dei pattern: con `adminPrefix: "backoffice"` e
le regole ancora scritte come letterali `/admin` — cioè la configurazione esatta che
produceva il difetto — un anonimo su `/backoffice/usersManagment/index.ejs` è
**respinto**, con il motivo che nomina il baseline della zona. La Fase 4 diventa
quindi una **pulizia**, non la correzione.

E la protezione non dipende più dal contenuto del file:

| Stato di `accessControl.json5` | Pannello admin | Sito pubblico |
|---|---|---|
| completo | protetto | servito |
| regole **svuotate** | **protetto** | servito |
| sezioni **assenti** | **protetto** | servito |
| file **illeggibile** | **protetto** | servito |
| file **cancellato** | **protetto** | servito |

Prima della Fase 2, in ognuno dei quattro casi degradati il pannello si apriva a
chiunque.

#### Un cambiamento di comportamento da conoscere

`GET /admin-theme-resources/...` da anonimo ora risponde **302** verso il login
invece di **200**. Non è un effetto collaterale: la zona `adminThemeResources` ha
`baseline` chiuso nella tabella D1, e il codice conosceva già la fuga — il commento
di `core/priorityMiddlewares/runtimeGate.js:232` dice che senza il gate riservato
quelle risorse « resterebbero servite a chiunque e rivelerebbero l'esistenza del
pannello ». Fino alla Fase 2 quella riga copriva solo `reserved stop`; ora la zona è
chiusa sempre.

**La pagina di login non è toccata**: le `pluginPages` non sono contesto admin
(`isAdminContext` non viene impostato da `pluginPagesSystem`), quindi usano il tema
**pubblico**, la cui zona resta aperta. Verificato: l'unico riferimento a
`adminThemeResourcesPrefix` nei template sta dentro il pannello
(`core/admin/webPages/systemSettings/index.ejs`).

`tests/integration/httpVerbs.test.js` è stato adeguato: lo status atteso è ora
**per-superficie** invece di un `200` fisso, così il test resta non vacuo e dichiara
quale superficie è pubblica e quale no.

### Fase 3 — cosa è stato scritto

- **`core/accessInvariantCheck.js`** (nuovo, modulo puro): `describeAccessInvariants`
  · `checkAccessInvariants` · `formatAccessProblemsBox`. Riceve la funzione di
  decisione come **parametro**: il core dichiara *cosa* deve valere, il plugin
  fornisce *chi* decide.
- **`accessManager`**: `checkAccess(url, user, context)` — terzo parametro
  **opzionale** che valuta la decisione contro un ruleset **dato** invece di quello
  vivo; `loadRules()` non committa più nulla finché i controlli non passano;
  `validateCandidate(jsonString)` verifica un ruleset non ancora su disco;
  `saveRules()` lo chiama **prima di scrivere**; `reloadRules()` propaga l'esito.
- **`main.js`**: un salvataggio rifiutato risponde **400** con l'elenco dei
  problemi, non 500 — è un errore dell'input, e l'admin deve sapere cosa correggere.
- **Test**: `tests/unit/core/accessInvariantCheck.test.js` (26, nuovo) + 8 aggiunti a
  `accessManagerBaseline.test.js`.

#### Le sonde si DERIVANO dalle zone, non si elencano

La tabella di D6 era scritta a mano. In implementazione è diventata **derivata**:
per ogni zona con `baseline` chiuso si generano le sonde « l'anonimo è negato », « un
ruolo non ammesso è negato », « ogni ruolo ammesso è consentito », su due path (la
radice e uno in profondità). Sulla configurazione distribuita sono **19 sonde**.

Il motivo è che una tabella scritta a mano diventa stantia nel momento in cui qualcuno
aggiunge una zona: la zona nuova non comparirebbe, e nessuno se ne accorgerebbe. Così
una zona chiusa aggiunta domani è coperta **senza toccare quel file**.

Le sonde verificano anche il **verso opposto** — che ogni ruolo ammesso entri — perché
un presidio chiuso troppo non è sicurezza: è un pannello irraggiungibile al suo
amministratore.

#### L'unica sonda non derivabile, e la più importante

« Un anonimo deve poter raggiungere la pagina di login » non si deduce dalle zone, e
la sua violazione è la peggiore della famiglia: chi viene rifiutato è mandato a una
pagina che lo rifiuta a sua volta — **un loop di redirect** — e nessuno può più
autenticarsi per correggere la configurazione dalla GUI. È irrecuperabile
dall'interfaccia.

L'URL non è cablato: si prende da `defaultPolicy.redirectOnDenied`, cioè dalla pagina
verso cui il motore stesso manda chi rifiuta. La sonda diventa **auto-coerente**.

**Verificato che non vieti una configurazione legittima:** il config spedito passa le
19 sonde con `defaultPolicy` ad `allow`, `requireAuth` **e** `deny`, zero violazioni
in tutti e tre i casi, perché esenta esplicitamente login e logout. La sonda scatta
solo su una configurazione in cui il login è davvero irraggiungibile.

#### Una sonda di D6 è stata esclusa, di proposito

D6 includeva « un anonimo deve raggiungere `{{publicThemeResources}}` ». **Non è un
invariante:** un amministratore può legittimamente mettere dietro autenticazione
l'intero sito, risorse comprese, e renderlo fatale vieterebbe una configurazione
valida. Se è un errore, il guasto è **visibile** (il sito esce senza stile) e
**recuperabile** (si corregge dalla GUI, a cui si accede ancora). Il login no: per
quello non c'è né visibilità né recupero.

#### `throw`, non `process.exit` (domanda A, deciso dal maintainer)

D7 diceva `process.exit`. In implementazione si è scelto **`throw`**: la fatalità
appartiene a `pluginSys`, che per un plugin in `essentialPlugins` emette `[FATAL]` e
termina. Un `process.exit` da dentro un plugin scavalcherebbe quella macchina e
ignorerebbe una dichiarazione del maintainer.

Il rovescio è reale: togliendo `adminAccessControl` da `essentialPlugins`, un
controllo accessi non applicabile non spegnerebbe il boot — il plugin verrebbe
soltanto saltato, e il sito servito **senza guardia**. L'invariante regge per
**configurazione**, quindi è presidiata da un test, non da questo codice.

**Verificato sul server reale:** con un segnaposto sconosciuto nel config vivo, il
boot stampa il box `[ACCESS]` che nomina il file, il pattern e i sette nomi di zona
validi, poi `pluginSys` stampa `[FATAL]` e il processo esce con **1**. Con il config
sano: 10 pattern, **19 invarianti verificate**, zero righe `[ACCESS]`.

#### Tutti gli otto problemi sono fatali, con messaggi DIAGNOSTICI (domanda B)

Non prescrittivi. Per la maggior parte di questi problemi l'intento dell'autore non è
desumibile — una `collision` fra due regole diverse può volersi risolvere in entrambi
i versi — e un suggerimento inventato dentro un box di sicurezza è peggio del
silenzio, oltre a essere testo da mantenere allineato. Ogni riga dice **quale file**,
**quale pattern o chiave**, **cosa non va**. L'unica eccezione è
`unknown-placeholder`, dove la risposta è **chiusa**: i nomi di zona validi.

I due problemi di **zona** sono attribuiti a `ital8Config.json5` nella radice del
progetto, non al file delle regole: è lì che nascono, e mandare chi legge a cercarli
nella cartella del plugin sarebbe un messaggio diagnostico che punta al file sbagliato.

#### Il salvataggio dalla GUI non può più impedire il boot successivo (domanda C)

Il difetto, trovato leggendo `main.js:178`: la GUI validava con
`ruleValidator.validateFromUI` — che non conosce zone, segnaposti né `baseline` —
**poi scriveva**, poi ricaricava. Con la Fase 3 scritta ingenuamente la sequenza
sarebbe stata: validazione superata → file **scritto** → ricarica **rifiutata** →
la GUI dice « salvato » → al riavvio successivo il CMS non parte.

La correzione: il controllo entra in `saveRules`, che è il **punto unico** da cui
passa ogni scrittura, **prima** di scrivere. L'invariante che si ottiene:

> **Un file che non farebbe ripartire il CMS non può essere salvato.**

I due validatori **non si sostituiscono**: `validateFromUI` conserva il suo mestiere
(sintassi JSON5, immutabilità delle hardcoded, esistenza dei ruoli, conflitti con le
rotte dei plugin) e il nuovo aggiunge ciò che solo il motore sa. È un **predicato
condiviso fra due percorsi**, non due validatori che devono concordare — il progetto
ha già visto divergere validatore e dispatcher su `access` (`CLAUDE.md`, nota su
`routeContract.test.js`).

#### Revisione della Fase 3 — cinque difetti, e uno era un FAIL-OPEN

La Fase 3 è stata sottoposta a revisione dopo la stesura, come la Fase 1. Il rilievo
principale è il più imbarazzante possibile per questa decisione: **un fail-open nel
percorso di enforcement, invisibile al presidio che la Fase 3 aveva appena costruito.**

| # | Difetto | Danno | Correzione |
|---|---|---|---|
| ① | Nel middleware un rifiuto che non porta **né `redirect` né `status`** cadeva fuori dall'`if` e raggiungeva `await next()` | **La pagina veniva SERVITA a chi era stato negato.** Raggiungibile con `defaultPolicy: { action: "allow" }` — plausibile, manca solo `redirectOnDenied` — e su **ogni** URL di zona chiusa priva di regola. Misurato: `checkAccess` rispondeva `{allowed: false, redirect: undefined, status: null}` e la pagina usciva | Un rifiuto senza esito applicabile **nega** con 403 e lo dichiara nel log: `allowed: false` non può mai significare « servi la pagina » |
| ② | Le sonde leggevano **solo `verdict.allowed`** | È il motivo per cui ① è passato sotto il presidio di tutta la Fase 3: la sonda vedeva « negato » e si dichiarava soddisfatta, mentre la richiesta HTTP veniva servita. 19 sonde, zero violazioni, e la pagina fuori | Su un rifiuto atteso si verifica anche che sia **applicabile** (`redirect` o `status`), con il nuovo esito `deny-not-enforceable` |
| ③ | `validateCandidate` ricadeva su `this.defaultPolicy` quando il candidato non la dichiarava | Validava una configurazione **diversa** da quella che stava per scrivere: un file privo di `defaultPolicy` passava il controllo e poi non faceva partire il CMS. Cioè **esattamente** « un file che non farebbe ripartire il CMS » che veniva salvato — l'invariante che la Fase 3 esiste per garantire | Nessun fallback sullo stato vivo: si valida ciò che finirebbe su disco, e nient'altro |
| ④ | Una `defaultPolicy` assente arrivava a `checkAccess`, che dereferenziava `undefined` | Il boot era fail-closed, ma la diagnosi era « Cannot read properties of undefined (reading 'redirectOnDenied') » ripetuta sei volte: contro il criterio deciso (« il messaggio deve far capire dov'è il problema ») | `describeDefaultPolicyDefect` controlla la forma nei **due** percorsi → problema `default-policy-invalid`, e le sonde vengono **saltate** quando la policy è inutilizzabile (venti problemi accurati valgono meno di uno chiaro) |
| ⑤ | `#reportProblems` scriveva `this.rulesetProblems` anche su un rifiuto a runtime | Lo stato dichiarava problemi su una configurazione **non in vigore**, mentre quella in vigore era sana. Nessun consumatore esterno (verificato), quindi latente | `rulesetProblems` descrive solo ciò che è in vigore; i problemi del candidato scartato arrivano nel valore di ritorno |

**Una presa in più, arrivata con ④.** Il controllo di forma rifiuta anche un refuso in
`defaultPolicy.action` (`"alow"`, `"Deny"`): il `default:` di `applyDefaultPolicy`
ricadeva su « allow », quindi un refuso rendeva **pubblico in silenzio** un sito che
l'amministratore aveva scritto per essere chiuso.

**Nono tipo di problema:** `default-policy-invalid`, fatale come gli altri otto.

**La lezione di metodo, che vale oltre questo intervento.** Il presidio della Fase 3
misurava la **funzione di decisione**, non l'**enforcement**, e fra i due c'era un
difetto. È la stessa forma del difetto che questa decisione esiste per chiudere —
due livelli che devono concordare e che nessuno teneva allineati — comparsa un piano
sotto a dove avevo messo le sonde. La correzione di ② non elimina il divario (le sonde
restano a livello di decisione) ma lo rende **attraversabile solo da una decisione
applicabile**, che è il massimo che un modulo puro possa garantire.

#### Secondo giro di revisione — sei difetti, e un'ironia

Un secondo giro sulla Fase 3, dopo le correzioni del primo. Il rilievo principale è
istruttivo: **la correzione del primo giro aveva creato esattamente la divergenza
contro cui era stato argomentato il predicato condiviso.**

| # | Difetto | Danno | Correzione |
|---|---|---|---|
| ① | `describeDefaultPolicyDefect` pretendeva `redirectOnDenied`, mentre `ruleValidator.validateDefaultPolicy` la dichiarava **opzionale** | Due validatori, la stessa chiave, verdetti opposti: nel percorso GUI l'admin riceveva un via libera da `validateFromUI` e un rifiuto da `saveRules`. È la classe di difetto che `CLAUDE.md` registra come già avvenuta su `access` — e la Fase 3 l'ha reintrodotta | `validateDefaultPolicy` diventa il predicato **unico** (statico, con delegato d'istanza per i chiamanti esistenti) e **richiede** `redirectOnDenied`; `describeDefaultPolicyDefect` vi **delega**, traducendo solo il messaggio |
| ② | Il controllo su `action` era re-implementato | La lista delle azioni valide viveva in due file | Una sola, `RuleValidator.DEFAULT_POLICY_ACTIONS` |
| ③ | `saveRules` scartava l'esito di `reloadRules()` | `validateCandidate` valida la **stringa**, `loadRules` rilegge il **file**: su una scrittura parziale la ricarica può essere rifiutata e la GUI direbbe « salvato » mentre in memoria restano le regole precedenti | L'esito è controllato; se la ricarica è rifiutata la risposta lo dice |
| ④ | Il presidio su `essentialPlugins` leggeva solo il `.default` | Il comportamento a runtime lo decide il file **vivo**: chi rimuovesse il plugin da quella lista avrebbe un sito servito senza middreware di controllo accessi, col test verde | Controlla **entrambi** i file, con il limite dichiarato nel test |
| ⑤ | `checkInTemplate` non consultava il `baseline` di zona | Dalla Fase 2 `checkAccess` lo applica e questo no: due percorsi di decisione con conoscenza diversa. Non sfruttabile oggi (il middleware gira prima), ma trappola latente | Passa per `tightenAccess` con il `baseline` della zona |
| ⑥ | `/test-access` non poteva simulare un **anonimo** | `{ roleIds: [] }` è truthy, quindi simulava un utente autenticato senza ruoli; e il form della GUI pretendeva almeno un ruolo. Dalle fasi 2-3 l'anonimo è l'attore centrale della protezione, e non era provabile | La rotta accetta `anonymous: true` e la GUI ha la casella corrispondente |

**Il difetto ① merita una riga in più**, perché è la lezione del giro. Correggendo
la diagnosi povera del primo giro ho scritto un secondo validatore della stessa
chiave, nello stesso intervento in cui avevo argomentato che « due validatori che
devono concordare prima o poi divergono ». Sono divergiti **subito**: uno dichiarava
`redirectOnDenied` opzionale, l'altro la pretendeva. La correzione non è stata
allinearli ma **togliere il secondo**.

**Un cambiamento di contratto, dichiarato:** `redirectOnDenied` è ora
**obbligatoria**. Quattro test di `ruleValidator` la fissavano come opzionale, uno
chiamato « accepts policy without redirectOnDenied (optional) ». Dichiararla
opzionale era innocuo soltanto finché nessuno controllava: il motore la restituisce
su **ogni** rifiuto per autenticazione, e un rifiuto che non la porta era quello
che il middleware serviva.

#### Due difetti della mia stessa stesura, trovati e corretti

| Difetto | Perché contava |
|---|---|
| `loadRules()` assegnava `this.rules` **prima** di verificare | Su un rifiuto a runtime il ruleset precedente era già perduto: l'opposto di D7, cioè un sito con **meno** protezioni di quelle che aveva un istante prima. Ora niente viene committato finché i controlli non passano |
| `reloadRules()` non propagava l'esito | Chi ricarica non poteva sapere se la ricarica era stata accettata, e presumeva che fosse andata |

Più un terzo nel fallback: un file diventato illeggibile **a runtime** non deve far
perdere il ruleset che sta funzionando. Il fallback a zero regole resta solo al boot.

### Scelte di dettaglio prese in implementazione

Nessuna devia dalla decisione; tre **aggiungono** un caso che la decisione
implicava senza nominarlo, e sono annotate qui perché non passino inosservate.

| Scelta | Perché |
|---|---|
| Terzo tipo di problema: **`malformed-placeholder`** | Un delimitatore spaiato (`{{admin`, `{admin}`, `}}`) non viene intercettato dalla regex dei segnaposti, quindi **resterebbe un letterale che non matcha nessun URL** — esattamente il fail-open che D2 vieta. Era un buco: è un problema riportato, non un pattern. |
| Quarto tipo: **`zone-prefix-collision`** | Due zone configurate sullo stesso prefisso concreto (es. `adminPrefix: "api"`) farebbero sparire una zona dentro l'altra senza un fiato. Stessa classe di difetto silenzioso che la decisione esiste per chiudere. |
| `resolvePattern` **esportata** oltre alle tre funzioni approvate | I consumatori della Fase 5 non hanno tutti un « ruleset »: `urlRedirect` ha un array, `sentinel` regole di forma propria. Senza la risoluzione di un singolo pattern dovrebbero reimplementarla. |
| `{{site}}` da solo risolve a **`/`** | La zona `site` ha prefisso vuoto, quindi `{{site}}` sostituito darebbe stringa vuota — che non è un pattern. `{{site}}/about.ejs` → `/about.ejs` resta senza doppi slash. |
| Spazi **tollerati** dentro le graffe (`{{ admin }}`) | Un refuso innocuo non merita un boot fatale; un nome **sconosciuto** sì, e resta tale. |
| Un prefisso vuoto o di soli spazi ricade sul **valore documentato** | `adminPrefix: ""` farebbe coincidere la zona con la radice del sito, creando un secondo catch-all. Stessa logica di `runtimeGate.js:60` (`ital8Conf.adminPrefix \|\| 'admin'`). |
| Le regole derivate portano **`derivedFrom`** | Serve alla GUI (D5: le derivate si mostrano in sola lettura) e al confronto fra regole, che lo ignora essendo metadato e non contenuto. |
| `zoneForPath` restituisce **`null`** sui pattern `regex:` | La zona di una regex non è determinabile dal suo testo; è anche il motivo per cui le regex non ricevono la derivazione dell'estensione. |

### Revisione del codice (2026-10-30) — otto difetti trovati e corretti

La Fase 1 è stata sottoposta a revisione **dopo** la stesura. Nessun rilievo era
un difetto di design: tutti e otto erano nell'implementazione, e sei di essi
producevano un **fail-open silenzioso**, cioè la stessa famiglia del difetto che
questa decisione esiste per chiudere. Sono qui con il danno che facevano.

| # | Difetto | Danno | Correzione |
|---|---|---|---|
| ① | Il guard sulle graffe scartava i **quantificatori regex** (`\d{1,3}`) | Una regola `requiresAuth` in forma `regex:` veniva **buttata via** e ricadeva nella `defaultPolicy` (`allow`): lo stesso danno del guard, dal lato opposto | Graffe **doppie** (`{{`/`}}`) sempre un problema; graffa **singola** solo fuori da un `regex:`, dove non ha significato |
| ② | L'estensione era usata verbatim | `koa-classic-server` normalizza `'ejs'` ≡ `'.ejs'` e accetta suffissi composti: con un `ext` senza punto derivavamo `/x.` invece di `/x`, e la URL pulita realmente servita non matchava nulla | Replicata la semantica di `normalizeExtSuffix` (`koa-classic-server/index.cjs:30`) |
| ③ | `**` prima dell'estensione veniva derivato | `/admin/docs/**.ejs` → gemello `/admin/docs/**`, **strettamente più largo**: una regola permissiva si estendeva a `db-dump.sql`, `secret.json` | Non si deriva; nuovo problema `underivable-pattern` (il gemello va scritto a mano) |
| ④ | Il prefisso concreto non era validato | `adminPrefix: "a*b"` → `/a*b/**`, che il matcher compila in `^/a[^/]+b/.*$` e **non matcha** il path letterale servito: zona scoperta, in silenzio | Nuovo problema `zone-prefix-invalid`. Presidio nel punto d'uso perché la GUI valida `adminPrefix`/`apiPrefix` (`systemSettings.js:104`) ma non `viewsPrefix`, e un config scritto a mano non passa da nessun validatore |
| ⑤ | Nelle collisioni vinceva il **primo** | Il chiamante costruisce `{...customRules, ...hardcodedRules}` (`accessManager.loadRules()`:55), dove le hardcoded `editable: false` sovrascrivono: « vince il primo » **rovesciava** quella precedenza | Vince l'**ultimo**, come l'object spread. Il problema resta riportato |
| ⑥ | La derivazione era solo estesa→pulita | `accessControl.default.json5` spedisce **tre** regole in forma pulita (`login`, `logout`, `userProfile`): le loro forme `.ejs` restavano fuori da ogni regola, e un anonimo otteneva un 301 — la conferma che la pagina esiste | Derivazione **bidirezionale**, con il conflitto fra le due forme segnalato **una volta** e non una per direzione |
| ⑦ | Una chiave **vuota** risolveva a `/` | `{'': regola}` portava silenziosamente la homepage pubblica dietro l'autenticazione | Nuovo problema `empty-pattern`; `{{site}}` resta la via legittima per nominare la radice |
| ⑧ | La collisione fra zone guardava solo l'**uguaglianza** | `adminPrefix: "admin"` + `apiPrefix: "admin/api"` passava in silenzio, e il longest-match consegnava quel sottoalbero del pannello alla zona `api`, il cui `baseline` è `null` | Rilevato anche l'**annidamento** |

Due rilievi del rapporto di revisione sono stati **ridimensionati** dopo verifica
diretta: `adminPrefix` *è* validato dalla GUI (la riga citata, `systemSettings.js:110`,
è `viewsPrefix`, che invece non ha controllo di charset), e un prefisso con spazi o
`?` resta **protetto** — solo `*` scopre davvero la zona. Lo spazio è comunque
segnalato, perché rende il pattern invalido secondo `patternMatcher.validatePattern()`.

**Collaudo sul config reale.** Il resolver è stato fatto girare sul
`accessControl.default.json5` spedito, con lo stesso merge di `loadRules()`: 10
regole in ingresso, 10 in uscita, **zero problemi**, con `hideExtension` sia spento
sia acceso. Nel secondo caso nulla viene derivato perché il default porta già
entrambe le forme a mano — il che significa che la Fase 4 può **cancellare** le tre
forme pulite duplicate sapendo che la derivazione le rigenera.

**Un nono difetto, trovato prima della revisione.** Il ramo di lookup che accetta un
oggetto semplice al posto della `Map` indicizzava **senza `hasOwnProperty`**: un
segnaposto `{{constructor}}` o `{{toString}}` pescava dal **prototipo** un valore
truthy, `zone.prefix` risultava `undefined` e il pattern diventava `"undefined/**"`
— un letterale che non matcha nessun URL, prodotto **in silenzio**. Esattamente il
fail-open che D2 vieta, ed esattamente la classe di difetto di `REVIEW.md` → **B4**
(« oggetti indicizzati con input utente senza `hasOwnProperty` »). Corretto con
`hasOwnProperty` più un controllo di **forma** del record (`prefix` deve essere una
stringa), che vale per entrambi i rami e protegge anche da una mappa malformata.
Presidiato da 6 test.

**Limite noto, consapevole:** un segnaposto dentro un pattern `regex:` viene
sostituito **verbatim**, quindi un prefisso che contenesse metacaratteri regex
(`adminPrefix: "a.b"`) allargherebbe la regex. Non è un fail-open — una regex più
larga su una regola `requiresAuth` protegge *più* URL, non meno — ma va saputo.

**Il confronto per segmenti è replicato, non condiviso:** `pathIsUnderSegment` è
copiata da `core/priorityMiddlewares/runtimeGate.js:228` invece di essere importata,
perché la direzione di dipendenza corretta è l'opposta (sarà `runtimeGate` a usare la
mappa, in Fase 6). La replica è esatta, così il consolidamento non cambierà
comportamento.

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
- **Un presidio di boot per `essentialPlugins`.** Un test copre l'installazione in
  cui gira, non quella di chi scarica il CMS: chi rimuove `adminAccessControl` da
  `essentialPlugins` ottiene un sito servito senza middleware di controllo accessi,
  e nessuno lo avverte. Il posto giusto è il **core**, al boot: chi monta il
  middleware di controllo accessi dovrebbe accorgersi se quel plugin non è
  essenziale. Fuori dallo scopo della Fase 3.
- **`dirListing` sul file server admin** (`index.js:563`, l'unico acceso dei
  cinque). Non è parte di questa decisione, ma è uno dei tre fattori aggravanti
  di A1: va valutato a sé.
- **La forma della risposta nelle zone di sole RISORSE.** Un `GET` anonimo su
  `{{adminThemeResources}}/css/theme.css` riceve un **302 verso una pagina HTML di
  login**: corretto come decisione d'accesso, strano come risposta a una richiesta
  di foglio di stile. La filosofia del `reservedGate` — rispondere **404**, senza
  rivelare — sarebbe più coerente per le zone che non servono pagine. Emerso in
  Fase 2, fuori dal suo scopo: cambiare la forma della risposta per zona è una
  decisione a sé.

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
- **2026-10-30 (terzo giro)** — **Fase 1 implementata**: `core/pathZoneResolver.js`
  (modulo puro) e 132 test parametrizzati sul prefisso, poi **revisionata**: nove
  difetti di implementazione corretti, sei dei quali erano fail-open silenziosi. In implementazione sono
  emersi due casi che la decisione implicava senza nominarli — delimitatore di
  segnaposto spaiato e due zone sullo stesso prefisso concreto — aggiunti come
  terzo e quarto tipo di problema, perché entrambi sarebbero stati fail-open
  silenziosi. Una rilettura adversariale del modulo ha poi scoperto un terzo
  fail-open, della classe di B4: il lookup su oggetto semplice senza
  `hasOwnProperty`. Corretto e presidiato. Vedi *Stato di implementazione*.
- **2026-10-30 (secondo giro)** — Riaperti e **chiusi** i quattro nomi.
  Confermati `{{admin}}` (nome di zona, con l'argomento decisivo della zona
  `site` priva di chiave di config) e `[ACCESS]`. Affinati gli altri due:
  concetto e modulo portano nomi distinti (`pathZones` →
  `core/pathZoneResolver.js`, `accessInvariants` →
  `core/accessInvariantCheck.js`, entrambi ricalcati su moduli esistenti), e
  **`posture` è diventato `baseline`** perché D4 rende quella chiave un
  pavimento, non un default. **Fase 0 chiusa.**
