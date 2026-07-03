# Audit di sicurezza — Sessione, Autenticazione, Area Admin

> **Data audit:** 2026-07-03
> **Ambito:** meccanismi di sessione, autenticazione utente, controllo accessi
> all'area di amministrazione ed endpoint riservati.
> **Escluso:** modulo `koa-classic-server` (analizzato separatamente).
> **Metodo:** revisione del codice + verifica empirica con server avviato
> (le voci marcate ✅ CONFERMATO sono state riprodotte dal vivo).

Questo documento è un **piano di lavoro tracciabile**: l'indice ha una checkbox
per ogni voce. Spuntala (`[x]`) quando la voce è **risolta e verificata**.
La procedura operativa per affrontarle una a una è in fondo.

---

## Indice / Stato di avanzamento

| # | Sev. | Vulnerabilità | Stato |
|---|------|---------------|-------|
| 1 | 🔴 Alta | [Bypass del controllo accessi admin via path non canonico](#1--bypass-del-controllo-accessi-admin-via-path-non-canonico) | - [x] ✅ corretto |
| 2 | 🟠 Media | [`defaultPolicy: "allow"` — postura deny-list fragile](#2--defaultpolicy-allow--postura-deny-list-fragile) | - [ ] |
| 3 | 🟠 Media | [Scritture non atomiche sullo store di autenticazione](#3--scritture-non-atomiche-sullo-store-di-autenticazione) | - [ ] |
| 4 | 🟠 Media | [Un admin (ruolo 1) può impossessarsi del root (ruolo 0)](#4--un-admin-ruolo-1-può-impossessarsi-del-root-ruolo-0) | - [ ] |
| 5 | 🟡 Bassa | [Cookie di sessione senza flag `Secure`](#5--cookie-di-sessione-senza-flag-secure) | - [ ] |
| 6 | 🟡 Bassa | [Endpoint di debug `GET /api/adminUsers/logged`](#6--endpoint-di-debug-get-apiadminuserslogged) | - [ ] |
| 7 | ℹ️ Info | [Chiavi di sessione placeholder](#7--chiavi-di-sessione-placeholder) | - [ ] |
| 8 | 🟡 Bassa | [`seo`: route POST con `method` minuscolo → ignorata](#8--seo-route-post-con-method-minuscolo--ignorata) | - [x] ✅ corretto |
| 9 | ℹ️ Info | [`adminBootstrapNavbar`: endpoint admin aperti al ruolo 2 (editor)](#9--adminbootstrapnavbar-endpoint-admin-aperti-al-ruolo-2-editor) | ✔️ intenzionale (won't fix) |

Legenda severità: 🔴 Alta · 🟠 Media · 🟡 Bassa · ℹ️ Informativa.

> ✅ **Esito verifica endpoint API sensibili** — vedi
> [Appendice A](#appendice-a--verifica-degli-endpoint-api-sensibili): il layer
> di autorizzazione delle **API** (`/api/...`) è risultato **solido** in test dal
> vivo. Il bypass della voce #1 riguarda **solo** le pagine admin statiche, non
> gli endpoint API.

---

## 1. 🔴 Bypass del controllo accessi admin via path non canonico

**Stato:** - [x] ✅ **CORRETTO** (2026-07-03) · **Severità:** Alta · **Tipo:** Broken Access Control / Auth bypass · ✅ **CONFERMATO dal vivo**

> ### ✅ Fix applicata — architettura a due layer (A obbligatoria + B opzionale)
>
> **Modulo condiviso** `core/pathCanonicalizer.js` (fonte unica): `canonicalizePath()`
> (risolve dot-segment e slash doppi, senza decodificare) + `isCanonicalPath()`
> (predicato per il gate B).
>
> - **Layer A — OBBLIGATORIO** (`plugins/adminAccessControl/lib/accessManager.js` →
>   `createMiddleware`): la guardia canonicalizza `ctx.path` **prima** del match, così
>   la regola `/admin/**` matcha anche i path non puliti. Chiude il bypass **da sola**,
>   sempre attiva. Neutralizza sia l'anonimo sia l'utente autenticato a basso privilegio
>   (la regola con ruoli `[0,1]` viene applicata correttamente).
> - **Layer B — OPZIONALE, default on** (`core/priorityMiddlewares/priorityMiddlewares.js`,
>   primissimo middleware): gate globale che risponde **400** ai path non canonici,
>   controllato da `ital8Config.json5 → rejectNonCanonicalPaths` (bump `schemaVersion` 1→2).
>   Difesa in profondità su TUTTA l'app.
>
> **INVARIANTE:** A è sempre attiva e chiude #1 da sola; disattivare B **non** riapre la
> vulnerabilità (rimuove solo un layer globale). Commento esplicito nel `.default`.
>
> **Verifica (test automatici, tutti verdi):**
> - `tests/unit/core/pathCanonicalizer.test.js` — logica di canonicalizzazione/predicato
>   + **regressione falsi positivi** (vedi sotto).
> - `tests/unit/accessManager.test.js` (esteso) — **prova di A**: path non canonici verso
>   `/admin` bloccati (redirect login / access-denied) anche senza B.
> - `tests/integration/rejectNonCanonicalPaths.test.js` — end-to-end: **B on** → 400;
>   **B off** → 302 login (mai 200), a dimostrazione che A chiude il bypass da sola;
>   + regressione query-string-con-slash e ACME.
> - Suite completa: **2451 test, 0 regressioni**.
>
> ### 🔒 Regressione — path legittimi che NON devono mai essere rifiutati
> Blindati da test dopo verifica dal vivo (per evitare falsi positivi del gate B):
> - **`/.well-known/acme-challenge/...`** (Let's Encrypt ACME) → passa.
> - **Spazi** — sia `%20` sia letterali, sia nei nomi di **FILE** sia di **CARTELLA**
>   (es. `/my folder/report final.pdf`) → passano (lo spazio 0x20 è fuori dal range
>   dei control char rifiutati).
> - Doppio punto **nel nome** file (`my..file.txt`, non dot-segment), hidden file
>   (`.gitignore`), unicode → passano.
> - **Query string** con slash/dot-segment (`?redir=/x/../y`) → passa: il gate opera su
>   `ctx.path`, non su `ctx.url`.
>
> ### 🔍 Revisione (code-review, 8 angoli, high effort)
> Eseguita sul diff: **0 bug di correttezza**. Verificati globalPrefix (nessuna
> regressione, anzi migliora `//app/admin`), `path.posix.normalize` (corretto anche su
> Windows), `checkInTemplate` (non usa il path per il match → nessun gap), doppia-encoding
> e overlong (coperti da B / non serviti dal file server). Unico rilievo (cosmetico):
> commento fuorviante + costruzione contorta della regex control-char → **corretto**
> (regex literal `/[\x00-\x1f\x7f]/`), test verdi.
>
> Nota: la voce **#2** (`defaultPolicy: allow`) resta aperta come hardening di postura
> separato — non era un prerequisito per chiudere #1 (A riconduce il path alla regola
> specifica, senza dipendere dal default).

### Descrizione
Le pagine admin sono servite come **file statici** da `koa-classic-server`. La loro
protezione dipende **interamente** dal middleware globale di `adminAccessControl`,
che confronta `ctx.path` — **grezzo, non normalizzato** — contro il pattern
`/admin/**`. Il file server statico invece **normalizza** il path (`/./`, `/x/../`)
prima di risolvere il file su disco. Questa discrepanza di normalizzazione annulla
il controllo di accesso.

Poiché `defaultPolicy` è `"allow"`, ogni path che non matcha una regola esplicita
è pubblico: `/./admin/...` non matcha `^/admin/.*$` → "allow" → file servito.

### Prova di concetto (nessuna autenticazione)

| Richiesta | Risultato osservato |
|---|---|
| `GET /admin/usersManagment/index.ejs` | `302` → redirect al login ✅ (protetto) |
| `GET /./admin/usersManagment/index.ejs` | **`200` — pagina admin servita** ❌ |
| `GET /x/../admin/usersManagment/index.ejs` | **`200` — pagina admin servita** ❌ |
| `GET /./admin/rolesManagment` | **`200`** (gestione ruoli) ❌ |
| `GET /./admin/adminAccessControl` | **`200`** (editor delle regole di accesso) ❌ |
| `GET /./admin/index.ejs` | **`200`** (dashboard admin) ❌ |

```bash
# Riproduzione
curl -s -o /dev/null -w "%{http_code}\n" --path-as-is http://localhost:3000/admin/usersManagment/index.ejs      # 302 (ok)
curl -s -o /dev/null -w "%{http_code}\n" --path-as-is http://localhost:3000/./admin/usersManagment/index.ejs    # 200 (BYPASS)
curl -s -o /dev/null -w "%{http_code}\n" --path-as-is http://localhost:3000/x/../admin/usersManagment/index.ejs # 200 (BYPASS)
```

### Impatto
- Esposizione dell'intera UI admin a utenti **anonimi** (struttura sezioni, JS
  interno, percorsi endpoint, la pagina che mostra `accessControl.json5`).
- I **dati** restano protetti perché caricati via API `/api/...` (gestite dal
  router `@koa/router`, matching diverso; `/./api/...` → 404, e ogni route ha il
  proprio `access`). Ma il gate di autenticazione **sulle pagine** è aggirato, e
  qualunque pagina admin che renderizzi dati sensibili server-side li leakerebbe.

### Causa radice (lato ital8cms — NON koa-classic-server)
`plugins/adminAccessControl/lib/accessManager.js` → `createMiddleware()`: usa
`ctx.path` senza canonicalizzarlo prima del pattern-matching.

### Rimedio proposto
1. **Canonicalizzare il path prima del match**: risolvere `.`/`..`, collassare gli
   slash multipli, decodificare in modo coerente col file server; in alternativa
   **rifiutare con `400`** i path non canonici.
2. Invertire la postura di default (vedi voce #2): `deny`/`requireAuth`.
3. Aggiungere test di regressione con i vettori `/./admin/...`, `/x/../admin/...`,
   `//admin/...`, `/%61dmin/...`, `/ADMIN/...`.

---

## 2. 🟠 `defaultPolicy: "allow"` — postura deny-list fragile

**Stato:** - [ ] da affrontare · **Severità:** Media · **Tipo:** Insecure default

### Descrizione
`plugins/adminAccessControl/accessControl.default.json5` → `defaultPolicy.action`
è `"allow"`. Il modello è **deny-list**: tutto è pubblico tranne ciò che una regola
esplicita protegge. È la precondizione che rende sfruttabile la voce #1 e, in
generale, ogni area riservata aggiunta senza una regola dedicata è pubblica.

### Impatto
Fragilità sistemica: una dimenticanza (nuovo prefisso admin, nuova sezione,
refuso in un pattern) apre un buco silenzioso.

### Rimedio proposto
Passare a postura **allow-list**: default `requireAuth` o `deny`, con whitelist
esplicita delle aree pubbliche (`/`, `/pluginPages/adminUsers/login.ejs`, risorse
del tema pubblico, ecc.). Da coordinare con la fix #1.

---

## 3. 🟠 Scritture non atomiche sullo store di autenticazione

**Stato:** - [ ] da affrontare · **Severità:** Media · **Tipo:** Data integrity / DoS

### Descrizione
`CLAUDE.md` impone scritture **atomiche** (temp + `rename`), ma lo store
utenti/ruoli usa `fs.writeFileSync` diretto:

- `plugins/adminUsers/userManagement.js:87` (`userUsert`)
- `plugins/adminUsers/main.js:581` (`updateUserProfile`)
- `plugins/adminUsers/roleManagement.js:67, 117, 151, 168`

### Impatto
Una scrittura interrotta (crash/kill) o concorrente può **corrompere**
`userAccount.json5` / `userRole.json5` → lockout dell'autenticazione / DoS,
perdita di account.

### Rimedio proposto
Applicare ovunque il pattern atomico già usato altrove nel progetto:
```js
fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), 'utf8');
fs.renameSync(file + '.tmp', file);
```
Valutare un helper condiviso (`core/saveJson5` esiste già) per uniformare.

---

## 4. 🟠 Un admin (ruolo 1) può impossessarsi del root (ruolo 0)

**Stato:** - [ ] da affrontare · **Severità:** Media · **Tipo:** Privilege escalation

### Descrizione
`POST /api/adminUsers/usertUser` (`plugins/adminUsers/main.js` → `userManagement.userUsert`)
accetta `isNewUser` e `roleIds` dal body **senza proteggere gli account root**.
Un utente con ruolo `1` (admin) può:
- inviare `isNewUser:false` con lo username del **root** e una nuova password →
  **reset delle credenziali root** (takeover);
- assegnare `roleIds:[0]` a sé stesso o ad altri → auto-promozione a root.

Nel modello RBAC il ruolo `0` (root) è **sopra** l'admin (`1`): questa è
un'escalation admin→root non prevista.

### Impatto
In installazioni multi-admin, qualsiasi admin può scavalcare il confine root.

### Rimedio proposto
Nell'handler / in `userUsert`:
- vietare la modifica di account che possiedono il ruolo `0` se il chiamante non è root;
- vietare l'assegnazione del ruolo `0` (in create e update) se il chiamante non è root.
Il ruolo del chiamante è in `ctx.session.user.roleIds`.

---

## 5. 🟡 Cookie di sessione senza flag `Secure`

**Stato:** - [ ] da affrontare · **Severità:** Bassa · **Tipo:** Hardening / session

### Descrizione
`core/priorityMiddlewares/koaSession.default.json5 → CONFIG` imposta `httpOnly` e
`sameSite:"lax"` ma **non** `secure`. Anche con HTTPS attivo il cookie non è marcato
`Secure` → potenziale leak su downgrade / mixed-content.

> Nota positiva: il token CSRF **viene ruotato** al login (`main.js:151`) — buona pratica già presente.

### Rimedio proposto
Impostare `secure: true` **in modo condizionale** quando `https.enabled` è vero
(il CMS supporta anche HTTP puro sulla 3000, quindi non può essere sempre `true`).
Valutare il prefisso `__Host-` in deployment solo-HTTPS.

---

## 6. 🟡 Endpoint di debug `GET /api/adminUsers/logged`

**Stato:** - [ ] da affrontare · **Severità:** Bassa · **Tipo:** Information disclosure

### Descrizione
`plugins/adminUsers/main.js:178` restituisce in chiaro `JSON.stringify(ctx.session)`
(contenuto della propria sessione). È un endpoint di test lasciato accessibile.

### Rimedio proposto
Rimuoverlo, oppure limitarlo alla modalità debug / proteggerlo con `access`
appropriato e non serializzare l'intera sessione.

---

## 7. ℹ️ Chiavi di sessione placeholder

**Stato:** - [ ] da affrontare · **Severità:** Informativa · **Tipo:** Promemoria operativo

### Descrizione
`koaSession.default.json5` usa `["CHANGE_ME_session_key_1", ...]`: firmano i cookie,
quindi se non ruotate sono **forgiabili** (impersonazione). Il progetto **già emette
un warning al boot** (`core/sessionSecurity.js`) e il wizard le rigenera.

### Rimedio proposto
Nessuna modifica di codice necessaria: garantire in fase di deploy che le chiavi
siano rigenerate (`npm run start-configure` o `openssl rand -hex 32`) e mai
committate. Documentato qui solo per completezza della checklist.

---

## 8. 🟡 `seo`: route POST con `method` minuscolo → ignorata

**Stato:** - [x] ✅ **CORRETTO** (2026-07-03) · **Severità:** Bassa · **Tipo:** Correttezza (contratto rotte)

### Descrizione
`plugins/seo/main.js:121` dichiarava `method: 'post'` (**minuscolo**) **e**
`func:` invece di `handler:` — due violazioni del contratto rotte di `CLAUDE.md`.
Il loader (`core/pluginSys.js` → `loadRoutes`) confronta con `'POST'` maiuscolo,
quindi la route veniva **silenziosamente ignorata** e la richiesta cadeva sul
static server. Non era un buco di sicurezza (la funzione equivalente esiste come
`POST /api/adminSeo/regenerate`, correttamente maiuscola e protetta `[0,1]`), ma
un endpoint morto.

### Fix applicata
`method: 'post'` → `method: 'POST'` e `func:` → `handler:` in
`plugins/seo/main.js`. **Verificato dal vivo:** `POST /api/seo/regenerate` risponde
ora `403` (CSRF/auth attivi) invece di `404` — la route è registrata e protetta.

> Miglioria futura (fuori ambito di questa fix): un check al boot che segnali i
> `method` non-maiuscoli / la chiave `func` invece di ignorarli in silenzio.

---

## 9. ℹ️ `adminBootstrapNavbar`: endpoint admin aperti al ruolo 2 (editor)

**Stato:** ✔️ **INTENZIONALE — won't fix** (decisione maintainer, 2026-07-03) · **Severità:** Informativa · **Tipo:** Superficie di autorizzazione

> **Decisione:** comportamento voluto — l'editor (ruolo 2) cura navigazione/contenuti
> e deve poter gestire le navbar. Nessuna modifica al codice. Voce mantenuta a
> documentazione della scelta.

### Descrizione
`plugins/adminBootstrapNavbar/main.js:31-32` dichiara `allowedRoles: [0, 1, 2]`
per le proprie rotte admin (creazione/modifica/eliminazione dei file navbar),
mentre tutti gli altri plugin admin usano `[0, 1]`. Significa che un **editor**
(ruolo 2) può gestire le navbar del sito.

### Impatto
Potenzialmente intenzionale (l'editor cura i contenuti/navigazione). Da confermare:
se non voluto, un editor ha una capacità di configurazione sito non prevista.

### Rimedio proposto
Decisione del maintainer: se non intenzionale, allineare a `[0, 1]`; se
intenzionale, documentarlo esplicitamente nel README del plugin.

---

## Procedura operativa (affrontare i punti uno a uno)

Regole di ingaggio, valide per **ogni** voce dell'indice:

1. **Un branch/una voce per volta.** Non accorpare fix eterogenee: ogni voce ha il
   suo commit isolato e verificabile.
2. **Prima il test che dimostra il bug** (red), poi la fix (green). Per la voce #1
   il test di regressione con i vettori di path elencati è obbligatorio.
3. **Naming:** per qualsiasi nuovo nome (funzione/variabile/file) proporre 2-3
   alternative e attendere l'ok del maintainer (regola `CLAUDE.md`).
4. **Verifica dal vivo** dopo la fix: avviare il server e ri-eseguire la PoC; il
   comportamento atteso deve cambiare da vulnerabile a sicuro.
5. **Spuntare la checkbox** nell'indice e nel titolo della sezione solo quando la
   fix è **implementata + verificata**; annotare nel commit il numero della voce.
6. **`CHANGELOG.md`**: registrare ogni fix (progetto alpha, breaking changes ammessi
   ma documentati).

### Ordine di lavorazione consigliato

| Passo | Voce | Perché in questo ordine |
|-------|------|--------------------------|
| 1 | **#1** + **#2** (insieme) | Auth bypass confermato e a exploit banale — massima priorità. La canonicalizzazione del path (#1) e la postura allow-list (#2) sono complementari e vanno progettate insieme. |
| 2 | **#3** | Integrità dello store credenziali: rischio corruzione/lockout. Fix meccanica e a basso rischio. |
| 3 | **#4** | Chiude l'escalation admin→root. Richiede logica sul ruolo del chiamante. |
| 4 | **#5** | Hardening cookie; condizionale su HTTPS. |
| 5 | **#6** | Rimozione/protezione endpoint di debug. Rapido. |
| 6 | **#7** | Nessun codice: checklist di deploy. |

### Definition of Done (per voce)

- [ ] Causa radice compresa e circoscritta al file/funzione indicati.
- [ ] Test di regressione aggiunto (dove applicabile) e rosso→verde.
- [ ] Fix implementata rispettando i pattern del progetto (atomicità, `loadJson5`, `access`, escaping).
- [ ] Verifica manuale dal vivo (PoC non più sfruttabile).
- [ ] Checkbox spuntata nell'indice + voce annotata in `CHANGELOG.md`.
- [ ] Nessuna regressione su login/logout, sessione, accesso admin legittimo.

---

## Appendice A — Verifica degli endpoint API sensibili

Oltre alle pagine web, ho testato **dal vivo** l'accesso agli **endpoint API**
riservati, che è il layer dove risiedono le azioni vere (lettura utenti, CRUD
ruoli, salvataggio regole di accesso, restart). Setup: 3 utenti reali —
`root` (ruolo 0), `editor3` (ruolo 3, basso privilegio), `custom100` (ruolo custom
100) — login effettivo con CSRF+Origin.

### Matrice GET (endpoint sensibili, attesi `[0,1]`)

| Endpoint | anon | ruolo 3 | ruolo 100 | root |
|---|---|---|---|---|
| `/api/adminUsers/userList` | 401 | 403 | 403 | 200 |
| `/api/adminUsers/roleList` | 401 | 403 | 403 | 200 |
| `/api/adminUsers/customRoleList` | 401 | 403 | 403 | 200 |
| `/api/adminUsers/hardcodedRoleList` | 401 | 403 | 403 | 200 |
| `/api/adminAccessControl/rules` | 401 | 403 | 403 | 200 |
| `/api/adminAccessControl/rules-json` | 401 | 403 | 403 | 200 |
| `/api/adminUsers/userInfo?username=root` | 401 | 403 | 403 | 200 |
| `/api/adminUsers/getCurrentUser` | 401 | 200 | 200 | 200 |

(`getCurrentUser` è `allowedRoles:[]` = qualsiasi autenticato → 200 per ruolo 3/100 è corretto.)

### Matrice POST mutanti (attesi `[0,1]`)

| Endpoint | ruolo 3 | ruolo 100 | root (token valido) |
|---|---|---|---|
| `/api/adminUsers/usertUser` | 403 | 403 | 200 |
| `/api/adminUsers/createCustomRole` | 403 | 403 | success |
| `/api/adminUsers/deleteCustomRole` | 403 | 403 | 200 |
| `/api/adminAccessControl/rules` | 403 | 403 | 200 |
| `/api/admin/restart` | 403 | 403 | (non eseguito) |

### Controlli aggiuntivi
- **Bypass di path sulle API:** `/./api/...` e `/x/../api/...` → **404** (il bypass
  della voce #1 **non** si applica alle API: le gestisce `@koa/router`, non il file
  server statico).
- **CSRF realmente applicato:** root POST **senza token** → 403; **con Origin
  esterno** → 403.
- **Ruolo indipendente dal CSRF:** `editor3` con un **token CSRF valido rubato** a
  root → comunque **403** sui ruoli (il controllo di ruolo non è aggirabile col token).

### Conclusione
Il layer di autorizzazione degli **endpoint API riservati funziona correttamente**
per tutti i vettori testati (anonimo, autenticato a basso privilegio, ruolo custom,
CSRF). La vulnerabilità #1 resta circoscritta al **serving statico delle pagine
admin**, non agli endpoint API.

---

*Documento generato durante l'audit del 2026-07-03. Aggiornare gli stati man mano
che le voci vengono chiuse.*
