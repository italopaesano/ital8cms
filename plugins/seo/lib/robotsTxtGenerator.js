/**
 * ROBOTS.TXT GENERATOR
 *
 * Genera il file robots.txt come file fisico nella directory wwwPath.
 * Aggiunge automaticamente il link alla sitemap se enableSitemap è true.
 *
 * @module plugins/seo/lib/robotsTxtGenerator
 */

const fs = require('fs');

const { resolvePatternList } = require('../../../core/pathZoneResolver');

/**
 * Porta i percorsi di `allow`/`disallow` dallo spazio LOGICO a quello SERVITO.
 *
 * ─── PERCHE ROBOTS.TXT E DIVERSO DA UN PATTERN DI CONFRONTO ───────────────────
 * Gli altri consumatori di segnaposti CONFRONTANO un percorso con la richiesta in
 * arrivo, e lo fanno dopo aver tolto il `globalPrefix` dal path: per loro lo
 * spazio logico è quello giusto. robots.txt invece EMETTE un URL verso l'esterno,
 * e i crawler lo leggono sul sito reale: `Disallow: /admin/` su un'istanza
 * montata sotto `/mysite` non protegge niente, perché il percorso vero è
 * `/mysite/admin/`. Qui il `globalPrefix` va ANTEPOSTO, non tolto.
 *
 * Era un difetto preesistente e indipendente dai segnaposti — `seo` non
 * menzionava `globalPrefix` da nessuna parte — ed è stato corretto insieme alla
 * conversione perché convertire senza correggere avrebbe scritto in robots.txt
 * una protezione non in vigore: la forma di A1, di nuovo.
 *
 * @param {string[]} declared - i percorsi come scritti nel config
 * @param {object|null} zoneMap - risultato di `resolvePathZones`, o null
 * @param {string} globalPrefix - il prefisso di deploy, '' se assente
 * @returns {{paths: string[], problems: object[]}}
 */
function toServedPaths(declared, zoneMap, globalPrefix) {
  if (!Array.isArray(declared) || declared.length === 0) {
    return { paths: [], problems: [] };
  }
  // Senza mappa delle zone i LETTERALI passano, i segnaposti NO.
  //
  // Un `{{admin}}/` emesso letterale in robots.txt sarebbe una riga visibile in un
  // file pubblicato, che non esclude niente e annuncia un errore di configurazione
  // a chiunque lo apra — e robots.txt lo apre chiunque. Quindi si scarta e si
  // dichiara, com'è la regola del resolver: un segnaposto non risolto non diventa
  // mai un letterale (D2). Questo ramo esiste per i chiamanti che non passano
  // `options` (la firma resta retrocompatibile); in produzione il chiamante la
  // passa, e questo è il paracadute perché nessuno possa aggirarla per distrazione.
  if (!zoneMap) {
    const problems = [];
    const paths = [];
    for (const declaredPath of declared) {
      if (typeof declaredPath === 'string' && declaredPath.includes('{{')) {
        problems.push({ pattern: declaredPath, kind: 'unresolved-without-zonemap' });
        continue;
      }
      paths.push(`${globalPrefix}${declaredPath}`);
    }
    return { paths, problems };
  }

  const outcome = resolvePatternList(declared, zoneMap);
  return {
    paths: outcome.patterns.map((p) => `${globalPrefix}${p}`),
    problems: outcome.problems,
  };
}

/**
 * Genera il contenuto del file robots.txt.
 *
 * @param {object} config - Configurazione plugin (custom)
 * @param {object} [options] - `zoneMap` (da resolvePathZones) e `globalPrefix`.
 *   Omessi, i percorsi vengono emessi come scritti: retrocompatibile per i
 *   chiamanti esistenti, incluso il twin admin.
 * @returns {string} - Contenuto del file robots.txt
 */
function generateRobotsTxt(config, options = {}) {
  const rules = config.robotsTxtRules || {};
  const zoneMap = options.zoneMap || null;
  const globalPrefix = options.globalPrefix || '';
  const lines = [];

  // User-agent
  const userAgent = rules.userAgent || '*';
  lines.push(`User-agent: ${userAgent}`);

  // Allow / Disallow: segnaposti risolti e globalPrefix anteposto (vedi toServedPaths).
  const allow = toServedPaths(rules.allow, zoneMap, globalPrefix);
  for (const servedPath of allow.paths) lines.push(`Allow: ${servedPath}`);

  const disallow = toServedPaths(rules.disallow, zoneMap, globalPrefix);
  for (const servedPath of disallow.paths) lines.push(`Disallow: ${servedPath}`);

  // Un percorso scartato è una riga in MENO in robots.txt, cioè un'area che si
  // credeva esclusa dai crawler e non lo è: va detto, non lasciato dedurre.
  for (const problem of [...allow.problems, ...disallow.problems]) {
    console.error(`[seo] robots.txt: percorso SCARTATO "${problem.pattern}" `
      + `(${problem.kind}) — quell'area NON sarà esclusa dai crawler`);
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
  toServedPaths,
};
