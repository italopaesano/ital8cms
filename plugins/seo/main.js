/**
 * SEO PLUGIN — main.js
 *
 * Plugin per la gestione SEO di ital8cms.
 * Inietta meta tags, Open Graph, Twitter Cards, canonical URL e structured data (JSON-LD)
 * nel <head> di tutte le pagine tramite il sistema di hook.
 * Genera sitemap.xml e robots.txt come file fisici nella directory wwwPath.
 *
 * CARATTERISTICHE:
 * - Ogni funzionalità disattivabile individualmente (enableMetaTags, enableOpenGraph, ecc.)
 * - Regole SEO per pagina con pattern matching (exact, wildcard, regex)
 * - Supporto multilingua senza dipendenza da simpleI18n (Strada B3)
 * - Sitemap auto-scan (solo wwwPath) + pagine extra manuali
 * - Diff prima di sovrascrivere file generati
 * - Endpoint API per rigenerazione on-demand
 * - Debug mode: rilegge seoPages.json5 ad ogni richiesta
 * - Pagine admin: inietta automaticamente robots noindex, nofollow
 *
 * DIPENDENZE: Nessuna (zero plugin dependency)
 * WEIGHT: 5 (dopo simpleI18n -10, prima di bootstrapNavbar 10)
 */

const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const PatternMatcher = require('../../core/patternMatcher');
const { generateMetaTags } = require('./lib/metaTagGenerator');
const { generateStructuredData } = require('./lib/structuredData');
const { generateSitemapXml, writeSitemapIfChanged } = require('./lib/sitemapGenerator');
const { generateRobotsTxt, writeRobotsTxtIfChanged } = require('./lib/robotsTxtGenerator');

const matcher = new PatternMatcher();

