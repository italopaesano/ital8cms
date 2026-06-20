<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 2 · ref -->
> 🌐 Italian reference edition (always up to date). English `https.md` is a stub until release.
# Configurazione HTTPS — ital8cms

> 📖 Teoria e deep-dive (cosa sono i certificati HTTPS, come si generano e si rinnovano periodicamente con ACME/Let's Encrypt, e la soluzione **reverse proxy** spiegata da zero): vedi [`EXPLAIN-https.it.md`](./EXPLAIN-https.it.md).

## Scopo

Guida operativa alla configurazione HTTPS di ital8cms: il blocco `https`, gli scenari di comportamento, e le due architetture di produzione con Let's Encrypt — la **Strada B** (ital8cms termina il TLS direttamente sulle porte 80/443, consigliata per servire un sito senza altri componenti) e la **Strada A** (reverse proxy davanti a ital8cms). Per ognuna: indicazioni **generali** e specifiche per **NixOS**.

## Panoramica

ital8cms supporta HTTPS nativamente tramite il modulo `https` integrato di Node.js (nessuna dipendenza npm aggiuntiva). Tutte le impostazioni HTTPS sono raggruppate nel blocco `https` di `ital8Config.json5`. La logica di avvio è centralizzata in [`core/httpsManager.js`](../core/httpsManager.js), esportata come `start(app, router, ital8Conf)` e chiamata da `index.js`.

Oltre all'avvio dei server, `httpsManager` fornisce:

- **analisi del certificato all'avvio** (soggetto, emittente, scadenza, soglie di warning/critical);
- **hot reload** dei certificati senza riavvio (`fs.watch` + `setSecureContext()`), utile dopo un rinnovo;
- **endpoint ACME HTTP-01** (`/.well-known/acme-challenge/:token`) per il rinnovo automatico via Let's Encrypt;
- **gestione pulita degli errori di bind** (porta privilegiata / porta occupata) con messaggi azionabili.

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

    // Soglie di avviso scadenza certificato (giorni rimanenti)
    "expiryWarningDays": 60,                  // ⚠  warning  — avviare il rinnovo
    "expiryCriticalDays": 15,                 // 🔴 critical — rinnovo urgente

    // Ricarica certificati senza riavvio quando i file cambiano su disco
    "hotReload": { "enabled": true, "debounceMs": 2000 },

    // Endpoint ACME HTTP-01 challenge per rinnovo automatico Let's Encrypt
    "acmeChallenge": { "enabled": false, "webroot": "" },
  },
}
```

## Riferimento dei campi

Tabella canonica dei campi del blocco `https` (questa guida è il riferimento unico; l'EXPLAIN cita i campi solo per spiegarne meccanismo o trade-off).

| Campo | Tipo | Obbligatorio | Default | Descrizione |
|-------|------|--------------|---------|-------------|
| `enabled` | boolean | Sì | `false` | `true` = abilita HTTPS, `false` = HTTP puro |
| `port` | number | Sì | `443` | Porta HTTPS (tipicamente 443) |
| `AutoRedirectHttpPortToHttpsPort` | boolean | Sì | `false` | Se `true`, il server HTTP su `httpPort` risponde solo con redirect 301 verso HTTPS (le challenge ACME restano servite) |
| `certFile` | string | Se abilitato | — | Certificato server (es. `fullchain.pem`). Assoluto o relativo alla root del progetto |
| `keyFile` | string | Se abilitato | — | Chiave privata (es. `privkey.pem` con certbot, `key.pem` con NixOS). Assoluto o relativo |
| `caFile` | string | No | `""` | CA intermedia (es. `chain.pem`). Vuoto = disabilitato. Superfluo se `certFile` è un `fullchain.pem` |
| `tlsOptions` | object | No | `{}` | Opzioni raw passate a `https.createServer()`. Unite **prima** di cert/key/ca, che hanno priorità. Utile per `ciphers`, `secureProtocol`, ecc. |
| `expiryWarningDays` | number | No | `60` | Giorni alla scadenza sotto i quali al boot compare un ⚠ warning |
| `expiryCriticalDays` | number | No | `15` | Giorni alla scadenza sotto i quali al boot compare un 🔴 critical |
| `hotReload.enabled` | boolean | No | `true` | Ricarica cert/key senza riavvio quando i file cambiano (post-rinnovo) |
| `hotReload.debounceMs` | number | No | `2000` | Attesa dopo l'ultimo evento fs prima di ricaricare (evita reload su scritture parziali) |
| `acmeChallenge.enabled` | boolean | No | `false` | Abilita l'endpoint `/.well-known/acme-challenge/:token` (challenge HTTP-01) |
| `acmeChallenge.webroot` | string | Se ACME abilitato | `""` | Webroot dei token; ital8cms legge da `{webroot}/.well-known/acme-challenge/`. Compatibile con `certbot --webroot -w {webroot}` |

## Scenari di comportamento

**Scenario 1 — `enabled: false` (default).** Solo HTTP su `httpPort`.

```
httpPort:3000 → App Koa completa
```

**Scenario 2 — `enabled: true` + `AutoRedirectHttpPortToHttpsPort: false`.** Due server paralleli: HTTPS completo + HTTP completo.

```
httpPort:3000  → App Koa completa (HTTP)
https.port:443 → App Koa completa (HTTPS)
```

**Scenario 3 — `enabled: true` + `AutoRedirectHttpPortToHttpsPort: true`.** HTTPS completo + HTTP minimale che redirige (301). La porta 443 viene **omessa** dall'URL di redirect (standard); porte non-standard (es. 8443) vengono incluse. Le richieste a `/.well-known/acme-challenge/` hanno **priorità sul redirect** (servite direttamente) → il rinnovo HTTP-01 funziona anche con il redirect attivo.

```
httpPort:3000  → redirect 301 → https://hostname[:port]/path  (+ ACME challenge)
https.port:443 → App Koa completa (HTTPS)
```

**Scenario 4 — `enabled: true` + certificati mancanti/illeggibili.** Fallback automatico a HTTP puro + warning visivo prominente (box `[HTTPS]`) con istruzioni azionabili. Distingue se manca `certFile`, `keyFile`, o entrambi. Il server **continua ad avviarsi** in HTTP sulla porta `httpPort`.

**Scenario 5 — errore di bind della porta.** Quando un server non riesce a mettersi in ascolto, l'evento `'error'` di `listen()` viene intercettato e tradotto in un **box diagnostico** seguito da **uscita pulita** (`process.exit(1)`); qui **non** c'è fallback (senza il bind non si può servire).

- `EACCES` (porta privilegiata `< 1024` senza permessi) → box `warnPrivilegedPort()`: opzioni *porta ≥ 1024 + reverse proxy* / *concedere la capability a Node* / *avvio con privilegi elevati*.
- `EADDRINUSE` (porta già occupata) → box `warnPortInUse()`: individua il processo (`lsof`/`ss`/`fuser`), libera la porta, o cambia porta.

> ℹ️ I box di errore e di scadenza certificato suggeriscono comandi **generici/Debian** (`certbot renew`, `setcap ... $(which node)`). Su **NixOS** valgono gli equivalenti dichiarativi descritti più sotto (timer di `security.acme`, `AmbientCapabilities`).

## Due architetture di produzione

| | **Strada B** — TLS in ital8cms | **Strada A** — reverse proxy |
|---|---|---|
| Chi termina il TLS | ital8cms (modulo `https` di Node) | nginx / Caddy davanti a ital8cms |
| Porte di ital8cms | 80 + 443 (privilegiate) | 3000 (loopback, non privilegiata) |
| Certificato letto da | ital8cms | il proxy |
| Rinnovo → ricarica | `hotReload` (o restart) | reload del proxy (automatico su NixOS) |
| Quando preferirla | servire un sito **senza** altri componenti | più siti / TLS avanzato / separazione dei ruoli |

La Strada B è documentata qui sotto in dettaglio. La Strada A è riassunta in fondo e trattata in profondità (con la teoria) in [`EXPLAIN-https.it.md`](./EXPLAIN-https.it.md).

## Strada B (consigliata) — ital8cms termina il TLS su 80/443

ital8cms ascolta direttamente su 80 (redirect + challenge) e 443 (sito), e legge i certificati emessi da un client ACME esterno (certbot in generale, `security.acme` su NixOS).

### B.1 — `ital8Config.json5`

```json5
"httpPort": 80,                 // server HTTP: redirect 301 + ACME challenge
"https": {
  "enabled": true,
  "port": 443,
  "AutoRedirectHttpPortToHttpsPort": true,
  "certFile": "/etc/letsencrypt/live/example.com/fullchain.pem",
  "keyFile":  "/etc/letsencrypt/live/example.com/privkey.pem",
  "caFile":   "",               // fullchain.pem include già la catena
  "hotReload": { "enabled": true, "debounceMs": 2000 },
  "acmeChallenge": { "enabled": false, "webroot": "" }  // vedi B.2
}
```

Su **NixOS** cambiano i percorsi (vedi B.2): i certificati di `security.acme` stanno in `/var/lib/acme/<dominio>/` e la chiave si chiama **`key.pem`** (non `privkey.pem`).

### B.2 — Ottenere e rinnovare il certificato

**Generico (certbot).** Emissione con webroot servito da ital8cms:

1. In `ital8Config.json5` imposta `acmeChallenge: { "enabled": true, "webroot": "/var/www/acme" }` (path assoluto).
2. Emetti/rinnova: `certbot certonly --webroot -w /var/www/acme -d example.com`. ital8cms serve i token su `:80` (anche in modalità redirect, Scenario 3).
3. Il rinnovo automatico è gestito dal timer/cron di certbot; con `hotReload` attivo ital8cms ricarica i nuovi file senza riavvio.

**NixOS (`security.acme`).** Su NixOS non si usa il cron di certbot: `security.acme` (basato su **lego**) installa un **systemd timer per dominio** che rinnova in automatico (~30 giorni prima della scadenza). Modulo dedicato `ital8cms-https.nix`, importato da `configuration.nix` (`imports = [ ./ital8cms-https.nix ];`):

```nix
# ital8cms-https.nix
{ config, pkgs, ... }:
let
  domain      = "example.com";
  projectRoot = "/var/lib/ital8cms";
