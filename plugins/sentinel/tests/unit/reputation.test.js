/**
 * reputation.test.js
 *
 * Il giudizio sulla storia locale di un'impronta.
 *
 * Qui i test non difendono la classificazione — contare una quota è banale — ma
 * le **due protezioni** senza le quali questa funzione fa più danni di quanti ne
 * eviti:
 *
 *   1. UN'IMPRONTA NON È UNA PERSONA, è una famiglia di client. Condannare
 *      un'impronta da browser vero chiude fuori tutti quelli che usano quel
 *      browser. È il modo più probabile in cui questa funzione rovina un sito, e
 *      il test che la copre è quello da non cancellare mai.
 *   2. LA SOGLIA MINIMA. Una quota su tre richieste è rumore, e condannare per
 *      rumore è esattamente come si producono i falsi positivi.
 */

'use strict';

const { classify, isSharedBrowserFingerprint, LEVELS, DEFAULTS } = require('../../lib/reputation');

const SCRIPT_FP = { coherent: false, headerProfile: 'minimal', family: 'script-like' };
const BROWSER_FP = { coherent: true, headerProfile: 'browser', family: 'browser-like' };

/** Voce di censimento con età controllata. */
function entry({ count = 100, blockedCount = 0, ageSeconds = 3600 } = {}) {
  return {
    count,
    blockedCount,
    firstSeenMs: Date.now() - ageSeconds * 1000,
    lastSeenMs: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('impronte mai viste', () => {
  test('nessun giudizio, che non è lo stesso di un giudizio positivo', () => {
    const r = classify(null, SCRIPT_FP);
    expect(r.levels).toEqual([]);
    expect(r.requests).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('suspect e bad dalla quota di blocchi', () => {
  test('quota alta → bad', () => {
    const r = classify(entry({ count: 100, blockedCount: 60 }), SCRIPT_FP);
    expect(r.levels).toContain('bad');
    expect(r.blockedShare).toBe(0.6);
  });

  test('quota intermedia → suspect, non bad', () => {
    const r = classify(entry({ count: 100, blockedCount: 30 }), SCRIPT_FP);
    expect(r.levels).toContain('suspect');
    expect(r.levels).not.toContain('bad');
  });

  test('quota bassa → nessun giudizio', () => {
    expect(classify(entry({ count: 100, blockedCount: 5 }), SCRIPT_FP).levels).toEqual([]);
  });

  test('i due giudizi si escludono: mai entrambi', () => {
    // Sono livelli di gravità, non etichette accumulabili: una regola scritta su
    // "suspect" non deve scattare anche su una impronta già "bad", o l'idea
    // stessa di gravità crescente non significherebbe niente.
    const r = classify(entry({ count: 100, blockedCount: 90 }), SCRIPT_FP);
    expect(r.levels.filter((l) => l === 'suspect' || l === 'bad')).toEqual(['bad']);
  });

  test('le soglie sono configurabili', () => {
    const severo = { suspectShare: 0.05, badShare: 0.1 };
    expect(classify(entry({ count: 100, blockedCount: 12 }), SCRIPT_FP, severo).levels).toContain('bad');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('il denominatore sono le richieste GIUDICATE, non tutte', () => {
  // Difetto emerso solo dal vivo. Escludere dal numeratore i blocchi decisi
  // dalla reputazione non basta: mentre il giudizio è in vigore la sua regola
  // scatta per prima, quindi nessun'altra regola produce più blocchi. Il
  // numeratore si ferma, il denominatore no, e la quota scende da sola finché
  // l'impronta non viene perdonata — per poi essere ricondannata. Un'oscillazione
  // che nessun test sulla singola classificazione può vedere.
  test('le richieste decise dalla reputazione non diluiscono la quota', () => {
    const condannata = { count: 27, judgedCount: 26, blockedCount: 19, firstSeenMs: Date.now() - 3600e3 };
    const primo = classify(condannata, SCRIPT_FP);
    expect(primo.levels).toContain('bad');

    // Trenta richieste in più, tutte bloccate DALLA regola di reputazione:
    // `count` sale, `judgedCount` no.
    const dopo = { ...condannata, count: 57 };
    expect(classify(dopo, SCRIPT_FP).levels).toContain('bad');
    expect(classify(dopo, SCRIPT_FP).blockedShare).toBe(primo.blockedShare);
  });

  test('senza il campo si ricade su count, per i censimenti scritti prima', () => {
    const vecchia = { count: 100, blockedCount: 60, firstSeenMs: Date.now() - 3600e3 };
    expect(classify(vecchia, SCRIPT_FP).levels).toContain('bad');
  });

  test('la quota risale se altre regole tornano a bloccare', () => {
    // Il giudizio non è eterno: resta legato alle prove raccolte nel merito, e
    // se quelle cambiano cambia anche lui.
    const pulita = { count: 200, judgedCount: 200, blockedCount: 10, firstSeenMs: Date.now() - 3600e3 };
    expect(classify(pulita, SCRIPT_FP).levels).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('la soglia minima di campione', () => {
  test('poche richieste → nessun giudizio, per quanto sia alta la quota', () => {
    // 3 richieste su 3 bloccate è il 100%, e non vuol dire niente.
    const r = classify(entry({ count: 3, blockedCount: 3 }), SCRIPT_FP);
    expect(r.levels).toEqual([]);
    expect(r.blockedShare).toBe(1);
  });

  test('raggiunta la soglia il giudizio compare', () => {
    const sotto = classify(entry({ count: DEFAULTS.minRequests - 1, blockedCount: 100 }), SCRIPT_FP);
    const sopra = classify(entry({ count: DEFAULTS.minRequests, blockedCount: 100 }), SCRIPT_FP);
    expect(sotto.levels).toEqual([]);
    expect(sopra.levels).toContain('bad');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('la protezione delle impronte da browser', () => {
  // IL test di questo file. Senza questa protezione, un attacco condotto con un
  // Chrome ordinario porterebbe a bloccare ogni visitatore con quel browser.
  test('un\'impronta da browser vero non viene MAI condannata', () => {
    const r = classify(entry({ count: 10000, blockedCount: 9999 }), BROWSER_FP);
    expect(r.levels).not.toContain('bad');
    expect(r.levels).not.toContain('suspect');
    expect(r.protected).toBe(true);
  });

  test('la stessa storia su un\'impronta script-like produce bad', () => {
    // Il confronto che rende visibile cosa fa la protezione: identici i numeri,
    // diverso il giudizio, e la differenza è solo «questa è condivisa».
    const r = classify(entry({ count: 10000, blockedCount: 9999 }), SCRIPT_FP);
    expect(r.levels).toContain('bad');
    expect(r.protected).toBe(false);
  });

  test('la protezione non tocca burst', () => {
    // `burst` non è un giudizio sulla condotta ma una constatazione di cadenza:
    // vale anche per un browser, e non condanna nessuno da solo.
    const r = classify(entry({ count: 100, blockedCount: 0, ageSeconds: 5 }), BROWSER_FP);
    expect(r.levels).toContain('burst');
  });

  test('si può disattivare, ma va fatto apposta', () => {
    const r = classify(entry({ count: 100, blockedCount: 90 }), BROWSER_FP,
      { protectBrowserFingerprints: false });
    expect(r.levels).toContain('bad');
  });

  test.each([
    [{ coherent: true, headerProfile: 'browser' }, true],
    [{ coherent: false, headerProfile: 'browser' }, false],
    [{ coherent: true, headerProfile: 'minimal' }, false],
    [null, false],
  ])('isSharedBrowserFingerprint(%j) → %s', (fpClass, expected) => {
    expect(isSharedBrowserFingerprint(fpClass)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('burst: comparsa adesso e già a raffica', () => {
  test('impronta nuova con molte richieste', () => {
    expect(classify(entry({ count: 50, ageSeconds: 10 }), SCRIPT_FP).levels).toContain('burst');
  });

  test('impronta nuova con poche richieste non è un burst', () => {
    // Un visitatore vero carica una pagina e le sue risorse.
    expect(classify(entry({ count: 8, ageSeconds: 10 }), SCRIPT_FP).levels).not.toContain('burst');
  });

  test('molte richieste distribuite nel tempo non sono un burst', () => {
    expect(classify(entry({ count: 5000, ageSeconds: 86400 }), SCRIPT_FP).levels).not.toContain('burst');
  });

  test('burst e bad possono convivere', () => {
    const r = classify(entry({ count: 100, blockedCount: 80, ageSeconds: 10 }), SCRIPT_FP);
    expect(r.levels).toEqual(expect.arrayContaining(['burst', 'bad']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('contratto', () => {
  test('ogni livello dichiarato è effettivamente producibile', () => {
    // Presidio contro le costanti morte: un livello ammesso dal validatore che
    // nessun percorso produce sarebbe una regola che non scatta mai.
    const prodotti = new Set([
      ...classify(entry({ count: 100, blockedCount: 80, ageSeconds: 10 }), SCRIPT_FP).levels,
      ...classify(entry({ count: 100, blockedCount: 30 }), SCRIPT_FP).levels,
    ]);
    expect(Array.from(prodotti).sort()).toEqual([...LEVELS].sort());
  });

  test('i numeri riportati servono a spiegare il giudizio', () => {
    const r = classify(entry({ count: 80, blockedCount: 20, ageSeconds: 600 }), SCRIPT_FP);
    expect(r.requests).toBe(80);
    expect(r.blockedShare).toBe(0.25);
    expect(r.ageSeconds).toBeGreaterThanOrEqual(599);
  });
});
