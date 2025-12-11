
const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore 
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
    // Test page for Bootstrap Icons
    {
      method: 'GET',
      path: '/test-icons',
      handler: async (ctx) => {
        ctx.type = 'text/html';
        ctx.body = `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Bootstrap Icons</title>
    <link rel="stylesheet" href="/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap.min.css">
    <link rel="stylesheet" href="/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap-icons.min.css">
    <style>
        body {
            padding: 2rem;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .test-section {
            margin-bottom: 2rem;
            padding: 1.5rem;
            border: 2px solid #dee2e6;
            border-radius: 0.5rem;
        }
        .icon-demo {
            font-size: 2rem;
            margin: 0.5rem;
        }
        .success {
            border-color: #28a745;
            background-color: #d4edda;
        }
        .info {
            border-color: #17a2b8;
            background-color: #d1ecf1;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Test Bootstrap Icons</h1>

        <div class="test-section success">
            <h2>✅ Test 1: Icone Base</h2>
            <p>Se vedi le icone sotto, Bootstrap Icons funziona correttamente:</p>
            <div>
                <i class="bi bi-gear icon-demo"></i>
                <i class="bi bi-house icon-demo"></i>
                <i class="bi bi-heart icon-demo"></i>
                <i class="bi bi-star icon-demo"></i>
                <i class="bi bi-check-circle icon-demo"></i>
            </div>
        </div>

        <div class="test-section info">
            <h2>📋 Test 2: Icone Comuni</h2>
            <div>
                <i class="bi bi-person icon-demo"></i>
                <i class="bi bi-envelope icon-demo"></i>
                <i class="bi bi-search icon-demo"></i>
                <i class="bi bi-cart icon-demo"></i>
                <i class="bi bi-menu-button icon-demo"></i>
            </div>
        </div>

        <div class="test-section">
            <h2>🔍 Test 3: Verifica Tecnica</h2>
            <p><strong>Font CSS caricato da:</strong> /${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap-icons.min.css</p>
            <p><strong>Font files serviti da:</strong> /${ital8Conf.apiPrefix}/${pluginName}/css/fonts/bootstrap-icons.woff2</p>
            <p>Apri gli strumenti sviluppatore (F12) → Network → filtra per "bootstrap-icons" per verificare il caricamento.</p>
        </div>

        <div class="test-section">
            <h2>📖 Elenco Icone Disponibili</h2>
            <p>Tutte le icone disponibili su: <a href="https://icons.getbootstrap.com/" target="_blank">https://icons.getbootstrap.com/</a></p>
        </div>
    </div>

    <script src="/${ital8Conf.apiPrefix}/${pluginName}/js/bootstrap.min.js"></script>
</body>
</html>
        `;
       }
    },
    // Bootstrap CSS
    {
      method: 'GET',
      path: '/css/bootstrap.min.css',
      handler: async (ctx) => {
        const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css');
        ctx.body = fs.createReadStream(bootstrapCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    },
    {
      method: 'GET',
      path: '/css/bootstrap.min.css.map',
      handler: async (ctx) => {
        const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css.map');
        ctx.body = fs.createReadStream(bootstrapCssPath);
        ctx.set('Content-Type', 'application/json');
       }
    },
    // Bootstrap JS
    {
      method: 'GET',
      path: '/js/bootstrap.min.js',
      handler: async (ctx) => {
        const bootstrapJsPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','js','bootstrap.min.js');
        ctx.body = fs.createReadStream(bootstrapJsPath);
        ctx.set('Content-Type', 'text/javascript');
       }
    },
    {
      method: 'GET',
      path: '/js/bootstrap.min.js.map',
      handler: async (ctx) => {
        const bootstrapJsPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','js','bootstrap.min.js.map');
        ctx.body = fs.createReadStream(bootstrapJsPath);
        ctx.set('Content-Type', 'application/json');
       }
    },
    // Bootstrap Icons CSS
    {
      method: 'GET',
      path: '/css/bootstrap-icons.min.css',
      handler: async (ctx) => {
        const bootstrapIconsCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap-icons','font','bootstrap-icons.min.css');
        ctx.body = fs.createReadStream(bootstrapIconsCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    },
    {
      method: 'GET',
      path: '/css/bootstrap-icons.css',
      handler: async (ctx) => {
        const bootstrapIconsCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap-icons','font','bootstrap-icons.css');
        ctx.body = fs.createReadStream(bootstrapIconsCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    },
    // Bootstrap Icons Fonts (WOFF e WOFF2)
    {
      method: 'GET',
      path: '/css/fonts/bootstrap-icons.woff',
      handler: async (ctx) => {
        const fontPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap-icons','font','fonts','bootstrap-icons.woff');
        ctx.body = fs.createReadStream(fontPath);
        ctx.set('Content-Type', 'font/woff');
       }
    },
    {
      method: 'GET',
      path: '/css/fonts/bootstrap-icons.woff2',
      handler: async (ctx) => {
        const fontPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap-icons','font','fonts','bootstrap-icons.woff2');
        ctx.body = fs.createReadStream(fontPath);
        ctx.set('Content-Type', 'font/woff2');
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
    <link rel='stylesheet' href='/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap.min.css' type='text/css'  media='all' />
    <link rel='stylesheet' href='/${ital8Conf.apiPrefix}/${pluginName}/css/bootstrap-icons.min.css' type='text/css'  media='all' />
    ` );
  HookMap.set('script', (passData) => `
    <script src="/${ital8Conf.apiPrefix}/${pluginName}/js/bootstrap.min.js" type="text/javascript" ></script>
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