
const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const pluginsManagment = require('./pluginsManagment');
const themesManagment = require('./themesManagment');
const systemSettings = require('./systemSettings');
const pagesManagment = require('./pagesManagment');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json'));// let perchè questa varibile può cambiare di valore
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi}

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json'));// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

// Salva il riferimento a pluginSys per accedervi nei submoduli
let myPluginSys = null;

function loadPlugin(pluginSys, pathPluginFolder){
  // Salva pluginSys per uso nei submoduli (themesManagment, pluginsManagment, systemSettings)
  myPluginSys = pluginSys;
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

/*   middlewareArray.push( // ritorna un array di midlware
    {

    }
  ); */
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

  // per ragioni di sucurezza all'indirizzo di admin sarà aggiunto un ulteriore sottopercorso
  // oltre as /api/namePlugin ci sarà anche adminPrefix quindi --> /api/namePlugin/adminPrefix
  // quindi usare sepre :  path: `/${ital8Conf.adminPrefix}/oterpath`


  const routeArray = Array();
  //ES.
  routeArray.push(
    {
      method: 'GET',
      path: `/${ital8Conf.adminPrefix}/hello`,
        handler: async (ctx) => {
          ctx.body = `hellò`
          ctx.type = 'text/css';
       }
    }
  );

  // Aggiungi route per gestione plugin (da pluginsManagment.js)
  const pluginManagmentRoutes = pluginsManagment.getRoutes();
  pluginManagmentRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per gestione temi (da themesManagment.js)
  // Passa una funzione getter per accedere a myPluginSys a runtime (non a construction time)
  const themeManagmentRoutes = themesManagment.getRoutes(() => myPluginSys);
  themeManagmentRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per gestione impostazioni sistema (da systemSettings.js)
  const systemSettingsRoutes = systemSettings.getRoutes();
  systemSettingsRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per gestione pagine web (da pagesManagment.js)
  const pagesManagmentRoutes = pagesManagment.getRoutes();
  pagesManagmentRoutes.forEach(route => {
    routeArray.push(route);
  });

  return routeArray;
}

/* 
  restituira una mappa che comechiave avrà la parte della pagina dove eseguire le funzione e come valore la funzione da eseguire 
  la funzione da eseguire avrà come paramentro passData che è l'aogetto contenente tutto ciò che verrà passato alla pagine
 */

function getHooksPage(){

  const HookMap = new Map();

  //HookMap.set( 'body', (passData) => '<h3>ciao a tutti</h3>');
  //HookMap.set('footer', (passData) => '<b>sono nel footer</b>');

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
  getMiddlewareToAdd: getMiddlewareToAdd,
  // Esporta il riferimento a pluginSys per i submoduli
  getPluginSys: () => myPluginSys

}