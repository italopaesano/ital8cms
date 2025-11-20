
const fs = require('fs');
const path = require('path');

let pluginConfig = require(`${__dirname}/config-plugin.json`);// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi} 

const ital8Conf = require('../../ital8-conf.json');// questo serve a caricare le impostazioni generali del modulo ed in particolare lìapi Prefix

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

  // API per cambiare il tema attivo (pubblico o admin)
  routeArray.push(
    {
      method: 'POST',
      path: `/setTheme`,
      handler: async (ctx) => {
        try {
          // Verifica autenticazione (opzionale ma consigliato)
          if (!ctx.session || !ctx.session.authenticated) {
            ctx.status = 401;
            ctx.body = { error: 'Non autorizzato. Effettua il login.' };
            return;
          }

          // Verifica ruolo (solo admin e root possono cambiare tema)
          const userRole = ctx.session.user ? ctx.session.user.roleId : 999;
          if (userRole > 1) { // 0 = root, 1 = admin
            ctx.status = 403;
            ctx.body = { error: 'Non hai i permessi per modificare i temi.' };
            return;
          }

          const { themeName, themeType } = ctx.request.body;

          // Validazione input
          if (!themeName || !themeType) {
            ctx.status = 400;
            ctx.body = { error: 'Parametri mancanti: themeName e themeType sono obbligatori.' };
            return;
          }

          if (themeType !== 'public' && themeType !== 'admin') {
            ctx.status = 400;
            ctx.body = { error: 'themeType deve essere "public" o "admin".' };
            return;
          }

          // Verifica che il tema esista
          const themesPath = path.join(__dirname, '../../themes');
          const themePath = path.join(themesPath, themeName);

          if (!fs.existsSync(themePath)) {
            ctx.status = 404;
            ctx.body = { error: `Il tema "${themeName}" non esiste.` };
            return;
          }

          // Verifica che il tema abbia la cartella views
          const viewsPath = path.join(themePath, 'views');
          if (!fs.existsSync(viewsPath)) {
            ctx.status = 400;
            ctx.body = { error: `Il tema "${themeName}" non ha una cartella views/ valida.` };
            return;
          }

          // Leggi configurazione attuale
          const configPath = path.join(__dirname, '../../ital8-conf.json');
          const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

          // Aggiorna il tema appropriato
          if (themeType === 'public') {
            currentConfig.activeTheme = themeName;
          } else {
            currentConfig.adminActiveTheme = themeName;
          }

          // Salva configurazione aggiornata
          fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');

          const typeLabel = themeType === 'public' ? 'sito pubblico' : 'pannello admin';
          ctx.body = {
            success: true,
            message: `Tema "${themeName}" attivato per ${typeLabel}. Riavvia il server per applicare le modifiche.`
          };

        } catch (error) {
          console.error('Errore nel cambio tema:', error);
          ctx.status = 500;
          ctx.body = { error: 'Errore interno del server: ' + error.message };
        }
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
  getMiddlewareToAdd: getMiddlewareToAdd

}