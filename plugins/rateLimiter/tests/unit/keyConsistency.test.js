/**
 * Presidio di CUCITURA: la chiave del client deve essere la stessa su OGNI
 * confine del plugin × review della v3.49.0.
 *
 * ─── IL DIFETTO CHE QUESTO TEST ESISTE PER IMPEDIRE ──────────────────────────
 * La normalizzazione degli IPv6 alla /64 (REVIEW.md → C2) era applicata in UN
 * punto: `resolveClientId`, cioè il percorso di enforcement. Le API esposte al
 * plugin admin — `banClient`, `releaseBlock`, `releaseAllForClient` — ricevevano
 * l'indirizzo **come digitato nella GUI** e lo usavano come chiave.
 *
 * Misurato prima della correzione:
 *
 *     ban salvato sotto : 2001:db8::5
 *     enforcement cerca : 2001:db8:0:0::/64
 *     bloccato?         : false          ← il ban era INERTE
 *
 * Un amministratore bannava un IPv6, vedeva l'operazione riuscire, e non
 * bloccava nulla. Normalizzare in un punto solo non basta: va fatto su tutti i
 * confini, ed è una proprietà del MODULO, non di una funzione.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeIpForKey, resolveClientId } = require('../../lib/keyResolver');
const RateLimitEngine = require('../../lib/rateLimitEngine');

const policy = {
  findWindowSeconds: 600, maxFailures: 3, shortBlockSeconds: 60,
  maxShortBlocks: 2, longBlockSeconds: 3600, escalationResetSeconds: 86400,
};

describe('la chiave dell\'enforcement e quella delle azioni admin coincidono', () => {
  test('un ban su un IPv6 digitato blocca le richieste di quella /64', () => {
    const engine = new RateLimitEngine({ resolvePolicy: () => policy });
    const digitatoNellaGui = '2001:db8::5';

    // Come fa ora l'oggetto condiviso: normalizza al confine.
    engine.forceBlock(normalizeIpForKey(digitatoNellaGui), 'adminLogin', { seconds: 3600 });

    // Come arriva una richiesta vera.
    const chiaveEnforcement = resolveClientId({ ip: '2001:db8::9' });   // stessa /64
    expect(engine.check(chiaveEnforcement, 'adminLogin').blocked).toBe(true);
  });

  test('e lo sblocco trova quello stesso ban', () => {
    const engine = new RateLimitEngine({ resolvePolicy: () => policy });
    engine.forceBlock(normalizeIpForKey('2001:db8::5'), 'adminLogin', { seconds: 3600 });

    engine.releaseAllForClient(normalizeIpForKey('2001:db8::77'));      // stessa /64

    expect(engine.check(resolveClientId({ ip: '2001:db8::5' }), 'adminLogin').blocked).toBe(false);
  });

  test('un IPv4 bannato non blocca un altro IPv4', () => {
    // Il contrappeso: la normalizzazione non deve allargare il ban su IPv4.
    const engine = new RateLimitEngine({ resolvePolicy: () => policy });
    engine.forceBlock(normalizeIpForKey('192.168.1.7'), 'adminLogin', { seconds: 3600 });

    expect(engine.check(resolveClientId({ ip: '192.168.1.8' }), 'adminLogin').blocked).toBe(false);
    expect(engine.check(resolveClientId({ ip: '192.168.1.7' }), 'adminLogin').blocked).toBe(true);
  });
});

// ── Il presidio strutturale: nessun confine dimenticato ─────────────────────

describe('ogni API che prende un clientId lo normalizza', () => {
  // È la forma di presidio che serve qui: il difetto non stava in una funzione
  // sbagliata ma in un confine DIMENTICATO, e il prossimo confine aggiunto
  // domani lo dimenticherebbe allo stesso modo.
  const src = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((r) => !r.trim().startsWith('//') && !r.trim().startsWith('*')).join('\n');

  // La convenzione di nome rende l'invariante leggibile: `clientId` è
  // l'indirizzo COME ARRIVA DA FUORI, `clientKey` / `keyFrom(ctx)` è la chiave
  // già normalizzata. Il difetto del ban inerte è nato perché un solo nome
  // significava entrambe le cose nello stesso file.
  test('nessuna chiamata all\'engine riceve un `clientId` NON normalizzato', () => {
    const nude = (src.match(/engine\.[a-zA-Z]+\(\s*clientId\b/g) || []);
    expect(nude).toEqual([]);
  });

  test.each([
    'check', 'recordFailure', 'recordSuccess',
    'release', 'releaseAllForClient', 'forceBlock', 'checkClientLongBlock',
  ])('engine.%s( riceve una chiave normalizzata', (metodo) => {
    const chiamate = src.match(new RegExp(`engine\\.${metodo}\\([^)]*\\)`, 'g')) || [];

    expect(chiamate.length).toBeGreaterThan(0);
    for (const chiamata of chiamate) {
      const argomento = chiamata.slice(chiamata.indexOf('(') + 1);
      const normalizzata = argomento.includes('normalizeIpForKey(')
        || /^\s*clientKey\b/.test(argomento)
        || /^\s*keyFrom\(/.test(argomento);
      expect({ metodo, chiamata, normalizzata }).toMatchObject({ normalizzata: true });
    }
  });

  test('main.js importa il normalizzatore', () => {
    expect(src).toMatch(/normalizeIpForKey/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lo STATO PERSISTITO prima dell'aggiornamento — il rilievo che la review
// automatica non aveva visto.
//
// Il cambio di chiave non riguarda solo la memoria: lo stato dei blocchi è
// salvato su disco. Un blocco scritto dalla versione precedente con
// l'indirizzo INTERO non verrebbe più trovato dall'enforcement, che ora cerca
// la /64. Misurato prima della correzione: un blocco **attivo** risultava
// rilasciato al primo riavvio dopo l'aggiornamento.
// ─────────────────────────────────────────────────────────────────────────────

describe('lo stato salvato da una versione precedente viene ri-chiavato', () => {
  const fsp = require('fs');
  const os = require('os');
  const StateStore = require('../../lib/stateStore');

  const radici = [];
  afterEach(() => {
    for (const d of radici) { try { fsp.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
    radici.length = 0;
    jest.restoreAllMocks();
  });

  /** Scrive uno stato « vecchio stile » e lo fa caricare da uno store vero. */
  function caricaStatoVecchio(voci) {
    const root = fsp.mkdtempSync(path.join(os.tmpdir(), 'rl-state-'));
    radici.push(root);
    fsp.mkdirSync(path.join(root, 'state'));
    fsp.writeFileSync(path.join(root, 'state', 'activeBlocks.json5'), JSON.stringify(voci), 'utf8');

    const engine = new RateLimitEngine({ resolvePolicy: () => policy });
    const store = new StateStore(root, engine, {
      flushIntervalSeconds: 0,
      normalizeClientId: normalizeIpForKey,
    });
    store.init();
    return { engine, store };
  }

  const vocePerIpv6 = (ip, blockedUntil, extra = {}) => ({
    [`${ip}|adminLogin`]: {
      clientId: ip, ruleName: 'adminLogin', failureCount: 5, shortBlockCount: 1,
      windowStartAt: Date.now(), lastFailureAt: Date.now(), blockedUntil, tier: 'long', ...extra,
    },
  });

  test('un blocco ATTIVO sopravvive all\'aggiornamento', () => {
    const fino = Date.now() + 3600000;
    const { engine } = caricaStatoVecchio(vocePerIpv6('2001:db8::5', fino));

    const chiave = resolveClientId({ ip: '2001:db8::5' });
    expect(engine.check(chiave, 'adminLogin').blocked).toBe(true);
  });

  test('due indirizzi della stessa /64 si fondono in una voce', () => {
    const fino = Date.now() + 3600000;
    const { engine } = caricaStatoVecchio({
      ...vocePerIpv6('2001:db8::5', fino),
      ...vocePerIpv6('2001:db8::9', fino - 1000, { failureCount: 9, shortBlockCount: 2 }),
    });

    expect(engine.state.size).toBe(1);
  });

  test('la fusione tiene il valore PIÙ RESTRITTIVO, non l\'ultimo letto', () => {
    // Scartare il più severo regalerebbe all'attaccante la differenza fra i due
    // contatori che prima erano separati.
    const fino = Date.now() + 3600000;
    const { engine } = caricaStatoVecchio({
      ...vocePerIpv6('2001:db8::5', fino - 5000, { failureCount: 3, shortBlockCount: 1 }),
      ...vocePerIpv6('2001:db8::9', fino, { failureCount: 9, shortBlockCount: 2 }),
    });

    const voce = engine.state.get(`${normalizeIpForKey('2001:db8::5')}|adminLogin`);
    expect(voce).toMatchObject({ failureCount: 9, shortBlockCount: 2, blockedUntil: fino });
  });

  test('le chiavi IPv4 restano identiche: nessuna ri-chiavatura inutile', () => {
    const fino = Date.now() + 3600000;
    const { engine } = caricaStatoVecchio(vocePerIpv6('192.168.1.7', fino));

    expect(engine.state.has('192.168.1.7|adminLogin')).toBe(true);
  });

  test('una voce con una chiave malformata non fa cadere il caricamento', () => {
    // Robustezza: lo stato su disco può essere stato toccato a mano.
    const { engine } = caricaStatoVecchio({ 'senza-separatore': { failureCount: 1 } });
    expect(engine.state.size).toBeGreaterThanOrEqual(0);   // nessuna eccezione
  });
});

