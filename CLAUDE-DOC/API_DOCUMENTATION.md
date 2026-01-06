# Documentazione API - ital8cms

## Panoramica

Tutte le API di ital8cms seguono il pattern:
```
/{apiPrefix}/{pluginName}/{path}
```

Con la configurazione di default:
```
/api/{pluginName}/{path}
```

## Autenticazione

Le API protette richiedono una sessione autenticata. Il cookie di sessione viene impostato dopo il login tramite `/api/adminUsers/login`.

### Header Cookie
```
Cookie: koa:sess=xxx; koa:sess.sig=xxx
```

---

## Plugin: adminUsers

Plugin per autenticazione e gestione utenti.

### Autenticazione

#### GET /api/adminUsers/login

Mostra la pagina di login.

**Parametri Query:**
- `error` (opzionale): Mostra errore se `invalid`
- `referrerTo` (opzionale): URL di redirect dopo login

**Response:** HTML (pagina login)

---

#### POST /api/adminUsers/login

Effettua il login dell'utente.

**Body (form-urlencoded):**
```
username=string
password=string
referrerTo=string (URL per redirect)
```

**Response:**
- Successo: Redirect a `referrerTo` o `defaultLoginRedirectURL`
- Fallimento: Redirect a login con `?error=invalid`

**Effetti Collaterali:**
- Imposta `ctx.session.authenticated = true`
- Imposta `ctx.session.user = { name: username }`

---

#### GET /api/adminUsers/logout

Mostra la pagina di logout.

**Response:** HTML (pagina logout)

---

#### POST /api/adminUsers/logout

Effettua il logout dell'utente.

**Body (form-urlencoded):**
```
referrerTo=string (URL per redirect)
```

**Response:** Redirect a `referrerTo`

**Effetti Collaterali:**
- Imposta `ctx.session = null`

---

#### GET /api/adminUsers/logged

Verifica se l'utente è loggato.

**Response:** `text/plain`
```
NON sei loggato : { sessione }
// oppure
complimenti sei loggato { user } sessione: { sessione }
```

---

### Gestione Utenti

#### GET /api/adminUsers/userList

Ottiene la lista di tutti gli utenti.

**Autenticazione:** Richiesta (da proteggere)

**Response:** `application/json`
```json
[
  {
    "username": "admin",
    "roleId": 0
  },
  {
    "username": "editor",
    "roleId": 2
  }
]
```

**Errori:**
- `500`: Unable to retrieve users list

---

#### GET /api/adminUsers/userInfo

Ottiene informazioni dettagliate su un utente.

**Parametri Query:**
- `username` (required): Nome utente

**Autenticazione:** Richiesta (da proteggere)

**Response:** `application/json`
```json
{
  "email": "user@example.com",
  "roleId": 1
}
```

**Note:** Il campo `hashPassword` viene rimosso per sicurezza.

**Errori:**
- `500`: Unable to retrieve users Info

---

#### GET /api/adminUsers/roleList

Ottiene la lista di tutti i ruoli disponibili.

**Autenticazione:** Richiesta (da proteggere)

**Response:** `application/json`
```json
{
  "roles": [
    {
      "id": 0,
      "name": "root",
      "description": "Full authorization"
    },
    {
      "id": 1,
      "name": "admin",
      "description": "Full access to all resources"
    }
  ]
}
```

**Errori:**
- `500`: Unable to retrieve roles list

---

#### POST /api/adminUsers/usertUser

Crea o aggiorna un utente (upsert).

**Autenticazione:** Richiesta (da proteggere)

**Body (JSON):**
```json
{
  "username": "string",
  "email": "string",
  "password": "string",
  "roleId": 0,
  "isNewUser": true
}
```

**Response:** `application/json`
```json
{
  "success": true,
  "message": "User created/updated successfully"
}
// oppure
{
  "success": false,
  "error": "Error message"
}
```

---

## Plugin: bootstrap

Plugin per servire i file Bootstrap CSS/JS.

### Assets CSS

#### GET /api/bootstrap/css/bootstrap.min.css

Serve il file CSS minificato di Bootstrap.

**Response:** `text/css`

---

#### GET /api/bootstrap/css/bootstrap.min.css.map

Serve la source map del CSS Bootstrap.

**Response:** `text/css`

---

### Assets JavaScript

#### GET /api/bootstrap/js/bootstrap.min.js

Serve il file JavaScript minificato di Bootstrap.

