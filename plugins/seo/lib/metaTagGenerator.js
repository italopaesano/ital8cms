/**
 * META TAG GENERATOR
 *
 * Genera il markup HTML per meta tags SEO, Open Graph, Twitter Cards e canonical URL.
 * Supporta valori multilingua (Strada B3: indipendente da simpleI18n).
 *
 * @module plugins/seo/lib/metaTagGenerator
 */

/**
 * Risolve un valore SEO che può essere stringa semplice o oggetto multilingua.
 *
 * Cascata di risoluzione per oggetti multilingua:
 * 1. ctx.state.lang (impostato da simpleI18n, se attivo)
 * 2. Prima lingua disponibile nell'oggetto (fallback universale)
 *
 * @param {string|object} value - Stringa semplice o oggetto { lang: string }
 * @param {object} ctx - Koa context (può contenere ctx.state.lang se simpleI18n è attivo)
 * @returns {string} - Valore risolto
 */
function resolveValue(value, ctx) {
  // Stringa semplice → restituisci così com'è
  if (typeof value === 'string') return value;

  // Non è un oggetto valido → stringa vuota
  if (typeof value !== 'object' || value === null) return '';

  // Oggetto multilingua → cerca lingua corrente (impostata da simpleI18n se attivo)
  const lang = ctx?.state?.lang;
  if (lang && value[lang]) return value[lang];

  // Fallback → prima lingua disponibile nell'oggetto
  const values = Object.values(value);
  return values.length > 0 ? values[0] : '';
}

/**
 * Escapa caratteri HTML per attributi sicuri.
 * @param {string} str - Stringa da escapare
 * @returns {string}
 */
function escapeAttr(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Genera il canonical URL dalla richiesta corrente.
 *
 * @param {object} passData - passData dal template
 * @param {object} config - Configurazione plugin (custom)
 * @returns {string} - URL canonical completo
 */
function buildCanonicalUrl(passData, config) {
  const ctx = passData.ctx;

  // Base URL dal config, oppure dall'host della richiesta
  let baseUrl = config.siteUrl;
  if (!baseUrl) {
    baseUrl = `${ctx.protocol}://${ctx.host}`;
  }
  // Rimuovi trailing slash dal baseUrl
  baseUrl = baseUrl.replace(/\/+$/, '');

  // Pathname senza query string
  let pathname = ctx.path;

  // Se canonicalCleanUrl è attivo, rimuovi l'estensione .ejs
  if (config.canonicalCleanUrl) {
    pathname = pathname.replace(/\.ejs$/i, '');
  }

  return baseUrl + pathname;
}

/**
 * Genera il blocco HTML dei meta tags per il <head>.
 *
 * @param {object} pageRule - Regola SEO matchata per la pagina corrente (può essere null)
 * @param {object} passData - passData dal template
 * @param {object} config - Configurazione plugin (custom)
 * @returns {string} - Markup HTML
 */
function generateMetaTags(pageRule, passData, config) {
  const ctx = passData.ctx;
  const tags = [];

  // ── META TAGS BASE ──
  if (config.enableMetaTags) {
    const description = pageRule?.description
      ? resolveValue(pageRule.description, ctx)
      : config.defaultDescription;
    const keywords = pageRule?.keywords
      ? resolveValue(pageRule.keywords, ctx)
      : config.defaultKeywords;
    const robots = pageRule?.robots || config.defaultRobots;

    if (description) {
      tags.push(`<meta name="description" content="${escapeAttr(description)}">`);
    }
    if (keywords) {
      tags.push(`<meta name="keywords" content="${escapeAttr(keywords)}">`);
    }
    if (robots) {
      tags.push(`<meta name="robots" content="${escapeAttr(robots)}">`);
    }
  }

  // ── CANONICAL URL ──
  if (config.enableCanonicalUrl) {
    const canonical = buildCanonicalUrl(passData, config);
    tags.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
  }

  // ── OPEN GRAPH ──
  if (config.enableOpenGraph) {
    const ogTitle = pageRule?.title
      ? resolveValue(pageRule.title, ctx)
      : (config.siteName || '');
    const ogDescription = pageRule?.description
      ? resolveValue(pageRule.description, ctx)
      : config.defaultDescription;
    const ogType = pageRule?.ogType || config.defaultOgType;
    const ogImage = pageRule?.ogImage || config.defaultOgImage;
    const ogUrl = buildCanonicalUrl(passData, config);

    if (ogTitle) {
      tags.push(`<meta property="og:title" content="${escapeAttr(ogTitle)}">`);
    }
    if (ogDescription) {
      tags.push(`<meta property="og:description" content="${escapeAttr(ogDescription)}">`);
    }
    if (ogType) {
      tags.push(`<meta property="og:type" content="${escapeAttr(ogType)}">`);
    }
    tags.push(`<meta property="og:url" content="${escapeAttr(ogUrl)}">`);
    if (ogImage) {
      // Se l'immagine è un path relativo, costruisci URL assoluto
      const imageUrl = ogImage.startsWith('http') ? ogImage : (config.siteUrl || '') + ogImage;
      tags.push(`<meta property="og:image" content="${escapeAttr(imageUrl)}">`);
    }
    if (config.siteName) {
      tags.push(`<meta property="og:site_name" content="${escapeAttr(config.siteName)}">`);
    }
  }

  // ── TWITTER CARDS ──
  if (config.enableTwitterCards) {
    const twitterTitle = pageRule?.title
      ? resolveValue(pageRule.title, ctx)
      : (config.siteName || '');
    const twitterDescription = pageRule?.description
      ? resolveValue(pageRule.description, ctx)
      : config.defaultDescription;
    const twitterCardType = pageRule?.twitterCardType || config.twitterCardType;
    const twitterImage = pageRule?.ogImage || config.defaultOgImage;

    if (twitterCardType) {
      tags.push(`<meta name="twitter:card" content="${escapeAttr(twitterCardType)}">`);
    }
    if (twitterTitle) {
      tags.push(`<meta name="twitter:title" content="${escapeAttr(twitterTitle)}">`);
    }
    if (twitterDescription) {
      tags.push(`<meta name="twitter:description" content="${escapeAttr(twitterDescription)}">`);
    }
    if (twitterImage) {
      const imageUrl = twitterImage.startsWith('http') ? twitterImage : (config.siteUrl || '') + twitterImage;
      tags.push(`<meta name="twitter:image" content="${escapeAttr(imageUrl)}">`);
    }
    if (config.twitterHandle) {
      tags.push(`<meta name="twitter:site" content="${escapeAttr(config.twitterHandle)}">`);
    }
  }

  return tags.join('\n    ');
}

module.exports = {
  resolveValue,
  escapeAttr,
  buildCanonicalUrl,
  generateMetaTags,
};
