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
    // Si asserisce sulle DUE righe che facevano la riscrittura — il temp e il
    // rename del file intero — e non sulla stringa `JSON.stringify(newConfig)`:
    // quella compare ancora nel commento che spiega il difetto, e un presidio
    // che cade su un commento è un presidio che insegna a cancellare i commenti.
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/fs\.writeFileSync\(tempPath/);
    expect(src).not.toMatch(/fs\.renameSync\(tempPath, configPath\)/);
  });

  test('scrive per chiave con setJson5Key', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/core\/setJson5Key['"]\)/);
    expect(src).toMatch(/await setJson5Key\(configPath, keyPath, value\)/);
  });
});
