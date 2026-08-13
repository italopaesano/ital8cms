/**
 * ruleFormMapping.test.js
 *
 * Il giro completo **file → form → file** delle due mappature che nella Vista C
 * hanno perso dati (piano di consolidamento, C6).
 *
 * ─── LA PROPRIETA CHE SI VERIFICA ─────────────────────────────────────────────
 * L'invariante dichiarata in testa a `rule-form.js` è: «un form non deve MAI
 * distruggere ciò che non sa rappresentare». Il modo naturale di metterla alla
 * prova è il **no-op**: aprire una regola, non toccare nulla, salvare, e ottenere
 * esattamente ciò che c'era. Due mappature lo violavano in silenzio:
 *
 *   • `sessionAnomaly: true` (= «qualunque anomalia») si presentava come «niente
 *     selezionato» e alla risalvata la chiave spariva. Una regola
 *     `{ sessionAnomaly: true, path: '/admin/**' }` diventava `{ path: '/admin/**' }`:
 *     da «solo le sessioni anomale» a «tutte». Continuava a validare, quindi
 *     nulla se ne accorgeva. Idem per `reputation: true`.
 *   • `query: ['union select', 'sleep(']` finiva in un campo a riga singola come
 *     `union select,sleep(` e tornava sul file come quell'unica stringa
 *     improbabile: la regola smetteva di rilevare entrambi i pattern per cui era
 *     stata scritta.
 *
 * ─── PERCHE SI PUO TESTARE UN FILE CLIENT-SIDE ────────────────────────────────
 * `rule-form.js` esporta le quattro funzioni pure sotto `typeof module`, ramo che
 * in browser non esiste. Sono l'unica parte testabile senza un DOM — che questo
 * progetto non allestisce da nessuna parte — e sono precisamente dove stava il
 * difetto: il resto è lettura e scrittura di campi.
 */

'use strict';

const {
  ANY,
  anyOrListToSelection,
  selectionToAnyOrList,
  patternsToText,
  textToPatterns,
} = require('../../adminWebSections/sentinelManagement/rule-form.js');

/** Il giro completo: valore sul file → selezione del form → valore sul file. */
const giroSelect = (value) => selectionToAnyOrList(anyOrListToSelection(value));
const giroTesto = (value) => textToPatterns(patternsToText(value));

describe('multi-select: `true` significa «qualunque» e deve sopravvivere', () => {
  test('il valore sentinella non collide con un valore vero', () => {
    const veri = ['uaChanged', 'fingerprintChanged', 'networkChanged', 'ipChanged',
      'scriptClient', 'burst', 'suspect', 'bad'];
    expect(veri).not.toContain(ANY);
  });

  // IL DIFETTO: prima questo giro restituiva `undefined`, cioè la chiave spariva.
  test('true → selezione «qualunque» → true', () => {
    expect(anyOrListToSelection(true)).toEqual([ANY]);
    expect(giroSelect(true)).toBe(true);
  });

  test('una lista sopravvive identica', () => {
    expect(giroSelect(['uaChanged', 'scriptClient'])).toEqual(['uaChanged', 'scriptClient']);
    expect(giroSelect(['bad'])).toEqual(['bad']);
  });

  test('assente resta assente: la chiave non va inventata', () => {
    expect(anyOrListToSelection(undefined)).toEqual([]);
    expect(giroSelect(undefined)).toBeUndefined();
    expect(selectionToAnyOrList([])).toBeUndefined();
  });

  // Se l'amministratore seleziona «qualunque» insieme a voci specifiche, la
  // scelta più larga è quella che descrive ciò che vuole.
  test('«qualunque» insieme ad altre voci vince', () => {
    expect(selectionToAnyOrList([ANY, 'uaChanged'])).toBe(true);
    expect(selectionToAnyOrList(['uaChanged', ANY])).toBe(true);
  });
});

describe('pattern multipli: una riga per pattern, non una virgola', () => {
  // IL DIFETTO: prima l'array veniva schiacciato da String(...) nel campo a riga
  // singola, e tornava sul file come "union select,sleep(".
  test('un array sopravvive identico', () => {
    expect(giroTesto(['union select', 'sleep('])).toEqual(['union select', 'sleep(']);
  });

  // LA RAGIONE per cui qui si va a capo invece di separare per virgola: nella
  // querystring la virgola è un carattere come un altro.
  test('una stringa che CONTIENE una virgola non viene spezzata', () => {
    expect(giroTesto('ids=1,2,3')).toBe('ids=1,2,3');
    expect(textToPatterns('ids=1,2,3')).toBe('ids=1,2,3');
  });

  test('una stringa singola resta scalare, non diventa un array di uno', () => {
    expect(giroTesto('regex:union\\s+select')).toBe('regex:union\\s+select');
  });

  test('vuoto → undefined: la chiave sparisce, invece di restare stringa vuota', () => {
    expect(textToPatterns('')).toBeUndefined();
    expect(textToPatterns('   ')).toBeUndefined();
    expect(textToPatterns('\n\n')).toBeUndefined();
    expect(patternsToText(undefined)).toBe('');
  });

  test('righe vuote e spazi ai bordi non producono pattern fantasma', () => {
    expect(textToPatterns('  a  \n\n  b  \n')).toEqual(['a', 'b']);
  });
});

// Il no-op è il test che conta: aprire e salvare senza toccare nulla non deve
// cambiare la regola. Sono le forme reali che compaiono nel file distribuito e
// negli esempi della documentazione.
describe('no-op: aprire e risalvare non cambia nulla', () => {
  test.each([
    [true],
    [['uaChanged', 'scriptClient']],
    [['burst']],
    [undefined],
  ])('multi-select %j', (value) => {
    expect(giroSelect(value)).toEqual(value);
  });

  test.each([
    ['regex:(\\.\\./|\\.\\.%2f)'],
    [['union select', 'sleep(']],
    ['ids=1,2,3'],
    [undefined],
  ])('pattern %j', (value) => {
    expect(giroTesto(value)).toEqual(value);
  });
});
