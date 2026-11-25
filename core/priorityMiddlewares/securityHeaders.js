/**
 * SECURITY HEADERS — gli header di sicurezza su OGNI risposta
 *
 * Prima di questo modulo i cinque header di sicurezza del progetto esistevano in
 * un solo posto: `runtimeGate.js`, cioè sulla pagina di manutenzione e sulle
 * risposte di rifiuto dei gate. Sito pubblico, pagine dei plugin, pannello admin
 * e API non ne avevano **nessuno** (REVIEW.md → A5).
 *
 * ─── IL CONTESTO SI DERIVA DALLE ZONE, NON DA UN ELENCO DI PREFISSI ──────────
 * La configurazione ha tre contesti — `wwwPath`, `pluginPages`, `admin` — e la
 * mappatura da path a contesto NON è un elenco di prefissi scritto a mano:
 *
 *   admin       ← ogni zona con `baseline.requiresAuth === true`
 *   pluginPages ← la zona `pluginPages`
 *   wwwPath     ← tutto il resto (sito, risorse del tema pubblico, api)
 *
 * È lo stesso criterio del `reservedGate`, e per la stessa ragione: un elenco di
 * prefissi a mano è il difetto A1 che aspetta di tornare. Con questa derivazione
 * la zona `views` — che dichiara `requiresAuth: true` — eredita gli header
 * dell'admin senza che nessuno debba ricordarselo, e una zona nuova fa lo stesso.
 *
 * ─── NON SOVRASCRIVE ─────────────────────────────────────────────────────────
 * Imposta solo gli header ASSENTI. Un plugin che sa cosa sta servendo — un
 * embed, un download, un'anteprima — può allentare la regola per la sua risposta
 * senza combattere col middleware. Il prezzo, dichiarato: un plugin può
 * indebolire la postura di sicurezza e nulla lo segnala.
 *
 * ─── IL LIMITE DA CONOSCERE: LE RISPOSTE DA ECCEZIONE ────────────────────────
 * Gli header sono impostati in un `finally`, quindi coprono anche le risposte di
 * errore «normali» (un 404 o un 403 prodotti assegnando lo status). NON coprono
 * le risposte generate da un'ECCEZIONE propagata: `ctx.onerror` di Koa rimuove
 * tutti gli header prima di scrivere la sua risposta, e non c'è modo di
 * impedirglielo da un middleware. È un limite del framework, non una scelta:
 * meglio dirlo che lasciar credere che la copertura sia totale.
 *
 * @module core/priorityMiddlewares/securityHeaders
 */

'use strict';

const { resolvePathZones, zoneForPath } = require('../pathZoneResolver');

/**
 * Valori di default, usati quando la chiave manca dal config.
 *
 * ⚠️ Devono coincidere con ciò che il `.default` spedisce, e non essere « il
 * valore neutro »: un'installazione che si **aggiorna** legge il config vivo
 * PRIMA che il merge additivo del boot gli aggiunga le chiavi nuove —
 * `priorityMiddleware()` gira a livello di modulo (`index.js:190`),
 * `reconcileSchemaVersions` dentro `startApp()`. Misurato con un vivo
 * pre-aggiornamento: l'area admin **non riceveva `X-Frame-Options`** fino al
 * secondo riavvio.
 *
 * Il default del codice è quindi quello **sicuro**, e il config serve a
 * rilassarlo — non ad accenderlo.
 */
const DEFAULTS = Object.freeze({
  nosniff: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  frameOptions: '',                 // '' = non emesso (sito pubblico)
  csp: Object.freeze({ enabled: false, policy: '' }),
});

/**
 * Default per contesto, dove il valore sicuro dipende dalla superficie.
 *
 * Solo `admin`: sul sito pubblico `X-Frame-Options` resta non emesso di
 * proposito — una pagina pubblica può legittimamente essere inquadrata.
 */
const DEFAULTS_PER_CONTESTO = Object.freeze({
  admin: Object.freeze({ frameOptions: 'DENY' }),
});

/** Nomi dei contesti configurabili. */
const CONTEXTS = Object.freeze(['wwwPath', 'pluginPages', 'admin']);

