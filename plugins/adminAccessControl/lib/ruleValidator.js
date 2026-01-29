/**
 * RULE VALIDATOR
 *
 * Valida le regole di accesso nel file accessControl.json5
 *
 * Validazioni:
 * 1. Sintassi JSON5 valida
 * 2. Campi obbligatori presenti (requiresAuth, allowedRoles)
 * 3. Pattern URL validi (no caratteri invalidi, regex corrette)
 * 4. Ruoli esistono (verifica con adminUsers)
 * 5. Nessuna modifica a hardcodedRules (se validazione da UI)
 * 6. Nessuna regola definisce rotte di plugin (conflitto)
 */

const PatternMatcher = require('./patternMatcher');

class RuleValidator {
  constructor(pluginSys, ital8Conf) {
    this.pluginSys = pluginSys;
    this.ital8Conf = ital8Conf || { apiPrefix: 'api' }; // Fallback se non passato
    this.patternMatcher = new PatternMatcher();
  }

  /**
   * Valida il file accessControl.json5 completo
   * @param {object} config - Configurazione parsata
   * @param {boolean} fromUI - true se validazione da interfaccia admin (impedisce modifica hardcoded)
   * @returns {object} - { valid: boolean, errors: array }
   */
  validateConfig(config, fromUI = false) {
    const errors = [];

    // 1. Verifica struttura base
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Invalid configuration: must be an object'] };
    }

    // 2. Verifica sezioni obbligatorie
    if (!config.hardcodedRules || typeof config.hardcodedRules !== 'object') {
      errors.push('Missing or invalid "hardcodedRules" section');
    }

    if (!config.customRules || typeof config.customRules !== 'object') {
      errors.push('Missing or invalid "customRules" section');
    }

