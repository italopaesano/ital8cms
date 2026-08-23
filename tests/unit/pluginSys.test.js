// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per core/pluginSys.js — il modulo REALE.
 *
 * PERCHÉ QUESTO FILE È STATO RISCRITTO (v2.97.0)
 * ----------------------------------------------
 * La versione precedente non conteneva alcun `require` di core/pluginSys.js:
 * l'unico import era `semver`. Le funzioni verificate — risoluzione delle
 * dipendenze, rilevamento dei cicli, ordinamento per weight — erano RISCRITTE
 * dentro il file di test, sotto un commento che lo dichiarava
 * («Funzione estratta da pluginSys per testing»). I test passavano e
 * verificavano una copia: il modulo vero risultava a 0% di copertura, e una
 * regressione al suo interno non avrebbe fatto fallire niente.
 *
 * È lo stesso antipattern già corretto per themeSys in v2.90.0 («i nuovi test
 * esercitano la funzione REALE, non una copia»), rimasto qui.
 *
 * PERIMETRO ATTUALE, E PERCHÉ NON È ANCORA TUTTO
 * ----------------------------------------------
 * `initialize()` — dove vivono caricamento, stati, dipendenze e cicli — risolve
 * i plugin con `path.join(__dirname, '..', 'plugins')`, cioè la cartella REALE
 * del progetto, e non accetta una root alternativa. Eseguirlo qui caricherebbe
 * i plugin veri in-process e SCRIVEREBBE `isInstalled` nei loro config vivi:
 * contro la regola di isolamento filesystem di docs/testing.it.md.
 *
 * Questo file copre quindi tutta la superficie raggiungibile SENZA initialize():
 * costruttore, accessori, contratto degli oggetti restituiti (copie difensive) e
 * getGlobalFunctions(), che è pilotato dalla configurazione iniettata nel
 * costruttore ed è quindi interamente esercitabile.
 *
 * Il resto richiede una root dei plugin iniettabile — la stessa correzione già
 * applicata a validateThemeContent() in v2.92.0, che cablava la root dei temi.
 * Vedi TODO.md §5.
 */

const pluginSys = require('../../core/pluginSys');

// Il modulo logga su console in diversi rami (warning sulla whitelist, banner
// dell'errore fatale). I test li esercitano di proposito, quindi le console
// vengono silenziate qui invece di sporcare l'output della suite.
let consoleSpies = [];

beforeEach(() => {
  consoleSpies = [
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
  consoleSpies = [];
});

describe('pluginSys — costruttore', () => {
  test('costruire non tocca il filesystem né carica plugin', () => {
    // Il costruttore fa SOLO setup dei campi: il caricamento è in initialize().
    // Se un giorno tornasse a scandire plugins/, questo test se ne accorge.
    const sys = new pluginSys({});

    expect(sys.getActivePluginNames()).toEqual([]);
    expect(sys.getAllPlugins()).toEqual([]);
    expect(sys.getPluginStates().size).toBe(0);
  });

  test('accetta una configurazione assente senza lanciare', () => {
    expect(() => new pluginSys(undefined)).not.toThrow();
  });
});

describe('pluginSys — accessori sullo stato iniziale', () => {
  let sys;
  beforeEach(() => { sys = new pluginSys({}); });

  test('getPluginState() di un plugin sconosciuto è null, non undefined', () => {
    expect(sys.getPluginState('nonEsiste')).toBeNull();
  });

  test('isPluginActive() è false per un plugin non caricato', () => {
    expect(sys.isPluginActive('adminUsers')).toBe(false);
  });

  test('getPlugin() di un plugin non attivo è null', () => {
    expect(sys.getPlugin('adminUsers')).toBeNull();
  });

  test('getMiddlewaresToLoad() parte da un array vuoto', () => {
    expect(sys.getMiddlewaresToLoad()).toEqual([]);
  });

  test('getObjectsToShareInWebPages() parte da un oggetto vuoto', () => {
    expect(sys.getObjectsToShareInWebPages()).toEqual({});
  });

  test('getPluginVersion() è null per un plugin non attivo, senza leggere il disco', () => {
    // Cortocircuita su isPluginActive(): non deve arrivare a cercare
    // pluginDescription.json5, altrimenti un plugin inesistente produrrebbe
    // un warning invece di un null pulito.
    expect(sys.getPluginVersion('nonEsiste')).toBeNull();
  });
});

describe('pluginSys — gli accessori restituiscono COPIE, non lo stato interno', () => {
  // Se restituissero il riferimento vivo, un chiamante potrebbe corrompere lo
  // stato del sistema plugin per sbaglio. È un contratto, non un dettaglio.
  test('getPluginStates(): mutare la mappa restituita non tocca il sistema', () => {
    const sys = new pluginSys({});
    const states = sys.getPluginStates();
    states.set('intruso', { state: 'installed' });

    expect(sys.getPluginStates().has('intruso')).toBe(false);
    expect(sys.getPluginState('intruso')).toBeNull();
  });

  test('getReservedRoutePaths(): mutare il Set restituito non tocca l\'indice', () => {
    const sys = new pluginSys({});
    const paths = sys.getReservedRoutePaths();
    paths.add('/api/intruso');

    expect(sys.getReservedRoutePaths().has('/api/intruso')).toBe(false);
    expect(sys.getReservedRoutePaths().size).toBe(0);
  });
});

describe('pluginSys — dependency injection dei sottosistemi', () => {
  let sys;
  beforeEach(() => { sys = new pluginSys({}); });

  test('themeSys: null prima, restituito dopo', () => {
    expect(sys.getThemeSys()).toBeNull();
    const fakeThemeSys = { marker: 'themeSys' };
    sys.setThemeSys(fakeThemeSys);
    expect(sys.getThemeSys()).toBe(fakeThemeSys);
  });

  test('reservedGate: null prima, restituito dopo', () => {
    expect(sys.getReservedGate()).toBeNull();
    const fakeGate = { isClosed: () => false };
    sys.setReservedGate(fakeGate);
    expect(sys.getReservedGate()).toBe(fakeGate);
  });

  test('adminSystem: null prima, restituito dopo (init a 2 fasi)', () => {
    expect(sys.getAdminSystem()).toBeNull();
    const fakeAdmin = { marker: 'adminSystem' };
    sys.setAdminSystem(fakeAdmin);
    expect(sys.getAdminSystem()).toBe(fakeAdmin);
  });
});

describe('pluginSys — requestRestart()', () => {
  test('senza callback registrato ritorna false e non lancia', () => {
    // Situazione anomala ma non fatale: il chiamante deve poterla distinguere.
    const sys = new pluginSys({});
    expect(sys.requestRestart({ reason: 'test' })).toBe(false);
  });

  test('con callback registrato lo invoca e ritorna true', () => {
    const sys = new pluginSys({});
    const callback = jest.fn();
    sys.setRequestRestart(callback);

    expect(sys.requestRestart({ reason: 'cambio tema' })).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ reason: 'cambio tema' });
  });

  test('invocata senza argomenti passa un oggetto vuoto, non undefined', () => {
    const sys = new pluginSys({});
    const callback = jest.fn();
    sys.setRequestRestart(callback);

    sys.requestRestart();
    expect(callback).toHaveBeenCalledWith({});
  });
});

