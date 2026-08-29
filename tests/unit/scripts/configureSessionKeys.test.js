// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per `configureSessionKeys()` — lo step del wizard che sostituisce le chiavi
 * di firma dei cookie di sessione.
 *
 * PERCHÉ QUESTO PEZZO
 * -------------------
 * `generateSessionKeys()` era già coperto (7 test): genera chiavi casuali robuste.
 * Ma generare le chiavi non serve a niente se lo step che le **scrive sul disco**
 * non funziona — ed erano 95 righe allo 0%. È il punto in cui l'installazione
 * smette di usare i placeholder committati nel repo, che chiunque abbia clonato il
 * progetto conosce e con cui potrebbe forgiare cookie di sessione validi.
 *
 * COME SI ESERCITA UNO STEP INTERATTIVO
 * -------------------------------------
 * La funzione prende `configPath` come parametro e richiede `inquirer` **lazy**,
 * dentro il corpo: entrambe le cose la rendono pilotabile senza toccare il codice
 * di produzione. `inquirer` è mockato, e ogni test lavora su una copia di
 * `koaSession.json5` in una **tmpdir** — il file vivo del repo non viene mai
 * aperto in scrittura, e un `afterAll` lo verifica con un digest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('inquirer', () => ({ default: { prompt: jest.fn() } }));
const inquirer = require('inquirer').default;

const {
  configureSessionKeys,
  MIN_CUSTOM_KEY_LENGTH,
} = require('../../../scripts/lib/sessionKeyManager');
const { keysAreInsecure, PLACEHOLDER_SESSION_KEYS } = require('../../../core/sessionSecurity');
const loadJson5 = require('../../../core/loadJson5');

/** Il file vivo del progetto: si legge per costruire le copie, mai si scrive. */
const CONFIG_VIVO = path.join(__dirname, '../../../core/priorityMiddlewares/koaSession.json5');

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let digestIniziale;

let tmpDir;

/** Logger fittizio: registra le chiamate, così si può asserire cosa è stato detto. */
const makeLogger = () => ({
  separator: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
});

/** BackupManager fittizio: interessa CHE il backup avvenga, non come. */
const makeBackupManager = () => ({ backupGlobalFile: jest.fn() });

/**
 * Scrive un koaSession.json5 di prova nella tmpdir.
 * Il file conserva un commento, così si può verificare che la scrittura non lo perda.
 */
function scriviConfig(keys) {
  const configPath = path.join(tmpDir, `koaSession-${Math.random().toString(36).slice(2)}.json5`);
  fs.writeFileSync(configPath, [
    '// This file follows the JSON5 standard - comments and trailing commas are supported',
    '{',
    '  // Le chiavi firmano i cookie di sessione',
    `  keys: ${JSON.stringify(keys)},`,
    '  CONFIG: {',
    '    key: "koa:sess",   // nome del cookie',
    '    maxAge: 86400000,',
    '  },',
    '}',
    '',
  ].join('\n'), 'utf8');
  return configPath;
}

beforeAll(() => {
  digestIniziale = digest(CONFIG_VIVO);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionKeys-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // La promessa di isolamento è VERIFICATA, non solo dichiarata: se un caso
  // futuro puntasse per sbaglio al file vivo, questo lo direbbe invece di
  // lasciare il repository sporco.
  expect(digest(CONFIG_VIVO)).toBe(digestIniziale);
});

/**
 * Lo step del wizard parla a schermo con `console.log`, ed è giusto che lo faccia:
 * chi installa deve vedere l'avviso sui placeholder. In un test però sono venti
 * blocchi che seppelliscono l'output di jest, quindi si silenzia — solo `log`, così
 * un errore inatteso resta visibile.
 */
let consoleLogOriginale;

beforeEach(() => {
  inquirer.prompt.mockReset();
  consoleLogOriginale = console.log;
  console.log = () => {};
});

afterEach(() => {
  console.log = consoleLogOriginale;
});

