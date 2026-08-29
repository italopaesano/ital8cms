// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per scripts/lib/StateManager — la memoria dell'installazione.
 *
 * PERCHÉ CONTA
 * ------------
 * È il file che risponde alla domanda « questa installazione è già stata
 * inizializzata? ». Da lì dipende se `npm run start-configure` riparte da zero o
 * riprende, e quali plugin rieseguono il proprio `init.js`. Uno stato letto male
 * fa **ri-eseguire un'inizializzazione già fatta** — che per i plugin significa
 * riscrivere config e, nel caso di `adminUsers`, ricreare l'account root.
 *
 * PERCHÉ NON ERA TESTATO PRIMA (e cosa è cambiato)
 * -----------------------------------------------
 * `globalStatePath` era cablato su `scripts/initState.json5`, cioè sul file VERO
 * del repository: esercitare la classe significava scrivere dentro il progetto.
 * Il seam aggiunto in v3.7.0 — un secondo parametro opzionale col default
 * invariato, come `themesRootPath` (v2.92.0) e `pluginsRootPath` (v2.98.0) — lo
 * rende pilotabile su tmpdir.
 *
 * Lo stato PER PLUGIN non ha mai avuto bisogno di un seam: deriva già dal
 * `pluginPath` che i metodi ricevono come argomento.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const StateManager = require('../../../scripts/lib/stateManager');

/** Il file vivo: si legge il digest per provare che nessun test lo tocchi. */
const STATE_VIVO = path.join(__dirname, '../../../scripts/initState.json5');

let tmpDir;
let statePath;
let logger;
let stateManager;

const makeLogger = () => ({
  separator: jest.fn(), info: jest.fn(), warning: jest.fn(),
  success: jest.fn(), error: jest.fn(),
});

