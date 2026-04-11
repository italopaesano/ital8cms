/**
 * Unit tests for mailer/lib/htmlToText.js
 */

'use strict';

const htmlToText = require('../../../plugins/mailer/lib/htmlToText');

// ══════════════════════════════════════════
// htmlToText
// ══════════════════════════════════════════

describe('htmlToText', () => {

  // ── Edge cases: input non validi ──

  describe('invalid / empty input', () => {
    test('returns empty string for null', () => {
      expect(htmlToText(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(htmlToText(undefined)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(htmlToText('')).toBe('');
    });

    test('returns empty string for number', () => {
      expect(htmlToText(42)).toBe('');
    });

    test('returns plain text unchanged (no tags)', () => {
      expect(htmlToText('Ciao mondo')).toBe('Ciao mondo');
    });
  });

  // ── Rimozione style e script ──

  describe('style and script removal', () => {
    test('removes <style> block entirely', () => {
      const html = '<style>body { color: red; } p { margin: 0; }</style><p>Testo</p>';
      const result = htmlToText(html);
      expect(result).not.toContain('color');
      expect(result).not.toContain('margin');
      expect(result).toContain('Testo');
    });

    test('removes <script> block entirely', () => {
      const html = '<script>alert("xss")</script><p>Testo</p>';
      const result = htmlToText(html);
      expect(result).not.toContain('alert');
      expect(result).not.toContain('xss');
      expect(result).toContain('Testo');
    });

    test('removes multiline <style> block', () => {
      const html = '<style>\n  body {\n    color: red;\n  }\n</style><p>OK</p>';
      const result = htmlToText(html);
      expect(result).not.toContain('body');
      expect(result).toContain('OK');
    });
  });

  // ── Conversione tag di blocco in newline ──

  describe('block tag conversion', () => {
    test('converts <br> to newline', () => {
      const result = htmlToText('Riga 1<br>Riga 2');
      expect(result).toContain('\n');
      expect(result).toContain('Riga 1');
      expect(result).toContain('Riga 2');
    });

    test('converts <br/> to newline', () => {
      const result = htmlToText('Riga 1<br/>Riga 2');
      expect(result).toContain('\n');
    });

    test('converts </p> to double newline', () => {
      const result = htmlToText('<p>Paragrafo 1</p><p>Paragrafo 2</p>');
      expect(result).toContain('\n\n');
      expect(result).toContain('Paragrafo 1');
      expect(result).toContain('Paragrafo 2');
    });

    test('converts </div> to newline', () => {
      const result = htmlToText('<div>Blocco 1</div><div>Blocco 2</div>');
      expect(result).toContain('\n');
    });

    test('converts </h1>-</h6> to double newline', () => {
      for (let i = 1; i <= 6; i++) {
        // Add content after the heading so trim() doesn't remove trailing \n\n
        const result = htmlToText(`<h${i}>Titolo</h${i}><p>Contenuto</p>`);
        expect(result).toContain('\n\n');
      }
    });

    test('converts </li> to newline', () => {
      const result = htmlToText('<ul><li>Voce 1</li><li>Voce 2</li></ul>');
      expect(result).toContain('\n');
      expect(result).toContain('Voce 1');
      expect(result).toContain('Voce 2');
    });
  });

  // ── Rimozione tag generici ──

  describe('generic tag removal', () => {
    test('removes <a> tags preserving text', () => {
      const result = htmlToText('<a href="https://example.com">Clicca qui</a>');
      expect(result).toBe('Clicca qui');
    });

    test('removes <strong> and <em> preserving text', () => {
      const result = htmlToText('<strong>Grassetto</strong> e <em>corsivo</em>');
      expect(result).toBe('Grassetto e corsivo');
    });

    test('removes nested tags', () => {
      const result = htmlToText('<div><p><strong>Testo</strong></p></div>');
      expect(result).toContain('Testo');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });
  });

  // ── Decode entità HTML ──

  describe('HTML entity decoding', () => {
    test('decodes &amp;', () => {
      expect(htmlToText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    });

    test('decodes &lt; and &gt;', () => {
      expect(htmlToText('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0');
    });

    test('decodes &quot;', () => {
      expect(htmlToText('He said &quot;hello&quot;')).toBe('He said "hello"');
    });

    test("decodes &#39;", () => {
      expect(htmlToText("It&#39;s fine")).toBe("It's fine");
    });

    test('decodes &nbsp;', () => {
      const result = htmlToText('Hello&nbsp;World');
      expect(result).toBe('Hello World');
    });

    test('decodes &ndash;', () => {
      expect(htmlToText('2020&ndash;2024')).toBe('2020-2024');
    });

    test('decodes &mdash;', () => {
      expect(htmlToText('Nota&mdash;importante')).toBe('Nota--importante');
    });
  });

  // ── Normalizzazione spazi e newline ──

  describe('whitespace normalization', () => {
    test('collapses multiple spaces into one', () => {
      expect(htmlToText('Ciao   mondo')).toBe('Ciao mondo');
    });

    test('collapses tabs into single space', () => {
      expect(htmlToText('Ciao\t\tmondo')).toBe('Ciao mondo');
    });

    test('limits consecutive newlines to max 2', () => {
      const result = htmlToText('<p>A</p><p></p><p></p><p>B</p>');
      expect(result).not.toMatch(/\n{3,}/);
    });

    test('trims leading and trailing whitespace', () => {
      expect(htmlToText('  Ciao  ')).toBe('Ciao');
    });
  });

  // ── Caso d'uso reale: email HTML ──

  describe('real-world email HTML', () => {
    test('converts a simple HTML email to readable text', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>body { font-family: Arial; }</style>
        </head>
        <body>
          <h1>Benvenuto!</h1>
          <p>Ciao <strong>Mario</strong>,</p>
          <p>Il tuo account &egrave; stato creato.</p>
          <a href="https://example.com/activate">Attiva l'account</a>
        </body>
        </html>
      `;
      const result = htmlToText(html);
      expect(result).toContain('Benvenuto!');
      expect(result).toContain('Mario');
      expect(result).not.toContain('<');
      expect(result).not.toContain('font-family');
    });
  });
});
