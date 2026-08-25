// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * L'ordine in cui i middleware dei plugin vengono montati.
 *
 * PERCHÉ ESISTE QUESTO FILE
 * -------------------------
 * L'ordine di CARICAMENTO dei plugin è anche l'ordine in cui `index.js` fa
 * `app.use()` dei loro middleware — `getMiddlewaresToLoad()` restituisce un array
 * costruito durante il caricamento, e index.js lo scorre in ordine. Quel legame
 * non era scritto da nessuna parte, e cambiando l'ordine di caricamento in v3.0.0
 * (da alfabetico a per-`weight`) è cambiato **anche** l'ordine dei middleware,
 * senza che nessun test se ne accorgesse.
 *
 * L'effetto misurato: `urlRedirect` ha cominciato a montare prima di `analytics`,
 * e siccome su una regola che matcha fa `ctx.redirect()` e ritorna **senza
 * `next()`**, il 100% dei 301/302 spariva dalle statistiche.
 *
 * COSA VIENE FISSATO QUI
 * ----------------------
 * Non l'ordine esatto dei 22 plugin — sarebbe un test che fallisce a ogni plugin
 * nuovo senza dire niente di utile. Si fissa l'**invariante semantica**: chi
 * OSSERVA il traffico deve montare prima di chi lo INTERROMPE. Chi aggiunge un
 * plugin che interrompe le richieste, o cambia un `weight`, lo scopre qui.
 */

const path = require('path');
const loadJson5 = require('../../core/loadJson5');

const PLUGINS_DIR = path.join(__dirname, '../../plugins');

/** Il `weight` dichiarato nel config VIVO — quello che il boot legge davvero. */
const weightOf = (plugin) => {
  const config = loadJson5(path.join(PLUGINS_DIR, plugin, 'pluginConfig.json5'));
  return typeof config.weight === 'number' ? config.weight : 0;
};

const isActive = (plugin) => {
  try {
    return loadJson5(path.join(PLUGINS_DIR, plugin, 'pluginConfig.json5')).active === 1;
  } catch {
    return false;
  }
};

/**
 * Plugin che INTERROMPONO la catena: su certe richieste rispondono e non
 * chiamano `next()`. Tutto ciò che deve osservare il traffico va montato prima.
 */
const INTERROMPONO = ['urlRedirect'];

/** Plugin che OSSERVANO: il loro middleware avvolge `await next()`. */
const OSSERVANO = ['analytics'];

describe('ordine dei middleware — chi osserva sta prima di chi interrompe', () => {
  test('il legame fra ordine di caricamento e ordine dei middleware è ancora questo', () => {
    // Se un domani `index.js` smettesse di montare i middleware nell'ordine
    // dell'array, l'invariante qui sotto perderebbe significato — e passerebbe
    // per il motivo sbagliato. Meglio accorgersene leggendo il sorgente.
    const indexSource = require('fs').readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
    expect(indexSource).toMatch(/getMiddlewaresToLoad\(\)/);
    expect(indexSource).toMatch(/app\.use\(\s*middleware\s*\)/);
  });

  test.each(OSSERVANO)('%s monta PRIMA di ogni plugin che interrompe', (osservatore) => {
    if (!isActive(osservatore)) return; // disattivato: niente da ordinare

    const pesoOsservatore = weightOf(osservatore);

    for (const interruttore of INTERROMPONO) {
      if (!isActive(interruttore)) continue;

      // Il weight decide l'ordine di caricamento, e quindi quello dei middleware.
      // Un osservatore con peso MAGGIORE monta dopo, e non vede le richieste che
      // l'altro ha già chiuso.
      expect({
        [osservatore]: pesoOsservatore,
        [interruttore]: weightOf(interruttore),
      }).toMatchObject({ [osservatore]: pesoOsservatore });

      expect(pesoOsservatore).toBeLessThan(weightOf(interruttore));
    }
  });

  test('urlRedirect interrompe davvero: non chiama next() dopo un redirect', () => {
    // È la premessa dell'invariante. Se un domani urlRedirect chiamasse next()
    // anche sui match, l'ordine smetterebbe di contare — e questo test lo direbbe
    // invece di lasciare in piedi un vincolo diventato inutile.
    const source = require('fs').readFileSync(
      path.join(PLUGINS_DIR, 'urlRedirect', 'main.js'), 'utf8');

    const dopoRedirect = source.slice(source.indexOf('ctx.redirect(finalUrl)'));
    expect(dopoRedirect).not.toMatch(/await next\(\)/);
  });

  test('analytics osserva davvero: il suo middleware avvolge next()', () => {
    const source = require('fs').readFileSync(
      path.join(PLUGINS_DIR, 'analytics', 'main.js'), 'utf8');
    expect(source).toMatch(/await next\(\)/);
  });
});
