/**
 * aggregator.js
 *
 * Trasforma gli eventi grezzi di `sentinel` nei numeri che la Vista Dati mostra.
 *
 * ─── COSA DEVE RISPONDERE, E PERCHE PROPRIO QUESTO ────────────────────────────
 * La domanda che il plugin esiste per risolvere non è «quante richieste ho
 * bloccato» — che è un numero rassicurante e inutile — ma **com'è composto il
 * traffico ostile**: quali famiglie, in che proporzione, da quante origini, con
 * quali impronte. Da lì si decide cosa promuovere.
 *
 * Da qui la scelta di aggregare per `category` prima che per `ruleName`: trenta
 * righe di nomi non dicono niente, «sonde verso CMS estranei: 62%» sì.
 */

'use strict';

/**
 * Riepilogo di una finestra di eventi.
 *
 * @param {Array<object>} events
 * @returns {object}
 */
function summarize(events) {
  const byCategory = new Map();
  const byRule = new Map();
  const byIp = new Map();
  const byFingerprint = new Map();
  const byDay = new Map();

  let enforced = 0;
  let observed = 0;
  let authenticated = 0;
  let bots = 0;
  let incoherent = 0;

  for (const event of events) {
    if (event.enforced) enforced++; else observed++;
    if (event.isAuthenticated) authenticated++;
    if (event.isBot) bots++;
    if (event.fpClass && event.fpClass.coherent === false) incoherent++;

    bump(byCategory, event.category || 'uncategorized');
    bump(byRule, event.ruleName || '—');
    if (event.ip) bump(byIp, event.ip);
    if (event.fp) bump(byFingerprint, event.fp);

    const day = typeof event.timestamp === 'string' ? event.timestamp.slice(0, 10) : null;
    if (day) bump(byDay, day);
  }

  return {
    total: events.length,
    enforced,
    observed,
    authenticated,
    bots,
    // Il segnale singolo più affidabile del plugin: quante richieste hanno
    // dichiarato un browser mentre la forma degli header diceva altro.
    incoherent,
    distinctIps: byIp.size,
    distinctFingerprints: byFingerprint.size,
    byCategory: toSortedArray(byCategory, 'category'),
    byRule: toSortedArray(byRule, 'ruleName'),
    topIps: toSortedArray(byIp, 'ip').slice(0, 20),
    topFingerprints: toSortedArray(byFingerprint, 'fp').slice(0, 20),
    timeline: toSortedArray(byDay, 'day').sort((a, b) => a.day.localeCompare(b.day)),
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedArray(map, keyName) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Unisce i contatori per regola con la definizione corrente delle regole, così
 * la tabella mostra anche quelle che non hanno MAI sparato — che sono
 * l'informazione più utile per potare.
 *
 * Accetta sia un elenco di NOMI sia le definizioni complete: queste ultime
 * portano l'`action` in vigore, che serve alla GUI per sapere quale gesto
 * proporre — promuovere o retrocedere.
 *
 * @param {Array<object>} ruleHits          - da sentinelDataReader.readRuleHits
 * @param {Array<string|object>} definitions - dall'oggetto condiviso del service
 * @returns {Array<object>}
 */
function mergeRuleStatus(ruleHits, definitions) {
  const byName = new Map(ruleHits.map((r) => [r.ruleName, r]));
  const out = [];

  for (const entry of definitions || []) {
    const definition = typeof entry === 'string' ? { name: entry } : (entry || {});
    const name = definition.name;
    if (!name) continue;

    const meta = {
      action: definition.action || null,
      category: definition.category || null,
      description: definition.description || '',
      enabled: definition.enabled !== false,
      escalatesTo: definition.escalatesTo || null,
    };

    const hits = byName.get(name);
    out.push(hits
      ? { ...hits, ...meta, defined: true }
      : {
        ruleName: name,
        ...meta,
        defined: true,
        hits: 0, enforcedHits: 0, authenticatedHits: 0, botHits: 0, distinctIps: 0,
        firstHit: null, lastHit: null,
        // Una regola con zero hit non è «sicura da promuovere»: è una regola di
        // cui non si sa niente. Promuoverla sarebbe un atto di fede, non una
        // decisione informata — la differenza che l'intero percorso in tre fasi
        // esiste per creare.
        safeToPromote: false,
        neverFired: true,
      });
    byName.delete(name);
  }

  // Contatori rimasti orfani: la regola è stata rinominata o rimossa, e la sua
  // storia è ancora su disco. Mostrarla evita di far sparire dati in silenzio.
  for (const orphan of byName.values()) {
    out.push({ ...orphan, defined: false });
  }

  return out.sort((a, b) => (b.hits || 0) - (a.hits || 0));
}

/**
 * Client con molti percorsi distinti falliti: la firma della scansione.
 *
 * È il pezzo che non deriva da nessuna regola — nasce dall'osservazione degli
 * esiti — ed è quindi il posto dove si scoprono gli attacchi per cui una regola
 * ancora non esiste.
 *
 * @param {Array<object>} clients - da sentinelDataReader.readOutcomeCensus
 * @param {number} [minDistinctPaths=20]
 * @returns {Array<object>}
 */
function suspectedScanners(clients, minDistinctPaths = 20) {
  return (clients || [])
    .filter((c) => (c.distinctPaths || 0) >= minDistinctPaths)
    .map((c) => ({
      clientId: c.clientId,
      distinctPaths: c.distinctPaths,
      // Il conteggio si ferma a un tetto (vedi census.js): oltre quello il
      // valore è un limite inferiore, e la tabella lo mostra come "1024+".
      // Nasconderlo darebbe per esatta una stima proprio dove si sta valutando
      // quanto è grande una scansione.
      distinctPathsSaturated: c.distinctPathsSaturated === true,
      total: c.total,
      notFound: (c.byStatus && c.byStatus['404']) || 0,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
    }));
}

/**
 * Quota di traffico che nessuna regola descrive.
 *
 * Il censimento registra OGNI impronta, anche quando nessuna regola ha matchato:
 * la differenza fra `count` e `matchedCount` è il traffico non classificato — ed
 * è lì che si scoprono le regole mancanti, non fra quelle che già scattano.
 *
 * @param {Array<object>} fingerprints
 * @returns {{ total: number, matched: number, unclassified: number, unclassifiedPercent: number }}
 */
function unclassifiedShare(fingerprints) {
  let total = 0;
  let matched = 0;
  for (const fp of fingerprints || []) {
    total += fp.count || 0;
    matched += fp.matchedCount || 0;
  }
  const unclassified = Math.max(0, total - matched);
  return {
    total,
    matched,
    unclassified,
    unclassifiedPercent: total > 0 ? Math.round((unclassified / total) * 100) : 0,
  };
}

module.exports = {
  summarize,
  mergeRuleStatus,
  suspectedScanners,
  unclassifiedShare,
};
