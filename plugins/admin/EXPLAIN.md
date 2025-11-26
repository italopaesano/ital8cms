# in questo file devi spiegare le funzionalita del plufin come usarlo ed i dettagli di funzionamento


nel file pluginConfig.json ci sarà una struttura di questo tipo 
```js

{
  "active": 0,
  "isInstalled": 0,
  "weight": 0,
  "dependency": {},
  "nodeModuleDependency": {},
  "nodeModuleDependencyPriority": {},// dipendenze gestite da priorityMiddlewares.js moduli di node per cui è importante l'ordine di caricamento Es koa-session deve essere caricato prima di '@koa/router 
  "custom": {} // qui saranno inserite tutte le impostazioni specifiche del modulo 
}
```