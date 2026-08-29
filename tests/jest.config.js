/**
 * Jest Configuration per ital8cms
 *
 * Discovery dei test:
 *  - tests/unit/**, tests/integration/**            (core del progetto)
 *  - plugins/<pluginName>/tests/**                   (test per plugin)
 *  - themes/<themeName>/tests/**                     (test per temi)
 *
 * I plugin con `active: 0` in pluginConfig.json5 e i temi con `active: 0` in
 * themeConfig.json5 vengono esclusi dalla scansione.
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../core/loadJson5');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Scansiona una directory (plugins/ o themes/) e ritorna i path assoluti
 * delle sotto-directory con flag `active: 0` nel file di config specificato.
 */
function getInactivePaths(parentDir, configFileName) {
  const absoluteParent = path.join(PROJECT_ROOT, parentDir);
  if (!fs.existsSync(absoluteParent)) return [];

  // Questa scansione gira alla VALUTAZIONE della config jest, cioè PRIMA del
  // globalSetup che materializza i vivi. In un clone fresco i config vivi
  // (git-ignored) non esistono ancora, quindi si ricade sul `.default` committato
  // per leggere `active` (presente sia nel vivo sia nel default). Vedi
  // docs/decisions/config-lifecycle.it.md.
  const defaultFileName = configFileName.replace(/\.json5$/, '.default.json5');

  const inactive = [];
  for (const entry of fs.readdirSync(absoluteParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let configPath = path.join(absoluteParent, entry.name, configFileName);
    if (!fs.existsSync(configPath)) {
      configPath = path.join(absoluteParent, entry.name, defaultFileName);
      if (!fs.existsSync(configPath)) continue;
    }
    try {
      const config = loadJson5(configPath);
      if (!config || config.active === 0) {
        inactive.push(`/${parentDir}/${entry.name}/`);
      }
    } catch (_err) {
      // Se il config è corrotto, non escludiamo: sarà un test fallito più chiaro
    }
  }
  return inactive;
}

const inactivePlugins = getInactivePaths('plugins', 'pluginConfig.json5');
const inactiveThemes = getInactivePaths('themes', 'themeConfig.json5');

module.exports = {
  // Root del progetto (una directory sopra rispetto a questo file in tests/)
  rootDir: '..',

  // Ambiente di test
  testEnvironment: 'node',

  // Pattern per trovare i test
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Cartelle da ignorare
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/', // E2E gestiti da Playwright
    ...inactivePlugins,
    ...inactiveThemes
  ],

  // Coverage
  //
  // Lo scope è TUTTO il codice che la suite ha il permesso di eseguire, non il
  // sottoinsieme comodo. Fino alla v2.95.0 era `core/**` + `plugins/**/main.js`:
  // 6.133 righe su ~53.000, cioè un ottavo del progetto. Il taglio cadeva nel
  // punto peggiore, perché i plugin tengono la logica nelle `lib/` e non in
  // `main.js` — 22.227 righe restavano fuori dalla misura in ENTRAMBE le
  // direzioni: quelle ben testate non venivano accreditate, quelle mai eseguite
  // non risultavano scoperte. Una percentuale alta ottenuta stringendo la
  // domanda non è una buona notizia, è una domanda diversa.
  collectCoverageFrom: [
    'core/**/*.js',
    'plugins/**/*.js',
    'scripts/**/*.js',
    'bin/**/*.js',
    'index.js',
    // I temi entrano nella misura da v3.23.0. Sono 395 righe su 6 file, e cinque
    // di essi sono cablaggio del DOM (menu, smooth scroll, back-to-top) che un
    // test unitario non può verificare meglio di una lettura: entrano a 0% e
    // restano lì a dichiararlo. Il sesto, `defaultAdminTheme/escapeHtml.js`, è il
    // LIVELLO 2 della difesa XSS del pannello admin — quello sì testato, ed è la
    // ragione per cui questa riga è stata aggiunta.
    //
    // Prima di v3.23.0 quelle righe non erano « scoperte »: erano INVISIBILI, e
    // una protezione di sicurezza senza test non risultava da nessuna parte. Il
    // costo misurato dell'inclusione è fra 0,24 e 0,60 punti percentuali.
    'themes/**/*.js',
    '!**/node_modules/**',
    // I file di test non sono il codice sotto misura.
    '!**/tests/**',
    // I plugin non attivi sono già fuori dalla discovery dei test
    // (testPathIgnorePatterns, poche righe più sopra): misurarne il codice
    // significherebbe gonfiare il denominatore con righe che la suite non ha il
    // permesso di testare. Stessa lista, così le due esclusioni non divergono.
    ...inactivePlugins.map((dir) => `!${dir.replace(/^\//, '')}**`)
  ],

  // Soglia minima di copertura — un CRICCHETTO, non un obiettivo.
  //
  // DOVE VIENE APPLICATA. Il job `coverage` del workflow CI esegue
  // `npm run test:coverage` a ogni pull request: è lì che questa soglia diventa un
  // check che può fallire. Vive qui e non nel workflow di proposito — così un
  // `npm run test:coverage` in locale dà lo stesso verdetto della CI, invece di
  // scoprirlo dopo il push. Nota che `npm test` lancia jest SENZA `--coverage`:
  // la suite normale non valuta la soglia, e non deve.
  //
  // Serve a impedire che la copertura SCENDA, non a spingerla a salire: il valore
  // è un punto sotto quello raggiunto (52,12 / 51,10 / 47,39 / 52,87 al momento in
  // cui è stata introdotta), non una meta da rincorrere. Un numero alto ottenuto
  // per inseguire la soglia non è una buona notizia — è una domanda diversa.
  //
  // PERCHÉ UN PUNTO DI MARGINE. Un refactor onesto può ridurre numeratore e
  // denominatore insieme e far oscillare la percentuale di qualche decimo senza
  // che si sia perso nulla. Con la soglia esattamente al valore attuale, la CI
  // diventerebbe rossa per un motivo che non è una regressione di copertura, e
  // una soglia che si impara a scavalcare smette di essere un presidio.
  //
  // PERCHÉ QUATTRO METRICHE E NON SOLO `lines`. `functions` è la più bassa (47,4%)
  // ed è quella che distingue un modulo **eseguito** da uno soltanto **caricato**:
  // un `require()` in cima a un test alza le righe senza esercitare niente.
  //
  // QUANDO ALZARLA. Dopo un intervento che aggiunge copertura in modo stabile,
  // riportando ciascun valore a un punto sotto il nuovo raggiunto. Mai in un commit
  // che non aggiunge test.
  //
  // ⚠ MISURARE SEMPRE **OFFLINE**. I 5 test di `themesInstall.realRepo` si saltano
  // da soli quando GitHub non è raggiungibile (`NETWORK_OK ? test : test.skip`),
  // quindi la copertura è più ALTA su una macchina connessa. I valori qui sotto
  // vengono da una run offline, cioè dal caso peggiore: alzarli partendo da una run
  // *con* rete armerebbe una trappola: una CI che perde la connessione andrebbe
  // rossa senza che nessuno abbia peggiorato niente.
  //
  // ⚠ Il denominatore dipende da `collectCoverageFrom`, che ESCLUDE i plugin
  // disattivati: attivare o disattivare un plugin sposta numeratore e denominatore
  // insieme e può far variare le percentuali senza che sia cambiato un test.
  // Se succede, il valore va rivisto — non è la soglia ad avere torto.
  //
  // MISURATO in v3.23.0, includendo `themes/**/*.js`: il denominatore si è mosso
  // di 395 righe e le quattro metriche sono scese fra 0,24 e 0,60 punti, restando
  // tutte sopra la soglia. Margini attuali: statements +1,25 · branches +1,38 ·
  // functions +1,50 · lines +1,95. La soglia NON è stata abbassata: il margine
  // regge, e abbassarla avrebbe reso il cricchetto più lasco senza motivo.
  coverageThreshold: {
    global: {
      statements: 51,
      branches: 50,
      functions: 46,
      lines: 51
    }
  },

  // Reporter
  verbose: true,

  // Timeout per test (10 secondi)
  testTimeout: 10000,

  // Materializzazione dei config vivi dai .default, una sola volta prima della
  // suite (replica il boot di index.js) → la suite è "fresh-clone safe": i test
  // che leggono i config vivi reali (ital8Config, themeConfig, ...) li trovano
  // anche in un checkout pulito dove i vivi git-ignored non esistono ancora.
  globalSetup: '<rootDir>/tests/globalSetup.js',

  // Setup file
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Clear mocks tra i test
  clearMocks: true,

  // Esecuzione seriale: i test di integrazione (httpsServer, httpsDiagnostics)
  // modificano lo stesso file ital8Config.json5 e spawnano server sulle stesse porte.
  // Con maxWorkers > 1 si verificano race condition su config e EADDRINUSE sulle porte.
  maxWorkers: 1
};
