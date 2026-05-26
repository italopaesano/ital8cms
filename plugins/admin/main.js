
const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const pluginsManagment = require('./pluginsManagment');
const pluginsInstall = require('./pluginsInstall');
const themesManagment = require('./themesManagment');
const themesInstall = require('./themesInstall');
const systemSettings = require('./systemSettings');
const pagesManagment = require('./pagesManagment');
const { detectSupervisor } = require('../../core/cliBridge/respawn');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi}

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

// Salva il riferimento a pluginSys per accedervi nei submoduli
let myPluginSys = null;

function loadPlugin(pluginSys, pathPluginFolder){
  // Salva pluginSys per uso nei submoduli (themesManagment, pluginsManagment, systemSettings)
  myPluginSys = pluginSys;
  //console.log( 'sharedObject: ', sharedObject );
};

function installPlugin(){

};

function uninstallPlugin(){

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

  // API endpoint: Ottiene sezioni admin (UI + menu sections)
  routeArray.push(
    {
      method: 'GET',
      path: `/${ital8Conf.adminPrefix}/adminSections`,
      access: { requiresAuth: true, allowedRoles: [0, 1] }, // Admin only - gestione pannello admin
      handler: async (ctx) => {
        try {
          // Ottiene adminSystem da pluginSys
          const adminSystem = myPluginSys.getAdminSystem();

          if (!adminSystem) {
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: 'AdminSystem not available'
            };
            return;
          }

          // Ottiene dati admin (UI + sections)
          const data = adminSystem.getAdminSections();

          ctx.body = {
            success: true,
            data: data
          };
        } catch (error) {
          console.error('Error in /admin/adminSections:', error);
          ctx.status = 500;
          ctx.body = {
            success: false,
            error: 'Internal server error'
          };
        }
      }
    }
  );

  // API endpoint: Ping (health-check) — usato dal polling post-restart
  // per rilevare quando il processo è tornato attivo dopo un riavvio.
  // Volutamente NO auth: il polling deve funzionare anche se il browser
  // perdesse la sessione durante il restart (in pratica koa-session firma
  // i cookie e li ripristina, ma non vogliamo dipenderne).
  // Path single-prefix (`/ping` → `/api/admin/ping`), coerente con gli
  // altri endpoint del plugin (themes, setTheme, ecc.).
  routeArray.push(
    {
      method: 'GET',
      path: '/ping',
      access: { requiresAuth: false, allowedRoles: [] },
      handler: async (ctx) => {
        ctx.body = { ok: true, ts: Date.now() };
      }
    }
  );

  // API endpoint: Restart ital8cms (graceful shutdown + self-respawn o
  // delega al supervisor). Risponde IMMEDIATAMENTE al client, poi via
  // setImmediate triggera la chiusura — così il browser riceve la risposta
  // prima che il server muoia.
  routeArray.push(
    {
      method: 'POST',
      path: '/restart',
      access: { requiresAuth: true, allowedRoles: [0, 1] }, // root + admin
      handler: async (ctx) => {
        const supervisor = detectSupervisor();
        const username = ctx.session && ctx.session.user
          ? ctx.session.user.username
          : 'unknown';

        console.log(`[admin] richiesta restart da utente "${username}" (supervisor: ${supervisor || 'none'})`);

        ctx.body = {
          ok: true,
          restarting: true,
          supervisor: supervisor,
          mode: supervisor ? 'supervisor' : 'self-respawn',
          message: supervisor
            ? `Riavvio in corso (gestito da ${supervisor})`
            : 'Riavvio in corso (self-respawn)'
        };

        // Triggera il restart DOPO che la risposta è stata inviata.
        // Il delay di 100ms dà al kernel TCP il tempo di flushare la response.
        setImmediate(() => {
          setTimeout(() => {
            const ok = myPluginSys.requestRestart({ reason: 'admin-restart-request' });
            if (!ok) {
              console.error('[admin] requestRestart() ha fallito: nessun callback registrato in pluginSys');
            }
          }, 100);
        });
      }
    }
  );

  // Aggiungi route per gestione plugin (da pluginsManagment.js)
  const pluginManagmentRoutes = pluginsManagment.getRoutes();
  pluginManagmentRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per installazione plugin da repo Git (da pluginsInstall.js)
  const pluginInstallRoutes = pluginsInstall.getRoutes();
  pluginInstallRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per gestione temi (da themesManagment.js)
  // Passa una funzione getter per accedere a myPluginSys a runtime (non a construction time)
  const themeManagmentRoutes = themesManagment.getRoutes(() => myPluginSys);
  themeManagmentRoutes.forEach(route => {
    routeArray.push(route);
  });

  // Aggiungi route per installazione tema da repo Git (da themesInstall.js)
  const themeInstallRoutes = themesInstall.getRoutes();
  themeInstallRoutes.forEach(route => {
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
  uninstallPlugin: uninstallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
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