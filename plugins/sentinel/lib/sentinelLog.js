/**
 * sentinelLog.js
 *
 * Log degli eventi in formato JSONL, con rotazione per data, retention e — la
 * parte che gli altri log del progetto non hanno — un TETTO DI DIMENSIONE.
 *
 * ─── PERCHE LA RETENTION A TEMPO NON BASTA ────────────────────────────────────
 * `retentionDays: 365` protegge dal log che invecchia, non da quello che cresce:
 * sotto attacco un singolo file giornaliero può prendere gigabyte in poche ore, e
 * un disco pieno non rompe sentinel — rompe l'INTERO sito, con una causa che
 * nessuno collegherebbe al plugin di sicurezza. Serve un budget in byte con
 * sfratto dal più vecchio, e serve un avviso PRIMA di doverlo applicare: quando
 * si cancellano dati è già tardi per accorgersene.
 *
 * ─── FUSO ORARIO ──────────────────────────────────────────────────────────────
 * I nomi file usano l'ORA LOCALE del server, come analytics/lib/fileManager.js.
 * Non è un dettaglio estetico: il giorno in cui si vorranno correlare i due
 * insiemi di dati, "2026-08-08" deve indicare lo stesso intervallo in entrambi.
 *
 * ─── FAIL-SOFT SEMPRE ─────────────────────────────────────────────────────────
 * Nessuna funzione di questo modulo solleva. Un errore di I/O sul log non deve
 * mai impedire un blocco né rompere una risposta: si segnala una volta sola
 * (latch) e si prosegue. Il latch serve perché il flush gira di continuo, e senza
 * di esso un filesystem in sola lettura riempirebbe il journal.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE_PREFIX = 'sentinel';

/**
 * Tetto di una singola write, in byte.
 *
 * È `PIPE_BUF` di Linux: sotto questa soglia una `write` in O_APPEND è atomica,
 * e due processi che scrivono sullo stesso file non possono interlacciare ciò
 * che scrivono. Vedi il commento esteso in `flush()`.
 */
const MAX_ATOMIC_WRITE_BYTES = 4096;

/**
 * Raggruppa gli eventi in blocchi di testo che restano sotto il tetto atomico.
 *
 * Una riga che da sola lo supera esce nel proprio blocco: non si può fare di
 * meglio, e spezzarla produrrebbe JSONL non valido — che è molto peggio di una
 * write non atomica.
 *
 * @param {Array<object>} events
 * @param {number} maxBytes
 * @returns {string[]} blocchi pronti da scrivere, newline finale compreso
 */
function batchLines(events, maxBytes) {
  const chunks = [];
  let current = '';
  let currentBytes = 0;

  for (const event of events) {
    const line = JSON.stringify(event) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');

    if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }

    current += line;
    currentBytes += lineBytes;

    // Riga più lunga del tetto da sola: chiude subito il blocco invece di
    // trascinarsi dietro le successive, che resterebbero anche loro sopra soglia.
    if (currentBytes >= maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
  }

  if (currentBytes > 0) chunks.push(current);
  return chunks;
}

function getIsoWeekString(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Nome del file per la data corrente.
 *
 * @param {string} rotationMode - "none" | "daily" | "weekly" | "monthly"
 * @param {string} instanceId   - suffisso di istanza (vedi il commento in classe)
 * @param {Date}   [date]
 * @returns {string}
 */
function getFileName(rotationMode, instanceId, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const suffix = instanceId ? `.${instanceId}` : '';

  switch (rotationMode) {
    case 'none':    return `${FILE_PREFIX}${suffix}.jsonl`;
    case 'weekly':  return `${FILE_PREFIX}-${getIsoWeekString(date)}${suffix}.jsonl`;
    case 'monthly': return `${FILE_PREFIX}-${year}-${month}${suffix}.jsonl`;
    case 'daily':
    default:        return `${FILE_PREFIX}-${year}-${month}-${day}${suffix}.jsonl`;
  }
}

/** Elenca i file di log della data dir, dal più vecchio al più recente. */
function listLogFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  try {
    return fs.readdirSync(dataDir)
      .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dataDir, f));
  } catch (_err) {
    return [];
  }
}

