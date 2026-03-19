/**
 * redirectMatcher.js
 *
 * Core matching engine for URL redirects.
 * Supports exact, wildcard (* and **), and regex patterns.
 * Evaluation order: first-match-wins (array order).
 */

const { hasWildcard, isRegexPattern, isExternalUrl } = require('./configValidator');

const LOG_PREFIX = '[urlRedirect]';

/**
 * Normalizes a URL path for matching.
 *
 * @param {string} urlPath - The URL path to normalize
 * @param {object} config - Plugin custom config
 * @returns {string} Normalized path
 */
function normalizePath(urlPath, config) {
  let normalized = urlPath;

  if (config.normalizeTrailingSlash && normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  if (!config.caseSensitive) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

/**
 * Normalizes a "from" pattern for matching (same rules as URL path).
 *
 * @param {string} from - The "from" pattern
 * @param {object} config - Plugin custom config
 * @returns {string} Normalized pattern
 */
function normalizeFrom(from, config) {
  // Don't normalize regex patterns (the regex itself handles matching)
  if (isRegexPattern(from)) {
    return from;
  }

  return normalizePath(from, config);
}

/**
 * Attempts to match a URL against a single wildcard pattern (* or **).
 * Returns the captured segment(s) if matched, or null.
 *
 * @param {string} normalizedUrl - The normalized URL path
 * @param {string} normalizedFrom - The normalized "from" pattern (with * or **)
 * @returns {string|null} Captured segment(s) or null if no match
 */
function matchWildcard(normalizedUrl, normalizedFrom) {
  // ** (recursive wildcard) — matches everything including /
  if (normalizedFrom.includes('**')) {
    const parts = normalizedFrom.split('**');
    if (parts.length !== 2) return null; // Only support one ** per pattern

    const prefix = parts[0];
    const suffix = parts[1];

    if (!normalizedUrl.startsWith(prefix)) return null;
    if (suffix && !normalizedUrl.endsWith(suffix)) return null;

    const endIdx = suffix ? normalizedUrl.length - suffix.length : undefined;
    const captured = normalizedUrl.slice(prefix.length, endIdx);
    return captured;
  }

  // * (single-segment wildcard) — matches one path segment (no /)
  if (normalizedFrom.includes('*')) {
    const parts = normalizedFrom.split('*');
    if (parts.length !== 2) return null; // Only support one * per pattern

    const prefix = parts[0];
    const suffix = parts[1];

    if (!normalizedUrl.startsWith(prefix)) return null;
    if (suffix && !normalizedUrl.endsWith(suffix)) return null;

    const captured = normalizedUrl.slice(prefix.length, suffix ? normalizedUrl.length - suffix.length : undefined);

    // Single wildcard must not contain /
    if (captured.includes('/')) return null;

    return captured;
  }

  return null;
}

/**
 * Attempts to match a URL against a regex pattern.
 * Returns the match object if matched, or null.
 *
 * @param {string} urlPath - The original URL path (not normalized for case — regex handles its own flags)
 * @param {string} from - The full "from" field (e.g., "regex:^/product/(\\d+)$")
 * @param {object} config - Plugin custom config
 * @returns {RegExpMatchArray|null} Match result or null
 */
function matchRegex(urlPath, from, config) {
  const regexStr = from.slice('regex:'.length);
  const flags = config.caseSensitive ? '' : 'i';

  try {
    const regex = new RegExp(regexStr, flags);
    let pathToTest = urlPath;

    if (config.normalizeTrailingSlash && pathToTest.length > 1 && pathToTest.endsWith('/')) {
      pathToTest = pathToTest.slice(0, -1);
    }

    return pathToTest.match(regex);
  } catch (e) {
    // Should not happen — regex was validated at boot
    console.warn(`${LOG_PREFIX} WARNING: regex error for pattern "${from}": ${e.message}`);
    return null;
  }
}

/**
 * Builds the destination URL by replacing captured groups.
 *
 * @param {string} toPattern - The "to" pattern
 * @param {string|RegExpMatchArray|null} captured - Captured value from wildcard or regex
 * @param {string} matchType - "exact", "wildcard", or "regex"
 * @returns {string} Final destination URL
 */
function buildDestination(toPattern, captured, matchType) {
  if (matchType === 'exact' || !captured) {
    return toPattern;
  }

  if (matchType === 'wildcard') {
    // Replace * or ** in the "to" pattern with the captured segment
    if (toPattern.includes('**')) {
      return toPattern.replace('**', captured);
    }
    if (toPattern.includes('*')) {
      return toPattern.replace('*', captured);
    }
    return toPattern;
  }

  if (matchType === 'regex') {
    // Replace $1, $2, etc. with captured groups
    let result = toPattern;
    // Replace all $N placeholders, even those beyond captured groups
    result = result.replace(/\$(\d+)/g, (placeholder, num) => {
      const index = parseInt(num, 10);
      return (index < captured.length) ? (captured[index] || '') : '';
    });
    return result;
  }

  return toPattern;
}

/**
 * Finds the first matching redirect rule for a given URL path.
 * Evaluation order: first-match-wins (array order).
 *
 * @param {string} urlPath - The request URL pathname
 * @param {Array} rules - Array of validated redirect rules
 * @param {object} config - Plugin custom config
 * @returns {{ rule: object, destination: string, matchType: string }|null}
 */
function findMatch(urlPath, rules, config) {
  const normalizedUrl = normalizePath(urlPath, config);

  for (const rule of rules) {
    // --- Regex pattern ---
    if (isRegexPattern(rule.from)) {
      if (!config.enableRegex) continue;

      const regexMatch = matchRegex(urlPath, rule.from, config);
      if (regexMatch) {
        const destination = buildDestination(rule.to, regexMatch, 'regex');
        return { rule, destination, matchType: 'regex' };
      }
      continue;
    }

    const normalizedFrom = normalizeFrom(rule.from, config);

    // --- Wildcard pattern ---
    if (hasWildcard(rule.from)) {
      if (!config.enablePatternMatching) continue;

      const captured = matchWildcard(normalizedUrl, normalizedFrom);
      if (captured !== null) {
        const destination = buildDestination(rule.to, captured, 'wildcard');
        return { rule, destination, matchType: 'wildcard' };
      }
      continue;
    }

    // --- Exact match ---
    if (normalizedUrl === normalizedFrom) {
      return { rule, destination: rule.to, matchType: 'exact' };
    }
  }

  return null;
}

/**
 * Appends the original query string to the destination URL.
 *
 * @param {string} destination - The destination URL
 * @param {string} queryString - The original query string (without leading ?)
 * @returns {string} Destination URL with query string
 */
function appendQueryString(destination, queryString) {
  if (!queryString) return destination;

  const separator = destination.includes('?') ? '&' : '?';
  return destination + separator + queryString;
}

module.exports = {
  findMatch,
  normalizePath,
  normalizeFrom,
  matchWildcard,
  matchRegex,
  buildDestination,
  appendQueryString,
};
