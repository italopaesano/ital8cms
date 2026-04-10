'use strict';

const fs   = require('fs');
const path = require('path');
const json5 = require('json5');

const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

/**
 * MailQueue — Coda email persistente con worker retry
 *
 * Le email vengono salvate in mailerQueue.json5 e processate dal worker.
 * Il worker parte immediatamente + ripete ogni pollingIntervalSeconds.
 *
 * Stati di un'entry in coda:
 *   "pending"    → in attesa di essere inviata (non ancora tentata)
 *   "processing" → invio in corso (lock temporaneo durante il tentativo)
 *   "sent"       → inviata con successo (rimane nella coda per storico)
 *   "failed"     → ultimo tentativo fallito, nextRetryAt schedulato
 *   "dead"       → tutti i retry esauriti, non verrà mai più ritentata
 *
 * Crash recovery: al riavvio le entry "processing" vengono riportate a
 * "pending" perché il loro tentativo di invio è stato interrotto.
 */
class MailQueue {
  /**
   * @param {object} options
   * @param {string}         options.pluginFolder  - Path root del plugin
   * @param {object}         options.queueConfig   - { pollingIntervalSeconds, maxRetries, retryIntervals, warningThreshold }
   * @param {BaseTransport}  options.transport     - Istanza transport attiva
   * @param {MailLogger}     options.logger        - Istanza logger
   * @param {MailEventBus}   options.eventBus      - Istanza event bus
   */
  constructor({ pluginFolder, queueConfig, transport, logger, eventBus }) {
    this._queuePath  = path.join(pluginFolder, 'mailerQueue.json5');
    this._config     = queueConfig;
    this._transport  = transport;
    this._logger     = logger;
    this._eventBus   = eventBus;
    this._entries    = [];
    this._workerTimer = null;
    this._processing  = false;

    this._load();
  }

  // ── API pubblica ──────────────────────────────────────────────────────────────

  /**
   * Aggiunge un'email alla coda, persiste su disco, processa immediatamente.
   * @param {object} mailOptions - Opzioni email complete
   * @returns {Promise<string>}  - ID dell'entry creata
   */
  async add(mailOptions) {
    const entry = {
      id:          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      addedAt:     new Date().toISOString(),
      from:        mailOptions.from        || '',
      to:          Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      cc:          mailOptions.cc  ? (Array.isArray(mailOptions.cc)  ? mailOptions.cc  : [mailOptions.cc])  : [],
      bcc:         mailOptions.bcc ? (Array.isArray(mailOptions.bcc) ? mailOptions.bcc : [mailOptions.bcc]) : [],
      replyTo:     mailOptions.replyTo     || '',
      subject:     mailOptions.subject,
      html:        mailOptions.html        || null,
      text:        mailOptions.text        || null,
      attachments: mailOptions.attachments || [],
      attempts:    0,
      nextRetryAt: null,
      status:      'pending',
      lastError:   null,
      lastAttemptAt: null,
      sentAt:      null,
    };

    this._entries.push(entry);
    this._checkThreshold();
    this._save();

    this._eventBus.emit('mailQueued', {
      id:      entry.id,
      to:      entry.to,
      subject: entry.subject,
      addedAt: entry.addedAt,
    });

    // Processamento immediato (fire-and-forget, errori interni già gestiti)
    this._processQueue().catch(err => {
      console.warn('[mailer/mailQueue] Errore nel processamento immediato:', err.message);
    });

    return entry.id;
  }

  /**
   * Avvia il worker periodico di processamento
   */
  startWorker() {
    if (this._workerTimer) return;

    const intervalMs = this._config.pollingIntervalSeconds * 1000;
    this._workerTimer = setInterval(() => {
      this._processQueue().catch(err => {
        console.warn('[mailer/mailQueue] Errore nel worker periodico:', err.message);
      });
    }, intervalMs);

    // unref(): il timer non impedisce al processo di terminare normalmente
    if (this._workerTimer.unref) this._workerTimer.unref();

    console.log(
      `[mailer/mailQueue] Worker avviato (polling ogni ${this._config.pollingIntervalSeconds}s)`
    );
  }

  /**
   * Ferma il worker periodico (chiamato da shutdown/reload)
   */
  stopWorker() {
    if (this._workerTimer) {
      clearInterval(this._workerTimer);
      this._workerTimer = null;
      console.log('[mailer/mailQueue] Worker fermato');
    }
  }

  /**
   * Sostituisce il transport attivo (usato da reload())
   * @param {BaseTransport} transport
   */
  setTransport(transport) {
    this._transport = transport;
  }

  /**
   * Restituisce le statistiche della coda
   * @returns {{ queueSize: number, deadLetterCount: number }}
   */
  getStats() {
    const queueSize       = this._entries.filter(e => e.status === 'pending' || e.status === 'failed').length;
    const deadLetterCount = this._entries.filter(e => e.status === 'dead').length;
    return { queueSize, deadLetterCount };
  }

  // ── Logica interna ────────────────────────────────────────────────────────────

