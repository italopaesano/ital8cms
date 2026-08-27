// Questo file segue lo standard del progetto ital8cms
const inquirer = require('inquirer').default
const path = require('path')
const loadJson5 = require('../../core/loadJson5')
const setJson5Key = require('../../core/setJson5Key')
const validators = require('./validators')

/**
 * Vero per un oggetto "semplice": navigabile, cioè in cui ha senso scendere.
 * Gli array NON lo sono — vedi `collectChangedPaths`.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Confronto strutturale per valori JSON-serializzabili. */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Raccoglie i path in cui `nextObj` differisce da `liveObj`, scendendo nei
 * sotto-oggetti: sono le sole chiavi da riscrivere.
 *
 * È il gemello di `collectMissingPaths` in `core/reconcileSchemaVersion.js` —
 * stessa forma di ritorno, stesse regole di ricorsione — con l'unica differenza
 * che quello cerca le chiavi **assenti** e questo quelle **diverse**. Chi conosce
 * uno legge l'altro senza rileggerlo.
 *
 * Si ferma al primo livello che diverge: se un intero sottoalbero è nuovo, o se
 * da una parte c'è un oggetto e dall'altra uno scalare, viene riportato il path
 * di quel nodo e non le sue foglie (verrà scritto in blocco).
 *
 * Gli array sono trattati come VALORI, non come contenitori navigabili: un array
 * che cambia viene riscritto intero. È la stessa scelta di `editJson5`, che non
 * naviga negli indici, ed è il limite noto di questa strada — i commenti DENTRO
 * un array riscritto si perdono. Nessuno dei sette campi del wizard è un array,
 * quindi oggi il caso non si presenta.
 *
 * Le chiavi presenti nel file e assenti da `nextObj` **non** compaiono qui: la
 * scrittura chiave-per-chiave non sa rimuovere, e non deve — vedi `saveConfig()`.
 *
 * @param {object} nextObj - I valori da portare sul file.
 * @param {object} liveObj - I valori attualmente sul file.
 * @param {string[]} [prefix] - Path accumulato nella ricorsione.
 * @returns {Array<{segments: string[], value: *}>}
 */
function collectChangedPaths(nextObj, liveObj, prefix = []) {
  const changed = []
  for (const key of Object.keys(nextObj)) {
    const segments = [...prefix, key]
    const nextValue = nextObj[key]
    const liveValue = Object.prototype.hasOwnProperty.call(liveObj, key) ? liveObj[key] : undefined

    // Entrambi oggetti semplici → si scende, per non riscrivere in blocco (e
    // quindi appiattire) un sottoalbero di cui è cambiata una sola foglia.
    if (isPlainObject(nextValue) && isPlainObject(liveValue)) {
      changed.push(...collectChangedPaths(nextValue, liveValue, segments))
      continue
    }

    if (!deepEqual(nextValue, liveValue)) {
      changed.push({ segments, value: nextValue })
    }
  }
  return changed
}

/**
 * Wizard per configurazione globale ital8cms
 * Ripropone ital8Config.json5 e permette modifiche
 */
