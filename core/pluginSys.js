
const fs = require('fs');
const path = require('path');
const semver = require('semver');

class pluginSys{

  #pluginsMiddlewares = Array();//Variabile privata che contiene l'elenco dei midlware dei plugin da aggiungere 
  #hooksPage;// variabile privata che conterrà la mappa degli hookdella pagina
  #routes;// variabile privata che conterrà le rotte aggiunte dai vari plugin
  #objectToShareToWebPages = {};// variabile che conterà gli ogetti restituiti dai vari plugin che saranno messi a dispozione del motore ejs e degli altri moduli
  #activePlugins = new Map();// Mappa che conterrà i plugin attivi
  #pluginsToActive = new Map();// plugin da attivare non ancora attivati perchè bisogna controllare le dipendenze

  constructor(){// qui bisognerà andare nella cartelle dai plugin e caricarli uno a uno 

    this.#hooksPage = new Map();// new Map(['namelPlugin', new Map(['head', (passData) => {}],['body', ( passData ) => {} ])]);
    this.#routes = new Map();// mappa che conterrà come chiave il nome del plugin da caricare e come valore un array contenete tutti gli ogetti che rappresentano le rotte

    //function caricatePlugin( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ){// questa funzione caricherà e se necessario installeà il plugin passato 
    // ATTENZIONE USO LA FUNZIONE FRECCIA PER MANTENERE il this locale , però la funzione freccia va dichiarata prima del suo utilizzo 
    const caricatePlugin = ( pluginName ) => { //, routes, hooksPage, objectToShareToWebPages, activePlugins ){/
      //caricatePlugin = ( pluginName, pluginConfig, routes, hooksPage, objectToShareToWebPages, activePlugins ) => {// q
        //console.log(pluginConfig);
        const pluginConfig = require(`../plugins/${pluginName}/config-plugin.json`);
        const plugin = require(`../plugins/${pluginName}/main.js`);// 

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
          plugin.installPlugin();// installo il plugin e dopo aggiornerò config-plugin.json settando isInstalled = 1
          pluginConfig.isInstalled = 1;//ora devo aggiornare config-plugin.json settando isInstalled = 1
          plugin.pluginConfig = pluginConfig ;// aggiorno anche l'ogetto interno al plugin
  
          // scrivo il nuovo file config-plugin.json con la variabile isInstalled aggiornata correttamente
          const textPluginConfig = JSON.stringify( pluginConfig, null, 2 );
          fs.promises.writeFile( `${__dirname}/../plugins/${pluginName}/config-plugin.json` , textPluginConfig )// aggiorno il file config-plugin.json
          .catch( (error) => {
            console.log(`si è verificato un errore nella scrittura del file config-plugin.json del plugin ${pluginName} , errore:`, error );
          });    
        }// if( pluginConfig.isInstalled == 0 ){
  
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
          this.#pluginsMiddlewares.push( plugin.getMiddlewareToAdd );// sarà un array di funzioni che generano un array
        }

        // loadPluginn(); // viene chiamato dopo perchè durante il caricamento potrebbe acadere che abbia bisogno di librerie di altri plugin
        plugin.loadPlugin();// questo carica il plugin
  
        
  
    }// const caricatePlugin = ( pluginName, pluginConfig ) => {

    // adesso leggo tutti i file della cartella plugins e ciclo per attivari e caricare quelli per essere caricati
    const baseDir =  path.join(__dirname, '..', 'plugins' ) ;//ottengo ilpercorso della directory plugins
    let Afiles = fs.readdirSync( baseDir );// gli dico di leggere il contenuto della directori plugins e metterloin un arra ps linux non distingue fra file e directori sono tutti fil eper lui
    Afiles = Afiles.filter(file => fs.statSync(baseDir + '/' +file).isDirectory())// prendo solo i "file" che in realtà sono directory

    const pluginsVersionMap = new Map();// mappa che conter le coppie nomePlugin -> Versione di tutti i plugin caricati o meno

    for( const nameFile of Afiles ){

      const pluginConfig = require(`../plugins/${nameFile}/config-plugin.json`);

      if( pluginConfig.active == 1 ){// il plugin è attivo quindi lo carico e dopo ( nell funzione caricate plugin controllo anche se è installato )

        const pluginVersion = require(`../plugins/${nameFile}/description-plugin.json`).version;
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

      dependencyMap.forEach( (version, plugiName) => {
        if( !pluginsListMap.has( plugiName ) ){
          return false;
        }
      });
      
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

}

module.exports = pluginSys ;