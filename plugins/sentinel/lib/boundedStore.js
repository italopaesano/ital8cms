/**
 * boundedStore.js
 *
 * Mappa con tetto massimo, scadenza e sfratto LRU.
 *
 * ─── PERCHE ESISTE: SENTINEL PUO ESSERE FATTO ESPLODERE USANDO SENTINEL ────────
 * Tutti gli aggregati di questo plugin sono indicizzati da valori che
 * l'ATTACCANTE controlla:
 *
 *   censimento delle firme   → chiave = fingerprint → chi randomizza l'ordine
 *                              degli header genera una firma nuova a OGNI richiesta
 *   aggregato degli esiti    → chiave = IP          → una botnet ne ha migliaia
 *   coerenza di sessione     → chiave = sessione    → le sessioni costano nulla
 *
 * Senza un tetto, una `Map` che cresce con l'attacco esaurisce la memoria del
 * processo: la difesa diventa il vettore. È la stessa forma di problema che
 * rateLimiter risolve con lo sweep periodico dei blocchi scaduti.
 *
 * ─── IL CONTATORE DI SFRATTI E UN SENSORE ─────────────────────────────────────
 * `evictions` non è una statistica di servizio: in esercizio normale resta a zero
 * per settimane, perché il traffico vero converge su poche decine di firme e di
 * client. Un tasso di sfratto improvviso significa che qualcuno sta producendo
 * chiavi nuove a raffica — cioè, esattamente, che sta tentando di gonfiare gli
 * aggregati. La contromisura si comporta da rilevatore.
 */

'use strict';

class BoundedStore {
  /**
   * @param {object} options
   * @param {number} options.maxEntries - tetto massimo di chiavi
   * @param {number} options.ttlSeconds - scadenza dall'ultimo aggiornamento (0 = nessuna)
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries > 0 ? options.maxEntries : 10000;
    this.ttlMs = options.ttlSeconds > 0 ? options.ttlSeconds * 1000 : 0;

    /**
     * L'ordine di inserimento di una Map JavaScript è garantito, e riscrivere una
     * chiave NON la sposta in fondo: per ottenere il comportamento LRU si cancella
     * e si reinserisce a ogni accesso (vedi touch). Questo rende la prima chiave
     * iterata sempre la meno usata di recente, e lo sfratto O(1).
     * @type {Map<string, object>}
     */
    this.entries = new Map();

    this.evictions = 0;
  }

  /** @returns {object|undefined} */
  get(key) {
    return this.entries.get(key);
  }

  /** @returns {boolean} */
  has(key) {
    return this.entries.has(key);
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Inserisce o aggiorna una voce, spostandola in fondo all'ordine LRU.
   * Se il tetto è superato, sfratta la voce meno usata di recente.
   *
   * @param {string} key
   * @param {object} value - deve contenere (o riceverà) `lastSeenMs`
   * @returns {object} il valore memorizzato
   */
  touch(key, value) {
    if (this.entries.has(key)) this.entries.delete(key);
    value.lastSeenMs = Date.now();
    this.entries.set(key, value);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
      this.evictions++;
    }

    return value;
  }

  /**
   * Aggiorna una voce esistente tramite una funzione, creandola se manca.
   *
   * @param {string} key
   * @param {Function} createFn - () => object, per la prima comparsa
   * @param {Function} updateFn - (entry) => void, ad ogni comparsa
   * @returns {object}
   */
  upsert(key, createFn, updateFn) {
    const existing = this.entries.get(key);
    const entry = existing || createFn();
    updateFn(entry);
    return this.touch(key, entry);
  }

  /**
   * Rimuove le voci scadute. Da chiamare da uno sweep periodico, non nel percorso
   * caldo: l'iterazione è O(n) e non deve pesare su una richiesta.
   *
   * @returns {number} voci rimosse
   */
  sweep() {
    if (this.ttlMs === 0) return 0;
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [key, value] of this.entries) {
      // L'ordine LRU non coincide con l'ordine di scadenza (una voce vecchia ma
      // toccata di recente sta in fondo), quindi non si può interrompere al primo
      // elemento non scaduto: va scandita tutta.
      if (value.lastSeenMs < cutoff) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Svuota il contenuto conservando il contatore di sfratti. */
  clear() {
    this.entries.clear();
  }

  /**
   * Esporta il contenuto come oggetto semplice, pronto per la serializzazione.
   * @param {Function} [mapFn] - (entry) => object, per omettere i campi interni
   * @returns {object}
   */
  toObject(mapFn) {
    const out = {};
    for (const [key, value] of this.entries) {
      out[key] = mapFn ? mapFn(value) : value;
    }
    return out;
  }

  /**
   * Ricarica il contenuto da un oggetto serializzato (ripresa dopo un riavvio).
   * Le voci già scadute non vengono reintrodotte.
   *
   * @param {object} data
   * @param {Function} [mapFn] - (key, value) => object|null
   */
  loadFrom(data, mapFn) {
    if (!data || typeof data !== 'object') return;
    const cutoff = this.ttlMs > 0 ? Date.now() - this.ttlMs : -Infinity;
    for (const [key, raw] of Object.entries(data)) {
      const entry = mapFn ? mapFn(key, raw) : raw;
      if (!entry) continue;
      if (typeof entry.lastSeenMs !== 'number') entry.lastSeenMs = Date.now();
      if (entry.lastSeenMs < cutoff) continue;
      if (this.entries.size >= this.maxEntries) break;
      this.entries.set(key, entry);
    }
  }
}

module.exports = BoundedStore;
