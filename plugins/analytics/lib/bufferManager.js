/**
 * bufferManager.js
 *
 * Buffer in memoria per gli eventi analytics con flush periodico su disco.
 *
 * MOTIVAZIONE:
 *   Scrivere su disco a ogni singola richiesta HTTP sarebbe costoso sotto carico
 *   (ogni visita = una syscall fs.appendFileSync). Il buffer accumula gli eventi
 *   in RAM e li scarica su disco in batch ogni N secondi, riducendo drasticamente
 *   le operazioni I/O.
 *
 * GARANZIE:
 *   - Flush finale garantito alla ricezione di SIGTERM o SIGINT
 *     (graceful shutdown: nessun evento perso in produzione)
 *   - Il timer usa .unref() per non bloccare l'uscita del processo Node.js
 *     se il server viene terminato normalmente senza segnali
 *   - flushIntervalSeconds = 0 → scrittura immediata per ogni evento (debug)
 */

const { writeEvents } = require('./fileManager');

const LOG_PREFIX = '[analytics]';

class BufferManager {
  /**
   * @param {string} dataDir  - Path assoluto alla directory dati
   * @param {object} config   - Blocco custom da pluginConfig.json5
   * @param {string} config.rotationMode           - "none"|"daily"|"weekly"|"monthly"
   * @param {number} config.flushIntervalSeconds   - Secondi tra flush (0 = immediato)
   */
  constructor(dataDir, config) {
    this.dataDir              = dataDir;
    this.rotationMode         = config.rotationMode || 'monthly';
    this.flushIntervalSeconds = config.flushIntervalSeconds ?? 2;

    /** @type {Array<object>} Eventi in attesa di scrittura su disco */
    this.buffer = [];

    /** @type {NodeJS.Timeout|null} */
    this.flushTimer = null;

    /** @type {boolean} Evita la registrazione multipla degli handler di shutdown */
    this.shutdownRegistered = false;

    /** @type {Function|null} Riferimento agli handler per poterli rimuovere */
    this._onShutdown = null;
  }

  /**
   * Avvia il flush timer e registra gli handler SIGTERM/SIGINT.
   * Deve essere chiamato una volta sola dopo la creazione dell'istanza.
   */
  init() {
    this._startFlushTimer();
    this._registerShutdownHandlers();
    console.log(
      `${LOG_PREFIX} Buffer inizializzato (flush: ${
        this.flushIntervalSeconds <= 0 ? 'immediato' : `ogni ${this.flushIntervalSeconds}s`
      })`
    );
  }

  /**
   * Aggiunge un evento al buffer.
   * Se flushIntervalSeconds è 0, esegue il flush immediatamente.
   *
   * @param {object} event - Evento analytics da bufferare
   */
  push(event) {
    this.buffer.push(event);

    if (this.flushIntervalSeconds <= 0) {
      this.flush();
    }
  }

  /**
   * Scrive tutti gli eventi accumulati su disco e svuota il buffer.
   * Operazione idempotente: se il buffer è vuoto non fa nulla.
   */
  flush() {
    if (this.buffer.length === 0) return;

    // Svuota il buffer atomicamente prima di scrivere
    // (evita race condition se push() viene chiamato durante la scrittura)
    const toWrite = this.buffer.splice(0);
    writeEvents(this.dataDir, this.rotationMode, toWrite);
  }

  /**
   * Termina il buffer in modo pulito:
   *   1. Ferma il timer periodico
   *   2. Esegue un flush finale (nessun evento perso)
   *   3. Rimuove gli handler SIGTERM/SIGINT
   */
  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    const pending = this.buffer.length;
    this.flush();

    if (pending > 0) {
      console.log(`${LOG_PREFIX} Flush finale: ${pending} eventi scritti su disco`);
    }

    this._removeShutdownHandlers();
  }

  /**
   * Restituisce il numero di eventi attualmente in buffer (non ancora su disco).
   * Utile per diagnostica e per lo shared object esposto a adminAnalytics.
   *
   * @returns {number}
   */
  size() {
    return this.buffer.length;
  }

  // ── Metodi privati ──────────────────────────────────────────────────────────

  /**
   * Avvia il timer periodico per il flush automatico.
   * Non avviato se flushIntervalSeconds <= 0 (modalità flush immediato).
   */
  _startFlushTimer() {
    if (this.flushIntervalSeconds <= 0) return;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalSeconds * 1000);

    // .unref() permette al processo di terminare normalmente anche con il timer attivo
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Registra gli handler per graceful shutdown.
   * Garantisce che nessun evento venga perso in caso di SIGTERM (es. pm2 restart)
   * o SIGINT (es. Ctrl+C in sviluppo).
   */
  _registerShutdownHandlers() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    this._onShutdown = () => {
      this.shutdown();
    };

    process.on('SIGTERM', this._onShutdown);
    process.on('SIGINT',  this._onShutdown);
  }

  /**
   * Rimuove gli handler di shutdown (utile in test per evitare listener multipli).
   */
  _removeShutdownHandlers() {
    if (this._onShutdown) {
      process.removeListener('SIGTERM', this._onShutdown);
      process.removeListener('SIGINT',  this._onShutdown);
      this._onShutdown = null;
      this.shutdownRegistered = false;
    }
  }
}

module.exports = BufferManager;
