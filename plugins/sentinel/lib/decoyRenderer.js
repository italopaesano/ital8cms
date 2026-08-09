/**
 * decoyRenderer.js
 *
 * Serve i contenuti fittizi: file preparati che prendono il posto di un errore,
 * per far credere a chi bussa di aver trovato quello che cercava.
 *
 * ─── PERCHE UN DECOY VALE PIU DI UN 404 ───────────────────────────────────────
 * Uno scanner chiede `/wp-login.php`. Un 404 gli dice «non è WordPress» e lui
 * passa oltre: gli è costato zero. Un 403 gli dice «non è WordPress **e c'è un
 * filtro**», cioè gli regala un'informazione. Un decoy gli dice «è WordPress», e
 * lui spende minuti a lanciare exploit contro un sito che PHP non lo esegue
 * nemmeno.
 *
 * Il valore è asimmetrico: a te costa un file statico, a lui costa tempo reale.
 * E soprattutto **avvelena i suoi dati**: molti scanner alimentano database di
 * bersagli, e da qui in poi il tuo sito è catalogato male.
 *
 * ─── FUORI DALLA PIPELINE DI RENDERING, PER DUE RAGIONI ───────────────────────
 * I decoy NON passano da EJS né dai partial del tema.
 *   1. Non si espone il motore di template a un percorso raggiungibile da
 *      traffico ostile.
 *   2. Il markup del tema renderebbe il decoy riconoscibile a colpo d'occhio —
 *      un finto WordPress con l'header del tuo sito non inganna nessuno.
 *
 * ─── DUE CARTELLE, PRECEDENZA A QUELLA DELL'UTENTE ────────────────────────────
 *   decoys/default/  forniti col plugin, VERSIONATI: un aggiornamento li sovrascrive
 *   decoys/data/     i tuoi, MAI toccati, esclusi da git
 * Per personalizzare un decoy fornito basta copiarlo in `data/` con lo stesso
 * nome. È la stessa simmetria di `x.default.json5` ↔ `x.json5`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DECOY_DIR = 'decoys';
const USER_SUBDIR = 'data';
const SHIPPED_SUBDIR = 'default';

/**
 * Tipo di contenuto dedotto dall'estensione del file di decoy.
 *
 * Conta per la credibilità: un finto `.env` servito come `text/html` verrebbe
 * reso dal browser come pagina e non somiglierebbe più a un file di
 * configurazione trafugato.
 */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Escape HTML minimale, per i segnaposto riflessi dentro un decoy HTML. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Risolve il file di decoy, con precedenza alla versione dell'utente.
 *
 * @param {string} pluginFolder
 * @param {string} fileName - nome semplice, già validato al load
 * @returns {string|null} path assoluto, o null se non esiste da nessuna parte
 */
function resolveDecoyPath(pluginFolder, fileName) {
  // Seconda linea di difesa contro il path traversal: il validatore rifiuta già
  // i nomi con separatori, ma un decoy che legge fuori dalla propria cartella
  // sarebbe una lettura arbitraria di file guidata da un file di configurazione.
  const safe = path.basename(fileName);
  if (safe !== fileName) return null;

  const userPath = path.join(pluginFolder, DECOY_DIR, USER_SUBDIR, safe);
  if (fs.existsSync(userPath)) return userPath;

  const shippedPath = path.join(pluginFolder, DECOY_DIR, SHIPPED_SUBDIR, safe);
  if (fs.existsSync(shippedPath)) return shippedPath;

  return null;
}

/**
 * Sostituisce i segnaposto del livello 1.
 *
 * ─── PERCHE NON BASTA UN FILE STATICO ─────────────────────────────────────────
 * Due risposte identiche hanno lo stesso hash, e uno scanner che confronta le
 * risposte si accorge che il "sito" restituisce sempre la stessa pagina per URL
 * diversi. Numeri di versione, timestamp e identificativi che cambiano rendono
 * il decoy indistinguibile da un'applicazione vera.
 *
 * ─── I SEGNAPOSTO RIFLESSI VANNO ESCAPATI ─────────────────────────────────────
 * `{{path}}` e `{{ip}}` inseriscono nel corpo dati scelti da chi ha fatto la
 * richiesta. In un decoy HTML sarebbe una XSS riflessa in piena regola: il
 * bersaglio non sarebbe l'attaccante — che si autoinfetterebbe — ma chiunque
 * riceva da lui un link a quell'URL. Si escapa in base al tipo di contenuto.
 *
 * @param {string} template
 * @param {object} vars
 * @param {boolean} isHtml
 * @returns {string}
 */
function renderTemplate(template, vars, isHtml) {
  const now = new Date();
  const esc = isHtml ? escapeHtml : ((v) => String(v));

  return template.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (match, name, arg) => {
    switch (name) {
      case 'now':
        return now.toISOString();
      case 'today':
        return now.toISOString().slice(0, 10);
      case 'timestamp':
        return String(Math.floor(now.getTime() / 1000));
      case 'random': {
        const length = Math.min(Math.max(parseInt(arg, 10) || 16, 1), 128);
        let out = '';
        while (out.length < length) out += Math.random().toString(36).slice(2);
        return out.slice(0, length);
      }
      case 'choice': {
        const options = String(arg || '').split('|').filter(Boolean);
        return options.length ? options[Math.floor(Math.random() * options.length)] : '';
      }
      // ── Riflessi: sempre escapati nel contesto HTML ──
      case 'path':
        return esc(vars.path || '');
      case 'ip':
        return esc(vars.ip || '');
      default:
        return match; // segnaposto sconosciuto: lasciato com'è, non è un errore fatale
    }
  });
}

/**
 * Legge un decoy e ne produce corpo, tipo e header.
 *
 * @param {object} options
 * @param {string} options.pluginFolder
 * @param {object} options.spec       - blocco `decoy` della regola
 * @param {object} options.vars       - { path, ip }
 * @param {boolean} [options.useCache]
 * @param {Map} [options.cache]
 * @returns {{ ok: boolean, body: string, type: string, status: number, headers: object }|null}
 */
function renderDecoy(options) {
  const { pluginFolder, spec, vars, useCache, cache } = options;

  const filePath = resolveDecoyPath(pluginFolder, spec.file);
  if (!filePath) return null;

  let template;
  if (useCache && cache && cache.has(filePath)) {
    template = cache.get(filePath);
  } else {
    try {
      template = fs.readFileSync(filePath, 'utf8');
    } catch (_err) {
      return null;
    }
    if (useCache && cache) cache.set(filePath, template);
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'text/plain; charset=utf-8';
  const isHtml = type.startsWith('text/html');

  return {
    ok: true,
    body: renderTemplate(template, vars || {}, isHtml),
    type,
    status: Number.isInteger(spec.status) ? spec.status : 200,
    // Header dichiarati dalla regola: servono alla credibilità. Un finto
    // `phpinfo()` senza `X-Powered-By: PHP/…` è smascherato dal primo scanner
    // che guarda gli header invece del corpo.
    headers: spec.headers && typeof spec.headers === 'object' ? spec.headers : {},
  };
}

module.exports = {
  renderDecoy,
  resolveDecoyPath,
  renderTemplate,
  escapeHtml,
  CONTENT_TYPES,
  DECOY_DIR,
  USER_SUBDIR,
  SHIPPED_SUBDIR,
};
