<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN-https.md` is a stub until release.
# HTTPS — Deep-dive tecnico (teoria + soluzione reverse proxy)

> Guida operativa (configurazione, campi, scenari, Strada B): vedi [`https.it.md`](./https.it.md).

Questo documento parte dalla **teoria** — cosa sono i certificati HTTPS, come si generano e come si rinnovano periodicamente — e poi la applica alla **Strada A** (TLS terminato da un reverse proxy davanti a ital8cms), con un focus sia **generale** sia su **NixOS**. Per la configurazione pratica del blocco `https` e per la Strada B (ital8cms che termina il TLS direttamente) vedi la guida.

## Perché è fatto così

La guida [`https.it.md`](./https.it.md) risponde a *"come configuro HTTPS?"*. Questo EXPLAIN risponde a *"perché funziona così e quale architettura conviene?"*. La Strada A (reverse proxy) è l'architettura "da manuale" del web moderno: vale la pena capirla a fondo perché separa nettamente due responsabilità — **terminare il TLS** (un problema crittografico, standardizzato, delegabile a software specializzato) e **generare la risposta HTTP** (il lavoro di ital8cms). Capire dove finisce una e inizia l'altra rende prevedibili sicurezza, rinnovo dei certificati e debugging.

## Teoria — cosa sono i certificati HTTPS

**HTTPS = HTTP dentro TLS.** TLS (Transport Layer Security, erede di SSL) aggiunge tre garanzie al traffico:

1. **Riservatezza** — i dati sono cifrati: chi intercetta vede solo byte opachi.
2. **Integrità** — manomissioni in transito vengono rilevate.
3. **Autenticazione del server** — il client ha la prova di parlare davvero con `example.com` e non con un impostore. È qui che entra il **certificato**.

### Crittografia asimmetrica e identità

TLS si fonda sulla **crittografia asimmetrica**: una **coppia di chiavi** matematicamente legate — una **privata** (segreta, resta sul server) e una **pubblica** (distribuibile). Ciò che una cifra, l'altra decifra; e una firma prodotta con la privata è verificabile con la pubblica.

Un **certificato** è un documento che **lega una chiave pubblica a un'identità** (un nome di dominio), **firmato** da un'autorità di cui i client si fidano. Il server custodisce la chiave **privata**; il certificato (pubblico) viene inviato a ogni client che si connette.

### Cosa contiene un certificato (X.509)

Il formato standard è **X.509**. I campi che contano in pratica:

| Campo | Significato |
|-------|-------------|
| **Subject** (CN + SAN) | l'identità: `CN=example.com` e soprattutto le **Subject Alternative Names** (`DNS:example.com`, `DNS:www.example.com`). I browser moderni usano le SAN, non più il solo CN |
| **Issuer** | chi ha emesso e firmato il certificato (la CA) |
| **Validità** | `notBefore` / `notAfter`: l'intervallo in cui è valido |
| **Public Key** | la chiave pubblica legata al subject |
| **Signature** | la firma della CA che rende il documento non falsificabile |

`core/httpsManager.js` legge esattamente questi campi al boot (`X509Certificate`) per loggare soggetto, emittente, scadenza e per rilevare i self-signed (`subject === issuer`).

### Catena di fiducia (chain of trust)

Nessun browser conosce i milioni di certificati del web; conosce solo poche decine di **root CA** nel proprio **trust store** (OS/browser). La fiducia si propaga a catena:

```
Root CA  (self-signed, nel trust store del client)
   └─ firma →  Intermediate CA
                   └─ firma →  Certificato del server (leaf)  ← example.com
```

Il server invia il **leaf + le intermedie** (è il `fullchain.pem`); il client verifica le firme risalendo fino a una root di cui si fida. La **root non viene inviata** (è già nel client). Per questo, quando `certFile` è un `fullchain.pem`, il campo `caFile` è di norma superfluo.

### L'handshake TLS, in breve

```
Client                                  Server
  │ ── ClientHello (SNI: example.com) ───▶ │   SNI = quale dominio voglio
  │ ◀── ServerHello + Certificate(chain) ─ │   il server presenta il fullchain
  │ ── scambio chiavi (ECDHE) ───────────▶ │   il server prova di possedere la
  │ ◀── Finished ───────────────────────── │   chiave privata (firma)
  │ ═══ dati applicativi cifrati (HTTP) ══ │
