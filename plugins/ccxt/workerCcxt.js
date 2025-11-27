
const workerThreads = require('worker_threads');
const ccxt = require("ccxt");
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
//ccxt.exchanges --> lista degli exchanges supportati
const Aexchanges = ccxt.exchanges;// arraydegli excabges supportati
const MapExchanges = new Map();// mappa che conterrà i riferimenti a gli exchanges per cui è gia stata instanziata una comunicazione
//const binance = new ccxt.binance();

// Aumenta il limite degli ascoltatori per l'oggetto parentPort
//workerThreads.parentPort.setMaxListeners(15); // Imposta il limite a 15 o al valore desiderato


if (workerThreads.isMainThread) {//controllo se questo file non viene eseguito nel main tred perchè deve essere eseguito solo in tread secondari 
  // lancio l'errore in questo caso non invierò il messaggio di errore stesso perchè non ci sarà nessun trad principale a cui inviarlo
  const errorMessage = `Errore il file ${__filename} non deve essere eseguito nel main tread`;
  console.log('Error: ', errorMessage);
  const error = new Error(errorMessage);
  throw error;

}else{

    // adesso carico i dati dei custo exchane per vedere se ci sono api di exchange custom
    const customExchangesKey = loadJson5(path.join(__dirname, './custom/customExchangesKey.json')).exchanges;// restituisce un array
    customExchangesKey.forEach( ( exchange ) => {
      MapExchanges.set( exchange.exchangeName, new ccxt[exchange.exchangeName]({ 'apiKey': exchange.apiKey, 'secret': exchange.secret }));
    });


    //gli errori lanciati nei workertread non vengono catturati nel tread principale e devono essere gestiti nel workertread stesso 
    try{// catturo l'errore qui e lo passo poi come semplice messaggio perchè gli errori lanciati nei workertread non vengono catturati nel tread principale e devono essere gestiti nel workertread stesso 

    workerThreads.parentPort.on('message', async (message) => {

    if( message.type ){//allora è un messagio di chiusura 
      console.log('Chiusura del worker thread workerCcxt.js del plugin ccxt...');
      workerThreads.parentPort.close();
    }else{ //allora si processa la richiesta normalmente
      //:{exchange: params.exchange, request: parms.fnCcxt, param: ctx.query}
      //Es :{exchange: 'binance', request: 'fetchOHLCV', param: {symbol: "BTC/USDT"}}
      const result = await processMessage(message);
      workerThreads.parentPort.postMessage(result);
    }


      });
    }catch( error){

      workerThreads.parentPort.postMessage({error: error});

    }

    // gestisco la chiusura del programma ad esempio quando viene premuto ctrl + c
    // Ascolta per il messaggio di shutdown
/*   workerThreads.parentPort.on('message', (message) => {
  if (message.type === 'shutdown') {
      console.log('Chiusura del worker thread...');
      // Esegui qualsiasi pulizia necessaria qui
      
      //CHIUDO TUTTE LE CONNESSIONI CON I VARI EXCHANGE -> non necessario almeno sembra
       MapExchanges.forEach( (exchange) => {

      }); 

      // Termina il worker thread
      workerThreads.parentPort.close();
  }
}); */

}

/* 
@param {Object} message - l'ogetto che rappresenta il messaggio nella segunte forma :{exchange: parms.exchange, request: 'fetchOHLCV', param: ctx.query
 * @returns il risultato della funzione ccxt corrispondente
 * @throws {Error} Se i parametri non sono validi es excange non esistente oppure funzione non valida oppure parametri della funzione non validi
*/

async function processMessage(message){
  // message.exchange prima di tutto controllo se l'excange richiesto è fra quelli supportati 
  // poi controllo se esiste nella pMappa degli excange apeti , se si utilizzo quello per la comunicazione altrimenti lo carico e lo inserico nella mappa

  if( ! Aexchanges.includes(message.exchange)){// messagio di errore

    //lancio l'errore
    const errorMessage = `Errore l'exchange ${message.exchange} non è supportato da ccxt`;
    console.log('Error: ', errorMessage);
    workerThreads.parentPort.postMessage({error: errorMessage});
// in questo contesto l'errore non può essere lanciato con throw error; perchè sarebbe gestito all'interno del trad bloccando e non potrebbe essere catturato nel main trad
    /* const error = new Error(errorMessage);
    throw error;
 */
  }else{//l'array appartiene all'elenco di quelli supportati 

    if(!MapExchanges.has( message.exchange )){// se l'array non è presente nella mappa allora lo si instanzia e poi lo si carica nella  mappa con il nome corrispondente 
      MapExchanges.set( message.exchange, new ccxt[message.exchange]);//istanzio l'excange richiesto e lo metto in mappa , es corrisponde --> set('binance', new ccxt.binance());
    }

    const exchange = MapExchanges.get(message.exchange);// a questo punto recuper l'istanza del'exchange caricato
    // a questo punto l'excange selezionato è attivo e pronto ad essere interrogato
    if( typeof exchange[message.request] === 'function' ){ //message.request --> funzione di ccxt richiesta
      try{//ATTENZIONE non so perchè ma ho tovuto mettere questo try{}... qui, quello all'interno della funzione principale dove viene chiamata: "const result = await processMessage(message);" non cattura l'eccezione
        //ATTENZIONE CONTROLARE LA VALIDITÀ DI: --> message.param --> che sono i paramentri della funzione
        return {uid: message.uid, response: await exchange[message.request](...Object.values(message.param)) };// eseguo la funzione generica dell'ogetto exchange generico
      }catch( error ){
        workerThreads.parentPort.postMessage({error: error});
      }
    }else if( exchange[message.request] ){// adesso consideroil caso in cui a ccxt sia richiesto un array e non una funzione

      try{
        return {uid: message.uid, response: exchange[message.request]};// restituisco l'array richiesto, naturalmente in quesocaso non ci sono parametri
      }catch( error ){
        workerThreads.parentPort.postMessage({error: error});
      }

    }else{// la funzione richiesta non è presente nella lista delle funzioni supportate
      const errorMessage = `la funzione o Array o Oggetto ${message.request} non è fra quelle supportate da ccxt per ${message.exchange}`;
      console.log('Error: ', errorMessage);
      workerThreads.parentPort.postMessage({error: errorMessage});
    }
    // adesso bisogna fare lo stesso lavoro con le funzioni recuperando la funzione ccxt corrispondente  
  }

}
/* 

    /* if (message.request == 'fetchOrderBook') {
      //const orderBook = await binance.fetchOrderBook(message.param.symbol);//('BTC/USDT');
      const orderBook = await processMessage(message);
      workerThreads.parentPort.postMessage(orderBook);
      
    }else if(message == 'fetchOHLCV'){
      //const ohlcv = await binance.fetchOHLCV('BTC/USDT', '1M');
      const ohlcv = await processMessage(message);
      workerThreads.parentPort.postMessage( ohlcv);
    } 
function fetchOrderBook(){
 orderbook = binance.fetch_order_book('BTC/USDT');
 orderbook.then((result) => {
  console.log(orderbook);
 }).catch((err) => {
   console.log(err);
   return { err: err};
 });
 return {orderbook: orderbook}
}

function fetchOHLCV(){
  return "test";
}


module.exports = {
  fetchOrderBook: fetchOrderBook,
  fetchOHLCV: fetchOHLCV 
} */