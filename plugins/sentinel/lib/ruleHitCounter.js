/**
 * ruleHitCounter.js
 *
 * Contatori per regola, con salvataggio periodico su disco.
 *
 * ─── A COSA SERVE DAVVERO ─────────────────────────────────────────────────────
 * Non è una statistica di vanità: è lo strumento che rende possibile il percorso
 * osserva → capisci → promuovi.
 *
 * Senza, dopo sei mesi ci si ritrova con quaranta regole e nessuna idea di quali
 * abbiano mai sparato: le regole morte non si potano, quelle che coprono il 95%
 * del traffico ostile non si riconoscono, e ogni richiesta paga la valutazione di
 * tutte. Modello: urlRedirect/lib/hitCounter.js.
 *
 * ─── IL CAMPO CHE DECIDE LA PROMOZIONE ────────────────────────────────────────
 * `authenticatedHits` è il semaforo. Una regola che in settimane di traffico non
 * ha mai toccato un utente autenticato si può promuovere a `block` con
 * tranquillità; se quel numero è diverso da zero c'è un falso positivo che non si
 * è ancora capito, e promuoverla significa chiudere fuori qualcuno.
 *
 * A differenza dei censimenti, qui le chiavi sono i NOMI DELLE REGOLE: un insieme
 * chiuso, deciso dall'amministratore e non dall'attaccante. Nessun tetto
 * necessario.
 */

'use strict';

const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const { saveAtomic } = require('./census');

class RuleHitCounter {
  constructor(dataDir, config, deps = {}) {
    this.filePath = path.join(dataDir, `ruleHits${config.instanceId ? '.' + config.instanceId : ''}.json5`);
    this.flushIntervalSeconds = Number.isFinite(config.flushIntervalSeconds) ? config.flushIntervalSeconds : 30;
    this.log = deps.log || (() => {});

    /** @type {Map<string, object>} */
    this.counters = new Map();
    this.flushTimer = null;
    this.dirty = false;
  }

  init() {
    this._load();
    if (this.flushIntervalSeconds > 0) {
      this.flushTimer = setInterval(() => this.save(), this.flushIntervalSeconds * 1000);
      if (this.flushTimer.unref) this.flushTimer.unref();
    }
  }

  /**
   * @param {string} ruleName
   * @param {object} info
   * @param {boolean} info.enforced      - l'azione è stata applicata
   * @param {boolean} info.authenticated - la richiesta veniva da un utente autenticato
   * @param {boolean} info.isBot         - UA riconosciuto come bot noto
   * @param {string}  info.ip
   */
  record(ruleName, info) {
    if (!ruleName) return;

    let entry = this.counters.get(ruleName);
    if (!entry) {
      entry = {
        hits: 0,
        enforcedHits: 0,
        authenticatedHits: 0,
        botHits: 0,
        distinctIps: new Set(),
        distinctIpsBaseline: 0,
        firstHit: null,
        lastHit: null,
      };
      this.counters.set(ruleName, entry);
    }

    entry.hits++;
    if (info.enforced) entry.enforcedHits++;
    if (info.authenticated) entry.authenticatedHits++;
    if (info.isBot) entry.botHits++;
    if (info.ip && entry.distinctIps.size < 1024) entry.distinctIps.add(info.ip);

    const now = new Date().toISOString();
    if (!entry.firstHit) entry.firstHit = now;
    entry.lastHit = now;

    this.dirty = true;
  }

  /**
   * Riepilogo per regola, con l'indicazione di quanto sia sicuro promuoverla.
   * @returns {Array<object>}
   */
  getSummary() {
    const out = [];
    for (const [ruleName, entry] of this.counters) {
      out.push({
        ruleName,
        hits: entry.hits,
        enforcedHits: entry.enforcedHits,
        authenticatedHits: entry.authenticatedHits,
        botHits: entry.botHits,
        // Massimo storico, non conteggio della sessione corrente: vedi `_load`.
        distinctIps: Math.max(entry.distinctIpsBaseline || 0, entry.distinctIps.size),
        firstHit: entry.firstHit,
        lastHit: entry.lastHit,
        // Solo un'indicazione, non un permesso: chi promuove è l'amministratore.
        safeToPromote: entry.hits > 0 && entry.authenticatedHits === 0,
      });
    }
    return out.sort((a, b) => b.hits - a.hits);
  }

  save() {
    if (!this.dirty) return false;
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      rules: {},
    };
    for (const row of this.getSummary()) {
      const { ruleName, ...rest } = row;
      payload.rules[ruleName] = rest;
    }
    const ok = saveAtomic(this.filePath, payload, this.log);
    if (ok) this.dirty = false;
    return ok;
  }

  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.save();
  }

  _load() {
    let data = null;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.filePath)) return;
      data = loadJson5(this.filePath);
    } catch (_err) {
      return; // contatori corrotti: ripartono da zero, nessun danno
    }
    if (!data || !data.rules) return;

    for (const [ruleName, raw] of Object.entries(data.rules)) {
      this.counters.set(ruleName, {
        hits: raw.hits || 0,
        enforcedHits: raw.enforcedHits || 0,
        authenticatedHits: raw.authenticatedHits || 0,
        botHits: raw.botHits || 0,
        // ── IP DISTINTI: PERCHE UN NUMERO E UN INSIEME VUOTO ──
        // L'insieme non si ricostruisce dal file, e non per pigrizia: gli
        // indirizzi non ci sono. Conservarli qui vorrebbe dire fare di
        // `ruleHits.json5` un archivio di dati personali senza chiederlo a
        // nessuno — esattamente ciò che `censusIpMode` esiste per rendere una
        // scelta esplicita (default `count`: quanti, non quali).
        //
        // Il valore letto resta però come PAVIMENTO. Il commento precedente
        // diceva «il totale storico resta nel file» e il codice faceva il
        // contrario: `getSummary()` leggeva `size` di un insieme vuoto e il
        // primo flush lo riscriveva sopra lo storico — bastava un solo hit su
        // una qualunque regola perché il salvataggio azzerasse il conteggio di
        // TUTTE (il payload si riscrive per intero). Un riavvio, e mesi di
        // «questa regola arriva da 500 origini» diventavano zero.
        //
        // Con il pavimento il numero è monotono e ha un significato dichiarabile:
        // **il massimo osservato in una singola esecuzione**. Non è la somma
        // storica dei distinti — quella richiederebbe gli indirizzi — ma è un
        // limite inferiore onesto, e serve la domanda per cui il campo esiste:
        // «questa regola scatta su una persona sola o su molte?».
        distinctIps: new Set(),
        distinctIpsBaseline: raw.distinctIps || 0,
        firstHit: raw.firstHit || null,
        lastHit: raw.lastHit || null,
      });
    }
  }
}

module.exports = RuleHitCounter;
