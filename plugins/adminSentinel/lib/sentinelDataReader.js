/**
 * sentinelDataReader.js
 *
 * Lettura dei dati prodotti da `sentinel`: il log eventi JSONL e i tre archivi
 * aggregati in JSON5.
 *
 * ─── PERCHE UN LETTORE E NON UNA API SUL SERVICE ──────────────────────────────
 * L'oggetto condiviso di `sentinel` espone lo stato *vivo* (statistiche in
 * memoria, riepilogo delle regole, sospetti scanner) ma non gli eventi storici:
 * quelli stanno su disco, in file che possono coprire un anno. Farli passare per
 * l'oggetto condiviso significherebbe caricarli tutti in memoria del service per
 * consegnarli al twin. Il twin li legge dove sono.
 *
 * ─── FUSIONE DEGLI SHARD ──────────────────────────────────────────────────────
 * I nomi dei file portano un suffisso di istanza (`sentinel-2026-08-08.w1.jsonl`)
 * che oggi è vuoto perché il processo è uno solo. Questo lettore legge comunque
 * TUTTI i file che corrispondono al prefisso e li unisce: il giorno in cui
 * ital8cms girasse in cluster, ogni worker scriverebbe sul proprio shard e la
 * dashboard continuerebbe a funzionare senza una riga di modifica. Farlo adesso
 * costa una `flatMap`; aggiungerlo dopo costerebbe una migrazione dei dati.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../../core/loadJson5');

/** Prefissi dei file prodotti dal service. */
const EVENT_PREFIX = 'sentinel';
const CENSUS_PREFIX = 'fingerprintCensus';
const OUTCOME_PREFIX = 'outcomeCensus';
const HITS_PREFIX = 'ruleHits';

/**
 * Elenca i file di log, dal più vecchio al più recente.
 * L'ordine lessicografico coincide con quello cronologico grazie al formato
 * `YYYY-MM-DD` nel nome.
 *
 * @param {string} dataDir
 * @returns {string[]} path assoluti
 */
function listEventFiles(dataDir) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  try {
    return fs.readdirSync(dataDir)
      .filter((f) => f.startsWith(EVENT_PREFIX) && f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dataDir, f));
  } catch (_err) {
    return [];
  }
}

/**
 * Legge un file JSONL. Le righe malformate vengono ignorate: un log troncato da
 * un crash non deve rendere illeggibile tutto il resto.
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => { try { return JSON.parse(line); } catch (_e) { return null; } })
      .filter(Boolean);
  } catch (_err) {
    return [];
  }
}

/**
 * Legge gli eventi più recenti, leggendo i file dal più recente all'indietro
 * finché non se ne hanno abbastanza.
 *
 * Non si caricano tutti i file per poi tagliare: con retention a 365 giorni
 * sarebbero centinaia di megabyte in memoria per mostrarne cinquanta righe.
 *
 * @param {string} dataDir
 * @param {object} [filter]
 * @param {number} [filter.limit=100]
 * @param {string} [filter.ruleName]
 * @param {string} [filter.category]
 * @param {string} [filter.ip]
 * @param {boolean} [filter.enforcedOnly]
 * @returns {{ events: Array<object>, scannedFiles: number, truncated: boolean }}
 */
