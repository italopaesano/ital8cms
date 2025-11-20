
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
//let ital8Conf;

class themeSys{

  //#fnInPageMap;// variabile privata

  constructor( theItal8Conf, thePluginSys = null ){// OLD OpluginSys. incorpora un istanza della classe pluginSys quindi un oggetto pluginSys da questo la O grande iniziale
    this.ital8Conf = theItal8Conf ;//OLD require('../ital8-conf.json');
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
    const configPath = path.join(themePath, 'config-theme.json');

    // Leggi configurazione tema
    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      return { satisfied: false, errors: [`Impossibile leggere config-theme.json: ${error.message}`] };
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
    const configPath = path.join(themePath, 'config-theme.json');

    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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

    // Controlla esistenza config-theme.json
    const configPath = path.join(themePath, 'config-theme.json');
    if (!fs.existsSync(configPath)) {
      return { valid: false, error: `config-theme.json mancante nel tema '${themeName}'` };
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
   * Restituisce i metadati di un tema dal file description-theme.json
   * @param {string} themeName - Nome del tema
   * @returns {object|null} - Oggetto con i metadati o null se non trovato
   */
  getThemeDescription(themeName) {
    const descPath = path.join(__dirname, '../themes', themeName, 'description-theme.json');

    try {
      if (fs.existsSync(descPath)) {
        return JSON.parse(fs.readFileSync(descPath, 'utf8'));
      }
    } catch (error) {
      console.warn(`[themeSys] Errore lettura description-theme.json per ${themeName}: ${error.message}`);
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
   * Restituisce l'URL per un asset del tema
   * @param {string} assetPath - Path relativo dell'asset (es. 'css/theme.css', 'js/theme.js')
   * @returns {string} - URL completo dell'asset (es. '/theme-assets/css/theme.css')
   * @example
   * // Nel template EJS:
   * // <link rel="stylesheet" href="<%= passData.themeSys.getAssetUrl('css/theme.css') %>">
   */
  getAssetUrl(assetPath) {
    // Rimuove eventuali slash iniziali dal path
    const cleanPath = assetPath.replace(/^\/+/, '');
    return `/theme-assets/${cleanPath}`;
  }

  /**
   * Restituisce il path assoluto della cartella assets del tema attivo
   * @returns {string} - Path assoluto della cartella assets
   */
  getAssetsPath() {
    return path.join(__dirname, '../themes', this.ital8Conf.activeTheme, 'assets');
  }

  /**
   * Verifica se la cartella assets esiste per il tema attivo
   * @returns {boolean} - true se la cartella assets esiste
   */
  hasAssets() {
    const assetsPath = this.getAssetsPath();
    return fs.existsSync(assetsPath) && fs.statSync(assetsPath).isDirectory();
  }

  getThemePartPath( partName ){// partName Es footer.ejs header.ejs ecc
    //console.log(`${__dirname}/themes/${ital8Conf.activeTheme}/views/${partName}`);
    return `${__dirname}/../themes/${this.ital8Conf.activeTheme}/views/${partName}`;
  }

  // questa funzionesarà chiamata nela Pagine .ejs di amministrazione in core/admin/webPage
  getAdminThemePartPath( partName ){// partName Es footer.ejs header.ejs ecc
    //console.log(`${__dirname}/themes/${ital8Conf.activeTheme}/views/${partName}`);
    return `${__dirname}/../themes/${this.ital8Conf.adminActiveTheme}/views/${partName}`;
  }

  // ============================================================================
  // PLUGIN ENDPOINT CUSTOMIZATION
  // Permette ai temi di sovrascrivere i template e gli asset dei plugin
  // Struttura: themes/{themeName}/plugins/{pluginName}/{endpointName}/
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
      'plugins',
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
      'plugins',
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
      'plugins',
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
    const pluginsPath = path.join(__dirname, '../themes', themeName, 'plugins');
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