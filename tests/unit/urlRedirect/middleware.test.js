// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per il MIDDLEWARE di urlRedirect (`plugins/urlRedirect/main.js`).
 *
 * PERCHÉ
 * ------
 * I tre file di test già presenti coprono le librerie (`redirectMatcher`,
 * `configValidator`, `hitCounter`) ma **non il middleware che le usa**: è lì che
 * vive la decisione su quali verbi intercettare, ed è lì che stava il difetto
 * corretto in v3.4.0 — un `HEAD` su un path redirezionato non seguiva il
 * redirect e serviva la risorsa da cui si sta redirezionando.
 *
 * COME SI ESERCITA
 * ----------------
 * `loadPlugin()` legge i config dal disco e assegna lo stato di modulo. I test
 * gli passano una cartella plugin **temporanea** con regole vere, così il
 * `redirectMap.json5` vivo dell'installazione (che oggi non ha regole attive)
 * non serve e non viene toccato.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../../../plugins/urlRedirect/main');

/** Cartella plugin temporanea, con regole vere e contatore a scrittura immediata. */
let tmpFolder;
/** Handler di segnale presenti PRIMA di loadPlugin: si rimuovono solo i nuovi. */
let sigtermPrima;
let sigintPrima;

const CUSTOM = {
  enableHitCounter: true,
  hitCounterFlushInterval: 0, // scrittura immediata → nessun timer da ripulire
  preserveQueryString: true,
  normalizeTrailingSlash: true,
  caseSensitive: true,
  enablePatternMatching: true,
  enableRegex: true,
  allowExternalRedirects: false,
  enableLogging: false,
  strictValidation: false,
};

const REGOLE = [
  { from: '/vecchia-pagina', to: '/nuova-pagina', type: 301 },
  { from: '/temporanea', to: '/destinazione', type: 302 },
];

beforeAll(async () => {
  sigtermPrima = process.listeners('SIGTERM').slice();
  sigintPrima = process.listeners('SIGINT').slice();

  tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'urlRedirect-mw-'));
  fs.writeFileSync(
    path.join(tmpFolder, 'pluginConfig.json5'),
    JSON.stringify({ schemaVersion: 1, active: 1, custom: CUSTOM }, null, 2),
  );
  fs.writeFileSync(
    path.join(tmpFolder, 'redirectMap.json5'),
    JSON.stringify({ schemaVersion: 1, redirects: REGOLE }, null, 2),
  );

  await plugin.loadPlugin(null, tmpFolder);
});

afterAll(() => {
  // Rimuove SOLO gli handler registrati da questo test: `removeAllListeners`
  // toglierebbe anche quelli di codice estraneo in esecuzione nello stesso worker.
  for (const l of process.listeners('SIGTERM')) {
    if (!sigtermPrima.includes(l)) process.removeListener('SIGTERM', l);
  }
  for (const l of process.listeners('SIGINT')) {
    if (!sigintPrima.includes(l)) process.removeListener('SIGINT', l);
  }
  fs.rmSync(tmpFolder, { recursive: true, force: true });
});

/** ctx minimo: registra status e Location come farebbe Koa. */
function makeCtx(method, urlPath, querystring = '') {
  return {
    method,
    path: urlPath,
    querystring,
    status: 404,
    headers: {},
    redirect(url) {
      this.headers.location = url;
    },
  };
}

/** Esegue il middleware e dice se ha ceduto il passo (`next()` chiamato). */
async function esegui(ctx) {
  const [middleware] = plugin.getMiddlewareToAdd();
  let proseguito = false;
  await middleware(ctx, async () => { proseguito = true; });
  return { ctx, proseguito };
}

