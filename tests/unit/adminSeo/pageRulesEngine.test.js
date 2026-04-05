/**
 * Unit tests for pageRulesEngine.js
 *
 * Tests pure functions extracted from the pageRules.ejs inline script:
 * - getPatternType(): pattern → badge classification
 * - insertSnippetIntoText(): JSON5 snippet insertion logic
 * - extractDisplayValue(): multilingual/string → display string
 * - getSitemapBadge(): sitemap field → badge descriptor
 * - formFieldsToRule(): flat form fields → rule object
 * - rulesToFormFields(): rules object → flat form fields array
 * - formFieldsArrayToRules(): round-trip form ↔ rules
 * - SNIPPETS: constant templates
 */

const {
  SNIPPETS,
  getPatternType,
  insertSnippetIntoText,
  extractDisplayValue,
  getSitemapBadge,
  formFieldsToRule,
  rulesToFormFields,
  formFieldsArrayToRules,
} = require('../../../plugins/adminSeo/lib/pageRulesEngine');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNIPPETS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SNIPPETS', () => {
  test('contains exactly 5 snippet types', () => {
    expect(Object.keys(SNIPPETS)).toHaveLength(5);
  });

  test('all expected types exist', () => {
    expect(SNIPPETS).toHaveProperty('exact');
    expect(SNIPPETS).toHaveProperty('wildcard');
    expect(SNIPPETS).toHaveProperty('recursive');
    expect(SNIPPETS).toHaveProperty('regex');
    expect(SNIPPETS).toHaveProperty('multilingual');
  });

  test('all snippets are non-empty strings', () => {
    for (const [key, value] of Object.entries(SNIPPETS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('exact snippet contains a pattern and sitemap', () => {
    expect(SNIPPETS.exact).toContain('/page.ejs');
    expect(SNIPPETS.exact).toContain('title');
    expect(SNIPPETS.exact).toContain('sitemap');
  });

  test('wildcard snippet uses * pattern', () => {
    expect(SNIPPETS.wildcard).toContain('/blog/*.ejs');
    expect(SNIPPETS.wildcard).toContain('article');
  });

  test('recursive snippet uses ** pattern', () => {
    expect(SNIPPETS.recursive).toContain('/docs/**');
  });

  test('regex snippet uses regex: prefix', () => {
    expect(SNIPPETS.regex).toContain('regex:');
  });

  test('multilingual snippet contains language objects', () => {
    expect(SNIPPETS.multilingual).toContain('"it"');
    expect(SNIPPETS.multilingual).toContain('"en"');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// getPatternType
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('getPatternType', () => {
  test('exact match — no wildcards or regex', () => {
    const result = getPatternType('/about.ejs');
    expect(result).toEqual({ label: 'exact', color: 'primary' });
  });

  test('exact match — root path', () => {
    expect(getPatternType('/')).toEqual({ label: 'exact', color: 'primary' });
  });

  test('exact match — deep path', () => {
    expect(getPatternType('/a/b/c/page.ejs')).toEqual({ label: 'exact', color: 'primary' });
  });

  test('single wildcard *', () => {
    const result = getPatternType('/blog/*.ejs');
    expect(result).toEqual({ label: '*', color: 'secondary' });
  });

  test('recursive wildcard **', () => {
    const result = getPatternType('/docs/**');
    expect(result).toEqual({ label: '**', color: 'warning' });
  });

  test('** takes priority over * when both present', () => {
    // Pattern "/a/**/b/*" contains both ** and *
    const result = getPatternType('/a/**/b/*');
    expect(result).toEqual({ label: '**', color: 'warning' });
  });

  test('regex pattern', () => {
    const result = getPatternType('regex:^/product/\\d+$');
    expect(result).toEqual({ label: 'regex', color: 'info' });
  });

  test('regex takes priority over wildcards', () => {
    // Hypothetical: regex: prefix with * in the pattern body
    const result = getPatternType('regex:^/blog/.*$');
    expect(result).toEqual({ label: 'regex', color: 'info' });
  });

  test('empty string is exact', () => {
    expect(getPatternType('')).toEqual({ label: 'exact', color: 'primary' });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// insertSnippetIntoText
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('insertSnippetIntoText', () => {
  test('returns null for unknown snippet type', () => {
    expect(insertSnippetIntoText('{}', 'nonexistent')).toBeNull();
  });

  test('wraps in braces if no braces exist', () => {
    const result = insertSnippetIntoText('', 'exact');
    expect(result).toMatch(/^\{/);
    expect(result).toMatch(/\}$/);
    expect(result).toContain('/page.ejs');
  });

  test('inserts before last closing brace in empty object', () => {
    const result = insertSnippetIntoText('{\n}', 'exact');
    expect(result).toContain('/page.ejs');
    // Should still end with }
    expect(result.trimEnd().endsWith('}')).toBe(true);
  });

  test('adds comma when previous content has no trailing comma', () => {
    const existing = '{\n  "/old": { "title": "Old" }\n}';
    const result = insertSnippetIntoText(existing, 'wildcard');
    // Should have added a comma after the existing rule
    expect(result).toContain('/blog/*.ejs');
    // The comma should be present somewhere before the new snippet
    const snippetStart = result.indexOf('/blog/*.ejs');
    const textBefore = result.substring(0, snippetStart);
    expect(textBefore).toContain(',');
  });

  test('does NOT add comma when previous content has trailing comma', () => {
    const existing = '{\n  "/old": { "title": "Old" },\n}';
    const result = insertSnippetIntoText(existing, 'exact');
    expect(result).toContain('/page.ejs');
    // Should not have double commas
    expect(result).not.toContain(',,');
  });

  test('does NOT add comma right after opening brace', () => {
    const result = insertSnippetIntoText('{\n}', 'regex');
    // The snippet should be inserted without a leading comma
    expect(result).not.toMatch(/\{,/);
  });

  test('all snippet types can be inserted', () => {
    for (const type of Object.keys(SNIPPETS)) {
      const result = insertSnippetIntoText('{}', type);
      expect(result).not.toBeNull();
      expect(result.length).toBeGreaterThan(2);
    }
  });

  test('preserves content outside braces', () => {
    const existing = '// comment\n{\n  "/page": {}\n}';
    const result = insertSnippetIntoText(existing, 'exact');
    expect(result).toContain('// comment');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// extractDisplayValue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extractDisplayValue', () => {
  test('returns string value as-is', () => {
    expect(extractDisplayValue('Hello World')).toBe('Hello World');
  });

  test('returns empty string as-is', () => {
    expect(extractDisplayValue('')).toBe('');
  });

  test('returns first value of multilingual object', () => {
    expect(extractDisplayValue({ it: 'Ciao', en: 'Hello' })).toBe('Ciao');
  });

  test('returns "—" for undefined', () => {
    expect(extractDisplayValue(undefined)).toBe('—');
  });

  test('returns "—" for null', () => {
    expect(extractDisplayValue(null)).toBe('—');
  });

  test('returns "—" for arrays', () => {
    expect(extractDisplayValue(['a', 'b'])).toBe('—');
  });

  test('returns "—" for numbers', () => {
    expect(extractDisplayValue(42)).toBe('—');
  });

  test('returns "—" for booleans', () => {
    expect(extractDisplayValue(true)).toBe('—');
  });

  test('returns "—" for empty object', () => {
    expect(extractDisplayValue({})).toBe('—');
  });

  test('handles single-language object', () => {
    expect(extractDisplayValue({ en: 'English Only' })).toBe('English Only');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// getSitemapBadge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('getSitemapBadge', () => {
  test('returns "excluded" for false', () => {
    expect(getSitemapBadge(false)).toEqual({ type: 'excluded', text: 'excluded' });
  });

  test('returns "default" for undefined', () => {
    expect(getSitemapBadge(undefined)).toEqual({ type: 'default', text: '—' });
  });

  test('returns "default" for null', () => {
    expect(getSitemapBadge(null)).toEqual({ type: 'default', text: '—' });
  });

  test('returns custom with priority', () => {
    const result = getSitemapBadge({ priority: 0.8 });
    expect(result.type).toBe('custom');
    expect(result.text).toContain('p:0.8');
  });

  test('returns custom with changefreq', () => {
    const result = getSitemapBadge({ changefreq: 'weekly' });
    expect(result.type).toBe('custom');
    expect(result.text).toContain('weekly');
  });

  test('returns custom with both priority and changefreq', () => {
    const result = getSitemapBadge({ priority: 0.6, changefreq: 'daily' });
    expect(result.type).toBe('custom');
    expect(result.text).toBe('p:0.6 daily');
  });

  test('returns custom with empty object', () => {
    const result = getSitemapBadge({});
    expect(result.type).toBe('custom');
    expect(result.text).toBe('custom');
  });

  test('returns "default" for non-object truthy values', () => {
    // e.g. sitemap: true — not a valid value but should degrade gracefully
    expect(getSitemapBadge(true)).toEqual({ type: 'default', text: '—' });
  });

  test('returns "default" for string values', () => {
    expect(getSitemapBadge('yes')).toEqual({ type: 'default', text: '—' });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// formFieldsToRule
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('formFieldsToRule', () => {
  test('returns null for empty pattern', () => {
    expect(formFieldsToRule({ pattern: '' })).toBeNull();
  });

  test('returns null for whitespace-only pattern', () => {
    expect(formFieldsToRule({ pattern: '   ' })).toBeNull();
  });

  test('returns null when pattern is undefined', () => {
    expect(formFieldsToRule({})).toBeNull();
  });

  test('minimal rule — pattern only', () => {
    const result = formFieldsToRule({ pattern: '/about.ejs' });
    expect(result).toEqual({ pattern: '/about.ejs', rule: {} });
  });

  test('trims pattern whitespace', () => {
    const result = formFieldsToRule({ pattern: '  /about.ejs  ' });
    expect(result.pattern).toBe('/about.ejs');
  });

  test('includes title when non-empty', () => {
    const result = formFieldsToRule({ pattern: '/p', title: 'My Title' });
    expect(result.rule.title).toBe('My Title');
  });

  test('omits title when empty', () => {
    const result = formFieldsToRule({ pattern: '/p', title: '' });
    expect(result.rule).not.toHaveProperty('title');
  });

  test('trims title', () => {
    const result = formFieldsToRule({ pattern: '/p', title: '  Padded  ' });
    expect(result.rule.title).toBe('Padded');
  });

  test('includes description when non-empty', () => {
    const result = formFieldsToRule({ pattern: '/p', description: 'Desc' });
    expect(result.rule.description).toBe('Desc');
  });

  test('includes keywords when non-empty', () => {
    const result = formFieldsToRule({ pattern: '/p', keywords: 'a, b, c' });
    expect(result.rule.keywords).toBe('a, b, c');
  });

  test('includes robots when non-empty', () => {
    const result = formFieldsToRule({ pattern: '/p', robots: 'noindex, nofollow' });
    expect(result.rule.robots).toBe('noindex, nofollow');
  });

  test('includes ogType when set', () => {
    const result = formFieldsToRule({ pattern: '/p', ogType: 'article' });
    expect(result.rule.ogType).toBe('article');
  });

  test('omits ogType when empty string', () => {
    const result = formFieldsToRule({ pattern: '/p', ogType: '' });
    expect(result.rule).not.toHaveProperty('ogType');
  });

  test('includes ogImage when non-empty', () => {
    const result = formFieldsToRule({ pattern: '/p', ogImage: '/img/og.jpg' });
    expect(result.rule.ogImage).toBe('/img/og.jpg');
  });

  test('includes twitterCardType when set', () => {
    const result = formFieldsToRule({ pattern: '/p', twitterCardType: 'summary' });
    expect(result.rule.twitterCardType).toBe('summary');
  });

  test('sitemap: exclude → false', () => {
    const result = formFieldsToRule({ pattern: '/p', sitemapToggle: 'exclude' });
    expect(result.rule.sitemap).toBe(false);
  });

  test('sitemap: custom with priority and changefreq', () => {
    const result = formFieldsToRule({
      pattern: '/p',
      sitemapToggle: 'custom',
      sitemapPriority: '0.7',
      sitemapChangefreq: 'weekly',
    });
    expect(result.rule.sitemap).toEqual({ priority: 0.7, changefreq: 'weekly' });
  });

  test('sitemap: custom with only priority', () => {
    const result = formFieldsToRule({
      pattern: '/p',
      sitemapToggle: 'custom',
      sitemapPriority: '0.5',
      sitemapChangefreq: '',
    });
    expect(result.rule.sitemap).toEqual({ priority: 0.5 });
  });

  test('sitemap: custom with only changefreq', () => {
    const result = formFieldsToRule({
      pattern: '/p',
      sitemapToggle: 'custom',
      sitemapPriority: '',
      sitemapChangefreq: 'daily',
    });
    expect(result.rule.sitemap).toEqual({ changefreq: 'daily' });
  });

  test('sitemap: custom with empty fields → empty object', () => {
    const result = formFieldsToRule({
      pattern: '/p',
      sitemapToggle: 'custom',
      sitemapPriority: '',
      sitemapChangefreq: '',
    });
    expect(result.rule.sitemap).toEqual({});
  });

  test('sitemap: default → no sitemap field', () => {
    const result = formFieldsToRule({ pattern: '/p', sitemapToggle: 'default' });
    expect(result.rule).not.toHaveProperty('sitemap');
  });

  test('sitemap: undefined toggle → no sitemap field', () => {
    const result = formFieldsToRule({ pattern: '/p' });
    expect(result.rule).not.toHaveProperty('sitemap');
  });

  test('complete rule with all fields', () => {
    const result = formFieldsToRule({
      pattern: '/about.ejs',
      title: 'About Us',
      description: 'Learn about our company',
      keywords: 'company, about, info',
      robots: 'index, follow',
      ogType: 'website',
      ogImage: '/img/about.jpg',
      twitterCardType: 'summary_large_image',
      sitemapToggle: 'custom',
      sitemapPriority: '0.8',
      sitemapChangefreq: 'monthly',
    });

    expect(result.pattern).toBe('/about.ejs');
    expect(result.rule).toEqual({
      title: 'About Us',
      description: 'Learn about our company',
      keywords: 'company, about, info',
      robots: 'index, follow',
      ogType: 'website',
      ogImage: '/img/about.jpg',
      twitterCardType: 'summary_large_image',
      sitemap: { priority: 0.8, changefreq: 'monthly' },
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// rulesToFormFields
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('rulesToFormFields', () => {
  test('returns empty array for null', () => {
    expect(rulesToFormFields(null)).toEqual([]);
  });

  test('returns empty array for undefined', () => {
    expect(rulesToFormFields(undefined)).toEqual([]);
  });

  test('returns empty array for non-object', () => {
    expect(rulesToFormFields('string')).toEqual([]);
  });

  test('returns empty array for empty object', () => {
    expect(rulesToFormFields({})).toEqual([]);
  });

  test('converts simple rule', () => {
    const fields = rulesToFormFields({
      '/about.ejs': { title: 'About', description: 'About page' },
    });
    expect(fields).toHaveLength(1);
    expect(fields[0].pattern).toBe('/about.ejs');
    expect(fields[0].title).toBe('About');
    expect(fields[0].description).toBe('About page');
    expect(fields[0].sitemapToggle).toBe('default');
  });

  test('converts rule with sitemap: false', () => {
    const fields = rulesToFormFields({
      '/private': { sitemap: false },
    });
    expect(fields[0].sitemapToggle).toBe('exclude');
  });

  test('converts rule with custom sitemap', () => {
    const fields = rulesToFormFields({
      '/blog': { sitemap: { priority: 0.6, changefreq: 'weekly' } },
    });
    expect(fields[0].sitemapToggle).toBe('custom');
    expect(fields[0].sitemapPriority).toBe('0.6');
    expect(fields[0].sitemapChangefreq).toBe('weekly');
  });

  test('detects multilingual title', () => {
    const fields = rulesToFormFields({
      '/': { title: { it: 'Ciao', en: 'Hello' } },
    });
    expect(fields[0].title).toBe(''); // string value is empty for multilingual
    expect(fields[0].isTitleMultilingual).toBe(true);
  });

  test('detects multilingual description', () => {
    const fields = rulesToFormFields({
      '/': { description: { it: 'Desc IT', en: 'Desc EN' } },
    });
    expect(fields[0].description).toBe('');
    expect(fields[0].isDescriptionMultilingual).toBe(true);
  });

  test('detects multilingual keywords', () => {
    const fields = rulesToFormFields({
      '/': { keywords: { it: 'kw-it', en: 'kw-en' } },
    });
    expect(fields[0].keywords).toBe('');
    expect(fields[0].isKeywordsMultilingual).toBe(true);
  });

  test('non-multilingual fields are not flagged', () => {
    const fields = rulesToFormFields({
      '/': { title: 'Plain', description: 'Plain', keywords: 'plain' },
    });
    expect(fields[0].isTitleMultilingual).toBe(false);
    expect(fields[0].isDescriptionMultilingual).toBe(false);
    expect(fields[0].isKeywordsMultilingual).toBe(false);
  });

  test('handles all optional fields as empty strings when missing', () => {
    const fields = rulesToFormFields({ '/page': {} });
    const f = fields[0];
    expect(f.title).toBe('');
    expect(f.description).toBe('');
    expect(f.keywords).toBe('');
    expect(f.robots).toBe('');
    expect(f.ogType).toBe('');
    expect(f.ogImage).toBe('');
    expect(f.twitterCardType).toBe('');
    expect(f.sitemapToggle).toBe('default');
    expect(f.sitemapPriority).toBe('');
    expect(f.sitemapChangefreq).toBe('');
  });

  test('converts multiple rules preserving order', () => {
    const rules = {
      '/a': { title: 'A' },
      '/b': { title: 'B' },
      '/c': { title: 'C' },
    };
    const fields = rulesToFormFields(rules);
    expect(fields).toHaveLength(3);
    expect(fields[0].pattern).toBe('/a');
    expect(fields[1].pattern).toBe('/b');
    expect(fields[2].pattern).toBe('/c');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// formFieldsArrayToRules (round-trip)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('formFieldsArrayToRules', () => {
  test('empty array → empty object', () => {
    expect(formFieldsArrayToRules([])).toEqual({});
  });

  test('skips entries with empty pattern', () => {
    const result = formFieldsArrayToRules([
      { pattern: '', title: 'Orphan' },
      { pattern: '/real', title: 'Real' },
    ]);
    expect(Object.keys(result)).toEqual(['/real']);
  });

  test('converts multiple entries', () => {
    const result = formFieldsArrayToRules([
      { pattern: '/a', title: 'A', sitemapToggle: 'default' },
      { pattern: '/b', title: 'B', sitemapToggle: 'exclude' },
    ]);
    expect(result['/a']).toEqual({ title: 'A' });
    expect(result['/b']).toEqual({ title: 'B', sitemap: false });
  });

  test('round-trip: rules → formFields → rules (string fields)', () => {
    const original = {
      '/about': {
        title: 'About',
        description: 'About page',
        robots: 'index, follow',
        ogType: 'website',
        ogImage: '/img.jpg',
        twitterCardType: 'summary',
        sitemap: { priority: 0.8, changefreq: 'monthly' },
      },
    };
    const fields = rulesToFormFields(original);
    const roundTripped = formFieldsArrayToRules(fields);
    expect(roundTripped).toEqual(original);
  });

  test('round-trip: sitemap exclude preserved', () => {
    const original = { '/private': { sitemap: false } };
    const fields = rulesToFormFields(original);
    const roundTripped = formFieldsArrayToRules(fields);
    expect(roundTripped).toEqual(original);
  });

  test('round-trip: multilingual fields lost (expected — form only handles strings)', () => {
    const original = {
      '/': { title: { it: 'Ciao', en: 'Hello' } },
    };
    const fields = rulesToFormFields(original);
    const roundTripped = formFieldsArrayToRules(fields);
    // Multilingual values are lost because form fields extract only strings
    // The title was '' (empty) so it is omitted entirely
    expect(roundTripped['/']).toEqual({});
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Integration: realistic data scenarios
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('realistic data scenarios', () => {
  const realisticRules = {
    '/': {
      title: { it: 'Home - Azienda XYZ', en: 'Home - XYZ Corp' },
      description: { it: 'Benvenuti nel sito', en: 'Welcome to our site' },
      sitemap: { priority: 1.0, changefreq: 'daily' },
    },
    '/about.ejs': {
      title: 'About Us',
      description: 'Learn about our company',
      ogType: 'website',
      sitemap: { priority: 0.8, changefreq: 'monthly' },
    },
    '/blog/*.ejs': {
      ogType: 'article',
      sitemap: { priority: 0.6, changefreq: 'weekly' },
    },
    'regex:^/product/\\d+$': {
      ogType: 'article',
      twitterCardType: 'summary_large_image',
    },
    '/admin/**': {
      robots: 'noindex, nofollow',
      sitemap: false,
    },
  };

  test('pattern types classified correctly', () => {
    expect(getPatternType('/')).toEqual({ label: 'exact', color: 'primary' });
    expect(getPatternType('/about.ejs')).toEqual({ label: 'exact', color: 'primary' });
    expect(getPatternType('/blog/*.ejs')).toEqual({ label: '*', color: 'secondary' });
    expect(getPatternType('regex:^/product/\\d+$')).toEqual({ label: 'regex', color: 'info' });
    expect(getPatternType('/admin/**')).toEqual({ label: '**', color: 'warning' });
  });

  test('display values extracted from all rule types', () => {
    expect(extractDisplayValue(realisticRules['/'].title)).toBe('Home - Azienda XYZ');
    expect(extractDisplayValue(realisticRules['/about.ejs'].title)).toBe('About Us');
    expect(extractDisplayValue(realisticRules['/blog/*.ejs'].title)).toBe('—');
  });

  test('sitemap badges correct for all rule types', () => {
    expect(getSitemapBadge(realisticRules['/'].sitemap).type).toBe('custom');
    expect(getSitemapBadge(realisticRules['/admin/**'].sitemap).type).toBe('excluded');
    expect(getSitemapBadge(realisticRules['regex:^/product/\\d+$'].sitemap).type).toBe('default');
  });

  test('conversion to form fields and back preserves string rules', () => {
    const fields = rulesToFormFields(realisticRules);
    expect(fields).toHaveLength(5);

    // About page (all string fields) should round-trip
    const aboutField = fields.find(f => f.pattern === '/about.ejs');
    expect(aboutField.title).toBe('About Us');
    expect(aboutField.ogType).toBe('website');
    expect(aboutField.sitemapToggle).toBe('custom');
    expect(aboutField.sitemapPriority).toBe('0.8');

    // Admin page sitemap excluded
    const adminField = fields.find(f => f.pattern === '/admin/**');
    expect(adminField.sitemapToggle).toBe('exclude');
    expect(adminField.robots).toBe('noindex, nofollow');
  });
});
