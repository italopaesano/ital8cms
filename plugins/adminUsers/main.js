


const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

const ejs = require("ejs"); // serve per aggiungere il supporto ejs , che fral'altro serve a caricare bootstrap

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

const libAccess = require('./lib/libAccess');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi} 

const userManagement = require('./userManagement');// necessario per gestire gli utenti
const roleManagement = require('./roleManagement');// necessario per gestire i ruoli custom

let myPluginSys = null;// riferimento al sistema dei plugin per accedere a themeSys

const ejsData = {// i dati che verranno passati a èjs
  apiPrefix: 
  `<span id="apiPrefix" style="display: none;">${ital8Conf.apiPrefix}</span><!-- questa parte di codice serve ad impostare la variabile apiPrefix -->
  <script>
      const apiPrefix = document.getElementById('apiPrefix').innerText;
  </script>`,
  bootstrapCss: 
  `<link rel='stylesheet' href='/${ital8Conf.apiPrefix}/bootstrap/css/bootstrap.min.css' type='text/css'  media='all' />\n
  <link rel='stylesheet' href='/${ital8Conf.apiPrefix}/bootstrap/css/bootstrap.min.css.map' type='text/css'  media='all' />`,

  bootstrapJs: 
  `<script src="/${ital8Conf.apiPrefix}/bootstrap/js/bootstrap.min.js" type="text/javascript" ></script>\n
  <script src="/${ital8Conf.apiPrefix}/bootstrap/js/bootstrap.min.js.map" type="text/javascript" ></script>
  `
}

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
    {
      method: 'GET',
      path: '/login', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => {

          // Path di default del template
          const defaultLoginPage = path.join( __dirname , 'webPages', 'login.ejs' );

          // Controllo se esiste un template personalizzato nel tema
          let loginPage = defaultLoginPage;
          let customCss = '';

          if (myPluginSys) {
            const themeSys = myPluginSys.getThemeSys();
            if (themeSys) {
              // Risolvi il path del template (usa quello custom se esiste)
              loginPage = themeSys.resolvePluginTemplatePath(
                'simpleAccess',
                'login',
                defaultLoginPage,
                'template.ejs'
              );

              // Carica CSS personalizzato se esiste
              customCss = themeSys.getPluginCustomCss('simpleAccess', 'login');
            }
          }

          ejsData.referrerTo = ctx.headers.referer || '/'; //aggiungo hai dati passati referrerTo che serve a sapere dove poter reindirizzare la pagina dopo il login
          ejsData.customCss = customCss; // CSS personalizzato del tema

          ctx.body = await ejs.renderFile( loginPage, ejsData);
          ctx.set('Content-Type', 'text/html');
          return;

       }
    },
    { //questo end point POST verrà chemato dal suo corrispondente GET per implementare il login se le credenziali sono corrette
      method: 'POST',
      path: '/login', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => {//
        const { username, password, referrerTo } = ctx.request.body;
        if( await libAccess.autenticate( username, password ) ){// login riuscito 

          ctx.session.authenticated = true;
          ctx.session.user = { name: username };// inizializzo una sessione
          if(pluginConfig.custom.redirectToHttpReferer){// se è impostata questa variabile la redirezione avverrà nella pagina dalla quale è partita il click per l appagina di login
            ctx.redirect(referrerTo);
          }else{// altrimenti rediriggo la pagina in un url di default definito nella configurazione
            ctx.redirect(pluginConfig.custom.defaultLoginRedirectURL);
          }
          return;

        }else{//login fallito
          //console.log('----------------login fallito --------------');
          ctx.redirect(`/${ital8Conf.apiPrefix}/${pluginName}/login?error=invalid&referrerTo=${referrerTo}`);// se il login fallissce si viene reindirizzati nella pagina di login
          return;

        }
        /* ctx.body = await ejs.renderFile( loginPage, ejsData);
        ctx.set('Content-Type', 'text/html'); */
       }
    },
    {
      method: 'GET',
      path: '/logged', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
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
    {
      method: 'GET',
      path: '/logout', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => {
        // Path di default del template
        const defaultLogoutPage = path.join( __dirname , 'webPages', 'logout.ejs' );

        // Controllo se esiste un template personalizzato nel tema
        let logoutPage = defaultLogoutPage;
        let customCss = '';

        if (myPluginSys) {
          const themeSys = myPluginSys.getThemeSys();
          if (themeSys) {
            logoutPage = themeSys.resolvePluginTemplatePath(
              'simpleAccess',
              'logout',
              defaultLogoutPage,
              'template.ejs'
            );
            customCss = themeSys.getPluginCustomCss('simpleAccess', 'logout');
          }
        }

        ejsData.referrerTo = ctx.headers.referer || '/'; //aggiungo hai dati passati referrerTo che serve a sapere dove poter reindirizzare la pagina dopo il logout
        ejsData.customCss = customCss;

        ctx.body = await ejs.renderFile( logoutPage, ejsData);
        ctx.set('Content-Type', 'text/html');
       }
    },
    { //questo end point POST verrà chemato dal suo corrispondente GET per implementare il login se le credenziali sono corrette
      method: 'POST', 
      path: '/logout', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => {//
        const {referrerTo } = ctx.request.body;
        ctx.session = null;
        /* ctx.body = 'Logout effettuato con successo';
        ctx.type = 'text'; */
        ctx.redirect(referrerTo);
       }
    },
      // ATTENZIONE BISOGNA LIMITARE l'ACCESSO A QUESTO RL SOLO A UTENTI LOGGATI
    { // url richiesto(dalla pagina di amministrazione) per ottenere la lista degli utenti attivi nel sito
      method: 'GET',
      path: '/userList', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
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
    { // url richiesto(dalla pagina di amministrazione) per ottenere tutte le informazioni sull'utente
      method: 'GET',
      path: '/userInfo', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
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
    { // url richiesto(dalla pagina di amministrazione) per ottenere la lista degli utenti attivi nel sito
      method: 'GET',
      path: '/roleList', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
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
    //START CURA USER create update delete user
    { // url richiesto(dalla pagina di amministrazione) per creare/modificare utenti
      method: 'POST',
      path: '/usertUser', // l'url completo avra la forma /api/namePlugin/usertUser
      handler: async (ctx) => {//

        const { username, email, password, roleIds, isNewUser } = ctx.request.body;

        const result = await userManagement.userUsert(username, password, email, roleIds, isNewUser);
        ctx.body = result;// result contiene un oggetto con informazioni dell'errore se c'è stato un errore, altrimenti un messaggio di successo
        ctx.type = 'application/json'; // oppure semplicemente 'json'

       }
    },
    //START GESTIONE RUOLI CUSTOM
    { // Ottiene lista ruoli custom (isHardcoded: false)
      method: 'GET',
      path: '/customRoleList',
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
    { // Ottiene lista ruoli hardcoded (isHardcoded: true)
      method: 'GET',
      path: '/hardcodedRoleList',
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
    { // Crea un nuovo ruolo custom
      method: 'POST',
      path: '/createCustomRole',
      handler: async (ctx) => {
        const { name, description } = ctx.request.body;
        const result = roleManagement.createCustomRole(name, description);
        ctx.body = result;
        ctx.type = 'application/json';
      }
    },
    { // Aggiorna un ruolo custom esistente
      method: 'POST',
      path: '/updateCustomRole',
      handler: async (ctx) => {
        const { roleId, name, description } = ctx.request.body;
        const result = roleManagement.updateCustomRole(roleId, name, description);
        ctx.body = result;
        ctx.type = 'application/json';
      }
    },
    { // Elimina un ruolo custom
      method: 'POST',
      path: '/deleteCustomRole',
      handler: async (ctx) => {
        const { roleId } = ctx.request.body;
        const result = roleManagement.deleteCustomRole(roleId);
        ctx.body = result;
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
        message = `ciao ${passData.ctx.session.user.name} <br> <a href="/${ital8Conf.apiPrefix}/simpleAccess/logout">Logout</a>` ;
      }else{
        message = `non sei loggato <br> <a href="/${ital8Conf.apiPrefix}/simpleAccess/login">Login</a>`;
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