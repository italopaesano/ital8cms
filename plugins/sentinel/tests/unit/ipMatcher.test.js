const { normalizeIp, ipInCidr, ipMatchesAny, isValidCidr } = require('../../lib/ipMatcher');

describe('normalizeIp', () => {
  test('lascia intatto un IPv4 normale', () => {
    expect(normalizeIp('151.38.1.1')).toBe('151.38.1.1');
  });

  // È il caso che rompe le implementazioni ingenue: in ascolto dual-stack (la
  // configurazione di default) ctx.ip restituisce la forma IPv4-mapped, e senza
  // normalizzazione una allowlist su 151.38.0.0/16 non matcherebbe.
  test('riporta un IPv4-mapped alla forma IPv4', () => {
    expect(normalizeIp('::ffff:151.38.1.1')).toBe('151.38.1.1');
    expect(normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  test('rimuove lo zone index degli IPv6 link-local', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });

  test('non converte il loopback IPv6 in quello IPv4', () => {
    // ::1 e 127.0.0.1 sono indirizzi distinti: una regola che nomina l'uno non
    // deve catturare l'altro.
    expect(normalizeIp('::1')).toBe('::1');
  });

  test('tollera input non validi', () => {
    expect(normalizeIp(undefined)).toBe('');
    expect(normalizeIp('')).toBe('');
    expect(normalizeIp(42)).toBe('');
  });
});

describe('ipInCidr — IPv4', () => {
  test.each([
    ['10.1.2.3', '10.0.0.0/8', true],
    ['11.1.2.3', '10.0.0.0/8', false],
    ['192.168.1.5', '192.168.1.0/24', true],
    ['192.168.2.5', '192.168.1.0/24', false],
    ['127.0.0.1', '127.0.0.0/8', true],
    ['203.0.113.44', '203.0.113.44', true],   // senza /: prefisso pieno
    ['203.0.113.45', '203.0.113.44', false],
    ['1.2.3.4', '0.0.0.0/0', true],           // /0 matcha tutto
  ])('%s in %s → %s', (ip, cidr, expected) => {
    expect(ipInCidr(ip, cidr)).toBe(expected);
  });

  test('applica la maschera anche a prefissi non allineati al byte', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/30')).toBe(true);
    expect(ipInCidr('10.0.0.5', '10.0.0.0/30')).toBe(false);
  });

  test('un IPv4-mapped matcha la rete IPv4 corrispondente', () => {
    expect(ipInCidr('::ffff:10.1.2.3', '10.0.0.0/8')).toBe(true);
  });
});

describe('ipInCidr — IPv6', () => {
  test.each([
    ['2001:db8::1', '2001:db8::/32', true],
    ['2001:db9::1', '2001:db8::/32', false],
    ['::1', '::1', true],
    ['fe80::abcd', 'fe80::/10', true],
  ])('%s in %s → %s', (ip, cidr, expected) => {
    expect(ipInCidr(ip, cidr)).toBe(expected);
  });

  test('famiglie diverse non matchano mai', () => {
    expect(ipInCidr('2001:db8::1', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('10.0.0.1', '2001:db8::/32')).toBe(false);
  });
});

describe('ipInCidr — input malformati', () => {
  test.each([
    ['10.0.0.1', '10.0.0.0/33'],      // prefisso oltre il massimo
    ['10.0.0.1', 'non-un-indirizzo'],
    ['10.0.0.1', '10.0.0.0/abc'],
    ['999.1.1.1', '10.0.0.0/8'],      // ottetto fuori range
    ['', '10.0.0.0/8'],
  ])('non matcha e non lancia: %s / %s', (ip, cidr) => {
    expect(() => ipInCidr(ip, cidr)).not.toThrow();
    expect(ipInCidr(ip, cidr)).toBe(false);
  });
});

describe('ipMatchesAny', () => {
  test('vero se almeno una rete matcha', () => {
    expect(ipMatchesAny('10.1.1.1', ['192.168.0.0/16', '10.0.0.0/8'])).toBe(true);
  });

  test('falso su lista vuota o assente', () => {
    expect(ipMatchesAny('10.1.1.1', [])).toBe(false);
    expect(ipMatchesAny('10.1.1.1', undefined)).toBe(false);
  });
});

describe('isValidCidr', () => {
  test('accetta le forme valide', () => {
    ['10.0.0.0/8', '203.0.113.44', '2001:db8::/32', '::1'].forEach((c) => {
      expect(isValidCidr(c)).toBe(true);
    });
  });

  test('rifiuta le forme invalide', () => {
    ['', '10.0.0.0/99', 'ciao', '10.0.0.256/8', null].forEach((c) => {
      expect(isValidCidr(c)).toBe(false);
    });
  });
});
