// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per scripts/lib/BackupManager — la rete di sicurezza del wizard.
 *
 * PERCHÉ CONTA
 * ------------
 * `npm run start-configure` **sovrascrive** file di configurazione veri:
 * `ital8Config.json5`, `koaSession.json5`, i config dei plugin. Questa classe è
 * l'unica cosa fra una re-inizializzazione andata storta e la perdita di quei
 * file. Un backup che *sembra* riuscito ma non lo è è peggio di nessun backup,
 * perché toglie la prudenza a chi lo ha visto scorrere.
 *
 * Da non confondere con `scripts/lib/backupEngine.js` (già al 100%), che fa gli
 * snapshot dell'intera installazione per `npm run backup`. Questa qui è la catena
 * **compartimentata** dell'inizializzazione: un file per volta, separando globale
 * e per-plugin.
 *
 * PERCHÉ NON ERA TESTATA PRIMA
 * ----------------------------
 * `backupRoot` era cablato su `backups/` del progetto e il path dei plugin su
 * `plugins/`: esercitare la classe avrebbe scritto dentro il repository. Il seam
 * aggiunto in v3.7.0 — due parametri opzionali col default invariato, la stessa
 * forma di `themesRootPath` (v2.92.0) e `pluginsRootPath` (v2.98.0) — la rende
 * pilotabile su tmpdir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BackupManager = require('../../../scripts/lib/backupManager');

/** Le due radici vere del progetto: nessun test deve scriverci dentro. */
const BACKUPS_VIVO = path.join(__dirname, '../../../backups');
const PLUGINS_VIVO = path.join(__dirname, '../../../plugins');

let tmpDir;
let backupRoot;
let pluginsRoot;
let logger;
let backupManager;

const makeLogger = () => ({
  separator: jest.fn(), info: jest.fn(), warning: jest.fn(),
  success: jest.fn(), error: jest.fn(),
});

/** Crea un file (con le cartelle intermedie) e restituisce il path. */
const scrivi = (filePath, contenuto) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contenuto, 'utf8');
  return filePath;
};

/** Elenco dei backup presenti nella radice, per contarli. */
const snapshotEsistenti = () =>
  (fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot) : []);

let contenutoVivoIniziale;

beforeAll(() => {
  // Fotografa quali snapshot esistono già: se un test usasse il default invece
  // del seam, ne comparirebbe uno nuovo e l'afterAll lo direbbe.
  contenutoVivoIniziale = fs.existsSync(BACKUPS_VIVO)
    ? fs.readdirSync(BACKUPS_VIVO).sort()
    : null;
});

