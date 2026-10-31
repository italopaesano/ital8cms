/**
 * Unit Tests: copertura della superficie riservata (accessControl.default.json5)
 *
 * Questi test non verificano una funzione: verificano una PROMESSA, cioè che il
 * perimetro dichiarato copra davvero ciò che esiste su disco.
 *
 * Perché servono. In revisione sono emersi due difetti che nessun test poteva
 * cogliere, perché nessuno confrontava le regole con la realtà:
 *   • `logout.ejs` e `access-denied.ejs` restavano servite a superficie chiusa —
 *     semplicemente nessuno si era ricordato di classificarle;
 *   • le regole erano ancorate a `.ejs`, quindi con `hideExtension` attivo la
 *     pagina di login era raggiungibile alla sua forma senza estensione.
 * Sono entrambi errori di OMISSIONE: il codice era corretto, mancava una riga di
 * configurazione. Un test che rilegge il filesystem è l'unico modo per accorgersene.
 *
 * Il primo test è volutamente una domanda posta allo sviluppatore: se aggiungi una
 * pagina a questi due plugin, fallisce finché non dichiari a quale faccia del sito
 * appartiene. Non è un falso allarme — è il punto.
 */

const fs = require('fs');
const path = require('path');
const PatternMatcher = require('../../core/patternMatcher');
const loadJson5 = require('../../core/loadJson5');
const { resolvePathZones, resolveRuleset } = require('../../core/pathZoneResolver');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ACCESS_CONTROL_DEFAULT = path.join(
  PROJECT_ROOT, 'plugins', 'adminAccessControl', 'accessControl.default.json5'
);

// I plugin il cui dominio È l'autenticazione/il controllo accessi: ogni pagina che
// servono appartiene per natura alla superficie riservata. Se un giorno uno di
// questi dovesse servire una pagina davvero pubblica, la scelta va resa esplicita
// qui — non lasciata implicita in un'omissione.
const AUTH_SURFACE_PLUGINS = ['adminUsers', 'adminAccessControl'];

/**
 * Le regole EFFETTIVE, non quelle scritte.
 *
 * Dalla Fase 4 di path-zones i pattern del `.default` sono SEGNAPOSTI
 * (`{{pluginPages}}/...`), e le forme senza estensione non sono più scritte a
 * mano ma DERIVATE al caricamento. Leggere i pattern grezzi e confrontarli con
 * URL concreti quindi non misura più niente: bisogna passare per lo stesso
 * resolver che usa il motore.
 *
 * Il parametro `hideExtensionOn` non è un dettaglio: le forme senza estensione
 * esistono SOLO in quella configurazione, e i test che le riguardano ora la
 * esercitano davvero invece di appoggiarsi a duplicati scritti a mano.
 */
function loadRules({ hideExtensionOn = false } = {}) {
  const config = loadJson5(ACCESS_CONTROL_DEFAULT);
  const declared = { ...config.customRules, ...config.hardcodedRules };

  const ital8Conf = loadJson5(path.join(PROJECT_ROOT, 'ital8Config.default.json5'));
  if (hideExtensionOn) {
    ital8Conf.hideExtension = ital8Conf.hideExtension || {};
    ital8Conf.hideExtension.pluginPagesPrefix = { enabled: true, ext: '.ejs' };
  }

  const resolved = resolveRuleset(declared, resolvePathZones(ital8Conf));
  if (resolved.problems.length > 0) {
    // Un problema qui significherebbe un `.default` che il motore non caricherebbe:
    // va detto COSI', non travestito da «pagina non riservata» in venti test.
    throw new Error(
      'accessControl.default.json5 non risolvibile:\n' +
      resolved.problems.map((p) => `  • [${p.kind}] ${p.message}`).join('\n')
    );
  }
  return resolved.rules;
}

// Enumera le pagine realmente presenti su disco, con l'URL pubblico con cui il
// Plugin Pages System le serve.
function discoverPluginPages(pluginName) {
  const webPagesDir = path.join(PROJECT_ROOT, 'plugins', pluginName, 'webPages');
  if (!fs.existsSync(webPagesDir)) return [];
  return fs.readdirSync(webPagesDir)
    .filter((entry) => entry.toLowerCase().endsWith('.ejs'))
    .map((entry) => ({
      file: `plugins/${pluginName}/webPages/${entry}`,
      url: `/pluginPages/${pluginName}/${entry}`,
    }));
}

function isReservedByRules(url, rules, matcher) {
  const rule = matcher.findMatchingRule(url, rules);
  return !!(rule && (rule.requiresAuth || rule.isAuthEntryPoint));
}

