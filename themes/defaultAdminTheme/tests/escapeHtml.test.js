// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * `escapeHtml.js` del tema admin — il LIVELLO 2 della difesa XSS del pannello.
 *
 * ─── PERCHÉ QUESTO FILE ESISTE ────────────────────────────────────────────────
 * `CLAUDE.md` descrive una difesa in profondità a **due livelli**:
 *
 *   1. **server** — gli endpoint API escapano i dati controllati dall'utente
 *      prima di mandarli ai template (`core/escapeHtml.js`);
 *   2. **client** — il tema admin carica QUESTO file globalmente da `head.ejs`,
 *      e il JS delle sezioni admin lo usa prima di ogni `innerHTML`.
 *
 * Il livello 2 esiste perché il livello 1 può essere dimenticato in un endpoint
 * nuovo. Ma finché non era né testato né **contato dalla coverage**, era una
 * protezione di cui nessuno poteva dire se funzionasse: non compariva come 0%,
 * non compariva affatto.
 *
 * Questo file arriva insieme all'allargamento di `collectCoverageFrom` a
 * `themes/**\/*.js`: contare quelle righe senza verificarne la più importante
 * avrebbe aggiunto un numero senza aggiungere una verifica.
 *
 * ─── COME SI PUÒ TESTARE UN FILE CLIENT-SIDE ──────────────────────────────────
 * Con il guard `typeof module`, la convenzione del progetto
 * (`docs/testing.it.md` → *JS client-side della GUI admin*). Il file era già
 * scritto come IIFE con `typeof window !== 'undefined' ? window : this`, quindi
 * gli mancava solo l'export: non tocca il DOM, la sua funzione è pura.
 */

const fs = require('fs');
const path = require('path');

const FILE_TEMA = path.join(__dirname, '../themeResources/js/escapeHtml.js');

// Il gemello lato server. Il confronto fra i due è il test più importante del file.
const escapeHtmlServer = require('../../../core/escapeHtml');
const { escapeHtml } = require(FILE_TEMA);

describe('il file è caricabile sotto Node grazie al guard', () => {
  test('esporta la funzione, e solo quella', () => {
    expect(Object.keys(require(FILE_TEMA))).toEqual(['escapeHtml']);
    expect(typeof escapeHtml).toBe('function');
  });

  test('resta uno script da browser: non tocca il DOM', () => {
    // È la ragione per cui qui non serve il secondo guard (`typeof document`)
    // che invece serve ai file delle sezioni admin: questo file non aggancia
    // niente, si limita a pubblicare la funzione su `window`.
    const sorgente = fs.readFileSync(FILE_TEMA, 'utf8');
    expect(sorgente).not.toMatch(/document\./);
    expect(sorgente).not.toMatch(/addEventListener/);
  });

  test('in browser continua a pubblicarsi su `window`', () => {
    // Il ramo che gira davvero in produzione. Se sparisse, il pannello admin
    // resterebbe senza `escapeHtml()` globale e ogni chiamata lancerebbe —
    // il file sarebbe testato e inutile.
    const sorgente = fs.readFileSync(FILE_TEMA, 'utf8');
    expect(sorgente).toMatch(/global\.escapeHtml = escapeHtml/);
    expect(sorgente).toMatch(/typeof window !== 'undefined' \? window : this/);
  });
});

describe('i cinque caratteri che deve neutralizzare', () => {
  // Sono cinque, e ognuno chiude una via diversa. Testarli in isolamento è ciò
  // che distingue « la funzione fa qualcosa » da « la funzione fa tutto ».
  test.each([
    ['&', '&amp;',  'l\'ampersand, che deve venire PER PRIMO o ri-escaperebbe gli altri'],
    ['<', '&lt;',   'apre un tag'],
    ['>', '&gt;',   'chiude un tag'],
    ['"', '&quot;', 'chiude un attributo con virgolette doppie'],
    ["'", '&#39;',  'chiude un attributo con virgolette singole'],
  ])('%s → %s (%s)', (carattere, atteso) => {
    expect(escapeHtml(carattere)).toBe(atteso);
  });

  test('l\'ordine delle sostituzioni è giusto: `&` non viene applicato due volte', () => {
    // È il classico errore di un escaper scritto in fretta: se `&` fosse
    // sostituito DOPO gli altri, `<` diventerebbe `&lt;` e poi `&amp;lt;`, e la
    // pagina mostrerebbe `&lt;` invece del carattere. Non è un buco di
    // sicurezza, ma rompe la visualizzazione di ogni dato che contenga `<`.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('sostituisce TUTTE le occorrenze, non solo la prima', () => {
    // Le regex sono `/g`: senza, `<a><b>` diventerebbe `&lt;a><b>` e il secondo
    // tag passerebbe intatto.
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;');
    expect(escapeHtml('a&b&c')).toBe('a&amp;b&amp;c');
  });
});

