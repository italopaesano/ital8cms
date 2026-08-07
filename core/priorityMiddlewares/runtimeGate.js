const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

// Percorsi pubblici esenti dal gate quando `maintenance.exemptPaths` è ASSENTE.
//
// Perché un default nel codice e non solo nel config: il merge additivo del boot
// (reconcileSchemaVersions) aggiunge al file vivo solo le chiavi **top-level**
// nuove. Poiché `maintenance` esiste già, una chiave *annidata* come `exemptPaths`
// non verrebbe propagata alle installazioni esistenti, che resterebbero senza
// login raggiungibile durante la manutenzione. Con questo default la decisione
// vale anche per chi aggiorna; una lista **esplicitamente vuota** (`[]`) resta
// rispettata e significa "massima chiusura".
const DEFAULT_EXEMPT_PATHS = [
  '/pluginPages/adminUsers/login',  // pagina di login (il prefisso copre anche login.ejs)
  '/api/adminUsers/login',          // endpoint di autenticazione
];

// Normalizza la lista di percorsi esenti dichiarata in config
// (`maintenance.exemptPaths`), scartando le voci inutilizzabili.
//
// GUARDIA DI SICUREZZA: si accettano solo stringhe non vuote che iniziano con '/'.
// Senza questo filtro una stringa vuota renderebbe vero ogni `startsWith()`,
// esentando l'INTERO sito e vanificando la manutenzione.
function normalizeExemptPaths(rawExemptPaths) {
  if (!Array.isArray(rawExemptPaths)) return [];
  return rawExemptPaths.filter((entry) => typeof entry === 'string' && entry.startsWith('/'));
}

// Un percorso è esente se ricade sotto i due prefissi admin (sempre) oppure sotto
// una delle voci di `exemptPaths` (configurabile). Il confronto è per PREFISSO,
// come per i prefissi admin: `/api/adminUsers/login` copre anche le sue
// sotto-risorse, e `/pluginPages/adminUsers/login` copre sia `login` sia
// `login.ejs` (utile con `hideExtension` attivo).
// I percorsi di `exemptPaths` si scrivono SENZA `globalPrefix`: viene anteposto qui.
function isExemptPath(reqPath, adminPrefix, adminThemeResourcesPrefix, globalPrefix, exemptPaths) {
  const base = globalPrefix || '';
  if (adminPrefix && reqPath.startsWith(`${base}/${adminPrefix}`)) return true;
  if (adminThemeResourcesPrefix && reqPath.startsWith(`${base}/${adminThemeResourcesPrefix}`)) return true;
  for (const exemptPath of normalizeExemptPaths(exemptPaths)) {
    if (reqPath.startsWith(`${base}${exemptPath}`)) return true;
  }
  return false;
}

