let pluginConfig = require(`${__dirname}/config-plugin.json`);// let perchè questa varibile può cambiare di valore 

function loadPlugin(){

};

function installPlugin(){

};

function unistallPlugin(){

};

function upgradePlugin(){

};

function getRouteArray(){// restituirà un array contenente tutte le rotte che poi saranno aggiunte al cms
  
  const routeArray = Array();
  
  return routeArray;
}

module.exports = {

  loadPlugin: loadPlugin,  //questa funzione verrà richiamata per caricare il plugin ogni volta che serve ad esempio ogni volta che si riavviam 
  installPlugin: installPlugin, // questa funzione verrà richiamata per installare il plugin
  unistallPlugin: unistallPlugin, // questa funzione verrà richiamata per disinstallare il plugin
  upgradePlugin: upgradePlugin, // questa funzione verrà richiamata quando sarà necessario aggiornare il plugin
  getRouteArray: getRouteArray,
  pluginConfig: pluginConfig

}