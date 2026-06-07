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
  if (!verdict.ok && custom && custom.enableLogging) {
    const client = (ctx && ctx.ip) || 'unknown';
    logger.warn(LOG_PREFIX, `BLOCCATA ${ctx.method} ${ctx.path} da ${client} — ${verdict.reason}`);
  }
  return verdict;
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
    // API per il futuro plugin admin (adminCsrfProtection)
    getConfig: () => JSON.parse(JSON.stringify(custom || {})),
    validateConfig: (newCustom) => validateConfig(newCustom),
  };
  return sharedApi;
}

module.exports = {
  pluginName,

  async loadPlugin(pluginSys, pathPluginFolder) {
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
    /** Inietta una config custom senza passare da loadPlugin (solo per i test). */
    _setConfigForTest(testCustom) {
      custom = testCustom;
      matcher = new PatternMatcher();
      sharedApi = null;
    },
  },
};
