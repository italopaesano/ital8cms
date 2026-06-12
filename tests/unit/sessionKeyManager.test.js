// Questo file segue lo standard del progetto ital8cms
'use strict';

const {
  generateSessionKeys,
  DEFAULT_KEY_COUNT,
  DEFAULT_KEY_BYTES,
} = require('../../scripts/lib/sessionKeyManager');
const { keysAreInsecure } = require('../../core/sessionSecurity');

describe('sessionKeyManager.generateSessionKeys', () => {
  test('di default genera DEFAULT_KEY_COUNT (3) chiavi', () => {
    expect(generateSessionKeys()).toHaveLength(3);
    expect(DEFAULT_KEY_COUNT).toBe(3);
  });

  test('le chiavi sono codificate base64url (solo [A-Za-z0-9_-])', () => {
    for (const key of generateSessionKeys()) {
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test('lunghezza coerente con 32 byte in base64url (43 caratteri, senza padding)', () => {
    for (const key of generateSessionKeys()) {
      expect(key).toHaveLength(43);
    }
    expect(DEFAULT_KEY_BYTES).toBe(32);
  });

  test('le chiavi generate sono uniche', () => {
    const keys = generateSessionKeys(5);
    expect(new Set(keys).size).toBe(5);
  });

  test('genera chiavi diverse a ogni chiamata (entropia)', () => {
    const first = generateSessionKeys();
    const second = generateSessionKeys();
    expect(first).not.toEqual(second);
  });

  test('rispetta count e bytes personalizzati', () => {
    const keys = generateSessionKeys(2, 16);
    expect(keys).toHaveLength(2);
    // 16 byte in base64url = 22 caratteri (senza padding)
    for (const key of keys) {
      expect(key).toHaveLength(22);
    }
  });

  test('le chiavi generate non sono mai considerate insicure', () => {
    expect(keysAreInsecure(generateSessionKeys())).toBe(false);
  });
});
