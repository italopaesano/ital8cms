/**
 * Unit Tests: PatternMatcher
 *
 * Testa la logica di pattern matching per URL usata dal sistema di access control.
 * Copre: match esatto, wildcard singolo, wildcard ricorsivo, regex, priorità.
 */

const PatternMatcher = require('../../plugins/adminAccessControl/lib/patternMatcher');

describe('PatternMatcher', () => {
  let matcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  // ========================================================================
  // getPatternInfo - Tipo e priorità pattern
  // ========================================================================
  describe('getPatternInfo', () => {
    test('should identify exact match patterns', () => {
      const info = matcher.getPatternInfo('/admin/users');
      expect(info.type).toBe('exact');
      expect(info.priority).toBe(1000);
    });

    test('should identify wildcard-single patterns', () => {
      const info = matcher.getPatternInfo('/admin/*');
      expect(info.type).toBe('wildcard-single');
      expect(info.priority).toBe(300);
    });

    test('should identify wildcard-recursive patterns', () => {
      const info = matcher.getPatternInfo('/admin/**');
      expect(info.type).toBe('wildcard-recursive');
      expect(info.priority).toBe(100);
    });

    test('should identify regex patterns', () => {
      const info = matcher.getPatternInfo('regex:^/api/user/\\d+$');
      expect(info.type).toBe('regex');
      expect(info.priority).toBe(500);
    });

    test('should treat paths without wildcards as exact', () => {
      const info = matcher.getPatternInfo('/pluginPages/adminUsers/login.ejs');
      expect(info.type).toBe('exact');
    });
  });

  // ========================================================================
  // Exact Match
  // ========================================================================
  describe('matchExact', () => {
    test('should match identical URLs', () => {
      expect(matcher.matches('/admin/users', '/admin/users')).toBe(true);
    });

    test('should NOT match different URLs', () => {
      expect(matcher.matches('/admin/users', '/admin/settings')).toBe(false);
    });

    test('should NOT match partial URLs', () => {
      expect(matcher.matches('/admin/users/edit', '/admin/users')).toBe(false);
    });

    test('should NOT match prefix of URL', () => {
      expect(matcher.matches('/admin', '/admin/users')).toBe(false);
    });

    test('should be case-sensitive', () => {
      expect(matcher.matches('/Admin/Users', '/admin/users')).toBe(false);
    });
  });

  // ========================================================================
  // Wildcard Single (*)
  // ========================================================================
  describe('matchWildcardSingle', () => {
    test('should match single path segment', () => {
      expect(matcher.matches('/admin/users', '/admin/*')).toBe(true);
    });

    test('should match different single segments', () => {
      expect(matcher.matches('/admin/settings', '/admin/*')).toBe(true);
    });

    test('should NOT match multiple path segments', () => {
      expect(matcher.matches('/admin/users/edit', '/admin/*')).toBe(false);
    });

    test('should match with extension pattern', () => {
      expect(matcher.matches('/content/page.ejs', '/content/*.ejs')).toBe(true);
    });

    test('should NOT match empty segment', () => {
      expect(matcher.matches('/admin/', '/admin/*')).toBe(false);
    });
  });

  // ========================================================================
  // Wildcard Recursive (**)
  // ========================================================================
  describe('matchWildcardRecursive', () => {
    test('should match single level path', () => {
      expect(matcher.matches('/admin/users', '/admin/**')).toBe(true);
    });

    test('should match deep nested paths', () => {
      expect(matcher.matches('/admin/users/edit/123', '/admin/**')).toBe(true);
    });

    test('should match two levels', () => {
      expect(matcher.matches('/admin/users/edit', '/admin/**')).toBe(true);
    });

    test('should match with extension', () => {
      expect(matcher.matches('/admin/settings/index.ejs', '/admin/**')).toBe(true);
    });

    test('should NOT match unrelated paths', () => {
      expect(matcher.matches('/api/users', '/admin/**')).toBe(false);
    });

    test('should match empty suffix', () => {
      // /admin/** should match /admin/ (** matches empty)
      expect(matcher.matches('/admin/', '/admin/**')).toBe(true);
    });
  });

  // ========================================================================
  // Regex Patterns
  // ========================================================================
  describe('matchRegex', () => {
    test('should match regex pattern for numeric IDs', () => {
      expect(matcher.matches('/api/user/123', 'regex:^/api/user/\\d+$')).toBe(true);
    });

    test('should NOT match non-numeric for numeric regex', () => {
      expect(matcher.matches('/api/user/abc', 'regex:^/api/user/\\d+$')).toBe(false);
    });

    test('should match PDF file pattern', () => {
      expect(matcher.matches('/download/report.pdf', 'regex:^/download/.*\\.pdf$')).toBe(true);
    });

    test('should NOT match non-PDF for PDF regex', () => {
      expect(matcher.matches('/download/report.doc', 'regex:^/download/.*\\.pdf$')).toBe(false);
    });

    test('should handle invalid regex gracefully', () => {
      // Invalid regex should return false, not throw
      expect(matcher.matches('/test', 'regex:[invalid')).toBe(false);
    });

    test('should cache compiled regex patterns', () => {
      // First call compiles and caches
      matcher.matches('/test/123', 'regex:^/test/\\d+$');
      // Second call uses cache
      matcher.matches('/test/456', 'regex:^/test/\\d+$');
      expect(matcher.regexCache.has('^/test/\\d+$')).toBe(true);
    });
  });

  // ========================================================================
  // findMatchingRule - Priority Resolution
  // ========================================================================
  describe('findMatchingRule', () => {
    test('should return null when no rules match', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] }
      };
      const result = matcher.findMatchingRule('/public/page', rules);
      expect(result).toBeNull();
    });

    test('should return matching rule', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] }
      };
      const result = matcher.findMatchingRule('/admin/dashboard', rules);
      expect(result).not.toBeNull();
      expect(result.requiresAuth).toBe(true);
    });

    test('should prefer exact match over wildcard', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] },
        '/admin/users': { requiresAuth: true, allowedRoles: [0, 1, 2] }
      };
      const result = matcher.findMatchingRule('/admin/users', rules);
      expect(result.allowedRoles).toEqual([0, 1, 2]); // Exact match wins
    });

    test('should prefer regex over wildcard-recursive', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] },
        'regex:^/admin/.*': { requiresAuth: true, allowedRoles: [0] }
      };
      const result = matcher.findMatchingRule('/admin/settings', rules);
      expect(result.allowedRoles).toEqual([0]); // Regex (500) > wildcard-recursive (100)
    });

    test('should prefer wildcard-single over wildcard-recursive', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1] },
        '/admin/*': { requiresAuth: true, allowedRoles: [0, 1, 2] }
      };
      const result = matcher.findMatchingRule('/admin/users', rules);
      expect(result.allowedRoles).toEqual([0, 1, 2]); // Single (300) > recursive (100)
    });

    test('should use custom priority from rule when defined', () => {
      const rules = {
        '/admin': { requiresAuth: true, allowedRoles: [0, 1], priority: 1000 },
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100 }
      };
      const result = matcher.findMatchingRule('/admin', rules);
      expect(result.priority).toBe(1000); // Custom priority on exact match
    });

    test('should handle multiple matching rules correctly', () => {
      const rules = {
        '/admin/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100 },
        '/admin/*': { requiresAuth: true, allowedRoles: [0, 1, 2] },
        '/admin/users': { requiresAuth: true, allowedRoles: [0, 1, 2, 3] },
        'regex:^/admin/users$': { requiresAuth: true, allowedRoles: [0] }
      };
      // For /admin/users: exact (1000) > regex (500) > single (300) > recursive (100)
      const result = matcher.findMatchingRule('/admin/users', rules);
      expect(result.allowedRoles).toEqual([0, 1, 2, 3]); // Exact match wins
    });
  });

  // ========================================================================
  // validatePattern
  // ========================================================================
  describe('validatePattern', () => {
    test('should accept valid exact patterns', () => {
      const result = matcher.validatePattern('/admin/users');
      expect(result.valid).toBe(true);
    });

    test('should accept valid wildcard patterns', () => {
      expect(matcher.validatePattern('/admin/*').valid).toBe(true);
      expect(matcher.validatePattern('/admin/**').valid).toBe(true);
    });

    test('should accept valid regex patterns', () => {
      const result = matcher.validatePattern('regex:^/api/\\d+$');
      expect(result.valid).toBe(true);
    });

    test('should reject invalid regex patterns', () => {
      const result = matcher.validatePattern('regex:[invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid regex');
    });

    test('should reject empty patterns', () => {
      const result = matcher.validatePattern('');
      expect(result.valid).toBe(false);
    });

    test('should reject null patterns', () => {
      const result = matcher.validatePattern(null);
      expect(result.valid).toBe(false);
    });

    test('should reject patterns with whitespace', () => {
      const result = matcher.validatePattern('/admin /users');
      expect(result.valid).toBe(false);
    });
  });
});
