/**
 * PATTERN MATCHER
 *
 * Sistema di pattern matching per URL con supporto per:
 * - Match esatto: "/dashboard.ejs"
 * - Wildcard singolo: "/content/*.ejs" (un livello)
 * - Wildcard ricorsivo: "/admin/**" (tutti i livelli)
 * - Regex: "regex:/api/user/\\d+" (prefisso esplicito)
 *
 * PRIORITÀ AUTOMATICA (da alta a bassa):
 * 1. Match esatto (priority: 1000)
 * 2. Regex (priority: 500)
 * 3. Wildcard singolo (priority: 300)
 * 4. Wildcard ricorsivo (priority: 100)
 *
 * Quando multiple regole matchano lo stesso URL, vince quella con priorità più alta.
 */

class PatternMatcher {
  constructor() {
    // Cache per pattern regex compilati
    this.regexCache = new Map();
  }

  /**
   * Determina il tipo di pattern e calcola priorità automatica
   * @param {string} pattern - Pattern da analizzare
   * @returns {object} - { type: string, priority: number }
   */
  getPatternInfo(pattern) {
    // Regex con prefisso esplicito
    if (pattern.startsWith('regex:')) {
      return { type: 'regex', priority: 500 };
    }

    // Wildcard ricorsivo
    if (pattern.includes('**')) {
      return { type: 'wildcard-recursive', priority: 100 };
    }

    // Wildcard singolo
    if (pattern.includes('*')) {
      return { type: 'wildcard-single', priority: 300 };
    }

    // Match esatto
    return { type: 'exact', priority: 1000 };
  }

  /**
   * Verifica se un URL matcha un pattern
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern da matchare
   * @returns {boolean} - true se match, false altrimenti
   */
  matches(url, pattern) {
    const { type } = this.getPatternInfo(pattern);

    switch (type) {
      case 'exact':
        return this.matchExact(url, pattern);

      case 'regex':
        return this.matchRegex(url, pattern);

      case 'wildcard-single':
        return this.matchWildcardSingle(url, pattern);

      case 'wildcard-recursive':
        return this.matchWildcardRecursive(url, pattern);

      default:
        return false;
    }
  }

  /**
   * Match esatto
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern esatto
   * @returns {boolean}
   */
  matchExact(url, pattern) {
    return url === pattern;
  }

  /**
   * Match con regex
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern regex con prefisso "regex:"
   * @returns {boolean}
   */
  matchRegex(url, pattern) {
    // Rimuovi prefisso "regex:"
    const regexStr = pattern.substring(6);

    // Usa cache per regex già compilati
    if (!this.regexCache.has(regexStr)) {
      try {
        this.regexCache.set(regexStr, new RegExp(regexStr));
      } catch (err) {
        // Regex invalida → già validata al boot, ma gestisci comunque
        console.error(`[PatternMatcher] Invalid regex: ${regexStr}`, err);
        return false;
      }
    }

    const regex = this.regexCache.get(regexStr);
    return regex.test(url);
  }

  /**
   * Match con wildcard singolo (*)
   * Un asterisco matcha qualsiasi carattere TRANNE '/' (non ricorsivo)
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern con *
   * @returns {boolean}
   */
  matchWildcardSingle(url, pattern) {
    // Converti pattern in regex: * → [^/]+
    const regexStr = '^' + pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape caratteri speciali regex
      .replace(/\*/g, '[^/]+') // * → uno o più caratteri tranne /
      + '$';

    const regex = new RegExp(regexStr);
    return regex.test(url);
  }

  /**
   * Match con wildcard ricorsivo (**)
   * Due asterischi matchano qualsiasi carattere incluso '/' (ricorsivo)
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern con **
   * @returns {boolean}
   */
  matchWildcardRecursive(url, pattern) {
    // Converti pattern in regex: ** → .*
    const regexStr = '^' + pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape caratteri speciali regex
      .replace(/\*\*/g, '.*') // ** → zero o più caratteri qualsiasi
      + '$';

    const regex = new RegExp(regexStr);
    return regex.test(url);
  }

  /**
   * Trova la regola con priorità più alta che matcha l'URL
   * @param {string} url - URL da testare
   * @param {object} rules - Oggetto con regole (es: { "/admin/**": {...}, "/dashboard.ejs": {...} })
   * @returns {object|null} - Regola matchata o null
   */
  findMatchingRule(url, rules) {
    let bestMatch = null;
    let highestPriority = -1;

    for (const [pattern, rule] of Object.entries(rules)) {
      if (this.matches(url, pattern)) {
        const { priority } = this.getPatternInfo(pattern);
        const rulePriority = rule.priority !== undefined ? rule.priority : priority;

        if (rulePriority > highestPriority) {
          highestPriority = rulePriority;
          bestMatch = { pattern, ...rule };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Valida un pattern (verifica sintassi corretta)
   * @param {string} pattern - Pattern da validare
   * @returns {object} - { valid: boolean, error: string|null }
   */
  validatePattern(pattern) {
    // Pattern vuoto non valido
    if (!pattern || typeof pattern !== 'string') {
      return { valid: false, error: 'Pattern must be a non-empty string' };
    }

    const { type } = this.getPatternInfo(pattern);

    // Valida regex
    if (type === 'regex') {
      const regexStr = pattern.substring(6);
      try {
        new RegExp(regexStr);
        return { valid: true, error: null };
      } catch (err) {
        return { valid: false, error: `Invalid regex: ${err.message}` };
      }
    }

    // Pattern URL non deve contenere spazi o caratteri invalidi
    if (/\s/.test(pattern)) {
      return { valid: false, error: 'Pattern cannot contain whitespace' };
    }

    return { valid: true, error: null };
  }
}

module.exports = PatternMatcher;
