// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Sweep su OGNI `migrations.json5` del repository: i path dichiarati in `touches`
 * devono risolvere dalla cartella del pacchetto.
 *
 * PERCHÉ ESISTE
 * -------------
 * `core/migrationRunner.js` risolve ogni `touches` con
 * `path.join(targetObj.packageDir, relative)`. Scrivere il path a partire dalla
 * radice del progetto — `"plugins/sentinel/sentinelRules.json5"` invece di
 * `"sentinelRules.json5"` — produce quindi `plugins/sentinel/plugins/sentinel/…`,
 * che non esiste. E il runner non protesta: fa `if (!fs.existsSync(full)) continue`.
 *
 * COSA SI PERDE, IN SILENZIO
 * --------------------------
 * `touches` guida **tre** meccanismi, non uno:
 *
 *   1. `backupTouchedFiles()` — il backup del file PRIMA che lo step lo modifichi.
 *      Con il path sbagliato la migrazione riscrive il config senza rete, e il CLI
 *      dichiara zero backup all'operatore.
 *   2. `alignTouchedSchemaVersions()` — l'allineamento della `schemaVersion` dei
 *      file secondari, che senza il path resta indietro.
 *   3. `protectedLivePaths` — l'esclusione dal merge additivo del boot, che
 *      altrimenti allineerebbe il file bruciando il trigger della migrazione.
 *
 * STORIA
 * ------
 * Trovato in v3.20.0 dalla review: **7 dichiarazioni su 8** avevano la forma
 * sbagliata (`sentinel` ×5, `adminSentinel`, `core/adminConfig`), e la migrazione
 * di `analytics` scritta in questa stessa branch era la quarta a ripetere
 * l'errore. Corretta la forma ovunque; questo file impedisce che torni.
 *
 * La forma giusta è quella che la documentazione mostra da sempre:
 * `docs/decisions/config-migrations.it.md` → `touches: ["pluginConfig.json5"]`.
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

const PROJECT_ROOT = path.join(__dirname, '../..');

/**
 * Trova ogni `migrations.json5` del repo e ne deduce il `packageDir`, con la
 * STESSA regola del runner:
 *   - plugin/tema → la cartella del pacchetto (`plugins/<nome>`);
 *   - core        → la cartella che ospita il config vivo, non la radice.
 *
 * @returns {Array<{label: string, indexPath: string, packageDir: string}>}
 */
function trovaIndiciMigrazione() {
  const trovati = [];

  for (const contenitore of ['plugins', 'themes']) {
    const dir = path.join(PROJECT_ROOT, contenitore);
    if (!fs.existsSync(dir)) continue;
    for (const nome of fs.readdirSync(dir)) {
      const indexPath = path.join(dir, nome, 'migrations', 'migrations.json5');
      if (!fs.existsSync(indexPath)) continue;
      trovati.push({ label: `${contenitore}/${nome}`, indexPath, packageDir: path.join(dir, nome) });
    }
  }

  // I tre config globali: il "pacchetto" è la cartella del vivo (migrationRunner.js
  // → makeCoreTarget). Tenerla in sincrono con quella mappa è il punto: se un
  // domani un core config cambiasse posizione, questo test lo direbbe.
  const CORE = {
    ital8Config: '',
    adminConfig: 'core/admin',
    koaSession: 'core/priorityMiddlewares',
  };
  for (const [nome, cartella] of Object.entries(CORE)) {
    const indexPath = path.join(PROJECT_ROOT, 'core/migrations', nome, 'migrations.json5');
    if (!fs.existsSync(indexPath)) continue;
    trovati.push({
      label: `core/${nome}`,
      indexPath,
      packageDir: path.join(PROJECT_ROOT, cartella),
    });
  }

  return trovati;
}

const indici = trovaIndiciMigrazione();

describe('migrations.json5 — i path di `touches` risolvono dalla cartella del pacchetto', () => {
  test('il repository ha almeno un indice di migrazione da controllare', () => {
    // Senza questo, uno sweep che non trova niente passerebbe dicendo « tutto a
    // posto »: è la forma di test verde che non verifica nulla.
    expect(indici.length).toBeGreaterThan(0);
  });

  test.each(indici.map((i) => [i.label, i]))('%s', (_label, indice) => {
    const contenuto = loadJson5(indice.indexPath);
    expect(Array.isArray(contenuto.steps)).toBe(true);

    for (const step of contenuto.steps) {
      expect(Array.isArray(step.touches)).toBe(true);
      expect(step.touches.length).toBeGreaterThan(0);

      for (const relative of step.touches) {
        // Mai assoluto: il runner lo concatenerebbe comunque a packageDir.
        expect(path.isAbsolute(relative)).toBe(false);

        // Il controllo che conta: risolto come fa il runner, il file deve esistere.
        const risolto = path.join(indice.packageDir, relative);
        expect({
          step: `v${step.from}→v${step.to}`,
          touches: relative,
          esiste: fs.existsSync(risolto),
        }).toEqual({
          step: `v${step.from}→v${step.to}`,
          touches: relative,
          esiste: true,
        });
      }
    }
  });
});

describe('la forma sbagliata è riconoscibile a colpo d\'occhio', () => {
  test('nessun `touches` comincia con il nome di un contenitore', () => {
    // La forma sbagliata ha un profilo preciso: comincia con `plugins/`, `themes/`
    // o `core/`, cioè ripete un pezzo di path che il runner aggiunge già. Il test
    // sopra la coglierebbe comunque (il file non esisterebbe), ma questo dice
    // *quale* errore è stato fatto invece di limitarsi a « non trovato ».
    for (const indice of indici) {
      for (const step of loadJson5(indice.indexPath).steps) {
        for (const relative of step.touches) {
          expect(relative).not.toMatch(/^(plugins|themes|core)\//);
        }
      }
    }
  });
});