**Response:** `text/javascript`

---

#### GET /api/bootstrap/js/bootstrap.min.js.map

Serve la source map del JS Bootstrap.

**Response:** `text/javascript`

---

## Plugin: admin

Plugin per l'interfaccia di amministrazione.

### Pagine Admin

Le pagine admin sono servite come file statici EJS da:
```
/admin/{path}
```

Pagine disponibili:
- `/admin/` - Dashboard principale
- `/admin/userManagment/` - Gestione utenti

---

## Plugin: dbApi

Plugin per accesso al database SQLite.

### Oggetti Condivisi

Questo plugin non espone route API dirette, ma condivide oggetti con altri plugin tramite `getObjectToShareToOthersPlugin()`:

```javascript
{
  db: Database,        // Istanza better-sqlite3
  mainDb: Database,    // Database principale
  webDb: Database      // Database per template web
}
```

---

## Codici di Errore

| Codice | Descrizione |
|--------|-------------|
| 200 | OK - Richiesta completata con successo |
| 301/302 | Redirect - Reindirizzamento |
| 400 | Bad Request - Parametri mancanti o non validi |
| 401 | Unauthorized - Autenticazione richiesta |
| 403 | Forbidden - Accesso negato |
| 404 | Not Found - Risorsa non trovata |
| 500 | Internal Server Error - Errore del server |

---

## Esempi di Utilizzo

### Login con cURL

```bash
# Login
curl -X POST http://localhost:3000/api/adminUsers/login \
  -d "username=admin&password=secret&referrerTo=/" \
  -c cookies.txt

# Richiesta autenticata
curl http://localhost:3000/api/adminUsers/userList \
  -b cookies.txt
```

### Fetch API (Browser)

```javascript
// Login
const response = await fetch('/api/adminUsers/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'username=admin&password=secret&referrerTo=/',
  credentials: 'include'
});

// Ottieni lista utenti
const users = await fetch('/api/adminUsers/userList', {
  credentials: 'include'
}).then(r => r.json());
```

### Axios

```javascript
// Login
await axios.post('/api/adminUsers/login', {
  username: 'admin',
  password: 'secret',
  referrerTo: '/'
});

// Ottieni info utente
const { data } = await axios.get('/api/adminUsers/userInfo', {
  params: { username: 'admin' }
});
```

---

## Ruoli Utente

| ID | Nome | Permessi |
|----|------|----------|
| 0 | root | Tutti i permessi |
| 1 | admin | Accesso completo alle risorse |
| 2 | editor | Create, Read, Update (no Delete) |
| 3 | viewer | Solo lettura |

---

## Sicurezza

### Best Practices

1. **Proteggere endpoint sensibili** - Aggiungere controlli di autenticazione
2. **Validare input** - Verificare tutti i parametri
3. **Usare HTTPS** - In produzione abilitare SSL
4. **Cambiare chiavi sessione** - Modificare in `koaSession.json5`

### Middleware di Protezione

Attualmente protetti i prefissi:
- `/reserved`
- `/private`
- `/lib`

**Nota**: Gli endpoint `/userList`, `/userInfo`, `/roleList`, `/usertUser` dovrebbero essere protetti con middleware di autenticazione.

---

## Aggiungere Nuove API

### Esempio Plugin

```javascript
// plugins/myPlugin/main.js
function getRouteArray() {
  return [
    {
      method: 'GET',
      path: '/hello',
      handler: async (ctx) => {
        ctx.body = { message: 'Hello World' };
        ctx.type = 'json';
      }
    },
    {
      method: 'POST',
      path: '/data',
      handler: async (ctx) => {
        const { name } = ctx.request.body;

        // Verifica autenticazione
        if (!ctx.session.authenticated) {
          ctx.status = 401;
          ctx.body = { error: 'Unauthorized' };
          return;
        }

        // Elaborazione
        ctx.body = { success: true, name };
        ctx.type = 'json';
      }
    }
  ];
}
```

L'endpoint sarà disponibile a:
- `GET /api/myPlugin/hello`
- `POST /api/myPlugin/data`

---

## Versioning

Attualmente ital8cms non implementa versioning delle API. Per future versioni considerare:

```
/api/v1/adminUsers/login
/api/v2/adminUsers/login
```

---

**Versione Documentazione:** 1.0.0
**Data:** 2025-11-19
**Compatibile con:** ital8cms 0.0.1-alpha.0
