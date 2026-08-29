// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per core/pluginLoadOrder.js — l'ordinamento di caricamento dei plugin.
 *
 * PERCHÉ CONTA
 * ------------
 * Questo modulo decide l'ordine in cui i plugin vengono caricati, e siccome
 * `index.js` monta i middleware scorrendo l'array costruito durante il
 * caricamento, decide **anche** l'annidamento Koa dei middleware dei plugin.
 * Un errore qui non rompe un test: sposta silenziosamente un middleware, e lo si
 * scopre da un dato che manca (è successo: il 100% dei 301/302 sparito dalle
 * statistiche, v3.10.0).
 *
 * COSA SI FISSA
 * -------------
 * Le due regole e il loro conflitto:
 *   • il vincolo topologico è DURO — una dipendenza carica sempre prima;
 *   • il peso decide tutto il resto, con l'alfabetico a parità;
 *   • quando le due si contraddicono vince la dipendenza, e la contraddizione
 *     viene RIPORTATA invece di restare muta (era il difetto D3).
 */

const resolveLoadOrder = require('../../core/pluginLoadOrder');

/** Scorciatoia: costruisce un candidato come lo passa `pluginSys.initialize()`. */
const plugin = (name, weight, deps = []) => ({
  name,
  weight,
  pluginDeps: new Map(deps.map((d) => [d, '*'])),
});

/** Posizione 1-based di un plugin nell'ordine. */
const pos = (order, name) => order.indexOf(name) + 1;

describe('resolveLoadOrder() — il peso ordina', () => {
  test('senza dipendenze, ordina per weight crescente', () => {
    const { order } = resolveLoadOrder([
      plugin('tardi', 10), plugin('presto', -10), plugin('mezzo', 0),
    ]);

    expect(order).toEqual(['presto', 'mezzo', 'tardi']);
  });

  test('a parità di peso, alfabetico', () => {
    // Esplicito e non affidato alla stabilità di sort(): i candidati arrivano
    // nell'ordine di readdirSync, che non è garantito alfabetico su ogni
    // filesystem — « a parità di weight, alfabetico » sarebbe vero solo per caso.
    const { order } = resolveLoadOrder([
      plugin('gamma', 0), plugin('alfa', 0), plugin('beta', 0),
    ]);

    expect(order).toEqual(['alfa', 'beta', 'gamma']);
  });

  test('un weight assente o non finito vale 0', () => {
    const { order } = resolveLoadOrder([
      { name: 'senzaPeso', pluginDeps: new Map() },
      plugin('pesante', 5),
      plugin('leggero', -5),
    ]);

    expect(order).toEqual(['leggero', 'senzaPeso', 'pesante']);
  });
});