describe('il middleware intercetta i verbi di sola lettura', () => {
  test('GET su un path redirezionato → 301 con Location', async () => {
    const { ctx, proseguito } = await esegui(makeCtx('GET', '/vecchia-pagina'));

    expect(ctx.status).toBe(301);
    expect(ctx.headers.location).toBe('/nuova-pagina');
    // Se avesse ceduto il passo, il server statico avrebbe servito la vecchia risorsa.
    expect(proseguito).toBe(false);
  });

  test('HEAD su un path redirezionato → identico a GET (corretto in v3.4.0)', async () => {
    // Era il difetto: `if (ctx.method !== 'GET')` faceva cedere il passo, e con
    // koa-classic-server 5.3.0 (che serve HEAD) la risposta diventava un 200
    // sulla risorsa da cui si sta redirezionando — senza alcun Location.
    const { ctx, proseguito } = await esegui(makeCtx('HEAD', '/vecchia-pagina'));

    expect(ctx.status).toBe(301);
    expect(ctx.headers.location).toBe('/nuova-pagina');
    expect(proseguito).toBe(false);
  });

  test('GET e HEAD producono lo STESSO status e lo STESSO Location', async () => {
    // RFC 9110 §9.3.2: HEAD è GET senza corpo. È l'invariante che il difetto
    // rompeva, e va asserita come confronto fra i due, non a valori fissi.
    const { ctx: get } = await esegui(makeCtx('GET', '/temporanea'));
    const { ctx: head } = await esegui(makeCtx('HEAD', '/temporanea'));

    expect(head.status).toBe(get.status);
    expect(head.headers.location).toBe(get.headers.location);
    expect(head.status).toBe(302); // il `type` della regola, non un default
  });

  test.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])(
    '%s NON viene redirezionato: cede il passo',
    async (metodo) => {
      // Un 301 su una POST cambierebbe il verbo del client e perderebbe il corpo.
      const { ctx, proseguito } = await esegui(makeCtx(metodo, '/vecchia-pagina'));

      expect(proseguito).toBe(true);
      expect(ctx.headers.location).toBeUndefined();
    },
  );

  test('un path senza regole cede il passo, su entrambi i verbi', async () => {
    for (const metodo of ['GET', 'HEAD']) {
      const { ctx, proseguito } = await esegui(makeCtx(metodo, '/path-senza-regola'));
      expect(proseguito).toBe(true);
      expect(ctx.headers.location).toBeUndefined();
    }
  });

  test('la query string è preservata su GET e su HEAD allo stesso modo', async () => {
    const { ctx: get } = await esegui(makeCtx('GET', '/vecchia-pagina', 'a=1&b=2'));
    const { ctx: head } = await esegui(makeCtx('HEAD', '/vecchia-pagina', 'a=1&b=2'));

    expect(get.headers.location).toBe('/nuova-pagina?a=1&b=2');
    expect(head.headers.location).toBe(get.headers.location);
  });
});

describe('hit counter e verbi', () => {
  const conteggio = (from) => {
    const dati = plugin.getObjectToShareToOthersPlugin('test', null, tmpFolder).getHitCounts();
    return dati[from] ? dati[from].hitCount : 0;
  };

  test('un HEAD redirezionato INCREMENTA il contatore, come un GET', async () => {
    // DECISIONE (v3.4.0): il contatore misura « quante volte una regola è stata
    // usata », e un HEAD a cui si è risposto 301 l'ha usata. Non contarlo
    // significherebbe re-introdurre nelle statistiche la stessa divergenza
    // GET/HEAD appena corretta nel redirect.
    const prima = conteggio('/temporanea');

    await esegui(makeCtx('HEAD', '/temporanea'));
    expect(conteggio('/temporanea')).toBe(prima + 1);

    await esegui(makeCtx('GET', '/temporanea'));
    expect(conteggio('/temporanea')).toBe(prima + 2);
  });

  test('un verbo non intercettato NON incrementa il contatore', async () => {
    const prima = conteggio('/vecchia-pagina');
    await esegui(makeCtx('POST', '/vecchia-pagina'));
    expect(conteggio('/vecchia-pagina')).toBe(prima);
  });
});
