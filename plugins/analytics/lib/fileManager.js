/**
 * fileManager.js
 *
 * Gestione file JSONL per il plugin analytics.
 *
 * FORMATO SCELTO — JSONL (.jsonl):
 *   Ogni riga del file è un oggetto JSON indipendente (JSON Lines).
 *   Questo formato è append-friendly: aggiungere un evento richiede una sola
 *   chiamata fs.appendFileSync() con costo O(1), senza dover leggere o
 *   riscrivere l'intero file.
 *   A confronto, un file .json con un array richiederebbe:
 *     1. Lettura completa del file (O(n))
 *     2. Parse JSON (O(n))
 *     3. Push del nuovo elemento
 *     4. Serializzazione e riscrittura (O(n))
 *   Con JSONL questa overhead è completamente eliminata.
 *
 * ROTAZIONE FILE:
 *   La rotazione crea un file separato per ogni periodo temporale.
 *   Questo evita file singoli enormi e facilita la pulizia per retention.
 *
 *   Modalità    | Filename                   | Esempio
 *   ------------|----------------------------|----------------------
 *   "none"      | analytics.jsonl            | analytics.jsonl
 *   "daily"     | analytics-YYYY-MM-DD.jsonl | analytics-2026-04-13.jsonl
 *   "weekly"    | analytics-YYYY-WXX.jsonl   | analytics-2026-W15.jsonl
 *   "monthly"   | analytics-YYYY-MM.jsonl    | analytics-2026-04.jsonl (default)
 */

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[analytics]';

/**
 * Calcola il numero ISO della settimana per una data.
 * Segue lo standard ISO 8601 (settimana 1 = settimana con il primo giovedì dell'anno).
 *
 * @param {Date} date - Data di riferimento
 * @returns {string} Anno e settimana nel formato "YYYY-WXX" (es. "2026-W15")
 */
function getIsoWeekString(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7; // 1=lun ... 7=dom
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // Sposta al giovedì della settimana ISO
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const isoYear = d.getUTCFullYear();
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Restituisce il nome del file JSONL in base alla modalità di rotazione.
 *
 * @param {string} rotationMode - "none" | "daily" | "weekly" | "monthly"
 * @param {Date}   [date]       - Data di riferimento (default: ora corrente)
 * @returns {string} Nome del file (es. "analytics-2026-04.jsonl")
 */
function getFileName(rotationMode, date = new Date()) {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');

  switch (rotationMode) {
    case 'none':
      return 'analytics.jsonl';
    case 'daily':
      return `analytics-${year}-${month}-${day}.jsonl`;
    case 'weekly':
      return `analytics-${getIsoWeekString(date)}.jsonl`;
    case 'monthly':
    default:
      return `analytics-${year}-${month}.jsonl`;
  }
}

/**
 * Assicura che la directory dati esista, creandola ricorsivamente se necessario.
 *
 * @param {string} dataDir - Path assoluto alla directory dati
 */
function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Scrive un batch di eventi JSONL su disco tramite append.
 * Ogni evento viene serializzato su una riga separata.
 * L'operazione è append-only: non legge mai il file esistente.
 *
 * @param {string}         dataDir      - Path assoluto alla directory dati
 * @param {string}         rotationMode - Modalità di rotazione
 * @param {Array<object>}  events       - Array di eventi da scrivere
 */
function writeEvents(dataDir, rotationMode, events) {
  if (!events || events.length === 0) return;

  ensureDataDir(dataDir);

  const fileName = getFileName(rotationMode);
  const filePath = path.join(dataDir, fileName);

  // Costruisce una stringa multi-riga JSONL (una riga per evento + newline finale)
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';

  try {
    fs.appendFileSync(filePath, lines, 'utf8');
  } catch (err) {
    console.error(`${LOG_PREFIX} ERROR: impossibile scrivere su ${filePath}: ${err.message}`);
  }
}

/**
 * Elimina i file JSONL più vecchi del numero di giorni specificato (retention policy).
 * Considera solo i file con il pattern "analytics*.jsonl" nella directory dati.
 * Non tocca file con altri nomi.
 *
 * @param {string} dataDir      - Path assoluto alla directory dati
 * @param {number} retentionDays - Numero di giorni di dati da conservare
 */
function cleanOldFiles(dataDir, retentionDays) {
  if (!fs.existsSync(dataDir)) return;
  if (retentionDays <= 0) return;

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let files;
  try {
    files = fs.readdirSync(dataDir);
  } catch (err) {
    console.warn(`${LOG_PREFIX} WARNING: impossibile leggere la directory dati per la pulizia: ${err.message}`);
    return;
  }

  let deletedCount = 0;
  for (const file of files) {
    if (!file.startsWith('analytics') || !file.endsWith('.jsonl')) continue;

    const filePath = path.join(dataDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoffMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} WARNING: impossibile processare ${file} durante la pulizia: ${err.message}`);
    }
  }

  if (deletedCount > 0) {
    console.log(`${LOG_PREFIX} Retention: eliminati ${deletedCount} file più vecchi di ${retentionDays} giorni`);
  }
}

/**
 * Legge e parsea tutti gli eventi da un file JSONL.
 * Le righe non valide (JSON malformato o vuote) vengono silenziosamente ignorate.
 *
 * @param {string} filePath - Path assoluto al file .jsonl
 * @returns {Array<object>} Array di eventi parsati (può essere vuoto)
 */
function readEventsFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`${LOG_PREFIX} WARNING: impossibile leggere ${filePath}: ${err.message}`);
    return [];
  }
}

/**
 * Elenca tutti i file JSONL nella directory dati, ordinati cronologicamente.
 *
 * @param {string} dataDir - Path assoluto alla directory dati
 * @returns {Array<string>} Array di path assoluti ai file .jsonl
 */
function listDataFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];

  try {
    return fs.readdirSync(dataDir)
      .filter(f => f.startsWith('analytics') && f.endsWith('.jsonl'))
      .sort() // Ordine lessicografico = ordine cronologico grazie al formato YYYY-MM-DD
      .map(f => path.join(dataDir, f));
  } catch (err) {
    console.warn(`${LOG_PREFIX} WARNING: impossibile leggere la directory dati: ${err.message}`);
    return [];
  }
}

module.exports = {
  getFileName,
  writeEvents,
  cleanOldFiles,
  readEventsFromFile,
  listDataFiles,
  ensureDataDir,
};
