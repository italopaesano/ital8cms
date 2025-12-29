// Questo file segue lo standard del progetto ital8cms
const fs = require('fs')
const path = require('path')
const loadJson5 = require('../../core/loadJson5')

/**
 * Gestione stato inizializzazione
 * - Stato globale: /scripts/initState.json5
 * - Stato plugin: /plugins/{pluginName}/scripts/initState.json5
 */
class StateManager {
  constructor(logger) {
    this.logger = logger
    this.globalStatePath = path.join(__dirname, '../initState.json5')
  }

  /**
   * Genera timestamp formato italiano: DD/MM/YYYY HH:MM:SS
   */
  getItalianTimestamp() {
    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = now.getFullYear()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
  }

  /**
   * Verifica se esiste stato inizializzazione globale
   * @returns {Boolean}
   */
  hasGlobalState() {
    return fs.existsSync(this.globalStatePath)
  }

  /**
   * Legge stato inizializzazione globale
   * @returns {Object|null}
   */
  readGlobalState() {
    if (!this.hasGlobalState()) {
      return null
    }

    try {
      return loadJson5(this.globalStatePath)
    } catch (error) {
      this.logger.error(`Errore lettura stato globale: ${error.message}`)
      return null
    }
  }

  /**
   * Scrive stato inizializzazione globale (formato dettagliato)
   * @param {Object} state - Stato da salvare
   */
  writeGlobalState(state) {
    const stateWithComment = {
      ...state,
      version: state.version || '1.0.0',
      initialized: state.initialized !== undefined ? state.initialized : true,
      initDate: state.initDate || this.getItalianTimestamp(),
      lastUpdate: this.getItalianTimestamp(),
      global: state.global || { completed: false },
      plugins: state.plugins || {}
    }

    const content = `// Questo file traccia lo stato di inizializzazione di ital8cms
${JSON.stringify(stateWithComment, null, 2)}`

    try {
      fs.writeFileSync(this.globalStatePath, content, 'utf8')
      this.logger.info('Stato globale salvato')
    } catch (error) {
      this.logger.error(`Errore scrittura stato globale: ${error.message}`)
      throw error
    }
  }

  /**
   * Aggiorna stato inizializzazione globale
   * @param {Object} updates - Parti da aggiornare
   */
  updateGlobalState(updates) {
    let currentState = this.readGlobalState() || {}

    const newState = {
      ...currentState,
      ...updates,
      lastUpdate: this.getItalianTimestamp()
    }

    this.writeGlobalState(newState)
  }

  /**
   * Aggiorna stato di un plugin specifico
   * @param {String} pluginName - Nome plugin
   * @param {Object} pluginState - Stato plugin
   */
  updatePluginState(pluginName, pluginState) {
    let currentState = this.readGlobalState() || {}

    if (!currentState.plugins) {
      currentState.plugins = {}
    }

    currentState.plugins[pluginName] = {
      ...pluginState,
      initDate: pluginState.initDate || this.getItalianTimestamp()
    }

    this.writeGlobalState(currentState)
  }

  /**
   * Verifica se un plugin è inizializzato
   * @param {String} pluginName - Nome plugin
   * @returns {Boolean}
   */
  isPluginInitialized(pluginName) {
    const state = this.readGlobalState()
    if (!state || !state.plugins || !state.plugins[pluginName]) {
      return false
    }
    return state.plugins[pluginName].completed === true
  }

  /**
   * Path file stato plugin
   * @param {String} pluginPath - Path assoluto cartella plugin
   * @returns {String}
   */
  getPluginStatePath(pluginPath) {
    return path.join(pluginPath, 'scripts', 'initState.json5')
  }

  /**
   * Verifica se esiste stato plugin
   * @param {String} pluginPath - Path assoluto cartella plugin
   * @returns {Boolean}
   */
  hasPluginState(pluginPath) {
    return fs.existsSync(this.getPluginStatePath(pluginPath))
  }

  /**
   * Legge stato plugin (formato minimale)
   * @param {String} pluginPath - Path assoluto cartella plugin
   * @returns {Object|null}
   */
  readPluginState(pluginPath) {
    const statePath = this.getPluginStatePath(pluginPath)
    if (!fs.existsSync(statePath)) {
      return null
    }

    try {
      return loadJson5(statePath)
    } catch (error) {
      this.logger.error(`Errore lettura stato plugin: ${error.message}`)
      return null
    }
  }

  /**
   * Scrive stato plugin (formato minimale + backupPath)
   * @param {String} pluginPath - Path assoluto cartella plugin
   * @param {Object} state - Stato da salvare
   */
  writePluginState(pluginPath, state) {
    const statePath = this.getPluginStatePath(pluginPath)

    // Crea directory scripts se non esiste
    const scriptsDir = path.dirname(statePath)
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true })
    }

    const pluginName = path.basename(pluginPath)
    const stateWithComment = {
      initialized: state.initialized !== undefined ? state.initialized : true,
      initDate: state.initDate || this.getItalianTimestamp(),
      backupPath: state.backupPath || null
    }

    const content = `// Stato inizializzazione plugin ${pluginName}
${JSON.stringify(stateWithComment, null, 2)}`

    try {
      fs.writeFileSync(statePath, content, 'utf8')
      this.logger.info(`Stato plugin salvato: ${pluginName}`)
    } catch (error) {
      this.logger.error(`Errore scrittura stato plugin: ${error.message}`)
      throw error
    }
  }

  /**
   * Reset stato globale (per re-inizializzazione)
   */
  resetGlobalState() {
    if (fs.existsSync(this.globalStatePath)) {
      fs.unlinkSync(this.globalStatePath)
      this.logger.info('Stato globale resettato')
    }
  }

  /**
   * Reset stato plugin
   * @param {String} pluginPath - Path assoluto cartella plugin
   */
  resetPluginState(pluginPath) {
    const statePath = this.getPluginStatePath(pluginPath)
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath)
      const pluginName = path.basename(pluginPath)
      this.logger.info(`Stato plugin resettato: ${pluginName}`)
    }
  }
}

module.exports = StateManager
