/**
 * PATTERN MATCHER — Utility di sistema per URL pattern matching
 *
 * Modulo condiviso del core di ital8cms per il matching di URL con supporto per:
 * - Match esatto: "/dashboard.ejs"
 * - Wildcard singolo: "/content/*.ejs" (un livello, non matcha '/')
 * - Wildcard ricorsivo: "/admin/**" (tutti i livelli, matcha anche '/')
 * - Regex: "regex:^/api/user/\\d+$" (prefisso esplicito "regex:")
 *
 * ─── LE REGEX SONO ANCORATE (v3.43.0, REVIEW.md → A4) ────────────────────────
 * Il corpo di un `regex:` è compilato come `^(?:corpo)$`: descrive il path
 * INTERO, non una sua sottostringa. Prima non lo era, e `RegExp.test()` senza
 * ancoraggi è un match di sottostringa: `regex:/admin/users` non significava
 * « il path /admin/users » ma « qualunque path che CONTENGA /admin/users »,
 * quindi matchava anche `/public/admin/users`. In un modulo che serve a
 * PROTEGGERE URL, una regola che matcha l'insieme sbagliato è il guasto
 * peggiore possibile.
 *
 * Conseguenza per chi scrive le regole: per cercare « dovunque » ora servono i
 * `.*` ESPLICITI, anteposti al path. Gli ancoraggi scritti a mano nel corpo
 * restano ammessi e innocui (`^(?:^/admin$)$` funziona).
 *
 * PRIORITÀ AUTOMATICA (da alta a bassa):
 * 1. Match esatto (priority: 1000)
 * 2. Regex (priority: 500)
 * 3. Wildcard singolo (priority: 300)
 * 4. Wildcard ricorsivo (priority: 100)
 *
 * Quando multiple regole matchano lo stesso URL, vince quella con priorità più alta.
 * Se una regola specifica un campo "priority" esplicito, quello prevale sulla priorità automatica.
 *
 * UTILIZZO:
 *
 *   const PatternMatcher = require('../core/patternMatcher');
 *   const matcher = new PatternMatcher();
 *
 *   // Verifica se un URL matcha un pattern
 *   matcher.matches('/admin/users', '/admin/**'); // true
 *
 *   // Trova la regola con priorità più alta che matcha
 *   const rules = {
 *     "/admin/**": { robots: "noindex" },
 *     "/admin/login": { title: "Login" }
 *   };
 *   matcher.findMatchingRule('/admin/login', rules);
 *   // → { pattern: "/admin/login", title: "Login" } (exact match vince, priority 1000)
 *
 * CHI UTILIZZA QUESTO MODULO (misurato: un cambio di semantica qui attraversa
 * tutti e sette, non i due che questa nota elencava):
 * - adminAccessControl — protezione degli URL (vuole il path INTERO)
 * - seo / adminSeo     — regole per pagina        (vuole il path INTERO)
 * - csrfProtection     — percorsi esenti          (vuole il path INTERO)
 * - urlRedirect        — redirect 301/302         (vuole il path INTERO)
 * - sentinel           — filtro delle richieste: RILEVA, quindi vuole « contiene
 *                        dovunque » — e dopo l'ancoraggio lo dichiara con `.*`
 * - core/pathZoneResolver, core/botDetector
 *
 * @module core/patternMatcher
 */

class PatternMatcher {
  constructor() {
    // Cache per pattern regex compilati (chiave: il corpo dopo "regex:")
    this.regexCache = new Map();
    // Cache per i wildcard compilati. Prima non c'era: i due matchWildcard
    // facevano `new RegExp(...)` a OGNI chiamata, e `matches()` è invocato una
    // volta per regola per richiesta.
    this.wildcardCache = new Map();
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
        // ANCORATA: `^(?:corpo)$` descrive il path intero. Il gruppo non
        // catturante non è cosmetico: senza, un corpo con alternative di primo
        // livello cambierebbe significato — `^/a|/b$` vuol dire « inizia con /a
        // OPPURE finisce con /b », mentre `^(?:/a|/b)$` vuol dire « è /a oppure
        // è /b », che è quello che intende chi scrive la regola.
        this.regexCache.set(regexStr, new RegExp(`^(?:${regexStr})$`));
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
    return this.wildcardToRegex(pattern).test(url);
  }

  // ─── Perché un passaggio solo (REVIEW.md → A4) ──────────────────────────────
  // I due metodi separati facevano l'escape dei metacaratteri SENZA includere
  // `*`, e poi sostituivano uno solo dei due wildcard: il ricorsivo solo `**`,
  // il singolo solo `*`. In un pattern MISTO l'asterisco singolo rimasto non era
  // né sostituito né escapato, e finiva nella regex finale come
  // QUANTIFICATORE — « zero o più occorrenze del carattere precedente »:
  //
  //     /admin/*/config/**   compilava in   ^/admin/*/config/.*$
  //
  // cioè « /admin seguito da zero o più slash, poi /config/ ». Misurato, il
  // difetto non era « non funziona », era un'INVERSIONE:
  //
  //     /admin/x/config/y    doveva matchare  →  NON matchava
  //     /admin/config/y      non doveva       →  matchava
  //     /admin//config/y     non doveva       →  matchava
  //
  // Con una scansione unica ogni carattere è deciso una volta sola, quindi la
  // classe di problema non esiste più — invece di RIFIUTARE i pattern misti,
  // che era il rimedio proposto in attesa di questo.
  /**
   * Compila un pattern wildcard in una RegExp ancorata, in un solo passaggio.
   *
   * - `**` → `.*`     (qualsiasi cosa, slash compresi)
   * - `*`  → `[^/]+`  (UN segmento, non vuoto: « un segmento qualsiasi » non è
   *                    « nessun segmento », quindi un doppio slash non matcha)
   * - ogni altro metacarattere regex è escapato
   *
   * @param {string} pattern - Pattern con `*` e/o `**`
   * @returns {RegExp} Regex ancorata, dalla cache se già compilata
   */
  wildcardToRegex(pattern) {
    if (this.wildcardCache.has(pattern)) return this.wildcardCache.get(pattern);

    let body = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];

      if (ch === '*') {
        if (pattern[i + 1] === '*') {
          body += '.*';
          i += 1;                       // consuma il secondo asterisco
        } else {
          body += '[^/]+';
        }
        continue;
      }

      body += /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    }

    const regex = new RegExp(`^${body}$`);
    this.wildcardCache.set(pattern, regex);
    return regex;
  }

  /**
   * Match con wildcard ricorsivo (**)
   * Due asterischi matchano qualsiasi carattere incluso '/' (ricorsivo)
   * @param {string} url - URL da testare
   * @param {string} pattern - Pattern con **
   * @returns {boolean}
   */
  matchWildcardRecursive(url, pattern) {
    return this.wildcardToRegex(pattern).test(url);
  }

  /**
   * Trova la regola con priorità più alta che matcha l'URL
   * @param {string} url - URL da testare
   * @param {object} rules - Oggetto con regole (es: { "/admin/**": {...}, "/dashboard.ejs": {...} })
   * @returns {object|null} - Regola matchata con campo "pattern" aggiunto, o null se nessun match
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
