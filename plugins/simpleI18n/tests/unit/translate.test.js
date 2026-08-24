// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/simpleI18n/main.js — traduzione e rilevamento della lingua.
 *
 * PERCHÉ
 * ------
 * `translate()` è la funzione `__()` che i template chiamano, ed è **l'unico caso
 * reale** del modello a whitelist delle funzioni globali descritto in CLAUDE.md.
 * Il plugin era senza un solo test.
 *
 * COME SI ESERCITA SENZA `loadPlugin()`
 * -------------------------------------
 * `loadPlugin()` legge `pluginConfig.json5` dal disco e assegna `this.config`.
 * I test non lo invocano: iniettano `config` direttamente sul modulo, che è
 * esattamente ciò che `loadPlugin()` farebbe, e ripristinano lo stato originale
 * in `afterEach`. Così nessun file viene letto e le catene di fallback sono
 * pilotabili — impossibile altrimenti, perché dipendono da `supportedLangs`.
 */

const plugin = require('../../main');

const CONFIG_BASE = {
  defaultLang: 'it',
  supportedLangs: ['it', 'en', 'fr'],
  enableQueryString: true,
  queryStringParam: 'lang',
  enableBrowserDetection: true,
  debugMode: false,
};

let configOriginale;

beforeEach(() => {
  configOriginale = plugin.config;
  plugin.config = { ...CONFIG_BASE };
});

afterEach(() => {
  plugin.config = configOriginale;
});

/** ctx minimo con una lingua già rilevata. */
const ctxConLang = (lang) => ({ state: { lang } });

describe('translate() — selezione della lingua', () => {
  const saluto = { it: 'Ciao', en: 'Hello', fr: 'Salut' };

  test('usa la lingua del ctx', () => {
    expect(plugin.translate(saluto, ctxConLang('en'))).toBe('Hello');
    expect(plugin.translate(saluto, ctxConLang('fr'))).toBe('Salut');
  });

  test('senza ctx usa la lingua di default', () => {
    expect(plugin.translate(saluto)).toBe('Ciao');
    expect(plugin.translate(saluto, null)).toBe('Ciao');
  });

  test('ctx senza state → lingua di default, non un errore', () => {
    expect(plugin.translate(saluto, {})).toBe('Ciao');
  });

  test('lingua richiesta assente → ricade sul default', () => {
    // Una traduzione mancante non deve produrre una pagina vuota.
    expect(plugin.translate({ it: 'Ciao' }, ctxConLang('en'))).toBe('Ciao');
  });

  test('manca anche il default → prima lingua supportata disponibile', () => {
    // Terzo livello di fallback: l\'ordine è quello di supportedLangs, non quello
    // delle chiavi dell\'oggetto.
    expect(plugin.translate({ fr: 'Salut' }, ctxConLang('en'))).toBe('Salut');
  });

  test('l\'ordine del fallback segue supportedLangs', () => {
    plugin.config = { ...CONFIG_BASE, defaultLang: 'de', supportedLangs: ['fr', 'en'] };
    // Sono presenti sia `en` sia `fr`: deve vincere `fr`, che viene prima.
    expect(plugin.translate({ en: 'Hello', fr: 'Salut' }, ctxConLang('de'))).toBe('Salut');
  });

  test('nessuna traduzione utilizzabile → segnaposto con la chiave, non stringa vuota', () => {
    // Un segnaposto visibile è diagnosticabile; una stringa vuota no.
    expect(plugin.translate({ key: 'homepage.titolo' }, ctxConLang('en'))).toBe('[homepage.titolo]');
  });

  test('nessuna traduzione e nessuna chiave → segnaposto generico', () => {
    expect(plugin.translate({}, ctxConLang('en'))).toBe('[missing-translation]');
  });
});

describe('translate() — interpolazione con Handlebars', () => {
  test('sostituisce le variabili dichiarate in `var`', () => {
    const res = plugin.translate({ it: 'Ciao {{nome}}', var: { nome: 'Italo' } });
    expect(res).toBe('Ciao Italo');
  });

  test('senza `var` il testo resta letterale, parentesi comprese', () => {
    // Nessuna compilazione: chi non usa variabili non paga il costo né il rischio.
    expect(plugin.translate({ it: 'Ciao {{nome}}' })).toBe('Ciao {{nome}}');
  });

  test('`var` non oggetto → nessuna interpolazione', () => {
    expect(plugin.translate({ it: 'Ciao {{nome}}', var: 'Italo' })).toBe('Ciao {{nome}}');
  });

  test('variabile mancante → segnaposto vuoto, non un crash', () => {
    expect(plugin.translate({ it: 'Ciao {{nome}}', var: { altro: 'x' } })).toBe('Ciao ');
  });

  test('Handlebars escapa l\'HTML nelle variabili interpolate', () => {
    // Le variabili possono venire da input utente: `{{ }}` escapa per default,
    // ed è la ragione per cui non serve un escape a valle.
    const res = plugin.translate({ it: 'Ciao {{nome}}', var: { nome: '<script>alert(1)</script>' } });
    expect(res).not.toContain('<script>');
    expect(res).toContain('&lt;script&gt;');
  });

  test('template malformato → si ricade sul testo non interpolato, senza lanciare', () => {
    const res = plugin.translate({ it: 'Ciao {{#if}}', key: 'rotta', var: { nome: 'x' } });
    expect(res).toBe('Ciao {{#if}}');
  });
});

