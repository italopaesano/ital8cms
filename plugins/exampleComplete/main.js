/**
 * Plugin di Esempio Completo per ital8cms
 *
 * Questo plugin dimostra TUTTE le funzionalità del sistema plugin.
 * Usalo come riferimento per creare i tuoi plugin.
 *
 * @module exampleComplete
 * @version 1.0.0
 * @author ital8cms Team
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

// Configurazione del plugin
const pluginConfig = require('./pluginConfig.json');
const pluginDescription = require('./pluginDescription.json');
const ital8Conf = require('../../ital8Config.json');

// Nome del plugin (usato per costruire URL)
const pluginName = pluginDescription.name;

// Variabili interne del plugin
let sharedObjects = {};  // Oggetti ricevuti da altri plugin
let pluginData = {       // Dati interni del plugin
  initialized: false,
  counter: 0
};

// ============================================================================
// FUNZIONI DEL CICLO DI VITA
// ============================================================================

/**
 * Funzione chiamata quando il plugin viene caricato
 *
 * Viene eseguita ad ogni avvio del server.
 * Usa questa funzione per:
 * - Inizializzare variabili
 * - Connettersi a servizi esterni
 * - Preparare risorse
 *
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {string} pathPluginFolder - Percorso assoluto alla cartella del plugin
 */
function loadPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Plugin caricato da: ${pathPluginFolder}`);

  // Esempio: accedi ad oggetti condivisi da altri plugin
  const dbApi = pluginSys.getSharedObject ? pluginSys.getSharedObject('dbApi') : null;
  if (dbApi) {
    console.log(`[${pluginName}] Database disponibile da dbApi`);
  }

  pluginData.initialized = true;
  pluginData.loadedAt = new Date().toISOString();
}

/**
 * Funzione chiamata quando il plugin viene installato per la prima volta
 *
 * Viene eseguita UNA SOLA VOLTA quando isInstalled = 0.
 * Usa questa funzione per:
 * - Creare tabelle nel database
 * - Copiare file di configurazione
 * - Inizializzare dati di default
 *
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {string} pathPluginFolder - Percorso assoluto alla cartella del plugin
 */
function installPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Installazione plugin...`);

  // Esempio: crea una cartella per i dati
  const dataFolder = path.join(pathPluginFolder, 'data');
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
    console.log(`[${pluginName}] Cartella data creata`);
  }

  // Esempio: crea un file di configurazione iniziale
  const initialData = {
    createdAt: new Date().toISOString(),
    settings: {
      enabled: true,
      maxItems: 100
    }
  };

  fs.writeFileSync(
    path.join(dataFolder, 'settings.json'),
    JSON.stringify(initialData, null, 2)
  );

  console.log(`[${pluginName}] Installazione completata`);
}

/**
 * Funzione chiamata quando il plugin viene aggiornato
 *
 * Viene eseguita quando la versione in pluginDescription.json
 * è maggiore della versione in pluginConfig.json.
 *
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {string} pathPluginFolder - Percorso assoluto alla cartella del plugin
 * @param {string} oldVersion - Versione precedente (es. "1.0.0")
 * @param {string} newVersion - Nuova versione (es. "1.1.0")
 */
function upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
  console.log(`[${pluginName}] Upgrade da ${oldVersion} a ${newVersion}`);

  // Esempio: migrazione basata sulla versione
  const semver = require('semver');

  // Migrazione per versione < 2.0.0
  if (semver.lt(oldVersion, '2.0.0')) {
    console.log(`[${pluginName}] Eseguo migrazione pre-2.0.0`);
    // Qui esegui le migrazioni necessarie
  }

  // Migrazione per versione < 1.5.0
  if (semver.lt(oldVersion, '1.5.0')) {
    console.log(`[${pluginName}] Eseguo migrazione pre-1.5.0`);
    // Aggiungi nuovi campi al database, ecc.
  }

  console.log(`[${pluginName}] Upgrade completato`);
}

/**
 * Funzione chiamata quando il plugin viene disinstallato
 *
 * Usa questa funzione per:
 * - Rimuovere tabelle dal database
 * - Eliminare file temporanei
 * - Pulire risorse
 *
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {string} pathPluginFolder - Percorso assoluto alla cartella del plugin
 */
