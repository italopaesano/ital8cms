// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per scripts/lib/PluginScanner — chi decide QUALI plugin si inizializzano,
 * e in che ordine.
 *
 * PERCHÉ CONTA
 * ------------
 * Un plugin viene inizializzato solo se lo scanner lo trova; e se l'ordine
 * topologico sbaglia, un `init.js` gira **prima** della dipendenza da cui dipende.
 * Nel caso concreto del progetto: se un plugin che vuole un ruolo custom girasse
 * prima di `adminUsers`, il ruolo non esisterebbe ancora.
 *
 * L'ordinamento è una `sortByDependencies()` **pura** — riceve un array e ne
 * restituisce un altro — quindi era già testabile senza toccare il disco.
 * `scanPlugins()` invece cablava `plugins/` sul repository: il seam aggiunto in
 * v3.7.0 (parametro opzionale col default invariato, come `pluginsRootPath` in
 * `core/pluginSys.js`, v2.98.0) permette di scandire un albero di prova.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PluginScanner = require('../../../scripts/lib/pluginScanner');

const PLUGINS_VIVO = path.join(__dirname, '../../../plugins');

let tmpDir;
let pluginsDir;
let logger;
let scanner;

const makeLogger = () => ({
  separator: jest.fn(), info: jest.fn(), warning: jest.fn(),
  success: jest.fn(), error: jest.fn(),
});

/**
 * Costruisce un plugin di prova nell'albero temporaneo.
 *
 * @param {string} nome
 * @param {object} [opzioni]
 * @param {boolean} [opzioni.conInit=true] - se creare `scripts/init.js`
 * @param {string[]} [opzioni.initDependencies]
 * @param {number} [opzioni.active=1]
 * @param {string} [opzioni.description]
 * @param {boolean} [opzioni.configRotto] - scrive un pluginConfig.json5 illeggibile
 */
function creaPlugin(nome, opzioni = {}) {
  const {
    conInit = true, initDependencies, active = 1, description, configRotto = false,
  } = opzioni;

  const dir = path.join(pluginsDir, nome);
  fs.mkdirSync(dir, { recursive: true });

  if (conInit) {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'init.js'), 'module.exports = {}\n', 'utf8');
  }

  const config = { active };
  if (initDependencies) config.initDependencies = initDependencies;
  fs.writeFileSync(
    path.join(dir, 'pluginConfig.json5'),
    configRotto ? '{ questo non è json5 :::' : `// config\n${JSON.stringify(config, null, 2)}`,
    'utf8',
  );

  if (description !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'pluginDescription.json5'),
      `// desc\n${JSON.stringify({ description }, null, 2)}`,
      'utf8',
    );
  }
  return dir;
}

