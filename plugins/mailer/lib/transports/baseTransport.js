'use strict';

/**
 * BaseTransport — Interfaccia astratta per i transport email
 *
 * Ogni transport deve estendere questa classe e implementare i tre metodi.
 * Questo design permette di aggiungere nuovi transport (SendGrid, Mailgun,
 * AWS SES, ecc.) senza modificare il resto del plugin.
 *
 * Implementazioni v1:
 *   - SmtpTransport  → invio reale via nodemailer SMTP
 *   - FakeTransport  → simulazione (console + file), per sviluppo/test
 *
 * Implementazioni future:
 *   - SendGridTransport, MailgunTransport, AwsSesTransport, ecc.
 */
class BaseTransport {
  /**
   * Restituisce il nome identificativo del transport
   * @returns {string} es. "smtp" | "fake" | "sendgrid"
   */
  getName() {
    throw new Error(
      `[BaseTransport] getName() non implementato in ${this.constructor.name}`
    );
  }

  /**
   * Invia un'email
   * @param {object} options - Opzioni email compatibili con nodemailer
   * @param {string|string[]} options.to
   * @param {string}          options.subject
   * @param {string}          [options.from]
   * @param {string|string[]} [options.cc]
   * @param {string|string[]} [options.bcc]
   * @param {string}          [options.replyTo]
   * @param {string}          [options.html]
   * @param {string}          [options.text]
   * @param {Array}           [options.attachments]
   * @returns {Promise<{ messageId: string }>}
   * @throws {Error} se l'invio fallisce
   */
  async send(options) {
    throw new Error(
      `[BaseTransport] send() non implementato in ${this.constructor.name}`
    );
  }

  /**
   * Verifica la connessione/disponibilità del servizio email
   * @returns {Promise<{ success: boolean, latencyMs: number|null, error: string|null }>}
   */
  async verify() {
    throw new Error(
      `[BaseTransport] verify() non implementato in ${this.constructor.name}`
    );
  }
}

module.exports = BaseTransport;
