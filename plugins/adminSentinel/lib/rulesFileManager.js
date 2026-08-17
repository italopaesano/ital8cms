/**
 * rulesFileManager.js
 *
 * Lettura e scrittura del file di regole **come testo grezzo**, per l'editor
 * JSON5 della Vista B.
 *
 * ─── PERCHE TESTO E NON OGGETTO ───────────────────────────────────────────────
 * L'editor raw esiste proprio per lasciar scrivere all'amministratore quello che
 * vuole, commenti compresi. Se il salvataggio passasse da `parse` → `stringify`,
 * l'editor restituirebbe un file diverso da quello inviato: sparirebbero i
 * commenti, l'indentazione e l'ordine delle chiavi. Qui il testo dell'utente
 * viene scritto **così com'è**, dopo essere stato validato.
 *
 * ─── PERCHE I BACKUP STANNO NEL TWIN ──────────────────────────────────────────
 * Il service non ne ha bisogno: scrive solo modifiche chirurgiche verificate. È
 * l'editor raw a poter distruggere un file in un colpo solo — un incolla
 * sbagliato, una selezione parziale — quindi il backup appartiene a chi offre
 * quella possibilità.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKUP_DIR_NAME = 'backups';
const BACKUP_PREFIX = 'sentinelRules';

/**
 * Legge il file di regole come testo.
 *
 * @param {string} filePath
 * @returns {{ ok: boolean, content: string, error: string|null, mtime: string|null }}
 */
function readRaw(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const mtime = fs.statSync(filePath).mtime.toISOString();
    return { ok: true, content, error: null, mtime };
  } catch (err) {
    return { ok: false, content: '', error: err.message, mtime: null };
  }
}

/**
 * Solo l'mtime, senza leggere il contenuto.
 *
 * Serve alla guardia contro la sovrascrittura: si confronta l'istante che il
 * client ha visto caricando con quello che il file ha adesso. Leggere l'intero
 * file per ricavarne una data sarebbe sprecato proprio nel percorso di
 * salvataggio, che è quello che deve essere veloce.
 *
 * @param {string} filePath
 * @returns {string|null} ISO, oppure null se il file non c'è o non si legge
 */
function currentMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_err) {
    return null;
  }
}

/**
 * Copia il file corrente nella cartella dei backup, con timestamp.
 * Fail-soft: se il backup non riesce lo si segnala, ma non si impedisce il
 * salvataggio — bloccare una correzione urgente perché non si può archiviare la
 * versione rotta sarebbe il peggiore dei compromessi.
 *
 * @returns {{ ok: boolean, file: string|null, error: string|null }}
 */
function createBackup(filePath, ownFolder, maxBackups) {
  const dir = path.join(ownFolder, BACKUP_DIR_NAME);
  try {
    if (!fs.existsSync(filePath)) return { ok: true, file: null, error: null };
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, `${BACKUP_PREFIX}.${stamp}.json5`);
    fs.copyFileSync(filePath, target);

    pruneBackups(dir, maxBackups);
    return { ok: true, file: path.basename(target), error: null };
  } catch (err) {
    return { ok: false, file: null, error: err.message };
  }
}

/** Tiene solo i backup più recenti. */
function pruneBackups(dir, maxBackups) {
  const keep = Number.isFinite(maxBackups) && maxBackups > 0 ? maxBackups : 10;
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.json5'))
      .sort(); // il timestamp ISO nel nome rende l'ordine lessicografico = cronologico
  } catch (_err) {
    return;
  }
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_err) { /* fail-soft */ }
  }
}

/**
 * Scrive il testo fornito, in modo atomico.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {{ ok: boolean, error: string|null }}
 */
function writeRaw(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
    return { ok: true, error: null };
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_e) { /* già assente */ }
    return { ok: false, error: err.message };
  }
}

/** Elenca i backup disponibili, dal più recente. */
function listBackups(ownFolder) {
  const dir = path.join(ownFolder, BACKUP_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.json5'))
      .sort()
      .reverse()
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return { file: f, size: stat.size, mtime: stat.mtime.toISOString() };
      });
  } catch (_err) {
    return [];
  }
}

module.exports = {
  readRaw, writeRaw, currentMtime, createBackup, listBackups, pruneBackups, BACKUP_DIR_NAME,
};