afterAll(() => {
  const adesso = fs.existsSync(BACKUPS_VIVO) ? fs.readdirSync(BACKUPS_VIVO).sort() : null;
  // Isolamento verificato, non promesso.
  expect(adesso).toEqual(contenutoVivoIniziale);
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backupManager-'));
  backupRoot = path.join(tmpDir, 'backups');
  pluginsRoot = path.join(tmpDir, 'plugins');
  fs.mkdirSync(pluginsRoot, { recursive: true });
  logger = makeLogger();
  backupManager = new BackupManager(logger, backupRoot, pluginsRoot);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('il seam introdotto in v3.7.0', () => {
  test('senza argomenti opzionali punta alle cartelle del progetto', () => {
    // Il default deve restare INVARIATO: `scripts/init.js` continua a costruire
    // la classe col solo logger, e non va toccato.
    const conDefault = new BackupManager(makeLogger());
    expect(conDefault.backupRoot).toBe(path.resolve(BACKUPS_VIVO));
    expect(conDefault.pluginsRootPath).toBe(path.resolve(PLUGINS_VIVO));
  });

  test('le due radici si spostano insieme', () => {
    // Spostarne una sola lascerebbe calcolare i path relativi rispetto al repo
    // reale, e il backup finirebbe in un ramo di `../../` fuori dallo snapshot.
    expect(backupManager.backupRoot).toBe(backupRoot);
    expect(backupManager.pluginsRootPath).toBe(pluginsRoot);
  });

  test('lo snapshot vive sotto la radice indicata, in una cartella datata', () => {
    backupManager.ensureBackupDirs();
    const [nome] = snapshotEsistenti();

    expect(nome).toMatch(/^init-\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}$/);
    expect(backupManager.currentBackupDir).toBe(path.join(backupRoot, nome));
  });
});

describe('ensureBackupDirs()', () => {
  test('crea le tre cartelle, anche partendo da una radice inesistente', () => {
    expect(fs.existsSync(backupRoot)).toBe(false);

    backupManager.ensureBackupDirs();

    expect(fs.existsSync(backupManager.currentBackupDir)).toBe(true);
    expect(fs.existsSync(backupManager.globalBackupDir)).toBe(true);
    expect(fs.existsSync(backupManager.pluginsBackupDir)).toBe(true);
  });

  test('chiamarla due volte non lancia e non duplica lo snapshot', () => {
    // Ogni metodo di backup la invoca: se non fosse idempotente, il secondo file
    // salvato farebbe fallire l'intera inizializzazione.
    backupManager.ensureBackupDirs();
    expect(() => backupManager.ensureBackupDirs()).not.toThrow();
    expect(snapshotEsistenti().length).toBe(1);
  });

  test('due file salvati finiscono nello STESSO snapshot', () => {
    // Il timestamp è calcolato una volta nel costruttore, non a ogni chiamata:
    // altrimenti una re-init produrrebbe una cartella per file e il ripristino
    // non saprebbe da quale attingere.
    scrivi(path.join(tmpDir, 'a.json5'), 'a');
    scrivi(path.join(tmpDir, 'b.json5'), 'b');

    backupManager.backupGlobalFile(path.join(tmpDir, 'a.json5'));
    backupManager.backupGlobalFile(path.join(tmpDir, 'b.json5'));

    expect(snapshotEsistenti().length).toBe(1);
    expect(fs.readdirSync(backupManager.globalBackupDir).sort()).toEqual(['a.json5', 'b.json5']);
  });
});

describe('backupGlobalFile() — i config del core', () => {
  test('copia il file e ne restituisce il path', () => {
    const originale = scrivi(path.join(tmpDir, 'ital8Config.json5'), '{ httpPort: 3000 }');

    const backupPath = backupManager.backupGlobalFile(originale);

    expect(fs.readFileSync(backupPath, 'utf8')).toBe('{ httpPort: 3000 }');
    expect(path.dirname(backupPath)).toBe(backupManager.globalBackupDir);
  });

  test('il contenuto è copiato BYTE PER BYTE, commenti compresi', () => {
    // Un backup che riserializza perderebbe i commenti dei .json5 — cioè
    // ripristinerebbe un file diverso da quello salvato.
    const testo = '// commento importante\n{\n  keys: ["a"],  // in linea\n}\n';
    const originale = scrivi(path.join(tmpDir, 'koaSession.json5'), testo);

    expect(fs.readFileSync(backupManager.backupGlobalFile(originale), 'utf8')).toBe(testo);
  });

  test('file inesistente → null e un WARNING, non un\'eccezione', () => {
    // Nel wizard è un caso normale (un config opzionale che non c'è): far
    // fallire l'installazione per questo sarebbe sbagliato.
    const esito = backupManager.backupGlobalFile(path.join(tmpDir, 'mai-esistito.json5'));

    expect(esito).toBeNull();
    expect(logger.warning).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('due file con lo STESSO nome da cartelle diverse si sovrascrivono', () => {
    // ⚠ CARATTERIZZAZIONE, non contratto voluto: il backup globale è piatto e
    // usa il solo `basename`. Oggi non morde — i config globali salvati hanno
    // nomi distinti (`ital8Config.json5`, `koaSession.json5`, `adminConfig.json5`) —
    // ma il giorno in cui due `config.json5` da cartelle diverse venissero
    // salvati insieme, il secondo cancellerebbe il primo **in silenzio**.
    // Aperto in TODO.md §5.
    const primo = scrivi(path.join(tmpDir, 'uno', 'config.json5'), 'PRIMO');
    const secondo = scrivi(path.join(tmpDir, 'due', 'config.json5'), 'SECONDO');

    backupManager.backupGlobalFile(primo);
    const backupPath = backupManager.backupGlobalFile(secondo);

    expect(fs.readFileSync(backupPath, 'utf8')).toBe('SECONDO');
    expect(fs.readdirSync(backupManager.globalBackupDir)).toEqual(['config.json5']);
  });
});

describe('backupPluginFile() — la struttura del plugin è preservata', () => {
  /** Crea un plugin di prova con un file dentro, e restituisce i due path. */
  const pluginConFile = (nome, relativo, contenuto) => {
    const pluginDir = path.join(pluginsRoot, nome);
    return { pluginDir, filePath: scrivi(path.join(pluginDir, relativo), contenuto) };
  };

  test('un file in radice finisce sotto plugins/<nome>/', () => {
    const { filePath } = pluginConFile('adminUsers', 'pluginConfig.json5', 'CONF');

    const backupPath = backupManager.backupPluginFile('adminUsers', filePath);

    expect(backupPath).toBe(
      path.join(backupManager.pluginsBackupDir, 'adminUsers', 'pluginConfig.json5'),
    );
    expect(fs.readFileSync(backupPath, 'utf8')).toBe('CONF');
  });

  test('un file annidato CONSERVA il suo path relativo', () => {
    // È la ragione per cui il seam doveva spostare anche `pluginsRootPath`: il
    // relativo si calcola rispetto alla radice dei plugin, e con quella cablata
    // sul repo reale un plugin in tmpdir produrrebbe un relativo pieno di `../`.
    const { filePath } = pluginConFile('media', 'lib/nested/deep.json5', 'DEEP');

    const backupPath = backupManager.backupPluginFile('media', filePath);

    expect(backupPath).toBe(
      path.join(backupManager.pluginsBackupDir, 'media', 'lib', 'nested', 'deep.json5'),
    );
    expect(fs.readFileSync(backupPath, 'utf8')).toBe('DEEP');
    // E la copia è rimasta DENTRO lo snapshot, non è risalita fuori.
    expect(path.relative(backupManager.currentBackupDir, backupPath).startsWith('..')).toBe(false);
  });

  test('due plugin diversi non si mescolano', () => {
    const a = pluginConFile('primo', 'pluginConfig.json5', 'A');
    const b = pluginConFile('secondo', 'pluginConfig.json5', 'B');

    backupManager.backupPluginFile('primo', a.filePath);
    backupManager.backupPluginFile('secondo', b.filePath);

    expect(fs.readdirSync(backupManager.pluginsBackupDir).sort()).toEqual(['primo', 'secondo']);
    expect(fs.readFileSync(backupManager.getPluginBackupPath('primo') + '/pluginConfig.json5', 'utf8'))
      .toBe('A');
  });

  test('backupPluginFiles() salva un elenco e un file mancante non lo interrompe', () => {
    const { pluginDir, filePath } = pluginConFile('misto', 'esiste.json5', 'X');
    const mancante = path.join(pluginDir, 'non-esiste.json5');

    const cartella = backupManager.backupPluginFiles('misto', [filePath, mancante]);

    // Il contratto documentato è « restituisce il path della CARTELLA », non
    // l'elenco dei backup riusciti: chi chiama non ha modo di sapere quali file
    // sono stati saltati se non leggendo il log.
    expect(cartella).toBe(path.join(backupManager.pluginsBackupDir, 'misto'));
    // Il file esistente c'è, quello mancante no — e il warning lo dice.
    expect(fs.readdirSync(cartella)).toEqual(['esiste.json5']);
    expect(logger.warning).toHaveBeenCalled();
  });

  test('backupPluginFiles() con lista vuota o assente → null, senza creare nulla', () => {
    expect(backupManager.backupPluginFiles('vuoto', [])).toBeNull();
    expect(backupManager.backupPluginFiles('vuoto', null)).toBeNull();
    // Non deve nemmeno aver preparato lo snapshot: non c'era niente da salvare.
    expect(snapshotEsistenti()).toEqual([]);
  });

  test('file inesistente → null e un WARNING', () => {
    expect(backupManager.backupPluginFile('x', path.join(tmpDir, 'niente.json5'))).toBeNull();
    expect(logger.warning).toHaveBeenCalled();
  });
});

describe('restore() — il ritorno indietro, che è il senso di tutto', () => {
  test('round-trip: modifica, ripristino, il file torna com\'era', () => {
    // È l'unica verifica che conta davvero su questa classe: un backup vale
    // quanto il ripristino che permette.
    const originale = scrivi(path.join(tmpDir, 'ital8Config.json5'), '{ httpPort: 3000 }');
    const backupPath = backupManager.backupGlobalFile(originale);

    fs.writeFileSync(originale, '{ httpPort: 9999 }', 'utf8');
    backupManager.restore(backupPath, originale);

    expect(fs.readFileSync(originale, 'utf8')).toBe('{ httpPort: 3000 }');
    expect(logger.success).toHaveBeenCalled();
  });

  test('ripristina anche un file nel frattempo CANCELLATO', () => {
    // Il caso peggiore, ed è quello per cui il backup esiste.
    const originale = scrivi(path.join(tmpDir, 'perso.json5'), 'CONTENUTO');
    const backupPath = backupManager.backupGlobalFile(originale);

    fs.unlinkSync(originale);
    backupManager.restore(backupPath, originale);

    expect(fs.readFileSync(originale, 'utf8')).toBe('CONTENUTO');
  });

  test('backup inesistente → lancia, nominando il path', () => {
    // Qui il throw è giusto: chi chiama sta cercando di tornare indietro, e
    // fallire in silenzio gli farebbe credere di esserci riuscito.
    expect(() => backupManager.restore(path.join(tmpDir, 'mai.json5'), path.join(tmpDir, 'x')))
      .toThrow(/non trovato/i);
  });

  test('restorePlugin() ripristina l\'ALBERO, annidamenti compresi', () => {
    const pluginDir = path.join(pluginsRoot, 'media');
    const radice = scrivi(path.join(pluginDir, 'pluginConfig.json5'), 'RADICE');
    const annidato = scrivi(path.join(pluginDir, 'lib', 'deep.json5'), 'ANNIDATO');

    backupManager.backupPluginFiles('media', [radice, annidato]);

    fs.writeFileSync(radice, 'ROTTO', 'utf8');
    fs.rmSync(path.join(pluginDir, 'lib'), { recursive: true, force: true });

    backupManager.restorePlugin('media');

    expect(fs.readFileSync(radice, 'utf8')).toBe('RADICE');
    expect(fs.readFileSync(annidato, 'utf8')).toBe('ANNIDATO');
  });

  test('restorePlugin() su un plugin mai salvato → lancia', () => {
    expect(() => backupManager.restorePlugin('maiSalvato')).toThrow(/non trovato/i);
  });
});

describe('getItalianTimestamp() e i path dello snapshot', () => {
  test('formato DD-MM-YYYY_HH-MM-SS: adatto a un nome di cartella', () => {
    // Diverso da quello di StateManager (`DD/MM/YYYY HH:MM:SS`) per una ragione:
    // gli slash e i due punti non possono stare in un nome di file.
    const timestamp = backupManager.getItalianTimestamp();

    expect(timestamp).toMatch(/^\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}$/);
    expect(timestamp).not.toMatch(/[/:]/);
  });

  test('getBackupPath() restituisce un path RELATIVO alla radice del progetto', () => {
    // È documentato così, e serve a mostrare all'utente dove è finito il backup
    // senza stampargli un path assoluto lungo. Il punto di riferimento è la
    // radice del progetto, non `backupRoot`: con una radice in tmpdir la
    // risposta onesta è appunto un path che risale.
    //
    // NOTA sul seam: questi due metodi restano ancorati a `__dirname` perché il
    // loro punto di riferimento È il progetto. Non è una dimenticanza — spostarlo
    // renderebbe il path relativo a se stesso, cioè sempre `init-<timestamp>`,
    // perdendo l'informazione che il metodo esiste per dare.
    const relativo = backupManager.getBackupPath();

    expect(path.isAbsolute(relativo)).toBe(false);
    expect(path.resolve(path.join(__dirname, '../../..'), relativo))
      .toBe(backupManager.currentBackupDir);
  });

  test('getPluginBackupPath() punta alla cartella del plugin dentro lo snapshot', () => {
    expect(path.resolve(path.join(__dirname, '../../..'), backupManager.getPluginBackupPath('x')))
      .toBe(path.join(backupManager.pluginsBackupDir, 'x'));
  });
});
