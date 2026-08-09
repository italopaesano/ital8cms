const { buildFingerprint, classifyHeaderProfile, extractHeaderOrder } = require('../../lib/requestFingerprint');

/**
 * Contesto Koa minimo. `rawHeaders` è l'array piatto che Node espone
 * nell'ordine di arrivo: è metà del valore dell'impronta.
 */
function makeCtx(headerPairs, httpVersion = '1.1') {
  const headers = {};
  const rawHeaders = [];
  for (const [name, value] of headerPairs) {
    headers[name.toLowerCase()] = value;
    rawHeaders.push(name, value);
  }
  return {
    headers,
    req: { rawHeaders, httpVersion, headers },
    get: (name) => headers[name.toLowerCase()],
  };
}

const CHROME_HEADERS = [
  ['Host', 'example.com'],
  ['Connection', 'keep-alive'],
  ['sec-ch-ua', '"Chromium";v="120"'],
  ['Upgrade-Insecure-Requests', '1'],
  ['User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'],
  ['Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
  ['Sec-Fetch-Site', 'none'],
  ['Sec-Fetch-Mode', 'navigate'],
  ['Sec-Fetch-Dest', 'document'],
  ['Accept-Encoding', 'gzip, deflate, br'],
  ['Accept-Language', 'it-IT,it;q=0.9'],
];

const CURL_HEADERS = [
  ['Host', 'example.com'],
  ['User-Agent', 'curl/8.5.0'],
  ['Accept', '*/*'],
];

describe('extractHeaderOrder', () => {
  test('conserva l ordine di arrivo ed esclude i volatili', () => {
    const ctx = makeCtx(CURL_HEADERS);
    const order = extractHeaderOrder(ctx.req);
    expect(order).toEqual(['accept']); // host e user-agent sono volatili
  });

  test('ripiega sull insieme ordinato se rawHeaders manca', () => {
    const ctx = makeCtx(CURL_HEADERS);
    delete ctx.req.rawHeaders;
    expect(Array.isArray(extractHeaderOrder(ctx.req))).toBe(true);
  });
});

describe('classifyHeaderProfile', () => {
  test('browser: manda i segnali che solo un browser manda', () => {
    const ctx = makeCtx(CHROME_HEADERS);
    expect(classifyHeaderProfile(ctx.headers)).toBe('browser');
  });

  test('minimal: l essenziale e nulla piu', () => {
    const ctx = makeCtx(CURL_HEADERS);
    expect(classifyHeaderProfile(ctx.headers)).toBe('minimal');
  });

  test('partial: negozia contenuto senza i segnali da browser', () => {
    const ctx = makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'python-requests/2.31.0'],
      ['Accept', 'application/json'],
      ['Accept-Encoding', 'gzip, deflate'],
    ]);
    expect(classifyHeaderProfile(ctx.headers)).toBe('partial');
  });
});

describe('buildFingerprint — indipendenza dallo User-Agent', () => {
  // È la regola di progetto centrale: se l'UA entrasse nell'impronta, le due
  // cose varierebbero insieme e non si potrebbero confrontare.
  test('cambiare SOLO lo User-Agent non cambia l impronta', () => {
    const honest = makeCtx(CURL_HEADERS);
    const lying = makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'],
      ['Accept', '*/*'],
    ]);
    expect(buildFingerprint(lying).fp).toBe(buildFingerprint(honest).fp);
  });

  test('client diversi producono impronte diverse', () => {
    expect(buildFingerprint(makeCtx(CHROME_HEADERS)).fp)
      .not.toBe(buildFingerprint(makeCtx(CURL_HEADERS)).fp);
  });

  test('l impronta e stabile a parita di richiesta', () => {
    expect(buildFingerprint(makeCtx(CHROME_HEADERS)).fp)
      .toBe(buildFingerprint(makeCtx(CHROME_HEADERS)).fp);
  });

  test('anche l ordine degli header conta', () => {
    // Fra header NON volatili: host e user-agent sono esclusi dalla firma, quindi
    // scambiarli fra loro non cambia nulla — ed è giusto così.
    const reordered = [...CHROME_HEADERS];
    const i = reordered.findIndex(([n]) => n === 'Accept-Encoding');
    const j = reordered.findIndex(([n]) => n === 'Accept-Language');
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];

    expect(buildFingerprint(makeCtx(reordered)).fp)
      .not.toBe(buildFingerprint(makeCtx(CHROME_HEADERS)).fp);
  });

  test('scambiare due header volatili non cambia la firma', () => {
    const reordered = [CURL_HEADERS[0], CURL_HEADERS[2], CURL_HEADERS[1]];
    expect(buildFingerprint(makeCtx(reordered)).fp)
      .toBe(buildFingerprint(makeCtx(CURL_HEADERS)).fp);
  });
});

