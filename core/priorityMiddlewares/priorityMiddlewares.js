

///////////////////////////////////////////////////////////////////////////////////////////
// PRIORITY MIDDLEWARES LOADER
//
// Carica i middleware in sequenza corretta e garantita, prima di plugin e static servers
//
// ORDINE DI CARICAMENTO FISSO (non modificabile):
//   1. bodyParser  (CORE - sempre attivo)
//   2. session     (OPTIONAL - configurabile in ital8Config.json5)
//   3. router      (CORE - sempre attivo)
//   4. [futuri middleware opzionali]
//
// CORE MIDDLEWARES (hardcoded, sempre attivi):
//   - bodyParser: parsing body delle richieste (POST, PUT) - OBBLIGATORIO
//   - router: routing principale (@koa/router) - OBBLIGATORIO
//
// OPTIONAL MIDDLEWARES (configurabili):
//   - session: gestione sessioni utente (koa-session)
//     Configurabile in ital8Config.json5 → priorityMiddlewares.session
//     Default: true (attivo)
//
// NOTA IMPORTANTE sull'ordine:
//   - bodyParser DEVE essere prima di router (altrimenti ctx.request.body undefined)
//   - session DEVE essere prima di router (altrimenti ctx.session undefined)
//   - router DEVE essere ultimo per poter usare body e session nei route handler
///////////////////////////////////////////////////////////////////////////////////////////

const loadJson5 = require('../loadJson5');

function priorityMiddleware(app, ital8Conf){

    // Leggi configurazione priority middlewares (default: vuoto)
    const config = ital8Conf.priorityMiddlewares || {};

    // ========== CORE MIDDLEWARE 1: BODY PARSER (sempre attivo) ==========
    const bodyParser = require('koa-bodyparser');
    app.use(bodyParser());
    console.log('[PriorityMiddleware] ✓ bodyParser loaded (core, always active)');


    // ========== OPTIONAL MIDDLEWARE 1: SESSION ==========
    let koaSession = null;
    if (config.session !== false) {  // Default: true (attivo se non esplicitamente disabilitato)
        koaSession = require('koa-session').default || require('koa-session');
        const koaSessionConfig = loadJson5(__dirname + '/koaSession.json5');
        app.keys = koaSessionConfig.keys;

        // Applica il globalPrefix al path dei cookie di sessione
        // Se globalPrefix è vuoto, usa "/" come default (root)
        koaSessionConfig.CONFIG.path = ital8Conf.globalPrefix || '/';

        app.use(koaSession(koaSessionConfig.CONFIG, app));
        console.log('[PriorityMiddleware] ✓ session loaded (optional, enabled in config)');
    } else {
        console.log('[PriorityMiddleware] ✗ session SKIPPED (disabled in config)');
        console.log('[PriorityMiddleware]   WARNING: ctx.session will be undefined - authentication will not work');
    }


    // ========== CORE MIDDLEWARE 2: ROUTER (sempre attivo) ==========
    // ATTENZIONE: questo middleware ('@koa/router') deve essere caricato DOPO bodyParser e session
    // altrimenti body e sessioni non saranno disponibili nelle route handler
    const koaRouter = require('@koa/router');
    const router = new koaRouter();
    app.use(router.routes());
    app.use(router.allowedMethods());
    console.log('[PriorityMiddleware] ✓ router loaded (core, always active)');


    // ========== FUTURE OPTIONAL MIDDLEWARES ==========
    // Qui verranno aggiunti futuri middleware opzionali (es. urlRewriter)
    // Esempio:
    // if (config.urlRewriter === true) {
    //     const urlRewriterConfig = loadJson5(__dirname + '/urlRewriter.json5');
    //     const createUrlRewriter = require('./lib/urlRewriter');
    //     app.use(createUrlRewriter(urlRewriterConfig));
    //     console.log('[PriorityMiddleware] ✓ urlRewriter loaded (optional, enabled in config)');
    // }


    // Ritorna riferimenti ai middleware per uso successivo
    return{
        router: router,
        bodyParser: bodyParser,
        koaSession: koaSession  // Null se session disabilitato
    }

}// function priorityMiddleware(app, ital8Conf)



module.exports = priorityMiddleware;