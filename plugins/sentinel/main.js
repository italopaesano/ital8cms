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
const { testRequest } = require('./lib/ruleTracer');
const { validateRules, logValidationResults } = require('./lib/ruleValidator');
const setJson5Key = require('../../core/setJson5Key');
const { setRuleAction: editRuleAction, replaceRule } = require('./lib/rulesFileEditor');
const { renderDecoy, resolveDecoyPath } = require('./lib/decoyRenderer');
const { CanaryRegistry, findCanary } = require('./lib/canaryRegistry');
const { SessionCoherence } = require('./lib/sessionCoherence');
const { Tarpit } = require('./lib/tarpit');
const { classify: classifyReputation } = require('./lib/reputation');
const { AlertDispatcher } = require('./lib/alertDispatcher');
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
let canaryRegistry = null;
let sessionCoherence = null;
let tarpit = null;
let alerts = null;

// Contatori di `drop`. Vivono qui e non in un modulo perché l'azione è tre righe
// di codice: un file solo per contarle sarebbe cerimonia.
let dropped = 0;
let dropDegraded = 0;   // quante volte è degradato a blocco per via del proxy
let sweepTimer = null;
let censusSaveTimer = null;
let gateState = 'running';

let pluginSysRef = null;

// Contenuto dei file di decoy già letti. Un decoy è un file statico servito a
// traffico ostile: rileggerlo dal disco a ogni richiesta significherebbe che
// chi sta scandendo il sito detta il ritmo delle nostre letture su disco.
// In debug la cache resta spenta, come per le regole, così una modifica al file
// si vede subito.
const decoyCache = new Map();

// Latch per non ripetere all'infinito lo stesso avviso di configurazione.
let rulesUnavailableLogged = false;
// Idem per la catena X-Forwarded-For più corta dei proxy dichiarati: la
// condizione è provocabile da chi bussa, quindi un log per richiesta sarebbe
// un attacco al disco travestito da diagnostica.
let shortProxyChainLogged = false;

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
    behindProxy: custom.trustProxy === true,
  });

  logValidationResults(result, logger, LOG_PREFIX);

  if (!result.valid && custom.strictValidation) {
    throw new Error('[sentinel] validazione di sentinelRules.json5 fallita (strictValidation=true)');
  }

  warnMissingDecoyFiles(result.rules);

  return result.rules;
}

/**
 * Avvisa se una regola `decoy` punta a un file che non esiste.
 *
 * Il validatore non può accorgersene: non conosce la cartella del plugin, e
 * dev'essere utilizzabile dalla GUI del twin admin per validare un testo che non
 * è ancora stato salvato. Il controllo sta qui, dove il disco c'è.
 *
 * È un avviso e non un errore perché la regola resta legittima — un decoy si
 * scrive spesso dopo la regola che lo userà — ma senza il file l'azione degrada
 * al 404 comune, e scoprirlo dal traffico invece che dall'avvio sarebbe la
 * peggiore delle sorprese: il decoy sembra configurato e non lo è.
 */
function warnMissingDecoyFiles(rules) {
  if (!pluginFolder) return;
  for (const rule of rules) {
    if (rule.action !== 'decoy' || !rule.decoy) continue;
    if (resolveDecoyPath(pluginFolder, rule.decoy.file)) continue;
    log('warn',
      `regola "${rule.name}": il decoy "${rule.decoy.file}" non esiste né in ` +
      'decoys/data/ né in decoys/default/ — l\'azione degraderà al 404 comune');
  }
}

/** Rilegge le regole a caldo (usato dal twin admin dopo un salvataggio). */
function reloadRules() {
  compiledRules = loadRules();
  // I decoy si modificano insieme alle regole che li usano: tenere in cache il
  // contenuto vecchio dopo un ricaricamento renderebbe la modifica invisibile
  // fino al riavvio.
  decoyCache.clear();
  log('info', `regole ricaricate: ${compiledRules.length} attive`);
  return compiledRules.length;
}