describe('pluginSys — getSharedObject()', () => {
  test('provider non attivo → null (non lancia)', () => {
    const sys = new pluginSys({});
    expect(sys.getSharedObject('dbApi')).toBeNull();
  });

  test('provider non attivo → null anche indicando il chiamante', () => {
    const sys = new pluginSys({});
    expect(sys.getSharedObject('dbApi', 'adminMedia')).toBeNull();
  });
});

describe('pluginSys — getGlobalFunctions(): il modello a whitelist', () => {
  test('whitelist assente → nessuna funzione globale', () => {
    const sys = new pluginSys({});
    expect(sys.getGlobalFunctions()).toEqual({});
  });

  test('whitelist vuota → nessuna funzione globale', () => {
    const sys = new pluginSys({ globalFunctionsWhitelist: {} });
    expect(sys.getGlobalFunctions()).toEqual({});
  });

  test('required:true con plugin NON attivo → lancia (fail-fast al boot)', () => {
    // È il contratto dichiarato in CLAUDE.md: una funzione dichiarata
    // indispensabile e non disponibile deve fermare il boot, non degradare.
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n', required: true, description: 'traduzioni' },
      },
    });

    expect(() => sys.getGlobalFunctions()).toThrow(/simpleI18n/);
    expect(() => sys.getGlobalFunctions()).toThrow(/__/);
  });

  test('required:false con plugin NON attivo → fallback, nessun throw', () => {
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n', required: false },
      },
    });

    const globals = sys.getGlobalFunctions();
    expect(typeof globals.__).toBe('function');
  });

  test('required omesso equivale a false (default permissivo)', () => {
    const sys = new pluginSys({
      globalFunctionsWhitelist: {
        __: { plugin: 'simpleI18n' },
      },
    });

    expect(() => sys.getGlobalFunctions()).not.toThrow();
    expect(typeof sys.getGlobalFunctions().__).toBe('function');
  });
});

describe('pluginSys — le funzioni di fallback restano usabili nei template', () => {
  // Un fallback che lancia trasformerebbe un plugin mancante in una pagina
  // rotta: il punto del required:false è esattamente evitarlo.
  const buildFallback = (functionName) => new pluginSys({
    globalFunctionsWhitelist: {
      [functionName]: { plugin: 'simpleI18n', required: false },
    },
  }).getGlobalFunctions()[functionName];

  test('__(): restituisce la traduzione inglese quando c\'è', () => {
    expect(buildFallback('__')({ en: 'Hello', it: 'Ciao' })).toBe('Hello');
  });

  test('__(): ricade sulla prima lingua disponibile se manca l\'inglese', () => {
    expect(buildFallback('__')({ it: 'Ciao' })).toBe('Ciao');
    expect(buildFallback('__')({ de: 'Hallo' })).toBe('Hallo');
  });

  test('__(): nessuna traduzione → segnaposto esplicito, non stringa vuota', () => {
    expect(buildFallback('__')({})).toBe('[NO TRANSLATION]');
    expect(buildFallback('__')(undefined)).toBe('[NO TRANSLATION]');
  });

  test('funzione generica: restituisce stringa vuota e non lancia', () => {
    const fallback = buildFallback('formatPrice');
    expect(fallback()).toBe('');
    expect(fallback(1, 2, 3)).toBe('');
  });
});
