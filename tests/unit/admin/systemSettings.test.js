/**
 * Unit test: il salvataggio da System Settings × REVIEW.md → B3.
 *
 * Il difetto: `updateSystemConfig` faceva `JSON.stringify(newConfig)`, cioè
 * RIMPIAZZAVA `ital8Config.json5` con l'oggetto arrivato dal form. Due
 * conseguenze, entrambe osservate su un'installazione reale:
 *
 *   1. i commenti sparivano — misurato: da 214 righe a ZERO;
 *   2. ogni chiave che il form non conosce veniva CANCELLATA, e il messaggio
 *      diceva « riavvia il server », che era il momento in cui l'installazione
 *      moriva.
 *
 * `diffLeaves` è il pezzo che rende impossibile la cancellazione per omissione:
 * confronta solo le chiavi PRESENTI nell'oggetto proposto, quindi una chiave che
 * il form non nomina non entra nemmeno nell'elenco delle modifiche.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const loadJson5 = require('../../../core/loadJson5');
const setJson5Key = require('../../../core/setJson5Key');
const { diffLeaves } = require('../../../plugins/admin/systemSettings');

// ── diffLeaves ───────────────────────────────────────────────────────────────

describe('diffLeaves — la cancellazione per omissione è impossibile', () => {
  const current = {
    httpPort: 3000,
    debugMode: 1,
    https: { enabled: false, port: 3443, tlsOptions: {} },
    securityHeaders: { admin: { frameOptions: 'DENY' } },
    globalFunctionsWhitelist: { __: { plugin: 'simpleI18n' } },
  };

  test('una chiave che il form NON nomina non compare fra le modifiche', () => {
    // È il caso che rompeva il boot: il form manda una ventina di chiavi, il
    // file ne ha molte di più.
    const changed = diffLeaves(current, { httpPort: 3001 });

    expect(changed).toEqual([{ keyPath: ['httpPort'], value: 3001 }]);
    expect(JSON.stringify(changed)).not.toContain('securityHeaders');
    expect(JSON.stringify(changed)).not.toContain('globalFunctionsWhitelist');
  });

  test('un valore identico non produce una scrittura', () => {
    expect(diffLeaves(current, { httpPort: 3000, debugMode: 1 })).toEqual([]);
  });

  test('scende negli oggetti annidati e riporta il PATH della foglia', () => {
    const changed = diffLeaves(current, { https: { enabled: true, port: 3443 } });
    expect(changed).toEqual([{ keyPath: ['https', 'enabled'], value: true }]);
  });

  test('una chiave nuova (assente dal config attuale) viene riportata', () => {
    const changed = diffLeaves(current, { nuovaChiave: 'x' });
    expect(changed).toEqual([{ keyPath: ['nuovaChiave'], value: 'x' }]);
  });

  test('gli array sono valori: si sostituiscono per intero, non si fondono', () => {
    const changed = diffLeaves({ lista: [1, 2, 3] }, { lista: [9] });
    expect(changed).toEqual([{ keyPath: ['lista'], value: [9] }]);
  });

  test('un oggetto dove prima c\'era uno scalare è una foglia, non una discesa', () => {
    const changed = diffLeaves({ x: 5 }, { x: { a: 1 } });
    expect(changed).toEqual([{ keyPath: ['x'], value: { a: 1 } }]);
  });
});

// ── L'effetto sul file vero ──────────────────────────────────────────────────

describe('la scrittura chirurgica sul file di configurazione DISTRIBUITO', () => {
  // Si parte dal `.default` realmente spedito, non da un finto: il difetto
  // riguardava i commenti e le chiavi di QUEL file.
  const DEFAULT_CONFIG = path.join(__dirname, '../../../ital8Config.default.json5');
  let copia;

  beforeEach(() => {
    copia = path.join(os.tmpdir(), `b3-${Date.now()}-${Math.random().toString(36).slice(2)}.json5`);
    fs.copyFileSync(DEFAULT_CONFIG, copia);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    try { fs.rmSync(copia, { force: true }); } catch (_) {}
  });

  const contaCommenti = (file) =>
    fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().startsWith('//')).length;

  test('i commenti sopravvivono a un salvataggio', async () => {
    const prima = contaCommenti(copia);
    expect(prima).toBeGreaterThan(100);           // il file spedito ne ha ~214

    for (const { keyPath, value } of diffLeaves(loadJson5(copia), { httpPort: 3001, debugMode: 0 })) {
      await setJson5Key(copia, keyPath, value);
    }

    expect(contaCommenti(copia)).toBe(prima);
  });

  test('le chiavi che il form non nomina restano al loro posto', async () => {
    const chiaviPrima = Object.keys(loadJson5(copia)).sort();

    // Un form che conosce solo la porta.
    for (const { keyPath, value } of diffLeaves(loadJson5(copia), { httpPort: 3001 })) {
      await setJson5Key(copia, keyPath, value);
    }

    const dopo = loadJson5(copia);
    expect(Object.keys(dopo).sort()).toEqual(chiaviPrima);
    expect(dopo.httpPort).toBe(3001);
    // Le chiavi che il boot legge e che il form non conosce.
    expect(dopo.securityHeaders).toBeDefined();
    expect(dopo.globalFunctionsWhitelist).toBeDefined();
    expect(dopo.cli).toBeDefined();
  });

  test('una chiave annidata si modifica senza toccare le sorelle', async () => {
    const httpsPrima = loadJson5(copia).https;

    for (const { keyPath, value } of diffLeaves(loadJson5(copia), { https: { port: 8443 } })) {
      await setJson5Key(copia, keyPath, value);
    }

    const httpsDopo = loadJson5(copia).https;
    expect(httpsDopo.port).toBe(8443);
    expect(httpsDopo.certFile).toBe(httpsPrima.certFile);
    expect(httpsDopo.acmeChallenge).toEqual(httpsPrima.acmeChallenge);
  });

  test('il file resta parsabile e il boot ritroverebbe tutto', async () => {
    for (const { keyPath, value } of diffLeaves(loadJson5(copia), { httpPort: 3001, enableAdmin: false })) {
      await setJson5Key(copia, keyPath, value);
    }

    const dopo = loadJson5(copia);
    expect(dopo.schemaVersion).toBeDefined();
    expect(dopo.enableAdmin).toBe(false);
    expect(dopo.priorityMiddlewares).toBeDefined();
  });
});

// ── Presidio strutturale ─────────────────────────────────────────────────────

describe('updateSystemConfig usa davvero la scrittura chirurgica', () => {
  // I test qui sopra verificano il MECCANISMO (diffLeaves + setJson5Key). Questo
  // verifica che l'handler lo adoperi: senza, una regressione che tornasse a
  // riscrivere il file intero passerebbe inosservata.
  const SRC = path.join(__dirname, '../../../plugins/admin/systemSettings.js');

  test('non riscrive più il file intero', () => {
    // ⚠️ Questo presidio asseriva l'ASSENZA di `fs.renameSync(tempPath, configPath)`,
    // cioè la forma della riscrittura totale. Dalla v3.51.0 un temp + rename c'è
    // di nuovo, ma per la ragione opposta: le chiavi si applicano a una COPIA che
    // prende il posto dell'originale solo se TUTTE riescono (prima un errore a
    // metà lasciava il config a metà). Quindi l'invariante da presidiare non è
    // « nessun rename » ma « nessuna serializzazione dell'oggetto intero ».
    const src = fs.readFileSync(SRC, 'utf8');
    const codice = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((r) => !r.trim().startsWith('//') && !r.trim().startsWith('*')).join('\n');

    expect(codice).not.toMatch(/JSON\.stringify\(\s*newConfig/);
    expect(codice).not.toMatch(/fs\.writeFileSync\(\s*(?:tempPath|configPath)\s*,\s*configContent/);
  });

  test('applica le chiavi a una COPIA e scambia in modo atomico', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toMatch(/fs\.copyFileSync\(configPath, tempPath\)/);
    expect(src).toMatch(/await setJson5Key\(tempPath, keyPath, value\)/);
    expect(src).toMatch(/fs\.renameSync\(tempPath, configPath\)/);
  });

  test('scrive per chiave con setJson5Key', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/core\/setJson5Key['"]\)/);
    expect(src).toMatch(/setJson5Key\([a-zA-Z]+, keyPath, value\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La scrittura è TUTTO-O-NIENTE (review della v3.51.0)
//
// Il ciclo per-foglia scriveva in posto: un errore a metà — un `setJson5Key`
// che non trova il path, un disco pieno — lasciava alcune chiavi scritte e
// altre no, rispondeva con un errore generico e non restituiva nemmeno il
// `backupPath`, cioè non diceva dove recuperare. Una configurazione a metà è
// peggio di una modifica rifiutata.
// ─────────────────────────────────────────────────────────────────────────────

describe('un guasto a metà non lascia il config a metà', () => {
  const VIVO = path.join(__dirname, '../../../ital8Config.json5');
  let salvataggio;

  beforeEach(() => {
    salvataggio = fs.readFileSync(VIVO, 'utf8');
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.writeFileSync(VIVO, salvataggio, 'utf8');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('il file resta identico se una scrittura fallisce a metà', async () => {
    const prima = fs.readFileSync(VIVO, 'utf8');

    // `setJson5Key` fallisce dalla SECONDA chiave: la prima è già applicata
    // sulla copia, quindi senza lo scambio atomico il file resterebbe a metà.
    let chiamate = 0;
    jest.doMock('../../../core/setJson5Key', () => async (...args) => {
      chiamate += 1;
      if (chiamate > 1) throw new Error('disco pieno (simulato)');
      return jest.requireActual('../../../core/setJson5Key')(...args);
    });

    const { updateSystemConfig } = require('../../../plugins/admin/systemSettings');
    const config = loadJson5(VIVO);

    const esito = await updateSystemConfig({
      ...config,
      httpPort: 3999,
      debugMode: config.debugMode === 1 ? 0 : 1,
    });

    expect(chiamate).toBeGreaterThan(1);                 // il guasto è scattato
    expect(esito.success).toBe(false);
    expect(esito.error).toMatch(/annullata/i);
    expect(esito.backupPath).toBeDefined();              // dice DOVE recuperare
    expect(fs.readFileSync(VIVO, 'utf8')).toBe(prima);   // e il file non è cambiato
  });

  test('nessun file temporaneo resta in giro dopo un fallimento', () => {
    expect(fs.existsSync(`${VIVO}.applying`)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// La cucitura fra le due metà della stessa sezione.
//
// La GUI di System Settings è un editor: carica il config con getSystemConfig()
// e rimanda al salvataggio esattamente ciò che ha caricato. Le due metà devono
// quindi parlare della STESSA forma. Non lo facevano: validateSystemConfig()
// pretendeva `useHttps` / `httpsPort` / `AutoRedirectHttpPortToHttpsPort`, nomi
// piatti della struttura precedente al blocco `https` annidato. Conseguenza
// misurata: ogni salvataggio rispondeva "Campo obbligatorio mancante" e la
// sezione era inutilizzabile — difetto a suite verde, perché i test esistenti
// chiamavano il validatore con payload scritti a mano nella forma che si
// aspettava, mai con il config reale.
// ──────────────────────────────────────────────────────────────────────────────
describe('le due metà della sezione parlano della stessa forma', () => {
  const DEFAULT = path.join(__dirname, '../../../ital8Config.default.json5');

  test('il config che la GUI carica è un config che la GUI può salvare', () => {
    const { getSystemConfig, validateSystemConfig } = require('../../../plugins/admin/systemSettings');

    const caricato = getSystemConfig();
    expect(caricato.success).toBe(true);

    const esito = validateSystemConfig(caricato.config);
    expect(esito.errors).toEqual([]);
    expect(esito.valid).toBe(true);
  });

  test('ogni campo obbligatorio esiste davvero nel config spedito', () => {
    const { validateSystemConfig } = require('../../../plugins/admin/systemSettings');
    const spedito = loadJson5(DEFAULT);

    // Si ricava la lista degli obbligatori dal validatore stesso: gli si passa
    // un oggetto vuoto e si leggono i nomi che reclama. Così il presidio non
    // duplica la lista — se qualcuno ne aggiunge uno inesistente, qui diventa
    // rosso senza che nessuno si ricordi di aggiornare il test.
    const reclamati = validateSystemConfig({}).errors
      .map((riga) => /Campo obbligatorio mancante: "(.+)"/.exec(riga))
      .filter(Boolean)
      .map((m) => m[1]);

    expect(reclamati.length).toBeGreaterThan(5);

    const inesistenti = reclamati.filter((campo) => !(campo in spedito));
    expect(inesistenti).toEqual([]);
  });

  test('i tipi sbagliati dentro il blocco https vengono ancora colti', () => {
    const { getSystemConfig, validateSystemConfig } = require('../../../plugins/admin/systemSettings');
    const base = getSystemConfig().config;

    const casi = [
      [{ enabled: 'si' }, /https\.enabled/],
      [{ port: 99999 }, /https\.port/],
      [{ port: 0 }, /https\.port/],
      [{ AutoRedirectHttpPortToHttpsPort: 1 }, /AutoRedirect/],
    ];

    for (const [patch, atteso] of casi) {
      const esito = validateSystemConfig({ ...base, https: { ...base.https, ...patch } });
      expect(esito.valid).toBe(false);
      expect(esito.errors.join(' ')).toMatch(atteso);
    }

    // porta non configurata: stringa vuota resta lecita
    expect(validateSystemConfig({ ...base, https: { ...base.https, port: '' } }).valid).toBe(true);

    // il blocco deve esserci, e deve essere un oggetto
    const senzaHttps = { ...base };
    delete senzaHttps.https;
    expect(validateSystemConfig(senzaHttps).valid).toBe(false);
    expect(validateSystemConfig({ ...base, https: 'x' }).valid).toBe(false);
    expect(validateSystemConfig({ ...base, https: [] }).valid).toBe(false);
  });
});
