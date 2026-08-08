/**
 * sentinel — filtro delle richieste in ingresso.
 *
 * ─── COSA FA ──────────────────────────────────────────────────────────────────
 * Valuta ogni richiesta PRIMA del router, la classifica secondo regole
 * dichiarative, e registra quello che vede. All'installazione non blocca nulla:
 * è un osservatorio. L'enforcement è una promozione consapevole che
 * l'amministratore fa dopo aver letto i propri dati.
 *
 * ─── DOVE GIRA, E PERCHE NON E UN MIDDLEWARE NORMALE ──────────────────────────
 * I middleware dei plugin sono montati DOPO il router: non vedrebbero mai una
 * rotta API già matchata, cioè proprio la superficie dove vivono gli attacchi
 * all'autenticazione. Questo plugin non registra quindi alcun middleware:
 * fornisce un MOTORE che il core installa nello slot `sentinelGate`, montato fra
 * il maintenance gate e il reserved gate. Vedi core/priorityMiddlewares/runtimeGate.js.
 *
 * Il fatto che il default non blocchi nulla non rende superfluo quel
 * posizionamento: per OSSERVARE il traffico verso /api/* bisogna comunque stare
 * prima del router.
 *
 * ─── DUE TETTI INDIPENDENTI SULL'ENFORCEMENT ──────────────────────────────────
 *   1. `custom.mode` nel config: "monitor" impedisce a QUALSIASI regola di agire,
 *      anche a quelle dichiarate `block`. È un tetto, non un override: "enforce"
 *      non promuove nulla, una regola in `monitor` resta osservativa.
 *   2. lo stato del gate, commutabile a caldo da `npm run cli -- sentinel monitor`
 *      senza toccare i file.
 * Nessuno dei due può essere scavalcato dall'altro né da una regola.
 *
 * ─── INTERCONNESSIONI ─────────────────────────────────────────────────────────
 * `rateLimiter` e `mailer` sono risolti in modo LAZY, opzionale, senza alcuna
 * `dependency` dichiarata. Se lo fossero, un rateLimiter disabilitato renderebbe
 * sentinel `incomplete` e spegnerebbe il filtro perché manca il rate limiter:
 * un'inversione di priorità inaccettabile.
 *
 * Nessuna interconnessione con `analytics`: sentinel ha il proprio log. I nomi
 * dei campi dell'evento coincidono però con quelli di analytics dove il
 * significato è lo stesso, così una futura lettura unificata non richiederà
 * traduttori.
 */

'use strict';

const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const logger = require('../../core/logger');
const PatternMatcher = require('../../core/patternMatcher');

const { buildFingerprint } = require('./lib/requestFingerprint');
const { buildSubject, findFirstMatch } = require('./lib/ruleMatcher');
const { validateRules, logValidationResults } = require('./lib/ruleValidator');
const { SentinelLog } = require('./lib/sentinelLog');
const { FingerprintCensus, OutcomeCensus } = require('./lib/census');
const RuleHitCounter = require('./lib/ruleHitCounter');
const { normalizeIp } = require('./lib/ipMatcher');

const LOG_PREFIX = 'sentinel';

// ── Stato del modulo ─────────────────────────────────────────────────────────
let pluginFolder = null;
let custom = null;
let ital8Conf = {};
let isDebugMode = false;

let compiledRules = [];
let matcher = null;          // istanza UNICA di PatternMatcher: ha la cache delle regex
let sentinelLog = null;
let fingerprintCensus = null;
let outcomeCensus = null;
let hitCounter = null;
let sweepTimer = null;
let censusSaveTimer = null;
let gateState = 'running';

let pluginSysRef = null;

// Latch per non ripetere all'infinito lo stesso avviso di configurazione.
let rulesUnavailableLogged = false;

