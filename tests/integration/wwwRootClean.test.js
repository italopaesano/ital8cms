// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * La web root pubblica (`/www`) parte PULITA.
 *
 * PERCHÉ ESISTE
 * -------------
 * `/www` è la cartella dell'**utente**: chi installa ital8cms ci mette il proprio
 * sito. Il CMS non ci mette nulla — né il wizard né il boot — e `.gitignore`
 * esclude `/www/*` con la sola eccezione di `.gitkeep`, che serve unicamente a
 * far sopravvivere la cartella a un clone (senza, `git` non la crea affatto e il
 * file server punterebbe a una directory inesistente).
 *
 * Fra la **v3.21.0** e la **v3.25.0** qui è vissuta una pagina segnaposto
 * committata (`!/www/index.ejs` in `.gitignore`), che faceva rispondere `GET /`
 * con un 200 su un'installazione pulita. È stata **rimossa**: era un file del
 * *progetto* in casa di chi costruisce il sito, e chi lo sostituiva se lo
 * ritrovava in `git status` come modificato. **Il 404 alla radice, finché non
 * esiste una `index.ejs` propria, è quindi il comportamento voluto.**
 *
 * COSA SI PRESIDIA QUI, E PERCHÉ PROPRIO QUESTO
 * ---------------------------------------------
 * Il rischio è **asimmetrico**, ed è la ragione per cui questo test guarda cosa
 * è **versionato** invece di cosa c'è su disco: un file rimesso in `/www` (una
 * pagina di benvenuto, un `favicon.ico`, un `robots.txt` d'esempio) resterebbe
 * **sulla macchina di chi sviluppa** — quindi ogni altro test continuerebbe a
 * passare — ma finirebbe nel pacchetto e comparirebbe a casa di tutti gli altri.
 * Nessuna suite se ne accorgerebbe. Da qui i tre controlli:
 *
 *   1. `/www` è versionata a **un solo file**, `.gitkeep`.
 *   2. `.gitignore` **ignora davvero** qualunque cosa ci finisca dentro — nomi di
 *      file indice compresi, che sono il caso da cui si ricadrebbe nel difetto.
 *   3. `.gitkeep` è l'**unica** eccezione: nessun altro `!/www/...` in `.gitignore`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '../..');
const WWW_GUARDIANO = 'www/.gitkeep';

// `git check-ignore` esce 0 se il path È ignorato, 1 se non lo è. Lavora sulle
// sole regole di esclusione, quindi risponde anche per file che non esistono su
// disco — che è esattamente ciò che serve per sondare nomi ipotetici.
function isIgnorato(relPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', relPath], { cwd: PROJECT_ROOT });
    return true;
  } catch (e) {
    return false;
  }
}

describe('/www — la web root pubblica parte pulita', () => {
  test('è versionata a UN SOLO file: .gitkeep', () => {
    // Qualsiasi altro file qui sarebbe un file del PROGETTO nella cartella
    // dell'UTENTE: invisibile a chi lo aggiunge (resta sulla sua macchina),
    // presente a casa di chiunque installi.
    const versionati = execFileSync('git', ['ls-files', 'www/'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    expect(versionati).toEqual([WWW_GUARDIANO]);
  });

  test('.gitkeep NON è ignorato — è ciò che tiene la cartella nel clone', () => {
    // Senza il guardiano git non crea `/www` affatto, e i tre static server di
    // `index.js` punterebbero a una directory inesistente.
    expect({ file: WWW_GUARDIANO, ignorato: isIgnorato(WWW_GUARDIANO) })
      .toEqual({ file: WWW_GUARDIANO, ignorato: false });
  });

  test('qualunque altro file in /www è ignorato — file indice compresi', () => {
    // I nomi cercati da `indexFiles.wwwPath` sono il caso da cui si ricadrebbe
    // nel difetto: è da lì che una pagina di benvenuto tornerebbe.
    const sonde = [
      'www/index.ejs',      // il nome della segnaposto rimossa
      'www/index.html',
      'www/favicon.ico',
      'www/robots.txt',     // generato a runtime dal plugin seo
      'www/sitemap.xml',    // idem
      'www/pagina/annidata.ejs',
    ];

    const esiti = sonde.map((f) => ({ file: f, ignorato: isIgnorato(f) }));

    expect(esiti).toEqual(sonde.map((f) => ({ file: f, ignorato: true })));
  });

  test('.gitkeep è l\'UNICA eccezione dichiarata per /www in .gitignore', () => {
    // Un secondo `!/www/...` rimetterebbe in gioco un file committato senza che
    // i controlli qui sopra debbano per forza accorgersene (un nome fuori dalle
    // sonde passerebbe): questo lo coglie alla fonte, nella regola.
    const gitignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8');

    const eccezioni = gitignore
      .split('\n')
      .map((riga) => riga.trim())
      .filter((riga) => /^!\/?www\//.test(riga));

    expect(eccezioni).toEqual(['!/www/.gitkeep']);
  });
});
