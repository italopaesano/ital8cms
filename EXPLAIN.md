

 ### documentazione di ital8

/EXPLAIN.md --> questo file , panoramica generale dulla documentazione
/plugins/EXPLAIN.md -> panoramica su come creare un plugin
/themes/EXPLAIN.md --> panoramica su come creare un tema

/core/EXPLAIN.md --> panoramica sulla vartelle come di seguito 
/core/core/EXPLAIN-pluginsSys.md --> descrive il funzionamento del sistema di plugin
/core/core/EXPLAIN-themeSys.md --> descrive il funzionamento del sistema dei temi 
/core/admin/EXPLAIN.md --> panoramica su come funziona l'amministrazione di ital8

 ### struttura generale di ital8

  ci saranno i seguenti sistemi

  a) pluginSys per gestire i plugin 
  b) themesys per gestire i temi  
  c) adminSys per l'aministrazione di ital8

  ### Struttura delle cartelle 
  /core --> questa cartella contiene i file con le logiche ed i file che fanno funzionare ital8 essenzialmente tutto il suo codice operativo sta qui dentro
  /core/admin --> file con le loggiche per l'amministrazione di ital8 (interfaccia utente) es cambiare tema installare e disinstallare plugin ecc
  /core/pluginSys.js --> file che gistisce il sistema di di plugin
  /core/themeSys.js --> file chegestisce il sistema dei temi 

  /plugins --> cartella che contiene al suo interno le cartelle dei plugin ad ogni cartella corrisponde un plugin
  /plugins/EXPLAIN.md --> file che spiega in maiera bsica come creare plugin

  /themes --> cartella che contene le cartelle dei temi ad ogni cartella corrisponde un tema
  /themes/EXPLAIN.md --> file che contiene una guida base per creare un tema
  

  /ital8Config.json5 file di configurazione ,li saranno indicati la configurazione dei percorsi base per le cartelle riservate rispetto a koa-classic-server
  Es :

  ```json
{
  "apiPrefix": "api",
  "adminPrefix": "admin",
  "viewsPrefix": "views",
  "baseThemePath": "../",
  "activeTheme": "default",
  "wwwPath": "/www",
  "debugMode": 1,
  "httpPort": 3000,
  "useHttps": false,
  "httpsPort": "",
  "AutoRedirectHttpPortToHttpsPort": false
}
  '''

























  ///// OLD

  per manipolare le pagine web tel tema da parte dei plugin viene definito la finzione: pageHook();
  quindi nel plugin all'interno di main.jd verrà definita la funzione pageHook(); come segue :

  ```js

  function pageHooks(){

    const pageHooksMap = new Map();
    pageHooksMap.set( 'head', (passData) => ` functione result ` );
    pageHooksMap.set('script', (passData) => ` function result ` );

    return pageHooksMap;

  }
  /* gli hook page si base sono :

    head
    header
    body
    footer
    script

  */

  ```

quest'altra funzione si occupa della definizionie delle rotte sempre all'interno del file main.js dei plugin : getRouteArray();



function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
```js  
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
      path: '/js/bootstrap.min.js', // // l'url completo avra la forma /api/binance/js -> se vengono mantenute le impostazioni di default
      handler: async (ctx) => { 
        const bootstrapJsPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','js','bootstrap.min.js');
        ctx.body = fs.createReadStream(bootstrapJsPath);
        ctx.set('Content-Type', 'text/javascript');
       }
    }
  );
  ```