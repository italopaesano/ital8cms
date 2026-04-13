/**
 * analytics — Plugin per il monitoraggio del traffico di ital8cms.
 *
 * Intercetta tutte le richieste HTTP tramite middleware Koa e salva gli eventi
 * in formato JSONL (una riga = un evento JSON), append-friendly e senza overhead.
 *
 * CARATTERISTICHE:
 *   - Traccia tutte le richieste a pagine (esclude API e risorse statiche)
 *   - Supporta rotazione file: none / daily / weekly / monthly (default)
 *   - Retention configurabile, default 365 giorni
 *   - Buffer in memoria con flush periodico, default 2s
 *   - Rilevamento bot: tracciati ma marcati con isBot: true
 *   - GDPR: anonimizzazione IP (IPv4: 2 ottetti, IPv6: 2 gruppi)
 *   - Session tracking: hash del cookie Koa esistente (nessun cookie extra)
 *   - Flush garantito su SIGTERM/SIGINT (nessun dato perso a shutdown)
 *
 * STORAGE:
 *   plugins/analytics/data/analytics-YYYY-MM.jsonl (rotazione mensile default)
 *
 * WEIGHT: 5 — caricamento precoce per catturare i tempi di risposta completi.
 *   Il middleware si posiziona all'inizio della catena, misura da prima di next()
 *   fino alla risposta finale, includendo tutti i middleware successivi.
 *
 * SHARED OBJECT (per adminAnalytics):
 *   pluginSys.getSharedObject('analytics') → { readEventsFromFile, listDataFiles,
 *                                              flushNow, getBufferSize, getConfig,
 *                                              getDataDir }
 *
 * DIPENDENZE: Nessuna (zero plugin dependency)
 */

const path = require('path');
const loadJson5   = require('../../core/loadJson5');
const { buildEvent } = require('./lib/eventCollector');
const BufferManager  = require('./lib/bufferManager');
const { cleanOldFiles, readEventsFromFile, listDataFiles } = require('./lib/fileManager');

const LOG_PREFIX = '[analytics]';

/** @type {object|null} Blocco custom di pluginConfig.json5 */
let config = null;

/** @type {string|null} Path assoluto alla directory dati */
let dataDir = null;

/** @type {BufferManager|null} */
let bufferManager = null;

/**
 * Prefissi URL da escludere dal tracking.
 * Calcolati al loadPlugin a partire da ital8Config.json5 per rispettare
 * le impostazioni utente (apiPrefix, publicThemeResourcesPrefix, adminThemeResourcesPrefix).
 *
 * @type {string[]}
 */
let excludedPrefixes = [];

/** @type {string} Prefisso admin (da ital8Config.adminPrefix) */
let adminPrefix = 'admin';

