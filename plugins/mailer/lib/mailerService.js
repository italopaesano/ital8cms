'use strict';

const path             = require('path');
const loadJson5        = require('../../../core/loadJson5');
const { createTransport } = require('./transportFactory');
const MailQueue        = require('./mailQueue');
const MailLogger       = require('./mailLogger');
const MailEventBus     = require('./mailEventBus');
const TemplateRenderer = require('./templateRenderer');
const htmlToText       = require('./htmlToText');

/**
 * MailerService — Orchestratore centrale del plugin mailer
 *
 * Coordina tutti i sottosistemi: transport, queue, logger, eventBus, templateRenderer.
 * Espone l'API pubblica del servizio email, poi resa disponibile agli altri plugin
 * tramite getObjectToShareToOthersPlugin() in main.js.
 *
 * Ciclo di vita:
 *   1. new MailerService(pluginFolder, debugMode)
 *   2. mailerService.initialize()   ← chiamato da loadPlugin()
 *   3. [uso normale del servizio]
 *   4. mailerService.shutdown()     ← chiamato da uninstallPlugin() o graceful shutdown
 */
class MailerService {
  /**
   * @param {string} pluginFolder - Path assoluto della directory del plugin
   * @param {number} debugMode    - Valore di ital8Config.debugMode
   */
  constructor(pluginFolder, debugMode) {
    this._pluginFolder      = pluginFolder;
    this._debugMode         = debugMode;
    this._config            = null;
    this._transport         = null;
    this._queue             = null;
    this._logger            = null;
    this._eventBus          = null;
    this._templateRenderer  = null;
    this._configured        = false;
    this._lastSentAt        = null;
    this._lastErrorAt       = null;
    this._lastError         = null;
  }

  /**
   * Inizializza tutti i sottosistemi e avvia il worker della coda.
   * Chiamato da loadPlugin() in main.js.
   */
  initialize() {
    this._config = loadJson5(path.join(this._pluginFolder, 'pluginConfig.json5'));
    const custom = this._config.custom;

    // 1. Event bus (primo: tutti gli altri lo usano)
    this._eventBus = new MailEventBus();

    // 2. Logger
    this._logger = new MailLogger(this._pluginFolder, custom.log);

    // 3. Template renderer
    this._templateRenderer = new TemplateRenderer(this._pluginFolder);

    // 4. Transport
    this._transport = createTransport(custom, this._debugMode, this._pluginFolder);
    this._checkConfiguration(custom);

    // 5. Coda (usa transport, logger, eventBus già creati)
    this._queue = new MailQueue({
      pluginFolder: this._pluginFolder,
      queueConfig:  custom.queue,
      transport:    this._transport,
      logger:       this._logger,
      eventBus:     this._eventBus,
    });

    // 6. Listener interno per aggiornare lastSentAt / lastError
    this._eventBus.on((eventName, data) => {
      if (eventName === 'mailSent') {
        this._lastSentAt = new Date().toISOString();
      }
      if (eventName === 'mailFailed' || eventName === 'mailDead') {
        this._lastError   = data.error;
        this._lastErrorAt = new Date().toISOString();
      }
    });

    // 7. Avvia worker periodico
    this._queue.startWorker();

    console.log(`[mailer] Inizializzato. Transport: ${this._transport.getName()}`);
  }

  /**
   * Ferma il worker della coda. Chiamato durante lo shutdown del server.
   */
  shutdown() {
    if (this._queue) this._queue.stopWorker();
    console.log('[mailer] Shutdown completato');
  }

  // ── API pubblica ──────────────────────────────────────────────────────────────

  /**
   * Invia un'email aggiungendola alla coda persistente.
   *
   * @param {object}          options
   * @param {string|string[]} options.to          - Destinatario/i (REQUIRED)
   * @param {string}          options.subject     - Oggetto email (REQUIRED)
   * @param {string}          [options.from]      - Mittente (default: config.defaultFrom)
   * @param {string|string[]} [options.cc]
   * @param {string|string[]} [options.bcc]
   * @param {string}          [options.replyTo]
   * @param {string}          [options.html]      - Almeno uno tra html/text REQUIRED
   * @param {string}          [options.text]      - Auto-generato da html se omesso
   * @param {Array}           [options.attachments] - Formato nodemailer
   * @returns {Promise<string>} ID entry in coda
   * @throws {Error} se il servizio non è configurato o le opzioni non sono valide
   */
  async send(options) {
    this._assertConfigured();
    this._validateSendOptions(options);

    const finalOptions = {
      from:        options.from || this._config.custom.defaultFrom,
      to:          options.to,
      cc:          options.cc,
      bcc:         options.bcc,
      replyTo:     options.replyTo,
      subject:     options.subject,
      html:        options.html || null,
      text:        options.text || (options.html ? htmlToText(options.html) : ''),
      attachments: options.attachments || [],
    };

    return await this._queue.add(finalOptions);
  }

