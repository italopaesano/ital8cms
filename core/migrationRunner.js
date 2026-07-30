/**
 * migrationRunner — porta un'installazione da una `schemaVersion` alla successiva
 * eseguendo gli step dichiarati nella cartella `migrations/` del pacchetto.
 *
 * Design completo: docs/decisions/config-migrations.it.md.
 *
 * PERCHÉ ESISTE. Il merge additivo di `reconcileSchemaVersion` sa solo AGGIUNGERE
 * chiavi. Rinomine, rimozioni e cambi di valore restavano scoperti: dei quattro
 * bump di `schemaVersion` realmente avvenuti nel progetto, tre non hanno prodotto
 * l'effetto atteso e hanno generato altrettanti workaround nel codice. Questo
 * modulo è la migrazione vera, rimandata dalla decisione sul ciclo di vita.
 *
 * IL CLOCK. `from-vN-to-vM` si riferisce alla `schemaVersion` del DESCRITTORE del
 * pacchetto (`pluginConfig` / `themeConfig`), promossa a versione di struttura
 * dell'intero pacchetto; per i config del core il clock è il file stesso. La
 * scelta evita di persistere "l'ultima versione vista" da qualche parte: quel
 * dato è già su disco — è la `schemaVersion` del file VIVO. Il default dice dove
 * il codice è arrivato, il vivo dove sta questa installazione, e la differenza
 * è esattamente la catena da percorrere.
 *
 * TRE STRATEGIE PER STEP, derivate senza campi aggiuntivi:
 *   automatic + nessuno script → merge additivo ricorsivo (sole aggiunte: il caso
 *                                più frequente, e il core lo sa già fare)
 *   automatic + script         → rinomine, rimozioni, cambi di valore
 *   manuale                    → umano o AI guidato dal .md, poi verify() o
 *                                --confirm-manual
 * Script e merge sono COMPLEMENTARI nello stesso step: lo script fa ciò che il
 * merge non sa fare e lascia che le aggiunte le completi il merge, che gira
 * comunque dopo. Così gli script restano corti.
 *
 * LA `schemaVersion` È UNA RICEVUTA, NON UN CONTATORE DI TENTATIVI. Viene allineata
 * solo a esito riuscito. Allinearla su fallimento brucerebbe il trigger: al boot
 * dopo l'installazione risulterebbe aggiornata e lo step non ripartirebbe più,
 * lasciando uno stato a metà che il sistema crede sano.
 *
 * SICUREZZA. Gli script sono codice di terze parti che gira sui config
 * dell'utente: si eseguono solo su richiesta esplicita (CLI) o con
 * `migrations.autoApply` attivo (default OFF), sempre dopo un backup dei file
 * dichiarati in `touches`, e le loro scritture sono confinate al pacchetto.
 *
 * API:
 *   collectTargets(projectRoot)                → tutti i pacchetti migrabili
 *   resolveTarget(projectRoot, name, {theme})  → un singolo target per nome
 *   readPlan(target)                           → { pending, errors, ... }
 *   runMigrations(target, options)             → esegue la catena
 *   reportPendingMigrations(projectRoot)       → rilevamento al boot + box [MIGRATE]
 */

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const loadJson5 = require('./loadJson5');
const setJson5Key = require('./setJson5Key');
const saveJson5 = require('./saveJson5');
const logger = require('./logger');

const MIGRATIONS_DIR = 'migrations';
const MIGRATIONS_INDEX = 'migrations.json5';

// I tre config globali non sono pacchetti: non hanno un descrittore che faccia da
// clock (lo è il file stesso) e vivono in cartelle diverse. La mappa tiene insieme
// le tre informazioni che al runner servono: dove sta il vivo, dove il default e
// dove le migrazioni.
const CORE_CONFIGS = [
  { name: 'ital8Config', live: 'ital8Config.json5', default: 'ital8Config.default.json5' },
  { name: 'adminConfig', live: 'core/admin/adminConfig.json5', default: 'core/admin/adminConfig.default.json5' },
  { name: 'koaSession', live: 'core/priorityMiddlewares/koaSession.json5', default: 'core/priorityMiddlewares/koaSession.default.json5' },
];

// ── Costruzione dei target ───────────────────────────────────────────────────

