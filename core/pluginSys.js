
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const logger = require('./logger');
const loadJson5 = require('./loadJson5');
const saveJson5 = require('./saveJson5');

class pluginSys{

  #pluginsMiddlewares = Array();//Variabile privata che contiene l'elenco dei midlware dei plugin da aggiungere
  #hooksPage;// variabile privata che conterrà la mappa degli hookdella pagina
  #routes;// variabile privata che conterrà le rotte aggiunte dai vari plugin
  #objectToShareToWebPages = {};// variabile che conterà gli ogetti restituiti dai vari plugin che saranno messi a dispozione del motore ejs e degli altri moduli
  #activePlugins = new Map();// Mappa che conterrà i plugin attivi
  #pluginsToActive = new Map();// plugin da attivare non ancora attivati perchè bisogna controllare le dipendenze
  #themeSys = null;// riferimento al sistema dei temi (impostato dopo l'inizializzazione)
  #ital8Conf = null;// configurazione principale del sistema (per whitelist funzioni globali)

  constructor(ital8Conf){// qui bisognerà andare nella cartelle dai plugin e caricarli uno a uno

    // Salva riferimento alla configurazione principale
    this.#ital8Conf = ital8Conf; 

    this.#hooksPage = new Map();// new Map(['namelPlugin', new Map(['head', (passData) => {}],['body', ( passData ) => {} ])]);
    this.#routes = new Map();// mappa che conterrà come chiave il nome del plugin da caricare e come valore un array contenete tutti gli ogetti che rappresentano le rotte

    //function caricatePlugin( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ){// questa funzione caricherà e se necessario installeà il plugin passato
    // ATTENZIONE USO LA FUNZIONE FRECCIA PER MANTENERE il this locale , però la funzione freccia va dichiarata prima del suo utilizzo
    const caricatePlugin = ( pluginName ) => { //, routes, hooksPage, objectToShareToWebPages, activePlugins ){/
      //caricatePlugin = ( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ) => {// q

      // Calcola il percorso della cartella del plugin
      const pathPluginFolder = path.join(__dirname, '..', 'plugins', pluginName);

      try {
        //console.log(pluginConfig);
        const pluginConfig = loadJson5(path.join(__dirname, '..', 'plugins', pluginName, 'pluginConfig.json5'));
        const plugin = require(`../plugins/${pluginName}/main.js`);//

        // Aggiungi metadata al plugin object per uso futuro
        plugin.pluginName = pluginName;
        plugin.pathPluginFolder = pathPluginFolder;

        // setto i plugin attivi prima del loading e dell'onstall i modo che ,, una volta caricati gliogeti condivisi questi potranno essere utilizati nel loading e nell'install
        this.#activePlugins.set( pluginName, plugin);//pluginName è il nome del plugin oltre che aggiungo il plugin alla lista dei plugin attivi

        //START CARICO GLI OGGETTI CONDIVISI PRIMA DI CHIAMARE LA FUNZION loadPlugin() ed installPlugin permettendo di utilizare gli ogetti condivisi in fase d'installazione o di loading
        //adesso crea e carico gli ogetti confivisi fra i plugin : ogni plugin chiamerà la funzione getObjectToShareToOthersPlugin( pluginName); passando il proprio nome come parametro ed ottenendo l'ogetto a lui destinato immagazinandolo con la funzione : setSharedObject( pluginName, object ) dove in questo caso pluginname è il nome del plugin dal quale si riceve l'ogetto o object l'aogetto che si riceve
        this.#activePlugins.forEach( ( plugin0, nomePlugin0  ) => { // per ogni plugin itero per tutti gli altri plugins escludendo se stesso
          if(plugin0.getObjectToShareToOthersPlugin){// mi assicuro che la funzione appropiata esista
            this.#activePlugins.forEach( ( plugin1, nomePlugin1 ) => {
                if( nomePlugin0 !== nomePlugin1){// mi assicuro che il plugin non richiami le funzioni su sse stesso
                  if(plugin1.setSharedObject){// mi assicuro che la funzione appropiata esiste
                    plugin1.setSharedObject( nomePlugin0, plugin0.getObjectToShareToOthersPlugin( nomePlugin1 ) );
                  }
                }
            });
          }// if(plugin0.getObjectToShareToOthersPlugin){/
        });// this.#activePlugins.forEach( ( nomePlugin0, plugin0 ) => {

        if( pluginConfig.isInstalled == 0 ){// allora il plugin è attivo ma non installto quindi bisogna istallarlo
          try {
            plugin.installPlugin(this, pathPluginFolder);// installo il plugin passando pluginSys e path
          } catch (installError) {
            logger.error('pluginSys', `Errore durante installazione plugin ${pluginName}`, installError);
            throw installError; // Rilancia per gestione esterna
          }
          pluginConfig.isInstalled = 1;//ora devo aggiornare pluginConfig.json5 settando isInstalled = 1
          plugin.pluginConfig = pluginConfig ;// aggiorno anche l'ogetto interno al plugin

          // scrivo il nuovo file pluginConfig.json5 con la variabile isInstalled aggiornata correttamente
          // IMPORTANTE: Usa saveJson5() per preservare il formato JSON5 con commenti
          saveJson5(path.join(__dirname, '..', 'plugins', pluginName, 'pluginConfig.json5'), pluginConfig)
          .catch( (error) => {
            logger.error('pluginSys', `Errore scrittura pluginConfig.json5 per ${pluginName}`, error);
          });
        }// if( pluginConfig.isInstalled == 0 ){

        // SISTEMA DI UPGRADE: controlla se la versione del plugin è cambiata
        const pluginDescription = loadJson5(path.join(__dirname, '..', 'plugins', pluginName, 'pluginDescription.json5'));
        const newVersion = pluginDescription.version;
        const oldVersion = pluginConfig.version || '0.0.0'; // Se non esiste, assume 0.0.0

        if (semver.valid(newVersion) && semver.valid(oldVersion) && semver.gt(newVersion, oldVersion)) {
          // Nuova versione rilevata! Esegui upgrade
          logger.info('pluginSys', `Upgrade plugin ${pluginName}: ${oldVersion} -> ${newVersion}`);

          if (plugin.upgradePlugin) {
            try {
              plugin.upgradePlugin(this, pathPluginFolder, oldVersion, newVersion);
              logger.info('pluginSys', `Upgrade ${pluginName} completato con successo`);
            } catch (upgradeError) {
              logger.error('pluginSys', `Errore durante upgrade plugin ${pluginName}`, upgradeError);
              throw upgradeError;
            }
          } else {
            logger.debug('pluginSys', `Nessuna funzione upgradePlugin() per ${pluginName}, skip migrazione`);
          }

          // NOTA: La versione NON viene mai salvata in pluginConfig.json5
          // La versione è sempre letta SOLO da pluginDescription.json5 (read-only)
          // Questo evita corruzioni del file pluginConfig.json5 durante aggiornamenti
        }

        // aggiungo le rotte del plugin all'elenco delle rotte da caricare
        if(plugin.getRouteArray){// controllo se è presente la funzione
          this.#routes.set(pluginName, plugin.getRouteArray());// asspcierò al nome del plugin l'array dele rotte
          // OLD this.routeMap.set(pluginName, plugin.getRouteArray()); // questa mappa conterrà come chiave il nome del modulo e come valore l'array di tutte le rotte del modulo
        }

        // aggiungo gli elementi a this.fnInPage con la struttura descritta nel costruttore
        if(plugin.getHooksPage){ // controllo se esiste la funzione
          this.#hooksPage.set( pluginName,  plugin.getHooksPage());// aggiungo gli hook alle pagine
          // OLD this.fnInPage.set( pluginName,  plugin.getFnInPageMap());//pluginName corrisponde al nome del plugin
        }

        //aggiungi gli ogetti da condividere nei template engine
        if(plugin.getObjectToShareToWebPages){
          this.#objectToShareToWebPages[pluginName] = plugin.getObjectToShareToWebPages();
        }

        //aggiungo i midlware di ogli plugin
        if(plugin.getMiddlewareToAdd){
          // IMPORTANTE: usa .bind(plugin) per preservare il contesto 'this' quando la funzione viene chiamata in index.js
          this.#pluginsMiddlewares.push( plugin.getMiddlewareToAdd.bind(plugin) );// sarà un array di funzioni che generano un array
        }

        // loadPluginn(); // viene chiamato dopo perchè durante il caricamento potrebbe acadere che abbia bisogno di librerie di altri plugin
        try {
          plugin.loadPlugin(this, pathPluginFolder);// questo carica il plugin passando pluginSys e path
        } catch (loadError) {
          logger.error('pluginSys', `Errore durante caricamento plugin ${pluginName}`, loadError);
          throw loadError; // Rilancia per gestione esterna
        }

        logger.info('pluginSys', `Plugin caricato: ${pluginName}`);

      } catch (error) {
        logger.error('pluginSys', `Errore fatale nel plugin ${pluginName}`, error);

        // Rimuovi il plugin dalla lista dei plugin attivi se era stato aggiunto
        if (this.#activePlugins.has(pluginName)) {
          this.#activePlugins.delete(pluginName);
        }

        // Rilancia l'errore per bloccare il sistema (comportamento critico)
        // Per permettere al sistema di continuare, commenta la riga seguente
        throw new Error(`Impossibile caricare il plugin ${pluginName}: ${error.message}`);
      }



    }// const caricatePlugin = ( pluginName, pluginConfig ) => {

    // adesso leggo tutti i file della cartella plugins e ciclo per attivari e caricare quelli per essere caricati
    const baseDir =  path.join(__dirname, '..', 'plugins' ) ;//ottengo ilpercorso della directory plugins
    let Afiles = fs.readdirSync( baseDir );// gli dico di leggere il contenuto della directori plugins e metterloin un arra ps linux non distingue fra file e directori sono tutti fil eper lui
    Afiles = Afiles.filter(file => fs.statSync(baseDir + '/' +file).isDirectory())// prendo solo i "file" che in realtà sono directory

    const pluginsVersionMap = new Map();// mappa che conter le coppie nomePlugin -> Versione di tutti i plugin caricati o meno

    for( const nameFile of Afiles ){

      const pluginConfig = loadJson5(path.join(__dirname, '..', 'plugins', nameFile, 'pluginConfig.json5'));

      if( pluginConfig.active == 1 ){// il plugin è attivo quindi lo carico e dopo ( nell funzione caricate plugin controllo anche se è installato )

        // VALIDAZIONE DIPENDENZE NPM (nodeModuleDependency)
        // Controlla che tutti i moduli npm richiesti siano installati e compatibili
        if (pluginConfig.nodeModuleDependency && Object.keys(pluginConfig.nodeModuleDependency).length > 0) {
          const missingModules = [];
          const incompatibleModules = [];

          for (const [moduleName, requiredVersion] of Object.entries(pluginConfig.nodeModuleDependency)) {
            try {
              // Verifica se il modulo è installato controllando il package.json
              // (funziona sia per moduli JS che per pacchetti di soli asset come bootstrap-icons)
              const modulePackagePath = path.join(__dirname, '..', 'node_modules', moduleName, 'package.json');

              // Verifica esistenza del file package.json
              if (!fs.existsSync(modulePackagePath)) {
                throw new Error('Modulo non trovato');
              }

              // Ottieni la versione installata dal package.json del modulo
              const modulePackage = require(modulePackagePath);
              const installedVersion = modulePackage.version;

              // Verifica compatibilità versione con semver
              if (!semver.satisfies(installedVersion, requiredVersion)) {
                incompatibleModules.push({
                  name: moduleName,
                  required: requiredVersion,
                  installed: installedVersion
                });
              }
            } catch (error) {
              // Modulo non trovato
              missingModules.push({
                name: moduleName,
                required: requiredVersion
              });
            }
          }

          // Se ci sono moduli mancanti o incompatibili, genera errore descrittivo
          if (missingModules.length > 0 || incompatibleModules.length > 0) {
            let errorMessage = `[pluginSys] ERRORE: Il plugin "${nameFile}" ha dipendenze npm non soddisfatte:\n`;

            if (missingModules.length > 0) {
              errorMessage += `\nModuli mancanti:\n`;
              missingModules.forEach(m => {
                errorMessage += `  - ${m.name}@${m.required}\n`;
              });
            }

            if (incompatibleModules.length > 0) {
              errorMessage += `\nModuli con versione incompatibile:\n`;
              incompatibleModules.forEach(m => {
                errorMessage += `  - ${m.name}: richiesta ${m.required}, installata ${m.installed}\n`;
              });
            }

            // Genera comando npm install per risolvere
            const allModules = [
              ...missingModules.map(m => `${m.name}@${m.required}`),
              ...incompatibleModules.map(m => `${m.name}@${m.required}`)
            ];
            errorMessage += `\nPer risolvere, eseguire:\n  npm install ${allModules.join(' ')}\n`;

            throw new Error(errorMessage);
          }
        }

        const pluginVersion = loadJson5(path.join(__dirname, '..', 'plugins', nameFile, 'pluginDescription.json5')).version;
        pluginsVersionMap.set( nameFile, pluginVersion);// nameFile = nome plugin , creo la mappa : nomeplugin --> versione

        //const plugin = require(`../plugins/${nameFile}/main.js`);// carico il plugin
        const dependencyList = new Map(Object.entries( pluginConfig.dependency ));
        if( dependencyList.size == 0  ){// allora il plugin non ha dipendenze è può essere caricato direttamente
          //console.log( dependencyList );
          caricatePlugin( nameFile ) ; 

        }else{// il plugin ha dipendenze e bisogna fare in modo che queste 

          this.#pluginsToActive.set( nameFile, dependencyList );//nameFile = nome plugin , dependencyList = mappa che contiene la lista delle dipendenze

        }// if else
        
        
      }// if( pluginConfig.active == 1 ){

    }// for( const nameFile of Afiles ){

    //ATTENZIONE ADESSO POTREBBERO ESSERCI DIPENDENZE NEI PLUGIN CHE POTREBBERO NON POTER ESSERE SODDISFATTE
    //START CONTROLLO ERRORI: SE CI SONO : 1) DIPENDENZE NON SODDISFATTE (INCLUSI ERRORI DI VERSIONE) 2)DIPENDENZE INCROCIATE 3)DIPENDENZE CON SE STESSI

    //ATTENZIONE I PUNTI 2 E 3 DEVONO ANCORA ESSERE SVLUPPATI E QUESTO PUÒ PORTARE A CICLI INFINIT
    this.#pluginsToActive.forEach( ( dependencyMap, nomePlugin ) => {

      dependencyMap.forEach( ( versionRequest, dependencyPluginName ) => {
        if( !pluginsVersionMap.has( dependencyPluginName || !semver.satisfies( pluginsVersionMap.get(dependencyPluginName), versionRequest ) ) ){//semver.satisfies è un metoo di una libreria che controlla se la versione richiesta è compatibile con quella installata
          throw new Error(`ERRORE dipendenza non soddisfatta il plugin ${nomePlugin} a come dipendenza il plugin ${dependencyPluginName} che deve essere almeno alla versione: ${versionRequest} ed è alla versione ${pluginsVersionMap.get(dependencyPluginName)}`);
        }
      });

    });

    // CONTROLLO DIPENDENZE CIRCOLARI (Punto 2 e 3)
    // Algoritmo DFS per rilevare cicli nel grafo delle dipendenze
    function detectCircularDependencies(pluginsToActive) {
      const visited = new Set();
      const recursionStack = new Set();
      const cyclePath = [];

      function hasCycle(pluginName) {
        visited.add(pluginName);
        recursionStack.add(pluginName);
        cyclePath.push(pluginName);

        const dependencies = pluginsToActive.get(pluginName);
        if (dependencies) {
          for (const [depName] of dependencies) {
            // Ignora dipendenze già caricate (senza dipendenze proprie)
            if (!pluginsToActive.has(depName)) {
              continue;
            }

            if (!visited.has(depName)) {
              if (hasCycle(depName)) {
                return true;
              }
            } else if (recursionStack.has(depName)) {
              // Ciclo trovato! Costruisci il percorso del ciclo
              cyclePath.push(depName);
              return true;
            }
          }
        }

        cyclePath.pop();
        recursionStack.delete(pluginName);
        return false;
      }

      for (const [pluginName] of pluginsToActive) {
        if (!visited.has(pluginName)) {
          if (hasCycle(pluginName)) {
            // Trova il punto di inizio del ciclo nel path
            const cycleStart = cyclePath.indexOf(cyclePath[cyclePath.length - 1]);
            const cycle = cyclePath.slice(cycleStart);
            throw new Error(
              `ERRORE: Dipendenza circolare rilevata!\n` +
              `Ciclo: ${cycle.join(' -> ')}\n` +
              `I plugin non possono dipendere circolarmente l'uno dall'altro.`
            );
          }
        }
      }
    }

    // Esegui controllo dipendenze circolari
    detectCircularDependencies(this.#pluginsToActive);

    //END CONTROLLO ERRORI


    // adesso mi trovo due mappe una con i plugin attivati e l'altra con quelli da attivare in basee alle dipendenze
    // this.#pluginsToActive --> plugin da attivare this.#activePlugins --> plugin attivi

    while( this.#pluginsToActive.size != 0 ){// finche ci sono elementi da attivare continua il ciclo
      this.#pluginsToActive.forEach( ( dependency, nomePlugin ) => {//CONTROINTUITIVO -> valore chiave -> il valore viene primadella chiave 
        //devo controllare se tutte le dipenze sono soddisfatte, cioè se tutti i moduli da cui dipende sono attivi

        if( isPluginDependenciesSatisfied( this.#activePlugins, dependency ) ){// se tutte le pipendenze sono presenti nei plugin gia attivi allora attiva anche questo plugin

          caricatePlugin( nomePlugin ) ;// questa funzione attiverà il plugin ed aggiornerà la mappa con i plugin già attivati this.#activePlugin
          this.#pluginsToActive.delete( nomePlugin );// dopo aver attivato il plugin lo rimuovo da gli elementi da attivare
        }
      });
    }

    // controllo che le chiavi della mappa passate come dipendenze siano tutti presenti nella pluginList
    function isPluginDependenciesSatisfied( pluginsListMap , dependencyMap ){// ritorna vero se i moduli già caricati posso sodisfare le dipendeze del modulo da caricare ,falso altrimenti
      //console.log( 'dependencyMap:', dependencyMap );

      // FIX: Usare for...of invece di forEach per permettere il return
      // Il return dentro forEach non esce dalla funzione ma solo dalla callback
      for( const [pluginName, version] of dependencyMap ){
        if( !pluginsListMap.has( pluginName ) ){
          return false;
        }
      }

      return true;
    }

