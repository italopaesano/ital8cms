
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const logger = require('./logger');
const loadJson5 = require('./loadJson5');
const saveJson5 = require('./saveJson5');
const editJson5 = require('./editJson5');
const setJson5Key = require('./setJson5Key');
const installPluginNpmDeps = require('./installPluginNpmDeps');
const { checkNpmDeps, resolvePluginStates } = require('./pluginStateResolver');
const demoNotice = require('./demoNotice');

// Metodi delle rotte dei plugin → metodo corrispondente di @koa/router.
// FONTE DI VERITÀ UNICA dei verbi supportati: prima era una catena if/else, e la
// lista finiva duplicata in tre punti (la catena, il messaggio d'errore, e
// VALID_METHODS in core/testHelpers/routeRunner.js) senza niente che li tenesse
// insieme. Sono già divergiti una volta — l'helper accettava DELETE e PATCH, che
// la catena non gestiva, e il validatore approvava rotte destinate a sparire.
// Un test in tests/integration/routeContract.test.js legge queste chiavi e le
// confronta con quelle dell'helper.
//
// `Object.create(null)` e NON un letterale: una tabella di lookup non deve
// ereditare da Object.prototype. Con un letterale, `TABELLA['toString']` (o
// 'constructor', 'valueOf', '__proto__') restituisce la funzione ereditata —
// TRUTHY — quindi un `method: 'toString'`, refuso o plugin di terze parti,
// scavalcava il ramo di warning qui sotto ed entrava in `router[<funzione>]`,
// che è `undefined`: un TypeError durante il boot, sincrono, dentro index.js.
// La vecchia catena if/else quei valori li saltava e basta.
const ROUTER_METHOD_DISPATCH = Object.assign(Object.create(null), {
  GET:  'get',
  POST: 'post',
  PUT:  'put',
  DEL:  'del',
  ALL:  'all',
});

/**
 * Vero se la rotta dichiara il proprio `access` in una forma che il route-wrap
 * sa usare: un oggetto non nullo e non un array.
 *
 * PERCHÉ ESISTE. `CLAUDE.md` ha sempre detto che `access` è obbligatorio su ogni
 * rotta di plugin, e che la sua assenza è un « errore fatale al boot ». Nel codice
 * quel gate non c'è mai stato: `loadRoutes` faceva
 * `oRoute.access ? wrap(...) : oRoute.handler`, quindi una rotta senza `access`
 * veniva REGISTRATA **senza il controllo di autenticazione** — funzionante e
 * aperta. Il documento prometteva una protezione che il codice non dava.
 *
 * PERCHÉ SALTARE E NON MORIRE. Il fatale punirebbe l'intera installazione per la
 * svista di un plugin, il contrario del boot graceful che il progetto ha scelto
 * per i plugin (un `loadPlugin` che lancia → `incomplete` + box, non `exit`). Qui
 * la stessa logica: la rotta non viene registrata — quindi **non esiste, quindi
 * non è aperta** — il sito parte, e il box al boot dice quale plugin e quale path.
 * È anche la forma che le altre due rotte malformate già avevano da v3.0.0
 * (`method` minuscolo, `func` invece di `handler`): tre difetti della stessa
 * famiglia, ora con la stessa risposta.
 *
 * DOVE STA LA SOGLIA, E PERCHÉ NON PIÙ IN ALTO. Si rifiuta esattamente ciò che
 * renderebbe la rotta registrata-e-non-protetta, e nient'altro:
 *
 *   • `access` assente, `null`, `undefined`, `false`, una stringa, un array
 *     → SALTATA. Sono i valori per cui il ternario cadeva sul ramo senza wrap.
 *   • `access: {}` → PASSA, e vale « pubblica » (il wrap legge
 *     `if (access.requiresAuth)`, che è falsy). Dichiarare `{}` è povero, ma è
 *     comunque una dichiarazione, e il route-wrap la applica.
 *   • `{ requiresAuth: true }` senza `allowedRoles` → PASSA. Rifiutarla farebbe
 *     **sparire una rotta protetta** invece di lasciarla funzionare, e il wrap la
 *     gestisce già correttamente (`if (access.allowedRoles && length > 0)`).
 *
 * Le forme più severe — `requiresAuth` booleano obbligatorio, `allowedRoles`
 * array — restano competenza di `validateRoute()` in `core/testHelpers/`, che è
 * un contratto di qualità sulle rotte del progetto, non un cancello di runtime.
 * Il predicato è condiviso fra i due proprio perché la parte in comune non torni
 * a divergere: era il difetto 🟡 di v3.10.0, in cui il validatore approvava
 * `{access: null}` mentre `loadRoutes` registrava la rotta senza protezione.
 *
 * @param {object} route - Oggetto rotta come restituito da `getRouteArray()`.
 * @returns {boolean}
 */