function makePackageTarget(projectRoot, container, name) {
  const descriptor = container === 'themes' ? 'themeConfig' : 'pluginConfig';
  const packageDir = path.join(projectRoot, container, name);
  return {
    label: `${container}/${name}`,
    kind: container === 'themes' ? 'theme' : 'plugin',
    name,
    packageDir,
    livePath: path.join(packageDir, `${descriptor}.json5`),
    defaultPath: path.join(packageDir, `${descriptor}.default.json5`),
    migrationsDir: path.join(packageDir, MIGRATIONS_DIR),
  };
}

function makeCoreTarget(projectRoot, entry) {
  return {
    label: `core/${entry.name}`,
    kind: 'core',
    name: entry.name,
    // Per i core il "pacchetto" è la cartella che ospita il config: è lì che uno
    // script può scrivere.
    packageDir: path.dirname(path.join(projectRoot, entry.live)),
    livePath: path.join(projectRoot, entry.live),
    defaultPath: path.join(projectRoot, entry.default),
    migrationsDir: path.join(projectRoot, 'core', MIGRATIONS_DIR, entry.name),
  };
}

/**
 * Elenca tutti i target migrabili: plugin, temi e i tre config del core.
 *
 * @param {string} projectRoot
 * @returns {Array<object>}
 */
function collectTargets(projectRoot) {
  const targets = [];
  for (const container of ['plugins', 'themes']) {
    const base = path.join(projectRoot, container);
    let entries;
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      targets.push(makePackageTarget(projectRoot, container, entry.name));
    }
  }
  for (const entry of CORE_CONFIGS) targets.push(makeCoreTarget(projectRoot, entry));
  return targets;
}

/**
 * Risolve un singolo target per nome (usato dal comando CLI).
 *
 * @param {string} projectRoot
 * @param {string} name - Nome del plugin/tema, o di un config core.
 * @param {object} [options]
 * @param {boolean} [options.theme] - Cerca in `themes/` invece che in `plugins/`.
 * @returns {object|null}
 */
function resolveTarget(projectRoot, name, options = {}) {
  const coreEntry = CORE_CONFIGS.find((c) => c.name === name);
  if (coreEntry) return makeCoreTarget(projectRoot, coreEntry);

  const container = options.theme ? 'themes' : 'plugins';
  const dir = path.join(projectRoot, container, name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  return makePackageTarget(projectRoot, container, name);
}

// ── Lettura e validazione dell'indice ────────────────────────────────────────

function readClock(filePath) {
  try {
    const parsed = loadJson5(filePath);
    return Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : null;
  } catch (_) {
    return null;
  }
}

/**
 * Valida `migrations.json5`. Gli errori NON lanciano: il chiamante (boot) li
 * segnala e lascia il pacchetto al suo `schemaVersion`, coerentemente col boot
 * graceful — un pacchetto con le migrazioni scritte male non blocca l'avvio.
 *
 * @param {object} index - Contenuto parsato di migrations.json5.
 * @param {object} target
 * @returns {{steps: Array<object>, errors: string[]}}
 */
function validateIndex(index, target) {
  const errors = [];
  if (index === null || typeof index !== 'object' || Array.isArray(index)) {
    return { steps: [], errors: [`${MIGRATIONS_INDEX} non contiene un oggetto`] };
  }
  if (!Array.isArray(index.steps)) {
    return { steps: [], errors: [`${MIGRATIONS_INDEX}: campo "steps" mancante o non array`] };
  }

  const steps = [];
  for (const [i, step] of index.steps.entries()) {
    const where = `steps[${i}]`;
    if (step === null || typeof step !== 'object') { errors.push(`${where}: non è un oggetto`); continue; }
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to)) {
      errors.push(`${where}: "from"/"to" devono essere interi`); continue;
    }
    if (step.to !== step.from + 1) {
      errors.push(`${where}: salto non unitario (${step.from} → ${step.to}): ogni step copre una sola versione`);
      continue;
    }
    if (typeof step.automatic !== 'boolean') { errors.push(`${where}: "automatic" deve essere booleano`); continue; }
    // `reason` è obbligatorio ANCHE quando automatic è true: obbliga l'autore a
    // motivare perché il salto è sicuro, non solo a dichiararlo.
    if (typeof step.reason !== 'string' || step.reason.trim() === '') {
      errors.push(`${where}: "reason" è obbligatorio (anche per gli step automatici)`); continue;
    }
    if (typeof step.title !== 'string' || step.title.trim() === '') {
      errors.push(`${where}: "title" è obbligatorio`); continue;
    }
    if (!Array.isArray(step.touches)) { errors.push(`${where}: "touches" deve essere un array`); continue; }
    if (!step.automatic && (typeof step.doc !== 'string' || step.doc.trim() === '')) {
      errors.push(`${where}: uno step manuale deve indicare il file "doc" che guida l'operatore`); continue;
    }
    if (step.script !== undefined && typeof step.script !== 'string') {
      errors.push(`${where}: "script" deve essere il nome di un file`); continue;
    }
    if (step.script && !fs.existsSync(path.join(target.migrationsDir, step.script))) {
      errors.push(`${where}: script dichiarato ma non trovato: ${step.script}`); continue;
    }
    steps.push(step);
  }

  // Catena contigua: un buco spezzerebbe l'avanzamento in silenzio.
  const sorted = [...steps].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from !== sorted[i - 1].to) {
      errors.push(`catena non contigua: dopo v${sorted[i - 1].to} manca lo step che parte da v${sorted[i - 1].to} (trovato from=${sorted[i].from})`);
      break;
    }
  }
  const duplicates = sorted.filter((s, i) => i > 0 && s.from === sorted[i - 1].from);
  if (duplicates.length > 0) {
    errors.push(`step duplicati per from=${duplicates[0].from}`);
  }

  return { steps: sorted, errors };
}

