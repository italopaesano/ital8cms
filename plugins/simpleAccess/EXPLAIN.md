# in questo file devi spiegare le funzionalita del plufin come usarlo ed i dettagli di funzionamento


questo plugin cerca di realizare un semplice modulo di autenticazione 
essendo la sua filosofia minimale non implemento neanche un database ma i dati dei clienti saranno immagzinati in un file .json

# i dati degli utenti vengono immagazinatinel file:
## usersAccounts.json
// struttura di esempio del file
```js
{
    "users": {
        "oxtor": {
        "email": "italopaesano@gmail.com",
        "hashPassword": "$2b$10$pkmDu0mjqASXk14REJGLl.rpJzSNzKLtUNEfI2N2wlppFtK6vA1Lu"
        },
        "utente2": {
        "email": "utente2@example.com",
        "hashPassword": "hash_della_password"
        },
        "utente3": {
        "email": "utente2@example.com",
        "hashPassword": "hash_della_password"
        }
    }    
}

```

# ecco inceve il file di configrazione nello specifico 
## config-plugin.json
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
    "loginReservedPrefix": ["/reserved", "/private", "/lib"],// prfix nei quali sarà automaticamente richiesta di essere logati 
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
    }
  }
}

```


