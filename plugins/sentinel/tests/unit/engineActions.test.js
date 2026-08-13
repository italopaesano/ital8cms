/**
 * engineActions.test.js
 *
 * Le azioni che il motore decide di applicare, la forma della risposta che ne
 * consegue, e il perimetro di scrittura che il plugin dichiara al boot. Copre i
 * difetti trovati nella revisione completa (piano di consolidamento, step C1 e C3)
 * in cui il plugin faceva il contrario di quanto documentato:
 *
 *   • `throttle` finiva classificato come enforcement, e il gate — non trovando
 *     una funzione `respond` da chiamare — degradava al 404 comune. Una regola
 *     documentata come «delega a rateLimiter SENZA bloccare» bloccava tutto.
 *   • `serveDrop` assegnava `ctx.respond = false` prima di sapere se ci fosse un
 *     socket da troncare, e ritornava `true` comunque: senza socket la richiesta
 *     restava appesa, perché né il plugin né Koa né il gate rispondevano più.
 *   • `getWritablePaths` dichiarava scrivibile `decoys/data`, da cui il plugin
 *     legge soltanto: su un filesystem immutabile il gate di scrivibilità saltava
 *     l'intero plugin di sicurezza per una cartella di sola lettura.
 *
 * Si usa `module.exports._internals`, che inietta la config nel modulo attorno
 * alla chiamata (il motore tiene `custom` a livello di modulo).
 */

'use strict';

const path = require('path');
const sentinel = require('../../main');

const { shouldEnforce, serveDrop } = sentinel._internals;

/** Config in cui TUTTO dice «applica»: quel che resta a decidere è l'azione. */
function enforcingConfig(over = {}) {
  return Object.assign({
    enabled: true,
    mode: 'enforce',
    authenticatedTraffic: { mode: 'enforce', enforceExemptRoles: [] },
  }, over);
}

const anonymous = { authenticated: false, roleIds: [], ip: '203.0.113.7', path: '/x' };

describe('shouldEnforce — quali azioni producono una risposta', () => {
  // Le azioni che scrivono davvero qualcosa (o troncano la connessione).
  test.each(['block', 'drop', 'decoy', 'redirect', 'tarpit'])(
    '"%s" è enforcement quando i tetti lo consentono',
    (action) => {
      expect(shouldEnforce({ action }, anonymous, enforcingConfig())).toBe(true);
    },
  );

  // Le azioni che lasciano proseguire la richiesta.
  test.each(['allow', 'monitor', 'throttle'])(
    '"%s" non è enforcement nemmeno con tutti i tetti aperti',
    (action) => {
      expect(shouldEnforce({ action }, anonymous, enforcingConfig())).toBe(false);
    },
  );

  // IL DIFETTO. `throttle` non ha un responder: se fosse enforcement il gate
  // cadrebbe sul suo 404. Ma il danno non era solo quello — `enforced` alimenta
  // anche il conteggio dei blocchi del censimento delle impronte (da cui la
  // reputazione ricava suspect/bad) e la colonna enforced/observed della
  // dashboard. Doveva quindi valere false ovunque, non solo nel verdetto.
  test('throttle resta fuori dall enforcement qualunque sia il resto della config', () => {
    const rule = { action: 'throttle', escalate: { rateLimiterRule: 'scanner' } };
    for (const conf of [
      enforcingConfig(),
      enforcingConfig({ mode: 'monitor' }),
      enforcingConfig({ authenticatedTraffic: { mode: 'monitor' } }),
    ]) {
      expect(shouldEnforce(rule, anonymous, conf)).toBe(false);
    }
  });

  // I tetti continuano a valere per le azioni che rispondono: la correzione di
  // throttle non deve averli allentati.
  test('i tetti restano in vigore per le azioni che rispondono', () => {
    const rule = { action: 'block' };
    expect(shouldEnforce(rule, anonymous, enforcingConfig({ mode: 'monitor' }))).toBe(false);

    const admin = { authenticated: true, roleIds: [1], ip: '203.0.113.7', path: '/x' };
    expect(shouldEnforce(rule, admin, enforcingConfig({
      authenticatedTraffic: { mode: 'enforce', enforceExemptRoles: [0, 1] },
    }))).toBe(false);
  });
});