/**
 * Calcola il piano di migrazione di un target: dove sta, dove deve arrivare, e
 * quali step servono.
 *
 * @param {object} target
 * @returns {{status: string, live: number|null, target: number|null, pending: Array<object>, errors: string[], hasMigrationsDir: boolean}}
 */
function readPlan(targetObj) {
  const result = {
    status: 'ok', live: null, target: null, pending: [], errors: [],
    hasMigrationsDir: fs.existsSync(path.join(targetObj.migrationsDir, MIGRATIONS_INDEX)),
  };

  if (!fs.existsSync(targetObj.defaultPath) || !fs.existsSync(targetObj.livePath)) {
    result.status = 'not-applicable';
    return result;
  }

  result.live = readClock(targetObj.livePath);
  result.target = readClock(targetObj.defaultPath);
  if (result.target === null) { result.status = 'no-default-version'; return result; }

  const liveVersion = result.live === null ? 0 : result.live;
  if (liveVersion >= result.target) { result.status = 'aligned'; return result; }

  if (!result.hasMigrationsDir) {
    // `migrations/` è opzionale: senza, resta il merge additivo del boot.
    result.status = 'no-migrations';
    return result;
  }

  let index;
  try {
    index = loadJson5(path.join(targetObj.migrationsDir, MIGRATIONS_INDEX));
  } catch (err) {
    result.status = 'invalid';
    result.errors.push(err.message);
    return result;
  }

  const { steps, errors } = validateIndex(index, targetObj);
  result.errors = errors;
  if (errors.length > 0) { result.status = 'invalid'; return result; }

  result.pending = steps.filter((s) => s.from >= liveVersion && s.to <= result.target);
  const covered = result.pending.length === (result.target - liveVersion);
  if (!covered) {
    result.status = 'incomplete-chain';
    result.errors.push(
      `la catena non copre l'intero salto v${liveVersion} → v${result.target}: ` +
      `mancano gli step per ${result.target - liveVersion - result.pending.length} versione/i`
    );
  }
  return result;
}

// ── Esecuzione ───────────────────────────────────────────────────────────────

// Backup dei file dichiarati in `touches`, prima di toccarli. Il nome porta un
// timestamp: i backup si accumulano invece di sovrascriversi, così un secondo
// tentativo non cancella lo stato originale.
async function backupTouchedFiles(targetObj, step) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saved = [];
  for (const relative of step.touches) {
    const full = path.join(targetObj.packageDir, relative);
    if (!fs.existsSync(full)) continue;
    const backupPath = `${full}.backup-v${step.from}-${stamp}`;
    await fsp.copyFile(full, backupPath);
    saved.push(path.basename(backupPath));
  }
  return saved;
}