function readRecentEvents(dataDir, filter = {}) {
  const limit = Number.isFinite(filter.limit) && filter.limit > 0 ? Math.min(filter.limit, 1000) : 100;
  const files = listEventFiles(dataDir).reverse(); // dal più recente

  const matches = (event) => {
    if (filter.ruleName && event.ruleName !== filter.ruleName) return false;
    if (filter.category && event.category !== filter.category) return false;
    if (filter.ip && event.ip !== filter.ip) return false;
    if (filter.enforcedOnly && event.enforced !== true) return false;
    return true;
  };

  const collected = [];
  let scannedFiles = 0;
  // «Ne sono rimasti fuori»: vero perché ne abbiamo VISTI altri, non perché il
  // limite è stato raggiunto. Erano la stessa cosa nel codice e non lo sono
  // nella realtà: un log con esattamente `limit` eventi si dichiarava troncato
  // avendo consegnato tutto quello che aveva.
  let leftOut = false;

  for (const filePath of files) {
    scannedFiles++;
    const rows = readJsonl(filePath).filter(matches);
    // Dentro un file l'ordine è cronologico crescente: si prende dalla coda.
    let i = rows.length - 1;
    for (; i >= 0 && collected.length < limit; i--) {
      collected.push(rows[i]);
    }

    if (collected.length >= limit) {
      // Righe avanzate in QUESTO file, oppure file più vecchi non aperti: in
      // entrambi i casi ci sono altri eventi. Il secondo caso è prudente — con
      // un filtro stretto quei file potrebbero non contenerne nessuno — e la
      // prudenza va in questa direzione: dire «forse c'è dell'altro» quando non
      // c'è costa una riga di interfaccia, tacerlo quando c'è nasconde dati.
      leftOut = i >= 0 || scannedFiles < files.length;
      break;
    }
  }

  return {
    events: collected,
    scannedFiles,
    truncated: leftOut,
  };
}

/**
 * Righe elaborate fra due cessioni del controllo all'event loop.
 *
 * Il valore serve a mettere un TETTO alla singola pausa, non a ripartire il
 * lavoro equamente: cedere fra un file e l'altro non basterebbe, perché sotto
 * attacco un file giornaliero può prendersi da solo quasi tutto il budget dei
 * 200 MB della data dir e varrebbe da sé una stalla di secondi.
 */
const LINES_PER_SLICE = 20000;

/**
 * Scorre gli eventi di una finestra temporale passandoli a una callback, **senza
 * mai materializzarli tutti insieme**.
 *
 * ─── PERCHE ASINCRONA, PER UNA LETTURA CHE E TUTTA SINCRONA ───────────────────
 * `readFileSync` e `JSON.parse` non cedono il controllo: finché girano, il
 * processo non serve nessun'altra richiesta. Su un anno di log al tetto dei
 * 200 MB sono ~3 secondi in cui l'INTERO sito è fermo — non la dashboard, il
 * sito — e con l'auto-aggiornamento della panoramica la cosa si ripete da sé.
 *
 * Qui il lavoro è lo stesso ma spezzato: ogni `LINES_PER_SLICE` righe si cede al
 * loop, così le altre richieste passano in mezzo. Il tempo totale non cala (è
 * CPU, e va pagata); cambia che non è più una stalla ma qualche millisecondo in
 * più su ciascuna delle richieste che nel frattempo arrivano.
 *
 * Chi ha bisogno del riepilogo NON accumuli in un array: usa
 * `aggregator.createSummaryAccumulator()`, che è la ragione per cui questa
 * funzione consegna un evento per volta invece di restituirne un elenco.
 *
 * @param {string} dataDir
 * @param {number} [days=7] - Giorni da coprire a ritroso
 * @param {(event: object) => void} onEvent - Riceve ogni evento dentro la finestra
 * @returns {Promise<{ scannedFiles: number, eventCount: number }>}
 */
