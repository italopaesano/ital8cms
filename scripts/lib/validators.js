// Questo file segue lo standard del progetto ital8cms

/**
 * Validatori comuni per input utente durante wizard
 */

/**
 * Solo cifre, niente altro. Gli spazi ai bordi sono tollerati (un `trim()`
 * precede il test): chi digita uno spazio di troppo non ha sbagliato il numero.
 */
const SOLE_CIFRE = /^\d+$/

/**
 * Spiega perché un input numerico è stato rifiutato, mostrando — quando è
 * significativo — il valore in cui `parseInt` lo avrebbe silenziosamente
 * trasformato.
 *
 * Il « sarebbe diventato » è la parte che conta: senza, il messaggio dice che
 * l'input è sbagliato; con, dice **quale danno** stava per fare. `3000abc` non
 * sembra pericoloso finché non si legge che il sito sarebbe partito su 3000
 * senza dirlo, e `1e4` — che uno legge come diecimila — sarebbe diventato 1.
 *
 * @param {string} etichetta - Come chiamare il valore nel messaggio (es. "porta")
 * @param {*} value - L'input rifiutato, così come digitato
 * @returns {string}
 */
function spiegaNonNumerico(etichetta, value) {
  const raw = String(value ?? '').trim()
  const troncato = parseInt(raw)
  // La frase si aggiunge SOLO se il parse aveva davvero scartato qualcosa senza
  // dirlo. Su `-1` parseInt restituisce -1 — niente di silenzioso è accaduto, e
  // il vecchio codice l'avrebbe comunque respinto per il range: annunciare
  // « sarebbe diventato -1 » spaventerebbe per un pericolo che non c'era.
  const troncamentoSilenzioso = Number.isFinite(troncato) && String(troncato) !== raw
  const conseguenza = troncamentoSilenzioso ? ` Scritto così sarebbe diventato ${troncato}.` : ''
  return `"${value}" non è ${etichetta}: usa solo cifre (0-9), senza lettere, punti o segni.${conseguenza}`
}

const validators = {
  /**
   * Valida porta TCP.
   *
   * ⚠ IL TEST SULLE SOLE CIFRE VIENE PRIMA DEL PARSE, ed è il punto.
   * Fino alla v3.15.0 il validatore faceva `parseInt(value)` e si limitava a
   * controllare il risultato: `parseInt` però **tronca al primo carattere non
   * numerico** invece di fallire, quindi `"3000abc"` valeva 3000, `"3000.9"`
   * valeva 3000 e `"1e4"` — che chiunque legge come diecimila — valeva **1**.
   * Il wizard accettava, `filter: (v) => parseInt(v)` scriveva il valore
   * troncato in `ital8Config.json5`, e la porta finita nel config **non era
   * quella digitata**. Nessuno lo segnalava.
   *
   * L'ordine filter/validate è stato verificato sul sorgente di inquirer 14
   * (`dist/ui/prompt.js`: `promptFn(...).then((answer) => ({ answer: filter(answer) }))`):
   * il filtro è applicato DOPO che il prompt ha risolto, quindi `validate`
   * riceve la stringa grezza e questo guard morde davvero. Se un domani
   * l'ordine si invertisse, `validate` riceverebbe già un numero e il guard
   * diventerebbe inutile — è presidiato in
   * `tests/unit/scripts/validators.test.js`.
   */
  port: (value) => {
    const raw = String(value ?? '').trim()
    if (raw === '') return 'La porta è obbligatoria'
    if (!SOLE_CIFRE.test(raw)) return spiegaNonNumerico('una porta valida', value)
    const port = Number(raw)
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
   * Valida numero intero positivo (zero incluso).
   *
   * Stesso guard di `port()` e per la stessa ragione: `parseInt` tronca invece
   * di fallire. Il difetto era identico — `"3.7"` valeva 3, `"5xyz"` valeva 5 —
   * ed è stato chiuso insieme all'altro nella v3.15.0. Questo validatore **non
   * ha chiamanti** nel repo (censimento in `validators.test.js`), quindi la
   * correzione non cambia nulla oggi: serve a non lasciare in piedi la stessa
   * trappola per il primo che lo userà.
   */
  positiveInteger: (value) => {
    const raw = String(value ?? '').trim()
    if (raw === '') return 'Campo obbligatorio'
    // Il segno meno è respinto da SOLE_CIFRE, ma merita il suo messaggio: chi
    // scrive "-1" ha capito il formato e sbagliato il valore, ed è un'altra cosa.
    if (/^-\d+$/.test(raw)) return 'Deve essere un numero positivo'
    if (!SOLE_CIFRE.test(raw)) return spiegaNonNumerico('un numero intero', value)
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
