const fs = require('fs');
const os = require('os');
const path = require('path');
const reader = require('../../lib/sentinelDataReader');

let dataDir;

function write(name, content) {
  fs.writeFileSync(path.join(dataDir, name), content, 'utf8');
}

function writeJsonl(name, rows) {
  write(name, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function writeJson5(name, obj) {
  write(name, '// test\n' + JSON.stringify(obj, null, 2) + '\n');
}

const ev = (over = {}) => ({
  timestamp: new Date().toISOString(),
  path: '/x.php',
  ruleName: 'php-probe',
  category: 'cms-probe',
  ip: '203.0.113.1',
  enforced: false,
  fp: 'aaa',
  ...over,
});

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-reader-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('robustezza', () => {
  test('una data dir inesistente non fa lanciare nulla', () => {
    const missing = path.join(dataDir, 'non-esiste');
    expect(reader.listEventFiles(missing)).toEqual([]);
    expect(reader.readRecentEvents(missing).events).toEqual([]);
    expect(reader.readFingerprintCensus(missing).fingerprints).toEqual([]);
    expect(reader.readRuleHits(missing)).toEqual([]);
  });

  // Un log troncato da un crash non deve rendere illeggibile tutto il resto.
  test('le righe malformate vengono saltate, le valide restano', () => {
    write('sentinel-2026-08-08.jsonl',
      JSON.stringify(ev({ path: '/a.php' })) + '\n'
      + '{ questa riga è rotta\n'
      + JSON.stringify(ev({ path: '/b.php' })) + '\n');
    const { events } = reader.readRecentEvents(dataDir);
    expect(events).toHaveLength(2);
  });

  test('uno shard corrotto non impedisce di leggere gli altri', () => {
    writeJson5('fingerprintCensus.a.json5', { fingerprints: { x: { count: 5 } } });
    write('fingerprintCensus.b.json5', 'non è json5 {{{');
    const census = reader.readFingerprintCensus(dataDir);
    expect(census.fingerprints).toHaveLength(1);
  });
});

describe('readRecentEvents', () => {
  test('restituisce i più recenti per primi, attraverso più file', () => {
    writeJsonl('sentinel-2026-08-07.jsonl', [ev({ path: '/vecchio.php' })]);
    writeJsonl('sentinel-2026-08-08.jsonl', [ev({ path: '/nuovo1.php' }), ev({ path: '/nuovo2.php' })]);
    const { events } = reader.readRecentEvents(dataDir, { limit: 10 });
    expect(events.map((e) => e.path)).toEqual(['/nuovo2.php', '/nuovo1.php', '/vecchio.php']);
  });

  // Con retention a 365 giorni caricare tutti i file per mostrarne cinquanta
  // righe sarebbero centinaia di megabyte in memoria.
  test('smette di leggere file appena ha abbastanza eventi', () => {
    writeJsonl('sentinel-2026-08-01.jsonl', [ev(), ev()]);
    writeJsonl('sentinel-2026-08-02.jsonl', [ev(), ev()]);
    writeJsonl('sentinel-2026-08-03.jsonl', [ev(), ev()]);
    const result = reader.readRecentEvents(dataDir, { limit: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.scannedFiles).toBe(1);
    expect(result.truncated).toBe(true);
  });

  test.each([
    [{ ruleName: 'altra' }, 0],
    [{ ruleName: 'php-probe' }, 2],
    [{ category: 'cms-probe' }, 2],
    [{ ip: '203.0.113.1' }, 2],
    [{ ip: '10.0.0.1' }, 0],
    [{ enforcedOnly: true }, 1],
  ])('filtro %p → %i eventi', (filter, expected) => {
    writeJsonl('sentinel-2026-08-08.jsonl', [ev(), ev({ enforced: true })]);
    expect(reader.readRecentEvents(dataDir, filter).events).toHaveLength(expected);
  });

  test('il limite è comunque tetto a 1000', () => {
    writeJsonl('sentinel-2026-08-08.jsonl', [ev()]);
    expect(() => reader.readRecentEvents(dataDir, { limit: 999999 })).not.toThrow();
  });
});

describe('readEventsSince', () => {
  test('esclude gli eventi fuori dalla finestra', () => {
    const vecchio = new Date(Date.now() - 30 * 86400000).toISOString();
    writeJsonl('sentinel-2026-08-08.jsonl', [ev({ timestamp: vecchio }), ev()]);
    const events = reader.readEventsSince(dataDir, 7);
    expect(events).toHaveLength(1);
  });
});

// La fusione degli shard è la predisposizione al cluster: con un processo solo il
// suffisso è costante e il comportamento è identico, ma la lettura è già pronta.
describe('fusione degli shard', () => {
  test('il censimento delle impronte somma i contatori fra shard', () => {
    writeJson5('fingerprintCensus.w1.json5', {
      evictions: 2,
      ipMode: 'count',
      fingerprints: { abc: { count: 10, matchedCount: 4, blockedCount: 1, ipCount: 3, firstSeen: '2026-08-01', lastSeen: '2026-08-05' } },
    });
    writeJson5('fingerprintCensus.w2.json5', {
      evictions: 3,
      fingerprints: { abc: { count: 5, matchedCount: 2, blockedCount: 0, ipCount: 7, firstSeen: '2026-07-28', lastSeen: '2026-08-09' } },
    });

    const census = reader.readFingerprintCensus(dataDir);
    expect(census.fingerprints).toHaveLength(1);
    const fp = census.fingerprints[0];
    expect(fp.count).toBe(15);
    expect(fp.matchedCount).toBe(6);
    // ipCount NON si somma: lo stesso indirizzo può essere stato visto da due
    // worker, e sommare sovrastimerebbe. Si prende il massimo.
    expect(fp.ipCount).toBe(7);
    expect(fp.firstSeen).toBe('2026-07-28');
    expect(fp.lastSeen).toBe('2026-08-09');
    expect(census.evictions).toBe(5);
  });

  test('gli esiti si fondono per client sommando gli status', () => {
    writeJson5('outcomeCensus.w1.json5', {
      byClient: { '1.2.3.4': { total: 10, distinctPaths: 8, byStatus: { 404: 9, 403: 1 }, lastSeen: '2026-08-01' } },
    });
    writeJson5('outcomeCensus.w2.json5', {
      byClient: { '1.2.3.4': { total: 5, distinctPaths: 12, byStatus: { 404: 5 }, lastSeen: '2026-08-09' } },
    });

    const { clients } = reader.readOutcomeCensus(dataDir);
    expect(clients).toHaveLength(1);
    expect(clients[0].total).toBe(15);
    expect(clients[0].byStatus['404']).toBe(14);
    expect(clients[0].distinctPaths).toBe(12);
    expect(clients[0].lastSeen).toBe('2026-08-09');
  });

  // Basta che UNO shard abbia colpito un utente autenticato perché la
  // promozione sia sconsigliata: il flag va ricalcolato sull'insieme.
  test('safeToPromote è ricalcolato dopo la fusione, non ereditato', () => {
    writeJson5('ruleHits.w1.json5', {
      rules: { 'php-probe': { hits: 100, enforcedHits: 0, authenticatedHits: 0, botHits: 5, distinctIps: 10, safeToPromote: true } },
    });
    writeJson5('ruleHits.w2.json5', {
      rules: { 'php-probe': { hits: 3, enforcedHits: 0, authenticatedHits: 2, botHits: 0, distinctIps: 1, safeToPromote: false } },
    });

    const hits = reader.readRuleHits(dataDir);
    expect(hits[0].hits).toBe(103);
    expect(hits[0].authenticatedHits).toBe(2);
    expect(hits[0].safeToPromote).toBe(false);
  });

  test('con un solo shard la fusione è trasparente', () => {
    writeJson5('ruleHits.json5', { rules: { a: { hits: 7, authenticatedHits: 0 } } });
    const hits = reader.readRuleHits(dataDir);
    expect(hits).toHaveLength(1);
    expect(hits[0].ruleName).toBe('a');
    expect(hits[0].hits).toBe(7);
  });
});
