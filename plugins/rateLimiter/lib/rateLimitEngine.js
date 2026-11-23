/**
 * rateLimitEngine.js
 *
 * Motore di rate limiting con escalation, in stile fail2ban.
 *
 * Modello a stati per ogni chiave (IP + ruleName):
 *
 *   NORMAL ──fail (count<max nella finestra)──────────────► NORMAL (count++)
 *   NORMAL ──fail (count==max, shortBlocks<maxShort)──────► SHORT_BLOCK
 *   SHORT_BLOCK ──blocco scaduto──────────────────────────► NORMAL (count=0, ricorda shortBlocks)
 *   NORMAL ──fail (count==max, shortBlocks>=maxShort)─────► LONG_BLOCK
 *   LONG_BLOCK  ──blocco scaduto──────────────────────────► NORMAL (reset totale)
 *   qualsiasi ──success───────────────────────────────────► entry rimossa (reset totale)
 *
 * Il motore è PURO (nessuna I/O): riceve un risolutore di policy e una clock
 * iniettabile (per i test) e notifica gli eventi tramite un callback `onEvent`.
 * La persistenza dello stato e l'audit log sono gestiti all'esterno (main.js).
 */

'use strict';

class RateLimitEngine {
  /**
   * @param {object} options
   * @param {function(string): object} options.resolvePolicy - ruleName → policy effettiva
   *        (campi: findWindowSeconds, maxFailures, shortBlockSeconds,
   *                maxShortBlocks, longBlockSeconds, escalationResetSeconds)
   * @param {function(object): void} [options.onEvent] - callback per gli eventi di audit
   * @param {function(): number} [options.now] - clock in ms (iniettabile per i test)
   */
  constructor(options = {}) {
    if (typeof options.resolvePolicy !== 'function') {
      throw new Error('[rateLimitEngine] resolvePolicy è obbligatorio');
    }
    this.resolvePolicy = options.resolvePolicy;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();

    /**
     * Tetto al numero di voci tracciate (REVIEW.md → C2, punto 2).
     *
     * Senza, `this.state` cresce di una voce per ogni combinazione
     * (clientId, regola) con almeno un fallimento, e `sweep()` rimuove solo
     * quelle già scadute: sotto un attacco distribuito la mappa cresce senza
     * limite — e siccome lo stato è **persistito su disco**, cresce anche il
     * file, che a ogni flush viene riscritto per intero.
     *
     * 10.000 voci sono un tetto generoso per un CMS single-process e stanno in
     * pochi MB; chi ha bisogno di più lo configura.
     */
    this.maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : 10000;

    /** @type {Map<string, object>} key = `${clientId}|${ruleName}` */
    this.state = new Map();

    /** @type {boolean} true se ci sono modifiche non ancora persistite */
    this.dirty = false;
  }

  /** Costruisce la chiave interna. clientId (IP) e ruleName non contengono '|'. */
  _key(clientId, ruleName) {
    return `${clientId}|${ruleName}`;
  }

  /** Crea una entry vergine. */
  _newEntry(clientId, ruleName, now) {
    return {
      clientId,
      ruleName,
      failureCount: 0,
      windowStartAt: 0,
      lastFailureAt: 0,
      shortBlockCount: 0,
      blockedUntil: 0,
      tier: 'none', // 'none' | 'short' | 'long'
    };
  }