  /**
   * Processa le email pending o failed con nextRetryAt <= now
   */
  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    try {
      const now        = new Date();
      const toProcess  = this._entries.filter(e =>
        e.status === 'pending' ||
        (e.status === 'failed' && e.nextRetryAt && new Date(e.nextRetryAt) <= now)
      );

      for (const entry of toProcess) {
        await this._sendEntry(entry);
      }
    } finally {
      this._processing = false;
    }
  }

  /**
   * Tenta l'invio di una singola entry, aggiorna lo stato e persiste
   * @param {object} entry
   */
  async _sendEntry(entry) {
    entry.status        = 'processing';
    entry.lastAttemptAt = new Date().toISOString();
    entry.attempts     += 1;

    const start = Date.now();

    try {
      await this._transport.send({
        from:        entry.from        || undefined,
        to:          entry.to,
        cc:          entry.cc.length   ? entry.cc   : undefined,
        bcc:         entry.bcc.length  ? entry.bcc  : undefined,
        replyTo:     entry.replyTo     || undefined,
        subject:     entry.subject,
        html:        entry.html        || undefined,
        text:        entry.text        || undefined,
        attachments: entry.attachments.length ? entry.attachments : undefined,
      });

      // ── Successo ─────────────────────────────────────────────────────────────
      const durationMs = Date.now() - start;
      entry.status    = 'sent';
      entry.sentAt    = new Date().toISOString();
      entry.lastError = null;

      this._logger.log({
        id:         entry.id,
        to:         entry.to,
        subject:    entry.subject,
        transport:  this._transport.getName(),
        status:     'sent',
        attempts:   entry.attempts,
        durationMs,
        error:      null,
      });

      this._eventBus.emit('mailSent', {
        id:        entry.id,
        to:        entry.to,
        subject:   entry.subject,
        transport: this._transport.getName(),
        durationMs,
        attempts:  entry.attempts,
      });

    } catch (err) {
      // ── Fallimento ────────────────────────────────────────────────────────────
      entry.lastError = err.message;
      const durationMs = Date.now() - start;

      if (entry.attempts >= this._config.maxRetries) {
        // Tutti i retry esauriti → dead letter
        entry.status      = 'dead';
        entry.nextRetryAt = null;

        this._logger.log({
          id:         entry.id,
          to:         entry.to,
          subject:    entry.subject,
          transport:  this._transport.getName(),
          status:     'dead',
          attempts:   entry.attempts,
          durationMs,
          error:      err.message,
        });

        this._eventBus.emit('mailDead', {
          id:      entry.id,
          to:      entry.to,
          subject: entry.subject,
          error:   err.message,
          attempts: entry.attempts,
          addedAt: entry.addedAt,
        });

        console.warn(
          `[mailer/mailQueue] ✗ Email "${entry.subject}" → dead letter` +
          ` (${entry.attempts} tentativi esauriti). ID: ${entry.id}`
        );

      } else {
        // Retry schedulato
        entry.status = 'failed';

        // Usa il retryInterval corrispondente al tentativo (ultimo valore come fallback)
        const intervalIndex  = entry.attempts - 1;
        const delaySeconds   = this._config.retryIntervals[intervalIndex]
          ?? this._config.retryIntervals[this._config.retryIntervals.length - 1];
        entry.nextRetryAt    = new Date(Date.now() + delaySeconds * 1000).toISOString();

        this._eventBus.emit('mailFailed', {
          id:          entry.id,
          to:          entry.to,
          subject:     entry.subject,
          error:       err.message,
          attempts:    entry.attempts,
          nextRetryAt: entry.nextRetryAt,
        });

        console.warn(
          `[mailer/mailQueue] ✗ Invio fallito per "${entry.subject}"` +
          ` (tentativo ${entry.attempts}/${this._config.maxRetries}).` +
          ` Retry in ${delaySeconds}s. Errore: ${err.message}`
        );
      }
    }

    this._save();
  }

  /**
   * Emette warning se la coda supera la soglia configurata
   */
  _checkThreshold() {
    const activeCount = this._entries.filter(
      e => e.status === 'pending' || e.status === 'failed'
    ).length;

    if (activeCount > this._config.warningThreshold) {
      console.warn(
        `[mailer/mailQueue] ⚠ ATTENZIONE: la coda email contiene ${activeCount} elementi` +
        ` (soglia warning: ${this._config.warningThreshold}).` +
        ` Verificare la configurazione SMTP o i log di errore.`
      );
    }
  }

  // ── Persistenza ──────────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._queuePath)) {
        const content = fs.readFileSync(this._queuePath, 'utf8');
        const parsed  = json5.parse(content);
        this._entries = Array.isArray(parsed.entries) ? parsed.entries : [];

        // Crash recovery: riporta "processing" → "pending"
        let recovered = 0;
        for (const e of this._entries) {
          if (e.status === 'processing') {
            e.status = 'pending';
            recovered++;
          }
        }
        if (recovered > 0) {
          console.log(
            `[mailer/mailQueue] Crash recovery: ${recovered} email` +
            ` riportate da "processing" a "pending"`
          );
          this._save();
        }

        const stats = this.getStats();
        if (stats.queueSize > 0) {
          console.log(
            `[mailer/mailQueue] Coda caricata: ${stats.queueSize} email in attesa,` +
            ` ${stats.deadLetterCount} dead letter`
          );
        }
      }
    } catch (err) {
      console.warn('[mailer/mailQueue] Impossibile caricare mailerQueue.json5:', err.message);
      this._entries = [];
    }
  }

  _save() {
    try {
      const data     = { entries: this._entries };
      const tempPath = this._queuePath + '.tmp';
      fs.writeFileSync(tempPath, JSON5_HEADER + JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.renameSync(tempPath, this._queuePath);
    } catch (err) {
      console.warn('[mailer/mailQueue] Impossibile salvare mailerQueue.json5:', err.message);
    }
  }
}

module.exports = MailQueue;
