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
 *
 * LIVELLO 2: middleware di enforcement sulle pagine fall-through (getMiddlewareToAdd),
 *   che legge le impostazioni di enforcement da `custom` in modo LIVE.
 *
 * API per il plugin admin (adminRateLimiter): l'oggetto condiviso espone azioni
 *   live (releaseBlock/releaseAllForClient/banClient), dati (getStats/
 *   getRecentAttempts/getConfig), validazione (validateRules/validateConfig) e
 *   hot-reload (reloadRules/reloadConfig). Vedi EXPLAIN.md.
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

/**
 * Forza il re-read di protectedRoutes.json5 (hot-reload delle regole).
 * Usato dal plugin admin dopo aver salvato il file.
 */
function reloadRules() {
  cachedRules = null;
  return loadRules();
}

/**
 * Re-legge pluginConfig.json5 e aggiorna `custom` a caldo (defaults, enforcement,
 * response, ...). Le policy effettive e l'enforcement L2 leggono `custom` live,
 * quindi le modifiche hanno effetto senza riavvio. I parametri infrastrutturali
 * (timer flush/sweep, rotazione/retention log) restano quelli creati al boot.
 * @returns {object} copia di `custom` dopo il reload
 */
function reloadConfig() {
  try {
    const cfg = loadJson5(path.join(pluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};
    cachedRules = null; // le policy effettive dipendono anche dai defaults
  } catch (err) {
    logger.warn(LOG_PREFIX, `reloadConfig fallito: ${err.message}`);
  }
  return JSON.parse(JSON.stringify(custom));
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
          const ruleInfo = ev.ruleName ? ` [${ev.ruleName}]` : '';
          logger.info(LOG_PREFIX, `${ev.event} ${ev.clientId}${ruleInfo}${blockInfo}`);
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
   *
   * NOTA: il middleware è registrato una volta sola (se il plugin è attivo), ma
   * legge le impostazioni di enforcement da `custom` in modo LIVE ad ogni
   * richiesta. Così `reloadConfig()` può attivare/disattivare/riconfigurare
   * l'enforcement a caldo, senza riavvio.
   */
  getMiddlewareToAdd(app) {
    if (!engine) {
      return []; // plugin disabilitato (custom.enabled=false): nessun middleware
    }

    const matcher = new PatternMatcher();

    return [
      async (ctx, next) => {
        const enf = custom && custom.enforcement;
        if (!enf || enf.enabled === false) {
          await next(); // enforcement disattivato (live)
          return;
        }

        const urlPath = ctx.path;

        // Percorsi esenti (admin, risorse tema, ecc.)
        const exemptPaths = Array.isArray(enf.exemptPaths) ? enf.exemptPaths : [];
        for (const p of exemptPaths) {
          if (matcher.matches(urlPath, p)) {
            await next();
            return;
          }
        }

        const clientId = resolveClientId(ctx, { trustProxy: custom.trustProxy === true });
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
          ctx.status = enf.status || 429;
          const retryAfterHeader = !(custom.response && custom.response.retryAfterHeader === false);
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

      // ── API basate su chiave esplicita ──
      check: (clientId, ruleName) => engine.check(clientId, ruleName),
      recordFailure: (clientId, ruleName) => engine.recordFailure(clientId, ruleName),
      recordSuccess: (clientId, ruleName) => engine.recordSuccess(clientId, ruleName),
      getActiveBlocks: () => engine.getActiveBlocks(),
      getRuleNames: () => Array.from(loadRules().keys()),

      // ── API per il plugin admin (adminRateLimiter) ──
      // Azioni live (effetto immediato sull'engine in memoria)
      releaseBlock: (clientId, ruleName) => engine.release(clientId, ruleName),
      releaseAllForClient: (clientId) => engine.releaseAllForClient(clientId),
      banClient: (clientId, ruleName, opts) => engine.forceBlock(clientId, ruleName, opts),

      // Dati per la Vista Dati della GUI
      getStats: () => {
        const active = engine.getActiveBlocks();
        return {
          enabled: custom.enabled !== false,
          enforcementEnabled: !!(custom.enforcement && custom.enforcement.enabled !== false),
          activeBlocks: active.length,
          shortBlocks: active.filter((b) => b.tier === 'short').length,
          longBlocks: active.filter((b) => b.tier === 'long').length,
          ruleCount: loadRules().size,
        };
      },
      getRecentAttempts: (opts) => (attemptLog ? attemptLog.readRecent(opts) : []),
      getConfig: () => JSON.parse(JSON.stringify(custom)),

      // Validazione (riuso del validator del plugin) — usata prima del salvataggio
      validateRules: (rulesData) => validate(custom, rulesData),
      validateConfig: (newCustom) => {
        let rulesData = {};
        try {
          rulesData = loadJson5(path.join(pluginFolder, 'protectedRoutes.json5'));
        } catch (e) { /* file assente: validazione solo del custom */ }
        return validate(newCustom, rulesData);
      },

      // Hot-reload (dopo che adminRateLimiter ha scritto i file .json5)
      reloadRules,
      reloadConfig,
    };
  },
};
