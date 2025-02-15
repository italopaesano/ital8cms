
const fs = require('fs');
const path = require('path');
const ital8Conf = require('../../ital8-conf.json');

let pluginConfig = require(`${__dirname}/config-plugin.json`);// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname  );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin


function loadPlugin(){
  //console.log( 'sharedObject: ', sharedObject );
};

function installPlugin(){

};

function unistallPlugin(){

};

function upgradePlugin(){

};

function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
  
  const routeArray = Array(
    {
      method: 'GET',
      path: '/css/bootstrap.min.css', // l'url completo avra la forma /api/binance/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css');
        ctx.body = fs.createReadStream(bootstrapCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    },
    {
      method: 'GET',
      path: '/css/bootstrap.min.css.map', // l'url completo avra la forma /api/binance/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css.map');
        ctx.body = fs.createReadStream(bootstrapCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    },
    {
      method: 'GET',
      path: '/js/bootstrap.min.js', // // l'url completo avra la forma /api/binance/js -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const bootstrapJsPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','js','bootstrap.min.js');
        ctx.body = fs.createReadStream(bootstrapJsPath);
        ctx.set('Content-Type', 'text/javascript');
       }
    },
    {
      method: 'GET',
      path: '/js/bootstrap.min.js.map', // // l'url completo avra la forma /api/binance/js -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const bootstrapJsPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','js','bootstrap.min.js.map');
        ctx.body = fs.createReadStream(bootstrapJsPath);
        ctx.set('Content-Type', 'text/javascript');
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
  HookMap.set( 'head', (passData) => `
    <link rel='stylesheet' href='/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap.min.css' type='text/css'  media='all' />\n
    <link rel='stylesheet' href='/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap.min.css.map' type='text/css'  media='all' />
    ` );
  HookMap.set('script', (passData) => `
    <script src="/${ital8Conf.apiPrefix}/${pluginName}/js/bootstrap.min.js" type="text/javascript" ></script>\n
    <script src="/${ital8Conf.apiPrefix}/${pluginName}/js/bootstrap.min.js.map" type="text/javascript" ></script>
    ` );

  return HookMap;
}


module.exports = {

  loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
  installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
  unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
  upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getHooksPage: getHooksPage

}