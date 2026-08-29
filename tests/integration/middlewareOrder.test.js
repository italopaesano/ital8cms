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
 *
 * SI CONFRONTA L'ORDINE, NON IL PESO (da v3.15.0)
 * -----------------------------------------------
 * La prima versione di questo file confrontava i `weight` dichiarati, dando per
 * scontato che un peso minore significasse « monta prima ». È esattamente
 * l'assunzione che il difetto D3 ha smontato: `adminAccessControl` dichiarava
 * -5 e caricava ULTIMO, perché i plugin con dipendenze venivano accodati dopo
 * tutti quelli senza. Un test costruito su quell'assunzione sarebbe passato
 * mentre l'invariante era violata.
 *
 * Ora si chiede l'ordine a `resolveLoadOrder`, cioè allo stesso modulo che il
 * boot usa per deciderlo: il confronto è sul risultato, non su una scorciatoia.
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const resolveLoadOrder = require('../../core/pluginLoadOrder');

const PLUGINS_DIR = path.join(__dirname, '../../plugins');

const isActive = (plugin) => {
  try {
    return loadJson5(path.join(PLUGINS_DIR, plugin, 'pluginConfig.json5')).active === 1;
  } catch {
    return false;
  }
};

/**
 * L'ordine di caricamento REALE dei plugin attivi, calcolato dallo stesso modulo
 * che usa il boot. È anche l'ordine in cui i middleware vengono montati.
 */
const ordineReale = () => {
  const installabili = [];
  for (const name of fs.readdirSync(PLUGINS_DIR)) {
    let config;
    try { config = loadJson5(path.join(PLUGINS_DIR, name, 'pluginConfig.json5')); } catch { continue; }
    if (config.active !== 1) continue;
    installabili.push({
      name,
      weight: typeof config.weight === 'number' ? config.weight : 0,
      pluginDeps: new Map(Object.entries(config.dependency || {})),
    });
  }
  return resolveLoadOrder(installabili).order;
};

/**
 * Plugin che INTERROMPONO la catena: su certe richieste rispondono e non
 * chiamano `next()`. Tutto ciò che deve osservare il traffico va montato prima.
 *
 * `adminAccessControl` è entrato in questa lista con v3.15.0. Interrompeva anche
 * prima — il suo middleware fa `ctx.redirect()` o imposta uno status e ritorna —
 * ma caricando ULTIMO la domanda « chi osserva sta prima? » non si poneva mai.
 * Con l'ordinamento topologico carica in mezzo al gruppo, e il vincolo diventa
 * reale: va presidiato.
 */
