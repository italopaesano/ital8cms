<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN-https.md` is a stub until release.
# HTTPS — Deep-dive tecnico (teoria + ital8cms come terminatore TLS)

> Guida operativa (configurazione, campi, scenari, ricette): vedi [`https.it.md`](./https.it.md).

Questo documento parte dalla **teoria** — cosa sono i certificati HTTPS, come si generano e come si rinnovano periodicamente — e poi la applica allo scenario **di riferimento** di ital8cms: servire un **sito web ufficiale terminando il TLS direttamente sulle porte 80 e 443** (la **Strada B**). La soluzione con **reverse proxy** (Strada A) è trattata in coda come **opzione secondaria**. Per la configurazione pratica del blocco `https` vedi la guida.

## Perché è fatto così

La guida [`https.it.md`](./https.it.md) risponde a *"come configuro HTTPS?"*. Questo EXPLAIN risponde a *"perché funziona così e cosa succede davvero sotto il cofano?"*.

Lo scenario che privilegiamo è quello in cui **ital8cms è il web server ufficiale del sito**: ascolta direttamente su 80 e 443, presenta lui stesso il certificato e parla TLS col mondo, senza alcun componente davanti. È il caso d'uso più diretto ("installo ital8cms e servo il mio sito") ed è quello attorno a cui è progettato `core/httpsManager.js`. Capire come ital8cms **termina il TLS internamente** — i due server, l'hot reload, l'endpoint ACME, la gestione degli errori di bind — rende prevedibili sicurezza, rinnovo dei certificati e debugging.

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

Due punti chiave: **(a)** la chiave privata serve ad **autenticare** il server durante l'handshake (firma), non a cifrare i dati di massa (lo fanno chiavi di sessione simmetriche derivate al volo); **(b)** **SNI** permette a un singolo IP/porta di servire molti domini, scegliendo il certificato giusto in base al nome richiesto.

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

ital8cms implementa il lato server di **HTTP-01** (endpoint `/.well-known/acme-challenge/:token`): è esattamente ciò che serve nella Strada B, dove ital8cms è il webserver su :80 (vedi *Moduli interni*).

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

## Architettura — ital8cms come terminatore TLS (Strada B)

Nello scenario di riferimento ital8cms **termina il TLS in proprio**: detiene il certificato e la chiave, parla HTTPS verso Internet su :443 e gestisce il redirect e le challenge ACME su :80. Non c'è alcun componente davanti.

```
                 :443 (TLS)                          ital8cms (Node/Koa)
   Internet ───────────────────▶  ┌───────────────────────────────────────┐
   (browser)   HTTPS              │  https.Server  ← app.callback()        │  app Koa completa
                                  │     ▲  cert + chiave private in memoria │
                 :80 (HTTP) ─────▶│  http.Server (redirect 301 → 443)      │  + ACME challenge
                                  │        e /.well-known/acme-challenge/   │  servito prima del 301
                                  └───────────────────────────────────────┘
