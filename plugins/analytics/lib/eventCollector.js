/**
 * eventCollector.js
 *
 * Costruisce l'oggetto evento analitico da una richiesta/risposta Koa.
 * Da chiamare DOPO await next() per avere statusCode e durationMs corretti.
 *
 * STRUTTURA EVENTO:
 * {
 *   timestamp:       string   — ISO 8601 UTC (es. "2026-04-13T10:30:00.000Z")
 *   path:            string   — Path URL (es. "/about" o "/about.ejs")
 *   method:          string   — Metodo HTTP (es. "GET", "POST")
 *   statusCode:      number   — Codice risposta HTTP (es. 200, 404, 500)
 *   durationMs:      number   — Durata richiesta in ms
 *   referrer:        string|null — Header Referer, o null se assente
 *   userAgent:       string|null — Header User-Agent, o null se assente
 *   isBot:           boolean  — true se riconosciuto come bot
 *   botName:         string|null — Nome del bot (es. "Googlebot"), o null
 *   ipArea:          string   — IP anonimizzato (2 ottetti IPv4 / 2 gruppi IPv6)
 *   sessionHash:     string|null — HMAC-SHA256 del session ID Koa, o null
 *   isAuthenticated: boolean  — true se l'utente ha una sessione autenticata
 *   isAdmin:         boolean  — true se la richiesta riguarda il pannello admin
 * }
 *
 * FILTRO PATH:
 *   Vengono tracciati solo i path corrispondenti a pagine reali:
 *   - Include: path .ejs espliciti
 *   - Include: path senza estensione (clean URL compatibili con hideExtension)
 *   - Esclude: path API (/${apiPrefix}/)
 *   - Esclude: risorse tema (/${publicThemeResourcesPrefix}/, /${adminThemeResourcesPrefix}/)
 *   - Esclude: file con estensioni statiche (.css, .js, .png, .jpg, .ico, ecc.)
 */

const { anonymizeIp, getHashedSessionId } = require('./privacyFilter');
const { detectBot } = require('./botDetector');

/**
 * Estensioni di file statici da escludere dal tracking.
 * Il path viene incluso solo se ha estensione .ejs o nessuna estensione.
 *
 * @type {Set<string>}
 */
const STATIC_EXTENSIONS = new Set([
  // Stili e script
  '.css', '.js', '.mjs', '.ts', '.map',
  // Immagini
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  // Font
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Media
  '.mp4', '.mp3', '.webm', '.ogg', '.wav', '.avi', '.mov',
  // Documenti
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  // Archivi
  '.zip', '.tar', '.gz', '.rar', '.7z',
  // Dati
  '.json', '.jsonl', '.xml', '.csv', '.txt', '.yaml', '.yml',
]);

/**
 * Determina se un path URL deve essere tracciato.
 *
 * Logica:
 *   1. Escludi i prefissi API e risorse statiche tema (da ital8Config)
 *   2. Escludi i file con estensioni non-.ejs
 *   3. Includi i file .ejs espliciti
 *   4. Includi i path senza estensione (potenziali clean URL)
 *
 * @param {string}   urlPath          — Path URL (es. "/about.ejs" o "/about")
 * @param {string[]} excludedPrefixes — Prefissi da escludere (calcolati da ital8Config)
 * @returns {boolean} true se il path deve essere tracciato
 */
function shouldTrack(urlPath, excludedPrefixes) {
  // 1. Escludi i prefissi noti (API, risorse tema)
  for (const prefix of excludedPrefixes) {
    if (urlPath.startsWith(prefix)) return false;
  }

  // 2. Estrai l'estensione dall'ultimo segmento del path
  const lastSegment = urlPath.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex === -1) {
    // Nessuna estensione → potenziale clean URL (hideExtension attivo) → includi
    return true;
  }

  const ext = lastSegment.slice(dotIndex).toLowerCase();

  // 3. .ejs esplicito → è una pagina → includi
  if (ext === '.ejs') return true;

  // 4. Estensione statica nota → risorsa non-pagina → escludi
  if (STATIC_EXTENSIONS.has(ext)) return false;

  // Estensione sconosciuta → includi per non perdere pagine con estensioni custom
  return true;
}

/**
 * Costruisce l'oggetto evento analytics da un contesto Koa completato.
 * Deve essere chiamato DOPO await next() per avere statusCode e duration corretti.
 *
 * @param {object}   ctx              — Contesto Koa (dopo next())
 * @param {number}   startTime        — Timestamp di inizio richiesta (Date.now())
 * @param {object}   pluginConfig     — Blocco custom da pluginConfig.json5
 * @param {string[]} excludedPrefixes — Prefissi URL da escludere (da ital8Config)
 * @param {string}   adminPrefix      — Prefisso admin (da ital8Config.adminPrefix)
 * @returns {object|null} Oggetto evento, o null se il path non deve essere tracciato
 */
function buildEvent(ctx, startTime, pluginConfig, excludedPrefixes, adminPrefix) {
  const urlPath = ctx.path;

  if (!shouldTrack(urlPath, excludedPrefixes)) return null;

  const durationMs = Date.now() - startTime;
  const userAgent = ctx.get('User-Agent') || null;
  const { isBot, botName } = detectBot(userAgent);

  // ── Anonimizzazione IP ──
  let ipArea;
  if (pluginConfig.gdprCompliance) {
    ipArea = anonymizeIp(ctx.ip);
  } else {
    ipArea = ctx.ip || 'unknown';
  }

  // ── Hash sessione ──
  // NOTA GDPR: useAnalyticsCookie: true richiede cookie banner (vedi privacyFilter.js)
  let sessionHash = null;
  const sessionSalt = pluginConfig.sessionSalt || 'cambia-questo-salt-in-produzione';
  if (pluginConfig.useAnalyticsCookie) {
    sessionHash = getHashedSessionId(
      ctx,
      pluginConfig.analyticsCookieName || 'ital8analytics',
      sessionSalt
    );
  } else {
    // Default GDPR-safe: usa session ID Koa esistente (nessun cookie extra)
    sessionHash = getHashedSessionId(ctx, 'koa:sess', sessionSalt);
  }

  // ── Contesto admin ──
  const adminPathPrefix = adminPrefix ? `/${adminPrefix}` : '/admin';
  const isAdmin = urlPath === adminPathPrefix
    || urlPath.startsWith(adminPathPrefix + '/');

  return {
    timestamp:       new Date().toISOString(),
    path:            urlPath,
    method:          ctx.method,
    statusCode:      ctx.status,
    durationMs,
    referrer:        ctx.get('Referer') || ctx.get('Referrer') || null,
    userAgent,
    isBot,
    botName,
    ipArea,
    sessionHash,
    isAuthenticated: !!(ctx.session && ctx.session.authenticated),
    isAdmin,
  };
}

module.exports = { buildEvent, shouldTrack, STATIC_EXTENSIONS };
