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
  // Un sotto-oggetto commentato: serve a verificare che cambiare UNA foglia non
  // appiattisca il blocco che la contiene.
  "https": {
    // false = il sito parte solo in HTTP
    "enabled": false,
    "port": 443,   // porta TLS
  },
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

describe('saveConfig() — scrittura chirurgica, chiave per chiave', () => {
  // Da v3.13.0 `saveConfig()` non riserializza più il file: confronta l'oggetto
  // con quello su disco e scrive con `setJson5Key` le sole chiavi cambiate.
  // Il contratto che ne discende è verificato qui sotto; la conservazione dei
  // commenti — il motivo della riscrittura — ha un blocco dedicato in fondo.

  test('i valori indicati finiscono sul disco', async () => {
    await wizard.saveConfig({ ...wizard.readCurrentConfig(), apiPrefix: 'v2', httpPort: 8080 });

    expect(loadJson5(configPath)).toMatchObject({ apiPrefix: 'v2', httpPort: 8080 });
    expect(logger.success).toHaveBeenCalled();
  });

  test('scrive SOLO le chiavi cambiate, e le nomina', async () => {
    // Il valore di ritorno non è cosmetico: è l'unico modo, per chi chiama, di
    // sapere cosa è stato davvero toccato (prima si riscriveva tutto comunque).
    const esito = await wizard.saveConfig({ ...wizard.readCurrentConfig(), httpPort: 8080 });

    expect(esito.written).toEqual(['httpPort']);
  });

  test('niente di cambiato → il file non viene toccato affatto', async () => {
    const primaDigest = digest(configPath);

    const esito = await wizard.saveConfig(wizard.readCurrentConfig());

    expect(esito.written).toEqual([]);
    expect(digest(configPath)).toBe(primaDigest);
    expect(logger.info).toHaveBeenCalled();
  });

  test('le chiavi assenti dall\'oggetto NON vengono rimosse, e vengono segnalate', async () => {
    // Scrivere chiave per chiave significa « questi sono i valori che imposto »,
    // non « questo è l'intero file »: un oggetto parziale non deve potare il
    // resto della configurazione. Ma nemmeno passare in silenzio.
    await wizard.saveConfig({ apiPrefix: 'v2' });

    const salvato = loadJson5(configPath);
    expect(salvato.apiPrefix).toBe('v2');
    expect(salvato.wwwPath).toBe('/www');
    expect(salvato.httpPort).toBe(3000);
    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('wwwPath'));
  });

  test('una foglia annidata si scrive senza appiattire il blocco che la contiene', async () => {
    const corrente = wizard.readCurrentConfig();

    const esito = await wizard.saveConfig({ ...corrente, https: { ...corrente.https, port: 8443 } });

    expect(esito.written).toEqual(['https.port']);
    expect(loadJson5(configPath).https).toEqual({ enabled: false, port: 8443 });
    // Il commento INTERNO al blocco è ancora lì: è la prova che non è stato
    // riscritto in blocco con un JSON.stringify del sotto-oggetto.
    expect(fs.readFileSync(configPath, 'utf8')).toContain('// false = il sito parte solo in HTTP');
  });

  test('file inesistente → rifiuta dopo averlo detto, senza crearlo', async () => {
    // Prima il file veniva creato da zero. Ora no: un `ital8Config.json5` assente
    // è il gate [INIT] del boot, non qualcosa che il wizard inventa.
    const assente = path.join(tmpDir, 'assente.json5');
    const orfano = new ConfigWizard(logger, assente);

    await expect(orfano.saveConfig({ apiPrefix: 'api' })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalled();
    expect(fs.existsSync(assente)).toBe(false);
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

describe('i commenti del config sopravvivono al salvataggio', () => {
  // ERA IL DIFETTO D1, corretto in v3.13.0.
  //
  // `saveConfig()` faceva `JSON.stringify(config, null, 2)` sull'oggetto intero:
  // il file veniva RISERIALIZZATO, quindi ogni commento spariva. Misurato sul
  // `ital8Config.json5` reale del progetto: **230 righe con commento su 340
  // diventavano 1**, e il file passava a 115 righe. Chi eseguiva il wizard e
  // confermava una qualsiasi modifica perdeva tutta la documentazione inline
  // della configurazione centrale, in silenzio.
  //
  // Era l'anti-pattern che CLAUDE.md vieta esplicitamente e che il resto del
  // codice recente già rispettava (`sessionKeyManager` usa `editJson5`).
  //
  // Questi test sono la rete che impedisce il ritorno: fanno passare la
  // riscrittura chirurgica e falliscono su qualunque riserializzazione.

  const contaCommenti = (t) => t.split('\n').filter((r) => r.includes('//')).length;

  test('salvare NON riduce i commenti del file', async () => {
    const prima = contaCommenti(fs.readFileSync(configPath, 'utf8'));
    expect(prima).toBeGreaterThan(1);

    await wizard.saveConfig({ ...wizard.readCurrentConfig(), httpPort: 8080 });

    expect(contaCommenti(fs.readFileSync(configPath, 'utf8'))).toBe(prima);
  });

  test('i commenti restano quelli, non solo altrettanti', async () => {
    // Contarli non basta: una riserializzazione che aggiungesse un'intestazione
    // per chiave passerebbe il test precedente. Qui si verifica il testo.
    await wizard.saveConfig({ ...wizard.readCurrentConfig(), apiPrefix: 'v2' });

    const testo = fs.readFileSync(configPath, 'utf8');
    expect(testo).toContain('// Prefisso delle rotte API');
    expect(testo).toContain('// pannello admin');
    expect(testo).toContain('// Una chiave che il wizard NON chiede mai');
    expect(testo).toContain('// porta TLS');
  });

  test('la riga della chiave cambiata conserva il proprio commento a fine riga', async () => {
    // Il caso più insidioso: `editJson5` sostituisce il VALORE, e il commento che
    // segue sulla stessa riga deve restare al suo posto.
    await wizard.saveConfig({ ...wizard.readCurrentConfig(), adminPrefix: 'pannello' });

    expect(fs.readFileSync(configPath, 'utf8'))
      .toMatch(/"adminPrefix":\s*"pannello",\s*\/\/ pannello admin/);
  });

  test('anche il percorso completo di run() li conserva', async () => {
    // La regressione da impedire è quella dell'utente vero, che non chiama
    // `saveConfig()` ma esegue il wizard.
    const prima = contaCommenti(fs.readFileSync(configPath, 'utf8'));
    inquirer.prompt
      .mockResolvedValueOnce({ shouldModify: true })
      .mockResolvedValueOnce({ fieldsToModify: ['httpPort'] })
      .mockResolvedValueOnce({ httpPort: 8080 })
      .mockResolvedValueOnce({ confirm: true });

    await wizard.run();

    expect(loadJson5(configPath).httpPort).toBe(8080);
    expect(contaCommenti(fs.readFileSync(configPath, 'utf8'))).toBe(prima);
  });

  test('i VALORI restano corretti: si conserva la documentazione senza perdere la configurazione', async () => {
    const prima = wizard.readCurrentConfig();

    await wizard.saveConfig(prima);

    expect(loadJson5(configPath)).toEqual(prima);
  });
});
