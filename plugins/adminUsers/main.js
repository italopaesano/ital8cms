


const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

const libAccess = require('./lib/libAccess');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi} 

const userManagement = require('./userManagement');// necessario per gestire gli utenti
const roleManagement = require('./roleManagement');// necessario per gestire i ruoli custom

let myPluginSys = null;// riferimento al sistema dei plugin per accedere a themeSys

function loadPlugin(pluginSys, pathPluginFolder){
  //console.log( 'sharedObject: ', sharedObject );
  myPluginSys = pluginSys;// memorizzo il riferimento per usarlo nelle route handlers
};

function installPlugin(){

};

function unistallPlugin(){

};

function upgradePlugin(){

};

function getMiddlewareToAdd( app ){// qui saranno elencati i Middleware che poi verranno aggiunti all'instanza di koa.js, app è l'istanza : const app = new koa();

  //const koaSession = require('koa-session').default || require('koa-session');;// dipendenza di questo plugin

  const middlewareArray = Array();

  middlewareArray.push( // ritorna un array di midlware

    async (ctx, next) => {// questo midlware permette laccessp a determinati prefix solo a gli utenti loggati
      if (pluginConfig.custom.loggedReservedPrefix.some(prefix => ctx.path.startsWith(prefix))) {
        if (!ctx.session || !ctx.session.authenticated) {
          ctx.status = 401;
          ctx.body = { message: 'Accesso negato. Effettua il login per accedere a questa risorsa.' };
          return; // Interrompi l'esecuzione del middleware
        }
      }
      await next();
 
    }
  );

  return middlewareArray;
}

function getObjectToShareToWebPages(){// restituisce un ogetto che sarà condiviso con i modori di template come sotto ogetto fi PassData.plugin.['nomePlugin']

  return {};
}

function getObjectToShareToOthersPlugin( pluginName ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

  return {};
}

function setSharedObject( pluginName, object ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

  sharedObject[pluginName] = object;// creo un ogetto con otributi con ilnome del plugin

}

