/**
 * ANALYTICS CONFIG VALIDATOR
 *
 * Validates the custom block of plugins/analytics/pluginConfig.json5.
 * Used by adminAnalytics routes before saving.
 *
 * @module plugins/adminAnalytics/lib/analyticsConfigValidator
 */

'use strict';

const DEFAULT_SALT = 'cambia-questo-salt-in-produzione-con-stringa-casuale';
const VALID_ROTATION_MODES = ['none', 'daily', 'weekly', 'monthly'];
const MIN_SALT_LENGTH = 32;

/**
 * Validates the analytics plugin custom config block.
 *
 * @param {object} custom
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSettings(custom) {
  const errors   = [];
  const warnings = [];

  if (!custom || typeof custom !== 'object') {
    errors.push('Configuration must be an object');
    return { valid: false, errors, warnings };
  }

  // ── gdprCompliance ─────────────────────────────────────────────────────────
  if (custom.gdprCompliance !== undefined && typeof custom.gdprCompliance !== 'boolean') {
    errors.push('gdprCompliance must be a boolean');
  }

  // ── sessionSalt ────────────────────────────────────────────────────────────
  if (custom.sessionSalt !== undefined) {
    if (typeof custom.sessionSalt !== 'string') {
      errors.push('sessionSalt must be a string');
    } else {
      if (custom.sessionSalt.length < MIN_SALT_LENGTH) {
        errors.push(`sessionSalt must be at least ${MIN_SALT_LENGTH} characters long (current: ${custom.sessionSalt.length})`);
      }
      if (custom.sessionSalt === DEFAULT_SALT) {
        warnings.push('sessionSalt is still set to the default value — change it before going to production');
      }
    }
  }

  // ── useAnalyticsCookie ────────────────────────────────────────────────────
  if (custom.useAnalyticsCookie !== undefined && typeof custom.useAnalyticsCookie !== 'boolean') {
    errors.push('useAnalyticsCookie must be a boolean');
  }

  // ── analyticsCookieName ───────────────────────────────────────────────────
  if (custom.analyticsCookieName !== undefined) {
    if (typeof custom.analyticsCookieName !== 'string') {
      errors.push('analyticsCookieName must be a string');
    } else if (custom.analyticsCookieName.trim() === '') {
      errors.push('analyticsCookieName must not be empty');
    }
  }

  // ── rotationMode ──────────────────────────────────────────────────────────
  if (custom.rotationMode !== undefined) {
    if (typeof custom.rotationMode !== 'string') {
      errors.push('rotationMode must be a string');
    } else if (!VALID_ROTATION_MODES.includes(custom.rotationMode)) {
      errors.push(`rotationMode must be one of: ${VALID_ROTATION_MODES.join(', ')}`);
    }
  }

  // ── retentionDays ─────────────────────────────────────────────────────────
  if (custom.retentionDays !== undefined) {
    if (typeof custom.retentionDays !== 'number' || !Number.isInteger(custom.retentionDays)) {
      errors.push('retentionDays must be an integer');
    } else if (custom.retentionDays < 0) {
      errors.push('retentionDays must be 0 or greater (0 = disabled)');
    }
  }

  // ── dataPath ──────────────────────────────────────────────────────────────
  if (custom.dataPath !== undefined) {
    if (typeof custom.dataPath !== 'string') {
      errors.push('dataPath must be a string');
    } else if (custom.dataPath.trim() === '') {
      errors.push('dataPath must not be empty');
    } else if (custom.dataPath.startsWith('/')) {
      errors.push('dataPath must be a relative path (must not start with /)');
    } else if (custom.dataPath.includes('..')) {
      errors.push('dataPath must not contain ".." path traversal sequences');
    }
  }

  // ── flushIntervalSeconds ──────────────────────────────────────────────────
  if (custom.flushIntervalSeconds !== undefined) {
    if (typeof custom.flushIntervalSeconds !== 'number' || !Number.isInteger(custom.flushIntervalSeconds)) {
      errors.push('flushIntervalSeconds must be an integer');
    } else if (custom.flushIntervalSeconds < 0) {
      errors.push('flushIntervalSeconds must be 0 or greater');
    } else if (custom.flushIntervalSeconds > 300) {
      warnings.push('flushIntervalSeconds > 300 s: events may be lost on unexpected crashes');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateSettings };
