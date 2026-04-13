'use strict';

const path         = require('path');
const loadJson5    = require('../../core/loadJson5');
const MailerService = require('./lib/mailerService');

/**
 * Plugin mailer — Servizio email per ital8cms
 *
 * Plugin di servizio puro: non ha route pubbliche, non ha UI admin.
 * Fornisce il servizio di invio email agli altri plugin tramite:
 *
 *   const mailer = pluginSys.getSharedObject('mailer');
 *   await mailer.send({ to: 'user@example.com', subject: '...', html: '...' });
 *
 * API esposta (getObjectToShareToOthersPlugin):
 *   send(options)                    → Promise<string>  (ID in coda)
 *   sendTemplate(name, to, vars)     → Promise<string>
 *   testConnection()                 → Promise<{ success, latencyMs, error }>
 *   getStatus()                      → { configured, transport, queueSize, ... }
 *   onMailEvent(callback)            → void
 *   reload()                         → Promise<void>
 *
 * Configurazione: plugins/mailer/pluginConfig.json5 (custom section)
 * Password SMTP: variabile d'ambiente (nome configurabile, default MAILER_SMTP_PASSWORD)
 */

/** @type {MailerService|null} */
let mailerService = null;

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

async function loadPlugin(pluginSys, pathPluginFolder) {
  // Legge debugMode da ital8Config.json5
  const ital8Conf = loadJson5(path.join(pathPluginFolder, '../../ital8Config.json5'));
  const debugMode = ital8Conf.debugMode || 0;

  mailerService = new MailerService(pathPluginFolder, debugMode);
  mailerService.initialize();
}

async function installPlugin(pluginSys, pathPluginFolder) {
  console.log('[mailer] Plugin installato correttamente.');
}

async function uninstallPlugin(pluginSys, pathPluginFolder) {
  if (mailerService) {
    mailerService.shutdown();
    mailerService = null;
  }
  console.log('[mailer] Plugin disinstallato.');
}

async function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
  console.log(`[mailer] Upgrade ${oldVersion} → ${newVersion}`);
  // Aggiungere eventuali migrazioni di dati per versioni future
}

// ── Route e middleware ────────────────────────────────────────────────────────

function getRouteArray() {
  // Plugin di servizio puro: nessuna route pubblica.
  // Le funzionalità sono accessibili solo via getSharedObject('mailer').
  return [];
}

function getMiddlewareToAdd() {
  return [];
}

// ── Template functions ────────────────────────────────────────────────────────

function getObjectToShareToWebPages() {
  // Nessun oggetto esposto direttamente ai template EJS pubblici.
  // I template accedono al mailer tramite i plugin che lo utilizzano.
  return {};
}

// ── Inter-plugin communication ────────────────────────────────────────────────

/**
 * Espone l'API del servizio email agli altri plugin.
 *
 * Utilizzo da un altro plugin:
 *   // Via push (durante init, in setSharedObject):
 *   this.mailer = sharedObject;
 *
 *   // Via pull (on-demand, in route handler):
 *   const mailer = pluginSys.getSharedObject('mailer');
 *
 * @param {string} forPlugin - Nome del plugin richiedente (non usato: tutti ricevono la stessa API)
 * @returns {object} API del servizio email
 */
function getObjectToShareToOthersPlugin(forPlugin) {
  if (!mailerService) {
    console.warn('[mailer] getObjectToShareToOthersPlugin() chiamato prima di loadPlugin()');
    return {};
  }

  return {
    /**
     * Invia un'email (aggiunge alla coda persistente)
     * @param {object} options - { to, subject, html?, text?, from?, cc?, bcc?, replyTo?, attachments? }
     * @returns {Promise<string>} ID entry in coda
     */
    send: (options) => mailerService.send(options),

    /**
     * Invia un'email tramite template EJS
     * @param {string}          templateName - Nome template in plugins/mailer/templates/
     * @param {string|string[]} to           - Destinatario/i
     * @param {object}          vars         - Variabili per il template (vars.subject REQUIRED)
     * @returns {Promise<string>} ID entry in coda
     */
    sendTemplate: (templateName, to, vars) => mailerService.sendTemplate(templateName, to, vars),

    /**
     * Verifica la connessione al servizio email
     * @returns {Promise<{ success: boolean, latencyMs: number|null, error: string|null }>}
     */
    testConnection: () => mailerService.testConnection(),

    /**
     * Stato del servizio
     * @returns {{ configured, transport, queueSize, deadLetterCount, lastSentAt, lastErrorAt, lastError }}
     */
    getStatus: () => mailerService.getStatus(),

    /**
     * Registra un listener per gli eventi del mailer
     * Eventi: "mailQueued", "mailSent", "mailFailed", "mailDead"
     * @param {Function} callback - (eventName: string, data: object) => void
     */
    onMailEvent: (callback) => mailerService.onMailEvent(callback),

    /**
     * Hot-reload della configurazione (chiamato da adminMailer dopo modifiche)
     * @returns {Promise<void>}
     */
    reload: () => mailerService.reload(),
  };
}

function setSharedObject(fromPlugin, sharedObject) {
  // Il plugin mailer non dipende da altri plugin in questa versione.
  // Estensioni future potrebbero usare dbApi per la coda persistente.
}

// ── Page hooks ────────────────────────────────────────────────────────────────

function getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  return '';
}

// ── Export standard plugin ────────────────────────────────────────────────────

module.exports = {
  loadPlugin,
  installPlugin,
  uninstallPlugin,
  upgradePlugin,
  getRouteArray,
  getMiddlewareToAdd,
  getObjectToShareToWebPages,
  getObjectToShareToOthersPlugin,
  setSharedObject,
  getHooksPage,
};
