
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const logger = require('./logger');
const loadJson5 = require('./loadJson5');
const saveJson5 = require('./saveJson5');
const editJson5 = require('./editJson5');
const setJson5Key = require('./setJson5Key');
const { checkNpmDeps, resolvePluginStates } = require('./pluginStateResolver');
const demoNotice = require('./demoNotice');

class pluginSys{

  #pluginsMiddlewares = Array();//Variabile privata che contiene l'elenco dei midlware dei plugin da aggiungere
  #hooksPage;// variabile privata che conterrà la mappa degli hookdella pagina
  #routes;// variabile privata che conterrà le rotte aggiunte dai vari plugin
  #objectToShareToWebPages = {};// variabile che conterà gli ogetti restituiti dai vari plugin che saranno messi a dispozione del motore ejs e degli altri moduli
  #activePlugins = new Map();// Mappa che conterrà i plugin attivi
  #pluginsToActive = new Map();// plugin da attivare non ancora attivati perchè bisogna controllare le dipendenze
  #themeSys = null;// riferimento al sistema dei temi (impostato dopo l'inizializzazione)
  #ital8Conf = null;// configurazione principale del sistema (per whitelist funzioni globali)
  #pluginStates = new Map();// stato runtime per plugin: 'available'|'disabled'|'incomplete'|'installed' (+ reason/detail)

  constructor(ital8Conf){// qui bisognerà andare nella cartelle dai plugin e caricarli uno a uno

    // Salva riferimento alla configurazione principale
    this.#ital8Conf = ital8Conf; 

    this.#hooksPage = new Map();// new Map(['namelPlugin', new Map(['head', (passData) => {}],['body', ( passData ) => {} ])]);
    this.#routes = new Map();// mappa che conterrà come chiave il nome del plugin da caricare e come valore un array contenete tutti gli ogetti che rappresentano le rotte
  }// fine costruttore — solo setup dei campi; il caricamento dei plugin è in initialize()