  /**
   * Fa posto quando la mappa supera il tetto (REVIEW.md → C2).
   *
   * ─── L'ORDINE DI SACRIFICIO, E PERCHÉ QUESTO ─────────────────────────────
   * Sfrattare una voce significa **dimenticare** chi ha fallito, quindi l'ordine
   * non è un dettaglio di performance: è una decisione di sicurezza.
   *
   *  1. Le voci **senza blocco attivo**, dalla meno recente: dimenticare chi non
   *     è bloccato costa solo il contatore dei suoi tentativi.
   *  2. Solo se non ce ne sono — cioè se TUTTE le voci sono bloccate — si
   *     sacrifica quella il cui blocco **scade prima**: è quella più vicina a
   *     essere rilasciata comunque, quindi è il danno minore fra quelli
   *     possibili.
   *
   * Non si rifiuta di inserire la voce nuova: significherebbe non tracciare
   * l'attaccante che sta arrivando adesso, che è il peggiore dei due mali. Per
   * lo stesso motivo la voce appena inserita è **esclusa** dallo sfratto: nasce
   * con `lastFailureAt: 0` — l'incremento avviene dopo — quindi sembrerebbe la
   * meno recente di tutte e verrebbe sacrificata subito. (Misurato: senza
   * l'esclusione, con il tetto a 1 la voce nuova sparisce appena inserita.)
   *
   * @param {string} [proteggi] - chiave da non sfrattare (quella appena creata)
   * @returns {number} quante voci sono state sfrattate
   */
  _enforceCap(proteggi) {
    if (this.state.size <= this.maxEntries) return 0;

    const now = this.now();
    const daSfrattare = this.state.size - this.maxEntries;

    const ordinate = [...this.state.entries()]
      .filter(([key]) => key !== proteggi)
      .sort((a, b) => {
        const aBloccata = a[1].blockedUntil > now;
        const bBloccata = b[1].blockedUntil > now;
        if (aBloccata !== bBloccata) return aBloccata ? 1 : -1;   // le non bloccate prima
        if (aBloccata) return a[1].blockedUntil - b[1].blockedUntil;  // scade prima → prima
        return (a[1].lastFailureAt || 0) - (b[1].lastFailureAt || 0); // meno recente → prima
      });

    let sfrattate = 0;
    for (const [key] of ordinate) {
      if (sfrattate >= daSfrattare) break;
      this.state.delete(key);
      sfrattate += 1;
    }

    if (sfrattate > 0) {
      this.dirty = true;
      this.onEvent({ event: 'evict', count: sfrattate, size: this.state.size, at: now });
    }
    return sfrattate;
  }

  /**
   * Applica le scadenze: fine blocco e reset della memoria di escalation.
   * Muta la entry passata.
   */
  _applyExpiry(entry, policy, now) {
    // 1) Fine di un blocco attivo
    if (entry.blockedUntil > 0 && entry.blockedUntil <= now) {
      if (entry.tier === 'long') {
        // Long block scaduto → reset totale
        entry.failureCount = 0;
        entry.windowStartAt = 0;
        entry.shortBlockCount = 0;
      } else {
        // Short block scaduto → azzera la finestra, MANTIENI la memoria di escalation
        entry.failureCount = 0;
        entry.windowStartAt = 0;
      }
      entry.tier = 'none';
      entry.blockedUntil = 0;
    }

    // 2) Reset della memoria di escalation dopo inattività prolungata
    if (
      entry.tier === 'none' &&
      entry.blockedUntil === 0 &&
      entry.lastFailureAt > 0 &&
      now - entry.lastFailureAt > policy.escalationResetSeconds * 1000
    ) {
      entry.failureCount = 0;
      entry.windowStartAt = 0;
      entry.shortBlockCount = 0;
    }
  }

  /** Costruisce il verdetto a partire dallo stato di blocco corrente. */
  _verdict(entry, now) {
    if (entry.blockedUntil > now) {
      return {
        blocked: true,
        tier: entry.tier,
        retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      };
    }
    return { blocked: false, tier: 'none', retryAfterSeconds: 0 };
  }

  /**
   * Verifica se il client è attualmente bloccato per la regola (senza registrare nulla).
   * @returns {{ blocked: boolean, tier: string, retryAfterSeconds: number }}
   */
  check(clientId, ruleName) {
    const now = this.now();
    const entry = this.state.get(this._key(clientId, ruleName));
    if (!entry) {
      return { blocked: false, tier: 'none', retryAfterSeconds: 0 };
    }
    const policy = this.resolvePolicy(ruleName);
    this._applyExpiry(entry, policy, now);
    return this._verdict(entry, now);
  }

