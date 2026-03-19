/**
 * configValidator.js
 *
 * Validates redirectMap.json5 rules at boot time.
 * Reports errors/warnings depending on strictValidation setting.
 */

const LOG_PREFIX = '[urlRedirect]';

/**
 * Checks if a "from" pattern contains wildcard characters (* or **).
 * @param {string} from
 * @returns {boolean}
 */
function hasWildcard(from) {
  return from.includes('*');
}

/**
 * Checks if a "from" pattern is a regex (prefixed with "regex:").
 * @param {string} from
 * @returns {boolean}
 */
function isRegexPattern(from) {
  return from.startsWith('regex:');
}

/**
 * Checks if a URL is external (starts with http:// or https://).
 * @param {string} url
 * @returns {boolean}
 */
function isExternalUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Validates a single redirect rule.
 *
 * @param {object} rule - The redirect rule object
 * @param {number} index - Array index (for error messages)
 * @param {object} config - Plugin custom config
 * @param {Set} seenFroms - Set of already seen "from" values (for duplicate detection)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateRule(rule, index, config, seenFroms) {
  const errors = [];
  const warnings = [];
  const ruleLabel = `Rule #${index + 1}`;

  // 1. "from" is required and must be a string
  if (!rule.from || typeof rule.from !== 'string') {
    errors.push(`${ruleLabel}: missing or invalid "from" field (must be a non-empty string)`);
    return { errors, warnings };
  }

  // 2. "to" is required and must be a string
  if (!rule.to || typeof rule.to !== 'string') {
    errors.push(`${ruleLabel}: missing or invalid "to" field (must be a non-empty string)`);
    return { errors, warnings };
  }

  // 3. "type" is optional, defaults to 301, must be 301 or 302
  if (rule.type !== undefined) {
    if (rule.type !== 301 && rule.type !== 302) {
      warnings.push(`${ruleLabel}: invalid "type" ${rule.type} (must be 301 or 302). Defaulting to 301`);
    }
  }

  // 4. Duplicate "from" detection
  const fromKey = rule.from;
  if (seenFroms.has(fromKey)) {
    warnings.push(`${ruleLabel}: duplicate "from": "${rule.from}". Only the first occurrence will be used`);
  } else {
    seenFroms.add(fromKey);
  }

  // 5. Regex pattern validation
  if (isRegexPattern(rule.from)) {
    if (!config.enableRegex) {
      warnings.push(`${ruleLabel}: regex pattern "${rule.from}" found but enableRegex is false. Rule will be skipped`);
    } else {
      const regexStr = rule.from.slice('regex:'.length);
      try {
        new RegExp(regexStr);
      } catch (e) {
        errors.push(`${ruleLabel}: invalid regex pattern "${rule.from}": ${e.message}`);
      }
    }
  }

  // 6. Wildcard validation
  if (!isRegexPattern(rule.from) && hasWildcard(rule.from)) {
    if (!config.enablePatternMatching) {
      warnings.push(`${ruleLabel}: wildcard pattern "${rule.from}" found but enablePatternMatching is false. Rule will be skipped`);
    }
  }

  // 7. External redirect validation
  if (isExternalUrl(rule.to) && !config.allowExternalRedirects) {
    warnings.push(`${ruleLabel}: external redirect "${rule.from}" → "${rule.to}" found but allowExternalRedirects is false. Rule will be skipped`);
  }

  // 8. Loop detection (direct A→B, B→A)
  return { errors, warnings };
}

/**
 * Detects redirect loops in the rules array.
 * Checks for direct loops: A→B and B→A (exact matches only).
 *
 * @param {Array} rules - Array of redirect rule objects
 * @returns {string[]} Array of warning messages
 */
function detectLoops(rules) {
  const warnings = [];
  const redirectMap = new Map();

  // Build map of from→to for exact rules only
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.from && typeof rule.from === 'string' && rule.to && typeof rule.to === 'string'
        && !isRegexPattern(rule.from) && !hasWildcard(rule.from)) {
      redirectMap.set(rule.from, { to: rule.to, index: i });
    }
  }

  // Check for direct loops
  for (const [from, { to, index }] of redirectMap) {
    const reverse = redirectMap.get(to);
    if (reverse && reverse.to === from) {
      warnings.push(`Rule #${index + 1}: possible redirect loop detected: "${from}" → "${to}" → "${from}"`);
    }
  }

  return warnings;
}

/**
 * Validates the entire redirectMap configuration.
 *
 * @param {object} redirectData - Parsed content of redirectMap.json5
 * @param {object} config - Plugin custom config (from pluginConfig.json5)
 * @returns {{ valid: boolean, errors: string[], warnings: string[], validRules: Array }}
 */
function validate(redirectData, config) {
  const allErrors = [];
  const allWarnings = [];
  const validRules = [];

  // Check top-level structure
  if (!redirectData || !Array.isArray(redirectData.redirects)) {
    allErrors.push('redirectMap.json5: missing or invalid "redirects" array');
    return { valid: false, errors: allErrors, warnings: allWarnings, validRules };
  }

  const seenFroms = new Set();

  for (let i = 0; i < redirectData.redirects.length; i++) {
    const rule = redirectData.redirects[i];
    const { errors, warnings } = validateRule(rule, i, config, seenFroms);

    allErrors.push(...errors);
    allWarnings.push(...warnings);

    // A rule is valid if it has no errors
    if (errors.length === 0) {
      validRules.push({
        from: rule.from,
        to: rule.to,
        type: (rule.type === 301 || rule.type === 302) ? rule.type : 301,
      });
    }
  }

  // Loop detection
  const loopWarnings = detectLoops(redirectData.redirects);
  allWarnings.push(...loopWarnings);

  // In strict mode, warnings become errors
  if (config.strictValidation) {
    allErrors.push(...allWarnings);
    allWarnings.length = 0;
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    validRules,
  };
}

/**
 * Logs validation results to console.
 *
 * @param {{ valid: boolean, errors: string[], warnings: string[], validRules: Array }} result
 */
function logValidationResults(result) {
  for (const warning of result.warnings) {
    console.warn(`${LOG_PREFIX} WARNING: ${warning}`);
  }
  for (const error of result.errors) {
    console.error(`${LOG_PREFIX} ERROR: ${error}`);
  }
}

module.exports = {
  validate,
  logValidationResults,
  hasWildcard,
  isRegexPattern,
  isExternalUrl,
};
