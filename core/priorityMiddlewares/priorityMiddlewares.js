

///////////////////////////////////////////////////////////////////////////////////////////
// questo file conterrà una funzione per caricare nella sequenza corretta i midlware che
// ne hanno bisogno , ad esempio koa-session deve essere caricato prima di '@koa/router
// per far si che le sessioni siano disponibili all'interno delle rotte , qusto implica che
// devono essere gestiti in un unica sequenza e non potranno essere gestiti da ogni plugin
//separatamente , per essere caricati solo se richiesti da dei plugin vi saraà un elenco dei
//priority midlware che i vari plugin potranno richiedere di installare
///////////////////////////////////////////////////////////////////////////////////////////

const loadJson = require('../jsonLoader');

function priorityMiddleware(app){

    const bodyParser = require('koa-bodyparser');
    app.use(bodyParser());


    const koaSession = require('koa-session').default || require('koa-session');//dovuto al fatto che originariamente è un modulo sviluppato per ES module
    const koaSessionConfig = loadJson(__dirname + '/koaSession.json');// configurazione di koa session
    app.keys = koaSessionConfig.keys;// importo le chiavi per la sicurezza  (necessaria per la firma delle sessioni)
    app.use(koaSession(koaSessionConfig.CONFIG, app));


    //START LIBRERIE DI ROUTING ----ATTENZIONE---- questo midlware ('@koa/router') deve essere caricato dopo il midlware delle sessioni altrimenti le sessioni non saranno disponibili nelle varie rotte
    const koaRouter = require('@koa/router');
    const router = new koaRouter();// { prefix: '/api' } = iniziale del percorso in maniera predfinita Es const router = new Router({ prefix: '/api' });
    app.use(router.routes());
    app.use(router.allowedMethods());
    //END LIBRERIE DI ROUTING 

    

    
    return{// rirona imidlware usati per possibilimodiche successive ad esempo router serve refernzialo perchè usato anche nel pluginSys
        router: router,
        bodyParser: bodyParser,
        koaSession: koaSession
    }

}// function priorityMiddleware(app){



module.exports = priorityMiddleware;