  /**
   * Registra un tentativo fallito, applicando finestra ed escalation.
   * @returns {{ blocked: boolean, tier: string, retryAfterSeconds: number }}
   */
  recordFailure(clientId, ruleName) {
    const now = this.now();
    const policy = this.resolvePolicy(ruleName);
    const key = this._key(clientId, ruleName);

    let entry = this.state.get(key);
    if (!entry) {
      entry = this._newEntry(clientId, ruleName, now);
      this.state.set(key, entry);
      // Il tetto si applica all'inserimento: è l'unico momento in cui la mappa
      // cresce (REVIEW.md → C2).
      this._enforceCap(key);
    }

    this._applyExpiry(entry, policy, now);

    // Se è ancora attivo un blocco, non incrementare: restituisci il verdetto corrente.
    if (entry.blockedUntil > now) {
      return this._verdict(entry, now);
    }

    // Gestione della finestra di conteggio (findtime)
    if (entry.windowStartAt === 0 || now - entry.windowStartAt > policy.findWindowSeconds * 1000) {
      entry.windowStartAt = now;
      entry.failureCount = 1;
    } else {
      entry.failureCount += 1;
    }
    entry.lastFailureAt = now;

    let eventType = 'failure';

    if (entry.failureCount >= policy.maxFailures) {
      if (entry.shortBlockCount < policy.maxShortBlocks) {
        // SHORT block
        entry.tier = 'short';
        entry.blockedUntil = now + policy.shortBlockSeconds * 1000;
        entry.shortBlockCount += 1;
        entry.failureCount = 0;
        entry.windowStartAt = 0;
        eventType = 'shortBlock';
      } else {
        // Escalation → LONG block
        entry.tier = 'long';
        entry.blockedUntil = now + policy.longBlockSeconds * 1000;
        entry.failureCount = 0;
        entry.windowStartAt = 0;
        eventType = 'longBlock';
      }
    }

    this.dirty = true;

    const verdict = this._verdict(entry, now);
    this.onEvent({
      event: eventType,
      clientId,
      ruleName,
      tier: entry.tier,
      failureCount: entry.failureCount,
      shortBlockCount: entry.shortBlockCount,
      blockedUntil: entry.blockedUntil || null,
      retryAfterSeconds: verdict.retryAfterSeconds,
      at: now,
    });

    return verdict;
  }

  /**
   * Registra un successo: rimuove ogni stato per (clientId, ruleName).
   */
  recordSuccess(clientId, ruleName) {
    const key = this._key(clientId, ruleName);
    if (this.state.has(key)) {
      this.state.delete(key);
      this.dirty = true;
      this.onEvent({ event: 'success', clientId, ruleName, at: this.now() });
    }
  }

  /**
   * Rimuove il blocco/stato per una chiave specifica (azione admin: sblocco).
   * @returns {boolean} true se esisteva una voce
   */
  release(clientId, ruleName) {
    const key = this._key(clientId, ruleName);
    if (this.state.has(key)) {
      this.state.delete(key);
      this.dirty = true;
      this.onEvent({ event: 'release', clientId, ruleName, at: this.now() });
      return true;
    }
    return false;
  }

