/**
 * Unit tests for getSafeRedirectUrl() — Open Redirect prevention
 * Tests the validation function exported from plugins/adminUsers/main.js
 */

const { _getSafeRedirectUrl: getSafeRedirectUrl } = require('../../plugins/adminUsers/main');

describe('getSafeRedirectUrl — Open Redirect prevention', () => {

  // ========== VALID INTERNAL PATHS ==========

  describe('valid internal paths (should pass through)', () => {
    test('root path /', () => {
      expect(getSafeRedirectUrl('/')).toBe('/');
    });

    test('simple internal path', () => {
      expect(getSafeRedirectUrl('/admin')).toBe('/admin');
    });

    test('nested internal path', () => {
      expect(getSafeRedirectUrl('/admin/users/edit')).toBe('/admin/users/edit');
    });

    test('path with query string', () => {
      expect(getSafeRedirectUrl('/page?id=1&lang=it')).toBe('/page?id=1&lang=it');
    });

    test('path with fragment', () => {
      expect(getSafeRedirectUrl('/page#section')).toBe('/page#section');
    });

    test('path with encoded characters', () => {
      expect(getSafeRedirectUrl('/search?q=hello%20world')).toBe('/search?q=hello%20world');
    });

    test('pluginPages path', () => {
      expect(getSafeRedirectUrl('/pluginPages/adminUsers/login.ejs')).toBe('/pluginPages/adminUsers/login.ejs');
    });

    test('API path', () => {
      expect(getSafeRedirectUrl('/api/adminUsers/userList')).toBe('/api/adminUsers/userList');
    });
  });

  // ========== EXTERNAL URLs (should be blocked) ==========

  describe('external URLs (should return fallback /)', () => {
    test('https external URL', () => {
      expect(getSafeRedirectUrl('https://evil.com')).toBe('/');
    });

    test('http external URL', () => {
      expect(getSafeRedirectUrl('http://evil.com')).toBe('/');
    });

    test('protocol-relative URL //evil.com', () => {
      expect(getSafeRedirectUrl('//evil.com')).toBe('/');
    });

    test('protocol-relative URL with path //evil.com/phishing', () => {
      expect(getSafeRedirectUrl('//evil.com/phishing')).toBe('/');
    });

    test('backslash variant /\\evil.com', () => {
      expect(getSafeRedirectUrl('/\\evil.com')).toBe('/');
    });

    test('javascript: protocol', () => {
      expect(getSafeRedirectUrl('javascript:alert(1)')).toBe('/');
    });

    test('data: protocol', () => {
      expect(getSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe('/');
    });

    test('ftp: protocol', () => {
      expect(getSafeRedirectUrl('ftp://evil.com/file')).toBe('/');
    });

    test('relative URL without leading slash', () => {
      expect(getSafeRedirectUrl('evil.com')).toBe('/');
    });

    test('relative URL that looks like domain', () => {
      expect(getSafeRedirectUrl('evil.com/path')).toBe('/');
    });
  });

  // ========== EDGE CASES ==========

  describe('edge cases (null, undefined, empty, whitespace)', () => {
    test('null returns /', () => {
      expect(getSafeRedirectUrl(null)).toBe('/');
    });

    test('undefined returns /', () => {
      expect(getSafeRedirectUrl(undefined)).toBe('/');
    });

    test('empty string returns /', () => {
      expect(getSafeRedirectUrl('')).toBe('/');
    });

    test('whitespace only returns /', () => {
      expect(getSafeRedirectUrl('   ')).toBe('/');
    });

    test('number returns /', () => {
      expect(getSafeRedirectUrl(42)).toBe('/');
    });

    test('object returns /', () => {
      expect(getSafeRedirectUrl({})).toBe('/');
    });

    test('array returns /', () => {
      expect(getSafeRedirectUrl([])).toBe('/');
    });

    test('boolean returns /', () => {
      expect(getSafeRedirectUrl(true)).toBe('/');
    });
  });

  // ========== WHITESPACE TRIMMING ==========

  describe('whitespace trimming', () => {
    test('leading whitespace is trimmed', () => {
      expect(getSafeRedirectUrl('  /admin')).toBe('/admin');
    });

    test('trailing whitespace is trimmed', () => {
      expect(getSafeRedirectUrl('/admin  ')).toBe('/admin');
    });

    test('whitespace before external URL is blocked', () => {
      expect(getSafeRedirectUrl('  https://evil.com')).toBe('/');
    });

    test('whitespace before protocol-relative URL is blocked', () => {
      expect(getSafeRedirectUrl('  //evil.com')).toBe('/');
    });
  });

  // ========== BYPASS ATTEMPTS ==========

  describe('common bypass attempts', () => {
    test('URL with @ sign (user@host trick)', () => {
      // /anything@evil.com still starts with / and not // so it stays internal
      // This is safe because browsers interpret it as a path, not a URL with credentials
      expect(getSafeRedirectUrl('/@evil.com')).toBe('/@evil.com');
    });

    test('URL with encoded slashes %2F%2F', () => {
      // %2F%2F is /, but the raw string starts with / not //
      // The server will interpret this as a path, not protocol-relative
      expect(getSafeRedirectUrl('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
    });

    test('mixed case protocol HTTPS://evil.com', () => {
      expect(getSafeRedirectUrl('HTTPS://evil.com')).toBe('/');
    });

    test('tab in URL', () => {
      // After trim, starts with h not /
      expect(getSafeRedirectUrl('\thttps://evil.com')).toBe('/');
    });

    test('newline in URL', () => {
      expect(getSafeRedirectUrl('\nhttps://evil.com')).toBe('/');
    });
  });
});
