
const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const ccxt = require("ccxt");// qui serve solo per rispondere alle funzioni generiche tutte quelle che richiedono di pecificare un exchange verra usato la comunicazione intratred con workerCcxt.js
const ccxtDataTables = require('./lib/ccxtDataStructureTables');// servirà a creare le tabbelle che immagazineranno i dati delle strutture di ccxt

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename(  __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin
const sharedObject = {};// ogetto che avrà gliogetti condiviso con gli altri plugin ES {dbApi: newdbApi}

const workerThreads = require('worker_threads');

//let workerCcxt;//variabile cche conterrà i riferimenti per comunicare con il tread del worker
//non so perchè ma in questo caso il percorso base è nel root del progetto npm
const workerCcxt = new workerThreads.Worker('./plugins/ccxt/workerCcxt.js');

//GESTISCO LA CHIUSURA DEL PROGRAMMA
// Gestione dell'evento SIGINT (ad esempio, Ctrl+C)
process.on('SIGINT', () => {
  console.log('Ricevuto SIGINT. Chiudo il workerCcxt thread.');

  // Invia un messaggio al worker per chiuderlo
  workerCcxt.postMessage({ type: 'shutdown' });// { type: 'shutdown' } è una mia trovata non una caratteristica dei worked tresd

  // Aspetta che il worker si chiuda
  workerCcxt.on('exit', (code) => {
      console.log(`workerCcxt terminato con codice ${code}`);
      process.exit(0); // Termina il processo principale
  });
});


let uidMessage = 0;// meglio che parte da 1 e non da zero cosi non può essere scambiato per false in un eventuale controlo if

function getUidMessage(){// questa funzione ritorna un uid per il messaggio , scrivo una funzione perchè credo che in futuro sarà migliorbile,per evitare la Race Condition
  //console.log(`MessageCounter uidMessage in getUidMessage : ${uidMessage}`);
  return ++uidMessage;
}


//OLD
/* let uidMessage = 0;//quid che sarà utilizato per contrassegnare i messagi
function getUidMessage(){// questa funzione ritorna un uid per il messaggio , scrivo una funzione perchè credo che in futuro sarà migliorbile,per evitare la Race Condition
  console.log(`uidMessage in getUidMessage : ${uidMessage}`);
  return ++uidMessage;
} */

function loadPlugin(){
  ccxtDataTables.createCcxtDataStructureTables( sharedObject.dbApi.db );
  //console.log( 'sharedObject: ', sharedObject );
};

function installPlugin(){

};

function unistallPlugin(){

};

function upgradePlugin(){

};

function getObjectToShareToWebPages(){// restituisce un ogetto che sarà condiviso con i modori di template come sotto ogetto fi PassData.plugin.['nomePlugin']

  return {};
}

function getObjectToShareToOthersPlugin( pluginName ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

  return {};
}

function setSharedObject( pluginName, object ){// pluginName = nome dell'altro plugin con cui sarà condiviso questo serve a creare comportamenti personalizati in base al plugin con cui si condivi

  sharedObject[pluginName] = object;// creo un ogetto con otributi con ilnome del plugin

}

function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
  
  const routeArray = Array();

  routeArray.push(
/*     {
      method: 'GET',
      path: '/exchanges', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 
        ctx.body = ccxt.exchanges; // old ora farò restituire direttamente l'array ctx.body = Object.assign({}, ccxt.exchanges );// utilizzo --> Object.assign({}, ... per convertire l'array in un ogetto che è maggiormente corrispondente al formato json
        ctx.set('Content-Type', 'application/json');
       }
    }, */
    { //Ritornerà un array di ogetti come contenuto in customExchangesKey.json5 tranne per le chiavi pubbliche e private che non saranno presenti
      method: 'GET',
      path: '/listExchangesWithAccount', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => {
        ctx.body = loadJson5(path.join(__dirname, './custom/customExchangesKey.json5')).exchanges.map( (item) => { return {exchangeName: item.exchangeName, refCoin: item.refCoin, id: item.id, accountName: item.accountName } }); // la funzione map è fatta in modo che l'array non contenga informazioni senzibili come l' apiKey o altro
        ctx.set('Content-Type', 'application/json');
       }
    },
    {
      method: 'GET',
      path: '/exchanges', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 
        ctx.body = ccxt.exchanges; // old ora farò restituire direttamente l'array ctx.body = Object.assign({}, ccxt.exchanges );// utilizzo --> Object.assign({}, ... per convertire l'array in un ogetto che è maggiormente corrispondente al formato json
        ctx.set('Content-Type', 'application/json');
       }
    },
    {
      method: 'GET',   // exchange -> nome del'excange in lista ccxt , fnCcxt --> funzione in excange.fnCcxt() riciesta
      path: '/:exchange/:fnCcxt', // l'url completo avra la forma /api/namePlugin/questo nome -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 

        const instanceUid = getUidMessage();

        try{
          //ctx.query --> la query string passata con GET parms.exchange --> la variabile che viene passata via url e che come segnaposto :exchange
          workerCcxt.postMessage({uid: instanceUid, exchange: ctx.params.exchange, request: ctx.params.fnCcxt, param: ctx.query});// con questa riga invio il messaggio poi tochherà aspettare la risposta
          
          let result = new Promise( (resolve, reject) => {// uso la promise per bloccare l'esecuzione della funzione fino al ricevimento della prima risposta
            
            // dichiaro la funzione listener per avere poi un riferimento per poi togliere il listener dalll'ascolto una volta che deve essere rilasciato
            const listener = (message) => {
              //if( essage.uid !== undefined --> controllo prima che message.uid esista e dopo faccio il confronte questo nel caso si intercetti un messaggio senza uid
              
              console.log(`instanceUid: ${instanceUid}, message.uid:${ message.uid ? message.uid : "nonDefinito"} `)//,message:`, message);
              !message.uid ? console.log("attenzione non esiste message.uid ecco tuto message:", message) : "" ;// debug se non esiste un uid nel messaggio lo stampo 
              
              if( message.uid !== undefined && instanceUid == message.uid ){// elaboto il messagio solo se ha il giusto uid
                resolve(message.response);
                workerCcxt.removeListener( 'message', listener )
                //message = null;
              }
              //reject('Errore durante l\'operazione');
            }

            workerCcxt.on('message', listener);
          });
          
          // aspetto che la promise sia risolta per ritornare il messaggio 
          result = await result; // faccio cosi (result = await result;)per avere a dispoizione l'ogetto restituito dalla promise e non la promise stessa

          if(result.error){// controllo se è presente l'errore
            // prendola descrizione dell'errore e lo lancio 
            throw new Error( result.error );
            
          }else{

            ctx.body = result;
            ctx.set('Content-Type', 'application/json');
            next();

          }   

        }catch(error){

          ctx.status = 400;
          ctx.body = {
            error: 'Bad Request',
            message: `Errore: ${error}`,
          };
          ctx.set('Content-Type', 'application/json');
        }

      }
    },
    /* {
      method: 'GET',
      path: '/:exchange/fetchOHLCV', // l'url completo avra la forma /api/namePlugin/questo nome -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 
        await workerCcxt.postMessage({exchange: ctx.params.exchange, request: 'fetchOHLCV', param: ctx.query});//('getFetchOHLCV');// con questa riga invio il messaggio poi tochherà aspettare la risposta
        
        const result = new Promise( (resolve, reject) => {// uso la promise per bloccare l'esecuzione della funzione fino al ricevimento della prima risposta
          workerCcxt.on('message', (message) => {
            //console.log('risultato messaggio:', message);
            resolve(message);
            //reject('Errore durante l\'operazione');
          });
        });

        ctx.body = await result; // aspetto che la promise sia risolta per ritornare il messaggio 
        ctx.set('Content-Type', 'application/json');
        next();
       }
    }, */
    {
      method: 'GET',
      path: '/test', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 
        //const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css');
        ctx.body = "ciao ciao";
        ctx.set('Content-Type', 'text/css');
       }
    }
  );
  //ES.
  /* routeArray.push(
    {
      method: 'GET',
      path: '/css/bootstrap.min.css', // l'url completo avra la forma /api/namePlugin/css -> se vengono mantenute le impostazioni di default
      handler: async (ctx, next) => { 
        const bootstrapCssPath = path.join(__dirname , '..', '..', 'node_modules','bootstrap','dist','css','bootstrap.min.css');
        ctx.body = fs.createReadStream(bootstrapCssPath);
        ctx.set('Content-Type', 'text/css');
       }
    }
  ); */

  return routeArray;
}