  /**
   * Carica, installa e aggiorna tutti i plugin attivi, risolvendo le dipendenze.
   * Estratto dal costruttore (che non può essere async) per poter AWAITARE i
   * lifecycle hook async dei plugin (loadPlugin/installPlugin/upgradePlugin).
   * Va chiamato e awaitato SUBITO dopo la costruzione, prima di usare
   * rotte/middleware/oggetti condivisi:
   *     const pluginSys = new (require('./core/pluginSys'))(ital8Conf);
   *     await pluginSys.initialize();
   */
  async initialize(){

    //function caricatePlugin( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ){// questa funzione caricherà e se necessario installeà il plugin passato
    // ATTENZIONE USO LA FUNZIONE FRECCIA PER MANTENERE il this locale , però la funzione freccia va dichiarata prima del suo utilizzo
    const caricatePlugin = async ( pluginName ) => { //, routes, hooksPage, objectToShareToWebPages, activePlugins ){/
      //caricatePlugin = ( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ) => {// q

      // Calcola il percorso della cartella del plugin
      const pathPluginFolder = path.join(__dirname, '..', 'plugins', pluginName);

      try {
        //console.log(pluginConfig);
        const pluginConfig = loadJson5(path.join(__dirname, '..', 'plugins', pluginName, 'pluginConfig.json5'));
        const plugin = require(path.join(__dirname, '..', 'plugins', pluginName, 'main.js'));

        // Aggiungi metadata al plugin object per uso futuro
        plugin.pluginName = pluginName;
        plugin.pathPluginFolder = pathPluginFolder;
        plugin.pluginConfig = pluginConfig;  // Aggiungi pluginConfig (necessario per adminSystem.getMenuSections())

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

        // Transizione di installazione: installPlugin() gira SOLO quando il plugin
        // diventa "installed" la prima volta, cioè quando isInstalled non era già 1
        // (clone fresco: il campo può mancare → undefined !== 1 → installa). Il flag
        // viene poi PERSISTITO dopo loadPlugin (vedi sotto), così se l'installazione
        // o il load falliscono non resta marcato installato.
        const wasInstalled = pluginConfig.isInstalled === 1;
        if( !wasInstalled ){
          if (plugin.installPlugin) {
            await plugin.installPlugin(this, pathPluginFolder);// può lanciare → catch graceful sotto
          }
        }

        // SISTEMA DI UPGRADE: controlla se la versione del plugin è cambiata
        const pluginDescription = loadJson5(path.join(__dirname, '..', 'plugins', pluginName, 'pluginDescription.json5'));
        const newVersion = pluginDescription.version;
        const oldVersion = pluginConfig.version || '0.0.0'; // Se non esiste, assume 0.0.0

        if (semver.valid(newVersion) && semver.valid(oldVersion) && semver.gt(newVersion, oldVersion)) {
          // Nuova versione rilevata! Esegui upgrade
          logger.info('pluginSys', `Upgrade plugin ${pluginName}: ${oldVersion} -> ${newVersion}`);

          if (plugin.upgradePlugin) {
            try {
              await plugin.upgradePlugin(this, pathPluginFolder, oldVersion, newVersion);
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
          const hookMap = plugin.getHooksPage();
          if (hookMap instanceof Map) {
            this.#hooksPage.set( pluginName, hookMap );
          } else {
            logger.warn('pluginSys', `Plugin "${pluginName}": getHooksPage() deve restituire una Map, ricevuto: ${typeof hookMap}. Hook ignorati.`);
          }
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

        // loadPlugin: può aver bisogno di librerie di altri plugin (già caricati
        // prima per via dell'ordine di dipendenza). Può lanciare → catch graceful.
        await plugin.loadPlugin(this, pathPluginFolder);

        // Persisti isInstalled:1 nel vivo SOLO se non era già 1 (transizione a
        // installed). setJson5Key AGGIUNGE il campo se manca (clone fresco),
        // altrimenti lo aggiorna — preservando i commenti.
        if( !wasInstalled ){
          try {
            await setJson5Key(path.join(pathPluginFolder, 'pluginConfig.json5'), 'isInstalled', 1, { afterKey: 'schemaVersion' });
          } catch (writeErr) {
            logger.warn('pluginSys', `isInstalled non persistito per ${pluginName}: ${writeErr.message}`);
          }
          pluginConfig.isInstalled = 1;
        }

        this.#pluginStates.set(pluginName, { state: 'installed', reason: null });
        logger.info('pluginSys', `Plugin caricato: ${pluginName}`);
        return true;

      } catch (error) {
        // BOOT GRACEFUL: un plugin che fallisce in install/upgrade/load NON
        // interrompe più l'avvio. Viene rimosso da ciò che ha eventualmente già
        // registrato e marcato 'incomplete'; la cascata sui dipendenti
        // non-ancora-caricati è gestita dal chiamante (vedi initialize()).
        logger.error('pluginSys', `Errore nel caricamento del plugin ${pluginName} — skippato (il boot prosegue)`, error);
        this.#activePlugins.delete(pluginName);
        this.#routes.delete(pluginName);
        this.#hooksPage.delete(pluginName);
        delete this.#objectToShareToWebPages[pluginName];
        this.#pluginStates.set(pluginName, { state: 'incomplete', reason: 'load-error', detail: error && error.message });
        return false;
      }



    }// const caricatePlugin = ( pluginName, pluginConfig ) => {

    // adesso leggo tutti i file della cartella plugins e ciclo per attivari e caricare quelli per essere caricati
    const baseDir =  path.join(__dirname, '..', 'plugins' ) ;//ottengo ilpercorso della directory plugins
    let Afiles = fs.readdirSync( baseDir );// gli dico di leggere il contenuto della directori plugins e metterloin un arra ps linux non distingue fra file e directori sono tutti fil eper lui
    // Tengo solo le directory reali. throwIfNoEntry:false evita un crash ENOENT
    // al boot su symlink rotti dentro plugins/ (es. un SKILL.md che punta a un
    // target assente): statSync segue il link e restituisce undefined invece di
    // lanciare, e l'entry non-directory viene scartata.
    Afiles = Afiles.filter(file => {
      const stats = fs.statSync(path.join(baseDir, file), { throwIfNoEntry: false })
      return stats && stats.isDirectory()
    })// prendo solo i "file" che in realtà sono directory

    // Validazione nomi directory plugin (defense-in-depth)
    // I nomi provengono da readdirSync quindi sono directory reali, ma per sicurezza
    // escludiamo nomi che potrebbero causare path traversal o comportamenti imprevisti
    Afiles = Afiles.filter(dirName => {
      if (dirName.includes('..') || dirName.includes('/') || dirName.includes('\\')) {
        logger.warn('pluginSys', `Directory plugin ignorata per nome non valido: "${dirName}"`);
        return false;
      }
      return true;
    });

    // ── RACCOLTA DEI CANDIDATI (plugin con active:1) ──────────────────────────
    // Niente più throw qui: le precondizioni (npm + dipendenze plugin) sono
    // valutate da pluginStateResolver, che assegna lo stato. Vedi config-lifecycle §2/§4.

    // Lettura della versione npm installata (iniettata in checkNpmDeps). fs.readFileSync
    // (non require) per i moduli con "exports" che bloccano require del package.json.
    const resolveInstalledVersion = (moduleName) => {
      const modulePackagePath = path.join(__dirname, '..', 'node_modules', moduleName, 'package.json');
      if (!fs.existsSync(modulePackagePath)) return null;
      try {
        return JSON.parse(fs.readFileSync(modulePackagePath, 'utf8')).version || null;
      } catch (_) {
        return null;
      }
    };

    const candidates = [];                 // plugin active:1 da valutare
    const candidateConfigs = new Map();    // nome → pluginConfig (vivo)

    for( const nameFile of Afiles ){
      let pluginConfig;
      try {
        pluginConfig = loadJson5(path.join(baseDir, nameFile, 'pluginConfig.json5'));
      } catch (e) {
        // pluginConfig.json5 assente → 'available' (codice presente, mai preso in
        // carico); illeggibile → segnalato, comunque non bloccante.
        const reason = (e && e.code === 'ENOENT') ? 'no-config' : 'config-error';
        if (reason === 'config-error') logger.warn('pluginSys', `pluginConfig.json5 illeggibile per "${nameFile}": ${e.message}`);
        this.#pluginStates.set(nameFile, { state: 'available', reason, detail: e && e.message });
        continue;
      }

      if( pluginConfig.active != 1 ){
        this.#pluginStates.set(nameFile, { state: 'disabled', reason: null });
        continue;
      }

      let version = '0.0.0';
      try { version = loadJson5(path.join(baseDir, nameFile, 'pluginDescription.json5')).version || '0.0.0'; } catch (_) {}

      const npm = checkNpmDeps(pluginConfig.nodeModuleDependency, resolveInstalledVersion);
      const pluginDeps = new Map(Object.entries(pluginConfig.dependency || {}));
      candidates.push({ name: nameFile, version, npmOk: npm.ok, npmDetail: npm, pluginDeps });
      candidateConfigs.set(nameFile, pluginConfig);
    }

    // ── RISOLUZIONE DEGLI STATI (npm + dipendenze plugin + cascata + cicli) ────
    const resolvedStates = resolvePluginStates(candidates);
    for (const [name, st] of resolvedStates) this.#pluginStates.set(name, st);

    // Persisti isInstalled:0 per i plugin già 'incomplete' qui (npm/dep/cicli),
    // solo se il file dice diverso.
    for (const c of candidates) {
      if (resolvedStates.get(c.name).state === 'incomplete') {
        const cfg = candidateConfigs.get(c.name);
        if (cfg.isInstalled !== 0) {
          try {
            await setJson5Key(path.join(baseDir, c.name, 'pluginConfig.json5'), 'isInstalled', 0, { afterKey: 'schemaVersion' });
          } catch (e) { logger.warn('pluginSys', `isInstalled non persistito per ${c.name}: ${e.message}`); }
        }
      }
    }

    // ── CARICAMENTO DEI PLUGIN 'installed', nell'ordine delle dipendenze ──────
    // I plugin non-'installed' (available/disabled/incomplete) NON vengono caricati.
    const installable = candidates.filter(c => resolvedStates.get(c.name).state === 'installed');

    // Tutte le dipendenze (plugin) del candidato sono già tra gli attivi?
    const dependenciesActive = (depMap) => {
      for (const depName of depMap.keys()) {
        if (!this.#activePlugins.has(depName)) return false;
      }
      return true;
    };

    // Marca un plugin 'incomplete' e persiste isInstalled:0 (solo se cambia).
    const markIncomplete = async (name, reason, detail) => {
      this.#pluginStates.set(name, { state: 'incomplete', reason, detail });
      const cfg = candidateConfigs.get(name);
      if (cfg && cfg.isInstalled !== 0) {
        try {
          await setJson5Key(path.join(baseDir, name, 'pluginConfig.json5'), 'isInstalled', 0, { afterKey: 'schemaVersion' });
        } catch (e) { logger.warn('pluginSys', `isInstalled non persistito per ${name}: ${e.message}`); }
      }
    };

    // Senza dipendenze: caricabili subito. Con dipendenze: in coda.
    for (const c of installable) {
      if (c.pluginDeps.size === 0) {
        const ok = await caricatePlugin(c.name);
        if (!ok) await markIncomplete(c.name, 'load-error', null);
      } else {
        this.#pluginsToActive.set(c.name, c.pluginDeps);
      }
    }

    // Coda: carica chi ha le dipendenze già attive; itera finché c'è progresso.
    // for...of (non forEach) per AWAITARE caricatePlugin in sequenza.
    let progress = true;
    while (this.#pluginsToActive.size > 0 && progress) {
      progress = false;
      for (const [name, depMap] of this.#pluginsToActive) {
        if (dependenciesActive(depMap)) {
          this.#pluginsToActive.delete(name);
          const ok = await caricatePlugin(name);
          if (!ok) await markIncomplete(name, 'load-error', null);
          progress = true;
        }
      }
    }
    // Rimasti in coda: una dipendenza è caduta al caricamento → incomplete (cascata).
    for (const [name] of this.#pluginsToActive) {
      await markIncomplete(name, 'dep-incomplete', { dep: '(fallita al caricamento)' });
    }
    this.#pluginsToActive.clear();

    // ── BOX DI RIEPILOGO degli stati non-installed ───────────────────────────
    this.#printPluginSummary();

    // ── PLUGIN ESSENZIALI: se uno non è caricato → box [FATAL] + exit ─────────
    this.#enforceEssentialPlugins();



    

  }// END initialize()

  /**
   * Stampa un box [PLUGINS] di riepilogo dei plugin rimasti 'incomplete' (boot
   * graceful: l'avvio prosegue, ma questi plugin non sono stati caricati).
   * Nessun output quando sono tutti a posto.
   * @private
   */
  #printPluginSummary() {
    const incomplete = [];
    for (const [name, st] of this.#pluginStates) {
      if (st.state === 'incomplete') incomplete.push([name, st]);
    }
    if (incomplete.length === 0) return;

    const line = '[PLUGINS] ' + '═'.repeat(58);
    const out = [
      '',
      line,
      `[PLUGINS]  ⚠  ${incomplete.length} plugin non caricati (incomplete) — il boot è proseguito:`,
      '[PLUGINS]',
    ];
    for (const [name, st] of incomplete) {
      out.push(`[PLUGINS]    • ${name} — ${this.#describeReason(st)}`);
    }
    out.push(
      '[PLUGINS]',
      '[PLUGINS]  Risolvi le cause sopra (es. `npm install`, ripara/attiva le',
      '[PLUGINS]  dipendenze) e riavvia: gli incomplete passano a installed da soli.',
      line,
      '',
    );
    console.warn(out.join('\n'));
  }

  /**
   * Traduce { reason, detail } di uno stato 'incomplete' in un messaggio leggibile.
   * @private
   */
  #describeReason(st) {
    const d = (st && typeof st.detail === 'object' && st.detail) ? st.detail : {};
    switch (st.reason) {
      case 'npm': {
        const parts = [];
        if (d.missing && d.missing.length) parts.push('mancanti: ' + d.missing.map(m => `${m.name}@${m.required}`).join(', '));
        if (d.incompatible && d.incompatible.length) parts.push('incompatibili: ' + d.incompatible.map(m => `${m.name} (richiesto ${m.required}, presente ${m.installed})`).join(', '));
        return 'dipendenze npm non soddisfatte — ' + (parts.join('; ') || 'vedi log');
      }
      case 'dep-missing': return `dipendenza plugin assente: "${d.dep}"`;
      case 'dep-version': return `dipendenza "${d.dep}" incompatibile (richiesta ${d.range}, presente ${d.version})`;
      case 'dep-incomplete': return `dipende da "${d.dep}" che non è disponibile`;
      case 'circular': return 'dipendenza circolare';
      case 'load-error': return `errore durante il caricamento: ${(st && st.detail) || 'vedi log'}`;
      default: return st.reason || 'motivo sconosciuto';
    }
  }

  /**
   * PLUGIN ESSENZIALI (ital8Config → essentialPlugins): se uno NON è tra gli
   * attivi alla fine del boot, stampa un box [FATAL] e termina il processo — un
   * sito con auth/access-control non funzionanti non deve essere servito
   * (config-lifecycle §4). No-op se la lista è vuota o tutti gli essenziali sono attivi.
   * @private
   */
  #enforceEssentialPlugins() {
    const essential = (this.#ital8Conf && Array.isArray(this.#ital8Conf.essentialPlugins))
      ? this.#ital8Conf.essentialPlugins : [];
    if (essential.length === 0) return;

    const failed = essential.filter((name) => !this.#activePlugins.has(name));
    if (failed.length === 0) return;

    const line = '[FATAL] ' + '═'.repeat(58);
    const out = ['', line, `[FATAL]  🔴  ${failed.length} plugin ESSENZIALE/I non caricato/i — avvio interrotto:`, '[FATAL]'];
    for (const name of failed) {
      const st = this.#pluginStates.get(name);
      const why = !st ? 'assente (cartella plugin non trovata)'
        : st.state === 'disabled' ? 'disattivato (active:0)'
        : st.state === 'available' ? 'non installato (pluginConfig.json5 assente)'
        : this.#describeReason(st);
      out.push(`[FATAL]    • ${name} — ${why}`);
    }
    out.push(
      '[FATAL]',
      '[FATAL]  Dichiarati essenziali in ital8Config.json5 → essentialPlugins.',
      '[FATAL]  Risolvi le cause (npm install, ripara/riattiva) e riavvia.',
      line,
      '',
    );
    console.error(out.join('\n'));
    process.exit(1);
  }

  /**
   * Stato runtime di un plugin (ciclo di vita config, Fase 2).
   * @param {string} pluginName
   * @returns {{state: string, reason: (string|null), detail?: any}|null}
   *          state ∈ 'available'|'disabled'|'incomplete'|'installed'; null se sconosciuto.
   */
  getPluginState(pluginName) {
    return this.#pluginStates.get(pluginName) || null;
  }

  /**
   * Copia della mappa degli stati di tutti i plugin (nome → { state, reason, detail }).
   * @returns {Map<string, object>}
   */
  getPluginStates() {
    return new Map(this.#pluginStates);
  }

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

      // Plugin attivo → Verifica implementazione getGlobalFunctionsForTemplates()
      const plugin = this.#activePlugins.get(pluginName);

      // Verifica se il plugin implementa getGlobalFunctionsForTemplates
      if (!plugin.getGlobalFunctionsForTemplates || typeof plugin.getGlobalFunctionsForTemplates !== 'function') {
        logger.warn('pluginSys',
          `⚠️  Plugin "${pluginName}" in whitelist but doesn't implement getGlobalFunctionsForTemplates()\n` +
          `   Expected: getGlobalFunctionsForTemplates() method returning { "${functionName}": function }\n` +
          `   This is unusual - plugin should implement this method if it's in the whitelist`
        );
        continue;
      }

      // Chiama getGlobalFunctionsForTemplates() per ottenere funzioni globali
      const globalFuncs = plugin.getGlobalFunctionsForTemplates();

      if (globalFuncs?.[functionName] && typeof globalFuncs[functionName] === 'function') {
        globalFunctions[functionName] = globalFuncs[functionName];
        logger.debug('pluginSys', `✓ Global function "${functionName}" registered from plugin "${pluginName}"`);
      } else {
        logger.warn('pluginSys', `⚠️  Plugin "${pluginName}" doesn't export function "${functionName}" in getGlobalFunctionsForTemplates()`);
      }
    }

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

        // Se la route dichiara un campo access, wrappa l'handler con un controllo di autenticazione e ruoli
        const handler = oRoute.access ? this.#wrapHandlerWithAccessCheck(oRoute.handler, oRoute.access) : oRoute.handler;

        if( oRoute.method == 'GET'){
          router.get( path , handler );// key è il nome del plugin che farà parte del percorso per evitare conflitti
        }else if( oRoute.method == 'POST' ){
          router.post( path , handler );
        }else if( oRoute.method == 'PUT' ){
          router.put( path , handler );
        }else if( oRoute.method == 'DEL' ){
          router.del( path , handler );
        }else if( oRoute.method == 'ALL' ){
          router.all( path , handler );
        }
      }

    }
  }