describe('azione "generate" — la via consigliata', () => {
  test('sostituisce i placeholder con chiavi sicure e lo dichiara', async () => {
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 2));
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    const esito = await configureSessionKeys({
      logger: makeLogger(), backupManager: makeBackupManager(), configPath,
    });

    expect(esito).toEqual({ action: 'generate', changed: true });

    // La verifica che conta: sul DISCO non ci sono più placeholder.
    const { keys } = loadJson5(configPath);
    expect(keysAreInsecure(keys)).toBe(false);
    for (const placeholder of PLACEHOLDER_SESSION_KEYS) {
      expect(keys).not.toContain(placeholder);
    }
  });

  test('fa il backup PRIMA di scrivere', async () => {
    // Il file contiene le chiavi in uso: sostituirle invalida tutte le sessioni
    // attive, e senza backup non si torna indietro.
    const configPath = scriviConfig(['vecchiaChiaveMoltoLungaEPersonalizzata']);
    const backupManager = makeBackupManager();
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    await configureSessionKeys({ logger: makeLogger(), backupManager, configPath });

    expect(backupManager.backupGlobalFile).toHaveBeenCalledWith(configPath);
  });

  test('i commenti del file sopravvivono alla scrittura', async () => {
    // La scrittura passa da `editJson5`, che modifica la sola chiave invece di
    // riserializzare l'oggetto: un `saveJson5` perderebbe i commenti, e questo
    // file ne ha di importanti.
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 1));
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    await configureSessionKeys({ logger: makeLogger(), backupManager: makeBackupManager(), configPath });

    const testo = fs.readFileSync(configPath, 'utf8');
    expect(testo).toContain('// Le chiavi firmano i cookie di sessione');
    expect(testo).toContain('// nome del cookie');
    // E il resto della configurazione non è stato toccato.
    expect(loadJson5(configPath).CONFIG.maxAge).toBe(86400000);
  });

  test('il default proposto è "generate" quando le chiavi sono placeholder', async () => {
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 1));
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    await configureSessionKeys({ logger: makeLogger(), backupManager: makeBackupManager(), configPath });

    const [[domande]] = inquirer.prompt.mock.calls;
    expect(domande[0].default).toBe('generate');
  });

  test('il default proposto è "keep" quando le chiavi sono già personalizzate', async () => {
    // In una re-init, proporre "generate" invaliderebbe le sessioni di chi sta
    // usando il sito: il default deve invertirsi.
    const configPath = scriviConfig(['chiavePersonalizzataAbbastanzaLunga']);
    inquirer.prompt.mockResolvedValueOnce({ action: 'keep' });

    await configureSessionKeys({ logger: makeLogger(), backupManager: makeBackupManager(), configPath });

    const [[domande]] = inquirer.prompt.mock.calls;
    expect(domande[0].default).toBe('keep');
  });

  test('nessun valore di chiave finisce nel logger', async () => {
    // Il logger scrive su file: stamparvi una chiave di firma equivarrebbe a
    // pubblicarla accanto al sito.
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 1));
    const logger = makeLogger();
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    await configureSessionKeys({ logger, backupManager: makeBackupManager(), configPath });

    const detto = Object.values(logger)
      .flatMap((fn) => fn.mock.calls.flat())
      .join(' ');
    for (const chiave of loadJson5(configPath).keys) {
      expect(detto).not.toContain(chiave);
    }
  });
});

