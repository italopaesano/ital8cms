<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 5 · ref -->
> 🌐 Edizione italiana di riferimento (sempre aggiornata). L'inglese `cli-control-plane.md` è uno stub fino alla release.
# Control plane CLI (`ital8cms-cli`) — ital8cms

Strumento da **terminale** per **pilotare un'istanza ital8cms già in esecuzione**
senza toccare i file a mano e, nella maggior parte dei casi, senza fermare il
server. È il canale pensato per l'uso **via SSH**: ti colleghi alla macchina,
lanci un comando e ottieni una risposta strutturata dal processo vivo.

Il client (`bin/ital8cms-cli.js`) parla con il server tramite un **socket UNIX
locale** (nessuna porta di rete esposta): il control plane è raggiungibile solo
da chi ha accesso al filesystem della macchina — di qui l'accoppiamento naturale
con SSH.

## Comandi

```bash
npm run cli -- status              # stato del server in esecuzione
npm run cli -- admin start         # ABILITA l'area di amministrazione (riavvia)
npm run cli -- admin stop          # DISABILITA l'area di amministrazione (riavvia)
npm run cli -- public start        # sito pubblico online (nessun riavvio)
npm run cli -- public stop         # sito pubblico in manutenzione (nessun riavvio)
npm run cli -- reserved start      # superficie riservata raggiungibile (nessun riavvio)
npm run cli -- reserved stop       # superficie riservata: 404 su tutto (nessun riavvio)
npm run cli -- publicOnly on       # assetto "sito vetrina" (riavvia)
npm run cli -- publicOnly off      # ritorno all'assetto normale (riavvia)
npm run cli -- reset <target>      # reset config di un plugin/tema ai default
npm run cli -- migrate <target>    # applica le migrazioni di config pendenti
```

> ⚠️ **Il `--` e i flag — la perdita è silenziosa.** Con `npm run` gli argomenti
> **posizionali** passano anche senza `--` (`npm run cli status` funziona), ma i
> **flag** (`--json`, `--theme`, `--config`, `--timeout`, …) vengono **intercettati
> da npm e scartati senza alcun errore**: il comando gira, ignorando il flag.
> Comportamento verificato con npm 10.9.7:
>
> | Comando | Argomenti che arrivano davvero al CLI |
> |---------|---------------------------------------|
> | `npm run cli status` | `["status"]` ✅ |
> | `npm run cli admin stop` | `["admin","stop"]` ✅ |
> | `npm run cli status --json` | `["status"]` ❌ — `--json` perso, output testuale |
> | `npm run cli -- status --json` | `["status","--json"]` ✅ |
> | `npm run cli reset seo --theme` | `["reset","seo"]` ❌ — **agisce su `plugins/seo` invece che su `themes/seo`** |
>
> Poiché non ricevi alcun avviso, la regola pratica è: **con `npm run` usa sempre
> `--`**. Con `node bin/ital8cms-cli.js` o col binario globale il problema non
> esiste.

## Scopo

| Comando | Cosa fa | Riavvia il processo? |
|---------|---------|----------------------|
| `status` | Mostra pid, uptime, porte HTTP/HTTPS, stato admin, stato reserved, stato public, supervisor rilevato | No |
| `admin start` / `admin stop` | Scrive `enableAdmin` in `ital8Config.json5` (l'admin system si aggancia al boot) | **Sì** |
| `reserved start` / `reserved stop` | Alza/abbassa il gate della superficie riservata (a runtime) | No |
| `public start` / `public stop` | Alza/abbassa il gate di manutenzione del sito pubblico (a runtime) | No |
| `publicOnly on` / `publicOnly off` | Macro: compone `reserved` + `admin` nell'assetto vetrina | **Sì** |
| `reset <target>` | Rimuove i config vivi di un plugin/tema (rigenerati dai `.default` al boot) | Solo con `--online` |

L'area **admin** richiede un riavvio perché la sua inizializzazione (symlink,
service discovery, rotte) avviene **al boot**: cambiare `enableAdmin` a caldo non
avrebbe effetto. I gate **public** e **reserved**, invece, sono middleware già
attivi che commutano stato a runtime, quindi sono **istantanei e senza riavvio**.

## Prerequisiti

- Il server ital8cms deve essere **in esecuzione** (il socket esiste solo mentre
  il processo è vivo). **Eccezione:** `reset` in modalità *offline* opera sul
  filesystem e funziona anche a server spento.
