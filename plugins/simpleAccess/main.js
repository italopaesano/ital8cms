
const ital8Conf = require('../../ital8-conf.json');// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

const fs = require('fs');
const path = require('path');

const koaSession = require('koa-session');// dipendenza di questo plugin
const ejs = require("ejs"); // serve per aggiungere il supporto ejs , che fral'altro serve a caricare bootstrap

let pluginConfig = require(`${__dirname}/config-plugin.json`);// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi} 

const ejsData = {// i dati che verranno passati a èjs
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

  const middlewareArray = Array();

  app.keys = ['una-chiave-segreta-di-sessione-kgjgugbfbdresewayt5435654757156']; // Imposta le chiavi della sessione 

  // Configurazione della sessione
  const sessionCONFIG = {
    key: 'koa.sess',
    maxAge: 86400000,
    overwrite: true,
    httpOnly: true,
    signed: true,
    rolling: false,
    renew: false
  };

  middlewareArray.push( // ritorna un array di midlware
    koaSession(sessionCONFIG, app) // vedi documentazione koa-session
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
        ctx.body = await ejs.renderFile( loginPage, ejsData);
        ctx.set('Content-Type', 'text/html');
       }
    },
    {
      method: 'GET',
      path: '/logout', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const logoutPage = path.join( __dirname , 'webPages', 'logout.ejs' );
        ctx.body = await ejs.renderFile( logoutPage, ejsData);
        ctx.set('Content-Type', 'text/html');
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

  const fnInPageMap = new Map();

  //fnInPageMap.set( 'body', (passData) => '<h3>ciao a tutti</h3>');
  //fnInPageMap.set('footer', (passData) => '<b>sono nel footer</b>');

  return fnInPageMap;
  
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