module.exports = {
  config: null,
  seoPages: null,
  seoPagesPath: null,
  pluginSys: null,
  pathPluginFolder: null,
  ital8Conf: null,
  wwwAbsolutePath: null,

  /**
   * Caricamento plugin: legge configurazione, genera file fisici.
   */
  async loadPlugin(pluginSys, pathPluginFolder) {
    this.pluginSys = pluginSys;
    this.pathPluginFolder = pathPluginFolder;

    // Carica configurazione plugin
    const pluginConfigPath = path.join(pathPluginFolder, 'pluginConfig.json5');
    this.config = loadJson5(pluginConfigPath).custom;

    // Carica regole SEO per pagina
    this.seoPagesPath = path.join(pathPluginFolder, 'seoPages.json5');
    this.seoPages = this._loadSeoPages();

    // Carica configurazione globale ital8cms (per indexFiles, hideExtension, wwwPath, debugMode)
    const ital8ConfPath = path.join(pathPluginFolder, '..', '..', 'ital8Config.json5');
    this.ital8Conf = loadJson5(ital8ConfPath);

    // Calcola path assoluto della directory wwwPath
    this.wwwAbsolutePath = path.join(pathPluginFolder, '..', '..', this.ital8Conf.wwwPath);

    // Validazione al boot (warning, non blocca il server)
    this._validateSeoPages();

    // Genera file fisici (sitemap.xml e robots.txt)
    this._generateFiles();

    console.log('[seo] Plugin loaded');
  },

  /**
   * Hook per iniettare contenuto nel <head> delle pagine.
   * Restituisce una Map come richiesto dal sistema hookPage di pluginSys.
   */
  getHooksPage() {
    const hookMap = new Map();

    hookMap.set('head', (passData) => {
      // In debug mode, rileggi seoPages.json5 ad ogni richiesta
      if (this.ital8Conf && this.ital8Conf.debugMode >= 1) {
        this.seoPages = this._loadSeoPages();
      }

      const ctx = passData.ctx;
      let tags = [];

      // ── CONTESTO ADMIN → noindex automatico ──
      if (passData.isAdminContext) {
        if (this.config.enableMetaTags) {
          tags.push('<meta name="robots" content="noindex, nofollow">');
        }
        return tags.join('\n    ');
      }

      // ── CONTESTO PUBBLICO → regole SEO complete ──
      // Trova la regola matchante per la pagina corrente
      const pageRule = this._findPageRule(ctx.path);

      // Genera meta tags (description, keywords, robots, OG, Twitter, canonical)
      const metaHtml = generateMetaTags(pageRule, passData, this.config);
      if (metaHtml) tags.push(metaHtml);

      // Genera structured data (JSON-LD)
      const structuredHtml = generateStructuredData(this.config);
      if (structuredHtml) tags.push(structuredHtml);

      return tags.join('\n    ');
    });

    return hookMap;
  },

  /**
   * Route API per rigenerazione on-demand.
   */
  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'post',
        path: '/regenerate',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1] // Solo root e admin
        },
        func: async (ctx) => {
          // Rileggi configurazione e regole
          const pluginConfigPath = path.join(this.pathPluginFolder, 'pluginConfig.json5');
          this.config = loadJson5(pluginConfigPath).custom;
          this.seoPages = this._loadSeoPages();

          // Rigenera file
          const report = this._generateFiles();

          ctx.body = report;
        }
      }
    ];
  },

  /**
   * Condivide API con altri plugin (es. futuro adminSeo).
   */
  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    return {
      getConfig: () => ({ ...this.config }),
      getSeoPages: () => ({ ...this.seoPages }),
      regenerate: () => this._generateFiles(),
      findPageRule: (urlPath) => this._findPageRule(urlPath),
    };
  },

  /**
   * Condivide funzioni con i template EJS (passData.plugin.seo.*).
   */
  getObjectToShareToWebPages() {
    return {
      getConfig: () => ({ ...this.config }),
    };
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // METODI PRIVATI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Carica seoPages.json5 con gestione errori.
   * @returns {object} - Regole SEO caricate, o oggetto vuoto se errore
   */
  _loadSeoPages() {
    try {
      return loadJson5(this.seoPagesPath);
    } catch (err) {
      console.warn(`[seo] Cannot load seoPages.json5: ${err.message}`);
      return {};
    }
  },

  /**
   * Trova la regola SEO matchante per un URL, usando PatternMatcher.
   * @param {string} urlPath - Path URL (es. "/about.ejs")
   * @returns {object|null} - Regola matchata o null
   */
  _findPageRule(urlPath) {
    if (!this.seoPages || Object.keys(this.seoPages).length === 0) return null;
    return matcher.findMatchingRule(urlPath, this.seoPages);
  },

  /**
   * Valida seoPages.json5 al boot (warning, non blocca il server).
   */
  _validateSeoPages() {
    if (!this.seoPages || typeof this.seoPages !== 'object') return;

    const validChangefreq = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

    for (const [pattern, rule] of Object.entries(this.seoPages)) {
      // Valida pattern
      const validation = matcher.validatePattern(pattern);
      if (!validation.valid) {
        console.warn(`[seo] seoPages.json5: invalid pattern "${pattern}": ${validation.error}`);
      }

      // Valida sitemap config se presente
      if (rule.sitemap && typeof rule.sitemap === 'object') {
        if (rule.sitemap.priority !== undefined) {
          if (typeof rule.sitemap.priority !== 'number' || rule.sitemap.priority < 0 || rule.sitemap.priority > 1) {
            console.warn(`[seo] seoPages.json5: "${pattern}" sitemap.priority must be between 0.0 and 1.0`);
          }
        }
        if (rule.sitemap.changefreq !== undefined) {
          if (!validChangefreq.includes(rule.sitemap.changefreq)) {
            console.warn(`[seo] seoPages.json5: "${pattern}" sitemap.changefreq invalid. Valid: ${validChangefreq.join(', ')}`);
          }
        }
      }
    }
  },

  /**
   * Genera sitemap.xml e robots.txt come file fisici.
   * @returns {object} - Report { sitemap: { changed, pages }, robotsTxt: { changed } }
   */
  _generateFiles() {
    const report = { sitemap: null, robotsTxt: null };

    // ── SITEMAP ──
    if (this.config.enableSitemap) {
      const indexFiles = this.ital8Conf?.indexFiles?.wwwPath || ['index.ejs'];
      const sitemapXml = generateSitemapXml({
        wwwAbsolutePath: this.wwwAbsolutePath,
        config: this.config,
        seoPages: this.seoPages || {},
        indexFiles: indexFiles,
      });
      const sitemapPath = path.join(this.wwwAbsolutePath, 'sitemap.xml');
      report.sitemap = writeSitemapIfChanged(sitemapPath, sitemapXml);
      if (report.sitemap.changed) {
        console.log(`[seo] sitemap.xml generated (${report.sitemap.pages} pages)`);
      } else {
        console.log(`[seo] sitemap.xml unchanged (${report.sitemap.pages} pages)`);
      }
    }

    // ── ROBOTS.TXT ──
    if (this.config.enableRobotsTxt) {
      const robotsTxt = generateRobotsTxt(this.config);
      const robotsPath = path.join(this.wwwAbsolutePath, 'robots.txt');
      report.robotsTxt = writeRobotsTxtIfChanged(robotsPath, robotsTxt);
      if (report.robotsTxt.changed) {
        console.log('[seo] robots.txt generated');
      } else {
        console.log('[seo] robots.txt unchanged');
      }
    }

    return report;
  },
};