  /**
   * Rimuove tutti i blocchi/stato per un client (tutte le regole).
   * @returns {number} numero di voci rimosse
   */
  releaseAllForClient(clientId) {
    let removed = 0;
    for (const [key, entry] of this.state) {
      if (entry.clientId === clientId) {
        this.state.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      this.onEvent({ event: 'releaseAll', clientId, count: removed, at: this.now() });
    }
    return removed;
  }

  /**
   * Forza un blocco manuale (ban da admin) per (clientId, ruleName).
   * @param {object} [opts] - { tier?: 'short'|'long' (default 'long'), seconds?: number }
   * @returns {{ blocked: boolean, tier: string, retryAfterSeconds: number }}
   */
  forceBlock(clientId, ruleName, opts = {}) {
    const now = this.now();
    const policy = this.resolvePolicy(ruleName);
    const tier = opts.tier === 'short' ? 'short' : 'long';
    const seconds = (typeof opts.seconds === 'number' && opts.seconds > 0)
      ? opts.seconds
      : (tier === 'short' ? policy.shortBlockSeconds : policy.longBlockSeconds);

    const key = this._key(clientId, ruleName);
    let entry = this.state.get(key);
    if (!entry) {
      entry = this._newEntry(clientId, ruleName, now);
      this.state.set(key, entry);
      // Il tetto si applica all'inserimento: è l'unico momento in cui la mappa
      // cresce (REVIEW.md → C2).
      this._enforceCap(key);
    }
    entry.tier = tier;
    entry.blockedUntil = now + seconds * 1000;
    entry.lastFailureAt = now;
    entry.failureCount = 0;
    entry.windowStartAt = 0;
    this.dirty = true;

    const verdict = this._verdict(entry, now);
    this.onEvent({
      event: 'manualBlock',
      clientId,
      ruleName,
      tier,
      blockedUntil: entry.blockedUntil,
      retryAfterSeconds: verdict.retryAfterSeconds,
      at: now,
    });
    return verdict;
  }

  /**
   * Verifica se un client ha un LONG block attivo su una qualsiasi regola.
   * Usato dal middleware di enforcement (Livello 2) per il ban globale dell'IP.
   * Applica la scadenza come effetto collaterale (pulizia).
   * @param {string} clientId
   * @returns {{ blocked: boolean, tier: string, ruleName: string|null, retryAfterSeconds: number }}
   */
  checkClientLongBlock(clientId) {
    const now = this.now();
    let best = { blocked: false, tier: 'none', ruleName: null, retryAfterSeconds: 0 };
    for (const entry of this.state.values()) {
      if (entry.clientId !== clientId) continue;
      const policy = this.resolvePolicy(entry.ruleName);
      this._applyExpiry(entry, policy, now);
      if (entry.tier === 'long' && entry.blockedUntil > now) {
        const retry = Math.ceil((entry.blockedUntil - now) / 1000);
        if (retry > best.retryAfterSeconds) {
          best = { blocked: true, tier: 'long', ruleName: entry.ruleName, retryAfterSeconds: retry };
        }
      }
    }
    return best;
  }

  /**
   * Restituisce la lista dei blocchi attualmente attivi (per introspezione/admin).
   * @returns {Array<object>}
   */
  getActiveBlocks() {
    const now = this.now();
    const result = [];
    for (const entry of this.state.values()) {
      if (entry.blockedUntil > now) {
        result.push({
          clientId: entry.clientId,
          ruleName: entry.ruleName,
          tier: entry.tier,
          shortBlockCount: entry.shortBlockCount,
          blockedUntil: entry.blockedUntil,
          retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
        });
      }
    }
    return result;
  }

  /**
   * Rimuove dalla memoria i blocchi scaduti e le voci ormai inattive.
   * Va chiamato periodicamente per mantenere limitato l'uso di RAM.
   */
  sweep() {
    const now = this.now();
    for (const [key, entry] of this.state) {
      const policy = this.resolvePolicy(entry.ruleName);
      this._applyExpiry(entry, policy, now);
      const isClean =
        entry.blockedUntil === 0 &&
        entry.failureCount === 0 &&
        entry.shortBlockCount === 0;
      if (isClean) {
        this.state.delete(key);
        this.dirty = true;
      }
    }
  }

  /**
   * Serializza lo stato per la persistenza su disco.
   * @returns {object} - mappa key → entry (timestamp in epoch ms)
   */
  serialize() {
    const obj = {};
    for (const [key, entry] of this.state) {
      obj[key] = { ...entry };
    }
    return obj;
  }

  /**
   * Carica lo stato da un oggetto serializzato (es. da disco al boot).
   * @param {object} obj
   */
  load(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && typeof value.clientId === 'string') {
        this.state.set(key, {
          clientId: value.clientId,
          ruleName: value.ruleName,
          failureCount: value.failureCount || 0,
          windowStartAt: value.windowStartAt || 0,
          lastFailureAt: value.lastFailureAt || 0,
          shortBlockCount: value.shortBlockCount || 0,
          blockedUntil: value.blockedUntil || 0,
          tier: value.tier || 'none',
        });
      }
    }
  }
}

module.exports = RateLimitEngine;
