/**
 * rateLimiter — Plugin di rate limiting / anti brute-force.
 *
 * LIVELLO 1 (questo file): GUARD via oggetto condiviso.
 *   I plugin che servono rotte sensibili (es. adminUsers per il login) tirano
 *   on-demand l'oggetto condiviso e invocano il guard dentro l'handler:
 *
 *     const rl = pluginSys.getSharedObject('rateLimiter');
 *     if (rl && rl.checkCtx(ctx, 'adminLogin').blocked) { ...nega... }
 *     rl?.recordFailureCtx(ctx, 'adminLogin');   // tentativo fallito
 *     rl?.recordSuccessCtx(ctx, 'adminLogin');   // tentativo riuscito
 *
 *   La chiave di rate limit è (IP + ruleName). Le policy stanno in
 *   protectedRoutes.json5, con default in pluginConfig.json5 → custom.defaults.
 *
 * MOTIVAZIONE ARCHITETTURALE:
 *   I middleware dei plugin vengono montati DOPO il router (vedi index.js), per
 *   cui non possono pre-bloccare una rotta API già matchata come POST /login.
 *   Il blocco va quindi invocato DENTRO l'handler, tramite l'oggetto condiviso.
 *   Il LIVELLO 2 (futuro) aggiungerà un middleware che applica il long block in
 *   modo globale sulle pagine fall-through.
 */

'use strict';

const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const logger = require('../../core/logger');
const PatternMatcher = require('../../core/patternMatcher');

const RateLimitEngine = require('./lib/rateLimitEngine');
const StateStore = require('./lib/stateStore');
const AttemptLog = require('./lib/attemptLog');
const { resolveClientId } = require('./lib/keyResolver');
const { validate } = require('./lib/configValidator');

const LOG_PREFIX = 'rateLimiter';

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));
const isDebugMode = ital8Conf.debugMode >= 1;

let pluginFolder = null;
let custom = null; // pluginConfig.custom
let cachedRules = null; // Map<string, object> ruleName → override
let engine = null;
let stateStore = null;
let attemptLog = null;
let sweepTimer = null;

/**
 * Carica le regole da protectedRoutes.json5 in una Map ruleName → override.
 * In debug rilegge ad ogni chiamata (modifiche immediate); in produzione cache.
 */
function loadRules() {
  if (!isDebugMode && cachedRules) {
    return cachedRules;
  }
  const map = new Map();
  try {
    const data = loadJson5(path.join(pluginFolder, 'protectedRoutes.json5'));
    const rules = Array.isArray(data.rules) ? data.rules : [];
    for (const rule of rules) {
      if (rule && typeof rule.name === 'string' && !map.has(rule.name)) {
        map.set(rule.name, rule);
      }
    }
  } catch (err) {
    logger.warn(LOG_PREFIX, `Lettura protectedRoutes.json5 fallita: ${err.message}`);
  }
  cachedRules = map;
  return map;
}