```

Due punti chiave: **(a)** la chiave privata serve ad **autenticare** il server durante l'handshake (firma), non a cifrare i dati di massa (lo fanno chiavi di sessione simmetriche derivate al volo); **(b)** **SNI** permette a un singolo IP/porta di servire molti domini, scegliendo il certificato giusto in base al nome richiesto — è ciò che rende possibile un reverse proxy con molti virtual host.

### Tipi di certificato

- **Livello di validazione:** **DV** (Domain Validated — prova solo il controllo del dominio), **OV** (Organization Validated), **EV** (Extended Validation). Let's Encrypt emette **DV**, gratuiti e automatizzati: sufficienti per la stragrande maggioranza dei siti.
- **self-signed vs CA-signed:** un certificato self-signed (subject = issuer) non risale ad alcuna root fidata → il browser mostra un warning. Va benissimo in **sviluppo locale** (vedi la sezione self-signed nella guida), mai in produzione.

## Teoria — come si generano e si rinnovano periodicamente

### Il modo tradizionale (manuale)

Storicamente: si genera la coppia di chiavi e una **CSR** (Certificate Signing Request, contiene la chiave pubblica + il subject), la si invia a una CA commerciale, la CA verifica l'identità ed emette un certificato a lunga durata (1–2 anni). Processo **manuale, a pagamento, raramente automatizzato** → rinnovi dimenticati e disservizi.

### ACME — l'automazione (RFC 8555)

**ACME** (Automatic Certificate Management Environment) è il protocollo che automatizza richiesta, validazione, emissione e **rinnovo**. È ciò che ha reso Let's Encrypt possibile. Flusso concettuale:

1. Il client crea (una volta) un **account ACME** (una propria coppia di chiavi).
2. Crea un **ordine** per uno o più domini.
3. Per ogni dominio la CA chiede di superare una **challenge** che prova il controllo del dominio.
4. Superata la challenge, il client invia la CSR e **scarica il certificato**.

### Le challenge (come si prova di controllare il dominio)

| Challenge | Come funziona | Pro / Contro |
|-----------|---------------|--------------|
| **HTTP-01** | la CA dà un *token*; lo servi su `http://dominio/.well-known/acme-challenge/<token>`; la CA lo recupera sulla **porta 80** | semplice; richiede la porta 80 raggiungibile; **niente wildcard** |
| **DNS-01** | crei un record **TXT** `_acme-challenge.dominio` con un valore derivato dal token; la CA interroga il DNS | nessuna porta in ingresso; **supporta i wildcard** (`*.dominio`); richiede automazione DNS (API del provider) |
| **TLS-ALPN-01** | validazione via TLS sulla **porta 443** con un protocollo ALPN dedicato | usata da alcuni proxy (Caddy/Traefik); niente porta 80 |

ital8cms implementa il lato server di **HTTP-01** (endpoint `/.well-known/acme-challenge/:token`, vedi guida) per lo scenario in cui è esso stesso il webserver. Con un reverse proxy o con DNS-01 quell'endpoint non serve.

### Perché il rinnovo è *periodico*

I certificati Let's Encrypt durano **90 giorni**. La durata breve è una **scelta di sicurezza**: limita la finestra di abuso in caso di compromissione della chiave e **costringe ad automatizzare**. I client rinnovano tipicamente quando mancano ~30 giorni, ben prima della scadenza. Il ciclo periodico è sempre lo stesso:

```
timer/cron  →  il client ACME controlla i giorni residui
            →  se sotto soglia: riesegue la challenge → ottiene un nuovo cert
            →  ricarica/riavvia il server che usa il certificato
```

`expiryWarningDays` / `expiryCriticalDays` di ital8cms **non rinnovano** nulla: sono solo soglie di **avviso al boot** per accorgersi se l'automazione di rinnovo si è inceppata.

### I client ACME

- **certbot** (EFF, Python) — il più diffuso, generico.
- **lego** (Go) — usato da **NixOS `security.acme`** e da Traefik.
- **acme.sh** (shell), **Caddy** (HTTPS automatico integrato), win-acme.

Su NixOS non si scrive un cron: `security.acme` genera un **systemd timer per dominio** che esegue lego e rinnova in automatico.

## Architettura — la soluzione reverse proxy (Strada A)

### TLS termination

Nella Strada A un **reverse proxy** (nginx, Caddy, …) si occupa di **terminare il TLS**: parla **HTTPS** verso Internet e inoltra **HTTP in chiaro** al backend su una rete locale fidata (il loopback). ital8cms non vede mai né il TLS né la chiave privata.

```
                         :443 (TLS)            :3000 (HTTP, loopback)
   Internet  ──────────▶  reverse proxy  ──────────────────▶  ital8cms
   (browser)   HTTPS       (nginx/Caddy)      HTTP in chiaro    (Node/Koa)
                              │  detiene cert + chiave privata
                              │  gestisce ACME / rinnovo
                         :80 ─┘  redirect 301 → 443
```

### Perché conviene

