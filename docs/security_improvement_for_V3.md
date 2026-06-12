# Security Improvement Plan — ital8cms V3

> **Data analisi:** 2026-06-09
> **Branch analizzato:** `claude/review-admin-analytics-todo-ZjwI9`
> **Autore:** Analisi automatizzata (Claude Code)
> **Versione documento:** 1.0.0

---

## Indice e checklist

Usa le checkbox per tracciare l'avanzamento. Le voci sono ordinate per priorità decrescente all'interno di ogni livello di severità.

### 🔴 CRITICAL

- [ ] [C-1](#c-1--chiavi-di-sessione-hardcoded-e-deboli) — Chiavi di sessione hardcoded e deboli in `koaSession.json5`
- [ ] [C-2](#c-2--endpoint-logged-espone-la-sessione-completa) — Endpoint `/logged` espone la sessione completa a chiunque

### 🟠 HIGH

- [ ] [H-1](#h-1--assenza-totale-di-protezione-csrf) — Assenza totale di protezione CSRF
- [ ] [H-2](#h-2--cookie-di-sessione-senza-secure-e-samesite) — Cookie di sessione senza flag `secure` e `sameSite`
- [ ] [H-3](#h-3--errormessage-esposto-ai-client-in-più-route) — `error.message` esposto ai client in più route
- [ ] [H-4](#h-4--salt-analytics-hmac-con-valore-di-default-prevedibile) — Salt analytics HMAC con valore di default prevedibile

### 🟡 MEDIUM

- [ ] [M-1](#m-1--assenza-di-rate-limiting-sul-login) — Assenza di rate limiting sull'endpoint di login
- [ ] [M-2](#m-2--assenza-di-header-di-sicurezza-http) — Assenza di header di sicurezza HTTP (CSP, HSTS, X-Frame-Options…)
- [ ] [M-3](#m-3--validazione-password-assente) — Validazione password assente (nessuna lunghezza minima né complessità)
- [ ] [M-4](#m-4--bcrypt-rounds-a-10-sotto-la-soglia-consigliata) — bcrypt rounds a 10, sotto la soglia consigliata per il 2025+
- [ ] [M-5](#m-5--consolelog-con-dati-utente-in-produzione) — `console.log` con dati utente in una route di produzione

### 🔵 LOW

- [ ] [L-1](#l-1--nessun-audit-log-delle-azioni-amministrative) — Nessun audit log delle azioni amministrative
- [ ] [L-2](#l-2--open-redirect-migliorabile) — Open redirect: la funzione `getSafeRedirectUrl` non copre tutti i bypass noti
- [ ] [L-3](#l-3--file-temporanei-orfani-nel-plugin-media) — File temporanei orfani nel plugin `adminMedia`

### ⚪ INFORMATIONAL

- [ ] [I-1](#i-1--dipendenza-handlebars-rischio-prototype-pollution) — Dipendenza `handlebars`: rischio prototype pollution
- [ ] [I-2](#i-2--strategia-generale-per-i-secret) — Strategia generale per la gestione dei secret (env vars)

---

## Raccomandazioni architetturali trasversali

- [ ] [A-1](#a-1--introdurre-un-middleware-di-sicurezza-centralizzato) — Introdurre un middleware di sicurezza centralizzato
- [ ] [A-2](#a-2--separare-i-secret-dal-codice-sorgente) — Separare i secret dal codice sorgente con `.env` + `dotenv`
- [ ] [A-3](#a-3--ordine-di-implementazione-suggerito) — Ordine di implementazione suggerito

---

## 🔴 CRITICAL

### C-1 — Chiavi di sessione hardcoded e deboli

**File:** `core/priorityMiddlewares/koaSession.json5`, riga 3
**Impatto:** Un attaccante che legge il repository (o un ex-collaboratore) può forgiare cookie di sessione firmati, impersonando qualsiasi utente incluso root.

**Codice attuale:**
```json5
"keys": ["key.segretussimmmmmm", "fbtgnrnyrmnytmtymyt", "brtnrynynyny"]
```

Le chiavi sono:
- Corte (< 20 caratteri)
- Leggibili e prive di entropia sufficiente
- Committed nel repository — chiunque abbia accesso al repo le conosce

**Fix raccomandato:**
Sostituire con chiavi generate da `crypto.randomBytes(64).toString('hex')` e lette da variabili d'ambiente a runtime:

```json5
// koaSession.json5 — valori placeholder, le chiavi reali vivono in .env
"keys": ["${SESSION_KEY_1}", "${SESSION_KEY_2}"]
```

```js
// Nel loader delle priority middlewares, prima di passare le chiavi a koa-session:
keys: [
  process.env.SESSION_KEY_1 || (() => { throw new Error('SESSION_KEY_1 non impostata') })(),
  process.env.SESSION_KEY_2 || (() => { throw new Error('SESSION_KEY_2 non impostata') })(),
]
```

Generazione chiavi una-tantum:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Note aggiuntive:** Aggiungere `koaSession.json5` (o almeno il campo `keys`) a `.gitignore` oppure tenerlo come file template con valori placeholder. Le chiavi non devono mai entrare nella history git.

---

### C-2 — Endpoint `/logged` espone la sessione completa

**File:** `plugins/adminUsers/main.js`, righe 145–162
**Impatto:** Chiunque può chiamare `GET /api/adminUsers/logged` senza autenticazione e ricevere in chiaro il contenuto integrale di `ctx.session`, inclusi tutti i dati dell'utente loggato.

**Codice attuale:**
```js
// access: { requiresAuth: false, allowedRoles: [] }  ← pubblico
ctx.body = `NON sei loggato : ${ JSON.stringify( ctx.session) }`;
// ...
ctx.body = `complimenti sei loggato ${ctx.session.user} sessione: ${ JSON.stringify( ctx.session) }`;
```

Problemi specifici:
1. L'endpoint è **pubblico** (`requiresAuth: false`) per scelta esplicita («utile per test»).
2. Restituisce `JSON.stringify(ctx.session)` — struttura interna della sessione visibile a occhio nudo.
3. Se `ctx.session.user` contiene campi sensibili (email, roleIds) vengono esposti in plain text.

**Fix raccomandato:**
Per gli ambienti di sviluppo, proteggere l'endpoint con autenticazione oppure rimuoverlo. Se serve davvero un endpoint di healthcheck per il login status, restituire solo un booleano:

```js
// Versione sicura — solo booleano + username
ctx.body = {
  authenticated: !!ctx.session?.authenticated,
  username: ctx.session?.user?.username ?? null,
};
```

Se il debug del session object è necessario in sviluppo, condizionarlo al `debugMode`:

```js
if (ital8Conf.debugMode >= 2) {
  ctx.body._debug = ctx.session; // solo in debug avanzato
}
```

---

## 🟠 HIGH

### H-1 — Assenza totale di protezione CSRF

**Dove manca:** Tutti i form HTML (`userUpsert.ejs`, form di login, form di logout, form nelle sezioni admin) e tutti gli endpoint POST/PUT/DELETE dei plugin.
**Impatto:** Un sito malevolo può indurre un admin autenticato a eseguire azioni non volute (creare utenti, cambiare configurazioni, cancellare file) con una singola richiesta cross-origin.

**Perché è exploitabile:** I cookie di sessione vengono inviati automaticamente dal browser con ogni richiesta, anche se originata da un altro dominio. Senza un token CSRF il server non può distinguere una richiesta legittima da una contraffatta.

**Fix raccomandato — approccio Synchronizer Token:**

1. Installare `koa-csrf` (o implementare middleware minimale):
```bash
npm install koa-csrf
```

2. Aggiungere il middleware in `core/priorityMiddlewares/`:
```js
const CSRF = require('koa-csrf');
// Dopo session, prima di router:
app.use(new CSRF({ invalidSessionSecretMessage: 'Invalid session secret' }));
```

3. Iniettare il token in ogni form EJS:
```ejs
<input type="hidden" name="_csrf" value="<%= ctx.csrf %>">
```

4. Per le chiamate AJAX (fetch), leggere il token da un meta tag e includerlo nell'header:
```html
<meta name="csrf-token" content="<%= ctx.csrf %>">
```
```js
headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }
```

**Alternativa senza libreria esterna:** Implementare il pattern Double Submit Cookie con `crypto.randomBytes` — più semplice da integrare nel middleware di priorità esistente.

> **Nota di compatibilità con koa-classic-server:** Le sessioni usano già `koa-session`, quindi lo storage del token CSRF nella sessione è già disponibile senza cambiamenti architetturali.

---

### H-2 — Cookie di sessione senza `secure` e `sameSite`

**File:** `core/priorityMiddlewares/koaSession.json5`
**Impatto:**
- Senza `secure: true`: il cookie di sessione può essere trasmesso su HTTP in chiaro, intercettabile con un attacco MITM (es. su reti Wi-Fi pubbliche).
- Senza `sameSite`: il browser invia il cookie anche in richieste cross-site, amplificando la superficie di attacco CSRF (vedi H-1).

**Configurazione attuale:**
```json5
"CONFIG": {
  "httpOnly": true,   // ✅ corretto
  "signed":   true,   // ✅ corretto
  "rolling":  false,  // ✅ corretto
  // ❌ mancano:
  // "secure":   true
  // "sameSite": "Lax"
}
```

**Fix raccomandato:**
```json5
"CONFIG": {
  "httpOnly": true,
  "signed":   true,
  "rolling":  false,
  "renew":    false,
  "secure":   true,       // solo HTTPS — da condizionare a ital8Config.https.enabled
  "sameSite": "Lax"       // blocca invio cross-site tranne navigazione top-level GET
}
```

**Attenzione:** `secure: true` rompe i cookie su HTTP puro. Il valore deve essere letto dinamicamente in base a `ital8Config.https.enabled`:

```js
// Nel loader del middleware di sessione
const secureFlag = ital8Conf.https?.enabled === true;
sessionConfig.CONFIG.secure = secureFlag;
```

Questo garantisce che in sviluppo locale (HTTP) i cookie continuino a funzionare, mentre in produzione (HTTPS) vengano protetti automaticamente.

---

### H-3 — `error.message` esposto ai client in più route

**File e righe coinvolte:**
| File | Riga | Messaggio esposto |
|------|------|------------------|
| `plugins/adminUsers/main.js` | 569 | `` `Errore interno del server: ${error.message}` `` |
| `plugins/adminAnalytics/main.js` | 419 | `` `JSON5 syntax error: ${err.message}` `` |
| `plugins/adminSeo/main.js` | 154, 182 | `` `JSON5 syntax error: ${err.message}` `` |

**Impatto:** `error.message` può rivelare path assoluti del server, nomi di variabili interne, versioni di librerie, struttura del filesystem — informazioni utili a un attaccante per il fingerprinting dell'applicazione.

Esempio reale dal codice:
```js
// adminUsers/main.js:569
ctx.body = { error: `Errore interno del server: ${error.message}` };
```
Se il file `userAccount.json5` non è leggibile, il messaggio potrebbe diventare:
`"Errore interno del server: ENOENT: no such file or directory, open '/home/user/ital8cms/plugins/adminUsers/userAccount.json5'"`

**Fix raccomandato:**
Loggare il messaggio completo server-side, restituire al client solo un messaggio generico:

```js
// Pattern da usare in tutti i catch di produzione
} catch (error) {
  console.error('[adminUsers] userInfo error:', error); // log completo server-side
  ctx.status = 500;
  ctx.body = { error: 'Errore interno del server.' }; // generico al client
}
```

**Eccezione accettabile:** Gli errori di syntax JSON5 (`err.message`) su input controllato dall'utente (es. la textarea di configurazione) possono essere restituiti al client perché aiutano l'utente a correggere il suo input — non rivelano path interni. Questa categoria va documentata esplicitamente con un commento.

---

### H-4 — Salt analytics HMAC con valore di default prevedibile

**File:** `plugins/analytics/pluginConfig.json5` (campo `custom.sessionSalt`), `plugins/adminAnalytics/lib/analyticsConfigValidator.js` riga 12
**Impatto:** Il salt viene usato in un HMAC-SHA256 per pseudonimizzare gli ID di sessione prima di registrarli nei log analytics. Se rimane il valore di default (`'cambia-questo-salt-in-produzione-con-stringa-casuale'`), un attaccante che conosce il salt (è nel repo) può fare reverse engineering degli hash e ri-identificare le sessioni.

**Valore di default hardcoded nel validatore:**
```js
const DEFAULT_SALT = 'cambia-questo-salt-in-produzione-con-stringa-casuale';
```

**Stato attuale:** Il sistema ha già una protezione parziale:
- ✅ Il validatore emette un **warning** se il salt è quello di default
- ✅ L'interfaccia admin mostra un banner giallo di avviso
- ✅ C'è un pulsante "Genera" che usa `crypto.getRandomValues`
- ❌ Ma non c'è nulla che blocchi l'avvio del server con il salt di default

**Fix raccomandato:**
Elevare il warning a errore bloccante **solo in produzione** (`debugMode === 0`):

```js
// In analyticsConfigValidator.js
if (custom.sessionSalt === DEFAULT_SALT) {
  if (isProduction) {
    errors.push('sessionSalt è ancora il valore di default — cambiarlo prima di andare in produzione');
  } else {
    warnings.push('sessionSalt è il valore di default — cambiarlo prima di andare in produzione');
  }
}
```

Passare `isProduction` (`debugMode === 0`) come secondo argomento alla funzione `validateSettings`.

**Fix alternativo (più robusto):** Generare il salt automaticamente al primo avvio se assente o uguale al default, salvarlo nel `pluginConfig.json5` tramite `analyticsFileManager`, e loggare un avviso visibile con il valore generato.

---

## 🟡 MEDIUM

### M-1 — Assenza di rate limiting sul login

**File:** `plugins/adminUsers/main.js`, route `POST /login` (~riga 104)
**Impatto:** L'endpoint di login non ha alcun limite di tentativi. Un attaccante può effettuare attacchi brute-force o credential stuffing senza essere bloccato.

**Nessuna libreria npm esterna richiesta** — implementazione minimale con Map in memoria:

```js
// Aggiungere in adminUsers/main.js (o in un middleware dedicato)
const loginAttempts = new Map(); // ip → { count, resetAt }
const MAX_ATTEMPTS  = 10;
const WINDOW_MS     = 15 * 60 * 1000; // 15 minuti

function checkRateLimit(ip) {
  const now    = Date.now();
  const entry  = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) return false;
  return true;
}
```

Usarlo nel handler del login:
```js
const ip = ctx.ip;
if (!checkRateLimit(ip)) {
  ctx.status = 429;
  ctx.body   = 'Troppi tentativi. Riprova tra 15 minuti.';
  return;
}
```

**Alternativa npm:** `koa-ratelimit` con store in memoria.

**Note:** La Map in memoria si azzera al riavvio del server — accettabile per un CMS a singola istanza. Per deployment multi-istanza sarebbe necessario Redis o un backend condiviso.

---

### M-2 — Assenza di header di sicurezza HTTP

**Dove manca:** Nessun middleware nella chain Koa imposta header di sicurezza. Verificato in `index.js` e nei priority middlewares.
**Impatto:** Il browser non riceve istruzioni esplicite su policy di sicurezza: clickjacking, MIME sniffing, mixed content e downgrade HTTPS sono tutti possibili.

**Header mancanti e impatto:**

| Header | Impatto se assente |
|--------|--------------------|
| `Content-Security-Policy` | XSS via script injection da domini esterni |
| `X-Frame-Options: DENY` | Clickjacking — la pagina admin è embeddabile in iframe |
| `X-Content-Type-Options: nosniff` | MIME sniffing — il browser può eseguire file come script |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP anche se HTTPS è attivo |
| `Referrer-Policy: strict-origin-when-cross-origin` | Il Referer header rivela URL interni admin a siti terzi |

**Fix raccomandato — middleware minimale senza dipendenze:**

```js
// core/priorityMiddlewares/securityHeaders.js
module.exports = function securityHeadersMiddleware() {
  return async function securityHeaders(ctx, next) {
    ctx.set('X-Frame-Options',           'DENY');
    ctx.set('X-Content-Type-Options',    'nosniff');
    ctx.set('Referrer-Policy',           'strict-origin-when-cross-origin');
    ctx.set('Permissions-Policy',        'geolocation=(), microphone=(), camera=()');
    if (ctx.secure) { // solo su HTTPS
      ctx.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // CSP di base — da raffinare per le risorse usate (Bootstrap CDN, etc.)
    ctx.set('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " + // 'unsafe-inline' da rimuovere dopo revisione EJS
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "font-src 'self'; " +
      "connect-src 'self'"
    );
    await next();
  };
};
```

> **Nota sul CSP:** Il valore `'unsafe-inline'` per script e style è temporaneo — molti template EJS usano script inline. La roadmap è: 1) aggiungere il header con `unsafe-inline`; 2) spostare progressivamente gli script inline in file `.js` separati; 3) rimuovere `unsafe-inline`.

---

### M-3 — Validazione password assente

**File:** `plugins/adminUsers/userManagement.js`, funzione `userUsert`, riga 22
**Impatto:** Un admin può creare utenti con password di un solo carattere. Le credenziali di accesso al pannello amministrativo non hanno una soglia minima di sicurezza.

**Codice attuale:**
```js
if (!username || !password || !email || !roleIds) {
  return { error: 'Errore: Devi specificare username, password, email e roleIds.' };
}
// Nessun controllo ulteriore sulla password
```

**Fix raccomandato** — aggiungere una funzione di validazione nel modulo `userManagement.js`:

```js
function validatePassword(password) {
  if (typeof password !== 'string') return 'La password deve essere una stringa.';
  if (password.length < 12)         return 'La password deve essere di almeno 12 caratteri.';
  if (!/[A-Z]/.test(password))      return 'La password deve contenere almeno una lettera maiuscola.';
  if (!/[0-9]/.test(password))      return 'La password deve contenere almeno un numero.';
  return null; // valida
}

// In userUsert():
const pwdError = validatePassword(password);
if (pwdError) return { error: pwdError, errorType: 'password' };
```

**Nota UX:** Il messaggio di errore deve essere mostrato accanto al campo password nel form `userUpsert.ejs` — il campo `errorType: 'password'` permette al frontend di fare highlight sul campo corretto.

---

### M-4 — bcrypt rounds a 10, sotto la soglia consigliata per il 2025+

**File:** `plugins/adminUsers/userManagement.js`, riga 54
**Impatto:** Con rounds=10, un attaccante con GPU moderna può calcolare ~10.000–100.000 hash/secondo. La soglia OWASP 2023+ raccomanda almeno 12 rounds (4× più lento).

**Codice attuale:**
```js
const hashedPassword = await bcryptjs.hash(password, 10);
```

**Fix raccomandato:**
```js
const BCRYPT_ROUNDS = 12; // configurabile da pluginConfig.json5 → custom.bcryptRounds
const hashedPassword = await bcryptjs.hash(password, BCRYPT_ROUNDS);
```

**Impatto sulle password esistenti:** Le password già hashate con rounds=10 continuano a funzionare per il login — bcryptjs include i rounds nell'hash. Il cambio a 12 si applica solo ai nuovi hash (nuovi utenti o reset password). Si può aggiungere una migrazione lazy: al login con successo, ri-hashare la password con 12 rounds se l'hash attuale usa 10.

```js
// Migrazione lazy — in loginUser(), dopo il compare con successo:
const hashRounds = bcryptjs.getRounds(user.hashPassword);
if (hashRounds < BCRYPT_ROUNDS) {
  user.hashPassword = await bcryptjs.hash(password, BCRYPT_ROUNDS);
  // salvare userAccount.json5
}
```

---

### M-5 — `console.log` con dati utente in produzione

**File:** `plugins/adminUsers/main.js`, riga 229
**Impatto:** I dati utente (email, roleIds, username) vengono stampati sui log di sistema in ogni richiesta `GET /userInfo`. In ambienti con log aggregati (PM2, journald, cloud logging) questi dati possono finire in sistemi di terze parti o essere accessibili a personale non autorizzato.

**Codice attuale:**
```js
const userData = { ...userAccount.users[username] };
userData.hashPassword = undefined; // rimossa la password
// ...
console.log('userAccount[username]', userData); // ← stampa email, roleIds, ecc.
ctx.body = userData;
```

**Fix raccomandato:**
Rimuovere il `console.log` o condizionarlo al debugMode:

```js
if (ital8Conf.debugMode >= 2) {
  console.log('[adminUsers] userInfo:', { username }); // solo il nome, non i dati
}
```

**Pattern generale** da applicare in tutti i plugin: i `console.log` di debug che stampano oggetti utente devono essere rimossi o sostituiti con log strutturati che omettono i campi sensibili.

---

## 🔵 LOW

### L-1 — Nessun audit log delle azioni amministrative

**Dove manca:** Nessuna delle route admin (creazione/modifica utenti, cambio ruoli, salvataggio configurazioni, caricamento file) registra chi ha eseguito l'operazione e quando.
**Impatto:** In caso di incidente è impossibile rispondere alle domande: chi ha cambiato questa configurazione? Chi ha creato questo utente? Quando è avvenuto l'accesso?

**Fix raccomandato — logger minimale senza dipendenze:**

```js
// core/auditLog.js
const fs   = require('fs');
const path = require('path');

function auditLog(ctx, action, details = {}) {
  const entry = JSON.stringify({
    ts:      new Date().toISOString(),
    user:    ctx.session?.user?.username ?? 'anonymous',
    ip:      ctx.ip,
    action,
    details,
  });
  // Append-only — nessun atomic write necessario per i log
  fs.appendFileSync(path.join(__dirname, '../logs/audit.log'), entry + '\n');
}

module.exports = { auditLog };
```

Usarlo nei punti critici:
```js
auditLog(ctx, 'user.create',   { target: username });
auditLog(ctx, 'user.delete',   { target: username });
auditLog(ctx, 'config.save',   { plugin: 'analytics' });
auditLog(ctx, 'login.success', {});
auditLog(ctx, 'login.failure', { reason: 'invalid_password' });
```

**Note:** Il file `logs/audit.log` deve essere aggiunto a `.gitignore`. In produzione, considerare rotazione giornaliera del file di log.

---

### L-2 — Open redirect migliorabile

**File:** `plugins/adminUsers/main.js`, funzione `getSafeRedirectUrl`, riga 28
**Impatto:** La funzione blocca i casi più ovvi (`//evil.com`, `/\evil.com`) ma non tutti i bypass noti basati su encoding.

**Codice attuale:**
```js
function getSafeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return '/';
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) return '/';
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return '/';
  return trimmed;
}
```

**Bypass non coperti:**
- `/%2F%2Fevil.com` → il server decodifica prima del check
- `/\tevil.com` (tab character)
- `/ /evil.com` (spazio)

**Fix raccomandato** — usare il parser URL del Node.js nativo:

```js
function getSafeRedirectUrl(url) {
  if (!url || typeof url !== 'string') return '/';
  try {
    // URL() con base fittizia: se url è assoluto lancia TypeError,
    // se è relativo il pathname è recuperabile
    const parsed = new URL(url, 'http://localhost');
    // Blocca se host è diverso da localhost (significa che url era assoluto)
    if (parsed.hostname !== 'localhost') return '/';
    // Restituisce solo pathname + search (mai il dominio)
    return parsed.pathname + parsed.search;
  } catch {
    return '/';
  }
}
```

Questo approccio usa il parser URL del browser/Node nativo che gestisce correttamente tutti gli encoding.

---

### L-3 — File temporanei orfani nel plugin `adminMedia`

**File:** `plugins/adminMedia/main.js`, righe ~61, ~125
**Impatto:** I file caricati da multer vengono scritti in `.tmp/` e poi spostati. Se il processo viene interrotto tra scrittura e spostamento (crash, SIGKILL), il file rimane orfano. Nel tempo questo può causare accumulo di dati non catalogati.

**Codice attuale:**
```js
fs.unlink(tmpFile.path, () => {}); // fire-and-forget, nessun log in caso di errore
```

**Fix raccomandato:**

1. Loggare i fallimenti di unlink:
```js
fs.unlink(tmpFile.path, (err) => {
  if (err) console.warn('[adminMedia] Failed to delete tmp file:', tmpFile.path, err.message);
});
```

2. Aggiungere una pulizia periodica al caricamento del plugin:
```js
async function cleanupTmpDir(tmpDir, maxAgeMs = 60 * 60 * 1000) { // 1 ora
  const files = await fs.promises.readdir(tmpDir).catch(() => []);
  const now   = Date.now();
  for (const f of files) {
    const fp   = path.join(tmpDir, f);
    const stat = await fs.promises.stat(fp).catch(() => null);
    if (stat && (now - stat.mtimeMs) > maxAgeMs) {
      await fs.promises.unlink(fp).catch(() => {});
    }
  }
}
// Chiamare in loadPlugin() e poi ogni ora
cleanupTmpDir(tmpDir);
setInterval(() => cleanupTmpDir(tmpDir), 60 * 60 * 1000);
```

---

## ⚪ INFORMATIONAL

### I-1 — Dipendenza `handlebars`: rischio prototype pollution

**File:** `package.json` — `"handlebars": "^4.7.8"`
**Contesto:** Handlebars ha una storia di vulnerabilità di prototype pollution (CVE-2019-19919, CVE-2021-23369, CVE-2021-23383). La versione 4.7.8 è l'ultima disponibile ma alcune varianti di attacco sono state riportate anche su versioni recenti.
**Impatto nel contesto ital8cms:** Se handlebars viene usato per rendere template con input utente non sanitizzato, prototype pollution può portare a RCE.

**Azioni:**
1. Verificare dove handlebars viene effettivamente usato nel progetto (`grep -r "handlebars" . --include="*.js" -l`)
2. Se usato solo come dipendenza transitiva, verificare se la dipendenza diretta può essere rimossa
3. Se usato direttamente, non passare mai input utente direttamente al template engine senza sanitizzazione
4. Considerare di passare a EJS (già usato nel progetto) per tutti i template che attualmente usano Handlebars

---

### I-2 — Strategia generale per la gestione dei secret

**Contesto:** Diversi punti del progetto contengono o rischiano di contenere secret nei file sorgente o di configurazione: chiavi di sessione, salt analytics, eventuali API key future.

**Inventario attuale dei secret nel repository:**
| File | Campo | Stato |
|------|-------|-------|
| `core/priorityMiddlewares/koaSession.json5` | `keys` | ❌ hardcoded nel repo |
| `plugins/analytics/pluginConfig.json5` | `custom.sessionSalt` | ⚠️ default prevedibile, modificabile via UI |

**Strategia consigliata per V3:**
Adottare `dotenv` per caricare i secret da `.env` a runtime, senza dipendenze aggiuntive sui file JSON5:

```bash
npm install dotenv
```

```js
// index.js — primissima riga
require('dotenv').config();
```

```
# .env (mai committato — aggiungere a .gitignore)
SESSION_KEY_1=<hex 64 byte>
SESSION_KEY_2=<hex 64 byte>
ANALYTICS_SALT=<hex 32 byte>
```

Aggiungere `.env` a `.gitignore` e fornire un `.env.example` committato con valori placeholder.

Questo approccio è compatibile con la filosofia del progetto (zero dipendenze obbligatorie) perché `dotenv` è opzionale — se il file `.env` non esiste le variabili d'ambiente vengono lette dal sistema operativo (comportamento standard per deployment con PM2, Docker, systemd).

---

## Raccomandazioni architetturali trasversali

### A-1 — Introdurre un middleware di sicurezza centralizzato

La catena di middleware attuale (`bodyParser → session → router`) non include nessun layer di sicurezza trasversale. Tutti i miglioramenti descritti in M-1 e M-2 trovano la loro casa naturale in un nuovo middleware di priorità.

**Struttura proposta:**
```
core/priorityMiddlewares/
├── bodyParser.js       (esistente)
├── session.js          (esistente)
├── securityHeaders.js  ← NUOVO (header HTTP sicurezza)
├── rateLimiter.js      ← NUOVO (rate limiting globale/per-route)
└── router.js           (esistente)
```

**Ordine di caricamento aggiornato:**
```
bodyParser → session → securityHeaders → rateLimiter → router
```

Il middleware `securityHeaders` si inserisce prima del router in modo da applicarsi a tutte le risposte, incluse quelle degli static server e degli error handler.

---

### A-2 — Separare i secret dal codice sorgente con `.env` + `dotenv`

Questo punto espande I-2 con indicazioni pratiche di implementazione.

**File da creare:**

```
# .env.example — committato come template
SESSION_KEY_1=genera-con-node-e-crypto-randomBytes-64-hex
SESSION_KEY_2=genera-con-node-e-crypto-randomBytes-64-hex
ANALYTICS_SALT=genera-con-node-e-crypto-randomBytes-32-hex
```

```
# .env — NON committato, da aggiungere a .gitignore
SESSION_KEY_1=a3f8c2...
SESSION_KEY_2=9d1b7e...
ANALYTICS_SALT=4f2a9c...
```

**Script di generazione** (aggiungibile a `package.json` come `scripts.gen-secrets`):
```js
// scripts/generateSecrets.js
const crypto = require('crypto');
console.log('SESSION_KEY_1=' + crypto.randomBytes(64).toString('hex'));
console.log('SESSION_KEY_2=' + crypto.randomBytes(64).toString('hex'));
console.log('ANALYTICS_SALT=' + crypto.randomBytes(32).toString('hex'));
```

```bash
node scripts/generateSecrets.js >> .env
```

**Fail-fast al boot:** Se le variabili d'ambiente obbligatorie non sono presenti, il server deve rifiutarsi di avviarsi con un messaggio chiaro — non cadere silenziosamente sul valore di default.

---

### A-3 — Ordine di implementazione suggerito

Le voci sono ordinate per massimizzare la riduzione del rischio al minimo sforzo implementativo. Le prime 4 sono bloccanti per qualsiasi deployment in produzione.

| Priorità | ID | Voce | Effort stimato | Dipendenze |
|----------|----|------|----------------|------------|
| 1 | C-1 | Chiavi sessione da env vars | Basso (1–2h) | A-2 |
| 2 | C-2 | Rimuovere/proteggere `/logged` | Molto basso (15 min) | — |
| 3 | H-2 | Flag `secure` + `sameSite` sul cookie | Basso (30 min) | C-1 |
| 4 | A-2 | Setup `.env` + `.env.example` + script | Basso (1h) | — |
| 5 | M-5 | Rimuovere `console.log` con dati utente | Molto basso (10 min) | — |
| 6 | H-3 | Oscurare `error.message` nei catch | Basso (1–2h, più route) | — |
| 7 | M-2 | Middleware security headers | Basso (2h) | A-1 |
| 8 | M-1 | Rate limiting login | Medio (3h) | — |
| 9 | H-1 | CSRF protection | Alto (1–2 giorni) | H-2 |
| 10 | M-3 | Validazione password | Basso (1h) | — |
| 11 | M-4 | bcrypt rounds 10→12 + migrazione lazy | Medio (3h) | — |
| 12 | L-2 | Open redirect con URL parser | Molto basso (30 min) | — |
| 13 | H-4 | Salt analytics: fail-fast in produzione | Basso (1h) | — |
| 14 | L-1 | Audit log | Medio (1 giorno) | — |
| 15 | L-3 | Cleanup tmp media | Basso (1h) | — |
| 16 | I-1 | Audit handlebars usage | Basso (30 min) | — |

**Milestone suggerite:**
- **V3-alpha hardening (obbligatorio prima del primo deploy):** C-1, C-2, H-2, A-2, M-5
- **V3-beta security (consigliato):** H-3, M-2, M-1, M-3
- **V3-stable (completo):** tutti gli elementi rimanenti