function declaresAccess(route) {
  const access = route && route.access;
  return access !== null && typeof access === 'object' && !Array.isArray(access);
}

class pluginSys{

  #pluginsMiddlewares = Array();//Variabile privata che contiene l'elenco dei midlware dei plugin da aggiungere
  #hooksPage;// variabile privata che conterrà la mappa degli hookdella pagina
  #routes;// variabile privata che conterrà le rotte aggiunte dai vari plugin
  #objectToShareToWebPages = {};// variabile che conterà gli ogetti restituiti dai vari plugin che saranno messi a dispozione del motore ejs e degli altri moduli
  #activePlugins = new Map();// Mappa che conterrà i plugin attivi
  #pluginsToActive = new Map();// plugin da attivare non ancora attivati perchè bisogna controllare le dipendenze
  #themeSys = null;// riferimento al sistema dei temi (impostato dopo l'inizializzazione)
  #reservedGate = null;// gate della superficie riservata (impostato da index.js dopo i priority middlewares)
  #reservedRoutePaths = new Set();// path completi delle rotte che appartengono alla superficie riservata (popolato da loadRoutes)
  #ital8Conf = null;// configurazione principale del sistema (per whitelist funzioni globali)
  #pluginStates = new Map();// stato runtime per plugin: 'available'|'disabled'|'incomplete'|'installed' (+ reason/detail)
  #pluginsRootPath = null;// cartella da cui si risolvono i plugin (default: <progetto>/plugins)

