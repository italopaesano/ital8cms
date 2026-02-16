# Plugin System - Guida Base

> **⚠️ NOTA:** Questa è una guida base introduttiva. Per la documentazione completa e aggiornata, consulta:
> - `/CLAUDE.md` - Documentazione completa del progetto
> - `/core/EXPLAIN-pluginsSys.md` - Guida dettagliata del sistema plugin
> - `/plugins/exampleComplete/` - Plugin di esempio completo con tutti i metodi

> **🆕 NUOVO STANDARD (2026-01-04):** È stato aggiunto il metodo `getGlobalFunctionsForTemplates()` per esportare funzioni globali nei template EJS. Vedi documentazione completa in `/CLAUDE.md` sezione "Global Functions in Templates".

---

il sistema di plugin funziona nel seguente modo:

1) ogni plugin ha la sua directory nella cartella plugins

2) il nome del plgin corrisponde col nome della directory che corrisponde anche al valore "name" all'interno di pluginDescription.json5 
        e tale nome e dovrà essere senza spazi o catteri speciali

3) all'interno di ogni cartella del plugin ci sarà un file con nome main.js
         che sarà il file che verrà caricato e poi eseguito per far funzionare il plugin

4) all'interno del file main.js ci saranno le seguenti funzioni:
 loadPlugin() installPlugin() unistallPlugin() upgradePlugin() getObjectToShare()
 getRouteArray() getMiddlewareToAdd()

queste funzionisaranno poi rese disponibili attraverso un esportazione del tipo :

```js
module.exports = {

        loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
        installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
        unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
        upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
        getObjectToShare: getObjectToShare,// rstituisce un ogetto che verrà condiviso con il template (es EJS) passData.plugins.['nomePlugin'] oppure con gli altri moduli
        getRouteArray: getRouteArray, //questa funzione restituirà tutte le rotte proprie del plugin
        getHooksPage: getHooksPage, // questa funzione restituirà una mappa che farà in modo che verrà eseguito un codice nelle parte ti pagina html desiderata es header main ecc
        pluginConfig: pluginConfig,
        getHooksPage: getHooksPage,
        getMiddlewareToAdd: getMiddlewareToAdd

}
```

analiziamo la funzione getRouteArray() ed in particolare l'array che restituisce : const routeArray = Array();
sarà strutturato nel seguente modo  :

```js
const routeArray = [
  {
    method: 'GET',
    path: '/api/users', // vedi descrizion nota sul path più sotto
    handler: async (ctx) => { .. }
  },
  {
    method: 'GET',
    path: '/api/products', // vedi descrizion nota sul path più sotto
    handler: async (ctx) => { .. }
  },
  {
    method: 'POST',
    path: '/api/users', // vedi descrizion nota sul path più sotto
    handler: async (ctx) => { .. }
  }
  // Aggiungi altre rotte qui...
]
```

+++ ATTENZIONE ++++
per gli oggetti di sopra per l'atributo " path: '/api/users' " bisoggan atenere presente che avrà due prefix
il risultato finale del path sarà qualcosa di simile a : path: `${api_prefox}/${moduleName}/api/users`

5) all'interno del cartella del plugin sarà contenuto anche il file pluginDescription.json5 che avrà la seguente struttura:

```json
{
        "name": "examplePlugin",
        "version": "1.0.0",
        "description": " an example of examplePlugin",
        "author": "Italo Paesano",
        "email": "italopaesano@protonmail.com",
        "licenze": "MIT",
        "note": "any note"
}
```

6) all'interno del cartella del plugin sarà contenuto anche il file pluginConfig.json5 che avrà la seguente struttura:
```json
{
        "active": 0,
        "isInstalled": 0,
        "weight": 0,
        "dependency": {},
        "nodeModuleDependency": {},
        "custom": {} // qui saranno inserite tutte le impostazioni specifiche del modulo 
}
```

analiziamo le seguenti parti:
```js
        "active": 0,// --> questo indica se il plugin deve essere attivo quindi se deve essere caricato o meno
        "isInstalled": 0,// --> questo indica se ha subito il processo d'installasione o meno (richiamara la funzione installPlugin() nel filemain.js)
        "weight": 0,// --> il peso di questo plugin indica la priorità con cui deve essere caricato rispetto a gli altri (bublesort) tenete presente che i plugin caricati dopo hanno a disposizione le funzionalità dei plugin caricati prima
        "dependency": {}//  --> elenca gli altri plugin da cui si dipende , in questo caso l'ordine di caricamento conta i plugin di questa lista devono esse caricati prima del plugin in oggetto 

        "dependency": {
                        "admin": "^3.1.9",
                        "db": "^0.0.1",
                        "valodatio": "^0.12.7"
                }
```
        "nodeModuleDependency": {} -->  elenca i moduli node.js necessari al plugin per funzionare
                Es:
```js
                "nodeModuleDependency": {
                        "ejs": "^3.1.9",
                        "fs": "^0.0.1-security",
                        "path": "^0.12.7"
                }
```          

7) analiziamo la funzione getFnInPageMap(); essa restituirà una mappa

Es:


```js
function getFnInPageMap(){

  const fnInPageMap = new Map();
  fnInPageMap.set( 'head', (passData) => '<link href="../../../node_modules/bootstrap/dist/css/bootstrap.min.css">' );
  fnInPageMap.set('script', (passData) => '<script src="../../../node_modules/bootstrap/dist/js/bootstrap.bundle.min.js" type="text/javascript" ></script>' );

  return fnInPageMap;
}

```
questo codice in parte genererà questo output

```html
<!-- START bootstrap part --> 
<link href="../../../node_modules/bootstrap/dist/css/bootstrap.min.css">
<!-- END bootstrap part --> 
</head>

```