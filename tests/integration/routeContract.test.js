// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Sweep del CONTRATTO DELLE ROTTE su tutti i plugin attivi.
 *
 * PERCHÉ ESISTE
 * -------------
 * CLAUDE.md descrive tre modi di sbagliare una rotta, e due sono SILENZIOSI:
 *
 *   • `method` minuscolo ('get')      → pluginSys.loadRoutes() non la registra
 *   • `func` invece di `handler`      → idem
 *   • `access` mancante               → errore FATALE al boot
 *
 * Nei primi due casi non c'è né errore né warning: la rotta semplicemente non
 * esiste, e la richiesta cade sul server statico restituendo HTML dove il
 * chiamante si aspetta JSON. Un difetto che si nota solo dal browser.
 *
 * `validateRoute()` (core/testHelpers/routeRunner.js) sa già riconoscere queste
 * forme, ma nessun test lo applicava a TUTTI i plugin: veniva usato solo dentro
 * la suite di adminCsrfProtection. Questo file colma il buco e copre, gratis,
 * anche i plugin che verranno scritti in futuro.
 *
 * NOTA SUL VALORE: al momento della scrittura lo sweep passa su 135 rotte di 22
 * plugin attivi. Non serve a trovare un difetto oggi — serve a far fallire la
 * PRIMA rotta scritta storta, invece di lasciarla sparire in silenzio.
 */

const fs = require('fs');
const path = require('path');

const loadJson5 = require('../../core/loadJson5');
const { validateRoute, VALID_METHODS } = require('../../core/testHelpers');

const PLUGINS_ROOT = path.join(__dirname, '..', '..', 'plugins');
const PLUGIN_SYS_SOURCE = path.join(__dirname, '..', '..', 'core', 'pluginSys.js');

/**
 * Raccoglie le rotte dichiarate dai plugin ATTIVI, così come le vede pluginSys:
 * `plugin.getRouteArray()` invocata SENZA argomenti (vedi core/pluginSys.js).
 */
function collectActivePluginRoutes() {
  const plugins = [];

  for (const entry of fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(PLUGINS_ROOT, entry.name);
    let pluginConfig;
    try {
      pluginConfig = loadJson5(path.join(pluginDir, 'pluginConfig.json5'));
    } catch (_) {
      continue; // nessun config vivo → plugin mai preso in carico
    }
    if (!pluginConfig || pluginConfig.active !== 1) continue;

    let pluginModule;
    try {
      pluginModule = require(path.join(pluginDir, 'main.js'));
    } catch (error) {
      plugins.push({ name: entry.name, loadError: error.message, routes: [] });
      continue;
    }

    if (typeof pluginModule.getRouteArray !== 'function') {
      plugins.push({ name: entry.name, routes: [], declaresRoutes: false });
      continue;
    }

    let routes;
    try {
      routes = pluginModule.getRouteArray();
    } catch (error) {
      plugins.push({ name: entry.name, routeArrayError: error.message, routes: [] });
      continue;
    }

    plugins.push({ name: entry.name, routes: Array.isArray(routes) ? routes : null, declaresRoutes: true });
  }

  return plugins;
}

const inspected = collectActivePluginRoutes();

describe('contratto delle rotte — sweep su tutti i plugin attivi', () => {
  // ANTI-VACUITÀ: se la scansione si rompesse e trovasse zero plugin, tutti i
  // test sotto passerebbero senza aver guardato niente. Le soglie sono basse di
  // proposito: servono a distinguere «ho controllato» da «non ho trovato nulla»,
  // non a fissare quanti plugin debba avere il progetto.
  test('lo sweep ha davvero ispezionato plugin e rotte', () => {
    expect(inspected.length).toBeGreaterThanOrEqual(10);

    const totalRoutes = inspected.reduce((sum, p) => sum + (p.routes ? p.routes.length : 0), 0);
    expect(totalRoutes).toBeGreaterThanOrEqual(50);
  });

  test('il main.js di ogni plugin attivo è caricabile', () => {
    const broken = inspected.filter((p) => p.loadError).map((p) => `${p.name}: ${p.loadError}`);
    expect(broken).toEqual([]);
  });

  test('getRouteArray() non lancia e restituisce un array', () => {
    const throwing = inspected.filter((p) => p.routeArrayError)
      .map((p) => `${p.name}: ${p.routeArrayError}`);
    expect(throwing).toEqual([]);

    const notArray = inspected.filter((p) => p.declaresRoutes && p.routes === null).map((p) => p.name);
    expect(notArray).toEqual([]);
  });

  test('ogni rotta rispetta il contratto (method MAIUSCOLO, path, access, handler)', () => {
    const problems = [];

    for (const plugin of inspected) {
      if (!plugin.routes) continue;
      plugin.routes.forEach((route, index) => {
        const issues = validateRoute(route);
        if (issues.length > 0) {
          const label = route && route.path ? `${route.method} ${route.path}` : `rotta #${index}`;
          problems.push(`${plugin.name} → ${label}: ${issues.join('; ')}`);
        }
      });
    }

    // Il messaggio d'errore elenca plugin, metodo e path: una rotta storta si
    // corregge senza dover ricostruire dove fosse.
    expect(problems).toEqual([]);
  });
});

