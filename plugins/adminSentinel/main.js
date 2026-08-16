/**
 * adminSentinel — main.js
 *
 * Plugin admin gemello di `sentinel`. Fornisce la GUI del pannello per leggere
 * ciò che il filtro produce: composizione del traffico ostile, stato delle
 * regole, impronte, sospetti scanner, timeline.
 *
 * ─── PERCHE ESISTE, E PERCHE PRIMA DELLE ALTRE FEATURE ────────────────────────
 * La v1 di `sentinel` era write-only: osservava, classificava e registrava, ma
 * per leggere quei dati bisognava aprire i JSONL a mano. Il percorso
 * *osserva → capisci → promuovi* aveva la prima fase completa e le altre due
 * scoperte. Questo plugin copre la seconda.
 *
 * ─── DUE SORGENTI, NON UNA ────────────────────────────────────────────────────
 *   • oggetto condiviso di `sentinel` → stato VIVO (statistiche in memoria,
 *     nomi delle regole, censimenti a caldo). Stesso processo, costo nullo.
 *   • file su disco, via lib/sentinelDataReader → dati STORICI. Non passano per
 *     l'oggetto condiviso perché caricare un anno di eventi nella memoria del
 *     service per consegnarli al twin non avrebbe senso.
 *
 * A differenza di quella verso `rateLimiter` — deliberatamente assente — la
 * dipendenza da `sentinel` qui è dichiarata: un twin senza il proprio service
 * non ha nulla da mostrare.
 *
 * Vedi le convenzioni "Twin Admin Plugin" e "Le Tre Viste" in CLAUDE.md.
 */

'use strict';

const path = require('path');
const JSON5 = require('json5');
const loadJson5 = require('../../core/loadJson5');
const reader = require('./lib/sentinelDataReader');
const aggregator = require('./lib/aggregator');
const rulesFile = require('./lib/rulesFileManager');

const pluginName = path.basename(__dirname);

// Caricata a livello di modulo: serve già pronta in getObjectToShareToWebPages(),
// che pluginSys invoca PRIMA di loadPlugin().
const ownConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const custom = ownConfig.custom || {};

let myPluginSys = null;
let ownFolder = null;

/**
 * Riepiloghi già calcolati, indicizzati per `dataDir|giorni`.
 *
 * Ogni voce: `{ stamp, computedAt, payload, pending }`.
 *
 * La data dir entra nella chiave anche se a runtime è una sola: un riepilogo
 * indicizzato per soli giorni sarebbe corretto per coincidenza, e la coincidenza
 * smette di valere al primo `custom.dataPath` cambiato a caldo.
 *
 * ─── PERCHE UN TETTO SU UNA MAPPA DI QUATTRO VOCI ─────────────────────────────
 * Le finestre del menu a tendina sono quattro, ma `days` è un parametro di query
 * e vale da 1 a 365: chi chiama l'API direttamente può fabbricare una voce per
 * ogni valore. Nessuna è grande — contatori, due classifiche da venti e una riga
 * per giorno — ma «piccola per 365» è un ragionamento che si fa una volta e poi
 * si smette di rifare quando il contenuto cresce. Il tetto lo rende inutile: la
 * mappa resta una mappa di lavoro e non diventa un archivio.
 */
const summaryCache = new Map();

/** Finestre distinte tenute in cache. Le voci del menu sono quattro. */
const MAX_CACHED_WINDOWS = 8;

/** Età massima di un riepilogo quando i file SONO cambiati. 0 = mai in cache. */
let summaryCacheSeconds = Number.isFinite(custom.summaryCacheSeconds)
  ? custom.summaryCacheSeconds
  : 30;

// Il filtro delle richieste è configurazione sensibile: root (0) e admin (1).
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1],
};

/** Oggetto condiviso di sentinel (null se il service è assente o disattivato). */
function getSentinel() {
  return myPluginSys ? myPluginSys.getSharedObject('sentinel', pluginName) : null;
}