- **Separazione delle responsabilità:** il proxy è software **specializzato** in TLS — cifrari moderni, **TLS 1.3**, **OCSP stapling**, **HTTP/2 e HTTP/3**, ripresa di sessione. ital8cms resta concentrato sul generare HTML/JSON.
- **Superficie ridotta e nessun privilegio:** ital8cms gira su una porta **non privilegiata** (3000) come utente normale; **non** tocca la chiave privata. Se l'app fosse compromessa, la chiave TLS resta fuori dalla sua portata.
- **Gestione centralizzata dei certificati:** un solo punto che ottiene e rinnova i certificati di **molti** siti (virtual host via **SNI**).
- **Funzioni extra "gratis":** caching, compressione, rate limiting/WAF, load balancing, terminazione di più protocolli.
- **Su NixOS è dichiarativo e self-healing:** `services.nginx.enableACME` + `security.acme` ottengono il certificato, fanno il redirect 80→443 e **rinnovano ricaricando nginx** senza alcuna logica applicativa.

### Trade-off (rispetto alla Strada B)

- **Un hop in più:** trascurabile sul loopback.
- **TLS non end-to-end fino all'app:** il tratto proxy→app è in chiaro. Sul loopback è accettabile; in reti non fidate si **ri-cifra** verso il backend (`proxy_pass https://…`).
- **L'app deve fidarsi degli header inoltrati:** dietro un proxy, schema reale (`https`) e IP del client viaggiano in header `X-Forwarded-*` — vanno trattati con cura (vedi *Sicurezza* e *Applicazione a ital8cms*).

## Applicazione a ital8cms — generale

### Configurazione

ital8cms si mette in HTTP puro e lascia tutto il TLS al proxy:

```json5
// ital8Config.json5
"httpPort": 3000,
"https": { "enabled": false }
```

Con `https.enabled: false`, `httpsManager.start()` avvia **solo** un server HTTP su `httpPort` (nessuna analisi certificato, nessun hot reload, nessun endpoint ACME: li gestisce il proxy). Idealmente fai il bind sul **loopback** (`127.0.0.1`) così l'app non è raggiungibile direttamente da Internet, ma solo tramite il proxy.

### Inoltro degli header — nota importante (`app.proxy`)

