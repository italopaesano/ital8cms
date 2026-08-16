/**
 * migrationsChain.test.js
 *
 * La catena dichiarata in `migrations/migrations.json5` deve coprire per intero
 * il salto dalla v1 alla `schemaVersion` corrente del descrittore.
 *
 * ─── PERCHE ESISTE ANCHE QUI ──────────────────────────────────────────────────
 * È il gemello del test omonimo di `sentinel`, nato là da un difetto vero: due
 * bump di `schemaVersion` senza step dichiarato, perché il merge additivo del
 * boot bastava. Ma il runner non guarda se serva uno script, guarda se la catena
 * COPRE IL SALTO (`pending.length === target - liveVersion`): con il descrittore
 * avanti e gli step indietro, ogni installazione riceveva un box `[MIGRATE]` di
 * errore a ogni avvio che nulla poteva chiudere.
 *
 * `adminSentinel` ha appena dichiarato la sua prima migrazione — v1→v2, cache del
 * riepilogo — quindi eredita da subito lo stesso modo di sbagliare. Il difetto è
 * invisibile a mano (bisogna confrontare due file lontani) e si ripresenta a ogni
 * bump: chi bumpa vede fallire questo test e sa cosa gli manca.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const json5 = require('json5');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(PLUGIN_DIR, 'migrations');

const descriptor = json5.parse(
  fs.readFileSync(path.join(PLUGIN_DIR, 'pluginConfig.default.json5'), 'utf8'),
);
const index = json5.parse(
  fs.readFileSync(path.join(MIGRATIONS_DIR, 'migrations.json5'), 'utf8'),
);

describe('catena delle migrazioni di adminSentinel', () => {
  test('copre l intero salto da v1 alla schemaVersion del descrittore', () => {
    const target = descriptor.schemaVersion;
    expect(Number.isInteger(target)).toBe(true);

    // Il runner conta gli step, non le versioni: un buco a metà catena passerebbe
    // il confronto sul solo estremo superiore.
    expect(index.steps).toHaveLength(target - 1);

    const salti = index.steps.map((s) => `${s.from}→${s.to}`);
    const attesi = Array.from({ length: target - 1 }, (_, i) => `${i + 1}→${i + 2}`);
    expect(salti).toEqual(attesi);
  });

  test('ogni step copre una sola versione ed è contiguo al precedente', () => {
    const ordinati = [...index.steps].sort((a, b) => a.from - b.from);
    for (const [i, step] of ordinati.entries()) {
      expect(step.to).toBe(step.from + 1);
      if (i > 0) expect(step.from).toBe(ordinati[i - 1].to);
    }
  });

  // `reason` è obbligatorio ANCHE per gli step automatici senza script:
  // dichiarare che un salto è sicuro non è la stessa cosa che motivarlo.
  test('ogni step motiva sé stesso e dichiara cosa tocca', () => {
    for (const step of index.steps) {
      expect(typeof step.title).toBe('string');
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(typeof step.reason).toBe('string');
      expect(step.reason.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(step.touches)).toBe(true);
      expect(typeof step.automatic).toBe('boolean');
    }
  });

  test('gli script dichiarati esistono davvero', () => {
    for (const step of index.steps) {
      if (!step.script) continue;
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, step.script))).toBe(true);
    }
  });

  // Convenzione ital8doc per le migrazioni: ogni salto ha il suo documento, anche
  // quando è automatico. È l'unico posto in cui un amministratore legge cosa gli
  // sta per succedere ai file.
  test('ogni salto ha il suo documento from-vN-to-vM.md', () => {
    for (const step of index.steps) {
      const doc = path.join(MIGRATIONS_DIR, `from-v${step.from}-to-v${step.to}.md`);
      expect(fs.existsSync(doc)).toBe(true);
    }
  });

  // I percorsi in `touches` guidano il backup automatico prima di ogni step: uno
  // sbagliato non fallisce, salva il file sbagliato.
  test('i percorsi toccati esistono come coppia .default', () => {
    const repoRoot = path.join(PLUGIN_DIR, '..', '..');
    for (const step of index.steps) {
      for (const touched of step.touches) {
        const predefinito = path.join(repoRoot, touched.replace(/\.json5$/, '.default.json5'));
        expect(fs.existsSync(predefinito)).toBe(true);
      }
    }
  });
});
