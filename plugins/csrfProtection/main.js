'use strict';

/**
 * csrfProtection — Protezione anti Cross-Site Request Forgery.
 *
 * STRATEGIA (difesa in profondità):
 *   • Token sincronizzatore per-sessione: vive in ctx.session.csrfToken (cookie
 *     firmato), iniettato nelle pagine via <meta> + campo hidden, validato sui
 *     metodi mutanti.
 *   • Controllo Origin/Referer come secondo layer (token-fallback se assenti).
 *
 * PUNTO DI ENFORCEMENT (core):
 *   La validazione gira dentro pluginSys.#wrapHandlerWithAccessCheck (il wrap che
 *   avvolge OGNI rotta API), PRIMA del controllo auth → copre anche le rotte
 *   pubbliche come POST /login. Il core tira l'oggetto condiviso on-demand:
 *       const csrf = pluginSys.getSharedObject('csrfProtection');
 *       if (csrf) { const v = csrf.validateRequest(ctx); if (!v.ok) ...403... }
 *   Il plugin è OPZIONALE: se disabilitato getSharedObject ritorna null e il
 *   wrap salta la validazione (degradazione graziosa).
 *
 * MOTIVAZIONE ARCHITETTURALE (perché NON solo un middleware):
 *   I middleware dei plugin sono montati DOPO il router (vedi index.js), quindi
 *   non possono pre-bloccare una rotta API già matchata come POST /login. La
 *   validazione va invocata dentro il wrap del core (che gira nel router).
 *   Il middleware del plugin serve solo a generare il token per le pagine.
 *
 * INTEGRAZIONE CLIENT:
 *   • Hook 'head' inietta <meta name="csrf-token"> + interceptor fetch/XHR che
 *     aggiunge l'header X-CSRF-Token alle richieste same-origin mutanti.
 *   • Funzioni globali csrfField()/csrfToken() per i form classici.
 */

const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const logger = require('../../core/logger');
const escapeHtml = require('../../core/escapeHtml');
const PatternMatcher = require('../../core/patternMatcher');

const { generateToken } = require('./lib/tokenManager');
const requestGuard = require('./lib/requestGuard');
const { validate: validateConfig } = require('./lib/configValidator');
const { getInterceptorScript } = require('./lib/clientInterceptor');

const LOG_PREFIX = 'csrfProtection';
const pluginName = path.basename(__dirname);

let custom = null;      // blocco `custom` di pluginConfig.json5
let matcher = null;     // istanza PatternMatcher (per exemptPaths)
let sharedApi = null;   // singleton dell'oggetto condiviso (evita riallocazioni per-richiesta)
let pluginFolderRef = __dirname; // cartella del plugin (per reloadConfig)

// ── Audit in memoria (per la GUI del twin adminCsrfProtection) ──
// Ring-buffer leggero dei blocchi recenti + contatori. Non persistente (si
// azzera al riavvio): serve a vedere a colpo d'occhio attacchi / misconfig.
const MAX_RECENT_BLOCKS = 200;
let recentBlocks = [];
let totalBlocks = 0;
let blocksByReason = { missing_or_invalid_token: 0, origin_mismatch: 0 };

// ── Gestione token in sessione ───────────────────────────────────────────

/** Assicura che esista un token in sessione e lo ritorna (null se sessione assente). */
function ensureToken(ctx) {
  if (!ctx || !ctx.session) return null;
  if (!ctx.session.csrfToken) ctx.session.csrfToken = generateToken();
  return ctx.session.csrfToken;
}

/** Rigenera il token in sessione (rotazione, es. dopo un login riuscito). */
function rotateToken(ctx) {
  if (!ctx || !ctx.session) return null;
  ctx.session.csrfToken = generateToken();
  return ctx.session.csrfToken;
}

// ── Validazione richiesta (delega a requestGuard, aggiunge il logging) ─────

/**
 * Valida una richiesta. Chiamato dal route-wrap del core sui metodi mutanti.
 * @returns {{ ok: boolean, status?: number, error?: string, reason?: string }}
 */
function validateRequest(ctx) {
  const verdict = requestGuard.evaluate(ctx, custom, matcher);
  if (!verdict.ok) {
    recordBlock(ctx, verdict);
    if (custom && custom.enableLogging) {
      const client = (ctx && ctx.ip) || 'unknown';
      logger.warn(LOG_PREFIX, `BLOCCATA ${ctx.method} ${ctx.path} da ${client} — ${verdict.reason}`);
    }
  }
  return verdict;
}

