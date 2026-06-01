/**
 * attemptLog.js
 *
 * Audit log append-only in formato JSONL (una riga JSON per evento).
 * Tiene traccia di fallimenti e blocchi. Quando il file supera una certa
 * dimensione viene ruotato in logs/archive/ con timestamp nel nome; gli archivi
 * più vecchi di `retentionDays` vengono cancellati.
 *
 * Il logging non deve MAI interrompere il flusso di autenticazione: ogni errore
 * di I/O viene catturato e degradato a warning.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../core/logger');

const LOG_PREFIX = 'rateLimiter';

class AttemptLog {
  /**
   * @param {string} pluginFolder - Path assoluto della cartella del plugin
   * @param {object} config - custom.log: { enabled, rotateWhenBytes, retentionDays }
   */
  constructor(pluginFolder, config = {}) {
    this.logDir = path.join(pluginFolder, 'logs');
    this.archiveDir = path.join(this.logDir, 'archive');
    this.filePath = path.join(this.logDir, 'attempts.jsonl');
    this.rotateWhenBytes = typeof config.rotateWhenBytes === 'number' ? config.rotateWhenBytes : 1048576;
    this.retentionDays = typeof config.retentionDays === 'number' ? config.retentionDays : 30;
  }

  /** Crea le directory necessarie. */
  init() {
    try {
      fs.mkdirSync(this.archiveDir, { recursive: true });
      this._cleanupRetention();
    } catch (err) {
      logger.warn(LOG_PREFIX, `Impossibile inizializzare la directory di log: ${err.message}`);
    }
  }

  /**
   * Aggiunge un evento all'audit log (JSONL). Esegue la rotazione se necessario.
   * @param {object} event - evento dal motore (campo `at` = epoch ms)
   */
  append(event) {
    try {
      this._rotateIfNeeded();

      const { at, ...rest } = event;
      const record = {
        ts: new Date(at || Date.now()).toISOString(),
        ...rest,
      };
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      logger.warn(LOG_PREFIX, `Scrittura audit log fallita: ${err.message}`);
    }
  }

  /**
   * Legge gli ultimi eventi dall'audit log corrente (per la GUI admin).
   * Scorre il file dal fondo e restituisce dal più recente, con filtri opzionali.
   * @param {object} [opts] - { limit=100, clientId?, ruleName?, event? }
   * @returns {Array<object>} eventi parsati (dal più recente)
   */
  readRecent(opts = {}) {
    const limit = (typeof opts.limit === 'number' && opts.limit > 0) ? opts.limit : 100;
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      return []; // file non ancora creato
    }

    const lines = raw.split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (e) {
        continue; // riga corrotta: salta
      }
      if (opts.clientId && rec.clientId !== opts.clientId) continue;
      if (opts.ruleName && rec.ruleName !== opts.ruleName) continue;
      if (opts.event && rec.event !== opts.event) continue;
      out.push(rec);
    }
    return out;
  }

  // ── Private ──

  _rotateIfNeeded() {
    let size = 0;
    try {
      size = fs.statSync(this.filePath).size;
    } catch (e) {
      return; // file non ancora esistente
    }

    if (size < this.rotateWhenBytes) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.archiveDir, `attempts-${stamp}.jsonl`);
    try {
      fs.renameSync(this.filePath, dest);
      this._cleanupRetention();
    } catch (err) {
      logger.warn(LOG_PREFIX, `Rotazione audit log fallita: ${err.message}`);
    }
  }

  _cleanupRetention() {
    if (!this.retentionDays || this.retentionDays <= 0) return;
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let files;
    try {
      files = fs.readdirSync(this.archiveDir);
    } catch (e) {
      return;
    }
    for (const name of files) {
      const full = path.join(this.archiveDir, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
        }
      } catch (e) {
        // ignora il singolo file problematico
      }
    }
  }
}

module.exports = AttemptLog;