function uninstallPlugin(pluginSys, pathPluginFolder) {
  console.log(`[${pluginName}] Disinstallazione plugin...`);

  // Esempio: rimuovi la cartella data
  const dataFolder = path.join(pathPluginFolder, 'data');
  if (fs.existsSync(dataFolder)) {
    fs.rmSync(dataFolder, { recursive: true });
    console.log(`[${pluginName}] Cartella data rimossa`);
  }

  console.log(`[${pluginName}] Disinstallazione completata`);
}

// ============================================================================
// ROUTE API
// ============================================================================

/**
 * Definisce le route API del plugin
 *
 * Ogni route sarà disponibile a: /api/{pluginName}/{path}
 *
 * @returns {Array} Array di oggetti route
 */
function getRouteArray() {
  const routeArray = [];

  // -------------------------------------------------------------------------
  // GET - Pagina HTML
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'GET',
    path: '/demo',
    handler: async (ctx) => {
      // Renderizza una pagina EJS
      const templatePath = path.join(__dirname, 'webPages', 'demo.ejs');

      const data = {
        title: 'Demo Plugin',
        counter: pluginData.counter,
        loadedAt: pluginData.loadedAt,
        config: pluginConfig.custom
      };

      ctx.body = await ejs.renderFile(templatePath, data);
      ctx.type = 'html';
    }
  });

  // -------------------------------------------------------------------------
  // GET - JSON Response
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'GET',
    path: '/info',
    handler: async (ctx) => {
      ctx.body = {
        name: pluginName,
        version: pluginDescription.version,
        initialized: pluginData.initialized,
        counter: pluginData.counter,
        config: pluginConfig.custom
      };
      ctx.type = 'json';
    }
  });

  // -------------------------------------------------------------------------
  // GET con Query Parameters
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'GET',
    path: '/search',
    handler: async (ctx) => {
      // Accedi ai parametri: /api/exampleComplete/search?q=test&limit=10
      const query = ctx.query.q || '';
      const limit = parseInt(ctx.query.limit) || 10;

      ctx.body = {
        query: query,
        limit: limit,
        results: [`Risultato per "${query}"`, `Altro risultato`].slice(0, limit)
      };
      ctx.type = 'json';
    }
  });

  // -------------------------------------------------------------------------
  // POST - Ricevi dati
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'POST',
    path: '/increment',
    handler: async (ctx) => {
      // Accedi al body della richiesta
      const { amount } = ctx.request.body;

      pluginData.counter += amount || 1;

      ctx.body = {
        success: true,
        newValue: pluginData.counter
      };
      ctx.type = 'json';
    }
  });

  // -------------------------------------------------------------------------
  // POST con validazione
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'POST',
    path: '/create',
    handler: async (ctx) => {
      const { name, email } = ctx.request.body;

      // Validazione
      if (!name || !email) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'Nome e email sono obbligatori'
        };
        ctx.type = 'json';
        return;
      }

      // Validazione email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'Email non valida'
        };
        ctx.type = 'json';
        return;
      }

      ctx.body = {
        success: true,
        message: `Creato: ${name} (${email})`
      };
      ctx.type = 'json';
    }
  });

  // -------------------------------------------------------------------------
  // Route protetta (richiede autenticazione)
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'GET',
    path: '/protected',
    handler: async (ctx) => {
      // Verifica autenticazione
      if (!ctx.session || !ctx.session.authenticated) {
        ctx.status = 401;
        ctx.body = {
          success: false,
          error: 'Autenticazione richiesta'
        };
        ctx.type = 'json';
        return;
      }

      ctx.body = {
        success: true,
        message: `Benvenuto ${ctx.session.user.name}!`,
        secretData: 'Questi sono dati riservati'
      };
      ctx.type = 'json';
    }
  });

  // -------------------------------------------------------------------------
  // Serve file statico
  // -------------------------------------------------------------------------
  routeArray.push({
    method: 'GET',
    path: '/style.css',
    handler: async (ctx) => {
      const cssPath = path.join(__dirname, 'webPages', 'style.css');
      ctx.body = fs.createReadStream(cssPath);
      ctx.type = 'css';
    }
  });

  return routeArray;
}

// ============================================================================
// PAGE HOOKS
// ============================================================================

/**
 * Definisce i contenuti da iniettare nelle pagine
 *
 * Sezioni disponibili: head, header, body, footer, script
 *
 * @returns {Map} Mappa sezione -> funzione
 */
