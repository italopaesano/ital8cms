<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 2 · ref -->
> 🌐 Italian reference edition (always up to date). English `deployment.md` is a stub until release.
# Deployment — ital8cms

## Scopo

Guida al rilascio in produzione di ital8cms: checklist pre-produzione, avvio dell'applicazione, process manager e reverse proxy.

## Checklist pre-produzione

- [ ] Cambiare le chiavi di sessione in `core/priorityMiddlewares/koaSession.json5` (il wizard `npm run start-configure` le genera casuali; un warning al boot avvisa se restano i placeholder)
- [ ] Impostare una `httpPort` adeguata o abilitare HTTPS
- [ ] Rivedere e proteggere il path admin (`adminPrefix`)
- [ ] Abilitare l'autenticazione per le rotte admin
- [ ] Impostare `debugMode: 0` in produzione
- [ ] Rivedere ruoli e permessi utente
- [ ] Fare il backup dei file di database
- [ ] Configurare un logging adeguato
- [ ] Configurare il reverse proxy (nginx/Apache)
- [ ] Configurare i certificati SSL se si usa HTTPS

## Deployment in produzione

1. **Installare le dipendenze:**
```bash
npm install --production
```

2. **Avviare l'applicazione:**
```bash
node index.js
```

3. **Usare un process manager (consigliato):**
```bash
# Installa PM2
npm install -g pm2

# Avvia l'applicazione
pm2 start index.js --name ital8cms

# Riavvio automatico al reboot
pm2 startup
pm2 save
```

4. **Reverse proxy (esempio nginx):**
```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## Gestire l'istanza in produzione (control plane CLI)

A deploy avvenuto, l'istanza **in esecuzione** si pilota da terminale (tipicamente
in SSH) tramite un socket UNIX locale, senza modificare i config a mano. Guida
completa: [`cli-control-plane.it.md`](./cli-control-plane.it.md).

```bash
cd /percorso/di/ital8cms

npm run cli -- status          # pid, uptime, porte, stato admin, stato public
npm run cli -- public stop     # finestra di manutenzione: 503 + Retry-After (nessun riavvio)
npm run cli -- public start    # sito pubblico di nuovo online
npm run cli -- admin stop      # disattiva l'area admin (riscrive enableAdmin + riavvia)
npm run cli -- admin start     # la riattiva
```

Note rilevanti in produzione:

- **`public start|stop` non riavvia** il processo: è il modo corretto per una
  finestra di manutenzione breve. `admin start|stop` **riavvia**: sotto
  systemd/PM2 il processo esce e il supervisor lo rimette in piedi (il campo
  `supervisor` di `status` mostra la variabile d'ambiente rilevata, es.
  `INVOCATION_ID`).
- **Il socket è il perimetro di sicurezza:** nessuna porta di rete esposta, il
  controllo d'accesso sono i permessi del file (`cli.socketMode`, default `0660`).
  Chi può scrivere sul socket può fermare il sito pubblico.
- **Durante la manutenzione** restano raggiungibili l'area admin e — per default —
  la pagina di login e l'endpoint di autenticazione
  (`maintenance.exemptPaths`), così un amministratore sloggato può rientrare.
  Impostando `exemptPaths: []` ottieni la chiusura totale, ma allora autenticati
  **prima** di fermare il pubblico.
- **Il `--` con `npm run` va sempre messo:** senza, npm scarta i flag (`--json`,
  `--theme`, …) **senza errori**.

## Configurazione via variabili d'ambiente (sviluppo futuro)

Valutare l'uso di variabili d'ambiente:

```javascript
// Caricamento da file .env
const httpPort = process.env.HTTP_PORT || 3000
const debugMode = process.env.DEBUG_MODE === 'true' ? 1 : 0
```

## Riferimenti

- Configurazione HTTPS: vedi la sezione HTTPS in `CLAUDE.md` (futura guida `docs/https.it.md`)
- Sicurezza delle chiavi di sessione: `core/sessionSecurity.js`
- Control plane CLI (gestione dell'istanza in esecuzione, manutenzione, reset):
  [`cli-control-plane.it.md`](./cli-control-plane.it.md)
- Aggiornamento e backup da terminale: [`self-update.it.md`](./self-update.it.md)
