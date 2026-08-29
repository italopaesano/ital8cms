// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * La pagina segnaposto di primo avvio (`www/index.ejs`).
 *
 * PERCHÉ ESISTE
 * -------------
 * Su un'installazione `production` pulita `GET /` rispondeva **404**: la prima
 * cosa che vedeva chi aveva appena installato ital8cms era un errore. È l'unico
 * difetto della lista aperta che incontrava *chiunque* installasse il CMS.
 *
 * La pagina è un file NORMALE di `/www`, non un meccanismo: chi costruisce il
 * proprio sito la sostituisce e non torna più. Per esistere ha però bisogno di
 * un'eccezione in `.gitignore`, che esclude tutto `/www/*`.
 *
 * COSA SI PRESIDIA QUI, E PERCHÉ PROPRIO QUESTO
 * ---------------------------------------------
 * Due rischi concreti, non la resa della pagina (quella si verifica avviando il
 * server, e lo si è fatto: `GET /` → 200 in italiano e in inglese):
 *
 *   1. **Che l'eccezione in `.gitignore` si perda.** Senza, il file sparisce dal
 *      pacchetto e il 404 torna — senza che nessun test ne accorga, perché il
 *      file resterebbe presente sulla macchina di chi sviluppa.
 *   2. **Che qualcuno aggiunga un link al pannello admin.** `index.js` NON passa
 *      `adminPrefix` alle pagine pubbliche, con un commento esplicito che vieta
 *      di farlo « per non svelare ad utenti potenzialmente pericolosi la
 *      location della sezione di admin ». Una pagina di benvenuto è esattamente
 *      il posto dove verrebbe naturale metterlo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ejs = require('ejs');

const PROJECT_ROOT = path.join(__dirname, '../..');
const PAGINA = path.join(PROJECT_ROOT, 'www/index.ejs');

describe('www/index.ejs — la pagina segnaposto di primo avvio', () => {
  test('esiste', () => {
    // Senza, `GET /` torna a rispondere 404 su ogni installazione pulita.
    expect(fs.existsSync(PAGINA)).toBe(true);
  });

  test('NON è esclusa da .gitignore, che esclude tutto il resto di /www', () => {
    // `/www/*` è git-ignored: questo file vive grazie a un `!/www/index.ejs`.
    // Se quell'eccezione sparisse, il file resterebbe sulla macchina di chi
    // sviluppa — quindi tutti gli altri test continuerebbero a passare — ma non
    // finirebbe nel pacchetto, e il difetto tornerebbe solo per gli utenti.
    // `git check-ignore` esce 1 quando il path NON è ignorato.
    let ignorato;
    try {
      execFileSync('git', ['check-ignore', '-q', 'www/index.ejs'], { cwd: PROJECT_ROOT });
      ignorato = true;
    } catch (e) {
      ignorato = false;
    }

    expect({ file: 'www/index.ejs', ignorato }).toEqual({ file: 'www/index.ejs', ignorato: false });
  });

  test('è EJS sintatticamente valido', () => {
    // Non la renderizza (servirebbe il `passData` completo del server): compila
    // soltanto, che è ciò che coglie una parentesi o un tag sbagliato.
    const sorgente = fs.readFileSync(PAGINA, 'utf8');

    expect(() => ejs.compile(sorgente, { filename: PAGINA })).not.toThrow();
  });

  test('NON rivela dove sta il pannello admin', () => {
    // `index.js` non passa `adminPrefix` alle pagine pubbliche, di proposito.
    // Usarlo qui darebbe `undefined` nell'URL; cablare "/admin" a mano sarebbe
    // peggio, perché funzionerebbe — rivelando il pannello anche a chi ha
    // cambiato il prefisso proprio per non farlo trovare.
    const sorgente = fs.readFileSync(PAGINA, 'utf8');
    const senzaCommenti = sorgente.replace(/<%#[\s\S]*?%>/g, '');

    expect(senzaCommenti).not.toMatch(/adminPrefix/);
    expect(senzaCommenti).not.toMatch(/href\s*=\s*["'][^"']*\/admin/i);
  });

  test('passa dai partial del TEMA ATTIVO invece di cablare l\'HTML', () => {
    // Una pagina di benvenuto con il proprio <html> completo funzionerebbe, ma
    // ignorerebbe il tema — e chi installa vedrebbe una pagina che non somiglia
    // al resto del sito che sta per costruire.
    const sorgente = fs.readFileSync(PAGINA, 'utf8');

    expect(sorgente).toMatch(/getThemePartPath\(\s*'head\.ejs'\s*\)/);
    expect(sorgente).toMatch(/getThemePartPath\(\s*'footer\.ejs'\s*\)/);
    expect(sorgente).not.toMatch(/<!DOCTYPE/i);
  });

  test('è bilingue tramite l\'helper globale __()', () => {
    // Il CMS è italiano e inglese; una pagina segnaposto in una lingua sola
    // sarebbe la prima cosa che smentisce quella promessa.
    const sorgente = fs.readFileSync(PAGINA, 'utf8');

    expect(sorgente).toMatch(/__\(\{/);
    expect(sorgente).toMatch(/\bit:\s*["']/);
    expect(sorgente).toMatch(/\ben:\s*["']/);
  });

  test('dice dove si trova e che va sostituita', () => {
    // È l'unica cosa che la pagina deve *fare*: chi la vede deve sapere qual è
    // il passo successivo, senza andare a cercarlo nella documentazione.
    const sorgente = fs.readFileSync(PAGINA, 'utf8');

    expect(sorgente).toMatch(/www\/index\.ejs/);
  });
});
