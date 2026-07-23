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
 * Preflight di scrivibilità delle data dir dichiarate dai plugin.
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

  // ── 1. Raccogli le dichiarazioni dai plugin attivi ──
  const declarations = []; // { plugin, dir, purpose }
  for (const pluginName of pluginSys.getActivePluginNames()) {
    const plugin = pluginSys.getPlugin(pluginName);
    if (!plugin || typeof plugin.getWritablePaths !== 'function') continue;

    let entries;
    try {
      entries = plugin.getWritablePaths(pluginSys, plugin.pathPluginFolder);
    } catch (e) {
      warn(`${LOG_PREFIX} ⚠  ${pluginName}.getWritablePaths() ha lanciato: ${e.message} — dichiarazione ignorata`);
      continue;
    }
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const rawPath = entry && entry.path;
      if (typeof rawPath !== 'string' || rawPath.trim() === '') {
        warn(`${LOG_PREFIX} ⚠  ${pluginName}: voce writable-path priva di "path" valido — ignorata`);
        continue;
      }
      const dir = path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(plugin.pathPluginFolder || process.cwd(), rawPath);
      declarations.push({
        plugin: pluginName,
        dir,
        purpose: (entry && typeof entry.purpose === 'string') ? entry.purpose : '',
      });
    }
  }

  if (declarations.length === 0) return { checked: 0, ok: 0 };

  // ── 2. Sonda ogni directory dichiarata ──
  const failures = [];
  for (const decl of declarations) {
    const result = probeWritable(decl.dir);
    if (!result.ok) failures.push({ ...decl, error: result.error });
  }

  // ── 3. Esito ──
  if (failures.length === 0) {
    return { checked: declarations.length, ok: declarations.length };
  }

  const out = [
    '',
    TAG_LINE,
    `${LOG_PREFIX}  🔴  ${failures.length} directory dati NON scrivibile/i — avvio interrotto:`,
    LOG_PREFIX,
  ];
  for (const f of failures) {
    const purpose = f.purpose ? ` (${f.purpose})` : '';
    out.push(`${LOG_PREFIX}  plugin ${f.plugin}${purpose}:`);
    out.push(...describeFailure(f.dir, f.error));
    out.push(LOG_PREFIX);
  }
  out.push(
    `${LOG_PREFIX}  Rimedi tipici:`,
    `${LOG_PREFIX}    • permessi/owner:   chown -R <utente-servizio> <dir>  |  chmod u+rwx <dir>`,
    `${LOG_PREFIX}    • systemd sandbox:  aggiungi la dir a ReadWritePaths= (o usa StateDirectory=)`,
    `${LOG_PREFIX}    • root read-only:   sposta la data dir su un percorso scrivibile (config del plugin)`,
    `${LOG_PREFIX}    • disco pieno:      libera spazio (ENOSPC)`,
    TAG_LINE,
    '',
  );
  error(out.join('\n'));
  exit(1);
  return { checked: declarations.length, ok: declarations.length - failures.length };
}

module.exports = { checkStorageWritability, probeWritable };
