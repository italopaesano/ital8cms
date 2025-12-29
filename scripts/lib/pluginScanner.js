// Questo file segue lo standard del progetto ital8cms
const fs = require('fs')
const path = require('path')
const loadJson5 = require('../../core/loadJson5')

/**
 * Scansione plugin con script di inizializzazione
 * Cerca plugins/{pluginName}/scripts/init.js
 */
class PluginScanner {
  constructor(logger) {
    this.logger = logger
    this.pluginsDir = path.join(__dirname, '../../plugins')
  }

  /**
   * Scansiona tutti i plugin alla ricerca di script init
   * @returns {Array<Object>} Array di plugin con init
   */
  scanPlugins() {
    const pluginsWithInit = []

    if (!fs.existsSync(this.pluginsDir)) {
      this.logger.warning('Directory plugins non trovata')
      return pluginsWithInit
    }

    const pluginDirs = fs.readdirSync(this.pluginsDir)

    for (const pluginName of pluginDirs) {
      const pluginPath = path.join(this.pluginsDir, pluginName)

      // Salta se non è directory
      if (!fs.statSync(pluginPath).isDirectory()) {
        continue
      }

      // Cerca script init
      const initScriptPath = path.join(pluginPath, 'scripts', 'init.js')

      if (fs.existsSync(initScriptPath)) {
        // Leggi pluginConfig.json5 per metadati
        const pluginConfigPath = path.join(pluginPath, 'pluginConfig.json5')
        let pluginConfig = {}

        try {
          if (fs.existsSync(pluginConfigPath)) {
            pluginConfig = loadJson5(pluginConfigPath)
          }
        } catch (error) {
          this.logger.warning(`Errore lettura config plugin ${pluginName}: ${error.message}`)
        }

        // Leggi pluginDescription.json5 per descrizione
        const pluginDescPath = path.join(pluginPath, 'pluginDescription.json5')
        let pluginDescription = {}

        try {
          if (fs.existsSync(pluginDescPath)) {
            pluginDescription = loadJson5(pluginDescPath)
          }
        } catch (error) {
          this.logger.warning(`Errore lettura description plugin ${pluginName}: ${error.message}`)
        }

        pluginsWithInit.push({
          name: pluginName,
          path: pluginPath,
          initScriptPath: initScriptPath,
          dependencies: pluginConfig.initDependencies || [],
          active: pluginConfig.active === 1,
          description: pluginDescription.description || 'Nessuna descrizione disponibile'
        })
      }
    }

    return pluginsWithInit
  }

  /**
   * Ordina plugin per dipendenze usando topological sort
   * @param {Array<Object>} plugins - Array plugin da ordinare
   * @returns {Array<Object>} Plugin ordinati
   */
  sortByDependencies(plugins) {
    const sorted = []
    const visited = new Set()
    const visiting = new Set()

    // Crea mappa nome -> plugin
    const pluginMap = new Map()
    for (const plugin of plugins) {
      pluginMap.set(plugin.name, plugin)
    }

    const visit = (pluginName) => {
      if (visited.has(pluginName)) {
        return
      }

      if (visiting.has(pluginName)) {
        throw new Error(`Dipendenza circolare rilevata: ${pluginName}`)
      }

      visiting.add(pluginName)

      const plugin = pluginMap.get(pluginName)
      if (!plugin) {
        // Plugin dipendenza non ha init script, salta
        visiting.delete(pluginName)
        return
      }

      // Visita dipendenze prima
      for (const depName of plugin.dependencies) {
        visit(depName)
      }

      visiting.delete(pluginName)
      visited.add(pluginName)
      sorted.push(plugin)
    }

    // Visita tutti i plugin
    for (const plugin of plugins) {
      visit(plugin.name)
    }

    return sorted
  }

  /**
   * Ottiene lista plugin ordinati per inizializzazione
   * @returns {Array<Object>} Plugin ordinati
   */
  getPluginsForInit() {
    this.logger.info('Scansione plugin con script di inizializzazione...')

    const plugins = this.scanPlugins()

    if (plugins.length === 0) {
      this.logger.info('Nessun plugin richiede inizializzazione')
      return []
    }

    this.logger.info(`Trovati ${plugins.length} plugin con script init`)

    // Ordina per dipendenze
    try {
      const sorted = this.sortByDependencies(plugins)
      return sorted
    } catch (error) {
      this.logger.error(`Errore ordinamento plugin: ${error.message}`)
      throw error
    }
  }

  /**
   * Verifica se le dipendenze di un plugin sono soddisfatte
   * @param {Object} plugin - Plugin da verificare
   * @param {Object} stateManager - StateManager instance
   * @returns {Object} { satisfied: boolean, missing: [] }
   */
  checkDependencies(plugin, stateManager) {
    const missing = []

    for (const depName of plugin.dependencies) {
      if (!stateManager.isPluginInitialized(depName)) {
        missing.push(depName)
      }
    }

    return {
      satisfied: missing.length === 0,
      missing: missing
    }
  }
}

module.exports = PluginScanner