async function forEachEventSince(dataDir, days = 7, onEvent) {
  const cutoffMs = Date.now() - days * 86400000;
  const files = listEventFiles(dataDir).reverse();

  let scannedFiles = 0;
  let eventCount = 0;
  // Il conteggio attraversa i file invece di ripartire da capo a ogni file:
  // trecento file da poche righe non devono poter scorrere senza mai cedere.
  let sinceLastYield = 0;

  for (const filePath of files) {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_e) { continue; }
    // Un file la cui ultima scrittura è precedente alla finestra non può
    // contenere eventi dentro la finestra: si può smettere (i file sono in
    // ordine cronologico decrescente).
    if (mtimeMs < cutoffMs) break;

    let lines;
    try { lines = fs.readFileSync(filePath, 'utf8').split('\n'); } catch (_e) { continue; }
    scannedFiles++;

    for (const line of lines) {
      if (line.trim()) {
        // Una riga malformata si salta: un log troncato da un crash non deve
        // rendere illeggibile tutto il resto.
        let event = null;
        try { event = JSON.parse(line); } catch (_e) { event = null; }
        if (event) {
          const t = Date.parse(event.timestamp);
          if (Number.isFinite(t) && t >= cutoffMs) {
            onEvent(event);
            eventCount++;
          }
        }
      }

      if (++sinceLastYield >= LINES_PER_SLICE) {
        sinceLastYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  return { scannedFiles, eventCount };
}

/**
 * Timbro dei file da cui dipende il riepilogo di una finestra: cambia se e solo
 * se può essere cambiata la risposta.
 *
 * Serve a rispondere alla domanda «ricalcolare cambierebbe qualcosa?» al costo
 * di una `readdir` e di qualche `stat` — millisecondi — invece che rileggendo
 * tutto. Se il timbro coincide con quello di un riepilogo già calcolato, quel
 * riepilogo non è vecchio: è **esatto**, e servirlo non è una scorciatoia.
 *
 * Comprende anche gli archivi delle impronte, non solo il log: `/summary`
 * riporta la quota di traffico non classificato, che nasce da lì. Un timbro che
 * guardasse i soli eventi terrebbe buona una quota ormai superata.
 *
 * Limite dichiarato: due riscritture dello stesso file nello stesso millisecondo
 * e con la stessa dimensione sarebbero indistinguibili. Per il log non può
 * succedere (si appende, quindi la dimensione cresce); per un archivio riscritto
 * intero è teoricamente possibile e praticamente trascurabile — e l'età massima
 * della cache lo limita comunque.
 *
 * @param {string} dataDir
 * @param {number} [days=7]
 * @returns {string} timbro opaco, da confrontare e basta
 */
function windowStamp(dataDir, days = 7) {
  if (!dataDir) return 'no-data-dir';
  const cutoffMs = Date.now() - days * 86400000;

  let names;
  try { names = fs.readdirSync(dataDir); } catch (_err) { return 'unreadable'; }

  let files = 0;
  let newestMtimeMs = 0;
  let totalBytes = 0;

  for (const name of names) {
    const isEvent = name.startsWith(EVENT_PREFIX) && name.endsWith('.jsonl');
    const isCensus = name.startsWith(CENSUS_PREFIX) && name.endsWith('.json5');
    if (!isEvent && !isCensus) continue;

    let stat;
    try { stat = fs.statSync(path.join(dataDir, name)); } catch (_err) { continue; }
    // Fuori finestra: non contribuisce alla risposta, quindi non al timbro.
    if (isEvent && stat.mtimeMs < cutoffMs) continue;

    files++;
    totalBytes += stat.size;
    if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs;
  }

  return `${days}:${files}:${newestMtimeMs}:${totalBytes}`;
}

/**
 * Legge e FONDE gli archivi aggregati sparsi su più shard.
 *
 * @param {string} dataDir
 * @param {string} prefix
 * @returns {Array<object>} i contenuti dei singoli shard
 */
function readShards(dataDir, prefix) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  let files;
  try {
    files = fs.readdirSync(dataDir).filter((f) => f.startsWith(prefix) && f.endsWith('.json5'));
  } catch (_err) {
    return [];
  }
  const out = [];
  for (const f of files) {
    try { out.push(loadJson5(path.join(dataDir, f))); }
    catch (_err) { /* shard corrotto: si ignora, gli altri restano leggibili */ }
  }
  return out;
}

/**
 * Prima voce di un accumulatore di fusione: contatori garantiti numerici e
 * identità che vince sul contenuto dello shard.
 *
 * ─── PERCHE NON BASTA LO SPREAD ───────────────────────────────────────────────
 * L'accumulatore nasceva come copia della PRIMA voce incontrata, e da lì in poi
 * le difese (`|| 0`, `|| {}`) proteggevano solo la voce *in arrivo*. Una prima
 * voce incompleta — shard troncato, file di uno schema più vecchio, scrittura
 * interrotta — avvelenava quindi tutta la fusione: `undefined + 5` è `NaN`, e
 * `existing.byStatus[code]` su un `byStatus` assente è un TypeError che fa
 * fallire l'intera rotta. Verificato eseguendo il modulo.
 *
 * Il difetto non si vede oggi (il service scrive sempre tutti i campi, anche a
 * zero) e vive nel ramo che serve al cluster: cioè quello che nessuno eserciterà
 * finché non servirà davvero. `readShards` a monte è già fail-soft con gli shard
 * illeggibili; questo lo rende coerente con quelli parziali.
 *
 * @param {object} entry - la voce così com'è nello shard
 * @param {string[]} counters - chiavi da forzare a numero
 * @param {object} identity - `{ fp }` / `{ clientId }` / `{ ruleName }`
 * @returns {object}
 */
function seedMergedEntry(entry, counters, identity) {
  const seeded = { ...entry, ...identity };
  for (const key of counters) {
    seeded[key] = Number.isFinite(entry[key]) ? entry[key] : 0;
  }
  return seeded;
}

/** Estremi temporali: si allargano, e tollerano un capo ancora assente. */
function widenEarliest(existing, candidate) {
  if (!candidate) return existing;
  return (!existing || candidate < existing) ? candidate : existing;
}

function widenLatest(existing, candidate) {
  if (!candidate) return existing;
  return (!existing || candidate > existing) ? candidate : existing;
}

/**
 * Censimento delle impronte, fuso fra gli shard.
 *
 * @param {string} dataDir
 * @returns {{ fingerprints: Array<object>, evictions: number, ipMode: string }}
 */
function readFingerprintCensus(dataDir) {
  const shards = readShards(dataDir, CENSUS_PREFIX);
  const merged = new Map();
  let evictions = 0;
  let ipMode = 'count';

  for (const shard of shards) {
    evictions += shard.evictions || 0;
    if (shard.ipMode) ipMode = shard.ipMode;

    for (const [fp, entry] of Object.entries(shard.fingerprints || {})) {
      const existing = merged.get(fp);
      if (!existing) {
        merged.set(fp, seedMergedEntry(
          entry, ['count', 'matchedCount', 'blockedCount', 'ipCount', 'pathCount'], { fp },
        ));
        continue;
      }
      // Fusione fra shard: i contatori si sommano, gli estremi temporali si
      // allargano. `ipCount` sovrastima se lo stesso indirizzo è stato visto da
      // due worker diversi — è un limite noto del conteggio distribuito senza
      // stato condiviso, e con un processo solo non si presenta.
      existing.count += entry.count || 0;
      existing.matchedCount += entry.matchedCount || 0;
      existing.blockedCount += entry.blockedCount || 0;
      existing.ipCount = Math.max(existing.ipCount, entry.ipCount || 0);
      existing.pathCount = Math.max(existing.pathCount, entry.pathCount || 0);
      existing.firstSeen = widenEarliest(existing.firstSeen, entry.firstSeen);
      existing.lastSeen = widenLatest(existing.lastSeen, entry.lastSeen);
    }
  }

  return {
    fingerprints: Array.from(merged.values()).sort((a, b) => (b.count || 0) - (a.count || 0)),
    evictions,
    ipMode,
  };
}

/**
 * Aggregato degli esiti, fuso fra gli shard.
 *
 * @param {string} dataDir
 * @returns {{ clients: Array<object>, evictions: number }}
 */
function readOutcomeCensus(dataDir) {
  const shards = readShards(dataDir, OUTCOME_PREFIX);
  const merged = new Map();
  let evictions = 0;

  for (const shard of shards) {
    evictions += shard.evictions || 0;
    for (const [clientId, entry] of Object.entries(shard.byClient || {})) {
      const existing = merged.get(clientId);
      if (!existing) {
        const seeded = seedMergedEntry(entry, ['total', 'distinctPaths'], { clientId });
        // Clonato, e mai condiviso con l'oggetto appena parsato: la fusione ci
        // somma dentro, e mutare il contenuto di uno shard letto sarebbe un
        // effetto collaterale invisibile.
        seeded.byStatus = { ...(entry.byStatus || {}) };
        merged.set(clientId, seeded);
        continue;
      }
      existing.total += entry.total || 0;
      existing.distinctPaths = Math.max(existing.distinctPaths, entry.distinctPaths || 0);
      // Basta che UNO shard abbia saturato il conteggio perché il numero fuso
      // sia un limite inferiore: la saturazione si propaga in OR, come
      // `safeToPromote` si propaga in AND poco più sotto e per la stessa
      // ragione — fondere due misure parziali non può produrre più certezza di
      // quanta ne avesse la meno certa delle due.
      existing.distinctPathsSaturated = existing.distinctPathsSaturated === true
        || entry.distinctPathsSaturated === true;
      for (const [code, n] of Object.entries(entry.byStatus || {})) {
        existing.byStatus[code] = (existing.byStatus[code] || 0) + (Number.isFinite(n) ? n : 0);
      }
      existing.firstSeen = widenEarliest(existing.firstSeen, entry.firstSeen);
      existing.lastSeen = widenLatest(existing.lastSeen, entry.lastSeen);
    }
  }

  return {
    clients: Array.from(merged.values()).sort((a, b) => (b.distinctPaths || 0) - (a.distinctPaths || 0)),
    evictions,
  };
}

/**
 * Contatori per regola, fusi fra gli shard.
 *
 * `authenticatedHits` è il campo che decide se una regola sia promuovibile:
 * sommandolo fra shard non si perde nulla, perché basta che UNO abbia colpito un
 * utente autenticato perché la promozione sia sconsigliata.
 *
 * @param {string} dataDir
 * @returns {Array<object>}
 */
function readRuleHits(dataDir) {
  const shards = readShards(dataDir, HITS_PREFIX);
  const merged = new Map();

  for (const shard of shards) {
    for (const [ruleName, entry] of Object.entries(shard.rules || {})) {
      const existing = merged.get(ruleName);
      if (!existing) {
        merged.set(ruleName, seedMergedEntry(
          entry,
          ['hits', 'enforcedHits', 'authenticatedHits', 'botHits', 'distinctIps'],
          { ruleName },
        ));
        continue;
      }
      existing.hits += entry.hits || 0;
      existing.enforcedHits += entry.enforcedHits || 0;
      existing.authenticatedHits += entry.authenticatedHits || 0;
      existing.botHits += entry.botHits || 0;
      existing.distinctIps = Math.max(existing.distinctIps, entry.distinctIps || 0);
      existing.lastHit = widenLatest(existing.lastHit, entry.lastHit);
      existing.firstHit = widenEarliest(existing.firstHit, entry.firstHit);
      // Ricalcolato dopo la fusione: il valore dei singoli shard non vale per
      // l'insieme (uno può avere zero hit autenticati e un altro no).
      existing.safeToPromote = existing.hits > 0 && existing.authenticatedHits === 0;
    }
  }

  return Array.from(merged.values()).sort((a, b) => (b.hits || 0) - (a.hits || 0));
}

module.exports = {
  listEventFiles,
  readJsonl,
  readRecentEvents,
  forEachEventSince,
  windowStamp,
  readFingerprintCensus,
  readOutcomeCensus,
  readRuleHits,
};
