#!/usr/bin/env node
// Questo file segue lo standard del progetto ital8cms

/**
 * Script di inizializzazione globale ital8cms
 * Wizard interattivo per configurazione iniziale e setup plugin
 */

const inquirer = require('inquirer').default
const path = require('path')

// Import moduli
const InitLogger = require('./lib/logger')
const ConfigWizard = require('./lib/configWizard')
const PluginScanner = require('./lib/pluginScanner')
const PluginInitRunner = require('./lib/pluginInitRunner')
const StateManager = require('./lib/stateManager')
const BackupManager = require('./lib/backupManager')
const materializeFromDefault = require('../core/materializeFromDefault')

/**
 * Banner di benvenuto
 */
function showWelcomeBanner() {
  console.log('\n┌─────────────────────────────────────────────────┐')
  console.log('│                                                 │')
  console.log('│   🚀 ital8cms - Setup Wizard                    │')
  console.log('│                                                 │')
  console.log('│   Questo wizard ti guiderà nella configurazione │')
  console.log('│   iniziale del sistema.                         │')
  console.log('│                                                 │')
  console.log('└─────────────────────────────────────────────────┘\n')
}

/**
 * Gestione re-inizializzazione
 */
async function handleReinit(stateManager, logger) {
  const state = stateManager.readGlobalState()

  if (!state) {
    return { shouldContinue: true, reinitType: null }
  }

  logger.separator()
  console.log('\n⚠️  Inizializzazione Esistente Rilevata\n')
  console.log(`ital8cms risulta già inizializzato:`)
  console.log(`  Data: ${state.initDate}\n`)

  console.log('Stato:')
  if (state.global && state.global.completed) {
    console.log('  • Configurazione globale: ✓ completata')
  }

  if (state.plugins && Object.keys(state.plugins).length > 0) {
    const pluginCount = Object.keys(state.plugins).length
    const completedCount = Object.values(state.plugins).filter(p => p.completed).length
    console.log(`  • Plugin inizializzati: ${completedCount}/${pluginCount}`)

    for (const [name, pluginState] of Object.entries(state.plugins)) {
      if (pluginState.completed) {
        console.log(`    - ${name}: ✓ (${pluginState.initDate})`)
      } else {
        console.log(`    - ${name}: ✗ ${pluginState.error ? '(' + pluginState.error + ')' : ''}`)
      }
    }
  }

  console.log('')
  logger.separator()
  console.log('')

  const { action } = await inquirer.prompt([
    {
      type: 'select',
      name: 'action',
      message: 'Cosa vuoi fare?',
      choices: [
        { name: 'Annulla (mantieni configurazione esistente)', value: 'cancel' },
        { name: 'Re-inizializza solo configurazione globale', value: 'global' },
        { name: 'Re-inizializza solo plugin specifici', value: 'plugins' },
        { name: 'Re-inizializza tutto (⚠️  ATTENZIONE: sovrascrive dati!)', value: 'all' }
      ],
      default: 'cancel'
    }
  ])

  if (action === 'cancel') {
    logger.info('Inizializzazione annullata')
    return { shouldContinue: false, reinitType: null }
  }

  // Conferma per azioni distruttive
  if (action === 'all' || action === 'global' || action === 'plugins') {
    console.log('\n⚠️  ATTENZIONE: La re-inizializzazione sovrascriverà i dati esistenti.')
    console.log('Verrà creato un backup automatico.\n')

    const { confirm } = await inquirer.prompt([
      {
        type: 'select',
        name: 'confirm',
        message: 'Sei sicuro di voler procedere?',
        choices: [
          { name: 'No, annulla', value: false },
          { name: 'Sì, procedi con re-inizializzazione', value: true }
        ],
        default: false
      }
    ])

    if (!confirm) {
      logger.info('Re-inizializzazione annullata')
      return { shouldContinue: false, reinitType: null }
    }
  }

  return { shouldContinue: true, reinitType: action }
}

/**
 * Scelta del profilo di installazione.
 *   - production: flusso standard (utente root creato da terminale, www vuota)
 *   - demo:       CMS pre-popolato con utenti/contenuti di esempio (solo per provare)
 * @returns {Promise<'production'|'demo'>}
 */
async function askInstallProfile() {
  const { profile } = await inquirer.prompt([
    {
      type: 'select',
      name: 'profile',
      message: 'Quale profilo di installazione vuoi?',
      choices: [
        { name: 'Production — installazione pulita (utente root da terminale, www vuota)', value: 'production' },
        { name: 'Demo — CMS pre-popolato per provare il sistema (utenti e www di esempio)', value: 'demo' }
      ],
      default: 'production'
    }
  ])

  if (profile === 'demo') {
    console.log('\n⚠️  PROFILO DEMO — solo esplorazione/sviluppo, NON usare in produzione.')
    console.log('   Utenti di esempio con password condivisa e nota: "demomode".\n')
  }

  return profile
}

/**
 * Funzione principale
 */