```

**Due server, una sola app.** Con `enabled: true` + `AutoRedirectHttpPortToHttpsPort: true`, `httpsManager.start()` crea:

- un **`https.Server` su :443** che monta l'**app Koa completa** — costruito come `https.createServer(tlsConfig, app.callback())`;
- un **`http.Server` su :80** *minimale* (`createHttpRedirectServer`) che serve le challenge ACME e poi fa **redirect 301** verso HTTPS.

L'uso di **`app.callback()`** (invece di `app.listen()`) è ciò che permette di montare la **stessa** istanza Koa sia su un server HTTP sia su uno HTTPS: l'app è disaccoppiata dal trasporto.

**Vantaggio nativo della terminazione diretta: il client reale è visibile.** Poiché è ital8cms stesso a chiudere la connessione TCP/TLS del browser, dentro i route handler `ctx.ip` è l'**IP reale del client**, `ctx.secure` è `true` e `ctx.protocol` è `https` — **senza** bisogno di `app.proxy` né di fidarsi di header `X-Forwarded-*`. È una differenza concreta rispetto alla Strada A (dove invece quegli header diventano necessari, vedi in coda): logging, plugin che chiavano sull'IP (es. `rateLimiter`) e costruzione di URL assoluti funzionano correttamente da subito.

## Moduli interni di `httpsManager` (come funziona davvero)

Tutto vive in `core/httpsManager.js`, esportato come `start(app, router, ital8Conf)` e chiamato da `index.js`.

### Avvio e caricamento certificati — `start()`

1. **Registra la route ACME** nel router Koa (`setupAcmeChallengeRoute`) **sempre e per prima**, così è prioritaria sul static server.
2. **Risolve i percorsi** `certFile`/`keyFile`/`caFile` (assoluti o relativi alla root del progetto).
3. **Pre-controlla l'esistenza** dei file con `fs.existsSync` *prima* di leggerli, distinguendo se manca il certificato, la chiave o entrambi → box `warnMissingCertificates` mirato.
4. **Carica i certificati** componendo `tlsConfig` con `{ ...tlsOptions, cert, key, ca }`: lo spread di `tlsOptions` è messo **prima** di cert/key/ca, così i file hanno sempre la precedenza e non possono essere sovrascritti da opzioni avanzate.
5. **Analizza il certificato** (`analyzeCert`): scadenza, soglie warning/critical, self-signed.
6. **Avvia** `https.Server` (:443) e, in base ad `AutoRedirectHttpPortToHttpsPort`, il server HTTP di redirect (:80) **oppure** un secondo `http.Server` con l'app completa.

**Due fallback distinti (entrambi non bloccanti):** se i file **mancano** → HTTP puro su `httpPort` (con la route ACME già attiva, così la **prima emissione** può comunque avvenire); se la **lettura** fallisce (permessi, file corrotto) → stesso fallback con messaggio dedicato. In entrambi i casi il sito resta su, in HTTP.

### Hot reload senza riavvio — `setupHotReload()`

Il cuore della convivenza con il rinnovo periodico. `fs.watch` osserva il `certFile` (e il `caFile` se presente); a ogni evento:

- **debounce** (`hotReload.debounceMs`, default 2000 ms) — un client come certbot scrive `fullchain.pem` e `privkey.pem` in **due operazioni separate**: il debounce evita di ricaricare a metà scrittura;
- ri-legge cert+key+ca e chiama **`httpsServer.setSecureContext(newContext)`** → il certificato viene sostituito **a caldo sul server live**: le connessioni in corso non vengono toccate, i nuovi handshake usano già il nuovo certificato. **Zero downtime, nessun riavvio.**

Si osserva il `certFile` (non la chiave) perché un rinnovo riscrive **sempre** il certificato; la chiave viene comunque riletta insieme. Gli errori dell'`FSWatcher` (file rinominato/rimosso, limite inotify) sono gestiti con un handler `'error'` → **warning non-fatale**: l'hot reload si sospende ma il server continua a servire con il certificato già in memoria (mai un crash).

> ⚠️ **Caveat inotify (importante su NixOS):** `fs.watch` segue l'inode del file. Se il rinnovo **sostituisce** il file con un *rename atomico* (comportamento tipico di lego/`security.acme`) anziché riscriverlo in place, il watch sull'inode vecchio può **smettere di emettere** dopo il primo rinnovo (il watcher logga il warning e **non riarma**). Conseguenza pratica: l'hot reload potrebbe funzionare una volta e poi tacere. La rete di sicurezza è un **restart pilotato dal rinnovo** (vedi *Regolazione & estensione → NixOS*).

### Endpoint ACME HTTP-01 — `setupAcmeChallengeRoute()` + `createHttpRedirectServer()`

Il token va servito in **entrambe** le modalità HTTP, perciò esistono due punti di servizio che leggono dalla stessa directory `{webroot}/.well-known/acme-challenge/` (`getChallengeDir`):

- una **route Koa** `/.well-known/acme-challenge/:token` (rilevante quando `AutoRedirect: false`, cioè l'app completa è anche su :80);
- un controllo **dentro il server di redirect** che, se l'URL inizia per `/.well-known/acme-challenge/`, **serve il token prima** di emettere il 301 (rilevante quando `AutoRedirect: true`).

In entrambi i casi `path.basename` neutralizza i path-traversal (token tipo `../../etc/passwd`) e la directory viene auto-creata se assente. Risultato: la challenge HTTP-01 funziona **sia** con il redirect attivo **sia** con l'app completa su :80.

### Errori di bind — `onListenError()`

Rilevante proprio perché la Strada B usa **porte privilegiate**. Su ogni server, **prima** di `listen()`, viene agganciato un handler `'error'`: senza, un fallimento di `listen()` verrebbe rilanciato da Node come **eccezione non catturata** (crash con stack grezzo). Lo smistamento per `err.code`:

- `EACCES` (porta `< 1024` senza permessi) → box `warnPrivilegedPort` (è il fallimento tipico di chi avvia su 80/443 senza la capability);
- `EADDRINUSE` (porta occupata) → box `warnPortInUse`;
- altro → `console.error` di una riga.

In tutti i casi **uscita pulita `process.exit(1)`**, mai uno stack trace. Niente fallback: senza il bind non si può servire.

## Regolazione & estensione — Strada B in produzione

### Generale (certbot e affini)

- **Emissione/rinnovo via HTTP-01 webroot servito da ital8cms:** `acmeChallenge: { enabled: true, webroot: "/var/www/acme" }`; `certbot certonly --webroot -w /var/www/acme -d example.com`. ital8cms serve i token su :80 anche in modalità redirect.
- **Rinnovo:** affidato al timer/cron di certbot; con `hotReload` attivo i nuovi file vengono ricaricati senza riavvio.
- **Ciclo di vita alla prima emissione:** al primo boot senza certificato ital8cms parte in HTTP puro **con la route ACME già attiva** → si emette il certificato → **un riavvio** porta a HTTPS+redirect+hotReload → da lì i rinnovi sono automatici.
- **Porte privilegiate (Linux non-NixOS):** `sudo setcap 'cap_net_bind_service=+ep' $(which node)` (da rieseguire dopo ogni update di Node) — oppure si passa alla Strada A.

### NixOS (focus)

La ricetta completa (modulo **`ital8cms-https.nix`**, utente/gruppo/servizio `ital8cms`) è nella guida [`https.it.md`](./https.it.md). Qui il **perché** delle scelte chiave:

- **Porte privilegiate → `AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ]`, non `setcap`.** Su NixOS il binario `node` vive in `/nix/store` (immutabile, e il path **cambia a ogni aggiornamento**): un `setcap` sullo store sarebbe sbagliato e non persistente. La capability va concessa **al processo del servizio** in modo dichiarativo nel unit systemd (riapplicata a ogni `nixos-rebuild`); `CapabilityBoundingSet` la restringe a quella sola.
- **`security.acme` = lego + systemd timer per dominio:** ottenimento e **rinnovo automatico** senza cron scritto a mano.
- **Tipo di challenge — DNS-01 consigliato in Strada B.** Con HTTP-01 webroot c'è un *chicken-and-egg*: per validare, lego ha bisogno che ital8cms sia **già in ascolto su :80**. Per i **rinnovi** è sempre vero; per la **prima emissione** su un `nixos-rebuild` pulito conviene ordinare `acme-<dominio>.service` con `after/wants = [ "ital8cms.service" ]` (se fallisce, il timer riprova). **DNS-01** (`dnsProvider`) elimina del tutto la dipendenza dalla porta 80 e supporta i wildcard → più pulito quando è ital8cms a fare da webserver.
- **Permessi per leggere `key.pem`:** `/var/lib/acme/<dominio>/key.pem` è `640` di proprietà di `acme`; impostando `security.acme.certs.<dominio>.group = "ital8cms"` il processo ital8cms può leggerlo (stesso schema che NixOS usa per nginx). Su NixOS la chiave si chiama **`key.pem`**, non `privkey.pem`.
- **Rinnovo → ricarica:** **hot reload** come percorso primario (zero downtime). Visto il *caveat inotify* sopra, come rete di sicurezza aggiungi `security.acme.certs.<dominio>.reloadServices = [ "ital8cms.service" ]`: NixOS esegue `try-reload-or-restart` e, non avendo ital8cms un `ExecReload`, fa un **restart breve** ma garantito. Trade-off consapevole: zero downtime (hot reload) vs ricarica garantita (restart).

## Sicurezza (Strada B)

Il trade-off centrale della terminazione diretta: **la chiave privata è caricata nel processo ital8cms** (letta con `fs.readFileSync` al boot e tenuta in memoria). In Strada A, invece, la chiave non è mai vista dall'app. Per la maggior parte dei siti singoli è un compromesso accettabile, ma va mitigato:

- **Processo a privilegio minimo:** utente dedicato non-root, **solo** `CAP_NET_BIND_SERVICE`, e hardening systemd (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `ReadWritePaths` ristretto alla sola root del progetto).
- **Permessi dei file:** chiave `640`, leggibile solo da `acme:ital8cms`; mai world-readable.
- **Redirect 80→443:** integrato (`AutoRedirectHttpPortToHttpsPort`), nessun contenuto servito in chiaro.
- **HSTS:** in Strada B **non c'è un proxy** che lo inietti, quindi `Strict-Transport-Security` va aggiunto da ital8cms — il modo pulito è un **middleware di plugin** (`getMiddlewareToAdd`) che setta l'header sulle risposte. Da valutare insieme a preload/`includeSubDomains`.
- **Chiavi di sessione:** ricordarsi di sostituire i placeholder in produzione (`core/sessionSecurity.js` avvisa al boot) — vedi [`deployment.it.md`](./deployment.it.md).

## Strada A (opzione secondaria) — reverse proxy

Quando **non** si vuole che ital8cms tocchi il TLS — più siti sullo stesso host, requisiti TLS avanzati, o policy che impone di tenere la chiave fuori dall'app — si mette un **reverse proxy** (nginx/Caddy) davanti: il proxy termina il TLS su :443 e inoltra **HTTP in chiaro** a ital8cms su `127.0.0.1:3000` (`https.enabled: false`).

```
   Internet ──:443 TLS──▶ reverse proxy ──:3000 HTTP (loopback)──▶ ital8cms
                          detiene cert + chiave; gestisce ACME/rinnovo
