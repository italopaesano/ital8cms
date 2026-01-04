
const koa = require('koa');
const app = new koa();
const koaClassicServer = require("koa-classic-server");
const ejs = require("ejs");
const loadJson5 = require('./core/loadJson5');
const ital8Conf = loadJson5('./ital8Config.json5');
const path = require('path');

const priorityMiddlewares = require('./core/priorityMiddlewares/priorityMiddlewares.js')(app, ital8Conf);
router = priorityMiddlewares.router ;
//const priorityMiddlewares(app); // carico i imidlware che vanno impostati in ordine preciso di caricamento

const pluginSys = new ( require("./core/pluginSys") )(ital8Conf); // carico il sistema di plugin e passo la configurazione per whitelist
// carico le rotte di tutti i plugin
pluginSys.loadRoutes( router , `${ital8Conf.globalPrefix}/${ital8Conf.apiPrefix}`);// il secondo paramentro è il primo prefix
const getObjectsToShareInWebPages = pluginSys.getObjectsToShareInWebPages();

// Ottieni le funzioni globali da esportare nei template EJS
// Queste funzioni saranno disponibili direttamente nei template senza dover accedere a passData.plugin.{pluginName}
// IMPORTANTE: Le versioni locali (passData.plugin.{pluginName}.{function}) rimangono SEMPRE disponibili
const globalFunctions = pluginSys.getGlobalFunctions();

// adesso faccio in modo di caricare tutti i vari midlware dei vari pugin
const middlewaresToLoad = pluginSys.getMiddlewaresToLoad();// questi midlware andranno caricati nell'app koa.js const app = new koa();
middlewaresToLoad.forEach( (midlwareFn) => {
  const middlewareArrey = midlwareFn(app);// questa funzione restituirà un array i midlware che poi dovranno essere agiunti singolarmente , ogni plugin quindi restituirà il suo array di midlway da aggiungere
  middlewareArrey.forEach( (middleware) =>{
    app.use(  middleware );
  });
});
//console.log( "--------app.middleware ----------" , app.middleware);// visualizza quali midlware sono caricati 
//console.log( 'getObjectsToShareInWebPages', getObjectsToShareInWebPages);

// carico il themesys (passo anche pluginSys per il controllo delle dipendenze)
const themeSys = new ( require('./core/themeSys') ) ( ital8Conf, pluginSys );

// Imposta il riferimento a themeSys in pluginSys per permettere ai plugin di accedervi
pluginSys.setThemeSys(themeSys);

// Inizializza Admin System (se abilitato)
let adminSystem = null;
if (ital8Conf.enableAdmin) {
  const AdminSystem = require('./core/admin/adminSystem');
  adminSystem = new AdminSystem(themeSys);

  // Collega PluginSys ad AdminSystem (evita dipendenza circolare)
  adminSystem.setPluginSys(pluginSys);
  pluginSys.setAdminSystem(adminSystem);

  // Inizializza admin (processa plugin admin, crea symlink, carica servizi)
  adminSystem.initialize();

  console.log('✓ Admin System initialized');
}

// Static server per le risorse del tema pubblico
// Le risorse sono accessibili tramite /{publicThemeResourcesPrefix}/css/, /{publicThemeResourcesPrefix}/js/, ecc.
// Configurazione cache controllata da browserCacheEnabled e browserCacheMaxAge in ital8Config.json
app.use(
  koaClassicServer(
    path.join(__dirname, 'themes', ital8Conf.activeTheme, 'themeResources'),
    {
      urlPrefix: `${ital8Conf.globalPrefix}/${ital8Conf.publicThemeResourcesPrefix}`,
      urlsReserved: [`${ital8Conf.globalPrefix}/${ital8Conf.adminPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.apiPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.viewsPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.adminThemeResourcesPrefix}`], // '/admin','/api','/views','/public-theme-resources','/admin-theme-resources' -> questi sarebbero i percorsi di default pero adesso sono configurabili
      showDirContents: false,
      browserCacheEnabled: ital8Conf.browserCacheEnabled,
      browserCacheMaxAge: ital8Conf.browserCacheMaxAge,
    }
  )
);
console.log(`[themeSys] Risorse del tema pubblico servite da ${ital8Conf.globalPrefix}/${ital8Conf.publicThemeResourcesPrefix}/ -> themes/${ital8Conf.activeTheme}/themeResources/`);

// koa classic server
app.use(
  koaClassicServer(
    __dirname + `${ital8Conf.wwwPath}`,
    (opt = {
      urlPrefix: `${ital8Conf.globalPrefix}`,
      showDirContents: true,
      urlsReserved: [`${ital8Conf.globalPrefix}/${ital8Conf.adminPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.apiPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.viewsPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.publicThemeResourcesPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.adminThemeResourcesPrefix}`], // '/admin','/api','/views','/public-theme-resources','/admin-theme-resources' -> questi sarebbero i percorsi di default pero adesso sono configurabili
      browserCacheEnabled: ital8Conf.browserCacheEnabled,
      browserCacheMaxAge: ital8Conf.browserCacheMaxAge,
      template: {
        render: async (ctx, next, filePath) => {
          ctx.body = await ejs.renderFile(filePath, {
            passData :{
              isAdminContext: false, // Flag per distinguere contesto pubblico da admin
              globalPrefix: ital8Conf.globalPrefix,// prefisso globale per costruire URL corretti
              apiPrefix: ital8Conf.apiPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamare in modo corretto e flessibile le api ad esempio dei vari plugin
              //adminPrefix: ital8Conf.adminPrefix,//ATTENZIONE PER NESSUN MOTIVO DOVRÀ ESSERE PASSATO adminPrefix nelle pagine web non di amministrazione per non svelare ad utenti potenzialmente pericolosi la locazion della sezione di admin
              pluginSys: pluginSys, // sistema dei plugin
              plugin: getObjectsToShareInWebPages,// quicondivo gli ogetti publidi dei plugin
              themeSys: themeSys, // sistema dei temi
              adminSystem: adminSystem, // Admin System (disponibile anche in pagine pubbliche per servizi come auth)
              //baseThemePath: `${ital8Conf.baseThemePath}` ,OLD -> mi sa che non serve più// default -> "../themes/default" -->baseThemePath contiene il percorso di base del tema corrente
              filePath: filePath,
              href: ctx.href,
              query: ctx.query,
              ctx: ctx,// DA MIGLIORARE PER LA SICUREZZA
              //session: ctx.session || undefined, // DA MIGLIORARE qusta variabile serve al  Plugin simpleAccess per gestire la visualizazione dele sessioni nell'hook page
            },
            // Espandi le funzioni globali (es. __() per i18n)
            // IMPORTANTE: Le versioni locali (passData.plugin.simpleI18n.__) rimangono disponibili
            ...globalFunctions
          });
        },
        ext: ["ejs", "EJS"], // Koa v3: sintassi moderna array literals
      },
    })
  )
);

