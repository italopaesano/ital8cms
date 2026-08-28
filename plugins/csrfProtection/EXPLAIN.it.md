<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# csrfProtection — Deep-dive tecnico

> Guida d'uso (config, API, helper): vedi [`README.it.md`](./README.it.md).

## Perché è fatto così

**Perché il CSRF è un rischio reale qui:** l'autorizzazione di ogni rotta API è stabilita unicamente dal cookie di sessione (`pluginSys.#wrapHandlerWithAccessCheck` controlla `ctx.session`). Senza un token server-side né un controllo di Origin, l'app si affidava interamente al default implicito `SameSite=Lax` del browser — che (a) è una mitigazione lato client, non un controllo applicativo, e (b) **non** copre il vettore same-site sotto-dominio. Questo plugin chiude la lacuna.

La difesa è **in profondità**, con due layer indipendenti:
1. **Synchronizer token** (per sessione, ruotato al login).
2. **Controllo Origin/Referer** (same-origin dinamico, proxy-aware), con fallback al token quando entrambi gli header mancano.

## Architettura e ciclo di vita del token

```
1. GENERATE  → SOLO dove serve: sessione autenticata, token già in sessione, oppure
               una pagina che chiama csrfField()/csrfToken(). Mai per un anonimo che
               si limita a leggere.
2. DELIVER   → getHooksPage('head'): <meta name="csrf-token"> + interceptor fetch/XHR;
               helper globali csrfField()/csrfToken() per i form classici
3. VALIDATE  → core: pluginSys.#wrapHandlerWithAccessCheck tira l'oggetto condiviso e
               chiama csrf.validateRequest(ctx, access) sui metodi mutanti, PRIMA del
               controllo auth
4. ROTATE    → handler di login adminUsers: if (csrf) csrf.rotateToken(ctx) dopo il successo
```

## Perché un hook nel core e non (solo) un middleware

I middleware dei plugin sono montati **dopo** il router (vedi `index.js`), quindi non possono pre-bloccare una rotta API già matchata come `POST /login`. La validazione deve girare **dentro il route-wrap** (che esegue all'interno del router). *(Stessa lezione architetturale di `rateLimiter`.)*

## Perché il plugin non registra NESSUN middleware

C'era un middleware il cui corpo intero era `if (ctx.session) ensureToken(ctx)`, per garantire il token prima del rendering. Era **ridondante** — l'hook `head` e gli helper `csrfField()`/`csrfToken()` coniano già per conto proprio, e la validazione rifiuta correttamente quando il token in sessione manca — e **costava molto**: girando dopo il router ma prima degli static server toccava la sessione di *ogni* richiesta che arrivasse fin lì, asset e 404 compresi. Per un visitatore senza cookie erano due `Set-Cookie` su ogni risposta.

Tre conseguenze, in ordine di gravità crescente:

1. una risposta con `Set-Cookie` è tipicamente non cacheabile da CDN e proxy condivisi;
2. un token CSRF coniato per un anonimo che non invierà mai nulla è la forma più difficile da difendere di cookie "tecnico";
3. **rendeva riconoscibile il 404 di blocco di `sentinel`.** Il suo corpo è byte-identico a un 404 autentico, ma sentinel risponde da uno slot *pre-router* e quindi non passava mai di qui: 404 vero → 2 `Set-Cookie`, 404 di sentinel → 0. Una sola richiesta bastava a separarli.

Misurato togliendolo: le due risposte tornano identiche (0 cookie entrambe), la pagina di login continua a coniare, il giro completo del token resta verde. Presidiato da `tests/integration/sentinelEnforcement.test.js` (parità dei `Set-Cookie`) e da un test unitario che verifica che `getMiddlewareToAdd()` resti vuoto.

## Dove nasce il token — e il contratto per chi scrive pagine

L'hook `head` è montato su **ogni** pagina a tema: se coniasse, darebbe un cookie a chiunque legga una qualunque pagina del sito. Quindi non conia. Il token nasce solo se:

| condizione | perché |
|---|---|
| sessione **autenticata** | l'utente è dentro la superficie riservata e un cookie ce l'ha già |
| token **già in sessione** | qualcuno l'ha coniato prima: si riusa |
| la pagina chiama `csrfField()` / `csrfToken()` | è la pagina a dichiarare «qui c'è un form» |

È così che la pagina di login — anonima per necessità — ottiene il suo token senza che il resto del sito paghi un cookie.

⚠️ **Contratto:** una pagina **anonima** che faccia una `fetch` mutante non trova il `<meta>`, perché l'head si renderizza prima del corpo e quindi prima di qualsiasi `csrfField()`. Se ti serve, chiama `csrfToken()` **in cima alla pagina**, prima di includere i partial del tema: il token esiste già quando l'hook gira, e `<meta>` e interceptor compaiono entrambi.

## Ambito derivato: nessun marcatore CSRF sulle rotte

Il core passa a `validateRequest(ctx, access)` il blocco `access` della rotta — che ha già in mano tre righe più sopra, per la superficie riservata. Da lì `requestGuard.scopeOf()` ricava l'ambito:

| la rotta dichiara | ambito | significato |
|---|---|---|
| `requiresAuth: true` | `authenticated` | sta dietro l'autenticazione |
| `isAuthEntryPoint: true` | `authEntryPoint` | varco pubblico per necessità (login, logout) |
| nessuno dei due | `public` | rotta dichiaratamente pubblica |

`access` è **obbligatorio** su ogni rotta, e una rotta che non lo dichiara non viene nemmeno registrata (salta + warning al boot, v3.14.0), quindi il perimetro non è un elenco da mantenere: è la stessa fonte da cui `reservedGate` deriva il proprio, e una rotta nuova eredita il comportamento senza dichiarare nulla.

**Policy attuale: tutti e tre gli ambiti sono protetti allo stesso modo.** Nel codice reale non costa nulla — sulle 56 rotte mutanti del progetto 51 sono `authenticated`, 2 sono i varchi login/logout e le uniche 3 `public` stanno in `exampleComplete` — e copre il caso futuro: un plugin nuovo con un form pubblico è protetto senza che il suo autore debba saperlo, invece di nascere scoperto in silenzio.

L'ambito serve quindi alla **diagnosi**: a parità di `reason`, un blocco su `authEntryPoint` è quasi sempre qualcuno che bussa al login senza token (scanner o client mal configurato), mentre uno su `public` è quasi sempre una pagina rotta da riparare. Finisce nell'audit, nei contatori `blocksByScope` e nella colonna «Ambito» della GUI.

Se un giorno si volesse rilassare l'ambito pubblico, il punto è **una riga sola** in `requestGuard.evaluate` (indicata nel codice), e andrebbe accoppiata all'inversione del ramo `mode: 'none'`: senza token da usare come ripiego, «né Origin né Referer» deve diventare un rifiuto, non un lasciapassare.

## Sorgente del token nella richiesta

Header `X-CSRF-Token` (fetch/XHR/upload multipart) **oppure** body `_csrf` (form urlencoded classici, parsati dal bodyParser prima del router). Per gli upload multipart il body non è parsato al momento del wrap, quindi il token deve arrivare via header (se ne occupa l'interceptor).

## Perché l'hardening `SameSite=lax` è necessario

Anche con token + controllo Origin, impostare `sameSite: 'lax'` esplicitamente sul cookie di sessione (`core/priorityMiddlewares/koaSession.json5`) aggiunge valore:
1. **Difesa in profondità, costo zero:** una seconda barriera indipendente. Se una rotta dovesse mai bypassare il wrap o l'interceptor regredisse, Lax riduce comunque l'invio del cookie sulle POST cross-**site**.
2. **Determinismo:** elimina la dipendenza dal "Lax-by-default" implicito del browser, che varia per browser/versione. Il comportamento è ora esplicito e documentato nel cookie stesso.
3. **Copre metodi che il token non copre:** il token protegge solo i metodi mutanti; una futura azione sensibile via GET sarebbe scoperta dal token → lì SameSite è l'unica barriera.

⚠️ **Ambito preciso:** `SameSite=lax` **non** ferma il vettore *same-site sotto-dominio* (i cookie Lax vengono inviati alle origin same-site) — quello è coperto dal **token**. Il prefisso `__Host-` (che bloccherebbe il cookie-tossing da sotto-dominio) **non** è applicato perché richiede Secure + `path=/` e romperebbe l'HTTP semplice (porta 3000) e lo sviluppo locale; valutarlo in deployment solo-HTTPS.

## Sicurezza

- Token a 256-bit da `crypto`, confronto a tempo costante (`tokenManager.safeEqual`) → niente timing leak.
- Cookie di sessione firmato → il token non è falsificabile né leggibile cross-origin.
- Origin/Referer ricostruito dall'Host (proxy-aware solo se `trustProxy`).

## Test

E2E helper in `tests/e2e/csrfHelper.js` (estrazione token + `postWithCsrf`). I test del plugin sono in `tests/`.

## Limitazioni e sviluppi futuri

- [x] **Twin admin `adminCsrfProtection`** — GUI (Data view + editor JSON5) — *implementato*.
- [ ] **Il `403` è una firma dello stack.** `POST /api/adminUsers/login` senza token risponde `403 CSRF validation failed`: a uno scanner dice «questo endpoint esiste ed è protetto da un synchronizer token», cioè più di quanto direbbe un login fallito. È in tensione con la postura del resto del progetto — il 404 di `reservedGate` è presidiato da un test byte-per-byte proprio per non far trapelare nulla, e da v2.81.0 nemmeno il `Set-Cookie` distingue più un blocco da un 404 autentico. Non è una svista di questo plugin (il `403` è il default sensato di un layer CSRF), ma va deciso: rispondere come farebbe la rotta senza token — cioè un login fallito — costerebbe la diagnosticabilità, che è esattamente ciò che rende utile la GUI di audit. Le due cose non si sommano, va scelta una. *Emerso nell'analisi di v2.81.0.*
- [ ] **Rotazione del token per-richiesta** (oggi per-sessione) come modalità opt-in più stretta.
- [ ] **Prefisso cookie `__Host-`** come opt-in per deployment solo-HTTPS.
- [ ] **Delivery CSP-friendly** — opzione per servire l'interceptor come script esterno (per `Content-Security-Policy` strette senza script inline).
