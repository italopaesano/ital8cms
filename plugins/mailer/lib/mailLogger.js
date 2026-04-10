'use strict';

const fs = require('fs');
const path = require('path');
const json5 = require('json5');

const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

/**
 * MailLogger — Log persistente degli invii email
 *
 * Mantiene uno storico degli invii in mailerLog.json5.
 * Le entry più recenti sono in cima (ordine cronologico inverso).
 * Il numero massimo di entry è configurabile (maxEntries).
 *
 * Formato entry:
 * {
 *   id:         string,   // ID univoco (stesso della coda)
 *   timestamp:  string,   // ISO 8601
 *   to:         string[], // Destinatari
 *   subject:    string,
 *   transport:  string,   // "smtp" | "fake"
 *   status:     string,   // "sent" | "failed" | "dead"
 *   attempts:   number,   // Tentativi totali
 *   durationMs: number|null,
 *   error:      string|null,
 * }
 */
class MailLogger {
  /**
   * @param {string} pluginFolder - Path root del plugin
   * @param {object} logConfig    - { enabled: boolean, maxEntries: number }
   */
  constructor(pluginFolder, logConfig) {
    this._logPath = path.join(pluginFolder, 'mailerLog.json5');
    this._config  = logConfig;
    this._entries = [];
    this._load();
  }

  /**
   * Aggiunge un'entry al log e persiste su disco
   * @param {object} entry
   * @param {string}   entry.id
   * @param {string[]} entry.to
   * @param {string}   entry.subject
   * @param {string}   entry.transport
   * @param {string}   entry.status      - "sent" | "failed" | "dead"
   * @param {number}   entry.attempts
   * @param {number}   [entry.durationMs]
   * @param {string}   [entry.error]
   */
  log(entry) {
    if (!this._config.enabled) return;

    const logEntry = {
      id:         entry.id,
      timestamp:  new Date().toISOString(),
      to:         Array.isArray(entry.to) ? entry.to : [entry.to],
      subject:    entry.subject,
      transport:  entry.transport,
      status:     entry.status,
      attempts:   entry.attempts,
      durationMs: entry.durationMs || null,
      error:      entry.error      || null,
    };

    this._entries.unshift(logEntry); // più recente in cima

    if (this._entries.length > this._config.maxEntries) {
      this._entries = this._entries.slice(0, this._config.maxEntries);
    }

    this._save();
  }

  /**
   * Restituisce tutte le entry del log (per adminMailer)
   * @returns {Array}
   */
  getEntries() {
    return this._entries;
  }

  // ── Persistenza ──────────────────────────────────────────────────────────────

  _load() {
    if (!this._config.enabled) return;

    try {
      if (fs.existsSync(this._logPath)) {
        const content = fs.readFileSync(this._logPath, 'utf8');
        const parsed  = json5.parse(content);
        this._entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    } catch (err) {
      console.warn('[mailer/mailLogger] Impossibile caricare mailerLog.json5:', err.message);
      this._entries = [];
    }
  }

  _save() {
    try {
      const data     = { entries: this._entries };
      const tempPath = this._logPath + '.tmp';
      fs.writeFileSync(tempPath, JSON5_HEADER + JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.renameSync(tempPath, this._logPath);
    } catch (err) {
      console.warn('[mailer/mailLogger] Impossibile salvare mailerLog.json5:', err.message);
    }
  }
}

module.exports = MailLogger;
