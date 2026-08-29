// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/adminAnalytics/lib/exportFormatter.js — export CSV e JSON.
 *
 * PERCHÉ QUESTO MODULO PER PRIMO
 * ------------------------------
 * È il punto in cui dati provenienti dalle **richieste HTTP** (`path`, `referrer`,
 * `userAgent`) escono dal CMS dentro un file che un amministratore apre con un
 * foglio di calcolo. Cioè: input controllato da chiunque visiti il sito, aperto da
 * chi ha i privilegi più alti. L'intero plugin era senza test.
 *
 * Il quoting RFC 4180 è implementato correttamente e qui viene fissato. La
 * protezione dalla **formula injection** mancava: era caratterizzata in fondo al
 * file come difetto noto, ed è stata corretta in v3.4.0 — quei test ora fissano
 * il contratto della neutralizzazione, non più il difetto.
 */

const {
  formatCsv,
  formatJson,
  neutralizeFormula,
  EVENT_FIELDS,
  FORMULA_TRIGGERS,
} = require('../../lib/exportFormatter');

/** Evento minimo: i campi non valorizzati diventano celle vuote. */
const evento = (over = {}) => ({
  timestamp: '2026-08-23T10:00:00Z',
  path: '/pagina',
  method: 'GET',
  statusCode: 200,
  ...over,
});

/** Righe del CSV, separate secondo il CRLF che il modulo dichiara. */
const righe = (csv) => csv.split('\r\n');

describe('formatCsv() — struttura', () => {
  test('la prima riga è l\'intestazione con i campi nell\'ordine canonico', () => {
    expect(righe(formatCsv([]))[0]).toBe(EVENT_FIELDS.join(','));
  });

  test('un array vuoto produce la sola intestazione, non una stringa vuota', () => {
    // Un file senza intestazione è illeggibile da un foglio di calcolo.
    expect(righe(formatCsv([])).length).toBe(1);
  });

  test('una riga per evento, nell\'ordine ricevuto', () => {
    const csv = righe(formatCsv([evento({ path: '/primo' }), evento({ path: '/secondo' })]));
    expect(csv.length).toBe(3);
    expect(csv[1]).toContain('/primo');
    expect(csv[2]).toContain('/secondo');
  });

  test('le righe sono separate da CRLF, come dichiara il modulo', () => {
    // Windows-style per la massima compatibilità coi fogli di calcolo.
    expect(formatCsv([evento()])).toContain('\r\n');
  });

  test('ogni riga ha esattamente il numero di colonne dell\'intestazione', () => {
    // Una colonna in più o in meno disallinea l'intero foglio.
    const csv = righe(formatCsv([evento({ userAgent: 'Mozilla/5.0' })]));
    const conta = (r) => r.split(',').length;
    expect(conta(csv[1])).toBe(conta(csv[0]));
  });

  test('null e undefined diventano celle vuote, mai le stringhe "null"/"undefined"', () => {
    const csv = righe(formatCsv([{ path: null, method: undefined }]))[1];
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  test('i campi non presenti nell\'evento non spostano le colonne', () => {
    const csv = righe(formatCsv([{ path: '/solo-path' }]));
    expect(csv[1].split(',').length).toBe(EVENT_FIELDS.length);
  });

  test('i booleani sono resi come testo', () => {
    const csv = righe(formatCsv([evento({ isBot: false, isAdmin: true })]))[1];
    expect(csv).toContain('false');
    expect(csv).toContain('true');
  });
});

describe('formatCsv() — quoting RFC 4180', () => {
  test('un valore con la virgola viene racchiuso fra virgolette', () => {
    // Senza, la virgola nello User-Agent spezzerebbe la riga in due colonne.
    const csv = righe(formatCsv([evento({ userAgent: 'Mozilla/5.0 (Linux; Android 10, wv)' })]))[1];
    expect(csv).toContain('"Mozilla/5.0 (Linux; Android 10, wv)"');
  });

  test('le virgolette interne sono raddoppiate', () => {
    const csv = righe(formatCsv([evento({ path: 'dice "ciao"' })]))[1];
    expect(csv).toContain('"dice ""ciao"""');
  });

  test('un valore con a capo viene racchiuso fra virgolette', () => {
    const csv = formatCsv([evento({ referrer: 'prima\nseconda' })]);
    expect(csv).toContain('"prima\nseconda"');
  });

  test('un valore con CR viene racchiuso fra virgolette', () => {
    // Altrimenti il CR verrebbe scambiato per un fine riga.
    const csv = formatCsv([evento({ referrer: 'prima\rseconda' })]);
    expect(csv).toContain('"prima\rseconda"');
  });

  test('i valori senza caratteri speciali NON vengono inutilmente quotati', () => {
    const csv = righe(formatCsv([evento({ method: 'GET' })]))[1];
    expect(csv).toContain(',GET,');
    expect(csv).not.toContain('"GET"');
  });
});

describe('formatJson()', () => {
  test('produce JSON valido e riparsabile', () => {
    const eventi = [evento(), evento({ path: '/altra' })];
    expect(JSON.parse(formatJson(eventi))).toEqual(eventi);
  });

  test('array vuoto → array JSON vuoto', () => {
    expect(JSON.parse(formatJson([]))).toEqual([]);
  });

  test('è indentato, perché è un file che una persona apre', () => {
    expect(formatJson([evento()])).toContain('\n  ');
  });

  test('i caratteri speciali sono gestiti da JSON.stringify', () => {
    const json = formatJson([evento({ path: 'con "virgolette" e \n a capo' })]);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)[0].path).toBe('con "virgolette" e \n a capo');
  });
});