- Il control plane deve essere **abilitato** in `ital8Config.json5` →
  `cli.enabled: true` (default).
- Devi avere i **permessi** sul file socket (default mode `0660`): tipicamente
  significa essere l'utente che ha avviato il server o appartenere al suo gruppo.
- Devi lanciare il comando dalla **root del progetto** (dove sta
  `ital8Config.json5`), oppure passare `--config <path>` / `--socket <path>`.

## Come si invoca

Ci sono tre modi, in ordine di praticità per l'uso via SSH:

### 1. `npm run cli -- <comando>` (sempre disponibile)

Nessuna installazione extra: usa lo script `cli` di `package.json`
(`node bin/ital8cms-cli.js`).

```bash
cd /percorso/di/ital8cms
npm run cli -- status
npm run cli -- admin stop
```

### 2. `node bin/ital8cms-cli.js <comando>` (equivalente diretto)

Salta il livello npm (nessun `--` da ricordare):

```bash
node bin/ital8cms-cli.js admin start
```

### 3. `ital8cms-cli <comando>` (dopo install globale)

Il binario è dichiarato in `package.json → bin`, ma **non è disponibile come
comando globale finché non lo installi/colleghi**. Dalla root del progetto:

```bash
npm link            # crea il symlink globale ital8cms-cli → ./bin/ital8cms-cli.js
# oppure
npm install -g .

ital8cms-cli status
ital8cms-cli admin stop
```