  /**
   * Wrappa un route handler con controllo access (autenticazione e ruoli)
   * @private
   * @param {Function} originalHandler - Handler originale della route
   * @param {object} access - Configurazione accesso { requiresAuth: boolean, allowedRoles: number[] }
   * @returns {Function} - Handler wrappato con controllo accesso
   */
  #wrapHandlerWithAccessCheck(originalHandler, access) {
    return async (ctx) => {
      // ── Protezione CSRF (anti cross-site request forgery) ──
      // Eseguita PRIMA del controllo auth così copre anche le rotte pubbliche
      // mutanti (es. POST /login). Il plugin csrfProtection è OPZIONALE: se
      // assente/disattivo getSharedObject ritorna null e la validazione viene
      // saltata (degradazione graziosa). La logica (metodi mutanti, esenzioni,
      // token, Origin) è interamente nel plugin: qui rispettiamo solo il verdetto.
      const csrf = this.getSharedObject('csrfProtection');
      if (csrf && typeof csrf.validateRequest === 'function') {
        const verdict = csrf.validateRequest(ctx);
        if (verdict && verdict.ok === false) {
          ctx.status = verdict.status || 403;
          ctx.body = { error: verdict.error || 'CSRF validation failed' };
          return;
        }
      }

      if (access.requiresAuth) {
        // Verifica autenticazione
        if (!ctx.session || !ctx.session.authenticated) {
          ctx.status = 401;
          ctx.body = { error: 'Authentication required' };
          return;
        }

        // Verifica ruoli (solo se allowedRoles è un array non vuoto)
        if (access.allowedRoles && access.allowedRoles.length > 0) {
          const userRoles = ctx.session.user?.roleIds || [];
          const hasRequiredRole = userRoles.some(roleId => access.allowedRoles.includes(roleId));
          if (!hasRequiredRole) {
            ctx.status = 403;
            ctx.body = { error: 'Insufficient permissions' };
            return;
          }
        }
      }

      // Accesso consentito, esegui l'handler originale
      await originalHandler(ctx);
    };
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
      if( !(fnMap instanceof Map) ){
        logger.warn('pluginSys', `hookPage("${hook}"): il plugin "${nomePlugin}" ha un hook non valido (atteso Map, trovato: ${typeof fnMap}). Saltato.`);
        continue;
      }
      if( fnMap.has(hook) ){// se siste la parte richiesta Es se il plugin bootstrap ha richiesto di inserire qualcosa in 'head'
        stingToReturn += ` <!-- \n START ${nomePlugin} part --> \n` ;
        const fnToExc = fnMap.get(hook);
        stingToReturn += fnToExc(passData);// viene ottenuta la funzione che avrà come argomento (passData) e il cui valore sarà concatenato alla stringa
        stingToReturn += ` <!-- \n END ${nomePlugin} part --> \n ` ;
      }
    }

    // PROFILO DEMO: badge "DEMO" iniettato una sola volta nell'header delle pagine
    // admin quando demo === true. Theme-agnostic (qualunque tema admin che chiama
    // hookPage('header') lo mostra). Puramente segnaletico, nessun effetto sulle richieste.
    if (hook === 'header' && this.#ital8Conf && this.#ital8Conf.demo && passData && passData.isAdminContext) {
      stingToReturn += demoNotice.getDemoBadgeHtml();
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
   * Registra il callback da invocare quando un plugin richiede un riavvio
   * di ital8cms (es. dopo cambio tema). Il callback è iniettato da index.js
   * e tipicamente delega a gracefulShutdown(reason, { respawn: true }).
   * @param {function} fn - funzione ({reason}) => void
   */
  setRequestRestart(fn) {
    this.requestRestartCallback = fn;
  }

  /**
   * Invocata dai plugin per richiedere un riavvio dell'intero processo.
   * Se non è stato registrato alcun callback (situazione anomala) logga
   * un warning e non fa nulla — il chiamante deve gestire il caso.
   * @param {object} opts - { reason: string }
   * @returns {boolean} - true se il callback è stato invocato, false altrimenti
   */
  requestRestart(opts = {}) {
    if (typeof this.requestRestartCallback !== 'function') {
      logger.warn('pluginSys', 'requestRestart() chiamato ma nessun callback registrato (setRequestRestart mai chiamato)');
      return false;
    }
    this.requestRestartCallback(opts);
    return true;
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

  /**
   * Restituisce l'oggetto condiviso di un plugin provider chiamando getObjectToShareToOthersPlugin() on-demand.
   * Se callerName è specificato, il provider può personalizzare l'oggetto restituito per quel consumer.
   * Se callerName è omesso (undefined), il provider restituisce l'oggetto generico.
   * @param {string} providerPluginName - Nome del plugin che espone l'oggetto condiviso
   * @param {string} [callerName] - Nome opzionale del plugin richiedente (per oggetti personalizzati)
   * @returns {object|null} - Oggetto condiviso o null se plugin non attivo o non espone oggetti
   */
  getSharedObject(providerPluginName, callerName) {
    const provider = this.#activePlugins.get(providerPluginName);
    if (!provider || !provider.getObjectToShareToOthersPlugin) {
      return null;
    }
    return provider.getObjectToShareToOthersPlugin(callerName) || null;
  }

}

module.exports = pluginSys ;