class SentinelLog {
  /**
   * @param {string} dataDir
   * @param {object} config - blocco custom.log di pluginConfig.json5
   * @param {object} [deps]
   * @param {Function} [deps.onAlert] - (payload) => void, per l'allerta di soglia
   * @param {Function} [deps.log]     - (level, message) => void
   */
  constructor(dataDir, config, deps = {}) {
    this.dataDir = dataDir;
    this.rotationMode = config.rotationMode || 'daily';
    this.retentionDays = Number.isFinite(config.retentionDays) ? config.retentionDays : 365;
    this.flushIntervalSeconds = Number.isFinite(config.flushIntervalSeconds) ? config.flushIntervalSeconds : 1;
    this.maxTotalBytes = Number.isFinite(config.maxTotalBytes) ? config.maxTotalBytes : 200 * 1024 * 1024;
    this.alertAtPercent = Number.isFinite(config.alertAtPercent) ? config.alertAtPercent : 70;

    /**
     * Suffisso di istanza nei nomi file. Con un processo solo è costante e il
     * comportamento è identico a non averlo; il giorno in cui si girasse in
     * cluster ogni worker scriverebbe sul proprio shard invece di contendersi lo
     * stesso file, e la lettura resterebbe una fusione degli shard. Predisporlo
     * ora costa una stringa, aggiungerlo dopo costerebbe una migrazione.
     */
    this.instanceId = config.instanceId || '';

    this.buffer = [];
    this.flushTimer = null;
    this.writeFailureLogged = false;
    this.alertSent = false;

    this.onAlert = typeof deps.onAlert === 'function' ? deps.onAlert : null;
    this.log = typeof deps.log === 'function' ? deps.log : () => {};

    this._onShutdown = null;
  }

  init() {
    this.applyRetention();
    this.enforceSizeBudget();

    if (this.flushIntervalSeconds > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushIntervalSeconds * 1000);
      if (this.flushTimer.unref) this.flushTimer.unref();
    }

