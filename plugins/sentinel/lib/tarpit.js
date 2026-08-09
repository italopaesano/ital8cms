/**
 * tarpit.js — la risposta a goccia
 *
 * Invece di rispondere e chiudere, la connessione resta aperta e il corpo esce
 * un pezzetto alla volta, lentissimo, fino a un tetto di durata. Il client sta
 * lì ad aspettare.
 *
 * ─── PERCHE UNA RISPOSTA LENTA E UN'ARMA ──────────────────────────────────────
 * Uno scanner è un programma che deve provare molte cose in poco tempo: il suo
 * valore è tutto nella cadenza. Un 404 gli costa qualche millisecondo e passa
 * oltre. Una risposta che non finisce mai gli occupa un worker e un socket per
 * decine di secondi, e se ne ha dieci in parallelo glieli occupa tutti.
 *
 * A differenza del decoy, che gli **avvelena i dati**, il tarpit gli **consuma
 * il tempo**. Sono due modi diversi di rendere costosa la stessa scansione.
 *
 * ─── E PERCHE E ANCHE UN'ARMA PUNTATA CONTRO DI NOI ───────────────────────────
 * Ogni connessione trattenuta è un socket, un descrittore di file e un timer
 * **nostri**. Il tarpit non è un blocco: è una promessa di tenere occupate
 * risorse proprie per far perdere tempo a qualcun altro. Sotto un flusso
 * sostenuto, senza limiti, sarebbe il modo più elegante di esaurire i propri
 * descrittori — la difesa che diventa il vettore, per la terza volta in questo
 * plugin (le prime due sono il censimento e il registro dei canary).
 *
 * Da qui i tre limiti, tutti e tre necessari:
 *
 *   1. **Tetto di connessioni simultanee.** Superato, si degrada al 404 comune.
 *      Non si accoda e non si aspetta: la richiesta successiva deve costare
 *      quanto un 404 normale, o il tetto sposterebbe il problema invece di
 *      risolverlo.
 *   2. **Durata massima.** Nessuna connessione resta appesa per sempre. Un
 *      tarpit senza scadenza non lo si distingue da una perdita di risorse.
 *   3. **Rilascio immediato alla chiusura.** Se il client stacca — e uno scanner
 *      con un timeout aggressivo stacca subito — il posto si libera in quel
 *      momento, non alla scadenza. Senza questo, un attaccante che apre e chiude
 *      in fretta saturerebbe il tetto pur non restando mai in attesa.
 *
 * ─── LO SPEGNIMENTO DEL PROCESSO ──────────────────────────────────────────────
 * `gracefulShutdown` aspetta che le connessioni finiscano. Con dei tarpit attivi
 * aspetterebbe fino alla loro scadenza: un riavvio da trenta secondi, causato
 * dalla propria difesa. `abortAll()` li tronca tutti, e va chiamata sui segnali.
 */

'use strict';

const DEFAULTS = {
  maxConcurrent: 20,
  maxSeconds: 30,
  intervalMs: 1000,
};

/**
 * Corpo servito a gocce. Deve sembrare l'inizio di qualcosa di legittimo: un
 * client che riceve subito spazi bianchi chiude e passa oltre, e il tarpit non
 * avrebbe trattenuto nessuno.
 */
const DRIP_PREFIX = '<!DOCTYPE html>\n<html>\n<head>\n<title>Loading</title>\n';
const DRIP_CHUNKS = [
  '<meta charset="utf-8">\n',
  '<meta name="robots" content="noindex">\n',
  '</head>\n',
  '<body>\n',
  '<div id="app">\n',
  '<p>\n',
];

class Tarpit {
  /**
   * @param {object} [config]
   * @param {number} [config.maxConcurrent]
   * @param {number} [config.maxSeconds]
   * @param {number} [config.intervalMs]
   */
  constructor(config = {}) {
    this.maxConcurrent = config.maxConcurrent > 0 ? config.maxConcurrent : DEFAULTS.maxConcurrent;
    this.maxSeconds = config.maxSeconds > 0 ? config.maxSeconds : DEFAULTS.maxSeconds;
    this.intervalMs = config.intervalMs > 0 ? config.intervalMs : DEFAULTS.intervalMs;

    /** @type {Set<{ abort: Function }>} */
    this.active = new Set();

    this.held = 0;        // quante connessioni sono state trattenute in totale
    this.refused = 0;     // quante volte il tetto ha fatto degradare al 404
    this.totalHeldMs = 0;
  }