describe('azione "keep" — non tocca il file', () => {
  test('con chiavi già personalizzate: nessuna scrittura, nessun backup', async () => {
    const configPath = scriviConfig(['chiavePersonalizzataAbbastanzaLunga']);
    const primaDigest = digest(configPath);
    const backupManager = makeBackupManager();
    inquirer.prompt.mockResolvedValueOnce({ action: 'keep' });

    const esito = await configureSessionKeys({ logger: makeLogger(), backupManager, configPath });

    expect(esito).toEqual({ action: 'keep', changed: false });
    expect(digest(configPath)).toBe(primaDigest);
    expect(backupManager.backupGlobalFile).not.toHaveBeenCalled();
  });

  test('con i placeholder: il file resta, ma arriva un WARNING', async () => {
    // Mantenere i placeholder è una scelta legittima in sviluppo, ma chi installa
    // deve uscire dallo step sapendo che l'installazione non è sicura.
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 2));
    const logger = makeLogger();
    inquirer.prompt.mockResolvedValueOnce({ action: 'keep' });

    await configureSessionKeys({ logger, backupManager: makeBackupManager(), configPath });

    expect(logger.warning).toHaveBeenCalled();
    expect(logger.warning.mock.calls.flat().join(' ')).toMatch(/non sicur|placeholder/i);
  });

  test('con chiavi personalizzate NON arriva alcun warning', async () => {
    // Il rovescio del test precedente: un avviso che compare sempre smette di
    // essere letto.
    const configPath = scriviConfig(['chiavePersonalizzataAbbastanzaLunga']);
    const logger = makeLogger();
    inquirer.prompt.mockResolvedValueOnce({ action: 'keep' });

    await configureSessionKeys({ logger, backupManager: makeBackupManager(), configPath });

    expect(logger.warning).not.toHaveBeenCalled();
  });
});

describe('azione "custom" — chiavi fornite a mano', () => {
  const chiaviCustom = () => 'primaChiaveMoltoLungaEUnica, secondaChiaveMoltoLungaEUnica';

  test('scrive le chiavi indicate, ripulite dagli spazi', async () => {
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 1));
    inquirer.prompt
      .mockResolvedValueOnce({ action: 'custom' })
      .mockResolvedValueOnce({ customRaw: chiaviCustom() });

    const esito = await configureSessionKeys({
      logger: makeLogger(), backupManager: makeBackupManager(), configPath,
    });

    expect(esito).toEqual({ action: 'custom', changed: true });
    expect(loadJson5(configPath).keys).toEqual([
      'primaChiaveMoltoLungaEUnica',
      'secondaChiaveMoltoLungaEUnica',
    ]);
  });

  test('le virgole in eccesso non producono chiavi vuote', async () => {
    // Una chiave vuota nell'array farebbe firmare i cookie con la stringa vuota.
    const configPath = scriviConfig(['x'.repeat(40)]);
    inquirer.prompt
      .mockResolvedValueOnce({ action: 'custom' })
      .mockResolvedValueOnce({ customRaw: ', unaChiaveMoltoLungaEDavveroUnica, ,' });

    await configureSessionKeys({ logger: makeLogger(), backupManager: makeBackupManager(), configPath });

    const { keys } = loadJson5(configPath);
    expect(keys).toEqual(['unaChiaveMoltoLungaEDavveroUnica']);
    expect(keys).not.toContain('');
  });

  describe('il validatore dell\'input, estratto dalla domanda posta', () => {
    /** Recupera la `validate` che il codice ha davvero passato a inquirer. */
    const prendiValidate = async () => {
      const configPath = scriviConfig(['y'.repeat(40)]);
      inquirer.prompt
        .mockResolvedValueOnce({ action: 'custom' })
        .mockResolvedValueOnce({ customRaw: 'unaChiaveMoltoLungaEDavveroUnica' });

      await configureSessionKeys({ logger: makeLogger(), backupManager: makeBackupManager(), configPath });

      const [[domande]] = inquirer.prompt.mock.calls.slice(1);
      return domande[0].validate;
    };

    test('accetta chiavi di lunghezza sufficiente', async () => {
      const validate = await prendiValidate();
      expect(validate('a'.repeat(MIN_CUSTOM_KEY_LENGTH))).toBe(true);
    });

    test('rifiuta una chiave troppo corta, nominandola', async () => {
      const validate = await prendiValidate();
      const corta = 'a'.repeat(MIN_CUSTOM_KEY_LENGTH - 1);
      const esito = validate(corta);
      expect(typeof esito).toBe('string');
      expect(esito).toContain(corta);
    });

    test('basta UNA chiave corta fra tante per rifiutare tutto', async () => {
      // Una chiave debole nel mazzo è sufficiente a firmare cookie deboli: il
      // rifiuto non può essere « a maggioranza ».
      const validate = await prendiValidate();
      expect(typeof validate(`${'a'.repeat(40)}, corta`)).toBe('string');
    });

    test('rifiuta un input vuoto o di sole virgole', async () => {
      const validate = await prendiValidate();
      expect(typeof validate('')).toBe('string');
      expect(typeof validate(' , , ')).toBe('string');
    });

    test('il controllo sui placeholder è RAGGIUNGIBILE, non un ramo morto', () => {
      // Misurato: 3 dei 4 placeholder superano i 16 caratteri della soglia, quindi
      // arrivano davvero al controllo dedicato invece di essere già respinti per
      // lunghezza. Se un domani i placeholder venissero accorciati, o la soglia
      // alzata, quel controllo diventerebbe irraggiungibile in silenzio — e il
      // rifiuto arriverebbe con il messaggio sbagliato. Questo test lo direbbe.
      const lunghi = PLACEHOLDER_SESSION_KEYS.filter((k) => k.length >= MIN_CUSTOM_KEY_LENGTH);
      expect(lunghi.length).toBeGreaterThan(0);
    });

    test('rifiuta un placeholder noto anche quando è abbastanza lungo', async () => {
      // È il punto dello step: reinserire a mano un placeholder lo
      // reintrodurrebbe passando dalla porta principale.
      const validate = await prendiValidate();
      const placeholderLungo = PLACEHOLDER_SESSION_KEYS
        .find((k) => k.length >= MIN_CUSTOM_KEY_LENGTH);

      expect(validate(placeholderLungo)).toMatch(/placeholder/i);
    });

    test('TUTTI i placeholder sono rifiutati, per una ragione o per l\'altra', async () => {
      // Quelli sotto soglia cadono per lunghezza, gli altri per identità: ciò che
      // conta è che nessuno di essi possa rientrare.
      const validate = await prendiValidate();
      for (const placeholder of PLACEHOLDER_SESSION_KEYS) {
        expect(typeof validate(placeholder)).toBe('string');
      }
    });
  });
});

