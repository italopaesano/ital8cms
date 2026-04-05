/**
 * PAGE RULES ENGINE
 *
 * Pure logic functions extracted from the pageRules.ejs inline script
 * for unit testing. These functions handle:
 *
 * - Pattern type classification (exact, wildcard, regex)
 * - JSON5 snippet generation for the editor toolbar
 * - Form builder ↔ rules object conversion
 * - Data display helpers (title/description extraction, sitemap badge)
 *
 * DOM-dependent rendering functions remain in pageRules.ejs — only
 * pure data transformations are extracted here.
 *
 * @module plugins/adminSeo/lib/pageRulesEngine
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SNIPPETS = {
  exact: `  "/page.ejs": {
    "title": "Page Title",
    "description": "Page description for search engines",
    "sitemap": { "priority": 0.8, "changefreq": "monthly" }
  },`,
  wildcard: `  "/blog/*.ejs": {
    "description": "Blog post",
    "ogType": "article",
    "sitemap": { "priority": 0.6, "changefreq": "weekly" }
  },`,
  recursive: `  "/docs/**": {
    "description": "Documentation section",
    "sitemap": { "priority": 0.5, "changefreq": "monthly" }
  },`,
  regex: `  "regex:^/product/\\\\d+$": {
    "ogType": "article",
    "sitemap": { "priority": 0.7, "changefreq": "weekly" }
  },`,
  multilingual: `  "/": {
    "title": { "it": "Titolo Pagina", "en": "Page Title" },
    "description": { "it": "Descrizione per i motori di ricerca", "en": "Description for search engines" },
    "sitemap": { "priority": 1.0, "changefreq": "daily" }
  },`,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATTERN TYPE DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Determines the pattern type and associated badge styling.
 *
 * @param {string} pattern - URL pattern to classify
 * @returns {{ label: string, color: string }} Bootstrap badge info
 */
function getPatternType(pattern) {
  if (pattern.startsWith('regex:')) return { label: 'regex', color: 'info' };
  if (pattern.includes('**')) return { label: '**', color: 'warning' };
  if (pattern.includes('*')) return { label: '*', color: 'secondary' };
  return { label: 'exact', color: 'primary' };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNIPPET INSERTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Computes the new textarea value after inserting a snippet.
 * Finds the last closing brace and inserts the snippet before it,
 * adding a comma if needed.
 *
 * @param {string} currentValue - Current textarea content
 * @param {string} snippetType - One of: 'exact', 'wildcard', 'recursive', 'regex', 'multilingual'
 * @returns {string|null} New textarea value, or null if snippetType is invalid
 */
function insertSnippetIntoText(currentValue, snippetType) {
  const snippet = SNIPPETS[snippetType];
  if (!snippet) return null;

  const lastBrace = currentValue.lastIndexOf('}');
  if (lastBrace === -1) {
    return '{\n' + snippet + '\n}';
  }

  const beforeBrace = currentValue.substring(0, lastBrace).trimEnd();
  const needsComma = beforeBrace.length > 1 && !beforeBrace.endsWith(',') && !beforeBrace.endsWith('{');
  const insertion = (needsComma ? ',' : '') + '\n' + snippet;
  return currentValue.substring(0, lastBrace) + insertion + '\n' + currentValue.substring(lastBrace);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA DISPLAY HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extracts a display string from a value that can be a string or multilingual object.
 * Returns the first available translation for objects, or '—' for missing/invalid values.
 *
 * @param {string|object|undefined} value - The field value
 * @returns {string} Display string
 */
function extractDisplayValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const vals = Object.values(value);
    return vals.length > 0 ? String(vals[0]) : '—';
  }
  return '—';
}

/**
 * Produces a sitemap badge description from a rule's sitemap field.
 *
 * @param {boolean|object|undefined} sitemap - The sitemap field of a rule
 * @returns {{ type: string, text: string }} type is 'excluded', 'custom', or 'default'
 */