function createMaintenanceGate(options) {
  const {
    ital8Conf,
    projectRoot,
    initialState = 'running',
    // Predicato sullo stato della superficie riservata. Vedi il commento su
    // `exemptionsAreUseful()` più sotto: quando la superficie è chiusa le
    // esenzioni di questo gate non servono più a nessuno e diventano un canale
    // di enumerazione, quindi vengono sospese.
    isReservedClosed = () => false,
  } = options;

  let publicState = initialState;

  const adminPrefix = ital8Conf.adminPrefix || 'admin';
  const adminThemeResourcesPrefix = ital8Conf.adminThemeResourcesPrefix || 'admin-theme-resources';
  const globalPrefix = ital8Conf.globalPrefix || '';

  const maintenanceConf = ital8Conf.maintenance || {};
  const rawPagePath = maintenanceConf.pagePath || './core/maintenancePage.ejs';
  const pagePath = path.isAbsolute(rawPagePath) ? rawPagePath : path.resolve(projectRoot, rawPagePath);
  const retryAfter = Number.isFinite(maintenanceConf.retryAfterSeconds) ? maintenanceConf.retryAfterSeconds : 600;
  // Chiave assente → default incorporati (copre le installazioni aggiornate, dove
  // il merge additivo non propaga le chiavi annidate). Chiave presente → si onora
  // quanto dichiarato, `[]` incluso (massima chiusura).
  if (maintenanceConf.exemptPaths !== undefined && !Array.isArray(maintenanceConf.exemptPaths)) {
    console.warn(
      '[maintenanceGate] maintenance.exemptPaths non è un array: nessun percorso ' +
      'pubblico sarà esente durante la manutenzione (login incluso)'
    );
  }
  const exemptPaths = maintenanceConf.exemptPaths === undefined
    ? [...DEFAULT_EXEMPT_PATHS]
    : normalizeExemptPaths(maintenanceConf.exemptPaths);

  async function renderMaintenance(ctx) {
    let html;
    try {
      html = await ejs.renderFile(pagePath, {
        retryAfterSeconds: retryAfter,
        ctx,
      });
    } catch (err) {
      console.warn(`[maintenanceGate] errore rendering ${pagePath}: ${err.message}`);
      html = '<!DOCTYPE html><meta charset="utf-8"><title>Torniamo subito</title>' +
             '<h1>Torniamo subito</h1><p>Il sito è temporaneamente non disponibile.</p>';
    }
    ctx.status = 503;
    ctx.set('Retry-After', String(retryAfter));
    ctx.set('X-Robots-Tag', 'noindex');
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = html;
  }

  // Le esenzioni di questo gate (prefissi admin + `maintenance.exemptPaths`)
  // esistono per UNA ragione: durante la manutenzione un amministratore deve
  // poter entrare e lavorare. Se la superficie riservata è chiusa quella ragione
  // decade — non entra più nessuno — e resta solo l'effetto collaterale:
  // i percorsi esenti rispondono 404 mentre tutto il resto risponde 503, e la
  // differenza enumera con precisione la superficie riservata (verificato).
  // Sospendendo le esenzioni, con entrambi i gate chiusi il sito risponde 503
  // ovunque: nessuna differenza da cui dedurre alcunché.
  function exemptionsAreUseful() {
    return !isReservedClosed();
  }

  async function middleware(ctx, next) {
    if (publicState === 'running') return next();
    if (exemptionsAreUseful() &&
        isExemptPath(ctx.path, adminPrefix, adminThemeResourcesPrefix, globalPrefix, exemptPaths)) {
      return next();
    }
    await renderMaintenance(ctx);
  }

  return {
    middleware,
    setState(newState) {
      if (newState !== 'running' && newState !== 'stopped') {
        throw new Error(`maintenanceGate: stato non valido ${newState}`);
      }
      publicState = newState;
    },
    getState() { return publicState; },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESERVED GATE (CLI-controlled reserved-surface stop)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Gemello speculare del maintenance gate, nello stesso modulo perché condividono
// natura (gate a runtime, commutabili senza riavvio) e insieme di prefissi.
//
// PERIMETRO — tutto ciò che sta DIETRO l'autenticazione:
//   • rotte con `access.requiresAuth: true`        → enforced da pluginSys (route-wrap)
//   • rotte con `access.isAuthEntryPoint: true`    → idem (login/logout: pubbliche
//                                                    per necessità, ma parte della
//                                                    superficie riservata)
//   • pagine con regola `requiresAuth`/`isAuthEntryPoint` in accessControl.json5
//                                                  → enforced da adminAccessControl
//   • i due prefissi admin (pannello + risorse del tema admin) → enforced QUI
//
// Il pannello admin è un SOTTOINSIEME della superficie riservata: chiudere la
// superficie lo rende irraggiungibile anche con `enableAdmin: true` (le sue
// pagine servono a nulla se ogni chiamata API dietro di esse è chiusa).
//
// SIMMETRIA COI DUE PREFISSI: il maintenance gate li ESENTA (durante la
// manutenzione l'admin deve poter lavorare); questo gate li PRENDE DI MIRA.
// Stessa costante, uso opposto — di qui la convivenza nello stesso file.
//
// RISPOSTA — 404 nudo, mai 403 né redirect: in assetto vetrina "chiuso" deve
// essere indistinguibile da "mai esistito". Nessun header segnaletico
// (X-Robots-Tag e simili sarebbero essi stessi un indizio).
//
// PERCHÉ `deny()` È ESPOSTO: i tre punti di enforcement (questo middleware, il
// route-wrap di pluginSys, il middleware di adminAccessControl) devono rispondere
// in modo IDENTICO, altrimenti la differenza fra le risposte ridiventa un canale
// di fingerprinting. Un solo posto che produce il 404 → nessuna divergenza
// possibile.
//
// COME `deny()` PRODUCE IL 404 — il punto più delicato dell'intera feature.
//
// Non basta rispondere "404": la risposta deve avere la STESSA FORMA di quella
// che il sito dà per un URL che non esiste davvero, altrimenti la differenza
// rende ogni percorso riservato enumerabile — cioè esattamente ciò che l'assetto
// vetrina promette di impedire.
//
// E le forme sono DUE, misurate sul server reale:
//   • sotto `apiPrefix` → 404 di default di Koa: `text/plain`, corpo "Not Found"
//     (9 byte). Nessuno static server serve `/api/*` — è in `urlsReserved` di
//     tutti — quindi una rotta inesistente arriva in fondo alla catena senza che
//     nessuno la gestisca.
//   • altrove → pagina HTML di koa-classic-server (325 byte) con `no-store`,
//     CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
//
// TENTATIVO SCARTATO — delegare invece di imitare. L'idea era riscrivere il path
// su una sentinella inesistente e lasciar proseguire la richiesta, così il 404 lo
// produceva lo static server stesso: zero duplicazione, nessuna deriva possibile.
// **Non funziona ed è pericoloso:** koa-classic-server gira con
// `useOriginalUrl: true` (suo default) e legge `ctx.originalUrl`, che la
// riscrittura di `ctx.path` non tocca. Verificato sul server reale: con la
// superficie CHIUSA `/admin/` tornava **200 con la dashboard** e la pagina di
// login **200 con il form**. La delega trasformava la chiusura in un pass-through
// completo — molto peggio del difetto che voleva correggere. La fabbricazione,
// per quanto meno elegante, è l'unica che non può essere aggirata.
//
// La duplicazione della pagina qui sotto è quindi deliberata, e presidiata da un
// test che confronta BYTE PER BYTE la risposta riservata con un 404 autentico:
// se koa-classic-server cambia la sua pagina, il test fallisce invece di lasciar
// divergere le due risposte in silenzio.
// TODO(koa-classic-server): chiedere al maintainer di esportare il renderer
// della error page, così questo mirror può sparire.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Mirror della error page di koa-classic-server v5.1.0 (verificata byte per byte).
const NOT_FOUND_HTML = '<!DOCTYPE html>\n' +
  '<html>\n' +
  '<head>\n' +
  '  <meta charset="UTF-8">\n' +
  '  <meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
  '  <title>URL not found</title>\n' +
  '</head>\n' +
  '<body>\n' +
  '  <h1>Not Found</h1>\n' +
  '  <h3>The requested URL was not found on this server.</h3>\n' +
  '</body>\n' +
  '</html>';

const NOT_FOUND_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// Confronto per SEGMENTO, non per semplice prefisso di stringa: `startsWith`
// nudo su `/admin` cattura anche `/admin-guide.ejs`, cioè contenuto pubblico
// legittimo (verificato: dava 404 a superficie chiusa). Un prefisso vale quando
// il path È il prefisso oppure prosegue con `/`.
function pathIsUnderSegment(reqPath, prefixPath) {
  return reqPath === prefixPath || reqPath.startsWith(`${prefixPath}/`);
}

// Un path appartiene alla superficie riservata "per prefisso" quando ricade sotto
// il pannello admin o sotto le risorse del tema admin. Le risorse del tema NON
// sono coperte da alcuna regola di accessControl.json5 (che conosce solo `/admin`
// e `/admin/**`): senza questa riga resterebbero servite a chiunque e
// rivelerebbero l'esistenza del pannello.
function isReservedPrefixPath(reqPath, adminPrefix, adminThemeResourcesPrefix, globalPrefix) {
  const base = globalPrefix || '';
  if (adminPrefix && pathIsUnderSegment(reqPath, `${base}/${adminPrefix}`)) return true;
  if (adminThemeResourcesPrefix && pathIsUnderSegment(reqPath, `${base}/${adminThemeResourcesPrefix}`)) return true;
  return false;
}

// Normalizzazione per il confronto con l'indice dei path riservati.
//
// L'indice è costruito dai path che pluginSys registra su @koa/router, che gira
// con le opzioni di default `sensitive: false` e `strict: false`: il router
// risponde quindi anche a `/API/adminUsers/login` e `/api/adminUsers/login/`.
// Un confronto esatto lasciava scoperte proprio quelle due forme (verificato:
// `OPTIONS /api/adminUsers/login/` → 200 con `Allow: POST`, e
// `GET /API/adminUsers/login` → 405), riaprendo il canale 405 che l'indice
// esisteva per chiudere. Il gate deve normalizzare come normalizza il router.
function normalizeReservedPath(reqPath) {
  if (typeof reqPath !== 'string' || reqPath === '') return '';
  const withoutTrailingSlash = reqPath.length > 1 && reqPath.endsWith('/')
    ? reqPath.slice(0, -1)
    : reqPath;
  return withoutTrailingSlash.toLowerCase();
}

function createReservedGate(options) {
  const {
    ital8Conf,
    initialState = 'running',
  } = options;

  let reservedState = initialState;

  // Path esatti delle rotte riservate, iniettati DOPO il caricamento dei plugin
  // (il gate nasce prima che le rotte esistano). Vuoto = nessuna copertura per
  // path: resta comunque attivo il route-wrap di pluginSys, che e la difesa
  // principale sulle rotte. Vedi pluginSys.getReservedRoutePaths().
  let reservedRoutePaths = new Set();

  const adminPrefix = ital8Conf.adminPrefix || 'admin';
  const adminThemeResourcesPrefix = ital8Conf.adminThemeResourcesPrefix || 'admin-theme-resources';
  const globalPrefix = ital8Conf.globalPrefix || '';

  const apiPrefix = ital8Conf.apiPrefix || 'api';

  // Risposta unica per tutti i punti di enforcement, nella forma che il sito
  // userebbe per quella stessa famiglia di path (vedi commento in testa alla
  // sezione).
  function deny(ctx) {
    ctx.status = 404;

    if (pathIsUnderSegment(ctx.path, `${globalPrefix || ''}/${apiPrefix}`)) {
      // Nessuno static server serve /api/*: qui il 404 lo emette Koa.
      ctx.type = 'text/plain; charset=utf-8';
      ctx.body = 'Not Found';
      return;
    }

    for (const [header, value] of Object.entries(NOT_FOUND_HEADERS)) {
      ctx.set(header, value);
    }
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = NOT_FOUND_HTML;
  }

  function isReservedPath(reqPath) {
    return isReservedPrefixPath(reqPath, adminPrefix, adminThemeResourcesPrefix, globalPrefix) ||
      reservedRoutePaths.has(normalizeReservedPath(reqPath));
  }

  async function middleware(ctx, next) {
    if (reservedState === 'running') return next();
    if (!isReservedPath(ctx.path)) return next();
    deny(ctx);
  }

  return {
    middleware,
    deny,
    isReservedPath,
    setReservedRoutePaths(paths) {
      const source = paths instanceof Set ? paths : new Set(paths || []);
      reservedRoutePaths = new Set([...source].map(normalizeReservedPath));
    },
    setState(newState) {
      if (newState !== 'running' && newState !== 'stopped') {
        throw new Error(`reservedGate: stato non valido ${newState}`);
      }
      reservedState = newState;
    },
    getState() { return reservedState; },
    isClosed() { return reservedState === 'stopped'; },
  };
}

module.exports = {
  createMaintenanceGate,
  createReservedGate,
  isExemptPath,
  isReservedPrefixPath,
  normalizeExemptPaths,
  DEFAULT_EXEMPT_PATHS,
};
