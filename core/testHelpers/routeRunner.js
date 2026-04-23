/**
 * routeRunner.js
 *
 * Esegue un handler di rotta di plugin contro un context mock, validando che
 * la struttura della rotta rispetti il contratto previsto da pluginSys
 * (method uppercase, path, access, handler).
 */

const REQUIRED_FIELDS = ['method', 'path', 'access', 'handler'];
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DEL', 'DELETE', 'PATCH', 'ALL'];

/**
 * Valida la struttura di un oggetto rotta.
 *
 * @param {Object} route
 * @returns {string[]} Lista di problemi (vuota se la rotta è valida)
 */
function validateRoute(route) {
  const issues = [];
  if (!route || typeof route !== 'object') {
    return ['route must be an object'];
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in route)) {
      issues.push(`Missing required field: ${field}`);
    }
  }
  if (route.method && !VALID_METHODS.includes(route.method)) {
    issues.push(`Invalid method '${route.method}' (must be uppercase: ${VALID_METHODS.join(', ')})`);
  }
  if (route.access) {
    if (typeof route.access !== 'object') {
      issues.push('access must be an object');
    } else {
      if (!('requiresAuth' in route.access)) {
        issues.push('access.requiresAuth must be defined');
      } else if (typeof route.access.requiresAuth !== 'boolean') {
        issues.push('access.requiresAuth must be a boolean');
      }
      if (!('allowedRoles' in route.access)) {
        issues.push('access.allowedRoles must be defined');
      } else if (!Array.isArray(route.access.allowedRoles)) {
        issues.push('access.allowedRoles must be an array');
      }
    }
  }
  if (route.handler && typeof route.handler !== 'function') {
    issues.push('handler must be a function');
  }
  return issues;
}

/**
 * Esegue l'handler di una rotta contro un ctx mock, dopo averla validata.
 *
 * @param {Object} route - Oggetto rotta conforme al contratto pluginSys
 * @param {Object} ctx - Context mock (tipicamente da createCtxMock)
 * @returns {Promise<Object>} Il ctx dopo l'esecuzione dell'handler
 * @throws {Error} Se la struttura della rotta non è valida
 */
async function runRoute(route, ctx) {
  const issues = validateRoute(route);
  if (issues.length > 0) {
    throw new Error(`Invalid route structure:\n  - ${issues.join('\n  - ')}`);
  }
  await route.handler(ctx);
  return ctx;
}

module.exports = { runRoute, validateRoute, VALID_METHODS };