/** Crea una cartella plugin di prova e ne restituisce il path. */
const makePluginDir = (nome) => {
  const dir = path.join(tmpDir, 'plugins', nome);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

let digestVivoIniziale = null;

beforeAll(() => {
  // Il file può non esistere (installazione mai inizializzata): il caso va
  // distinto, altrimenti l'assenza verrebbe scambiata per « non modificato ».
  digestVivoIniziale = fs.existsSync(STATE_VIVO)
    ? crypto.createHash('sha256').update(fs.readFileSync(STATE_VIVO)).digest('hex')
    : null;
});

afterAll(() => {
  const adesso = fs.existsSync(STATE_VIVO)
    ? crypto.createHash('sha256').update(fs.readFileSync(STATE_VIVO)).digest('hex')
    : null;

  // Isolamento VERIFICATO, non promesso: se un caso futuro dimenticasse il seam
  // e usasse il default, questo lo direbbe invece di sporcare il repository.
  expect(adesso).toBe(digestVivoIniziale);
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateManager-'));
  statePath = path.join(tmpDir, 'initState.json5');
  logger = makeLogger();
  stateManager = new StateManager(logger, statePath);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('il seam introdotto in v3.7.0', () => {
  test('senza secondo argomento punta al file del progetto', () => {
    // Il default deve restare INVARIATO: il seam serve ai test, non a spostare
    // il comportamento di `scripts/init.js`, che continua a passare il solo logger.
    const conDefault = new StateManager(makeLogger());
    expect(conDefault.globalStatePath).toBe(path.resolve(STATE_VIVO));
  });

  test('con il secondo argomento usa quel file e nessun altro', () => {
    expect(stateManager.globalStatePath).toBe(statePath);
  });
});

describe('stato globale — assenza, lettura, scrittura', () => {
  test('senza file: hasGlobalState() è false e readGlobalState() dà null', () => {
    // È lo stato di un'installazione mai inizializzata, e deve essere
    // distinguibile da « letto ma vuoto ».
    expect(stateManager.hasGlobalState()).toBe(false);
    expect(stateManager.readGlobalState()).toBeNull();
  });

  test('scrittura e rilettura conservano ciò che è stato scritto', () => {
    stateManager.writeGlobalState({ global: { completed: true } });

    expect(stateManager.hasGlobalState()).toBe(true);
    expect(stateManager.readGlobalState().global).toEqual({ completed: true });
  });

  test('i campi obbligatori vengono riempiti anche partendo da un oggetto vuoto', () => {
    // Chi legge lo stato dà per scontati questi campi: mancarne uno farebbe
    // fallire il confronto a valle invece di riportare « non inizializzato ».
    stateManager.writeGlobalState({});
    const stato = stateManager.readGlobalState();

    expect(stato).toMatchObject({
      version: '1.0.0',
      initialized: true,
      global: { completed: false },
      plugins: {},
    });
    expect(typeof stato.initDate).toBe('string');
    expect(typeof stato.lastUpdate).toBe('string');
  });

  test('`initialized: false` NON viene sovrascritto dal default', () => {
    // Il codice usa `!== undefined`, non `||`: un `false` esplicito è
    // un'informazione, e con `||` sarebbe stato ribaltato in `true`.
    stateManager.writeGlobalState({ initialized: false });
    expect(stateManager.readGlobalState().initialized).toBe(false);
  });

  test('una initDate già presente viene preservata, lastUpdate no', () => {
    // `initDate` è « quando è stata inizializzata »: riscriverla a ogni update
    // cancellerebbe l'unico dato storico del file.
    stateManager.writeGlobalState({ initDate: '01/01/2020 10:00:00' });
    const primo = stateManager.readGlobalState();

    stateManager.updateGlobalState({ global: { completed: true } });
    const secondo = stateManager.readGlobalState();

    expect(secondo.initDate).toBe('01/01/2020 10:00:00');
    expect(secondo.lastUpdate).not.toBe(primo.initDate);
  });

  test('il file scritto è JSON5 valido e porta il commento in testa', () => {
    stateManager.writeGlobalState({});
    const testo = fs.readFileSync(statePath, 'utf8');

    expect(testo.startsWith('//')).toBe(true);
    // Il progetto legge i .json5 con loadJson5: un file senza commento sarebbe
    // comunque valido, ma la convenzione vuole la prima riga di intestazione.
    expect(() => require('../../../core/loadJson5')(statePath)).not.toThrow();
  });

  test('un file corrotto → null e un errore loggato, MAI un throw', () => {
    // Il wizard non deve morire con uno stack trace perché qualcuno ha modificato
    // il file a mano: deve poter ripartire.
    fs.writeFileSync(statePath, '{ questo non è json5 :::', 'utf8');

    expect(() => stateManager.readGlobalState()).not.toThrow();
    expect(stateManager.readGlobalState()).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test('scrittura impossibile → rilancia, dopo averlo detto', () => {
    // Qui invece il throw è giusto: se lo stato non si scrive, proseguire
    // significherebbe credere di aver registrato qualcosa che non c'è.
    const inScrivibile = new StateManager(logger, path.join(tmpDir, 'assente', 'x.json5'));

    expect(() => inScrivibile.writeGlobalState({})).toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('updateGlobalState() — fusione, non sostituzione', () => {
  test('le chiavi non citate sopravvivono all\'aggiornamento', () => {
    stateManager.writeGlobalState({ version: '2.0.0', global: { completed: true } });
    stateManager.updateGlobalState({ plugins: { adminUsers: { completed: true } } });

    const stato = stateManager.readGlobalState();
    expect(stato.version).toBe('2.0.0');
    expect(stato.global).toEqual({ completed: true });
    expect(stato.plugins.adminUsers).toEqual({ completed: true });
  });

  test('funziona anche partendo da nessuno stato', () => {
    // Prima installazione: `readGlobalState()` dà null e l'update non deve
    // esplodere sul `...null`.
    expect(() => stateManager.updateGlobalState({ global: { completed: true } })).not.toThrow();
    expect(stateManager.readGlobalState().global).toEqual({ completed: true });
  });
});

describe('stato per plugin dentro lo stato globale', () => {
  test('updatePluginState() aggiunge il plugin e gli mette una data', () => {
    stateManager.updatePluginState('adminUsers', { completed: true });

    const registrato = stateManager.readGlobalState().plugins.adminUsers;
    expect(registrato.completed).toBe(true);
    expect(typeof registrato.initDate).toBe('string');
  });

  test('registrare un secondo plugin non cancella il primo', () => {
    // È l'errore naturale di un `plugins = { [nome]: … }` al posto di un merge,
    // e farebbe ri-eseguire l'init di tutti i plugin già fatti.
    stateManager.updatePluginState('adminUsers', { completed: true });
    stateManager.updatePluginState('media', { completed: true });

    expect(Object.keys(stateManager.readGlobalState().plugins).sort())
      .toEqual(['adminUsers', 'media']);
  });

  test('isPluginInitialized() è vero SOLO con completed: true', () => {
    // Il punto delicato: qualsiasi altra risposta fa ri-eseguire un init già
    // fatto. Si verifica ogni forma di « non completato », non solo l'assenza.
    expect(stateManager.isPluginInitialized('mai')).toBe(false); // nessuno stato

    stateManager.updatePluginState('parziale', { completed: false });
    expect(stateManager.isPluginInitialized('parziale')).toBe(false);

    stateManager.updatePluginState('senzaFlag', { qualcosa: 1 });
    expect(stateManager.isPluginInitialized('senzaFlag')).toBe(false);

    stateManager.updatePluginState('fatto', { completed: true });
    expect(stateManager.isPluginInitialized('fatto')).toBe(true);
  });

  test('un `completed` truthy ma non booleano NON conta come completato', () => {
    // Il confronto è `=== true`: fissarlo evita che un domani un `'yes'` o un `1`
    // letto da un file scritto a mano venga preso per un'installazione riuscita.
    stateManager.updatePluginState('stringa', { completed: 'true' });
    expect(stateManager.isPluginInitialized('stringa')).toBe(false);
  });
});

describe('stato scritto DENTRO la cartella del plugin', () => {
  test('il path è plugins/<nome>/scripts/initState.json5', () => {
    const pluginDir = makePluginDir('mioPlugin');
    expect(stateManager.getPluginStatePath(pluginDir))
      .toBe(path.join(pluginDir, 'scripts', 'initState.json5'));
  });

  test('la cartella scripts/ viene creata se manca', () => {
    // Un plugin senza `scripts/` è il caso normale: la scrittura non deve
    // fallire perché la cartella non c'è.
    const pluginDir = makePluginDir('senzaScripts');
    stateManager.writePluginState(pluginDir, { initialized: true });

    expect(fs.existsSync(path.join(pluginDir, 'scripts', 'initState.json5'))).toBe(true);
  });

  test('scrittura e rilettura, con il nome del plugin nel commento', () => {
    const pluginDir = makePluginDir('mioPlugin');
    stateManager.writePluginState(pluginDir, { initialized: true, backupPath: '/tmp/b' });

    expect(stateManager.hasPluginState(pluginDir)).toBe(true);
    expect(stateManager.readPluginState(pluginDir)).toMatchObject({
      initialized: true, backupPath: '/tmp/b',
    });
    expect(fs.readFileSync(stateManager.getPluginStatePath(pluginDir), 'utf8'))
      .toContain('mioPlugin');
  });

  test('backupPath assente diventa null, non undefined', () => {
    // `undefined` sparirebbe da JSON.stringify e la chiave non esisterebbe:
    // chi legge dovrebbe distinguere « assente » da « nessun backup ».
    const pluginDir = makePluginDir('senzaBackup');
    stateManager.writePluginState(pluginDir, { initialized: true });

    expect(stateManager.readPluginState(pluginDir).backupPath).toBeNull();
  });

  test('lo stato di un plugin è indipendente da quello di un altro', () => {
    const primo = makePluginDir('primo');
    const secondo = makePluginDir('secondo');

    stateManager.writePluginState(primo, { initialized: true });

    expect(stateManager.hasPluginState(primo)).toBe(true);
    expect(stateManager.hasPluginState(secondo)).toBe(false);
  });
});

describe('reset — la via per re-inizializzare', () => {
  test('resetGlobalState() rimuove il file e lo dice', () => {
    stateManager.writeGlobalState({});
    stateManager.resetGlobalState();

    expect(fs.existsSync(statePath)).toBe(false);
    expect(stateManager.hasGlobalState()).toBe(false);
    expect(logger.info).toHaveBeenCalled();
  });

  test('resetGlobalState() su un file già assente non lancia né logga', () => {
    // Idempotenza: un reset ripetuto è un no-op silenzioso, non un errore.
    expect(() => stateManager.resetGlobalState()).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('resetPluginState() rimuove SOLO il plugin indicato', () => {
    const primo = makePluginDir('primo');
    const secondo = makePluginDir('secondo');
    stateManager.writePluginState(primo, { initialized: true });
    stateManager.writePluginState(secondo, { initialized: true });

    stateManager.resetPluginState(primo);

    expect(stateManager.hasPluginState(primo)).toBe(false);
    expect(stateManager.hasPluginState(secondo)).toBe(true);
  });

  test('resetPluginState() su un plugin senza stato è un no-op', () => {
    expect(() => stateManager.resetPluginState(makePluginDir('vuoto'))).not.toThrow();
  });
});

describe('getItalianTimestamp()', () => {
  test('formato DD/MM/YYYY HH:MM:SS, con i campi sempre a due cifre', () => {
    // Il formato finisce dentro il file di stato e viene letto da una persona:
    // un `1/1/2026 9:5:3` sarebbe ambiguo oltre che brutto.
    expect(stateManager.getItalianTimestamp())
      .toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  test('il giorno viene PRIMA del mese', () => {
    // È un formato italiano, non ISO né americano: invertirli produrrebbe date
    // plausibili e sbagliate per undici giorni al mese.
    jest.useFakeTimers().setSystemTime(new Date(2026, 1, 25, 14, 5, 9)); // 25 feb
    try {
      expect(stateManager.getItalianTimestamp()).toBe('25/02/2026 14:05:09');
    } finally {
      jest.useRealTimers();
    }
  });
});
