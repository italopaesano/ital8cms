/**
 * counters.test.js
 *
 * I due contatori che l'amministratore legge per decidere, e che dicevano il
 * falso (piano di consolidamento, C8). Non cambiavano il comportamento del
 * filtro: cambiavano ciò su cui si basa chi lo governa, che nel percorso
 * «osserva → capisci → promuovi» è la stessa cosa un passo più a monte.
 *
 *   • Il censimento degli esiti contava i **3xx** fra le richieste fallite. Un
 *     redirect non è un fallimento: è il sito che risponde come deve. Chi ne
 *     colleziona molti — un crawler su un sito con `urlRedirect`, o chiunque
 *     tocchi l'area admin da sloggato — finiva fra i «sospetti scanner», cioè
 *     nel pannello nato per mostrare gli attacchi privi di regola.
 *   • `ruleHitCounter` distruggeva lo storico degli IP distinti al primo
 *     salvataggio dopo un riavvio, mentre il commento accanto affermava il
 *     contrario. E lo faceva per TUTTE le regole insieme, perché il payload si
 *     riscrive per intero.
 *
 * Nessuno dei due moduli aveva test: sono i primi.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sentinel = require('../../main');
const RuleHitCounter = require('../../lib/ruleHitCounter');
const { OutcomeCensus } = require('../../lib/census');

const { observeOutcome } = sentinel._internals;

function cartellaTemporanea() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-contatori-'));
}

// ─────────────────────────────────────────────────────────────────────────────
// IL CENSIMENTO DEGLI ESITI
// ─────────────────────────────────────────────────────────────────────────────

describe('observeOutcome — cosa conta come richiesta fallita', () => {
  /** Doppio del censimento: interessa solo COSA gli arriva. */
  function censimentoFinto() {
    const registrate = [];
    return { registrate, record: (ip, status, p) => registrate.push({ ip, status, p }) };
  }

  const ctx = (status) => ({ status, path: `/p${status}`, ip: '203.0.113.9', headers: {} });
  const conf = { observeOutcomes: true };

  test.each([400, 401, 403, 404, 405, 418, 429, 500, 502, 503])(
    '%i viene registrato: è un esito fallito',
    (status) => {
      const censimento = censimentoFinto();
      observeOutcome(ctx(status), conf, censimento);
      expect(censimento.registrate).toHaveLength(1);
      expect(censimento.registrate[0].status).toBe(status);
    },
  );

  // IL DIFETTO. Il gate filtra i 2xx e passa tutto il resto: i 3xx arrivavano
  // qui e venivano contati come percorsi falliti distinti.
  test.each([301, 302, 303, 307, 308, 304])(
    '%i NON viene registrato: un redirect non è un fallimento',
    (status) => {
      const censimento = censimentoFinto();
      observeOutcome(ctx(status), conf, censimento);
      expect(censimento.registrate).toHaveLength(0);
    },
  );

  test('il 2xx non arriva nemmeno qui, ma se arrivasse non conterebbe', () => {
    const censimento = censimentoFinto();
    observeOutcome(ctx(200), conf, censimento);
    observeOutcome(ctx(204), conf, censimento);
    expect(censimento.registrate).toHaveLength(0);
  });

  test('`observeOutcomes: false` spegne tutto', () => {
    const censimento = censimentoFinto();
    observeOutcome(ctx(404), { observeOutcomes: false }, censimento);
    expect(censimento.registrate).toHaveLength(0);
  });
});

/**
 * Il caso concreto da cui nasce la correzione: l'area admin risponde 302 verso
 * la pagina di login a ogni richiesta non autenticata (misurato sull'istanza
 * viva). Bastano venti percorsi admin toccati da sloggato — o un crawler su un
 * sito con molti redirect — per superare la soglia dei sospetti scanner.
 */
