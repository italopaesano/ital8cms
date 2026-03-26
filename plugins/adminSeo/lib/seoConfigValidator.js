/**
 * SEO CONFIG VALIDATOR
 *
 * Validates SEO plugin configuration (pluginConfig.json5 custom block)
 * and per-page rules (seoPages.json5).
 *
 * Used by adminSeo plugin for server-side validation before saving.
 *
 * @module plugins/adminSeo/lib/seoConfigValidator
 */

const PatternMatcher = require('../../../core/patternMatcher');

const matcher = new PatternMatcher();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const VALID_CHANGEFREQ = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
const VALID_OG_TYPES = ['website', 'article', 'profile', 'book', 'music.song', 'music.album', 'video.movie', 'video.episode'];
const VALID_TWITTER_CARD_TYPES = ['summary', 'summary_large_image', 'app', 'player'];
const VALID_ROBOTS_DIRECTIVES = ['index', 'noindex', 'follow', 'nofollow', 'none', 'noarchive', 'nosnippet', 'noimageindex', 'max-snippet', 'max-image-preview', 'max-video-preview'];

// Fields recognized in per-page rules
const VALID_PAGE_RULE_FIELDS = ['title', 'description', 'keywords', 'robots', 'ogType', 'ogImage', 'twitterCardType', 'sitemap'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL SETTINGS VALIDATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validates the custom block of pluginConfig.json5.
 *
 * @param {object} custom - The custom block to validate
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateGlobalSettings(custom) {
  const errors = [];
  const warnings = [];

  if (!custom || typeof custom !== 'object') {
    errors.push('Configuration must be an object');
    return { valid: false, errors, warnings };
  }

  // — Site Identity —
  if (custom.siteName !== undefined && typeof custom.siteName !== 'string') {
    errors.push('siteName must be a string');
  }
  if (custom.siteUrl !== undefined) {
    if (typeof custom.siteUrl !== 'string') {
      errors.push('siteUrl must be a string');
    } else if (custom.siteUrl && !isValidUrl(custom.siteUrl)) {
      warnings.push('siteUrl does not appear to be a valid URL (expected https://...)');
    }
  }

  // — Feature toggles —
  const booleanFields = [
    'enableMetaTags', 'enableOpenGraph', 'enableTwitterCards',
    'enableCanonicalUrl', 'enableStructuredData', 'enableSitemap',
    'enableRobotsTxt', 'canonicalCleanUrl', 'sitemapAutoScan',
  ];
  for (const field of booleanFields) {
    if (custom[field] !== undefined && typeof custom[field] !== 'boolean') {
      errors.push(`${field} must be a boolean (true/false)`);
    }
  }

  // — Default values —
  const stringFields = ['defaultDescription', 'defaultKeywords', 'defaultRobots', 'defaultOgImage', 'twitterHandle'];
  for (const field of stringFields) {
    if (custom[field] !== undefined && typeof custom[field] !== 'string') {
      errors.push(`${field} must be a string`);
    }
  }

  if (custom.defaultOgType !== undefined) {
    if (typeof custom.defaultOgType !== 'string') {
      errors.push('defaultOgType must be a string');
    } else if (custom.defaultOgType && !VALID_OG_TYPES.includes(custom.defaultOgType)) {
      warnings.push(`defaultOgType "${custom.defaultOgType}" is not a standard OG type. Valid: ${VALID_OG_TYPES.join(', ')}`);
    }
  }

  if (custom.twitterCardType !== undefined) {
    if (typeof custom.twitterCardType !== 'string') {
      errors.push('twitterCardType must be a string');
    } else if (custom.twitterCardType && !VALID_TWITTER_CARD_TYPES.includes(custom.twitterCardType)) {
      errors.push(`twitterCardType "${custom.twitterCardType}" is not valid. Valid: ${VALID_TWITTER_CARD_TYPES.join(', ')}`);
    }
  }

  // — Organization —
  if (custom.organization !== undefined) {
    if (typeof custom.organization !== 'object' || custom.organization === null || Array.isArray(custom.organization)) {
      errors.push('organization must be an object');
    } else {
      const org = custom.organization;
      const orgStringFields = ['name', 'url', 'logo', 'contactEmail', 'contactPhone'];
      for (const field of orgStringFields) {
        if (org[field] !== undefined && typeof org[field] !== 'string') {
          errors.push(`organization.${field} must be a string`);
        }
      }
      if (org.socialProfiles !== undefined) {
        if (!Array.isArray(org.socialProfiles)) {
          errors.push('organization.socialProfiles must be an array');
        } else {
          for (let i = 0; i < org.socialProfiles.length; i++) {
            if (typeof org.socialProfiles[i] !== 'string') {
              errors.push(`organization.socialProfiles[${i}] must be a string`);
            }
          }
        }
      }
    }
  }

  // — Sitemap —
  if (custom.sitemapDefaultChangefreq !== undefined) {
    if (typeof custom.sitemapDefaultChangefreq !== 'string') {
      errors.push('sitemapDefaultChangefreq must be a string');
    } else if (!VALID_CHANGEFREQ.includes(custom.sitemapDefaultChangefreq)) {
      errors.push(`sitemapDefaultChangefreq "${custom.sitemapDefaultChangefreq}" is not valid. Valid: ${VALID_CHANGEFREQ.join(', ')}`);
    }
  }

  if (custom.sitemapDefaultPriority !== undefined) {
    if (typeof custom.sitemapDefaultPriority !== 'number') {
      errors.push('sitemapDefaultPriority must be a number');
    } else if (custom.sitemapDefaultPriority < 0 || custom.sitemapDefaultPriority > 1) {
      errors.push('sitemapDefaultPriority must be between 0.0 and 1.0');
    }
  }

  if (custom.sitemapExclude !== undefined) {
    if (!Array.isArray(custom.sitemapExclude)) {
      errors.push('sitemapExclude must be an array');
    } else {
      for (let i = 0; i < custom.sitemapExclude.length; i++) {
        if (typeof custom.sitemapExclude[i] !== 'string') {
          errors.push(`sitemapExclude[${i}] must be a string`);
        }
      }
    }
  }

  if (custom.sitemapExtraPages !== undefined) {
    if (!Array.isArray(custom.sitemapExtraPages)) {
      errors.push('sitemapExtraPages must be an array');
    } else {
      for (let i = 0; i < custom.sitemapExtraPages.length; i++) {
        const page = custom.sitemapExtraPages[i];
        if (typeof page !== 'object' || page === null || Array.isArray(page)) {
          errors.push(`sitemapExtraPages[${i}] must be an object with {url, changefreq?, priority?}`);
        } else {
          if (!page.url || typeof page.url !== 'string') {
            errors.push(`sitemapExtraPages[${i}].url is required and must be a string`);
          }
          if (page.changefreq !== undefined && !VALID_CHANGEFREQ.includes(page.changefreq)) {
            errors.push(`sitemapExtraPages[${i}].changefreq "${page.changefreq}" is not valid`);
          }
          if (page.priority !== undefined) {
            if (typeof page.priority !== 'number' || page.priority < 0 || page.priority > 1) {
              errors.push(`sitemapExtraPages[${i}].priority must be between 0.0 and 1.0`);
            }
          }
        }
      }
    }
  }

  // — Robots.txt —
  if (custom.robotsTxtRules !== undefined) {
    if (typeof custom.robotsTxtRules !== 'object' || custom.robotsTxtRules === null || Array.isArray(custom.robotsTxtRules)) {
      errors.push('robotsTxtRules must be an object');
    } else {
      const rules = custom.robotsTxtRules;
      if (rules.userAgent !== undefined && typeof rules.userAgent !== 'string') {
        errors.push('robotsTxtRules.userAgent must be a string');
      }
      if (rules.allow !== undefined && !Array.isArray(rules.allow)) {
        errors.push('robotsTxtRules.allow must be an array');
      }
      if (rules.disallow !== undefined && !Array.isArray(rules.disallow)) {
        errors.push('robotsTxtRules.disallow must be an array');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE RULES VALIDATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validates the entire seoPages.json5 content.
 *
 * @param {object} pages - The parsed seoPages object
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePageRules(pages) {
  const errors = [];
  const warnings = [];

  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) {
    errors.push('SEO pages must be an object (pattern → rule mapping)');
    return { valid: false, errors, warnings };
  }

  for (const [pattern, rule] of Object.entries(pages)) {
    // Validate pattern
    const patternValidation = matcher.validatePattern(pattern);
    if (!patternValidation.valid) {
      errors.push(`Pattern "${pattern}": ${patternValidation.error}`);
      continue;
    }

    // Rule must be an object
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
      errors.push(`"${pattern}": rule must be an object`);
      continue;
    }

    // Check for unknown fields
    for (const field of Object.keys(rule)) {
      if (!VALID_PAGE_RULE_FIELDS.includes(field)) {
        warnings.push(`"${pattern}": unknown field "${field}"`);
      }
    }

    // Validate multilingual fields (title, description, keywords)
    const multilingualFields = ['title', 'description', 'keywords'];
    for (const field of multilingualFields) {
      if (rule[field] !== undefined) {
        if (!isValidMultilingualValue(rule[field])) {
          errors.push(`"${pattern}".${field}: must be a string or an object with language keys (e.g., { "it": "...", "en": "..." })`);
        }
      }
    }

    // Validate string fields
    if (rule.robots !== undefined && typeof rule.robots !== 'string') {
      errors.push(`"${pattern}".robots: must be a string`);
    }
    if (rule.ogType !== undefined) {
      if (typeof rule.ogType !== 'string') {
        errors.push(`"${pattern}".ogType: must be a string`);
      } else if (!VALID_OG_TYPES.includes(rule.ogType)) {
        warnings.push(`"${pattern}".ogType: "${rule.ogType}" is not a standard OG type`);
      }
    }
    if (rule.ogImage !== undefined && typeof rule.ogImage !== 'string') {
      errors.push(`"${pattern}".ogImage: must be a string`);
    }
    if (rule.twitterCardType !== undefined) {
      if (typeof rule.twitterCardType !== 'string') {
        errors.push(`"${pattern}".twitterCardType: must be a string`);
      } else if (!VALID_TWITTER_CARD_TYPES.includes(rule.twitterCardType)) {
        errors.push(`"${pattern}".twitterCardType: "${rule.twitterCardType}" is not valid. Valid: ${VALID_TWITTER_CARD_TYPES.join(', ')}`);
      }
    }

    // Validate sitemap field
    if (rule.sitemap !== undefined) {
      if (rule.sitemap !== false && (typeof rule.sitemap !== 'object' || rule.sitemap === null || Array.isArray(rule.sitemap))) {
        errors.push(`"${pattern}".sitemap: must be false or an object with {priority?, changefreq?}`);
      } else if (typeof rule.sitemap === 'object' && rule.sitemap !== null) {
        if (rule.sitemap.priority !== undefined) {
          if (typeof rule.sitemap.priority !== 'number' || rule.sitemap.priority < 0 || rule.sitemap.priority > 1) {
            errors.push(`"${pattern}".sitemap.priority: must be between 0.0 and 1.0`);
          }
        }
        if (rule.sitemap.changefreq !== undefined) {
          if (!VALID_CHANGEFREQ.includes(rule.sitemap.changefreq)) {
            errors.push(`"${pattern}".sitemap.changefreq: "${rule.sitemap.changefreq}" is not valid. Valid: ${VALID_CHANGEFREQ.join(', ')}`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Checks if a value is a valid multilingual value (string or { lang: string } object).
 */
function isValidMultilingualValue(value) {
  if (typeof value === 'string') return true;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.values(value).every(v => typeof v === 'string');
  }
  return false;
}

/**
 * Basic URL validation.
 */
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  validateGlobalSettings,
  validatePageRules,
  isValidMultilingualValue,
  isValidUrl,
  VALID_CHANGEFREQ,
  VALID_OG_TYPES,
  VALID_TWITTER_CARD_TYPES,
  VALID_ROBOTS_DIRECTIVES,
  VALID_PAGE_RULE_FIELDS,
};
