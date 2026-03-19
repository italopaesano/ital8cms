/**
 * hitCounter.js
 *
 * Tracks how many times each redirect rule is used.
 * Stores counters in redirectHitCount.json5 with periodic flush to disk.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown flush.
 */

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[urlRedirect]';

class HitCounter {
  /**
   * @param {string} pluginFolder - Absolute path to the plugin folder
   * @param {object} config - Plugin custom config
   */
  constructor(pluginFolder, config) {
    this.filePath = path.join(pluginFolder, 'redirectHitCount.json5');
    this.flushInterval = config.hitCounterFlushInterval;
    this.enableLogging = config.enableLogging;

    /** @type {Map<string, { hitCount: number, firstHit: string|null, lastHit: string|null }>} */
    this.counters = new Map();

    /** @type {boolean} Track if there are unsaved changes */
    this.dirty = false;

    /** @type {NodeJS.Timeout|null} */
    this.flushTimer = null;

    /** @type {boolean} */
    this.shutdownRegistered = false;
  }

  /**
   * Initializes the hit counter: loads existing data and starts flush timer.
   */
  init() {
    this._loadFromDisk();
    this._startFlushTimer();
    this._registerShutdownHandlers();
  }

  /**
   * Records a hit for a given redirect "from" pattern.
   *
   * @param {string} fromPattern - The "from" value of the matched rule
   */
  recordHit(fromPattern) {
    const now = new Date().toISOString();
    const existing = this.counters.get(fromPattern);

    if (existing) {
      existing.hitCount++;
      existing.lastHit = now;
    } else {
      this.counters.set(fromPattern, {
        hitCount: 1,
        firstHit: now,
        lastHit: now,
      });
    }

    this.dirty = true;

    // Immediate write if flushInterval is 0
    if (this.flushInterval === 0) {
      this.flush();
    }
  }

  /**
   * Flushes the in-memory counters to disk (atomic write).
   * Only writes if there are unsaved changes.
   */
  flush() {
    if (!this.dirty) return;

    try {
      const data = {};
      for (const [key, value] of this.counters) {
        data[key] = value;
      }

      const jsonContent = '// This file follows the JSON5 standard - comments and trailing commas are supported\n'
        + JSON.stringify(data, null, 2) + '\n';

      const tempPath = this.filePath + '.tmp';
      fs.writeFileSync(tempPath, jsonContent, 'utf8');
      fs.renameSync(tempPath, this.filePath);

      this.dirty = false;
    } catch (err) {
      console.error(`${LOG_PREFIX} ERROR: Failed to write hit counters to disk: ${err.message}`);
    }
  }

  /**
   * Returns a copy of all hit count data.
   * @returns {object}
   */
  getAll() {
    const result = {};
    for (const [key, value] of this.counters) {
      result[key] = { ...value };
    }
    return result;
  }

  /**
   * Stops the flush timer, performs a final flush, and removes shutdown handlers.
   */
  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this._removeShutdownHandlers();
  }

  // ── Private Methods ──

  /**
   * Loads existing hit count data from disk.
   * Creates an empty file if it doesn't exist.
   */
  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        // Create empty file
        const emptyContent = '// This file follows the JSON5 standard - comments and trailing commas are supported\n{}\n';
        fs.writeFileSync(this.filePath, emptyContent, 'utf8');
        return;
      }

      // Use loadJson5 to support JSON5 format (with fallback to JSON.parse)
      let data;
      try {
        const loadJson5 = require('../../../core/loadJson5');
        data = loadJson5(this.filePath);
      } catch (e) {
        // Fallback: strip comments and parse as JSON
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const stripped = raw.replace(/^\s*\/\/.*$/gm, '').trim();
        data = stripped ? JSON.parse(stripped) : {};
      }

      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && typeof value.hitCount === 'number') {
          this.counters.set(key, {
            hitCount: value.hitCount,
            firstHit: value.firstHit || null,
            lastHit: value.lastHit || null,
          });
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} WARNING: Could not load hit counters from disk: ${err.message}. Starting with empty counters.`);
    }
  }

  /**
   * Starts the periodic flush timer.
   */
  _startFlushTimer() {
    // flushInterval 0 = immediate writes (no timer needed)
    if (this.flushInterval <= 0) return;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval * 1000);

    // Allow the process to exit even if the timer is active
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Registers process event handlers for graceful shutdown.
   * Ensures counters are flushed before the process exits.
   * Uses a module-level flag to avoid registering multiple listeners
   * across multiple HitCounter instances (e.g., in tests).
   */
  _registerShutdownHandlers() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    // Keep reference for potential cleanup
    this._onShutdown = () => {
      this.shutdown();
    };

    process.on('SIGTERM', this._onShutdown);
    process.on('SIGINT', this._onShutdown);
  }

  /**
   * Removes process shutdown handlers (useful for cleanup in tests).
   */
  _removeShutdownHandlers() {
    if (this._onShutdown) {
      process.removeListener('SIGTERM', this._onShutdown);
      process.removeListener('SIGINT', this._onShutdown);
      this._onShutdown = null;
      this.shutdownRegistered = false;
    }
  }
}

module.exports = HitCounter;
