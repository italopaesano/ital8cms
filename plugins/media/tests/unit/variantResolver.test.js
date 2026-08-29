// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/media/lib/variantResolver.js — la convenzione di naming delle
 * varianti immagine.
 *
 * PERCHÉ
 * ------
 * Il modulo decide come si chiamano le cartelle e i file delle varianti
 * responsive. È una **convenzione condivisa fra chi scrive e chi legge**: se
 * `variantFolderName()` e `originalNameFromVariantFolder()` smettessero di essere
 * l'una l'inversa dell'altra, le varianti resterebbero sul disco senza che nessuno
 * le trovi più — occupando spazio e non venendo mai servite. Nessun test le
 * copriva.
 *
 * Qui si esercitano le sole funzioni **pure**: naming, estensioni, normalizzazione
 * dei preset. Quelle che leggono il filesystem restano fuori.
 */

const path = require('path');

const {
  VARIANT_FOLDER_SUFFIX,
  DEFAULT_OPTIMIZABLE_EXTENSIONS,
  variantFolderName,
  isVariantFolderName,
  originalNameFromVariantFolder,
  variantFileName,
  getExtension,
  isOptimizableImage,
  presetWidths,
  variantFolderPathAbs,
} = require('../../lib/variantResolver');

describe('naming delle cartelle variante — andata e ritorno', () => {
  test('la cartella nasce dal nome del file, nascosta e con suffisso', () => {
    expect(variantFolderName('foto.jpg')).toBe(`.foto.jpg${VARIANT_FOLDER_SUFFIX}`);
  });

  test.each([
    'foto.jpg',
    'nome con spazi.png',
    'nome.con.molti.punti.webp',
    'MAIUSCOLO.JPG',
    'accentata-è.jpeg',
    'file-senza-estensione',
  ])('round-trip: "%s" torna identico dopo andata e ritorno', (originale) => {
    // È l'invariante che tiene insieme scrittura e lettura delle varianti.
    const cartella = variantFolderName(originale);
    expect(isVariantFolderName(cartella)).toBe(true);
    expect(originalNameFromVariantFolder(cartella)).toBe(originale);
  });

  test.each([
    ['cartella normale',        'immagini'],
    ['nascosta ma senza suffisso', '.git'],
    ['suffisso senza punto iniziale', `foto.jpg${VARIANT_FOLDER_SUFFIX}`],
    ['solo il suffisso',        `.${VARIANT_FOLDER_SUFFIX}`],
    ['stringa vuota',           ''],
  ])('%s NON è una cartella variante', (_caso, nome) => {
    expect(isVariantFolderName(nome)).toBe(false);
    expect(originalNameFromVariantFolder(nome)).toBeNull();
  });

  test('input non stringa non fa lanciare', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(isVariantFolderName(value)).toBe(false);
    }
  });

  test('il nome del file variante compone preset, larghezza e formato', () => {
    expect(variantFileName('web', 1920, 'webp')).toBe('web-1920.webp');
    expect(variantFileName('thumb', 320, 'avif')).toBe('thumb-320.avif');
  });
});

describe('getExtension()', () => {
  test.each([
    ['foto.jpg',        'jpg'],
    ['FOTO.JPG',        'jpg'],
    ['archivio.tar.gz', 'gz'],
    ['foto.WebP',       'webp'],
  ])('"%s" → "%s"', (nome, atteso) => {
    expect(getExtension(nome)).toBe(atteso);
  });

  test('file senza estensione → stringa vuota', () => {
    expect(getExtension('README')).toBe('');
  });

  test('un file che inizia col punto non è "tutto estensione"', () => {
    // `.gitignore` è un file nascosto senza estensione, non un file con
    // estensione "gitignore".
    expect(getExtension('.gitignore')).toBe('');
  });
});

describe('isOptimizableImage()', () => {
  test.each(DEFAULT_OPTIMIZABLE_EXTENSIONS)('%s è ottimizzabile', (ext) => {
    expect(isOptimizableImage(`foto.${ext}`)).toBe(true);
  });

  test('il confronto è insensibile al maiuscolo', () => {
    expect(isOptimizableImage('FOTO.JPG')).toBe(true);
  });

  test.each([
    ['GIF — l\'animazione andrebbe persa', 'animazione.gif'],
    ['BMP — raro, servito com\'è',         'immagine.bmp'],
    ['SVG — vettoriale',                   'logo.svg'],
    ['PDF — non è un\'immagine',           'documento.pdf'],
    ['senza estensione',                   'file'],
  ])('%s → NON ottimizzabile', (_caso, nome) => {
    expect(isOptimizableImage(nome)).toBe(false);
  });

  test('la lista delle estensioni è sovrascrivibile dal chiamante', () => {
    expect(isOptimizableImage('animazione.gif', ['gif'])).toBe(true);
    expect(isOptimizableImage('foto.jpg', ['gif'])).toBe(false);
  });
});

describe('presetWidths() — le due forme accettate del config', () => {
  test('array diretto di larghezze', () => {
    expect(presetWidths([320, 640, 1920])).toEqual([320, 640, 1920]);
  });

  test('oggetto con chiave widths', () => {
    expect(presetWidths({ widths: [320, 640] })).toEqual([320, 640]);
  });

  test('forme non riconosciute → array vuoto, mai undefined', () => {
    // Il chiamante itera il risultato: un `undefined` qui diventerebbe un crash
    // in fase di generazione delle varianti.
    for (const value of [undefined, null, {}, { widths: 'no' }, 42, 'stringa']) {
      expect(presetWidths(value)).toEqual([]);
    }
  });
});

describe('variantFolderPathAbs()', () => {
  test('la cartella variante sta ACCANTO all\'originale, non dentro', () => {
    const abs = path.join('/srv', 'media', '2026', 'foto.jpg');
    expect(variantFolderPathAbs(abs))
      .toBe(path.join('/srv', 'media', '2026', `.foto.jpg${VARIANT_FOLDER_SUFFIX}`));
  });

  test('il nome della cartella resta coerente con variantFolderName()', () => {
    // Le due funzioni devono restare allineate: se divergessero, le varianti
    // verrebbero scritte in un posto e cercate in un altro.
    const abs = path.join('/srv', 'foto con spazi.png');
    expect(path.basename(variantFolderPathAbs(abs)))
      .toBe(variantFolderName('foto con spazi.png'));
  });
});
