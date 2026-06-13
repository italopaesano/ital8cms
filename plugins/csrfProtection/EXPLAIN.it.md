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
1. GENERATE  → middleware del plugin (prima del render della pagina): assicura ctx.session.csrfToken
2. DELIVER   → getHooksPage('head'): <meta name="csrf-token"> + interceptor fetch/XHR;
               helper globali csrfField()/csrfToken() per i form classici
3. VALIDATE  → core: pluginSys.#wrapHandlerWithAccessCheck tira l'oggetto condiviso e
               chiama csrf.validateRequest(ctx) sui metodi mutanti, PRIMA del controllo auth
4. ROTATE    → handler di login adminUsers: if (csrf) csrf.rotateToken(ctx) dopo il successo
```

## Perché un hook nel core e non (solo) un middleware

I middleware dei plugin sono montati **dopo** il router (vedi `index.js`), quindi non possono pre-bloccare una rotta API già matchata come `POST /login`. La validazione deve girare **dentro il route-wrap** (che esegue all'interno del router). Il middleware del plugin si limita a generare il token per il rendering della pagina. *(Stessa lezione architetturale di `rateLimiter`.)*

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
- [ ] **Rotazione del token per-richiesta** (oggi per-sessione) come modalità opt-in più stretta.
- [ ] **Prefisso cookie `__Host-`** come opt-in per deployment solo-HTTPS.
- [ ] **Delivery CSP-friendly** — opzione per servire l'interceptor come script esterno (per `Content-Security-Policy` strette senza script inline).
