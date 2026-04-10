'use strict';

const nodemailer = require('nodemailer');
const BaseTransport = require('./baseTransport');

/**
 * SmtpTransport — Invio email reale via nodemailer SMTP
 *
 * Crea una nuova connessione SMTP per ogni email (pool: false, default nodemailer).
 * La password SMTP viene letta esclusivamente dall'env var configurata in
 * pluginConfig.json5 → custom.smtp.passwordEnvVar.
 *
 * Supporta:
 *   - STARTTLS (porta 587, secure: false)
 *   - TLS diretto (porta 465, secure: true)
 */
class SmtpTransport extends BaseTransport {
  /**
   * @param {object} smtpConfig               - Config da pluginConfig.custom.smtp
   * @param {string} smtpConfig.host
   * @param {number} smtpConfig.port
   * @param {boolean} smtpConfig.secure
   * @param {string} smtpConfig.user
   * @param {string} smtpConfig.passwordEnvVar - Nome env var per la password
   */
  constructor(smtpConfig) {
    super();
    this._config = smtpConfig;
    this._password = process.env[smtpConfig.passwordEnvVar] || null;
  }

  getName() {
    return 'smtp';
  }

  /**
   * Costruisce un transporter nodemailer (nuova connessione per ogni invio)
   * @returns {object} nodemailer transporter
   */
  _buildTransporter() {
    return nodemailer.createTransport({
      host:   this._config.host,
      port:   this._config.port,
      secure: this._config.secure,
      auth: {
        user: this._config.user,
        pass: this._password,
      },
      // pool: false è il default nodemailer → nuova connessione per ogni email
    });
  }

  async send(options) {
    const transporter = this._buildTransporter();
    try {
      const result = await transporter.sendMail(options);
      return { messageId: result.messageId };
    } finally {
      transporter.close();
    }
  }

  async verify() {
    const start = Date.now();
    const transporter = this._buildTransporter();
    try {
      await transporter.verify();
      return { success: true, latencyMs: Date.now() - start, error: null };
    } catch (err) {
      return { success: false, latencyMs: null, error: err.message };
    } finally {
      transporter.close();
    }
  }
}

module.exports = SmtpTransport;
