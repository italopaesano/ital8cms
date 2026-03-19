/**
 * Unit tests for urlRedirect/lib/redirectMatcher.js
 */

const {
  findMatch,
  normalizePath,
  normalizeFrom,
  matchWildcard,
  matchRegex,
  buildDestination,
  appendQueryString,
} = require('../../../plugins/urlRedirect/lib/redirectMatcher');

// ── Helper: default config ──
function defaultConfig(overrides = {}) {
  return {
    enableHitCounter: true,
    hitCounterFlushInterval: 30,
    preserveQueryString: true,
    normalizeTrailingSlash: true,
    caseSensitive: true,
    enablePatternMatching: true,
    enableRegex: true,
    allowExternalRedirects: false,
    enableLogging: false,
    strictValidation: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// normalizePath
// ══════════════════════════════════════════

describe('normalizePath', () => {
  test('removes trailing slash', () => {
    expect(normalizePath('/about/', defaultConfig())).toBe('/about');
  });

  test('does not remove trailing slash from root path', () => {
    expect(normalizePath('/', defaultConfig())).toBe('/');
  });

  test('keeps trailing slash when normalizeTrailingSlash is false', () => {
    expect(normalizePath('/about/', defaultConfig({ normalizeTrailingSlash: false }))).toBe('/about/');
  });

  test('lowercases when caseSensitive is false', () => {
    expect(normalizePath('/About/Page', defaultConfig({ caseSensitive: false }))).toBe('/about/page');
  });

  test('preserves case when caseSensitive is true', () => {
    expect(normalizePath('/About/Page', defaultConfig())).toBe('/About/Page');
  });

  test('applies both normalizations', () => {
    expect(normalizePath('/About/', defaultConfig({ caseSensitive: false }))).toBe('/about');
  });
});

// ══════════════════════════════════════════
// normalizeFrom
// ══════════════════════════════════════════

describe('normalizeFrom', () => {
  test('does not normalize regex patterns', () => {
    expect(normalizeFrom('regex:^/About/', defaultConfig({ caseSensitive: false }))).toBe('regex:^/About/');
  });

  test('normalizes non-regex patterns', () => {
    expect(normalizeFrom('/About/', defaultConfig({ caseSensitive: false }))).toBe('/about');
  });
});

// ══════════════════════════════════════════
// matchWildcard
// ══════════════════════════════════════════

describe('matchWildcard', () => {

  describe('single wildcard (*)', () => {
    test('matches single segment', () => {
      expect(matchWildcard('/blog/my-post', '/blog/*')).toBe('my-post');
    });

    test('does not match multiple segments', () => {
      expect(matchWildcard('/blog/2024/my-post', '/blog/*')).toBeNull();
    });

    test('matches with suffix', () => {
      expect(matchWildcard('/files/report.pdf', '/files/*.pdf')).toBe('report');
    });

    test('matches empty segment', () => {
      expect(matchWildcard('/blog/', '/blog/*')).toBe('');
    });

    test('does not match if prefix is wrong', () => {
      expect(matchWildcard('/news/post', '/blog/*')).toBeNull();
    });
  });

  describe('recursive wildcard (**)', () => {
    test('matches single segment', () => {
      expect(matchWildcard('/docs/guide', '/docs/**')).toBe('guide');
    });

    test('matches multiple segments', () => {
      expect(matchWildcard('/docs/guide/install/linux', '/docs/**')).toBe('guide/install/linux');
    });

    test('matches empty path', () => {
      expect(matchWildcard('/docs/', '/docs/**')).toBe('');
    });

    test('does not match if prefix is wrong', () => {
      expect(matchWildcard('/other/guide', '/docs/**')).toBeNull();
    });

    test('matches with suffix', () => {
      expect(matchWildcard('/docs/guide/index.html', '/docs/**/index.html')).toBe('guide');
    });
  });
});

// ══════════════════════════════════════════
// matchRegex
// ══════════════════════════════════════════

describe('matchRegex', () => {
  test('matches simple regex', () => {
    const result = matchRegex('/product/123', 'regex:^/product/(\\d+)$', defaultConfig());
    expect(result).not.toBeNull();
    expect(result[1]).toBe('123');
  });

  test('does not match when pattern does not match', () => {
    const result = matchRegex('/product/abc', 'regex:^/product/(\\d+)$', defaultConfig());
    expect(result).toBeNull();
  });

  test('case insensitive matching when caseSensitive is false', () => {
    const result = matchRegex('/Product/123', 'regex:^/product/(\\d+)$', defaultConfig({ caseSensitive: false }));
    expect(result).not.toBeNull();
  });

  test('case sensitive matching by default', () => {
    const result = matchRegex('/Product/123', 'regex:^/product/(\\d+)$', defaultConfig());
    expect(result).toBeNull();
  });

  test('normalizes trailing slash before regex matching', () => {
    const result = matchRegex('/product/123/', 'regex:^/product/(\\d+)$', defaultConfig());
    expect(result).not.toBeNull();
    expect(result[1]).toBe('123');
  });

  test('multiple capture groups', () => {
    const result = matchRegex('/blog/2024/my-post', 'regex:^/blog/(\\d{4})/(.+)$', defaultConfig());
    expect(result).not.toBeNull();
    expect(result[1]).toBe('2024');
    expect(result[2]).toBe('my-post');
  });
});

// ══════════════════════════════════════════
// buildDestination
// ══════════════════════════════════════════

describe('buildDestination', () => {
  test('exact match returns "to" as-is', () => {
    expect(buildDestination('/new-page', null, 'exact')).toBe('/new-page');
  });

  test('wildcard replaces * with captured segment', () => {
    expect(buildDestination('/articles/*', 'my-post', 'wildcard')).toBe('/articles/my-post');
  });

  test('wildcard replaces ** with captured path', () => {
    expect(buildDestination('/new/**', 'guide/install', 'wildcard')).toBe('/new/guide/install');
  });

  test('regex replaces $1 with captured group', () => {
    const captured = ['/product/123', '123'];
    expect(buildDestination('/products/$1', captured, 'regex')).toBe('/products/123');
  });

  test('regex replaces multiple capture groups', () => {
    const captured = ['/blog/2024/post', '2024', 'post'];
    expect(buildDestination('/archive/$1/$2', captured, 'regex')).toBe('/archive/2024/post');
  });

  test('regex handles missing capture group', () => {
    const captured = ['/product/123', '123'];
    expect(buildDestination('/products/$1/$2', captured, 'regex')).toBe('/products/123/');
  });

  test('wildcard with no * in destination returns as-is', () => {
    expect(buildDestination('/fixed-page', 'captured', 'wildcard')).toBe('/fixed-page');
  });
});

// ══════════════════════════════════════════
// appendQueryString
// ══════════════════════════════════════════

describe('appendQueryString', () => {
  test('appends query string with ?', () => {
    expect(appendQueryString('/new', 'page=2&sort=name')).toBe('/new?page=2&sort=name');
  });

  test('appends query string with & when destination already has query', () => {
    expect(appendQueryString('/new?lang=en', 'page=2')).toBe('/new?lang=en&page=2');
  });

  test('returns destination unchanged when query is empty', () => {
    expect(appendQueryString('/new', '')).toBe('/new');
  });

  test('returns destination unchanged when query is undefined', () => {
    expect(appendQueryString('/new', undefined)).toBe('/new');
  });
});

// ══════════════════════════════════════════
// findMatch (integration of all matching logic)
// ══════════════════════════════════════════

describe('findMatch', () => {
  const rules = [
    { from: '/exact-page', to: '/new-exact', type: 301 },
    { from: '/blog/*', to: '/articles/*', type: 301 },
    { from: '/old-docs/**', to: '/docs/**', type: 301 },
    { from: 'regex:^/product/(\\d+)\\.html$', to: '/products/$1', type: 301 },
    { from: '/promo', to: '/offers', type: 302 },
  ];

  test('matches exact path', () => {
    const result = findMatch('/exact-page', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('exact');
    expect(result.destination).toBe('/new-exact');
  });

  test('matches single wildcard', () => {
    const result = findMatch('/blog/my-post', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('wildcard');
    expect(result.destination).toBe('/articles/my-post');
  });

  test('matches recursive wildcard', () => {
    const result = findMatch('/old-docs/guide/install', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('wildcard');
    expect(result.destination).toBe('/docs/guide/install');
  });

  test('matches regex pattern', () => {
    const result = findMatch('/product/42.html', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('regex');
    expect(result.destination).toBe('/products/42');
  });

  test('returns null for unmatched path', () => {
    const result = findMatch('/unknown-page', rules, defaultConfig());
    expect(result).toBeNull();
  });

  test('first-match-wins: first rule takes precedence', () => {
    const overlappingRules = [
      { from: '/blog/*', to: '/first/*', type: 301 },
      { from: '/blog/*', to: '/second/*', type: 301 },
    ];
    const result = findMatch('/blog/post', overlappingRules, defaultConfig());
    expect(result.destination).toBe('/first/post');
  });

  test('skips wildcard rules when enablePatternMatching is false', () => {
    const result = findMatch('/blog/my-post', rules, defaultConfig({ enablePatternMatching: false }));
    // Should not match /blog/* rule
    expect(result).toBeNull();
  });

  test('skips regex rules when enableRegex is false', () => {
    const result = findMatch('/product/42.html', rules, defaultConfig({ enableRegex: false }));
    expect(result).toBeNull();
  });

  test('normalizes trailing slash for matching', () => {
    const result = findMatch('/exact-page/', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.destination).toBe('/new-exact');
  });

  test('case insensitive matching', () => {
    const result = findMatch('/EXACT-PAGE', rules, defaultConfig({ caseSensitive: false }));
    expect(result).not.toBeNull();
    expect(result.destination).toBe('/new-exact');
  });

  test('case sensitive matching does not match different case', () => {
    const result = findMatch('/EXACT-PAGE', rules, defaultConfig());
    expect(result).toBeNull();
  });

  test('returns correct type from rule', () => {
    const result = findMatch('/promo', rules, defaultConfig());
    expect(result).not.toBeNull();
    expect(result.rule.type).toBe(302);
  });

  test('returns null for empty rules array', () => {
    const result = findMatch('/any-path', [], defaultConfig());
    expect(result).toBeNull();
  });
});
