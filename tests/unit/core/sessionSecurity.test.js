// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * sessionSecurity — la classificazione a tre livelli delle chiavi di sessione.
 *
 * Il test che conta davvero, in questo file, è quello in fondo: « il .default
 * realmente spedito è rifiutato dal gate ». È il presidio che mancava quando
 * `REVIEW.md` → A2 è nato, e la sua assenza è l'intera ragione per cui il difetto
 * è vissuto cinque mesi senza che nulla lo intercettasse.
 *
 * La storia, perché non si ripeta: il 2026-06-12 alle 22:19 una PR rinominò le
 * chiavi spedite in `CHANGE_ME_*`; alle 22:43 una seconda PR, biforcata prima,
 * introdusse la denylist elencando i valori che la prima aveva appena rimosso.
 * Nessun conflitto git (file diversi), test verdi su entrambi i rami, e la
 * protezione arrivò su `main` già inerte. Gli altri test di questo file
 * verificano il COMPORTAMENTO del modulo; quello finale verifica che il modulo
 * sia ancora allineato a ciò che il repository spedisce davvero — che è una
 * proprietà diversa, e l'unica che una collisione fra rami paralleli non può
 * aggirare.
 */

const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const {
  PLACEHOLDER_SESSION_KEYS,
  MIN_SESSION_KEY_LENGTH,
  classifySessionKeys,
  keysAreInsecure,
  checkSessionKeys,
} = require('../../../core/sessionSecurity');

/** Una chiave lunga e casuale: il livello `ok` di riferimento. */
const BUONA = 'Zx9_random-secure-key-abcdef0123456789AAA';
const BUONA_2 = 'Qw8-another-secure-key-zyxwvu9876543210BBB';

describe('sessionSecurity.PLACEHOLDER_SESSION_KEYS', () => {
  test('contiene i placeholder storici del progetto e della documentazione', () => {
    expect(PLACEHOLDER_SESSION_KEYS).toEqual(
      expect.arrayContaining([
        'key.segretussimmmmmm',
        'fbtgnrnyrmnytmtymyt',
        'brtnrynynyny',
        'key.secondaryKey123',
      ])
    );
  });

  test('è immutabile (frozen)', () => {
    expect(Object.isFrozen(PLACEHOLDER_SESSION_KEYS)).toBe(true);
  });
});

describe('sessionSecurity.classifySessionKeys — livello 1: PUBBLICA (fatale)', () => {
  test('prefisso CHANGE_ME_ → fatal/public-shipped', () => {
    const v = classifySessionKeys(['CHANGE_ME_session_key_1', 'CHANGE_ME_session_key_2']);
    expect(v.tier).toBe('fatal');
    expect(v.reason).toBe('public-shipped');
    expect(v.offending).toHaveLength(2);
  });

  test('basta UNA chiave col prefisso fra tante buone', () => {
    const v = classifySessionKeys([BUONA, 'CHANGE_ME_session_key_3', BUONA_2]);
    expect(v.tier).toBe('fatal');
    expect(v.reason).toBe('public-shipped');
    expect(v.offending).toEqual(['CHANGE_ME_session_key_3']);
  });

  test('il prefisso vale qualunque cosa segua (non è un confronto esatto)', () => {
    // È il punto per cui il criterio è un PREFISSO e non una lista di valori:
    // qualunque suffisso futuro resta coperto senza aggiornare nulla.
    expect(classifySessionKeys(['CHANGE_ME_qualcosa_mai_vista_prima']).tier).toBe('fatal');
    expect(classifySessionKeys(['CHANGE_ME_']).tier).toBe('fatal');
  });

  test('OGNI placeholder storico è fatale, non soltanto debole', () => {
    // La ragione per cui l'elenco esatto non è sostituibile dall'euristica:
    // tre di questi quattro superano la soglia di lunghezza, e uno
    // (`key.secondaryKey123`) ha anche quattro classi di caratteri — è
    // strutturalmente indistinguibile da una chiave scelta a mano. Solo il
    // fatto storico di essere stato spedito lo rende pubblico.
    for (const storica of PLACEHOLDER_SESSION_KEYS) {
      const v = classifySessionKeys([storica]);
      expect(v.tier).toBe('fatal');
    }
  });

  test('un placeholder storico LUNGO è fatale, non debole (il caso che l\'euristica mancherebbe)', () => {
    const lunga = PLACEHOLDER_SESSION_KEYS.find((k) => k.length >= MIN_SESSION_KEY_LENGTH);
    expect(lunga).toBeDefined(); // se un giorno non ce ne fossero, il test va rivisto
    const v = classifySessionKeys([lunga]);
    expect(v.tier).toBe('fatal');
    expect(v.reason).toBe('public-historical');
  });

  test('chiavi assenti, vuote o malformate → fatal/keys-invalid', () => {
    for (const input of [null, undefined, 'una-stringa', {}, []]) {
      const v = classifySessionKeys(input);
      expect(v.tier).toBe('fatal');
      expect(v.reason).toBe('keys-invalid');
    }
    expect(classifySessionKeys([BUONA, 42]).reason).toBe('keys-invalid');
    expect(classifySessionKeys([BUONA, '']).reason).toBe('keys-invalid');
  });

  test('keys-invalid non nomina nulla in `offending`', () => {
    // Stampare una chiave malformata non aiuterebbe chi legge il box, e una
    // chiave vera accanto a una malformata non è «colpevole» di niente.
    expect(classifySessionKeys([BUONA, 42]).offending).toEqual([]);
  });
});

