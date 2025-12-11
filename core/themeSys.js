
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const loadJson5 = require('./loadJson5');
//let ital8Conf;

/**
 * ============================================================================
 * themeSys - Sistema di Gestione Temi per ital8cms
 * ============================================================================
 *
 * Gestisce il caricamento, la validazione e l'utilizzo dei temi nell'applicazione.
 * I temi sono composti da partials (views) e templates EJS, con supporto per
 * personalizzazione dei template dei plugin e gestione delle dipendenze.
 *
 * STRUTTURA TEMI:
 * themes/{themeName}/
 *   ├── views/                           # Partials riutilizzabili (head.ejs, header.ejs, footer.ejs, ecc.)
 *   ├── templates/                       # Template completi per pagine
 *   ├── themeResources/                  # Asset statici (CSS, JS, immagini)
 *   ├── pluginsEndpointsMarkup/          # Personalizzazioni template plugin
 *   ├── themeConfig.json                 # Configurazione tema
 *   └── themeDescription.json            # Metadati tema
 *
 * FUNZIONI PER CATEGORIA:
 *
 * 1. INIZIALIZZAZIONE
 *    - constructor(theItal8Conf, thePluginSys)
 *      Inizializza il sistema temi, valida temi pubblico e admin, controlla dipendenze
 *
 * 2. GESTIONE DIPENDENZE
 *    - checkDependencies(themeName)
 *      Verifica che tutte le dipendenze plugin e NPM siano soddisfatte
 *    - getThemeDependencies(themeName)
 *      Restituisce oggetto con dipendenze plugin e moduli NPM
 *    - themeRequiresPlugin(themeName, pluginName)
 *      Verifica se il tema richiede un plugin specifico
 *    - getActiveThemePluginDependencies()
 *      Restituisce dipendenze plugin del tema pubblico attivo
 *    - checkActiveThemeDependencies()
 *      Verifica dipendenze del tema pubblico attivo
 *
 * 3. VALIDAZIONE TEMI
 *    - validateTheme(themeName)
 *      Valida struttura tema (directory, file obbligatori, config)
 *    - validateThemeContent(themeName)
 *      Valida CONTENUTO partials (hook richiesti, pattern hardcoded sospetti)
 *
 * 4. INFORMAZIONI E METADATI
 *    - getAvailableThemes()
 *      Lista tutti i temi disponibili con stato di validazione
 *    - getThemeDescription(themeName)
 *      Legge metadati da themeDescription.json
 *    - getThemeVersion(themeName)
 *      Restituisce versione del tema
 *    - getActiveThemeDescription()
 *      Metadati del tema pubblico attivo
 *    - getAdminThemeDescription()
 *      Metadati del tema admin attivo
 *    - themeSupportsHook(themeName, hookName)
 *      Verifica se il tema supporta un hook specifico
 *    - getThemeFeatures(themeName)
 *      Restituisce oggetto con feature supportate dal tema
 *
 * 5. GESTIONE RISORSE TEMA
 *    - getThemeResourceUrl(resourcePath)
 *      Genera URL pubblico per risorsa del tema (es. '/theme-assets/css/theme.css')
 *    - getThemeResourcesPath()
 *      Path assoluto della cartella themeResources del tema attivo
 *    - hasThemeResources()
 *      Verifica se la cartella themeResources esiste
 *
 * 6. PATH PARTIALS
 *    - getThemePartPath(partName)
 *      Path assoluto del partial nel tema pubblico (es. 'head.ejs')
 *
 * 7. PERSONALIZZAZIONE PLUGIN (Plugin Endpoint Customization)
 *    Permette ai temi di sovrascrivere i template e gli asset degli endpoint dei plugin
 *    Struttura: themes/{themeName}/pluginsEndpointsMarkup/{pluginName}/{endpointName}/
 *
 *    - hasCustomPluginTemplate(pluginName, endpointName, templateFile, isAdmin)
 *      Verifica esistenza template personalizzato per endpoint plugin
 *    - getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin)
 *      Restituisce path del template personalizzato se esiste
 *    - resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile, isAdmin)
 *      Risolve path template con fallback (custom → default plugin)
 *    - hasCustomPluginAsset(pluginName, endpointName, assetFile, isAdmin)
 *      Verifica esistenza asset personalizzato
 *    - getCustomPluginAssetPath(pluginName, endpointName, assetFile, isAdmin)
 *      Path assoluto dell'asset personalizzato
 *    - getPluginAssetUrl(pluginName, endpointName, assetFile)
 *      URL pubblico per asset plugin personalizzato
 *    - getPluginCustomCss(pluginName, endpointName, cssFile, isAdmin)
 *      Legge contenuto CSS personalizzato (utile per inline CSS)
 *    - getCustomizedPlugins(isAdmin)
 *      Lista tutti i plugin con personalizzazioni nel tema attivo
 *
 * UTILIZZO NEI TEMPLATE EJS:
 *
 *   // Includere partial:
 *   <%- include( passData.themeSys.getThemePartPath('head.ejs') ) %>
 *
 *   // Risorse del tema:
 *   <link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
 *
 *   // Template personalizzato plugin:
 *   const templatePath = passData.themeSys.resolvePluginTemplatePath(
 *     'simpleAccess', 'login', defaultPath
 *   );
 *
 * ============================================================================
 */