describe('contratto delle rotte — il guard riconosce le forme sbagliate', () => {
  // Senza questi casi, un validateRoute() che non guardasse più niente
  // continuerebbe a far passare lo sweep qui sopra: verde e cieco.
  const validRoute = () => ({
    method: 'GET',
    path: '/esempio',
    access: { requiresAuth: false, allowedRoles: [] },
    handler: async () => {},
  });

  test('la rotta di riferimento è valida (baseline)', () => {
    expect(validateRoute(validRoute())).toEqual([]);
  });

  test('method minuscolo → segnalato', () => {
    expect(validateRoute({ ...validRoute(), method: 'get' }).join(' ')).toMatch(/uppercase/i);
  });

  test('`func` invece di `handler` → handler mancante', () => {
    const route = validRoute();
    delete route.handler;
    route.func = async () => {};
    expect(validateRoute(route).join(' ')).toMatch(/handler/);
  });

  test('access mancante → segnalato (al boot sarebbe fatale)', () => {
    const route = validRoute();
    delete route.access;
    expect(validateRoute(route).join(' ')).toMatch(/access/);
  });

  test('access senza requiresAuth o allowedRoles → segnalato', () => {
    expect(validateRoute({ ...validRoute(), access: {} }).join(' ')).toMatch(/requiresAuth/);
    expect(validateRoute({ ...validRoute(), access: { requiresAuth: false } }).join(' ')).toMatch(/allowedRoles/);
  });

  test('handler non funzione → segnalato', () => {
    expect(validateRoute({ ...validRoute(), handler: 'non una funzione' }).join(' ')).toMatch(/handler/);
  });

  test('metodo che loadRoutes NON sa smistare → segnalato', () => {
    // PATCH e DELETE erano accettati dal validatore ma cadono fuori dalla catena
    // if/else di loadRoutes, che non ha un ramo finale: la rotta sparirebbe in
    // silenzio. Il validatore deve rifiutarli, non benedirli.
    expect(validateRoute({ ...validRoute(), method: 'PATCH' }).join(' ')).toMatch(/Invalid method/);
    expect(validateRoute({ ...validRoute(), method: 'DELETE' }).join(' ')).toMatch(/Invalid method/);
  });
});

describe('contratto delle rotte — il validatore non deve divergere da loadRoutes', () => {
  test('VALID_METHODS coincide con i metodi che loadRoutes smista davvero', () => {
    // Il difetto che questo test previene è già successo una volta: VALID_METHODS
    // elencava DELETE e PATCH, che loadRoutes non gestisce, quindi il guard
    // approvava rotte destinate a sparire. Qui i verbi vengono LETTI dal sorgente
    // di pluginSys, così le due liste non possono più separarsi in silenzio.
    const source = fs.readFileSync(PLUGIN_SYS_SOURCE, 'utf8');
    const block = source.match(/const ROUTER_METHOD_DISPATCH = \{([\s\S]*?)\n\};/);

    // Se la mappa venisse rinominata o rimossa, questo test deve fallire invece
    // di confrontare una lista vuota con una lista vuota e dichiararsi contento.
    expect(block).not.toBeNull();

    const dispatched = [...block[1].matchAll(/^\s*([A-Z]+)\s*:/gm)].map((m) => m[1]);
    expect(dispatched.length).toBeGreaterThan(0);
    expect([...new Set(dispatched)].sort()).toEqual([...VALID_METHODS].sort());
  });
});