describe('formula injection — neutralizzazione (v3.4.0)', () => {
  // Il difetto che questi test presidiavano come caratterizzazione è stato
  // corretto: `path`, `referrer` e `userAgent` arrivano dalle richieste HTTP,
  // quindi il contenuto è scelto da chiunque visiti il sito — senza alcun
  // accesso privilegiato — mentre il file lo apre un amministratore.
  test.each([
    ['uguale',     '=1+1'],
    ['più',        '+1+1'],
    ['meno',       '-1+1'],
    ['chiocciola', '@SUM(A1:A9)'],
    ['tab',        '\t=1+1'],
  ])('un userAgent che inizia con %s viene neutralizzato con l\'apice', (_caso, payload) => {
    const cella = righe(formatCsv([evento({ userAgent: payload })]))[1]
      .split(',')[EVENT_FIELDS.indexOf('userAgent')];

    expect(cella).toBe(`'${payload}`);
    expect(FORMULA_TRIGGERS).not.toContain(cella[0]);
  });

  test('l\'apice sta DENTRO le virgolette, così il quoting RFC 4180 regge', () => {
    // Se il prefisso finisse fuori dalle virgolette romperebbe la struttura del
    // CSV: il campo verrebbe letto come due colonne.
    const riga = righe(formatCsv([evento({ referrer: '=HYPERLINK("http://x"),y' })]))[1];
    expect(riga).toContain('"\'=HYPERLINK(');
    expect(riga).not.toContain(',"=HYPERLINK(');
  });

  test('i valori innocui NON vengono toccati', () => {
    // Una neutralizzazione troppo larga sporcherebbe ogni export.
    const cella = righe(formatCsv([evento({ userAgent: 'Mozilla/5.0' })]))[1]
      .split(',')[EVENT_FIELDS.indexOf('userAgent')];
    expect(cella).toBe('Mozilla/5.0');
  });

  test('i NUMERI negativi restano numeri, non diventano testo', () => {
    // `-` è un trigger di formula, ma solo per le stringhe: un numero non può
    // portare una formula, e prefissarlo lo renderebbe inutilizzabile nei calcoli.
    const cella = righe(formatCsv([evento({ durationMs: -5 })]))[1]
      .split(',')[EVENT_FIELDS.indexOf('durationMs')];
    expect(cella).toBe('-5');
  });

  test('neutralizeFormula() — contratto della funzione', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('testo')).toBe('testo');
    expect(neutralizeFormula('')).toBe('');
    // Non stringhe: passano attraverso, convertite ma non prefissate.
    expect(neutralizeFormula(-5)).toBe('-5');
    expect(neutralizeFormula(200)).toBe('200');
    expect(neutralizeFormula(true)).toBe('true');
  });
});
