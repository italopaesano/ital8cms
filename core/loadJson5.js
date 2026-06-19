/**
 * JSON5 Loader Module
 *
 * Centralized JSON5 file loading with support for comments and trailing commas.
 * All configuration files in this project use JSON5 format (.json5 extension).
 *
 * loadJson5() è una utility di BASSO LIVELLO: in caso di errore LANCIA un Error
 * con messaggio chiaro — distingue "file non trovato" / "sintassi JSON5 non
 * valida" / "altro errore di lettura" — ma NON stampa nulla di suo. La
 * PRESENTAZIONE spetta al chiamante: i chiamanti "soft" (es. sessionSecurity,
 * themeSys) trattano il fallimento come non fatale (warning + fallback), mentre
 * al boot, per i config critici, si usa warnConfigError() per un box [CONFIG]
 * prominente prima di uscire. (Throw-only: evita doppio output con i box di boot.)
 *
 * Usage:
 *   const loadJson5 = require('./core/loadJson5');
 *   const config = loadJson5('./ital8Config.json5');
 */

const json5 = require('json5');
const fs = require('fs');
const path = require('path');

/**
 * Load and parse a JSON5 file.
 * @param {string} filePath - Absolute or relative path to JSON5 file
 * @param {string} [callerDir] - Directory of the calling file (optional, for relative paths)
 * @returns {any} - Parsed JSON5 object
 * @throws {Error} - Errore con messaggio chiaro; `.code` propagato (ENOENT) o
 *                   `'JSON5_PARSE_ERROR'`; `.cause` = errore originale.
 */
function loadJson5(filePath, callerDir = null) {
  // Risoluzione del path: se relativo usa callerDir, altrimenti cwd.
  let resolvedPath = filePath;
  if (!path.isAbsolute(filePath) && callerDir) {
    resolvedPath = path.resolve(callerDir, filePath);
  } else if (!path.isAbsolute(filePath)) {
    resolvedPath = path.resolve(process.cwd(), filePath);
  }

  // Lettura del file: distingue "non trovato" (ENOENT) da altri errori di IO.
  let fileContent;
  try {
    fileContent = fs.readFileSync(resolvedPath, 'utf8');
  } catch (readError) {
    const reason = (readError && readError.code === 'ENOENT')
      ? `file di configurazione non trovato: ${filePath}`
      : `impossibile leggere il file di configurazione ${filePath}: ${readError.message}`;
    const wrapped = new Error(reason, { cause: readError });
    if (readError && readError.code) wrapped.code = readError.code;
    throw wrapped;
  }

  // Parsing JSON5: un fallimento qui è SEMPRE un errore di sintassi.
  try {
    return json5.parse(fileContent);
  } catch (parseError) {
    // json5.parse lancia un SyntaxError con messaggio del tipo
    // "JSON5: invalid character '…' at line N column M".
    const wrapped = new Error(
      `sintassi JSON5 non valida in ${filePath}: ${parseError.message}`,
      { cause: parseError }
    );
    wrapped.code = 'JSON5_PARSE_ERROR';
    throw wrapped;
  }
}

/**
 * Stampa un box [CONFIG] prominente e azionabile per un errore di caricamento di
 * un file di configurazione (tipicamente al boot, per i config critici). Stessa
 * filosofia di httpsManager.warnPrivilegedPort() e processSafetyNet.warnFatalError():
 * prominente, chiaro, actionable. NON esce dal processo — la decisione spetta al
 * chiamante (di norma process.exit(1) subito dopo).
 *
 * @param {string} fileLabel - Etichetta del file (es. 'ital8Config.json5')
 * @param {Error} error - L'errore lanciato da loadJson5()
 */
function warnConfigError(fileLabel, error) {
  const line = '[CONFIG] ' + '═'.repeat(58);
  const detail = (error && error.message) ? error.message : String(error);
  const notFound = !!(error && error.code === 'ENOENT');

  const lines = [
    '',
    line,
    `[CONFIG]  🔴  Configurazione non valida: ${fileLabel}`,
    line,
    `[CONFIG]    ${detail}`,
    '[CONFIG]',
  ];

  if (notFound) {
    lines.push(
      '[CONFIG]  Il file di configurazione non esiste nel percorso atteso.',
      '[CONFIG]  Verifica il percorso, oppure ripristina il file dal repository',
      '[CONFIG]  o da un backup.',
    );
  } else {
    lines.push(
      '[CONFIG]  Il file contiene un errore di sintassi JSON5: controlla il punto',
      '[CONFIG]  indicato sopra (riga/colonna). JSON5 ammette commenti e virgole',
      '[CONFIG]  finali, ma stringhe e parentesi devono essere bilanciate.',
      '[CONFIG]  Suggerimento: valida il file con un linter JSON5.',
    );
  }

  lines.push(
    '[CONFIG]',
    '[CONFIG]  ▶ Avvio interrotto (configurazione non caricabile).',
    line,
    '',
  );

  console.error(lines.join('\n'));
}

loadJson5.warnConfigError = warnConfigError;
module.exports = loadJson5;
