// Questo file segue lo standard del progetto ital8cms
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

/**
 * Sistema di logging per script di inizializzazione
 * Log sia su console che su file con formato data italiano
 */
class InitLogger {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs')
    this.timestamp = this.getItalianTimestamp()
    this.logFile = path.join(this.logDir, `init-${this.timestamp}.log`)
    this.ensureLogDir()
  }

  /**
   * Crea directory logs se non esiste
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * Genera timestamp formato italiano: DD-MM-YYYY_HH-MM-SS
   * @returns {String} Timestamp formattato
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
   * Genera timestamp completo per log entries
   * @returns {String} Timestamp formato: DD/MM/YYYY HH:MM:SS
   */
  getLogTimestamp() {
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
   * Log generico
   * @param {String} message - Messaggio da loggare
   * @param {String} level - Livello log (INFO, SUCCESS, ERROR, WARNING)
   */
  log(message, level = 'INFO') {
    const timestamp = this.getLogTimestamp()
    const logLine = `[${timestamp}] [${level}] ${message}\n`

    // Scrivi su file
    fs.appendFileSync(this.logFile, logLine, 'utf8')

    // Console (senza timestamp, già visibile)
    console.log(message)
  }

  /**
   * Log informativo (bianco)
   */
  info(message) {
    this.log(message, 'INFO')
  }

  /**
   * Log successo (verde)
   */
  success(message) {
    const timestamp = this.getLogTimestamp()
    const logLine = `[${timestamp}] [SUCCESS] ${message}\n`
    fs.appendFileSync(this.logFile, logLine, 'utf8')
    console.log(chalk.green('✓ ' + message))
  }

  /**
   * Log errore (rosso)
   */
  error(message) {
    const timestamp = this.getLogTimestamp()
    const logLine = `[${timestamp}] [ERROR] ${message}\n`
    fs.appendFileSync(this.logFile, logLine, 'utf8')
    console.log(chalk.red('✗ ' + message))
  }

  /**
   * Log warning (giallo)
   */
  warning(message) {
    const timestamp = this.getLogTimestamp()
    const logLine = `[${timestamp}] [WARNING] ${message}\n`
    fs.appendFileSync(this.logFile, logLine, 'utf8')
    console.log(chalk.yellow('⚠ ' + message))
  }

  /**
   * Separatore visuale
   */
  separator() {
    const line = '━'.repeat(60)
    console.log(chalk.gray(line))
    fs.appendFileSync(this.logFile, line + '\n', 'utf8')
  }

  /**
   * Ottieni path del file di log corrente
   */
  getLogFilePath() {
    return this.logFile
  }
}

module.exports = InitLogger
