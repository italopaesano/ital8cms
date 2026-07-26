<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 2 · ref -->
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
npm run cli -- reset <target>      # reset config di un plugin/tema ai default
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
| `status` | Mostra pid, uptime, porte HTTP/HTTPS, stato admin, stato public, supervisor rilevato | No |
| `admin start` / `admin stop` | Scrive `enableAdmin` in `ital8Config.json5` (l'admin system si aggancia al boot) | **Sì** |
| `public start` / `public stop` | Alza/abbassa il gate di manutenzione del sito pubblico (a runtime) | No |
| `reset <target>` | Rimuove i config vivi di un plugin/tema (rigenerati dai `.default` al boot) | Solo con `--online` |

L'area **admin** richiede un riavvio perché la sua inizializzazione (symlink,
service discovery, rotte) avviene **al boot**: cambiare `enableAdmin` a caldo non
avrebbe effetto. Il gate **public**, invece, è un middleware già attivo che
commuta stato a runtime, quindi è **istantaneo e senza riavvio**.

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
| `/api/adminUsers/logged` | `503` — **le API sono bloccate** |
| `/pluginPages/adminUsers/login.ejs` | `503` — **la pagina di login è bloccata** |

> 🚨 **Attenzione: durante `public stop` non puoi effettuare il login.** L'area
> admin è esente dal gate, ma la **pagina di login** vive sotto `/pluginPages/…`
> e l'**endpoint di autenticazione** sotto `/api/adminUsers/login`: entrambi sono
> percorsi pubblici e rispondono `503`. Conseguenza pratica: **una sessione già
> autenticata continua a lavorare** nel pannello, mentre chi è **sloggato resta
> fuori** finché non riporti il sito online.
>
> Regole operative: **autenticati prima** di lanciare `public stop`; se ti trovi
> chiuso fuori, la via d'uscita è dal terminale — `npm run cli -- public start`
> (nessun riavvio, effetto immediato).

Lo stato public è **persistito** in un file di stato interno del cliBridge
(`core/cliBridge/state.json5`, scritto dal sistema — non modificarlo a mano) e
sopravvive ai riavvii.

Config in `ital8Config.json5`:

```json5
"maintenance": {
  "pagePath": "./core/maintenancePage.ejs",  // pagina servita durante lo stop
  "retryAfterSeconds": 600,                   // header Retry-After (secondi)
}
```

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
| Durante la manutenzione non riesci a fare login (`503`) | `public stop` blocca `/api/*` e `/pluginPages/*`, dove vivono login e pagina di login | `npm run cli -- public start`; in futuro autenticati **prima** di fermare il pubblico |
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