function getSitemapBadge(sitemap) {
  if (sitemap === false) {
    return { type: 'excluded', text: 'excluded' };
  }
  if (sitemap && typeof sitemap === 'object') {
    const parts = [];
    if (sitemap.priority !== undefined) parts.push(`p:${sitemap.priority}`);
    if (sitemap.changefreq) parts.push(sitemap.changefreq);
    return { type: 'custom', text: parts.join(' ') || 'custom' };
  }
  return { type: 'default', text: '—' };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORM ↔ RULES CONVERSION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Converts form field values (flat key-value map from one form card) into
 * a rule object suitable for seoPages.json5.
 *
 * Empty strings are omitted from the result. Sitemap handling:
 * - 'exclude' → sitemap: false
 * - 'custom' → sitemap: { priority?, changefreq? }
 * - 'default' → sitemap field omitted
 *
 * @param {object} fields - Flat object with form field values
 * @param {string} fields.pattern - URL pattern
 * @param {string} fields.title - Page title
 * @param {string} fields.description - Page description
 * @param {string} fields.keywords - Page keywords
 * @param {string} fields.robots - Robots directive
 * @param {string} fields.ogType - OpenGraph type
 * @param {string} fields.ogImage - OpenGraph image URL
 * @param {string} fields.twitterCardType - Twitter card type
 * @param {string} fields.sitemapToggle - 'default' | 'custom' | 'exclude'
 * @param {string} fields.sitemapPriority - Priority as string (may be NaN after parseFloat)
 * @param {string} fields.sitemapChangefreq - Changefreq value
 * @returns {{ pattern: string, rule: object }|null} null if pattern is empty
 */
function formFieldsToRule(fields) {
  const pattern = (fields.pattern || '').trim();
  if (!pattern) return null;

  const rule = {};
  if (fields.title && fields.title.trim()) rule.title = fields.title.trim();
  if (fields.description && fields.description.trim()) rule.description = fields.description.trim();
  if (fields.keywords && fields.keywords.trim()) rule.keywords = fields.keywords.trim();
  if (fields.robots && fields.robots.trim()) rule.robots = fields.robots.trim();
  if (fields.ogType) rule.ogType = fields.ogType;
  if (fields.ogImage && fields.ogImage.trim()) rule.ogImage = fields.ogImage.trim();
  if (fields.twitterCardType) rule.twitterCardType = fields.twitterCardType;

  if (fields.sitemapToggle === 'exclude') {
    rule.sitemap = false;
  } else if (fields.sitemapToggle === 'custom') {
    rule.sitemap = {};
    const priority = parseFloat(fields.sitemapPriority);
    if (!isNaN(priority)) rule.sitemap.priority = priority;
    if (fields.sitemapChangefreq) rule.sitemap.changefreq = fields.sitemapChangefreq;
  }

  return { pattern, rule };
}

/**
 * Converts a rules object (from seoPages.json5) into an array of flat form field
 * objects suitable for populating form cards.
 *
 * @param {object} rules - The seoPages rules object (pattern → rule)
 * @returns {Array<object>} Array of flat field objects
 */
function rulesToFormFields(rules) {
  if (!rules || typeof rules !== 'object') return [];

  return Object.entries(rules).map(([pattern, rule]) => {
    const fields = {
      pattern,
      title: typeof rule.title === 'string' ? rule.title : '',
      description: typeof rule.description === 'string' ? rule.description : '',
      keywords: typeof rule.keywords === 'string' ? rule.keywords : '',
      robots: rule.robots || '',
      ogType: rule.ogType || '',
      ogImage: rule.ogImage || '',
      twitterCardType: rule.twitterCardType || '',
      sitemapToggle: 'default',
      sitemapPriority: '',
      sitemapChangefreq: '',
      // Flags for multilingual fields
      isTitleMultilingual: typeof rule.title === 'object' && rule.title !== null,
      isDescriptionMultilingual: typeof rule.description === 'object' && rule.description !== null,
      isKeywordsMultilingual: typeof rule.keywords === 'object' && rule.keywords !== null,
    };

    if (rule.sitemap === false) {
      fields.sitemapToggle = 'exclude';
    } else if (rule.sitemap && typeof rule.sitemap === 'object') {
      fields.sitemapToggle = 'custom';
      if (rule.sitemap.priority !== undefined) fields.sitemapPriority = String(rule.sitemap.priority);
      if (rule.sitemap.changefreq) fields.sitemapChangefreq = rule.sitemap.changefreq;
    }

    return fields;
  });
}

/**
 * Converts an array of flat form field objects back to a rules object.
 *
 * @param {Array<object>} formFieldsArray - Array from rulesToFormFields
 * @returns {object} Rules object (pattern → rule)
 */
function formFieldsArrayToRules(formFieldsArray) {
  const rules = {};
  for (const fields of formFieldsArray) {
    const result = formFieldsToRule(fields);
    if (result) {
      rules[result.pattern] = result.rule;
    }
  }
  return rules;
}

module.exports = {
  SNIPPETS,
  getPatternType,
  insertSnippetIntoText,
  extractDisplayValue,
  getSitemapBadge,
  formFieldsToRule,
  rulesToFormFields,
  formFieldsArrayToRules,
};
