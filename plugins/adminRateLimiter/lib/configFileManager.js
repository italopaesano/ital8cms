/**
 * configFileManager.js — operazioni filesystem per adminRateLimiter.
 *
 * Legge/scrive i file di configurazione del plugin di servizio `rateLimiter`
 * (protectedRoutes.json5, pluginConfig.json5) con scrittura atomica e backup
 * a rotazione. NON contiene logica di validazione: quella è riusata dal
 * `rateLimiter` tramite l'oggetto condiviso (validateRules/validateConfig).
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Legge il contenuto grezzo di un file (stringa). Lancia se assente. */
function readRaw(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Crea un backup timestamped del file in backupDir e applica la retention
 * (mantiene al massimo `maxBackups` backup per file base).
 */
function backup(filePath, backupDir, maxBackups = 10) {
  if (!fs.existsSync(filePath)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(filePath, path.join(backupDir, `${base}.${stamp}.bak`));

  // Retention: tieni solo gli ultimi maxBackups per questo file base
  const prefix = base + '.';
  const backups = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
    .sort(); // i timestamp ISO ordinano cronologicamente
  while (backups.length > maxBackups) {
    const oldest = backups.shift();
    try { fs.unlinkSync(path.join(backupDir, oldest)); } catch (e) { /* ignora */ }
  }
}

/** Scrittura atomica: scrive su file temporaneo e poi rinomina. */
function writeAtomic(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { readRaw, backup, writeAtomic };