describe('resolveLoadOrder() — il vincolo delle dipendenze è duro', () => {
  test('una dipendenza carica prima del dipendente, anche se pesa di più', () => {
    const { order } = resolveLoadOrder([
      plugin('dipendente', -100, ['fornitore']),
      plugin('fornitore', 100),
    ]);

    expect(order).toEqual(['fornitore', 'dipendente']);
  });

  test('la catena transitiva è rispettata', () => {
    const { order } = resolveLoadOrder([
      plugin('c', -1, ['b']), plugin('b', -2, ['a']), plugin('a', 50),
    ]);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('dipendenze multiple: il dipendente segue TUTTE', () => {
    const { order } = resolveLoadOrder([
      plugin('consumer', -10, ['uno', 'due']),
      plugin('uno', 0), plugin('due', 20),
    ]);

    expect(pos(order, 'consumer')).toBeGreaterThan(pos(order, 'uno'));
    expect(pos(order, 'consumer')).toBeGreaterThan(pos(order, 'due'));
  });
});

describe('resolveLoadOrder() — il peso conta ANCHE per chi ha dipendenze', () => {
  // È la correzione D3. Prima il peso ordinava i soli plugin SENZA dipendenze, e
  // gli altri venivano accodati dopo TUTTI quelli senza: `adminAccessControl`
  // dichiarava -5 e caricava 22° su 22. Il suo peso non era poco efficace, era
  // inerte.

  test('un dipendente leggero carica appena la sua dipendenza è pronta', () => {
    const { order } = resolveLoadOrder([
      plugin('leggeroConDep', -5, ['fornitore']),
      plugin('fornitore', 0),
      plugin('pesanteSenzaDep', 40),
      plugin('altroSenzaDep', 30),
    ]);

    // Non in fondo: subito dopo la sua unica dipendenza.
    expect(order).toEqual(['fornitore', 'leggeroConDep', 'altroSenzaDep', 'pesanteSenzaDep']);
  });

  test('il vecchio comportamento — dipendenti tutti in coda — non torna', () => {
    // Mutazione tipica: reintrodurre « prima i dep-free, poi gli altri ».
    const { order } = resolveLoadOrder([
      plugin('conDep', -50, ['base']),
      plugin('base', 0),
      plugin('senzaDep1', 1),
      plugin('senzaDep2', 2),
    ]);

    expect(pos(order, 'conDep')).toBeLessThan(pos(order, 'senzaDep1'));
    expect(pos(order, 'conDep')).toBeLessThan(pos(order, 'senzaDep2'));
  });
});

describe('resolveLoadOrder() — i pesi che non possono essere onorati', () => {
  test('nessuna inversione quando il peso è rispettato', () => {
    const { weightInversions } = resolveLoadOrder([
      plugin('a', -10), plugin('b', 0), plugin('c', 10),
    ]);

    expect(weightInversions).toEqual([]);
  });

  test('una dipendenza che scavalca il peso viene RIPORTATA', () => {
    const { weightInversions } = resolveLoadOrder([
      plugin('guardia', -5, ['utenti']),
      plugin('utenti', 0),
      plugin('altro', 0),
    ]);

    expect(weightInversions).toHaveLength(1);
    expect(weightInversions[0]).toMatchObject({
      name: 'guardia',
      weight: -5,
      blockingDep: { name: 'utenti', weight: 0 },
    });
    // Nomina CHI l'ha scavalcato: senza, il box direbbe che c'è un problema
    // senza dire quale.
    expect(weightInversions[0].overtaken.map((o) => o.name).sort()).toEqual(['altro', 'utenti']);
  });

  test('la disuguaglianza è STRETTA: a parità di peso non è un\'inversione', () => {
    // A peso uguale l'ordine lo decide il tiebreak alfabetico, e scavalcarlo non
    // tradisce nessuna intenzione dichiarata. Segnalarlo sarebbe rumore su ogni
    // boot di ogni installazione.
    const { order, weightInversions } = resolveLoadOrder([
      plugin('zeta', 0, ['alfa']),
      plugin('alfa', 0),
      plugin('beta', 0),
    ]);

    // `zeta` carica dopo `beta` pur precedendolo in alfabetico...
    expect(pos(order, 'zeta')).toBeGreaterThan(pos(order, 'beta'));
    // ...ma i pesi sono uguali, quindi nessuna inversione da segnalare.
    expect(weightInversions).toEqual([]);
  });

  test('la dipendenza vincolante è quella emessa PIÙ TARDI', () => {
    // È la risposta alla domanda che uno si fa leggendo il box: « e allora perché
    // carica lì? ». Indicare la prima dipendenza invece dell'ultima manderebbe
    // a guardare il posto sbagliato.
    const { weightInversions } = resolveLoadOrder([
      plugin('guardia', -20, ['presto', 'tardi']),
      plugin('presto', -10),
      plugin('tardi', 5),
      plugin('rumore', 0),
    ]);

    expect(weightInversions[0].blockingDep.name).toBe('tardi');
  });
});

describe('resolveLoadOrder() — ciò che non ha una posizione valida', () => {
  test('una dipendenza fuori dagli installabili lascia il plugin senza posizione', () => {
    // Il chiamante lo marca 'incomplete', come faceva la vecchia coda svuotandosi
    // senza progresso.
    const { order, unordered } = resolveLoadOrder([
      plugin('orfano', 0, ['maiInstallato']),
      plugin('sano', 0),
    ]);

    expect(order).toEqual(['sano']);
    expect(unordered).toEqual(['orfano']);
  });

  test('un ciclo non manda in loop: i coinvolti restano senza posizione', () => {
    // pluginStateResolver intercetta già i cicli a monte; questo ramo è la rete,
    // non il percorso previsto. Senza, il while girerebbe all\'infinito.
    const { order, unordered } = resolveLoadOrder([
      plugin('a', 0, ['b']), plugin('b', 0, ['a']), plugin('libero', 0),
    ]);

    expect(order).toEqual(['libero']);
    expect(unordered.sort()).toEqual(['a', 'b']);
  });

  test('un plugin che non dipende dal ciclo carica lo stesso', () => {
    const { order } = resolveLoadOrder([
      plugin('a', 0, ['b']), plugin('b', 0, ['a']), plugin('indipendente', -1),
    ]);

    expect(order).toEqual(['indipendente']);
  });

  test('lista vuota → risultato vuoto, nessun errore', () => {
    expect(resolveLoadOrder([])).toEqual({ order: [], unordered: [], weightInversions: [] });
  });

  test('argomento non-array → rilancia invece di restituire ordini fantasiosi', () => {
    expect(() => resolveLoadOrder(null)).toThrow(/must be an array/);
  });
});

describe('resolveLoadOrder() — forme accettate per le dipendenze', () => {
  // Il modulo è puro e testabile da solo: non deve dipendere dalla scelta di
  // `initialize()` di costruire una Map nome→range.
  test.each([
    ['Map', new Map([['base', '^1.0.0']])],
    ['array', ['base']],
    ['oggetto', { base: '^1.0.0' }],
    ['Set', new Set(['base'])],
  ])('dipendenze come %s', (_etichetta, deps) => {
    const { order } = resolveLoadOrder([
      { name: 'dipendente', weight: -50, pluginDeps: deps },
      { name: 'base', weight: 0, pluginDeps: null },
    ]);

    expect(order).toEqual(['base', 'dipendente']);
  });
});

describe('resolveLoadOrder() — la configurazione reale del progetto', () => {
  // Ancora al mondo vero: se un domani i weight o le dipendenze dei plugin
  // distribuiti cambiassero in modo da spostare l'ordine, questo test lo dice.
  const fs = require('fs');
  const path = require('path');
  const loadJson5 = require('../../core/loadJson5');
  const PLUGINS_DIR = path.join(__dirname, '../../plugins');

  const installabiliReali = () => {
    const out = [];
    for (const name of fs.readdirSync(PLUGINS_DIR)) {
      let cfg;
      try { cfg = loadJson5(path.join(PLUGINS_DIR, name, 'pluginConfig.json5')); } catch { continue; }
      if (cfg.active !== 1) continue;
      out.push(plugin(name, typeof cfg.weight === 'number' ? cfg.weight : 0,
        Object.keys(cfg.dependency || {})));
    }
    return out;
  };

  test('ogni dipendenza carica prima del suo dipendente', () => {
    const reali = installabiliReali();
    const { order } = resolveLoadOrder(reali);

    for (const candidato of reali) {
      for (const dep of candidato.pluginDeps.keys()) {
        if (!order.includes(dep)) continue; // dipendenza non attiva: non è ordinabile
        expect(pos(order, dep)).toBeLessThan(pos(order, candidato.name));
      }
    }
  });

  test('adminAccessControl non carica più per ultimo', () => {
    // Il caso che ha aperto D3: dichiara weight -5 — il più basso dopo
    // simpleI18n — e con il vecchio ordinamento caricava 22° su 22.
    const reali = installabiliReali();
    if (!reali.some((c) => c.name === 'adminAccessControl')) return;

    const { order } = resolveLoadOrder(reali);

    expect(pos(order, 'adminAccessControl')).toBeLessThan(order.length);
    // Subito dopo la sua unica dipendenza: è tutto ciò che il peso -5 può ottenere.
    expect(pos(order, 'adminAccessControl')).toBe(pos(order, 'adminUsers') + 1);
  });

  test('l\'unica inversione di peso è quella nota, e viene segnalata', () => {
    const { weightInversions } = resolveLoadOrder(installabiliReali());

    expect(weightInversions.map((i) => i.name)).toEqual(['adminAccessControl']);
    expect(weightInversions[0].blockingDep.name).toBe('adminUsers');
  });
});
