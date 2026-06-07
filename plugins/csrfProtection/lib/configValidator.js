'use strict';

/**
 * configValidator.js — Validazione al boot del blocco `custom` di pluginConfig.json5.
 *
 * Ritorna { valid, errors, warnings }. Gli errori bloccano l'avvio solo se
 * `custom.strictValidation === true` (gestito da main.js); i warning sono
 * sempre solo informativi.
 */

const KNOWN_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * @param {object} custom
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validate(custom) {
  const errors = [];
  const warnings = [];

  if (!custom || typeof custom !== 'object') {
    return { valid: false, errors: ['custom mancante o non valido'], warnings };
  }

  if (custom.enabled !== undefined && typeof custom.enabled !== 'boolean') {
    warnings.push('custom.enabled non booleano: assunto true');
  }

  // protectedMethods
  if (custom.protectedMethods !== undefined) {
    if (!Array.isArray(custom.protectedMethods)) {
      errors.push('custom.protectedMethods deve essere un array');
    } else {
      for (const m of custom.protectedMethods) {
        const norm = String(m || '').toUpperCase();
        const canonical = norm === 'DEL' ? 'DELETE' : norm;
        if (typeof m !== 'string' || !KNOWN_METHODS.includes(canonical)) {
          warnings.push(`custom.protectedMethods: metodo non riconosciuto "${m}"`);
        }
      }
    }
  }

  // campi stringa non vuoti
  for (const field of ['tokenHeaderName', 'tokenFieldName', 'metaName']) {
    if (custom[field] !== undefined && (typeof custom[field] !== 'string' || custom[field].trim() === '')) {
      errors.push(`custom.${field} deve essere una stringa non vuota`);
    }
  }

  if (custom.trustProxy !== undefined && typeof custom.trustProxy !== 'boolean') {
    warnings.push('custom.trustProxy non booleano: assunto false');
  }

  // originCheck
  if (custom.originCheck !== undefined) {
    if (typeof custom.originCheck !== 'object' || custom.originCheck === null) {
      errors.push('custom.originCheck deve essere un oggetto');
    } else {
      const ao = custom.originCheck.allowedOrigins;
      if (ao !== undefined && !Array.isArray(ao)) {
        errors.push('custom.originCheck.allowedOrigins deve essere un array');
      } else if (Array.isArray(ao)) {
        for (const o of ao) {
          if (typeof o !== 'string' || !/^https?:\/\//.test(o)) {
            warnings.push(`custom.originCheck.allowedOrigins: origin sospetto "${o}" (atteso scheme://host)`);
          }
        }
      }
    }
  }

  // exemptPaths
  if (custom.exemptPaths !== undefined && !Array.isArray(custom.exemptPaths)) {
    errors.push('custom.exemptPaths deve essere un array');
  }

  // failureStatus
  if (custom.failureStatus !== undefined) {
    const s = custom.failureStatus;
    if (typeof s !== 'number' || s < 400 || s > 599) {
      warnings.push('custom.failureStatus dovrebbe essere un codice HTTP 4xx/5xx (assunto 403)');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validate, KNOWN_METHODS };
