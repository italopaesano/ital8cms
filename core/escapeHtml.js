'use strict';

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Converts &, <, >, ", ' to their HTML entity equivalents.
 *
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string, or empty string if input is not a string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = escapeHtml;