/** Registra un blocco nell'audit in memoria (contatori + ring-buffer). */
function recordBlock(ctx, verdict) {
  totalBlocks += 1;
  const reasonKey = (verdict.reason && verdict.reason.startsWith('origin_mismatch'))
    ? 'origin_mismatch'
    : 'missing_or_invalid_token';
  blocksByReason[reasonKey] = (blocksByReason[reasonKey] || 0) + 1;
  recentBlocks.push({
    ts: new Date().toISOString(),
    method: ctx && ctx.method,
    path: ctx && ctx.path,
    reason: verdict.reason,
    ip: (ctx && ctx.ip) || 'unknown',
  });
  if (recentBlocks.length > MAX_RECENT_BLOCKS) {
    recentBlocks = recentBlocks.slice(-MAX_RECENT_BLOCKS);
  }
}

/** Statistiche per la Vista Dati della GUI. */
function getStats() {
  return {
    enabled: custom ? custom.enabled !== false : false,
    originCheckEnabled: !!(custom && custom.originCheck && custom.originCheck.enabled !== false),
    protectedMethods: (custom && custom.protectedMethods) || requestGuard.DEFAULT_METHODS,
    exemptCount: (custom && Array.isArray(custom.exemptPaths)) ? custom.exemptPaths.length : 0,
    totalBlocks,
    blocksByReason: { ...blocksByReason },
  };
}

/** Blocchi recenti (più recente prima), opzionalmente limitati. */
function getRecentBlocks(limit) {
  const n = (Number.isFinite(limit) && limit > 0) ? limit : 100;
  return recentBlocks.slice(-n).reverse();
}

/** Re-legge pluginConfig.json5 e aggiorna `custom` a caldo (hot-reload). */
function reloadConfig() {
  try {
    const cfg = loadJson5(path.join(pluginFolderRef, 'pluginConfig.json5'));
    custom = cfg.custom || {};
    matcher = new PatternMatcher();
  } catch (err) {
    logger.warn(LOG_PREFIX, `reloadConfig fallito: ${err.message}`);
  }
  return JSON.parse(JSON.stringify(custom));
}

/**
 * "CSRF tester": valuta una richiesta sintetica contro la policy corrente.
 * Utile nella GUI per capire come metodo/path/origin/token si combinano.
 * @param {object} input - { method, path, siteOrigin, requestOrigin, tokenProvided }
 * @returns {{ ok, skipped?, reason?, status? }}
 */
function simulate(input = {}) {
  const method = String(input.method || 'POST');
  const reqPath = String(input.path || '/');
  let protocol = 'http';
  let host = 'localhost:3000';
  try {
    const u = new URL(String(input.siteOrigin || 'http://localhost:3000'));
    protocol = u.protocol.replace(':', '');
    host = u.host;
  } catch { /* siteOrigin non valido: usa i default */ }

  const headers = {};
  if (input.requestOrigin) headers.origin = String(input.requestOrigin);
  const sessionToken = 'SIMULATED_TOKEN';
  if (input.tokenProvided) headers['x-csrf-token'] = sessionToken;

  const fakeCtx = {
    method,
    path: reqPath,
    protocol,
    host,
    session: { csrfToken: sessionToken },
    request: { body: {} },
    get: (name) => headers[String(name).toLowerCase()],
  };
  return requestGuard.evaluate(fakeCtx, custom, matcher);
}

// ── Markup helpers per i template ─────────────────────────────────────────

/** `<input type="hidden" name="_csrf" value="…">` per un dato ctx (o '' se no sessione). */
function csrfFieldFor(ctx) {
  const token = ensureToken(ctx);
  if (!token) return '';
  const fieldName = (custom && custom.tokenFieldName) || '_csrf';
  return `<input type="hidden" name="${escapeHtml(fieldName)}" value="${escapeHtml(token)}">`;
}

// Le funzioni globali ricevono passData (come `__` di simpleI18n) → leggono passData.ctx.
function csrfFieldGlobal(passData) {
  return csrfFieldFor(passData && passData.ctx);
}
function csrfTokenGlobal(passData) {
  return ensureToken(passData && passData.ctx) || '';
}