    this._onShutdown = () => this.shutdown();
    process.on('SIGTERM', this._onShutdown);
    process.on('SIGINT', this._onShutdown);
  }

  /**
   * Accoda un evento. Con flushIntervalSeconds a 0 scrive subito.
   * @param {object} event
   */
  append(event) {
    this.buffer.push(event);
    if (this.flushIntervalSeconds <= 0) this.flush();
  }

  /** Scrive il buffer su disco. Non solleva mai. */
  flush() {
    if (this.buffer.length === 0) return;
    const toWrite = this.buffer.splice(0);

    if (!this._ensureDataDir()) return;

    const filePath = path.join(this.dataDir, getFileName(this.rotationMode, this.instanceId));

    // ── Perché si scrive a blocchi, e perché il blocco è da 4 KB ──
    // Su POSIX una `write` in O_APPEND **sotto PIPE_BUF (4 KB)** è atomica: due
    // processi che scrivono sullo stesso file non possono interlacciarsi. È la
    // garanzia che tiene in piedi lo scenario cluster per cui esiste instanceId,
    // e un batch unico di dimensione arbitraria la perderebbe.
    //
    // Ma la garanzia riguarda la DIMENSIONE della write, non il numero di righe:
    // finché il blocco resta sotto il tetto, dieci righe in una write sono
    // atomiche esattamente quanto una. Qui si scriveva una riga per volta, che è
    // la lettura più severa del vincolo e la si pagava dove fa più male — sotto
    // attacco il buffer accumula migliaia di eventi al secondo, e ognuno
    // costava una syscall sincrona sull'event loop, cioè sul tempo di risposta
    // di tutto il sito. Raggruppando, il numero di write scende di un ordine di
    // grandezza e l'atomicità resta intatta.
    //
    // Una singola riga più lunga di 4 KB parte da sola e supera il tetto: era
    // già così prima (una riga = una write), quindi non si perde nulla che si
    // avesse. Un evento simile è comunque patologico — l'UA è troncato a 512 e
    // il resto dei campi è limitato.
    try {
      for (const chunk of batchLines(toWrite, MAX_ATOMIC_WRITE_BYTES)) {
        fs.appendFileSync(filePath, chunk, 'utf8');
      }
      this.writeFailureLogged = false;
    } catch (err) {
      if (!this.writeFailureLogged) {
        this.log('error', `scrittura su ${filePath} fallita: ${err.message} — log sospeso finché il problema persiste`);
        this.writeFailureLogged = true;
      }
    }
  }

  /** Elimina i file più vecchi della retention. */
  applyRetention() {
    if (this.retentionDays <= 0) return;
    const cutoffMs = Date.now() - this.retentionDays * 86400000;
    let deleted = 0;

    for (const filePath of listLogFiles(this.dataDir)) {
      try {
        if (fs.statSync(filePath).mtimeMs < cutoffMs) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (_err) { /* fail-soft */ }
    }

    if (deleted > 0) this.log('info', `retention: eliminati ${deleted} file più vecchi di ${this.retentionDays} giorni`);
  }

  /**
   * Calcola l'occupazione della data dir e, se serve, sfratta dal più vecchio.
   *
   * L'allerta scatta PRIMA dello sfratto: avvisare mentre si stanno già
   * cancellando dati sarebbe inutile. Viene inviata una volta sola finché
   * l'occupazione non rientra sotto soglia, altrimenti sotto attacco l'allerta
   * diventerebbe essa stessa un problema.
   *
   * @returns {{ totalBytes: number, deleted: number }}
   */
  enforceSizeBudget() {
    const files = listLogFiles(this.dataDir);
    if (files.length === 0) return { totalBytes: 0, deleted: 0 };

    const sized = [];
    let totalBytes = 0;
    for (const filePath of files) {
      try {
        const size = fs.statSync(filePath).size;
        sized.push({ filePath, size });
        totalBytes += size;
      } catch (_err) { /* fail-soft */ }
    }

    if (this.maxTotalBytes <= 0) return { totalBytes, deleted: 0 };

    const usedPercent = (totalBytes / this.maxTotalBytes) * 100;

    if (usedPercent >= this.alertAtPercent && !this.alertSent) {
      this.alertSent = true;
      const payload = {
        // Il genere DEVE essere una chiave di ALERT_SEVERITY in alertDispatcher:
        // è quella tabella a decidere la gravità che finisce nell'oggetto
        // dell'email. Qui c'era `log-size-threshold`, che in tabella non esiste,
        // e l'allerta sul disco partiva come "INFO" — cioè la riga che deve far
        // alzare qualcuno alle tre di notte arrivava con la gravità di una nota.
        // Il difetto era invisibile ai test perché quelli del dispatcher
        // notificano già `diskBudget`, il nome giusto: si verificavano a vicenda
        // senza che nessuno dei due usasse ciò che l'altro emette davvero.
        kind: 'diskBudget',
        usedPercent: Math.round(usedPercent),
        totalBytes,
        maxTotalBytes: this.maxTotalBytes,
      };
      this.log('warn',
        `il log occupa ${Math.round(usedPercent)}% del budget ` +
        `(${Math.round(totalBytes / 1048576)} MB su ${Math.round(this.maxTotalBytes / 1048576)} MB)`);
      if (this.onAlert) {
        try { this.onAlert(payload); } catch (_err) { /* fail-soft */ }
      }
    } else if (usedPercent < this.alertAtPercent) {
      this.alertSent = false; // rientrata: riarma l'allerta per la prossima volta
    }

    // Sfratto dal più vecchio (i file sono ordinati per nome = per data).
    let deleted = 0;
    let index = 0;
    while (totalBytes > this.maxTotalBytes && index < sized.length - 1) {
      // L'ultimo file non si tocca mai: è quello su cui si sta scrivendo, e
      // cancellarlo perderebbe gli eventi dell'attacco in corso — cioè proprio
      // quelli per cui il budget è stato superato.
      try {
        fs.unlinkSync(sized[index].filePath);
        totalBytes -= sized[index].size;
        deleted++;
      } catch (_err) { /* fail-soft */ }
      index++;
    }

    if (deleted > 0) {
      this.log('warn', `budget disco superato: eliminati ${deleted} file di log più vecchi`);
    }

    return { totalBytes, deleted };
  }

  /** @returns {number} eventi ancora in memoria */
  pendingSize() {
    return this.buffer.length;
  }

  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    if (this._onShutdown) {
      process.removeListener('SIGTERM', this._onShutdown);
      process.removeListener('SIGINT', this._onShutdown);
      this._onShutdown = null;
    }
  }

  _ensureDataDir() {
    if (fs.existsSync(this.dataDir)) return true;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      return true;
    } catch (err) {
      if (!this.writeFailureLogged) {
        this.log('error', `impossibile creare la data dir ${this.dataDir}: ${err.message}`);
        this.writeFailureLogged = true;
      }
      return false;
    }
  }
}

module.exports = {
  SentinelLog, getFileName, listLogFiles, batchLines,
  FILE_PREFIX, MAX_ATOMIC_WRITE_BYTES,
};
