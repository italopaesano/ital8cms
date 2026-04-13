'use strict';

const SmtpTransport = require('./transports/smtpTransport');
const FakeTransport = require('./transports/fakeTransport');

/**
 * Risolve il nome effettivo del transport in base alla config e al debugMode.
 *
 * Logica:
 *   "auto" + debugMode >= 1  →  "fake"
 *   "auto" + debugMode == 0  →  "smtp"
 *   "smtp"                   →  "smtp"  (anche in debug)
 *   "fake"                   →  "fake"  (anche in produzione)
 *
 * @param {string} transportConfig - Valore di pluginConfig.custom.transport
 * @param {number} debugMode       - Valore di ital8Config.debugMode
 * @returns {string} "smtp" | "fake"
 */
function resolveTransportName(transportConfig, debugMode) {
  if (transportConfig === 'auto') {
    return debugMode >= 1 ? 'fake' : 'smtp';
  }
  return transportConfig;
}

/**
 * Factory: crea il transport appropriato in base alla configurazione.
 *
 * Aggiungere un nuovo transport futuro (es. SendGrid):
 *   1. Creare lib/transports/sendgridTransport.js che estende BaseTransport
 *   2. Aggiungere il case "sendgrid" qui sotto
 *   3. Nessuna modifica necessaria al resto del sistema
 *
 * @param {object} custom       - Sezione custom di pluginConfig.json5
 * @param {number} debugMode    - Valore di ital8Config.debugMode
 * @param {string} pluginFolder - Path root del plugin (per FakeTransport)
 * @returns {BaseTransport}
 * @throws {Error} se il transport non è riconosciuto
 */
function createTransport(custom, debugMode, pluginFolder) {
  const transportName = resolveTransportName(custom.transport, debugMode);

  if (transportName === 'smtp') {
    return new SmtpTransport(custom.smtp);
  }

  if (transportName === 'fake') {
    return new FakeTransport(custom.fake, pluginFolder);
  }

  // Estensioni future: aggiungere case qui
  // if (transportName === 'sendgrid') return new SendGridTransport(custom.sendgrid);
  // if (transportName === 'mailgun')  return new MailgunTransport(custom.mailgun);

  throw new Error(
    `[mailer/transportFactory] Transport non riconosciuto: "${transportName}". ` +
    `Valori validi: "smtp", "fake", "auto".`
  );
}

module.exports = { createTransport, resolveTransportName };