//START ADESSO CARICO LA PARTE DI ADMIN SE RICHIESTA
if(ital8Conf.enableAdmin){// SE LA SEZIONE DI ADMIN È ABBILITATA

  // Static server per le risorse del tema admin
  // Le risorse sono accessibili tramite /{adminThemeResourcesPrefix}/css/, /{adminThemeResourcesPrefix}/js/, ecc.
  // Configurazione cache controllata da browserCacheEnabled e browserCacheMaxAge in ital8Config.json
  app.use(
    koaClassicServer(
      path.join(__dirname, 'themes', ital8Conf.adminActiveTheme, 'themeResources'),
      {
        urlPrefix: `${ital8Conf.globalPrefix}/${ital8Conf.adminThemeResourcesPrefix}`,
        urlsReserved: [`${ital8Conf.globalPrefix}/${ital8Conf.adminPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.apiPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.viewsPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.publicThemeResourcesPrefix}`], // '/admin','/api','/views','/public-theme-resources','/admin-theme-resources' -> questi sarebbero i percorsi di default pero adesso sono configurabili
        showDirContents: false,
        browserCacheEnabled: ital8Conf.browserCacheEnabled,
        browserCacheMaxAge: ital8Conf.browserCacheMaxAge,
      }
    )
  );
  console.log(`[themeSys] Risorse del tema admin servite da ${ital8Conf.globalPrefix}/${ital8Conf.adminThemeResourcesPrefix}/ -> themes/${ital8Conf.adminActiveTheme}/themeResources/`);

  // Static server per le pagine admin complete
  app.use(
    koaClassicServer(
      path.join(__dirname, 'core', 'admin', 'webPages'),// punto alla cartella delle pagine di admin
      (opt = {
        index: ['index.ejs'], // Koa v3 + koa-classic-server v2.1.2: formato array raccomandato
        urlPrefix: `${ital8Conf.globalPrefix}/${ital8Conf.adminPrefix}`,
        showDirContents: true,
        urlsReserved: [`${ital8Conf.globalPrefix}/${ital8Conf.apiPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.viewsPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.publicThemeResourcesPrefix}`, `${ital8Conf.globalPrefix}/${ital8Conf.adminThemeResourcesPrefix}`], // '/api','/views','/public-theme-resources','/admin-theme-resources' -> questi sarebbero i percorsi di default pero adesso sono configurabili
        browserCacheEnabled: ital8Conf.browserCacheEnabled,
        browserCacheMaxAge: ital8Conf.browserCacheMaxAge,
        template: {
          render: async (ctx, next, filePath) => {
            ctx.body = await ejs.renderFile(filePath, {
              passData :{
                isAdminContext: true, // Flag per distinguere contesto admin da pubblico
                globalPrefix: ital8Conf.globalPrefix,// prefisso globale per costruire URL corretti
                apiPrefix: ital8Conf.apiPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamare in modo corretto e flessibile le api ad esempio dei vari plugin
                adminPrefix: ital8Conf.adminPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamamare correttamente le pagine di admin con il corretto prefix
                pluginSys: pluginSys, // sistema dei plugin
                plugin: getObjectsToShareInWebPages,// quicondivo gli ogetti publidi dei plugin
                themeSys: themeSys,// thema dei temi con il tema in uso quello di --->default
                adminSystem: adminSystem, // Admin System con menu dinamico e servizi
                //baseThemePath: `${ital8Conf.baseThemePath}` ,OLD -> mi sa che non serve più// default -> "../themes/default" -->baseThemePath contiene il percorso di base del tema corrente
                filePath: filePath,
                href: ctx.href,
                query: ctx.query,
                ctx: ctx,// DA MIGLIORARE PER LA SICUREZZA
                //session: ctx.session || undefined, // DA MIGLIORARE qusta variabile serve al  Plugin simpleAccess per gestire la visualizazione dele sessioni nell'hook page
              },
              // Espandi le funzioni globali (es. __() per i18n)
              // IMPORTANTE: Le versioni locali (passData.plugin.simpleI18n.__) rimangono disponibili
              ...globalFunctions
            });
          },
          ext: ["ejs", "EJS"], // Koa v3: sintassi moderna array literals
        },
      })
    )
  );

}
//END ADESSO CARICO LA PARTE DI ADMIN SE RICHIESTA 



app.listen(ital8Conf.httpPort, console.log( "server started on port:" + ital8Conf.httpPort ));