function reloadConfig() {
  try {
    const cfg = loadJson5(path.join(pluginFolder, 'pluginConfig.json5'));
    custom = cfg.custom || {};
    compiledRules = loadRules();
    decoyCache.clear();
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
  if (!alerts) return;
  const { kind, ...rest } = payload || {};
  alerts.notify(kind || 'diskBudget', rest);
}

/**
 * Confronta la richiesta autenticata con la linea di base della sua sessione.
 *
 * Gira **prima** della valutazione delle regole perché il risultato è una
 * condizione come le altre, e come le altre dev'essere calcolato una volta sola.
 *
 * Nessun effetto sul traffico anonimo: una sessione anonima non ha niente da
 * rubare, e tracciarla richiederebbe di crearla — cioè mandare un cookie a ogni
 * visitatore, che è un cambiamento di comportamento sproporzionato al segnale.
 *
 * Fail-soft: qualunque problema qui restituisce «nessuna anomalia», mai
 * un'eccezione. Il resto del filtro deve continuare a funzionare.
 *
 * @returns {string[]}
 */
function inspectSession(ctx, fingerprint, clientIp) {
  if (!sessionCoherence) return [];
  const session = ctx.session;
  if (!session || !session.authenticated) return [];

  try {
    const sessionId = SessionCoherence.resolveSessionId(session);
    if (!sessionId) return [];

    const fpClass = fingerprint.fpClass || {};
    const result = sessionCoherence.observe(sessionId, {
      userAgent: ctx.get ? (ctx.get('User-Agent') || '') : '',
      // La CLASSE dell'impronta, non l'hash: l'hash cambia fra una navigazione e
      // una fetch dello stesso browser. Vedi CLIENT_CLASS_FIELDS.
      fpClass,
      ip: clientIp,
      username: (session.user && session.user.username) || null,
      // Un cookie valido in mano a qualcosa che non è un browser. Non è un
      // cambiamento ma uno stato, ed è già di per sé la descrizione di un
      // problema anche se quel client ha usato il cookie fin dall'inizio.
      isScriptClient: fpClass.headerProfile === 'minimal' || fpClass.family === 'script-like',
    });
    return result.anomalies;
  } catch (err) {
    log('warn', `coerenza di sessione non valutata: ${err.message}`);
    return [];
  }
}

/**
 * Sorveglia il tasso di sfratto del censimento delle impronte.
 *
 * ─── PERCHE UNA CONTROMISURA FA DA SENSORE ────────────────────────────────────
 * Il tetto del censimento esiste perché la sua chiave — l'impronta — la decide
 * chi bussa: randomizzare l'ordine degli header genera una firma nuova a ogni
 * richiesta, e senza tetto la difesa diventerebbe il modo di esaurire la memoria.
 *
 * Ma in esercizio normale quel tetto non si tocca mai: il traffico vero converge
 * su poche decine di impronte, e per settimane gli sfratti restano a zero. Un
 * tasso di sfratto improvviso non è un problema di capacità da alzare, è la firma
 * di qualcuno che sta producendo chiavi a raffica — cioè che ha capito come
 * funziona il censimento e sta provando a gonfiarlo. La contromisura, misurata,
 * diventa un rilevatore.
 *
 * Si guarda il DELTA fra due passaggi, non il totale: il totale cresce e basta,
 * e dopo un episodio resterebbe sopra soglia per sempre.
 */
let lastEvictionCount = 0;

function checkEvictionRate() {
  if (!fingerprintCensus || !fingerprintCensus.store) return;

  const total = fingerprintCensus.store.evictions || 0;
  const delta = total - lastEvictionCount;
  lastEvictionCount = total;
  if (delta <= 0) return;

  const alertConf = (custom && custom.alerts) || {};
  const threshold = Number.isFinite(alertConf.evictionsPerSweep) ? alertConf.evictionsPerSweep : 100;
  if (threshold <= 0 || delta < threshold) return;

  sendAlert({
    kind: 'evictionRate',
    evictionsInWindow: delta,
    evictionsTotal: total,
    threshold,
    trackedFingerprints: fingerprintCensus.store.size,
    hint: 'impronte create a raffica: probabile randomizzazione degli header per gonfiare il censimento',
  });
}

/** `mailer`, risolto al momento dell'uso come `rateLimiter`: opzionale, mai una dipendenza. */
function getMailer() {
  if (!pluginSysRef) return null;
  try {
    return pluginSysRef.getSharedObject('mailer', 'sentinel');
  } catch (_err) {
    return null;
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
 * Con `trustedProxyCount` si prende la voce giusta contando DA DESTRA. Ogni proxy
 * APPENDE l'indirizzo da cui ha ricevuto, quindi con due proxy fidati la catena
 * legittima è `client, proxy1` e l'indice giusto è `length - hops`. Prendere la
 * prima voce da sinistra — la scelta comoda — significa leggere un valore che il
 * client controlla, quindi permettergli di attribuire i propri blocchi a un
 * indirizzo altrui o di aggirare un ban cambiando header a ogni richiesta.
 *
 * ─── LA CATENA PIU CORTA DEL PREVISTO NON SI USA ──────────────────────────────
 * Qui c'era `Math.max(0, chain.length - hops)`, cioè: se la catena è più corta di
 * quanto dichiarato, prendi la prima voce. È il caso in cui la prima voce è
 * proprio quella che NON è stata scritta da un proxy fidato.
 *
 * E non serve una configurazione sbagliata per arrivarci — bastava quella, ma
 * c'è di peggio. Con `trustedProxyCount: 1` perfettamente corretto, chi raggiunge
 * l'app **direttamente** (porta aperta sulla rete, proxy scavalcato) manda
 * `X-Forwarded-For: 1.2.3.4`: la catena ha un solo elemento, nessun proxy l'ha
 * toccata, e il vecchio calcolo restituiva `1.2.3.4`. Misurato. Da lì in poi IP
 * di ban, chiave del censimento, escalation verso rateLimiter e confronto
 * `sameClient` del canary erano tutti scelti da chi bussa.
 *
 * Se la catena è più corta di `hops`, la richiesta non ha attraversato i proxy
 * dichiarati: non esiste una voce fidata da leggere, e si ricade sul **peer del
 * socket**, che non è falsificabile. Si perde granularità — dietro un proxy vero
 * il peer è il proxy — ma non si crede a un valore inventato.
 *
 * ⚠ Il ripiego vale finché `app.proxy` di Koa resta disattivato (oggi lo è, e non
 * è impostato da nessuna parte): con `app.proxy: true` sarebbe Koa stessa a
 * leggere l'XFF e a restituirne la prima voce, reintroducendo il problema dentro
 * `ctx.ip`. È fra le voci di vigilanza del TODO del plugin.
 *
 * @param {object} ctx
 * @returns {string}
 */
function resolveClientIp(ctx) {
  const trustProxy = custom.trustProxy === true;
  const peerIp = normalizeIp((ctx && (ctx.ip || (ctx.request && ctx.request.ip))) || '');

  if (trustProxy && ctx.headers) {
    const raw = ctx.headers['x-forwarded-for'];
    if (typeof raw === 'string' && raw.length > 0) {
      const chain = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const hops = Number.isInteger(custom.trustedProxyCount) && custom.trustedProxyCount > 0
        ? custom.trustedProxyCount
        : 1;

      if (chain.length >= hops) return normalizeIp(chain[chain.length - hops]);

      // Catena più corta dei proxy dichiarati: o la topologia non è quella
      // configurata, o qualcuno sta parlando all'app senza passare dai proxy.
      // Entrambe le cose vanno sapute, ma una sola volta: il caso è provocabile
      // da chi bussa, e un log per richiesta sarebbe un attacco al disco.
      if (!shortProxyChainLogged) {
        log('warn',
          `X-Forwarded-For con ${chain.length} voce/i ma trustedProxyCount=${hops}: ` +
          'la richiesta non ha attraversato i proxy dichiarati. Uso l\'indirizzo del ' +
          'socket. Controlla trustedProxyCount, e che l\'app non sia raggiungibile ' +
          'direttamente scavalcando il proxy.');
        shortProxyChainLogged = true;
      }
    }
  }

  return peerIp;
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
  // Azioni che NON producono una risposta: la richiesta prosegue comunque.
  //
  // `throttle` è il caso non ovvio, ed è qui perché AGISCE senza rispondere: la
  // sua azione è l'escalation verso rateLimiter, non il destino di questa
  // richiesta. Considerarlo enforcement rompeva tre cose insieme —
  //   • il gate, non trovando un `respond`, degradava al 404 comune: una regola
  //     documentata come «delega a rateLimiter SENZA bloccare» bloccava tutto;
  //   • il censimento delle impronte lo contava come blocco (`blocked:` più
  //     sotto), quindi la reputazione condannava per blocchi mai avvenuti;
  //   • la dashboard lo mostrava nella colonna «enforced» invece che fra gli
  //     osservati.
  // L'escalation resta e parte lo stesso: vedi la condizione in `evaluate`.
  if (rule.action === 'allow' || rule.action === 'monitor' || rule.action === 'throttle') return false;

  // Tetto globale: in "monitor" nulla agisce, nemmeno una regola `block`.
  if (custom.mode !== 'enforce') return false;

  // Tetto del gate. Il gate lo applica comunque per conto suo — è la difesa che
  // deve reggere anche con un motore impazzito — ma va considerato ANCHE qui,
  // altrimenti il log mente: con `sentinel monitor` attivo il motore scriverebbe
  // `enforced: true` su una richiesta che è passata. Un log che racconta blocchi
  // mai avvenuti è peggio di un log assente, perché ci si fa affidamento.
  if (gateState !== 'running') return false;

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
    // Presente solo quando la richiesta portava un token esca: nel log è la riga
    // che non ha bisogno di essere interpretata.
    canary: subject.canary
      ? { token: subject.canary.token, status: subject.canary.status }
      : null,
    // Presente solo quando la sessione ha smesso di assomigliare a sé stessa.
    sessionAnomalies: subject.sessionAnomalies && subject.sessionAnomalies.length > 0
      ? subject.sessionAnomalies
      : null,
    // Giudizio sulla storia locale dell'impronta, quando c'è.
    reputation: subject.reputation && subject.reputation.levels.length > 0
      ? subject.reputation.levels
      : null,
  };
}

/**
 * Chiave con cui questo client è noto a rateLimiter.
 *
 * Sul traffico autenticato è l'ACCOUNT, non l'indirizzo: un account compromesso
 * usato da una botnet distribuita su 500 IP alimenta comunque un solo contatore,
 * e viene colto. L'API di rateLimiter accetta già una chiave esplicita.
 */
function clientKeyFor(subject) {
  return subject.authenticated && subject.username ? `user:${subject.username}` : subject.ip;
}

/**
 * Alimenta rateLimiter, se la regola lo chiede e il plugin c'è.
 *
 * ─── DUE INTENSITA, UNA SOLA DICHIARAZIONE ────────────────────────────────────
 * `escalate` senza `ban` **conta un fallimento**: sarà rateLimiter, con la sua
 * escalation, a decidere dopo quanti tentativi bloccare. È la forma giusta per
 * tutto ciò che resta un'inferenza — una sonda sospetta, un UA incoerente — dove
 * il singolo evento non prova niente e l'insistenza sì.
 *
 * `escalate: { ban: true }` **blocca subito**, saltando il conteggio. Si
 * giustifica solo dove non c'è niente da accumulare perché il primo evento è già
 * la prova: il caso è il canary, un token che esiste solo dentro un decoy e che
 * nessuno può richiedere senza averlo letto lì.
 *
 * ─── IL BAN OBBEDISCE AI TETTI, IL CONTEGGIO NO ───────────────────────────────
 * Il conteggio parte anche per una regola in `monitor` (comportamento storico,
 * documentato nel file delle regole: non dichiarare `escalate` finché la regola
 * è in osservazione). Il ban **no**: forzare un blocco è un'azione, e le azioni
 * passano dai tetti dell'enforcement. Un sentinel in osservazione che fa bandire
 * gente da rateLimiter non sarebbe un osservatorio.
 *
 * @returns {false|'counted'|'banned'}
 */
function escalate(rule, subject, enforced) {
  if (!rule.escalate) return false;
  const rl = getRateLimiter();
  if (!rl) return false;

  const clientId = clientKeyFor(subject);
  const ruleName = rule.escalate.rateLimiterRule;

  if (rule.escalate.ban && enforced) {
    if (typeof rl.banClient !== 'function') return false;
    try {
      const opts = { tier: 'long' };
      if (rule.escalate.banSeconds) opts.seconds = rule.escalate.banSeconds;
      rl.banClient(clientId, ruleName, opts);
      log('warn', `ban immediato di ${clientId} (regola "${rule.name}" → rateLimiter "${ruleName}")`);
      return 'banned';
    } catch (err) {
      log('warn', `ban immediato fallito: ${err.message}`);
      return false;
    }
  }

  if (typeof rl.recordFailure !== 'function') return false;
  try {
    rl.recordFailure(clientId, ruleName);
    return 'counted';
  } catch (err) {
    log('warn', `escalation verso rateLimiter fallita: ${err.message}`);
    return false;
  }
}

/**
 * Registra e segnala l'uso di un token esca.
 *
 * ─── IL CONFRONTO CHE VALE PIU DEL TOKEN STESSO ───────────────────────────────
 * Sapere che un canary è stato usato è già una certezza. Ma il registro sa anche
 * a CHI era stato consegnato, e il confronto fra consegnatario e utilizzatore
 * dice una cosa che nessun altro dato del plugin può dire:
 *
 *   stesso client   → uno scanner che segue i link che trova. Automazione.
 *   client DIVERSO  → il contenuto del decoy è passato di mano. Chi scandaglia e
 *                     chi sfrutta sono due macchine, il che descrive
 *                     un'operazione più strutturata di un bot che gira da solo.
 *
 * Per questo `sameClient` è un campo a sé e non una nota nel testo: è la domanda
 * a cui si vuole rispondere guardando la dashboard, non una curiosità.
 */
function recordCanaryTrigger(subject, rule, enforced, escalation) {
  const found = subject.canary;
  const delivered = found.deliveredTo || {};
  const sameClient = found.status === 'known'
    ? (delivered.ip === subject.ip || delivered.fp === subject.fp)
    : null;

  canaryRegistry.recordTrigger({
    token: found.token,
    status: found.status,
    usedByIp: subject.ip,
    usedByFp: subject.fp,
    usedOnPath: subject.path,
    deliveredToIp: delivered.ip || null,
    deliveredAt: delivered.mintedAt || null,
    deliveredOnPath: delivered.path || null,
    sameClient,
    ruleName: rule ? rule.name : null,
    enforced,
  });

  sendAlert({
    kind: 'canaryTriggered',
    token: found.token,
    status: found.status,
    usedBy: subject.ip,
    usedOn: subject.path,
    deliveredTo: delivered.ip || null,
    deliveredAt: delivered.mintedAt ? new Date(delivered.mintedAt).toISOString() : null,
    sameClient,
    rule: rule ? rule.name : '(nessuna regola trappola ha matchato)',
    enforced,
    escalation: escalation || 'nessuna',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RISPOSTE PROPRIE DEL PLUGIN (decoy, redirect)
// ─────────────────────────────────────────────────────────────────────────────
//
// Il gate produce da sé il 404 di `block`, riusando `reservedGate.deny()` perché
// quel 404 dev'essere byte-identico a uno autentico. Decoy e redirect invece
// hanno un corpo che solo il plugin conosce: il verdetto porta con sé la
// funzione che lo scrive, e il gate la chiama SOLO se l'enforcement è davvero in
// vigore e se la risposta non tradirebbe la superficie riservata chiusa.
//
// Nessuna di queste funzioni chiama `next()`: la richiesta finisce qui.

/**
 * Scrive un contenuto fittizio sulla risposta.
 *
 * L'ordine delle scritture non è casuale: il tipo dedotto dall'estensione viene
 * PRIMA degli header dichiarati dalla regola, così una regola che vuole un
 * `Content-Type` diverso da quello dell'estensione può averlo. È la scelta più
 * specifica a vincere, e gli header pericolosi sono già stati rifiutati al
 * caricamento.
 */
function serveDecoy(ctx, spec, subject) {
  const rendered = renderDecoy({
    pluginFolder,
    spec,
    vars: { path: subject.path, ip: subject.ip },
    useCache: !isDebugMode,
    cache: decoyCache,
    // Il token si conia al momento della consegna e si registra INSIEME a chi lo
    // riceve: è quel legame — non il token in sé — a rendere il canary più di un
    // URL improbabile.
    mintCanary: canaryRegistry
      ? () => canaryRegistry.mint({ ip: subject.ip, fp: subject.fp, path: subject.path })
      : undefined,
  });

  // File sparito dopo il caricamento (cancellato, permessi cambiati): il gate
  // intercetta l'eccezione, logga una volta sola e ripiega sul 404 comune.
  if (!rendered) {
    throw new Error(`decoy "${spec.file}" non trovato in decoys/data/ né in decoys/default/`);
  }

  ctx.status = rendered.status;
  ctx.type = rendered.type;
  for (const [name, value] of Object.entries(rendered.headers)) ctx.set(name, value);
  ctx.body = rendered.body;
}

/**
 * Manda la richiesta altrove.
 *
 * Non si usa `ctx.redirect()`: quello di Koa compone un corpo che riflette
 * l'URL e varia con l'header Accept, cioè rende la risposta riconoscibile e
 * diversa da quella di un redirect qualunque. Qui l'unica informazione è il
 * Location — destinazione e stato sono già stati validati al caricamento
 * (allowlist per l'esterno, permanenti vietati fuori dal sito).
 */
function serveRedirect(ctx, spec) {
  ctx.status = spec.status;
  ctx.set('Location', spec.to);
  ctx.type = 'text/plain; charset=utf-8';
  ctx.body = '';
}

/**
 * Chiude la connessione senza rispondere niente (lo stile del 444 di nginx).
 *
 * ─── COSA DA E COSA TOGLIE RISPETTO AL BLOCCO ─────────────────────────────────
 * Il 404 di `block` è **indistinguibile** da un URL che non è mai esistito: è la
 * sua qualità principale, e il motivo per cui è il default. Ma è anche una
 * risposta completa, che costa a noi il lavoro di produrla e a chi bussa quasi
 * niente.
 *
 * Troncare la connessione costa meno a noi e molto di più a lui: senza risposta,
 * il suo client resta in attesa fino al proprio timeout. In cambio si rinuncia
 * all'indistinguibilità — una connessione azzerata si nota, e dice che quel
 * percorso è trattato diversamente dagli altri. Sono due strumenti, non uno
 * migliore dell'altro.
 *
 * ─── DIETRO UN PROXY NON FUNZIONA, E FA PEGGIO ────────────────────────────────
 * Con un reverse proxy davanti, il socket che tronchiamo è quello **verso il
 * proxy**, non verso il client: il proxy risponde 502, che è più rumoroso di un
 * 404 e riempie i suoi log di errori. Per questo, con `trustProxy: true`
 * dichiarato, `drop` degrada al blocco: è l'unica configurazione in cui sappiamo
 * con certezza di non stare parlando direttamente col client.
 */
function serveDrop(ctx) {
  if (custom.trustProxy === true) {
    dropDegraded++;
    return false;   // il gate scrive il 404 comune
  }

  // L'ORDINE CONTA. `ctx.respond = false` dice a Koa «non finalizzare tu»: se lo
  // si assegna prima di sapere che c'è un socket da troncare, e il socket non
  // c'è (HTTP/2, un adapter che lo stacca, una connessione smontata fra il router
  // e questo punto), nessuno risponde più — né noi né Koa — e restituendo `true`
  // il gate crede che sia stato gestito e salta il 404 di ripiego. La richiesta
  // resta appesa fino al timeout del client, e il contatore registra un drop mai
  // avvenuto. Senza socket si RINUNCIA, come si fa dietro proxy: contesto intatto,
  // il gate scrive il 404 comune.
  const socket = ctx.res && ctx.res.socket;
  if (!socket) {
    dropDegraded++;
    return false;
  }

  ctx.respond = false;
  if (!socket.destroyed) socket.destroy();
  dropped++;
  return true;
}

/**
 * Trattiene la connessione a gocce.
 *
 * Col tetto pieno **rinuncia** invece di accodare: la richiesta successiva deve
 * costare quanto un 404 normale, o il tetto sposterebbe il problema invece di
 * risolverlo. Rinunciando lascia il contesto intatto, così il gate può ancora
 * scriverci il proprio 404.
 */
async function serveTarpit(ctx, spec) {
  if (!tarpit) return false;

  const outcome = await tarpit.hold(ctx, { seconds: spec && spec.seconds });
  return outcome.held;
}

/**
 * Attacca al verdetto la funzione che ne scriverà la risposta.
 *
 * Solo per i verdetti che verranno applicati: senza `respond` il gate degrada al
 * 404 comune, che è esattamente quello che deve succedere quando l'azione è
 * dichiarata ma l'enforcement non è in vigore.
 */
function attachResponder(verdict, rule, subject) {
  if (rule.action === 'decoy' && rule.decoy) {
    verdict.respond = (ctx) => serveDecoy(ctx, rule.decoy, subject);
  } else if (rule.action === 'redirect' && rule.redirect) {
    verdict.respond = (ctx) => serveRedirect(ctx, rule.redirect);
  } else if (rule.action === 'drop') {
    verdict.respond = (ctx) => serveDrop(ctx);
  } else if (rule.action === 'tarpit') {
    verdict.respond = (ctx) => serveTarpit(ctx, rule.tarpit);
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
      // Cercato UNA volta per richiesta, non una per regola: la scansione tocca
      // percorso e querystring, e quasi nessuna richiesta contiene un token.
      canary: findCanary(canaryRegistry, ctx.path, ctx.querystring),
      sessionAnomalies: inspectSession(ctx, fingerprint, clientIp),
      // Sulla voce di censimento com'era PRIMA di questa richiesta: registrarla
      // per prima farebbe influenzare alla richiesta il giudizio su sé stessa.
      reputation: fingerprintCensus
        ? classifyReputation(
          fingerprintCensus.getEntry(fingerprint.fp),
          fingerprint.fpClass,
          custom.reputation || {},
        )
        : null,
    });

    const rule = findFirstMatch(rules, subject, matcher);

    const enforced = rule ? shouldEnforce(rule, subject) : false;

    // Censimento: registra SEMPRE la comparsa dell'impronta, anche quando nessuna
    // regola ha matchato. È il traffico non classificato a dire quali regole
    // mancano; contarlo solo quando una regola scatta significherebbe vedere solo
    // ciò che si sa già riconoscere.
    //
    // Gira DOPO il calcolo di `enforced` perché la quota di blocchi è il dato su
    // cui poggia la reputazione, e senza il verdetto non la si saprebbe. I
    // blocchi decisi da una regola che USA la reputazione sono però esclusi: se
    // contassero, il primo inciampo di un'impronta la condannerebbe per sempre —
    // bloccata, quindi quota più alta, quindi più bloccata.
    if (fingerprintCensus) {
      fingerprintCensus.record(fingerprint.fp, {
        fpClass: fingerprint.fpClass,
        ip: subject.ip,
        path: subject.path,
        matched: !!rule,
        judged: !(rule && rule.usesReputation),
        blocked: enforced && !(rule && rule.usesReputation),
      });
    }
    // `monitor` e `throttle` alimentano rateLimiter pur non essendo enforcement:
    // il primo per scelta storica (contare mentre si osserva), il secondo perché
    // contare È la sua azione. In entrambi i casi `enforced` è false, quindi
    // `escalate.ban` non scatta: il ban è un'azione e le azioni passano dai tetti
    // dell'enforcement. Un throttle che bandisce sarebbe una contraddizione nei
    // termini, oltre che una sorpresa.
    const escalation = rule && (enforced || rule.action === 'monitor' || rule.action === 'throttle')
      ? escalate(rule, subject, enforced)
      : false;
    const escalated = escalation !== false;

    // Un canary usato è l'unico evento del plugin che non ammette interpretazioni,
    // e si segnala PRIMA di guardare se una regola lo copre.
    //
    // Fuori dal `if (rule)` di proposito: il caso in cui nessuna regola matcha è
    // quello in cui la segnalazione serve di più — significa che il token è stato
    // usato e la regola trappola è stata cancellata, rinominata o messa dopo una
    // `allow` che la scavalca. Legare l'unico segnale certo del plugin alla
    // presenza di una riga in un file modificabile dalla GUI sarebbe fragile
    // esattamente dove non ce lo si può permettere.
    //
    // Si segnala anche in osservazione: osservare significa non agire sulla
    // richiesta, non tacere su ciò che si è visto. Il dispatcher ha già la
    // finestra di silenzio che impedisce a chi usa il token in ciclo di
    // trasformare la notifica nel moltiplicatore del proprio attacco.
    if (subject.canary && canaryRegistry) {
      recordCanaryTrigger(subject, rule, enforced, escalation);
    }

    if (!rule) return null;

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

    // Decoy e redirect portano con sé la propria risposta. `tarpit` non ancora:
    // senza `respond` il gate degrada al 404 comune, quindi la regola si può già
    // scrivere e osservare e cambierà solo l'effetto.
    if (enforced) attachResponder(verdict, rule, subject);

    return verdict;
  },

  /**
   * Osserva come è finita una richiesta lasciata passare.
   *
   * È qui che sentinel scopre gli attacchi per cui non esiste ancora una regola:
   * il classico «quaranta percorsi diversi falliti in un minuto», che nessuna
   * regola scritta a mano avrebbe intercettato.
   *
   * ─── PERCHE SOLO DAL 400 IN SU ────────────────────────────────────────────
   * Il gate filtra i 2xx (un 200 non è un segnale, e così si evita al motore il
   * 99% delle chiamate), ma il suo filtro è «non-2xx» — cioè comprende anche i
   * **3xx**, che qui sarebbero rumore travestito da segnale.
   *
   * Un redirect non è una richiesta fallita: è il sito che risponde come deve.
   * E i redirect non sono rari — la sola area admin ne emette uno per ogni
   * richiesta non autenticata, verso la pagina di login. Il caso peggiore è un
   * sito con `urlRedirect` o `hideExtension` attivi: un crawler legittimo che
   * segue duecento link vecchi colleziona duecento percorsi distinti e finisce
   * fra i «sospetti scanner» — cioè nel pannello che esiste per mostrare gli
   * attacchi privi di regola. Ed è proprio il tipo di sito che quei due plugin
   * li installa.
   *
   * (Il 304 sarebbe il caso da manuale, ma qui non si presenta: nessuna delle
   * istanze di `koa-classic-server` gestisce le richieste condizionali, e le
   * risorse dei temi vanno esplicitamente in `no-store`. Verificato.)
   *
   * Fail-soft assoluto: la risposta è già stata emessa.
   */
  observeOutcome(ctx, info) {
    if (!custom || custom.observeOutcomes === false) return;
    if (!outcomeCensus) return;
    if (!(ctx.status >= 400)) return;

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

    // Il dispatcher va creato PRIMA di tutto ciò che può allertare: SentinelLog
    // emette la soglia del budget disco già durante `init()`.
    const alertConf = custom.alerts || {};
    alerts = new AlertDispatcher({
      log: (level, message) => log(level, message),
      getRecipient: () => (custom && custom.alertRecipient) || null,
      getMailer,
      cooldownMinutes: alertConf.cooldownMinutes,
    });

    const canaryConf = custom.canary || {};
    if (canaryConf.enabled !== false) {
      canaryRegistry = new CanaryRegistry(canaryConf);
    }

    const sessionConf = custom.sessionCoherence || {};
    if (sessionConf.enabled !== false) {
      sessionCoherence = new SessionCoherence(sessionConf);
    }

    tarpit = new Tarpit(custom.tarpit || {});

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
          if (canaryRegistry) canaryRegistry.sweep();
          if (sessionCoherence) sessionCoherence.sweep();
          sentinelLog.enforceSizeBudget();
          checkEvictionRate();
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
   *
   * ⚠ SOLO CIO CHE SI SCRIVE DAVVERO. Qui compariva anche `decoys/data`, che il
   * plugin non scrive mai — `resolveDecoyPath` fa `existsSync` e `readFileSync`,
   * e in tutto il codice non c'è una scrittura verso quella cartella. Su un
   * deploy con filesystem immutabile, o con `ReadWritePaths=` di systemd limitato
   * alla sola data dir, la sonda falliva e il gate saltava L'INTERO PLUGIN DI
   * SICUREZZA per una cartella da cui si legge soltanto. È lo scenario che il box
   * [SENTINEL] di index.js esiste per rendere visibile, provocato da noi.
   *
   * La regola che ne discende, per chi aggiungerà voci: una directory va
   * dichiarata qui se e solo se esiste una scrittura che la riguarda. «Serve al
   * plugin» non basta — leggere non richiede il permesso di scrivere.
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
        canary: canaryRegistry ? canaryRegistry.getStats() : null,
        sessions: sessionCoherence ? sessionCoherence.getStats() : null,
        tarpit: tarpit ? tarpit.getStats() : null,
        drop: { dropped, degradedBehindProxy: dropDegraded },
        reputation: custom.reputation || {},
        alerts: alerts ? alerts.getStats() : null,
      }),
      getRuleSummary: () => (hitCounter ? hitCounter.getSummary() : []),
      getRuleNames: () => compiledRules.map((r) => r.name),

      /**
       * Definizione corrente delle regole, senza il `match` compilato.
       *
       * Il twin ha bisogno dell'`action` in vigore per sapere quale gesto
       * proporre — promuovere o retrocedere — e ricavarla rileggendo il file
       * significherebbe mostrare qualcosa di diverso da ciò che il motore sta
       * applicando in quel momento.
       */
      getRules: () => compiledRules.map((r) => ({
        name: r.name,
        action: r.action,
        category: r.category,
        description: r.description,
        appliesTo: r.appliesTo,
        enabled: r.enabled,
        escalatesTo: r.escalate ? r.escalate.rateLimiterRule : null,
        // Una regola che bandisce al primo colpo non è "una regola con
        // escalation": è un'altra cosa, e nella tabella del twin dev'essere
        // visibile senza aprire il file.
        bansImmediately: !!(r.escalate && r.escalate.ban),
      })),
      /**
       * Le regole come stanno SUL FILE, non compilate.
       *
       * `getRules()` restituisce ciò che il motore sta applicando, con il
       * `match` compilato (Set, RegExp): perfetto per una tabella, inutilizzabile
       * per un form, che deve mostrare esattamente ciò che l'amministratore ha
       * scritto e riscriverlo senza trasformarlo. Rileggere il file è
       * l'operazione giusta anche per un secondo motivo: un form popolato dalla
       * versione compilata riscriverebbe `["php"]` dove c'era `"php"`.
       */
      getRulesSource: () => {
        const rulesData = loadJson5(path.join(pluginFolder, 'sentinelRules.json5'));
        return Array.isArray(rulesData.rules) ? rulesData.rules : [];
      },

      getSuspectedScanners: (minPaths) => (outcomeCensus ? outcomeCensus.getSuspectedScanners(minPaths) : []),
      getConfig: () => JSON.parse(JSON.stringify(custom)),

      /**
       * Prova una richiesta contro le regole in vigore, spiegando l'esito.
       *
       * Il caso d'uso non è «quale regola scatta» — quello si vede dal log — ma
       * «ho scritto questa regola e non scatta, perché?». Per questo riporta
       * TUTTE le regole valutate con atteso vs osservato per ogni condizione,
       * non solo quella vincente.
       *
       * Usa un valutatore separato da quello del percorso caldo: tracciare
       * costa allocazioni per ogni foglia, e non si fa pagare a tutto il
       * traffico una funzione usata qualche volta al mese.
       */
      testRequest: (spec) => testRequest(
        spec,
        isDebugMode ? loadRules() : compiledRules,
        matcher || new PatternMatcher(),
        {
          salt: custom.fingerprintSalt || '',
          globalPrefix: ital8Conf.globalPrefix || '',
          // Con il registro vero, incollare nel tester l'URL di un canary appena
          // scattato risponde alla domanda che si è appena posta chi lo incolla:
          // «la mia regola trappola lo avrebbe preso?».
          canaryRegistry,
        },
      ),

      // ── Validazione (prima di un salvataggio dalla GUI) ──
      validateRules: (rulesData) => validateRules(rulesData, {
        knownRateLimiterRules: getRateLimiterRuleNames(),
        allowedRedirectHosts: Array.isArray(custom.allowedRedirectHosts) ? custom.allowedRedirectHosts : [],
        behindProxy: custom.trustProxy === true,
      }),

      // ── Scrittura (usata dal twin adminSentinel) ──
      // Stanno QUI e non nel twin perché la conoscenza del formato del file e
      // l'obbligo di ricaricare dopo ogni scrittura appartengono al service:
      // se stessero di là, prima o poi qualcuno scriverebbe senza ricaricare e
      // la GUI direbbe "salvato" mentre il filtro continua col vecchio.
      getRulesFilePath: () => path.join(pluginFolder, 'sentinelRules.json5'),

      /**
       * Promuove o retrocede una regola.
       *
       * La RETROCESSIONE conta più della promozione: un percorso a senso unico
       * invita a non imboccarlo mai. Se disfare richiedesse di aprire un editor
       * JSON5 alle tre di notte, nessuno promuoverebbe niente.
       */
      setRuleAction: (ruleName, action) => {
        const filePath = path.join(pluginFolder, 'sentinelRules.json5');
        const result = editRuleAction(filePath, ruleName, action);
        if (result.changed) {
          reloadRules();
          log('info', `regola "${ruleName}": ${result.previous} → ${action}`);
        }
        return result;
      },

      /**
       * Sostituisce i campi di una regola (Vista C — form strutturato).
       *
       * ─── PERCHE SI VALIDA L'INSIEME E NON LA SINGOLA REGOLA ─────────────
       * Alcune proprietà esistono solo a livello di file: un nome duplicato,
       * una regola resa irraggiungibile da una `allow` che la precede. Validare
       * la sola regola modificata lascerebbe passare proprio gli errori che
       * nascono dal metterla insieme alle altre — e la GUI direbbe «salvato»
       * mentre il motore scarta.
       *
       * Si sostituisce quindi la regola nella STRUTTURA già parsata, si valida
       * il risultato con il validatore del motore, e solo se passa si tocca il
       * testo su disco.
       *
       * ⚠ La scrittura riscrive il blocco testuale di QUELLA regola: i commenti
       * scritti dentro di essa spariscono. Gli altri restano. L'interfaccia lo
       * dichiara prima del salvataggio invece di lasciarlo scoprire dopo.
       */
      setRuleFields: (ruleName, fields) => {
        const filePath = path.join(pluginFolder, 'sentinelRules.json5');
        const rulesData = loadJson5(filePath);
        const rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
        const index = rules.findIndex((r) => r && r.name === ruleName);
        if (index === -1) throw new Error(`regola non trovata: ${ruleName}`);

        // Il nome non è modificabile: lega contatori, righe di log e promozioni.
        const updated = { ...fields, name: ruleName };

        const candidate = { ...rulesData, rules: rules.map((r, i) => (i === index ? updated : r)) };
        const verdict = validateRules(candidate, {
          knownRateLimiterRules: getRateLimiterRuleNames(),
          allowedRedirectHosts: Array.isArray(custom.allowedRedirectHosts) ? custom.allowedRedirectHosts : [],
          behindProxy: custom.trustProxy === true,
        });
        if (!verdict.valid) {
          return { changed: false, valid: false, errors: verdict.errors, warnings: verdict.warnings };
        }

        replaceRule(filePath, ruleName, updated);
        reloadRules();
        log('info', `regola "${ruleName}" aggiornata dal form`);

        return { changed: true, valid: true, errors: [], warnings: verdict.warnings };
      },

      /**
       * Cambia la modalità globale (tetto sull'enforcement).
       *
       * `custom.mode` è un path annidato con parent oggetto, quindi setJson5Key
       * basta e i commenti restano intatti.
       */
      setMode: async (mode) => {
        if (mode !== 'monitor' && mode !== 'enforce') {
          throw new Error(`modalità non valida: ${mode} (ammesse: monitor, enforce)`);
        }
        const previous = custom.mode;
        if (previous === mode) return { changed: false, previous };

        await setJson5Key(path.join(pluginFolder, 'pluginConfig.json5'), ['custom', 'mode'], mode);
        custom.mode = mode; // effetto immediato, senza attendere un reload completo
        log('info', `modalità globale: ${previous} → ${mode}`);
        return { changed: true, previous };
      },

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
    // PRIMA di tutto il resto: `gracefulShutdown` aspetta che le connessioni
    // finiscano, e un tarpit da trenta secondi trasformerebbe un riavvio in
    // un'attesa di trenta secondi causata dalla propria difesa.
    if (tarpit) {
      const troncate = tarpit.abortAll();
      if (troncate > 0) log('info', `spegnimento: ${troncate} connessione/i trattenute troncate`);
    }
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
  serveDrop: (ctx, conf) => { const prev = custom; custom = conf || custom; const r = serveDrop(ctx); custom = prev; return r; },
  observeOutcome: (ctx, conf, census) => {
    const prevConf = custom;
    const prevCensus = outcomeCensus;
    custom = conf || custom;
    outcomeCensus = census || outcomeCensus;
    try { engine.observeOutcome(ctx, {}); } finally { custom = prevConf; outcomeCensus = prevCensus; }
  },
  resolveDataDir,
};