describe('sessionSecurity.classifySessionKeys — livello 2: DEBOLE (avviso)', () => {
  test('chiave sotto la soglia → weak/too-short', () => {
    const corta = 'a'.repeat(MIN_SESSION_KEY_LENGTH - 1);
    const v = classifySessionKeys([corta]);
    expect(v.tier).toBe('weak');
    expect(v.reason).toBe('too-short');
    expect(v.offending).toEqual([corta]);
  });

  test('esattamente alla soglia → ok (il confronto è `<`, non `<=`)', () => {
    expect(classifySessionKeys(['a'.repeat(MIN_SESSION_KEY_LENGTH)]).tier).toBe('ok');
  });

  test('il livello PUBBLICO prevale sul DEBOLE quando coesistono', () => {
    // Importa l'ordine: una chiave pubblica e una corta insieme devono dare
    // `fatal`, perché è il verdetto più severo a decidere cosa fa il boot.
    const v = classifySessionKeys(['abc', 'CHANGE_ME_session_key_1']);
    expect(v.tier).toBe('fatal');
  });
});

describe('sessionSecurity.classifySessionKeys — livello 3: OK', () => {
  test('chiavi lunghe e casuali → ok, nessun motivo, nessun colpevole', () => {
    const v = classifySessionKeys([BUONA, BUONA_2]);
    expect(v).toEqual({ tier: 'ok', reason: null, offending: [] });
  });
});

describe('sessionSecurity.keysAreInsecure', () => {
  test('true a QUALUNQUE livello diverso da ok', () => {
    expect(keysAreInsecure(['CHANGE_ME_session_key_1'])).toBe(true); // fatal
    expect(keysAreInsecure(['brtnrynynyny'])).toBe(true);            // fatal (storica)
    expect(keysAreInsecure(['abc'])).toBe(true);                     // weak
    expect(keysAreInsecure([])).toBe(true);                          // fatal (invalid)
    expect(keysAreInsecure(null)).toBe(true);
  });

  test('false solo su chiavi a posto', () => {
    expect(keysAreInsecure([BUONA, BUONA_2])).toBe(false);
  });
});

