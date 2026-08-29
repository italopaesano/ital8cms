// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/analytics/migrations/from-v1-to-v2.js — il passaggio di
 * `weight` da 5 a -8.
 *
 * PERCHÉ ESISTE QUESTO FILE
 * -------------------------
 * Lo script era stato scritto, documentato e committato **senza essere mai
 * eseguito**. La review della branch ha trovato che il ramo più delicato — quello
 * che deve *proteggere* un weight scelto dall'amministratore — chiamava
 * `logger.warning()`, che non esiste: il logger core espone `debug/info/warn/error`.
 *
 * L'effetto, riprodotto prima di correggere: `TypeError: logger.warning is not a
 * function`. Il runner cattura l'errore, ferma la catena, e la `schemaVersion`
 * **non avanza mai** — quindi il box `[MIGRATE]` avrebbe insistito a ogni boot su
 * un passo che non poteva riuscire, e la spiegazione che serviva all'amministratore
 * non sarebbe mai comparsa.
 *
 * Uno script di migrazione gira una volta sola, su installazioni che non sono la
 * tua, e proprio per questo va esercitato prima. Questi test lo fanno su una
 * COPIA in tmpdir: il `pluginConfig.json5` vero non viene mai toccato — e c'è un
 * `afterAll` col digest che lo verifica invece di prometterlo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const logger = require('../../../../core/logger');
const loadJson5 = require('../../../../core/loadJson5');
const { migrate, OLD_WEIGHT, NEW_WEIGHT } = require('../../migrations/from-v1-to-v2');

const CONFIG_VIVO = path.join(__dirname, '../../pluginConfig.json5');
const digest = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

let tmpDir;
let digestVivoIniziale;

/** Config di prova col weight indicato, nella forma multi-riga dei config veri. */
const scriviConfig = (weight) => {
  const contenuto = `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "schemaVersion": 1,
  "active": 1,

  // Un commento che deve sopravvivere alla migrazione.
  "weight": ${weight},

  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {
    "enabled": true,
  },
}
`;
  fs.writeFileSync(path.join(tmpDir, 'pluginConfig.json5'), contenuto, 'utf8');
};

beforeAll(() => { digestVivoIniziale = digest(CONFIG_VIVO); });

afterAll(() => {
  // Isolamento verificato, non promesso: questa migrazione RISCRIVE un config, e
  // un test che sbagliasse path modificherebbe il plugin del repository.
  expect(digest(CONFIG_VIVO)).toBe(digestVivoIniziale);
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyticsMigr-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('il caso normale: weight 5 → -8', () => {
  test('scrive il valore nuovo', async () => {
    scriviConfig(OLD_WEIGHT);

    await migrate({ packageDir: tmpDir, logger, dryRun: false });

    expect(loadJson5(path.join(tmpDir, 'pluginConfig.json5')).weight).toBe(NEW_WEIGHT);
  });

  test('non tocca il resto del config, commenti inclusi', async () => {
    // Usa `editJson5`, non un `saveJson5` dell'oggetto intero: la differenza è
    // esattamente quella della decisione D1.
    scriviConfig(OLD_WEIGHT);

    await migrate({ packageDir: tmpDir, logger, dryRun: false });

    const testo = fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8');
    expect(testo).toContain('// Un commento che deve sopravvivere alla migrazione.');
    expect(testo).toMatch(/^\/\/ This file follows/);
    expect(loadJson5(path.join(tmpDir, 'pluginConfig.json5')).custom).toEqual({ enabled: true });
  });

  test('è idempotente: eseguita due volte, la seconda non trova nulla da fare', async () => {
    scriviConfig(OLD_WEIGHT);

    await migrate({ packageDir: tmpDir, logger, dryRun: false });
    const dopoUno = fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8');
    await migrate({ packageDir: tmpDir, logger, dryRun: false });

    expect(fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8')).toBe(dopoUno);
  });

  test('in dry-run non scrive niente', async () => {
    // Se il dry-run mentisse, l'anteprima che l'operatore usa per decidere
    // sarebbe peggio che inutile.
    scriviConfig(OLD_WEIGHT);
    const prima = fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8');

    await migrate({ packageDir: tmpDir, logger, dryRun: true });

    expect(fs.readFileSync(path.join(tmpDir, 'pluginConfig.json5'), 'utf8')).toBe(prima);
  });
});

describe('il ramo che protegge la scelta dell\'amministratore', () => {
  // ERA IL DIFETTO. Questo ramo chiamava `logger.warning()`, che non esiste:
  // lanciava un TypeError proprio dove doveva essere prudente.

  test.each([3, 0, -20, 7])('weight personalizzato (%i) → NON viene modificato', async (weight) => {
    scriviConfig(weight);

    await migrate({ packageDir: tmpDir, logger, dryRun: false });

    expect(loadJson5(path.join(tmpDir, 'pluginConfig.json5')).weight).toBe(weight);
  });

  test('NON lancia: il logger usato deve esistere davvero', async () => {
    // Il test che avrebbe intercettato il difetto. Usa il logger CORE vero, non
    // un finto: un mock con un metodo `warning` avrebbe fatto passare il bug.
    scriviConfig(3);

    await expect(migrate({ packageDir: tmpDir, logger, dryRun: false })).resolves.not.toThrow();
  });

  test('il logger core non espone `warning` — è il motivo del difetto', () => {
    // Fissa la premessa: se un domani il logger acquisisse `warning`, questo test
    // lo direbbe, invece di lasciare in piedi un vincolo diventato inutile.
    expect(typeof logger.warn).toBe('function');
    expect(logger.warning).toBeUndefined();
  });

  test('lo script non usa metodi che il logger non ha', () => {
    // Sweep sul sorgente: coglie anche i rami che questi test non attraversano.
    const sorgente = fs.readFileSync(
      path.join(__dirname, '../../migrations/from-v1-to-v2.js'), 'utf8');

    const metodiUsati = [...sorgente.matchAll(/\blogger\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(metodiUsati.length).toBeGreaterThan(0);
    for (const metodo of new Set(metodiUsati)) {
      expect(typeof logger[metodo]).toBe('function');
    }
  });
});

describe('il contratto con il runner', () => {
  test('`touches` è relativo alla cartella del pacchetto', () => {
    // Il runner fa `path.join(packageDir, relative)`. Scritto come
    // "plugins/analytics/pluginConfig.json5" risolveva in
    // plugins/analytics/plugins/analytics/..., quindi il backup pre-step veniva
    // saltato in silenzio: la migrazione riscriveva il config senza rete.
    const indice = loadJson5(path.join(__dirname, '../../migrations/migrations.json5'));

    for (const step of indice.steps) {
      for (const relative of step.touches) {
        expect(path.isAbsolute(relative)).toBe(false);
        // Deve esistere risolto dalla cartella del plugin, non da quella del progetto.
        expect(fs.existsSync(path.join(__dirname, '../..', relative))).toBe(true);
      }
    }
  });

  test('un config senza il file non fa esplodere lo script in modo opaco', async () => {
    // tmpDir è vuoto: loadJson5 rilancia con un messaggio che nomina il file.
    await expect(migrate({ packageDir: tmpDir, logger, dryRun: false }))
      .rejects.toThrow(/non trovato/i);
  });
});
