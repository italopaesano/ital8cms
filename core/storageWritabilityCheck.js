/**
 * storageWritabilityCheck.js
 *
 * PREFLIGHT di scrivibilità delle directory dati dichiarate dai plugin.
 *
 * MOTIVAZIONE:
 *   Diversi plugin creano pigramente una propria data dir e vi scrivono a
 *   runtime (analytics → JSONL degli eventi, e in prospettiva rateLimiter,
 *   mailer, media, ...). Se il filesystem non lo permette (root read-only tipo
 *   store Nix, sandbox systemd senza la dir in ReadWritePaths=/StateDirectory=,
 *   permessi/owner errati, disco pieno) il problema emerge solo al primo write,
 *   spesso come un errore oscuro molto dopo l'avvio. Questo modulo lo anticipa
 *   al BOOT con un messaggio chiaro e azionabile.
 *
 * DISCOVERY (plugin-declared):
 *   Ogni plugin può esporre in main.js:
 *     getWritablePaths(pluginSys, pathPluginFolder) → Array<{ path, purpose }>
 *   Il preflight itera i plugin ATTIVI, raccoglie le dichiarazioni e sonda ogni
 *   path. I plugin che non dichiarano nulla sono semplicemente saltati.
 *
 * SONDA (effettiva, non basata sui soli permessi):
 *   fs.accessSync(dir, W_OK) sarebbe la via Unix "canonica", ma (a) fallisce con
 *   ENOENT se la dir non esiste ancora — proprio il caso del deploy fresco — e
 *   (b) verifica il permesso, non l'esito reale (ENOSPC, chattr +i, quote, alcuni
 *   FS di rete possono mentire). Per un check BLOCCANTE un falso "non scrivibile"
 *   abortirebbe il boot a torto. Perciò usiamo la sonda EFFETTIVA (probeWritable):
 *   crea la dir (recursive), scrive un file temporaneo e lo cancella. Non mente
 *   (esercita gli stessi syscall del plugin) e pre-crea la data dir, così il
 *   primo uso parte già liscio. I metadati Unix (code dell'errore, owner/mode
 *   dell'antenato esistente, uid/gid del processo) servono solo ad ARRICCHIRE il
 *   messaggio d'errore quando la sonda fallisce.
 *
 * SEVERITÀ (bloccante):
 *   Una directory dichiarata non scrivibile interrompe l'avvio con un box
 *   [STORAGE] + process.exit(1), come per gli essentialPlugins non caricati:
 *   meglio fallire-forte-e-chiaro al boot che scoprirlo runtime. Complementa la
 *   resilienza fail-soft già presente nelle scritture (che a runtime non crasha
 *   mai): boot = preflight strict, runtime = resiliente.
 *
 * AGGANCIO:
 *   Invocato da index.js DOPO pluginSys.initialize() (i path assoluti derivano
 *   da loadPlugin, quindi devono essere già risolti).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const loadJson5 = require('./loadJson5');

const LOG_PREFIX = '[STORAGE]';
const TAG_LINE   = LOG_PREFIX + ' ' + '═'.repeat(58);

/**
 * Sonda EFFETTIVA di scrivibilità: crea la dir (recursive), scrive un file
 * temporaneo e lo cancella. Unico test che non mente e che pre-crea la data dir.
 *
 * @param {string} dir - Path assoluto della directory da verificare
 * @returns {{ok: true} | {ok: false, error: Error}}
 */
function probeWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probeFile = path.join(dir, `.ital8-writecheck-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probeFile, '', 'utf8');
    fs.unlinkSync(probeFile);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Risale al primo antenato ESISTENTE di un path (per leggerne owner/mode quando
 * la dir stessa non esiste ancora).
 *
 * @param {string} dir
 * @returns {string} Path dell'antenato esistente (al limite la radice)
 */
function nearestExistingAncestor(dir) {
  let current = path.resolve(dir);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break; // radice raggiunta
    current = parent;
  }
  return current;
}

/**
 * Righe diagnostiche in stile Unix per un fallimento di sonda: code dell'errore,
 * owner/mode dell'antenato esistente, uid/gid del processo.
 *
 * @param {string} dir
 * @param {Error}  error
 * @returns {string[]}
 */
function describeFailure(dir, error) {
  const code = (error && error.code) ? error.code : 'ERRORE';
  const message = (error && error.message) ? error.message : String(error);
  const lines = [
    `${LOG_PREFIX}    • ${dir}`,
    `${LOG_PREFIX}        ${code}: ${message}`,
  ];

  try {
    const ancestor = nearestExistingAncestor(dir);
    const st = fs.statSync(ancestor);
    const mode = (st.mode & 0o777).toString(8).padStart(3, '0');
    const owner = (typeof st.uid === 'number') ? `uid=${st.uid} gid=${st.gid}` : 'owner n/d';
    const label = (ancestor === path.resolve(dir)) ? 'dir' : 'antenato esistente';
    lines.push(`${LOG_PREFIX}        ${label} ${ancestor} → mode ${mode}, ${owner}`);
  } catch (_) { /* best-effort: la diagnostica non deve mai lanciare */ }

  if (typeof process.getuid === 'function') {
    lines.push(`${LOG_PREFIX}        processo: uid=${process.getuid()} gid=${process.getgid()}`);
  }
  return lines;
}

/**
 * Righe azionabili sui rimedi tipici (condivise da box bloccante e advisory).
 * @returns {string[]}
 */
function remedyLines() {
  return [
    `${LOG_PREFIX}  Rimedi tipici:`,
    `${LOG_PREFIX}    • permessi/owner:   chown -R <utente-servizio> <dir>  |  chmod u+rwx <dir>`,
    `${LOG_PREFIX}    • systemd sandbox:  aggiungi la dir a ReadWritePaths= (o usa StateDirectory=)`,
    `${LOG_PREFIX}    • root read-only:   sposta la data dir su un percorso scrivibile (config del plugin)`,
    `${LOG_PREFIX}    • disco pieno:      libera spazio (ENOSPC)`,
  ];
}

/**
 * Compone il box [STORAGE] a partire dai fallimenti (condiviso da preflight
 * bloccante e advisory).
 *
 * @param {string} headerLine - Riga di intestazione (già con LOG_PREFIX)
 * @param {Array<{plugin, dir, purpose, error}>} failures
 * @param {string[]} footerLines - Righe finali (nota + rimedi)
 * @returns {string}
 */
function formatFailuresBox(headerLine, failures, footerLines) {
  const out = ['', TAG_LINE, headerLine, LOG_PREFIX];
  for (const f of failures) {
    const purpose = f.purpose ? ` (${f.purpose})` : '';
    out.push(`${LOG_PREFIX}  plugin ${f.plugin}${purpose}:`);
    out.push(...describeFailure(f.dir, f.error));
    out.push(LOG_PREFIX);
  }
  out.push(...footerLines, TAG_LINE, '');
  return out.join('\n');
}

/**
 * Raccoglie e valida le data dir dichiarate da UN plugin via getWritablePaths().
 * Non sonda, non lancia: risolve i path (assoluti o relativi a pathPluginFolder)
 * e scarta le voci malformate con un warning. Condivisa dal preflight bloccante
 * e dall'advisory d'installazione.
 *
 * @param {object} plugin    - Oggetto plugin (con pluginName, pathPluginFolder)
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {(...a:any)=>void} warn
 * @returns {Array<{plugin: string, dir: string, purpose: string}>}
 */
function resolveDeclaredDirs(plugin, pluginSys, warn) {
  if (!plugin || typeof plugin.getWritablePaths !== 'function') return [];

  let entries;
  try {
    entries = plugin.getWritablePaths(pluginSys, plugin.pathPluginFolder);
  } catch (e) {
    warn(`${LOG_PREFIX} ⚠  ${plugin.pluginName}.getWritablePaths() ha lanciato: ${e.message} — dichiarazione ignorata`);
    return [];
  }
  if (!Array.isArray(entries)) return [];

  const dirs = [];
  for (const entry of entries) {
    const rawPath = entry && entry.path;
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      warn(`${LOG_PREFIX} ⚠  ${plugin.pluginName}: voce writable-path priva di "path" valido — ignorata`);
      continue;
    }
    const dir = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(plugin.pathPluginFolder || process.cwd(), rawPath);
    dirs.push({
      plugin: plugin.pluginName,
      dir,
      purpose: (entry && typeof entry.purpose === 'string') ? entry.purpose : '',
    });
  }
  return dirs;
}

/**
 * Sonda un elenco di directory dichiarate e ritorna quelle NON scrivibili.
 * @param {Array<{plugin, dir, purpose}>} declaredDirs
 * @returns {Array<{plugin, dir, purpose, error: Error}>}
 */
function probeFailures(declaredDirs) {
  const failures = [];
  for (const decl of declaredDirs) {
    const result = probeWritable(decl.dir);
    if (!result.ok) failures.push({ ...decl, error: result.error });
  }
  return failures;
}

/**
 * Preflight BLOCCANTE di scrivibilità delle data dir dichiarate dai plugin.
 * Invocato da index.js dopo pluginSys.initialize(). Una dir non scrivibile →
 * box [STORAGE] + process.exit(1).
 *
 * @param {object} pluginSys - Istanza del sistema plugin (già inizializzata)
 * @param {object} [options]
 * @param {(code:number)=>void} [options.exit]  - override di process.exit (test)
 * @param {(...a:any)=>void}    [options.error] - override di console.error (test)
 * @param {(...a:any)=>void}    [options.warn]  - override di console.warn (test)
 * @returns {{checked: number, ok: number}} Riepilogo (per i test, quando non esce)
 */
function checkStorageWritability(pluginSys, options = {}) {
  const exit  = options.exit  || ((code) => process.exit(code));
  const error = options.error || console.error.bind(console);
  const warn  = options.warn  || console.warn.bind(console);

  if (!pluginSys || typeof pluginSys.getActivePluginNames !== 'function') {
    return { checked: 0, ok: 0 };
  }

  const declaredDirs = [];
  for (const pluginName of pluginSys.getActivePluginNames()) {
    declaredDirs.push(...resolveDeclaredDirs(pluginSys.getPlugin(pluginName), pluginSys, warn));
  }
  if (declaredDirs.length === 0) return { checked: 0, ok: 0 };

  const failures = probeFailures(declaredDirs);
  if (failures.length === 0) {
    return { checked: declaredDirs.length, ok: declaredDirs.length };
  }

  error(formatFailuresBox(
    `${LOG_PREFIX}  🔴  ${failures.length} directory dati NON scrivibile/i — avvio interrotto:`,
    failures,
    remedyLines(),
  ));
  exit(1);
  return { checked: declaredDirs.length, ok: declaredDirs.length - failures.length };
}

/**
 * Advisory NON bloccante di scrivibilità per UN singolo plugin. Pensato per
 * l'install-time (pluginSys, dopo installPlugin+loadPlugin) e per il wizard.
 *
 * Logga un box [STORAGE] di AVVISO se una data dir dichiarata non è scrivibile
 * nel contesto CORRENTE, ma NON interrompe: il contesto d'installazione/wizard
 * (utente, sandbox) può differire da quello del servizio a runtime, quindi non
 * deve dare falsa sicurezza né bloccare a torto. Il gate autorevole e bloccante
 * resta il preflight di boot (checkStorageWritability).
 *
 * @param {object} plugin    - Oggetto plugin (con pluginName, pathPluginFolder)
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {object} [options]
 * @param {(...a:any)=>void} [options.warn] - override di console.warn (test)
 * @returns {boolean} true se tutto scrivibile (o nulla dichiarato), false se ci sono avvisi
 */
function advisePluginWritability(plugin, pluginSys, options = {}) {
  const warn = options.warn || console.warn.bind(console);

  const declaredDirs = resolveDeclaredDirs(plugin, pluginSys, warn);
  if (declaredDirs.length === 0) return true;

  const failures = probeFailures(declaredDirs);
  if (failures.length === 0) return true;

  warn(formatFailuresBox(
    `${LOG_PREFIX}  ⚠  Directory dati non scrivibili nel contesto attuale (plugin ${plugin.pluginName}):`,
    failures,
    [...advisoryFooter(), ...remedyLines()],
  ));
  return false;
}

/**
 * Righe finali comuni agli avvisi non bloccanti (install-time e wizard).
 * @returns {string[]}
 */
function advisoryFooter() {
  return [
    `${LOG_PREFIX}  AVVISO non bloccante: il contesto d'installazione/wizard può differire`,
    `${LOG_PREFIX}  da quello del servizio a runtime. Il controllo autorevole e bloccante`,
    `${LOG_PREFIX}  avviene al boot del server.`,
    LOG_PREFIX,
  ];
}

