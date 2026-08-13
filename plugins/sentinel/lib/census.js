/**
 * census.js
 *
 * I due archivi aggregati di sentinel: il censimento delle impronte e
 * l'aggregato degli esiti. Stanno nello stesso file perché condividono la
 * persistenza (scrittura atomica su .json5, ricarica al riavvio) e differiscono
 * solo per la forma del record; tenerli separati avrebbe significato duplicare
 * quella parte in due posti destinati a divergere.
 *
 * ─── PERCHE AGGREGATI E NON RIGHE DI LOG ──────────────────────────────────────
 * Il log eventi registra i fatti: una riga per richiesta che ha fatto scattare
 * una regola. Questi due archivi registrano invece le TENDENZE, e devono poterlo
 * fare anche per il traffico che nessuna regola descrive — dove si scoprono le
 * regole mancanti. Con una riga per richiesta il volume sarebbe quello di
 * analytics; con dei contatori è trascurabile.
 *
 * ─── I DUE SEGNALI CHE VALGONO IL PREZZO ──────────────────────────────────────
 *   1. una impronta vista da 500 IP diversi  → botnet, e lo si sa senza
 *      conservare un solo indirizzo (censusIpMode: "count")
 *   2. un client che colleziona 198 percorsi distinti tutti in 404 in pochi
 *      minuti → scansione, senza che nessuna regola l'abbia descritta
 *
 * ─── ENTRAMBI SONO LIMITATI ───────────────────────────────────────────────────
 * Le chiavi sono controllate dall'attaccante (vedi BoundedStore): tetto, TTL,
 * sfratto LRU e sweep periodico non sono ottimizzazioni, sono la condizione per
 * cui questi archivi non diventano il modo di far cadere il processo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const BoundedStore = require('./boundedStore');

/**
 * Scrittura atomica di un archivio.
 *
 * Temp + rename: un lettore non può mai vedere il file a metà. Qui conta più che
 * altrove perché il twin admin leggerà questi file mentre il motore li riscrive.
 * Non solleva mai: perdere un salvataggio del censimento è irrilevante, far
 * cadere un timer con un'eccezione no (diventerebbe un uncaughtException).
 */
function saveAtomic(filePath, payload, log) {
  const header = '// This file follows the JSON5 standard - written by the sentinel plugin, do not edit by hand\n';
  const tempPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, header + JSON.stringify(payload, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    if (log) log('warn', `salvataggio di ${path.basename(filePath)} fallito: ${err.message}`);
    return false;
  }
}

/**
 * Ricostruisce la mappa indirizzo → ultima comparsa da ciò che c'è su disco.
 *
 * Accetta due formati: quello attuale (`ipsSeenMs`, un oggetto con le date) e
 * quello storico (`ips`, un semplice elenco). Nel secondo caso gli indirizzi
 * vengono datati all'ultima comparsa della voce: è l'informazione più vicina al
 * vero che si abbia, ed è conservativa — li fa scadere prima, non dopo.
 */
function hydrateIps(ips, seenMs, ipsSeenMs) {
  const map = new Map();
  if (ipsSeenMs && typeof ipsSeenMs === 'object') {
    for (const [ip, ms] of Object.entries(ipsSeenMs)) map.set(ip, Number(ms) || seenMs);
    return map;
  }
  if (Array.isArray(ips)) {
    for (const ip of ips) map.set(ip, seenMs);
  }
  return map;
}

function loadSafely(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return loadJson5(filePath);
  } catch (_err) {
    // Un archivio corrotto si ricostruisce da solo con il traffico successivo:
    // non vale né un errore né un blocco.
    return null;
  }
}

const isoOrNull = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

// ─────────────────────────────────────────────────────────────────────────────
// CENSIMENTO DELLE IMPRONTE
// ─────────────────────────────────────────────────────────────────────────────