describe('sessionSecurity.checkSessionKeys', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('sessione disabilitata in config → nessun output, ritorna ok', () => {
    const result = checkSessionKeys(
      { priorityMiddlewares: { session: false } },
      { sessionConfig: { keys: ['CHANGE_ME_session_key_1'] } } // pubbliche, ma sessione off
    );
    expect(result).toBe('ok');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('chiavi pubbliche → box FATALE su console.error, ritorna fatal', () => {
    const result = checkSessionKeys({}, { sessionConfig: { keys: ['CHANGE_ME_session_key_1'] } });
    expect(result).toBe('fatal');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const box = errorSpy.mock.calls[0][0];
    expect(box).toContain('[SESSION]');
    expect(box).toContain('il CMS non parte');
    expect(box).toContain('npm run start-configure');
  });

  test('placeholder storico → box fatale, con il motivo giusto nel testo', () => {
    const result = checkSessionKeys({}, { sessionConfig: { keys: ['key.segretussimmmmmm'] } });
    expect(result).toBe('fatal');
    expect(errorSpy.mock.calls[0][0]).toContain('storia di git');
  });

  test('chiavi deboli → box di AVVISO su console.warn, ritorna weak', () => {
    const result = checkSessionKeys({}, { sessionConfig: { keys: ['abc'] } });
    expect(result).toBe('weak');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const box = warnSpy.mock.calls[0][0];
    expect(box).toContain('[SESSION]');
    expect(box).toContain('Il server parte comunque');
    // Il box debole NON deve dire che il CMS non parte: è l'avviso, non il gate.
    expect(box).not.toContain('il CMS non parte');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('chiavi a posto → nessun output, ritorna ok', () => {
    const result = checkSessionKeys({}, { sessionConfig: { keys: [BUONA, BUONA_2] } });
    expect(result).toBe('ok');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('config di sessione illeggibile → nessun crash, ritorna ok', () => {
    // `ok` e non `fatal`: non c'è una chiave da giudicare, e un file illeggibile
    // è già fatale per chi lo legge davvero (il montaggio dei priority
    // middleware). Qui inventare un verdetto significherebbe spegnere il boot
    // per un motivo che questa funzione non ha verificato.
    const result = checkSessionKeys({}, { configPath: '/path/che/non/esiste/koaSession.json5' });
    expect(result).toBe('ok');
    expect(warnSpy).toHaveBeenCalled();
  });

  test('non termina MAI il processo: a uscire è il chiamante', () => {
    // Presidio del contratto dichiarato in testa al modulo. Se un giorno la
    // funzione chiamasse process.exit, questo test ucciderebbe il worker di
    // Jest invece di fallire — quindi lo si verifica con una spia.
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit non deve essere chiamato da sessionSecurity');
    });
    expect(() => checkSessionKeys({}, { sessionConfig: { keys: ['CHANGE_ME_session_key_1'] } }))
      .not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('IL PRESIDIO — il modulo resta allineato a ciò che il repo SPEDISCE', () => {
  const DEFAULT_PATH = path.join(__dirname, '../../../core/priorityMiddlewares/koaSession.default.json5');

  test('le chiavi del koaSession.default.json5 reale sono classificate FATALI', () => {
    // Legge il file SPEDITO, non una sua copia nel test: è l'unico modo perché
    // una rinomina dei segnaposti non possa più passare inosservata. Era il test
    // mancante quando A2 è nato — con questo, chi rinomina i placeholder senza
    // aggiornare il modulo trova la CI rossa, e una collisione fra due PR
    // parallele viene fermata dalla seconda a essere mergiata.
    const spedite = loadJson5(DEFAULT_PATH).keys;
    const verdict = classifySessionKeys(spedite);
    expect(verdict.tier).toBe('fatal');
    expect(verdict.offending.length).toBeGreaterThan(0);
  });

  test('e keysAreInsecure le dichiara insicure (il predicato che usa il wizard)', () => {
    expect(keysAreInsecure(loadJson5(DEFAULT_PATH).keys)).toBe(true);
  });

  test('nessuna chiave spedita passerebbe per buona', () => {
    // Verifica per chiave, non sull'insieme: se un giorno il .default spedisse
    // tre segnaposti e una chiave « vera » per sbaglio, l'asserzione
    // sull'insieme resterebbe verde mentre quella singola la nominerebbe.
    for (const k of loadJson5(DEFAULT_PATH).keys) {
      expect(classifySessionKeys([k]).tier).toBe('fatal');
    }
  });
});