function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
  
  const routeArray = Array();
  //ES.
  routeArray.push(
    // NOTA: La pagina GET /login è ora servita automaticamente dal Plugin Pages System
    // URL: /pluginPages/adminUsers/login.ejs
    // File sorgente: /plugins/adminUsers/webPages/login.ejs

    { // POST /login - Endpoint per autenticazione utenti (pubblico)
      method: 'POST',
      path: '/login',
      access: {
        requiresAuth: false,
        allowedRoles: [] // Pubblico, tutti possono tentare il login
      },
      handler: async (ctx) => {//
        const { username, password, referrerTo } = ctx.request.body;
        if( await libAccess.autenticate( username, password ) ){// login riuscito

          // Carica dati completi utente da userAccount.json5
          const userAccountPath = path.join(__dirname, 'userAccount.json5');
          const usersData = loadJson5(userAccountPath);
          const userData = usersData.users[username];

          ctx.session.authenticated = true;
          ctx.session.user = {
            username: username, // Nome utente
            email: userData.email, // Email
            roleIds: userData.roleIds || [] // Array di ruoli (con fallback per compatibilità)
          };
          if(pluginConfig.custom.redirectToHttpReferer){// se è impostata questa variabile la redirezione avverrà nella pagina dalla quale è partita il click per l appagina di login
            ctx.redirect(referrerTo);
          }else{// altrimenti rediriggo la pagina in un url di default definito nella configurazione
            ctx.redirect(pluginConfig.custom.defaultLoginRedirectURL);
          }
          return;

        }else{//login fallito
          //console.log('----------------login fallito --------------');
          ctx.redirect(`/${ital8Conf.pluginPagesPrefix}/${pluginName}/login.ejs?error=invalid&referrerTo=${referrerTo}`);// se il login fallissce si viene reindirizzati nella pagina di login
          return;

        }
        /* ctx.body = await ejs.renderFile( loginPage, ejsData);
        ctx.set('Content-Type', 'text/html'); */
       }
    },
    { // GET /logged - Test endpoint per verificare stato autenticazione (pubblico)
      method: 'GET',
      path: '/logged',
      access: {
        requiresAuth: false,
        allowedRoles: [] // Pubblico, utile per test
      },
      handler: async (ctx) => { 
        if (!ctx.session || !ctx.session.authenticated) {

          ctx.body = `NON sei loggato : ${ JSON.stringify( ctx.session) }`;
          ctx.type = 'text';

        }else{

          ctx.body = `complimenti sei loggato ${ctx.session.user} sessione: ${ JSON.stringify( ctx.session) }`;
          ctx.type = 'text';

        }
        //ctx.set('Content-Type', 'text/plain');
       }
    },
    // NOTA: La pagina GET /logout è ora servita automaticamente dal Plugin Pages System
    // URL: /pluginPages/adminUsers/logout.ejs
    // File sorgente: /plugins/adminUsers/webPages/logout.ejs

    { // POST /logout - Endpoint per logout (pubblico, ma tipicamente usato da utenti autenticati)
      method: 'POST',
      path: '/logout',
      access: {
        requiresAuth: false,
        allowedRoles: [] // Pubblico, chiunque può chiamare logout
      },
      handler: async (ctx) => {//
        const {referrerTo } = ctx.request.body;
        ctx.session = null;
        /* ctx.body = 'Logout effettuato con successo';
        ctx.type = 'text'; */
        ctx.redirect(referrerTo);
       }
    },
    { // GET /userList - Lista tutti gli utenti (solo admin)
      method: 'GET',
      path: '/userList',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {//
        const userFilePath = path.join(__dirname, 'userAccount.json5');
        try {
          const userAccount = loadJson5(userFilePath);
          ctx.body = Object.entries(userAccount.users).map(([username, userData]) => ({//CON QUESTE ISTRUZIONI GENERO UN ARRAY CONTENETE OGETTI CON DUE CAMPI username , roleIds
            username,
            roleIds: userData.roleIds  // Array di ruoli
          }));
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: `Unable to retrieve users list: ${error}` };
        }

        ctx.type = 'application/json'; // oppure semplicemente 'json'
       }
    },
    { // GET /userInfo - Dettagli specifico utente (solo admin)
      method: 'GET',
      path: '/userInfo',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {//
        const username = ctx.query.username; //username pasatocon la queystrng
        const userFilePath = path.join(__dirname, 'userAccount.json5');
        try {
          const userAccount = loadJson5(userFilePath);
          userAccount.users[username].hashPassword = undefined;// non voglioesporre l'hashPassword per ragioni di sicurezza
          console.log('userAccount[username]', userAccount.users[username]);
          ctx.body = userAccount.users[username];//ATTENZIONE CONSIGLIATO NON USARE JSON.stringify() , come -->  ctx.body = JSON.stringify(userAccount.users[username]); vedi articolo --> https://chatgpt.com/share/67e8e119-aa58-8012-ba93-0a69499c9186
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: `Unable to retrieve users Info: ${error}` };
        }

        ctx.type = 'application/json'; // oppure semplicemente 'json'
       }
    },
    { // GET /roleList - Lista tutti i ruoli (hardcoded + custom) (solo admin)
      method: 'GET',
      path: '/roleList',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {//
        const roleFilePath = path.join(__dirname, 'userRole.json5');
        try {
          ctx.body = loadJson5(roleFilePath);
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: 'Unable to retrieve roles list' };
        }

        ctx.type = 'application/json'; // oppure semplicemente 'json'
       }
    },
    //START CRUD USER create update delete user
    { // POST /usertUser - Crea o modifica utente (solo admin)
      method: 'POST',
      path: '/usertUser',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {//

        const { username, email, password, roleIds, isNewUser } = ctx.request.body;

        const result = await userManagement.userUsert(username, password, email, roleIds, isNewUser);
        ctx.body = result;// result contiene un oggetto con informazioni dell'errore se c'è stato un errore, altrimenti un messaggio di successo
        ctx.type = 'application/json'; // oppure semplicemente 'json'

       }
    },
    //START GESTIONE RUOLI CUSTOM
    { // GET /customRoleList - Lista ruoli custom (solo admin)
      method: 'GET',
      path: '/customRoleList',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {
        try {
          const customRoles = roleManagement.getCustomRoles();
          ctx.body = customRoles;
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: `Impossibile recuperare i ruoli custom: ${error}` };
        }
        ctx.type = 'application/json';
      }
    },
    { // GET /hardcodedRoleList - Lista ruoli hardcoded (solo admin)
      method: 'GET',
      path: '/hardcodedRoleList',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {
        try {
          const hardcodedRoles = roleManagement.getHardcodedRoles();
          ctx.body = hardcodedRoles;
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: `Impossibile recuperare i ruoli hardcoded: ${error}` };
        }
        ctx.type = 'application/json';
      }
    },
    { // POST /createCustomRole - Crea nuovo ruolo custom (solo admin)
      method: 'POST',
      path: '/createCustomRole',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {
        const { name, description } = ctx.request.body;
        const result = roleManagement.createCustomRole(name, description);
        ctx.body = result;
        ctx.type = 'application/json';
      }
    },
    { // POST /updateCustomRole - Aggiorna ruolo custom esistente (solo admin)
      method: 'POST',
      path: '/updateCustomRole',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {
        const { roleId, name, description } = ctx.request.body;
        const result = roleManagement.updateCustomRole(roleId, name, description);
        ctx.body = result;
        ctx.type = 'application/json';
      }
    },
    { // POST /deleteCustomRole - Elimina ruolo custom (solo admin)
      method: 'POST',
      path: '/deleteCustomRole',
      access: {
        requiresAuth: true,
        allowedRoles: [0, 1] // Solo root e admin
      },
      handler: async (ctx) => {
        const { roleId } = ctx.request.body;
        const result = roleManagement.deleteCustomRole(roleId);
        ctx.body = result;
        ctx.type = 'application/json';
      }
    },
    //START GESTIONE PROFILO UTENTE (modifica username e password)
    // NOTA: La pagina GET /userProfile è ora servita automaticamente dal Plugin Pages System
    // URL: /pluginPages/adminUsers/userProfile.ejs
    // File sorgente: /plugins/adminUsers/webPages/userProfile.ejs

    { // GET /getCurrentUser - Dati utente corrente (qualsiasi utente autenticato)
      method: 'GET',
      path: '/getCurrentUser',
      access: {
        requiresAuth: true,
        allowedRoles: [] // Tutti gli utenti autenticati (qualsiasi ruolo)
      },
      handler: async (ctx) => {
        // Usa username dalla sessione se loggato, altrimenti da query string per testing
        let username;
        if (ctx.session && ctx.session.authenticated && ctx.session.user) {
          username = ctx.session.user.name; // Utente loggato
        } else {
          username = ctx.query.username || 'testuser'; // Testing senza login
        }

        const userFilePath = path.join(__dirname, 'userAccount.json5');

        try {
          const userAccount = loadJson5(userFilePath);
          const userData = userAccount.users[username];

          if (!userData) {
            ctx.status = 404;
            ctx.body = { error: 'Utente non trovato' };
            return;
          }

          // Non esporre la password hashata
          ctx.body = {
            username,
            email: userData.email,
            roleIds: userData.roleIds
          };
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: `Errore nel recupero dati utente: ${error}` };
        }

        ctx.type = 'application/json';
      }
    },
    { // POST /updateUserProfile - Aggiorna profilo utente corrente (qualsiasi utente autenticato)
      method: 'POST',
      path: '/updateUserProfile',
      access: {
        requiresAuth: true,
        allowedRoles: [] // Tutti gli utenti autenticati possono modificare il proprio profilo
      },
      handler: async (ctx) => {
        // Usa username dalla sessione se loggato, altrimenti da body per testing
        let currentUsername;
        if (ctx.session && ctx.session.authenticated && ctx.session.user) {
          currentUsername = ctx.session.user.name; // Utente loggato
        } else {
          currentUsername = ctx.request.body.currentUsername; // Testing senza login
        }

        const { newUsername, newPassword, currentPassword } = ctx.request.body;

        // Verifica che la password attuale sia stata fornita
        if (!currentPassword) {
          ctx.body = {
            error: 'La password attuale è obbligatoria per confermare le modifiche.',
            errorField: 'currentPassword'
          };
          return;
        }

        // Verifica che almeno un campo sia da modificare
        if (!newUsername && !newPassword) {
          ctx.body = {
            error: 'Devi specificare almeno un campo da modificare (username o password).',
            errorField: null
          };
          return;
        }

        // Verifica la password attuale
        const isPasswordValid = await libAccess.autenticate(currentUsername, currentPassword);
        if (!isPasswordValid) {
          ctx.body = {
            error: 'Password attuale non corretta.',
            errorField: 'currentPassword'
          };
          return;
        }

        const userFilePath = path.join(__dirname, 'userAccount.json5');

        try {
          const userAccount = loadJson5(userFilePath);

          // Verifica che l'utente esista
          if (!userAccount.users[currentUsername]) {
            ctx.status = 404;
            ctx.body = { error: 'Utente non trovato' };
            return;
          }

          let successMessages = [];

          // Modifica username se fornito
          if (newUsername && newUsername !== currentUsername) {
            // Validazione username
            if (newUsername.length < 3) {
              ctx.body = {
                error: 'Il nuovo username deve contenere almeno 3 caratteri.',
                errorField: 'newUsername'
              };
              return;
            }

            if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
              ctx.body = {
                error: 'Il nuovo username può contenere solo lettere, numeri, underscore e trattini.',
                errorField: 'newUsername'
              };
              return;
            }

            // Verifica che il nuovo username non esista già
            if (userAccount.users[newUsername]) {
              ctx.body = {
                error: 'Il nuovo username è già in uso. Scegline un altro.',
                errorField: 'newUsername'
              };
              return;
            }

            // Rinomina l'utente (copia i dati con nuova chiave, elimina vecchia chiave)
            userAccount.users[newUsername] = { ...userAccount.users[currentUsername] };
            delete userAccount.users[currentUsername];

            successMessages.push('Username modificato con successo');
          }

          // Modifica password se fornita
          if (newPassword) {
            // Validazione password
            if (newPassword.length < 6) {
              ctx.body = {
                error: 'La nuova password deve contenere almeno 6 caratteri.',
                errorField: 'newPassword'
              };
              return;
            }

            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            const targetUsername = newUsername || currentUsername;
            userAccount.users[targetUsername].hashPassword = hashedPassword;

            successMessages.push('Password modificata con successo');
          }

          // Salva le modifiche
          fs.writeFileSync(userFilePath, JSON.stringify(userAccount, null, 2), 'utf8');

          // Se l'utente è loggato e ha cambiato username, aggiorna la sessione
          if (ctx.session && ctx.session.authenticated && newUsername && newUsername !== currentUsername) {
            ctx.session.user.name = newUsername;
          }

          ctx.body = {
            success: successMessages.join('. ') + '.'
          };

        } catch (error) {
          console.error('Errore aggiornamento profilo:', error);
          ctx.status = 500;
          ctx.body = { error: `Errore interno del server: ${error.message}` };
        }

        ctx.type = 'application/json';
      }
    }
  );

  return routeArray;
}