class FingerprintCensus {
  /**
   * @param {string} dataDir
   * @param {object} config
   * @param {'none'|'count'|'full'} config.censusIpMode
   *   none  → nessuna informazione sugli IP
   *   count → solo il NUMERO di IP distinti: dà il segnale botnet senza
   *           conservare alcun indirizzo (default)
   *   full  → elenco degli indirizzi. Rende l'archivio un insieme di dati
   *           personali a lunga conservazione: da qui la retention anche qui,
   *           che con "none"/"count" non servirebbe.
   * @param {object} [deps]
   */
  constructor(dataDir, config, deps = {}) {
    this.filePath = path.join(dataDir, `fingerprintCensus${config.instanceId ? '.' + config.instanceId : ''}.json5`);
    this.ipMode = ['none', 'count', 'full'].includes(config.censusIpMode) ? config.censusIpMode : 'count';
    this.maxIpsPerFingerprint = Number.isFinite(config.maxIpsPerFingerprint) ? config.maxIpsPerFingerprint : 256;

    // Retention DEGLI INDIRIZZI, separata da quella delle voci.
    //
    // Serve solo con ipMode "full", che è l'unico caso in cui gli indirizzi
    // finiscono su disco. Senza, un'impronta sempre attiva non scadrebbe mai —
    // il TTL della voce si conta dall'ultimo uso — e il suo elenco di indirizzi
    // resterebbe lì per sempre: un archivio di dati personali senza scadenza.
    //
    // Scadono gli INDIRIZZI, non il CONTEGGIO: `ipCount` è una statistica
    // ("questa impronta arriva da 500 origini", il segnale botnet) e non un dato
    // personale, quindi non ha ragione di essere cancellata con loro.
    this.ipRetentionDays = Number.isFinite(config.ipRetentionDays) ? config.ipRetentionDays : 30;
    this.log = deps.log || (() => {});

    this.store = new BoundedStore({
      maxEntries: Number.isFinite(config.maxFingerprints) ? config.maxFingerprints : 10000,
      ttlSeconds: Number.isFinite(config.ttlDays) ? config.ttlDays * 86400 : 90 * 86400,
    });

    this.dirty = false;
  }

  load() {
    const data = loadSafely(this.filePath);
    if (!data || !data.fingerprints) return;
    this.store.loadFrom(data.fingerprints, (_key, raw) => {
      if (!raw || typeof raw !== 'object') return null;
      return {
        firstSeenMs: raw.firstSeenMs || Date.now(),
        lastSeenMs: raw.lastSeenMs || Date.now(),
        count: raw.count || 0,
        // Ricadere su `count` per le voci scritte prima che questo campo
        // esistesse: un censimento vecchio non deve far sparire il giudizio.
        judgedCount: raw.judgedCount === undefined ? (raw.count || 0) : raw.judgedCount,
        matchedCount: raw.matchedCount || 0,
        blockedCount: raw.blockedCount || 0,
        paths: new Set(Array.isArray(raw.samplePaths) ? raw.samplePaths : []),
        pathCount: raw.pathCount || 0,
        // Formato storico: array di stringhe. Si accetta ancora, datando gli
        // indirizzi all'ultima comparsa della voce — l'informazione più vicina
        // al vero che si abbia, e comunque conservativa.
        ips: hydrateIps(raw.ips, raw.lastSeenMs || Date.now(), raw.ipsSeenMs),
        ipCount: raw.ipCount || 0,
        class: raw.class || {},
      };
    });
  }

  /**
   * Registra una comparsa.
   *
   * @param {string} fp
   * @param {object} info
   * @param {object} info.fpClass
   * @param {string} info.ip
   * @param {string} info.path
   * @param {boolean} info.matched  - una regola ha matchato
   * @param {boolean} info.blocked  - l'azione è stata applicata
   */
  record(fp, info) {
    if (!fp) return;