describe('payload XSS reali', () => {
  test.each([
    ['tag script',        '<script>alert(1)</script>'],
    ['img con onerror',   '<img src=x onerror=alert(1)>'],
    ['svg con onload',    '<svg onload=alert(1)>'],
    ['uscita da attributo', '" onmouseover="alert(1)'],
    ['uscita con apice',  "' onmouseover='alert(1)"],
  ])('%s non produce più né tag né uscita da attributo', (_caso, payload) => {
    const reso = escapeHtml(payload);

    // La proprietà di sicurezza è questa: dopo l'escaping non resta NESSUN
    // carattere capace di aprire un tag o di chiudere un attributo. Il resto del
    // payload può benissimo sopravvivere come testo — `onerror=alert(1)` scritto
    // in una pagina è innocuo se non sta dentro un tag.
    expect(reso).not.toMatch(/[<>"']/);
  });

  test('il testo del payload resta leggibile, ed è voluto', () => {
    // Un escaper non deve censurare: deve rendere inerte. Chi guarda la pagina
    // deve poter vedere cosa è stato tentato.
    expect(escapeHtml('<script>')).toContain('script');
  });
});

describe('input che non sono stringhe', () => {
  test.each([
    ['null',      null],
    ['undefined', undefined],
    ['numero',    42],
    ['oggetto',   { a: 1 }],
    ['array',     ['<b>']],
    ['booleano',  true],
    ['funzione',  () => {}],
  ])('%s → stringa vuota, non una conversione', (_caso, valore) => {
    // `if (typeof str !== 'string') return '';` — la scelta è « vuoto », non
    // `String(valore)`. Conta perché un oggetto convertito darebbe
    // "[object Object]" nella pagina, e un array darebbe il suo contenuto
    // **non escapato** una volta unito con la virgola.
    expect(escapeHtml(valore)).toBe('');
  });

  test('la stringa vuota resta stringa vuota', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('un testo senza caratteri speciali torna identico', () => {
    // Il caso normale: l'escaper non deve sporcare ciò che non ha bisogno di
    // essere toccato.
    expect(escapeHtml('Mario Rossi 42')).toBe('Mario Rossi 42');
    expect(escapeHtml('àèìòù €')).toBe('àèìòù €');
  });
});

describe('⚠ i due livelli della difesa devono concordare', () => {
  // IL TEST PIÙ IMPORTANTE DEL FILE.
  //
  // `core/escapeHtml.js` (server) e questo (client) sono due implementazioni
  // della stessa regola, in due file diversi, che nessuno tiene allineati.
  // Oggi sono identiche carattere per carattere — verificato.
  //
  // Se un domani divergessero, la difesa in profondità diventerebbe
  // ASIMMETRICA: un carattere neutralizzato da un lato e non dall'altro
  // significa che il livello 2 non copre più ciò che il livello 1 dimentica, e
  // il buco si aprirebbe esattamente nel punto in cui si contava sulla ridondanza.
  // Nessun test lo avrebbe detto, perché ogni file resta valido per conto suo.

  const CAMPIONI = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '" onmouseover="alert(1)',
    "' onmouseover='alert(1)",
    'a & b < c > d " e \' f',
    '&amp;',
    '&lt;già escapato&gt;',
    'testo normale',
    '',
    'àèìòù €',
    '<<<>>>&&&"""\'\'\'',
  ];

  test.each(CAMPIONI.map((c) => [JSON.stringify(c), c]))(
    'client e server danno lo STESSO risultato per %s', (_etichetta, campione) => {
      expect(escapeHtml(campione)).toBe(escapeHtmlServer(campione));
    });

  test.each([
    ['null',      null],
    ['undefined', undefined],
    ['numero',    42],
    ['oggetto',   {}],
  ])('concordano anche sui non-stringa: %s', (_caso, valore) => {
    // Anche la gestione dei tipi sbagliati deve coincidere: se il server
    // restituisse '' e il client 'undefined', il pannello mostrerebbe testo
    // diverso a seconda di quale livello ha agito.
    expect(escapeHtml(valore)).toBe(escapeHtmlServer(valore));
  });

  test('le due implementazioni hanno la stessa logica nel sorgente', () => {
    // Il confronto sui campioni copre i casi che ho pensato; questo copre quelli
    // che non ho pensato. Normalizza gli spazi e confronta la catena di
    // `.replace()`: se una delle due ne aggiungesse, togliesse o riordinasse
    // una, si vedrebbe qui anche senza un campione che lo dimostri.
    const catena = (testo) => (testo.match(/\.replace\([^)]*\)/g) || [])
      .map((r) => r.replace(/\s+/g, ''));

    const clientCatena = catena(fs.readFileSync(FILE_TEMA, 'utf8'));
    const serverCatena = catena(
      fs.readFileSync(path.join(__dirname, '../../../core/escapeHtml.js'), 'utf8'));

    expect(clientCatena.length).toBe(5);
    expect(clientCatena).toEqual(serverCatena);
  });
});