/* 
  restituira una mappa che comechiave avrà la parte della pagina dove eseguire le funzione e come valore la funzione da eseguire 
  la funzione da eseguire avrà come paramentro passData che è l'aogetto contenente tutto ciò che verrà passato alla pagine
 */

function getHooksPage(){



  const HookMap = new Map();

  if(pluginConfig.custom.useLoginStatusBox){ // visualizzo lo LoginStatusBox solo se la corrispettiva variabile è settata nelle impostazioni
    HookMap.set( 'header', (passData) => {
      let message;

      if(passData.ctx.session.user){
        message = `ciao ${passData.ctx.session.user.name} <br> <a href="/${ital8Conf.pluginPagesPrefix}/adminUsers/userProfile.ejs">🔐 Profilo</a> | <a href="/${ital8Conf.pluginPagesPrefix}/adminUsers/logout.ejs">Logout</a>` ;
      }else{
        message = `non sei loggato <br> <a href="/${ital8Conf.pluginPagesPrefix}/adminUsers/login.ejs">Login</a>`;
      }
      
      return `
      <style>
      #loginStatusBox {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1050;
      }
      </style>

      <!-- Riquadro stato login -->
    <div id="loginStatusBox" class="card shadow border-primary">
      <div class="card-body p-2">
        <div id="loginStatus" class="text-end">
          <!-- Contenuto dinamico qui -->
          <span class="text-muted">${ message }</span>
        </div>
      </div>
    </div>
      
        `;
      });

    }
  //fnInPageMap.set( 'body', (passData) => '<h3>ciao a tutti</h3>');
  //fnInPageMap.set('footer', (passData) => '<b>sono nel footer</b>');

  return HookMap;
  
/*   new Map(
    ['body', function(passData) {return 'ciao a tutti';}],
    ['footer', function(passData) {return 'sono nel footer';}]
    ); */
}


module.exports = {

  loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
  installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
  unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
  upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
  getObjectToShareToWebPages: getObjectToShareToWebPages,
  getObjectToShareToOthersPlugin: getObjectToShareToOthersPlugin,
  setSharedObject: setSharedObject,//setterà l'ogetto che sarà condiviso con tutti i plugin
  pluginName: pluginName,
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getHooksPage: getHooksPage,
  getMiddlewareToAdd: getMiddlewareToAdd

}