    this.store.upsert(fp,
      () => ({
        firstSeenMs: Date.now(),
        lastSeenMs: Date.now(),
        count: 0,
        judgedCount: 0,
        matchedCount: 0,
        blockedCount: 0,
        paths: new Set(),
        pathCount: 0,
        ips: new Map(),
        ipCount: 0,
        class: info.fpClass || {},
      }),
      (entry) => {
        entry.count++;
        // `judgedCount` è il denominatore della reputazione, e conta solo le
        // richieste giudicate NEL MERITO. Una richiesta decisa da una regola di
        // reputazione non lo è stata: è stata decisa dal giudizio stesso.
        //
        // Escludere solo il numeratore non basterebbe, ed è un errore che si
        // vede solo dal vivo: mentre il giudizio è in vigore la regola di
        // reputazione scatta per prima, quindi nessun'altra regola produce più
        // blocchi, il numeratore si ferma e il denominatore no. La quota
        // scende da sola finché l'impronta non viene perdonata — e poi
        // ricondannata, in un'oscillazione senza fine.
        if (info.judged !== false) entry.judgedCount++;
        if (info.matched) entry.matchedCount++;
        if (info.blocked) entry.blockedCount++;
        entry.class = info.fpClass || entry.class;

        // I percorsi si contano tenendo un campione limitato: l'obiettivo è
        // distinguere "un client che chiede sempre la stessa cosa" da "un client
        // che ne prova centinaia", non ricostruire la navigazione.
        if (info.path && entry.paths.size < 64 && !entry.paths.has(info.path)) {
          entry.paths.add(info.path);
          entry.pathCount++;
        } else if (info.path && !entry.paths.has(info.path)) {
          entry.pathCount++;
        }

        if (this.ipMode !== 'none' && info.ip) {
          if (!entry.ips.has(info.ip)) {
            entry.ipCount++;
            // Anche con ipMode "count" si tiene un insieme limitato: senza, non
            // si potrebbe sapere se un IP è già stato visto e ogni richiesta
            // incrementerebbe il conteggio, rendendolo un contatore di richieste
            // travestito da contatore di indirizzi.
            if (entry.ips.size < this.maxIpsPerFingerprint) entry.ips.set(info.ip, Date.now());
          } else {
            entry.ips.set(info.ip, Date.now());
          }
        }
      });

    this.dirty = true;
  }

  sweep() {
    const removed = this.store.sweep();
    if (removed > 0) this.dirty = true;
    if (this.sweepIps() > 0) this.dirty = true;
    return removed;
  }

  /**
   * Fa scadere gli INDIRIZZI conservati, lasciando intatti i conteggi.
   *
   * Gira solo con ipMode "full": è l'unico caso in cui gli indirizzi finiscono
   * su disco, e quindi l'unico in cui c'è qualcosa da conservare o da
   * dimenticare. Con "count" l'insieme vive solo in memoria e serve a non
   * ricontare due volte lo stesso indirizzo; farlo scadere gonfierebbe il
   * conteggio dei distinti senza alcun beneficio.
   *
   * @returns {number} indirizzi dimenticati
   */
  sweepIps() {
    if (this.ipMode !== 'full' || this.ipRetentionDays <= 0) return 0;

    const cutoff = Date.now() - this.ipRetentionDays * 86400 * 1000;
    let removed = 0;
    for (const entry of this.store.entries.values()) {
      for (const [ip, seenMs] of entry.ips) {
        if (seenMs < cutoff) { entry.ips.delete(ip); removed++; }
      }
    }
    return removed;
  }

  /**
   * Voce del censimento, per chi deve ricavarne un giudizio.
   * Sola lettura: chi chiama non deve modificarla.
   */
  getEntry(fp) {
    return fp ? this.store.get(fp) || null : null;
  }