// Il contesto passato agli script: utility core già atomiche, più i path del
// pacchetto. `dryRun` va rispettato dallo script, altrimenti l'anteprima mente.
function buildContext(targetObj, step, { dryRun }) {
  return {
    packageDir: targetObj.packageDir,
    configPath: targetObj.livePath,
    stepDir: fs.existsSync(path.join(targetObj.migrationsDir, `from-v${step.from}-to-v${step.to}`))
      ? path.join(targetObj.migrationsDir, `from-v${step.from}-to-v${step.to}`)
      : null,
    loadJson5,
    saveJson5,
    setJson5Key,
    logger,
    dryRun: !!dryRun,
  };
}

/**
 * Verifica strutturale: ogni chiave del `.default` deve esistere nel vivo, a
 * qualsiasi profondità. È la stessa traversata del merge ricorsivo, quindi come
 * postcondizione costa quasi nulla e non richiede campi dichiarativi in più.
 *
 * Limite noto: vede la STRUTTURA, non i VALORI. Intercetta una chiave nuova che
 * non è arrivata, non un valore che doveva cambiare — quello è competenza di uno
 * script, quindi coperto dall'altro ramo.
 *
 * @returns {string[]} path mancanti, in notazione puntata (vuoto = ok)
 */
function findMissingKeys(defaultObj, liveObj, prefix = []) {
  const missing = [];
  if (defaultObj === null || typeof defaultObj !== 'object' || Array.isArray(defaultObj)) return missing;
  for (const key of Object.keys(defaultObj)) {
    if (prefix.length === 0 && key === 'schemaVersion') continue;
    const segments = [...prefix, key];
    if (liveObj === null || typeof liveObj !== 'object' || !Object.prototype.hasOwnProperty.call(liveObj, key)) {
      missing.push(segments.join('.'));
      continue;
    }
    const dv = defaultObj[key];
    const lv = liveObj[key];
    if (dv !== null && typeof dv === 'object' && !Array.isArray(dv)) {
      missing.push(...findMissingKeys(dv, lv, segments));
    }
  }
  return missing;
}

/**
 * Esegue la catena di migrazione di un target, uno step alla volta.
 *
 * Si ferma al primo step manuale non confermato e al primo fallimento: in
 * entrambi i casi la `schemaVersion` NON avanza, così il boot successivo
 * ripropone lo stesso punto.
 *
 * @param {object} targetObj
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Non scrive nulla, riporta cosa farebbe.
 * @param {boolean} [options.confirmManual] - Marca "fatto a mano" lo step manuale corrente.
 * @param {function} [options.onLog]
 * @returns {Promise<{applied: Array, stopped: object|null, errors: string[], dryRun: boolean}>}
 */
