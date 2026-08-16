const {
  createSummaryAccumulator, summarize, mergeRuleStatus, suspectedScanners, unclassifiedShare,
} = require('../../lib/aggregator');

const ev = (over = {}) => ({
  timestamp: '2026-08-08T10:00:00.000Z',
  category: 'cms-probe',
  ruleName: 'php-probe',
  ip: '203.0.113.1',
  fp: 'aaa',
  enforced: false,
  isAuthenticated: false,
  isBot: false,
  fpClass: { coherent: true },
  ...over,
});

describe('summarize', () => {
  test('un insieme vuoto non fa lanciare nulla', () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.distinctIps).toBe(0);
  });

  test('conta applicati e osservati separatamente', () => {
    const s = summarize([ev(), ev({ enforced: true }), ev({ enforced: true })]);
    expect(s.total).toBe(3);
    expect(s.enforced).toBe(2);
    expect(s.observed).toBe(1);
  });

  // È il segnale singolo più affidabile del plugin: merita un contatore proprio,
  // non di essere dedotto scorrendo gli eventi.
  test('conta le incoerenze UA ↔ impronta', () => {
    const s = summarize([
      ev(),
      ev({ fpClass: { coherent: false } }),
      ev({ fpClass: { coherent: false } }),
    ]);
    expect(s.incoherent).toBe(2);
  });

  test('tollera eventi senza fpClass', () => {
    expect(() => summarize([ev({ fpClass: undefined })])).not.toThrow();
  });

  // La domanda non è «quante ne ho bloccate» ma di cosa è fatto il traffico:
  // aggregare per categoria è ciò che rende leggibile la risposta.
  test('aggrega per categoria, dalla più frequente', () => {
    const s = summarize([
      ev({ category: 'cms-probe' }),
      ev({ category: 'cms-probe' }),
      ev({ category: 'scanner' }),
    ]);
    expect(s.byCategory).toEqual([
      { category: 'cms-probe', count: 2 },
      { category: 'scanner', count: 1 },
    ]);
  });

  test('gli eventi senza categoria finiscono in "uncategorized"', () => {
    const s = summarize([ev({ category: undefined })]);
    expect(s.byCategory[0].category).toBe('uncategorized');
  });

  test('conta IP e impronte distinti, non le occorrenze', () => {
    const s = summarize([
      ev({ ip: '1.1.1.1', fp: 'a' }),
      ev({ ip: '1.1.1.1', fp: 'a' }),
      ev({ ip: '2.2.2.2', fp: 'b' }),
    ]);
    expect(s.distinctIps).toBe(2);
    expect(s.distinctFingerprints).toBe(2);
  });

  test('la timeline è per giorno e in ordine cronologico', () => {
    const s = summarize([
      ev({ timestamp: '2026-08-09T01:00:00.000Z' }),
      ev({ timestamp: '2026-08-07T01:00:00.000Z' }),
      ev({ timestamp: '2026-08-07T02:00:00.000Z' }),
    ]);
    expect(s.timeline).toEqual([
      { day: '2026-08-07', count: 2 },
      { day: '2026-08-09', count: 1 },
    ]);
  });
});

// L'accumulatore è la forma che la dashboard usa davvero: `summarize` è solo il
// suo involucro per chi ha già un array. Il patto che i due devono rispettare è
// uno solo — dare lo stesso risultato — perché è ciò che rende sostituibile
// l'uno con l'altro senza dover ricontrollare ogni numero.
describe('createSummaryAccumulator', () => {
  const eventi = [
    ev(),
    ev({ enforced: true, ip: '203.0.113.2', fpClass: { coherent: false } }),
    ev({ category: 'sensitive-file', ruleName: 'env-probe', fp: 'bbb', isBot: true }),
    ev({ timestamp: '2026-08-09T11:00:00.000Z', isAuthenticated: true }),
  ];

  test('dà esattamente il risultato di summarize sugli stessi eventi', () => {
    const accumulator = createSummaryAccumulator();
    for (const evento of eventi) accumulator.add(evento);
    expect(accumulator.result()).toEqual(summarize(eventi));
  });

  test('senza eventi non lancia e non inventa numeri', () => {
    expect(createSummaryAccumulator().result()).toEqual(summarize([]));
  });

  // Il senso di avere un accumulatore invece di un array: il chiamante non deve
  // trattenere gli eventi per poterli contare.
  test('non trattiene gli eventi che ha ricevuto', () => {
    const accumulator = createSummaryAccumulator();
    const evento = ev();
    accumulator.add(evento);
    const risultato = accumulator.result();
    expect(Object.values(risultato)).not.toContain(evento);
    expect(risultato.total).toBe(1);
  });

  test('leggere il risultato due volte dà lo stesso risultato', () => {
    const accumulator = createSummaryAccumulator();
    accumulator.add(ev());
    expect(accumulator.result()).toEqual(accumulator.result());
  });
});

