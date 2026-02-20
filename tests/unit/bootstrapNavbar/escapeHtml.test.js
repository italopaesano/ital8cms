/**
 * Unit Tests per escapeHtml()
 *
 * Funzione pura che sanitizza caratteri speciali HTML per prevenire XSS.
 * Testata direttamente (esportata da navbarRenderer.js).
 */

const { escapeHtml } = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');

describe('escapeHtml', () => {

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

  // ─── Combinazioni multiple ─────────────────────────────────────────────────

  describe('combinazioni multiple', () => {
    test('tutti e 5 i caratteri nella stessa stringa', () => {
      expect(escapeHtml(`<a href="x" title='y'>&`))
        .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
    });

    test('caratteri ripetuti consecutivi', () => {
      expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });

    test('& appare prima e dopo il replace', () => {
      // Il primo & viene sostituito con &amp;
      // I successivi & vengono sostituiti ma non rischiano doppio-encoding
      // perche replace opera sulla stringa originale
      expect(escapeHtml('a&b&c')).toBe('a&amp;b&amp;c');
    });
  });

  // ─── Stringhe sicure (nessuna sostituzione) ───────────────────────────────

  describe('stringhe sicure', () => {
    test('stringa senza caratteri speciali', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    test('stringa vuota', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('stringa con solo lettere e numeri', () => {
      expect(escapeHtml('abc123')).toBe('abc123');
    });

    test('stringa con caratteri speciali non-HTML', () => {
      expect(escapeHtml('hello@world.com #tag $price')).toBe('hello@world.com #tag $price');
    });

    test('stringa con Unicode', () => {
      expect(escapeHtml('Ciao Mondo 🎉 日本語')).toBe('Ciao Mondo 🎉 日本語');
    });
  });

  // ─── Input non-string ─────────────────────────────────────────────────────

  describe('input non-string', () => {
    test('null → stringa vuota', () => {
      expect(escapeHtml(null)).toBe('');
    });

    test('undefined → stringa vuota', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    test('numero → stringa vuota', () => {
      expect(escapeHtml(42)).toBe('');
    });

    test('booleano → stringa vuota', () => {
      expect(escapeHtml(true)).toBe('');
    });

    test('oggetto → stringa vuota', () => {
      expect(escapeHtml({ key: 'value' })).toBe('');
    });

    test('array → stringa vuota', () => {
      expect(escapeHtml(['a', 'b'])).toBe('');
    });

    test('zero → stringa vuota', () => {
      expect(escapeHtml(0)).toBe('');
    });
  });

  // ─── Scenari XSS realistici ───────────────────────────────────────────────

  describe('scenari XSS realistici', () => {
    test('script injection', () => {
      expect(escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('event handler injection', () => {
      expect(escapeHtml('onload="alert(1)"'))
        .toBe('onload=&quot;alert(1)&quot;');
    });

    test('href javascript injection', () => {
      expect(escapeHtml("javascript:alert('xss')"))
        .toBe('javascript:alert(&#39;xss&#39;)');
    });

    test('img onerror injection', () => {
      expect(escapeHtml('<img src=x onerror=alert(1)>'))
        .toBe('&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
