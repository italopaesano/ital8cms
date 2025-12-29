// Questo file segue lo standard del progetto ital8cms
const fs = require('fs')
const path = require('path')

/**
 * Gestione backup compartimentato per inizializzazione
 * - Backup globale: configurazioni core
 * - Backup plugin: file specifici per ogni plugin
 */
class BackupManager {
  constructor(logger) {
    this.logger = logger
    this.backupRoot = path.join(__dirname, '../../backups')
    this.timestamp = this.getItalianTimestamp()
    this.currentBackupDir = path.join(this.backupRoot, `init-${this.timestamp}`)
    this.globalBackupDir = path.join(this.currentBackupDir, 'global')
    this.pluginsBackupDir = path.join(this.currentBackupDir, 'plugins')
  }

  /**
   * Genera timestamp formato italiano: DD-MM-YYYY_HH-MM-SS
   */
  getItalianTimestamp() {
    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = now.getFullYear()
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')

    return `${day}-${month}-${year}_${hours}-${minutes}-${seconds}`
  }

  /**
   * Crea directory backup se non esistono
   */
  ensureBackupDirs() {
    if (!fs.existsSync(this.backupRoot)) {
      fs.mkdirSync(this.backupRoot, { recursive: true })
    }
    if (!fs.existsSync(this.currentBackupDir)) {
      fs.mkdirSync(this.currentBackupDir, { recursive: true })
    }
    if (!fs.existsSync(this.globalBackupDir)) {
      fs.mkdirSync(this.globalBackupDir, { recursive: true })
    }
    if (!fs.existsSync(this.pluginsBackupDir)) {
      fs.mkdirSync(this.pluginsBackupDir, { recursive: true })
    }
  }

  /**
   * Backup file configurazione globale
   * @param {String} filePath - Path assoluto del file
   * @returns {String} Path del backup
   */
  backupGlobalFile(filePath) {
    this.ensureBackupDirs()

    if (!fs.existsSync(filePath)) {
      this.logger.warning(`File non trovato per backup: ${filePath}`)
      return null
    }

    const fileName = path.basename(filePath)
    const backupPath = path.join(this.globalBackupDir, fileName)

    try {
      fs.copyFileSync(filePath, backupPath)
      this.logger.info(`Backup creato: ${backupPath}`)
      return backupPath
    } catch (error) {
      this.logger.error(`Errore backup file: ${error.message}`)
      throw error
    }
  }

  /**
   * Backup file per plugin specifico
   * @param {String} pluginName - Nome plugin
   * @param {String} filePath - Path assoluto del file
   * @returns {String} Path del backup
   */
  backupPluginFile(pluginName, filePath) {
    this.ensureBackupDirs()

    if (!fs.existsSync(filePath)) {
      this.logger.warning(`File non trovato per backup: ${filePath}`)
      return null
    }

    const pluginBackupDir = path.join(this.pluginsBackupDir, pluginName)
    if (!fs.existsSync(pluginBackupDir)) {
      fs.mkdirSync(pluginBackupDir, { recursive: true })
    }

    // Mantieni struttura relativa dentro plugin
    const pluginRoot = path.join(__dirname, '../../plugins', pluginName)
    const relativePath = path.relative(pluginRoot, filePath)
    const backupPath = path.join(pluginBackupDir, relativePath)

    // Crea directory se necessario
    const backupDir = path.dirname(backupPath)
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    try {
      fs.copyFileSync(filePath, backupPath)
      this.logger.info(`Backup plugin creato: ${backupPath}`)
      return backupPath
    } catch (error) {
      this.logger.error(`Errore backup plugin file: ${error.message}`)
      throw error
    }
  }

  /**
   * Backup multipli file per plugin
   * @param {String} pluginName - Nome plugin
   * @param {Array<String>} filePaths - Array di path assoluti
   * @returns {String} Path directory backup plugin
   */
  backupPluginFiles(pluginName, filePaths) {
    if (!filePaths || filePaths.length === 0) {
      return null
    }

    this.logger.info(`Creazione backup per plugin: ${pluginName}`)

    for (const filePath of filePaths) {
      this.backupPluginFile(pluginName, filePath)
    }

    return path.join(this.pluginsBackupDir, pluginName)
  }

  /**
   * Ripristina file da backup
   * @param {String} backupPath - Path del backup
   * @param {String} originalPath - Path originale da ripristinare
   */
  restore(backupPath, originalPath) {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup non trovato: ${backupPath}`)
    }

    try {
      fs.copyFileSync(backupPath, originalPath)
      this.logger.success(`File ripristinato: ${originalPath}`)
      return true
    } catch (error) {
      this.logger.error(`Errore ripristino file: ${error.message}`)
      throw error
    }
  }

  /**
   * Ripristina tutti i file di un plugin
   * @param {String} pluginName - Nome plugin
   */
  restorePlugin(pluginName) {
    const pluginBackupDir = path.join(this.pluginsBackupDir, pluginName)

    if (!fs.existsSync(pluginBackupDir)) {
      throw new Error(`Backup plugin non trovato: ${pluginName}`)
    }

    this.logger.info(`Ripristino plugin da backup: ${pluginName}`)

    const pluginRoot = path.join(__dirname, '../../plugins', pluginName)

    // Funzione ricorsiva per ripristinare tutti i file
    const restoreDirectory = (backupDir, targetDir) => {
      const items = fs.readdirSync(backupDir)

      for (const item of items) {
        const backupItemPath = path.join(backupDir, item)
        const targetItemPath = path.join(targetDir, item)

        if (fs.statSync(backupItemPath).isDirectory()) {
          if (!fs.existsSync(targetItemPath)) {
            fs.mkdirSync(targetItemPath, { recursive: true })
          }
          restoreDirectory(backupItemPath, targetItemPath)
        } else {
          this.restore(backupItemPath, targetItemPath)
        }
      }
    }

    restoreDirectory(pluginBackupDir, pluginRoot)
    this.logger.success(`Plugin ripristinato: ${pluginName}`)
  }

  /**
   * Ottieni path relativo della directory backup corrente
   * @returns {String} Path relativo
   */
  getBackupPath() {
    return path.relative(path.join(__dirname, '../..'), this.currentBackupDir)
  }

  /**
   * Ottieni path relativo della directory backup plugin
   * @param {String} pluginName - Nome plugin
   * @returns {String} Path relativo
   */
  getPluginBackupPath(pluginName) {
    return path.relative(
      path.join(__dirname, '../..'),
      path.join(this.pluginsBackupDir, pluginName)
    )
  }
}

module.exports = BackupManager
