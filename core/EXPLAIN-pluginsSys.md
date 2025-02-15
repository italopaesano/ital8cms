
  
  
  # mostreremo il funzionamento del sistema dei plugin 
  ## per come creare un plugin e quali regole seguire per crearne uno si ci rifaccia alla documentazione corrispondente
  ##  in : /plugins/EXPLAIN.md
  
 quando si scrive un plaugin si hanno a disposizione le seguenfi funzione per estendere le funzionalità di ital8
 getRouteArray(); getHooksPage(); le cunzioni verranno analizzate una a una 

  ### getRouteArray(); questa funzione restituisce un Array che rappresenterà le totte e le sue funioni corrispondenti
  ### questa funzione deve restituire la seguente struttura dati:
  # getRouteArray()
```js
function getRouteArray(){

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
  
  return routeArray;
}

  ```

  # getHooksPage();
  ### getHooksPage(); questa funzione restiuisce una struttura dati che associerà ad agni hook di ogni pagina una funzione che a sua volta rstituira un astringa da accodare alle vari pagine web in base all' hook chiamato

  ### hookMap.set( hookNmale, Fn ); fn = function( PassData ) { return "someString"; } 

  ### Es.

  ```js
  function getHooksPage(){

  const HookMap = new Map();
  HookMap.set( 'head', (passData) => `<link rel='stylesheet' href='${ital8Conf.apiPrefix}/bootstrap/css/bootstrap.min.css' type='text/css'  media='all' />` );
  HookMap.set('script', (passData) => `<script src="${ital8Conf.apiPrefix}/bootstrap/js/bootstrap.min.js" type="text/javascript" ></script>` );

  return HookMap;
}
  ```

# le funzioni getObjectToShareToWebPages() getObjectToShareToOthersPlugin() setSharedObject()
## getObjectToShareToWebPages() sarà l oggetto che si trovera nei template es passData.plugins[nome plugin] 
## mentre getObjectToShareToOthersPlugin() setSharedObject() dei plugin permetto ad ogni plugin di condividere ogetti personalizato con tuti gli altri plugin

### function setSharedObject( pluginName, object ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

### function getObjectToShareToOthersPlugin( pluginName ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

# a questo proposito mostriamo la parte di codice in pluginSys.js che mostra come gli ogetti condivisi fra i plugin vengono creati 


```js

//START CARICO GLI OGGETTI CONDIVISI PRIMA DI CHIAMARE LA FUNZION loadPlugin() ed installPlugin permettendo di utilizare gli ogetti condivisi in fase d'installazione o di loading 
//adesso crea e carico gli ogetti confivisi fra i plugin : ogni plugin chiamerà la funzione getObjectToShareToOthersPlugin( pluginName); passando il proprio nome come parametro ed ottenendo l'ogetto a lui destinato immagazinandolo con la funzione : setSharedObject( pluginName, object ) dove in questo caso pluginname è il nome del plugin dal quale si riceve l'ogetto o object l'aogetto che si riceve 
this.#activePlugins.forEach( ( plugin0, nomePlugin0  ) => { // per ogni plugin itero per tutti gli altri plugins escludendo se stesso
  if(plugin0.getObjectToShareToOthersPlugin){// mi assicuro che la funzione appropiata esista
    this.#activePlugins.forEach( ( plugin1, nomePlugin1 ) => {
        if( nomePlugin0 !== nomePlugin1){// mi assicuro che il plugin non richiami le funzioni su sse stesso
          if(plugin1.setSharedObject){// mi assicuro che la funzione appropiata esiste 
            plugin1.setSharedObject( nomePlugin0, plugin0.getObjectToShareToOthersPlugin( nomePlugin1 ) );
          }
        }
    });
  }// if(plugin0.getObjectToShareToOthersPlugin){/
});// this.#activePlugins.forEach( ( nomePlugin0, plugin0 ) => {


//adesso crea e carico gli ogetti confivisi fra i plugin : ogni plugin chiamerà la funzione getObjectToShareToOthersPlugin( pluginName); passando il proprio nome come parametro ed ottenendo l'ogetto a lui destinato immagazinandolo con la funzione : setSharedObject( pluginName, object ) dove in questo caso pluginname è il nome del plugin dal quale si riceve l'ogetto o object l'aogetto che si riceve 
//OLD OLD OLD OLD 
    /* this.#activePlugins.forEach( ( nomePlugin0, plugin0 ) => { // per ogni plugin itero per tutti gli altri plugins escludendo se stesso
      if(plugin0.getObjectToShareToOthersPlugin){// mi assicuro che la funzione appropiata esista
        this.#activePlugins.forEach( ( nomePlugin1, plugin1 ) => {
            if( nomePlugin0 =! nomePlugin1){// mi assicuro che il plugin non richiami le funzioni su sse stesso
              if(plugin1.setSharedObject){// mi assicuro che la funzione appropiata esiste 
                plugin1.setSharedObject( nomePlugin0, plugin0.getObjectToShareToOthersPlugin( nomePlugin1 ) );
              }
            }
        });
      }// if(plugin0.getObjectToShareToOthersPlugin){/
    });// this.#activePlugins.forEach( ( nomePlugin0, plugin0 ) => { */
```