describe('buildFingerprint — memoizzazione sul socket', () => {
  // Con keep-alive una pagina porta decine di richieste sulla stessa
  // connessione, e un client non cambia libreria HTTP a metà connessione.
  function ctxWithSocket(headerPairs, socket) {
    const ctx = makeCtx(headerPairs);
    ctx.req.socket = socket;
    return ctx;
  }

  test('la seconda richiesta sulla stessa connessione riusa l impronta', () => {
    const socket = {};
    const first = buildFingerprint(ctxWithSocket(CURL_HEADERS, socket));
    const second = buildFingerprint(ctxWithSocket(CHROME_HEADERS, socket));
    // Stessa connessione → stesso oggetto, senza ricalcolo (header ignorati).
    expect(second).toBe(first);
  });

  test('connessioni diverse non condividono la cache', () => {
    const a = buildFingerprint(ctxWithSocket(CURL_HEADERS, {}));
    const b = buildFingerprint(ctxWithSocket(CHROME_HEADERS, {}));
    expect(b).not.toBe(a);
    expect(b.fp).not.toBe(a.fp);
  });

  test('un salt cambiato a caldo invalida la cache', () => {
    const socket = {};
    const primo = buildFingerprint(ctxWithSocket(CURL_HEADERS, socket), { salt: 'a' });
    const dopo = buildFingerprint(ctxWithSocket(CURL_HEADERS, socket), { salt: 'b' });
    expect(dopo.fp).not.toBe(primo.fp);
  });

  test('un socket non estendibile non fa fallire nulla', () => {
    const socket = Object.freeze({});
    expect(() => buildFingerprint(ctxWithSocket(CURL_HEADERS, socket))).not.toThrow();
  });
});

describe('buildFingerprint — salt', () => {
  test('senza salt le impronte sono confrontabili fra installazioni', () => {
    expect(buildFingerprint(makeCtx(CURL_HEADERS), { salt: '' }).fp)
      .toBe(buildFingerprint(makeCtx(CURL_HEADERS)).fp);
  });

  test('con salt diventano locali all installazione', () => {
    expect(buildFingerprint(makeCtx(CURL_HEADERS), { salt: 'sito-a' }).fp)
      .not.toBe(buildFingerprint(makeCtx(CURL_HEADERS), { salt: 'sito-b' }).fp);
  });
});

describe('buildFingerprint — coerenza UA ↔ impronta', () => {
  test('un browser vero e coerente', () => {
    const { fpClass } = buildFingerprint(makeCtx(CHROME_HEADERS));
    expect(fpClass.coherent).toBe(true);
    expect(fpClass.claimedBrowser).toBe('chrome');
    expect(fpClass.claimedOs).toBe('linux');
    expect(fpClass.headerProfile).toBe('browser');
  });

  test('curl onesto e coerente: dichiara quello che e', () => {
    const { fpClass } = buildFingerprint(makeCtx(CURL_HEADERS));
    expect(fpClass.coherent).toBe(true);
    expect(fpClass.family).toBe('curl');
    expect(fpClass.claimedBrowser).toBe(null);
  });

  // Il segnale che vale piu di tutti: non serve decidere se curl sia ostile,
  // serve accorgersi che qualcuno sta fingendo di non esserlo.
  test('curl che finge di essere Chrome e INCOERENTE', () => {
    const { fpClass } = buildFingerprint(makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'],
      ['Accept', '*/*'],
    ]));
    expect(fpClass.coherent).toBe(false);
    expect(fpClass.claimedBrowser).toBe('chrome');
    expect(fpClass.headerProfile).toBe('minimal');
  });

  // Conservativo di proposito: browser vecchi, proxy che riscrivono e client
  // legittimi atipici finiscono in "partial", e un falso allarme li colpirebbe.
  test('un profilo "partial" NON viene giudicato incoerente', () => {
    const { fpClass } = buildFingerprint(makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'Mozilla/5.0 (Windows NT 6.1) Firefox/45.0'],
      ['Accept', 'text/html'],
      ['Accept-Encoding', 'gzip'],
    ]));
    expect(fpClass.headerProfile).not.toBe('minimal');
    expect(fpClass.coherent).toBe(true);
  });

  test('riconosce i bot noti tramite core/botDetector', () => {
    const { fpClass } = buildFingerprint(makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
      ['Accept', '*/*'],
    ]));
    expect(fpClass.isBot).toBe(true);
    expect(fpClass.botName).toBe('Googlebot');
  });

  test('un User-Agent enorme non fa esplodere nulla (troncamento anti-ReDoS)', () => {
    const ctx = makeCtx([
      ['Host', 'example.com'],
      ['User-Agent', 'a'.repeat(50000)],
      ['Accept', '*/*'],
    ]);
    expect(() => buildFingerprint(ctx)).not.toThrow();
  });
});
