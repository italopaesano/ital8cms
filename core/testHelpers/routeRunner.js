/**
 * routeRunner.js
 *
 * Esegue un handler di rotta di plugin contro un context mock, validando che
 * la struttura della rotta rispetti il contratto previsto da pluginSys
 * (method uppercase, path, access, handler).
 */

// Il predicato del RUNTIME, non una seconda copia: `loadRoutes` salta e segnala
// esattamente le rotte per cui questo è falso (da v3.14.0). Importarlo invece di
// riscriverlo è la lezione del difetto 🟡 di v3.10.0, in cui validatore e
// dispatcher erano tornati a divergere proprio su `access`.
const { declaresAccess } = require('../pluginSys');

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

  // I tre controlli qui sotto guardano il VALORE, non la sola presenza della
  // chiave. Prima erano dietro un guard di verità (`if (route.handler && …)`,
  // `if (route.access)`), e `field in route` è vero anche per un valore
  // `undefined`: il validatore approvava quindi — con zero problemi segnalati —
  // esattamente le tre forme che loadRoutes rifiuta o degrada.
  //
  // Misurato prima della correzione: `{handler: undefined}` → nessun problema,
  // poi `runRoute` esplode con «route.handler is not a function» mentre
  // loadRoutes salta la rotta con un warning; `{access: null}` → nessun problema,
  // e loadRoutes REGISTRA la rotta **senza** il wrap di autenticazione
  // (`oRoute.access ? wrap(...) : oRoute.handler`), cioè aperta; `{method: ''}` →
  // nessun problema, e la rotta non viene registrata.
  //
  // È la stessa divergenza validatore/dispatcher che il commento su VALID_METHODS
  // dichiarava chiusa in v2.99.0: lo era per i VERBI, non per la struttura.
  if ('method' in route && !VALID_METHODS.includes(route.method)) {
    issues.push(`Invalid method '${route.method}' (must be uppercase: ${VALID_METHODS.join(', ')})`);
  }
  if ('handler' in route && typeof route.handler !== 'function') {
    issues.push('handler must be a function');
  }
  if ('path' in route && (typeof route.path !== 'string' || route.path === '')) {
    issues.push('path must be a non-empty string');
  }
  if ('access' in route) {
    if (!declaresAccess(route)) {
      // Un access falsy non era « assente e basta »: fino alla v3.13.0 loadRoutes
      // registrava comunque la rotta saltando il controllo di autenticazione —
      // il caso peggiore dei tre, perché la rotta funzionava, senza protezione.
      // Da v3.14.0 la salta e lo segnala, con QUESTO stesso predicato.
      issues.push('access must be an object (loadRoutes skips the route: it is never registered)');
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