/**
 * Advisory NON bloccante per il WIZARD / uso OFFLINE (nessun pluginSys, i plugin
 * non sono caricati). Scansiona una directory di plugin, e per ogni plugin
 * ATTIVO (active:1) che espone getWritablePaths(), lo introspeziona in modo
 * difensivo (require in try/catch), risolve le sue data dir dal config e le
 * sonda. Stampa UN box [STORAGE] consolidato di avviso se qualcosa non è
 * scrivibile. Non lancia mai e non blocca.
 *
 * @param {string} pluginsDir - Path assoluto alla cartella plugins/
 * @param {object} [options]
 * @param {(...a:any)=>void} [options.warn] - override di console.warn (test)
 * @returns {boolean} true se tutto scrivibile (o nulla dichiarato), false se ci sono avvisi
 */
function adviseWritabilityForPluginsDir(pluginsDir, options = {}) {
  const warn = options.warn || console.warn.bind(console);

  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (_) {
    return true; // cartella plugins/ non leggibile → niente da fare
  }

  const failures = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginFolder = path.join(pluginsDir, entry.name);

    // Solo plugin ATTIVI (active:1), come al boot; salta disabilitati/non installati.
    try {
      const cfg = loadJson5(path.join(pluginFolder, 'pluginConfig.json5'));
      if (!cfg || cfg.active !== 1) continue;
    } catch (_) {
      continue; // config vivo assente → plugin non ancora installato: salta
    }

    const mainPath = path.join(pluginFolder, 'main.js');
    let mod;
    try {
      mod = require(mainPath);
    } catch (_) {
      continue; // require fallito (dep mancante, ecc.) → salta senza rumore
    }
    if (!mod || typeof mod.getWritablePaths !== 'function') continue;

    const pluginObj = {
      pluginName: entry.name,
      pathPluginFolder: pluginFolder,
      getWritablePaths: mod.getWritablePaths,
    };
    failures.push(...probeFailures(resolveDeclaredDirs(pluginObj, null, warn)));
  }

  if (failures.length === 0) return true;

  warn(formatFailuresBox(
    `${LOG_PREFIX}  ⚠  Directory dati non scrivibili nel contesto attuale (setup):`,
    failures,
    [...advisoryFooter(), ...remedyLines()],
  ));
  return false;
}

module.exports = {
  checkStorageWritability,
  advisePluginWritability,
  adviseWritabilityForPluginsDir,
  probeWritable,
};