  save() {
    if (!this.dirty) return false;
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      ipMode: this.ipMode,
      // Non una statistica di servizio: in esercizio normale resta a zero, e un
      // valore che sale indica che qualcuno sta producendo impronte a raffica.
      evictions: this.store.evictions,
      fingerprints: this.store.toObject((entry) => ({
        firstSeen: isoOrNull(entry.firstSeenMs),
        lastSeen: isoOrNull(entry.lastSeenMs),
        firstSeenMs: entry.firstSeenMs,
        lastSeenMs: entry.lastSeenMs,
        count: entry.count,
        judgedCount: entry.judgedCount,
        matchedCount: entry.matchedCount,
        blockedCount: entry.blockedCount,
        pathCount: entry.pathCount,
        samplePaths: Array.from(entry.paths).slice(0, 16),
        ipCount: this.ipMode === 'none' ? 0 : entry.ipCount,
        // Solo con "full" gli indirizzi finiscono su disco. Con "count" restano
        // in memoria come aiuto alla deduplica e non vengono mai scritti.
        ips: this.ipMode === 'full' ? Array.from(entry.ips.keys()) : [],
        ipsSeenMs: this.ipMode === 'full' ? Object.fromEntries(entry.ips) : undefined,
        class: entry.class,
      })),
    };
    const ok = saveAtomic(this.filePath, payload, this.log);
    if (ok) this.dirty = false;
    return ok;
  }

  getStats() {
    return {
      tracked: this.store.size,
      evictions: this.store.evictions,
      ipMode: this.ipMode,
      ipRetentionDays: this.ipMode === 'full' ? this.ipRetentionDays : null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATO DEGLI ESITI
// ─────────────────────────────────────────────────────────────────────────────

class OutcomeCensus {
  /**
   * Registra come sono finite le richieste LASCIATE PASSARE, per client.
   *
   * Solo esiti **dal 400 in su**: è il pezzo che permette a sentinel di
   * accorgersi di attacchi per cui NON esiste ancora una regola — senza, il
   * filtro saprebbe solo ciò che gli è già stato insegnato a riconoscere.
   *
   * Il 2xx è escluso dal gate (non è un segnale, e toglie il 99% delle
   * chiamate); il **3xx** è escluso da `observeOutcome`, dove sta la ragione per
   * esteso: un redirect non è una richiesta fallita, e contarlo manda fra i
   * «sospetti scanner» chi segue i redirect di un sito che ne ha molti.
   */
  constructor(dataDir, config, deps = {}) {
    this.filePath = path.join(dataDir, `outcomeCensus${config.instanceId ? '.' + config.instanceId : ''}.json5`);
    this.log = deps.log || (() => {});

    this.store = new BoundedStore({
      maxEntries: Number.isFinite(config.maxClients) ? config.maxClients : 5000,
      ttlSeconds: Number.isFinite(config.ttlHours) ? config.ttlHours * 3600 : 24 * 3600,
    });

    this.dirty = false;
  }

  load() {
    const data = loadSafely(this.filePath);
    if (!data || !data.byClient) return;
    this.store.loadFrom(data.byClient, (_key, raw) => {
      if (!raw || typeof raw !== 'object') return null;
      return {
        firstSeenMs: raw.firstSeenMs || Date.now(),
        lastSeenMs: raw.lastSeenMs || Date.now(),
        total: raw.total || 0,
        byStatus: raw.byStatus || {},
        paths: new Set(Array.isArray(raw.samplePaths) ? raw.samplePaths : []),
        distinctPaths: raw.distinctPaths || 0,
      };
    });
  }

  /**
   * @param {string} clientId - IP normalizzato
   * @param {number} status
   * @param {string} reqPath
   */
  record(clientId, status, reqPath) {
    if (!clientId) return;

    this.store.upsert(clientId,
      () => ({
        firstSeenMs: Date.now(),
        lastSeenMs: Date.now(),
        total: 0,
        byStatus: {},
        paths: new Set(),
        distinctPaths: 0,
      }),
      (entry) => {
        entry.total++;
        const key = String(status);
        entry.byStatus[key] = (entry.byStatus[key] || 0) + 1;
        if (reqPath && !entry.paths.has(reqPath)) {
          entry.distinctPaths++;
          if (entry.paths.size < 256) entry.paths.add(reqPath);
        }
      });

    this.dirty = true;
  }

  sweep() {
    const removed = this.store.sweep();
    if (removed > 0) this.dirty = true;
    return removed;
  }

  save() {
    if (!this.dirty) return false;
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      evictions: this.store.evictions,
      byClient: this.store.toObject((entry) => ({
        firstSeen: isoOrNull(entry.firstSeenMs),
        lastSeen: isoOrNull(entry.lastSeenMs),
        firstSeenMs: entry.firstSeenMs,
        lastSeenMs: entry.lastSeenMs,
        total: entry.total,
        byStatus: entry.byStatus,
        distinctPaths: entry.distinctPaths,
        samplePaths: Array.from(entry.paths).slice(0, 32),
      })),
    };
    const ok = saveAtomic(this.filePath, payload, this.log);
    if (ok) this.dirty = false;
    return ok;
  }

  /**
   * Client che hanno collezionato molti percorsi distinti falliti: è la firma
   * della scansione, e non richiede alcuna regola scritta a mano.
   *
   * @param {number} minDistinctPaths
   * @returns {Array<{ clientId: string, distinctPaths: number, total: number }>}
   */
  getSuspectedScanners(minDistinctPaths = 20) {
    const out = [];
    for (const [clientId, entry] of this.store.entries) {
      if (entry.distinctPaths >= minDistinctPaths) {
        out.push({ clientId, distinctPaths: entry.distinctPaths, total: entry.total });
      }
    }
    return out.sort((a, b) => b.distinctPaths - a.distinctPaths);
  }

  getStats() {
    return {
      tracked: this.store.size,
      evictions: this.store.evictions,
    };
  }
}

module.exports = { FingerprintCensus, OutcomeCensus, saveAtomic };