async function main() {
  // Inizializza logger
  const logger = new InitLogger()
  logger.info('Avvio wizard di inizializzazione ital8cms')

  // Mostra banner
  showWelcomeBanner()

  // Scelta profilo di installazione (production | demo)
  const installProfile = await askInstallProfile()

  // Inizializza manager
  const stateManager = new StateManager(logger)
  const backupManager = new BackupManager(logger)
  const configWizard = new ConfigWizard(logger)
  const pluginScanner = new PluginScanner(logger)

  // Gestione re-inizializzazione
  const { shouldContinue, reinitType } = await handleReinit(stateManager, logger)

  if (!shouldContinue) {
    logger.info('Wizard terminato')
    console.log('')
    process.exit(0)
  }

  // Reset stato se re-inizializzazione completa
  if (reinitType === 'all') {
    stateManager.resetGlobalState()
  }

  try {
    // FASE 1: Configurazione globale
    let shouldConfigureGlobal = true

    if (reinitType === 'plugins') {
      shouldConfigureGlobal = false
    }

    let finalConfig = null

    if (shouldConfigureGlobal) {
      // Materializza i config core mancanti dai rispettivi .default. In un clone
      // fresco i vivi (ital8Config/koaSession/adminConfig) sono git-ignored e
      // assenti: il wizard li crea dai default, poi li configura (config-lifecycle §5).
      const projectRoot = path.join(__dirname, '..')
      const coreConfigs = [
        ['ital8Config.default.json5', 'ital8Config.json5'],
        ['core/priorityMiddlewares/koaSession.default.json5', 'core/priorityMiddlewares/koaSession.json5'],
        ['core/admin/adminConfig.default.json5', 'core/admin/adminConfig.json5'],
      ]
      for (const [def, live] of coreConfigs) {
        const res = await materializeFromDefault(path.join(projectRoot, def), path.join(projectRoot, live))
        if (res.created) logger.success(`Config core materializzato dal default: ${live}`)
      }

      // Backup configurazione esistente
      const configPath = path.join(__dirname, '../ital8Config.json5')
      backupManager.backupGlobalFile(configPath)

      // Esegui wizard configurazione
      finalConfig = await configWizard.run()

      // Gestione chiavi di sessione (sicurezza: firma dei cookie koa-session).
      // Step indipendente dalla domanda "vuoi modificare le impostazioni?":
      // i placeholder committati nel repo vanno sempre proposti per la rotazione.
      const sessionKeyManager = require('./lib/sessionKeyManager')
      const koaSessionPath = path.join(__dirname, '../core/priorityMiddlewares/koaSession.json5')
      await sessionKeyManager.configureSessionKeys({ logger, backupManager, configPath: koaSessionPath })

      // Aggiorna stato globale
      stateManager.updateGlobalState({
        initialized: true,
        global: {
          completed: true,
          configModified: true,
          backupPath: backupManager.getBackupPath()
        }
      })

      logger.success('Configurazione globale completata')
    }

    // ─── RAMO DEMO ──────────────────────────────────────────────────────────
    // Profilo demo: NIENTE init di produzione (niente root da terminale).
    // Copia i file seed (*.demo.json5 + .demoData/) e invoca gli hook seedDemo(),
    // poi attiva il flag demo in ital8Config.json5.
    if (installProfile === 'demo') {
      logger.separator()
      console.log('\n🌱 FASE 2 (demo): seeding contenuti di esempio\n')

      const DemoSeeder = require('./lib/demoSeeder')
      const demoSeeder = new DemoSeeder(logger)
      await demoSeeder.run()

      try {
        const editJson5 = require('../core/editJson5')
        await editJson5(path.join(__dirname, '../ital8Config.json5'), 'demo', true)
        logger.success('Profilo demo attivato: demo=true in ital8Config.json5')
      } catch (e) {
        logger.warning(`Impossibile impostare demo=true: ${e.message}`)
      }
    }

    // ─── RAMO PRODUCTION ────────────────────────────────────────────────────
    // Flusso standard: inizializzazione interattiva dei plugin (es. root da terminale).
    if (installProfile !== 'demo') {
    // Assicura che il flag demo sia spento in un'installazione di produzione
    try {
      const editJson5 = require('../core/editJson5')
      await editJson5(path.join(__dirname, '../ital8Config.json5'), 'demo', false)
    } catch (e) {
      logger.warning(`Impossibile impostare demo=false: ${e.message}`)
    }

    // FASE 2: Inizializzazione plugin
    logger.separator()
    console.log('\n🔍 Scansione plugin con script di inizializzazione...\n')

    const plugins = pluginScanner.getPluginsForInit()

    if (plugins.length === 0) {
      logger.info('Nessun plugin richiede inizializzazione')
    } else {
      console.log(`Trovati ${plugins.length} plugin che richiedono inizializzazione:\n`)

      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]
        const depString = plugin.dependencies.length > 0
          ? ` (dipende da: ${plugin.dependencies.join(', ')})`
          : ' (nessuna dipendenza)'

        console.log(`  ${i + 1}. ${plugin.name}${depString}`)
      }

      console.log('')

      let shouldInitPlugins = true
      let selectedPlugins = plugins

      if (reinitType === 'plugins') {
        // Scelta manuale plugin da re-inizializzare
        const { pluginsToReinit } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'pluginsToReinit',
            message: 'Seleziona plugin da re-inizializzare:',
            choices: plugins.map(p => ({ name: p.name, value: p.name }))
          }
        ])

        if (pluginsToReinit.length === 0) {
          shouldInitPlugins = false
        } else {
          selectedPlugins = plugins.filter(p => pluginsToReinit.includes(p.name))

          // Reset stato per plugin selezionati
          for (const plugin of selectedPlugins) {
            stateManager.resetPluginState(plugin.path)
          }
        }
      } else {
        // Prima inizializzazione o re-init completo
        const { initChoice } = await inquirer.prompt([
          {
            type: 'select',
            name: 'initChoice',
            message: 'Vuoi procedere con l\'inizializzazione dei plugin?',
            choices: [
              { name: 'Sì, inizializza tutti', value: 'all' },
              { name: 'Sì, ma scegli manualmente quali', value: 'manual' },
              { name: 'No, salta inizializzazione plugin', value: 'skip' }
            ],
            default: 'all'
          }
        ])

        if (initChoice === 'skip') {
          shouldInitPlugins = false
        } else if (initChoice === 'manual') {
          const { selectedNames } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selectedNames',
              message: 'Seleziona plugin da inizializzare:',
              choices: plugins.map(p => ({
                name: `${p.name} - ${p.description}`,
                value: p.name,
                checked: true
              }))
            }
          ])

          if (selectedNames.length === 0) {
            shouldInitPlugins = false
          } else {
            selectedPlugins = plugins.filter(p => selectedNames.includes(p.name))
          }
        }
      }

      if (shouldInitPlugins) {
        const runner = new PluginInitRunner(logger, backupManager, stateManager)
        const stats = await runner.runAll(selectedPlugins)

        // Riepilogo finale plugin
        logger.separator()
        console.log('\n📊 Riepilogo Inizializzazione Plugin:\n')
        console.log(`  Plugin totali: ${stats.total}`)
        console.log(`  Successi: ${stats.success}`)
        console.log(`  Fallimenti: ${stats.failed}\n`)

        if (stats.failed > 0) {
          console.log('Plugin falliti:')
          for (const failed of stats.failedPlugins) {
            console.log(`  • ${failed.name}: ${failed.error}`)
          }
          console.log('')
        }
      }
    }

    } // fine RAMO PRODUCTION (installProfile !== 'demo')

    // FASE 3: Riepilogo finale
    logger.separator()
    console.log('\n🎉 Inizializzazione Completata!\n')

    const state = stateManager.readGlobalState()

    console.log('Riepilogo:')
    if (state.global && state.global.completed) {
      console.log('  ✓ Configurazione globale: completata')
    }

    if (state.plugins && Object.keys(state.plugins).length > 0) {
      const completedPlugins = Object.entries(state.plugins).filter(([_, p]) => p.completed)
      console.log(`  ✓ Plugin inizializzati: ${completedPlugins.length}/${Object.keys(state.plugins).length}`)

      for (const [name, _] of completedPlugins) {
        console.log(`    • ${name}: ✓`)
      }
    }

    console.log('\nFile creati:')
    console.log(`  • scripts/initState.json5`)
    console.log(`  • ${logger.getLogFilePath()}`)

    console.log('\nBackup salvati in:')
    console.log(`  • ${backupManager.getBackupPath()}`)

    logger.separator()
    console.log('\nProssimi passi:\n')
    console.log('  1. Avvia il server:')
    console.log('     npm start\n')
    console.log('  2. Accedi al pannello admin:')
    console.log(`     http://localhost:${finalConfig?.httpPort || 3000}/admin\n`)

    if (installProfile === 'demo') {
      console.log('  3. Login con un utente demo (password unica: "demomode"):')
      console.log('     demoRoot · demoAdmin · demoEditor · demoSelfEditor')
      console.log('     demoContentModerator · demoNewsletterEditor\n')
      console.log('  ⚠️  Profilo DEMO attivo — NON usare in produzione.\n')
    } else if (state.plugins && state.plugins.adminUsers && state.plugins.adminUsers.completed) {
      console.log('  3. Login con le credenziali create\n')
    }

    logger.separator()

    logger.success('Wizard completato con successo')
    console.log('')

  } catch (error) {
    logger.error(`Errore fatale: ${error.message}`)
    logger.error(error.stack)
    console.log('')
    process.exit(1)
  }
}

// Avvio script
// .catch() di sicurezza: il try/catch interno di main() copre la FASE 1 in poi,
// ma non la parte iniziale (askInstallProfile/handleReinit). Senza questo, una
// loro rejection sarebbe una unhandledRejection. Qui: messaggio chiaro + exit 1.
main().catch((error) => {
  console.error(`[init] Errore fatale durante l'inizializzazione: ${error && error.stack ? error.stack : error}`)
  process.exit(1)
})
