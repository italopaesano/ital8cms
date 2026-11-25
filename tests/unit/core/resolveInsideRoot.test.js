/**
 * Unit test: il contenimento di un percorso dentro una radice × REVIEW.md → B5.
 *
 * Il difetto: `plugins/admin/pagesManagment.js` faceva
 *
 *     path.normalize(path.join(wwwPath, filePath)).startsWith(wwwPath)
 *
 * e `startsWith` su un percorso **senza il separatore finale** confronta
 * stringhe, non directory: `/…/wwwBackup/x.ejs` « inizia con » `/…/www` pur
 * essendo un'altra cartella. `path.normalize` non aveva nulla da risolvere,
 * perché `path.join` aveva già consumato il `..`. La guardia approvava.
 *
 * Il caso della prima tabella è esattamente quello, e la versione corretta
 * esisteva già nel progetto a due file di distanza da quella sbagliata.
 */

'use strict';

const path = require('path');
const { resolveInsideRoot, isInsideRoot } = require('../../../core/resolveInsideRoot');

const ROOT = path.join(path.sep, 'home', 'u', 'ital8cms', 'www');

describe('il separatore è il punto (B5)', () => {
  test.each([
    ['../wwwBackup/x.ejs',  'la sorella il cui nome INIZIA per www — il caso di B5'],
    ['../www2/x',           'un\'altra sorella con prefisso comune'],
    ['../../etc/passwd',    'risalita classica'],
    ['../',                 'la cartella padre'],
  ])('rifiuta %s (%s)', (rel) => {
    expect(resolveInsideRoot(ROOT, rel)).toBeNull();
    expect(isInsideRoot(ROOT, rel)).toBe(false);
  });

  test('la forma sbagliata avrebbe approvato il primo caso', () => {
    // Si misura il difetto, invece di fidarsi della descrizione: con `join` il
    // `..` viene consumato e la stringa risultante inizia davvero con la radice.
    const vecchiaForma = path.normalize(path.join(ROOT, '../wwwBackup/x.ejs')).startsWith(ROOT);
    expect(vecchiaForma).toBe(true);                       // ← approvava
    expect(isInsideRoot(ROOT, '../wwwBackup/x.ejs')).toBe(false);  // ← ora rifiuta
  });
});

describe('ciò che è dentro resta dentro', () => {
  test.each([
    ['pagina.ejs',          'un file'],
    ['sotto/pagina.ejs',    'una sottocartella'],
    ['sotto/../pagina.ejs', 'una risalita che non esce'],
    ['',                    'la radice stessa'],
    ['.',                   'la radice, scritta col punto'],
  ])('accetta %s (%s)', (rel) => {
    expect(isInsideRoot(ROOT, rel)).toBe(true);
  });

  test('restituisce il percorso assoluto risolto', () => {
    expect(resolveInsideRoot(ROOT, 'a/b.ejs')).toBe(path.join(ROOT, 'a', 'b.ejs'));
  });
});

describe('casi limite', () => {
  test('un percorso ASSOLUTO fuori dalla radice è rifiutato', () => {
    // Differenza dalla forma vecchia: `path.join(root, '/abs')` dava
    // `root/abs` (dentro), `path.resolve(root, '/abs')` dà `/abs` (fuori).
    // Più stretto, e più onesto: chi chiede un assoluto non chiede un relativo.
    expect(isInsideRoot(ROOT, path.join(path.sep, 'etc', 'passwd'))).toBe(false);
  });

  test('una radice assente o non stringa → null, non un\'eccezione', () => {
    expect(resolveInsideRoot(null, 'x')).toBeNull();
    expect(resolveInsideRoot(undefined, 'x')).toBeNull();
    expect(resolveInsideRoot('', 'x')).toBeNull();
  });

  test('un percorso assente vale la radice', () => {
    expect(resolveInsideRoot(ROOT, null)).toBe(ROOT);
    expect(resolveInsideRoot(ROOT, undefined)).toBe(ROOT);
  });

  test('una radice con separatore finale si comporta come senza', () => {
    expect(isInsideRoot(ROOT + path.sep, 'pagina.ejs')).toBe(true);
    expect(isInsideRoot(ROOT + path.sep, '../wwwBackup/x')).toBe(false);
  });
});

// ── I due punti d'uso ────────────────────────────────────────────────────────

describe('non esistono più due copie del controllo', () => {
  const fs = require('fs');
  const leggi = (rel) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

  test('isPathSafe delega al controllo condiviso', () => {
    const src = leggi('plugins/admin/pagesManagment.js');
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/core\/resolveInsideRoot['"]\)/);
    // L'invariante è la DELEGA, non il nome dell'argomento: dalla v3.51.0 il
    // percorso passa per una normalizzazione dello slash iniziale, quindi
    // l'argomento non si chiama più `filePath`. Inchiodare il presidio al nome
    // lo faceva cadere su una correzione corretta.
    expect(src).toMatch(/isInsideRoot\(getWwwPath\(\),\s*\w+\)/);
    // La forma sbagliata non deve più comparire nel codice.
    expect(src).not.toMatch(/normalizedPath\.startsWith\(wwwPath\)/);
  });

  test('mediaManager delega al controllo condiviso', () => {
    const src = leggi('plugins/adminMedia/lib/mediaManager.js');
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/\.\.\/core\/resolveInsideRoot['"]\)/);
  });

  test('resolveAbsPath non dirotta più sulla radice', () => {
    const src = leggi('plugins/adminMedia/lib/mediaManager.js');
    expect(src).not.toMatch(/safeResolve\(mediaRoot, relPath\) \|\| mediaRoot/);
  });
});
