// Questo file segue lo standard del progetto ital8cms

/**
 * Validatori comuni per input utente durante wizard
 */
const validators = {
  /**
   * Valida porta TCP
   */
  port: (value) => {
    const port = parseInt(value)
    if (isNaN(port)) return 'La porta deve essere un numero'
    if (port < 1 || port > 65535) return 'Porta deve essere tra 1 e 65535'
    return true
  },

  /**
   * Valida valore booleano
   */
  boolean: (value) => {
    const normalizedValue = String(value).toLowerCase()
    if (!['true', 'false', 'yes', 'no', '1', '0'].includes(normalizedValue)) {
      return 'Valore deve essere: true/false, yes/no, 1/0'
    }
    return true
  },

  /**
   * Converte stringa in booleano
   */
  toBoolean: (value) => {
    const normalizedValue = String(value).toLowerCase()
    return ['true', 'yes', '1'].includes(normalizedValue)
  },

  /**
   * Valida email
   */
  email: (value) => {
    if (!value || value.trim() === '') return 'Email obbligatoria'
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(value) || 'Formato email non valido'
  },

  /**
   * Valida username
   */
  username: (value) => {
    if (!value || value.trim() === '') return 'Username obbligatorio'
    if (value.length < 3) return 'Username troppo corto (minimo 3 caratteri)'
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      return 'Username può contenere solo lettere, numeri, underscore (_) e trattino (-)'
    }
    return true
  },

  /**
   * Valida password
   */
  password: (value) => {
    if (!value || value.trim() === '') return 'Password obbligatoria'
    if (value.length < 8) return 'Password troppo corta (minimo 8 caratteri)'
    if (!/[A-Z]/.test(value)) return 'Password deve contenere almeno una lettera maiuscola'
    if (!/[a-z]/.test(value)) return 'Password deve contenere almeno una lettera minuscola'
    if (!/[0-9]/.test(value)) return 'Password deve contenere almeno un numero'
    return true
  },

  /**
   * Valida stringa non vuota
   */
  required: (value) => {
    if (!value || value.trim() === '') return 'Campo obbligatorio'
    return true
  },

  /**
   * Valida numero intero positivo
   */
  positiveInteger: (value) => {
    const num = parseInt(value)
    if (isNaN(num)) return 'Deve essere un numero'
    if (num < 0) return 'Deve essere un numero positivo'
    return true
  },

  /**
   * Valida path directory
   */
  directoryPath: (value) => {
    if (!value || value.trim() === '') return 'Path obbligatorio'
    // Controllo base caratteri validi
    if (!/^[a-zA-Z0-9_\-/.]+$/.test(value)) {
      return 'Path contiene caratteri non validi'
    }
    return true
  },

  /**
   * Valida prefix API (nessun slash, solo alfanumerici)
   */
  apiPrefix: (value) => {
    if (!value || value.trim() === '') return 'Prefix obbligatorio'
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      return 'Prefix può contenere solo lettere, numeri, underscore e trattino'
    }
    if (value.includes('/')) return 'Prefix non può contenere slash (/)'
    return true
  }
}

module.exports = validators
