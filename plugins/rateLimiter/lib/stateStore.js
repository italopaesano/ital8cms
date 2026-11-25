/**
 * stateStore.js
 *
 * Persistenza dello stato "caldo" del motore (contatori e blocchi attivi).
 * Lo stato vive in memoria nel RateLimitEngine; questo modulo lo salva
 * periodicamente su state/activeBlocks.json5 (scrittura atomica temp+rename) e
 * lo ricarica al boot, così i blocchi sopravvivono ai riavvii del server.
 *
 * Segue lo stesso pattern di urlRedirect/lib/hitCounter.js (timer con unref,
 * flush solo se dirty, handler SIGTERM/SIGINT per il flush finale).
 *
 * NOTA: i timestamp nello stato sono in epoch ms (machine-readable). L'audit
 * leggibile dall'uomo è separato (attemptLog.js, con timestamp ISO).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../../core/logger');
const loadJson5 = require('../../../core/loadJson5');

const LOG_PREFIX = 'rateLimiter';
const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported\n';

class StateStore {
  /**
   * @param {string} pluginFolder - Path assoluto della cartella del plugin
   * @param {object} engine - Istanza di RateLimitEngine (espone serialize/load/dirty)
   * @param {object} config - custom.state: { flushIntervalSeconds }
   */
  constructor(pluginFolder, engine, config = {}) {
    this.dir = path.join(pluginFolder, 'state');
    this.filePath = path.join(this.dir, 'activeBlocks.json5');
    this.engine = engine;
    this.flushInterval = typeof config.flushIntervalSeconds === 'number' ? config.flushIntervalSeconds : 30;
    /**
     * Normalizzatore dell'identificatore di client, iniettato dal plugin.
     *
     * Serve a RI-CHIAVARE lo stato salvato da una versione precedente: dalla
     * v3.49.0 la chiave degli IPv6 è il prefisso /64, e un blocco scritto su
     * disco con l'indirizzo intero non verrebbe più trovato. Misurato: un blocco
     * ATTIVO risultava rilasciato al primo riavvio dopo l'aggiornamento.
     *
     * Identità se non iniettato: lo store non sa nulla di indirizzi IP, e non
     * deve saperne.
     */
    this.normalizeClientId = typeof config.normalizeClientId === 'function'
      ? config.normalizeClientId
      : (id) => id;
    this.flushTimer = null;
    this._onShutdown = null;
  }

  init() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      logger.warn(LOG_PREFIX, `Impossibile creare la directory di stato: ${err.message}`);
    }
    this._loadFromDisk();
    this._startFlushTimer();
    this._registerShutdownHandlers();
  }

  /** Scrive lo stato su disco (atomico) se ci sono modifiche. */
  flush() {
    if (!this.engine.dirty) return;
    try {
      const data = this.engine.serialize();
      const content = JSON5_HEADER + JSON.stringify(data, null, 2) + '\n';
      const tempPath = this.filePath + '.tmp';
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, this.filePath);
      this.engine.dirty = false;
    } catch (err) {
      logger.error(LOG_PREFIX, `Salvataggio stato fallito: ${err.message}`);
    }
  }

  /** Ferma il timer, esegue un flush finale e rimuove gli handler. */
  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this._removeShutdownHandlers();
  }

  // ── Private ──

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON5_HEADER + '{}\n', 'utf8');
        return;
      }
      const data = loadJson5(this.filePath);
      this.engine.load(this._rekey(data));
      // load() non deve marcare dirty: lo stato appena letto coincide col disco
      this.engine.dirty = false;
    } catch (err) {
      logger.warn(LOG_PREFIX, `Impossibile caricare lo stato dal disco: ${err.message}. Avvio con stato vuoto.`);
    }
  }

  /**
   * Riscrive le chiavi dello stato letto da disco con la normalizzazione
   * corrente, fondendo le voci che collassano sulla stessa chiave.
   *
   * La fusione tiene il blocco **più restrittivo** (il `blockedUntil` più
   * lontano) e il conteggio dei fallimenti più alto: due indirizzi della stessa
   * /64 che prima avevano contatori separati diventano un contatore solo, e
   * scartare il più severo regalerebbe all'attaccante la differenza.
   *
   * @param {object} data - stato come letto dal disco
   * @returns {object} stato con le chiavi correnti
   */
  _rekey(data) {
    if (!data || typeof data !== 'object') return data;

    const out = {};
    let riscritte = 0;

    for (const [key, entry] of Object.entries(data)) {
      const sep = key.lastIndexOf('|');
      if (sep <= 0 || !entry || typeof entry !== 'object') { out[key] = entry; continue; }

      const clientId = key.slice(0, sep);
      const ruleName = key.slice(sep + 1);
      const nuovoId = this.normalizeClientId(clientId);
      const nuovaKey = `${nuovoId}|${ruleName}`;
      if (nuovaKey !== key) riscritte += 1;

      const esistente = out[nuovaKey];
      const voce = { ...entry, clientId: nuovoId };

      out[nuovaKey] = !esistente ? voce : {
        ...voce,
        failureCount: Math.max(esistente.failureCount || 0, voce.failureCount || 0),
        shortBlockCount: Math.max(esistente.shortBlockCount || 0, voce.shortBlockCount || 0),
        blockedUntil: Math.max(esistente.blockedUntil || 0, voce.blockedUntil || 0),
        lastFailureAt: Math.max(esistente.lastFailureAt || 0, voce.lastFailureAt || 0),
        tier: (esistente.blockedUntil || 0) >= (voce.blockedUntil || 0) ? esistente.tier : voce.tier,
      };
    }

    if (riscritte > 0) {
      logger.info(LOG_PREFIX, `stato: ${riscritte} chiavi riscritte con la normalizzazione corrente`);
    }
    return out;
  }

  _startFlushTimer() {
    if (this.flushInterval <= 0) {
      return; // 0 = scrittura immediata gestita altrove (qui nessun timer)
    }
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval * 1000);
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  _registerShutdownHandlers() {
    this._onShutdown = () => this.shutdown();
    process.on('SIGTERM', this._onShutdown);
    process.on('SIGINT', this._onShutdown);
  }

  _removeShutdownHandlers() {
    if (this._onShutdown) {
      process.removeListener('SIGTERM', this._onShutdown);
      process.removeListener('SIGINT', this._onShutdown);
      this._onShutdown = null;
    }
  }
}

module.exports = StateStore;
