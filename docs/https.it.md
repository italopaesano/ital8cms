<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `https.md` is a stub until release.
# Configurazione HTTPS — ital8cms

## Panoramica

ital8cms supporta HTTPS nativamente tramite il modulo `https` integrato di Node.js. Tutte le impostazioni HTTPS sono raggruppate nel blocco `https` di `ital8Config.json5`. Le tre vecchie variabili piatte (`useHttps`, `httpsPort`, `AutoRedirectHttpPortToHttpsPort`) sono state rimosse.

## Blocco di configurazione

```json5
// In ital8Config.json5
{
  "httpPort": 3000,

  "https": {
    "enabled": false,                         // true = abilita HTTPS
    "port": 443,                              // Porta HTTPS (default 443)
    "AutoRedirectHttpPortToHttpsPort": false, // true = redirect 301 HTTP→HTTPS
    "certFile": "./certs/fullchain.pem",      // Percorso certificato server
    "keyFile": "./certs/privkey.pem",         // Percorso chiave privata
    "caFile": "",                             // CA intermedia (opzionale, "" = disabilitato)
    "tlsOptions": {},                         // Opzioni TLS avanzate (opzionale)
  },
}
```

## Riferimento dei campi

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|--------------|-------------|
| `enabled` | boolean | Sì | `true` = abilita HTTPS, `false` = HTTP puro |
| `port` | number | Sì | Porta HTTPS (tipicamente 443) |
| `AutoRedirectHttpPortToHttpsPort` | boolean | Sì | Se `true`, il server HTTP su `httpPort` risponde solo con redirect 301 verso HTTPS |
| `certFile` | string | Se abilitato | Percorso al certificato server (es. `fullchain.pem` di Let's Encrypt). Assoluto o relativo alla root del progetto. |
| `keyFile` | string | Se abilitato | Percorso alla chiave privata (es. `privkey.pem`). Assoluto o relativo. |
| `caFile` | string | No | Percorso alla CA intermedia (es. `chain.pem`). Stringa vuota `""` = disabilitato. |
| `tlsOptions` | object | No | Opzioni raw passate a `https.createServer()`. Vengono unite **prima** di certFile/keyFile/caFile, che hanno sempre priorità. Utile per `ciphers`, `secureProtocol`, `requestCert`, ecc. |

## Scenari di comportamento

**Scenario 1: `enabled: false` (default)**

Solo HTTP su `httpPort`.

```
httpPort:3000 → App Koa completa
```

**Scenario 2: `enabled: true` + `AutoRedirectHttpPortToHttpsPort: false`**

Due server paralleli: HTTPS completo + HTTP completo.

```
httpPort:3000  → App Koa completa (HTTP)
https.port:443 → App Koa completa (HTTPS)
```

**Scenario 3: `enabled: true` + `AutoRedirectHttpPortToHttpsPort: true`**

HTTPS completo + HTTP minimale che redirige.

```
httpPort:3000  → redirect 301 → https://hostname[:port]/path
https.port:443 → App Koa completa (HTTPS)
```

La porta 443 viene **omessa** dall'URL di redirect (standard HTTP). Porte non-standard (es. 8443) vengono incluse.

**Scenario 4: `enabled: true` + certificati mancanti o illeggibili**

Fallback automatico a HTTP puro + warning visivo prominente con istruzioni actionable.

```
[HTTPS] ══════════════════════════════════════════════════════════
[HTTPS]  ⚠  HTTPS abilitato ma certificati mancanti
[HTTPS] ══════════════════════════════════════════════════════════
[HTTPS]    certFile: ./certs/fullchain.pem  ← non trovato
[HTTPS]    keyFile:  ./certs/privkey.pem  ← non trovato
[HTTPS]
[HTTPS]  Opzione A — genera un certificato self-signed (sviluppo locale):
[HTTPS]
[HTTPS]    mkdir -p certs
[HTTPS]    openssl req -x509 -newkey rsa:2048 \
[HTTPS]      -keyout certs/privkey.pem \
[HTTPS]      -out certs/fullchain.pem \
[HTTPS]      -days 365 -nodes \
[HTTPS]      -subj "/CN=localhost" \
[HTTPS]      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
[HTTPS]
[HTTPS]  Opzione B — disabilita HTTPS in ital8Config.json5:
[HTTPS]
[HTTPS]    "https": { "enabled": false }
[HTTPS]
[HTTPS]  ▶ Avvio in HTTP puro sulla porta 3000 (fallback)
[HTTPS] ══════════════════════════════════════════════════════════
httpPort:3000 → App Koa completa (HTTP - fallback)
```

**Comportamento di dettaglio:**
- Se manca **solo** il cert → `← non trovato` appare solo sulla riga `certFile`, il titolo usa il singolare
- Se manca **solo** la key → `← non trovato` appare solo sulla riga `keyFile`
- Se mancano **entrambi** → entrambe le righe annotate, titolo al plurale
- Errori di altro tipo (permessi, file corrotto) → `console.error` generico (catch separato)

## Setup Let's Encrypt (esempio pratico)

```json5
"https": {
  "enabled": true,
  "port": 443,
  "AutoRedirectHttpPortToHttpsPort": true,
  "certFile": "/etc/letsencrypt/live/example.com/fullchain.pem",
  "keyFile": "/etc/letsencrypt/live/example.com/privkey.pem",
  "caFile": "/etc/letsencrypt/live/example.com/chain.pem",
  "tlsOptions": {},
},
```

## Certificato self-signed (sviluppo locale)

```bash
# Genera certificato self-signed con SAN (richiesto da Chrome >= 58)
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

**Nota:** il flag `-addext "subjectAltName=..."` è necessario perché i browser moderni (Chrome ≥ 58, Firefox, Safari) rifiutano i certificati che hanno solo `CN=localhost` senza Subject Alternative Name (SAN). Senza SAN il browser mostra `ERR_CERT_COMMON_NAME_INVALID` anche se Node.js accetta la connessione.

```json5
"https": {
  "enabled": true,
  "port": 3443,
  "AutoRedirectHttpPortToHttpsPort": false,
  "certFile": "./certs/fullchain.pem",
  "keyFile": "./certs/privkey.pem",
  "caFile": "",
  "tlsOptions": {},
},
```

Accesso: `https://localhost:3443` (il browser mostrerà un warning per il self-signed, normale in sviluppo).

## Note di implementazione

- `http` e `https` sono moduli built-in di Node.js — nessuna dipendenza npm aggiuntiva
- La logica di avvio è centralizzata in `core/httpsManager.js`, esportata come `start(app, router, ital8Conf)` e chiamata da `index.js`
- `app.callback()` viene chiamato invece di `app.listen()` per poter passare l'app Koa sia a `http.createServer()` che a `https.createServer()`
- `tlsOptions` viene unito con spread (`...tlsOptions`) **prima** di `cert`/`key`/`ca`, garantendo che i percorsi file abbiano sempre priorità
- **Warning certificati mancanti** (`warnMissingCertificates()` in `httpsManager.js`):
  - Effettua un controllo `fs.existsSync()` **pre-emptivo** prima di tentare `readFileSync()`
  - Distingue quale file è assente (`certFile`, `keyFile`, o entrambi) — annotazione `← non trovato` solo sul file mancante
  - Emette un box ASCII visivo con bordi `═══`, difficile da ignorare nello scroll del terminale
  - Include il comando `openssl` esatto con SAN e lo snippet per disabilitare HTTPS
  - Il server **continua ad avviarsi** in HTTP puro (fallback — comportamento invariato)
  - Errori diversi da "file not found" (permessi, corruzione) passano al `catch` generico separato