async function runMigrations(targetObj, options = {}) {
  const dryRun = options.dryRun === true;
  const confirmManual = options.confirmManual === true;
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const report = { label: targetObj.label, applied: [], stopped: null, errors: [], dryRun };

  const plan = readPlan(targetObj);
  if (plan.status !== 'ok') {
    if (plan.errors.length) report.errors.push(...plan.errors);
    report.status = plan.status;
    return report;
  }

  const reconcileSchemaVersion = require('./reconcileSchemaVersion');

  for (const step of plan.pending) {
    const stepLabel = `from-v${step.from}-to-v${step.to}`;

    if (!step.automatic && !confirmManual) {
      // Prima di fermarsi, si dà una possibilità a verify(): se l'operatore ha
      // già eseguito i passi del .md, la postcondizione passa e la catena avanza
      // senza bisogno di --confirm-manual.
      const verified = await tryVerify(targetObj, step, { dryRun });
      if (!verified.ok) {
        report.stopped = {
          step: stepLabel, title: step.title, reason: step.reason,
          doc: step.doc, needs: verified.hasVerify ? 'verify-failed' : 'manual',
          detail: verified.detail || null,
        };
        onLog(`⏸ ${targetObj.label}: ${stepLabel} richiede un intervento manuale — vedi migrations/${step.doc}`);
        break;
      }
      onLog(`✓ ${targetObj.label}: ${stepLabel} verificato da verify(), la catena prosegue`);
    }

    let backups = [];
    try {
      if (!dryRun) backups = await backupTouchedFiles(targetObj, step);

      if (step.script) {
        const scriptPath = path.join(targetObj.migrationsDir, step.script);
        const migration = require(scriptPath);
        if (typeof migration.migrate !== 'function') {
          throw new Error(`${step.script} non esporta una funzione migrate()`);
        }
        await migration.migrate(buildContext(targetObj, step, { dryRun }));
      }

      // Il merge additivo completa comunque le sole aggiunte: gli script non
      // devono ricopiare le chiavi nuove del default.
      let added = [];
      if (!dryRun) {
        const merge = await reconcileSchemaVersion(targetObj.defaultPath, targetObj.livePath);
        added = merge.added || [];
      }

      if (!dryRun) {
        const missing = findMissingKeys(loadJson5(targetObj.defaultPath), loadJson5(targetObj.livePath));
        if (missing.length > 0) {
          throw new Error(`postcondizione fallita: chiavi del default assenti nel vivo dopo la migrazione → ${missing.join(', ')}`);
        }
        // Ricevuta: la versione avanza solo ora. reconcileSchemaVersion l'ha già
        // portata al target del default; qui si riallinea allo step, così una
        // catena interrotta a metà resta ripartibile dal punto giusto.
        await setJson5Key(targetObj.livePath, 'schemaVersion', step.to);
        await alignTouchedSchemaVersions(targetObj, step);
      }

      report.applied.push({ step: stepLabel, title: step.title, added, backups });
      onLog(`✓ ${targetObj.label}: ${stepLabel} applicato${dryRun ? ' (dry-run)' : ''}`);
    } catch (err) {
      report.errors.push(`${stepLabel}: ${err.message}`);
      report.stopped = { step: stepLabel, title: step.title, needs: 'error', detail: err.message };
      onLog(`✗ ${targetObj.label}: ${stepLabel} fallito — ${err.message}`);
      break;
    }
  }

  return report;
}

// Lo step che gira è responsabile di TUTTI i file che dichiara in `touches`:
// allinea anche le loro schemaVersion, così il merge additivo che passa dopo li
// trova a posto e non interviene una seconda volta sugli stessi file.
async function alignTouchedSchemaVersions(targetObj, step) {
  for (const relative of step.touches) {
    const livePath = path.join(targetObj.packageDir, relative);
    if (livePath === targetObj.livePath) continue; // già allineato dal chiamante
    const defaultPath = livePath.replace(/\.json5$/, '.default.json5');
    if (!fs.existsSync(livePath) || !fs.existsSync(defaultPath)) continue;
    const defaultVersion = readClock(defaultPath);
    if (defaultVersion === null) continue;
    await setJson5Key(livePath, 'schemaVersion', defaultVersion);
  }
}

// Esegue la sola verify() di uno step manuale, se lo script la espone.
async function tryVerify(targetObj, step, { dryRun }) {
  if (!step.script) return { ok: false, hasVerify: false };
  try {
    const migration = require(path.join(targetObj.migrationsDir, step.script));
    if (typeof migration.verify !== 'function') return { ok: false, hasVerify: false };
    const res = await migration.verify(buildContext(targetObj, step, { dryRun }));
    return { ok: res && res.ok === true, hasVerify: true, detail: res && res.detail };
  } catch (err) {
    return { ok: false, hasVerify: true, detail: err.message };
  }
}

// ── Rilevamento al boot ──────────────────────────────────────────────────────

/**
 * Passa in rassegna tutti i target e riepiloga le migrazioni pendenti in un box
 * `[MIGRATE]`. È il livello PASSIVO: non esegue nulla di sua iniziativa, perché
 * un boot che modifica i config in silenzio è ciò che rende impossibile capire
 * cosa è successo quando qualcosa si rompe. L'esecuzione automatica degli step
 * `automatic` resta opt-in (`ital8Config.json5 → migrations.autoApply`).
 *
 * Non lancia mai: un pacchetto con le migrazioni scritte male è un warning, non
 * un motivo per non servire il sito.
 *
 * `protectedLivePaths` è la parte che rende il meccanismo sicuro: sono i config
 * per cui resta una migrazione da applicare, e che quindi `reconcileSchemaVersions`
 * NON deve toccare. Se il merge additivo li allineasse, **brucerebbe il trigger**
 * — al boot dopo il vivo risulterebbe aggiornato e la migrazione dichiarata non
 * partirebbe più, perdendo per sempre rinomine e rimozioni.
 *
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {boolean} [options.autoApply] - Applica gli step automatici pendenti.
 * @returns {Promise<{pending: Array, invalid: Array, applied: Array, protectedLivePaths: string[]}>}
 */
