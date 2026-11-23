<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `security-headers.md` is a stub until release.

# Header di sicurezza

## Scopo

Gli header che il CMS aggiunge a ogni risposta, come configurarli per contesto, e
cosa sapere prima di accendere la **CSP**.

Fino alla v3.44.0 il CMS non mandava **nessun** header di sicurezza sulle risposte
normali: i cinque nomi comparivano solo sulla pagina di manutenzione e sui rifiuti
dei gate (`REVIEW.md` → A5).

## Cosa viene emesso, di serie

| Header | Valore | Dove |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | tutte le superfici |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | tutte le superfici |
| `X-Frame-Options` | `DENY` | **solo** le superfici riservate |
| `Strict-Transport-Security` | `max-age=86400` | solo con `https.enabled` |
| `Content-Security-Policy` | — | **spenta**, vedi sotto |

## I tre contesti, e come si decide a quale appartiene una richiesta

La configurazione ha tre blocchi — `wwwPath`, `pluginPages`, `admin` — come
`hideExtension`. Ma la mappatura da path a contesto **non è un elenco di
prefissi**: si deriva dalla **zona** del path (`core/pathZoneResolver.js`).

| Contesto | Zone |
|---|---|
| `admin` | ogni zona che dichiara `baseline.requiresAuth: true` |
| `pluginPages` | la zona `pluginPages` |
| `wwwPath` | tutto il resto: sito, risorse del tema pubblico, `api` |

**Perché derivarlo e non elencarlo:** è lo stesso criterio del `reservedGate`, e
per la stessa ragione. Un elenco di prefissi scritto a mano è il difetto A1 che
aspetta di tornare — e si è già visto due volte: `views` dichiara
`requiresAuth: true` senza chiamarsi « admin », e un elenco l'avrebbe dimenticata.
Con la derivazione eredita gli header dell'area riservata senza che nessuno debba
ricordarselo, e **una zona nuova fa lo stesso**.

```json5
"securityHeaders": {
  "hsts":        { "enabled": true, "maxAge": 86400 },
  "wwwPath":     { "nosniff": true, "referrerPolicy": "strict-origin-when-cross-origin",
                   "frameOptions": "", "csp": { "enabled": false, "policy": "…" } },
  "pluginPages": { /* idem */ },
  "admin":       { "frameOptions": "DENY", /* … */ },
}
```

`frameOptions: ""` = header non emesso. Il **sito pubblico resta inquadrabile** di
proposito: una pagina pubblica può legittimamente essere embeddata (widget,
anteprime), e deciderlo al posto di chi costruisce il sito sarebbe arbitrario.

## HSTS non è per contesto, ed è una scelta

La direttiva vale per l'**intera connessione**, non per un prefisso di URL: tre
interruttori darebbero due chiavi inerti e una efficace, cioè una configurazione
che insegna una cosa falsa. Sta quindi accanto agli altri header ma **fuori** dai
blocchi per contesto.

È emesso **solo** con `https.enabled: true` — in HTTP puro renderebbe il sito
irraggiungibile al riavvio successivo del browser. Il `maxAge` di serie è **un
giorno**, non un anno: se qualcosa va storto si rientra in fretta. Alzalo a
`31536000` quando l'HTTPS è stabile da tempo, e aggiungi `includeSubDomains` solo
se **tutti** i sottodomini parlano HTTPS.

## Il middleware non sovrascrive

Imposta solo gli header **assenti**. Un plugin che sa cosa sta servendo — un
embed, un download, un'anteprima — può allentare la regola per la sua risposta
senza combattere col middleware.

Il prezzo, dichiarato: un plugin può indebolire la postura di sicurezza e nulla lo
segnala. Si vede già su una risposta reale: il 404 di `koa-classic-server` porta
una CSP molto più stretta (`default-src 'none'`) e un `Referrer-Policy:
no-referrer` suoi, e il middleware li rispetta.

> ⚠️ **Limite da conoscere: le risposte da ECCEZIONE.** Gli header sono impostati
> in un `finally`, quindi coprono anche le risposte di errore « normali » (un 404
> o un 403 prodotti assegnando lo status). **Non** coprono le risposte generate da
> un'eccezione propagata: `ctx.onerror` di Koa rimuove tutti gli header prima di
> scrivere la sua risposta, e non c'è modo di impedirglielo da un middleware. È un
> limite del framework, non una scelta.

## Il cookie di sessione: `secure`

`core/priorityMiddlewares/koaSession.json5` → `CONFIG.secure: "auto"`.

Senza questa chiave il cookie di sessione — compreso quello di **root** — viaggiava
in chiaro anche su un'installazione interamente HTTPS: bastava una singola
richiesta HTTP (un link vecchio, un redirect, una risorsa mista).

`"auto"` è un **sentinella** risolto in codice al montaggio: diventa `true` se
`https.enabled` è true, `false` altrimenti. Non è zucchero sintattico —
`koa-session` 7 valida le proprie opzioni con zod e `secure` **deve** essere un
booleano: passandogli la stringa, il boot muore con uno `ZodError` e il CMS non
parte (misurato).

> **Conseguenza nello scenario « HTTPS e HTTP in parallelo »** (`https.enabled`
> con `AutoRedirectHttpPortToHttpsPort: false`): il cookie di sessione viaggia
> solo sul lato HTTPS, quindi il login funziona solo là. È il comportamento voluto
> — un cookie di sessione non deve passare in chiaro — ma è un cambiamento.

## La CSP: perché è spenta, e come accenderla

La CSP è l'unico header che **può rompere il sito**, perché un tema può
legittimamente avere script o stili inline. Viene quindi spedita **spenta**, con
una policy consigliata già scritta in `policy`.

**Accenderla è una decisione da prendere guardando le proprie pagine in un
browser.** Per farlo:

```json5
"securityHeaders": { "admin": { "csp": { "enabled": true } } }
```

poi apri il pannello (o il sito) e guarda la **console** del browser: ogni
violazione è segnalata con la direttiva che l'ha bloccata.

### Misurato sui temi e le pagine distribuite

Accendendo la policy consigliata su tutti e tre i contesti, la suite e2e (96 test
su Chromium) ha prodotto **un solo fallimento**:

```
auth.spec.js › Login - Invalid Credentials › should show error message after failed attempt
```

La causa è concreta: `plugins/adminUsers/webPages/login.ejs:84` contiene uno
`<script>` **inline**, e la policy consigliata per `pluginPages`
(`default-src 'self'`, senza `script-src`) blocca gli script inline. Tutto il
resto — pannello admin compreso — passa.

Le tre strade, in ordine di preferenza: spostare quello script in un file servito
dal plugin; dargli un `nonce`; oppure, se hai fretta, aggiungere
`script-src 'self' 'unsafe-inline'` alla policy di `pluginPages` — sapendo che
`unsafe-inline` annulla gran parte del valore della CSP sugli script.

## Dove vive

- `core/priorityMiddlewares/securityHeaders.js` — il middleware
- `ital8Config.json5` → `securityHeaders` — la configurazione
- `core/priorityMiddlewares/koaSession.json5` → `CONFIG.secure` — il cookie
- Montato in `core/priorityMiddlewares/priorityMiddlewares.js`, subito dopo il
  gate canonico e **prima** di tutto il resto, così gli header accompagnano anche
  le risposte dei gate a valle (503 di manutenzione, 404 del reserved).