Il proxy inoltra l'identità della richiesta originale:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;   # "https"
```

⚠️ **ital8cms (in `index.js`) non imposta `app.proxy = true`.** Di conseguenza Koa, per default, **non si fida** degli header `X-Forwarded-*`: dietro il proxy `ctx.protocol` resta `'http'`, `ctx.secure` è `false` e `ctx.ip` è l'**IP del proxy** (`127.0.0.1`), non quello del client reale. Conseguenze da tenere presenti:

- Qualsiasi logica che dipende dall'**IP del client** (logging, e plugin che chiavano sull'IP come `rateLimiter`) vedrebbe l'IP del proxy.
- Qualsiasi logica che dipende dallo **schema** (`ctx.secure`, costruzione di URL assoluti `https`, cookie `Secure`) vedrebbe `http`.

Per far sì che Koa onori gli `X-Forwarded-*` occorrerebbe abilitare `app.proxy = true` (e idealmente restringere gli IP fidati). **Questa guida non modifica il codice**: lo segnaliamo come consapevolezza architetturale e come possibile tuning futuro (vedi *Limitazioni*). Finché `app.proxy` resta `false`, abilitalo solo se davanti c'è davvero un proxy fidato — mai su un'app esposta direttamente, perché gli header sarebbero falsificabili dal client.

### Esempio nginx (generale)

```nginx
# redirect tutto l'HTTP verso HTTPS
server {
  listen 80;
  server_name example.com;
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name example.com;

  ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Il certificato e il suo rinnovo (certbot, acme.sh, …) sono **interamente fuori da ital8cms**: il client ACME rinnova e **ricarica nginx** (`nginx -s reload`).

## Applicazione a ital8cms — NixOS

Su NixOS la Strada A è particolarmente pulita: nginx + `security.acme` rendono ottenimento, redirect e **rinnovo automatico** completamente dichiarativi. Modulo dedicato `ital8cms-proxy.nix`, importato da `configuration.nix` (`imports = [ ./ital8cms-proxy.nix ];`):

```nix
# ital8cms-proxy.nix
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
  };

  services.nginx = {
    enable = true;
    recommendedTlsSettings   = true;   # TLS 1.2/1.3, cifrari forti, OCSP stapling
    recommendedProxySettings = true;   # imposta gli header X-Forwarded-* corretti
    recommendedGzipSettings  = true;
    virtualHosts.${domain} = {
      enableACME = true;   # ottiene E RINNOVA il certificato automaticamente
      forceSSL   = true;   # redirect 80 → 443
      locations."/" = {
        proxyPass = "http://127.0.0.1:3000";
        proxyWebsockets = true;
      };
    };
  };

  networking.firewall.allowedTCPPorts = [ 80 443 ];

  # ital8cms: servizio HTTP puro sul loopback, NESSUNA capability sulle porte basse
  systemd.services.ital8cms = {
    description = "ital8cms";
    wantedBy = [ "multi-user.target" ];
    wants    = [ "network-online.target" ];
    after    = [ "network-online.target" ];
    environment.NODE_ENV = "production";
    serviceConfig = {
      User = "ital8cms";
      Group = "ital8cms";
      WorkingDirectory = projectRoot;
      ExecStart = "${pkgs.nodejs}/bin/node index.js";
      Restart = "on-failure";
      ProtectSystem = "strict";
      ReadWritePaths = [ projectRoot ];
      ProtectHome = true;
      NoNewPrivileges = true;
    };
  };
}
```

Punti notevoli rispetto alla Strada B:

- **Niente `CAP_NET_BIND_SERVICE`:** ital8cms sta su 3000, solo nginx tocca 80/443.
- **`recommendedProxySettings = true`** imposta automaticamente gli header `X-Forwarded-*` (resta valida la nota su `app.proxy` lato ital8cms).
- **Rinnovo automatico:** `security.acme` installa il systemd timer; con `enableACME` NixOS **ricarica nginx** a ogni rinnovo (nessun `reloadServices` da scrivere a mano). I certificati vivono in `/var/lib/acme/<dominio>/` e il modulo aggiunge nginx al gruppo `acme` per leggerli.

## Sicurezza

- **Redirect 80→443** (`forceSSL` / il `server` di redirect): nessun contenuto servito in chiaro.
- **TLS moderno:** `recommendedTlsSettings` (TLS 1.2/1.3, cifrari forti, OCSP stapling). Evita protocolli/cifrari legacy.
- **HSTS:** aggiungi `Strict-Transport-Security` (es. via `extraConfig` del virtual host) per forzare HTTPS nei browser dopo la prima visita.
- **Chiave privata isolata:** nella Strada A la chiave sta **solo** sul proxy; ital8cms non vi accede mai — riduzione netta della superficie d'attacco.
- **Header inoltrati:** `app.proxy = true` (se mai abilitato) va usato **solo** dietro un proxy fidato; diversamente un client potrebbe falsificare `X-Forwarded-Proto`/`X-Forwarded-For`.
- **Cookie:** per cookie `Secure` dietro proxy serve che l'app sappia di essere in HTTPS (di nuovo `app.proxy` + `X-Forwarded-Proto`). La sessione di ital8cms usa già `HttpOnly` e `SameSite=lax` (vedi `core/priorityMiddlewares/koaSession.json5`).

## Regolazione & estensione

- **Più siti:** un solo proxy con molti `virtualHosts`/`server` (SNI) può servire decine di domini, ciascuno con il proprio certificato e backend.
- **Wildcard:** per `*.example.com` usa **DNS-01** (`security.acme.certs.<dominio>.dnsProvider`), unica challenge che li supporta.
- **HTTP/2 e HTTP/3:** abilitabili a livello di proxy senza toccare ital8cms.
- **Caddy come alternativa a nginx:** HTTPS automatico "out of the box" (gestisce ACME da sé), configurazione minima; stesso schema di TLS termination + `reverse_proxy 127.0.0.1:3000`.
- **Reti non fidate proxy↔app:** ri-cifra verso il backend (`proxy_pass https://…`) se il tratto interno non è il loopback.

## Limitazioni & sviluppi futuri

- **`app.proxy` non impostato:** dietro reverse proxy, IP client e schema non sono visti correttamente da ital8cms finché `app.proxy = true` non viene abilitato in `index.js`. Possibile evoluzione: esporlo come flag in `ital8Config.json5` (con whitelist di IP fidati). Per ora è una scelta consapevole documentata qui.
- **Hint generici nei messaggi del core:** i box di `httpsManager` suggeriscono `certbot renew` / `setcap` (Debian-centrici); gli equivalenti NixOS sono nella guida. Allineamento dei messaggi: miglioria futura.
- **Configurazione via variabili d'ambiente:** vedi la nota in [`deployment.it.md`](./deployment.it.md) (porta/HTTPS da env) — utile per containerizzazione.

## Riferimenti

- Guida operativa (campi, scenari, Strada B): [`https.it.md`](./https.it.md)
- Deploy in produzione: [`deployment.it.md`](./deployment.it.md)
- Implementazione: [`core/httpsManager.js`](../core/httpsManager.js)
- RFC 8555 (ACME), documentazione Let's Encrypt, NixOS `security.acme` / `services.nginx`
