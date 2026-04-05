/**
 * Unit tests for seoConfigValidator.js
 *
 * Tests server-side validation logic for:
 * - validatePageRules(): seoPages.json5 pattern-rule validation
 * - validateGlobalSettings(): pluginConfig.json5 custom block validation
 * - isValidMultilingualValue(): string or {lang: string} detection
 * - isValidUrl(): URL format validation
 * - Exported constants (VALID_CHANGEFREQ, VALID_OG_TYPES, etc.)
 */

const {
  validatePageRules,
  validateGlobalSettings,
  isValidMultilingualValue,
  isValidUrl,
  VALID_CHANGEFREQ,
  VALID_OG_TYPES,
  VALID_TWITTER_CARD_TYPES,
  VALID_ROBOTS_DIRECTIVES,
  VALID_PAGE_RULE_FIELDS,
} = require('../../../plugins/adminSeo/lib/seoConfigValidator');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('exported constants', () => {
  test('VALID_CHANGEFREQ contains expected values', () => {
    expect(VALID_CHANGEFREQ).toContain('always');
    expect(VALID_CHANGEFREQ).toContain('daily');
    expect(VALID_CHANGEFREQ).toContain('weekly');
    expect(VALID_CHANGEFREQ).toContain('monthly');
    expect(VALID_CHANGEFREQ).toContain('yearly');
    expect(VALID_CHANGEFREQ).toContain('never');
    expect(VALID_CHANGEFREQ).toHaveLength(7); // includes 'hourly'
  });

  test('VALID_OG_TYPES contains standard types', () => {
    expect(VALID_OG_TYPES).toContain('website');
    expect(VALID_OG_TYPES).toContain('article');
    expect(VALID_OG_TYPES).toContain('profile');
    expect(VALID_OG_TYPES.length).toBeGreaterThanOrEqual(4);
  });

  test('VALID_TWITTER_CARD_TYPES contains expected types', () => {
    expect(VALID_TWITTER_CARD_TYPES).toContain('summary');
    expect(VALID_TWITTER_CARD_TYPES).toContain('summary_large_image');
    expect(VALID_TWITTER_CARD_TYPES).toHaveLength(4);
  });

  test('VALID_PAGE_RULE_FIELDS lists all recognized fields', () => {
    expect(VALID_PAGE_RULE_FIELDS).toContain('title');
    expect(VALID_PAGE_RULE_FIELDS).toContain('description');
    expect(VALID_PAGE_RULE_FIELDS).toContain('keywords');
    expect(VALID_PAGE_RULE_FIELDS).toContain('robots');
    expect(VALID_PAGE_RULE_FIELDS).toContain('ogType');
    expect(VALID_PAGE_RULE_FIELDS).toContain('ogImage');
    expect(VALID_PAGE_RULE_FIELDS).toContain('twitterCardType');
    expect(VALID_PAGE_RULE_FIELDS).toContain('sitemap');
    expect(VALID_PAGE_RULE_FIELDS).toHaveLength(8);
  });

  test('VALID_ROBOTS_DIRECTIVES contains standard directives', () => {
    expect(VALID_ROBOTS_DIRECTIVES).toContain('index');
    expect(VALID_ROBOTS_DIRECTIVES).toContain('noindex');
    expect(VALID_ROBOTS_DIRECTIVES).toContain('follow');
    expect(VALID_ROBOTS_DIRECTIVES).toContain('nofollow');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// isValidMultilingualValue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('isValidMultilingualValue', () => {
  test('accepts plain string', () => {
    expect(isValidMultilingualValue('Hello')).toBe(true);
  });

  test('accepts empty string', () => {
    expect(isValidMultilingualValue('')).toBe(true);
  });

  test('accepts multilingual object', () => {
    expect(isValidMultilingualValue({ it: 'Ciao', en: 'Hello' })).toBe(true);
  });

  test('accepts single-language object', () => {
    expect(isValidMultilingualValue({ en: 'English' })).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidMultilingualValue(null)).toBe(false);
  });

  test('rejects arrays', () => {
    expect(isValidMultilingualValue(['a', 'b'])).toBe(false);
  });

  test('rejects numbers', () => {
    expect(isValidMultilingualValue(42)).toBe(false);
  });

  test('rejects booleans', () => {
    expect(isValidMultilingualValue(true)).toBe(false);
  });

  test('rejects object with non-string values', () => {
    expect(isValidMultilingualValue({ it: 'Ciao', en: 123 })).toBe(false);
  });

  test('accepts empty object (edge case)', () => {
    // Object.values({}).every(v => typeof v === 'string') → true (vacuous truth)
    expect(isValidMultilingualValue({})).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// isValidUrl
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('isValidUrl', () => {
  test('accepts https URL', () => {
    expect(isValidUrl('https://www.example.com')).toBe(true);
  });

  test('accepts http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  test('accepts URL with path', () => {
    expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
  });

  test('rejects plain string', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  test('rejects ftp protocol', () => {
    expect(isValidUrl('ftp://files.example.com')).toBe(false);
  });

  test('rejects relative path', () => {
    expect(isValidUrl('/about')).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// validatePageRules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('validatePageRules', () => {
  describe('root-level validation', () => {
    test('rejects null', () => {
      const result = validatePageRules(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    test('rejects array', () => {
      const result = validatePageRules([]);
      expect(result.valid).toBe(false);
    });

    test('rejects string', () => {
      const result = validatePageRules('not an object');
      expect(result.valid).toBe(false);
    });

    test('accepts empty object', () => {
      const result = validatePageRules({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('pattern validation', () => {
    test('accepts exact pattern', () => {
      const result = validatePageRules({ '/about.ejs': { title: 'About' } });
      expect(result.valid).toBe(true);
    });

    test('accepts wildcard * pattern', () => {
      const result = validatePageRules({ '/blog/*.ejs': { title: 'Blog' } });
      expect(result.valid).toBe(true);
    });

    test('accepts wildcard ** pattern', () => {
      const result = validatePageRules({ '/docs/**': { title: 'Docs' } });
      expect(result.valid).toBe(true);
    });

    test('accepts regex pattern', () => {
      const result = validatePageRules({ 'regex:^/p/\\d+$': { title: 'Product' } });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid regex pattern', () => {
      const result = validatePageRules({ 'regex:^/[invalid': { title: 'Bad' } });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('rule structure validation', () => {
    test('rejects non-object rule', () => {
      const result = validatePageRules({ '/page': 'not an object' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be an object'))).toBe(true);
    });

    test('rejects null rule', () => {
      const result = validatePageRules({ '/page': null });
      expect(result.valid).toBe(false);
    });

    test('rejects array rule', () => {
      const result = validatePageRules({ '/page': [] });
      expect(result.valid).toBe(false);
    });

    test('warns about unknown fields', () => {
      const result = validatePageRules({ '/page': { title: 'Ok', unknownField: 'bad' } });
      expect(result.valid).toBe(true); // warnings don't invalidate
      expect(result.warnings.some(w => w.includes('unknown field'))).toBe(true);
    });
  });

  describe('multilingual field validation', () => {
    test('accepts string title', () => {
      const result = validatePageRules({ '/p': { title: 'Hello' } });
      expect(result.valid).toBe(true);
    });

    test('accepts multilingual title', () => {
      const result = validatePageRules({ '/p': { title: { it: 'Ciao', en: 'Hello' } } });
      expect(result.valid).toBe(true);
    });

    test('rejects non-string non-object title', () => {
      const result = validatePageRules({ '/p': { title: 42 } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('title'))).toBe(true);
    });

    test('rejects multilingual title with non-string values', () => {
      const result = validatePageRules({ '/p': { title: { it: 'Ciao', en: 123 } } });
      expect(result.valid).toBe(false);
    });

    test('validates description same as title', () => {
      const result = validatePageRules({ '/p': { description: { it: 'D-it', en: 'D-en' } } });
      expect(result.valid).toBe(true);
    });

    test('validates keywords same as title', () => {
      const result = validatePageRules({ '/p': { keywords: 'kw1, kw2' } });
      expect(result.valid).toBe(true);
    });
  });

  describe('string field validation', () => {
    test('accepts valid robots string', () => {
      const result = validatePageRules({ '/p': { robots: 'noindex, nofollow' } });
      expect(result.valid).toBe(true);
    });

    test('rejects non-string robots', () => {
      const result = validatePageRules({ '/p': { robots: 42 } });
      expect(result.valid).toBe(false);
    });

    test('accepts valid ogImage string', () => {
      const result = validatePageRules({ '/p': { ogImage: '/img/og.jpg' } });
      expect(result.valid).toBe(true);
    });

    test('rejects non-string ogImage', () => {
      const result = validatePageRules({ '/p': { ogImage: true } });
      expect(result.valid).toBe(false);
    });
  });

  describe('ogType validation', () => {
    test('accepts standard ogType', () => {
      const result = validatePageRules({ '/p': { ogType: 'article' } });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('warns about non-standard ogType', () => {
      const result = validatePageRules({ '/p': { ogType: 'custom_type' } });
      expect(result.valid).toBe(true); // warning, not error
      expect(result.warnings.some(w => w.includes('ogType'))).toBe(true);
    });

    test('rejects non-string ogType', () => {
      const result = validatePageRules({ '/p': { ogType: 42 } });
      expect(result.valid).toBe(false);
    });
  });

  describe('twitterCardType validation', () => {
    test('accepts valid twitterCardType', () => {
      const result = validatePageRules({ '/p': { twitterCardType: 'summary' } });
      expect(result.valid).toBe(true);
    });

    test('accepts summary_large_image', () => {
      const result = validatePageRules({ '/p': { twitterCardType: 'summary_large_image' } });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid twitterCardType', () => {
      const result = validatePageRules({ '/p': { twitterCardType: 'invalid_type' } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('twitterCardType'))).toBe(true);
    });

    test('rejects non-string twitterCardType', () => {
      const result = validatePageRules({ '/p': { twitterCardType: 123 } });
      expect(result.valid).toBe(false);
    });
  });

  describe('sitemap field validation', () => {
    test('accepts sitemap: false', () => {
      const result = validatePageRules({ '/p': { sitemap: false } });
      expect(result.valid).toBe(true);
    });

    test('accepts valid sitemap object', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 0.8, changefreq: 'weekly' } } });
      expect(result.valid).toBe(true);
    });

    test('accepts sitemap with only priority', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 0.5 } } });
      expect(result.valid).toBe(true);
    });

    test('accepts sitemap with only changefreq', () => {
      const result = validatePageRules({ '/p': { sitemap: { changefreq: 'monthly' } } });
      expect(result.valid).toBe(true);
    });

    test('accepts empty sitemap object', () => {
      const result = validatePageRules({ '/p': { sitemap: {} } });
      expect(result.valid).toBe(true);
    });

    test('rejects sitemap: true', () => {
      const result = validatePageRules({ '/p': { sitemap: true } });
      expect(result.valid).toBe(false);
    });

    test('rejects sitemap: string', () => {
      const result = validatePageRules({ '/p': { sitemap: 'yes' } });
      expect(result.valid).toBe(false);
    });

    test('rejects sitemap: array', () => {
      const result = validatePageRules({ '/p': { sitemap: [] } });
      expect(result.valid).toBe(false);
    });

    test('rejects priority out of range (> 1)', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 1.5 } } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('priority'))).toBe(true);
    });

    test('rejects priority out of range (< 0)', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: -0.1 } } });
      expect(result.valid).toBe(false);
    });

    test('rejects non-number priority', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 'high' } } });
      expect(result.valid).toBe(false);
    });

    test('accepts boundary priority 0', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 0 } } });
      expect(result.valid).toBe(true);
    });

    test('accepts boundary priority 1', () => {
      const result = validatePageRules({ '/p': { sitemap: { priority: 1 } } });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid changefreq', () => {
      const result = validatePageRules({ '/p': { sitemap: { changefreq: 'biweekly' } } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('changefreq'))).toBe(true);
    });

    test('accepts all valid changefreq values', () => {
      for (const freq of VALID_CHANGEFREQ) {
        const result = validatePageRules({ '/p': { sitemap: { changefreq: freq } } });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('multiple rules', () => {
    test('validates all rules and collects all errors', () => {
      const result = validatePageRules({
        '/good': { title: 'Good' },
        '/bad1': { twitterCardType: 'invalid' },
        '/bad2': { sitemap: { priority: 99 } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    test('valid complex set with mixed patterns', () => {
      const result = validatePageRules({
        '/': { title: { it: 'Home', en: 'Home' }, sitemap: { priority: 1.0, changefreq: 'daily' } },
        '/about.ejs': { title: 'About', ogType: 'website' },
        '/blog/*.ejs': { ogType: 'article', sitemap: { changefreq: 'weekly' } },
        '/admin/**': { robots: 'noindex', sitemap: false },
        'regex:^/product/\\d+$': { twitterCardType: 'summary_large_image' },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// validateGlobalSettings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('validateGlobalSettings', () => {
  describe('root-level validation', () => {
    test('rejects null', () => {
      const result = validateGlobalSettings(null);
      expect(result.valid).toBe(false);
    });

    test('rejects non-object', () => {
      const result = validateGlobalSettings('string');
      expect(result.valid).toBe(false);
    });

    test('accepts empty object', () => {
      const result = validateGlobalSettings({});
      expect(result.valid).toBe(true);
    });
  });

  describe('site identity', () => {
    test('accepts valid siteName', () => {
      const result = validateGlobalSettings({ siteName: 'My Site' });
      expect(result.valid).toBe(true);
    });

    test('rejects non-string siteName', () => {
      const result = validateGlobalSettings({ siteName: 42 });
      expect(result.valid).toBe(false);
    });

    test('accepts valid siteUrl', () => {
      const result = validateGlobalSettings({ siteUrl: 'https://example.com' });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('warns about invalid siteUrl format', () => {
      const result = validateGlobalSettings({ siteUrl: 'not-a-url' });
      expect(result.valid).toBe(true); // warning only
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('rejects non-string siteUrl', () => {
      const result = validateGlobalSettings({ siteUrl: 42 });
      expect(result.valid).toBe(false);
    });
  });

  describe('feature toggles', () => {
    const booleanFields = [
      'enableMetaTags', 'enableOpenGraph', 'enableTwitterCards',
      'enableCanonicalUrl', 'enableStructuredData', 'enableSitemap',
      'enableRobotsTxt', 'canonicalCleanUrl', 'sitemapAutoScan',
    ];

    test.each(booleanFields)('%s accepts boolean', (field) => {
      const result = validateGlobalSettings({ [field]: true });
      expect(result.valid).toBe(true);
    });

    test.each(booleanFields)('%s rejects non-boolean', (field) => {
      const result = validateGlobalSettings({ [field]: 'yes' });
      expect(result.valid).toBe(false);
    });
  });

  describe('default values', () => {
    test('accepts valid defaultOgType', () => {
      const result = validateGlobalSettings({ defaultOgType: 'website' });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('warns about non-standard defaultOgType', () => {
      const result = validateGlobalSettings({ defaultOgType: 'custom' });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('accepts valid twitterCardType', () => {
      const result = validateGlobalSettings({ twitterCardType: 'summary' });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid twitterCardType', () => {
      const result = validateGlobalSettings({ twitterCardType: 'invalid' });
      expect(result.valid).toBe(false);
    });
  });

  describe('organization', () => {
    test('accepts valid organization', () => {
      const result = validateGlobalSettings({
        organization: { name: 'Corp', url: 'https://corp.com', logo: '/logo.png' },
      });
      expect(result.valid).toBe(true);
    });

    test('rejects non-object organization', () => {
      const result = validateGlobalSettings({ organization: 'Corp' });
      expect(result.valid).toBe(false);
    });

    test('rejects array organization', () => {
      const result = validateGlobalSettings({ organization: [] });
      expect(result.valid).toBe(false);
    });

    test('rejects non-string org fields', () => {
      const result = validateGlobalSettings({ organization: { name: 42 } });
      expect(result.valid).toBe(false);
    });

    test('accepts valid socialProfiles array', () => {
      const result = validateGlobalSettings({
        organization: { socialProfiles: ['https://twitter.com/x', 'https://linkedin.com/x'] },
      });
      expect(result.valid).toBe(true);
    });

    test('rejects non-array socialProfiles', () => {
      const result = validateGlobalSettings({ organization: { socialProfiles: 'url' } });
      expect(result.valid).toBe(false);
    });

    test('rejects non-string socialProfile items', () => {
      const result = validateGlobalSettings({ organization: { socialProfiles: [42] } });
      expect(result.valid).toBe(false);
    });
  });

  describe('sitemap settings', () => {
    test('accepts valid sitemapDefaultChangefreq', () => {
      const result = validateGlobalSettings({ sitemapDefaultChangefreq: 'monthly' });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid sitemapDefaultChangefreq', () => {
      const result = validateGlobalSettings({ sitemapDefaultChangefreq: 'biweekly' });
      expect(result.valid).toBe(false);
    });

    test('accepts valid sitemapDefaultPriority', () => {
      const result = validateGlobalSettings({ sitemapDefaultPriority: 0.5 });
      expect(result.valid).toBe(true);
    });

    test('rejects out-of-range sitemapDefaultPriority', () => {
      const result = validateGlobalSettings({ sitemapDefaultPriority: 1.5 });
      expect(result.valid).toBe(false);
    });

    test('rejects non-number sitemapDefaultPriority', () => {
      const result = validateGlobalSettings({ sitemapDefaultPriority: 'high' });
      expect(result.valid).toBe(false);
    });

    test('accepts valid sitemapExclude array', () => {
      const result = validateGlobalSettings({ sitemapExclude: ['*.tmp', '/admin/**'] });
      expect(result.valid).toBe(true);
    });

    test('rejects non-array sitemapExclude', () => {
      const result = validateGlobalSettings({ sitemapExclude: 'pattern' });
      expect(result.valid).toBe(false);
    });

    test('rejects non-string sitemapExclude items', () => {
      const result = validateGlobalSettings({ sitemapExclude: [42] });
      expect(result.valid).toBe(false);
    });
  });

  describe('sitemapExtraPages', () => {
    test('accepts valid extra pages', () => {
      const result = validateGlobalSettings({
        sitemapExtraPages: [
          { url: '/page1', changefreq: 'weekly', priority: 0.7 },
        ],
      });
      expect(result.valid).toBe(true);
    });

    test('rejects non-array', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: {} });
      expect(result.valid).toBe(false);
    });

    test('rejects entry without url', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: [{ changefreq: 'weekly' }] });
      expect(result.valid).toBe(false);
    });

    test('rejects entry with non-string url', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: [{ url: 42 }] });
      expect(result.valid).toBe(false);
    });

    test('rejects entry with invalid changefreq', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: [{ url: '/p', changefreq: 'bad' }] });
      expect(result.valid).toBe(false);
    });

    test('rejects entry with out-of-range priority', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: [{ url: '/p', priority: 2 }] });
      expect(result.valid).toBe(false);
    });

    test('rejects non-object entry', () => {
      const result = validateGlobalSettings({ sitemapExtraPages: ['string'] });
      expect(result.valid).toBe(false);
    });
  });

  describe('robotsTxtRules', () => {
    test('accepts valid robotsTxtRules', () => {
      const result = validateGlobalSettings({
        robotsTxtRules: { userAgent: '*', allow: ['/'], disallow: ['/admin'] },
      });
      expect(result.valid).toBe(true);
    });

    test('rejects non-object', () => {
      const result = validateGlobalSettings({ robotsTxtRules: 'rules' });
      expect(result.valid).toBe(false);
    });

    test('rejects non-string userAgent', () => {
      const result = validateGlobalSettings({ robotsTxtRules: { userAgent: 42 } });
      expect(result.valid).toBe(false);
    });

    test('rejects non-array allow', () => {
      const result = validateGlobalSettings({ robotsTxtRules: { allow: '/' } });
      expect(result.valid).toBe(false);
    });

    test('rejects non-array disallow', () => {
      const result = validateGlobalSettings({ robotsTxtRules: { disallow: '/admin' } });
      expect(result.valid).toBe(false);
    });
  });

  describe('complete valid config', () => {
    test('accepts a realistic full config', () => {
      const result = validateGlobalSettings({
        siteName: 'My Site',
        siteUrl: 'https://www.example.com',
        enableMetaTags: true,
        enableOpenGraph: true,
        enableTwitterCards: true,
        enableCanonicalUrl: true,
        enableStructuredData: true,
        enableSitemap: true,
        enableRobotsTxt: true,
        canonicalCleanUrl: true,
        sitemapAutoScan: true,
        defaultDescription: 'A great site',
        defaultKeywords: 'site, great',
        defaultRobots: 'index, follow',
        defaultOgType: 'website',
        defaultOgImage: '/img/og.jpg',
        twitterCardType: 'summary_large_image',
        twitterHandle: '@mysite',
        sitemapDefaultChangefreq: 'monthly',
        sitemapDefaultPriority: 0.5,
        sitemapExclude: ['/admin/**', '*.tmp'],
        sitemapExtraPages: [{ url: '/landing', priority: 0.9, changefreq: 'weekly' }],
        organization: {
          name: 'Corp',
          url: 'https://corp.com',
          logo: '/logo.png',
          contactEmail: 'info@corp.com',
          socialProfiles: ['https://twitter.com/corp'],
        },
        robotsTxtRules: {
          userAgent: '*',
          allow: ['/'],
          disallow: ['/admin/', '/private/'],
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