describe('gli oggetti condivisi con template e plugin', () => {
  test('getGlobalFunctionsForTemplates() espone SOLO __()', () => {
    // È la funzione autorizzata dalla whitelist in ital8Config.json5: esporne
    // altre significherebbe chiedere privilegi che la whitelist non concede.
    const globals = plugin.getGlobalFunctionsForTemplates();
    expect(Object.keys(globals)).toEqual(['__']);
    expect(typeof globals.__).toBe('function');
  });

  test('__() esposta è legata al plugin e funziona staccata dall\'oggetto', () => {
    // Nei template viene invocata come funzione libera: senza il bind, `this`
    // sarebbe undefined e `this.config` esploderebbe.
    const { __ } = plugin.getGlobalFunctionsForTemplates();
    expect(__({ it: 'Ciao' })).toBe('Ciao');
  });

  test('getObjectToShareToWebPages() espone le quattro funzioni documentate', () => {
    const shared = plugin.getObjectToShareToWebPages();
    expect(Object.keys(shared).sort()).toEqual(['__', 'getConfig', 'getCurrentLang', 'getSupportedLangs']);
  });

  test('getCurrentLang() ricade sul default quando il ctx non ha lingua', () => {
    const { getCurrentLang } = plugin.getObjectToShareToWebPages();
    expect(getCurrentLang(ctxConLang('en'))).toBe('en');
    expect(getCurrentLang({})).toBe('it');
    expect(getCurrentLang(undefined)).toBe('it');
  });

  test('getSupportedLangs() e getConfig() restituiscono COPIE', () => {
    // Un template che mutasse la lista cambierebbe il comportamento del plugin
    // per tutte le richieste successive del processo.
    const shared = plugin.getObjectToShareToWebPages();

    shared.getSupportedLangs().push('de');
    expect(plugin.config.supportedLangs).toEqual(['it', 'en', 'fr']);

    shared.getConfig().defaultLang = 'de';
    expect(plugin.config.defaultLang).toBe('it');
  });
});

describe('middleware di rilevamento della lingua', () => {
  /** ctx minimo per il middleware. */
  const makeCtx = (query = {}, accepts = null) => ({
    path: '/pagina',
    query,
    state: {},
    acceptsLanguages: () => accepts,
  });

  const runMiddleware = async (ctx) => {
    const [middleware] = plugin.getMiddlewareToAdd();
    await middleware(ctx, async () => {});
    return ctx;
  };

  test('la query string ha la precedenza sul browser', async () => {
    const ctx = await runMiddleware(makeCtx({ lang: 'fr' }, 'en'));
    expect(ctx.state.lang).toBe('fr');
  });

  test('la query è normalizzata a minuscolo', async () => {
    const ctx = await runMiddleware(makeCtx({ lang: 'EN' }));
    expect(ctx.state.lang).toBe('en');
  });

  test('una lingua non supportata nella query viene ignorata', async () => {
    // Altrimenti `?lang=<script>` finirebbe in ctx.state.lang.
    const ctx = await runMiddleware(makeCtx({ lang: 'de' }));
    expect(ctx.state.lang).toBe('it');
  });

  test('senza query si usa il browser', async () => {
    const ctx = await runMiddleware(makeCtx({}, 'en'));
    expect(ctx.state.lang).toBe('en');
  });

  test('senza query né browser si usa il default', async () => {
    const ctx = await runMiddleware(makeCtx({}, false));
    expect(ctx.state.lang).toBe('it');
  });

  test('con enableQueryString spento la query è ignorata', async () => {
    plugin.config = { ...CONFIG_BASE, enableQueryString: false };
    const ctx = await runMiddleware(makeCtx({ lang: 'fr' }, false));
    expect(ctx.state.lang).toBe('it');
  });

  test('con enableBrowserDetection spento il browser è ignorato', async () => {
    plugin.config = { ...CONFIG_BASE, enableBrowserDetection: false };
    const ctx = await runMiddleware(makeCtx({}, 'en'));
    expect(ctx.state.lang).toBe('it');
  });

  test('il middleware chiama sempre next()', async () => {
    const [middleware] = plugin.getMiddlewareToAdd();
    const next = jest.fn(async () => {});
    await middleware(makeCtx(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
