// Questo file segue lo standard del progetto ital8cms
const inquirer = require('inquirer')
const fs = require('fs')
const path = require('path')
const loadJson5 = require('../../core/loadJson5')
const validators = require('./validators')

/**
 * Wizard per configurazione globale ital8cms
 * Ripropone ital8Config.json5 e permette modifiche
 */
class ConfigWizard {
  constructor(logger) {
    this.logger = logger
    this.configPath = path.join(__dirname, '../../ital8Config.json5')
  }

  /**
   * Legge configurazione corrente
   * @returns {Object}
   */
  readCurrentConfig() {
    try {
      return loadJson5(this.configPath)
    } catch (error) {
      this.logger.error(`Errore lettura configurazione: ${error.message}`)
      throw error
    }
  }

  /**
   * Salva configurazione
   * @param {Object} config - Nuova configurazione
   */
  saveConfig(config) {
    const content = `// This file follows the JSON5 standard - comments and trailing commas are supported
${JSON.stringify(config, null, 2)}`

    try {
      fs.writeFileSync(this.configPath, content, 'utf8')
      this.logger.success('Configurazione salvata')
    } catch (error) {
      this.logger.error(`Errore salvataggio configurazione: ${error.message}`)
      throw error
    }
  }

  /**
   * Esegue wizard configurazione
   * @returns {Promise<Object>} Configurazione finale
   */
  async run() {
    this.logger.separator()
    console.log('\n⚙️  FASE 1: Configurazione Globale\n')

    const currentConfig = this.readCurrentConfig()

    console.log('Configurazione attuale in ital8Config.json5:\n')
    console.log(`  • apiPrefix: "${currentConfig.apiPrefix}"`)
    console.log(`  • adminPrefix: "${currentConfig.adminPrefix}"`)
    console.log(`  • enableAdmin: ${currentConfig.enableAdmin}`)
    console.log(`  • httpPort: ${currentConfig.httpPort}`)
    console.log(`  • debugMode: ${currentConfig.debugMode}`)
    console.log(`  • activeTheme: "${currentConfig.activeTheme}"`)
    console.log(`  • adminActiveTheme: "${currentConfig.adminActiveTheme}"`)
    console.log('')

    const { shouldModify } = await inquirer.prompt([
      {
        type: 'list',
        name: 'shouldModify',
        message: 'Vuoi modificare qualche impostazione?',
        choices: [
          { name: 'No, mantieni configurazione attuale', value: false },
          { name: 'Sì, modifica impostazioni', value: true }
        ],
        default: false
      }
    ])

    if (!shouldModify) {
      this.logger.info('Configurazione mantenuta invariata')
      return currentConfig
    }

    // Chiedi quali impostazioni modificare
    const { fieldsToModify } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'fieldsToModify',
        message: 'Seleziona le impostazioni da modificare:',
        choices: [
          { name: 'apiPrefix (prefisso route API)', value: 'apiPrefix' },
          { name: 'adminPrefix (prefisso route admin)', value: 'adminPrefix' },
          { name: 'enableAdmin (abilita pannello admin)', value: 'enableAdmin' },
          { name: 'httpPort (porta HTTP)', value: 'httpPort' },
          { name: 'debugMode (modalità debug)', value: 'debugMode' },
          { name: 'activeTheme (tema pubblico)', value: 'activeTheme' },
          { name: 'adminActiveTheme (tema admin)', value: 'adminActiveTheme' }
        ]
      }
    ])

    if (fieldsToModify.length === 0) {
      this.logger.info('Nessuna modifica selezionata')
      return currentConfig
    }

    // Costruisci domande per i campi selezionati
    const questions = []

    if (fieldsToModify.includes('apiPrefix')) {
      questions.push({
        type: 'input',
        name: 'apiPrefix',
        message: 'Prefisso route API (es. "api"):',
        default: currentConfig.apiPrefix,
        validate: validators.apiPrefix
      })
    }

    if (fieldsToModify.includes('adminPrefix')) {
      questions.push({
        type: 'input',
        name: 'adminPrefix',
        message: 'Prefisso route admin (es. "admin"):',
        default: currentConfig.adminPrefix,
        validate: validators.apiPrefix
      })
    }

    if (fieldsToModify.includes('enableAdmin')) {
      questions.push({
        type: 'confirm',
        name: 'enableAdmin',
        message: 'Abilitare pannello admin?',
        default: currentConfig.enableAdmin
      })
    }

    if (fieldsToModify.includes('httpPort')) {
      questions.push({
        type: 'input',
        name: 'httpPort',
        message: 'Porta HTTP:',
        default: currentConfig.httpPort,
        validate: validators.port,
        filter: (value) => parseInt(value)
      })
    }

    if (fieldsToModify.includes('debugMode')) {
      questions.push({
        type: 'list',
        name: 'debugMode',
        message: 'Modalità debug:',
        choices: [
          { name: 'Disabilitata (0)', value: 0 },
          { name: 'Abilitata (1)', value: 1 }
        ],
        default: currentConfig.debugMode
      })
    }

    if (fieldsToModify.includes('activeTheme')) {
      questions.push({
        type: 'input',
        name: 'activeTheme',
        message: 'Tema pubblico:',
        default: currentConfig.activeTheme,
        validate: validators.required
      })
    }

    if (fieldsToModify.includes('adminActiveTheme')) {
      questions.push({
        type: 'input',
        name: 'adminActiveTheme',
        message: 'Tema admin:',
        default: currentConfig.adminActiveTheme,
        validate: validators.required
      })
    }

    // Esegui domande
    const answers = await inquirer.prompt(questions)

    // Merge con configurazione esistente
    const newConfig = {
      ...currentConfig,
      ...answers
    }

    // Mostra riepilogo modifiche
    console.log('\n📝 Modifiche da applicare:\n')
    for (const field of fieldsToModify) {
      if (currentConfig[field] !== newConfig[field]) {
        console.log(`  • ${field}: ${currentConfig[field]} → ${newConfig[field]}`)
      }
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confermi le modifiche?',
        default: true
      }
    ])

    if (!confirm) {
      this.logger.info('Modifiche annullate, mantenuta configurazione corrente')
      return currentConfig
    }

    // Salva nuova configurazione
    this.saveConfig(newConfig)

    return newConfig
  }
}

module.exports = ConfigWizard