describe('percorsi di errore — il wizard non deve mai morire qui', () => {
  test('config illeggibile → esito "skip", nessun throw', async () => {
    // Un file mancante o corrotto non può interrompere l'installazione con uno
    // stack trace: lo step si salta e lo dice.
    const logger = makeLogger();

    const esito = await configureSessionKeys({
      logger,
      backupManager: makeBackupManager(),
      configPath: path.join(tmpDir, 'inesistente.json5'),
    });

    expect(esito).toEqual({ action: 'skip', changed: false });
    expect(logger.warning).toHaveBeenCalled();
    expect(inquirer.prompt).not.toHaveBeenCalled(); // nemmeno chiede
  });

  test('scrittura fallita → esito changed:false ed errore loggato', async () => {
    const configPath = scriviConfig([...PLACEHOLDER_SESSION_KEYS].slice(0, 1));
    const logger = makeLogger();
    const backupManager = {
      backupGlobalFile: jest.fn(() => { throw new Error('disco pieno'); }),
    };
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    const esito = await configureSessionKeys({ logger, backupManager, configPath });

    expect(esito.changed).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  test('una chiave `keys` non-array è trattata come lista vuota, non come crash', async () => {
    // Un file modificato a mano può contenere qualsiasi cosa.
    const configPath = path.join(tmpDir, 'keys-non-array.json5');
    fs.writeFileSync(configPath, '{ keys: "unaStringa", CONFIG: {} }\n', 'utf8');
    inquirer.prompt.mockResolvedValueOnce({ action: 'generate' });

    const esito = await configureSessionKeys({
      logger: makeLogger(), backupManager: makeBackupManager(), configPath,
    });

    expect(esito.changed).toBe(true);
    expect(Array.isArray(loadJson5(configPath).keys)).toBe(true);
  });
});