/* 
  restituira una mappa che comechiave avrà la parte della pagina dove eseguire le funzione e come valore la funzione da eseguire 
  la funzione da eseguire avrà come paramentro passData che è l'aogetto contenente tutto ciò che verrà passato alla pagine
 */

function getHooksPage(){

  const fnInPageMap = new Map();

  //fnInPageMap.set( 'body', (passData) => '<h3>ciao a tutti</h3>');
  //fnInPageMap.set('footer', (passData) => '<b>sono nel footer</b>');

  return fnInPageMap;
  
/*   new Map(
    ['body', function(passData) {return 'ciao a tutti';}],
    ['footer', function(passData) {return 'sono nel footer';}] 
    ); */
}


module.exports = {

  loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
  installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
  unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
  upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
  getObjectToShareToWebPages: getObjectToShareToWebPages,
  getObjectToShareToOthersPlugin: getObjectToShareToOthersPlugin,
  setSharedObject: setSharedObject,//setterà l'ogetto che sarà condiviso con tutti i plugin
  pluginName: pluginName,
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig,
  getHooksPage: getHooksPage,

}


/* OLD_ const fs = require('fs');
const path = require('path');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));// let perchè questa varibile può cambiare di valore 
const pluginName = path.basename( __dirname );// restituisce il nome della directory che contiene il file corrente e che è anche il nome del plugin

function loadPlugin(){

};

function installPlugin(){

};

function unistallPlugin(){

};

function upgradePlugin(){

};

function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
  
  const routeArray = Array(
    {
      method: 'GET',
      path: '/saluto', // path completo /api/binance/saluto 
      handler: async (ctx) => { 
        ctx.body = "Ciao a tutti";
       }
    }
  );

  return routeArray;
}

module.exports = {

  loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
  installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
  unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
  upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig

} */