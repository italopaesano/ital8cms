


const fs = require('fs');
const path = require('path');

const ejs = require("ejs"); // serve per aggiungere il supporto ejs , che fral'altro serve a caricare bootstrap

const ital8Conf = require('../../ital8-conf.json');// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

const libAccess = require('./lib/libAccess');

let pluginConfig = require(`${__dirname}/config-plugin.json`);// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi} 

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

function loadPlugin(){
  //console.log( 'sharedObject: ', sharedObject );
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

          const loginPage = path.join( __dirname , 'webPages', 'login.ejs' );
          ejsData.referrerTo = ctx.headers.referer || '/'; //aggiungo hai dati passati referrerTo che serve a sapere dove poter reindirizzare la pagina dopo il login
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
        const logoutPage = path.join( __dirname , 'webPages', 'logout.ejs' );
        ejsData.referrerTo = ctx.headers.referer || '/'; //aggiungo hai dati passati referrerTo che serve a sapere dove poter reindirizzare la pagina dopo il logout
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