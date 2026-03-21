/**
 * Client-side HTML escaping utility (defense-in-depth).
 * Primary sanitization MUST happen server-side in API endpoints.
 * This is an additional safety layer for client-side DOM manipulation.
 */
(function(global) {
  'use strict';

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.escapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
