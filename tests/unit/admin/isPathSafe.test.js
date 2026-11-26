/**
 * La guardia che decide cosa si può scrivere dentro /www × REVIEW.md → B5, più
 * la regressione dello slash iniziale trovata dalla review della v3.51.0.
 *
 * ─── DUE DIFETTI, IN DIREZIONI OPPOSTE ───────────────────────────────────────
 * B5: `startsWith` su un percorso senza separatore confronta **stringhe**, non
 * directory, quindi `/…/wwwBackup/x.ejs` « iniziava con » `/…/www` e la guardia
 * lo **approvava**. Troppo permissiva.
 *
 * La correzione ha portato il difetto opposto: passando da `path.join` a
 * `path.resolve`, uno **slash iniziale** rende il percorso assoluto e lo porta
 * fuori dalla radice. Misurato: `createPage('/about.ejs')` passava da accettato
 * a **rifiutato** — su un campo di testo libero del pannello, dove quella è la
 * forma naturale di scrivere il percorso. Troppo restrittiva.
 *
 * Questo presidio tiene ferme entrambe le direzioni.
 */

'use strict';

const path = require('path');
const { isPathSafe } = require('../../../plugins/admin/pagesManagment');

describe('ciò che è dentro /www è accettato', () => {
  test.each([
    ['about.ejs',            'un file, forma relativa'],
    ['/about.ejs',           'un file, con lo slash iniziale — la forma naturale nel pannello'],
    ['//about.ejs',          'slash duplicati'],
    ['sotto/pagina.ejs',     'una sottocartella'],
    ['/sotto/pagina.ejs',    'una sottocartella con lo slash'],
    ['sotto/../pagina.ejs',  'una risalita che NON esce'],
  ])('%s (%s)', (percorso) => {
    expect(isPathSafe(percorso)).toBe(true);
  });
});

describe('ciò che esce da /www è rifiutato — in qualunque forma', () => {
  test.each([
    ['../wwwBackup/x.ejs',     'la sorella il cui nome inizia per www — il caso di B5'],
    ['/../wwwBackup/x.ejs',    'lo stesso, con lo slash iniziale'],
    ['../../etc/passwd',       'risalita doppia'],
    ['/../../etc/passwd',      'risalita doppia con lo slash'],
    ['sotto/../../fuori.ejs',  'risalita che parte da dentro'],
    ['..',                     'la cartella padre'],
  ])('%s (%s)', (percorso) => {
    expect(isPathSafe(percorso)).toBe(false);
  });

  test('lo slash iniziale non è una scorciatoia per uscire', () => {
    // La tolleranza dello slash non deve riaprire la traversal: si toglie il
    // prefisso e POI si risolve, quindi i `..` restano risolti.
    expect(isPathSafe('/..')).toBe(false);
    expect(isPathSafe('///../fuori')).toBe(false);
  });
});

describe('la forma SBAGLIATA del controllo non è tornata', () => {
  test('il confronto non è più su stringhe senza separatore', () => {
    // Si misura il difetto invece di descriverlo: la vecchia forma approvava.
    const wwwPath = path.join(__dirname, '../../../www');
    const vecchiaForma = path.normalize(path.join(wwwPath, '../wwwBackup/x.ejs')).startsWith(wwwPath);

    expect(vecchiaForma).toBe(true);               // ← approvava
    expect(isPathSafe('../wwwBackup/x.ejs')).toBe(false);   // ← ora rifiuta
  });

  test.each([null, undefined, ''])('un percorso assente (%p) non fa esplodere la guardia', (p) => {
    expect(() => isPathSafe(p)).not.toThrow();
  });
});