// ── Oggetto condiviso (singleton) ─────────────────────────────────────────
function buildSharedApi() {
  if (sharedApi) return sharedApi;
  sharedApi = {
    // Usato dal route-wrap del core
    validateRequest,
    // Gestione token (usata da adminUsers per la rotazione al login)
    ensureToken,
    rotateToken,
    getToken: (ctx) => ensureToken(ctx),
    // API per il plugin admin gemello (adminCsrfProtection)
    getStats,                                        // KPI + contatori blocchi
    getRecentBlocks,                                 // audit dei blocchi recenti
    simulate,                                        // CSRF tester
    getConfig: () => JSON.parse(JSON.stringify(custom || {})),
    validateConfig: (newCustom) => validateConfig(newCustom),
    reloadConfig,                                    // hot-reload dopo Save dell'editor
  };
  return sharedApi;
}

module.exports = {
  pluginName,

  async loadPlugin(pluginSys, pathPluginFolder) {
    pluginFolderRef = pathPluginFolder;
    const cfg = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};
    matcher = new PatternMatcher();

    const result = validateConfig(custom);
    result.warnings.forEach((w) => logger.warn(LOG_PREFIX, w));
    if (!result.valid) {
      result.errors.forEach((e) => logger.error(LOG_PREFIX, e));
      if (custom.strictValidation) {
        throw new Error('[csrfProtection] validazione configurazione fallita (strictValidation=true)');
      }
      logger.warn(LOG_PREFIX, 'configurazione con errori: il plugin prosegue, controlla pluginConfig.json5');
    }

    if (custom.enabled === false) {
      logger.info(LOG_PREFIX, 'disabilitato (custom.enabled=false) — nessuna validazione CSRF');
      return;
    }

    const oc = custom.originCheck && custom.originCheck.enabled !== false;
    const methods = (custom.protectedMethods || requestGuard.DEFAULT_METHODS).join(',');
    logger.info(LOG_PREFIX, `attivo — token per-sessione + originCheck=${oc}; metodi protetti: ${methods}`);
  },

  /**
   * Middleware: assicura che ogni navigazione (pagina) abbia un token in sessione,
   * così è disponibile per l'iniezione nel <meta>/form e per le successive POST.
   * Gira DOPO il router (come ogni middleware plugin) ma PRIMA degli static server,
   * quindi prima del rendering delle pagine.
   */
  getMiddlewareToAdd() {
    if (custom && custom.enabled === false) return [];
    return [
      async (ctx, next) => {
        if (ctx.session) ensureToken(ctx);
        await next();
      },
    ];
  },

  /**
   * Hook 'head': inietta <meta> col token + interceptor fetch/XHR in ogni pagina
   * (i temi chiamano pluginSys.hookPage('head', passData) dentro head.ejs).
   */
  getHooksPage() {
    const map = new Map();
    if (custom && custom.enabled === false) return map;

    map.set('head', (passData) => {
      const ctx = passData && passData.ctx;
      const token = ensureToken(ctx);
      if (!token) return ''; // sessione assente → niente token, niente iniezione
      const metaName = (custom && custom.metaName) || 'csrf-token';
      const headerName = (custom && custom.tokenHeaderName) || 'X-CSRF-Token';
      const meta = `<meta name="${escapeHtml(metaName)}" content="${escapeHtml(token)}">`;
      return `${meta}\n${getInterceptorScript({ metaName, headerName })}`;
    });

    return map;
  },

  /** Oggetto condiviso (pull via pluginSys.getSharedObject('csrfProtection')). */
  getObjectToShareToOthersPlugin(/* forPlugin */) {
    if (custom && custom.enabled === false) return null;
    return buildSharedApi();
  },

  /** Funzioni globali per i template (autorizzate in ital8Config.globalFunctionsWhitelist). */
  getGlobalFunctionsForTemplates() {
    return {
      csrfField: csrfFieldGlobal,
      csrfToken: csrfTokenGlobal,
    };
  },

  /** Versioni locali (passData.plugin.csrfProtection.*) sempre disponibili. */
  getObjectToShareToWebPages() {
    return {
      csrfField: csrfFieldGlobal,
      csrfToken: csrfTokenGlobal,
    };
  },

  // ── Esposti per i test unitari ──
  _internals: {
    validateRequest,
    ensureToken,
    rotateToken,
    csrfFieldFor,
    buildSharedApi,
    getStats,
    getRecentBlocks,
    simulate,
    reloadConfig,
    /** Inietta una config custom senza passare da loadPlugin (solo per i test). */
    _setConfigForTest(testCustom) {
      custom = testCustom;
      matcher = new PatternMatcher();
      sharedApi = null;
      // Azzera l'audit in memoria per test deterministici
      recentBlocks = [];
      totalBlocks = 0;
      blocksByReason = { missing_or_invalid_token: 0, origin_mismatch: 0 };
    },
  },
};
