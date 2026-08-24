// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per scripts/lib/ConfigWizard — la FASE 1 di `npm run start-configure`.
 *
 * PERCHÉ CONTA
 * ------------
 * È l'unico codice del progetto che **riscrive `ital8Config.json5`**, cioè la
 * configurazione centrale: porta, prefissi delle rotte, temi attivi, pannello
 * admin. Un errore qui non rompe un test, rompe l'installazione di chi lo ha
 * appena eseguito.
 *
 * PERCHÉ NON ERA TESTATO PRIMA
 * ----------------------------
 * `configPath` era cablato sul file VERO: esercitare la classe avrebbe
 * sovrascritto la configurazione del repository. Il seam aggiunto in v3.7.0 —
 * parametro opzionale col default invariato — lo rende pilotabile su tmpdir, e un
 * `afterAll` verifica col digest che il file vivo non sia stato toccato.
 *
 * COSA EMERGE
 * -----------
 * `saveConfig()` fa `JSON.stringify` dell'oggetto intero, quindi **perde tutti i
 * commenti** del file. Misurato sul `ital8Config.json5` reale: 230 righe commentate
 * su 340 diventano 1. È caratterizzato in fondo al file come difetto noto, non come
 * comportamento voluto.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('inquirer', () => ({ default: { prompt: jest.fn() } }));
const inquirer = require('inquirer').default;

const ConfigWizard = require('../../../scripts/lib/configWizard');
const loadJson5 = require('../../../core/loadJson5');

const CONFIG_VIVO = path.join(__dirname, '../../../ital8Config.json5');
const digest = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

let tmpDir;
let configPath;
let logger;
let wizard;
let digestVivoIniziale;
let consoleLogOriginale;

const makeLogger = () => ({
  separator: jest.fn(), info: jest.fn(), warning: jest.fn(),
  success: jest.fn(), error: jest.fn(),
});

/** Config di prova, con commenti: servono a verificare cosa sopravvive. */
const CONFIG_CON_COMMENTI = `// This file follows the JSON5 standard
{
  // Prefisso delle rotte API
  "apiPrefix": "api",
  "adminPrefix": "admin",   // pannello admin
  "enableAdmin": true,
  "httpPort": 3000,
  "debugMode": 1,
  "activeTheme": "default",
  "adminActiveTheme": "defaultAdminTheme",
  // Una chiave che il wizard NON chiede mai
  "wwwPath": "/www",
}
`;

beforeAll(() => {
  digestVivoIniziale = digest(CONFIG_VIVO);
});

afterAll(() => {
  // Isolamento verificato, non promesso: questo wizard RISCRIVE il file, quindi
  // un test che sbagliasse path distruggerebbe la config del repository.
  expect(digest(CONFIG_VIVO)).toBe(digestVivoIniziale);
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configWizard-'));
  configPath = path.join(tmpDir, 'ital8Config.json5');
  fs.writeFileSync(configPath, CONFIG_CON_COMMENTI, 'utf8');
  logger = makeLogger();
  wizard = new ConfigWizard(logger, configPath);

  inquirer.prompt.mockReset();
  consoleLogOriginale = console.log;
  console.log = () => {};
});

