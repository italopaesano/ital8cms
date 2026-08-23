/**
 * routeRunner.js
 *
 * Esegue un handler di rotta di plugin contro un context mock, validando che
 * la struttura della rotta rispetti il contratto previsto da pluginSys
 * (method uppercase, path, access, handler).
 */

const REQUIRED_FIELDS = ['method', 'path', 'access', 'handler'];

// ESATTAMENTE i metodi che pluginSys.loadRoutes() sa smistare al router.
// La catena if/else lì dentro non ha un ramo finale: un metodo fuori da questa
// lista non viene registrato e NON produce alcun errore — la rotta sparisce e la
// richiesta cade sul server statico (HTML invece di JSON). È la stessa classe di
// difetto silenzioso del `method` minuscolo descritta in CLAUDE.md.
//
// La lista conteneva anche 'DELETE' e 'PATCH', che loadRoutes NON gestisce: il
// validatore dava quindi il via libera a rotte destinate a sparire in silenzio.
// Corretto in v2.99.0; nessuna rotta del progetto li usava (censimento: solo GET
// e POST). Se un giorno loadRoutes imparerà nuovi verbi, il test di coerenza in
// tests/integration/routeContract.test.js obbliga ad aggiornare anche questa lista.
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DEL', 'ALL'];

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
