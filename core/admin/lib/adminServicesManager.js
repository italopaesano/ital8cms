/**
 * AdminServicesManager - Gestisce i servizi forniti dai plugin all'admin
 *
 * Un "servizio" è una funzionalità backend fornita da un plugin che può essere
 * utilizzata da altri componenti del sistema.
 *
 * Esempi di servizi:
 * - "auth": Autenticazione utenti (fornito da adminUsers)
 * - "email": Invio email (fornito da adminMailer)
 * - "storage": Gestione file (fornito da adminStorage)
 *
 * Responsabilità:
 * - Mappa nome servizio → plugin che lo fornisce
 * - Valida che i servizi richiesti siano disponibili
 * - Fornisce accesso ai plugin che forniscono servizi
 */
class AdminServicesManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.pluginSys = null;  // Sarà settato dopo con setPluginSys()
    this.services = new Map();  // serviceName → plugin
  }

  /**
   * Setta riferimento a PluginSys (chiamato dopo costruzione)
   */
  setPluginSys(pluginSys) {
    this.pluginSys = pluginSys;
  }

  /**
   * Carica i servizi dalla configurazione
   * (chiamato dopo che tutti i plugin sono stati caricati)
   */
  loadServices() {
    if (!this.pluginSys) {
      throw new Error('PluginSys not set, cannot load services');
    }

    const servicesConfig = this.configManager.getServices();

    for (const [serviceName, serviceConfig] of Object.entries(servicesConfig)) {
      const pluginName = serviceConfig.plugin;

      // Cerca il plugin
      const plugin = this.pluginSys.getPlugin(pluginName);

      if (!plugin) {
        if (serviceConfig.required) {
          throw new Error(
            `Required service "${serviceName}" not available. ` +
            `Plugin "${pluginName}" not found.`
          );
        } else {
          console.warn(`⚠️ Optional service "${serviceName}" not available (plugin "${pluginName}" not found)`);
          continue;
        }
      }

      // Verifica che il plugin sia attivo
      if (plugin.pluginConfig.active !== 1) {
        if (serviceConfig.required) {
          throw new Error(
            `Required service "${serviceName}" not available. ` +
            `Plugin "${pluginName}" is not active.`
          );
        } else {
          console.warn(`⚠️ Optional service "${serviceName}" not available (plugin "${pluginName}" not active)`);
          continue;
        }
      }

      // Registra servizio
      this.services.set(serviceName, plugin);
      console.log(`✓ Service "${serviceName}" → plugin "${pluginName}"`);
    }
  }

  /**
   * Registra un plugin che fornisce servizi
   * (chiamato quando un plugin admin viene caricato)
   */
  registerPlugin(plugin) {
    // Verifica che il plugin abbia adminConfig con servizi
    if (!plugin.adminConfig?.providesServices) {
      return; // Plugin non fornisce servizi
    }

    const providedServices = plugin.adminConfig.providesServices;

    for (const serviceName of providedServices) {
      // Verifica che il servizio sia configurato in adminConfig.json5
      const servicesConfig = this.configManager.getServices();
      const serviceConfig = servicesConfig[serviceName];

      if (!serviceConfig) {
        console.warn(
          `⚠️ Plugin "${plugin.pluginName}" provides service "${serviceName}" ` +
          `but it's not configured in adminConfig.json5`
        );
        continue;
      }

      // Verifica che il plugin corrisponda
      if (serviceConfig.plugin !== plugin.pluginName) {
        console.warn(
          `⚠️ Plugin "${plugin.pluginName}" provides service "${serviceName}" ` +
          `but adminConfig.json5 expects plugin "${serviceConfig.plugin}"`
        );
        continue;
      }

      console.log(`✓ Plugin "${plugin.pluginName}" registered for service "${serviceName}"`);
    }
  }

  /**
   * Ottiene plugin che fornisce un servizio
   * @param {string} serviceName - Nome del servizio (es. "auth", "email")
   * @returns {object|null} - Plugin object o null se non disponibile
   */
  getService(serviceName) {
    return this.services.get(serviceName) || null;
  }

  /**
   * Verifica se un servizio è disponibile
   * @param {string} serviceName
   * @returns {boolean}
   */
  hasService(serviceName) {
    return this.services.has(serviceName);
  }

  /**
   * Ottiene tutti i servizi disponibili
   * @returns {Map} - Map di serviceName → plugin
   */
  getAllServices() {
    return this.services;
  }

  /**
   * Ottiene endpoint API dei servizi per passData (usato in EJS)
   * @returns {object} - { serviceName: { endpoint1: url, endpoint2: url, ... } }
   */
  getEndpointsForPassData() {
    const endpoints = {};

    for (const [serviceName, plugin] of this.services.entries()) {
      // Ottiene endpoint dal adminConfig del plugin
      const apiEndpoints = plugin.adminConfig?.apiEndpoints || {};
      endpoints[serviceName] = apiEndpoints;
    }

    return endpoints;
  }
}

module.exports = AdminServicesManager;
