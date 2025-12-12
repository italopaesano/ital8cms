const ConfigManager = require('./lib/configManager');
const AdminServicesManager = require('./lib/adminServicesManager');
const SymlinkManager = require('./lib/symlinkManager');

/**
 * AdminSystem - Sistema centrale di gestione admin
 *
 * Coordina tutti i componenti dell'admin:
 * - ConfigManager: Gestisce adminConfig.json5
 * - AdminServicesManager: Gestisce servizi forniti da plugin
 * - SymlinkManager: Gestisce symlink delle sezioni
 *
 * Workflow inizializzazione:
 * 1. Costruttore: Crea manager (senza pluginSys)
 * 2. setPluginSys(): Collega pluginSys dopo creazione
 * 3. initialize(): Processa plugin admin, crea symlink, carica servizi
 */
class AdminSystem {
  constructor(themeSys) {
    this.themeSys = themeSys;
    this.pluginSys = null;  // Sarà settato dopo con setPluginSys()

    // Inizializza manager
    this.configManager = new ConfigManager();
    this.servicesManager = new AdminServicesManager(this.configManager);
    this.symlinkManager = new SymlinkManager(this.configManager);

    console.log('✓ Admin System created');
  }

  /**
   * Setta riferimento a PluginSys (chiamato dopo costruzione)
   * @param {object} pluginSys
   */
  setPluginSys(pluginSys) {
    this.pluginSys = pluginSys;
    this.servicesManager.setPluginSys(pluginSys);
  }

  /**
   * Inizializza admin system (chiamato DOPO loadPlugins)
   * A questo punto tutti i plugin sono caricati
   */
  initialize() {
    if (!this.pluginSys) {
      throw new Error('AdminSystem.initialize() called but pluginSys is not set');
    }

    console.log('Initializing Admin System...');

    // 1. Valida symlink esistenti (verifica integrità)
    this.symlinkManager.validateSymlinks();

    // 2. Processa tutti i plugin admin caricati
    const plugins = this.pluginSys.getAllPlugins();
    for (const plugin of plugins) {
      if (plugin.pluginConfig?.pluginType?.isAdminPlugin) {
        this.onAdminPluginLoaded(plugin);
      }
    }

    // 3. Carica servizi
    this.servicesManager.loadServices();

    console.log('✓ Admin System initialized');
  }

  /**
   * Chiamato quando un plugin admin viene caricato
   * @param {object} plugin
   */
  onAdminPluginLoaded(plugin) {
    console.log(`Processing admin plugin: ${plugin.pluginName}`);

    // Installa sezione (crea symlink se necessario)
    try {
      this.symlinkManager.installPluginSection(plugin);
    } catch (error) {
      console.error(`✗ Failed to install section for plugin "${plugin.pluginName}":`, error.message);
      throw error;
    }

    // Registra servizi forniti dal plugin
    this.servicesManager.registerPlugin(plugin);
  }

  /**
   * Chiamato quando un plugin admin viene disinstallato
   * @param {object} plugin
   */
  onAdminPluginUninstalled(plugin) {
    console.log(`Uninstalling admin plugin: ${plugin.pluginName}`);

    // Rimuovi sezione (rimuovi symlink)
    this.symlinkManager.uninstallPluginSection(plugin);
  }

  /**
   * Ottiene sezioni da mostrare nel menu admin
   * @returns {Array<object>} - Array di sezioni con label, url, icon, etc.
   */
  getMenuSections() {
    const sections = [];
    const config = this.configManager.getConfig();

    for (const sectionId of config.menuOrder) {
      const sectionConfig = config.sections[sectionId];

      // Skip se sezione non esiste
      if (!sectionConfig) {
        continue;
      }

      // Skip se sezione disabilitata
      if (!sectionConfig.enabled) {
        continue;
      }

      if (sectionConfig.type === 'plugin') {
        // Sezione fornita da plugin
        const plugin = this.pluginSys.getPlugin(sectionConfig.plugin);

        // Skip se plugin non trovato o non attivo
        if (!plugin || plugin.pluginConfig.active !== 1) {
          continue;
        }

        // Ottiene info da adminConfig del plugin
        const adminConfig = plugin.adminConfig;
        if (!adminConfig || !adminConfig.adminSection) {
          console.warn(`⚠️ Plugin "${sectionConfig.plugin}" has no valid adminConfig`);
          continue;
        }

        sections.push({
          id: sectionId,
          label: adminConfig.adminSection.label,
          icon: adminConfig.adminSection.icon || '',
          url: `/${config.adminPrefix || 'admin'}/${sectionId}/index.ejs`,
          type: 'plugin',
          plugin: sectionConfig.plugin
        });

      } else if (sectionConfig.type === 'hardcoded') {
        // Sezione hardcoded
        sections.push({
          id: sectionId,
          label: sectionConfig.label,
          icon: sectionConfig.icon || '',
          url: sectionConfig.url,
          type: 'hardcoded'
        });
      }
    }

    return sections;
  }

  /**
   * Ottiene servizio per nome
   * @param {string} serviceName
   * @returns {object|null}
   */
  getService(serviceName) {
    return this.servicesManager.getService(serviceName);
  }

  /**
   * Ottiene endpoint API dei servizi per passData (usato in EJS)
   * @returns {object}
   */
  getEndpointsForPassData() {
    return this.servicesManager.getEndpointsForPassData();
  }

  /**
   * Ottiene configurazione UI
   * @returns {object}
   */
  getUI() {
    return this.configManager.getUI();
  }

  /**
   * Ottiene tutte le informazioni admin (UI + sezioni menu)
   * Metodo unificato per API endpoint
   * @returns {object} - { ui, sections }
   */
  getAdminSections() {
    return {
      ui: this.configManager.getUI(),
      sections: this.getMenuSections()
    };
  }

  /**
   * Ottiene ConfigManager
   * @returns {ConfigManager}
   */
  getConfigManager() {
    return this.configManager;
  }

  /**
   * Ottiene ServicesManager
   * @returns {AdminServicesManager}
   */
  getServicesManager() {
    return this.servicesManager;
  }

  /**
   * Ottiene SymlinkManager
   * @returns {SymlinkManager}
   */
  getSymlinkManager() {
    return this.symlinkManager;
  }
}

module.exports = AdminSystem;