  /**
   * Invia un'email renderizzando un template EJS.
   *
   * Il subject deve essere incluso in vars.subject.
   * Le variabili disponibili nel template sono SOLO quelle passate in vars.
   *
   * @param {string}          templateName - Nome template (senza .ejs)
   * @param {string|string[]} to           - Destinatario/i
   * @param {object}          vars         - Variabili per il template (vars.subject REQUIRED)
   * @returns {Promise<string>} ID entry in coda
   * @throws {Error} se il template non esiste o vars.subject manca
   */
  async sendTemplate(templateName, to, vars) {
    this._assertConfigured();

    if (!vars || !vars.subject) {
      throw new Error('[mailer] sendTemplate(): vars.subject è obbligatorio');
    }

    const html = await this._templateRenderer.render(templateName, vars);
    const text = htmlToText(html);

    return await this.send({
      to,
      subject: vars.subject,
      html,
      text,
    });
  }

  /**
   * Verifica la connessione al servizio email (SMTP o altro transport).
   * Utile per adminMailer nella pagina di configurazione.
   *
   * @returns {Promise<{ success: boolean, latencyMs: number|null, error: string|null }>}
   */
  async testConnection() {
    try {
      return await this._transport.verify();
    } catch (err) {
      return { success: false, latencyMs: null, error: err.message };
    }
  }

  /**
   * Restituisce lo stato corrente del servizio.
   * Utile per adminMailer nella dashboard.
   *
   * @returns {{
   *   configured:      boolean,
   *   transport:       string,
   *   queueSize:       number,
   *   deadLetterCount: number,
   *   lastSentAt:      string|null,
   *   lastErrorAt:     string|null,
   *   lastError:       string|null,
   * }}
   */
  getStatus() {
    const stats = this._queue
      ? this._queue.getStats()
      : { queueSize: 0, deadLetterCount: 0 };

    return {
      configured:      this._configured,
      transport:       this._transport ? this._transport.getName() : 'none',
      queueSize:       stats.queueSize,
      deadLetterCount: stats.deadLetterCount,
      lastSentAt:      this._lastSentAt,
      lastErrorAt:     this._lastErrorAt,
      lastError:       this._lastError,
    };
  }

  /**
   * Registra un listener per gli eventi del mailer.
   * Chiamato da altri plugin che vogliono reagire agli eventi email.
   *
   * @param {Function} callback - (eventName: string, data: object) => void
   */
  onMailEvent(callback) {
    this._eventBus.on(callback);
  }

  /**
   * Hot-reload della configurazione.
   * Chiamato da adminMailer dopo aver modificato pluginConfig.json5.
   * Ferma il worker, ricrea il transport, riavvia il worker.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    console.log('[mailer] Reload configurazione in corso...');

    this._queue.stopWorker();

    this._config    = loadJson5(path.join(this._pluginFolder, 'pluginConfig.json5'));
    const custom    = this._config.custom;

    this._transport = createTransport(custom, this._debugMode, this._pluginFolder);
    this._checkConfiguration(custom);

    this._queue.setTransport(this._transport);
    this._queue.startWorker();

    console.log(`[mailer] Reload completato. Nuovo transport: ${this._transport.getName()}`);
  }

  // ── Metodi privati ────────────────────────────────────────────────────────────

  /**
   * Verifica se il servizio è configurato correttamente.
   * Per SMTP controlla la presenza dell'env var della password.
   * Stampa un warning prominente se non configurato.
   */
  _checkConfiguration(custom) {
    const transportName = this._transport.getName();

    if (transportName === 'smtp') {
      const password = process.env[custom.smtp.passwordEnvVar];
      if (!password) {
        this._configured = false;
        const envVar = custom.smtp.passwordEnvVar;
        console.warn('\n[mailer] ══════════════════════════════════════════════════════════');
        console.warn('[mailer]  ⚠  Plugin mailer: configurazione SMTP incompleta');
        console.warn('[mailer] ══════════════════════════════════════════════════════════');
        console.warn(`[mailer]  La variabile d'ambiente "${envVar}" non è impostata.`);
        console.warn('[mailer]  Il servizio email NON è operativo.');
        console.warn('[mailer]');
        console.warn('[mailer]  Soluzioni:');
        console.warn(`[mailer]    A) Imposta la variabile prima di avviare il server:`);
        console.warn(`[mailer]         export ${envVar}=la-tua-password-smtp`);
        console.warn(`[mailer]    B) Usa transport "fake" per sviluppo locale:`);
        console.warn(`[mailer]         Modifica pluginConfig.json5 → custom.transport = "fake"`);
        console.warn('[mailer] ══════════════════════════════════════════════════════════\n');
      } else {
        this._configured = true;
      }
    } else {
      // FakeTransport e altri non richiedono env var
      this._configured = true;
    }
  }

  /**
   * Lancia un errore se il servizio non è configurato
   */
  _assertConfigured() {
    if (!this._configured) {
      const envVar = this._config.custom.smtp.passwordEnvVar;
      throw new Error(
        `[mailer] Servizio non configurato: la variabile d'ambiente "${envVar}" non è impostata. ` +
        `Imposta la variabile o usa transport "fake" in pluginConfig.json5.`
      );
    }
  }

  /**
   * Valida le opzioni minime per send()
   */
  _validateSendOptions(options) {
    if (!options)          throw new Error('[mailer] send(): options è obbligatorio');
    if (!options.to)       throw new Error('[mailer] send(): options.to è obbligatorio');
    if (!options.subject)  throw new Error('[mailer] send(): options.subject è obbligatorio');
    if (!options.html && !options.text) {
      throw new Error('[mailer] send(): almeno uno tra options.html e options.text è obbligatorio');
    }
  }
}

module.exports = MailerService;
