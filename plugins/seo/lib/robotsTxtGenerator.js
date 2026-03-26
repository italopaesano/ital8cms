/**
 * ROBOTS.TXT GENERATOR
 *
 * Genera il file robots.txt come file fisico nella directory wwwPath.
 * Aggiunge automaticamente il link alla sitemap se enableSitemap è true.
 *
 * @module plugins/seo/lib/robotsTxtGenerator
 */

const fs = require('fs');

/**
 * Genera il contenuto del file robots.txt.
 *
 * @param {object} config - Configurazione plugin (custom)
 * @returns {string} - Contenuto del file robots.txt
 */
function generateRobotsTxt(config) {
  const rules = config.robotsTxtRules || {};
  const lines = [];

  // User-agent
  const userAgent = rules.userAgent || '*';
  lines.push(`User-agent: ${userAgent}`);

  // Allow
  if (rules.allow && rules.allow.length > 0) {
    for (const path of rules.allow) {
      lines.push(`Allow: ${path}`);
    }
  }

  // Disallow
  if (rules.disallow && rules.disallow.length > 0) {
    for (const path of rules.disallow) {
      lines.push(`Disallow: ${path}`);
    }
  }

  // Sitemap link (aggiunto automaticamente se enableSitemap è true)
  if (config.enableSitemap && config.siteUrl) {
    const baseUrl = config.siteUrl.replace(/\/+$/, '');
    lines.push('');
    lines.push(`Sitemap: ${baseUrl}/sitemap.xml`);
  }

  lines.push(''); // Riga finale vuota
  return lines.join('\n');
}

/**
 * Scrive robots.txt su disco, solo se il contenuto è diverso da quello esistente.
 *
 * @param {string} outputPath - Path assoluto del file robots.txt
 * @param {string} content - Contenuto da scrivere
 * @returns {object} - { changed: boolean }
 */
function writeRobotsTxtIfChanged(outputPath, content) {
  // Leggi file esistente (se esiste)
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(outputPath, 'utf8');
  } catch (err) {
    // File non esiste → sarà creato
  }

  // Confronta contenuto
  if (existingContent === content) {
    return { changed: false };
  }

  // Scrivi il nuovo file (scrittura atomica: temp + rename)
  const tempPath = outputPath + '.tmp';
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, outputPath);

  return { changed: true };
}

module.exports = {
  generateRobotsTxt,
  writeRobotsTxtIfChanged,
};
