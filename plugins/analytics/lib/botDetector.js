/**
 * botDetector.js
 *
 * Rilevamento bot e crawler automatici dal valore dell'header User-Agent.
 *
 * COMPORTAMENTO:
 *   I bot vengono SEMPRE tracciati (non filtrati), ma marcati con:
 *     isBot: true
 *     botName: "NomeBot" (es. "Googlebot", "SemrushBot", ...)
 *
 * Questo permette all'adminAnalytics di:
 *   - Visualizzare traffico umano vs bot separatamente
 *   - Identificare crawler SEO, monitoring e scraper
 *   - Evidenziare picchi di traffico bot anomali
 *
 * ORDINE DI MATCHING:
 *   Le firme specifiche (es. "Googlebot") vengono testate prima di quelle
 *   generiche (es. "bot", "crawler") per evitare falsi positivi.
 */

/**
 * Lista delle firme bot note, in ordine di specificità (dalla più specifica alla più generica).
 * Ogni entry: { pattern: RegExp, name: string }
 *
 * @type {Array<{ pattern: RegExp, name: string }>}
 */
const BOT_SIGNATURES = [
  // ── Search engines ──
  { pattern: /Googlebot/i,              name: 'Googlebot' },
  { pattern: /Googlebot-Image/i,        name: 'Googlebot Image' },
  { pattern: /Googlebot-Video/i,        name: 'Googlebot Video' },
  { pattern: /Googlebot-News/i,         name: 'Googlebot News' },
  { pattern: /Google-InspectionTool/i,  name: 'Google Inspection Tool' },
  { pattern: /Google-Read-Aloud/i,      name: 'Google Read Aloud' },
  { pattern: /Bingbot/i,                name: 'Bingbot' },
  { pattern: /msnbot/i,                 name: 'MSN Bot' },
  { pattern: /Slurp/i,                  name: 'Yahoo Slurp' },
  { pattern: /DuckDuckBot/i,            name: 'DuckDuckBot' },
  { pattern: /Baiduspider/i,            name: 'Baiduspider' },
  { pattern: /YandexBot/i,              name: 'YandexBot' },
  { pattern: /Sogou/i,                  name: 'Sogou Bot' },
  { pattern: /Exabot/i,                 name: 'Exabot' },
  { pattern: /facebot/i,                name: 'Facebook Bot' },
  { pattern: /ia_archiver/i,            name: 'Alexa Crawler' },
  { pattern: /Applebot/i,               name: 'Applebot' },

  // ── Social media preview ──
  { pattern: /facebookexternalhit/i,    name: 'Facebook Preview' },
  { pattern: /Twitterbot/i,             name: 'Twitterbot' },
  { pattern: /LinkedInBot/i,            name: 'LinkedInBot' },
  { pattern: /WhatsApp/i,               name: 'WhatsApp Preview' },
  { pattern: /TelegramBot/i,            name: 'Telegram Bot' },
  { pattern: /Slackbot/i,               name: 'Slackbot' },
  { pattern: /Discordbot/i,             name: 'Discordbot' },

  // ── SEO & audit tools ──
  { pattern: /SemrushBot/i,             name: 'SemrushBot' },
  { pattern: /AhrefsBot/i,              name: 'AhrefsBot' },
  { pattern: /MJ12bot/i,                name: 'Majestic Bot' },
  { pattern: /DotBot/i,                 name: 'DotBot' },
  { pattern: /rogerbot/i,               name: 'Moz Rogerbot' },
  { pattern: /SiteAuditBot/i,           name: 'SiteAuditBot' },
  { pattern: /SEMrush/i,                name: 'SEMrush' },
  { pattern: /Screaming Frog/i,         name: 'Screaming Frog' },
  { pattern: /seokicks/i,               name: 'SEO Kicks' },
  { pattern: /serpstatbot/i,            name: 'Serpstat Bot' },

  // ── Monitoring & uptime ──
  { pattern: /UptimeRobot/i,            name: 'UptimeRobot' },
  { pattern: /Pingdom/i,                name: 'Pingdom' },
  { pattern: /StatusCake/i,             name: 'StatusCake' },
  { pattern: /Site24x7/i,               name: 'Site24x7' },
  { pattern: /Better Uptime/i,          name: 'Better Uptime' },
  { pattern: /hetrixtools/i,            name: 'HetrixTools' },

  // ── Archive & indexing ──
  { pattern: /archive\.org_bot/i,       name: 'Internet Archive' },
  { pattern: /Wayback Machine/i,        name: 'Wayback Machine' },
  { pattern: /CCBot/i,                  name: 'Common Crawl' },

  // ── HTTP client tools (non-browser) ──
  { pattern: /^curl\//i,                name: 'curl' },
  { pattern: /^wget\//i,                name: 'wget' },
  { pattern: /^python-requests\//i,     name: 'Python requests' },
  { pattern: /^Go-http-client\//i,      name: 'Go HTTP client' },
  { pattern: /^Java\//i,                name: 'Java HTTP client' },
  { pattern: /^Apache-HttpClient/i,     name: 'Apache HttpClient' },
  { pattern: /libwww-perl/i,            name: 'libwww-perl' },
  { pattern: /^okhttp\//i,              name: 'OkHttp' },
  { pattern: /^axios\//i,               name: 'axios' },
  { pattern: /^node-fetch/i,            name: 'node-fetch' },

  // ── Generici (testati per ultimi per evitare falsi positivi) ──
  { pattern: /\bbot\b/i,                name: 'Generic bot' },
  { pattern: /\bcrawler\b/i,            name: 'Generic crawler' },
  { pattern: /\bspider\b/i,             name: 'Generic spider' },
  { pattern: /\bscraper\b/i,            name: 'Generic scraper' },
  { pattern: /\barchiver\b/i,           name: 'Generic archiver' },
];

/**
 * Verifica se il valore User-Agent appartiene a un bot noto.
 *
 * @param {string|undefined} userAgent - Valore dell'header User-Agent
 * @returns {{ isBot: boolean, botName: string|null }}
 *   isBot: true se riconosciuto come bot
 *   botName: nome leggibile del bot, o null se non è un bot
 */
function detectBot(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return { isBot: false, botName: null };
  }

  for (const sig of BOT_SIGNATURES) {
    if (sig.pattern.test(userAgent)) {
      return { isBot: true, botName: sig.name };
    }
  }

  return { isBot: false, botName: null };
}

module.exports = { detectBot, BOT_SIGNATURES };