class ConfigWizard {
  /**
   * @param {object} logger - InitLogger
   * @param {string} [configPath] - File `ital8Config.json5` da leggere e riscrivere.
   *        Il default è quello del progetto; il parametro esiste perché i test
   *        possano lavorare su una copia in tmpdir — questo wizard **riscrive** la
   *        configurazione globale, quindi esercitarlo sul file vivo la
   *        sovrascriverebbe.
   */
  constructor(logger, configPath = path.join(__dirname, '../../ital8Config.json5')) {
    this.logger = logger
    this.configPath = configPath
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
   * Salva la configurazione scrivendo **solo le chiavi il cui valore è cambiato**,
   * una per una, con `setJson5Key`.
   *
   * PERCHÉ NON SI RISERIALIZZA IL FILE
   * ----------------------------------
   * Fino alla v3.12.0 questo metodo faceva `JSON.stringify` dell'oggetto intero e
   * riscriveva il file da capo. Funzionava — i valori erano giusti — ma
   * `ital8Config.json5` è la documentazione inline della configurazione centrale,
   * e la riserializzazione la cancellava tutta: misurato sul file reale del
   * progetto, **230 righe con commento su 340 diventavano 1**, e il file passava a
   * 115 righe. Chi eseguiva il wizard e confermava una qualsiasi modifica perdeva
   * ogni spiegazione delle chiavi, in silenzio, e non c'era modo di riaverla se
   * non ripescandola dal `.default`.
   *
   * È l'anti-pattern che CLAUDE.md vieta esplicitamente (*« Negli script preferisci
   * setJson5Key/editJson5 a un saveJson5 dell'oggetto intero: quest'ultimo perde i
   * commenti del config vivo »*) e che il resto del codice recente già rispettava:
   * `sessionKeyManager` usa `editJson5` proprio per questo motivo.
   *
   * COSA CAMBIA NEL CONTRATTO
   * -------------------------
   * Scrivere chiave per chiave significa dire « questi sono i valori che imposto »,
   * non « questo è l'intero file ». Tre conseguenze, tutte volute:
   *
   *  1. **Nulla di cambiato → nulla di scritto.** Il file non viene toccato
   *     affatto, nemmeno nel timestamp.
   *  2. **Le chiavi assenti da `config` NON vengono rimosse.** La scrittura
   *     chirurgica non sa cancellare, e non deve: il wizard chiede sette campi su
   *     una trentina, e un `saveConfig` che potasse tutto il resto sarebbe molto
   *     peggio del problema che risolve. Se ne trova, lo dice.
   *  3. **Il file deve esistere.** Prima veniva creato; ora `loadJson5` rilancia.
   *     È il comportamento giusto: un `ital8Config.json5` assente è il gate
   *     `[INIT]` del boot, non qualcosa che il wizard inventa da zero.
   *
   * @param {Object} config - I valori da portare sul file (di norma il config
   *        corrente con sopra le risposte del wizard).
   * @returns {Promise<{written: string[], unknown: string[]}>} I path scritti in
   *          notazione puntata, e le chiavi presenti sul file ma assenti da
   *          `config` (lasciate intatte).
   */
  async saveConfig(config) {
    try {
      const live = this.readOnDiskConfig()
      const changed = collectChangedPaths(config, live)

      for (const { segments, value } of changed) {
        await setJson5Key(this.configPath, segments, value)
      }

      // Chiavi che il file ha e l'oggetto no: non si toccano, ma non restano
      // nemmeno taciute — chi passa un oggetto parziale deve sapere che il resto
      // del file è ancora lì.
      const unknown = Object.keys(live).filter(
        (k) => !Object.prototype.hasOwnProperty.call(config, k)
      )
      if (unknown.length > 0) {
        this.logger.warning(
          `Chiavi presenti in ${path.basename(this.configPath)} e non nell'oggetto salvato, ` +
          `lasciate invariate: ${unknown.join(', ')}`
        )
      }

      const written = changed.map(({ segments }) => segments.join('.'))
      if (written.length === 0) {
        this.logger.info('Nessuna modifica da scrivere: configurazione già allineata')
      } else {
        this.logger.success(`Configurazione salvata (${written.join(', ')})`)
      }

      return { written, unknown }
    } catch (error) {
      this.logger.error(`Errore salvataggio configurazione: ${error.message}`)
      throw error
    }
  }

  /**
   * Rilegge il file senza loggare, per il confronto interno di `saveConfig()`.
   *
   * Separato da `readCurrentConfig()` di proposito: quello è il passo del wizard
   * che parla all'utente e logga l'errore prima di rilanciare, e riusarlo qui
   * produrrebbe due `logger.error` per lo stesso guasto.
   *
   * @returns {Object}
   */
  readOnDiskConfig() {
    return loadJson5(this.configPath)
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
        type: 'select',
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
        type: 'select',
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
    await this.saveConfig(newConfig)

    return newConfig
  }
}

module.exports = ConfigWizard