describe('copertura della superficie riservata', () => {
  const matcher = new PatternMatcher();
  const rules = loadRules();
  // Le forme senza estensione esistono solo con `hideExtension` acceso.
  const rulesWithCleanUrls = loadRules({ hideExtensionOn: true });

  const pages = AUTH_SURFACE_PLUGINS.flatMap(discoverPluginPages);

  test('i plugin della superficie di autenticazione servono almeno una pagina', () => {
    // Guardia contro un test che passa perché non trova nulla da controllare
    // (cartella rinominata, plugin spostato): senza questa, i test qui sotto
    // diventerebbero silenziosamente vuoti.
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  test.each(AUTH_SURFACE_PLUGINS.flatMap(discoverPluginPages).map((p) => [p.url, p.file]))(
    '%s è dichiarata riservata (%s)',
    (url) => {
      expect(isReservedByRules(url, rules, matcher)).toBe(true);
    }
  );

  // Con `hideExtension.pluginPagesPrefix` attivo l'URL servito è senza estensione.
  // Una regola ancorata a `.ejs` non lo intercetta, e la pagina resta raggiungibile
  // a superficie chiusa: è il difetto trovato in revisione.
  test.each(AUTH_SURFACE_PLUGINS.flatMap(discoverPluginPages).map((p) => [
    p.url.replace(/\.ejs$/i, ''),
    p.url,
  ]))(
    '%s (forma senza estensione, hideExtension attivo) è dichiarata riservata',
    (extensionlessUrl) => {
      expect(isReservedByRules(extensionlessUrl, rulesWithCleanUrls, matcher)).toBe(true);
    }
  );

  // Il perimetro deve restare CHIUSO, non diventare onnivoro: una regola troppo
  // larga spegnerebbe contenuto pubblico legittimo senza che nessuno se ne accorga.
  test.each([
    ['/index.ejs'],
    ['/chi-siamo.ejs'],
    ['/pluginPages/adminUsers/loginHelper.ejs'],
    ['/pluginPages/altroPlugin/pagina.ejs'],
    ['/admin-guide.ejs'],
  ])('%s NON è dichiarata riservata (con e senza hideExtension)', (publicUrl) => {
    // Entrambe le configurazioni: la derivazione delle forme pulite AGGIUNGE
    // pattern, ed è proprio quando si aggiungono pattern che un perimetro
    // diventa onnivoro senza che nessuno lo noti.
    expect(isReservedByRules(publicUrl, rules, matcher)).toBe(false);
    expect(isReservedByRules(publicUrl, rulesWithCleanUrls, matcher)).toBe(false);
  });

  // I varchi sono pubblici per necessità: se qualcuno li marcasse `requiresAuth`
  // nessuno potrebbe più autenticarsi, e il sito diventerebbe inaccessibile
  // dall'esterno senza che nulla lo segnali.
  test.each([
    ['/pluginPages/adminUsers/login.ejs'],
    ['/pluginPages/adminUsers/login'],
    ['/pluginPages/adminUsers/logout.ejs'],
  ])('%s resta PUBBLICA (isAuthEntryPoint, non requiresAuth)', (entryPointUrl) => {
    // Il ruleset con le forme pulite è un SOVRAINSIEME di quello base (la
    // derivazione aggiunge il gemello, non sostituisce l'originale), quindi
    // copre qui entrambe le forme di URL.
    const rule = matcher.findMatchingRule(entryPointUrl, rulesWithCleanUrls);
    expect(rule).toBeTruthy();
    expect(rule.requiresAuth).toBe(false);
    expect(rule.isAuthEntryPoint).toBe(true);
  });

  // La pagina del profilo utente è l'opposto: riservata per il controllo accessi
  // ordinario, non un varco.
  test('userProfile richiede autenticazione anche a superficie aperta', () => {
    const rule = matcher.findMatchingRule('/pluginPages/adminUsers/userProfile.ejs', rules);
    expect(rule.requiresAuth).toBe(true);
    expect(rule.isAuthEntryPoint).toBeUndefined();
  });
});

// Il wildcard singolo è la trappola in cui è caduta la prima correzione: sembra
// coprire entrambe le forme di URL e invece ne copre una sola. Fissarne la
// semantica qui evita che qualcuno "semplifichi" le regole tornando al wildcard.
describe('semantica del wildcard singolo (perché le regole usano match esatti)', () => {
  const matcher = new PatternMatcher();
  const wildcardRules = { '/pluginPages/adminUsers/login*': { requiresAuth: false, allowedRoles: [], isAuthEntryPoint: true } };

  test('`login*` copre la forma CON estensione', () => {
    expect(matcher.findMatchingRule('/pluginPages/adminUsers/login.ejs', wildcardRules)).toBeTruthy();
  });

  test('`login*` NON copre la forma senza estensione (* è [^/]+, uno o più)', () => {
    expect(matcher.findMatchingRule('/pluginPages/adminUsers/login', wildcardRules)).toBeFalsy();
  });

  test('`login*` cattura per sbaglio le pagine vicine', () => {
    expect(matcher.findMatchingRule('/pluginPages/adminUsers/loginHelper.ejs', wildcardRules)).toBeTruthy();
  });
});