describe('sospetti scanner — chi ci finisce dentro', () => {
  function censimentoVero() {
    return new OutcomeCensus(cartellaTemporanea(), {}, {});
  }

  test('venti redirect distinti NON producono un sospetto scanner', () => {
    const censimento = censimentoVero();
    const conf = { observeOutcomes: true };
    for (let i = 0; i < 25; i++) {
      observeOutcome(
        { status: 302, path: `/admin/sezione${i}`, ip: '198.51.100.4', headers: {} },
        conf, censimento,
      );
    }
    expect(censimento.getSuspectedScanners(20)).toEqual([]);
  });

  // Il segnale vero resta intatto: è il motivo per cui il censimento esiste.
  test('venti 404 distinti lo producono', () => {
    const censimento = censimentoVero();
    const conf = { observeOutcomes: true };
    for (let i = 0; i < 25; i++) {
      observeOutcome(
        { status: 404, path: `/wp-content/plugin${i}/x.php`, ip: '198.51.100.5', headers: {} },
        conf, censimento,
      );
    }
    const sospetti = censimento.getSuspectedScanners(20);
    expect(sospetti).toHaveLength(1);
    expect(sospetti[0].distinctPaths).toBe(25);
  });

  // Un client che fa entrambe le cose viene giudicato solo sui fallimenti.
  test('i redirect non gonfiano il conteggio di chi ha anche dei 404', () => {
    const censimento = censimentoVero();
    const conf = { observeOutcomes: true };
    for (let i = 0; i < 30; i++) {
      observeOutcome({ status: 301, path: `/vecchio/${i}`, ip: '198.51.100.6', headers: {} }, conf, censimento);
    }
    for (let i = 0; i < 3; i++) {
      observeOutcome({ status: 404, path: `/manca/${i}`, ip: '198.51.100.6', headers: {} }, conf, censimento);
    }
    expect(censimento.getSuspectedScanners(20)).toEqual([]);
    expect(censimento.getSuspectedScanners(3)[0].distinctPaths).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I CONTATORI PER REGOLA
// ─────────────────────────────────────────────────────────────────────────────

describe('ruleHitCounter — gli IP distinti sopravvivono al riavvio', () => {
  const colpo = (ip) => ({ enforced: true, authenticated: false, isBot: false, ip });

  /** Un riavvio vero: si salva, si costruisce un'istanza nuova, si ricarica. */
  function riavvia(dataDir) {
    const nuovo = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    nuovo.init();
    return nuovo;
  }

  test('il valore letto dal file non viene riscritto con zero', () => {
    const dataDir = cartellaTemporanea();

    const primo = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    primo.init();
    for (let i = 0; i < 500; i++) primo.record('php-probe', colpo(`10.0.${Math.floor(i / 256)}.${i % 256}`));
    expect(primo.save()).toBe(true);
    expect(primo.getSummary()[0].distinctIps).toBe(500);

    // IL DIFETTO: qui bastava UN colpo perché il flush successivo scrivesse 1
    // sopra 500. Peggio, il payload si riscrive per intero: anche le regole non
    // toccate dal riavvio venivano azzerate.
    const dopo = riavvia(dataDir);
    expect(dopo.getSummary()[0].distinctIps).toBe(500);

    dopo.record('php-probe', colpo('192.0.2.1'));
    expect(dopo.getSummary()[0].distinctIps).toBe(500);
    dopo.save();

    expect(riavvia(dataDir).getSummary()[0].distinctIps).toBe(500);
  });

  test('una regola non toccata dopo il riavvio non viene azzerata dal salvataggio di un altra', () => {
    const dataDir = cartellaTemporanea();
    const primo = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    primo.init();
    primo.record('regola-A', colpo('203.0.113.1'));
    primo.record('regola-A', colpo('203.0.113.2'));
    primo.record('regola-B', colpo('203.0.113.3'));
    primo.save();

    const dopo = riavvia(dataDir);
    dopo.record('regola-A', colpo('203.0.113.9'));   // solo A viene toccata
    dopo.save();

    const perNome = Object.fromEntries(riavvia(dataDir).getSummary().map((r) => [r.ruleName, r]));
    expect(perNome['regola-A'].distinctIps).toBe(2);
    expect(perNome['regola-B'].distinctIps).toBe(1);   // ← era 0
  });

  test('il conteggio cresce quando la sessione corrente supera lo storico', () => {
    const dataDir = cartellaTemporanea();
    const primo = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    primo.init();
    primo.record('php-probe', colpo('203.0.113.1'));
    primo.save();

    const dopo = riavvia(dataDir);
    for (let i = 1; i <= 4; i++) dopo.record('php-probe', colpo(`198.51.100.${i}`));
    expect(dopo.getSummary()[0].distinctIps).toBe(4);
    dopo.save();
    expect(riavvia(dataDir).getSummary()[0].distinctIps).toBe(4);
  });

  // Il numero è un MASSIMO PER ESECUZIONE, non la somma storica dei distinti:
  // quella richiederebbe di conservare gli indirizzi, cioè di fare del file dei
  // contatori un archivio di dati personali senza che nessuno l'abbia chiesto.
  test('gli indirizzi non finiscono sul disco', () => {
    const dataDir = cartellaTemporanea();
    const contatore = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    contatore.init();
    contatore.record('php-probe', colpo('203.0.113.77'));
    contatore.save();

    const scritto = fs.readFileSync(contatore.filePath, 'utf8');
    expect(scritto).not.toContain('203.0.113.77');
    expect(scritto).toContain('"distinctIps": 1');
  });

  test('gli altri contatori continuano a sommarsi attraverso il riavvio', () => {
    const dataDir = cartellaTemporanea();
    const primo = new RuleHitCounter(dataDir, { flushIntervalSeconds: 0 }, {});
    primo.init();
    primo.record('php-probe', { enforced: true, authenticated: true, isBot: true, ip: '203.0.113.1' });
    primo.save();

    const dopo = riavvia(dataDir);
    dopo.record('php-probe', { enforced: false, authenticated: false, isBot: false, ip: '203.0.113.2' });

    const riga = dopo.getSummary()[0];
    expect(riga.hits).toBe(2);
    expect(riga.enforcedHits).toBe(1);
    expect(riga.authenticatedHits).toBe(1);
    expect(riga.botHits).toBe(1);
    // `authenticatedHits` è il semaforo della promozione: se si azzerasse al
    // riavvio, una regola con falsi positivi sembrerebbe sicura da promuovere.
    expect(riga.safeToPromote).toBe(false);
  });
});
