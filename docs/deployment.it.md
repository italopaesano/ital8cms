<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
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