/**
 * Data dir del service, risolta dalla SUA configurazione.
 *
 * Si passa da `pluginSys.getPlugin()` invece di cablare il percorso, così un
 * `custom.dataPath` personalizzato continua a funzionare — è la stessa strada
 * che gli altri twin usano per leggere i file del proprio service.
 */
function sentinelDataDir() {
  const plugin = myPluginSys && myPluginSys.getPlugin('sentinel');
  const folder = plugin && plugin.pathPluginFolder;
  if (!folder) return null;
  try {
    const conf = loadJson5(path.join(folder, 'pluginConfig.json5')).custom || {};
    return path.resolve(folder, conf.dataPath || './data');
  } catch (_err) {
    return path.resolve(folder, 'data');
  }
}

/** Risposta comune quando il service non è disponibile. */
function serviceUnavailable(extra = {}) {
  return { enabled: false, ...extra };
}

/**
 * Il riepilogo di una finestra, ricalcolato solo quando serve davvero.
 *
 * ─── PERCHE UNA CACHE SU UNA DASHBOARD DI SICUREZZA ───────────────────────────
 * Il riepilogo si ricava da tutto il log della finestra, e la finestra arriva a
 * un anno perché è una voce del menu. Ricalcolarlo a ogni auto-aggiornamento
 * significa rileggere e riparsare centinaia di megabyte ogni quindici secondi,
 * per ogni scheda aperta, e ottenere quasi sempre lo stesso numero.
 *
 * La validità sta su due livelli, e il primo non è un compromesso:
 *
 *   1. TIMBRO IDENTICO — i file non sono cambiati, quindi la risposta in cache è
 *      *bit per bit* quella che il ricalcolo produrrebbe. Non è vecchia, è
 *      esatta: nessun limite di età avrebbe senso. Su un sito tranquillo è il
 *      caso normale, e l'auto-aggiornamento smette di costare.
 *   2. TIMBRO CAMBIATO ma calcolo recente — qui sì che si sta servendo qualcosa
 *      di un po' vecchio, e infatti la risposta porta `computedAt` e la pagina
 *      lo mostra. Su un sito attivo il log cambia ogni secondo: senza questo
 *      livello il primo caso non scatterebbe mai e si tornerebbe a ricalcolare
 *      sempre.
 *
 * Le richieste in volo si fondono: tre schede aperte fanno un ricalcolo, non
 * tre. È la stessa situazione che rendeva il difetto originale peggiore di
 * quanto sembrasse, e va chiusa qui e non nel browser.
 *
 * Resta un limite che questa cache non può togliere: il PRIMO calcolo della
 * finestra annuale su un log grosso costa comunque secondi di CPU (spezzettati,
 * vedi `forEachEventSince`). Toglierlo del tutto vuol dire non ricavare più il
 * riepilogo dagli eventi grezzi, cioè far scrivere al service un aggregato
 * giornaliero accanto agli altri censimenti — un intervento su `sentinel`, non
 * su questo plugin.
 *
 * @param {string} dataDir
 * @param {number} days
 * @returns {Promise<{ computedAt: number, payload: object }>}
 */
async function summaryForWindow(dataDir, days) {
  const stamp = reader.windowStamp(dataDir, days);
  const cacheKey = `${dataDir}|${days}`;

  let entry = summaryCache.get(cacheKey);
  if (!entry) {
    // Si sfratta la voce inserita per prima (le Map iterano in ordine di
    // inserimento), mai una con un calcolo in corso: buttarla via lascerebbe
    // orfane le richieste che la stanno aspettando e ne farebbe partire un'altra
    // identica, cioè il contrario di quello per cui la deduplica esiste.
    if (summaryCache.size >= MAX_CACHED_WINDOWS) {
      for (const [key, cached] of summaryCache) {
        if (!cached.pending) { summaryCache.delete(key); break; }
      }
    }
    entry = { stamp: null, computedAt: 0, payload: null, pending: null };
    summaryCache.set(cacheKey, entry);
  }

  if (entry.payload) {
    if (entry.stamp === stamp) return entry;
    const maxAgeMs = summaryCacheSeconds * 1000;
    if (maxAgeMs > 0 && Date.now() - entry.computedAt < maxAgeMs) return entry;
  }

  if (!entry.pending) {
    entry.pending = (async () => {
      const accumulator = aggregator.createSummaryAccumulator();
      const scan = await reader.forEachEventSince(dataDir, days, (event) => accumulator.add(event));
      const census = reader.readFingerprintCensus(dataDir);

      return {
        days,
        summary: accumulator.result(),
        // Il traffico che nessuna regola descrive: è lì che si scoprono le
        // regole mancanti, non fra quelle che già scattano.
        unclassified: aggregator.unclassifiedShare(census.fingerprints),
        evictions: census.evictions,
        scannedFiles: scan.scannedFiles,
      };
    })()
      .then((payload) => {
        entry.stamp = stamp;
        entry.computedAt = Date.now();
        entry.payload = payload;
        return entry;
      })
      .finally(() => { entry.pending = null; });
  }

  return entry.pending;
}