describe('mergeRuleStatus', () => {
  test('include le regole definite che non hanno MAI sparato', () => {
    const merged = mergeRuleStatus([{ ruleName: 'a', hits: 10, authenticatedHits: 0 }], ['a', 'b']);
    const b = merged.find((r) => r.ruleName === 'b');
    expect(b).toBeDefined();
    expect(b.hits).toBe(0);
    expect(b.neverFired).toBe(true);
  });

  // Zero scatti non vuol dire «sicura»: vuol dire che non si sa niente.
  // Promuoverla sarebbe un atto di fede, ed è l'opposto di ciò che il percorso
  // in tre fasi esiste per costruire.
  test('una regola mai scattata NON è promuovibile', () => {
    const merged = mergeRuleStatus([], ['mai-usata']);
    expect(merged[0].safeToPromote).toBe(false);
    expect(merged[0].neverFired).toBe(true);
  });

  // Se la storia sparisse in silenzio, una rinomina cancellerebbe settimane di
  // osservazione senza che nessuno se ne accorga.
  test('i contatori orfani restano visibili, marcati come non definiti', () => {
    const merged = mergeRuleStatus([{ ruleName: 'rinominata', hits: 42 }], ['nuova']);
    const orfana = merged.find((r) => r.ruleName === 'rinominata');
    expect(orfana).toBeDefined();
    expect(orfana.defined).toBe(false);
  });

  test('ordina per numero di scatti decrescente', () => {
    const merged = mergeRuleStatus(
      [{ ruleName: 'poca', hits: 2 }, { ruleName: 'tanta', hits: 90 }],
      ['poca', 'tanta'],
    );
    expect(merged[0].ruleName).toBe('tanta');
  });

  test('tollera un elenco di nomi assente', () => {
    expect(() => mergeRuleStatus([{ ruleName: 'a', hits: 1 }], undefined)).not.toThrow();
  });
});

describe('suspectedScanners', () => {
  test('seleziona solo chi supera la soglia di percorsi distinti', () => {
    const found = suspectedScanners([
      { clientId: '1.1.1.1', distinctPaths: 50, total: 60, byStatus: { 404: 55 } },
      { clientId: '2.2.2.2', distinctPaths: 3, total: 3, byStatus: { 404: 3 } },
    ], 20);
    expect(found).toHaveLength(1);
    expect(found[0].clientId).toBe('1.1.1.1');
    expect(found[0].notFound).toBe(55);
  });

  test('senza byStatus il conteggio dei 404 è zero, non undefined', () => {
    const found = suspectedScanners([{ clientId: 'x', distinctPaths: 30, total: 30 }], 20);
    expect(found[0].notFound).toBe(0);
  });

  test('lista assente → nessun sospetto', () => {
    expect(suspectedScanners(undefined)).toEqual([]);
  });
});

describe('unclassifiedShare', () => {
  // È lì che si scoprono le regole mancanti: fra quelle che già scattano, no.
  test('la quota non classificata è la differenza fra visto e matchato', () => {
    const share = unclassifiedShare([
      { count: 100, matchedCount: 30 },
      { count: 100, matchedCount: 20 },
    ]);
    expect(share.total).toBe(200);
    expect(share.matched).toBe(50);
    expect(share.unclassified).toBe(150);
    expect(share.unclassifiedPercent).toBe(75);
  });

  test('nessun traffico → 0%, non NaN', () => {
    expect(unclassifiedShare([]).unclassifiedPercent).toBe(0);
    expect(unclassifiedShare(undefined).unclassifiedPercent).toBe(0);
  });

  test('non produce percentuali negative se matched supera count', () => {
    const share = unclassifiedShare([{ count: 5, matchedCount: 9 }]);
    expect(share.unclassified).toBe(0);
  });
});
