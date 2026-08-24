// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per `plugins/seo/lib/robotsTxtGenerator.js` e `lib/structuredData.js`.
 *
 * PERCHÉ STANNO INSIEME
 * ---------------------
 * Sono i due generatori che producono output **consumato dalle macchine**:
 * `robots.txt` dice ai crawler cosa possono visitare, il JSON-LD dice ai motori
 * di ricerca chi sei. Un errore qui non si vede aprendo il sito — si vede
 * settimane dopo, nei risultati di ricerca. Sono anche i due che nessun test
 * toccava.
 *
 * Del generatore di robots.txt si esercita la sola `generateRobotsTxt()`, che è
 * pura; `writeRobotsTxtIfChanged()` scrive su disco e resta fuori (vedi TODO.md §5
 * sui path cablati).
 */

const { generateRobotsTxt } = require('../../lib/robotsTxtGenerator');
const {
  buildOrganizationSchema,
  buildWebSiteSchema,
  generateStructuredData,
  serializeJsonLd,
} = require('../../lib/structuredData');

describe('generateRobotsTxt()', () => {
  test('config vuoto → User-agent: * (il default permissivo, dichiarato)', () => {
    const txt = generateRobotsTxt({});
    expect(txt).toContain('User-agent: *');
  });

  test('le regole Disallow compaiono una per riga', () => {
    const txt = generateRobotsTxt({ robotsTxtRules: { disallow: ['/admin/', '/api/'] } });
    expect(txt).toContain('Disallow: /admin/');
    expect(txt).toContain('Disallow: /api/');
  });

  test('Allow precede Disallow, come vuole la convenzione', () => {
    const txt = generateRobotsTxt({
      robotsTxtRules: { allow: ['/public/'], disallow: ['/'] },
    });
    expect(txt.indexOf('Allow: /public/')).toBeLessThan(txt.indexOf('Disallow: /'));
  });

  test('userAgent personalizzato sostituisce l\'asterisco', () => {
    const txt = generateRobotsTxt({ robotsTxtRules: { userAgent: 'Googlebot' } });
    expect(txt).toContain('User-agent: Googlebot');
    expect(txt).not.toContain('User-agent: *');
  });

  test('la riga Sitemap compare solo con enableSitemap E siteUrl', () => {
    // Una riga `Sitemap:` che punta a un URL inesistente è peggio dell'assenza.
    expect(generateRobotsTxt({ enableSitemap: true, siteUrl: 'https://esempio.it' }))
      .toContain('Sitemap: https://esempio.it/sitemap.xml');

    expect(generateRobotsTxt({ enableSitemap: true })).not.toContain('Sitemap:');
    expect(generateRobotsTxt({ siteUrl: 'https://esempio.it' })).not.toContain('Sitemap:');
  });

  test('lo slash finale di siteUrl non produce un doppio slash nella Sitemap', () => {
    const txt = generateRobotsTxt({ enableSitemap: true, siteUrl: 'https://esempio.it//' });
    expect(txt).toContain('Sitemap: https://esempio.it/sitemap.xml');
    expect(txt).not.toContain('.it//sitemap');
  });

  test('liste vuote non producono righe vuote di Allow/Disallow', () => {
    const txt = generateRobotsTxt({ robotsTxtRules: { allow: [], disallow: [] } });
    expect(txt).not.toMatch(/Allow:\s*$/m);
    expect(txt).not.toMatch(/Disallow:\s*$/m);
  });

  test('il file termina con una riga vuota', () => {
    // Diversi crawler ignorano l\'ultima direttiva se il file non finisce con \\n.
    expect(generateRobotsTxt({}).endsWith('\n')).toBe(true);
  });
});

describe('buildOrganizationSchema()', () => {
  test('senza nome → null (non uno schema vuoto)', () => {
    // Uno schema JSON-LD senza `name` è peggio di nessuno schema: i validatori
    // lo segnalano come errore strutturato.
    expect(buildOrganizationSchema({})).toBeNull();
    expect(buildOrganizationSchema({ organization: {} })).toBeNull();
  });

  test('siteName fa da fallback al nome dell\'organizzazione', () => {
    const schema = buildOrganizationSchema({ siteName: 'Sito' });
    expect(schema.name).toBe('Sito');
    expect(schema['@type']).toBe('Organization');
    expect(schema['@context']).toBe('https://schema.org');
  });

  test('organization.name ha la precedenza su siteName', () => {
    const schema = buildOrganizationSchema({ siteName: 'Sito', organization: { name: 'Azienda' } });
    expect(schema.name).toBe('Azienda');
  });

  test('il contactPoint compare solo se c\'è almeno un contatto', () => {
    expect(buildOrganizationSchema({ siteName: 'S' }).contactPoint).toBeUndefined();

    const conEmail = buildOrganizationSchema({ siteName: 'S', organization: { contactEmail: 'a@b.co' } });
    expect(conEmail.contactPoint.email).toBe('a@b.co');
    expect(conEmail.contactPoint['@type']).toBe('ContactPoint');
  });

  test('il telefono porta con sé contactType, come richiede schema.org', () => {
    const schema = buildOrganizationSchema({ siteName: 'S', organization: { contactPhone: '+39 000' } });
    expect(schema.contactPoint.telephone).toBe('+39 000');
    expect(schema.contactPoint.contactType).toBe('customer service');
  });

  test('sameAs compare solo con profili social non vuoti', () => {
    expect(buildOrganizationSchema({ siteName: 'S', organization: { socialProfiles: [] } }).sameAs)
      .toBeUndefined();
    expect(buildOrganizationSchema({ siteName: 'S', organization: { socialProfiles: ['https://x.com/a'] } }).sameAs)
      .toEqual(['https://x.com/a']);
  });
});

