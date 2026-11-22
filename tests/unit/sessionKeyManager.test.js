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

describe('sessionKeyManager.generateSessionKeys — entropyContribution', () => {
  const CONTRIBUTO = 'questo testo lo digita chi installa';

  test('con un contributo le chiavi restano base64url e della stessa lunghezza', () => {
    // SHA-256 produce 32 byte, quindi 43 caratteri base64url: identico al ramo
    // senza contributo. Chi legge il file non vede due formati diversi.
    for (const key of generateSessionKeys(DEFAULT_KEY_COUNT, DEFAULT_KEY_BYTES, CONTRIBUTO)) {
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(key).toHaveLength(43);
    }
  });

  test('NON è riproducibile: lo stesso contributo dà chiavi diverse', () => {
    // È la proprietà che distingue un contributo di entropia da un SEME, ed è il
    // motivo per cui non si chiama seme. Se fosse riproducibile, chi lo
    // conservasse custodirebbe un segreto di pari valore alle chiavi.
    const a = generateSessionKeys(3, 32, CONTRIBUTO);
    const b = generateSessionKeys(3, 32, CONTRIBUTO);
    expect(a).not.toEqual(b);
  });

  test('le chiavi restano indipendenti fra loro a parità di contributo', () => {
    // Ogni chiave riceve materiale casuale FRESCO: se il contributo fosse l'unico
    // ingrediente, le tre chiavi di una stessa chiamata sarebbero identiche — e
    // la rotazione di koa-session non avrebbe più senso.
    const keys = generateSessionKeys(5, 32, CONTRIBUTO);
    expect(new Set(keys).size).toBe(5);
  });

  test('un contributo VUOTO non cambia il comportamento (nessuna degradazione)', () => {
    for (const vuoto of ['', undefined, null, 42, {}]) {
      const keys = generateSessionKeys(2, 32, vuoto);
      expect(keys).toHaveLength(2);
      for (const key of keys) {
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(key).toHaveLength(43);
      }
      expect(keysAreInsecure(keys)).toBe(false);
    }
  });

  test('MAI PEGGIO di randomBytes da solo: un contributo banale non indebolisce', () => {
    // La proprietà centrale della costruzione, garantita dall'ordine degli
    // argomenti: il materiale casuale entra per primo e per intero, quindi
    // nemmeno il contributo più prevedibile riduce lo spazio delle chiavi.
    // La forma da non scrivere — SHA-256(contributo) senza il casuale —
    // renderebbe queste due chiamate IDENTICHE.
    const banale = 'a';
    const prima = generateSessionKeys(1, 32, banale)[0];
    const dopo = generateSessionKeys(1, 32, banale)[0];
    expect(prima).not.toBe(dopo);
    expect(keysAreInsecure([prima])).toBe(false);
  });

  test('un contributo non produce mai chiavi che il gate rifiuterebbe', () => {
    // Comprese le forme che potrebbero collidere coi criteri del gate: nessun
    // contributo può far nascere una chiave col prefisso CHANGE_ME_ o corta.
    for (const contributo of ['CHANGE_ME_', 'brtnrynynyny', ' ', '🔑', 'a'.repeat(5000)]) {
      expect(keysAreInsecure(generateSessionKeys(3, 32, contributo))).toBe(false);
    }
  });
});
