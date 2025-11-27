
const koa = require('koa');
const app = new koa();
const koaClassicServer = require("koa-classic-server");
const ejs = require("ejs");
const loadJson5 = require('./core/loadJson5');
const ital8Conf = loadJson5('./ital8Config.json');
const path = require('path');

const priorityMiddlewares = require('./core/priorityMiddlewares/priorityMiddlewares.js')(app);
router = priorityMiddlewares.router ;
//const priorityMiddlewares(app); // carico i imidlware che vanno impostati in ordine preciso di caricamento

const pluginSys = new ( require("./core/pluginSys") )(); // carico il sistema di plugin e ne istanzio pure un ogetto
// carico le rotte di tutti i plugin
pluginSys.loadRoutes( router , `/${ital8Conf.apiPrefix}`);// il secondo paramentro è il primo prefix
const getObjectsToShareInWebPages = pluginSys.getObjectsToShareInWebPages();
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

// Static server per gli asset del tema attivo
// Gli asset sono accessibili tramite /theme-assets/css/, /theme-assets/js/, ecc.
app.use(
  koaClassicServer(
    path.join(__dirname, 'themes', ital8Conf.activeTheme, 'assets'),
    {
      urlPrefix: '/theme-assets',
      showDirContents: false,
      enableCaching: true,
      cacheMaxAge: 86400, // 24 ore di cache per asset del tema
    }
  )
);
console.log(`[themeSys] Asset del tema serviti da /theme-assets/ -> themes/${ital8Conf.activeTheme}/assets/`);

// koa classic server
app.use(
  koaClassicServer(
    __dirname + `${ital8Conf.wwwPath}`,
    (opt = {
      showDirContents: true,
      urlsReserved: [`/${ital8Conf.adminPrefix}`, `/${ital8Conf.apiPrefix}`, `/${ital8Conf.viewsPrefix}`], // '/admin','/api','/views' -> questi sarebbero i percorsi di default pero adesso sono configurabili
      enableCaching: false, // Disabilitato per facilitare i test durante lo sviluppo
      cacheMaxAge: 86400, // 24 ore di cache per file statici (usato solo se enableCaching: true)
      template: {
        render: async (ctx, next, filePath) => {
          ctx.body = await ejs.renderFile(filePath, {
            passData :{
              apiPrefix: ital8Conf.apiPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamare in modo corretto e flessibile le api ad esempio dei vari plugin
              //adminPrefix: ital8Conf.adminPrefix,//ATTENZIONE PER NESSUN MOTIVO DOVRÀ ESSERE PASSATO adminPrefix nelle pagine web non di amministrazione per non svelare ad utenti potenzialmente pericolosi la locazion della sezione di admin
              pluginSys: pluginSys, // sistema dei plugin
              plugin: getObjectsToShareInWebPages,// quicondivo gli ogetti publidi dei plugin
              themeSys: themeSys, // sistema dei temi
              //baseThemePath: `${ital8Conf.baseThemePath}` ,OLD -> mi sa che non serve più// default -> "../themes/default" -->baseThemePath contiene il percorso di base del tema corrente
              filePath: filePath,
              href: ctx.href,
              query: ctx.query,
              ctx: ctx,// DA MIGLIORARE PER LA SICUREZZA
              //session: ctx.session || undefined, // DA MIGLIORARE qusta variabile serve al  Plugin simpleAccess per gestire la visualizazione dele sessioni nell'hook page
            }
          });
        },
        ext: ["ejs", "EJS"], // Koa v3: sintassi moderna array literals
      },
    })
  )
);

//START ADESSO CARICO LA PARTE DI ADMIN SE RICHIESTA
if(ital8Conf.enableAdmin){// SE LA SEZIONE DI ADMIN È ABBILITATA

  app.use(
    koaClassicServer(
      path.join(__dirname, 'core', 'admin', 'webPages'),// punto alla cartella delle pagine di admin
      (opt = {
        index: ['index.ejs'], // Koa v3 + koa-classic-server v2.1.2: formato array raccomandato
        urlPrefix: `/${ital8Conf.adminPrefix}`,
        showDirContents: true,
        urlsReserved: [`/${ital8Conf.apiPrefix}`, `/${ital8Conf.viewsPrefix}`], // '/api','/views' -> questi sarebbero i percorsi di default pero adesso sono configurabili
        enableCaching: false, // Disabilitato per facilitare i test durante lo sviluppo
        cacheMaxAge: 3600, // 1 ora di cache per pagine admin (usato solo se enableCaching: true)
        template: {
          render: async (ctx, next, filePath) => {
            ctx.body = await ejs.renderFile(filePath, {
              passData :{
                apiPrefix: ital8Conf.apiPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamare in modo corretto e flessibile le api ad esempio dei vari plugin
                adminPrefix: ital8Conf.adminPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamamare correttamente le pagine di admin con il corretto prefix
                pluginSys: pluginSys, // sistema dei plugin
                plugin: getObjectsToShareInWebPages,// quicondivo gli ogetti publidi dei plugin
                themeSys: themeSys,// thema dei temi con il tema in uso quello di --->default
                //baseThemePath: `${ital8Conf.baseThemePath}` ,OLD -> mi sa che non serve più// default -> "../themes/default" -->baseThemePath contiene il percorso di base del tema corrente
                filePath: filePath,
                href: ctx.href,
                query: ctx.query,
                ctx: ctx,// DA MIGLIORARE PER LA SICUREZZA
                //session: ctx.session || undefined, // DA MIGLIORARE qusta variabile serve al  Plugin simpleAccess per gestire la visualizazione dele sessioni nell'hook page
              }
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