describe('buildWebSiteSchema()', () => {
  test('senza siteName → null', () => {
    expect(buildWebSiteSchema({})).toBeNull();
  });

  test('con siteName produce uno schema WebSite valido', () => {
    const schema = buildWebSiteSchema({ siteName: 'Sito', siteUrl: 'https://esempio.it' });
    expect(schema).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Sito',
      url: 'https://esempio.it',
    });
  });

  test('l\'url è omesso se manca, non impostato a undefined', () => {
    const schema = buildWebSiteSchema({ siteName: 'Sito' });
    expect('url' in schema).toBe(false);
  });
});

describe('generateStructuredData() — il markup JSON-LD', () => {
  const config = { enableStructuredData: true, siteName: 'Sito', siteUrl: 'https://esempio.it' };

  test('toggle spento → stringa vuota', () => {
    expect(generateStructuredData({ ...config, enableStructuredData: false })).toBe('');
    expect(generateStructuredData({ siteName: 'Sito' })).toBe('');
  });

  test('produce script JSON-LD parsabili', () => {
    const html = generateStructuredData(config);
    const blocchi = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];

    expect(blocchi.length).toBe(2); // Organization + WebSite
    for (const [, json] of blocchi) {
      // Se non è JSON valido, il motore di ricerca lo scarta in silenzio.
      expect(() => JSON.parse(json)).not.toThrow();
      expect(JSON.parse(json)['@context']).toBe('https://schema.org');
    }
  });

  test('senza dati minimi non emette script vuoti', () => {
    expect(generateStructuredData({ enableStructuredData: true })).toBe('');
  });

  test('un `</script>` nel config NON esce dal tag (corretto in v3.4.0)', () => {
    // Il parser HTML cerca `</script` prima che un parser JSON veda il payload:
    // senza escape il tag si chiudeva in anticipo e il resto diventava markup vivo.
    //
    // Il valore arriva da `seoConfig.json5`, scritto da un amministratore
    // (ruoli 0/1), quindi non era una escalation di privilegi — ma un campo di
    // testo semplice come `siteName` non deve essere una via per iniettare
    // markup in ogni pagina del sito.
    const html = generateStructuredData({
      enableStructuredData: true,
      siteName: 'Sito</script><b>x</b>',
    });

    expect(html).not.toContain('</script><b>x</b>');
    // Esattamente due tag aperti e due chiusi: la struttura regge.
    expect(html.match(/<\/script>/g).length).toBe(2);
  });

  test('il valore originale sopravvive alla riparsatura', () => {
    // L'escape `\\uXXXX` è standard JSON: chi consuma il JSON-LD (i motori di
    // ricerca) rilegge il carattere originale. Nessun dato viene perso.
    const siteName = 'A & B </script> <b>';
    const html = generateStructuredData({ enableStructuredData: true, siteName });
    const [, json] = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);

    expect(JSON.parse(json).name).toBe(siteName);
  });

  test('anche `&` e `>` sono neutralizzati', () => {
    // `&` da solo non rompe il tag, ma un `&lt;` reintrodotto da un
    // trasformatore a valle sì: si escapa la terna completa.
    const html = generateStructuredData({
      enableStructuredData: true,
      siteName: 'Sito',
      siteUrl: 'https://esempio.it?a=1&b=2>',
    });

    expect(html).not.toContain('?a=1&b=2');
    expect(html).toContain('\\u0026');
    expect(html).toContain('\\u003e');
  });

  test('serializeJsonLd() — contratto della funzione', () => {
    expect(serializeJsonLd({ a: '<' })).toBe('{"a":"\\u003c"}');
    expect(serializeJsonLd({ a: '>' })).toBe('{"a":"\\u003e"}');
    expect(serializeJsonLd({ a: '&' })).toBe('{"a":"\\u0026"}');
    // Nulla di innocuo viene toccato, e il risultato resta JSON valido.
    expect(serializeJsonLd({ a: 'testo', n: 1 })).toBe('{"a":"testo","n":1}');
    expect(JSON.parse(serializeJsonLd({ a: '</script>' })).a).toBe('</script>');
  });
});
