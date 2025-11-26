# in questo file devi spiegare le funzionalita del plufin come usarlo ed i dettagli di funzionamento


questo plugin cerca di realizare un semplice modulo di autenticazione 
essendo la sua filosofia minimale non implemento neanche un database ma i dati dei clienti saranno immagzinati in un file .json

# nota sul redirezione della pagina dopo il login 

Quando un utente accede alla pagina di login, l’indirizzo della pagina di origine (cioè quella da cui è arrivato) viene recuperato leggendo l’header HTTP Referer, che in Koa.js è disponibile tramite ctx.headers.referer.

Questo indirizzo viene passato nel form come parametro nascosto referrerTo, in modo da poterlo usare per la redirezione dopo un login riuscito.

Se il login ha successo, l’utente viene reindirizzato a referrerTo, tornando così automaticamente alla pagina da cui era partito.

Se invece il login fallisce, la pagina di login viene semplicemente ricaricata con un messaggio d’errore, ma conservando ancora referrerTo nella query string, così da mantenerlo anche per il tentativo successivo.

quindi se presente nei paramenti delle querystring un paramentro referrerTo viene usanto questo per sapere dove reindirizzare la pagina 
se non esiste questo paramentro nella query sting allora viene usato l'header httom refere che in koa.js viene contenuto in ctx.headers.referer.
questo per fare in modo che dopo il login si venga reindirizzati correttamente alla pagina di origin anche se vi è stato qualche tentativo di login fallito 

esempio di URL che viene ricaricato quando un login fallisce http://localhost:3003/login?error=invalid&referrerTo=http://localhost:3003/
error=invali -> mostra il messaggio di errore 
referrerTo=http://localhost:3003/ --> è l'url dove rediriggere la pagina in caso dilogin riuscito 
se l'utente insrisce correttamente i dati al primo colpo , allora l'url di redirezione sara l'header refer che si trova in ctx.headers.referer.

# i dati degli utenti vengono immagazinatinel file:
## userAccount.json
// struttura di esempio del file
```js
//ATTENZIONE PIÙ È BASSO L'ID DEL RUOLO E PIÒ PERMESSI HA UN iD = 0 --> utente Root di defoult ha accesso a tutto
{
  "users": {
      "oxtor": {
        "email": "italopaesano@gmail.com",
        "hashPassword": "$2b$10$pkmDu0mjqASXk14REJGLl.rpJzSNzKLtUNEfI2N2wlppFtK6vA1Lu",
        "roleId": 1
      },
      "utente2": {
        "email": "utente2@example.com",
        "hashPassword": "hash_della_password",
        "roleId": 2
      },
      "utente3": {
        "email": "utente2@example.com",
        "hashPassword": "hash_della_password",
        "roleId": 3
      }
    }
}

```

# mentre user Role contiene la descrizione dei ruoli utente 
```js
{
    "roles": {
        "0": {
        "name": "root",
        "description": "il root full and authorized to do anything."
        },
        "1": {
        "name": "admin",
        "description": "Has full access to all resources and actions."
        },
        "2": {
        "name": "editor",
        "description": "Can create, read, and update resources."
        },
        "3": {
        "name": "viewer",
        "description": "Can only read resources."
        }
      }
}
```

# ecco inceve il file di configrazione nello specifico 
## pluginConfig.json
```js

{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,
  "dependency": {
    "bootstrap": "^1.0.0"
  },
  "nodeModuleDependency": {
    "bcryptjs": "^3.0.2",
    "koa-session": "^7.0.2",
    "ejs": "^3.1.9"
  },
  "custom": {
    "loggedReservedPrefix": ["/reserved", "/private", "/lib"],// prfix nei quali sarà automaticamente richiesta di essere logati 
    "defaultLoginRedirectURL": "/api/simpleAccess/logged",// url di default per il redirect dopo che illogi ha avuto successo
    }
  }
}

```

#OLD
```js
//OLD QUESTO CONFIGURAZIONI ORA VENGONOGESTITE IN : prioritaryMidlware.js
"sessionKeys": "una-chiave-segreta-di-sessione-kgjgugbfbdresewayt5435654757156", //dato che serve 
    "sessionCONFIG" :{
      "key": "koa.sess",
      "maxAge": 86400000,
      "autoCommit": true, 
      "overwrite": true,
      "httpOnly": true, 
      "signed": true, 
      "rolling": false, 
      "renew": false, 
      "secure": true, 
      "sameSite": null //ATTENZIONE QUESTO VALORE   NON DEVE ESSERE null , altrimenti il programmada error  citato nella configurazione di koa-session ma meglio rimuoverlo


```