    if (!config.defaultPolicy || typeof config.defaultPolicy !== 'object') {
      errors.push('Missing or invalid "defaultPolicy" section');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // 3. Valida hardcodedRules
    const hardcodedErrors = this.validateRuleSection(config.hardcodedRules, 'hardcodedRules', fromUI);
    errors.push(...hardcodedErrors);

    // 4. Valida customRules
    const customErrors = this.validateRuleSection(config.customRules, 'customRules', fromUI);
    errors.push(...customErrors);

    // 5. Valida defaultPolicy
    const policyErrors = this.validateDefaultPolicy(config.defaultPolicy);
    errors.push(...policyErrors);

    // 6. Verifica conflitti con rotte plugin (solo per customRules)
    if (!fromUI) { // Solo al boot, non da UI
      const conflictErrors = this.checkPluginRouteConflicts(config.customRules);
      errors.push(...conflictErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida una sezione di regole (hardcoded o custom)
   * @param {object} rules - Oggetto con regole
   * @param {string} sectionName - Nome sezione (per errori)
   * @param {boolean} fromUI - true se da interfaccia admin
   * @returns {array} - Array di errori
   */
  validateRuleSection(rules, sectionName, fromUI) {
    const errors = [];

    for (const [pattern, rule] of Object.entries(rules)) {
      // Valida pattern
      const patternValidation = this.patternMatcher.validatePattern(pattern);
      if (!patternValidation.valid) {
        errors.push(`${sectionName}["${pattern}"]: ${patternValidation.error}`);
        continue; // Skip ulteriori validazioni su questo pattern
      }

      // Valida campi obbligatori
      if (rule.requiresAuth === undefined) {
        errors.push(`${sectionName}["${pattern}"]: Missing required field "requiresAuth"`);
      } else if (typeof rule.requiresAuth !== 'boolean') {
        errors.push(`${sectionName}["${pattern}"]: "requiresAuth" must be boolean`);
      }

      if (rule.allowedRoles === undefined) {
        errors.push(`${sectionName}["${pattern}"]: Missing required field "allowedRoles"`);
      } else if (!Array.isArray(rule.allowedRoles)) {
        errors.push(`${sectionName}["${pattern}"]: "allowedRoles" must be an array`);
      } else {
        // Valida che i ruoli esistano
        const roleErrors = this.validateRoles(rule.allowedRoles, pattern, sectionName);
        errors.push(...roleErrors);
      }

      // Valida priority (opzionale, ma se presente deve essere numero)
      if (rule.priority !== undefined && typeof rule.priority !== 'number') {
        errors.push(`${sectionName}["${pattern}"]: "priority" must be a number`);
      }

      // Valida editable (opzionale)
      if (rule.editable !== undefined && typeof rule.editable !== 'boolean') {
        errors.push(`${sectionName}["${pattern}"]: "editable" must be boolean`);
      }

      // NOTA: Il controllo per hardcodedRules immutabili è fatto in validateFromUI()
      // tramite confronto byte-per-byte dell'intera sezione (linee 295-301)
      // Non serve controllare qui ogni singola regola
    }

    return errors;
  }

  /**
   * Valida che i ruoli esistano nel sistema
   * @param {array} roleIds - Array di ID ruoli
   * @param {string} pattern - Pattern URL (per errori)
   * @param {string} sectionName - Nome sezione (per errori)
   * @returns {array} - Array di errori
   */
  validateRoles(roleIds, pattern, sectionName) {
    const errors = [];

    // Ottieni plugin adminUsers
    const adminUsers = this.pluginSys.getPlugin('adminUsers');
    if (!adminUsers) {
      // adminUsers non disponibile → warning ma non errore fatale
      console.warn('[RuleValidator] adminUsers plugin not available, skipping role validation');
      return errors;
    }

    // Carica ruoli da adminUsers
    const loadJson5 = require('../../../core/loadJson5');
    const path = require('path');
    let allRoles;

    try {
      const userRolePath = path.join(adminUsers.pathPluginFolder, 'userRole.json5');
      const roleData = loadJson5(userRolePath);
      allRoles = roleData.roles || {};
    } catch (err) {
      console.warn('[RuleValidator] Cannot load userRole.json5, skipping role validation', err);
      return errors;
    }

    // Verifica ogni ruolo
    for (const roleId of roleIds) {
      if (typeof roleId !== 'number') {
        errors.push(`${sectionName}["${pattern}"]: Role ID must be a number, got ${typeof roleId}`);
        continue;
      }

      // Verifica che il ruolo esista
      if (!allRoles[roleId]) {
        errors.push(`${sectionName}["${pattern}"]: Role ${roleId} not found in userRole.json5 (WARNING)`);
        // Non bloccare il boot per ruoli mancanti, solo warning
      }
    }

    return errors;
  }

  /**
   * Valida defaultPolicy
   * @param {object} policy - Oggetto defaultPolicy
   * @returns {array} - Array di errori
   */
  validateDefaultPolicy(policy) {
    const errors = [];

    // Verifica action
    if (!policy.action) {
      errors.push('defaultPolicy: Missing required field "action"');
    } else {
      const validActions = ['allow', 'deny', 'requireAuth'];
      if (!validActions.includes(policy.action)) {
        errors.push(`defaultPolicy: "action" must be one of: ${validActions.join(', ')}`);
      }
    }

    // Verifica redirectOnDenied (opzionale ma se presente deve essere string)
    if (policy.redirectOnDenied !== undefined && typeof policy.redirectOnDenied !== 'string') {
      errors.push('defaultPolicy: "redirectOnDenied" must be a string');
    }

    return errors;
  }

  /**
   * Verifica conflitti con rotte definite dai plugin
   * @param {object} customRules - Regole custom
   * @returns {array} - Array di errori (fatali se conflitto trovato)
   */
  checkPluginRouteConflicts(customRules) {
    const errors = [];

    // Ottieni tutte le rotte registrate dai plugin
    const pluginRoutes = this.getPluginRoutes();

    for (const pattern of Object.keys(customRules)) {
      // Verifica se il pattern matcha una rotta plugin
      for (const pluginRoute of pluginRoutes) {
        if (this.patternMatcher.matches(pluginRoute.fullPath, pattern)) {
          errors.push(
            `FATAL: Rule conflict detected! ` +
            `Pattern "${pattern}" in customRules matches plugin route "${pluginRoute.fullPath}" ` +
            `(plugin: ${pluginRoute.plugin}). ` +
            `Remove this rule from accessControl.json5 - plugin routes must declare access in their code.`
          );
        }
      }
    }

    return errors;
  }

  /**
   * Ottieni lista di tutte le rotte registrate dai plugin
   * @returns {array} - Array di { plugin: string, path: string, fullPath: string }
   */
  getPluginRoutes() {
    const routes = [];
    const allPlugins = this.pluginSys.getAllPlugins();

    for (const [pluginName, plugin] of allPlugins.entries()) {
      if (plugin.getRouteArray) {
        try {
          const routeArray = plugin.getRouteArray();
          if (Array.isArray(routeArray)) {
            for (const route of routeArray) {
              // Costruisci full path come in pluginSys.loadRoutes()
              const apiPrefix = this.ital8Conf.apiPrefix || 'api';
              const fullPath = `/${apiPrefix}/${pluginName}${route.path}`;

              routes.push({
                plugin: pluginName,
                path: route.path,
                fullPath: fullPath
              });
            }
          }
        } catch (err) {
          console.warn(`[RuleValidator] Cannot get routes from plugin ${pluginName}`, err);
        }
      }
    }

    return routes;
  }

  /**
   * Valida JSON5 parsato da UI (impedisce modifica hardcodedRules)
   * @param {string} jsonString - Stringa JSON5 da textarea
   * @param {object} originalHardcodedRules - Regole hardcoded originali (immutabili)
   * @returns {object} - { valid: boolean, errors: array, parsed: object|null }
   */
  validateFromUI(jsonString, originalHardcodedRules) {
    const errors = [];

    // 1. Parsing JSON5
    let parsed;
    try {
      // Usa JSON5.parse se disponibile, altrimenti JSON.parse
      const JSON5 = require('json5');
      parsed = JSON5.parse(jsonString);
    } catch (err) {
      return {
        valid: false,
        errors: [`JSON5 syntax error: ${err.message}`],
        parsed: null
      };
    }

    // 2. Verifica che hardcodedRules non siano state modificate
    const submittedHardcoded = JSON.stringify(parsed.hardcodedRules);
    const originalHardcoded = JSON.stringify(originalHardcodedRules);

    if (submittedHardcoded !== originalHardcoded) {
      errors.push('Cannot modify hardcodedRules section. This section is read-only.');
      return { valid: false, errors, parsed: null };
    }

    // 3. Valida configurazione completa
    const configValidation = this.validateConfig(parsed, true);

    if (!configValidation.valid) {
      return {
        valid: false,
        errors: configValidation.errors,
        parsed: null
      };
    }

    return {
      valid: true,
      errors: [],
      parsed: parsed
    };
  }
}

module.exports = RuleValidator;
