

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

    // ========== HEADER DI SICUREZZA (REVIEW.md → A5) ==========
    // Montato subito dopo il gate canonico e PRIMA di tutto il resto, così gli
    // header accompagnano anche le risposte prodotte dai gate a valle (503 di
    // manutenzione, 404 del reserved) e non solo quelle delle pagine.
    //
    // Limite dichiarato: NON copre le risposte generate da un'eccezione
    // propagata, perché `ctx.onerror` di Koa rimuove tutti gli header prima di
    // scrivere la sua risposta. È un limite del framework, non una scelta.
    const { createSecurityHeaders } = require('./securityHeaders');
    const securityHeaders = createSecurityHeaders({ ital8Conf });
    app.use(securityHeaders.middleware);
    console.log('[PriorityMiddleware] ✓ securityHeaders loaded (core, always active)');

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

        // `secure: "auto"` → booleano, deciso da https.enabled (REVIEW.md → A5).
        //
        // ⚠️ La traduzione non è zucchero sintattico: `koa-session` 7 valida le
        // proprie opzioni con zod e `secure` DEVE essere un booleano. Misurato:
        // passandogli la stringa "auto" il boot muore con uno ZodError
        // (« Expected boolean, received string ») e il CMS non parte. La scheda A5
        // proponeva proprio `"secure": "auto"` dicendo che koa-session lo
        // supporta: era vero per versioni precedenti, non per questa.
        //
        // Il sentinella "auto" resta nel file di configurazione perché dice a chi
        // legge cosa accade — il cookie è `secure` quando il sito è su HTTPS — e
        // qui viene risolto una volta sola al montaggio.
        //
        // Conseguenza da conoscere, nello scenario « HTTPS e HTTP in parallelo »
        // (https.enabled con AutoRedirect a false): il cookie di sessione viaggia
        // solo sul lato HTTPS, quindi il login funziona solo là. È il
        // comportamento voluto — un cookie di sessione non deve passare in chiaro
        // — ma è un cambiamento rispetto a prima.
        // Chiave assente = `"auto"`: il default del CODICE deve essere quello
        // sicuro, perché un'installazione che si aggiorna legge il vivo PRIMA che
        // il merge additivo gli aggiunga la chiave (vedi la nota sotto).
        const secureConfigurato = koaSessionConfig.CONFIG.secure === undefined
            ? 'auto'
            : koaSessionConfig.CONFIG.secure;

        if (secureConfigurato === 'auto') {
            const esito = resolveSecureCookieFlag(ital8Conf);
            koaSessionConfig.CONFIG.secure = esito.secure;
            if (esito.warning) console.warn(esito.warning);
        }

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



/**
 * Decide se il cookie di sessione va marcato `secure`.
 *
 * ⚠️ `secure: true` NON significa « il login funziona solo su HTTPS », come un
 * commento di questo file affermava: significa che la libreria `cookies`
 * **LANCIA** se le si chiede un cookie secure su una connessione in chiaro.
 * Misurato: `Error: Cannot send secure cookie over unencrypted connection` →
 * status **500** su ogni scrittura di sessione via HTTP, pagina di login
 * compresa.
 *
 * Quindi si marca `secure` solo quando l'applicazione **non è raggiungibile in
 * chiaro**: con `https.enabled` E il redirect attivo, la porta HTTP è servita
 * dal server di redirect, che non tocca le sessioni. Nello scenario « HTTPS e
 * HTTP in parallelo » il cookie resta non-secure — più debole, ma funzionante —
 * e il boot lo dice invece di lasciarlo scoprire da un 500.
 *
 * @param {object} ital8Conf
 * @returns {{secure: boolean, warning: string|null}}
 */
function resolveSecureCookieFlag(ital8Conf) {
    const httpsAttivo = ital8Conf?.https?.enabled === true;
    const redirectAttivo = ital8Conf?.https?.AutoRedirectHttpPortToHttpsPort === true;
    const soloHttps = httpsAttivo && redirectAttivo;

    if (httpsAttivo && !soloHttps) {
        return {
            secure: false,
            warning: '[PriorityMiddleware] \u26a0  cookie di sessione NON marcato `secure`: '
                + "l'app è servita anche in chiaro (https.enabled con "
                + 'AutoRedirectHttpPortToHttpsPort: false). Marcarlo farebbe fallire con 500 '
                + 'ogni richiesta HTTP. Attiva il redirect per chiudere il punto.',
        };
    }

    return { secure: soloHttps, warning: null };
}

module.exports = priorityMiddleware;
// Esportato per il presidio: la decisione sul cookie `secure` è una regola, e
// una regola va verificabile senza montare l'intera catena di middleware.
module.exports.resolveSecureCookieFlag = resolveSecureCookieFlag;