module.exports = {

  /**
   * Inizializzazione plugin: legge la configurazione, prepara il buffer
   * e avvia la pulizia dei file vecchi secondo la retention policy.
   *
   * @param {object} pluginSys        - Sistema plugin ital8cms
   * @param {string} pathPluginFolder - Path assoluto alla cartella del plugin
   */
  async loadPlugin(pluginSys, pathPluginFolder) {
    // ── Carica configurazione plugin ──
    const pluginConfigPath = path.join(pathPluginFolder, 'pluginConfig.json5');
    const pluginConf = loadJson5(pluginConfigPath);
    config = pluginConf.custom;

    // ── Carica configurazione globale ital8cms ──
    // Necessario per ricavare i prefissi URL effettivi (apiPrefix, temi, admin)
    const ital8ConfPath = path.join(pathPluginFolder, '..', '..', 'ital8Config.json5');
    let ital8Conf;
    try {
      ital8Conf = loadJson5(ital8ConfPath);
    } catch (e) {
      console.warn(`${LOG_PREFIX} WARNING: impossibile leggere ital8Config.json5, uso valori di default`);
      ital8Conf = {};
    }

    // Costruisce i prefissi esclusi dall'analytics in base alla config reale
    const api        = ital8Conf.apiPrefix                 || 'api';
    const pubTheme   = ital8Conf.publicThemeResourcesPrefix || 'public-theme-resources';
    const adminTheme = ital8Conf.adminThemeResourcesPrefix  || 'admin-theme-resources';

    excludedPrefixes = [
      `/${api}/`,
      `/${pubTheme}/`,
      `/${adminTheme}/`,
    ];

    adminPrefix = ital8Conf.adminPrefix || 'admin';

    // ── Risolvi path assoluto della directory dati ──
    dataDir = path.resolve(pathPluginFolder, config.dataPath || './data');

    // ── Inizializza buffer ──
    bufferManager = new BufferManager(dataDir, config);
    bufferManager.init();

    // ── Retention: pulizia file vecchi all'avvio ──
    if (config.retentionDays > 0) {
      try {
        cleanOldFiles(dataDir, config.retentionDays);
      } catch (e) {
        console.warn(`${LOG_PREFIX} WARNING: errore durante la pulizia retention: ${e.message}`);
      }
    }

    console.log(
      `${LOG_PREFIX} Plugin caricato — rotazione: ${config.rotationMode}, ` +
      `retention: ${config.retentionDays}gg, ` +
      `GDPR: ${config.gdprCompliance}, ` +
      `buffer: ${config.flushIntervalSeconds <= 0 ? 'immediato' : config.flushIntervalSeconds + 's'}`
    );
  },

  /**
   * Middleware Koa: si posiziona all'inizio della catena di elaborazione,
   * misura il tempo di risposta totale, costruisce l'evento e lo bufferizza.
   *
   * Il middleware chiama await next() per lasciare elaborare la richiesta
   * agli handler successivi, poi — dopo la risposta — raccoglie i dati.
   * Questo pattern garantisce che statusCode e durationMs siano sempre corretti.
   *
   * @returns {Array<Function>} Array con un singolo middleware Koa
   */
  getMiddlewareToAdd() {
    return [
      async (ctx, next) => {
        // Registra il momento di inizio PRIMA di chiamare next()
        const startTime = Date.now();

        // Esegui tutta la catena di middleware (routing, autenticazione, ecc.)
        await next();

        // Costruisci e bufferizza l'evento DOPO la risposta
        if (!config || !bufferManager) return;

        const event = buildEvent(ctx, startTime, config, excludedPrefixes, adminPrefix);
        if (event) {
          bufferManager.push(event);
        }
      },
    ];
  },

  /**
   * Espone l'API analytics agli altri plugin (principalmente adminAnalytics).
   *
   * Utilizzo:
   *   const analyticsApi = pluginSys.getSharedObject('analytics');
   *   const files = analyticsApi.listDataFiles();
   *
   * @returns {object} Oggetto con metodi di accesso ai dati analytics
   */
  getObjectToShareToOthersPlugin() {
    return {
      /**
       * Legge e parsea tutti gli eventi da un file JSONL specifico.
       * Le righe malformate vengono silenziosamente ignorate.
       *
       * @param {string} filePath - Path assoluto al file .jsonl
       * @returns {Array<object>} Array di eventi
       */
      readEventsFromFile: (filePath) => readEventsFromFile(filePath),

      /**
       * Elenca tutti i file JSONL nella directory dati, in ordine cronologico.
       *
       * @returns {Array<string>} Array di path assoluti
       */
      listDataFiles: () => listDataFiles(dataDir),

      /**
       * Forza un flush immediato del buffer su disco.
       * Utile per adminAnalytics prima di leggere i dati aggiornati.
       */
      flushNow: () => {
        if (bufferManager) bufferManager.flush();
      },

      /**
       * Restituisce il numero di eventi attualmente in buffer (non ancora su disco).
       *
       * @returns {number}
       */
      getBufferSize: () => bufferManager ? bufferManager.size() : 0,

      /**
       * Restituisce una copia della configurazione corrente del plugin.
       *
       * @returns {object}
       */
      getConfig: () => ({ ...config }),

      /**
       * Restituisce il path assoluto alla directory dati.
       * Necessario a adminAnalytics per accedere ai file direttamente.
       *
       * @returns {string|null}
       */
      getDataDir: () => dataDir,
    };
  },
};
