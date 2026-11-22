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
const editJson5 = require('../core/editJson5');
const loadJson5 = require('../core/loadJson5');
const { classifySessionKeys } = require('../core/sessionSecurity');
const { generateSessionKeys } = require('../scripts/lib/sessionKeyManager');

const PROJECT_ROOT = path.join(__dirname, '..');

// Coppie default→vivo dei config core standalone (stesse del wizard scripts/init.js).
const CORE_PAIRS = [
  ['ital8Config.default.json5', 'ital8Config.json5'],
  ['core/priorityMiddlewares/koaSession.default.json5', 'core/priorityMiddlewares/koaSession.json5'],
  ['core/admin/adminConfig.default.json5', 'core/admin/adminConfig.json5'],
];

const KOA_SESSION_LIVE = path.join(PROJECT_ROOT, 'core/priorityMiddlewares/koaSession.json5');

/**
 * Sostituisce le chiavi di sessione PUBBLICHE con chiavi casuali vere.
 *
 * Serve perché il `.default` spedisce i segnaposti `CHANGE_ME_*`, e dalla
 * correzione di REVIEW.md → A2 quelle chiavi non fanno partire il CMS. Senza
 * questo passo ogni run materializzerebbe un `koaSession.json5` che il gate
 * rifiuta, e tutte le integration che avviano l'app morirebbero al boot.
 *
 * La scelta è deliberata: generare chiavi vere invece di dare ai test una via di
 * fuga (una variabile d'ambiente che disattivi il gate). Una via di fuga
 * reintrodurrebbe l'« ignorabile » che il gate esiste per rimuovere, e lascerebbe
 * la suite a esercitare un percorso che in produzione non esiste. Così invece
 * l'ambiente di test somiglia a un'installazione CONFIGURATA, che è la
 * condizione in cui il CMS è pensato per girare.
 *
 * Idempotente: non tocca nulla se le chiavi già passano il gate — quindi in
 * sviluppo, dopo la prima run, è un no-op silenzioso. Usa `editJson5` e non una
 * riscrittura dell'oggetto per non perdere i commenti del file (decisione D1).
 */
async function ensureUsableSessionKeys() {
  let keys;
  try {
    keys = loadJson5(KOA_SESSION_LIVE).keys;
  } catch {
    return false; // file assente o illeggibile: non è questo il posto dove segnalarlo
  }
  if (classifySessionKeys(keys).tier !== 'fatal') return false;
  await editJson5(KOA_SESSION_LIVE, 'keys', generateSessionKeys());
  return true;
}

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

  // 3. Chiavi di sessione usabili (il wizard, che normalmente le genera, non gira).
  const keysRotated = await ensureUsableSessionKeys();

  // 4. isInstalled:1 sui temi bundled appena materializzati (come al boot).
  await ensureThemesInstalled(path.join(PROJECT_ROOT, 'themes'));

  if (created > 0) {
    console.log(`[test globalSetup] materializzati ${created} config vivi dai .default`);
  }
  if (keysRotated) {
    console.log('[test globalSetup] chiavi di sessione pubbliche sostituite con chiavi casuali');
  }
};
