// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * themeIntegrity.js — La suite di integrità che OGNI tema esegue su se stesso.
 *
 * PERCHÉ ESISTE COME HELPER CONDIVISO
 * -----------------------------------
 * I test dei temi vivono in `themes/<nome>/tests/`, uno per tema: è il modello
 * self-contained del progetto — un tema clonato da un repo porta con sé il proprio
 * test. Ma il *contratto* che i sette temi devono soddisfare è uno solo, e
 * copiarlo sette volte significherebbe sette punti da aggiornare quando cambia, e
 * sei occasioni di dimenticarne uno.
 *
 * Il compromesso: il file di test resta dentro il tema (self-contained, e
 * `npm run test:themes` lo trova con il suo pattern `themes/[^/]+/tests/`), mentre
 * le asserzioni stanno qui, accanto agli altri helper condivisi. Un tema clonato in
 * un'altra installazione funziona lo stesso, perché `core/testHelpers/` fa parte
 * del CMS come `loadJson5`.
 *
 * COSA VERIFICA, E PERCHÉ PROPRIO QUESTO
 * --------------------------------------
 * Non ri-verifica ciò che `themeSys` già copre nei suoi test unitari: quello è
 * testare il validatore, non i temi. Qui si applica il validatore ai temi **veri**
 * e si aggiunge ciò che il validatore NON guarda:
 *
 * - `validateThemeContent()` percorre l'albero di inclusione a partire dai **sei
 *   partial noti**. Tutto ciò che sta in `templates/` e in
 *   `pluginsEndpointsMarkup/` non viene mai raggiunto — e sono 17 file sui 54 del
 *   repo. Qui si parte da OGNI `.ejs` del tema.
 * - Il risolutore generico non sa seguire `include(getThemePartPath('head.ejs'))`,
 *   perché il path è calcolato a runtime: lo classifica « non risolvibile » e passa
 *   oltre. Ma è **l'idioma canonico del progetto** (CLAUDE.md → *Sistema dei temi*),
 *   e sui sette temi vale 42 chiamate. Qui viene riconosciuto e verificato: se un
 *   tema chiede un partial che non ha, il render esplode — e oggi nessuno lo dice.
 * - Stessa cosa per `getThemeResourceUrl('css/theme.css')`: una risorsa assente non
 *   rompe il render, dà un 404 su **ogni pagina servita da quel tema**.
 */

const fs = require('fs');
const path = require('path');

const loadJson5 = require('../loadJson5');
const resolveIncludeTree = require('../ejsIncludeResolver');
const ThemeSys = require('../themeSys');

/** I tre modi di quotare un argomento in EJS, come già fa `validateThemeContent`. */
const QUOTES = "['\"`]";

/** `include(passData.themeSys.getThemePartPath('head.ejs'))` → `head.ejs` */
const RE_THEME_PART = new RegExp(`getThemePartPath\\(\\s*${QUOTES}([^'"\`]+)${QUOTES}\\s*\\)`, 'g');

/** `getThemeResourceUrl('css/theme.css')` → `css/theme.css` */
const RE_THEME_RESOURCE = new RegExp(`getThemeResourceUrl\\(\\s*${QUOTES}([^'"\`]+)${QUOTES}\\s*\\)`, 'g');

/**
 * Elenca ricorsivamente i file `.ejs` di una cartella.
 *
 * `node_modules` è escluso: un tema self-contained può avere le proprie dipendenze
 * npm, e i template di un pacchetto di terze parti non sono contenuto del tema.
 *
 * @param {string} dirPath
 * @param {string[]} [collected]
 * @returns {string[]} Path assoluti
 */
function collectEjsFiles(dirPath, collected = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collectEjsFiles(entryPath, collected);
    } else if (entry.name.endsWith('.ejs')) {
      collected.push(entryPath);
    }
  }
  return collected;
}

/**
 * Estrae gli argomenti letterali di tutte le chiamate a una delle due API del tema.
 *
 * @param {string[]} ejsFiles - Path assoluti
 * @param {RegExp} pattern - `RE_THEME_PART` o `RE_THEME_RESOURCE` (con flag `g`)
 * @param {string} themeRoot - Per rendere i path relativi nei messaggi
 * @returns {Array<{ target: string, inFile: string }>}
 */
function collectApiCalls(ejsFiles, pattern, themeRoot) {
  const calls = [];

  for (const filePath of ejsFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    // `matchAll` su una regex `g` condivisa è sicuro: non usa `lastIndex`.
    for (const match of source.matchAll(pattern)) {
      calls.push({ target: match[1], inFile: path.relative(themeRoot, filePath) });
    }
  }

  return calls;
}