afterEach(() => {
  console.log = consoleLogOriginale;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('il seam introdotto in v3.7.0', () => {
  test('senza secondo argomento punta a ital8Config.json5 del progetto', () => {
    expect(new ConfigWizard(makeLogger()).configPath).toBe(path.resolve(CONFIG_VIVO));
  });

  test('con il secondo argomento lavora su quel file soltanto', () => {
    expect(wizard.configPath).toBe(configPath);
  });
});

describe('readCurrentConfig()', () => {
  test('legge la configurazione, commenti inclusi nel file', () => {
    expect(wizard.readCurrentConfig()).toMatchObject({ apiPrefix: 'api', httpPort: 3000 });
  });

  test('file mancante → rilancia dopo averlo detto', () => {
    // Senza configurazione globale non si sa nemmeno su che porta partire: è il
    // caso in cui fermarsi è giusto.
    const orfano = new ConfigWizard(logger, path.join(tmpDir, 'assente.json5'));

    expect(() => orfano.readCurrentConfig()).toThrow();
    expect(logger.error).toHaveBeenCalled();
  });

  test('file corrotto → rilancia dopo averlo detto', () => {
    fs.writeFileSync(configPath, '{ non è json5 :::', 'utf8');

    expect(() => wizard.readCurrentConfig()).toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('saveConfig()', () => {
  test('scrive un JSON5 rileggibile con i valori indicati', () => {
    wizard.saveConfig({ apiPrefix: 'v2', httpPort: 8080 });

    expect(loadJson5(configPath)).toEqual({ apiPrefix: 'v2', httpPort: 8080 });
    expect(logger.success).toHaveBeenCalled();
  });

  test('la prima riga resta l\'intestazione JSON5 del progetto', () => {
    wizard.saveConfig({ apiPrefix: 'api' });
    expect(fs.readFileSync(configPath, 'utf8').split('\n')[0]).toMatch(/^\/\/ This file follows/);
  });

  test('scrittura impossibile → rilancia dopo averlo detto', () => {
    const orfano = new ConfigWizard(logger, path.join(tmpDir, 'assente', 'x.json5'));

    expect(() => orfano.saveConfig({})).toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('run() — il percorso completo', () => {
  test('rispondendo "no" NON tocca il file', () => {
    // Il caso più frequente in una re-init: chi non vuole cambiare niente non
    // deve vedersi riscrivere la configurazione.
    inquirer.prompt.mockResolvedValueOnce({ shouldModify: false });
    const primaDigest = digest(configPath);

    return wizard.run().then((esito) => {
      expect(esito).toMatchObject({ apiPrefix: 'api', httpPort: 3000 });
      expect(digest(configPath)).toBe(primaDigest);
    });
  });

  test('modificando un campo e confermando, il valore finisce sul disco', async () => {
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['httpPort'] })
      .mockResolvedValueOnce({ httpPort: 8080 })
      .mockResolvedValueOnce({ confirm: true });

    const esito = await wizard.run();

    expect(esito.httpPort).toBe(8080);
    expect(loadJson5(configPath).httpPort).toBe(8080);
  });

  test('le chiavi NON toccate sopravvivono al salvataggio', () => {
    // Il merge è `{ ...currentConfig, ...answers }`: se fosse una sostituzione,
    // ogni chiave non chiesta dal wizard sparirebbe dalla configurazione.
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['httpPort'] })
      .mockResolvedValueOnce({ httpPort: 8080 })
      .mockResolvedValueOnce({ confirm: true });

    return wizard.run().then(() => {
      const salvato = loadJson5(configPath);
      expect(salvato.wwwPath).toBe('/www');          // mai chiesta
      expect(salvato.activeTheme).toBe('default');   // chiedibile, non chiesta
    });
  });

  test('NON confermando, il file resta intatto e torna la config originale', async () => {
    // L'ultima possibilità di ripensarci: deve funzionare davvero.
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['httpPort'] })
      .mockResolvedValueOnce({ httpPort: 9999 })
      .mockResolvedValueOnce({ confirm: false });
    const primaDigest = digest(configPath);

    const esito = await wizard.run();

    expect(esito.httpPort).toBe(3000);
    expect(digest(configPath)).toBe(primaDigest);
    expect(logger.info).toHaveBeenCalled();
  });

  test('la porta digitata passa dal validatore e viene convertita a numero', async () => {
    // `filter: (v) => parseInt(v)`: senza, la porta finirebbe nel config come
    // stringa, e `app.listen("8080")` è un caso diverso da `listen(8080)`.
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['httpPort'] })
      .mockResolvedValueOnce({ httpPort: 8080 })
      .mockResolvedValueOnce({ confirm: true });

    await wizard.run();

    const domandaPorta = inquirer.prompt.mock.calls[2][0].find((q) => q.name === 'httpPort');
    expect(typeof domandaPorta.validate).toBe('function');
    expect(domandaPorta.filter('8080')).toBe(8080);
    expect(typeof loadJson5(configPath).httpPort).toBe('number');
  });

  test('ogni campo chiedibile propone come default il valore CORRENTE', async () => {
    // Premere invio su ogni domanda deve lasciare la configurazione com'era: un
    // default sbagliato la cambierebbe senza che nessuno l'abbia chiesto.
    const campi = ['apiPrefix', 'adminPrefix', 'httpPort', 'activeTheme', 'adminActiveTheme'];
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: campi })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ confirm: false });

    const corrente = wizard.readCurrentConfig();
    await wizard.run();

    for (const domanda of inquirer.prompt.mock.calls[2][0]) {
      expect(domanda.default).toBe(corrente[domanda.name]);
    }
  });

  test('i prefissi sono protetti dal validatore apiPrefix', async () => {
    // `apiPrefix` e `adminPrefix` finiscono dentro gli URL: uno slash o uno
    // spazio produrrebbe rotte irraggiungibili.
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['apiPrefix', 'adminPrefix'] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ confirm: false });

    await wizard.run();

    for (const domanda of inquirer.prompt.mock.calls[2][0]) {
      expect(domanda.validate('api/v1')).not.toBe(true);
      expect(domanda.validate('api')).toBe(true);
    }
  });
});

describe('⚠ DIFETTO NOTO — saveConfig() distrugge i commenti del config', () => {
  // CARATTERIZZAZIONE, non contratto voluto.
  //
  // `saveConfig()` fa `JSON.stringify(config, null, 2)` sull'oggetto intero: il
  // file viene RISERIALIZZATO, quindi ogni commento sparisce. È esattamente
  // l'anti-pattern che CLAUDE.md vieta (*« Negli script preferisci
  // setJson5Key/editJson5 a un saveJson5 dell'oggetto intero: quest'ultimo perde
  // i commenti del config vivo »*), e che il codice più recente rispetta —
  // `sessionKeyManager` usa `editJson5` proprio per questo.
  //
  // MISURATO sul `ital8Config.json5` reale del progetto: **230 righe commentate
  // su 340 diventano 1**, e il file passa da 340 a 115 righe. Quel file è la
  // documentazione inline della configurazione centrale: chi esegue il wizard e
  // conferma una qualsiasi modifica la perde tutta, in silenzio.
  //
  // Non corretto qui: la correzione è sostituire la riscrittura con un
  // `editJson5` per ogni chiave cambiata, il che cambia il comportamento del
  // wizard. È una decisione, aperta in TODO.md §5. Quando verrà fatta, questi
  // test falliranno e vanno riscritti come contratto.

  test('un salvataggio azzera i commenti del file', () => {
    const commenti = (t) => t.split('\n').filter((r) => r.includes('//')).length;
    expect(commenti(fs.readFileSync(configPath, 'utf8'))).toBeGreaterThan(1);

    wizard.saveConfig(wizard.readCurrentConfig());

    // Resta solo l'intestazione riscritta a mano dal codice.
    expect(commenti(fs.readFileSync(configPath, 'utf8'))).toBe(1);
  });

  test('i VALORI sopravvivono: si perde la documentazione, non la configurazione', () => {
    // La distinzione conta per giudicare la gravità: il sito continua a
    // funzionare identico, ma il file diventa illeggibile per chi lo apre dopo.
    const prima = wizard.readCurrentConfig();
    wizard.saveConfig(prima);

    expect(loadJson5(configPath)).toEqual(prima);
  });
});
