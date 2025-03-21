
const koa = require('koa');
const app = new koa();
const koaClassicServer = require("koa-classic-server");
const ejs = require("ejs");
const ital8Conf = require('./ital8-conf.json');

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

// carico il themesys
const themeSys = new ( require('./core/themeSys') ) ( ital8Conf );

// koa classic server
app.use( 
  koaClassicServer(
    __dirname + `${ital8Conf.wwwPath}`,
    (opt = {
      showDirContents: true,
      urlsReserved: Array( `/${ital8Conf.adminPrefix}`,`/${ital8Conf.apiPrefix}`,`/${ital8Conf.viewsPrefix}`),//, '/admin','/api','/views' -> questi sarebbero i percorsi di defoult pero adesso sono configurabili  
      template: {
        render: async (ctx, next, filePath) => {
          ctx.body = await ejs.renderFile(filePath, {
            passData :{ 
              apiPrefix: ital8Conf.apiPrefix,// questo potrà essere usato all'interno della pagine web per poter richiamare in modo corretto e flessibile le api ad esempio dei vari plugin
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
        ext: Array("ejs", "EJS"),
      },
    })
  )
);



app.listen(ital8Conf.httpPort, console.log( "server started on port:" + ital8Conf.httpPort ));