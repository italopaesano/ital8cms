'use strict';

const fs = require('fs');
const path = require('path');
const json5 = require('json5');
const BaseTransport = require('./baseTransport');

const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

/**
 * FakeTransport — Transport simulato per sviluppo e test
 *
 * Non invia email reali. Ogni invio:
 *   1. Stampa un box visivo in console con i dettagli dell'email
 *   2. Appende l'email a mailerFakeOutbox.json5 (se saveToFile: true)
 *
 * Attivazione:
 *   - Automaticamente quando debugMode >= 1 e transport è "auto"
 *   - Manualmente impostando transport: "fake" in pluginConfig.json5
 */
class FakeTransport extends BaseTransport {
  /**
   * @param {object} fakeConfig                  - Config da pluginConfig.custom.fake
   * @param {boolean} fakeConfig.saveToFile
   * @param {number}  fakeConfig.maxOutboxEntries
   * @param {string}  pluginFolder               - Path root del plugin
   */
  constructor(fakeConfig, pluginFolder) {
    super();
    this._config = fakeConfig;
    this._outboxPath = path.join(pluginFolder, 'mailerFakeOutbox.json5');
  }

  getName() {
    return 'fake';
  }

  async send(options) {
    const messageId = `fake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toList = Array.isArray(options.to) ? options.to.join(', ') : (options.to || '');
    const textPreview = (options.text || '').slice(0, 120);

    console.log('\n[mailer/fake] ══════════════════════════════════════════════════');
    console.log('[mailer/fake]  📧  EMAIL SIMULATA  (transport: fake)');
    console.log('[mailer/fake] ══════════════════════════════════════════════════');
    console.log(`[mailer/fake]  To:      ${toList}`);
    if (options.cc)     console.log(`[mailer/fake]  Cc:      ${Array.isArray(options.cc) ? options.cc.join(', ') : options.cc}`);
    if (options.bcc)    console.log(`[mailer/fake]  Bcc:     ${Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc}`);
    if (options.replyTo) console.log(`[mailer/fake]  ReplyTo: ${options.replyTo}`);
    console.log(`[mailer/fake]  Subject: ${options.subject}`);
    if (textPreview)    console.log(`[mailer/fake]  Text:    ${textPreview}${options.text && options.text.length > 120 ? '...' : ''}`);
    if (options.attachments && options.attachments.length) {
      console.log(`[mailer/fake]  Allegati: ${options.attachments.length}`);
    }
    console.log(`[mailer/fake]  ID:      ${messageId}`);
    console.log('[mailer/fake] ══════════════════════════════════════════════════\n');

    if (this._config.saveToFile) {
      this._appendToOutbox({
        id:          messageId,
        timestamp:   new Date().toISOString(),
        to:          Array.isArray(options.to) ? options.to : [options.to],
        subject:     options.subject,
        html:        options.html   || null,
        text:        options.text   || null,
        attachments: options.attachments || [],
      });
    }

    return { messageId };
  }

  async verify() {
    // Il fake transport è sempre "connesso"
    return { success: true, latencyMs: 0, error: null };
  }

  /**
   * Appende un'entry a mailerFakeOutbox.json5 (scrittura sincrona, file piccolo)
   * @param {object} entry
   */
  _appendToOutbox(entry) {
    try {
      let outbox = { entries: [] };

      if (fs.existsSync(this._outboxPath)) {
        try {
          const content = fs.readFileSync(this._outboxPath, 'utf8');
          outbox = json5.parse(content);
          if (!Array.isArray(outbox.entries)) outbox.entries = [];
        } catch (_) {
          outbox = { entries: [] };
        }
      }

      outbox.entries.unshift(entry); // più recente in cima

      if (outbox.entries.length > this._config.maxOutboxEntries) {
        outbox.entries = outbox.entries.slice(0, this._config.maxOutboxEntries);
      }

      const tempPath = this._outboxPath + '.tmp';
      fs.writeFileSync(tempPath, JSON5_HEADER + JSON.stringify(outbox, null, 2) + '\n', 'utf8');
      fs.renameSync(tempPath, this._outboxPath);
    } catch (err) {
      console.warn('[mailer/fake] Impossibile salvare mailerFakeOutbox.json5:', err.message);
    }
  }
}

module.exports = FakeTransport;
