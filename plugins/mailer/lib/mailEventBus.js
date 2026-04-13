'use strict';

/**
 * MailEventBus — Sistema eventi del plugin mailer
 *
 * Permette ad altri plugin di registrare listener via onMailEvent(callback).
 * Il mailer chiama emit() nei momenti chiave del flusso di invio.
 *
 * Utilizzo da un altro plugin:
 *   const mailer = pluginSys.getSharedObject('mailer');
 *   mailer.onMailEvent((eventName, data) => {
 *     if (eventName === 'mailSent') console.log('Email inviata:', data.id);
 *     if (eventName === 'mailDead') notifyAdmin('Email persa:', data.subject);
 *   });
 *
 * Eventi emessi:
 *   "mailQueued"  → { id, to, subject, addedAt }
 *   "mailSent"    → { id, to, subject, transport, durationMs, attempts }
 *   "mailFailed"  → { id, to, subject, error, attempts, nextRetryAt }
 *   "mailDead"    → { id, to, subject, error, attempts, addedAt }
 */
class MailEventBus {
  constructor() {
    this._listeners = [];
  }

  /**
   * Registra un listener per tutti gli eventi del mailer
   * @param {Function} callback - (eventName: string, data: object) => void
   * @throws {Error} se callback non è una funzione
   */
  on(callback) {
    if (typeof callback !== 'function') {
      throw new Error('[mailer/mailEventBus] Il listener deve essere una funzione');
    }
    this._listeners.push(callback);
  }

  /**
   * Emette un evento verso tutti i listener registrati.
   * Errori nei listener vengono catturati e loggati senza interrompere il flusso.
   *
   * @param {string} eventName - "mailQueued"|"mailSent"|"mailFailed"|"mailDead"
   * @param {object} data      - Payload dell'evento
   */
  emit(eventName, data) {
    for (const listener of this._listeners) {
      try {
        listener(eventName, data);
      } catch (err) {
        console.warn(
          `[mailer/mailEventBus] Errore nel listener per evento "${eventName}":`,
          err.message
        );
      }
    }
  }

  /**
   * Restituisce il numero di listener registrati (utile per debug)
   * @returns {number}
   */
  listenerCount() {
    return this._listeners.length;
  }
}

module.exports = MailEventBus;