async function reportPendingMigrations(projectRoot, options = {}) {
  const summary = { pending: [], invalid: [], applied: [], protectedLivePaths: [] };

  for (const targetObj of collectTargets(projectRoot)) {
    let plan;
    try {
      plan = readPlan(targetObj);
    } catch (err) {
      summary.invalid.push({ label: targetObj.label, errors: [err.message] });
      continue;
    }

    if (plan.status === 'invalid' || plan.status === 'incomplete-chain') {
      summary.invalid.push({ label: targetObj.label, errors: plan.errors });
      continue;
    }
    if (plan.status !== 'ok' || plan.pending.length === 0) continue;

    const automaticRun = plan.pending.filter((s) => s.automatic).length;
    const entry = {
      label: targetObj.label,
      from: plan.live === null ? 0 : plan.live,
      to: plan.target,
      steps: plan.pending.map((s) => ({
        step: `from-v${s.from}-to-v${s.to}`, title: s.title, automatic: s.automatic,
      })),
      allAutomatic: automaticRun === plan.pending.length,
    };

    if (options.autoApply && entry.allAutomatic) {
      const res = await runMigrations(targetObj, { onLog: (m) => logger.info('migrate', m) });
      if (res.applied.length > 0) summary.applied.push({ label: targetObj.label, applied: res.applied });
      if (res.errors.length > 0) summary.invalid.push({ label: targetObj.label, errors: res.errors });
      if (res.stopped) {
        // Applicata solo in parte: quel che resta va comunque protetto.
        summary.pending.push(entry);
        summary.protectedLivePaths.push(targetObj.livePath);
      }
    } else {
      summary.pending.push(entry);
      summary.protectedLivePaths.push(targetObj.livePath);
      // Anche i file secondari dichiarati dagli step pendenti: allinearne la
      // schemaVersion prima della migrazione avrebbe lo stesso effetto distruttivo.
      for (const step of plan.pending) {
        for (const relative of step.touches) {
          const full = path.join(targetObj.packageDir, relative);
          if (full !== targetObj.livePath) summary.protectedLivePaths.push(full);
        }
      }
    }
  }

  if (summary.pending.length > 0 || summary.invalid.length > 0) printMigrateBox(summary);
  return summary;
}

function printMigrateBox(summary) {
  const line = '[MIGRATE] ' + '═'.repeat(57);
  const out = ['', line, '[MIGRATE]  ⚠  Migrazioni di configurazione in sospeso', line];

  for (const p of summary.pending) {
    out.push(`[MIGRATE]  • ${p.label}: v${p.from} → v${p.to}`);
    for (const s of p.steps) {
      out.push(`[MIGRATE]      ${s.automatic ? '[auto]  ' : '[manual]'} ${s.step} — ${s.title}`);
    }
  }
  if (summary.pending.length > 0) {
    const first = summary.pending[0].label.split('/').pop();
    out.push(
      '[MIGRATE]',
      `[MIGRATE]  Esegui:  npm run cli -- migrate ${first}     (aggiungi --dry-run per`,
      '[MIGRATE]  vedere cosa verrebbe fatto). Gli step [manual] richiedono un intervento',
      '[MIGRATE]  guidato dal .md dello step; la catena si ferma lì finché non è risolto.',
    );
  }
  if (summary.invalid.length > 0) {
    out.push('[MIGRATE]', `[MIGRATE]  ${summary.invalid.length} pacchetto/i con migrazioni non valide (ignorate):`);
    for (const bad of summary.invalid) {
      out.push(`[MIGRATE]    • ${bad.label}: ${bad.errors.join('; ')}`);
    }
  }
  out.push(line, '');
  console.warn(out.join('\n'));
}

module.exports = {
  collectTargets,
  resolveTarget,
  readPlan,
  runMigrations,
  reportPendingMigrations,
  // export interni per i test
  _validateIndex: validateIndex,
  _findMissingKeys: findMissingKeys,
  MIGRATIONS_DIR,
  MIGRATIONS_INDEX,
};
