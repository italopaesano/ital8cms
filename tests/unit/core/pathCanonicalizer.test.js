/**
 * Unit Tests: core/pathCanonicalizer
 *
 * Copre le due funzioni condivise dai layer A (canonicalizePath) e B
 * (isCanonicalPath) della difesa contro il path/URL normalization mismatch
 * (audit sicurezza #1).
 */

const { canonicalizePath, isCanonicalPath } = require('../../../core/pathCanonicalizer');

describe('pathCanonicalizer.canonicalizePath', () => {
  test.each([
    ['/admin/usersManagment/index.ejs', '/admin/usersManagment/index.ejs'],
    ['/', '/'],
    ['/admin/', '/admin/'],                          // slash finale preservato
    ['/./admin/x', '/admin/x'],                       // dot-segment iniziale
    ['/admin/./x', '/admin/x'],                       // dot-segment interno
    ['/x/../admin/x', '/admin/x'],                    // parent traversal risolto
    ['//admin//x', '/admin/x'],                       // slash duplicati collassati
    ['/./admin/./x', '/admin/x'],                     // combinazione
    ['/admin/../../etc/passwd', '/etc/passwd'],       // non risale oltre la root
    ['/admin/sub/..', '/admin'],                      // trailing ..
  ])('canonicalizePath(%j) === %j', (input, expected) => {
    expect(canonicalizePath(input)).toBe(expected);
  });

  test('input non stringa/vuoto restituito invariato', () => {
    expect(canonicalizePath('')).toBe('');
    expect(canonicalizePath(undefined)).toBe(undefined);
    expect(canonicalizePath(null)).toBe(null);
  });

  test('NON decodifica le percent-encoding (compito di B, non di A)', () => {
    // %2e / %2f restano tali: A non "indovina" la semantica del file server.
    expect(canonicalizePath('/admin%2fx')).toBe('/admin%2fx');
    expect(canonicalizePath('/%2e/admin')).toBe('/%2e/admin');
  });
});

describe('pathCanonicalizer.isCanonicalPath', () => {
  describe('path canonici → true', () => {
    test.each([
      '/admin/usersManagment/index.ejs',
      '/',
      '/admin/',
      '/normal/page.ejs',
      '/with%20space.ejs',       // %20 (spazio) è innocuo, non rifiutato
      '/api/adminUsers/userList',
    ])('%j → true', (p) => {
      expect(isCanonicalPath(p)).toBe(true);
    });

    test('input non stringa/vuoto → true (niente da rifiutare)', () => {
      expect(isCanonicalPath('')).toBe(true);
      expect(isCanonicalPath(undefined)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // REGRESSIONE — falsi positivi da NON rifiutare mai.
  // Blinda i casi legittimi che "sembrano" sospetti ma sono validi, così una
  // futura modifica troppo severa del gate B viene subito colta.
  // ────────────────────────────────────────────────────────────────────────
  describe('regressione — path legittimi mai rifiutati', () => {
    test.each([
      // Let's Encrypt / ACME HTTP-01 challenge (ital8Config → https.acmeChallenge)
      ['/.well-known/acme-challenge/tokenABC123', 'ACME challenge'],

      // Spazi: devono passare sia nei FILE sia nelle CARTELLE, encoded e letterali.
      ['/file with space.ejs', 'spazio letterale nel FILE'],
      ['/file%20with%20space.ejs', 'spazio %20 nel FILE'],
      ['/my folder/page.ejs', 'spazio letterale nella CARTELLA'],
      ['/my%20folder/report final.pdf', 'spazio nella cartella (%20) e nel file'],
      ['/a b/c d/e f.ejs', 'spazi in più cartelle e file'],
      ['/images/photo (1).jpg', 'spazio + parentesi nel FILE'],

      // Punti nel NOME (non dot-segment): mai toccati.
      ['/downloads/my..file.txt', 'doppio punto nel nome file'],
      ['/archive..tar.gz', 'doppio punto nel nome file'],
      ['/v1.2.3/release.zip', 'punti singoli in cartella'],
      ['/a.b.c/page.ejs', 'punti multipli in cartella'],

      // Hidden / leading-dot: segmento che inizia per '.' ma non è '.'/'..'.
      ['/.gitignore', 'hidden file'],
      ['/.env.example', 'leading dot'],

      // Unicode.
      ['/résumé.pdf', 'unicode'],
      ['/文档/página.ejs', 'unicode in cartella e file'],
    ])('%j (%s) → isCanonicalPath true e canonicalizePath invariato', (p) => {
      expect(isCanonicalPath(p)).toBe(true);
      expect(canonicalizePath(p)).toBe(p);
    });
  });

  describe('path non canonici / pericolosi → false', () => {
    test.each([
      ['/./admin/x', 'dot-segment'],
      ['/x/../admin/x', 'parent traversal'],
      ['//admin/x', 'slash doppi'],
      ['/admin/../../etc/passwd', 'traversal profondo'],
      ['/admin\\x', 'backslash'],
      ['/%2e/admin', 'dot percent-encoded'],
      ['/admin%2fx', 'slash percent-encoded'],
      ['/admin%2Fx', 'slash percent-encoded (maiuscolo)'],
      ['/admin%5cx', 'backslash percent-encoded'],
      ['/admin%00', 'NUL percent-encoded'],
      ['/admin\x00x', 'NUL letterale'],
      ['/admin\x1fx', 'control char'],
    ])('%j (%s) → false', (p) => {
      expect(isCanonicalPath(p)).toBe(false);
    });
  });
});