in {
  users.users.ital8cms = { isSystemUser = true; group = "ital8cms"; home = projectRoot; };
  users.groups.ital8cms = {};

  security.acme = {
    acceptTerms = true;
    defaults.email = "you@example.com";
    certs.${domain} = {
      group = "ital8cms";                 # ital8cms può leggere key.pem
      dnsProvider = "cloudflare";         # DNS-01: nessuna dipendenza dalla porta 80
      environmentFile = "/var/lib/secrets/acme.env";  # es. CF_DNS_API_TOKEN=...
      # reloadServices = [ "ital8cms.service" ];      # rete di sicurezza, vedi nota hot reload
    };
  };

  networking.firewall.allowedTCPPorts = [ 80 443 ];

  systemd.services.ital8cms = {
    description = "ital8cms";
    wantedBy = [ "multi-user.target" ];
    wants    = [ "network-online.target" ];
    after    = [ "network-online.target" "acme-${domain}.service" ];
    environment.NODE_ENV = "production";
    serviceConfig = {
      User = "ital8cms";
      Group = "ital8cms";
      WorkingDirectory = projectRoot;
      ExecStart = "${pkgs.nodejs}/bin/node index.js";
      Restart = "on-failure";
      AmbientCapabilities   = [ "CAP_NET_BIND_SERVICE" ];   # bind su 80/443 da non-root
      CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
      ProtectSystem = "strict";
      ReadWritePaths = [ projectRoot ];   # ital8cms scrive JSON5/log nel progetto
      ProtectHome = true;
      NoNewPrivileges = true;
    };
  };
}
```

E in `ital8Config.json5`: `certFile = "/var/lib/acme/example.com/fullchain.pem"`, `keyFile = "/var/lib/acme/example.com/key.pem"`, `caFile = ""`.

**Tipo di challenge su NixOS:**

- **DNS-01 (consigliato per la Strada B):** `dnsProvider = "..."`. Nessuna dipendenza dalla porta 80, niente problemi di ordine d'avvio, supporta i wildcard. Lascia `acmeChallenge.enabled: false`.
- **HTTP-01 via webroot:** imposta `security.acme.certs.<dominio>.webroot = "/var/lib/acme/acme-challenge"` **e** in `ital8Config.json5` `acmeChallenge: { "enabled": true, "webroot": "/var/lib/acme/acme-challenge" }` (stesso path assoluto). Per i **rinnovi** ital8cms è sempre attivo su :80 e serve i token; per la **prima emissione** conviene wirare l'ordine `acme-<dominio>.service` → `after/wants = [ "ital8cms.service" ]` (se la prima validazione fallisce, il timer riprova). Per questa frizione, **DNS-01 resta più pulito** quando è ital8cms a fare da webserver.

### B.3 — Porte privilegiate

Far girare Node su 80/443 come utente non-root richiede la capability `CAP_NET_BIND_SERVICE`, altrimenti scatta lo Scenario 5 (`EACCES`).

- **NixOS:** `AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ]` nel unit systemd (vedi B.2). **Non** usare `setcap` su `$(which node)`: il binario è in `/nix/store` (immutabile) e cambia a ogni update.
- **Altri Linux:** `sudo setcap 'cap_net_bind_service=+ep' $(which node)` (da rieseguire dopo ogni aggiornamento di Node), oppure usa la Strada A.

### B.4 — Ciclo di vita / prima emissione

Se al primo boot il certificato non esiste ancora, ital8cms **non crasha**: parte in HTTP puro sulla porta `httpPort` servendo l'app completa, **con la route ACME già registrata**. Quindi: prima emissione → certificato pronto → **un riavvio** di ital8cms per passare a HTTPS+redirect+hotReload → da lì i rinnovi sono automatici (hot reload).

## Strada A (secondaria) — reverse proxy

nginx/Caddy termina il TLS su 443 e fa da proxy a ital8cms in HTTP puro su `127.0.0.1:3000` (`https.enabled: false`). Vantaggi: ital8cms resta su porta non privilegiata (niente capability), il proxy gestisce cert, redirect e TLS avanzato, e su NixOS il reload del proxy al rinnovo è automatico.

Esempio nginx (vedi anche [`deployment.it.md`](./deployment.it.md)):

```nginx
server {
  listen 443 ssl;
  server_name example.com;
  ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Su **NixOS** la coppia idiomatica è `services.nginx` (con `enableACME = true; forceSSL = true;`) + `security.acme`: ottenimento, redirect 80→443 e rinnovo (con reload di nginx) sono **completamente dichiarativi**. ital8cms resta un servizio systemd su `127.0.0.1:3000` con `https.enabled: false` e **senza** `CAP_NET_BIND_SERVICE`.

> 📖 Teoria completa (certificati, ACME, rinnovo periodico) e il modulo NixOS `ital8cms-proxy.nix` con tutte le note (header `X-Forwarded-*`, `app.proxy`, cookie `Secure`, HSTS): [`EXPLAIN-https.it.md`](./EXPLAIN-https.it.md).

## Certificato self-signed (sviluppo locale)

```bash
# Certificato self-signed con SAN (richiesto dai browser moderni)
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Il flag `-addext "subjectAltName=..."` è necessario: senza SAN i browser mostrano `ERR_CERT_COMMON_NAME_INVALID` anche se Node accetta la connessione. Config tipica di sviluppo:

```json5
"https": {
  "enabled": true,
  "port": 3443,
  "AutoRedirectHttpPortToHttpsPort": false,
  "certFile": "./certs/fullchain.pem",
  "keyFile": "./certs/privkey.pem",
  "caFile": "",
}
```

Accesso: `https://localhost:3443` (il browser mostrerà un warning per il self-signed, normale in sviluppo).

## Rinnovo del certificato (in sintesi)

- **Strada B + certbot:** rinnovo dal timer/cron di certbot; `hotReload` ricarica i nuovi file senza riavvio.
- **Strada B + NixOS:** rinnovo dal systemd timer di `security.acme`; `hotReload` ricarica senza riavvio. Caveat: l'hot reload via `fs.watch` può sospendersi se il rinnovo sostituisce i file con un rename atomico (il watcher logga un warning e non riarma); come rete di sicurezza aggiungi `reloadServices = [ "ital8cms.service" ]` (NixOS esegue `try-reload-or-restart` → riavvio breve garantito).
- **Strada A:** rinnovo gestito dal proxy/sistema; il proxy viene ricaricato (su NixOS automaticamente con `enableACME`).

## Note di implementazione

- `http` e `https` sono moduli built-in di Node.js — nessuna dipendenza npm aggiuntiva.
- `start()` usa `app.callback()` (non `app.listen()`) per passare l'app Koa sia a `http.createServer()` che a `https.createServer()`.
- `tlsOptions` viene unito con spread **prima** di `cert`/`key`/`ca`, garantendo che i percorsi file abbiano sempre priorità.
- **Warning certificati mancanti** (`warnMissingCertificates()`): controllo `fs.existsSync()` pre-emptivo, distingue il file assente, box ASCII azionabile, fallback a HTTP puro.
- **Hot reload** (`setupHotReload()`): watcher su `certFile` (e `caFile` se presente) con debounce; ricarica via `setSecureContext()`. Gli errori del watcher sono **non fatali** (warning, il server continua a servire col certificato già caricato).
- **ACME HTTP-01** (`setupAcmeChallengeRoute()` + `createHttpRedirectServer()`): token serviti sia dalla route Koa sia dal server di redirect su :80, con protezione path-traversal (`path.basename`).
- **Errori di bind** (`onListenError` + `warnPrivilegedPort()` + `warnPortInUse()`): handler `'error'` su ogni server **prima** di `listen()`; smistamento per `err.code`; uscita pulita senza stack trace.

## Riferimenti

- Teoria e deep-dive reverse proxy: [`EXPLAIN-https.it.md`](./EXPLAIN-https.it.md)
- Deploy in produzione: [`deployment.it.md`](./deployment.it.md)
- Implementazione: [`core/httpsManager.js`](../core/httpsManager.js)
- Configurazione: blocco `https` in [`ital8Config.json5`](../ital8Config.json5)