const INTERROMPONO = ['urlRedirect', 'adminAccessControl'];

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

    const ordine = ordineReale();
    const posizione = (nome) => ordine.indexOf(nome);
    expect(posizione(osservatore)).toBeGreaterThanOrEqual(0);

    for (const interruttore of INTERROMPONO) {
      if (!isActive(interruttore)) continue;

      // Si confronta la POSIZIONE nell'ordine calcolato, non il weight: un peso
      // minore non basta a garantire « monta prima », perché una dipendenza può
      // frenare il plugin (è il caso di adminAccessControl, weight -5).
      //
      // Una sola asserzione, quella che può fallire. La versione precedente ne
      // aveva anche una decorativa — `expect({a, b}).toMatchObject({a})` con `a`
      // calcolato dalla stessa espressione da entrambe le parti — che era vera
      // per QUALUNQUE ordine, violazioni comprese: rumore in un test il cui unico
      // scopo è presidiare questo vincolo. Il contesto non serviva comunque:
      // `toBeLessThan` stampa già entrambe le posizioni quando fallisce.
      expect(posizione(osservatore)).toBeLessThan(posizione(interruttore));
    }
  });

  test('CHI contribuisce davvero un middleware — sei, non nove', () => {
    // ERA UN ERRORE DI MISURA MIO, trovato dalla review (rettificato in v3.20.0).
    // Avevo contato le FUNZIONI `getMiddlewareToAdd()` invocate — nove — e scritto
    // « nove middleware » in `CLAUDE.md` e nel changelog. Tre di quelle funzioni
    // restituiscono un array vuoto: `admin`, `csrfProtection` e `mailer`
    // dichiarano il metodo ma non sono nella catena Koa. In particolare il CSRF
    // NON è un middleware — l'enforcement vive nel route-wrap del core — e
    // ragionare sull'ordine includendolo porta a conclusioni sbagliate su quando
    // viene applicato.
    //
    // COME È STATA MISURATA questa classificazione, e come rifarla: caricare i
    // plugin veri con `pluginSys.initialize()` e invocare
    // `getMiddlewareToAdd({})` su ciascuno, contando chi restituisce un array non
    // vuoto. Qui NON si fa: caricare i plugin veri dentro la suite avvierebbe i
    // loro timer (buffer analytics, worker mailer, flush urlRedirect), e un
    // `require()` di tutti i main.js è già bastato a bloccare un processo in
    // questa branch. Le due liste sono quindi il RISULTATO di quella misura, e il
    // test presidia due cose: che restino queste, e che un plugin nuovo che
    // dichiari il metodo debba essere classificato a mano invece di scivolare
    // dentro senza che nessuno decida se osserva o interrompe.
    const CONTRIBUISCONO = [
      'adminAccessControl', 'adminUsers', 'analytics', 'rateLimiter', 'simpleI18n', 'urlRedirect',
    ];
    const DICHIARANO_MA_VUOTO = ['admin', 'csrfProtection', 'mailer'];

    const dichiarano = [];
    for (const nome of fs.readdirSync(PLUGINS_DIR)) {
      if (!isActive(nome)) continue;
      const mainPath = path.join(PLUGINS_DIR, nome, 'main.js');
      if (!fs.existsSync(mainPath)) continue;
      if (/\bgetMiddlewareToAdd\b/.test(fs.readFileSync(mainPath, 'utf8'))) dichiarano.push(nome);
    }

    // Nessun plugin attivo dichiara il metodo senza essere in una delle due liste:
    // se ne compare uno nuovo, questo test lo nomina e chiede di classificarlo.
    expect(dichiarano.sort()).toEqual([...CONTRIBUISCONO, ...DICHIARANO_MA_VUOTO].sort());

    // E i tre che NON contribuiscono restano fuori dalla catena: se uno di loro
    // cominciasse a registrare un middleware, l'ordine documentato cambierebbe e
    // andrebbe rimisurato.
    for (const nome of DICHIARANO_MA_VUOTO) {
      const sorgente = fs.readFileSync(path.join(PLUGINS_DIR, nome, 'main.js'), 'utf8');
      const senzaCommenti = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(senzaCommenti).not.toMatch(/middlewareArray\.push\s*\(/);
    }
  });

  test('la documentazione non torna a dire « nove »', () => {
    // Presidia la rettifica dove è stata scritta: `CLAUDE.md` è il documento che
    // chi progetta un plugin legge per capire l'annidamento dei middleware.
    const claude = fs.readFileSync(path.join(__dirname, '../../CLAUDE.md'), 'utf8');
    const sezione = claude.slice(claude.indexOf('### Ordine di caricamento'),
                                claude.indexOf('### Stati dei plugin'));

    expect(sezione).toMatch(/contribuiscono \*\*davvero\*\* un\s+> middleware sono \*\*sei\*\*/);
    expect(sezione).not.toMatch(/dei nove/);
  });

  test('adminAccessControl interrompe davvero: redirect/status senza next()', () => {
    // La premessa della sua presenza in INTERROMPONO. Il middleware fa
    // `ctx.redirect(...)` e `return`, oppure imposta uno status e `return`:
    // in entrambi i casi ciò che sta a valle non vede la richiesta.
    const source = fs.readFileSync(
      path.join(PLUGINS_DIR, 'adminAccessControl', 'lib', 'accessManager.js'), 'utf8');

    const middleware = source.slice(source.indexOf('createMiddleware()'));
    expect(middleware).toMatch(/ctx\.redirect\(/);
    // Dopo il redirect esce: se un domani chiamasse next(), smetterebbe di
    // interrompere e questo vincolo diventerebbe inutile senza dirlo.
    const dopoRedirect = middleware.slice(middleware.indexOf('ctx.redirect('));
    const primoReturn = dopoRedirect.indexOf('return;');
    expect(primoReturn).toBeGreaterThan(-1);
    expect(dopoRedirect.slice(0, primoReturn)).not.toMatch(/await next\(\)/);
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