  /**
   * @param {object} ital8Conf - configurazione principale del sistema
   * @param {string} [pluginsRootPath] - cartella da cui risolvere i plugin.
   *   Default INVARIATO: la `plugins/` del progetto. Il parametro esiste perché
   *   la root era cablata in sei punti, il che rendeva `initialize()` impossibile
   *   da esercitare in un test senza caricare i plugin VERI in-process e
   *   scrivere `isInstalled` nei loro config vivi — contro l'isolamento
   *   filesystem di docs/testing.it.md. Stessa forma già adottata per
   *   `validateThemeContent(..., themesRootPath)` in v2.92.0, e per lo stesso
   *   motivo. Nessun chiamante di produzione lo passa.
   */
  constructor(ital8Conf, pluginsRootPath = path.join(__dirname, '..', 'plugins')){// qui bisognerà andare nella cartelle dai plugin e caricarli uno a uno

    // Salva riferimento alla configurazione principale
    this.#ital8Conf = ital8Conf;
    this.#pluginsRootPath = pluginsRootPath;

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
      const pathPluginFolder = path.join(this.#pluginsRootPath, pluginName);

      try {
        //console.log(pluginConfig);
        const pluginConfig = loadJson5(path.join(this.#pluginsRootPath, pluginName, 'pluginConfig.json5'));

        // TRANSIZIONE D'INSTALLAZIONE: il plugin diventa "installed" la prima volta
        // quando isInstalled non era già 1 (clone fresco: il campo può mancare →
        // undefined === 1 è false → transizione). Gate condiviso da: (1) install
        // deps npm self-contained qui sotto, (2) installPlugin() più avanti. Definito
        // una sola volta così i due non possono divergere.
        const wasInstalled = pluginConfig.isInstalled === 1;

        // DEPS NPM DI UN PLUGIN SELF-CONTAINED (alla transizione d'installazione).
        // Se il plugin è self-contained (porta un proprio package.json), installa le
        // sue dipendenze npm nel node_modules LOCALE eseguendo `npm install` dentro
        // la sua cartella. Gira PRIMA di require(main.js) così le deps sono
        // risolvibili anche se main.js le richiede al top-level. No-op sui plugin
        // legacy (nessun package.json). Best-effort: un fallimento NON blocca il boot
        // — loadPlugin resta l'arbitro (una dep davvero mancante → il require lancia
        // → catch graceful → plugin 'incomplete'). Copre lo scenario "attivo un
        // plugin self-contained dopo l'install iniziale" che altrimenti resterebbe
        // incomplete finché non si rilancia deps-sync (docs/self-update.it.md, #5).
        if (!wasInstalled) {
          try {
            installPluginNpmDeps(pathPluginFolder, {
              onLog: (sub) => logger.info('pluginSys', `Plugin self-contained "${pluginName}": installo le dipendenze npm (npm ${sub})...`),
            });
          } catch (npmErr) {
            logger.warn('pluginSys', `npm install fallito per "${pluginName}": ${String(npmErr.message).split('\n')[0]} — il plugin potrebbe restare 'incomplete'`);
          }
        }

        const plugin = require(path.join(this.#pluginsRootPath, pluginName, 'main.js'));

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
        // GATE DI SCRIVIBILITÀ DELLE DATA DIR (graceful, per OGNI plugin):
        // se una data dir dichiarata via getWritablePaths() non è scrivibile, il
        // caricamento del plugin FALLISCE — lancia, così il catch graceful sotto
        // marca il plugin 'incomplete', lo rimuove dagli attivi (routes/hook/
        // middleware non ancora registrati) e NON persiste isInstalled: il plugin
        // è saltato ma il boot PROSEGUE (un essenziale non caricato resta fatale
        // via #enforceEssentialPlugins). Gira PRIMA di installPlugin()/loadPlugin(),
        // così nessun side-effect parte se la dir non è pronta; getWritablePaths()
        // risolve i path offline dal config (loadPlugin non è ancora girato).
        // Copre sia la prima installazione sia i plugin già installati la cui dir
        // regredisce a non scrivibile (nessun preflight fatale separato).
        require('./storageWritabilityCheck').assertPluginWritableOrThrow(plugin, this);

        // wasInstalled è definito sopra (subito dopo il load di pluginConfig).
        if( !wasInstalled ){
          if (plugin.installPlugin) {
            await plugin.installPlugin(this, pathPluginFolder);// può lanciare → catch graceful sotto
          }
        }

        // SISTEMA DI UPGRADE: esegue upgradePlugin() quando la versione del CODICE
        // del plugin è avanzata rispetto all'ultima per cui l'upgrade è già girato.
        //
        // `version` nel pluginConfig VIVO = "ultima versione di codice per cui
        // l'upgrade è stato eseguito con successo", non la versione corrente (che
        // è e resta in pluginDescription.json5, read-only). È uno stato runtime,
        // come isInstalled: sta nel vivo (git-ignored), mai nel `.default`.
        //
        // Prima questa versione non veniva MAI persistita — il codice lo dichiarava
        // esplicitamente, per timore di corrompere il file riscrivendolo. Con
        // setJson5Key la scrittura è chirurgica (una sola chiave, commenti e
        // formattazione intatti) e quel timore non ha più fondamento. Senza
        // persistenza `oldVersion` valeva sempre '0.0.0', quindi `semver.gt` era
        // vero per qualunque plugin e upgradePlugin() girava A OGNI BOOT invece che
        // agli aggiornamenti: inoffensivo finché tutte le implementazioni erano
        // stub vuoti, rotto al primo che ci avesse messo una migrazione reale.
        //
        // Prima installazione: NON è un upgrade. Là gira installPlugin() (sopra) e
        // qui si registra soltanto la versione di partenza, senza invocare l'hook.
        const pluginDescription = loadJson5(path.join(this.#pluginsRootPath, pluginName, 'pluginDescription.json5'));
        const newVersion = pluginDescription.version;
        const oldVersion = pluginConfig.version || '0.0.0'; // mai eseguito prima → 0.0.0
        const livePluginConfigPath = path.join(pathPluginFolder, 'pluginConfig.json5');

        if (!wasInstalled) {
          // Installazione fresca: allinea il segnaposto senza eseguire l'upgrade.
          if (semver.valid(newVersion)) {
            await setJson5Key(livePluginConfigPath, 'version', newVersion, { afterKey: 'schemaVersion' });
          }
        } else if (semver.valid(newVersion) && semver.valid(oldVersion) && semver.gt(newVersion, oldVersion)) {
          logger.info('pluginSys', `Upgrade plugin ${pluginName}: ${oldVersion} -> ${newVersion}`);

          if (plugin.upgradePlugin) {
            try {
              await plugin.upgradePlugin(this, pathPluginFolder, oldVersion, newVersion);
              logger.info('pluginSys', `Upgrade ${pluginName} completato con successo`);
            } catch (upgradeError) {
              logger.error('pluginSys', `Errore durante upgrade plugin ${pluginName}`, upgradeError);
              // Non si persiste la nuova versione: l'upgrade va ritentato al boot
              // successivo. Il throw finisce nel catch graceful → 'incomplete'.
              throw upgradeError;
            }
          } else {
            logger.debug('pluginSys', `Nessuna funzione upgradePlugin() per ${pluginName}, skip migrazione`);
          }

          // Persistita SOLO a esito riuscito: è la ricevuta dell'upgrade eseguito.
          await setJson5Key(livePluginConfigPath, 'version', newVersion, { afterKey: 'schemaVersion' });
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

        // loadPlugin: può aver bisogno di librerie di altri plugin (già caricati
        // prima per via dell'ordine di dipendenza). Può lanciare → catch graceful.
        await plugin.loadPlugin(this, pathPluginFolder);

        // I MIDDLEWARE SI REGISTRANO SOLO A CARICAMENTO RIUSCITO, e questa riga sta
        // DOPO `loadPlugin()` per una ragione precisa.
        //
        // Tutto il resto che `caricatePlugin` registra prima del load — rotte, hook,
        // oggetti condivisi — vive in una Map o in un oggetto indicizzati per NOME
        // del plugin, quindi il catch qui sotto li rimuove con un `delete(pluginName)`.
        // I middleware no: sono un ARRAY posizionale, senza chiave. Rimuoverli
        // richiederebbe di ricordarsi l'indice, e infatti erano gli unici che il
        // catch non ripuliva.
        //
        // MISURATO prima della correzione: un plugin il cui `loadPlugin()` lancia
        // veniva marcato `incomplete` e tolto da tutto il resto, ma
        // `getMiddlewaresToLoad()` restituiva ancora il suo middleware — che
        // `index.js` montava con `app.use()`. Se quel middleware rilegge lo stato che
        // ha fatto fallire il load (per esempio `urlRedirect` con
        // `strictValidation: true` e una regola non valida), rilancia a OGNI
        // richiesta: 500 sull'intero sito da un plugin che il box `[PLUGINS]` dichiara
        // saltato.
        //
        // Spostare il push invece di aggiungere una rimozione toglie l'asimmetria
        // alla radice: non c'è nulla da ripulire se non è mai stato aggiunto.
        if(plugin.getMiddlewareToAdd){
          // IMPORTANTE: usa .bind(plugin) per preservare il contesto 'this' quando la funzione viene chiamata in index.js
          this.#pluginsMiddlewares.push( plugin.getMiddlewareToAdd.bind(plugin) );// sarà un array di funzioni che generano un array
        }

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
    const baseDir =  this.#pluginsRootPath ;//ottengo ilpercorso della directory plugins
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

      // PESO DI CARICAMENTO. Assente → 0 (retrocompatibile: un plugin che non lo
      // dichiara non deve cambiare posizione). Presente ma non numerico è invece
      // un errore di configurazione dell'autore, non un default: va detto, perché
      // altrimenti il plugin scivolerebbe a 0 in silenzio.
      let weight = 0;
      if (pluginConfig.weight !== undefined) {
        if (typeof pluginConfig.weight === 'number' && Number.isFinite(pluginConfig.weight)) {
          weight = pluginConfig.weight;
        } else {
          logger.warn('pluginSys', `"${nameFile}": weight non numerico (${JSON.stringify(pluginConfig.weight)}) — uso 0`);
        }
      }

      candidates.push({ name: nameFile, version, npmOk: npm.ok, npmDetail: npm, pluginDeps, weight });
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
    // ORDINE DICHIARATO IN CLAUDE.md: 1) weight crescente, 2) risoluzione delle
    // dipendenze (una dipendenza è caricata prima del suo dipendente qualunque sia
    // il peso), 3) alfabetico a parità di weight.
    //
    // Il primo passo NON esisteva: fino alla v3.0.0 l'ordine era quello di
    // fs.readdirSync(), e il campo `weight` — pur documentato, mostrato dalla GUI
    // admin e validato come obbligatorio — non veniva letto da nessuna parte. Chi
    // lo impostava otteneva silenziosamente niente, e i valori nel repo mostrano
    // che veniva impostato con intenzione (simpleI18n a -10 perché fornisce la
    // funzione globale __(), adminAccessControl a -5 perché regola gli accessi).
    //
    // Il tiebreak alfabetico è esplicito e non affidato alla stabilità di sort():
    // l'ordine di readdirSync non è garantito alfabetico su tutti i filesystem,
    // quindi «a parità di weight, alfabetico» sarebbe stato vero solo per caso.
    // Confronto diretto e non localeCompare, per non dipendere dal locale.
    //
    // ⚠ FIN DOVE ARRIVA QUESTO ORDINAMENTO, detto con precisione. Ordina i soli
    // plugin SENZA dipendenze: quelli con `dependency` finiscono in
    // #pluginsToActive e vengono accodati man mano che le dipendenze si risolvono,
    // quindi il loro peso non li anticipa. `adminAccessControl` dichiara -5 — il più
    // basso dopo simpleI18n — e carica ULTIMO, perché dipende da adminUsers.
    // La forma completa sarebbe un unico ordinamento topologico su tutti gli
    // installabili con il weight come tie-break; è aperta in TODO.md.
    //
    // ⚠ QUESTO ORDINE È ANCHE QUELLO DEI MIDDLEWARE: index.js scorre l'array di
    // getMiddlewaresToLoad() e fa app.use() di ciascuno. Cambiare l'ordinamento
    // qui sposta l'annidamento Koa dei middleware dei plugin — è già successo in
    // v3.0.0, e ha tolto i redirect dalle analytics finché analytics non è stato
    // portato a -8 (v3.10.0). L'invariante «chi osserva sta prima di chi
    // interrompe» è presidiata da tests/integration/middlewareOrder.test.js.
    const installable = candidates
      .filter(c => resolvedStates.get(c.name).state === 'installed')
      .sort((a, b) => (a.weight - b.weight) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

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

  /**
   * Imposta il riferimento al reserved gate (superficie riservata).
   * Chiamato da index.js con il gate creato dai priority middlewares.
   *
   * Serve al route-wrap: quando la superficie riservata è chiusa, le rotte che le
   * appartengono devono rispondere 404 invece di 401/403. Il gate è la fonte di
   * verità unica dello stato — e fornisce anche il `deny()` condiviso, così tutti
   * i punti di enforcement rispondono in modo identico.
   * @param {object} reservedGate - Gate creato da createReservedGate()
   */
  setReservedGate(reservedGate) {
    this.#reservedGate = reservedGate;
  }

  /**
   * Restituisce il riferimento al reserved gate
   * @returns {object|null} - Gate o null se non ancora impostato
   */
  getReservedGate() {
    return this.#reservedGate;
  }

  /**
   * Path completi (prefisso incluso) delle rotte appartenenti alla superficie
   * riservata, raccolti durante loadRoutes(). Da passare al reserved gate, che
   * li chiude PER PATH — chiudendo anche il 405 di allowedMethods() sul metodo
   * sbagliato, che il route-wrap non puo intercettare.
   * @returns {Set<string>} - Copia dell'indice
   */
  getReservedRoutePaths() {
    return new Set(this.#reservedRoutePaths);
  }

  loadRoutes( router , prefix = "" ){//prefisso delle rotte  questa chiamata farà caricare tutte le istanze di route caricate precedentemente dal costruttore
    // le rotte avranno comepresso sia "prefix" se impostato , e sia il nome del modulo , questo permetterà di evitare conflitti
    for( const[ key, Avalue ] of  this.#routes ){ // itero la mappa key è il nome del modulo Avalue è l'array che contiene tuti gli ogrtti che rapresentano le rotte
      for (const oRoute of Avalue) {
        const path = `${prefix}/${key}${oRoute.path}`;

        // HANDLER MANCANTE O NON INVOCABILE. Il caso tipico è `func` invece di
        // `handler`: CLAUDE.md lo dava per «silenziosamente ignorato», ma la
        // misura dice altro — la rotta veniva REGISTRATA con un handler che
        // avvolgeva `undefined`, e falliva alla prima richiesta con
        // `TypeError: originalHandler is not a function`, cioè un 500. Peggio di
        // una rotta assente: esiste, risponde, e si rompe solo quando qualcuno la
        // usa. Meglio non registrarla e dirlo al boot.
        if (typeof oRoute.handler !== 'function') {
          logger.warn('pluginSys',
            `Rotta IGNORATA — plugin "${key}", ${oRoute.method} ${path}: handler mancante o non invocabile\n` +
            `   La chiave DEVE chiamarsi "handler" ed essere una funzione${oRoute.func ? ' — qui c\'è "func", che pluginSys non legge' : ''}.\n` +
            `   Senza questo controllo la rotta verrebbe registrata e risponderebbe 500 alla prima richiesta.`);
          continue;
        }

        // ACCESS MANCANTE O INUTILIZZABILE. Terza forma di rotta malformata, e la
        // più grave: qui la rotta non spariva né dava 500 — veniva REGISTRATA e
        // funzionava, ma senza il wrap di autenticazione. `CLAUDE.md` dichiarava
        // questo caso « errore fatale al boot »; il gate non è mai esistito.
        // Saltarla, invece di morire, allinea la risposta al boot graceful dei
        // plugin: una svista di terze parti non deve fermare l'installazione.
        if (!declaresAccess(oRoute)) {
          logger.warn('pluginSys',
            `Rotta IGNORATA — plugin "${key}", ${oRoute.method} ${path}: campo "access" mancante o non utilizzabile\n` +
            `   Ricevuto: ${JSON.stringify(oRoute.access) ?? String(oRoute.access)}. Serve un oggetto, es. { requiresAuth: false, allowedRoles: [] }.\n` +
            `   Senza questo controllo la rotta verrebbe registrata SENZA verifica di autenticazione.`);
          continue;
        }

        // `access` è dichiarato: l'handler passa sempre dal wrap di controllo
        // accessi e ruoli. Non c'è più un ramo « senza wrap » — era quello che
        // rendeva aperta una rotta a cui il campo mancava.
        const handler = this.#wrapHandlerWithAccessCheck(oRoute.handler, oRoute.access);

        // Indice dei path riservati, per il reserved gate.
        //
        // Il route-wrap qui sopra copre il caso normale (metodo giusto, handler
        // invocato), ma NON il metodo sbagliato: `router.allowedMethods()`
        // risponde 405 senza mai entrare nell'handler, e un 405 dice "questo path
        // esiste" — l'esatto contrario di quel che l'assetto vetrina promette
        // (verificato: GET su una rotta POST-only dava 405 mentre tutto il resto
        // dava 404). Il gate, che sta prima del router, chiude questi path per
        // path e non per metodo.
        if (oRoute.access.requiresAuth || oRoute.access.isAuthEntryPoint) {
          this.#reservedRoutePaths.add(path);
        }

        // key è il nome del plugin, che fa parte del percorso per evitare conflitti.
        const routerMethod = ROUTER_METHOD_DISPATCH[oRoute.method];
        if (routerMethod) {
          router[routerMethod]( path , handler );
        } else {
          // RAMO CHE PRIMA NON ESISTEVA. La catena if/else si limitava ai cinque
          // metodi noti e finiva lì: una rotta con qualunque altro verbo non veniva
          // registrata, senza errore né warning. Spariva — e la richiesta cadeva sul
          // server statico restituendo HTML dove il chiamante aspettava JSON, un
          // difetto che si nota solo dal browser. È la stessa classe di guasto
          // silenzioso del `method` minuscolo descritta in CLAUDE.md, ed è ora
          // l'unica delle tre a essere diagnosticata a voce.
          logger.warn('pluginSys',
            `Rotta IGNORATA — plugin "${key}", metodo "${oRoute.method}" ${path}\n` +
            `   Metodi gestiti: ${Object.keys(ROUTER_METHOD_DISPATCH).join(', ')} (MAIUSCOLI).\n` +
            `   La rotta NON è registrata: la richiesta cadrà sul server statico (HTML invece di JSON).`);
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
      // ── Superficie riservata chiusa (CLI: `reserved stop`) ──
      // PRIMO controllo, prima ancora del CSRF: se la rotta appartiene alla
      // superficie riservata deve semplicemente non esistere — non deve né
      // validare token né distinguere fra 401 e 403, perché ogni risposta
      // diversa dal 404 del sito racconta qualcosa di ciò che c'è dietro.
      //
      // Perimetro, derivato da quel che le rotte GIÀ dichiarano:
      //   • requiresAuth: true      → sta dietro l'autenticazione
      //   • isAuthEntryPoint: true  → è pubblica per necessità (login, logout,
      //                               sonde di stato) ma appartiene comunque
      //                               alla superficie riservata
      const reservedGate = this.#reservedGate;
      if (reservedGate && reservedGate.isClosed() && (access.requiresAuth || access.isAuthEntryPoint)) {
        reservedGate.deny(ctx);
        return;
      }

      // ── Protezione CSRF (anti cross-site request forgery) ──
      // Eseguita PRIMA del controllo auth così copre anche le rotte pubbliche
      // mutanti (es. POST /login). Il plugin csrfProtection è OPZIONALE: se
      // assente/disattivo getSharedObject ritorna null e la validazione viene
      // saltata (degradazione graziosa). La logica (metodi mutanti, esenzioni,
      // token, Origin) è interamente nel plugin: qui rispettiamo solo il verdetto.
      //
      // `access` viene passato perché il plugin ne DERIVA l'ambito CSRF
      // (`requiresAuth` / `isAuthEntryPoint` / nessuno dei due) invece di
      // richiedere un marcatore proprio sulle rotte — stessa fonte da cui la
      // superficie riservata deriva il proprio perimetro, tre righe più sopra.
      const csrf = this.getSharedObject('csrfProtection');
      if (csrf && typeof csrf.validateRequest === 'function') {
        const verdict = csrf.validateRequest(ctx, access);
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
      const descriptionPath = path.join(this.#pluginsRootPath, pluginName, 'pluginDescription.json5');
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

// Esposto perché `core/testHelpers/routeRunner.js` usi LO STESSO predicato del
// runtime invece di riscriverlo: la parte in comune fra validatore e dispatcher
// è già tornata a divergere una volta (difetto 🟡 di v3.10.0). Stessa forma di
// `editJson5._internals`.
module.exports.declaresAccess = declaresAccess;