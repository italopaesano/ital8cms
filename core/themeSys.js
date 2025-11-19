
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
//let ital8Conf;

class themeSys{

  //#fnInPageMap;// variabile privata

  constructor( theItal8Conf ){// OLD OpluginSys. incorpora un istanza della classe pluginSys quindi un oggetto pluginSys da questo la O grande iniziale
    this.ital8Conf = theItal8Conf ;//OLD require('../ital8-conf.json');
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

    // Valida tema admin con fallback automatico
    const adminValidation = this.validateTheme(this.ital8Conf.adminActiveTheme);
    if (!adminValidation.valid) {
      console.warn(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' non valido: ${adminValidation.error}`);
      console.warn('[themeSys] Fallback al tema "default"');
      this.ital8Conf.adminActiveTheme = 'default';
    } else {
      console.log(`[themeSys] Tema admin '${this.ital8Conf.adminActiveTheme}' caricato correttamente`);
    }
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
          themes.push({
            name: entry,
            valid: validation.valid,
            error: validation.error,
            isActive: entry === this.ital8Conf.activeTheme,
            isAdminActive: entry === this.ital8Conf.adminActiveTheme
          });
        }
      }
    } catch (error) {
      console.error('[themeSys] Errore nella lettura dei temi:', error.message);
    }

    return themes;
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