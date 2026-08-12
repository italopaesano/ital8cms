<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# csrfProtection

Difende da **Cross-Site Request Forgery** su ogni rotta che modifica stato (POST/PUT/DELETE/PATCH), login incluso. Implementa una **difesa in profondità** con due layer indipendenti, applicati **centralmente nel route-wrap del core** (non per-handler), così la copertura è trasparente su tutte le rotte `/api/*`.

> 📖 Deep-dive tecnico (architettura, ciclo di vita del token, perché un hook nel core e non un middleware, SameSite): vedi [`EXPLAIN.it.md`](./EXPLAIN.it.md).

## Cosa fa

- **Token sincronizzatore (per sessione):** token casuale 256-bit in `ctx.session.csrfToken` (cookie firmato → non falsificabile, non leggibile cross-origin), **ruotato al login**.
- **Controllo Origin/Referer:** same-origin dinamico (ricostruito dall'Host della richiesta, proxy-aware), con allowlist opzionale; **fallback al token** quando entrambi gli header sono assenti.
- **Enforcement centrale:** validato dentro il route-wrap del core, **prima** del controllo di autenticazione → copre anche rotte pubbliche che modificano stato come `POST /login`.
- **Nessun cookie per chi legge e basta:** il token nasce solo dove serve — sessione autenticata, token già presente, o una pagina che chiama `csrfField()`/`csrfToken()`. Un visitatore anonimo che naviga il sito non riceve alcun cookie.
- **Ambito derivato, zero marcatori:** l'ambito CSRF di una rotta (`authenticated` / `authEntryPoint` / `public`) si ricava dal suo `access`, lo stesso da cui la superficie riservata deriva il proprio perimetro. Oggi tutti e tre sono protetti allo stesso modo; l'ambito serve alla diagnosi.
- **Integrazione client trasparente:** un page-hook inietta un `<meta>` col token + un interceptor che patcha **sia `fetch` sia `XMLHttpRequest`** per aggiungere `X-CSRF-Token` sulle richieste mutanti same-origin; helper globali `csrfField()`/`csrfToken()` per i form classici.
- **Opzionale e graceful:** se disabilitato, l'oggetto condiviso è `null` e il route-wrap salta la validazione.
- **Esenzioni:** `exemptPaths` (pattern via `core/patternMatcher.js`) per futuri webhook / API server-to-server.

> ⚠️ **Se scrivi una pagina ANONIMA con una `fetch` mutante** (POST/PUT/DELETE/PATCH), chiama `csrfToken(passData)` **in cima alla pagina**, prima di includere i partial del tema. Altrimenti il `<meta>` col token non viene iniettato — l'head si renderizza prima del corpo — e la richiesta finisce in 403. Le pagine autenticate e i form classici con `csrfField()` non richiedono nulla.

## Configurazione (`pluginConfig.json5` → `custom`)

| Campo | Default | Descrizione |
|-------|---------|-------------|
| `enabled` | `true` | Off → oggetto condiviso `null`, il route-wrap salta la validazione |
| `protectedMethods` | `["POST","PUT","DELETE","PATCH"]` | Metodi mutanti da proteggere (`DEL`≡`DELETE`) |
| `tokenHeaderName` | `"X-CSRF-Token"` | Header usato da fetch/XHR |
| `tokenFieldName` | `"_csrf"` | Campo nascosto usato dai form classici |
| `metaName` | `"csrf-token"` | Nome del `<meta>` letto dall'interceptor |
| `trustProxy` | `false` | Legge `X-Forwarded-Host/Proto` (solo dietro proxy fidato) |
| `originCheck.enabled` | `true` | Abilita il layer Origin/Referer |
| `originCheck.allowedOrigins` | `[]` | Origin aggiuntivi oltre al same-origin |
| `exemptPaths` | `[]` | Pattern esenti dalla protezione (`core/patternMatcher`) |
| `failureStatus` | `403` | Status HTTP in caso di validazione fallita |
| `enableLogging` | `true` | Log a console delle richieste bloccate |
| `strictValidation` | `false` | Crash al boot su errori di validazione della config |

## API dell'oggetto condiviso (pull via `pluginSys.getSharedObject('csrfProtection')`)

- `validateRequest(ctx, access)` → `{ ok, status?, error?, reason?, scope? }` (usato dal route-wrap del core; `access` è il blocco della rotta, da cui si deriva `scope`)
- `ensureToken(ctx)` · `rotateToken(ctx)` · `getToken(ctx)`
- Per il twin admin (`adminCsrfProtection`): `getStats()` (contatori per motivo **e per ambito**), `getRecentBlocks(limit)` (audit in memoria, con `scope` per riga), `simulate(input)` (CSRF tester, accetta `scope`), `getConfig()`, `validateConfig(newCustom)`, `reloadConfig()` (hot-reload dopo un salvataggio).

## Ambito CSRF (derivato da `access`)

| La rotta dichiara | Ambito | Protetta? |
|---|---|---|
| `requiresAuth: true` | `authenticated` | sì |
| `isAuthEntryPoint: true` | `authEntryPoint` | sì — è qui che vive il CSRF anonimo che conta (login, logout) |
| nessuno dei due | `public` | sì (scelta sicura per default) |

Non c'è nulla da dichiarare in più: `access` è già obbligatorio su ogni rotta. L'ambito compare nell'audit e nella GUI perché a parità di motivo cambia la diagnosi. Deep-dive e punto in cui rilassare la policy: [`EXPLAIN.it.md`](./EXPLAIN.it.md).

## Helper per i template

```ejs
<%# Form classico — input nascosto col token %>
<form method="POST" action="/api/adminUsers/login">
  <%- csrfField(passData) %>
  ...
</form>

<%# Token grezzo (per JS custom / meta) %>
<script>const token = '<%= csrfToken(passData) %>';</script>
```

Entrambi sono in whitelist in `ital8Config.json5 → globalFunctionsWhitelist` (`required: false` → se il plugin è spento, il fallback rende `''`). Fetch/XHR **non** richiedono modifiche: l'interceptor iniettato aggiunge l'header in automatico.

## File

| File | Scopo |
|------|-------|
| `main.js` | Lifecycle, head hook (conio condizionale), oggetto condiviso, helper globali, audit. **Nessun middleware** — vedi `EXPLAIN.it.md` |
| `lib/tokenManager.js` | Generazione token (base64url 256-bit) + confronto a tempo costante |
| `lib/originValidator.js` | Validazione Origin/Referer (proxy-aware) |
| `lib/requestGuard.js` | Logica di validazione pura `evaluate(ctx, custom, matcher, access)` + `scopeOf(access)` |
| `lib/configValidator.js` | Validazione config al boot |
| `lib/clientInterceptor.js` | Script inline che patcha fetch + XMLHttpRequest |

## Dipendenze

Utility core: `core/patternMatcher.js` (esenzioni). Enforcement nel core: `core/pluginSys.js` (`#wrapHandlerWithAccessCheck`). Hardening correlato: `core/priorityMiddlewares/koaSession.json5` (`SameSite=lax`).