> Senza uno di questi passaggi, `ital8cms-cli` restituisce `command not found`
> (vedi [Troubleshooting](#troubleshooting)).

## Procedura: attivare/disattivare l'area admin via SSH

```bash
ssh utente@server
cd /percorso/di/ital8cms

# 1. verifica lo stato attuale
npm run cli -- status
#   admin state:   running

# 2. disattiva l'area admin (il processo viene riavviato)
npm run cli -- admin stop
#   ✓ admin.stop richiesto (config aggiornato; processo in chiusura, … si occuperà del riavvio)
#   ⏳ in attesa del riavvio del processo...
#   ✓ server ripartito (pid: 81109)

# 3. per riattivarla
npm run cli -- admin start
```

In modalità testuale (human) il client, dopo un comando che richiede riavvio,
**attende** che il processo sparisca e ritorni (poll fino a 15s) e conferma con
il nuovo `pid`. Con `--no-wait` o `--json` il client restituisce subito la
risposta iniziale senza attendere il riavvio.

Cosa succede sotto:

1. `writeEnableAdmin` modifica **solo** il valore `enableAdmin` in
   `ital8Config.json5` (regex chirurgica, **preserva commenti** e formattazione),
   con scrittura **atomica** (temp + `rename`).
2. Se il valore è già quello richiesto → risposta `noop`, nessuna azione, nessun
   riavvio (`= admin.stop: admin già in stato stopped, nessuna azione`).
3. Altrimenti il server richiede un riavvio pulito (`requestRestart`) e riparte
   (vedi [Meccanica del riavvio](#meccanica-del-riavvio)).

### Cosa disattiva esattamente `admin stop`

Con `enableAdmin: false`, al boot **non** vengono montati:

- l'**AdminSystem** (symlink delle sezioni, service discovery, menu dinamico);
- lo static server delle **pagine admin** (`/{adminPrefix}/…`, default `/admin/`);
- lo static server delle **risorse del tema admin**
  (`/{adminThemeResourcesPrefix}/…`, default `/admin-theme-resources/`).

> ⚠️ **Non aspettarti un 404 su `/admin/`.** Per un utente **non autenticato**
> `/admin/` risponde `302` verso il login **sia con admin attivo sia con admin
> disattivato**: il middleware di controllo accessi (`adminAccessControl`) è un
> middleware di plugin e interviene **prima** dello static server admin. La
> differenza osservabile è sulle risorse non protette — ad esempio
> `/admin-theme-resources/css/theme.css` passa da `200` (admin attivo) a `404`
> (admin disattivato). Per una verifica sintetica usa `status`, che è la fonte
> autorevole (`admin state: running|stopped`).

**`admin stop` spegne il pannello, non l'autenticazione.** Restano raggiungibili
la pagina di login, l'endpoint di autenticazione e le rotte API dei plugin admin
(protette, ma presenti): il sito continua a dichiarare di avere un'area
riservata. È un comportamento voluto e utile — l'amministratore lavora via API o
rientra quando riattiva il pannello.

Se invece vuoi che di quell'area **non resti traccia**, è il caso d'uso di
[`reserved stop`](#superficie-riservata-reserved).

## La coppia `public start` / `public stop` (manutenzione)

Mette il **sito pubblico** in manutenzione senza fermare il processo:

```bash
npm run cli -- public stop     # attiva la pagina di manutenzione
npm run cli -- public start    # rimette online il sito pubblico
```

Quando `public` è `stopped`, il gate di manutenzione:

- risponde **HTTP 503** con header **`Retry-After`** (da `retryAfterSeconds`) e
  **`X-Robots-Tag: noindex`**, servendo la pagina definita da `maintenance.pagePath`
  (se il rendering fallisce, una pagina minimale di fallback);
- è montato **prima del router**, quindi intercetta **anche le rotte API dei
  plugin**, non solo le pagine;
- **lascia passare soltanto** i due prefissi admin — `/{adminPrefix}/…` e
  `/{adminThemeResourcesPrefix}/…` (di default `/admin/` e
  `/admin-theme-resources/`, più l'eventuale `globalPrefix`).

Comportamento verificato con `public stopped`:

| Percorso | Esito |
|----------|-------|
| `/` | `503` (manutenzione) |
| `/admin/` | passa il gate (poi `302` al login se non autenticato) |
| `/admin-theme-resources/css/theme.css` | `200` |
| `/api/adminUsers/logged` | `503` — le altre API restano bloccate |
| `/api/adminUsers/login` | **passa** (via `exemptPaths`, vedi sotto) |
| `/pluginPages/adminUsers/login` | **passa** (via `exemptPaths`, vedi sotto) |

Lo stato public è **persistito** in un file di stato interno del cliBridge
(`core/cliBridge/state.json5`, scritto dal sistema — non modificarlo a mano) e
sopravvive ai riavvii.

### Perché il login è esente: `maintenance.exemptPaths`

Poiché il gate è montato prima del router, senza correttivi bloccherebbe anche la
**pagina di login** (`/pluginPages/adminUsers/login`) e l'**endpoint di
autenticazione** (`/api/adminUsers/login`), che sono percorsi pubblici. Effetto
collaterale: un amministratore **sloggato** non potrebbe più entrare nel pannello
durante la manutenzione, pur essendo `/admin/*` esente.

Per questo esiste `maintenance.exemptPaths`: la lista dei percorsi **pubblici**
che restano raggiungibili a sito fermo.

```json5
"maintenance": {
  "pagePath": "./core/maintenancePage.ejs",  // pagina servita durante lo stop
  "retryAfterSeconds": 600,                   // header Retry-After (secondi)
  "exemptPaths": [
    "/pluginPages/adminUsers/login",          // pagina di login (copre anche login.ejs)
    "/api/adminUsers/login",                  // endpoint di autenticazione
  ],
}
```

Semantica:

- confronto per **prefisso** (come per i prefissi admin): `/api/adminUsers/login`
  copre anche le sue sotto-risorse, e `/pluginPages/adminUsers/login` copre sia
  `login` sia `login.ejs` (utile se attivi `hideExtension`);
- i percorsi si scrivono **senza `globalPrefix`**: lo antepone il gate;
- sono accettate solo stringhe che iniziano con `/`; le altre voci vengono
  **ignorate** (una stringa vuota esenterebbe l'intero sito);
- **chiave assente** → si usano i **default incorporati** (gli stessi due percorsi
  di login). Serve alle installazioni **aggiornate**: il merge additivo del boot
  propaga solo le chiavi *top-level* nuove, non quelle annidate come questa;
- **lista vuota `[]`** → **massima chiusura**: nessun endpoint pubblico
  raggiungibile, login incluso.

> 🔒 **Se scegli `[]`**, durante la manutenzione chi è sloggato **non può entrare**:
> `/admin/*` passa il gate ma rimanda a una pagina di login che risponde `503`. In
> quel caso autenticati **prima** di fermare il pubblico, o rientra dal terminale
> con `npm run cli -- public start` (immediato, nessun riavvio).

> ℹ️ L'esenzione riguarda **solo** il gate di manutenzione: gli altri livelli di
> sicurezza restano attivi. Un `POST` al login senza token CSRF continua a
> ricevere `403` anche a sito fermo.

> ⚠️ **Le esenzioni valgono finché la superficie riservata è aperta.** Con
> [`reserved stop`](#superficie-riservata-reserved) attivo vengono **sospese** e
> il sito risponde `503` ovunque: le esenzioni servono a far entrare un
> amministratore, e se la superficie è chiusa non entra più nessuno — resterebbe
> solo la differenza fra `404` (esenti) e `503` (tutto il resto), che equivale a
> pubblicare la mappa dell'area riservata. In quella combinazione anche il `403`
> del CSRF citato sopra diventa `404`, per la stessa ragione.

## Superficie riservata (`reserved`)

```bash
npm run cli -- reserved stop    # login, profilo, API autenticate, pannello → 404
npm run cli -- reserved start   # tutto di nuovo raggiungibile
```

In una frase: **spegne tutto ciò che sta dietro l'autenticazione**, e lo fa
sparire — non "vietato", proprio *inesistente*. Il sito pubblico continua a
funzionare per intero, form contatti compresi. È istantaneo e non riavvia nulla.

Serve quando il sito è **solo una vetrina** e non c'è ragione che un visitatore
veda una pagina di login; il caso completo è
[l'assetto `publicOnly`](#assetto-sito-vetrina-publiconly).

> ℹ️ **Da non confondere con `loggedReservedPrefix`** (in
> `plugins/adminUsers/pluginConfig.json5`): quello è un elenco di prefissi —
> `/reserved`, `/private`, … — per cui il plugin `adminUsers` **richiede il
> login**. Nomi simili, concetti opposti: `loggedReservedPrefix` decide *cosa
> protegge* l'autenticazione, `reserved stop` decide *se l'autenticazione esiste*
> agli occhi di chi visita il sito.

Le tre aree non sono tre scatole affiancate: **`admin` sta dentro `reserved`**.

```
sito pubblico                                  ← public
└── tutto ciò che sta dietro l'autenticazione  ← reserved
    └── pannello di amministrazione            ← admin
```

- `admin stop` spegne il **pannello**, lasciando raggiungibile il resto della
  superficie autenticata (login, profilo utente, eventuali aree membri).
- `reserved stop` spegne **tutta** la superficie autenticata, pannello incluso —
  anche con `enableAdmin: true`. `status` lo dichiara:
  `admin state: running  (irraggiungibile: reserved stopped)`.

### Cosa comprende, e come viene calcolato

Il perimetro **si deriva da dichiarazioni che esistono già**, non da un elenco da
mantenere a mano:

| Sorgente | Criterio | Chi lo applica |
|---|---|---|
| `getRouteArray() → access.requiresAuth: true` | rotta dietro l'autenticazione | route-wrap di `pluginSys` |
| `getRouteArray() → access.isAuthEntryPoint: true` | rotta pubblica che appartiene comunque alla superficie riservata | route-wrap di `pluginSys` |
| regola in `accessControl.json5` con `requiresAuth` o `isAuthEntryPoint` | pagina riservata (`userProfile`, `login`, `logout`, `access-denied`) | middleware di `adminAccessControl` |
| prefissi `adminPrefix` e `adminThemeResourcesPrefix` | pannello e risorse del tema admin | il gate stesso |
| indice dei path delle rotte riservate | chiude anche il **405** di `allowedMethods()`, che risponde senza passare dall'handler | il gate stesso |

> **Ogni pagina ha due regole**, una per forma di URL: con
> `hideExtension.pluginPagesPrefix` attivo l'URL servito è senza estensione
> (`/…/login`), e una regola su `login.ejs` non lo intercetterebbe.
> Sono **match esatti**, non wildcard: `login*` sembrerebbe coprire entrambe le
> forme e invece no — il wildcard singolo traduce `*` in `[^/]+`, cioè *uno o
> più* caratteri, quindi copre `login.ejs` ma **non** `login`, e in più
> cattura per sbaglio pagine vicine come `loginHelper.ejs`.
>
> L'indice delle rotte è confrontato come confronta il **router** — che gira con
> `sensitive: false` e `strict: false` — quindi `/API/…/login` e `/…/login/` sono
> chiusi come la forma canonica.
>
> Un test rilegge le pagine effettivamente presenti in
> `plugins/{adminUsers,adminAccessControl}/webPages/` e verifica che ognuna sia
> classificata, **in entrambe le forme di URL**: se aggiungi una pagina a quei
> plugin il test fallisce finché non dichiari a quale faccia del sito appartiene.

Un plugin di terze parti che ignora del tutto l'esistenza di `reserved` eredita
il comportamento corretto **gratis**: `access` è già obbligatorio su ogni rotta e
la sua assenza è errore fatale al boot.

### `isAuthEntryPoint` — l'unica dichiarazione da aggiungere

Alcune rotte sono `requiresAuth: false` **per necessità** (nessuno potrebbe
autenticarsi, altrimenti) ma appartengono comunque alla superficie riservata.
Il marcatore serve solo a queste:

```javascript
{
  method: 'POST', path: '/login',
  access: { requiresAuth: false, allowedRoles: [], isAuthEntryPoint: true },
  handler: async (ctx) => { … }
}
```

Stesso marcatore, stessa semantica, per le **pagine** (che non sono rotte) in
`accessControl.json5`:

```json5
"/pluginPages/adminUsers/login.ejs": {
  "requiresAuth": false,
  "allowedRoles": [],
  "isAuthEntryPoint": true
}
```

> Il nome dice "varco di autenticazione", ma la semantica esatta è più larga:
> **rotta o pagina pubblica che appartiene comunque alla superficie riservata**.
> Oltre a `login` sono marcati anche `logout` e `logged` (uscita e sonda di stato)
> e `/api/admin/ping`, la cui sola esistenza rivelerebbe il plugin admin. Se ti
> serve un health check raggiungibile anche in assetto vetrina, esponilo come
> rotta propria **senza** il marcatore.

### La risposta è sempre 404 — e nella forma giusta

Mai 403, mai un redirect. In assetto vetrina "chiuso" deve essere
**indistinguibile da "mai esistito"**: un 401 racconta che dietro c'è un
endpoint, un 302 verso il login racconta dove si entra. È la differenza
deliberata rispetto al 503 esplicito di `public stop`, che invece *vuole* dire
"torniamo subito".

Ma non basta lo status: deve coincidere anche la **forma** della risposta,
perché questo CMS ne ha **due** per un URL inesistente.

| Famiglia | 404 autentico |
|---|---|
| sotto `apiPrefix` (`/api/…`) | `text/plain`, corpo `Not Found` (9 byte) — nessuno static server serve `/api/*`, quindi risponde Koa |
| tutto il resto | pagina HTML di `koa-classic-server` (325 byte) con `no-store`, CSP, `nosniff`, `X-Frame-Options`, … |

Il gate produce la forma **della famiglia richiesta**. Una prima versione
rispondeva sempre `text/plain` di 9 byte: coerente fra i tre punti di
enforcement, ma diversa dal resto del sito — e quindi ogni percorso riservato
restava enumerabile dalla sola forma della risposta. Un test d'integrazione
confronta ora **byte per byte** la risposta riservata con un 404 autentico della
stessa famiglia, così una divergenza futura fallisce invece di passare in
silenzio.

### Con anche `public stop`: 503 uniforme

Con `public stop` e `reserved stop` attivi insieme il sito risponde **503
ovunque**, esenzioni comprese.

Le esenzioni del gate di manutenzione (prefissi admin + `maintenance.exemptPaths`,
che di default contiene la pagina di login) esistono per una ragione sola: far
lavorare un amministratore durante la manutenzione. Se la superficie riservata è
chiusa, quella ragione decade — non entra più nessuno — e resterebbe solo
l'effetto collaterale: i percorsi esenti risponderebbero 404 mentre tutto il
resto risponde 503, e la differenza sarebbe una mappa precisa della superficie
riservata. Perciò, a superficie chiusa, le esenzioni sono **sospese**.

### Fail-closed

Se `core/cliBridge/state.json5` **esiste ma non è leggibile**, `reserved` parte
**chiuso** (mentre `public` parte aperto). L'asimmetria è deliberata: un file
corrotto non deve mettere in manutenzione un sito sano, ma non deve nemmeno
riaprire in silenzio la superficie riservata proprio quando qualcosa è andato
storto. Un file **assente** (clone fresco) non è corruzione: tutto parte aperto.

### Via di rientro

Con la superficie chiusa la pagina di login non esiste più: **l'unica via di
rientro è il terminale** (`npm run cli -- reserved start`). È la stessa filosofia
di `maintenance.exemptPaths: []`, ed è il motivo per cui il control plane vive su
socket UNIX e si usa via SSH.

### Nei template

`passData.reservedClosed` (booleano) permette a temi e navbar di non stampare
voci verso l'area riservata, invece di produrre link che darebbero 404.

```ejs
<% if (!passData.reservedClosed) { %>
  <a href="/pluginPages/adminUsers/login.ejs">Area riservata</a>
<% } %>
```

## Assetto sito vetrina (`publicOnly`)

Macro **trasparente**: non introduce un quarto stato, compone le leve esistenti —
che restano usabili anche singolarmente.

| | Cosa fa |
|---|---|
| `publicOnly on` | `reserved stop` + `admin stop` → **riavvia** |
| `publicOnly off` | `reserved start` + `admin start` → **riavvia** |

Resta pienamente funzionante tutto ciò che è pubblico: pagine, form contatti,
`mailer`, `csrfProtection`, `rateLimiter`, i18n, SEO.

> ⚠️ **Terzo passo ancora mancante: il directory listing.** Spegnere il listing di
> `/www` fa parte del progetto dell'assetto vetrina — un listing pubblico rivela
> nomi di file, bozze e materiale non linkato — ma è **bloccato da un bug di
> `koa-classic-server` v5.1.0**: disabilitare il listing fa rispondere **404 alla
> radice del sito** anche quando un file indice è configurato ed esiste. Poiché il
> modulo è mantenuto dal team, il passo verrà aggiunto **dopo la release corretta**
> invece di essere aggirato (vedi [`TODO.md`](../TODO.md) → *Dipendenze*).

## `reset <target>` (config di plugin/temi)

Riporta i config di un plugin/tema ai default rimuovendo i file **vivi**
(`x.json5`), che il prossimo boot rigenera dai rispettivi `x.default.json5`.

```bash
npm run cli -- reset seo                 # offline (filesystem): agisce anche a server spento
npm run cli -- reset seo --dry-run       # mostra cosa verrebbe rimosso, senza toccare nulla
npm run cli -- reset default --theme     # target sotto themes/ invece di plugins/
npm run cli -- reset seo --online        # a caldo via socket: rimuove i vivi E riavvia
npm run cli -- reset adminUsers -y       # salta il prompt di conferma
```

- **Offline** (default): opera direttamente sul filesystem, funziona anche a
  server spento (utile se una config corrotta impedisce il boot). Non passa per
  il socket.
- **`--online`**: esegue il reset sul server in esecuzione e **riavvia** per
  rigenerare i default.
- I plugin **essenziali** (`essentialPlugins`) richiedono una **conferma
  rafforzata**: devi **ridigitare il nome esatto** del plugin (`--yes` la salta).
- Se il reset tocca file di **dati utente** (es. account e ruoli) compare un
  **avviso esplicito** con l'elenco dei file e il rischio di lockout, seguito
  dalla normale conferma `[y/N]`.
- `--dry-run` elenca i file che verrebbero rimossi senza toccare nulla; se non
  c'è nulla da resettare la risposta è un `noop` con uscita `0`.
- Se sbagli contenitore il CLI te lo dice invece di fallire genericamente:
  `"defaultAdminTheme" non è in plugins/, ma esiste in themes/ — aggiungi --theme`.

> Approfondimento sul ciclo di vita dei config e sulla relazione default↔vivo:
> [`decisions/config-lifecycle.it.md`](./decisions/config-lifecycle.it.md).

## `migrate <target>` (migrazioni di configurazione)

Applica le migrazioni che un plugin/tema dichiara nella sua cartella `migrations/`
per portare i config vivi da una `schemaVersion` alla successiva. Come `reset`,
opera **offline** sui file: non passa dal socket e funziona a server spento.

```bash
npm run cli -- migrate seo                    # plugin
npm run cli -- migrate mySite --theme         # tema
npm run cli -- migrate ital8Config            # config del core
npm run cli -- migrate seo --dry-run          # mostra gli step senza toccare nulla
npm run cli -- migrate seo --confirm-manual   # sblocca uno step manuale già eseguito a mano
```

Il comando **elenca sempre** gli step pendenti prima di chiedere conferma, con
motivo e file toccati, così la decisione è informata:

```
Migrazioni pendenti per plugins/seo: v1 → v2
  [auto]   from-v1-to-v2 — custom.vecchioNome rinominata in custom.nuovoNome
            motivo: Rinomina meccanica a valore invariato: il valore dell'utente viene trasportato.
            tocca: pluginConfig.json5
```

- **Backup automatico** dei file dichiarati in `touches`, prima di ogni step
  (`pluginConfig.json5.backup-v1-<timestamp>`).
- **Uno step alla volta:** la `schemaVersion` avanza solo a esito riuscito. Se uno
  step fallisce la catena si ferma lì, la versione **non** avanza e il comando
  esce con `1`: correggi e rilancia.
- **Step manuali:** la catena si ferma e il CLI ti indica il `.md` da seguire.
  Dopo averlo fatto rilancia `migrate`: se lo step espone una `verify()` la
  verifica sblocca la catena da sola, altrimenti aggiungi `--confirm-manual`.
- **Quando non c'è nulla da fare** la risposta è un `noop` con uscita `0` — anche
  quando il pacchetto non ha affatto una cartella `migrations/` (in quel caso è il
  merge additivo del boot a coprire le sole aggiunte di chiavi).

Il **boot non applica nulla di sua iniziativa**: si limita a elencare le migrazioni
pendenti nel box `[MIGRATE]`. Per farle applicare automaticamente al boot — solo
quelle dichiarate `automatic` — imposta `migrations.autoApply: true` in
`ital8Config.json5`; il default è `false` perché gli step possono eseguire script
forniti dal pacchetto.

> Standard completo (struttura della cartella, formato di `migrations.json5`,
> contratto degli script): [`decisions/config-migrations.it.md`](./decisions/config-migrations.it.md).

## Opzioni globali

Valide per tutti i comandi (ricorda il `--` con `npm run`):

| Opzione | Descrizione |
|---------|-------------|
| `--json` | Output JSON grezzo invece del testo leggibile (ideale per script) |
| `--config <path>` | Percorso di `ital8Config.json5` (default: `./ital8Config.json5`) |
| `--socket <path>` | Percorso del socket UNIX (ha priorità sul config) |
| `--timeout <ms>` | Timeout di connessione/lettura in ms (default: 2000) |
| `--no-wait` | Non attende il ritorno del server dopo un riavvio |

## Configurazione del control plane

In `ital8Config.json5`, sezione `cli`:

```json5
"cli": {
  "enabled": true,               // false → nessun socket creato, control plane disattivato
  "socketPath": "./ital8cms.sock", // relativo alla root del progetto, o assoluto
  "socketMode": "0660",          // permessi del file socket (ottale)
}
```

- **`enabled`** — se `false`, il server parte **senza** canale CLI (log:
  `[cliBridge] disabilitato in config`).
- **`socketPath`** — chi si connette (client) e chi ascolta (server) devono
  risolvere lo **stesso** path. Se lo cambi, ricordati `--socket` lato client (o
  lancia il client dalla stessa root, così legge lo stesso config).
- **`socketMode`** — i permessi del socket **sono** il controllo d'accesso: solo
  chi può leggere/scrivere il file può inviare comandi. Non allargarli senza
  motivo. Il file creato è un socket con quei permessi (`srw-rw---- … ital8cms.sock`
  con il default `0660`).

Il file socket è **effimero**: creato all'avvio, rimosso allo shutdown ordinato.
Se resta orfano dopo un crash, al boot successivo il server lo **sonda**: se
nessuno risponde lo considera *stale* e lo **rimuove da sé**; se invece risponde
(altra istanza viva sullo stesso path) rifiuta il bind con `EADDRINUSE` e prosegue
**senza** canale CLI, stampando un box di avviso. Il socket è git-ignored (`*.sock`).

## Meccanica del riavvio

I comandi che modificano lo stato di boot (`admin start|stop`, `reset --online`)
richiedono un riavvio pulito del processo. Il cliBridge sceglie la modalità in
base all'ambiente (`detectSupervisor`):

- **Sotto supervisor** — se rileva una delle variabili d'ambiente `PM2_HOME`
  (PM2), `INVOCATION_ID` (systemd) o `SUPERVISORD_ENABLED` (supervisord): il
  processo **si chiude** e lascia che sia il supervisor a **riavviarlo**. È il
  caso di una tipica installazione di produzione (systemd/PM2).
- **Self-respawn** — se nessun supervisor è rilevato: il processo **genera un
  figlio distaccato** (che riparte) e poi esce. Utile in sviluppo o avvii manuali.

In entrambi i casi il client, in modalità human, attende e conferma il nuovo
`pid`. Se il server non torna entro 15s, avvisa di controllare lo `status`.

> ℹ️ **Come leggere il campo `supervisor`.** `status` riporta il **nome della
> variabile d'ambiente** che ha fatto scattare il rilevamento, non un nome
> "commerciale": sotto systemd vedrai `supervisor: INVOCATION_ID`, sotto PM2
> `PM2_HOME`. Se nessun supervisor è rilevato la riga **non compare** e il
> riavvio avviene in self-respawn. Esempi reali:
>
> ```
> supervisor:    INVOCATION_ID          → systemd riavvierà il processo
> (riga assente)                         → self-respawn
> ```
>
> Attenzione: il rilevamento è **euristico** (presenza della variabile). Se lanci
> il server a mano dentro una shell che eredita `INVOCATION_ID` da systemd,
> ital8cms crederà di essere supervisionato e **uscirà senza riavviarsi**: in quel
> caso dovrai riavviarlo tu.

## Sicurezza

- **Nessuna esposizione di rete:** il control plane è un **socket UNIX locale**,
  non una porta TCP. Non è raggiungibile dall'esterno; l'accesso passa per SSH +
  permessi del filesystem.
- **Controllo d'accesso = permessi del socket** (`socketMode`, default `0660`):
  trattali come una credenziale. Chi può scrivere sul socket può
  attivare/disattivare l'admin e mettere il sito in manutenzione.
- **Scritture atomiche** su `ital8Config.json5` (temp + `rename`), con
  preservazione di commenti e formattazione.
- **Protezione degli argomenti:** il target di `reset` è validato
  (`^[A-Za-z0-9_-]+$`, niente path traversal); il server limita la dimensione
  della richiesta (64 KiB) e applica un timeout per connessione (5s).

## Troubleshooting

Scenari reali (ricalcano gli errori più comuni al primo utilizzo):

| Sintomo | Causa | Soluzione |
|---------|-------|-----------|
| `ital8cms-cli: command not found` | Il binario non è installato globalmente | Usa `npm run cli -- <cmd>` **oppure** `npm link` / `npm install -g .` una volta |
| `npm error Missing script: "ital8cms-cli"` | Lo script npm si chiama `cli`, non `ital8cms-cli` | `npm run cli -- <cmd>` |
| `error: unknown command 'stop'` | `stop` non è un comando top-level | È un **sottocomando**: `admin stop` o `public stop` |
| Un flag (`--json`, `--theme`, `--timeout`) sembra non avere effetto, **senza errori** | Manca il `--`: npm ha intercettato il flag e lo ha scartato in silenzio | Anteponi `--`: `npm run cli -- <cmd> --json` |
| Il comando ha agito sul plugin invece che sul tema | `npm run cli reset X --theme` → npm ha mangiato `--theme` | `npm run cli -- reset X --theme` |
| Durante la manutenzione il login risponde `503` | `maintenance.exemptPaths` è impostata a `[]` (massima chiusura) o contiene percorsi errati | Riporta i percorsi di login in `exemptPaths`, oppure rientra da terminale con `npm run cli -- public start` |
| `ital8cms non sembra in esecuzione (socket non trovato)` | Server spento o `socketPath` diverso | Avvia il server, o passa `--socket`/`--config`; per il solo `reset` usa la modalità offline |
| `socket presente ma il server non risponde` | Possibile crash dell'istanza (socket orfano) | Controlla i log del server; riavvialo |
| `permessi insufficienti sul socket` | `socketMode`/owner non consentono l'accesso al tuo utente | Esegui come l'utente del server, o allinea gruppo/permessi |
| `nessuna risposta entro Nms` | Timeout troppo basso o server sotto carico | Aumenta `--timeout <ms>` |

**Codici di uscita:** `0` = successo · `1` = errore di trasporto/client (socket
assente, timeout, uso errato) · `2` = il server ha risposto con esito negativo.

## Riferimenti

- Sorgenti: `bin/ital8cms-cli.js` (client), `core/cliBridge/` (server, handler,
  respawn, socket, state, config editor).
- Configurazione: `ital8Config.json5` → sezioni `cli` e `maintenance`.
- Ciclo di vita dei config e reset: [`decisions/config-lifecycle.it.md`](./decisions/config-lifecycle.it.md).
- Aggiornamento/backup da terminale (strumenti gemelli, fuori dal processo):
  [`self-update.it.md`](./self-update.it.md).
