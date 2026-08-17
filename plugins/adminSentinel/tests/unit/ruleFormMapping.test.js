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
  FORM_OWNED_KEYS,
  mergeRuleFields,
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

// ─────────────────────────────────────────────────────────────────────────────
// La stessa invariante, applicata un livello più su (revisione del plugin)
// ─────────────────────────────────────────────────────────────────────────────
//
// Il `match` non rappresentabile era già conservato alla lettera, ma il RESTO
// della regola veniva ricostruito da zero: l'oggetto inviato al service
// conteneva solo le chiavi che il form conosce. Finché lo schema del file e
// l'elenco del form coincidono non si perde niente — ed è vero oggi — ma è una
// coincidenza da mantenere a mano, e il primo campo nuovo aggiunto a `sentinel`
// sparirebbe al primo salvataggio dal form, in silenzio.

describe('mergeRuleFields: ciò che il form non conosce sopravvive', () => {
  const regolaSuFile = {
    name: 'php-probe',
    enabled: true,
    action: 'monitor',
    category: 'cms-probe',
    match: { extension: ['php'] },
    // Una chiave che il form non conosce: sta qui al posto del campo che
    // `sentinel` aggiungerà un giorno.
    campoFuturo: { chissa: 'cosa', annidato: [1, 2, 3] },
  };

  test('una chiave sconosciuta al form resta identica', () => {
    const merged = mergeRuleFields(regolaSuFile, {
      name: 'php-probe', enabled: true, action: 'block', match: { extension: ['php'] },
    });
    expect(merged.campoFuturo).toEqual(regolaSuFile.campoFuturo);
    expect(merged.action).toBe('block');
  });

  test('le chiavi possedute dal form si possono TOGLIERE', () => {
    // È così che si cancella un escalate: il campo lasciato vuoto non produce
    // la chiave, e la fusione deve rimuoverla invece di conservare la vecchia.
    const conEscalate = { ...regolaSuFile, escalate: { rateLimiterRule: 'login' } };
    const merged = mergeRuleFields(conEscalate, {
      name: 'php-probe', enabled: true, action: 'monitor', match: { extension: ['php'] },
    });
    expect(merged.escalate).toBeUndefined();
    expect('escalate' in merged).toBe(false);
  });

  test('una chiave sconosciuta NON viene tolta quando il form non la manda', () => {
    // La differenza che regge tutto: «assente dal form» significa «rimuovila»
    // solo per le chiavi che il form possiede.
    const merged = mergeRuleFields(regolaSuFile, { name: 'php-probe' });
    expect(merged.campoFuturo).toEqual(regolaSuFile.campoFuturo);
  });

  test('non muta la regola ricevuta', () => {
    const copia = JSON.parse(JSON.stringify(regolaSuFile));
    mergeRuleFields(regolaSuFile, { name: 'php-probe', action: 'block' });
    expect(regolaSuFile).toEqual(copia);
  });

  test('una regola assente non fa lanciare nulla', () => {
    expect(mergeRuleFields(undefined, { name: 'x', action: 'monitor' }))
      .toEqual({ name: 'x', action: 'monitor' });
  });

  // Il no-op, come per le mappature di C6: aprire e risalvare senza toccare
  // niente non deve cambiare la regola.
  test('no-op: aprire e risalvare non cambia nulla', () => {
    const campiRaccolti = {
      name: 'php-probe',
      enabled: true,
      action: 'monitor',
      match: { extension: ['php'] },
      category: 'cms-probe',
    };
    expect(mergeRuleFields(regolaSuFile, campiRaccolti)).toEqual(regolaSuFile);
  });

  test('l elenco delle chiavi possedute copre lo schema del file di regole', () => {
    // Se `sentinel` aggiunge un campo di primo livello e questo elenco non lo
    // segue, il campo NON viene distrutto (è il senso della fusione) ma diventa
    // nemmeno modificabile dal form: il promemoria è qui.
    expect(FORM_OWNED_KEYS).toEqual(expect.arrayContaining([
      'name', 'enabled', 'action', 'match',
      'category', 'description', 'appliesTo',
      'decoy', 'redirect', 'tarpit', 'escalate',
    ]));
  });
});

// Stesso difetto di `query`, sul campo accanto: anche gli User-Agent contengono
// virgole, e il campo a virgole li restituiva spezzati in pattern che non
// matchano più niente.
describe('userAgent: una riga per pattern, non una virgola', () => {
  test('uno User-Agent con la virgola non viene spezzato', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 10, wv) AppleWebKit/537.36';
    expect(giroTesto(ua)).toBe(ua);
  });

  test('una regex con un quantificatore {1,3} sopravvive', () => {
    // La forma in cui la virgola è sintassi, non separatore.
    expect(giroTesto('regex:^curl/[0-9]{1,3}\\.')).toBe('regex:^curl/[0-9]{1,3}\\.');
  });

  test('il valore speciale `empty` resta scalare', () => {
    expect(giroTesto('empty')).toBe('empty');
  });

  test('una lista sopravvive identica', () => {
    expect(giroTesto(['curl', 'wget', 'python-requests']))
      .toEqual(['curl', 'wget', 'python-requests']);
  });

  test('assente resta assente: la chiave non va inventata', () => {
    expect(giroTesto(undefined)).toBeUndefined();
  });
});
