/**
 * urlRedirect — Plugin per redirect URL (301/302).
 *
 * Supporta redirect esatti, wildcard (* e **), e regex.
 * Ideale per migrazioni da un vecchio sito a uno nuovo.
 * Le regole sono definite in redirectMap.json5.
 * Le statistiche di utilizzo sono salvate in redirectHitCount.json5.
 */

const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const { validate, logValidationResults, isExternalUrl } = require('./lib/configValidator');
const { findMatch, appendQueryString } = require('./lib/redirectMatcher');
const HitCounter = require('./lib/hitCounter');

const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));
const isDebugMode = ital8Conf.debugMode >= 1;

const LOG_PREFIX = '[urlRedirect]';

/** @type {Array} Validated redirect rules (cached in production mode) */
let cachedRules = null;

/** @type {object} Plugin custom config */
let pluginConfig = null;

/** @type {string} Path to the plugin folder */
let pluginFolder = null;

/** @type {HitCounter|null} */
let hitCounter = null;

/**
 * Loads and validates redirect rules from redirectMap.json5.
 * In debug mode, re-reads from disk on every call.
 * In production mode, uses cached rules after first load.
 *
 * @returns {Array} Array of validated redirect rules
 */
function loadRules() {
  if (!isDebugMode && cachedRules !== null) {
    return cachedRules;
  }

  const mapPath = path.join(pluginFolder, 'redirectMap.json5');
  let redirectData;

  try {
    redirectData = loadJson5(mapPath);
  } catch (err) {
    console.error(`${LOG_PREFIX} ERROR: Failed to load redirectMap.json5: ${err.message}`);
    return cachedRules || [];
  }

  const result = validate(redirectData, pluginConfig);
  logValidationResults(result);

  if (!result.valid && pluginConfig.strictValidation) {
    throw new Error(`${LOG_PREFIX} FATAL: redirectMap.json5 validation failed with strictValidation enabled. Server cannot start.`);
  }

  cachedRules = result.validRules;
  return cachedRules;
}

/**
 * Counts rule types for the boot log summary.
 *
 * @param {Array} rules
 * @returns {{ exact: number, wildcard: number, regex: number }}
 */
function countRuleTypes(rules) {
  let exact = 0;
  let wildcard = 0;
  let regex = 0;

  for (const rule of rules) {
    if (rule.from.startsWith('regex:')) {
      regex++;
    } else if (rule.from.includes('*')) {
      wildcard++;
    } else {
      exact++;
    }
  }

  return { exact, wildcard, regex };
}

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    pluginFolder = pathPluginFolder;

    const config = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
    pluginConfig = config.custom;

    // Load and validate rules
    const rules = loadRules();

    const counts = countRuleTypes(rules);
    console.log(`${LOG_PREFIX} Loaded ${rules.length} redirect rules (${counts.exact} exact, ${counts.wildcard} wildcard, ${counts.regex} regex)`);

    // Initialize hit counter
    if (pluginConfig.enableHitCounter) {
      hitCounter = new HitCounter(pathPluginFolder, pluginConfig);
      hitCounter.init();
      const flushMsg = pluginConfig.hitCounterFlushInterval === 0
        ? 'immediate write'
        : `flush every ${pluginConfig.hitCounterFlushInterval}s`;
      console.log(`${LOG_PREFIX} Hit counter enabled (${flushMsg})`);
    }
  },

  getMiddlewareToAdd() {
    const config = pluginConfig;
    const counter = hitCounter;

    return [
      async (ctx, next) => {
        // Only intercept GET requests
        if (ctx.method !== 'GET') {
          await next();
          return;
        }

        const rules = loadRules();
        if (rules.length === 0) {
          await next();
          return;
        }

        const urlPath = ctx.path;
        const match = findMatch(urlPath, rules, config);

        if (!match) {
          await next();
          return;
        }

        const { rule, destination, matchType } = match;

        // Security check: block external redirects if not allowed
        if (isExternalUrl(destination) && !config.allowExternalRedirects) {
          if (config.enableLogging) {
            console.warn(`${LOG_PREFIX} BLOCKED external redirect: ${rule.from} → ${destination} (allowExternalRedirects: false)`);
          }
          await next();
          return;
        }

        // Build final URL
        let finalUrl = destination;
        if (config.preserveQueryString && ctx.querystring) {
          finalUrl = appendQueryString(finalUrl, ctx.querystring);
        }

        // Record hit
        if (counter) {
          counter.recordHit(rule.from);
        }

        // Log redirect
        if (config.enableLogging) {
          const typeLabel = matchType !== 'exact' ? ` (${matchType})` : '';
          console.log(`${LOG_PREFIX} ${rule.type} ${urlPath} → ${finalUrl}${typeLabel}`);
        }

        // Perform redirect
        ctx.status = rule.type;
        ctx.redirect(finalUrl);
      },
    ];
  },

  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    return {
      /** Returns a copy of all loaded redirect rules */
      getRedirectRules: () => {
        const rules = loadRules();
        return rules.map(r => ({ ...r }));
      },
      /** Returns hit count data (empty object if hit counter is disabled) */
      getHitCounts: () => hitCounter ? hitCounter.getAll() : {},
      /** Returns the number of loaded redirect rules */
      getRuleCount: () => loadRules().length,
    };
  },
};
