/**
 * Jest globalSetup — materializza i config vivi dai `.default` prima della suite.
 *
 * Dal ciclo di vita config (docs/decisions/config-lifecycle.it.md) TUTTI i config
 * vivi sono git-ignored e generati al boot: i 3 core (ital8Config/adminConfig/
 * koaSession), i descrittori (pluginConfig/themeConfig) e i file di contenuto/dati.
 * Vari test leggono i vivi REALI del progetto (es. tests/unit/admin/
 * themesManagment.test.js, le integration httpsServer/hideExtension/cliBridge),
 * quindi in un clone fresco — dove i vivi non esistono ancora — fallirebbero con
 * ENOENT.
 *
 * Questo globalSetup replica la materializzazione del boot (index.js) UNA sola
 * volta prima di tutte le suite, rendendo i test self-sufficient / fresh-clone
 * safe:
 *   1. materializeMissingConfigs su plugins/ e themes/ (descrittori + contenuto/dati)
 *   2. materializeFromDefault sui 3 core (ital8Config/adminConfig/koaSession)
 *   3. ensureThemesInstalled su themes/ (isInstalled:1 sui temi bundled, come al boot)
 *
 * È NON distruttivo: materializeFromDefault / materializeMissingConfigs sono no-op
 * se il vivo esiste già, e ensureThemesInstalled imposta isInstalled solo se assente.
 * In sviluppo (config già materializzati) è quindi un no-op silenzioso.
 *
 * NB: la discovery in jest.config.js (esclusione dei plugin `active:0`) gira PRIMA
 * di questo hook, perciò legge il `.default` come fallback — vedi jest.config.js.
 */

'use strict';

const path = require('path');
const materializeMissingConfigs = require('../core/materializeMissingConfigs');
const materializeFromDefault = require('../core/materializeFromDefault');
const ensureThemesInstalled = require('../core/ensureThemesInstalled');

const PROJECT_ROOT = path.join(__dirname, '..');

// Coppie default→vivo dei config core standalone (stesse del wizard scripts/init.js).
const CORE_PAIRS = [
  ['ital8Config.default.json5', 'ital8Config.json5'],
  ['core/priorityMiddlewares/koaSession.default.json5', 'core/priorityMiddlewares/koaSession.json5'],
  ['core/admin/adminConfig.default.json5', 'core/admin/adminConfig.json5'],
];

module.exports = async function globalSetup() {
  let created = 0;

  // 1. Contenitori plugins/ e themes/ (descrittori + contenuto/dati utente).
  for (const container of ['plugins', 'themes']) {
    const summary = await materializeMissingConfigs(path.join(PROJECT_ROOT, container));
    created += summary.created.length;
  }

  // 2. Config core standalone (il boot li gestisce via gate/wizard; qui li
  //    materializziamo direttamente perché in test non c'è il wizard).
  for (const [def, live] of CORE_PAIRS) {
    const res = await materializeFromDefault(path.join(PROJECT_ROOT, def), path.join(PROJECT_ROOT, live));
    if (res && res.created) created += 1;
  }

  // 3. isInstalled:1 sui temi bundled appena materializzati (come al boot).
  await ensureThemesInstalled(path.join(PROJECT_ROOT, 'themes'));

  if (created > 0) {
    console.log(`[test globalSetup] materializzati ${created} config vivi dai .default`);
  }
};
