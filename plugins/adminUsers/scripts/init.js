// Questo file segue lo standard del progetto ital8cms

/**
 * Script di inizializzazione plugin adminUsers
 * Crea il primo utente root del sistema
 */

const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const loadJson5 = require('../../../core/loadJson5')

/**
 * Validatori specifici per adminUsers
 */
const validators = {
  username: (value) => {
    if (!value || value.trim() === '') return 'Username obbligatorio'
    if (value.length < 3) return 'Username troppo corto (minimo 3 caratteri)'
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      return 'Username può contenere solo lettere, numeri, underscore (_) e trattino (-)'
    }
    return true
  },

  email: (value) => {
    if (!value || value.trim() === '') return 'Email obbligatoria'
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(value) || 'Formato email non valido'
  },

  password: (value) => {
    if (!value || value.trim() === '') return 'Password obbligatoria'
    if (value.length < 8) return 'Password troppo corta (minimo 8 caratteri)'
    if (!/[A-Z]/.test(value)) return 'Password deve contenere almeno una lettera maiuscola (premi "?" per info)'
    if (!/[a-z]/.test(value)) return 'Password deve contenere almeno una lettera minuscola'
    if (!/[0-9]/.test(value)) return 'Password deve contenere almeno un numero'
    return true
  }
}

/**
 * Domande per inquirer
 */
function getQuestions() {
  return [
    {
      type: 'input',
      name: 'username',
      message: 'Username utente root (premi "?" per info):',
      default: 'admin',
      validate: validators.username
    },
    {
      type: 'input',
      name: 'email',
      message: 'Email utente root (premi "?" per info):',
      validate: validators.email
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password utente root (premi "?" per info):',
      mask: '*',
      validate: validators.password
    },
    {
      type: 'password',
      name: 'confirmPassword',
      message: 'Conferma password:',
      mask: '*',
      validate: (value, answers) => {
        if (value !== answers.password) {
          return 'Le password non coincidono'
        }
        return true
      }
    }
  ]
}

/**
 * Descrizione dettagliata (opzionale)
 */
function getDescription() {
  return `
╔══════════════════════════════════════════════════════════════╗
║  Inizializzazione Plugin adminUsers                          ║
╚══════════════════════════════════════════════════════════════╝

Questo script crea il primo utente root del sistema.
L'utente root ha accesso completo a tutte le funzionalità admin
con roleId 0 (massimi privilegi).

Informazioni richieste:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Username: identificativo univoco (minimo 3 caratteri)
  - Solo lettere, numeri, underscore (_) e trattino (-)
  - Esempio: admin, root, amministratore

• Email: indirizzo email valido
  - Utilizzato per recupero password e notifiche
  - Esempio: admin@tuodominio.com

• Password: password sicura (minimo 8 caratteri)
  - Deve contenere: maiuscole, minuscole, numeri
  - Esempio: Admin123! (NON utilizzare password banali!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  IMPORTANTE: Annota le credenziali in un luogo sicuro!
  `.trim()
}

/**
 * File da backuppare prima dell'init
 */
function getFilesToBackup(pathPluginFolder) {
  return [
    path.join(pathPluginFolder, 'userAccount.json5'),
    path.join(pathPluginFolder, 'userRole.json5')
  ]
}

/**
 * Esegue l'inizializzazione
 */
async function run(answers, context) {
  const { pathPluginFolder, logger } = context

  try {
    logger.info(`Creazione utente root: ${answers.username}`)

    // Path file
    const userAccountPath = path.join(pathPluginFolder, 'userAccount.json5')
    const userRolePath = path.join(pathPluginFolder, 'userRole.json5')

    // Leggi file esistenti o crea struttura vuota
    let userAccounts = { users: {} }
    let userRoles = {}

    if (fs.existsSync(userAccountPath)) {
      try {
        userAccounts = loadJson5(userAccountPath)
        // Assicura che esista la chiave "users"
        if (!userAccounts.users) {
          userAccounts.users = {}
        }
      } catch (error) {
        logger.warning('File userAccount.json5 corrotto, creo nuovo file')
        userAccounts = { users: {} }
      }
    }

    if (fs.existsSync(userRolePath)) {
      try {
        userRoles = loadJson5(userRolePath)
      } catch (error) {
        logger.warning('File userRole.json5 corrotto, creo nuovo file')
        userRoles = { roles: {} }
      }
    }

    // Verifica se username già esistente
    if (userAccounts.users[answers.username]) {
      return {
        success: false,
        message: `Username "${answers.username}" già esistente. Utilizza un altro username o elimina l'utente esistente.`
      }
    }

    // Hash password
    logger.info('Generazione hash password...')
    const hashedPassword = await bcrypt.hash(answers.password, 10)

    // Crea utente root (con struttura corretta usando "users")
    userAccounts.users[answers.username] = {
      email: answers.email,
      hashPassword: hashedPassword,
      roleIds: [0] // Root role (roleId 0 = massimi privilegi)
    }

    // Assicurati che i ruoli hardcoded esistano
    if (!userRoles.roles) {
      userRoles.roles = {}
    }

    // Aggiungi/aggiorna ruoli hardcoded se non esistono
    const hardcodedRoles = {
      "0": {
        "name": "root",
        "description": "Accesso completo al sistema, incluse operazioni critiche",
        "isHardcoded": true
      },
      "1": {
        "name": "admin",
        "description": "Accesso completo a tutte le risorse admin",
        "isHardcoded": true
      },
      "2": {
        "name": "editor",
        "description": "Può creare, leggere, aggiornare ed eliminare TUTTI i contenuti",
        "isHardcoded": true
      },
      "3": {
        "name": "selfEditor",
        "description": "Può creare, leggere, aggiornare ed eliminare SOLO i propri contenuti",
        "isHardcoded": true
      }
    }

    for (const [roleId, roleData] of Object.entries(hardcodedRoles)) {
      if (!userRoles.roles[roleId]) {
        userRoles.roles[roleId] = roleData
      }
    }

    // Salva file userAccount.json5
    const userAccountContent = `// This file follows the JSON5 standard - comments and trailing commas are supported
${JSON.stringify(userAccounts, null, 2)}`

    fs.writeFileSync(userAccountPath, userAccountContent, 'utf8')
    logger.info('File userAccount.json5 aggiornato')

    // Salva file userRole.json5
    const userRoleContent = `// This file follows the JSON5 standard - comments and trailing commas are supported
${JSON.stringify(userRoles, null, 2)}`

    fs.writeFileSync(userRolePath, userRoleContent, 'utf8')
    logger.info('File userRole.json5 aggiornato')

    return {
      success: true,
      message: `Utente root "${answers.username}" creato con successo! RoleId: 0 (root)`,
      data: {
        rootUserCreated: true,
        rootUsername: answers.username
      }
    }
  } catch (error) {
    logger.error(`Errore durante creazione utente: ${error.message}`)

    return {
      success: false,
      message: `Errore durante creazione utente: ${error.message}`,
      error: error
    }
  }
}

// Export interfaccia
module.exports = {
  getQuestions,
  getDescription,
  getFilesToBackup,
  run
}
