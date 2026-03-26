/**
 * SITEMAP GENERATOR
 *
 * Genera il file sitemap.xml come file fisico nella directory wwwPath.
 * Supporta auto-scan della directory wwwPath + pagine extra manuali.
 *
 * Caratteristiche:
 * - Auto-scan: scansiona ricorsivamente wwwPath per file .ejs
 * - Esclusione pattern: wildcard e regex (via PatternMatcher)
 * - Pagine extra: aggiunte manualmente in pluginConfig.json5
 * - Override per pagina: priority e changefreq da seoPages.json5
 * - Diff prima di sovrascrivere: non tocca il file se identico
 * - Index files: mappati alla directory (es. index.ejs → /)
 * - Clean URL: rimuove estensione .ejs se canonicalCleanUrl è true
 *
 * @module plugins/seo/lib/sitemapGenerator
 */

const fs = require('fs');
const path = require('path');
const PatternMatcher = require('../../../core/patternMatcher');

const matcher = new PatternMatcher();

/**
 * Scansiona ricorsivamente una directory per file .ejs.
 *
 * @param {string} dirPath - Path assoluto della directory
 * @param {string} basePath - Path base per calcolare percorsi relativi
 * @returns {string[]} - Array di path relativi (es. ["/about.ejs", "/contact.ejs"])
 */
function scanDirectory(dirPath, basePath) {
  const results = [];

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`[seo] Cannot read directory: ${dirPath}`, err.message);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Ricorsione nelle sottodirectory
      results.push(...scanDirectory(fullPath, basePath));
    } else if (entry.isFile() && entry.name.endsWith('.ejs')) {
      // Calcola path relativo con / iniziale
      const relativePath = '/' + path.relative(basePath, fullPath).replace(/\\/g, '/');
      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Verifica se un path relativo corrisponde a un file index.
 *
 * @param {string} relativePath - Path relativo (es. "/navbarExamples/index.ejs")
 * @param {string[]} indexFiles - Array nomi file index (es. ["index.ejs"])
 * @returns {boolean}
 */
function isIndexFile(relativePath, indexFiles) {
  const fileName = path.basename(relativePath);
  return indexFiles.includes(fileName);
}

/**
 * Converte un path relativo del filesystem in un URL per la sitemap.
 *
 * @param {string} relativePath - Path relativo (es. "/about.ejs")
 * @param {string[]} indexFiles - Array nomi file index
 * @param {boolean} cleanUrl - Se true, rimuove estensione .ejs
 * @returns {string} - URL per la sitemap (es. "/about")
 */
function pathToUrl(relativePath, indexFiles, cleanUrl) {
  let url = relativePath;

  // Se è un file index, mappa alla directory
  if (isIndexFile(relativePath, indexFiles)) {
    url = path.dirname(relativePath).replace(/\\/g, '/');
    // Assicurati che finisca con /
    if (!url.endsWith('/')) url += '/';
    return url;
  }

  // Se clean URL, rimuovi estensione .ejs
  if (cleanUrl) {
    url = url.replace(/\.ejs$/i, '');
  }

  return url;
}

/**
 * Verifica se un path deve essere escluso dalla sitemap.
 *
 * @param {string} relativePath - Path relativo (es. "/test_bootstrap.ejs")
 * @param {string[]} excludePatterns - Array di pattern di esclusione
 * @returns {boolean} - true se deve essere escluso
 */
function isExcluded(relativePath, excludePatterns) {
  for (const pattern of excludePatterns) {
    if (matcher.matches(relativePath, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Genera il contenuto XML della sitemap.
 *
 * @param {object} options - Opzioni di generazione
 * @param {string} options.wwwAbsolutePath - Path assoluto alla directory wwwPath
 * @param {object} options.config - Configurazione plugin (custom)
 * @param {object} options.seoPages - Regole SEO per pagina (da seoPages.json5)
 * @param {string[]} options.indexFiles - Array nomi file index
 * @returns {string} - Contenuto XML della sitemap
 */
function generateSitemapXml(options) {
  const { wwwAbsolutePath, config, seoPages, indexFiles } = options;

  const urls = [];

  // ── AUTO-SCAN wwwPath ──
  if (config.sitemapAutoScan) {
    const ejsFiles = scanDirectory(wwwAbsolutePath, wwwAbsolutePath);
    const excludePatterns = config.sitemapExclude || [];

    for (const filePath of ejsFiles) {
      // Escludi file che matchano pattern di esclusione
      if (isExcluded(filePath, excludePatterns)) continue;

      // Escludi file non-HTML (sitemap.xml, robots.txt non sono .ejs, ma precauzione)
      const url = pathToUrl(filePath, indexFiles, config.canonicalCleanUrl);

      // Cerca override in seoPages.json5
      const pageRule = matcher.findMatchingRule(filePath, seoPages);

      // Se la regola dice sitemap: false, escludi
      if (pageRule && pageRule.sitemap === false) continue;

      const sitemapConfig = (pageRule && typeof pageRule.sitemap === 'object') ? pageRule.sitemap : {};
      const changefreq = sitemapConfig.changefreq || config.sitemapDefaultChangefreq;
      const priority = sitemapConfig.priority !== undefined ? sitemapConfig.priority : config.sitemapDefaultPriority;

      urls.push({ url, changefreq, priority });
    }
  }

  // ── PAGINE EXTRA MANUALI ──
  if (config.sitemapExtraPages && config.sitemapExtraPages.length > 0) {
    for (const extra of config.sitemapExtraPages) {
      if (!extra.url) {
        console.warn('[seo] sitemapExtraPages: entry without "url" field, skipping');
        continue;
      }
      urls.push({
        url: extra.url,
        changefreq: extra.changefreq || config.sitemapDefaultChangefreq,
        priority: extra.priority !== undefined ? extra.priority : config.sitemapDefaultPriority,
      });
    }
  }

  // ── GENERA XML ──
  const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const entry of urls) {
    const loc = baseUrl + entry.url;
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(loc)}</loc>\n`;
    if (entry.changefreq) {
      xml += `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>\n`;
    }
    if (entry.priority !== undefined) {
      xml += `    <priority>${entry.priority}</priority>\n`;
    }
    xml += '  </url>\n';
  }

  xml += '</urlset>\n';
  return xml;
}

/**
 * Scrive la sitemap su disco, solo se il contenuto è diverso da quello esistente.
 *
 * @param {string} outputPath - Path assoluto del file sitemap.xml
 * @param {string} xmlContent - Contenuto XML da scrivere
 * @returns {object} - { changed: boolean, pages: number }
 */
function writeSitemapIfChanged(outputPath, xmlContent) {
  const pageCount = (xmlContent.match(/<url>/g) || []).length;

  // Leggi file esistente (se esiste)
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(outputPath, 'utf8');
  } catch (err) {
    // File non esiste → sarà creato
  }

  // Confronta contenuto
  if (existingContent === xmlContent) {
    return { changed: false, pages: pageCount };
  }

  // Scrivi il nuovo file (scrittura atomica: temp + rename)
  const tempPath = outputPath + '.tmp';
  fs.writeFileSync(tempPath, xmlContent, 'utf8');
  fs.renameSync(tempPath, outputPath);

  return { changed: true, pages: pageCount };
}

/**
 * Escapa caratteri speciali XML.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  scanDirectory,
  isIndexFile,
  pathToUrl,
  isExcluded,
  generateSitemapXml,
  writeSitemapIfChanged,
  escapeXml,
};
