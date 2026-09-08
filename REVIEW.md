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
| A1 | [Cambiare `adminPrefix` apre il pannello admin a chiunque](#a1--cambiare-adminprefix-apre-il-pannello-admin-a-chiunque) | Accesso anonimo alle pagine admin | - [ ] |
| A2 | [Le due reti di sicurezza sulle chiavi di sessione sono entrambe morte](#a2--le-due-reti-di-sicurezza-sulle-chiavi-di-sessione-sono-entrambe-morte) | Impersonazione root senza credenziali | - [ ] |
| A3 | [Le regole hardcoded del controllo accessi non sono immutabili](#a3--le-regole-hardcoded-del-controllo-accessi-non-sono-immutabili) | Una regola custom scavalca la protezione admin | - [ ] |
| A4 | [Regex non ancorate e mix `*`/`**` che sbaglia in silenzio](#a4--regex-non-ancorate-e-mix--che-sbaglia-in-silenzio) | Regole che proteggono l'insieme sbagliato di URL | - [ ] |
| A5 | [Nessun security header, e cookie di sessione senza `secure`](#a5--nessun-security-header-e-cookie-di-sessione-senza-secure) | XSS/clickjacking/furto cookie non mitigati | - [ ] |
| A6 | [`checkInTemplate` — la guardia documentata per i template non protegge](#a6--checkintemplate--la-guardia-documentata-per-i-template-non-protegge) | Pagina protetta servita per intero nel corpo del 302 | - [ ] |
| A7 | [Server di redirect HTTP→HTTPS: DoS remoto + open redirect](#a7--server-di-redirect-httphttps-dos-remoto--open-redirect) | Una richiesta spegne il processo | - [ ] |

### 🟠 B — Correttezza e integrità dei dati

| # | Problema | Impatto | Stato |
|---|---|---|---|
| B1 | [Il file delle credenziali è scritto in modo non atomico](#b1--il-file-delle-credenziali-è-scritto-in-modo-non-atomico) | Perdita di tutti gli account | - [ ] |
| B2 | [`updateUserProfile` — lost update fra richieste concorrenti](#b2--updateuserprofile--lost-update-fra-richieste-concorrenti) | Modifiche silenziosamente perse | - [ ] |
| B3 | [Salvare da System Settings distrugge il config e può impedire il boot](#b3--salvare-da-system-settings-distrugge-il-config-e-può-impedire-il-boot) | Installazione non più avviabile | - [ ] |
| B4 | [Oggetti indicizzati con input utente senza `hasOwnProperty`](#b4--oggetti-indicizzati-con-input-utente-senza-hasownproperty) | 500 non autenticato sul login | - [ ] |
| B5 | [`isPathSafe` confronta il prefisso senza separatore](#b5--ispathsafe-confronta-il-prefisso-senza-separatore) | Scrittura di file fuori da `/www` | - [ ] |
| B6 | [Il contratto `getObjectToShareToOthersPlugin` è documentato con tre parametri, il runtime ne passa uno](#b6--il-contratto-getobjecttosharetoothersplugin-è-documentato-con-tre-parametri-il-runtime-ne-passa-uno) | Trappola per chi scrive plugin | - [ ] |
| B7 | [Storage a file senza lock — l'architettura non regge il multi-processo](#b7--storage-a-file-senza-lock--larchitettura-non-regge-il-multi-processo) | Corruzione dati con `pm2 -i` | - [ ] |

### 🟡 C — Altri punti sostanziali

| # | Problema | Impatto | Stato |
|---|---|---|---|
| C1 | [`GET /logged` è pubblico e stampa l'intera sessione](#c1--get-logged-è-pubblico-e-stampa-lintera-sessione) | Fuga del token CSRF | - [ ] |
| C2 | [Rate limiting inefficace su IPv6, e senza tetto](#c2--rate-limiting-inefficace-su-ipv6-e-senza-tetto) | Brute-force non rallentato | - [ ] |
| C3 | [Enumerazione utenti per timing sul login](#c3--enumerazione-utenti-per-timing-sul-login) | Scoperta degli username validi | - [ ] |
| C4 | [Policy password incoerente fra i due punti di scrittura](#c4--policy-password-incoerente-fra-i-due-punti-di-scrittura) | Password deboli sull'utente root | - [ ] |
| C5 | [Due definizioni diverse di « autenticato »](#c5--due-definizioni-diverse-di--autenticato) | Invariante non presidiata | - [ ] |
| C6 | [`cliBridge`: `chmod` dopo `listen`, e fallimento non fatale](#c6--clibridge-chmod-dopo-listen-e-fallimento-non-fatale) | Canale di controllo con permessi ignoti | - [ ] |
| C7 | [Il ruolo `admin` (1) equivale a esecuzione di codice remoto](#c7--il-ruolo-admin-1-equivale-a-esecuzione-di-codice-remoto) | RBAC documentato in modo fuorviante | - [ ] |

### ✅ D — [Cosa è stato verificato e risulta solido](#d--cosa-è-stato-verificato-e-risulta-solido)

### 📌 E — [Ordine di intervento suggerito](#e--ordine-di-intervento-suggerito)

### 🔎 F — [Osservazione di metodo: il filo comune](#f--osservazione-di-metodo-il-filo-comune)

---

# 🔴 A — Sicurezza, bloccanti

## A1 · Cambiare `adminPrefix` apre il pannello admin a chiunque

**Severità:** 🔴 alta · **Sforzo:** medio · **Presidio mancante:** test con `adminPrefix` non di default

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

## A3 · Le regole hardcoded del controllo accessi non sono immutabili

**Severità:** 🔴 alta · **Sforzo:** basso · **Presidio mancante:** test sul tie-break

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

**Severità:** 🔴 alta · **Sforzo:** basso · **Presidio mancante:** validazione dei pattern misti

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
