// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/seo/lib/metaTagGenerator.js.
 *
 * PERCHÉ
 * ------
 * Questo modulo produce markup che finisce nel `<head>` di ogni pagina, a partire
 * da valori che l'amministratore scrive nella GUI: titolo, descrizione, keyword,
 * nome del sito. È quindi un punto in cui **contenuto controllato dall'utente
 * diventa HTML** — e l'intero plugin `seo` era senza un solo test.
 *
 * L'invariante che conta è l'accoppiamento fra `escapeAttr()` e il modo in cui gli
 * attributi vengono scritti: l'escape copre `& " < >` ma NON l'apice singolo, il
 * che è corretto **solo finché** gli attributi usano le virgolette doppie. Il test
 * lo verifica invece di darlo per scontato: se qualcuno passasse ad `attr='...'`,
 * un apice nel titolo aprirebbe un buco.
 */

const {
  resolveValue,
  escapeAttr,
  buildCanonicalUrl,
  generateMetaTags,
} = require('../../lib/metaTagGenerator');

/** passData minimo: al modulo serve solo `ctx`. */
const makePassData = (ctx = {}) => ({
  ctx: { protocol: 'https', host: 'esempio.it', path: '/pagina.ejs', state: {}, ...ctx },
});

describe('escapeAttr()', () => {
  test('escapa i quattro caratteri che romperebbero un attributo o il markup', () => {
    expect(escapeAttr('&')).toBe('&amp;');
    expect(escapeAttr('"')).toBe('&quot;');
    expect(escapeAttr('<')).toBe('&lt;');
    expect(escapeAttr('>')).toBe('&gt;');
  });

  test('l\'ampersand è escapato per primo, senza doppia codifica', () => {
    // Ordine sbagliato → `<` diventerebbe `&amp;lt;`, cioè testo visibile.
    expect(escapeAttr('<a>')).toBe('&lt;a&gt;');
    expect(escapeAttr('a & b')).toBe('a &amp; b');
    expect(escapeAttr('&amp;')).toBe('&amp;amp;');
  });

  test('neutralizza un tentativo di uscire dall\'attributo', () => {
    const attacco = '" onload="alert(1)';
    const escaped = escapeAttr(attacco);
    expect(escaped).not.toContain('"');
    expect(escaped).toBe('&quot; onload=&quot;alert(1)');
  });

  test('input non stringa → stringa vuota, mai "undefined" nel markup', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(escapeAttr(value)).toBe('');
    }
  });

  test('NON escapa l\'apice singolo — vedi il test di accoppiamento sotto', () => {
    // Documenta il perimetro reale della funzione: è sicura per gli attributi
    // con virgolette doppie, non per quelli con apici.
    expect(escapeAttr("l'apostrofo")).toBe("l'apostrofo");
  });
});

describe('resolveValue() — valori multilingua', () => {
  test('stringa semplice → restituita intatta', () => {
    expect(resolveValue('Titolo', {})).toBe('Titolo');
  });

  test('oggetto multilingua → sceglie la lingua di ctx.state.lang', () => {
    const valore = { it: 'Ciao', en: 'Hello' };
    expect(resolveValue(valore, { state: { lang: 'en' } })).toBe('Hello');
    expect(resolveValue(valore, { state: { lang: 'it' } })).toBe('Ciao');
  });

  test('lingua non presente nell\'oggetto → prima disponibile, non stringa vuota', () => {
    // Una pagina senza traduzione deve comunque avere un titolo.
    expect(resolveValue({ it: 'Ciao' }, { state: { lang: 'de' } })).toBe('Ciao');
  });

  test('nessuna lingua nel ctx → prima disponibile', () => {
    expect(resolveValue({ it: 'Ciao', en: 'Hello' }, {})).toBe('Ciao');
    expect(resolveValue({ it: 'Ciao' }, undefined)).toBe('Ciao');
  });

  test('valori non utilizzabili → stringa vuota', () => {
    expect(resolveValue(null, {})).toBe('');
    expect(resolveValue(undefined, {})).toBe('');
    expect(resolveValue(42, {})).toBe('');
    expect(resolveValue({}, {})).toBe('');
  });
});

