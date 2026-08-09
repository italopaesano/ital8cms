

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

const path = require('path');
const loadJson5 = require('../loadJson5');
const { readState } = require('../cliBridge/stateFile');
const { createMaintenanceGate, createReservedGate, createSentinelGate } = require('./runtimeGate');

function priorityMiddleware(app, ital8Conf, options = {}){

    // Leggi configurazione priority middlewares (default: vuoto)
    const config = ital8Conf.priorityMiddlewares || {};
    const projectRoot = options.projectRoot || process.cwd();

    // ========== GATE B: REJECT NON-CANONICAL PATHS (opzionale, default on) ==========
    // Layer B della difesa contro il path/URL normalization mismatch (audit #1).
    // Rifiuta con 400 le richieste il cui path non è già canonico (dot-segment,
    // slash doppi, backslash, %2e/%2f/%5c/%00, control char). Registrato per PRIMO,
    // prima ancora di bodyParser/session: è un controllo puramente sintattico sul
    // path e non necessita di body né sessione.
    //
    // INVARIANTE: la canonicalizzazione nella guardia di adminAccessControl (Layer A)
    // è sempre attiva e chiude il bypass da sola; questo gate è difesa in profondità
    // aggiuntiva su TUTTA l'app. Disattivarlo (rejectNonCanonicalPaths:false) NON
    // riapre la vulnerabilità — fortemente raccomandato tenerlo attivo.
    // Default fail-safe: attivo salvo esplicito `false`.
    if (ital8Conf.rejectNonCanonicalPaths !== false) {
        const { isCanonicalPath } = require('../pathCanonicalizer');
        app.use(async (ctx, next) => {
            if (!isCanonicalPath(ctx.path)) {
                ctx.status = 400;
                ctx.body = 'Bad Request';
                return;
            }
            await next();
        });
        console.log('[PriorityMiddleware] ✓ rejectNonCanonicalPaths gate loaded (enabled)');
    } else {
        console.log('[PriorityMiddleware] ✗ rejectNonCanonicalPaths gate SKIPPED (disabled in config)');
    }

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


    // I due gate a runtime leggono lo stato UNA volta qui; da questo momento la
    // fonte di verità è l'oggetto gate in memoria, che il cliBridge commuta a caldo.
    const initialState = readState();

    // ========== RESERVED GATE (CLI-controlled reserved stop) ==========
    // NB: creato PRIMA del maintenance gate ma montato DOPO — le due cose sono
    // indipendenti. Va creato prima perché il maintenance gate ne interroga lo
    // stato per decidere se le proprie esenzioni abbiano ancora senso.
    const initialReservedState = initialState.reserved || 'running';
    const reservedGate = createReservedGate({
        ital8Conf,
        initialState: initialReservedState,
    });


    // ========== MAINTENANCE GATE (CLI-controlled public stop) ==========
    // Posizionato PRIMA del router così intercetta anche le rotte API.
    // Lascia passare /admin/* e /admin-theme-resources/* per non bloccare
    // l'amministrazione — ma solo finché la superficie riservata è aperta
    // (vedi exemptionsAreUseful in runtimeGate.js).
    const initialPublicState = initialState.public || 'running';
    const maintenanceGate = createMaintenanceGate({
        ital8Conf,
        projectRoot,
        initialState: initialPublicState,
        isReservedClosed: () => reservedGate.isClosed(),
    });
    app.use(maintenanceGate.middleware);
    console.log(`[PriorityMiddleware] ✓ maintenance gate loaded (initial public state: ${initialPublicState})`);

    // Montato DOPO il maintenance gate e PRIMA del router.
    //
    // Perché prima del router: deve vedere sia le pagine statiche sia le rotte API.
    // Perché dopo il maintenance gate: con entrambi chiusi il 503 uniforme del
    // maintenance ha la precedenza e non lascia trapelare nulla; se solo questo è
    // chiuso, il maintenance lascia passare e qui si applica il 404.
    // ========== SENTINEL GATE (slot pre-router del filtro richieste) ==========
    // Montato FRA maintenance e reserved:
    //   • dopo maintenance → in manutenzione il 503 resta uniforme su tutto. Se
    //     sentinel rispondesse 404 mentre il resto dà 503, quella differenza
    //     sarebbe essa stessa un'informazione.
    //   • prima di reserved → deve poter filtrare (e osservare) anche le
    //     scansioni dirette al pannello quando la superficie è aperta.
    //   • prima del router  → altrimenti non vedrebbe mai una rotta API matchata.
    //
    // Nasce SENZA motore: lo riceve in index.js dopo pluginSys.initialize(),
    // dal plugin `sentinel`. Senza plugin resta un pass-through da un `if`.
    const initialSentinelState = initialState.sentinel || 'running';
    const sentinelGate = createSentinelGate({
        ital8Conf,
        reservedGate,
        initialState: initialSentinelState,
    });
    app.use(sentinelGate.middleware);
    console.log(`[PriorityMiddleware] ✓ sentinel gate loaded (initial sentinel state: ${initialSentinelState}, engine: pending)`);

    app.use(reservedGate.middleware);
    console.log(`[PriorityMiddleware] ✓ reserved gate loaded (initial reserved state: ${initialReservedState})`);


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
        koaSession: koaSession,  // Null se session disabilitato
        maintenanceGate: maintenanceGate,  // Gate per public stop via CLI
        reservedGate: reservedGate,        // Gate per reserved stop via CLI
        sentinelGate: sentinelGate         // Slot del filtro richieste (motore iniettato in index.js)
    }

}// function priorityMiddleware(app, ital8Conf)



module.exports = priorityMiddleware;