describe('serveDrop — troncare la connessione, o rinunciare', () => {
  function ctxWithSocket(socket) {
    return { res: { socket } };
  }

  test('con un socket vivo lo distrugge e dichiara di aver gestito', () => {
    let destroyed = false;
    const socket = { destroyed: false, destroy() { destroyed = true; this.destroyed = true; } };
    const ctx = ctxWithSocket(socket);

    expect(serveDrop(ctx, { trustProxy: false })).toBe(true);
    expect(destroyed).toBe(true);
    expect(ctx.respond).toBe(false); // Koa non deve finalizzare: la connessione non c'è più
  });

  // IL DIFETTO: senza socket non c'è niente da troncare. Rinunciando, il gate
  // può ancora scrivere il 404 comune; dichiarando di aver gestito, la richiesta
  // resterebbe appesa fino al timeout del client — e il contatore registrerebbe
  // un drop mai avvenuto.
  test('senza socket rinuncia e lascia il contesto intatto', () => {
    const ctx = ctxWithSocket(null);

    expect(serveDrop(ctx, { trustProxy: false })).toBe(false);
    expect(ctx.respond).toBeUndefined();
  });

  test('senza nemmeno ctx.res rinuncia allo stesso modo', () => {
    const ctx = {};
    expect(serveDrop(ctx, { trustProxy: false })).toBe(false);
    expect(ctx.respond).toBeUndefined();
  });

  // Un socket già distrutto: la connessione è comunque andata, non si richiama
  // destroy() e non si lascia la richiesta appesa.
  test('con un socket già distrutto non richiama destroy ma gestisce', () => {
    let calls = 0;
    const socket = { destroyed: true, destroy() { calls++; } };
    const ctx = ctxWithSocket(socket);

    expect(serveDrop(ctx, { trustProxy: false })).toBe(true);
    expect(calls).toBe(0);
    expect(ctx.respond).toBe(false);
  });

  // Dietro un reverse proxy il socket troncato è quello verso il proxy, che
  // risponderebbe 502: più rumoroso di un 404. Degrada da sé, e prima di tutto
  // il resto.
  test('con trustProxy rinuncia senza toccare il socket', () => {
    let calls = 0;
    const socket = { destroyed: false, destroy() { calls++; } };
    const ctx = ctxWithSocket(socket);

    expect(serveDrop(ctx, { trustProxy: true })).toBe(false);
    expect(calls).toBe(0);
    expect(ctx.respond).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Il perimetro di scrittura dichiarato al boot (consolidamento C3).
//
// `getWritablePaths` è sondato dal gate di scrivibilità con una scrittura VERA:
// una directory dichiarata e non scrivibile fa saltare l'intero plugin con un box
// [STORAGE]. Dichiarare più del necessario significa quindi poter perdere il
// filtro di sicurezza per una cartella da cui si legge soltanto — ed era il caso
// di `decoys/data`, mai scritta da nessuna parte del codice.
describe('getWritablePaths — solo ciò che si scrive davvero', () => {
  const folder = path.join(__dirname, '..', '..');

  test('dichiara la sola data dir', () => {
    const paths = sentinel.getWritablePaths(null, folder);
    expect(paths).toHaveLength(1);
    expect(paths[0].path).toBe(sentinel._internals.resolveDataDir(folder, {}));
  });

  test('non dichiara decoys/data, che il plugin non scrive mai', () => {
    const dichiarati = sentinel.getWritablePaths(null, folder).map((p) => p.path);
    expect(dichiarati.some((p) => p.includes(path.join('decoys', 'data')))).toBe(false);
  });

  test('ogni voce dichiarata ha uno scopo leggibile', () => {
    for (const voce of sentinel.getWritablePaths(null, folder)) {
      expect(typeof voce.path).toBe('string');
      expect(voce.purpose).toEqual(expect.any(String));
      expect(voce.purpose.length).toBeGreaterThan(0);
    }
  });
});