/**
 * A quale contesto appartiene una zona.
 *
 * @param {object|null} zone - Zona risolta da `zoneForPath`, o null
 * @returns {'wwwPath'|'pluginPages'|'admin'}
 */
function contextForZone(zone) {
  if (!zone) return 'wwwPath';
  if (zone.baseline && zone.baseline.requiresAuth === true) return 'admin';
  if (zone.name === 'pluginPages') return 'pluginPages';
  return 'wwwPath';
}

/** Fonde il config di un contesto con i default, una volta sola alla costruzione. */
function contextSettings(raw, contesto) {
  const conf = raw || {};
  const perContesto = DEFAULTS_PER_CONTESTO[contesto] || {};
  return Object.freeze({
    nosniff: conf.nosniff !== false,
    referrerPolicy: typeof conf.referrerPolicy === 'string'
      ? conf.referrerPolicy
      : DEFAULTS.referrerPolicy,
    frameOptions: typeof conf.frameOptions === 'string'
      ? conf.frameOptions
      : (perContesto.frameOptions !== undefined ? perContesto.frameOptions : DEFAULTS.frameOptions),
    csp: Object.freeze({
      enabled: conf.csp ? conf.csp.enabled === true : false,
      policy: conf.csp && typeof conf.csp.policy === 'string' ? conf.csp.policy : '',
    }),
  });
}

/**
 * Crea il middleware degli header di sicurezza.
 *
 * @param {object} args
 * @param {object} args.ital8Conf - Configurazione globale
 * @returns {{ middleware: Function, settingsFor: Function }}
 */
function createSecurityHeaders({ ital8Conf }) {
  const conf = ital8Conf.securityHeaders || {};
  const zoneMap = resolvePathZones(ital8Conf);

  const perContext = Object.freeze(Object.fromEntries(
    CONTEXTS.map((name) => [name, contextSettings(conf[name], name)])
  ));

  // HSTS non è per contesto, ed è una scelta: la direttiva vale per l'INTERA
  // connessione, non per un prefisso di URL. Tre interruttori darebbero due
  // chiavi inerti e una efficace, cioè una configurazione che insegna una cosa
  // falsa. Ed è emesso solo con HTTPS attivo: in HTTP puro renderebbe il sito
  // irraggiungibile al riavvio successivo.
  const hstsConf = conf.hsts || {};
  const hsts = Object.freeze({
    enabled: hstsConf.enabled !== false && ital8Conf.https?.enabled === true,
    maxAge: Number.isInteger(hstsConf.maxAge) && hstsConf.maxAge >= 0 ? hstsConf.maxAge : 86400,
  });

  /** Gli header che questo contesto vuole, come coppie [nome, valore]. */
  function headersFor(settings) {
    const out = [];
    if (settings.nosniff) out.push(['X-Content-Type-Options', 'nosniff']);
    if (settings.referrerPolicy) out.push(['Referrer-Policy', settings.referrerPolicy]);
    if (settings.frameOptions) out.push(['X-Frame-Options', settings.frameOptions]);
    if (settings.csp.enabled && settings.csp.policy) {
      out.push(['Content-Security-Policy', settings.csp.policy]);
    }
    if (hsts.enabled) {
      out.push(['Strict-Transport-Security', `max-age=${hsts.maxAge}`]);
    }
    return out;
  }

  const middleware = async (ctx, next) => {
    try {
      await next();
    } finally {
      const zone = zoneForPath(ctx.path || '', zoneMap.zones);
      const settings = perContext[contextForZone(zone)];

      for (const [name, value] of headersFor(settings)) {
        // Non sovrascrive: `ctx.response.get` ritorna '' se l'header non c'è.
        if (!ctx.response.get(name)) ctx.set(name, value);
      }
    }
  };

  return {
    middleware,
    /** Esposto per i test e per la diagnostica: quali header riceve un path. */
    settingsFor: (reqPath) => ({
      context: contextForZone(zoneForPath(reqPath || '', zoneMap.zones)),
      headers: headersFor(perContext[contextForZone(zoneForPath(reqPath || '', zoneMap.zones))]),
    }),
  };
}

module.exports = { createSecurityHeaders, contextForZone, CONTEXTS, DEFAULTS, DEFAULTS_PER_CONTESTO };