```

**Quando preferirla:** separazione netta dei ruoli (la chiave non è mai nell'app), molti domini dietro un unico proxy (SNI), funzioni di edge (caching, HTTP/2-3, OCSP stapling, WAF). **Trade-off:** un hop in più (trascurabile su loopback) e l'app deve **fidarsi degli header inoltrati** per conoscere schema e IP reali.

### Nota `app.proxy` (specifica della Strada A)

Dietro un proxy, schema reale e IP del client viaggiano in header `X-Forwarded-*`. ⚠️ **ital8cms (in `index.js`) non imposta `app.proxy = true`**: di default Koa **non** si fida di quegli header → `ctx.protocol` resta `http`, `ctx.secure` è `false`, `ctx.ip` è l'IP del proxy (`127.0.0.1`). Per farli onorare servirebbe `app.proxy = true` (idealmente con whitelist di IP fidati) — **da abilitare solo dietro un proxy fidato**, mai su un'app esposta direttamente (gli header sarebbero falsificabili). Questo problema **non esiste in Strada B**, dove il client reale è visibile nativamente.

### NixOS — modulo `ital8cms-proxy.nix`

Su NixOS la Strada A è particolarmente pulita: nginx + `security.acme` rendono ottenimento, redirect 80→443 e **rinnovo automatico (con reload di nginx)** completamente dichiarativi. Importa il modulo da `configuration.nix` (`imports = [ ./ital8cms-proxy.nix ];`):

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

Note: niente `CAP_NET_BIND_SERVICE` (solo nginx tocca 80/443); `recommendedProxySettings` imposta gli `X-Forwarded-*` (resta valida la nota su `app.proxy` lato ital8cms); con `enableACME` NixOS **ricarica nginx** a ogni rinnovo, senza `reloadServices` da scrivere a mano.

## Limitazioni & sviluppi futuri

- **`app.proxy` non impostato:** rilevante **solo** in Strada A; in Strada B il client reale è già visibile. Possibile evoluzione: esporre `app.proxy` come flag in `ital8Config.json5` (con whitelist di IP fidati), utile a chi sceglie il reverse proxy.
- **HSTS non integrato:** in Strada B va aggiunto via middleware di plugin; un eventuale toggle nativo (header di sicurezza) è una miglioria futura.
- **Hint generici nei messaggi del core:** i box di `httpsManager` suggeriscono `certbot renew` / `setcap` (Debian-centrici); gli equivalenti NixOS sono qui e nella guida. Allineamento dei messaggi: miglioria futura.
- **Configurazione via variabili d'ambiente:** vedi la nota in [`deployment.it.md`](./deployment.it.md) (porta/HTTPS da env) — utile per containerizzazione.

## Riferimenti

- Guida operativa (campi, scenari, ricette Strada B/A): [`https.it.md`](./https.it.md)
- Deploy in produzione: [`deployment.it.md`](./deployment.it.md)
- Implementazione: [`core/httpsManager.js`](../core/httpsManager.js)
- RFC 8555 (ACME), documentazione Let's Encrypt, NixOS `security.acme` / `services.nginx`