/** Solo i nomi, nell'ordine restituito: è l'unica cosa che conta nei test d'ordine. */
const nomi = (plugins) => plugins.map((p) => p.name);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluginScanner-'));
  pluginsDir = path.join(tmpDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  logger = makeLogger();
  scanner = new PluginScanner(logger, pluginsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('il seam introdotto in v3.7.0', () => {
  test('senza secondo argomento punta alla cartella plugins del progetto', () => {
    expect(new PluginScanner(makeLogger()).pluginsDir).toBe(path.resolve(PLUGINS_VIVO));
  });

  test('con il secondo argomento scandisce SOLO quell\'albero', () => {
    creaPlugin('soloQui');
    expect(nomi(scanner.scanPlugins())).toEqual(['soloQui']);
  });
});

describe('scanPlugins() — chi entra e chi no', () => {
  test('trova solo i plugin che hanno scripts/init.js', () => {
    // È il criterio: un plugin senza init non ha niente da inizializzare, e
    // includerlo lo farebbe comparire in un elenco su cui il wizard poi si ferma.
    creaPlugin('conInit', { conInit: true });
    creaPlugin('senzaInit', { conInit: false });

    expect(nomi(scanner.scanPlugins())).toEqual(['conInit']);
  });

  test('i file sciolti dentro plugins/ non vengono scambiati per plugin', () => {
    // Il repo vero ne ha (`plugins/EXPLAIN.md`): trattarli come cartelle
    // farebbe fallire la lettura invece di ignorarli.
    creaPlugin('vero');
    fs.writeFileSync(path.join(pluginsDir, 'EXPLAIN.md'), '# doc\n', 'utf8');

    expect(nomi(scanner.scanPlugins())).toEqual(['vero']);
  });

  test('un symlink ROTTO viene ignorato invece di far crashare il wizard', () => {
    // `statSync` segue il link: senza `throwIfNoEntry: false` sarebbe un ENOENT
    // che interrompe l'installazione. Il commento nel codice lo dichiara, e qui
    // si verifica che sia vero.
    creaPlugin('vero');
    fs.symlinkSync(path.join(tmpDir, 'destinazione-inesistente'), path.join(pluginsDir, 'rotto'));

    expect(() => scanner.scanPlugins()).not.toThrow();
    expect(nomi(scanner.scanPlugins())).toEqual(['vero']);
  });

  test('cartella plugins inesistente → array vuoto e un warning, non un throw', () => {
    const orfano = new PluginScanner(logger, path.join(tmpDir, 'non-esiste'));

    expect(orfano.scanPlugins()).toEqual([]);
    expect(logger.warning).toHaveBeenCalled();
  });

  test('nessun plugin → array vuoto, mai undefined', () => {
    // Chi chiama itera il risultato: un `undefined` sarebbe un crash a valle.
    expect(scanner.scanPlugins()).toEqual([]);
  });
});

describe('scanPlugins() — i metadati letti da ogni plugin', () => {
  test('riporta nome, path e path dell\'init script', () => {
    const dir = creaPlugin('mio');
    const [plugin] = scanner.scanPlugins();

    expect(plugin).toMatchObject({
      name: 'mio',
      path: dir,
      initScriptPath: path.join(dir, 'scripts', 'init.js'),
    });
  });

  test('`active` è vero SOLO con il NUMERO 1', () => {
    // Il confronto nel codice è `=== 1`. Verificarlo con i soli `1` e `0`
    // passerebbe anche con un `!!pluginConfig.active`, cioè per il motivo
    // sbagliato: i casi che distinguono i due sono `true`, `'1'` e `2`, ed è
    // proprio da un config scritto a mano che arrivano.
    creaPlugin('uno', { active: 1 });
    creaPlugin('zero', { active: 0 });
    creaPlugin('booleano', { active: true });
    creaPlugin('stringa', { active: '1' });
    creaPlugin('due', { active: 2 });

    const perNome = Object.fromEntries(scanner.scanPlugins().map((p) => [p.name, p.active]));
    expect(perNome).toEqual({
      uno: true,
      zero: false,
      booleano: false,
      stringa: false,
      due: false,
    });
  });

  test('le dipendenze assenti diventano un array vuoto, non undefined', () => {
    creaPlugin('senzaDeps');
    expect(scanner.scanPlugins()[0].dependencies).toEqual([]);
  });

  test('description assente → testo di fallback, mai undefined', () => {
    // Finisce a schermo nel wizard: un « undefined » stampato sarebbe un difetto
    // visibile a chi installa.
    creaPlugin('senzaDesc');
    expect(scanner.scanPlugins()[0].description).toBe('Nessuna descrizione disponibile');
  });

  test('description presente viene usata', () => {
    creaPlugin('conDesc', { description: 'Gestione utenti' });
    expect(scanner.scanPlugins()[0].description).toBe('Gestione utenti');
  });

  test('un pluginConfig CORROTTO non esclude il plugin: warning e default', () => {
    // Scelta difendibile e da fissare: il plugin ha un `init.js`, quindi va
    // proposto lo stesso; ciò che non si è potuto leggere prende i default.
    creaPlugin('rotto', { configRotto: true });

    const [plugin] = scanner.scanPlugins();
    expect(plugin.name).toBe('rotto');
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.active).toBe(false); // `active === 1` è falso su un config vuoto
    expect(logger.warning).toHaveBeenCalled();
  });
});

describe('sortByDependencies() — l\'ordine di inizializzazione', () => {
  /** Costruisce l'oggetto plugin minimo che l'ordinamento richiede. */
  const p = (name, dependencies = []) => ({ name, dependencies });

  test('una dipendenza viene PRIMA di chi la richiede', () => {
    const ordinati = nomi(scanner.sortByDependencies([p('figlio', ['padre']), p('padre')]));
    expect(ordinati).toEqual(['padre', 'figlio']);
  });

  test('una catena a tre viene srotolata per intero', () => {
    const ordinati = nomi(scanner.sortByDependencies([
      p('terzo', ['secondo']), p('primo'), p('secondo', ['primo']),
    ]));
    expect(ordinati).toEqual(['primo', 'secondo', 'terzo']);
  });

  test('un diamante non duplica la dipendenza condivisa', () => {
    //     base
    //     /  \
    //    a    b
    //     \  /
    //     alto
    const ordinati = nomi(scanner.sortByDependencies([
      p('alto', ['a', 'b']), p('a', ['base']), p('b', ['base']), p('base'),
    ]));

    expect(ordinati.length).toBe(4);
    expect(new Set(ordinati).size).toBe(4); // nessun doppione
    expect(ordinati.indexOf('base')).toBeLessThan(ordinati.indexOf('a'));
    expect(ordinati.indexOf('a')).toBeLessThan(ordinati.indexOf('alto'));
    expect(ordinati.indexOf('b')).toBeLessThan(ordinati.indexOf('alto'));
  });

  test('una dipendenza circolare LANCIA, nominandola', () => {
    // Il ciclo non ha un ordine valido: proseguire significherebbe scegliere a
    // caso quale plugin inizializzare per primo.
    expect(() => scanner.sortByDependencies([p('a', ['b']), p('b', ['a'])]))
      .toThrow(/circolare/i);
  });

  test('un auto-riferimento è un ciclo', () => {
    expect(() => scanner.sortByDependencies([p('solo', ['solo'])])).toThrow(/circolare/i);
  });

  test('una dipendenza SENZA init script viene semplicemente saltata', () => {
    // È il caso normale: `bootstrap` può essere una dipendenza dichiarata pur
    // non avendo nulla da inizializzare. Non deve far fallire l'ordinamento.
    const ordinati = nomi(scanner.sortByDependencies([p('mio', ['bootstrap'])]));
    expect(ordinati).toEqual(['mio']);
  });

  test('nessuna dipendenza → l\'ordine d\'ingresso è preservato', () => {
    const ordinati = nomi(scanner.sortByDependencies([p('c'), p('a'), p('b')]));
    expect(ordinati).toEqual(['c', 'a', 'b']);
  });

  test('array vuoto → array vuoto', () => {
    expect(scanner.sortByDependencies([])).toEqual([]);
  });
});

describe('getPluginsForInit() — scansione e ordinamento insieme', () => {
  test('restituisce i plugin trovati, ordinati per dipendenza', () => {
    creaPlugin('figlio', { initDependencies: ['padre'] });
    creaPlugin('padre');

    expect(nomi(scanner.getPluginsForInit())).toEqual(['padre', 'figlio']);
  });

  test('nessun plugin → array vuoto e un messaggio, senza ordinare nulla', () => {
    expect(scanner.getPluginsForInit()).toEqual([]);
    expect(logger.info).toHaveBeenCalled();
  });

  test('un ciclo viene RILANCIATO dopo essere stato loggato', () => {
    // Il wizard deve fermarsi: un ordine arbitrario è peggio di un errore.
    creaPlugin('a', { initDependencies: ['b'] });
    creaPlugin('b', { initDependencies: ['a'] });

    expect(() => scanner.getPluginsForInit()).toThrow(/circolare/i);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('checkDependencies() — le dipendenze sono già inizializzate?', () => {
  /** StateManager fittizio: conta solo `isPluginInitialized`. */
  const stateManagerCon = (inizializzati) => ({
    isPluginInitialized: (nome) => inizializzati.includes(nome),
  });

  test('tutte soddisfatte → satisfied con missing vuoto', () => {
    const esito = scanner.checkDependencies(
      { name: 'mio', dependencies: ['a', 'b'] },
      stateManagerCon(['a', 'b']),
    );
    expect(esito).toEqual({ satisfied: true, missing: [] });
  });

  test('elenca SOLO quelle mancanti, non tutte', () => {
    // Il wizard mostra `missing` a chi installa: elencare anche quelle presenti
    // manderebbe a cercare un problema che non c'è.
    const esito = scanner.checkDependencies(
      { name: 'mio', dependencies: ['presente', 'assente'] },
      stateManagerCon(['presente']),
    );
    expect(esito).toEqual({ satisfied: false, missing: ['assente'] });
  });

  test('nessuna dipendenza → soddisfatte per definizione', () => {
    expect(scanner.checkDependencies({ name: 'mio', dependencies: [] }, stateManagerCon([])))
      .toEqual({ satisfied: true, missing: [] });
  });
});