class themeSys{

  //#fnInPageMap;// variabile privata

  constructor( theItal8Conf, thePluginSys = null ){// OLD OpluginSys. incorpora un istanza della classe pluginSys quindi un oggetto pluginSys da questo la O grande iniziale
    this.ital8Conf = theItal8Conf ;//OLD require('../ital8Config.json5');
    this.pluginSys = thePluginSys; // Riferimento al sistema dei plugin per il check delle dipendenze
    //this.activeTheme = activeTheme;// nome del tema attivoQUESTA DEFINIZIONE SERVE A PERMETTERE DI IMPOSTARE UN TEMA ATTIVO DIVERSO DA QUELLO IMPOSTATO NEL FIEL DI CONFIGUAZIONE , AD ESEMPIO  PER I FILE DI ADMIN IL TEMA ATTIVO SARÀ SEMPRE QUELLO DI DEFULT
    //this.#fnInPageMap = OpluginSys.fnInPage;

    // Valida tema pubblico con fallback automatico
    const publicValidation = this.validateTheme(this.ital8Conf.activeTheme);
    if (!publicValidation.valid) {
      console.warn(`[themeSys] Tema pubblico '${this.ital8Conf.activeTheme}' non valido: ${publicValidation.error}`);
      console.warn('[themeSys] Fallback al tema "default"');
      this.ital8Conf.activeTheme = 'default';
    } else {
      console.log(`[themeSys] Tema pubblico '${this.ital8Conf.activeTheme}' caricato correttamente`);

      // Valida il contenuto dei partials (hook e struttura)
      const contentValidation = this.validateThemeContent(this.ital8Conf.activeTheme);
      if (!contentValidation.valid) {
        console.error(`[themeSys] ⚠️  ERRORI nel contenuto del tema '${this.ital8Conf.activeTheme}':`);
        contentValidation.errors.forEach(err => console.error(`  ❌ ${err}`));
      }
      if (contentValidation.warnings.length > 0) {
        console.warn(`[themeSys] ⚠️  WARNING nel tema '${this.ital8Conf.activeTheme}':`);
        contentValidation.warnings.forEach(warn => console.warn(`  ⚠️  ${warn}`));
      }
      if (contentValidation.valid && contentValidation.warnings.length === 0) {
        console.log(`[themeSys] ✅ Contenuto tema pubblico validato correttamente`);
      }
    }

    // Valida che il tema pubblico NON sia marcato come admin theme
    try {
      const publicConfigPath = path.join(__dirname, '../themes', this.ital8Conf.activeTheme, 'themeConfig.json5');
      const publicConfig = loadJson5(publicConfigPath);
      if (publicConfig.isAdminTheme === true) {
        console.error(`[themeSys] ⚠️  ERRORE: Il tema pubblico '${this.ital8Conf.activeTheme}' è marcato come admin theme (isAdminTheme: true)!`);
        console.warn('[themeSys] Un tema admin non può essere usato come tema pubblico. Fallback al tema "default"');
        this.ital8Conf.activeTheme = 'default';
      }
    } catch (error) {
      console.warn(`[themeSys] Impossibile verificare isAdminTheme per tema pubblico '${this.ital8Conf.activeTheme}': ${error.message}`);
    }

    // Controlla dipendenze del tema pubblico (se pluginSys è disponibile)
    if (this.pluginSys) {
      const publicDeps = this.checkDependencies(this.ital8Conf.activeTheme);
      if (!publicDeps.satisfied) {
        console.warn(`[themeSys] Dipendenze tema pubblico non soddisfatte: ${publicDeps.errors.join(', ')}`);
      }
    }

    // Valida tema admin con fallback automatico
    const adminValidation = this.validateTheme(this.ital8Conf.adminActiveTheme);
    if (!adminValidation.valid) {
      console.warn(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' non valido: ${adminValidation.error}`);
      console.warn('[themeSys] Fallback al tema "default"');
      this.ital8Conf.adminActiveTheme = 'default';
    } else {
      console.log(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' caricato correttamente`);

      // Valida il contenuto dei partials solo se diverso dal tema pubblico (evita duplicati)
      if (this.ital8Conf.adminActiveTheme !== this.ital8Conf.activeTheme) {
        const contentValidation = this.validateThemeContent(this.ital8Conf.adminActiveTheme);
        if (!contentValidation.valid) {
          console.error(`[themeSys] ⚠️  ERRORI nel contenuto del tema admin '${this.ital8Conf.adminActiveTheme}':`);
          contentValidation.errors.forEach(err => console.error(`  ❌ ${err}`));
        }
        if (contentValidation.warnings.length > 0) {
          console.warn(`[themeSys] ⚠️  WARNING nel tema admin '${this.ital8Conf.adminActiveTheme}':`);
          contentValidation.warnings.forEach(warn => console.warn(`  ⚠️  ${warn}`));
        }
        if (contentValidation.valid && contentValidation.warnings.length === 0) {
          console.log(`[themeSys] ✅ Contenuto tema admin validato correttamente`);
        }
      }
    }

    // Valida che il tema admin SIA marcato come admin theme
    try {
      const adminConfigPath = path.join(__dirname, '../themes', this.ital8Conf.adminActiveTheme, 'themeConfig.json5');
      const adminConfig = loadJson5(adminConfigPath);
      if (adminConfig.isAdminTheme !== true) {
        console.error(`[themeSys] ⚠️  ERRORE: Il tema admin '${this.ital8Conf.adminActiveTheme}' NON è marcato come admin theme (isAdminTheme mancante o false)!`);
        console.warn('[themeSys] Un tema pubblico non può essere usato come tema admin. Fallback al tema "defaultAdminTheme"');
        this.ital8Conf.adminActiveTheme = 'defaultAdminTheme';
        // Rivalidazione dopo fallback
        const fallbackValidation = this.validateTheme('defaultAdminTheme');
        if (!fallbackValidation.valid) {
          console.error('[themeSys] ERRORE CRITICO: Tema defaultAdminTheme non trovato o non valido!');
          console.warn('[themeSys] Ultimo fallback al tema "default" (anche se non è un admin theme)');
          this.ital8Conf.adminActiveTheme = 'default';
        }
      }
    } catch (error) {
      console.warn(`[themeSys] Impossibile verificare isAdminTheme per tema admin '${this.ital8Conf.adminActiveTheme}': ${error.message}`);
    }

    // Controlla dipendenze del tema admin (se pluginSys è disponibile e tema diverso da pubblico)
    if (this.pluginSys && this.ital8Conf.adminActiveTheme !== this.ital8Conf.activeTheme) {
      const adminDeps = this.checkDependencies(this.ital8Conf.adminActiveTheme);
      if (!adminDeps.satisfied) {
        console.warn(`[themeSys] Dipendenze tema admin non soddisfatte: ${adminDeps.errors.join(', ')}`);
      }
    }
  }

  /**
   * Controlla le dipendenze di un tema (plugin e moduli NPM)
   * @param {string} themeName - Nome del tema da controllare
   * @returns {object} - { satisfied: boolean, errors: Array<string> }
   */
  checkDependencies(themeName) {
    const errors = [];
    const themePath = path.join(__dirname, '../themes', themeName);
    const configPath = path.join(themePath, 'themeConfig.json5');

    // Leggi configurazione tema
    let config;
    try {
      config = loadJson5(configPath);
    } catch (error) {
      return { satisfied: false, errors: [`Impossibile leggere themeConfig.json5: ${error.message}`] };
    }

    // Controlla dipendenze plugin
    const pluginDeps = config.pluginDependency || {};
    for (const [pluginName, versionRequired] of Object.entries(pluginDeps)) {
      if (!this.pluginSys.isPluginActive(pluginName)) {
        errors.push(`Plugin '${pluginName}' richiesto ma non attivo`);
        continue;
      }

      // Verifica versione se specificata
      if (versionRequired && versionRequired !== '*') {
        const installedVersion = this.pluginSys.getPluginVersion(pluginName);
        if (installedVersion && !semver.satisfies(installedVersion, versionRequired)) {
          errors.push(`Plugin '${pluginName}' versione ${installedVersion} non soddisfa requisito ${versionRequired}`);
        }
      }
    }

    // Controlla dipendenze moduli NPM
    const nodeDeps = config.nodeModuleDependency || {};
    for (const [moduleName, versionRequired] of Object.entries(nodeDeps)) {
      try {
        // Verifica che il modulo sia installato
        const modulePath = require.resolve(moduleName);

        // Verifica versione se specificata
        if (versionRequired && versionRequired !== '*') {
          try {
            const packageJsonPath = path.join(path.dirname(modulePath), '..', 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const installedVersion = packageJson.version;

            if (installedVersion && !semver.satisfies(installedVersion, versionRequired)) {
              errors.push(`Modulo NPM '${moduleName}' versione ${installedVersion} non soddisfa requisito ${versionRequired}`);
            }
          } catch {
            // Se non riesce a leggere la versione, considera comunque il modulo installato
            console.warn(`[themeSys] Impossibile verificare versione del modulo '${moduleName}'`);
          }
        }
      } catch {
        errors.push(`Modulo NPM '${moduleName}' richiesto ma non installato`);
      }
    }

    return {
      satisfied: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Restituisce tutte le dipendenze di un tema
   * @param {string} themeName - Nome del tema
   * @returns {object} - { plugins: {}, nodeModules: {} }
   */
  getThemeDependencies(themeName) {
    const themePath = path.join(__dirname, '../themes', themeName);
    const configPath = path.join(themePath, 'themeConfig.json5');

    try {
      if (fs.existsSync(configPath)) {
        const config = loadJson5(configPath);
        return {
          plugins: config.pluginDependency || {},
          nodeModules: config.nodeModuleDependency || {}
        };
      }
    } catch (error) {
      console.warn(`[themeSys] Errore lettura dipendenze per ${themeName}: ${error.message}`);
    }

    return { plugins: {}, nodeModules: {} };
  }

  /**
   * Verifica se un tema richiede un determinato plugin
   * @param {string} themeName - Nome del tema
   * @param {string} pluginName - Nome del plugin
   * @returns {boolean|string} - false se non richiesto, altrimenti la versione richiesta
   */
  themeRequiresPlugin(themeName, pluginName) {
    const deps = this.getThemeDependencies(themeName);
    return deps.plugins[pluginName] || false;
  }

  /**
   * Restituisce la lista dei plugin richiesti dal tema attivo
   * @returns {object} - Oggetto { pluginName: versionRequired }
   */
  getActiveThemePluginDependencies() {
    const deps = this.getThemeDependencies(this.ital8Conf.activeTheme);
    return deps.plugins;
  }

  /**
   * Verifica se tutte le dipendenze del tema attivo sono soddisfatte
   * @returns {object} - { satisfied: boolean, errors: Array }
   */
  checkActiveThemeDependencies() {
    return this.checkDependencies(this.ital8Conf.activeTheme);
  }

  /**
   * Valida un tema verificando che esista e abbia tutti i file necessari
   * @param {string} themeName - Nome del tema da validare
   * @returns {object} - { valid: boolean, error: string|null }
   */
  validateTheme(themeName) {
    const themePath = path.join(__dirname, '../themes', themeName);

    // Controlla esistenza directory del tema
    if (!fs.existsSync(themePath)) {
      return { valid: false, error: `Directory del tema '${themeName}' non trovata` };
    }

    // Controlla se è effettivamente una directory
    const stats = fs.statSync(themePath);
    if (!stats.isDirectory()) {
      return { valid: false, error: `'${themeName}' non è una directory` };
    }

    // Controlla esistenza themeConfig.json5
    const configPath = path.join(themePath, 'themeConfig.json5');
    if (!fs.existsSync(configPath)) {
      return { valid: false, error: `themeConfig.json5 mancante nel tema '${themeName}'` };
    }

    // Controlla esistenza directory views
    const viewsPath = path.join(themePath, 'views');
    if (!fs.existsSync(viewsPath)) {
      return { valid: false, error: `Directory 'views' mancante nel tema '${themeName}'` };
    }

    // Controlla partials obbligatori
    const requiredPartials = ['head.ejs', 'header.ejs', 'footer.ejs'];
    for (const partial of requiredPartials) {
      const partialPath = path.join(viewsPath, partial);
      if (!fs.existsSync(partialPath)) {
        return { valid: false, error: `Partial '${partial}' mancante nel tema '${themeName}'` };
      }
    }

    // Tutte le validazioni passate
    return { valid: true, error: null };
  }

  /**
   * Valida il CONTENUTO dei partials di un tema verificando la presenza degli hook richiesti
   * @param {string} themeName - Nome del tema da validare
   * @returns {object} - { valid: boolean, errors: Array<string>, warnings: Array<string> }
   */
  validateThemeContent(themeName) {
    const themePath = path.join(__dirname, '../themes', themeName);
    const viewsPath = path.join(themePath, 'views');
    const errors = [];
    const warnings = [];

    // Definisci gli hook richiesti per ogni partial
    const requiredHooks = {
      'head.ejs': {
        required: ['hookPage("head"', 'hookPage(\'head\'', 'hookPage(`head`'],
        description: 'Hook "head" per injection CSS/meta tags'
      },
      'header.ejs': {
        required: ['hookPage("header"', 'hookPage(\'header\'', 'hookPage(`header`'],
        description: 'Hook "header" all\'inizio del body'
      },
      'footer.ejs': {
        required: [
          ['hookPage("footer"', 'hookPage(\'footer\'', 'hookPage(`footer`'],
          ['hookPage("script"', 'hookPage(\'script\'', 'hookPage(`script`']
        ],
        description: 'Hook "footer" e "script" per injection scripts'
      },
      'nav.ejs': {
        required: ['hookPage("nav"', 'hookPage(\'nav\'', 'hookPage(`nav`'],
        description: 'Hook "nav" per navigation',
        optional: true
      },
      'main.ejs': {
        required: [
          ['hookPage("main"', 'hookPage(\'main\'', 'hookPage(`main`'],
          ['hookPage("body"', 'hookPage(\'body\'', 'hookPage(`body`']
        ],
        description: 'Hook "main" e "body" per contenuto principale',
        optional: true
      },
      'aside.ejs': {
        required: ['hookPage("aside"', 'hookPage(\'aside\'', 'hookPage(`aside`'],
        description: 'Hook "aside" per sidebar',
        optional: true
      }
    };

    // Pattern per rilevare contenuto hardcoded sospetto
    const suspiciousPatterns = [
      { pattern: /<link[^>]+href=[^>]+bootstrap/i, message: 'Bootstrap CSS hardcoded (dovrebbe essere iniettato via hook)' },
      { pattern: /<script[^>]+src=[^>]+bootstrap/i, message: 'Bootstrap JS hardcoded (dovrebbe essere iniettato via hook)' },
      { pattern: /<style>/i, message: 'Tag <style> hardcoded (CSS dovrebbe essere iniettato via hook)' },
      { pattern: /<nav[^>]+class=/i, message: 'Navbar HTML hardcoded in nav.ejs (dovrebbe essere iniettato via hook)', file: 'nav.ejs' }
    ];

    // Verifica ogni partial
    for (const [partialName, hookConfig] of Object.entries(requiredHooks)) {
      const partialPath = path.join(viewsPath, partialName);

      // Salta partials opzionali se non esistono
      if (hookConfig.optional && !fs.existsSync(partialPath)) {
        continue;
      }

      if (!fs.existsSync(partialPath)) {
        errors.push(`Partial '${partialName}' non trovato`);
        continue;
      }

      try {
        const content = fs.readFileSync(partialPath, 'utf8');

        // Verifica presenza hook richiesti
        const requiredArray = Array.isArray(hookConfig.required[0]) ? hookConfig.required : [hookConfig.required];

        for (const hookVariants of requiredArray) {
          const hookFound = hookVariants.some(variant => content.includes(variant));

          if (!hookFound) {
            const hookName = hookVariants[0].match(/hookPage\(["'`](\w+)["'`]/)[1];
            errors.push(`${partialName}: Hook "${hookName}" mancante (${hookConfig.description})`);
          }
        }

        // Verifica pattern sospetti (solo per partials non opzionali o esistenti)
        for (const { pattern, message, file } of suspiciousPatterns) {
          // Se il pattern specifica un file, controlla solo quello
          if (file && file !== partialName) continue;

          if (pattern.test(content)) {
            // Caso speciale: navbar in nav.ejs
            // Non emettere warning se c'è un wrapper <nav> ma il contenuto è iniettato via hook
            if (partialName === 'nav.ejs' && pattern.source.includes('nav')) {
              // Verifica se c'è l'hook che inietta il contenuto dinamicamente
              const hasNavHook = content.includes('pluginSys.hookPage("nav"') ||
                                 content.includes("pluginSys.hookPage('nav'") ||
                                 content.includes('pluginSys.hookPage(`nav`');

              if (hasNavHook) {
                // Hook trovato - il contenuto è dinamico, solo il wrapper è hardcoded (OK)
                continue;
              }
            }

            warnings.push(`${partialName}: ${message}`);
          }
        }

      } catch (error) {
        errors.push(`Errore lettura ${partialName}: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  /**
   * Restituisce la lista dei temi disponibili con il loro stato di validazione
   * @returns {Array} - Array di oggetti { name, valid, error }
   */
  getAvailableThemes() {
    const themesPath = path.join(__dirname, '../themes');
    const themes = [];

    try {
      const entries = fs.readdirSync(themesPath);
      for (const entry of entries) {
        const entryPath = path.join(themesPath, entry);
        const stats = fs.statSync(entryPath);

        if (stats.isDirectory()) {
          const validation = this.validateTheme(entry);
          const description = this.getThemeDescription(entry);
          themes.push({
            name: entry,
            valid: validation.valid,
            error: validation.error,
            isActive: entry === this.ital8Conf.activeTheme,
            isAdminActive: entry === this.ital8Conf.adminActiveTheme,
            description: description
          });
        }
      }
    } catch (error) {
      console.error('[themeSys] Errore nella lettura dei temi:', error.message);
    }

    return themes;
  }

  /**
   * Restituisce i metadati di un tema dal file themeDescription.json
   * @param {string} themeName - Nome del tema
   * @returns {object|null} - Oggetto con i metadati o null se non trovato
   */
  getThemeDescription(themeName) {
    const descPath = path.join(__dirname, '../themes', themeName, 'themeDescription.json5');

    try {
      if (fs.existsSync(descPath)) {
        return loadJson5(descPath);
      }
    } catch (error) {
      console.warn(`[themeSys] Errore lettura themeDescription.json5 per ${themeName}: ${error.message}`);
    }

    return null;
  }

  /**
   * Restituisce la versione di un tema
   * @param {string} themeName - Nome del tema
   * @returns {string|null} - Versione del tema o null
   */
  getThemeVersion(themeName) {
    const description = this.getThemeDescription(themeName);
    return description ? description.version : null;
  }

  /**
   * Restituisce i metadati del tema pubblico attivo
   * @returns {object|null} - Metadati del tema attivo
   */
  getActiveThemeDescription() {
    return this.getThemeDescription(this.ital8Conf.activeTheme);
  }

  /**
   * Restituisce i metadati del tema admin attivo
   * @returns {object|null} - Metadati del tema admin attivo
   */
  getAdminThemeDescription() {
    return this.getThemeDescription(this.ital8Conf.adminActiveTheme);
  }

  /**
   * Verifica se un tema supporta un determinato hook
   * @param {string} themeName - Nome del tema
   * @param {string} hookName - Nome dell'hook (es. 'head', 'footer')
   * @returns {boolean} - true se il tema supporta l'hook
   */
  themeSupportsHook(themeName, hookName) {
    const description = this.getThemeDescription(themeName);
    if (!description || !description.supportedHooks) {
      return true; // Assume supporto se non specificato
    }
    return description.supportedHooks.includes(hookName);
  }

  /**
   * Restituisce le feature supportate da un tema
   * @param {string} themeName - Nome del tema
   * @returns {object} - Oggetto con le feature
   */
  getThemeFeatures(themeName) {
    const description = this.getThemeDescription(themeName);
    return description ? (description.features || {}) : {};
  }

  /**
   * Restituisce l'URL per una risorsa del tema
   * @param {string} resourcePath - Path relativo della risorsa (es. 'css/theme.css', 'js/theme.js')
   * @param {object} passData - Oggetto passData contenente isAdminContext (opzionale per backward compatibility)
   * @returns {string} - URL completo della risorsa (es. '/public-theme-resources/css/theme.css')
   * @example
   * // Nel template EJS (consigliato - con passData):
   * // <link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css', passData) %>">
   * //
   * // Vecchio metodo (backward compatible ma deprecato):
   * // <link rel="stylesheet" href="<%= passData.themeSys.getThemeResourceUrl('css/theme.css') %>">
   */
  getThemeResourceUrl(resourcePath, passData = null) {
    // Rimuove eventuali slash iniziali dal path
    const cleanPath = resourcePath.replace(/^\/+/, '');

    // Determina il prefix corretto in base al contesto
    // Se passData.isAdminContext === true, usa adminThemeResourcesPrefix
    // Altrimenti usa publicThemeResourcesPrefix
    const prefix = (passData && passData.isAdminContext === true)
      ? this.ital8Conf.adminThemeResourcesPrefix
      : this.ital8Conf.publicThemeResourcesPrefix;

    return `/${prefix}/${cleanPath}`;
  }

  /**
   * Restituisce il path assoluto della cartella themeResources del tema attivo
   * @returns {string} - Path assoluto della cartella themeResources
   */
  getThemeResourcesPath() {
    return path.join(__dirname, '../themes', this.ital8Conf.activeTheme, 'themeResources');
  }

  /**
   * Verifica se la cartella themeResources esiste per il tema attivo
   * @returns {boolean} - true se la cartella themeResources esiste
   */
  hasThemeResources() {
    const resourcesPath = this.getThemeResourcesPath();
    return fs.existsSync(resourcesPath) && fs.statSync(resourcesPath).isDirectory();
  }

  /**
   * Restituisce il path assoluto di un partial del tema
   * @param {string} partName - Nome del partial (es. 'head.ejs', 'footer.ejs')
   * @param {object} passData - Oggetto passData contenente isAdminContext (opzionale per backward compatibility)
   * @returns {string} - Path assoluto del partial
   * @example
   * // Nel template EJS (consigliato - con passData):
   * // <%- include( passData.themeSys.getThemePartPath('head.ejs', passData) ) %>
   * //
   * // Vecchio metodo (backward compatible - senza passData):
   * // <%- include( passData.themeSys.getThemePartPath('head.ejs') ) %>
   */
  getThemePartPath(partName, passData = null) {
    // Determina quale tema usare in base al contesto
    // Se passData.isAdminContext === true, usa adminActiveTheme
    // Altrimenti usa activeTheme (pubblico)
    const themeName = (passData && passData.isAdminContext === true)
      ? this.ital8Conf.adminActiveTheme
      : this.ital8Conf.activeTheme;

    return `${__dirname}/../themes/${themeName}/views/${partName}`;
  }


  // ============================================================================
  // PLUGIN ENDPOINT CUSTOMIZATION
  // Permette ai temi di sovrascrivere i template e gli asset dei plugin
  // Struttura: themes/{themeName}/pluginsEndpointsMarkup/{pluginName}/{endpointName}/
  // ============================================================================

  /**
   * Verifica se esiste un template personalizzato nel tema per un endpoint di un plugin
   * @param {string} pluginName - Nome del plugin (es. 'simpleAccess')
   * @param {string} endpointName - Nome dell'endpoint (es. 'login')
   * @param {string} templateFile - Nome del file template (es. 'template.ejs')
   * @param {boolean} isAdmin - Se true, usa il tema admin invece del tema pubblico
   * @returns {boolean} - true se il template personalizzato esiste
   */
  hasCustomPluginTemplate(pluginName, endpointName, templateFile = 'template.ejs', isAdmin = false) {
    const customPath = this.getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin);
    return customPath !== null;
  }

  /**
   * Restituisce il path del template personalizzato se esiste, altrimenti null
   * @param {string} pluginName - Nome del plugin (es. 'simpleAccess')
   * @param {string} endpointName - Nome dell'endpoint (es. 'login')
   * @param {string} templateFile - Nome del file template (es. 'template.ejs')
   * @param {boolean} isAdmin - Se true, usa il tema admin invece del tema pubblico
   * @returns {string|null} - Path assoluto del template personalizzato o null
   */
  getCustomPluginTemplatePath(pluginName, endpointName, templateFile = 'template.ejs', isAdmin = false) {
    const themeName = isAdmin ? this.ital8Conf.adminActiveTheme : this.ital8Conf.activeTheme;
    const customPath = path.join(
      __dirname,
      '../themes',
      themeName,
      'pluginsEndpointsMarkup',
      pluginName,
      endpointName,
      templateFile
    );

    if (fs.existsSync(customPath)) {
      return customPath;
    }
    return null;
  }

  /**
   * Restituisce il path del template da usare per un endpoint di un plugin.
   * Se esiste un template personalizzato nel tema, usa quello, altrimenti usa il default del plugin.
   * @param {string} pluginName - Nome del plugin
   * @param {string} endpointName - Nome dell'endpoint
   * @param {string} defaultPath - Path di default del template nel plugin
   * @param {string} templateFile - Nome del file template (default: 'template.ejs')
   * @param {boolean} isAdmin - Se true, usa il tema admin
   * @returns {string} - Path assoluto del template da usare
   */
  resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile = 'template.ejs', isAdmin = false) {
    const customPath = this.getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin);
    if (customPath) {
      console.log(`[themeSys] Usando template personalizzato per ${pluginName}/${endpointName}: ${customPath}`);
      return customPath;
    }
    return defaultPath;
  }

  /**
   * Verifica se esistono asset personalizzati nel tema per un endpoint di un plugin
   * @param {string} pluginName - Nome del plugin
   * @param {string} endpointName - Nome dell'endpoint
   * @param {string} assetFile - Nome del file asset (es. 'style.css')
   * @param {boolean} isAdmin - Se true, usa il tema admin
   * @returns {boolean} - true se l'asset personalizzato esiste
   */
  hasCustomPluginAsset(pluginName, endpointName, assetFile, isAdmin = false) {
    const themeName = isAdmin ? this.ital8Conf.adminActiveTheme : this.ital8Conf.activeTheme;
    const assetPath = path.join(
      __dirname,
      '../themes',
      themeName,
      'pluginsEndpointsMarkup',
      pluginName,
      endpointName,
      assetFile
    );
    return fs.existsSync(assetPath);
  }

  /**
   * Restituisce il path assoluto di un asset personalizzato per un plugin
   * @param {string} pluginName - Nome del plugin
   * @param {string} endpointName - Nome dell'endpoint
   * @param {string} assetFile - Nome del file asset
   * @param {boolean} isAdmin - Se true, usa il tema admin
   * @returns {string|null} - Path assoluto dell'asset o null se non esiste
   */
  getCustomPluginAssetPath(pluginName, endpointName, assetFile, isAdmin = false) {
    const themeName = isAdmin ? this.ital8Conf.adminActiveTheme : this.ital8Conf.activeTheme;
    const assetPath = path.join(
      __dirname,
      '../themes',
      themeName,
      'pluginsEndpointsMarkup',
      pluginName,
      endpointName,
      assetFile
    );

    if (fs.existsSync(assetPath)) {
      return assetPath;
    }
    return null;
  }

  /**
   * Restituisce l'URL per un asset personalizzato di un plugin
   * @param {string} pluginName - Nome del plugin
   * @param {string} endpointName - Nome dell'endpoint
   * @param {string} assetFile - Nome del file asset (es. 'style.css')
   * @returns {string} - URL dell'asset (es. '/theme-plugin-assets/simpleAccess/login/style.css')
   */
  getPluginAssetUrl(pluginName, endpointName, assetFile) {
    return `/theme-plugin-assets/${pluginName}/${endpointName}/${assetFile}`;
  }

  /**
   * Legge il contenuto di un asset personalizzato CSS per un plugin
   * Utile per includere CSS inline nel template
   * @param {string} pluginName - Nome del plugin
   * @param {string} endpointName - Nome dell'endpoint
   * @param {string} cssFile - Nome del file CSS (default: 'style.css')
   * @param {boolean} isAdmin - Se true, usa il tema admin
   * @returns {string} - Contenuto del CSS o stringa vuota se non esiste
   */
  getPluginCustomCss(pluginName, endpointName, cssFile = 'style.css', isAdmin = false) {
    const cssPath = this.getCustomPluginAssetPath(pluginName, endpointName, cssFile, isAdmin);
    if (cssPath) {
      try {
        return fs.readFileSync(cssPath, 'utf8');
      } catch (error) {
        console.warn(`[themeSys] Errore lettura CSS personalizzato: ${error.message}`);
        return '';
      }
    }
    return '';
  }

  /**
   * Restituisce la lista dei plugin con template personalizzati nel tema attivo
   * @param {boolean} isAdmin - Se true, usa il tema admin
   * @returns {Array} - Array di oggetti { pluginName, endpoints: [...] }
   */
  getCustomizedPlugins(isAdmin = false) {
    const themeName = isAdmin ? this.ital8Conf.adminActiveTheme : this.ital8Conf.activeTheme;
    const pluginsPath = path.join(__dirname, '../themes', themeName, 'pluginsEndpointsMarkup');
    const result = [];

    if (!fs.existsSync(pluginsPath)) {
      return result;
    }

    try {
      const plugins = fs.readdirSync(pluginsPath);
      for (const pluginName of plugins) {
        const pluginPath = path.join(pluginsPath, pluginName);
        if (!fs.statSync(pluginPath).isDirectory()) continue;

        const endpoints = [];
        const endpointDirs = fs.readdirSync(pluginPath);

        for (const endpointName of endpointDirs) {
          const endpointPath = path.join(pluginPath, endpointName);
          if (!fs.statSync(endpointPath).isDirectory()) continue;

          const files = fs.readdirSync(endpointPath);
          endpoints.push({
            name: endpointName,
            files: files
          });
        }

        if (endpoints.length > 0) {
          result.push({
            pluginName: pluginName,
            endpoints: endpoints
          });
        }
      }
    } catch (error) {
      console.error(`[themeSys] Errore lettura plugin personalizzati: ${error.message}`);
    }

    return result;
  }

  /*
  questo metodo prenderà comeparamentro la parte della pagina chesu vuole generare
   Es: head, header, body, booter ecc
   e eseguirà le funzioni corrispondenti e le restituirà
  */

   //OLD 
 /*  getPagePart( pagePart, passData ){

    let stingToReturn = "";
    for( const [ nomePlugin, fnMap] of this.#fnInPageMap ){
      if( fnMap.has(pagePart) ){// se siste la parte richiesta Es se il plugin bootstrap ha richiesto di inserire qualcosa in 'head'
        stingToReturn += ` <!-- \n START ${nomePlugin} part --> \n` ;
        const fnToExc = fnMap.get(pagePart);
        stingToReturn += fnToExc(passData);// viene ottenuta la funzione che avrà come argomento (passData) e il cui valore sarà concatenato alla stringa
        stingToReturn += ` <!-- \n END ${nomePlugin} part --> \n ` ;
      }
    }

    return stingToReturn;
  } */
}

module.exports = themeSys;