/** Risolve la policy effettiva per una regola: default + override. */
function resolvePolicy(ruleName) {
  const d = custom.defaults;
  const o = loadRules().get(ruleName) || {};
  const pick = (field) => (o[field] !== undefined ? o[field] : d[field]);
  return {
    findWindowSeconds: pick('findWindowSeconds'),
    maxFailures: pick('maxFailures'),
    shortBlockSeconds: pick('shortBlockSeconds'),
    maxShortBlocks: pick('maxShortBlocks'),
    longBlockSeconds: pick('longBlockSeconds'),
    escalationResetSeconds: pick('escalationResetSeconds'),
  };
}

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    pluginFolder = pathPluginFolder;

    const cfg = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};

    if (custom.enabled === false) {
      logger.info(LOG_PREFIX, 'disabilitato (custom.enabled=false) — guard inattivo');
      return;
    }

    // Validazione configurazione + regole
    let rulesData = {};
    try {
      rulesData = loadJson5(path.join(pathPluginFolder, 'protectedRoutes.json5'));
    } catch (err) {
      logger.warn(LOG_PREFIX, `protectedRoutes.json5 non leggibile: ${err.message}`);
    }
    const result = validate(custom, rulesData);
    result.warnings.forEach((w) => logger.warn(LOG_PREFIX, w));
    if (!result.valid) {
      result.errors.forEach((e) => logger.error(LOG_PREFIX, e));
      if (custom.strictValidation) {
        throw new Error('[rateLimiter] validazione configurazione fallita (strictValidation=true)');
      }
      logger.warn(LOG_PREFIX, 'validazione con errori: il plugin prosegue, controlla la configurazione');
    }

    // Audit log (opzionale)
    if (custom.log && custom.log.enabled) {
      attemptLog = new AttemptLog(pathPluginFolder, custom.log);
      attemptLog.init();
    }

    // Motore
    engine = new RateLimitEngine({
      resolvePolicy,
      onEvent: (ev) => {
        if (custom.enableLogging) {
          const blockInfo = ev.retryAfterSeconds
            ? ` → blocco ${ev.tier} per ${ev.retryAfterSeconds}s`
            : '';
          logger.info(LOG_PREFIX, `${ev.event} ${ev.clientId} [${ev.ruleName}]${blockInfo}`);
        }
        if (attemptLog) attemptLog.append(ev);
      },
    });

    // Persistenza stato
    stateStore = new StateStore(pathPluginFolder, engine, custom.state || {});
    stateStore.init();

    // Sweep periodico dei blocchi scaduti
    const sweepSec = typeof custom.sweepIntervalSeconds === 'number' ? custom.sweepIntervalSeconds : 60;
    if (sweepSec > 0) {
      sweepTimer = setInterval(() => {
        try {
          engine.sweep();
        } catch (err) {
          logger.warn(LOG_PREFIX, `sweep fallito: ${err.message}`);
        }
      }, sweepSec * 1000);
      if (sweepTimer.unref) sweepTimer.unref();
    }

    const d = custom.defaults;
    logger.info(
      LOG_PREFIX,
      `attivo — ${loadRules().size} regola/e protette; default: ${d.maxFailures} tentativi/${d.findWindowSeconds}s → blocco ${d.shortBlockSeconds}s, dopo ${d.maxShortBlocks} blocchi → ${d.longBlockSeconds}s`
    );
  },

  /**
   * LIVELLO 2 — Middleware di enforcement sulle pagine fall-through.
   *
   * Gira DOPO il router (vedi index.js), quindi vede solo le richieste che non
   * sono state matchate da una rotta API (tipicamente le pagine statiche/EJS).
   * Nega l'accesso quando:
   *   1. globalLongBlock: l'IP ha un LONG block attivo su una qualsiasi regola
   *      (ban prolungato dell'IP su tutto il sito);
   *   2. una regola con `pathPattern` matcha il percorso e l'IP è bloccato per
   *      quella regola (short o long).
   * I percorsi in `exemptPaths` sono sempre lasciati passare.
   */
  getMiddlewareToAdd(app) {
    const enf = custom && custom.enforcement;
    if (!engine || !enf || enf.enabled === false) {
      return []; // Livello 2 disattivo (o plugin disabilitato)
    }

    const trustProxy = custom.trustProxy === true;
    const matcher = new PatternMatcher();
    const exemptPaths = Array.isArray(enf.exemptPaths) ? enf.exemptPaths : [];
    const denyStatus = enf.status || 429;
    const retryAfterHeader = !(custom.response && custom.response.retryAfterHeader === false);

    return [
      async (ctx, next) => {
        const urlPath = ctx.path;

        // Percorsi esenti (admin, risorse tema, ecc.)
        for (const p of exemptPaths) {
          if (matcher.matches(urlPath, p)) {
            await next();
            return;
          }
        }

        const clientId = resolveClientId(ctx, { trustProxy });
        let verdict = null;

        // 1) Ban globale per LONG block
        if (enf.globalLongBlock) {
          const v = engine.checkClientLongBlock(clientId);
          if (v.blocked) verdict = v;
        }

        // 2) Enforcement per pattern (regole con pathPattern)
        if (!verdict) {
          for (const rule of loadRules().values()) {
            if (rule.pathPattern && matcher.matches(urlPath, rule.pathPattern)) {
              const v = engine.check(clientId, rule.name);
              if (v.blocked) {
                verdict = v;
                break;
              }
            }
          }
        }

        if (verdict && verdict.blocked) {
          if (custom.enableLogging) {
            logger.info(LOG_PREFIX, `enforcement: negato ${clientId} su ${urlPath} (${verdict.tier}, ${verdict.retryAfterSeconds}s)`);
          }
          if (enf.redirectTo) {
            ctx.redirect(enf.redirectTo);
            return;
          }
          ctx.status = denyStatus;
          if (retryAfterHeader) ctx.set('Retry-After', String(verdict.retryAfterSeconds));
          ctx.body = { error: 'Access temporarily blocked', retryAfterSeconds: verdict.retryAfterSeconds };
          return;
        }

        await next();
      },
    ];
  },

  /**
   * Oggetto condiviso esposto agli altri plugin (pull via pluginSys.getSharedObject).
   * Restituisce null se il plugin è disabilitato, così i consumer saltano il guard
   * grazie al fallback `if (rl)`.
   */
  getObjectToShareToOthersPlugin(forPlugin) {
    if (!engine) return null;

    const trustProxy = custom.trustProxy === true;
    const idFrom = (ctx) => resolveClientId(ctx, { trustProxy });

    return {
      // ── API ctx-aware (uso tipico dei consumer) ──
      keyFromCtx: (ctx) => idFrom(ctx),
      checkCtx: (ctx, ruleName) => engine.check(idFrom(ctx), ruleName),
      recordFailureCtx: (ctx, ruleName) => engine.recordFailure(idFrom(ctx), ruleName),
      recordSuccessCtx: (ctx, ruleName) => engine.recordSuccess(idFrom(ctx), ruleName),

      /**
       * Guard "tutto-in-uno": se bloccato scrive 429 (+ Retry-After) e ritorna true.
       * Comodo per endpoint JSON. Per i form (es. login) il consumer può preferire
       * checkCtx + redirect verso una pagina con messaggio.
       */
      guardCtx: (ctx, ruleName) => {
        const verdict = engine.check(idFrom(ctx), ruleName);
        if (verdict.blocked) {
          const resp = custom.response || {};
          ctx.status = resp.status || 429;
          if (resp.retryAfterHeader !== false) {
            ctx.set('Retry-After', String(verdict.retryAfterSeconds));
          }
          ctx.body = { error: 'Too Many Requests', retryAfterSeconds: verdict.retryAfterSeconds };
          return true;
        }
        return false;
      },

      // ── API basate su chiave esplicita (es. per il futuro adminRateLimiter) ──
      check: (clientId, ruleName) => engine.check(clientId, ruleName),
      recordFailure: (clientId, ruleName) => engine.recordFailure(clientId, ruleName),
      recordSuccess: (clientId, ruleName) => engine.recordSuccess(clientId, ruleName),
      getActiveBlocks: () => engine.getActiveBlocks(),
      getRuleNames: () => Array.from(loadRules().keys()),
    };
  },
};
