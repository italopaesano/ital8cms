<!-- ital8doc v1-1 · tipo: reference · lang: it -->
# REVIEW — Revisione completa del codice ital8cms

> **Data revisione:** 2026-09-07
> **Ambito:** intero codebase (~100k righe: core 11k, plugin 52k, script 5k, test 34k).
> **Base:** branch `main` @ `0531b73`, versione progetto `0.0.1-alpha.3`.
> **Metodo:** lettura del codice + esecuzione diretta dei moduli puri (`core/patternMatcher.js`)
> per confermare i comportamenti descritti. `node_modules` non era installato
> nell'ambiente di revisione, quindi la suite di test **non** è stata eseguita.
> **Criterio di inclusione:** solo difetti **sostanziali** — sicurezza, correttezza,
> integrità dei dati, invarianti architetturali violate. Sono stati deliberatamente
> **esclusi** stile, formattazione, refusi nei commenti e micro-ottimizzazioni.

---

## Come si usa questo documento

Ogni voce dell'indice ha una **checkbox**: spuntala (`[x]`) quando il problema è
**corretto e verificato con un test di regressione**. Non spuntarla solo perché la
modifica è stata scritta — metà dei difetti qui dentro nascono proprio da un
presidio che esisteva ma che nessun test teneva allineato.

Ogni scheda ha sempre le stesse cinque sezioni, così è leggibile anche a distanza
di mesi da chi non ha partecipato alla revisione:

| Sezione | Risponde a |
|---|---|
| **Dove** | quale file e quale riga |
| **Cosa succede** | il meccanismo, spiegato senza dare per scontato il contesto |
| **Perché è un problema** | l'impatto concreto, non teorico |
| **Verifica** | come è stato confermato (comando, output, o lettura incrociata) |
| **Come si corregge** | la direzione della fix, con il presidio da aggiungere |

I numeri di riga si riferiscono al commit `0531b73` e vanno riletti dopo ogni
modifica al file citato.

---

## Indice / Stato di avanzamento

### 🔴 A — Sicurezza, bloccanti

