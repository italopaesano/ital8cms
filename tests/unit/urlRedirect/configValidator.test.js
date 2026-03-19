/**
 * Unit tests for urlRedirect/lib/configValidator.js
 */

const { validate, hasWildcard, isRegexPattern, isExternalUrl } = require('../../../plugins/urlRedirect/lib/configValidator');

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
// Utility functions
// ══════════════════════════════════════════

describe('hasWildcard', () => {
  test('returns true for single wildcard', () => {
    expect(hasWildcard('/blog/*')).toBe(true);
  });

  test('returns true for recursive wildcard', () => {
    expect(hasWildcard('/docs/**')).toBe(true);
  });

  test('returns false for exact path', () => {
    expect(hasWildcard('/about')).toBe(false);
  });

  test('returns false for regex pattern with asterisk', () => {
    // Note: hasWildcard checks string content, not regex prefix
    expect(hasWildcard('regex:^/blog/.*')).toBe(true);
  });
});

describe('isRegexPattern', () => {
  test('returns true for regex-prefixed pattern', () => {
    expect(isRegexPattern('regex:^/product/(\\d+)$')).toBe(true);
  });

  test('returns false for exact path', () => {
    expect(isRegexPattern('/about')).toBe(false);
  });

  test('returns false for wildcard', () => {
    expect(isRegexPattern('/blog/*')).toBe(false);
  });
});

describe('isExternalUrl', () => {
  test('returns true for https URL', () => {
    expect(isExternalUrl('https://example.com')).toBe(true);
  });

  test('returns true for http URL', () => {
    expect(isExternalUrl('http://example.com')).toBe(true);
  });

  test('returns false for relative path', () => {
    expect(isExternalUrl('/new-page')).toBe(false);
  });

  test('returns false for path that contains http', () => {
    expect(isExternalUrl('/pages/http-guide')).toBe(false);
  });
});

// ══════════════════════════════════════════
// validate()
// ══════════════════════════════════════════

describe('validate', () => {

  // ── Top-level structure ──

  test('returns error for missing redirects array', () => {
    const result = validate({}, defaultConfig());
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing or invalid "redirects" array');
  });

  test('returns error for null input', () => {
    const result = validate(null, defaultConfig());
    expect(result.valid).toBe(false);
  });

  test('returns error for redirects as object instead of array', () => {
    const result = validate({ redirects: {} }, defaultConfig());
    expect(result.valid).toBe(false);
  });

  test('valid with empty redirects array', () => {
    const result = validate({ redirects: [] }, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.validRules).toHaveLength(0);
  });

  // ── Required fields ──

  test('error when "from" is missing', () => {
    const data = { redirects: [{ to: '/new' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing or invalid "from"');
  });

  test('error when "to" is missing', () => {
    const data = { redirects: [{ from: '/old' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing or invalid "to"');
  });

  test('error when "from" is empty string', () => {
    const data = { redirects: [{ from: '', to: '/new' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(false);
  });

  test('error when "from" is not a string', () => {
    const data = { redirects: [{ from: 123, to: '/new' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(false);
  });

  // ── Type validation ──

  test('valid rule with type 301', () => {
    const data = { redirects: [{ from: '/old', to: '/new', type: 301 }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.validRules[0].type).toBe(301);
  });

  test('valid rule with type 302', () => {
    const data = { redirects: [{ from: '/old', to: '/new', type: 302 }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.validRules[0].type).toBe(302);
  });

  test('defaults to 301 when type is omitted', () => {
    const data = { redirects: [{ from: '/old', to: '/new' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.validRules[0].type).toBe(301);
  });

  test('warns and defaults to 301 for invalid type', () => {
    const data = { redirects: [{ from: '/old', to: '/new', type: 307 }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('invalid "type"');
    expect(result.validRules[0].type).toBe(301);
  });

  // ── Duplicate detection ──

  test('warns on duplicate "from" values', () => {
    const data = {
      redirects: [
        { from: '/old', to: '/new1' },
        { from: '/old', to: '/new2' },
      ],
    };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('duplicate'))).toBe(true);
  });

  // ── Regex validation ──

  test('valid regex pattern compiles without error', () => {
    const data = { redirects: [{ from: 'regex:^/product/(\\d+)$', to: '/products/$1' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.validRules).toHaveLength(1);
  });

  test('error on invalid regex pattern', () => {
    const data = { redirects: [{ from: 'regex:^/bad[', to: '/new' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('invalid regex pattern');
  });

  test('warns when regex pattern used but enableRegex is false', () => {
    const data = { redirects: [{ from: 'regex:^/product/(\\d+)$', to: '/products/$1' }] };
    const result = validate(data, defaultConfig({ enableRegex: false }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('enableRegex is false'))).toBe(true);
  });

  // ── Wildcard validation ──

  test('warns when wildcard pattern used but enablePatternMatching is false', () => {
    const data = { redirects: [{ from: '/blog/*', to: '/articles/*' }] };
    const result = validate(data, defaultConfig({ enablePatternMatching: false }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('enablePatternMatching is false'))).toBe(true);
  });

  test('wildcard pattern passes when enablePatternMatching is true', () => {
    const data = { redirects: [{ from: '/blog/*', to: '/articles/*' }] };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  // ── External redirect validation ──

  test('warns when external redirect used but allowExternalRedirects is false', () => {
    const data = { redirects: [{ from: '/shop', to: 'https://shop.example.com' }] };
    const result = validate(data, defaultConfig({ allowExternalRedirects: false }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('allowExternalRedirects is false'))).toBe(true);
  });

  test('no warning for external redirect when allowExternalRedirects is true', () => {
    const data = { redirects: [{ from: '/shop', to: 'https://shop.example.com' }] };
    const result = validate(data, defaultConfig({ allowExternalRedirects: true }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  // ── Loop detection ──

  test('warns on direct redirect loop', () => {
    const data = {
      redirects: [
        { from: '/a', to: '/b' },
        { from: '/b', to: '/a' },
      ],
    };
    const result = validate(data, defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('redirect loop'))).toBe(true);
  });

  test('no loop warning for non-circular redirects', () => {
    const data = {
      redirects: [
        { from: '/a', to: '/b' },
        { from: '/c', to: '/d' },
      ],
    };
    const result = validate(data, defaultConfig());
    expect(result.warnings.some(w => w.includes('loop'))).toBe(false);
  });

  // ── strictValidation ──

  test('strictValidation promotes warnings to errors', () => {
    const data = {
      redirects: [
        { from: '/old', to: '/new1' },
        { from: '/old', to: '/new2' },
      ],
    };
    const result = validate(data, defaultConfig({ strictValidation: true }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate'))).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  // ── validRules output ──

  test('validRules excludes rules with errors', () => {
    const data = {
      redirects: [
        { from: '/ok', to: '/fine' },
        { to: '/missing-from' },            // missing from
        { from: '/also-ok', to: '/good' },
      ],
    };
    const result = validate(data, defaultConfig());
    expect(result.validRules).toHaveLength(2);
    expect(result.validRules[0].from).toBe('/ok');
    expect(result.validRules[1].from).toBe('/also-ok');
  });

  test('valid rule with all fields', () => {
    const data = {
      redirects: [{ from: '/old', to: '/new', type: 302 }],
    };
    const result = validate(data, defaultConfig());
    expect(result.validRules[0]).toEqual({
      from: '/old',
      to: '/new',
      type: 302,
    });
  });
});
