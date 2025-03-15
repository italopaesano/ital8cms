# ostrukBinance

in questo plugin verrannno caricate le api del mio account buinance in modo da poter interagire in remoto 
con i server binance e con i miei account

questo modulo genererà degi url con la forma da richiamare con ilmetodo GET come i seguenti:

/{api}/cctx/{exchange_name}/{ccxt_gunxtion}

ES:
/api/ccxt/binance/fetchOrderBook?symbol=BTC/USDT&limit=undefined

exchange_name = come viene chiamo l'exchange in ccxt

la queri get associatia a ciscun URL sarà identico ha gli argomenti della funzione ccxt di volta in volta richiamata



si interroga un indirizzo come in esempio 
/api/ccxt/binance/fetchOrderBook?symbol=BTC/USDT&limit=undefined
verrà passato al file workerCcxt.js (che sta lavorando in untread separato)
un ogetto attraverso una comunicazione multi tread del tipo :

```js
{uid: ++uidMessage, exchange: parms.exchange, request:'fetchOrderBook', param: ctx.query}
```
uid--> id univico che contrassegna il messagio (serve per gestire la sincrinizazione ed evitare scambio di messaggi)
exchange --> è il nome dell'exchange a cui riferirsi request --> è la funzione ccxt che è stata richiesta 
e param --> sono i parametri passati attraverso la funzione GET che corrisponderanno a quelli del nome della funzione chiamata 
nell'esempio di sopra:  
```js 
fetchOrderBook (symbol, limit = undefined, params = {});```

la query passata dal plugin ccxt al file workerCcxt.js ha il seguente formaro :
```js
await workerCcxtFn.postMessage({uid: xxx, exchange: "exchange Name", request: 'function ccx', param: ctx.query});```
Es:
```js 
await workerCcxtFn.postMessage({uid ++uidMessage, exchange: parms.exchange, request: 'fetchOHLCV', param: ctx.query});```