/*     //adesso crea e carico gli ogetti confivisi fra i plugin : ogni plugin chiamerà la funzione getObjectToShareToOthersPlugin( pluginName); passando il proprio nome come parametro ed ottenendo l'ogetto a lui destinato immagazinandolo con la funzione : setSharedObject( pluginName, object ) dove in questo caso pluginname è il nome del plugin dal quale si riceve l'ogetto o object l'aogetto che si riceve 
    this.#activePlugins.forEach( ( plugin0, nomePlugin0  ) => { // per ogni plugin itero per tutti gli altri plugins escludendo se stesso
      if(plugin0.getObjectToShareToOthersPlugin){// mi assicuro che la funzione appropiata esista
        this.#activePlugins.forEach( ( plugin1, nomePlugin1 ) => {
            if( nomePlugin0 =! nomePlugin1){// mi assicuro che il plugin non richiami le funzioni su sse stesso
              if(plugin1.setSharedObject){// mi assicuro che la funzione appropiata esiste 
                plugin1.setSharedObject( nomePlugin0, plugin0.getObjectToShareToOthersPlugin( nomePlugin1 ) );
              }
            }
        });
      }// if(plugin0.getObjectToShareToOthersPlugin){/
    });// this.#activePlugins.forEach( ( nomePlugin0, plugin0 ) => { */
    
    

  }// END constructor()

  getMiddlewaresToLoad(){
    return this.#pluginsMiddlewares;
  }
  
  getObjectsToShareInWebPages(){ // ritorno gli ogetti da condividere con gli altri
    return this.#objectToShareToWebPages;
  }

  /**
   * Ritorna le funzioni globali da esportare nei template EJS
   * SICUREZZA: Solo le funzioni nella whitelist (ital8Config.json5) possono diventare globali
   *
   * Comportamento:
   * - required: true  → CRASH STARTUP se plugin mancante (fail-fast)
   * - required: false → Crea funzione fallback che logga WARNING quando chiamata
   * - Plugin che provano a esportare funzioni NON in whitelist → WARNING + ignorate
   * - Versione locale (passData.plugin.{pluginName}.{function}) SEMPRE disponibile
   *
   * @returns {Object} - Oggetto con funzioni globali { nomeFunzione: function }
   * @example
   * // In ital8Config.json5:
   * "globalFunctionsWhitelist": {
   *   "__": { "plugin": "simpleI18n", "required": true }
   * }
   *
   * // Nei template EJS (sintassi globale):
   * <%- __({ en: "Hello", it: "Ciao" }, passData.ctx) %>
   *
   * // Sintassi locale (sempre disponibile):
   * <%- passData.plugin.simpleI18n.__({ en: "Hello", it: "Ciao" }, passData.ctx) %>
   */
  getGlobalFunctions() {
    const globalFunctions = {};
    const whitelist = this.#ital8Conf?.globalFunctionsWhitelist || {};

    // Se whitelist vuota, log warning e ritorna oggetto vuoto
    if (Object.keys(whitelist).length === 0) {
      logger.warn('pluginSys', '⚠️  No globalFunctionsWhitelist configured in ital8Config.json5');
      logger.warn('pluginSys', '   Global functions disabled - use local syntax: passData.plugin.{pluginName}.{function}');
      return globalFunctions;
    }

    // Itera sulla whitelist e registra funzioni autorizzate
    for (const [functionName, config] of Object.entries(whitelist)) {
      const pluginName = config.plugin;
      const isRequired = config.required !== undefined ? config.required : false; // Default: false

      // Verifica se il plugin è attivo
      if (!this.#activePlugins.has(pluginName)) {
        if (isRequired) {
          // REQUIRED: Plugin mancante → CRASH STARTUP (fail-fast)
          const errorMsg =
            `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🚨 FATAL: REQUIRED GLOBAL FUNCTION NOT AVAILABLE\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `  Function: "${functionName}"\n` +
            `  Required plugin: "${pluginName}"\n` +
            `  Status: Plugin NOT active\n\n` +
            `Description: ${config.description || 'N/A'}\n\n` +
            `Fix options:\n` +
            `  1. Activate plugin "${pluginName}" in plugins/${pluginName}/pluginConfig.json5\n` +
            `  2. Set "required": false in ital8Config.json5 (uses fallback)\n` +
            `  3. Remove "${functionName}" from globalFunctionsWhitelist\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          logger.error('pluginSys', errorMsg);
          throw new Error(`Required plugin "${pluginName}" for global function "${functionName}" is not active`);
        }

        // OPTIONAL: Plugin mancante → Crea funzione fallback
        logger.warn('pluginSys', `⚠️  Plugin "${pluginName}" not active for function "${functionName}", using fallback`);
        globalFunctions[functionName] = this.#createFallbackFunction(functionName, pluginName);
        continue;
      }

      // Plugin attivo → Registra funzione normalmente
      const plugin = this.#activePlugins.get(pluginName);
      const shared = plugin.getObjectToShareToWebPages?.();

      if (shared?.[functionName] && typeof shared[functionName] === 'function') {
        globalFunctions[functionName] = shared[functionName];
        logger.debug('pluginSys', `✓ Global function "${functionName}" registered from plugin "${pluginName}"`);
      } else {
        logger.warn('pluginSys', `⚠️  Plugin "${pluginName}" doesn't export function "${functionName}"`);
      }
    }

    // SICUREZZA: Valida che nessun plugin violi la whitelist
    this.#validateWhitelistViolations(whitelist);

    return globalFunctions;
  }

  /**
   * Crea una funzione fallback per funzioni globali opzionali non disponibili
   * Quando chiamata, logga WARNING e ritorna valore di default
   * @private
   * @param {string} functionName - Nome della funzione
   * @param {string} pluginName - Nome del plugin che dovrebbe fornire la funzione
   * @returns {Function} - Funzione fallback
   */
  #createFallbackFunction(functionName, pluginName) {
    if (functionName === '__') {
      // Fallback speciale per i18n: ritorna prima traduzione disponibile
      return (translations, ctx) => {
        logger.warn('pluginSys', `⚠️  Translation function __() called but plugin "${pluginName}" not active`);

        // Cerca la prima traduzione disponibile
        const langs = ['en', 'it', 'es', 'fr', 'de'];
        for (const lang of langs) {
          if (translations?.[lang]) {
            return translations[lang];
          }
        }

        // Nessuna traduzione trovata
        return '[NO TRANSLATION]';
      };
    }

    // Fallback generico: ritorna stringa vuota
    return (...args) => {
      logger.warn('pluginSys', `⚠️  Function "${functionName}" called but plugin "${pluginName}" not active`);
      return '';
    };
  }

  /**
   * Valida che nessun plugin provi a esportare funzioni globali non autorizzate
   * SICUREZZA: Plugin che violano la whitelist vengono segnalati ma NON bloccano il sistema
   * @private
   * @param {Object} whitelist - Whitelist delle funzioni autorizzate
   */
  #validateWhitelistViolations(whitelist) {
    const violations = [];

    for (const [pluginName, plugin] of this.#activePlugins.entries()) {
      const shared = plugin.getObjectToShareToWebPages?.();
      if (!shared) continue;

      // Trova tutte le funzioni esportate dal plugin
      const exportedFunctions = Object.keys(shared).filter(
        key => typeof shared[key] === 'function'
      );

      // Verifica ogni funzione contro la whitelist
      for (const funcName of exportedFunctions) {
        const whitelistEntry = whitelist[funcName];

        if (!whitelistEntry) {
          // Funzione NON in whitelist → VIOLAZIONE
          violations.push({
            plugin: pluginName,
            function: funcName,
            reason: 'not in whitelist',
            suggestion: `Add to globalFunctionsWhitelist in ital8Config.json5 to enable`
          });
        } else if (whitelistEntry.plugin !== pluginName) {
          // Funzione riservata ad ALTRO plugin → VIOLAZIONE
          violations.push({
            plugin: pluginName,
            function: funcName,
            reason: `reserved for plugin "${whitelistEntry.plugin}"`,
            suggestion: `Only "${whitelistEntry.plugin}" can export this function`
          });
        }
      }
    }

    // Se ci sono violazioni, logga WARNING dettagliato
    if (violations.length > 0) {
      logger.warn('pluginSys', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.warn('pluginSys', '⚠️  GLOBAL FUNCTIONS WHITELIST VIOLATIONS DETECTED');
      logger.warn('pluginSys', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      violations.forEach(v => {
        logger.warn('pluginSys', `   ❌ Plugin "${v.plugin}" exports "${v.function}" (${v.reason})`);
        logger.warn('pluginSys', `      💡 ${v.suggestion}`);
      });

      logger.warn('pluginSys', '');
      logger.warn('pluginSys', '   These functions will NOT be available globally');
      logger.warn('pluginSys', '   Use local syntax: passData.plugin.{pluginName}.{function}');
      logger.warn('pluginSys', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  }

  /**
   * Imposta il riferimento al sistema dei temi
   * Chiamato da index.js dopo la creazione di themeSys
   * @param {object} themeSys - Istanza di themeSys
   */
  setThemeSys(themeSys) {
    this.#themeSys = themeSys;
  }

  /**
   * Restituisce il riferimento al sistema dei temi
   * @returns {object|null} - Istanza di themeSys o null se non ancora impostato
   */
  getThemeSys() {
    return this.#themeSys;
  }

  loadRoutes( router , prefix = "" ){//prefisso delle rotte  questa chiamata farà caricare tutte le istanze di route caricate precedentemente dal costruttore
    // le rotte avranno comepresso sia "prefix" se impostato , e sia il nome del modulo , questo permetterà di evitare conflitti
    for( const[ key, Avalue ] of  this.#routes ){ // itero la mappa key è il nome del modulo Avalue è l'array che contiene tuti gli ogrtti che rapresentano le rotte
      for (const oRoute of Avalue) {
        const path = `${prefix}/${key}${oRoute.path}`;
        if( oRoute.method == 'GET'){
          router.get( path , oRoute.handler );// key è il nome del plugin che farà parte del percorso per evitare conflitti
        }else if( oRoute.method == 'POST' ){
          router.post( path , oRoute.handler );
        }else if( oRoute.method == 'PUT' ){
          router.put( path , oRoute.handler );
        }else if( oRoute.method == 'DEL' ){
          router.del( path , oRoute.handler );
        }else if( oRoute.method == 'ALL' ){
          router.all( path , oRoute.handler );
        }
      }

    }
  }

/**
 * Funzione per gestire il hook della pagina.
 *
 * @param {string} hook - Il nome del hook della pagina. sc 'head' 'hader' 'script'
 * @param {object} passData - passData sono i dati in una pagina js passati al motore .ejs.
 * @returns {string} - ritorna come stringa il risultato della funzione fnToExc(passData);
 *
 * @example
 * // Esempio di utilizzo del hookPage
 * hookPage ( hook, passData )
 */
  hookPage( hook, passData ){

    let stingToReturn = "";
    for( const [ nomePlugin, fnMap] of this.#hooksPage ){
      if( fnMap.has(hook) ){// se siste la parte richiesta Es se il plugin bootstrap ha richiesto di inserire qualcosa in 'head'
        stingToReturn += ` <!-- \n START ${nomePlugin} part --> \n` ;
        const fnToExc = fnMap.get(hook);
        stingToReturn += fnToExc(passData);// viene ottenuta la funzione che avrà come argomento (passData) e il cui valore sarà concatenato alla stringa
        stingToReturn += ` <!-- \n END ${nomePlugin} part --> \n ` ;
      }
    }

    return stingToReturn;

  }

  /**
   * Verifica se un plugin è attivo
   * @param {string} pluginName - Nome del plugin
   * @returns {boolean} - true se il plugin è attivo
   */
  isPluginActive(pluginName) {
    return this.#activePlugins.has(pluginName);
  }

  /**
   * Restituisce la versione di un plugin attivo
   * @param {string} pluginName - Nome del plugin
   * @returns {string|null} - Versione del plugin o null se non trovato
   */
  getPluginVersion(pluginName) {
    if (!this.isPluginActive(pluginName)) {
      return null;
    }

    try {
      const descriptionPath = path.join(__dirname, '../plugins', pluginName, 'pluginDescription.json5');
      const description = loadJson5(descriptionPath);
      return description.version || null;
    } catch (error) {
      console.warn(`[pluginSys] Impossibile leggere versione del plugin '${pluginName}':`, error.message);
      return null;
    }
  }

  /**
   * Restituisce la lista dei nomi dei plugin attivi
   * @returns {Array<string>} - Array con i nomi dei plugin attivi
   */
  getActivePluginNames() {
    return Array.from(this.#activePlugins.keys());
  }

  /**
   * Setta riferimento ad AdminSystem (chiamato da index.js dopo costruzione)
   * @param {object} adminSystem - Istanza di AdminSystem
   */
  setAdminSystem(adminSystem) {
    this.adminSystem = adminSystem;
  }

  /**
   * Ottiene riferimento ad AdminSystem
   * @returns {object|null} - Istanza di AdminSystem o null se non inizializzato
   */
  getAdminSystem() {
    return this.adminSystem || null;
  }

  /**
   * Ottiene tutti i plugin attivi (per AdminSystem.initialize)
   * @returns {Array<object>} - Array di plugin objects
   */
  getAllPlugins() {
    const plugins = [];
    for (const [pluginName, pluginObj] of this.#activePlugins.entries()) {
      plugins.push(pluginObj);
    }
    return plugins;
  }

  /**
   * Ottiene un plugin specifico per nome
   * @param {string} pluginName - Nome del plugin
   * @returns {object|null} - Plugin object o null se non trovato
   */
  getPlugin(pluginName) {
    return this.#activePlugins.get(pluginName) || null;
  }

}

module.exports = pluginSys ;