'use strict';

const { generateToken, safeEqual } = require('../../lib/tokenManager');

describe('csrfProtection · tokenManager', () => {
  describe('generateToken', () => {
    test('ritorna una stringa non vuota', () => {
      const t = generateToken();
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    });

    test('usa alfabeto base64url (URL/attr-safe)', () => {
      for (let i = 0; i < 50; i++) {
        expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    test('256 bit → 43 caratteri base64url (senza padding)', () => {
      expect(generateToken().length).toBe(43);
    });

    test('genera valori unici (nessuna collisione su 1000 token)', () => {
      const set = new Set();
      for (let i = 0; i < 1000; i++) set.add(generateToken());
      expect(set.size).toBe(1000);
    });
  });

  describe('safeEqual', () => {
    test('true per stringhe identiche', () => {
      expect(safeEqual('abc123', 'abc123')).toBe(true);
    });

    test('false per stringhe diverse della stessa lunghezza', () => {
      expect(safeEqual('abc123', 'abc124')).toBe(false);
    });

    test('false per lunghezze diverse', () => {
      expect(safeEqual('abc', 'abcd')).toBe(false);
    });

    test('false per input non-stringa', () => {
      expect(safeEqual(null, 'x')).toBe(false);
      expect(safeEqual('x', undefined)).toBe(false);
      expect(safeEqual(123, 123)).toBe(false);
      expect(safeEqual({}, {})).toBe(false);
    });

    test('false per stringa vuota vs token', () => {
      expect(safeEqual('', generateToken())).toBe(false);
    });

    test('riconosce un token reale uguale a se stesso', () => {
      const t = generateToken();
      expect(safeEqual(t, t)).toBe(true);
    });
  });
});
