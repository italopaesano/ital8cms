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

module.exports = { createMaintenanceGate, isExemptPath, normalizeExemptPaths, DEFAULT_EXEMPT_PATHS };
