/**
 * Unit Tests per isActivePage()
 *
 * Compara l'href di un menu item con l'URL corrente per determinare
 * se la pagina e attiva. Normalizza trailing slashes e usa new URL()
 * con fallback a comparazione stringa semplice.
 */

const { isActivePage } = require('../../../plugins/bootstrapNavbar/lib/navbarRenderer');

describe('isActivePage', () => {

  // ─── Match esatto ──────────────────────────────────────────────────────────

  describe('match esatto', () => {
    test('path identici', () => {
      expect(isActivePage('/about', 'http://localhost:3000/about')).toBe(true);
    });

    test('root path /', () => {
      expect(isActivePage('/', 'http://localhost:3000/')).toBe(true);
    });

    test('path con segmenti multipli', () => {
      expect(isActivePage('/admin/users/edit', 'http://localhost:3000/admin/users/edit')).toBe(true);
    });
  });

  // ─── Normalizzazione trailing slashes ─────────────────────────────────────

  describe('normalizzazione trailing slashes', () => {
    test('item senza slash finale, URL con slash finale', () => {
      expect(isActivePage('/about', 'http://localhost:3000/about/')).toBe(true);
    });

    test('item con slash finale, URL senza slash finale', () => {
      expect(isActivePage('/about/', 'http://localhost:3000/about')).toBe(true);
    });

    test('entrambi con slash finale', () => {
      expect(isActivePage('/about/', 'http://localhost:3000/about/')).toBe(true);
    });

    test('path root senza trailing slash normalizzato', () => {
      // '/' non ha trailing slash da rimuovere → rimane '/'
      // '' (stringa vuota dopo remove) → diventa '/'
      expect(isActivePage('/', 'http://localhost:3000')).toBe(true);
    });

    test('multipli trailing slashes', () => {
      expect(isActivePage('/page///', 'http://localhost:3000/page')).toBe(true);
    });
  });

  // ─── Query string e fragment ignorati ─────────────────────────────────────

  describe('query string e fragment ignorati', () => {
    test('URL con query string match il path base', () => {
      expect(isActivePage('/page', 'http://localhost:3000/page?id=1&sort=asc')).toBe(true);
    });

    test('URL con fragment match il path base', () => {
      expect(isActivePage('/page', 'http://localhost:3000/page#section')).toBe(true);
    });

    test('URL con query string E fragment match il path base', () => {
      expect(isActivePage('/page', 'http://localhost:3000/page?id=1#section')).toBe(true);
    });

    test('path diversi anche con query string uguale', () => {
      expect(isActivePage('/other', 'http://localhost:3000/page?id=1')).toBe(false);
    });
  });

  // ─── Path che non matchano ─────────────────────────────────────────────────

  describe('path che non matchano', () => {
    test('path completamente diversi', () => {
      expect(isActivePage('/about', 'http://localhost:3000/contact')).toBe(false);
    });

    test('path simili ma diversi (prefix)', () => {
      expect(isActivePage('/admin', 'http://localhost:3000/admin/users')).toBe(false);
    });

    test('path simili ma diversi (suffix)', () => {
      expect(isActivePage('/admin/users', 'http://localhost:3000/admin')).toBe(false);
    });

    test('case sensitive', () => {
      expect(isActivePage('/About', 'http://localhost:3000/about')).toBe(false);
    });
  });

  // ─── Input falsy ──────────────────────────────────────────────────────────

  describe('input falsy', () => {
    test('itemHref null → false', () => {
      expect(isActivePage(null, 'http://localhost:3000/')).toBe(false);
    });

    test('itemHref undefined → false', () => {
      expect(isActivePage(undefined, 'http://localhost:3000/')).toBe(false);
    });

    test('itemHref stringa vuota → false', () => {
      expect(isActivePage('', 'http://localhost:3000/')).toBe(false);
    });

    test('currentHref null → false', () => {
      expect(isActivePage('/', null)).toBe(false);
    });

    test('currentHref undefined → false', () => {
      expect(isActivePage('/', undefined)).toBe(false);
    });

    test('currentHref stringa vuota → false', () => {
      expect(isActivePage('/', '')).toBe(false);
    });

    test('entrambi null → false', () => {
      expect(isActivePage(null, null)).toBe(false);
    });
  });

  // ─── Fallback string comparison ───────────────────────────────────────────

  describe('fallback string comparison (URL invalida)', () => {
    test('URL non parsabile fa fallback a comparazione diretta', () => {
      // new URL('not-a-url') lancia un errore → fallback
      expect(isActivePage('not-a-url', 'not-a-url')).toBe(true);
    });

    test('fallback: stringhe diverse → false', () => {
      expect(isActivePage('/page', 'not-a-url')).toBe(false);
    });

    test('path relativo come currentHref fa fallback', () => {
      // '/page' non è un URL valido per new URL() → fallback
      expect(isActivePage('/page', '/page')).toBe(true);
    });
  });

  // ─── Protocolli e domini ──────────────────────────────────────────────────

  describe('protocolli e domini', () => {
    test('HTTPS funziona come HTTP', () => {
      expect(isActivePage('/page', 'https://example.com/page')).toBe(true);
    });

    test('dominio diverso ma path uguale → true (solo pathname confrontato)', () => {
      expect(isActivePage('/page', 'http://other-domain.com/page')).toBe(true);
    });

    test('porta diversa ma path uguale → true', () => {
      expect(isActivePage('/page', 'http://localhost:8080/page')).toBe(true);
    });
  });

  // ─── Caratteri speciali nei path ──────────────────────────────────────────

  describe('caratteri speciali nei path', () => {
    test('path con trattini', () => {
      expect(isActivePage('/my-page', 'http://localhost:3000/my-page')).toBe(true);
    });

    test('path con underscore', () => {
      expect(isActivePage('/my_page', 'http://localhost:3000/my_page')).toBe(true);
    });

    test('path con .ejs estensione', () => {
      expect(isActivePage('/page.ejs', 'http://localhost:3000/page.ejs')).toBe(true);
    });
  });
});
