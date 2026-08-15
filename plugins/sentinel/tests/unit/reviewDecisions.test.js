/**
 * reviewDecisions.test.js
 *
 * Le quattro scelte prese dopo la revisione completa del plugin. Stanno insieme
 * perché condividono una forma: **il codice diceva una cosa e il config, il
 * README o il tester ne dicevano un'altra**, e in tutti e quattro i casi era la
 * seconda voce a essere creduta — perché è quella che si legge prima di andare
 * in produzione.
 *
 *   • **`status`** — foglia che si validava, che il tester dava per vincente, e
 *     che a runtime non scatta mai: il filtro gira PRIMA del router, quindi lo
 *     stato della risposta non esiste ancora quando le regole vengono valutate.
 *     Due conferme indipendenti per qualcosa che non succede.
 *   • **`distinctPaths`** — dopo il tetto del campione diventava un contatore di
 *     richieste: 257 percorsi distinti più 5000 ripetizioni di uno solo davano
 *     5256. Quel numero è la colonna della tabella «sospetti scanner».
 *   • **`exempt`** — modalità documentata («le regole non si applicano affatto
 *     agli autenticati») e mai implementata: identica a `monitor`, quindi righe
 *     di log con lo username per chi aveva chiesto di non guardare i propri
 *     utenti.
 *   • **`shell-probe`** — intercettava `/js/shell.js`, e il semaforo della
 *     promozione (`authenticatedHits === 0`) non poteva accorgersene, perché un
 *     asset chiesto da visitatori anonimi lo lascia a zero per sempre.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const json5 = require('json5');

const PatternMatcher = require('../../../../core/patternMatcher');
const { validateRules } = require('../../lib/ruleValidator');
const { buildSubject, findFirstMatch, evaluateNode } = require('../../lib/ruleMatcher');
const { buildFingerprint } = require('../../lib/requestFingerprint');
const { testRequest } = require('../../lib/ruleTracer');
const { OutcomeCensus, FingerprintCensus, MAX_PATH_KEYS } = require('../../lib/census');
const sentinel = require('../../main');

const matcher = new PatternMatcher();

function compile(rules) {
  const r = validateRules({ rules });
  if (!r.valid) throw new Error(`regole non valide: ${r.errors.join('; ')}`);
  return r.rules;
}

function subjectFor(spec = {}) {
  const ctx = {
    path: spec.path || '/',
    method: spec.method || 'GET',
    querystring: '',
    headers: {},
    session: null,
    ip: spec.ip || '203.0.113.5',
    get: () => '',
    req: { rawHeaders: [], httpVersion: '1.1', headers: {} },
  };
  return buildSubject(ctx, {
    fingerprint: buildFingerprint(ctx, {}),
    clientIp: ctx.ip,
    globalPrefix: '',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('D1 — la foglia `status` non promette più ciò che non mantiene', () => {
  const RULE = { name: 'notfound-storm', action: 'block', match: { status: [404] } };

  test('la regola resta valida ma il validatore avvisa che non scatterà mai', () => {
    const r = validateRules({ rules: [RULE] });
    expect(r.valid).toBe(true);            // fail-open: la regola non si scarta
    expect(r.warnings.join(' ')).toMatch(/non scatta mai/);
  });

  test('l avviso arriva anche da dentro un combinatore', () => {
    const r = validateRules({
      rules: [{ name: 'x', action: 'block', match: { any: [{ path: '/a' }, { status: [500] }] } }],
    });
    expect(r.warnings.join(' ')).toMatch(/non scatta mai/);
  });

  test('nessun avviso quando la foglia non c è', () => {
    const r = validateRules({ rules: [{ name: 'x', action: 'block', match: { path: '/a' } }] });
    expect(r.warnings.join(' ')).not.toMatch(/non scatta mai/);
  });

  // Il cuore del difetto: il tester era l'unico posto che scrivesse
  // `subject.status`, quindi l'unico in cui la foglia sembrasse funzionare.
  test('il tester non dà più per vincente una regola che a runtime non scatta', () => {
    const rules = compile([RULE]);
    const out = testRequest({ path: '/qualsiasi', status: 404 }, rules, matcher, {});

    expect(out.matched).toBeNull();
    const riga = out.evaluated[0].entries.find((e) => e.leaf === 'status');
    expect(riga.matched).toBe(false);
    expect(String(riga.actual)).toMatch(/non scatta mai/);
  });

  test('lo stato richiesto resta nell eco del soggetto, per chi l ha passato', () => {
    const out = testRequest({ path: '/x', status: 404 }, compile([RULE]), matcher, {});
    expect(out.subject.status).toBe(404);
  });

  test('a runtime la condizione è falsa, come il tester ora dichiara', () => {
    const rules = compile([RULE]);
    expect(findFirstMatch(rules, subjectFor({ path: '/x' }), matcher)).toBeNull();
    expect(evaluateNode(rules[0].match, subjectFor({ path: '/x' }), matcher)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D2 — i percorsi distinti si contano, o si dichiara di aver smesso', () => {
  let dataDir;

  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-census-')); });
  afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('ripetere LO STESSO percorso non gonfia più il conteggio', () => {
    const oc = new OutcomeCensus(dataDir, {}, {});
    for (let i = 0; i < 300; i++) oc.record('9.9.9.9', 404, `/p${i}`);
    for (let i = 0; i < 5000; i++) oc.record('9.9.9.9', 404, '/sempre-lo-stesso');

    // Prima: 5301. I distinti veri sono 301.
    expect(oc.store.get('9.9.9.9').distinctPaths).toBe(301);
  });

  test('il conteggio si ferma al tetto e lo dichiara', () => {
    const oc = new OutcomeCensus(dataDir, {}, {});
    for (let i = 0; i < MAX_PATH_KEYS + 500; i++) oc.record('9.9.9.9', 404, `/p${i}`);

    const entry = oc.store.get('9.9.9.9');
    expect(entry.distinctPaths).toBe(MAX_PATH_KEYS);
    expect(entry.distinctPathsSaturated).toBe(true);
  });

  test('la saturazione arriva fino a chi legge la tabella', () => {
    const oc = new OutcomeCensus(dataDir, {}, {});
    for (let i = 0; i < MAX_PATH_KEYS + 10; i++) oc.record('1.2.3.4', 404, `/p${i}`);
    for (let i = 0; i < 30; i++) oc.record('5.6.7.8', 404, `/q${i}`);

    const scanners = oc.getSuspectedScanners(20);
    expect(scanners.find((s) => s.clientId === '1.2.3.4').saturated).toBe(true);
    expect(scanners.find((s) => s.clientId === '5.6.7.8').saturated).toBe(false);
  });

  test('senza saturazione la chiave non finisce su disco', () => {
    const oc = new OutcomeCensus(dataDir, {}, {});
    for (let i = 0; i < 30; i++) oc.record('5.6.7.8', 404, `/q${i}`);
    oc.save();

    const written = json5.parse(fs.readFileSync(oc.filePath, 'utf8'));
    expect(written.byClient['5.6.7.8'].distinctPaths).toBe(30);
    expect(written.byClient['5.6.7.8']).not.toHaveProperty('distinctPathsSaturated');
  });

  test('il conteggio sopravvive al riavvio, l insieme riparte dal campione', () => {
    const oc = new OutcomeCensus(dataDir, {}, {});
    for (let i = 0; i < 100; i++) oc.record('7.7.7.7', 404, `/p${i}`);
    oc.save();

    const ripreso = new OutcomeCensus(dataDir, {}, {});
    ripreso.load();
    expect(ripreso.store.get('7.7.7.7').distinctPaths).toBe(100);

    // Un percorso già nel campione non viene ricontato dopo il riavvio.
    ripreso.record('7.7.7.7', 404, '/p0');
    expect(ripreso.store.get('7.7.7.7').distinctPaths).toBe(100);
  });

  test('stessa cura per il censimento delle impronte', () => {
    const fc = new FingerprintCensus(dataDir, {}, {});
    const info = { fpClass: {}, ip: '1.1.1.1', matched: false };
    for (let i = 0; i < 100; i++) fc.record('abc', { ...info, path: `/p${i}` });
    for (let i = 0; i < 1000; i++) fc.record('abc', { ...info, path: '/uno-solo' });

    expect(fc.getEntry('abc').pathCount).toBe(101);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D3 — "exempt" non guarda affatto gli autenticati', () => {
  let root;

  /**
   * Monta il plugin su un albero finto con la modalità indicata.
   * Il percorso vero, non un'iniezione: la differenza fra `exempt` e `monitor`
   * non sta in `shouldEnforce` — sta nel fatto che con `exempt` non si cerca
   * nemmeno quale regola matcherebbe, quindi non c'è niente da registrare.
   */
  async function mount(authMode) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-exempt-'));
    const folder = path.join(root, 'plugins', 'sentinel');
    fs.mkdirSync(folder, { recursive: true });

    fs.writeFileSync(path.join(root, 'ital8Config.json5'), '{ debugMode: 0 }\n', 'utf8');
    fs.writeFileSync(path.join(folder, 'pluginConfig.json5'), `{
  custom: {
    enabled: true,
    mode: "monitor",
    dataPath: "./data",
    sweepIntervalSeconds: 0,
    census: { saveIntervalSeconds: 0 },
    // Buffer trattenuto: così \`pendingLogEvents\` dice quante righe di log
    // sarebbero state scritte, che è esattamente ciò che "exempt" promette di
    // non produrre.
    log: { flushIntervalSeconds: 60 },
    hitCounter: { flushIntervalSeconds: 0 },
    authenticatedTraffic: { mode: "${authMode}", enforceExemptRoles: [0, 1] },
  },
}\n`, 'utf8');
    fs.writeFileSync(path.join(folder, 'sentinelRules.json5'), `{
  rules: [
    {
      name: "php-probe",
      enabled: true,
      category: "cms-probe",
      action: "monitor",
      match: { extension: ["php"] },
    },
  ],
}\n`, 'utf8');

    await sentinel.loadPlugin({}, folder);
    return sentinel.getObjectToShareToOthersPlugin();
  }

  function authCtx() {
    return {
      path: '/qualcosa.php',
      method: 'GET',
      querystring: '',
      headers: {},
      session: { authenticated: true, user: { username: 'mario', roleIds: [3] } },
      ip: '203.0.113.5',
      get: () => '',
      req: { rawHeaders: [], httpVersion: '1.1', headers: {} },
    };
  }

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  test('"monitor" osserva: verdetto e riga di log (con lo username)', async () => {
    const engine = await mount('monitor');
    const verdict = engine.evaluate(authCtx());

    expect(verdict).not.toBeNull();
    expect(verdict.ruleName).toBe('php-probe');
    expect(engine.getStats().pendingLogEvents).toBe(1);
  });

  test('"exempt" non cerca: nessun verdetto, nessuna riga di log', async () => {
    const engine = await mount('exempt');

    expect(engine.evaluate(authCtx())).toBeNull();
    expect(engine.getStats().pendingLogEvents).toBe(0);
    // Nessun contatore per regola: non c'è stata alcuna regola.
    expect(engine.getRuleSummary()).toEqual([]);
  });

  test('"exempt" riguarda i soli autenticati: gli anonimi restano osservati', async () => {
    const engine = await mount('exempt');
    const anon = { ...authCtx(), session: null };

    expect(engine.evaluate(anon).ruleName).toBe('php-probe');
    expect(engine.getStats().pendingLogEvents).toBe(1);
  });

  test('"exempt" non spegne il censimento delle impronte', async () => {
    // La sua chiave è il client, non la persona: spegnerlo accecherebbe la
    // reputazione di tutti, autenticati e non.
    const engine = await mount('exempt');
    engine.evaluate(authCtx());
    expect(engine.getStats().fingerprints.tracked).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D4 — shell-probe non intercetta più asset legittimi', () => {
  const rules = compile(
    json5.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'sentinelRules.default.json5'), 'utf8')).rules
      .filter((r) => r.name === 'shell-probe'),
  );

  test.each([
    ['/wp/c99.php', true],
    ['/uploads/r57.phtml', true],
    ['/x/shell.php5', true],
    ['/a/cmd.asp', true],
    ['/b/backdoor.jsp', true],
    ['/c/wso.aspx', true],
    // I falsi positivi che il semaforo della promozione non poteva cogliere.
    ['/js/shell.js', false],
    ['/assets/cmd.css', false],
    ['/docs/webshell.pdf', false],
    ['/img/logo.png', false],
  ])('%s → %s', (reqPath, atteso) => {
    const hit = findFirstMatch(rules, subjectFor({ path: reqPath }), matcher);
    expect(!!hit).toBe(atteso);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D4 — la migrazione v5→v6 che porta la regola sulle installazioni esistenti', () => {
  const { migrate, OLD_PATTERN, NEW_PATTERN } = require('../../migrations/from-v5-to-v6');
  const DEFAULT_RULES = path.join(__dirname, '..', '..', 'sentinelRules.default.json5');

  const logger = { info: () => {}, warn: () => {} };
  let dir;

  /** Ricostruisce il file come stava in v5: il distribuito col pattern vecchio. */
  function installazioneV5() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mig-'));
    const text = fs.readFileSync(DEFAULT_RULES, 'utf8')
      .replace(JSON.stringify(NEW_PATTERN), JSON.stringify(OLD_PATTERN));
    fs.writeFileSync(path.join(dir, 'sentinelRules.json5'), text, 'utf8');
    return path.join(dir, 'sentinelRules.json5');
  }

  const leggi = (file) => fs.readFileSync(file, 'utf8');
  const patternDi = (file) => json5.parse(leggi(file)).rules.find((r) => r.name === 'shell-probe').match.path;

  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

  test('aggiorna il pattern toccando UNA sola riga', async () => {
    const file = installazioneV5();
    const before = leggi(file);
    await migrate({ packageDir: path.dirname(file), logger, dryRun: false });
    const after = leggi(file);

    expect(patternDi(file)).toBe(NEW_PATTERN);

    const righeCambiate = before.split('\n')
      .filter((line, i) => line !== after.split('\n')[i]).length;
    expect(righeCambiate).toBe(1);
  });

  test('nessun commento perso, nessuna regola persa', async () => {
    const file = installazioneV5();
    const before = json5.parse(leggi(file));
    await migrate({ packageDir: path.dirname(file), logger, dryRun: false });

    expect(leggi(file)).toContain('COME SI PROMUOVE UNA REGOLA');
    expect(json5.parse(leggi(file)).rules).toHaveLength(before.rules.length);
  });

  test('idempotente: la seconda esecuzione non cambia niente', async () => {
    const file = installazioneV5();
    await migrate({ packageDir: path.dirname(file), logger, dryRun: false });
    const dopoUna = leggi(file);
    await migrate({ packageDir: path.dirname(file), logger, dryRun: false });

    expect(leggi(file)).toBe(dopoUna);
  });

  // Il vincolo che conta più di tutti: una migrazione che sovrascrive la scelta
  // di un amministratore fa perdere fiducia in tutte quelle successive.
  test('un pattern personalizzato NON viene toccato', async () => {
    const file = installazioneV5();
    const personalizzato = leggi(file)
      .replace(JSON.stringify(OLD_PATTERN), JSON.stringify('regex:/(mio|custom)\\.'));
    fs.writeFileSync(file, personalizzato, 'utf8');

    await migrate({ packageDir: path.dirname(file), logger, dryRun: false });
    expect(leggi(file)).toBe(personalizzato);
  });

  test('dry-run non scrive', async () => {
    const file = installazioneV5();
    const prima = leggi(file);
    await migrate({ packageDir: path.dirname(file), logger, dryRun: true });
    expect(leggi(file)).toBe(prima);
  });

  test('regola cancellata dall utente: nessun errore, nessuna modifica', async () => {
    const file = installazioneV5();
    const senza = json5.parse(leggi(file));
    senza.rules = senza.rules.filter((r) => r.name !== 'shell-probe');
    fs.writeFileSync(file, json5.stringify(senza, null, 2), 'utf8');
    const prima = leggi(file);

    await expect(migrate({ packageDir: path.dirname(file), logger, dryRun: false }))
      .resolves.toBeUndefined();
    expect(leggi(file)).toBe(prima);
  });

  test('file assente: nessun errore', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mig-'));
    await expect(migrate({ packageDir: dir, logger, dryRun: false })).resolves.toBeUndefined();
  });
});
