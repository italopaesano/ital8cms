// Questo file segue lo standard del progetto ital8cms
const inquirer = require('inquirer')
const chalk = require('chalk')
const ora = require('ora')

/**
 * Esecuzione script di inizializzazione plugin
 */
class PluginInitRunner {
  constructor(logger, backupManager, stateManager) {
    this.logger = logger
    this.backupManager = backupManager
    this.stateManager = stateManager
  }

  /**
   * Esegue inizializzazione di un singolo plugin
   * @param {Object} plugin - Plugin da inizializzare
   * @param {Number} index - Indice corrente
   * @param {Number} total - Totale plugin
   * @returns {Promise<Object>} Risultato { success, error }
   */
  async runPluginInit(plugin, index, total) {
    this.logger.separator()
    console.log(`\n📦 FASE 2: Inizializzazione Plugin (${index}/${total})\n`)
    console.log(chalk.bold(`Plugin: ${plugin.name}`))
    console.log(`Descrizione: ${plugin.description}\n`)

    // Chiedi se mostrare dettagli (se disponibili)
    let initModule
    try {
      initModule = require(plugin.initScriptPath)
    } catch (error) {
      this.logger.error(`Errore caricamento script init: ${error.message}`)
      return { success: false, error: error.message }
    }

    // Mostra descrizione dettagliata se disponibile
    if (initModule.getDescription && typeof initModule.getDescription === 'function') {
      const { showDetails } = await inquirer.prompt([
        {
          type: 'list',
          name: 'showDetails',
          message: 'Vuoi vedere una descrizione dettagliata?',
          choices: [
            { name: 'No, procedi direttamente', value: false },
            { name: 'Sì, mostra dettagli', value: true }
          ],
          default: false
        }
      ])

      if (showDetails) {
        console.log('\n' + chalk.cyan(initModule.getDescription()) + '\n')
      }
    }

    // Ottieni domande dal plugin
    let questions = []
    if (initModule.getQuestions && typeof initModule.getQuestions === 'function') {
      try {
        questions = initModule.getQuestions()
      } catch (error) {
        this.logger.error(`Errore ottenimento domande: ${error.message}`)
        return { success: false, error: error.message }
      }
    }

    // Chiedi risposte all'utente
    let answers = {}
    if (questions.length > 0) {
      try {
        answers = await inquirer.prompt(questions)
      } catch (error) {
        this.logger.error(`Errore input utente: ${error.message}`)
        return { success: false, error: error.message }
      }
    }

    // Backup file se specificato
    let backupPath = null
    if (initModule.getFilesToBackup && typeof initModule.getFilesToBackup === 'function') {
      const spinner = ora('Creazione backup file esistenti...').start()

      try {
        const filesToBackup = initModule.getFilesToBackup(plugin.path)
        if (filesToBackup && filesToBackup.length > 0) {
          backupPath = this.backupManager.backupPluginFiles(plugin.name, filesToBackup)
          spinner.succeed(`Backup creato: ${backupPath}`)
        } else {
          spinner.info('Nessun file da backuppare')
        }
      } catch (error) {
        spinner.fail(`Errore backup: ${error.message}`)
        this.logger.warning('Continuo senza backup...')
      }
    }

    // Esegui inizializzazione
    const spinner = ora('Inizializzazione in corso...').start()

    try {
      if (!initModule.run || typeof initModule.run !== 'function') {
        spinner.fail('Script init non ha funzione run()')
        return { success: false, error: 'Funzione run() mancante' }
      }

      const context = {
        pathPluginFolder: plugin.path,
        logger: this.logger
      }

      const result = await initModule.run(answers, context)

      if (result.success) {
        spinner.succeed(result.message || 'Inizializzazione completata')

        // Salva stato plugin
        this.stateManager.writePluginState(plugin.path, {
          initialized: true,
          backupPath: backupPath
        })

        // Aggiorna stato globale
        this.stateManager.updatePluginState(plugin.name, {
          completed: true,
          backupPath: backupPath
        })

        return { success: true }
      } else {
        spinner.fail(result.message || 'Inizializzazione fallita')

        // Ripristina backup se disponibile
        if (backupPath) {
          const restore = await this.askRestore()
          if (restore) {
            this.backupManager.restorePlugin(plugin.name)
          }
        }

        // Salva errore nello stato
        this.stateManager.updatePluginState(plugin.name, {
          completed: false,
          error: result.message || result.error?.message || 'Errore sconosciuto',
          lastAttempt: this.stateManager.getItalianTimestamp()
        })

        return { success: false, error: result.message || result.error?.message }
      }
    } catch (error) {
      spinner.fail(`Errore durante inizializzazione: ${error.message}`)
      this.logger.error(error.stack)

      // Ripristina backup se disponibile
      if (backupPath) {
        const restore = await this.askRestore()
        if (restore) {
          this.backupManager.restorePlugin(plugin.name)
        }
      }

      // Salva errore nello stato
      this.stateManager.updatePluginState(plugin.name, {
        completed: false,
        error: error.message,
        lastAttempt: this.stateManager.getItalianTimestamp()
      })

      return { success: false, error: error.message }
    }
  }

  /**
   * Chiede se ripristinare backup dopo errore
   * @returns {Promise<Boolean>}
   */
  async askRestore() {
    const { restore } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'restore',
        message: 'Vuoi ripristinare i file dal backup?',
        default: true
      }
    ])

    return restore
  }

  /**
   * Esegue inizializzazione di tutti i plugin
   * @param {Array<Object>} plugins - Plugin da inizializzare
   * @returns {Promise<Object>} Statistiche { total, success, failed }
   */
  async runAll(plugins) {
    const stats = {
      total: plugins.length,
      success: 0,
      failed: 0,
      failedPlugins: []
    }

    for (let i = 0; i < plugins.length; i++) {
      const plugin = plugins[i]
      const result = await this.runPluginInit(plugin, i + 1, plugins.length)

      if (result.success) {
        stats.success++
      } else {
        stats.failed++
        stats.failedPlugins.push({
          name: plugin.name,
          error: result.error
        })
      }

      console.log('') // Spacing
    }

    return stats
  }
}

module.exports = PluginInitRunner