| # | Problema | Impatto | Stato |
|---|---|---|---|
| A1 | [Cambiare `adminPrefix` apre il pannello admin a chiunque](#a1--cambiare-adminprefix-apre-il-pannello-admin-a-chiunque) | Accesso anonimo alle pagine admin | - [x] |
| A2 | [Le due reti di sicurezza sulle chiavi di sessione sono entrambe morte](#a2--le-due-reti-di-sicurezza-sulle-chiavi-di-sessione-sono-entrambe-morte) | Impersonazione root senza credenziali | - [x] |
| A3 | [Le regole hardcoded del controllo accessi non sono immutabili](#a3--le-regole-hardcoded-del-controllo-accessi-non-sono-immutabili) | Una regola custom scavalca la protezione admin | - [x] |
| A4 | [Regex non ancorate e mix `*`/`**` che sbaglia in silenzio](#a4--regex-non-ancorate-e-mix--che-sbaglia-in-silenzio) | Regole che proteggono l'insieme sbagliato di URL | - [x] |
| A5 | [Nessun security header, e cookie di sessione senza `secure`](#a5--nessun-security-header-e-cookie-di-sessione-senza-secure) | XSS/clickjacking/furto cookie non mitigati | - [x] |
| A6 | [`checkInTemplate` — la guardia documentata per i template non protegge](#a6--checkintemplate--la-guardia-documentata-per-i-template-non-protegge) | Pagina protetta servita per intero nel corpo del 302 | - [x] |
| A7 | [Server di redirect HTTP→HTTPS: DoS remoto + open redirect](#a7--server-di-redirect-httphttps-dos-remoto--open-redirect) | Una richiesta spegne il processo | - [x] |

### 🟠 B — Correttezza e integrità dei dati

| # | Problema | Impatto | Stato |
|---|---|---|---|
| B1 | [Il file delle credenziali è scritto in modo non atomico](#b1--il-file-delle-credenziali-è-scritto-in-modo-non-atomico) | Perdita di tutti gli account | - [x] |
| B2 | [`updateUserProfile` — lost update fra richieste concorrenti](#b2--updateuserprofile--lost-update-fra-richieste-concorrenti) | Modifiche silenziosamente perse | - [x] |
| B3 | [Salvare da System Settings distrugge il config e può impedire il boot](#b3--salvare-da-system-settings-distrugge-il-config-e-può-impedire-il-boot) | Installazione non più avviabile | - [x] |
| B4 | [Oggetti indicizzati con input utente senza `hasOwnProperty`](#b4--oggetti-indicizzati-con-input-utente-senza-hasownproperty) | 500 non autenticato sul login | - [x] |
| B5 | [`isPathSafe` confronta il prefisso senza separatore](#b5--ispathsafe-confronta-il-prefisso-senza-separatore) | Scrittura di file fuori da `/www` | - [x] |
| B6 | [Il contratto `getObjectToShareToOthersPlugin` è documentato con tre parametri, il runtime ne passa uno](#b6--il-contratto-getobjecttosharetoothersplugin-è-documentato-con-tre-parametri-il-runtime-ne-passa-uno) | Trappola per chi scrive plugin | - [x] |
| B7 | [Storage a file senza lock — l'architettura non regge il multi-processo](#b7--storage-a-file-senza-lock--larchitettura-non-regge-il-multi-processo) | Corruzione dati con `pm2 -i` | - [x] |

### 🟡 C — Altri punti sostanziali

| # | Problema | Impatto | Stato |
|---|---|---|---|
| C1 | [`GET /logged` è pubblico e stampa l'intera sessione](#c1--get-logged-è-pubblico-e-stampa-lintera-sessione) | Fuga del token CSRF | - [x] |
| C2 | [Rate limiting inefficace su IPv6, e senza tetto](#c2--rate-limiting-inefficace-su-ipv6-e-senza-tetto) | Brute-force non rallentato | - [x] |
| C3 | [Enumerazione utenti per timing sul login](#c3--enumerazione-utenti-per-timing-sul-login) | Scoperta degli username validi | - [x] |
| C4 | [Policy password incoerente fra i due punti di scrittura](#c4--policy-password-incoerente-fra-i-due-punti-di-scrittura) | Password deboli sull'utente root | - [x] |
| C5 | [Due definizioni diverse di « autenticato »](#c5--due-definizioni-diverse-di--autenticato) | Invariante non presidiata | - [x] |
| C6 | [`cliBridge`: `chmod` dopo `listen`, e fallimento non fatale](#c6--clibridge-chmod-dopo-listen-e-fallimento-non-fatale) | Canale di controllo con permessi ignoti | - [x] |
| C7 | [Il ruolo `admin` (1) equivale a esecuzione di codice remoto](#c7--il-ruolo-admin-1-equivale-a-esecuzione-di-codice-remoto) | RBAC documentato in modo fuorviante | - [x] |

### ✅ D — [Cosa è stato verificato e risulta solido](#d--cosa-è-stato-verificato-e-risulta-solido)

### 📌 E — [Ordine di intervento suggerito](#e--ordine-di-intervento-suggerito)

### 🔎 F — [Osservazione di metodo: il filo comune](#f--osservazione-di-metodo-il-filo-comune)

---

# 🔴 A — Sicurezza, bloccanti

## A1 · Cambiare `adminPrefix` apre il pannello admin a chiunque

> ✅ **CORRETTO (2026-10-31), fasi 1-3 di [`docs/decisions/path-zones.it.md`](./docs/decisions/path-zones.it.md).**
> La correzione non è quella proposta qui sotto: invece di sincronizzare la regola
> col prefisso, il **minimo d'accesso di ogni zona dello spazio URL vive in codice**
> (`core/pathZoneResolver.js`), quindi la protezione del pannello non sta più in un
> file. Misurato: con `adminPrefix: "backoffice"` **e le regole ancora letterali**
> un anonimo è respinto; e il pannello resta protetto anche con
> `accessControl.json5` svuotato, illeggibile o cancellato. Il presidio richiesto in
> fondo alla scheda esiste, parametrizzato su cinque prefissi, più 19 sonde eseguite
> a ogni caricamento del ruleset e un box `[ACCESS]` che rende fatale al boot un
> ruleset non applicabile.

### Dove

- `plugins/adminAccessControl/accessControl.default.json5` → sezione `hardcodedRules`
- `scripts/lib/configWizard.js:264` (il wizard che permette il cambio)
- `index.js:563` (elenco directory attivo sul server statico admin)

### Cosa succede

Il pannello di amministrazione è composto da **pagine EJS servite staticamente**
(`core/admin/webPages/`), non da rotte API. Le rotte API hanno il campo `access`
obbligatorio e passano dal route-wrap di `pluginSys`; le **pagine** no: cadono oltre
il router, e l'unica cosa che le protegge è il middleware di `adminAccessControl`.

Quel middleware confronta il path della richiesta con le regole di
`accessControl.json5`, dove la protezione del pannello è scritta **letteralmente**:

```json5
"hardcodedRules": {
  "/admin":    { "requiresAuth": true, "allowedRoles": [0, 1], "priority": 1000 },
  "/admin/**": { "requiresAuth": true, "allowedRoles": [0, 1], "priority": 100  }
}
```

Ma `admin` non è un valore fisso: è `ital8Config.json5 → adminPrefix`, dichiarato
configurabile, modificabile dal wizard di installazione e dalla GUI System Settings.
**Nessun codice sincronizza le due cose.** Cambiare `adminPrefix` in `backoffice`
sposta le pagine su `/backoffice/...`, dove nessuna regola matcha più.

E quando nessuna regola matcha si applica la default policy, che di serie è:

```json5
"defaultPolicy": { "action": "allow" }
```

Cioè: **accesso pubblico**.

### Perché è un problema

Tre fattori si sommano e trasformano un problema di configurazione in un'esposizione
completa delle pagine:

1. **Le pagine admin non hanno una guardia propria.** Ho controllato tutti i file
   `.ejs` sotto `core/admin/webPages/`: solo `themesManagment/index.ejs` e
   `themeView.ejs` leggono `session.user.roleIds`, e lo fanno per **nascondere dei
   pulsanti**, non per negare l'accesso. Nessuna pagina fa un controllo di
   autenticazione lato server.
2. **L'elenco directory è acceso** sul file server admin (`index.js:563`,
   `dirListing: { enabled: true }`), quindi non serve nemmeno indovinare i nomi delle
   sezioni: l'intero albero è navigabile.
3. **`adminPrefix` è pensato come misura di sicurezza per oscurità.** `index.js`
   contiene un commento esplicito: *« ATTENZIONE PER NESSUN MOTIVO DOVRÀ ESSERE
   PASSATO adminPrefix nelle pagine web non di amministrazione »*. Chi lo cambia lo
   fa **credendo di aumentare la sicurezza**, e ottiene l'esatto contrario. È la
   dinamica peggiore: la mossa difensiva è quella che apre la porta.

**Cosa NON succede:** le rotte API restano protette dal route-wrap, quindi un anonimo
non riesce a eseguire azioni (creare utenti, installare plugin). Il danno è la
divulgazione: struttura del pannello, sezioni installate, plugin presenti, endpoint
disponibili, più il markup completo di ogni pagina di gestione.

### Verifica

Eseguendo il matcher reale del progetto con le regole hardcoded reali:

```
findMatchingRule('/backoffice/index.ejs', hardcodedRules) → null
```

`null` significa « nessuna regola » → `applyDefaultPolicy()` → `action: "allow"` →
`allowed: true` → `await next()` → la pagina viene servita.

### Come si corregge

**Il pattern corretto esiste già nel repo, a un file di distanza.**
`core/priorityMiddlewares/runtimeGate.js:60` fa esattamente la cosa giusta:

```js
const adminPrefix = ital8Conf.adminPrefix || 'admin';
```

E `accessManager` fa già la stessa cosa per un altro prefisso — allo start del
middleware toglie `globalPrefix` dal path prima del match, proprio perché i pattern
sono *logici*. Manca solo l'equivalente per `adminPrefix`. Due strade:

- **(a) Iniettare i pattern a runtime.** In `AccessManager.loadRules()`, costruire le
  regole hardcoded in codice a partire da `ital8Conf.adminPrefix`, invece di leggerle
  dal JSON5. Il file resta come documentazione, ma non è più la fonte di verità di una
  regola di sicurezza.
- **(b) Normalizzare il path prima del match.** Come già si fa per `globalPrefix`:
  se il path inizia con `/${adminPrefix}`, riscriverlo in `/admin` ai soli fini del
  confronto.

Preferirei **(a)**: rende impossibile che un file di configurazione modificabile
dall'utente contenga la protezione del pannello.

**Presidio da aggiungere:** un test d'integrazione che avvii l'app con
`adminPrefix: "backoffice"` e asserisca che una `GET /backoffice/` anonima **non**
riceva 200. Senza quel test il difetto rientra alla prima rifattorizzazione.

---

## A2 · Le due reti di sicurezza sulle chiavi di sessione sono entrambe morte

> ✅ **CORRETTO (2026-11-16), v3.39.0.** Chiavi di sessione **pubbliche** → box
> `[SESSION]` + `exit 1`: il CMS non parte. La correzione non è quella proposta in
> fondo alla scheda (predicato robusto + avviso): su decisione del maintainer
> l'avviso è diventato un **gate fail-closed**, perché quando l'unica difesa è un
> avviso, un avviso che non scatta equivale ad assenza di difesa. Scala a tre
> livelli in `core/sessionSecurity.js → classifySessionKeys()`: `fatal` (pubblica
> — prefisso `CHANGE_ME_` **o** placeholder storico) / `weak` (sotto i 16
> caratteri → avviso, il boot prosegue) / `ok`.
>
> **Due rilievi della scheda vanno corretti, sulla base della misura.**
>
> 1. **Il difetto non era un drift: era nato così.** La scheda dice che il commento
>    « Valori attualmente presenti » *« non è più vero »*, implicando una
>    divergenza successiva. In realtà la denylist è arrivata su `main` **già
>    disallineata**: il 12/06/2026 la PR #289 rinominò le chiavi alle 22:19, la PR
>    #290 introdusse la denylist alle **22:43** elencando quelle appena rimosse
>    (ramo biforcato prima, nessun conflitto git, test verdi su entrambi i lati).
>    `keysAreInsecure(chiavi spedite)` ritorna `false` dal primo commit in cui la
>    protezione esiste: **inerte dal giorno uno.**
> 2. **Le chiavi storiche non sono « deboli », sono pubbliche.** Col criterio
>    strutturale proposto, **tre dei quattro** placeholder storici passerebbero per
>    buoni (`key.secondaryKey123`: 19 caratteri, quattro classi). Nessuna euristica
>    rileva « è nota a tutti ». L'elenco esatto resta quindi nel livello `fatal`.
>
> **Due conseguenze che la scheda non menzionava:** il wizard non si limitava a
> preselezionare « Mantieni », **stampava** `✓ Le chiavi attuali risultano già
> personalizzate` — una rassicurazione falsa; e il percorso « Inserisci chiavi
> personalizzate » **accettava `CHANGE_ME_session_key_1` verbatim**.
>
> **Impatto verificato end-to-end** (non per lettura): un cookie firmato con le
> sole chiavi del `.default` pubblico è accettato con `roleIds: [0]`; con firma
> invalida è rifiutato. **Presidio aggiunto**, quello che la scheda chiedeva: un
> test legge il `.default` **realmente spedito** e pretende che il gate lo rifiuti
> — più un test d'integrazione che avvia l'app con chiavi pubbliche e asserisce
> `exit 1` senza che il server sia mai stato in ascolto. Tre mutazioni colte, fra
> cui la riproduzione della collisione del 12 giugno.

**Severità:** 🔴 critica · **Sforzo:** minimo (una riga + un test) · **Presidio mancante:** test che leghi denylist e `.default`

### Dove

- `core/sessionSecurity.js:37` — la denylist
- `core/priorityMiddlewares/koaSession.default.json5:6` — le chiavi spedite
- `scripts/lib/sessionKeyManager.js:104` — il default del wizard

### Cosa succede

Le sessioni di ital8cms sono **cookie firmati** (`signed: true`): il contenuto della
sessione viaggia nel cookie del browser, e il server si fida di quel contenuto perché
è firmato con `app.keys`. Chi conosce quelle chiavi può **fabbricare un cookie
valido** con dentro quello che vuole — per esempio `authenticated: true` e
`roleIds: [0]`, cioè root.

Per questo il progetto ha costruito **due reti di sicurezza**, entrambe basate sullo
stesso predicato in `core/sessionSecurity.js`:

1. un box `[SESSION]` al boot, se le chiavi sono ancora i placeholder;
2. il wizard di installazione, che propone « Genera nuove chiavi » come default
   quando rileva i placeholder.

Il predicato è un confronto **esatto** contro una lista:

```js
const PLACEHOLDER_SESSION_KEYS = Object.freeze([
  // Valori attualmente presenti in core/priorityMiddlewares/koaSession.json5
  'key.segretussimmmmmm',
  'fbtgnrnyrmnytmtymyt',
  'brtnrynynyny',
  'key.secondaryKey123',
]);
```

Quel commento — *« Valori attualmente presenti »* — **non è più vero**. Il `.default`
oggi spedisce altri valori:

```json5
"keys": ["CHANGE_ME_session_key_1", "CHANGE_ME_session_key_2", "CHANGE_ME_session_key_3"]
```

I nuovi placeholder **non sono nella denylist**. Il confronto è `includes()`, esatto,
senza prefissi. Quindi su un'installazione appena clonata:

- `keysAreInsecure(keys)` ritorna **`false`** → il box `[SESSION]` **non viene mai
  emesso**, esattamente nel solo scenario per cui è stato scritto;
- `sessionKeyManager.js:104` fa `default: insecure ? 'generate' : 'keep'` → il wizard
  propone **« Mantieni le chiavi correnti »**, cioè mantieni i placeholder pubblici.

### Perché è un problema

È l'unico difetto della revisione che porta direttamente a **impersonazione di root
senza credenziali**, e per ottenerla basta leggere il repository — che è pubblico.

La gravità però non sta nel valore delle chiavi (un placeholder è un placeholder, va
bene che sia noto): sta nel fatto che **entrambi i meccanismi progettati per
impedire che quel placeholder arrivi in produzione sono silenziosamente disattivati**.
Un amministratore attento che installa il CMS, legge il wizard, non vede nessun
avviso e accetta il default proposto, finisce in produzione con le chiavi pubbliche
**credendo di aver fatto la cosa giusta**.

La documentazione peggiora la situazione: `CLAUDE.md` descrive entrambi i meccanismi
come funzionanti, quindi non c'è modo di accorgersi del buco leggendo i documenti.

### Verifica

`grep -rn "CHANGE_ME"` su tutto il codebase (esclusi `node_modules` e `.git`)
restituisce **una sola occorrenza**: la riga 6 di `koaSession.default.json5`. La
stringa non compare né in `core/sessionSecurity.js`, né in `scripts/`, né in alcun
test. Il disallineamento è totale e non c'è nulla che lo intercetti.

### Come si corregge

Due modifiche, entrambe piccole:

1. **Rendere il predicato robusto al rename.** Invece della sola lista esatta,
   aggiungere un criterio strutturale — per esempio: è insicura ogni chiave che
   inizia con `CHANGE_ME`, o che è più corta di N caratteri, o che non ha entropia
   sufficiente. La lista esatta resta per i valori storici.
2. **Legare la denylist al `.default` con un test.** Il test che serve è banale e
   impedisce per sempre il ritorno del problema:

   ```js
   const def = loadJson5('core/priorityMiddlewares/koaSession.default.json5');
   expect(keysAreInsecure(def.keys)).toBe(true);
   ```

   Se qualcuno rinomina i placeholder senza aggiornare la denylist, il test rosso lo
   dice subito.

**Nota collaterale, stessa area:** valutare di spostare le chiavi in una variabile
d'ambiente, come il commento del `.default` già suggerisce. Rimuoverebbe la classe di
problema alla radice invece di presidiarla.

---

> ✅ **CORRETTO (2026-10-31), come effetto della monotonia introdotta dalle fasi
> 1-3 di [`docs/decisions/path-zones.it.md`](./docs/decisions/path-zones.it.md).**
> Una regola può solo **stringere**, mai allentare, il `baseline` della sua zona:
> a runtime vince il `baseline`, e al caricamento il tentativo è un problema
> `baseline-violation` che da Fase 3 non fa partire il CMS. Le `hardcodedRules`
> restano nel `.default` come documentazione, non più come fonte di verità.

## A3 · Le regole hardcoded del controllo accessi non sono immutabili

> ✅ **CORRETTO (2026-10-31), fasi 1-3 di [`docs/decisions/path-zones.it.md`](./docs/decisions/path-zones.it.md)** —
> dallo stesso intervento che ha chiuso A1, e **non** da una correzione del
> tie-break. La distinzione conta, perché il meccanismo descritto qui sotto è
> **ancora esattamente quello**: rieseguita il 22/11/2026 la verifica di questa
> scheda sul codice di oggi, `findMatchingRule` su una custom `/**` accanto alla
> hardcoded `/admin/**` restituisce ancora `{ pattern: '/**', requiresAuth: false }`,
> e fra `/x/**` e `/x/y/**` vince ancora il primo. Il `>` di
> `core/patternMatcher.js:186` non è stato toccato.
>
> **Cos'è cambiato, allora.** Due cose, e insieme rendono il difetto incapace di
> produrre la sua conseguenza:
>
> 1. **Il minimo d'accesso del pannello non vive più in un file.** Sta nel
>    `baseline` della zona, in codice (`core/pathZoneResolver.js`), quindi non
>    dipende da `accessControl.json5`: misurato in A1, il pannello resta protetto
>    anche con quel file svuotato, illeggibile o cancellato — e a maggior ragione
>    con una custom catch-all che vince il tie-break.
> 2. **Un ruleset in cui il difetto morderebbe non si carica in silenzio.** Le sonde
>    di `core/accessInvariantCheck.js` sono **generate dalla mappa delle zone** (ogni
>    zona con `baseline.requiresAuth: true` produce una sonda anonima che si aspetta
>    `deny`) e passano per la **vera funzione di decisione**, a ogni caricamento del
>    ruleset. Una custom `/**` con `requiresAuth: false` fa quindi fallire la sonda su
>    `/admin/` → box `[ACCESS]`. Il modulo nomina questo caso come la ragione per cui
>    esiste: *« non vede una regola custom che scavalca il baseline della zona — cioè
>    A3 »*.
>
> **Il residuo da conoscere, e dove vive.** Resta falsa la promessa scritta nei
> commenti del config e in `CLAUDE.md` — *« in caso di conflitto vince la regola più
> specifica »* — perché fra due `**` la specificità non è considerata affatto: vince
> l'ordine di inserimento. Fuori dalle zone con baseline chiuso, un amministratore
> può ancora scrivere due regole e vedere applicata quella che non si aspetta. È la
> stessa famiglia di **A4** (« regole che proteggono l'insieme sbagliato di URL, in
> silenzio »), che è **aperta**: i tre interventi proposti in fondo a questa scheda —
> fascia di priorità riservata, tie-break sulla specificità — vanno fatti **lì**, dove
> il tema è il matching e non l'immutabilità.
>
> Spuntata ma senza banner per tre settimane: chi rileggeva questa scheda la trovava
> identica all'originale e non aveva modo di sapere cosa l'avesse chiusa.

**Severità:** 🔴 alta · **Sforzo:** basso · **Presidio mancante:** test sul tie-break *(il presidio aggiunto è comportamentale e sta a livello di zona — vedi il banner; un test unitario sul tie-break in sé continua a non esserci, e la sua casa naturale è A4)*

### Dove

- `core/patternMatcher.js:186` — il confronto di priorità
- `plugins/adminAccessControl/lib/accessManager.js:55` — l'ordine di fusione

### Cosa succede

`accessControl.json5` ha due sezioni: `hardcodedRules`, dichiarate **immutabili** e
non modificabili dalla UI, e `customRules`, che l'amministratore scrive liberamente.
`AccessManager.loadRules()` le fonde così:

```js
this.rules = {
  ...config.customRules,
  ...config.hardcodedRules   // "Hardcoded sovrascrive custom se conflitto"
};
```

Lo spread protegge dal caso in cui **la stessa chiave** compaia in entrambe: se una
custom si chiama `/admin/**`, quella hardcoded la sovrascrive. Ma non protegge da
nient'altro — e in particolare non cambia **l'ordine di iterazione**: le chiavi di
`customRules` sono inserite per prime, quindi in `Object.entries()` escono per prime.

Qui entra il secondo pezzo. `findMatchingRule` sceglie la regola vincente così:

```js
if (rulePriority > highestPriority) {   // strettamente maggiore
  highestPriority = rulePriority;
  bestMatch = { pattern, ...rule };
}
```

`>` e non `>=`: **a parità di priorità vince la prima incontrata**. E le custom sono
sempre le prime.

Le priorità automatiche sono per **tipo di pattern**, non per specificità:
esatto 1000, regex 500, wildcard singolo 300, wildcard ricorsivo 100. Due wildcard
ricorsivi hanno quindi **la stessa identica priorità**, per quanto uno sia molto più
specifico dell'altro.

### Perché è un problema

Una regola custom `/**` — catch-all, priorità automatica 100 — batte la regola
hardcoded `/admin/**`, che ha anch'essa priorità 100 ma viene iterata dopo.
L'invariante centrale del plugin (*« le hardcoded proteggono aree critiche e hanno
priorità massima »*) **non regge**, e il `ruleValidator` non rifiuta la regola
catch-all.

Cade anche la seconda promessa, quella scritta nei commenti del file di
configurazione e in `CLAUDE.md`: *« In caso di conflitto, la regola più specifica
vince »*. Fra due `**` la specificità **non viene considerata affatto**: vince
l'ordine di inserimento, che è un dettaglio implementativo e non una regola che
qualcuno possa prevedere leggendo la documentazione.

Non richiede un attaccante: basta un amministratore che scrive una regola generale
(*« tutto il sito richiede login »*, oppure il suo opposto) senza sapere che così
disattiva la protezione del pannello.

### Verifica

Eseguendo `core/patternMatcher.js` reale, con la stessa fusione che fa `accessManager`:

```
custom:    { '/**':        { requiresAuth: false } }   // priorità automatica 100
hardcoded: { '/admin/**':  { requiresAuth: true  } }   // priorità 100

findMatchingRule('/admin/usersManagment/index.ejs', {...custom, ...hardcoded})
  → { pattern: '/**', requiresAuth: false, allowedRoles: [] }
```

E il caso « la più specifica vince », isolato:

```
{ '/x/**': {tag:'A'}, '/x/y/**': {tag:'B'} } su '/x/y/z'  →  vince '/x/**'
```

### Come si corregge

Tre interventi complementari, tutti localizzati:

1. **Fascia di priorità riservata alle hardcoded.** In `loadRules()`, sommare un
   offset (es. `+10000`) alla priorità di ogni regola hardcoded. Rende l'immutabilità
   una proprietà del **codice**, non dell'ordine delle chiavi in un oggetto.
2. **Tie-break sulla specificità.** In `findMatchingRule`, a parità di priorità
   preferire il pattern **più lungo** (o con più segmenti fissi). Rende vera la frase
   già scritta in documentazione.
3. **Iterare le hardcoded per prime**, invertendo lo spread — utile comunque come
   difesa in profondità, ma da solo non basta ed è la ragione per cui non lo elenco
   come fix principale.

**Presidio:** un test che metta una custom `/**` accanto alla hardcoded `/admin/**` e
asserisca che su `/admin/qualcosa` vinca la hardcoded.

---

## A4 · Regex non ancorate e mix `*`/`**` che sbaglia in silenzio

> ✅ **CORRETTO (2026-11-22), v3.43.0.** Entrambi i difetti, con la strada più
> invasiva delle due proposte — **ancorare**, non « pretendere gli ancoraggi » —
> su decisione del maintainer: progetto in beta, nessun utilizzatore terzo,
> breaking change ammesso e documentato (regola 11).
>
> 1. **Le regex sono ancorate:** il corpo è compilato come `^(?:corpo)$`. Il
>    gruppo non catturante non è cosmetico — senza, un corpo con alternative di
>    primo livello cambierebbe significato (`^/a|/b$` è « inizia con /a OPPURE
>    finisce con /b »).
> 2. **I wildcard sono compilati in un passaggio unico** (`wildcardToRegex`):
>    `**` → `.*`, `*` → `[^/]+`, tutto il resto escapato. Elimina la classe di
>    problema invece del caso singolo, quindi il rimedio-tampone proposto qui
>    sotto — *far rifiutare i pattern misti* — **non serve più**: un pattern
>    misto ora funziona. `*` resta `[^/]+` e non `[^/]*`: « un segmento
>    qualsiasi » non è « nessun segmento », quindi `/admin//config` non matcha
>    `/admin/*/config`.
>
> **Il raggio d'impatto era più ampio di quanto questa scheda dicesse.** Qui si
> legge « condiviso fra `adminAccessControl` e `seo` »: i consumatori sono
> **sette**, due nel core (`csrfProtection`, `urlRedirect`, `sentinel`,
> `core/pathZoneResolver`, `core/botDetector`). E le semantiche volute sono
> **opposte**: chi protegge vuole il path intero, `sentinel` — che *rileva* —
> vuole « contiene dovunque ».
>
> **🐞 Conseguenza misurata, e la ragione per cui l'ancoraggio non è bastato:**
> le due regole `path` di `sentinel` che cercano chiavi SSH e webshell passavano
> da `true` a `false` con l'ancoraggio — `/.ssh/id_rsa` e
> `/uploads/img/shell.php` non venivano più intercettati. Sarebbero rimaste nel
> file, **valide e inerti**. Riscritte con i `.*` espliciti e portate sulle
> installazioni esistenti dalla migrazione **sentinel v7 → v8**. I test del
> plugin hanno colto il problema da soli (7 fallimenti), che è il modo in cui si
> vorrebbe scoprire sempre una cosa così.
>
> **Non toccata, e verificato perché:** la regola `query` di `sentinel` usa lo
> stesso prefisso `regex:` ma **non passa dal matcher** — `query`, `userAgent` e
> gli header li compila il plugin in `lib/ruleValidator.js`
> (`new RegExp(source, 'i')`, senza ancoraggi e case-insensitive). Una prima
> stesura della migrazione la riscriveva, inutilmente.
>
> **Effetto collaterale a valle, dichiarato:** in `core/pathZoneResolver.js` il
> difetto di un prefisso che contiene `*` si è **capovolto** — era
> « la zona resta scoperta » (il `*` era un quantificatore), ora è « la zona si
> estende a path che non sono quel prefisso ». L'avviso resta, con la ragione
> corretta.
>
> **Presidi:** 58 test in `tests/unit/patternMatcher.test.js`, fra cui la tabella
> che questa scheda chiedeva — pattern misti, regex con e senza ancoraggi,
> wildcard su segmento vuoto, asterisco letterale, metacaratteri, cache.
>
> *Resta aperto, ed è il residuo di A3 che questa scheda aveva ereditato:* la
> priorità dipende dal **tipo** di pattern e non dalla specificità, quindi fra
> due `**` vince l'ordine di inserimento (`/x/**` batte `/x/y/**` su `/x/y/z`).
> I due rimedi — fascia di priorità riservata alle hardcoded, tie-break sulla
> lunghezza — sono registrati in `TODO.md` §6: cambiano la risoluzione delle
> regole per tutti e meritano una decisione a sé, non una coda a questa.

**Severità:** 🔴 alta · **Sforzo:** basso · **Presidio mancante:** validazione dei pattern misti *(non più necessaria: con il compilatore a passaggio unico un pattern misto è valido e funziona — vedi il banner)*

### Dove

- `core/patternMatcher.js:118` — `matchRegex`
- `core/patternMatcher.js:164` — `matchWildcardRecursive`
- `core/patternMatcher.js:211` — `validatePattern`, che non intercetta né l'uno né l'altro

### Cosa succede

Due difetti distinti nello stesso modulo, che è condiviso fra `adminAccessControl`
(protezione degli URL) e `seo` (regole per pagina).

**(1) Le regex non sono ancorate.**

```js
const regexStr = pattern.substring(6);          // toglie "regex:"
this.regexCache.set(regexStr, new RegExp(regexStr));
return regex.test(url);
```

`RegExp.test()` senza `^` e `$` è un match di **sottostringa**. La regola
`regex:/admin/users` non descrive « il path `/admin/users` », descrive « qualunque
path che contenga da qualche parte `/admin/users` ».

**(2) Un `*` singolo dentro un pattern `**` resta un quantificatore regex.**

`getPatternInfo` classifica il pattern guardando solo se contiene `**`. Se lo
contiene, `matchWildcardRecursive` sostituisce **solo** `**`:

```js
.replace(/[.+?^${}()|[\]\\]/g, '\\$&')   // escape — nota: '*' NON è nella lista
.replace(/\*\*/g, '.*')                   // ** → .*
```

L'asterisco singolo rimasto non viene né sostituito né escapato: finisce nella regex
finale **come asterisco regex**, cioè come « zero o più occorrenze del carattere
precedente ». Il pattern `/admin/*/config/**` diventa la regex
`^/admin/*/config/.*$`, che significa: `/admin` seguito da **zero o più slash**,
poi `/config/`. Non ha più niente a che vedere con « un segmento qualsiasi ».

### Perché è un problema

Il modulo serve, fra le altre cose, a **proteggere URL**. Una regola che matcha
l'insieme sbagliato è il guasto peggiore possibile in quel ruolo, e qui accade
**senza alcun segnale**: nessun errore, nessun warning al boot, `validatePattern`
approva entrambe le forme. L'amministratore scrive una regola, la vede accettata
dalla UI, e crede che protegga qualcosa che non protegge.

Il difetto (2) è particolarmente insidioso perché **inverte** il comportamento: la
regola non protegge il caso previsto e protegge invece un caso non previsto. Chi la
prova con l'URL sbagliato la vede « funzionare ».

Il difetto (1) interagisce con A3: le regex hanno priorità 500, sopra i wildcard, e
una regex troppo larga può soffiare il match a una regola più corretta.

### Verifica

Eseguendo il matcher reale:

```
matches('/public/admin/users', 'regex:/admin/users')  → true    ← non ancorata
matches('/admin/x/config/y',   '/admin/*/config/**')  → false   ← doveva matchare
matches('/admin/config/y',     '/admin/*/config/**')  → true    ← non doveva
```

### Come si corregge

- **Ancorare le regex**, avvolgendole in `^(?:…)$` alla compilazione. È un cambio di
  comportamento per chi avesse regole esistenti che si affidano al match parziale:
  va annotato in `CHANGELOG.md` (il progetto è alpha, i breaking change sono
  ammessi se documentati). L'alternativa meno invasiva è **pretendere** gli
  ancoraggi in `validatePattern`, rifiutando al boot le regex che non li hanno.
- **Compilare i wildcard in un solo passaggio.** Sostituire i due metodi separati con
  un unico compilatore che, in una sola scansione, traduca `**` → `.*` e `*` →
  `[^/]*`, escapando tutto il resto. Elimina la classe di problema invece del caso
  singolo.
- **Nel frattempo**, far rifiutare a `validatePattern` i pattern che mescolano `*` e
  `**`: è una riga, e trasforma un guasto silenzioso in un errore al boot.

**Presidio:** una tabella di casi in `tests/unit/` che copra pattern misti, regex con
e senza ancoraggi, e wildcard su segmento vuoto.

---

## A5 · Nessun security header, e cookie di sessione senza `secure`

> ✅ **CORRETTO (2026-11-23), v3.44.0.** Middleware core
> `core/priorityMiddlewares/securityHeaders.js`, montato subito dopo il gate
> canonico. Di serie: `nosniff` e `Referrer-Policy:
> strict-origin-when-cross-origin` su **tutte** le superfici, `X-Frame-Options:
> DENY` **solo** su quelle riservate (il sito pubblico resta inquadrabile di
> proposito), HSTS **solo** con `https.enabled` e con `max-age` di **un giorno**,
> non di un anno. Cookie di sessione: `secure` risolto da `https.enabled`.
>
> **I tre contesti si derivano dalle ZONE, non da un elenco di prefissi.**
> `admin` = ogni zona con `baseline.requiresAuth: true`, quindi anche `views` e le
> risorse del tema admin — ed è lo stesso criterio del `reservedGate`, per la
> stessa ragione: un elenco a mano è il difetto A1 che aspetta di tornare. Una
> zona nuova eredita gli header senza dichiarare nulla.
>
> **🐞 La correzione del cookie proposta da questa scheda non funziona.** Diceva
> `"secure": "auto"` *« koa-session lo supporta »*. Misurato avviando il server:
> `koa-session` **7** valida le opzioni con zod e `secure` deve essere un
> **booleano** — con la stringa il boot muore con uno `ZodError` e **il CMS non
> parte**. Il sentinella `"auto"` resta nel file perché dice a chi legge cosa
> accade, e viene risolto in booleano al montaggio. Conseguenza da conoscere nello
> scenario « HTTPS e HTTP in parallelo »: il cookie viaggia solo sul lato HTTPS,
> quindi il login funziona solo là — che è il punto.
>
> **La CSP è spedita SPENTA, e la decisione di accenderla ora ha una misura.**
> Accendendo la policy consigliata su tutti e tre i contesti, la suite e2e (96
> test su Chromium) produce **un solo fallimento**: la pagina di login di
> `adminUsers` contiene uno `<script>` **inline** (`webPages/login.ejs:84`) che
> `default-src 'self'` blocca. Tutto il resto, pannello compreso, passa. Le tre
> strade sono in [`docs/security-headers.it.md`](./docs/security-headers.it.md).
>
> **Limite dichiarato:** gli header non coprono le risposte generate da
> un'**eccezione** propagata — `ctx.onerror` di Koa rimuove tutti gli header
> prima di scrivere la sua risposta. Coprono le risposte di errore « normali »
> (404/403 assegnati). È un limite del framework, non una scelta.
>
> **Non sovrascrive** ciò che un plugin ha già impostato, e si vede su una
> risposta reale: il 404 di `koa-classic-server` porta una CSP più stretta
> (`default-src 'none'`) e un `Referrer-Policy: no-referrer` suoi, rispettati.
>
> **Presidi:** 24 test in `tests/unit/core/securityHeaders.test.js` (derivazione
> del contesto zona per zona, header per superficie, HSTS gated, non-sovrascrive,
> risposte di errore), più la verifica sulle risposte **reali** di un server
> avviato.
>
> **Rifinita il 2026-11-25 (v3.51.0), su revisione del codice.** Due cuciture:
> **(a)** `secure: true` sul cookie di sessione **con HTTPS acceso ma HTTP ancora
> in ascolto** fa rispondere **500** a ogni richiesta HTTP — il modulo `cookies`
> lancia invece di degradare. Ora il flag è `true` solo quando l'HTTP non è una
> via d'accesso, cioè `https.enabled && AutoRedirectHttpPortToHttpsPort`; nel
> caso a doppio ascolto resta `false` **con un avviso al boot** che nomina il
> perché. La decisione è estratta in `resolveSecureCookieFlag()`, verificabile da
> sola. **(b)** `X-Frame-Options: DENY` sulle superfici riservate arrivava dal
> `.default`, quindi un'installazione **già esistente** — che il `.default` non lo
> rigenera — restava senza l'header fino alla migrazione. Ora il default severo è
> **nel codice** (`DEFAULTS_PER_CONTESTO`), e il config lo sovrascrive solo se lo
> dichiara: l'indurimento vale dal **primo** riavvio.

**Severità:** 🔴 alta (sistemica) · **Sforzo:** medio · **Natura:** lavoro nuovo, non una correzione

### Dove

- `core/priorityMiddlewares/runtimeGate.js:217` — **l'unico** punto del progetto che imposta header di sicurezza
- `core/priorityMiddlewares/koaSession.default.json5` — il cookie di sessione
- `index.js` — le quattro istanze di `koa-classic-server`, nessuna con header

### Cosa succede

Cercando in tutto il codebase `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, si trovano
**solo dentro `runtimeGate.js`**, cioè sulla pagina di manutenzione e sulle risposte
di rifiuto dei gate. Le risposte normali — sito pubblico, plugin pages, pannello
admin, API — non ne hanno nessuno.

In parallelo, il cookie di sessione è configurato con `httpOnly`, `signed` e
`sameSite: lax` — tutte scelte corrette e ben motivate nei commenti — ma **manca
`secure`**, anche quando `https.enabled: true`.

### Perché è un problema

Non è un problema teorico, perché tre condizioni specifiche di questo progetto lo
rendono concreto:

1. **Il pannello admin renderizza dati controllati da terzi.** Nomi di plugin, temi,
   file, indirizzi IP, User-Agent. Il progetto ha già investito molto nella difesa XSS
   a due livelli (`core/escapeHtml.js` lato server + `escapeHtml.js` lato client), che
   è la difesa giusta — ma una **CSP** è la rete che raccoglie ciò che sfugge, e non c'è.
2. **I media caricati dagli utenti sono serviti dalla stessa origin.** La cartella
   media sta sotto `wwwPath`. Il `fileValidator` fa un buon lavoro (whitelist di
   estensioni + magic bytes, SVG correttamente escluso), ma senza
   `X-Content-Type-Options: nosniff` un file poliglotta — banale con GIF, che richiede
   solo `GIF8` in testa — può essere interpretato dal browser come qualcosa di diverso
   da un'immagine.
3. **Senza `secure`, il cookie di root viaggia in chiaro.** Basta una singola
   richiesta HTTP verso il sito (un link vecchio, un redirect, una risorsa
   mista) perché il cookie di sessione finisca sulla rete non cifrato, anche su
   un'installazione interamente HTTPS.

Manca anche `X-Frame-Options`/`frame-ancestors`, quindi il pannello è inquadrabile in
un iframe: clickjacking sulle azioni amministrative.

### Verifica

Lettura incrociata: `grep` sui cinque nomi di header su `core/`, `plugins/`,
`themes/`, `index.js` restituisce solo `runtimeGate.js` e i suoi test. La chiave
`secure` non compare in `koaSession.default.json5`.

### Come si corregge

Un **middleware di header nei priority middlewares**, montato subito dopo il gate
canonico (prima di tutto il resto, così copre anche le risposte di errore):

- `X-Content-Type-Options: nosniff` — sempre, senza eccezioni, è puro guadagno;
- `X-Frame-Options: DENY` (o `frame-ancestors 'none'` in CSP) sui prefissi admin;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Strict-Transport-Security` **solo** quando `https.enabled` — attivarlo in HTTP
  puro renderebbe il sito irraggiungibile;
- **CSP configurabile per contesto** (`wwwPath` / `pluginPages` / `adminPrefix`), con
  un default permissivo sul pubblico e più stretto sull'admin. La CSP è l'unico punto
  che richiede cautela: i temi possono legittimamente avere script inline, quindi va
  introdotta come opt-in con un default che non rompa le installazioni esistenti.

Per il cookie: `"secure": "auto"` in `koaSession.default.json5` — `koa-session` lo
supporta e degrada correttamente in HTTP locale, quindi non rompe lo sviluppo.

---

## A6 · `checkInTemplate` — la guardia documentata per i template non protegge

> ✅ **CORRETTO (2026-11-23), v3.44.0.** Tutti e tre i difetti, con **entrambe**
> le strade proposte in fondo alla scheda.
>
> 1. **Il rendering si ferma davvero.** La guardia imposta il redirect e poi
>    lancia `AccessDeniedError` (`core/accessDeniedError.js`), che `index.js`
>    intercetta nei suoi **tre** punti di render senza assegnare il corpo. Il
>    redirect è impostato *prima* del lancio, quindi chi intercetta non deve
>    fabbricare una risposta.
> 2. **Il percorso documentato ora esiste:** `passData.plugin.adminAccessControl`,
>    perché `pluginSys` indicizza questi oggetti per nome di plugin.
> 3. **La firma documentata è quella vera.** Niente più `ctx` a `undefined` e
>    `TypeError` dall'interno del template: se il secondo argomento manca, la
>    guardia lancia un errore che **dice cosa scrivere**.
>
> **Il parametro non è sparito, e la ragione è misurata.** La scelta era
> « recuperare `ctx` da `passData` » per rendere corretta la forma a un argomento
> solo. Non è possibile: gli oggetti di `getObjectToShareToWebPages()` sono
> costruiti **una volta al boot** (`index.js:358`) e riusati da tutte le
> richieste, quindi non possono catturare un `ctx` per-richiesta. Servirebbe uno
> strato di binding per-richiesta nel sistema plugin, che toccherebbe l'oggetto
> condiviso di **ogni** plugin — fuori dalla portata di questa correzione. La
> guardia accetta quindi `passData` (la forma documentata) o un `ctx` nudo (per
> chi l'avesse già scritta).
>
> **Aggiunta la variante non lanciante:** `canAccess({...}, passData) → boolean`,
> per chi vuole mostrare un messaggio invece di essere rediretto. La guardia che
> *protegge* resta `check()`.
>
> **Un difetto in più, corretto:** quando `accessManager` non è inizializzato la
> guardia faceva `return`, cioè **proseguiva** col rendering della pagina
> protetta. Ora lancia: senza il gestore non si può affermare che l'accesso sia
> consentito.
>
> **Presidi:** 12 test in `tests/unit/accessManagerTemplateGuard.test.js`. Quello
> che conta rende un template EJS **vero** che chiama la guardia, con lo stesso
> `try/catch` di `index.js`, e pretende che il corpo non contenga la pagina; più
> un presidio **strutturale** che conta i punti di render di `index.js` e pretende
> che ognuno sia coperto, così un quarto aggiunto domani non riapre il difetto in
> silenzio. **Mutazione** (via il `throw`): 4 fallimenti.

**Severità:** 🔴 alta (come API), 🟢 nulla (come esposizione attuale) · **Sforzo:** basso

### Dove

- `plugins/adminAccessControl/lib/accessManager.js:262` — l'implementazione
- `plugins/adminAccessControl/main.js:268` — la documentazione d'uso

### Cosa succede

Il plugin espone ai template una funzione di guardia, documentata così:

```
Uso: <% passData.accessControl.check({ requiresAuth: true, allowedRoles: [102, 104] }) %>
Se accesso negato, fa redirect automaticamente
```

Ha **tre difetti sovrapposti**, ognuno sufficiente a renderla inutilizzabile.

**(1) Non ferma il rendering.** `checkInTemplate` chiama `ctx.redirect(...)` e poi
fa `return` — ma quel `return` esce solo dalla funzione, non dal template. Il template
EJS **prosegue**, e alla fine `index.js` fa:

```js
ctx.body = await ejs.renderFile(filePath, { passData, ...globalFunctions });
```

Koa mantiene lo status 302 (era stato impostato esplicitamente), ma il corpo della
risposta diventa **la pagina protetta, renderizzata per intero**. Un browser segue il
redirect e nasconde il problema; `curl` senza `-L` legge tutto il contenuto.

**(2) Il percorso documentato non esiste.** Gli oggetti restituiti da
`getObjectToShareToWebPages()` finiscono in `passData.plugin.{nomePlugin}`
(`core/pluginSys.js:697`). Il percorso corretto è quindi
`passData.plugin.adminAccessControl.check`, non `passData.accessControl.check`.

**(3) La firma documentata omette un parametro.** L'implementazione è
`check(requirements, ctx)`; l'esempio passa un solo argomento. Con `ctx` a `undefined`,
`ctx.session?.user` lancia un `TypeError` e il template esplode.

### Perché è un problema

Oggi **nessun template del progetto la usa** (verificato con `grep` su tutti gli
`.ejs`), quindi non c'è esposizione in corso. Ma è **API pubblica documentata** in un
plugin di sicurezza: il primo autore di plugin o tema che la segue crede di aver
protetto una pagina e non l'ha protetta — e lo scopre solo se qualcuno guarda la
risposta con uno strumento che non segue i redirect.

Il difetto (1) è quello che conta: gli altri due si notano subito (il template esplode
o non fa nulla), mentre (1) **funziona apparentemente**, ed è il modo peggiore in cui
un controllo di accesso può fallire.

### Verifica

Lettura del flusso di rendering in `index.js` (tutte e tre le istanze
`koa-classic-server` con `template.render` seguono lo stesso schema: renderizzano e
assegnano `ctx.body` incondizionatamente) più la firma reale in `main.js:276`,
confrontata con la docstring soprastante.

### Come si corregge

Per il difetto (1) ci sono due strade pulite:

- **Far lanciare un'eccezione sentinella** (es. `AccessDeniedError`), intercettata nel
  `template.render` di `index.js`, che a quel punto non assegna il corpo. È la
  soluzione che mantiene la sintassi documentata (una riga nel template).
- **Restituire un booleano** e cambiare la documentazione in
  `<% if (!check(...)) return %>` — EJS supporta il `return` nel corpo compilato.
  Più semplice da implementare, ma sposta la responsabilità sull'autore del template,
  che è proprio ciò che l'helper voleva evitare.

Per (2) e (3): correggere la docstring in `main.js` con il percorso e la firma reali.
Se possibile, eliminare del tutto il parametro `ctx` recuperandolo da `passData`, così
la firma documentata diventa anche quella corretta.

**Presidio:** un test che invochi la guardia su una richiesta anonima e asserisca che
il corpo della risposta **non** contenga il contenuto della pagina.

---

## A7 · Server di redirect HTTP→HTTPS: DoS remoto + open redirect

> ✅ **CORRETTO (2026-11-22), v3.42.0.** Applicata la soluzione proposta in fondo
> alla scheda, tutti e tre i punti.
>
> 1. **Whitelist invece di « sanificazione ».** `path.basename` non era una
>    difesa — restituisce `..` tale e quale — e al suo posto c'è
>    `ACME_TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/`: o il nome ha la forma di un
>    token ACME, o non si legge niente. Nessun caso limite da indovinare.
> 2. **La lettura è dentro `try/catch`**, e non fa più `existsSync` prima di
>    leggere: un solo ramo copre « non esiste » (ENOENT), « è una directory »
>    (EISDIR — la causa del DoS) e « permessi » (EACCES), e sparisce la finestra
>    fra il controllo e l'uso. L'intero handler del server grezzo è a sua volta
>    avvolto in `try/catch`, perché è l'unico strato che quel codice ha: non
>    passa da Koa, quindi un'eccezione arrivava a `uncaughtException` e
>    `processSafetyNet` chiudeva il processo con `respawn: false`.
> 3. **Il redirect non si fida più di `Host`.** Nuova chiave
>    `ital8Config.json5 → https.publicHost`: se configurata, l'host del
>    `Location` è un dato dell'**installazione** e non della richiesta. Se vuota
>    il comportamento storico resta, ma solo per host di forma plausibile — e al
>    boot compare un avviso. Documentata in
>    [`docs/https.it.md`](./docs/https.it.md) → *L'header Host e `publicHost`*.
>
> **Le due copie sono diventate una.** La lettura del token viveva due volte —
> nel server grezzo e nella rotta Koa — e la correzione andava quindi applicata
> due volte: è la forma con cui una correzione ne raggiunge **una sola** (è
> appena accaduto altrove, v3.41.0). Ora entrambe chiamano `readAcmeToken()`.
>
> **Un cambiamento di comportamento da conoscere:** sul server di redirect un
> token assente o malformato risponde ora **404** invece di ricadere sul 301.
> Rimandare una challenge su HTTPS la farebbe fallire comunque — il certificato
> è proprio quello che si sta tentando di ottenere — e così i due rami dicono la
> stessa cosa (la rotta Koa il 404 lo dava già).
>
> **Presidi, i due chiesti qui sotto più i casi positivi:** 32 test in
> `tests/unit/core/httpsManager.test.js`. Le richieste di traversal sono scritte
> su un **socket grezzo**, non con `http.request`, perché il client HTTP di Node
> può normalizzare il path e un test che non mette `..` sul filo verificherebbe
> un'altra cosa. **Due mutazioni, entrambe colte:** rimettere `path.basename`
> senza `try/catch` → **8 fallimenti**; rifidarsi dell'header `Host` → **4**.
>
> *Resta aperta, e non è un residuo di questa scheda:* far servire le challenge
> a Koa anche sulla porta 80, eliminando il server grezzo. Registrata in
> `TODO.md` §6 — è una modifica architetturale, non una correzione.

**Severità:** 🔴 alta · **Sforzo:** minimo · **Condizione:** configurazione Let's Encrypt

### Dove

- `core/httpsManager.js:231` — lettura del token ACME
- `core/httpsManager.js:242` — costruzione del redirect
- `core/httpsManager.js:196` — la variante sul router Koa (impatto minore)

### Cosa succede

Quando si attiva HTTPS con redirect automatico, `createHttpRedirectServer()` avvia un
`http.createServer` **grezzo** sulla porta HTTP. È importante capire cosa significa:
quel server **non passa dall'applicazione Koa**, quindi non attraversa il gate
`rejectNonCanonicalPaths`, né i gate di manutenzione, né nulla. È codice esposto
direttamente a Internet, senza alcuno strato difensivo davanti.

Dentro, per servire le challenge ACME:

```js
const safeToken = path.basename(req.url);        // il commento dice "previene path traversal"
const tokenPath = path.join(challengeDir, safeToken);
if (fs.existsSync(tokenPath)) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(fs.readFileSync(tokenPath, 'utf8'));   // nessun try/catch
}
```

`path.basename` **non** è una difesa da traversal: è una funzione che estrae l'ultimo
segmento di un percorso, e l'ultimo segmento di `/.well-known/acme-challenge/..` è la
stringa `'..'`, che `basename` restituisce tale e quale. Poi `path.join(dir, '..')`
risale alla directory padre, `existsSync` su una directory è **vero**, e
`readFileSync` su una directory lancia `EISDIR`.

Quell'errore è **sincrono e non catturato**, dentro il callback di un server HTTP
grezzo: risale fino a `uncaughtException`, dove `core/processSafetyNet.js` lo
trasforma in `gracefulShutdown('fatal-error', { respawn: false, exitCode: 1 })`.
**Il processo esce.**

Due righe più sotto, il redirect vero e proprio:

```js
const hostname = (req.headers.host || 'localhost').split(':')[0];
res.writeHead(301, { 'Location': 'https://' + hostname + portSuffix + req.url });
```

`Host` è un header **scelto dal client**. Chiunque può ottenere un `301` verso un
dominio arbitrario partendo da un URL del sito.

### Perché è un problema

Il DoS è la parte grave: **una singola richiesta, senza autenticazione, spegne il
sito**. E `respawn: false` significa che non si rialza da solo — serve il supervisore
esterno, se c'è. Il costo per l'attaccante è una richiesta HTTP; il costo per il
gestore è il downtime completo.

La condizione di attivazione non è esotica, è **la configurazione di produzione
raccomandata**: `https.enabled: true` + `AutoRedirectHttpPortToHttpsPort: true` +
`acmeChallenge.enabled: true`, cioè HTTPS con rinnovo automatico Let's Encrypt.

L'open redirect è meno grave ma reale: è il mattone classico degli attacchi di
phishing (« il link parte davvero dal tuo dominio »), e se davanti c'è una CDN diventa
un vettore di cache poisoning.

La variante sul router Koa (riga 196) condivide il `readFileSync` senza try/catch, ma
lì l'impatto è minore: il gate canonico rifiuta già `..` con un 400, e comunque Koa
cattura l'eccezione e risponde 500 invece di far cadere il processo.

### Verifica

Lettura del codice. La catena è meccanica e verificabile passo per passo:
`path.basename('/.well-known/acme-challenge/..')` → `'..'` (comportamento documentato
di Node); `path.join(dir, '..')` → directory padre; `fs.existsSync(dir)` → `true`;
`fs.readFileSync(dir)` → `EISDIR` sincrono; nessun `try` nello stack fino a
`processSafetyNet`, che è installato per fare esattamente `process.exit(1)`.

### Come si corregge

Tre modifiche, tutte di poche righe:

1. **Validare il token invece di « sanificarlo ».** I token ACME hanno una forma nota:
   `/^[A-Za-z0-9_-]{16,128}$/`. Una whitelist rifiuta `..`, la query string e tutto il
   resto, e non ha casi limite come `basename`.
2. **`try/catch` attorno alla lettura**, in entrambe le varianti (riga 196 e riga 231):
   una richiesta malformata non deve mai poter uscire dal suo handler. Vale come regola
   generale per tutto ciò che gira fuori da Koa.
3. **Non fidarsi di `Host` per il redirect.** Confrontarlo con una allowlist
   configurata (o con un nuovo `https.publicHost`), e in caso di mancata
   corrispondenza usare il valore configurato invece di quello ricevuto.

**Presidio:** un test che invii `GET /.well-known/acme-challenge/..` al server di
redirect e asserisca una risposta 404, e uno che invii un `Host` estraneo e asserisca
che il `Location` non lo contenga.

---

# 🟠 B — Correttezza e integrità dei dati

## B1 · Il file delle credenziali è scritto in modo non atomico

> ✅ **CORRETTO (2026-11-23), v3.45.0.** Le due scritture di `userAccount.json5`
> passano ora da `core/json5UpdateQueue.js`, che legge-modifica-scrive dentro una
> coda **per file** e scrive tramite `saveJson5` — già atomico (temp + rename).
> Chiude B1 e B2 con lo stesso strato, come suggeriva questa scheda, e vale per
> qualunque store futuro.
>
> **Il limite, dichiarato:** la coda vive in memoria, quindi copre un **solo
> processo**. Con `pm2 -i max` N processi hanno N code che non si conoscono: è
> **B7**, e si affronta là. Un lockfile andrebbe gestito su crash, timeout, lock
> orfani e NFS — più superficie di quanta ne risolva per un CMS dichiaratamente
> single-process.
>
> **⚠️ Seguito (v3.50.0): la coda non copriva tutti i writer.** Una revisione del
> codice ha trovato che `roleManagement.js` scriveva lo **stesso**
> `userAccount.json5` con un suo `writeJson5Atomic`: una coda che serializza solo
> i propri chiamanti non serializza niente. Misurato, con un `updateProfile` in
> volo: la cancellazione di un ruolo veniva annullata **30 volte su 30**. Ora
> anche `roleManagement` passa dalla coda, e un **censimento** dei writer dei due
> file di dati (`tests/unit/core/writerCensus.test.js`) rende rossa la CI al
> prossimo che ne aggiunge uno fuori.
>
> **Presidi:** 10 test in `tests/unit/core/json5UpdateQueue.test.js`, fra cui la
> riproduzione della finestra di `await bcrypt.hash` e lo scenario misto
> « cancellazione + modifica » dove l'utente cancellato **non** resuscita.

**Severità:** 🟠 alta · **Sforzo:** minimo · **Regola del progetto violata:** `CLAUDE.md` §1

### Dove

- `plugins/adminUsers/userManagement.js:87`
- `plugins/adminUsers/main.js:591`

### Cosa succede

`CLAUDE.md`, regola operativa numero 1, prescrive: *« scritture **atomiche** (temp +
`rename`) »*. Il motivo è che `fs.writeFileSync` non è un'operazione singola: tronca
il file a zero e poi ci scrive dentro. Se il processo muore fra i due momenti — un
crash, un `SIGKILL`, un disco pieno, un container terminato — sul disco resta un file
troncato o vuoto.

La scrittura atomica evita il problema scrivendo su un file temporaneo e poi facendo
`rename`, che a livello di filesystem è atomico: o si vede il file vecchio o si vede
quello nuovo, mai una via di mezzo.

Due punti del progetto non seguono la regola, ed è una coincidenza sfortunata che
siano proprio i due che scrivono `userAccount.json5`:

```js
fs.writeFileSync(usersFilePath, JSON.stringify(userAccount, null, 2));           // userManagement.js:87
fs.writeFileSync(userFilePath, JSON.stringify(userAccount, null, 2), 'utf8');    // main.js:591
```

### Perché è un problema

`userAccount.json5` contiene **tutti gli account del sistema**, con i loro hash e i
loro ruoli. È anche `git-ignored` per scelta (config-lifecycle), quindi **non esiste
una copia nel repository** da cui ripristinarlo. Se si tronca:

- nessuno può più autenticarsi;
- il pannello admin è irraggiungibile, quindi non si può rimediare dall'interno;
- l'unica via d'uscita è un backup, se qualcuno l'ha fatto, o la ricostruzione a mano
  via wizard con accesso shell.

La finestra temporale è breve ma l'esito è totale, e il file viene riscritto a ogni
operazione sugli utenti — inclusa la cancellazione di un ruolo, che riscrive tutti
gli account che lo avevano.

### Verifica

`grep -rn "writeFileSync"` su `core/`, `plugins/`, `scripts/` con esclusione dei
percorsi `.tmp`: emergono esattamente questi due punti come scritture dirette su un
file di dati. Tutti gli altri store del progetto — `rateLimiter/stateStore.js`,
`urlRedirect/hitCounter.js`, `mailer/mailQueue.js`, `seo/sitemapGenerator.js`,
`adminBootstrapNavbar/navbarFileManager.js`, `sentinel/census.js` — fanno
correttamente temp + `rename`. **La convenzione è rispettata ovunque tranne che sul
file più importante.**

### Come si corregge

Sostituire le due chiamate con la sequenza già usata dal resto del progetto:

```js
const tempPath = usersFilePath + '.tmp';
fs.writeFileSync(tempPath, JSON.stringify(userAccount, null, 2), 'utf8');
fs.renameSync(tempPath, usersFilePath);
```

Meglio ancora: dato che questo pattern è ripetuto in una dozzina di file, **estrarlo
in `core/`** come `writeJson5Atomic(filePath, obj, header)` — funzione che
`plugins/admin/pluginsInstall.js:243` ha già scritto localmente. Un solo punto da
correggere in futuro, e la regola diventa impossibile da dimenticare.

**Presidio:** un test che verifichi che nessun file sotto `plugins/adminUsers/` chiami
`writeFileSync` su un percorso che non finisce per `.tmp`. È un test grezzo ma
efficace contro la regressione.

---

## B2 · `updateUserProfile` — lost update fra richieste concorrenti

> ✅ **CORRETTO (2026-11-23), v3.45.0.** Stesso strato di B1: il mutatore riceve
> il contenuto **riletto dentro la coda**, quindi chi arriva secondo vede le
> modifiche del primo. In `updateUserProfile` le modifiche (rename, email, hash)
> sono ora un **delta** riapplicato sul dato fresco, invece di una copia in
> memoria riscritta per intero.
>
> **Due aggiunte oltre alla scheda.** Se, riletto il file, l'utente **non esiste
> più** — cancellato mentre la richiesta era in volo — la scrittura non avviene e
> l'handler risponde **409** invece di resuscitarlo. E `userUsert()`, che la
> scheda nota essere « corretto per caso » perché l'hash avveniva prima della
> lettura, ora lo è per costruzione: l'equilibrio non dipende più dall'ordine
> delle righe.
>
> **Rifinita il 2026-11-25 (v3.51.0), su revisione del codice.** Rimettere il
> delta dentro il mutatore ha chiuso il lost update, ma il **rinomino** dello
> username aveva ancora una finestra: il controllo di collisione girava sul dato
> letto **prima** della coda, quindi due rinomini verso lo stesso nome nuovo
> potevano passarlo entrambi — e il secondo avrebbe **sovrascritto** l'utente
> appena creato dal primo. Ora la collisione è ricontrollata sul dato **riletto**
> dentro il mutatore, che annulla la scrittura e risponde **409** nominando lo
> username appena preso.

**Severità:** 🟠 media · **Sforzo:** basso

### Dove

`plugins/adminUsers/main.js`, handler `POST /updateUserProfile`:
lettura a riga 505, `await` a riga 583, scrittura a riga 591.

### Cosa succede

Node.js esegue un solo thread: finché una funzione non incontra un `await`, nessun
altro codice può interporsi. Questo rende **sicuro** il classico ciclo
leggi-modifica-scrivi, *a patto che non ci sia un `await` in mezzo*.

Qui c'è:

```js
const userAccount = loadJson5(userFilePath);              // 505 — legge lo stato
// ... validazioni ...
const hashedPassword = await bcrypt.hash(newPassword, 10); // 583 — cede il controllo
userAccount.users[targetUsername].hashPassword = hashedPassword;
fs.writeFileSync(userFilePath, JSON.stringify(userAccount, null, 2), 'utf8'); // 591 — riscrive TUTTO
```

Durante quell'`await`, Node è libero di eseguire un'altra richiesta. Se due utenti
aggiornano il profilo contemporaneamente:

1. la richiesta A legge il file (contiene: alice, bob);
2. la richiesta A entra in `bcrypt.hash` e cede il controllo;
3. la richiesta B legge il file (stessa copia), modifica bob, scrive;
4. la richiesta A si risveglia, modifica **la sua copia in memoria** (che non conosce
   la modifica di B), e riscrive l'intero file.

La modifica di B è sparita. Nessun errore, nessun log: entrambi gli utenti hanno
ricevuto « Modifica riuscita ».

### Perché è un problema

`bcrypt.hash(password, 10)` è deliberatamente lento — è il suo scopo — e impiega
circa 100 ms. Non è una finestra di microsecondi che si verifica una volta l'anno: è
un intervallo ampio, facilmente sovrapponibile in un pannello usato da più persone.

Lo stesso schema colpisce combinazioni miste: un amministratore che cancella un
utente mentre quell'utente sta cambiando la propria email **lo resuscita**, perché la
scrittura dell'utente si basa su una copia del file che lo conteneva ancora.

Da notare che `userUsert()` in `userManagement.js` è **corretto per caso**: lì la
`await bcrypt.hash` avviene *prima* della lettura, quindi lettura e scrittura sono
contigue e nessuno può interporsi. È un equilibrio fragile, che dipende dall'ordine
delle righe e che nessun commento segnala.

### Verifica

Lettura del flusso, con verifica dell'ordine delle operazioni: la `loadJson5` di riga
505 precede l'`await` di riga 583, che precede la `writeFileSync` di riga 591.

### Come si corregge

Due opzioni, in ordine di robustezza crescente:

- **Rileggere dopo l'`await`.** Spostare `loadJson5` dopo l'hash, o rileggerlo e
  riapplicare la modifica sul dato fresco. Risolve questo caso, ma va ricordato ogni
  volta che si aggiunge un `await`.
- **Serializzare le scritture** con una coda condivisa in `core/` (una semplice catena
  di promesse per file). Risolve B1 e B2 insieme, ed è la stessa infrastruttura che
  servirebbe per B7.

Consiglio la seconda: il progetto ha già una dozzina di store che fanno
leggi-modifica-scrivi, e un punto solo dove renderli sicuri vale più di dodici
correzioni puntuali.

---

## B3 · Salvare da System Settings distrugge il config e può impedire il boot

> ✅ **CORRETTO (2026-11-23), v3.45.0.** `updateSystemConfig` scrive ora **foglia
> per foglia** con `setJson5Key`, non più `JSON.stringify` dell'oggetto intero.
>
> **Il difetto era peggiore di « perde i commenti », e l'ho visto su
> un'installazione reale:** `ital8Config.json5` ridotto da **214 righe di
> commento a ZERO**. Ma la parte che rompeva il boot è l'altra: il form conosce
> una ventina di chiavi, il file ne ha **35** — `securityHeaders`, `cli`,
> `migrations`, `globalFunctionsWhitelist`, `maintenance`… — e tutte quelle che
> il form non nominava venivano **cancellate**. Il messaggio diceva « riavvia il
> server per applicare le modifiche », e il riavvio era il momento in cui
> l'installazione moriva.
>
> **Ora la cancellazione per omissione è impossibile per costruzione:**
> `diffLeaves` confronta solo le chiavi **presenti** nell'oggetto proposto, quindi
> una chiave che il form non nomina non entra nemmeno nell'elenco delle
> modifiche. Non per diligenza di chi scriverà il prossimo form — perché la
> scrittura non la vede.
>
> Più: si scrive **solo ciò che è cambiato** (zero modifiche → zero scritture, e
> la risposta lo dice), e una **copia di sicurezza** del config finisce sotto
> `backups/systemSettings/` prima di toccarlo (fail-soft: se la copia non riesce,
> il salvataggio prosegue — la scrittura chirurgica non è distruttiva).
>
> **Presidi:** 12 test in `tests/unit/admin/systemSettings.test.js`, condotti sul
> `.default` **realmente spedito** — i commenti contati prima e dopo, le 35 chiavi
> verificate una per una, e un presidio **strutturale** che pretende che
> l'handler usi `setJson5Key` e non riscriva più il file intero.
>
> *Nota registrata in `TODO.md`:* sotto `backups/` convivono ora **tre** schemi di
> nomi (`backup-*` degli snapshot a comando, `init-*` del wizard, e
> `systemSettings/`), e nessuno dei tre pota gli altri.
>
> **Rifinita il 2026-11-25 (v3.51.0), su revisione del codice.** Due cose, e la
> seconda era più grave della card.
>
> **(a) La scrittura chirurgica non era atomica nell'insieme.** Le chiavi erano
> scritte una per una **sul file vivo**: un guasto a metà (disco pieno, processo
> ucciso) lasciava il config con alcune chiavi nuove e altre vecchie — proprio lo
> stato incoerente che la card voleva evitare, solo più piccolo. Ora le scritture
> vanno su una **copia**, e il file vivo è sostituito con un `rename` finale: o
> tutte o nessuna. Se qualcosa cade, la copia è rimossa e la risposta dice dove
> sta il backup.
>
> **(b) Salvare da System Settings era IMPOSSIBILE, non distruttivo.** Emerso
> mentre scrivevo il presidio di (a): `validateSystemConfig()` pretendeva
> `useHttps`, `httpsPort` e `AutoRedirectHttpPortToHttpsPort` — i nomi **piatti**
> della struttura precedente al blocco `https` annidato, che il config non ha più.
> La GUI è un editor: carica il config e rimanda ciò che ha caricato, quindi ogni
> salvataggio rispondeva **« Campo obbligatorio mancante »** e la sezione era
> inutilizzabile. Difetto **preesistente** a questa revisione, e a suite verde:
> i test chiamavano il validatore con payload scritti a mano nella forma che lui
> si aspettava, **mai** con il config reale.
>
> **Il presidio che mancava è il round-trip della cucitura:** ciò che
> `getSystemConfig()` carica deve essere un config che `validateSystemConfig()`
> accetta; e ogni campo che il validatore reclama deve **esistere** nel config
> spedito — lista ricavata interrogando il validatore stesso, così il test non la
> duplica. Reintrodotto il difetto, cadono 4 test.

**Severità:** 🟠 alta · **Sforzo:** medio · **Decisione del progetto violata:** D1 (scrittura chirurgica)

### Dove

`plugins/admin/systemSettings.js:217` (funzione `updateSystemConfig`),
più `validateSystemConfig` nello stesso file.

### Cosa succede

La sezione « Impostazioni di sistema » del pannello mostra `ital8Config.json5` in un
editor e permette di salvarlo. Il salvataggio fa questo:

```js
const configContent = '// This file follows the JSON5 standard ...\n' +
                      JSON.stringify(newConfig, null, 2);
fs.writeFileSync(tempPath, configContent, 'utf8');
fs.renameSync(tempPath, configPath);
```

La scrittura **è** atomica (bene), ma il contenuto è la **riserializzazione completa**
dell'oggetto ricevuto dal browser. Da qui due conseguenze indipendenti.

**(1) Tutti i commenti spariscono.** L'oggetto arriva dal browser, che l'ha ricevuto
da `loadJson5` — il quale, giustamente, restituisce dati e butta via i commenti. Il
salvataggio riscrive il file da quei dati, quindi ogni commento è perso per sempre.

`ital8Config.default.json5` è un file di **20 KB**, in larghissima parte
documentazione inline: ogni chiave ha accanto la spiegazione di cosa fa e perché.
`CLAUDE.md` ha una decisione esplicita su questo punto (D1): *« Negli script
preferisci `setJson5Key`/`editJson5` a un `saveJson5` dell'oggetto intero:
quest'ultimo **perde i commenti** del config vivo »*. La GUI che modifica il config
più importante del sistema fa esattamente ciò che la decisione vieta.

**(2) La validazione non protegge dalle chiavi mancanti.** `validateSystemConfig`
controlla il **tipo** di circa sei campi (`debugMode` deve essere 0 o 1, `enableAdmin`
deve essere booleano...), ma **nessuna chiave è obbligatoria**: se il payload non la
contiene, il campo semplicemente non viene controllato — e poi non viene scritto.

Un salvataggio a cui manchi `indexFiles` o `hideExtension` passa la validazione, viene
scritto, e al riavvio `index.js` fa:

```js
index: ital8Conf.indexFiles.wwwPath,
hideExtension: ital8Conf.hideExtension.wwwPath.enabled ? ... : undefined,
```

→ `TypeError: Cannot read properties of undefined` → `[BOOT] Avvio fallito` → `exit 1`.

### Perché è un problema

Il messaggio restituito all'amministratore è: *« Configurazione aggiornata con
successo. Riavvia il server per applicare le modifiche. »* Il riavvio è precisamente
il momento in cui l'installazione muore, e a quel punto:

- il pannello non c'è più (il server non parte);
- il file corretto non c'è più (è stato sovrascritto);
- **nessun backup è stato fatto**, benché `BackupManager` esista già nel progetto e
  sia usato dal wizard e da `adminBootstrapNavbar`;
- serve accesso shell per recuperare, cosa che un utente di un pannello web non ha
  necessariamente.

Il difetto (1), la perdita dei commenti, è meno drammatico ma **certo**: si verifica a
ogni salvataggio, anche quello corretto, e degrada permanentemente un file che il
progetto tratta come documentazione di prima classe.

### Verifica

Lettura di `updateSystemConfig` e di `validateSystemConfig` (nessun controllo di
presenza, solo controlli di tipo su campi opzionali), incrociata con i punti di
`index.js` che dereferenziano `ital8Conf.indexFiles` e `ital8Conf.hideExtension`
senza optional chaining.
L'editor lato client (`core/admin/webPages/systemSettings/index.ejs:222`) conferma il
percorso: carica con `JSON.stringify(result.config, null, 2)` e rimanda indietro
l'oggetto intero.

### Come si corregge

Tre interventi, applicabili in ordine e indipendenti:

1. **Backup preventivo** con `BackupManager` prima di ogni scrittura. È la rete di
   sicurezza più economica e va messa comunque, qualunque sia il resto.
2. **Scrittura chirurgica.** Calcolare il diff fra config attuale e config inviato, e
   applicare solo le chiavi cambiate con `setJson5Key`/`editJson5`. I commenti
   sopravvivono e le chiavi non toccate non possono sparire. È l'approccio già usato
   altrove nel progetto e coerente con D1.
3. **Validare la presenza delle chiavi obbligatorie** — almeno quelle che `index.js`
   dereferenzia senza protezione. Se il diff (punto 2) viene adottato, questo punto
   diventa quasi superfluo, perché una chiave non può più sparire per omissione; resta
   utile come controllo esplicito.

**Presidio:** un test che salvi un config privo di `indexFiles` e asserisca che la
richiesta venga **rifiutata**, e un test che salvi una modifica e verifichi che un
commento presente prima sia ancora presente dopo.

---

## B4 · Oggetti indicizzati con input utente senza `hasOwnProperty`

> ✅ **CORRETTO (2026-11-23), v3.46.0.** Tutte e quattro le misure proposte.
>
> 1. **`Object.hasOwn`** nei punti che indicizzano con input utente, più la mappa
>    degli utenti costruita **senza prototipo** (`Object.create(null)`) nel login:
>    due difese indipendenti sulla stessa classe.
> 2. **Denylist esplicita** di `__proto__`, `constructor` e `prototype` nella
>    validazione dello username, messa **prima** della regex di forma — così
>    l'errore arriva presto e dice *« nome riservato del linguaggio »* invece di
>    un rifiuto a valle per un'altra ragione.
> 3. **`try/catch` sull'handler di login**: un endpoint pubblico non deve poter
>    rispondere 500 per un input malformato, indipendentemente da questo caso.
> 4. **Record validato** prima di `bcrypt.compare`: un utente presente ma senza
>    `hashPassword` era l'altra via allo stesso 500.
>
> **Misurato prima della correzione** — e sono **tre** chiavi, non una come
> riportava la scheda:
>
> ```
> autenticate('constructor', …)  →  ✗ LANCIA  Illegal arguments: string, undefined
> autenticate('toString', …)     →  ✗ LANCIA
> autenticate('__proto__', …)    →  ✗ LANCIA
> autenticate('pippo', …)        →  ok  false
> ```
>
> **Presidi:** in `tests/unit/libAccess.test.js` cinque chiavi di prototipo
> (`constructor`, `toString`, `valueOf`, `__proto__`, `hasOwnProperty`) che ora
> restituiscono `false` senza lanciare, più il record malformato; e in
> `tests/unit/adminUsersInputSurface.test.js` la denylist, con un test che
> verifica che il rifiuto arrivi **prima** della validazione di forma — perché
> `__proto__` passa la regex, ed è il motivo per cui la denylist serve.

**Severità:** 🟠 media · **Sforzo:** minimo

### Dove

- `plugins/adminUsers/lib/libAccess.js:14` e `:18` — il login
- `plugins/adminUsers/userManagement.js:82` — la creazione utente

### Cosa succede

In JavaScript ogni oggetto eredita proprietà da `Object.prototype`. Scrivere
`oggetto[chiave]` con una chiave che arriva dall'esterno non restituisce quindi solo
le proprietà « vere » dell'oggetto: restituisce anche `constructor`, `toString`,
`valueOf`, `__proto__` e compagnia.

Nel login:

```js
if (!username || !password || !usersAccounts.users[username]) return false;
const storedHash = usersAccounts.users[username].hashPassword;
const isMatch = await bcrypt.compare(password, storedHash);
```

Con `username = "constructor"`, `usersAccounts.users['constructor']` restituisce il
costruttore di `Object`, che è **truthy**: il controllo di esistenza passa. Poi
`.hashPassword` su una funzione è `undefined`, e `bcryptjs.compare(password,
undefined)` **rigetta** con un errore (*Illegal arguments*). Il rigetto risale
all'handler, che non ha `try/catch`, e Koa risponde **500**.

Nella creazione utente il problema è speculare. La validazione dello username è:

```js
const validUsernameRegex = /^[A-Za-z0-9_\-]+$/;
```

che **accetta `__proto__`** (sono solo lettere e underscore). Il controllo di
esistenza usa `Object.keys()`, che `__proto__` non elenca → passa. Poi:

```js
userAccount.users[username] = { hashPassword, email, roleIds };
```

Assegnare a `__proto__` non crea una proprietà: **sostituisce il prototipo**
dell'oggetto. `JSON.stringify` non serializza il prototipo, quindi il file viene
scritto senza il nuovo utente — ma la funzione ritorna
`{ success: 'Utente "__proto__" creato con successo.' }`.

### Perché è un problema

Il caso del login è il più concreto: **un 500 su un endpoint pubblico e non
autenticato**, provocabile con una richiesta banale. È anche un oracolo di
enumerazione, perché la risposta è visibilmente diversa (500) da quella di un login
fallito normale (302 verso la pagina di login).

Il caso della creazione utente è meno grave ma peggiore come **qualità del
comportamento**: il sistema dichiara di aver fatto una cosa che non ha fatto.
L'amministratore vede « creato con successo », l'utente non esiste, e nulla nei log
lo segnala.

Da notare che `updateUserProfile` è **salvo per caso**: lì il controllo « esiste
già? » è `if (userAccount.users[newUsername])`, che con `__proto__` restituisce
`Object.prototype` (truthy) e quindi **rifiuta** la rinomina. Funziona, ma per il
motivo sbagliato, e con un messaggio d'errore fuorviante (« username già in uso »).
Tre punti che indicizzano lo stesso oggetto con lo stesso input e si comportano in tre
modi diversi.

### Verifica

Lettura del codice, applicando la semantica standard di JavaScript:
`({}).constructor` è truthy, `Object.keys({})` non contiene `__proto__`,
`obj.__proto__ = value` invoca il setter del prototipo.
`bcryptjs` v3 rigetta esplicitamente quando l'hash non è una stringa.

### Come si corregge

- **Usare `Object.hasOwn(users, username)`** (o `Object.prototype.hasOwnProperty.call`)
  prima di ogni accesso, in tutti e tre i punti. È l'unica difesa che copre l'intera
  classe di problema.
- **Denylist esplicita** di `__proto__`, `constructor`, `prototype` nella validazione
  dello username, così l'errore arriva presto e con un messaggio comprensibile.
- **`try/catch` nell'handler di login**, perché un endpoint pubblico non deve poter
  rispondere 500 per un input malformato — indipendentemente da questo caso specifico.
- Considerare `Object.create(null)` per la mappa degli utenti dopo il caricamento:
  elimina il prototipo e quindi l'intera classe di problema.

---

## B5 · `isPathSafe` confronta il prefisso senza separatore

> ✅ **CORRETTO (2026-11-23), v3.47.0.** Il controllo vive ora in
> `core/resolveInsideRoot.js` e lo usano **entrambi** i punti. La versione
> corretta esisteva già nel progetto — in `adminMedia/lib/mediaManager.js`, **a
> due file di distanza** da quella sbagliata: una copia giusta e una sbagliata
> sono il modo in cui una correzione ne raggiunge una sola.
>
> **Misurato, non descritto:** un test esegue la forma vecchia e pretende che
> approvi `../wwwBackup/x.ejs`, poi pretende che quella nuova lo rifiuti. Il
> difetto è così scritto nel presidio, non solo nel commento.
>
> **Sistemato anche il fallback silenzioso** della nota finale della scheda:
> `resolveAbsPath` faceva `safeResolve(...) || mediaRoot`, cioè **dirottava**
> l'operazione sulla radice invece di rifiutarla — un upload verso `../../etc`
> finiva nella cartella media. Ora restituisce `null` e i due chiamanti
> rispondono `400`/scartano il file. Un test preesistente asseriva il dirottamento
> (*« falls back to mediaRoot »*): sostituito, con la spiegazione di perché il
> comportamento è cambiato.
>
> **Due cambiamenti di comportamento da conoscere.** (a) La versione di
> `mediaManager` **toglieva** i `..` iniziali prima di risolvere, quindi
> `../fuori/x` diventava `fuori/x`: sicuro, ma una riscrittura **silenziosa** —
> chi chiedeva un percorso fuori riceveva un percorso dentro, diverso da quello
> chiesto. Ora è un rifiuto. (b) Un percorso **assoluto** fuori dalla radice è
> rifiutato: `path.join(root, '/etc/passwd')` dava `root/etc/passwd` (dentro),
> `path.resolve` dà `/etc/passwd` (fuori).
>
> **Presidi:** 18 test in `tests/unit/core/resolveInsideRoot.test.js`, fra cui
> tre **strutturali** che pretendono che entrambi i punti deleghino e che la forma
> sbagliata non compaia più nel codice.
>
> **Rifinita il 2026-11-25 (v3.51.0), su revisione del codice.** La delega al
> controllo condiviso aveva una **regressione di comportamento**: `path.join`
> ignora lo slash iniziale del secondo argomento, `path.resolve` lo tratta come
> assoluto e porta **fuori** dalla radice. Misurato: `/about.ejs` — la forma
> naturale nel campo di testo del pannello — passava da **accettato** a
> **rifiutato**. Ora `isPathSafe` normalizza lo slash iniziale prima di delegare;
> `core/resolveInsideRoot` resta **stretto** (là un percorso assoluto è assoluto,
> e `adminMedia` conta su quello). La guardia è esportata e presidiata da sola,
> 17 test, inclusi i casi che devono restare rifiutati (`/../fuori.ejs`).

**Severità:** 🟠 media (admin-only) · **Sforzo:** minimo

### Dove

`plugins/admin/pagesManagment.js:247`

### Cosa succede

La guardia che deve impedire la scrittura di file fuori da `/www` è:

```js
const absolutePath  = path.join(wwwPath, filePath);
const normalizedPath = path.normalize(absolutePath);
return normalizedPath.startsWith(wwwPath);
```

`startsWith` su un percorso **senza il separatore finale** confronta stringhe, non
directory. Se `wwwPath` è `/home/user/ital8cms/www`, allora
`/home/user/ital8cms/wwwBackup/x.ejs` **inizia** con quella stringa, pur essendo una
directory completamente diversa.

Con `filePath = "../wwwBackup/x.ejs"`, `path.join` produce
`/home/user/ital8cms/wwwBackup/x.ejs`, `normalize` non ha nulla da risolvere, e la
guardia **approva**.

### Perché è un problema

L'exploit è limitato: si può scrivere solo in directory **sorelle di `www` il cui
nome inizia per `www`**, e l'operazione richiede già il ruolo admin, che (vedi C7)
può comunque scrivere codice eseguibile dentro `/www`. Non è quindi un aumento di
privilegio.

Quello che conta è **l'idioma**: è la forma classicamente sbagliata di questo
controllo, ed è scritta in un file che si chiama `isPathSafe`. Chi la legge la prende
per un esempio da imitare. Il progetto ha già la versione corretta a due file di
distanza, in `plugins/adminMedia/lib/mediaManager.js:34`:

```js
const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
if (resolved !== mediaRoot && !resolved.startsWith(rootWithSep)) return null;
```

### Verifica

Lettura del codice, con la semantica di `String.prototype.startsWith` e di
`path.normalize` (che non rimuove i `..` già risolti da `join`).

### Come si corregge

Allineare `isPathSafe` alla versione di `mediaManager`, oppure — meglio — **estrarre
quella versione in `core/`** e usarla in entrambi i punti. Il progetto ha già
`core/servingRootResolver.js` con responsabilità affine: potrebbe essere la sua casa.

**Nota nella stessa area:** `mediaManager.resolveAbsPath` (riga 124) è corretto nel
rilevare la traversal, ma poi fa `safeResolve(...) || mediaRoot` — cioè, quando
rileva un tentativo, **reindirizza silenziosamente l'operazione sulla radice** invece
di rifiutarla. Un upload verso `../../etc` finisce nella cartella media anziché
ricevere un errore. Non è una vulnerabilità, ma è un fallimento silenzioso in un punto
in cui il rifiuto esplicito sarebbe più chiaro (e tutte le altre funzioni dello stesso
file, righe 175/220/260, restituiscono correttamente un errore).

---

## B6 · Il contratto `getObjectToShareToOthersPlugin` è documentato con tre parametri, il runtime ne passa uno

> ✅ **CORRETTO (2026-11-23), v3.48.0.** Scelta la strada **(a)**: i parametri
> vengono passati, quindi la documentazione torna vera e il pattern « Twin Admin »
> raccomandato da `CLAUDE.md` diventa possibile come descritto. Due righe, nei
> due call site — `pathPluginFolder` è il metadato che `pluginSys` inietta già su
> ogni plugin caricato.
>
> **Presidi:** tre test in `tests/unit/pluginSys.test.js` che usano plugin
> sintetici i quali **scrivono su disco** cosa hanno ricevuto, così il test lo
> rilegge: uno sul percorso al boot (*push*), uno su `getSharedObject` (*pull*),
> e uno che pretende che il `pathPluginFolder` sia quello del **provider** e non
> del chiamante — l'errore facile da fare passando i parametri.

**Severità:** 🟠 media (latente) · **Sforzo:** basso

### Dove

- `core/pluginSys.js:188` — condivisione al boot (*push*)
- `core/pluginSys.js:1178` — condivisione a runtime (*pull*)
- `CLAUDE.md` § « Export di `main.js` » e `plugins/exampleComplete/main.js:454`

### Cosa succede

La documentazione e il plugin di riferimento dichiarano la firma:

```js
getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) { return {} }
```

Ma **entrambi** i punti in cui il runtime la invoca passano un solo argomento:

```js
plugin1.setSharedObject(nomePlugin0, plugin0.getObjectToShareToOthersPlugin(nomePlugin1)); // :188
return provider.getObjectToShareToOthersPlugin(callerName) || null;                        // :1178
```

`pluginSys` e `pathPluginFolder` arrivano quindi sempre `undefined`.

### Perché è un problema

Oggi **non si rompe niente**: i quattro plugin che dichiarano la firma completa
(`exampleComplete`, `seo`, `urlRedirect`, `simpleI18n`) dichiarano i parametri ma non
li usano. Il difetto è **latente**, e per questo insidioso: sta aspettando il primo
plugin che li usi davvero.

Ed è probabile che quel plugin arrivi presto, perché **la documentazione ci si
appoggia**. Il pattern « Twin Admin Plugin », raccomandato da `CLAUDE.md` per ogni
nuovo service plugin, prescrive proprio di risolvere la cartella del plugin gemello
via `pluginSys.getPlugin('<service>').pathPluginFolder`. Chi lo fa dentro
`getObjectToShareToOthersPlugin`, come la firma documentata suggerisce, ottiene un
`TypeError` — e lo ottiene al **boot**, dove il messaggio arriva mescolato al
caricamento dei plugin.

C'è anche un aggravante di leggibilità: il difetto è **invisibile leggendo il plugin**.
La firma sembra giusta, il codice sembra giusto; solo aprendo `core/pluginSys.js` si
scopre che due dei tre parametri non arrivano mai.

### Verifica

`grep` su `core/pluginSys.js` per tutte le invocazioni del metodo: sono due, entrambe
con un solo argomento. `grep` sui plugin per la firma a tre parametri: quattro
dichiarazioni, nessun uso attuale dei parametri 2 e 3.

### Come si corregge

Va scelta una delle due direzioni, non lasciata a metà:

- **(a) Passare i parametri.** In entrambi i call site, aggiungere `this` e il
  `pathPluginFolder` del provider (che `pluginSys` già conosce: lo inietta come
  metadato su ogni plugin caricato). È la soluzione che mantiene la documentazione
  vera e abilita il pattern Twin Admin come descritto.
- **(b) Correggere la firma ovunque:** documentazione, `exampleComplete` e i tre
  plugin. Più veloce, ma toglie una capacità che la documentazione promette e che ha
  senso avere.

Consiglio **(a)**: il costo è di due righe e allinea il codice a un'architettura già
progettata così.

**Presidio:** un test che invochi `getSharedObject` su un provider fittizio e
asserisca che riceva tre argomenti definiti.

---

## B7 · Storage a file senza lock — l'architettura non regge il multi-processo

> ✅ **CORRETTO (2026-11-23), v3.49.0 — strada breve: dichiararlo E RILEVARLO.**
> Lo storage con lock fra processi resta lavoro grosso, e la scelta
> « single-process per sempre » vincolerebbe il futuro del progetto: **la
> decisione architetturale resta aperta**. Quello che non resta aperto è il
> **silenzio**.
>
> `core/singleProcessLock.js` scrive `ital8cms.lock` (PID + radice del progetto)
> al boot e lo rilascia alla chiusura ordinata. Un secondo processo sulla stessa
> cartella si ferma con un box `[LOCK]` che nomina il PID attivo, mostra
> `pm2 start index.js -i max` come **il comando da non usare**, e dice come
> procedere. **Verificato su istanze vere:** la prima parte, la seconda stampa il
> box ed esce; il lock viene rilasciato alla chiusura.
>
> **Il lock è deliberatamente semplice, e i due casi che lo rendono usabile
> sono:** un PID **non più vivo** è un lock orfano e si prende il posto da sé —
> un crash non deve richiedere un intervento manuale, altrimenti il rimedio
> diventa peggio del male; una **radice diversa** significa file **copiato**, e
> succede davvero, perché i test d'integrazione copiano l'intero progetto in una
> tmpdir e un lock copiato con un PID vivo bloccherebbe ogni fixture con un
> errore incomprensibile.
>
> Se il lock non si può **scrivere** (filesystem di sola lettura) il boot
> prosegue con un avviso: rifiutare l'avvio per questo sarebbe peggio del rischio
> che evita, e il gate delle data dir scrivibili copre già i casi che contano.
>
> **Presidi:** 15 test in `tests/unit/core/singleProcessLock.test.js`, fra cui il
> lock orfano, quello copiato, quello illeggibile, il rifiuto a rilasciare il
> lock di qualcun altro, e due **strutturali** sul montaggio in `index.js`.
> Documentato in [`docs/deployment.it.md`](./docs/deployment.it.md).

**Severità:** 🟠 alta (architetturale) · **Sforzo:** alto · **Natura:** decisione da prendere, non solo un bug

### Dove

Trasversale. Tutti gli store JSON5 del progetto: `plugins/rateLimiter/lib/stateStore.js`,
`plugins/urlRedirect/lib/hitCounter.js`, `plugins/mailer/lib/mailQueue.js`,
`plugins/adminUsers/userAccount.json5`, `plugins/seo/seoPages.json5`, e altri.
Il riferimento in conflitto è `docs/deployment.it.md` + `CLAUDE.md` § « Comandi di
riferimento rapido », che documentano `pm2 start index.js`.

### Cosa succede

La scelta « zero database » è la filosofia dichiarata del progetto, e la condivido:
per dataset piccoli, file JSON leggibili sono più semplici da capire, salvare e
versionare di un DBMS.

Ma quella scelta porta con sé un vincolo che il progetto non ha ancora dichiarato:
**il ciclo leggi-modifica-scrivi è sicuro solo dentro un singolo processo**. La
scrittura atomica (temp + `rename`) garantisce che nessuno legga mai un file a metà,
ma **non** garantisce che due scrittori non si sovrascrivano a vicenda: entrambi
leggono lo stesso stato, entrambi lo modificano, e l'ultimo che scrive cancella il
lavoro del primo.

Dentro un solo processo Node il problema quasi non si presenta, perché lettura e
scrittura sono contigue e nulla può interporsi (l'eccezione è B2). Con **due processi**
la garanzia sparisce del tutto.

### Perché è un problema

Il progetto documenta `pm2` come modo di eseguire ital8cms in produzione. Alla prima
persona che scrive `pm2 start index.js -i max` — che è **il motivo per cui si usa
pm2** — partono N processi che condividono le stesse cartelle. Da quel momento:

- il `rateLimiter` perde i conteggi dei tentativi falliti (un processo sovrascrive lo
  stato dell'altro): la difesa anti brute-force smette di funzionare in modo
  affidabile, senza che nulla lo segnali;
- il contatore di `urlRedirect` perde colpi;
- la coda di `mailer` può perdere messaggi, o rispedirne;
- `userAccount.json5` può perdere un utente appena creato.

Nessuno di questi guasti produce un errore: producono **dati sbagliati**, che è la
forma più costosa da diagnosticare.

C'è anche un secondo effetto, indipendente dal multi-processo: gli store fanno I/O
**sincrono** (`loadJson5`, `writeFileSync`) dentro il ciclo di richiesta. Su file
piccoli è irrilevante; quando il file di stato del `rateLimiter` cresce (vedi C2),
ogni flush blocca l'event loop per tutti.

### Verifica

Lettura incrociata degli store e della documentazione di deployment. Il conflitto è
esplicito: nessuno store implementa un lock inter-processo, e nessun documento dice
che l'esecuzione debba essere a processo singolo.

### Come si corregge

Sono due strade, ed è una **decisione del maintainer**, non un difetto con una sola
risposta:

- **(a) Dichiarare ital8cms single-process.** Il costo è nullo in codice: si aggiorna
  `docs/deployment.it.md` dicendo che `pm2` va usato in modalità `fork` (una sola
  istanza) e **mai** in `cluster`, spiegando il perché. Coerente con lo stadio alpha e
  con la filosofia file-based. Si può rafforzare con un lock file al boot che rifiuti
  l'avvio di una seconda istanza sulla stessa cartella — così il vincolo è presidiato
  dal codice, non solo dalla documentazione.
- **(b) Introdurre un lock inter-processo** (lock file con `O_EXCL`, o `proper-lockfile`)
  in un unico modulo `core/`, usato da tutti gli store. Abilita il cluster, ma
  aggiunge una dipendenza concettuale che va progettata bene (timeout, lock orfani
  dopo un crash, contesa).

Consiglio **(a)** per la v0.0.1: è onesto, costa una pagina di documentazione, e
rimanda (b) a quando ci sarà una ragione concreta per il multi-processo. Qualunque sia
la scelta, va **scritta**: oggi il vincolo esiste ma non è dichiarato da nessuna parte,
ed è il tipo di cosa che si scopre in produzione.

---

# 🟡 C — Altri punti sostanziali

Difetti reali ma di impatto o probabilità minori di quelli sopra. Sono descritti più
brevemente perché il meccanismo è più semplice, non perché siano trascurabili.

## C1 · `GET /logged` è pubblico e stampa l'intera sessione

> ✅ **CORRETTO (2026-11-23), v3.46.0.** `GET /logged` risponde ora
> `{ authenticated: false }` oppure `{ authenticated: true, username }`, in JSON.
>
> **Il difetto era in ENTRAMBI i rami**, non solo in quello autenticato come
> riportava la scheda: anche il ramo anonimo faceva
> `JSON.stringify(ctx.session)`. Detto con precisione: è la sessione **del
> chiamante**, quindi non è una fuga fra utenti — è il **proprio** token CSRF
> messo in un corpo di risposta, da cui può finire nei log di un proxy o nella
> cronologia del browser.
>
> Che fosse un endpoint di **debug rimasto acceso** lo diceva il codice stesso:
> `${ctx.session.user}` produceva la stringa `[object Object]`.
>
> **Presidi:** quattro test che invocano l'handler preso dall'array di rotte
> **vero** e pretendono che l'uscita non contenga il token, né l'email, né i
> ruoli; più la coerenza con C5 (una sessione con `user` ma senza il flag è
> trattata come anonima).

**Dove:** `plugins/adminUsers/main.js:184`

La rotta è dichiarata `requiresAuth: false` e risponde così:

```js
ctx.body = `complimenti sei loggato ${ctx.session.user} sessione: ${JSON.stringify(ctx.session)}`;
```

**Il problema:** `JSON.stringify(ctx.session)` non stampa « i dati dell'utente »:
stampa **tutto** ciò che sta nella sessione, incluso `csrfToken`, che il plugin
`csrfProtection` custodisce lì proprio perché non sia leggibile. Un token CSRF che
compare in una risposta è un token che può finire nei log di un proxy, nella cronologia
del browser, o in un referer.

Va aggiunto che `${ctx.session.user}` produce la stringa `[object Object]`: è un
endpoint di **debug** rimasto acceso, non una funzionalità.

**Come si corregge:** restituire un JSON minimo (`{ authenticated: true, username }`),
oppure rimuovere la rotta. Se serve per i test, spostarla dietro `debugMode`.

---

## C2 · Rate limiting inefficace su IPv6, e senza tetto

> ✅ **CORRETTO (2026-11-23), v3.49.0.** Entrambi i punti.
>
> **(1) Gli IPv6 sono normalizzati alla /64** in `resolveClientId`, sia sul ramo
> della socket sia su quello di `X-Forwarded-For`. Misurato: quattro indirizzi
> della stessa /64 — che prima partivano da quattro contatori a zero —
> condividono ora una chiave, e la stessa rete scritta in forme diverse
> (compressa, con zeri non significativi, in maiuscolo) dà sempre la stessa.
>
> **Tre casi limite gestiti, e il secondo conta più degli altri:** un **IPv4** resta
> intero (l'indirizzo *è* la chiave giusta); un **IPv4-mapped** (`::ffff:1.2.3.4`)
> è trattato come IPv4 — troncarlo alla /64 metterebbe **tutti** gli IPv4 mappati
> del mondo nello stesso contatore, cioè trasformerebbe la difesa in un blocco
> globale; lo **zone id** (`%eth0`) è un dettaglio dell'host e viene scartato.
>
> **Il prezzo, dichiarato:** utenti legittimi *diversi* dietro la stessa /64
> condividono il contatore. In una rete domestica è lo stesso abbonato; in uno
> studio o in un campus possono essere persone diverse. È il compromesso che
> rende la difesa efficace su IPv6.
>
> **(2) Tetto di 10.000 voci con sfratto**, applicato all'inserimento — l'unico
> momento in cui la mappa cresce. **L'ordine di sacrificio è una decisione di
> sicurezza, non di performance:** prima le voci **senza blocco attivo** dalla
> meno recente; solo se tutte sono bloccate, quella il cui blocco **scade prima**
> (la più vicina a essere rilasciata comunque). Sfrattare un blocco attivo
> significherebbe **rilasciare un attaccante**. Lo sfratto emette un evento di
> audit: non è una perdita silenziosa.
>
> **🐞 E un difetto colto dal presidio:** la voce appena inserita nasce con
> `lastFailureAt: 0` — l'incremento avviene dopo — quindi sembrava la meno
> recente di tutte e veniva **sfrattata subito**. Con il tetto a 1 la voce nuova
> spariva appena creata. Ora è esclusa dallo sfratto: non tracciare chi sta
> arrivando è il peggiore dei mali possibili.
>
> **⚠️ Seguito (v3.50.0): la normalizzazione era applicata in UN punto solo.**
> `resolveClientId` la faceva, le API esposte al plugin admin no. Misurato: un ban
> su `2001:db8::5` digitato nella GUI veniva salvato con quella chiave mentre
> l'enforcement cercava `2001:db8:0:0::/64` — **il ban era inerte**. E lo stato
> dei blocchi è persistito: un blocco **attivo** scritto dalla versione
> precedente risultava rilasciato al primo riavvio dopo l'aggiornamento (rilievo
> che la revisione automatica non aveva visto). Ora normalizzano tutti i confini,
> lo stato viene **ri-chiavato** al caricamento tenendo il valore più
> restrittivo, e la distinzione fra indirizzo e chiave è nei nomi
> (`clientId` / `clientKey`), perché il difetto è nato da quell'ambiguità.
>
> **Presidi:** 18 test in `plugins/rateLimiter/tests/unit/ipv6AndCap.test.js`.
>
> **Rifinita il 2026-11-25 (v3.51.0), su revisione del codice.** Il tetto c'era
> ma costava troppo: lo sfratto ordinava **l'intera** mappa per trovare una voce
> sola, cioè O(n log n) a ogni inserimento oltre il tetto — il lavoro peggiora
> proprio mentre l'attacco riempie la mappa. Ora è una scansione singola che
> tiene il minimo (misurato su 10 000 voci: **1,36 ms → 0,69 ms**), e la voce
> appena creata è **protetta** dallo sfratto: sfrattare quella che stai scrivendo
> rende il contatore azzerabile a comando. Il tetto è inoltre **configurabile**
> (`custom.maxTrackedEntries`, `schemaVersion` 2→3) invece che costante nel
> codice: chi ospita molte regole su molti IP deve poterlo alzare.

**Dove:** `plugins/rateLimiter/lib/keyResolver.js:22`, `plugins/rateLimiter/lib/rateLimitEngine.js:40`

**Due problemi indipendenti nello stesso plugin.**

**(1) La chiave è l'indirizzo IP intero.** Su IPv4 ha senso: un indirizzo costa. Su
IPv6 no: l'assegnazione minima a un utente domestico è una **/64**, cioè
18 miliardi di miliardi di indirizzi. Cambiare indirizzo a ogni tentativo è banale, e
ogni tentativo parte da un contatore a zero. La difesa anti brute-force **non
rallenta nulla** su IPv6.

La pratica standard è normalizzare gli indirizzi IPv6 alla **/64** prima di usarli
come chiave, così l'intera assegnazione condivide un contatore.

**(2) Nessun tetto al numero di chiavi tracciate.** `this.state` è una `Map` che
cresce di una voce per ogni combinazione (IP, regola) con almeno un fallimento.
`sweep()` rimuove solo le voci « pulite », cioè quelle già scadute. Sotto un attacco
distribuito (o sfruttando il punto 1) la mappa cresce senza limite — e siccome lo
stato viene **persistito su disco**, cresce anche il file, che a ogni flush viene
riscritto per intero in modo sincrono.

**Come si corregge:** normalizzare gli IPv6 alla /64 in `resolveClientId`; imporre un
tetto al numero di voci (con eviction LRU delle meno recenti) e uno alla dimensione
dello stato persistito.

---

## C3 · Enumerazione utenti per timing sul login

> ✅ **CORRETTO (2026-11-23), v3.46.0.** Il ramo « utente inesistente » confronta
> ora la password contro un **hash equalizzatore** — un bcrypt valido di una
> password che nessuno conosce — quindi costa come il ramo « password sbagliata ».
>
> **Misurato, prima e dopo**, con un utente vero presente nel file:
>
> | caso | prima | dopo |
> |---|---|---|
> | utente vero, password errata | ~80 ms | 82 ms |
> | utente **inesistente** | **~0 ms** | 57 ms |
> | chiave di prototipo | *500* | 56 ms |
>
> L'hash è una **costante** e non un valore calcolato al caricamento: calcolarlo
> costerebbe ~100 ms a ogni boot per ottenere lo stesso effetto.
>
> **Il presidio verifica il MECCANISMO, non il tempo:** tre test controllano che
> `bcrypt.compare` venga invocato anche per un utente che non esiste e per una
> chiave di prototipo, e che l'hash equalizzatore sia un bcrypt **valido** — se
> fosse malformato, `compare` rigetterebbe subito e l'oracolo si riaprirebbe con
> lo stesso numero di chiamate. Un'asserzione sui millisecondi sarebbe instabile
> su una macchina carica, e un presidio instabile viene disattivato.

**Dove:** `plugins/adminUsers/lib/libAccess.js:14`

```js
if (!username || !password || !usersAccounts.users[username]) return false;   // ritorno immediato
const isMatch = await bcrypt.compare(password, storedHash);                    // ~100 ms
```

Se l'utente **non esiste**, la funzione ritorna subito. Se esiste, esegue un confronto
bcrypt, deliberatamente lento. La differenza è di circa due ordini di grandezza:
misurabile con precisione anche attraverso la rete, e sufficiente a distinguere gli
username validi da quelli inventati.

Il `rateLimiter` mitiga (limita il numero di tentativi), ma non elimina: bastano poche
richieste per username, e su IPv6 il limite non morde affatto (C2).

**Come si corregge:** nel ramo « utente inesistente », eseguire comunque un
`bcrypt.compare` contro un hash fittizio precalcolato, e poi ritornare `false`. Il
tempo di risposta diventa indistinguibile.

---

## C4 · Policy password incoerente fra i due punti di scrittura

> ✅ **CORRETTO (2026-11-23), v3.48.0.** Una sola policy, in
> `core/passwordPolicy.js`, usata da **tutti** i punti che scrivono una password.
>
> **Le policy erano TRE, non due:** la terza, che la scheda non cita, è quella del
> wizard (`scripts/lib/validators.js`) — ≥ 8 caratteri con maiuscola, minuscola e
> cifra. È la **più stretta** delle tre, ed è diventata quella condivisa:
> adottarla non indebolisce nessun percorso, li allinea tutti al più severo.
> (Il modulo sta in `core/` e non in `plugins/adminUsers/lib/` come suggeriva la
> scheda, perché anche il wizard deve usarlo e la direzione tooling → core è la
> regola del progetto.)
>
> **E la denylist, come la scheda chiedeva — con un reperto.** L'esempio di
> password **valida** nel test del wizard era `Password1`: soddisfa tutti i
> requisiti di composizione ed è fra le password più usate al mondo. Un criterio
> che approva il proprio controesempio è la ragione per cui la denylist serve;
> l'esempio è stato sostituito e il caso è diventato un presidio.
>
> La validazione in `userUsert` sta **prima** dell'hash: non si spendono 100 ms di
> bcrypt per rifiutare. Dieci fixture di test usavano la stringa `'password'`,
> ora rifiutata: aggiornati a una password conforme, perché l'oggetto di quei test
> è lo **username** e una password non valida mascherava l'errore da osservare.
>
> **Presidi:** 23 test in `tests/unit/core/passwordPolicy.test.js`, fra cui quattro
> **strutturali**: i tre punti importano la policy, il minimo di 6 non compare più,
> e la validazione precede l'hash (verificato sulle posizioni nel sorgente).

**Dove:** `plugins/adminUsers/main.js:574` e `plugins/adminUsers/userManagement.js:21`

Due punti creano o modificano una password, con due regole diverse:

| Punto | Chi lo usa | Controllo |
|---|---|---|
| `updateUserProfile` | l'utente sul proprio profilo | minimo **6 caratteri** |
| `userUsert` | l'admin che crea un utente, **incluso il primo root** | **nessun controllo** |

Il punto senza alcun controllo è quello che crea l'utente **più privilegiato del
sistema**. Una password di un carattere è accettata senza obiezioni.

Anche il minimo di 6 caratteri è sotto ogni raccomandazione corrente (NIST indica 8
come minimo assoluto), e non c'è alcun controllo contro le password più comuni.

**Come si corregge:** una funzione unica di validazione in `plugins/adminUsers/lib/`,
invocata da entrambi i punti. Come minimo: lunghezza ≥ 8 e denylist delle password
più diffuse. Essendo una regola che cambia comportamento, va annotata in
`CHANGELOG.md`.

---

## C5 · Due definizioni diverse di « autenticato »

> ✅ **CORRETTO (2026-11-23), v3.46.0.** `core/isAuthenticated.js` è ora la
> definizione unica, usata da entrambi i punti. Espone due funzioni:
> `isAuthenticated(ctx)` e `sessionUser(ctx)`, che restituisce l'utente **solo
> se** la sessione è autenticata — da usare al posto di `ctx.session?.user ||
> null`, che è la forma che restituiva l'oggetto comunque.
>
> **La definizione è la più STRETTA delle due e pretende entrambi i campi:** un
> oggetto utente senza il flag non è una sessione autenticata, e un flag senza
> l'oggetto non permette di decidere alcun ruolo.
>
> **È un cambiamento di comportamento, non un refactoring, e si è visto subito:**
> dieci test preesistenti costruivano fixture con `session: { user: … }` **senza**
> il flag e sono diventati rossi. Non erano sbagliati — si appoggiavano alla
> definizione larga. Allineati facendo impostare ai loro helper entrambi i campi,
> come fa il login vero.
>
> **Presidi:** 15 test in `tests/unit/core/isAuthenticated.test.js`, fra cui i
> casi « utente senza flag » e « flag senza utente », il flag di tipo sbagliato
> (`'true'`, `1`), e tre presìdi **strutturali** che pretendono che i due punti
> importino la funzione condivisa e che **nessuno dei due** guardi più
> `ctx.session?.user || null` da sé.

**Dove:** `core/pluginSys.js:1004` contro `plugins/adminAccessControl/lib/accessManager.js:203`

I due punti che decidono se un utente è autenticato usano criteri diversi:

```js
if (!ctx.session || !ctx.session.authenticated) { ... }   // route-wrap: guarda il flag
const user = ctx.session?.user || null;                    // middleware pagine: guarda l'oggetto
```

Oggi coincidono, perché il login imposta entrambi i campi insieme e il logout azzera
l'intera sessione. Ma è una **coincidenza mantenuta a mano**: nulla nel codice o nei
test impedisce che un giorno un `ctx.session.user` venga impostato senza
`authenticated` — per esempio per ricordare l'ultimo username in un form, o durante un
flusso a due fattori. In quel momento il controllo delle pagine considererebbe
autenticato qualcuno che il controllo delle rotte rifiuta.

**Come si corregge:** una funzione condivisa in `core/` (`isAuthenticated(ctx)`),
usata da entrambi. Rende l'invariante esplicita e la mette in un solo posto.

---

## C6 · `cliBridge`: `chmod` dopo `listen`, e fallimento non fatale

> ✅ **CORRETTO (2026-11-23), v3.47.0.** Il socket **nasce** già con i permessi
> giusti, e se non si possono garantire il canale **non si apre**.
>
> **La finestra è chiusa, non accorciata.** Il `chmod` stava dentro la callback di
> `listen`, cioè dopo che il socket esisteva. Ora la `umask` del processo è
> impostata attorno al bind — l'unico modo di influenzare il modo di *creazione*
> di un socket UNIX da Node, che non accetta un'opzione di modo su `listen` — e
> viene ripristinata appena il socket esiste, perché è globale al processo.
> **Misurato:** il socket risulta `600` alla nascita, senza che il `chmod` sia
> intervenuto. Il `chmod` resta come cintura, per i filesystem dove la umask non
> avesse effetto.
>
> **E il fallimento è fatale.** Prima era un `console.warn` e il canale restava
> aperto con permessi **ignoti**. Ora: socket chiuso, file rimosso, nessun canale
> — chi usa la CLI riceve un errore di connessione, non un canale di cui non sa
> chi ascolta. Lo stesso trattamento vale se il `chmod` **non lancia** ma il modo
> misurato non è quello chiesto: la garanzia che conta è quella verificata.
>
> **⚠️ Seguito (v3.50.0): la umask restava avvelenata.** La ripristinavo solo
> nella callback di `listen`, ma un errore di bind arriva sull'evento `error` —
> quindi su un bind fallito restava a `0o777 & ~socketMode` per **tutta la vita
> del processo**. Misurato: da `022` a `177`, con la conseguenza che ogni
> **directory** creata dopo nasceva senza bit di esecuzione, cioè non
> attraversabile. Ora è ripristinata su entrambe le uscite, e tre test lo
> presidiano — compreso uno che verifica la *conseguenza*, non la variabile.
>
> **Presidi:** 5 test in `tests/unit/cliBridge/socketPermissions.test.js`. Il modo
> è **misurato sul file** per `0600` e `0660`; uno verifica che la `umask` del
> processo venga ripristinata (lasciarla stretta cambierebbe il modo di ogni file
> creato dopo, in tutta l'applicazione); due simulano il fallimento e pretendono
> che il canale non si apra e che il socket non resti in giro.

**Dove:** `core/cliBridge/server.js:173`

```js
server.listen(socketPath, () => {
  try {
    fs.chmodSync(socketPath, socketMode);   // 0o660
  } catch (err) {
    console.warn(`[cliBridge] impossibile applicare chmod ...`);   // solo un warning
  }
  ...
});
```

**Due problemi.** Primo, il socket viene creato da `listen()` con i permessi derivati
dall'umask del processo, e solo **dopo** viene ristretto: c'è una finestra, per quanto
breve, in cui i permessi sono quelli di default. Con un umask permissivo (alcuni
supervisori di servizio lo lasciano a `000`) quella finestra è sfruttabile.

Secondo, e più importante: se il `chmod` **fallisce**, il bridge resta in ascolto con
permessi ignoti e il programma prosegue. È un fail-open su un canale che può
disattivare l'area admin, spegnere il sito pubblico e riavviare il processo.

**Come si corregge:** impostare l'umask prima di `listen` (o creare il socket in una
directory già ristretta), e trattare il fallimento del `chmod` come **fatale**:
chiudere il server e non offrire il canale. Un canale di controllo che non riesce a
proteggersi non deve esistere.

---

## C7 · Il ruolo `admin` (1) equivale a esecuzione di codice remoto

> ✅ **CORRETTO (2026-11-23), v3.48.0 — strada (a): detto.** Non è un difetto di
> implementazione ma una caratteristica che la documentazione contraddiceva:
> `CLAUDE.md` descriveva il ruolo 0 come « accesso completo al sistema » e il
> ruolo 1 come « accesso completo alle risorse admin », lasciando intendere una
> gerarchia **che non esiste**.
>
> Ora la sezione RBAC dice a voce alta che **0 e 1 sono equivalenti dal punto di
> vista della sicurezza**, e che assegnare il ruolo 1 significa **concedere il
> controllo del server** — perché un `.ejs` è codice eseguito dal server, e
> installare un plugin da un repo arbitrario lo esegue al boot successivo.
>
> La strada **(b)** — restringere a `[0]` le operazioni che scrivono codice
> eseguibile — è registrata in `TODO.md` per l'uscita dall'alpha, come la scheda
> consiglia: è il momento in cui la distinzione fra « amministra il sito » e
> « amministra il server » diventa quella che rende utile avere due ruoli. Prima è
> un vincolo senza beneficiario.

**Dove:** `plugins/admin/pagesManagment.js` e `plugins/admin/pluginsInstall.js` —
tutte le rotte dichiarano `allowedRoles: [0, 1]`

Questo non è un difetto di implementazione: è una **caratteristica** del progetto che
merita di essere detta a voce alta, perché la documentazione dei ruoli suggerisce
altro.

Chi ha il ruolo 1 può:

- **scrivere file `.ejs` arbitrari sotto `/www`** (`pagesManagment`). I file `.ejs`
  sono template eseguiti dal motore EJS lato server: un template può fare
  `require('child_process')`. Scrivere una pagina **è** eseguire codice sul server.
- **installare plugin da un repository Git arbitrario** (`pluginsInstall`), il cui
  `main.js` viene caricato ed eseguito al boot successivo.

Entrambe sono legittime in un CMS « developer-first » che rifiuta esplicitamente
l'approccio zero-knowledge: sono lo strumento di lavoro, non una falla.

**Il problema è la documentazione dei ruoli.** `CLAUDE.md` descrive il ruolo 0 come
*« accesso completo al sistema, incluse le operazioni critiche »* e il ruolo 1 come
*« accesso completo a tutte le risorse admin »*, lasciando intendere una gerarchia. In
pratica la gerarchia **non esiste**: il ruolo 1 può ottenere tutto ciò che può ottenere
il ruolo 0, passando per l'esecuzione di codice.

**Come si corregge —** due scelte, entrambe difendibili:

- **(a) Dirlo.** Aggiungere alla documentazione dei ruoli che 0 e 1 sono equivalenti
  dal punto di vista della sicurezza, e che assegnare il ruolo 1 significa concedere
  il controllo del server. Costo: un paragrafo.
- **(b) Renderlo vero.** Restringere a `[0]` le operazioni che scrivono codice
  eseguibile: `pagesManagment` (creazione/modifica pagine) e `pluginsInstall`/
  `themesInstall`. Il ruolo 1 conserva la gestione di utenti, contenuti e
  configurazione. Costo: una modifica a ~15 dichiarazioni `access`, più
  l'aggiornamento dei test.

Consiglio **(a)** per ora e **(b)** quando il progetto uscirà dallo stadio alpha: la
distinzione fra « amministra il sito » e « amministra il server » è quella che rende
utile avere due ruoli.

---

# ✅ D — Cosa è stato verificato e risulta solido

Elencato per calibrare la revisione: **non** sono aree che non ho guardato, sono aree
che ho guardato e che ho trovato in ordine. Serve anche a evitare che un futuro
intervento « migliori » qualcosa che è già stato progettato bene.

- **`plugins/csrfProtection`** — token da 256 bit generati con
  `crypto.randomBytes`, confronto a tempo costante (`crypto.timingSafeEqual`),
  rotazione del token al cambio di privilegi (login), controllo Origin/Referer come
  secondo livello, e — la scelta migliore — l'**ambito CSRF derivato dal campo
  `access` che le rotte già dichiarano**, invece di un marcatore separato da tenere
  allineato a mano. È la parte più solida del codebase.
- **`core/pathCanonicalizer.js` e i due layer** — la guardia obbligatoria
  (canonicalizzazione prima del match) più il gate opzionale (rifiuto dei path non
  canonici). L'invariante dichiarata — *« A chiude la vulnerabilità da sola, B è
  difesa in profondità »* — è vera nel codice, e il ragionamento sul perché è
  documentato bene.
- **Il contratto delle rotte** (`handler` / `access` / metodo maiuscolo) — i tre modi
  di sbagliare una rotta hanno oggi la **stessa** risposta (non registrata + warning
  al boot), e lo sweep in `tests/integration/routeContract.test.js` usa **lo stesso
  predicato** del dispatcher, esportato apposta (`pluginSys.declaresAccess`). È
  esattamente il presidio che manca altrove.
- **`git clone` in `pluginsInstall`/`themesInstall`** — `spawn` senza shell, `--`
  prima dell'URL (niente option injection), `GIT_TERMINAL_PROMPT=0`, timeout con kill,
  nome del plugin validato **prima** di diventare un percorso su disco. Nessuna
  injection possibile.
- **`plugins/adminMedia/lib/fileValidator.js`** — doppia validazione estensione +
  magic bytes, SVG correttamente **escluso** dalla whitelist delle immagini (è il
  vettore XSS classico degli upload). `mediaManager.safeResolve` è la versione
  corretta del controllo di traversal.
- **Boot graceful e ciclo di vita dei config** — `pluginLoadOrder` e
  `pluginStateResolver` come moduli **puri** e testabili, box diagnostici azionabili,
  e in particolare il box `[WEIGHT]`, che invece di tacere una contraddizione
  (« il peso dice presto, la dipendenza dice non prima di questo ») la **nomina**.
  Architettura sopra la media per un progetto di questa età.
- **CI** (`.github/workflows/ci.yml`) — matrice su Node 22 e 24, audit delle
  dipendenze anche su cron settimanale (che intercetta gli advisory pubblicati su
  dipendenze già installate, cosa che una run solo-su-PR mancherebbe), e un ratchet
  anti-regressione sulla coverage. 164 file di test.

---

# 📌 E — Ordine di intervento suggerito

L'ordine tiene conto di tre cose: gravità, costo, e **quanto è probabile che il
difetto rientri** se non si aggiunge un presidio.

| Priorità | Voci | Perché in questa posizione |
|---|---|---|
| **1** | **A2** | Una riga più un test. Porta a impersonazione di root su ogni installazione fresca, ed è il rapporto impatto/costo più sbilanciato di tutta la revisione. |
| **2** | **A1 + A3 + A4** | Tre facce dello stesso sottosistema (`patternMatcher` + `accessManager`). Conviene un intervento unico, con i test che coprano `adminPrefix` custom, il tie-break e i pattern misti. |
| **3** | **A7** | Due modifiche piccole e localizzate su un DoS remoto non autenticato. Il costo è minimo, la finestra di esposizione è la configurazione di produzione raccomandata. |
| **4** | **B3, B1, B2** | Perdita di dati e installazione non avviabile. Tutti e tre risolvibili con strumenti che il progetto **già possiede** (`setJson5Key`, `BackupManager`, temp + `rename`). |
| **5** | **B4, B5, B6, C1, C3, C5, C6** | Correzioni piccole e indipendenti, raggruppabili in un unico passaggio di pulizia. |
| **6** | **C2, C4, C7** | Richiedono una decisione (normalizzazione /64, policy password, ruoli) prima del codice. |
| **7** | **A5** | Lavoro **nuovo**, non una correzione: va progettato (la CSP richiede cautela per non rompere i temi esistenti) e merita un intervento dedicato. |
| **8** | **B7** | Decisione architetturale. Se si sceglie la strada (a) — dichiarare single-process — costa una pagina di documentazione e può salire di priorità. |

---

# 🔎 F — Osservazione di metodo: il filo comune

Quattro dei difetti sopra hanno **la stessa forma**, e vale la pena vederli insieme
perché suggeriscono un intervento diverso dalle singole fix:

| Difetto | L'implementazione corretta esiste già in… |
|---|---|
| **A1** — `/admin` cablato | `core/priorityMiddlewares/runtimeGate.js:60`, che deriva il prefisso dal config |
| **A5** — nessun security header | `runtimeGate.js:217`, che li imposta correttamente sulla pagina di manutenzione |
| **B1** — scrittura non atomica | cinque store diversi, tutti con temp + `rename` |
| **B3** — commenti distrutti | `core/setJson5Key.js` ed `core/editJson5.js`, scritti apposta per non perderli |
| **B5** — `startsWith` senza separatore | `plugins/adminMedia/lib/mediaManager.js:34`, che usa `rootWithSep` |

Il progetto **non manca degli strumenti giusti**: li ha scritti, li ha documentati, e
in molti punti li usa. Quello che manca è il **presidio che impedisce ai due gemelli
di divergere** — cioè un test che leghi l'implementazione corretta a tutti i suoi
utilizzatori.

Il progetto ha già fatto questa mossa una volta, e bene. Il commento in
`core/pluginSys.js:1185` dice:

> *Esposto perché `core/testHelpers/routeRunner.js` usi LO STESSO predicato del
> runtime invece di riscriverlo: la parte in comune fra validatore e dispatcher è già
> tornata a divergere una volta.*

È esattamente il ragionamento che serve qui, applicato ad altri quattro casi. Ogni
volta che una regola di sicurezza o una convenzione di scrittura viene implementata,
la domanda da porsi è: **cosa impedisce alla seconda copia di allontanarsi dalla
prima?** Se la risposta è « l'attenzione di chi modifica », il difetto rientrerà.

---

## Nota sui limiti di questa revisione

- **La suite di test non è stata eseguita** (`node_modules` assente nell'ambiente):
  tutte le affermazioni derivano dalla lettura del codice o dall'esecuzione diretta
  dei moduli puri, mai da una run dei test del progetto.
- **Non è stata fatta verifica dinamica** con il server avviato: nessuna delle voci
  qui è marcata « riprodotta dal vivo », a differenza di
  `docs/security/audit-session-auth-admin.it.md`. Prima di considerare chiusa una
  voce 🔴, vale la pena riprodurla su un'istanza reale.
- **Non è stato analizzato `koa-classic-server`**, che è dipendenza mantenuta dal team
  e va revisionata nel suo repository (regola 4 di `CLAUDE.md`: i bug lì vanno
  segnalati e corretti nel modulo, non aggirati qui).
- **Copertura non uniforme:** i plugin `sentinel`, `analytics`, `mailer`, `ccxt` e
  `dbApi` sono stati esaminati in modo più superficiale degli altri. Su `sentinel` in
  particolare — 1.700 righe di plugin di sicurezza — quanto ho letto è di buona
  qualità, ma non l'ho coperto per intero.

---

**Revisione condotta da:** Claude (Claude Code) su richiesta del maintainer
**Documento correlato:** [`docs/security/audit-session-auth-admin.it.md`](./docs/security/audit-session-auth-admin.it.md) — audit precedente, ambito sessione/auth/admin
**Registro dei lavori aperti:** [`TODO.md`](./TODO.md) — le voci non ancora affrontate qui vanno riportate lì una volta pianificate