/** Svuota i riepiloghi in cache. Esportata per i test. */
function clearSummaryCache() {
  summaryCache.clear();
}

/**
 * Valida il testo dell'editor: prima la sintassi JSON5, poi le regole vere e
 * proprie con il validatore **del service**.
 *
 * Riusare quel validatore invece di riscriverne uno qui è la sola garanzia che
 * ciò che la GUI accetta e ciò che il motore accetta restino la stessa cosa: due
 * implementazioni divergerebbero al primo campo nuovo.
 *
 * @param {*} content
 * @param {object} sentinel - oggetto condiviso del service
 * @returns {{ ok: boolean, errors: string[], warnings: string[], ruleCount: number }}
 */
function validateText(content, sentinel) {
  if (typeof content !== 'string' || content.trim() === '') {
    return { ok: false, errors: ['contenuto vuoto'], warnings: [], ruleCount: 0 };
  }

  let parsed;
  try {
    parsed = JSON5.parse(content);
  } catch (err) {
    return { ok: false, errors: [`sintassi JSON5 non valida: ${err.message}`], warnings: [], ruleCount: 0 };
  }

  const result = sentinel.validateRules(parsed);
  return {
    ok: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    ruleCount: result.rules ? result.rules.length : 0,
  };
}

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    myPluginSys = pluginSys;
    ownFolder = pathPluginFolder;
    console.log(`[${pluginName}] Plugin caricato — GUI di lettura per il filtro sentinel`);
  },

  /**
   * I backup dell'editor raw vengono creati pigramente al primo salvataggio.
   * Dichiararli qui li fa sondare al boot: una cartella non scrivibile diventa
   * un box [STORAGE] azionabile invece di un errore al primo tentativo di
   * salvare, cioè nel momento peggiore.
   */
  getWritablePaths(pluginSys, pathPluginFolder) {
    return [{
      path: path.join(pathPluginFolder || __dirname, rulesFile.BACKUP_DIR_NAME),
      purpose: 'backups of sentinelRules.json5 before raw edits',
    }];
  },

  /** Parametri UI letti dalla config, esposti ai template. */
  getObjectToShareToWebPages() {
    return {
      autoRefreshSeconds: custom.autoRefreshSeconds || 15,
      eventLimit: custom.eventLimit || 100,
      windowDays: custom.windowDays || 7,
      scannerThreshold: custom.scannerThreshold || 20,
    };
  },

  getRouteArray() {
    return [

      // ── Stato vivo: cosa sta facendo il filtro adesso ──
      {
        method: 'GET',
        path: '/status',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel) {
            ctx.body = serviceUnavailable({ reason: 'sentinel non attivo o disabilitato' });
            return;
          }
          const stats = sentinel.getStats();
          ctx.body = {
            enabled: true,
            stats,
            // Distinguere le due cose è importante quanto per l'admin panel:
            // `mode: enforce` con il gate in `monitor` NON sta bloccando, e
            // mostrare solo il primo sarebbe una trappola diagnostica.
            effectivelyEnforcing: stats.mode === 'enforce' && stats.gateState === 'running',
            dataDir: sentinelDataDir(),
          };
        },
      },

      // ── Vista Dati: la composizione del traffico su una finestra ──
      {
        method: 'GET',
        path: '/summary',
        access: pluginAccess,
        handler: async (ctx) => {
          const dataDir = sentinelDataDir();
          if (!dataDir) {
            ctx.body = serviceUnavailable({ summary: null });
            return;
          }

          const requested = parseInt(ctx.query.days, 10);
          const days = Number.isFinite(requested) && requested > 0
            ? Math.min(requested, 365)
            : (custom.windowDays || 7);

          const entry = await summaryForWindow(dataDir, days);

          ctx.body = {
            enabled: true,
            ...entry.payload,
            // Quando i numeri sono stati calcolati. La pagina lo mostra: servire
            // un riepilogo di trenta secondi fa va benissimo, farlo credere
            // dell'istante no — è lo stesso motivo per cui la dashboard forza il
            // salvataggio degli archivi prima di leggerli.
            computedAt: new Date(entry.computedAt).toISOString(),
          };
        },
      },

      // ── Vista Dati: stato delle regole, con l'indicatore di promuovibilità ──
      {
        method: 'GET',
        path: '/rules',
        access: pluginAccess,
        handler: async (ctx) => {
          const dataDir = sentinelDataDir();
          const sentinel = getSentinel();
          if (!dataDir) {
            ctx.body = serviceUnavailable({ rules: [] });
            return;
          }
          const hits = reader.readRuleHits(dataDir);
          // Le definizioni complete, non i soli nomi: la GUI ha bisogno
          // dell'`action` in vigore per proporre il gesto giusto.
          let definitions = [];
          if (sentinel && typeof sentinel.getRules === 'function') definitions = sentinel.getRules();
          else if (sentinel && typeof sentinel.getRuleNames === 'function') definitions = sentinel.getRuleNames();
          ctx.body = { enabled: true, rules: aggregator.mergeRuleStatus(hits, definitions) };
        },
      },

      // ── Vista Dati: impronte censite ──
      {
        method: 'GET',
        path: '/fingerprints',
        access: pluginAccess,
        handler: async (ctx) => {
          const dataDir = sentinelDataDir();
          if (!dataDir) {
            ctx.body = serviceUnavailable({ fingerprints: [] });
            return;
          }
          const limit = Math.min(parseInt(ctx.query.limit, 10) || 50, 500);
          const census = reader.readFingerprintCensus(dataDir);
          ctx.body = {
            enabled: true,
            ipMode: census.ipMode,
            evictions: census.evictions,
            fingerprints: census.fingerprints.slice(0, limit),
          };
        },
      },

      // ── Vista Dati: sospetti scanner (dall'osservazione degli esiti) ──
      {
        method: 'GET',
        path: '/scanners',
        access: pluginAccess,
        handler: async (ctx) => {
          const dataDir = sentinelDataDir();
          if (!dataDir) {
            ctx.body = serviceUnavailable({ scanners: [] });
            return;
          }
          const threshold = parseInt(ctx.query.minPaths, 10) || custom.scannerThreshold || 20;
          const outcome = reader.readOutcomeCensus(dataDir);
          ctx.body = {
            enabled: true,
            threshold,
            evictions: outcome.evictions,
            scanners: aggregator.suspectedScanners(outcome.clients, threshold),
          };
        },
      },

      // ── Vista Dati: eventi recenti, con filtri ──
      {
        method: 'GET',
        path: '/events',
        access: pluginAccess,
        handler: async (ctx) => {
          const dataDir = sentinelDataDir();
          if (!dataDir) {
            ctx.body = serviceUnavailable({ events: [] });
            return;
          }
          const result = reader.readRecentEvents(dataDir, {
            limit: parseInt(ctx.query.limit, 10) || custom.eventLimit || 100,
            ruleName: ctx.query.ruleName ? String(ctx.query.ruleName) : undefined,
            category: ctx.query.category ? String(ctx.query.category) : undefined,
            ip: ctx.query.ip ? String(ctx.query.ip) : undefined,
            enforcedOnly: ctx.query.enforcedOnly === '1',
          });
          ctx.body = { enabled: true, ...result };
        },
      },

      // ─────────────────────────────────────────────────────────────────────
      // SCRITTURA — promozione, retrocessione, editor raw
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Le regole come stanno sul FILE, per popolare il form della Vista C.
       *
       * Diverso da `/rules`, che riporta ciò che il motore sta applicando con il
       * `match` già compilato: un form popolato da lì riscriverebbe `["php"]`
       * dove l'amministratore aveva scritto `"php"`.
       */
      {
        method: 'GET',
        path: '/rules/source',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.getRulesSource !== 'function') {
            ctx.body = serviceUnavailable({ rules: [] });
            return;
          }
          try {
            ctx.body = { enabled: true, rules: sentinel.getRulesSource() };
          } catch (err) {
            ctx.status = 500;
            ctx.body = { enabled: true, rules: [], error: err.message };
          }
        },
      },

      // ── Vista C: salvataggio di una singola regola dal form ──
      {
        method: 'POST',
        path: '/rules/fields',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.setRuleFields !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable({ error: 'sentinel non disponibile' });
            return;
          }

          const body = ctx.request.body || {};
          const ruleName = typeof body.ruleName === 'string' ? body.ruleName.trim() : '';
          const rule = body.rule;

          if (!ruleName || !rule || typeof rule !== 'object') {
            ctx.status = 400;
            ctx.body = { ok: false, error: 'ruleName e rule sono obbligatori' };
            return;
          }

          try {
            // La validazione la fa il SERVICE, con il validatore del motore:
            // riusarlo è la sola garanzia che ciò che la GUI accetta e ciò che
            // il filtro accetta restino la stessa cosa.
            const result = sentinel.setRuleFields(ruleName, rule);
            if (!result.valid) ctx.status = 400;
            ctx.body = { ok: result.valid, ...result, ruleName };
          } catch (err) {
            // La sostituzione verifica sé stessa prima di scrivere: se arriva
            // qui, il file non è stato toccato.
            ctx.status = 400;
            ctx.body = { ok: false, error: err.message };
          }
        },
      },

      /**
       * Promuove o retrocede una regola.
       *
       * La scrittura la fa il SERVICE, non questo plugin: lì stanno la
       * conoscenza del formato del file e l'obbligo di ricaricare dopo. Se la
       * facesse il twin, prima o poi qualcuno scriverebbe senza ricaricare e la
       * GUI direbbe "salvato" mentre il filtro continua col vecchio.
       */
      {
        method: 'POST',
        path: '/rules/action',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.setRuleAction !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable({ error: 'sentinel non disponibile' });
            return;
          }

          const body = ctx.request.body || {};
          const ruleName = typeof body.ruleName === 'string' ? body.ruleName.trim() : '';
          const action = typeof body.action === 'string' ? body.action.trim() : '';

          if (!ruleName || !action) {
            ctx.status = 400;
            ctx.body = { ok: false, error: 'ruleName e action sono obbligatori' };
            return;
          }

          try {
            const result = sentinel.setRuleAction(ruleName, action);
            ctx.body = { ok: true, ...result, ruleName, action };
          } catch (err) {
            // L'editor verifica la propria modifica prima di scrivere: se
            // arriva qui, il file non è stato toccato.
            ctx.status = 400;
            ctx.body = { ok: false, error: err.message };
          }
        },
      },

      /** Interruttore globale monitor ↔ enforce. */
      {
        method: 'POST',
        path: '/mode',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.setMode !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable({ error: 'sentinel non disponibile' });
            return;
          }
          const mode = ctx.request.body && ctx.request.body.mode;
          try {
            const result = await sentinel.setMode(mode);
            ctx.body = { ok: true, ...result, mode };
          } catch (err) {
            ctx.status = 400;
            ctx.body = { ok: false, error: err.message };
          }
        },
      },

      /**
       * Tester — prova una richiesta contro le regole in vigore.
       *
       * Non modifica nulla, ma resta dietro autenticazione come tutto il resto:
       * dire a un anonimo quali regole ci sono e come aggirarle sarebbe un
       * regalo notevole.
       */
      {
        method: 'POST',
        path: '/rules/test',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.testRequest !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable();
            return;
          }
          const spec = (ctx.request.body && ctx.request.body.spec) || {};
          if (typeof spec.path !== 'string' || spec.path === '') {
            ctx.status = 400;
            ctx.body = { ok: false, error: 'il path è obbligatorio' };
            return;
          }
          try {
            ctx.body = { ok: true, result: sentinel.testRequest(spec) };
          } catch (err) {
            ctx.status = 400;
            ctx.body = { ok: false, error: err.message };
          }
        },
      },

      /** Vista B — lettura del file di regole come testo. */
      {
        method: 'GET',
        path: '/rules/raw',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.getRulesFilePath !== 'function') {
            ctx.body = serviceUnavailable({ content: '' });
            return;
          }
          const result = rulesFile.readRaw(sentinel.getRulesFilePath());
          ctx.body = { enabled: true, ...result, backups: rulesFile.listBackups(ownFolder || __dirname) };
        },
      },

      /**
       * Vista B — validazione senza salvare.
       *
       * Separata dal salvataggio di proposito: si deve poter controllare una
       * regola prima di metterla in produzione, ed è anche il modo di capire un
       * errore senza doverlo prima provocare.
       */
      {
        method: 'POST',
        path: '/rules/validate',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.validateRules !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable();
            return;
          }
          ctx.body = validateText(ctx.request.body && ctx.request.body.content, sentinel);
        },
      },

      /** Vista B — salvataggio del testo, previa validazione e backup. */
      {
        method: 'POST',
        path: '/rules/save',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.getRulesFilePath !== 'function') {
            ctx.status = 503;
            ctx.body = serviceUnavailable();
            return;
          }

          const content = ctx.request.body && ctx.request.body.content;
          const check = validateText(content, sentinel);

          // Validazione LATO SERVER prima di ogni scrittura, con il validatore
          // del service: quella del browser è comodità, questa è la garanzia.
          if (!check.ok) {
            ctx.status = 400;
            ctx.body = { ...check, saved: false };
            return;
          }

          const filePath = sentinel.getRulesFilePath();
          const backup = rulesFile.createBackup(filePath, ownFolder || __dirname, custom.maxBackupsPerFile);
          const written = rulesFile.writeRaw(filePath, content);

          if (!written.ok) {
            ctx.status = 500;
            ctx.body = { ok: false, saved: false, error: written.error };
            return;
          }

          const ruleCount = sentinel.reloadRules();
          ctx.body = {
            ok: true,
            saved: true,
            ruleCount,
            warnings: check.warnings,
            backup: backup.file,
            backupError: backup.error,
          };
        },
      },

      // ── Forza il salvataggio degli archivi prima di leggerli ──
      // Il service tiene in memoria fino a un minuto di censimento: senza questo,
      // la dashboard mostrerebbe dati vecchi di un minuto senza dirlo.
      {
        method: 'POST',
        path: '/flush',
        access: pluginAccess,
        handler: async (ctx) => {
          const sentinel = getSentinel();
          if (!sentinel || typeof sentinel.flushNow !== 'function') {
            ctx.body = serviceUnavailable();
            return;
          }
          sentinel.flushNow();
          ctx.body = { enabled: true, ok: true };
        },
      },

    ];
  },
};

// Esportati per i test: la cache dei riepiloghi vive per tutta la durata del
// processo, e un test che non potesse azzerarla vedrebbe il risultato di quello
// prima. Stessa convenzione di `sentinel/main.js`.
module.exports._internals = {
  clearSummaryCache,
  summaryCacheSize: () => summaryCache.size,
  MAX_CACHED_WINDOWS,
  /**
   * Sostituisce l'età massima della cache; ritorna il valore precedente, che
   * chi chiama è tenuto a ripristinare. Stessa idea dello scambio temporaneo di
   * `custom` in `sentinel/main.js`.
   */
  setSummaryCacheSeconds: (value) => {
    const previous = summaryCacheSeconds;
    summaryCacheSeconds = value;
    return previous;
  },
};