/**
 * Esegue `fn` con `console.log`/`warn`/`error` disattivati, e li ripristina in ogni
 * caso — anche se `fn` lancia, altrimenti un errore lascerebbe muta l'intera suite.
 *
 * @param {Function} fn
 * @returns {*} Il valore restituito da `fn`
 */
function silenceConsole(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};

  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

/**
 * Registra la suite di integrità per il tema che contiene la cartella di test.
 *
 * @param {string} themeTestsDir - Passare `__dirname` dal file di test del tema.
 *        Da qui si ricavano nome e radice: il file non deve ripetere il proprio
 *        nome, così rinominare la cartella del tema non lascia un test che ne
 *        valida un altro.
 */
function describeThemeIntegrity(themeTestsDir) {
  const themeRoot = path.dirname(themeTestsDir);
  const themeName = path.basename(themeRoot);
  const themesRootPath = path.dirname(themeRoot);

  const ital8Conf = loadJson5(path.join(themesRootPath, '..', 'ital8Config.json5'));

  // Il costruttore di ThemeSys valida i temi ATTIVI e ne stampa l'esito. Con sette
  // suite sarebbero sette blocchi di log che parlano di `placeholderExample` e
  // `defaultAdminTheme` qualunque sia il tema in esame — rumore che nasconde
  // l'output dei test veri. Silenziato per la sola costruzione: i log dei test,
  // e qualunque errore, restano visibili.
  const themeSys = silenceConsole(() => new ThemeSys(ital8Conf));

  const ejsFiles = collectEjsFiles(themeRoot);

  describe(`tema "${themeName}" — integrità`, () => {
    describe('struttura e contenuto, secondo i validatori di themeSys', () => {
      test('supera la validazione strutturale', () => {
        // themeConfig.json5, views/, e i tre partial obbligatori.
        const { valid, error } = themeSys.validateTheme(themeName);
        expect({ valid, error }).toEqual({ valid: true, error: null });
      });

      test('supera la validazione di contenuto: gli hook richiesti ci sono tutti', () => {
        // Un hook mancante non rompe il render — rompe l'iniezione dei plugin,
        // che è peggio: la pagina esce, senza il CSS o gli script che le servono.
        const { errors } = themeSys.validateThemeContent(themeName, themesRootPath);
        expect(errors).toEqual([]);
      });
    });

    describe('gli include si risolvono in OGNI file, non solo nei sei partial noti', () => {
      test('il tema ha almeno un file .ejs', () => {
        // Guardia anti-vacuità: senza questa, un tema svuotato per errore
        // passerebbe ogni test qui sotto senza verificare nulla.
        expect(ejsFiles.length).toBeGreaterThan(0);
      });

      test('nessun include punta a un file inesistente', () => {
        // `validateThemeContent` parte dai sei partial noti: `templates/` e
        // `pluginsEndpointsMarkup/` non vengono mai raggiunti. Un include rotto
        // là dentro è un 500 alla prima richiesta di quella pagina.
        const broken = [];

        for (const filePath of ejsFiles) {
          const tree = resolveIncludeTree(filePath, { rootPath: themeRoot });
          for (const { filePath: inFile, target } of tree.missingIncludes) {
            broken.push(`${path.relative(themeRoot, inFile)} → include('${target}')`);
          }
        }

        expect(broken).toEqual([]);
      });
    });

    describe("l'idioma canonico del progetto, che il risolutore generico non segue", () => {
      // `include(passData.themeSys.getThemePartPath('head.ejs'))` ha un path
      // CALCOLATO: il risolutore lo classifica « non risolvibile » e passa oltre.
      // È però la forma che CLAUDE.md prescrive, e qui si può verificare davvero
      // perché il partial richiesto sta per definizione in views/ di questo tema.
      const partCalls = collectApiCalls(ejsFiles, RE_THEME_PART, themeRoot);
      const resourceCalls = collectApiCalls(ejsFiles, RE_THEME_RESOURCE, themeRoot);

      test('ogni getThemePartPath() chiede un partial che il tema possiede', () => {
        const missing = partCalls
          .filter(({ target }) => !fs.existsSync(path.join(themeRoot, 'views', target)))
          .map(({ target, inFile }) => `${inFile} → views/${target}`);

        expect(missing).toEqual([]);
      });

      test('ogni getThemeResourceUrl() chiede una risorsa che il tema possiede', () => {
        // Non rompe il render: dà un 404 su OGNI pagina servita dal tema, che è
        // il tipo di difetto che sopravvive a lungo perché la pagina "funziona".
        const missing = resourceCalls
          .filter(({ target }) => !fs.existsSync(path.join(themeRoot, 'themeResources', target)))
          .map(({ target, inFile }) => `${inFile} → themeResources/${target}`);

        expect(missing).toEqual([]);
      });
    });

    describe('descrittori — la coppia default/vivo del ciclo di vita dei config', () => {
      const defaultConfigPath = path.join(themeRoot, 'themeConfig.default.json5');
      const liveConfigPath = path.join(themeRoot, 'themeConfig.json5');

      test('esiste il sidecar themeConfig.default.json5', () => {
        // È la fonte di verità committata: il vivo è git-ignored e rigenerato al
        // boot. Senza il `.default`, un clone fresco parte senza themeConfig.
        expect(fs.existsSync(defaultConfigPath)).toBe(true);
      });

      test('il .default NON porta isInstalled: è stato runtime', () => {
        // Lo scrive il boot (`ensureThemesInstalled`). Se finisse nel `.default`,
        // un tema clonato risulterebbe installato prima di esserlo davvero.
        expect('isInstalled' in loadJson5(defaultConfigPath)).toBe(false);
      });

      test('schemaVersion è un intero ed è la PRIMA chiave del .default', () => {
        // La posizione è convenzione documentata; il tipo è ciò su cui
        // `reconcileSchemaVersions` fa il confronto di drift al boot.
        const defaultConfig = loadJson5(defaultConfigPath);
        expect(Number.isInteger(defaultConfig.schemaVersion)).toBe(true);
        expect(Object.keys(defaultConfig)[0]).toBe('schemaVersion');
      });

      test('isAdminTheme non è andato alla deriva fra .default e vivo', () => {
        // Il vivo si può modificare a mano. Se divergesse, un tema pubblico
        // potrebbe finire attivabile come admin, o viceversa.
        expect(loadJson5(liveConfigPath).isAdminTheme)
          .toBe(loadJson5(defaultConfigPath).isAdminTheme);
      });

      test('themeDescription.json5 dichiara nome, versione, autore e licenza', () => {
        const description = loadJson5(path.join(themeRoot, 'themeDescription.json5'));

        // Il nome deve combaciare con la cartella: è la cartella che `activeTheme`
        // nomina, quindi un descrittore che dice altro manda fuori strada chi
        // legge il pannello admin.
        expect(description.name).toBe(themeName);
        expect(typeof description.version).toBe('string');
        expect(description.author).toBeTruthy();
        expect(description.license).toBeTruthy();
      });

      test('se wwwCustomPath è attivo, la cartella www/ del tema esiste', () => {
        const declared = Boolean(loadJson5(liveConfigPath).wwwCustomPath);
        const wwwExists = fs.existsSync(path.join(themeRoot, 'www'));

        // Implicazione a SENSO UNICO, come la risolve `pagesManagment.getWwwPath()`.
        // Col flag ACCESO la cartella del tema è l'unica radice servita:
        // dichiararlo senza averla significa 404 su tutto il sito. Col flag spento
        // si serve il `/www` del progetto e un `www/` dentro il tema viene
        // semplicemente ignorato — inerte, non un errore: vietarlo sarebbe una
        // regola che il progetto non ha mai fatto, e boccerebbe un tema legittimo.
        expect({ declared, wwwExists }).not.toEqual({ declared: true, wwwExists: false });
      });
    });

    describe('coerenza con la configurazione globale', () => {
      test('se è il tema admin attivo, dichiara isAdminTheme: true', () => {
        // `adminActiveTheme` lo pretende. La verifica sta qui, non solo in
        // themeSys, perché è il TEMA a doversi dichiarare tale.
        if (ital8Conf.adminActiveTheme !== themeName) return;
        expect(loadJson5(path.join(themeRoot, 'themeConfig.json5')).isAdminTheme).toBe(true);
      });

      test('se è il tema pubblico attivo, NON dichiara isAdminTheme: true', () => {
        if (ital8Conf.activeTheme !== themeName) return;
        expect(loadJson5(path.join(themeRoot, 'themeConfig.json5')).isAdminTheme).not.toBe(true);
      });
    });
  });
}

module.exports = { describeThemeIntegrity, collectEjsFiles, collectApiCalls };
