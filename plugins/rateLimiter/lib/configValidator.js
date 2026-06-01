/**
 * configValidator.js
 *
 * Validazione al boot della configurazione del plugin e delle regole in
 * protectedRoutes.json5. Restituisce errori e warning; il main decide se
 * crashare (strictValidation) o proseguire con i default.
 */

'use strict';

const POLICY_POSITIVE_FIELDS = [
  'findWindowSeconds',
  'maxFailures',
  'shortBlockSeconds',
  'longBlockSeconds',
  'escalationResetSeconds',
];

/**
 * Valida un blocco di policy (defaults o override di regola).
 * @param {object} policy
 * @param {string} label - etichetta per i messaggi (es. "defaults" o "rule 'adminLogin'")
 * @param {boolean} partial - se true, i campi mancanti sono ammessi (override parziale)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validatePolicy(policy, label, partial) {
  const errors = [];
  const warnings = [];

  for (const field of POLICY_POSITIVE_FIELDS) {
    if (policy[field] === undefined) {
      if (!partial) errors.push(`${label}: campo obbligatorio mancante "${field}"`);
      continue;
    }
    if (typeof policy[field] !== 'number' || !Number.isFinite(policy[field]) || policy[field] <= 0) {
      errors.push(`${label}: "${field}" deve essere un numero positivo (trovato: ${policy[field]})`);
    }
  }

  // maxShortBlocks può essere 0 (= subito long block), quindi >= 0
  if (policy.maxShortBlocks !== undefined) {
    if (typeof policy.maxShortBlocks !== 'number' || policy.maxShortBlocks < 0) {
      errors.push(`${label}: "maxShortBlocks" deve essere un numero >= 0 (trovato: ${policy.maxShortBlocks})`);
    }
  } else if (!partial) {
    errors.push(`${label}: campo obbligatorio mancante "maxShortBlocks"`);
  }

  return { errors, warnings };
}

/**
 * Valida l'intera configurazione del plugin.
 * @param {object} custom - pluginConfig.custom
 * @param {object} rulesData - contenuto di protectedRoutes.json5
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validate(custom, rulesData) {
  const errors = [];
  const warnings = [];

  if (!custom || typeof custom !== 'object') {
    return { valid: false, errors: ['custom config mancante o non valida'], warnings };
  }

  // Default policy (deve essere completa)
  if (!custom.defaults || typeof custom.defaults !== 'object') {
    errors.push('custom.defaults mancante: necessario per ereditare i parametri di rate limit');
  } else {
    const r = validatePolicy(custom.defaults, 'defaults', false);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  // Regole protette
  const rules = (rulesData && Array.isArray(rulesData.rules)) ? rulesData.rules : null;
  if (!rules) {
    warnings.push('protectedRoutes.json5: campo "rules" assente o non è un array — nessuna regola caricata');
  } else {
    const seen = new Set();
    rules.forEach((rule, idx) => {
      if (!rule || typeof rule.name !== 'string' || rule.name.length === 0) {
        errors.push(`protectedRoutes.json5: la regola #${idx} non ha un "name" valido (stringa non vuota)`);
        return;
      }
      if (seen.has(rule.name)) {
        warnings.push(`protectedRoutes.json5: nome regola duplicato "${rule.name}" (vince la prima)`);
      }
      seen.add(rule.name);
      const r = validatePolicy(rule, `rule '${rule.name}'`, true);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validate, validatePolicy };
