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

  async function middleware(ctx, next) {
    if (publicState === 'running') return next();
    if (isExemptPath(ctx.path, adminPrefix, adminThemeResourcesPrefix, globalPrefix, exemptPaths)) {
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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Un path appartiene alla superficie riservata "per prefisso" quando ricade sotto
// il pannello admin o sotto le risorse del tema admin. Le risorse del tema NON
// sono coperte da alcuna regola di accessControl.json5 (che conosce solo `/admin`
// e `/admin/**`): senza questa riga resterebbero servite a chiunque e
// rivelerebbero l'esistenza del pannello.
function isReservedPrefixPath(reqPath, adminPrefix, adminThemeResourcesPrefix, globalPrefix) {
  const base = globalPrefix || '';
  if (adminPrefix && reqPath.startsWith(`${base}/${adminPrefix}`)) return true;
  if (adminThemeResourcesPrefix && reqPath.startsWith(`${base}/${adminThemeResourcesPrefix}`)) return true;
  return false;
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

  // Risposta unica per tutti i punti di enforcement (vedi commento sopra).
  function deny(ctx) {
    ctx.status = 404;
    ctx.type = 'text/plain; charset=utf-8';
    ctx.body = 'Not Found';
  }

  async function middleware(ctx, next) {
    if (reservedState === 'running') return next();
    const isReserved =
      isReservedPrefixPath(ctx.path, adminPrefix, adminThemeResourcesPrefix, globalPrefix) ||
      reservedRoutePaths.has(ctx.path);
    if (!isReserved) return next();
    deny(ctx);
  }

  return {
    middleware,
    deny,
    setReservedRoutePaths(paths) {
      reservedRoutePaths = paths instanceof Set ? paths : new Set(paths || []);
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