  get concurrent() {
    return this.active.size;
  }

  /** C'è posto per un'altra connessione? */
  hasRoom() {
    return this.active.size < this.maxConcurrent;
  }

  /**
   * Trattiene la connessione, scrivendo il corpo a gocce.
   *
   * @param {object} ctx - contesto Koa
   * @param {object} [options]
   * @param {number} [options.seconds] - durata richiesta dalla regola
   * @returns {Promise<{ held: boolean, ms: number }>} `held: false` = tetto pieno,
   *          il chiamante deve degradare al 404 comune
   */
  hold(ctx, options = {}) {
    if (!this.hasRoom()) {
      this.refused++;
      return Promise.resolve({ held: false, ms: 0 });
    }

    const requested = Number.isFinite(options.seconds) && options.seconds > 0
      ? options.seconds
      : this.maxSeconds;
    // Il tetto di configurazione non è superabile da una regola: una durata
    // scritta a mano nel file non deve poter tenere occupato un socket più a
    // lungo di quanto l'amministratore abbia deciso.
    const seconds = Math.min(requested, this.maxSeconds);

    // `ctx.respond = false` toglie la risposta di mano a Koa: da qui in poi si
    // scrive direttamente sul socket, e nessuno chiuderà al posto nostro.
    ctx.respond = false;

    const res = ctx.res;
    const startedAt = Date.now();
    this.held++;

    return new Promise((resolve) => {
      let timer = null;
      let chunkIndex = 0;
      let finished = false;
      const entry = { abort: () => finish(true) };

      const finish = (destroy) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        this.active.delete(entry);
        this.totalHeldMs += Date.now() - startedAt;

        res.removeListener('close', onClose);
        res.removeListener('error', onClose);

        try {
          if (destroy) {
            // Interruzione (spegnimento del processo): si tronca e basta.
            if (res.socket && !res.socket.destroyed) res.socket.destroy();
          } else if (!res.writableEnded) {
            res.end('</p>\n</div>\n</body>\n</html>\n');
          }
        } catch (_err) { /* fail-soft: la connessione può essere già sparita */ }

        resolve({ held: true, ms: Date.now() - startedAt });
      };

      // Il client che stacca libera il posto SUBITO. Uno scanner con un timeout
      // aggressivo stacca dopo pochi secondi: senza questo, il tetto resterebbe
      // occupato da connessioni che non esistono più.
      const onClose = () => finish(false);
      res.on('close', onClose);
      res.on('error', onClose);

      this.active.add(entry);

      try {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          // Niente Content-Length: la risposta è a lunghezza ignota, ed è la
          // ragione per cui il client resta in attesa invece di chiudere.
          'Cache-Control': 'no-store',
        });
        res.write(DRIP_PREFIX);
      } catch (_err) {
        finish(false);
        return;
      }

      const deadline = startedAt + seconds * 1000;

      const drip = () => {
        if (finished) return;
        if (Date.now() >= deadline) {
          finish(false);
          return;
        }
        try {
          res.write(DRIP_CHUNKS[chunkIndex % DRIP_CHUNKS.length]);
          chunkIndex++;
        } catch (_err) {
          finish(false);
          return;
        }
        timer = setTimeout(drip, this.intervalMs);
        // Il timer non deve tenere vivo il processo: allo spegnimento
        // `abortAll()` tronca comunque, ma un timer non-unref'd terrebbe in piedi
        // l'event loop anche in casi che non passano di lì.
        if (timer.unref) timer.unref();
      };

      timer = setTimeout(drip, this.intervalMs);
      if (timer.unref) timer.unref();
    });
  }

  /**
   * Tronca tutte le connessioni trattenute.
   * Da chiamare allo spegnimento: `gracefulShutdown` aspetta le connessioni, e
   * senza questa un riavvio durerebbe quanto il tarpit più lungo.
   *
   * @returns {number} quante ne sono state troncate
   */
  abortAll() {
    const count = this.active.size;
    for (const entry of Array.from(this.active)) {
      try { entry.abort(); } catch (_err) { /* fail-soft */ }
    }
    return count;
  }

  getStats() {
    return {
      concurrent: this.active.size,
      maxConcurrent: this.maxConcurrent,
      held: this.held,
      refused: this.refused,
      averageHeldSeconds: this.held > 0
        ? Math.round((this.totalHeldMs / this.held) / 100) / 10
        : 0,
    };
  }
}

module.exports = { Tarpit, DEFAULTS, DRIP_PREFIX, DRIP_CHUNKS };