describe('buildCanonicalUrl()', () => {
  test('usa siteUrl dal config quando c\'è', () => {
    const url = buildCanonicalUrl(makePassData(), { siteUrl: 'https://esempio.it' });
    expect(url).toBe('https://esempio.it/pagina.ejs');
  });

  test('senza siteUrl ricade su protocollo e host della richiesta', () => {
    const url = buildCanonicalUrl(makePassData({ protocol: 'http', host: 'localhost:3000' }), {});
    expect(url).toBe('http://localhost:3000/pagina.ejs');
  });

  test('lo slash finale di siteUrl non produce un doppio slash', () => {
    // Due URL canonical diversi per la stessa pagina sono esattamente il problema
    // che il canonical dovrebbe risolvere.
    const url = buildCanonicalUrl(makePassData(), { siteUrl: 'https://esempio.it///' });
    expect(url).toBe('https://esempio.it/pagina.ejs');
  });

  test('canonicalCleanUrl rimuove l\'estensione .ejs', () => {
    const url = buildCanonicalUrl(makePassData(), { siteUrl: 'https://esempio.it', canonicalCleanUrl: true });
    expect(url).toBe('https://esempio.it/pagina');
  });

  test('canonicalCleanUrl non tocca un path che non finisce in .ejs', () => {
    const passData = makePassData({ path: '/documenti/report.pdf' });
    const url = buildCanonicalUrl(passData, { siteUrl: 'https://esempio.it', canonicalCleanUrl: true });
    expect(url).toBe('https://esempio.it/documenti/report.pdf');
  });
});

describe('generateMetaTags() — il markup che finisce nel <head>', () => {
  // Ogni famiglia di tag ha il proprio interruttore: senza, il modulo non emette
  // nulla. È il primo contratto da fissare, perché una chiave sbagliata nel config
  // produce silenzio — non un errore.
  const config = {
    siteUrl: 'https://esempio.it',
    siteName: 'Sito',
    enableMetaTags: true,
    enableCanonicalUrl: true,
  };

  test('la descrizione dalla regola di pagina compare come meta description', () => {
    const html = generateMetaTags({ description: 'Una descrizione' }, makePassData(), config);
    expect(html).toContain('<meta name="description" content="Una descrizione">');
  });

  test('ACCOPPIAMENTO: gli attributi usano virgolette DOPPIE, che escapeAttr copre', () => {
    // È l'invariante che rende sicuro il non-escape dell'apice singolo. Se il
    // markup passasse agli apici, questo test fallisce e obbliga a estendere
    // escapeAttr prima che il buco si apra.
    const html = generateMetaTags({ description: "l'apostrofo resta" }, makePassData(), config);
    expect(html).toContain('content="');
    expect(html).not.toMatch(/content='/);
  });

  test('un tentativo di iniezione nella descrizione viene neutralizzato', () => {
    const attacco = '"><script>alert(1)</script>';
    const html = generateMetaTags({ description: attacco }, makePassData(), config);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&gt;');
  });

  test('senza regola di pagina non lancia e produce comunque una stringa', () => {
    // La maggior parte delle pagine non ha una regola dedicata.
    const html = generateMetaTags(null, makePassData(), config);
    expect(typeof html).toBe('string');
  });

  test('i campi assenti non producono meta vuoti', () => {
    // `<meta name="description" content="">` è peggio dell'assenza del tag.
    const html = generateMetaTags({}, makePassData(), config);
    expect(html).not.toContain('content=""');
  });
});

describe('generateMetaTags() — i feature toggle', () => {
  const passData = () => ({
    ctx: { protocol: 'https', host: 'esempio.it', path: '/p.ejs', state: {} },
  });

  test('enableMetaTags spento → nessun meta description, anche con la regola presente', () => {
    const html = generateMetaTags({ description: 'C\'è' }, passData(), { siteUrl: 'https://esempio.it' });
    expect(html).not.toContain('name="description"');
  });

  test('enableCanonicalUrl spento → nessun link canonical', () => {
    const html = generateMetaTags(null, passData(), { siteUrl: 'https://esempio.it', enableMetaTags: true });
    expect(html).not.toContain('rel="canonical"');
  });

  test('enableCanonicalUrl acceso → il canonical c\'è', () => {
    const html = generateMetaTags(null, passData(), { siteUrl: 'https://esempio.it', enableCanonicalUrl: true });
    expect(html).toContain('<link rel="canonical" href="https://esempio.it/p.ejs">');
  });

  test('enableOpenGraph spento → nessun tag og:', () => {
    const html = generateMetaTags({ title: 'T' }, passData(), { siteUrl: 'https://esempio.it', enableMetaTags: true });
    expect(html).not.toContain('property="og:');
  });

  test('config completamente vuoto → stringa vuota, nessun crash', () => {
    // Un plugin appena installato, prima che l'admin apra la GUI.
    expect(generateMetaTags(null, passData(), {})).toBe('');
  });

  test('i default del config valgono quando la regola di pagina non dice niente', () => {
    const html = generateMetaTags(null, passData(), {
      enableMetaTags: true,
      defaultDescription: 'Descrizione di default',
      defaultRobots: 'index, follow',
    });
    expect(html).toContain('content="Descrizione di default"');
    expect(html).toContain('content="index, follow"');
  });

  test('la regola di pagina ha la precedenza sul default', () => {
    const html = generateMetaTags({ description: 'Specifica' }, passData(), {
      enableMetaTags: true,
      defaultDescription: 'Generica',
    });
    expect(html).toContain('content="Specifica"');
    expect(html).not.toContain('content="Generica"');
  });
});