function getHooksPage() {
  const hookMap = new Map();

  // -------------------------------------------------------------------------
  // HEAD - CSS e meta tag
  // -------------------------------------------------------------------------
  hookMap.set('head', (passData) => {
    return `
      <!-- Stili del plugin ${pluginName} -->
      <style>
        .example-plugin-box {
          padding: 10px;
          margin: 10px 0;
          border: 1px solid #ddd;
          border-radius: 5px;
          background: #f9f9f9;
        }
      </style>
    `;
  });

  // -------------------------------------------------------------------------
  // HEADER - Contenuto nell'header
  // -------------------------------------------------------------------------
  hookMap.set('header', (passData) => {
    // Esempio: mostra un banner se configurato
    if (pluginConfig.custom.showBanner) {
      return `
        <div class="example-plugin-box">
          <strong>Plugin Demo:</strong> Counter = ${pluginData.counter}
        </div>
      `;
    }
    return '';
  });

  // -------------------------------------------------------------------------
  // SCRIPT - JavaScript da caricare
  // -------------------------------------------------------------------------
  hookMap.set('script', (passData) => {
    return `
      <script>
        // JavaScript del plugin ${pluginName}
        console.log('Plugin ${pluginName} caricato');

        // Funzione di esempio
        window.examplePlugin = {
          increment: async function(amount) {
            const response = await fetch('/api/${pluginName}/increment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ amount })
            });
            return response.json();
          }
        };
      </script>
    `;
  });

  return hookMap;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Definisce i middleware da aggiungere
 *
 * I middleware vengono eseguiti per ogni richiesta.
 *
 * @returns {Array} Array di oggetti middleware
 */
function getMiddlewareToAdd() {
  return [
    {
      func: async (ctx, next) => {
        // Esempio: aggiungi un header personalizzato
        ctx.set('X-Plugin-Example', 'active');

        // Esempio: logga le richieste al plugin
        if (ctx.url.includes(`/api/${pluginName}/`)) {
          console.log(`[${pluginName}] ${ctx.method} ${ctx.url}`);
        }

        await next();
      }
    }
  ];
}

// ============================================================================
// OBJECT SHARING
// ============================================================================

/**
 * Fornisce oggetti da condividere con altri plugin
 *
 * @param {string} forPlugin - Nome del plugin richiedente
 * @param {object} pluginSys - Istanza del sistema plugin
 * @param {string} pathPluginFolder - Percorso del plugin
 * @returns {object} Oggetti da condividere
 */
function getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  // Puoi personalizzare cosa condividere per ogni plugin
  if (forPlugin === 'admin') {
    // Condividi più funzionalità con il plugin admin
    return {
      getCounter: () => pluginData.counter,
      setCounter: (val) => { pluginData.counter = val; },
      getConfig: () => pluginConfig.custom
    };
  }

  // Per altri plugin, condividi solo funzioni di lettura
  return {
    getCounter: () => pluginData.counter,
    isInitialized: () => pluginData.initialized
  };
}

/**
 * Riceve oggetti condivisi da altri plugin
 *
 * @param {string} fromPlugin - Nome del plugin che condivide
 * @param {object} sharedObject - Oggetto condiviso
 */
function setSharedObject(fromPlugin, sharedObject) {
  sharedObjects[fromPlugin] = sharedObject;
  console.log(`[${pluginName}] Ricevuto oggetto da ${fromPlugin}`);

  // Esempio: usa il database di dbApi
  if (fromPlugin === 'dbApi' && sharedObject.db) {
    console.log(`[${pluginName}] Database disponibile`);
  }
}

/**
 * Oggetti da condividere con le pagine web (template EJS)
 *
 * Questi oggetti saranno disponibili in passData.plugin.{pluginName}
 *
 * @returns {object} Oggetti per le pagine
 */
function getObjectToShareToWebPages() {
  return {
    counter: pluginData.counter,
    config: pluginConfig.custom,
    helpers: {
      formatDate: (date) => new Date(date).toLocaleDateString('it-IT')
    }
  };
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  // Ciclo di vita
  loadPlugin,
  installPlugin,
  uninstallPlugin,
  upgradePlugin,

  // Route e hooks
  getRouteArray,
  getHooksPage,
  getMiddlewareToAdd,

  // Object sharing
  getObjectToShareToOthersPlugin,
  setSharedObject,
  getObjectToShareToWebPages,

  // Configurazione (opzionale)
  pluginConfig
};