function log(level, message) {
  if (typeof logger[level] === 'function') logger[level](LOG_PREFIX, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// CARICAMENTO DELLE REGOLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legge, valida e compila sentinelRules.json5.
 *
 * FAIL-OPEN: in caso di errore si resta senza regole (nessun filtro) ma il sito
 * funziona. La probabilità di scrivere una regola sbagliata è molto maggiore di
 * quella di subire un attacco nei minuti in cui la si corregge, e un filtro che
 * fallisce fail-closed trasformerebbe una virgola fuori posto in un blackout.
 *
 * @returns {Array<object>} regole compilate
 */
function loadRules() {
  const rulesPath = path.join(pluginFolder, 'sentinelRules.json5');

  let rulesData;
  try {
    rulesData = loadJson5(rulesPath);
  } catch (err) {
    if (!rulesUnavailableLogged) {
      log('error', `sentinelRules.json5 non leggibile (${err.message}) — nessuna regola attiva, il sito resta raggiungibile`);
      rulesUnavailableLogged = true;
    }
    return [];
  }
  rulesUnavailableLogged = false;

  const result = validateRules(rulesData, {
    knownRateLimiterRules: getRateLimiterRuleNames(),
    allowedRedirectHosts: Array.isArray(custom.allowedRedirectHosts) ? custom.allowedRedirectHosts : [],
  });

  logValidationResults(result, logger, LOG_PREFIX);

  if (!result.valid && custom.strictValidation) {
    throw new Error('[sentinel] validazione di sentinelRules.json5 fallita (strictValidation=true)');
  }

  return result.rules;
}

/** Rilegge le regole a caldo (usato dal futuro twin admin dopo un salvataggio). */
function reloadRules() {
  compiledRules = loadRules();
  log('info', `regole ricaricate: ${compiledRules.length} attive`);
  return compiledRules.length;
}

function reloadConfig() {
  try {
    const cfg = loadJson5(path.join(pluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};
    compiledRules = loadRules();
  } catch (err) {
    log('warn', `reloadConfig fallito: ${err.message}`);
  }
  return JSON.parse(JSON.stringify(custom));
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERCONNESSIONI OPZIONALI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Oggetto condiviso di rateLimiter, risolto al momento dell'uso.
 * Lazy di proposito: così l'ordine di caricamento dei plugin non vincola, e
 * l'assenza di rateLimiter è un non-evento.
 */
function getRateLimiter() {
  if (!pluginSysRef) return null;
  try {
    return pluginSysRef.getSharedObject('rateLimiter', 'sentinel');
  } catch (_err) {
    return null;
  }
}

function getRateLimiterRuleNames() {
  const rl = getRateLimiter();
  if (!rl || typeof rl.getRuleNames !== 'function') return null;
  try {
    return rl.getRuleNames();
  } catch (_err) {
    return null;
  }
}

/**
 * Invia un'allerta operativa. Usa `mailer` se presente e configurato; in ogni
 * caso l'evento resta nel log applicativo, così l'allerta non dipende dalla
 * posta per esistere.
 *
 * Il destinatario è un campo di configurazione esplicito e non viene dedotto
 * dagli account: `adminUsers` non espone oggi alcuna API per risolvere l'email
 * di root, e un indirizzo operativo è comunque spesso diverso da quello
 * amministrativo. Soluzione provvisoria, annotata nel TODO del plugin.
 */
function sendAlert(payload) {
  const recipient = custom && custom.alertRecipient;
  if (!recipient) return;

  const mailer = pluginSysRef ? pluginSysRef.getSharedObject('mailer', 'sentinel') : null;
  if (!mailer || typeof mailer.send !== 'function') return;

  try {
    mailer.send({
      to: recipient,
      subject: `[sentinel] ${payload.kind}`,
      text: JSON.stringify(payload, null, 2),
    });
  } catch (err) {
    log('warn', `invio allerta fallito: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITA DEL CLIENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Risolve l'IP del client.
 *
 * `X-Forwarded-For` è falsificabile dal client: si legge SOLO con `trustProxy`
 * attivo, cioè solo quando davanti c'è un proxy che lo imposta davvero.
 *
 * Con `trustedProxyCount` si prende la voce giusta contando DA DESTRA. La catena
 * è "client, proxy1, proxy2" e solo le ultime voci sono state scritte da proxy
 * fidati: prendere la prima da sinistra — la scelta comoda — significa leggere
 * un valore che il client controlla, quindi permettergli di attribuire i propri
 * blocchi a un indirizzo altrui o di aggirare un ban cambiando header a ogni
 * richiesta.
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveClientIp(ctx) {
  const trustProxy = custom.trustProxy === true;

  if (trustProxy && ctx.headers) {
    const raw = ctx.headers['x-forwarded-for'];
    if (typeof raw === 'string' && raw.length > 0) {
      const chain = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (chain.length > 0) {
        const hops = Number.isInteger(custom.trustedProxyCount) && custom.trustedProxyCount > 0
          ? custom.trustedProxyCount
          : 1;
        const index = Math.max(0, chain.length - hops);
        return normalizeIp(chain[index] || chain[0]);
      }
    }
  }

  return normalizeIp((ctx && (ctx.ip || (ctx.request && ctx.request.ip))) || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISIONE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide se l'azione di una regola vada applicata, applicando il tetto della
 * configurazione. Il gate applicherà poi il proprio, indipendente da questo.
 *
 * @param {object} rule
 * @param {object} subject
 * @returns {boolean}
 */
function shouldEnforce(rule, subject) {
  if (rule.action === 'allow' || rule.action === 'monitor') return false;

  // Tetto globale: in "monitor" nulla agisce, nemmeno una regola `block`.
  if (custom.mode !== 'enforce') return false;

  if (subject.authenticated) {
    const authConf = custom.authenticatedTraffic || {};
    if (authConf.mode !== 'enforce') return false;

    // I ruoli esenti non sono mai soggetti a enforcement, ma restano OSSERVATI:
    // bloccare un root per una regola scritta male significa chiudersi fuori dal
    // proprio pannello, e in quel momento nessuno sa più quale regola sia stata.
    const exemptRoles = Array.isArray(authConf.enforceExemptRoles) ? authConf.enforceExemptRoles : [0, 1];
    if (subject.roleIds.some((id) => exemptRoles.includes(id))) return false;
  }

  return true;
}

/** Costruisce la riga di log dell'evento. */
function buildEvent(ctx, subject, rule, enforced, extra = {}) {
  // isBot/botName arrivano dal fingerprint, che li ha già calcolati con
  // core/botDetector: rifarlo qui sarebbe una seconda scansione delle ~70 firme
  // per ogni evento.
  const { isBot, botName } = subject.fpClass;

  return {
    // Campi con lo stesso nome e significato di quelli di analytics
    timestamp: new Date().toISOString(),
    path: ctx.path,
    method: subject.method,
    statusCode: extra.statusCode !== undefined ? extra.statusCode : null,
    durationMs: extra.durationMs !== undefined ? extra.durationMs : 0,
    referrer: ctx.get ? (ctx.get('Referer') || ctx.get('Referrer') || null) : null,
    userAgent: subject.userAgent || null,
    isBot,
    botName,
    isAuthenticated: subject.authenticated,
    isAdmin: false,

    // Campi propri di sentinel
    ip: subject.ip,
    ruleName: rule ? rule.name : null,
    category: rule ? rule.category : null,
    action: rule ? rule.action : 'observe',
    enforced,
    fp: subject.fp,
    fpClass: subject.fpClass,
    username: subject.authenticated ? subject.username : null,
    escalated: extra.escalated === true,
  };
}

/** Alimenta rateLimiter, se la regola lo chiede e il plugin c'è. */
function escalate(rule, subject) {
  if (!rule.escalate) return false;
  const rl = getRateLimiter();
  if (!rl || typeof rl.recordFailure !== 'function') return false;

  try {
    // Sul traffico autenticato la chiave è l'ACCOUNT, non l'indirizzo: un account
    // compromesso usato da una botnet distribuita su 500 IP alimenta comunque un
    // solo contatore, e viene colto. L'API di rateLimiter accetta già una chiave
    // esplicita, non serve modificarlo.
    const clientId = subject.authenticated && subject.username
      ? `user:${subject.username}`
      : subject.ip;
    rl.recordFailure(clientId, rule.escalate.rateLimiterRule);
    return true;
  } catch (err) {
    log('warn', `escalation verso rateLimiter fallita: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTORE (installato nello slot sentinelGate)
// ─────────────────────────────────────────────────────────────────────────────

const engine = {
  /**
   * Valuta la richiesta. Chiamato dal gate PRIMA di next().
   * Non scrive sulla risposta e non chiama next(): restituisce solo un verdetto.
   *
   * @param {object} ctx
   * @returns {object|null}
   */
  evaluate(ctx) {
    if (!custom || custom.enabled === false) return null;

    // In debug le regole si rileggono ad ogni richiesta, così una modifica ha
    // effetto immediato. È sicuro perché le scritture del twin admin sono
    // atomiche (temp + rename): non si può mai leggere un file a metà.
    const rules = isDebugMode ? loadRules() : compiledRules;
    if (rules.length === 0) return null;

    const fingerprint = buildFingerprint(ctx, { salt: custom.fingerprintSalt || '' });
    const clientIp = resolveClientIp(ctx);
    const subject = buildSubject(ctx, {
      fingerprint,
      clientIp,
      globalPrefix: ital8Conf.globalPrefix || '',
    });

    const rule = findFirstMatch(rules, subject, matcher);

    // Censimento: registra SEMPRE la comparsa dell'impronta, anche quando nessuna
    // regola ha matchato. È il traffico non classificato a dire quali regole
    // mancano; contarlo solo quando una regola scatta significherebbe vedere solo
    // ciò che si sa già riconoscere.
    if (fingerprintCensus) {
      fingerprintCensus.record(fingerprint.fp, {
        fpClass: fingerprint.fpClass,
        ip: subject.ip,
        path: subject.path,
        matched: !!rule,
        blocked: false,
      });
    }

    if (!rule) return null;

    const enforced = shouldEnforce(rule, subject);
    const escalated = enforced || rule.action === 'monitor' ? escalate(rule, subject) : false;

    if (hitCounter) {
      hitCounter.record(rule.name, {
        enforced,
        authenticated: subject.authenticated,
        isBot: subject.fpClass.isBot,
        ip: subject.ip,
      });
    }

    // Le regole `allow` si contano ma non si registrano: sono la whitelist, e una
    // riga di log per ogni health check seppellirebbe gli eventi che contano.
    if (rule.action !== 'allow' && sentinelLog) {
      sentinelLog.append(buildEvent(ctx, subject, rule, enforced, { escalated }));
    }

    const verdict = {
      action: rule.action,
      ruleName: rule.name,
      category: rule.category,
      enforce: enforced,
    };

    // In v1 decoy/redirect/tarpit non producono ancora un corpo proprio: senza
    // `respond` il gate degrada al 404 comune. La regola si può già scrivere e
    // osservare, cambierà solo l'effetto quando la v2 aggiungerà le risposte.
    return verdict;
  },

  /**
   * Osserva come è finita una richiesta lasciata passare.
   * Il gate chiama questo metodo solo per gli esiti NON-2xx: un 200 non è un
   * segnale, e il filtro toglie circa il 99% delle chiamate.
   *
   * È qui che sentinel scopre gli attacchi per cui non esiste ancora una regola.
   * Fail-soft assoluto: la risposta è già stata emessa.
   */
  observeOutcome(ctx, info) {
    if (!custom || custom.observeOutcomes === false) return;
    if (!outcomeCensus) return;

    const clientIp = resolveClientIp(ctx);
    outcomeCensus.record(clientIp, ctx.status, ctx.path);
  },

  /** Il gate notifica i cambi di stato (CLI). */
  onGateState(state) {
    gateState = state;
    log('info', `stato del gate → ${state}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CICLO DI VITA
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    pluginFolder = pathPluginFolder;
    pluginSysRef = pluginSys;

    const cfg = loadJson5(path.join(pathPluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};

    try {
      ital8Conf = loadJson5(path.join(pathPluginFolder, '..', '..', 'ital8Config.json5'));
    } catch (_err) {
      ital8Conf = {};
    }
    isDebugMode = Number(ital8Conf.debugMode) >= 1;

    if (custom.enabled === false) {
      log('info', 'disabilitato (custom.enabled=false) — lo slot resterà vuoto');
      return;
    }

    // Istanza UNICA: PatternMatcher tiene una cache interna delle regex compilate,
    // e crearne una per richiesta la vanificherebbe.
    matcher = new PatternMatcher();

    const dataDir = resolveDataDir(pathPluginFolder, custom);
    const instanceId = custom.instanceId || '';

    sentinelLog = new SentinelLog(dataDir, { ...(custom.log || {}), instanceId }, {
      log: (level, message) => log(level, message),
      onAlert: (payload) => sendAlert(payload),
    });
    sentinelLog.init();

    const censusConf = custom.census || {};
    fingerprintCensus = new FingerprintCensus(dataDir, { ...censusConf, instanceId }, { log });
    fingerprintCensus.load();

    outcomeCensus = new OutcomeCensus(dataDir, { ...(censusConf.outcome || {}), instanceId }, { log });
    outcomeCensus.load();

    hitCounter = new RuleHitCounter(dataDir, { ...(custom.hitCounter || {}), instanceId }, { log });
    hitCounter.init();

    compiledRules = loadRules();

    // Sweep periodico: gli archivi sono indicizzati da chiavi che l'attaccante
    // controlla, quindi la scadenza va applicata attivamente. Il salvataggio va
    // in coppia con lo sweep per non riscrivere i file nel percorso caldo.
    const sweepSeconds = Number.isFinite(custom.sweepIntervalSeconds) ? custom.sweepIntervalSeconds : 300;
    if (sweepSeconds > 0) {
      sweepTimer = setInterval(() => {
        try {
          fingerprintCensus.sweep();
          outcomeCensus.sweep();
          sentinelLog.enforceSizeBudget();
        } catch (err) {
          log('warn', `sweep fallito: ${err.message}`);
        }
      }, sweepSeconds * 1000);
      if (sweepTimer.unref) sweepTimer.unref();
    }

    const censusSaveSeconds = Number.isFinite(censusConf.saveIntervalSeconds) ? censusConf.saveIntervalSeconds : 60;
    if (censusSaveSeconds > 0) {
      censusSaveTimer = setInterval(() => {
        try {
          fingerprintCensus.save();
          outcomeCensus.save();
        } catch (err) {
          log('warn', `salvataggio del censimento fallito: ${err.message}`);
        }
      }, censusSaveSeconds * 1000);
      if (censusSaveTimer.unref) censusSaveTimer.unref();
    }

    process.on('SIGTERM', persistAll);
    process.on('SIGINT', persistAll);

    const modeLabel = custom.mode === 'enforce' ? 'ENFORCE' : 'monitor (osservazione)';
    log('info',
      `attivo — modalità ${modeLabel}, ${compiledRules.length} regole, ` +
      `osservazione esiti: ${custom.observeOutcomes === false ? 'off' : 'on'}, ` +
      `censimento IP: ${(custom.census && custom.census.censusIpMode) || 'count'}`);
  },

  /**
   * Directory che il plugin scrive a runtime.
   *
   * Sondate al boot dal gate di scrivibilità: se non scrivibili il plugin viene
   * saltato con un box [STORAGE] invece di far emergere il problema alla prima
   * scrittura. Il path va risolto OFFLINE dal config, perché questo metodo gira
   * prima di loadPlugin.
   */
  getWritablePaths(pluginSys, pathPluginFolder) {
    const folder = pathPluginFolder || __dirname;
    let conf = custom;
    if (!conf) {
      try {
        conf = loadJson5(path.join(folder, 'pluginConfig.json5')).custom || {};
      } catch (_err) {
        return [];
      }
    }
    return [
      { path: resolveDataDir(folder, conf), purpose: 'sentinel event log and aggregates (JSONL + JSON5)' },
      { path: path.resolve(folder, 'decoys', 'data'), purpose: 'user-provided decoy files' },
    ];
  },

  /**
   * Oggetto condiviso.
   *
   * Per il core (`index.js`) è il MOTORE che finisce nello slot pre-router: le
   * tre funzioni del contratto del gate devono essere qui in cima. Per gli altri
   * plugin — in prospettiva il twin `adminSentinel` — è anche l'API di lettura e
   * di ricarica a caldo.
   */
  getObjectToShareToOthersPlugin() {
    if (!custom || custom.enabled === false) return null;

    return {
      // ── Contratto del gate ──
      evaluate: (ctx) => engine.evaluate(ctx),
      observeOutcome: (ctx, info) => engine.observeOutcome(ctx, info),
      onGateState: (state) => engine.onGateState(state),

      // ── Lettura (twin admin) ──
      getStats: () => ({
        enabled: custom.enabled !== false,
        mode: custom.mode || 'monitor',
        gateState,
        ruleCount: compiledRules.length,
        pendingLogEvents: sentinelLog ? sentinelLog.pendingSize() : 0,
        fingerprints: fingerprintCensus ? fingerprintCensus.getStats() : null,
        outcomes: outcomeCensus ? outcomeCensus.getStats() : null,
      }),
      getRuleSummary: () => (hitCounter ? hitCounter.getSummary() : []),
      getRuleNames: () => compiledRules.map((r) => r.name),
      getSuspectedScanners: (minPaths) => (outcomeCensus ? outcomeCensus.getSuspectedScanners(minPaths) : []),
      getConfig: () => JSON.parse(JSON.stringify(custom)),

      // ── Validazione (prima di un salvataggio dalla GUI) ──
      validateRules: (rulesData) => validateRules(rulesData, {
        knownRateLimiterRules: getRateLimiterRuleNames(),
        allowedRedirectHosts: Array.isArray(custom.allowedRedirectHosts) ? custom.allowedRedirectHosts : [],
      }),

      // ── Ricarica a caldo ──
      reloadRules,
      reloadConfig,
      flushNow: () => {
        if (sentinelLog) sentinelLog.flush();
        if (fingerprintCensus) fingerprintCensus.save();
        if (outcomeCensus) outcomeCensus.save();
        if (hitCounter) hitCounter.save();
      },
    };
  },
};

/**
 * Risolve la data dir dal config. Usata sia a runtime sia OFFLINE da
 * getWritablePaths, che gira prima di loadPlugin.
 */
function resolveDataDir(folder, conf) {
  return path.resolve(folder, (conf && conf.dataPath) || './data');
}

/** Salvataggio finale allo spegnimento: nessun dato perso su un riavvio pulito. */
function persistAll() {
  try {
    if (sentinelLog) sentinelLog.flush();
    if (fingerprintCensus) fingerprintCensus.save();
    if (outcomeCensus) outcomeCensus.save();
    if (hitCounter) hitCounter.shutdown();
  } catch (_err) {
    // fail-soft: siamo in chiusura, un errore qui non deve impedire l'uscita
  }
}

// Esportati per i test: verificano il comportamento del motore senza dover
// montare un'applicazione Koa completa.
module.exports._internals = {
  resolveClientIp: (ctx, conf) => { const prev = custom; custom = conf || custom; const r = resolveClientIp(ctx); custom = prev; return r; },
  shouldEnforce: (rule, subject, conf) => { const prev = custom; custom = conf || custom; const r = shouldEnforce(rule, subject); custom = prev; return r; },
  resolveDataDir,
};
