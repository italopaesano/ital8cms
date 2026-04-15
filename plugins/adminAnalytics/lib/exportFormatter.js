'use strict';

/**
 * exportFormatter.js — Converts event arrays to CSV or JSON for file download.
 *
 * CSV output:
 *   - One header row with field names
 *   - One data row per event
 *   - RFC 4180 quoting (wrap in double-quotes when value contains comma, newline, or quote)
 *   - Windows-style CRLF line endings (broadest spreadsheet compatibility)
 *
 * JSON output:
 *   - Pretty-printed JSON array (2-space indent)
 */

/** Canonical order of fields in CSV/JSON exports */
const EVENT_FIELDS = [
  'timestamp',
  'path',
  'method',
  'statusCode',
  'durationMs',
  'referrer',
  'userAgent',
  'isBot',
  'botName',
  'ipArea',
  'sessionHash',
  'isAuthenticated',
  'isAdmin',
];

/**
 * Formats an array of events as a CSV string.
 *
 * @param {object[]} events
 * @returns {string} UTF-8 CSV string
 */
function formatCsv(events) {
  const rows = [EVENT_FIELDS.join(',')];

  for (const ev of events) {
    const row = EVENT_FIELDS.map(field => {
      const val = ev[field];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // RFC 4180: wrap in quotes if value contains comma, double-quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

/**
 * Formats an array of events as a pretty-printed JSON string.
 *
 * @param {object[]} events
 * @returns {string} JSON string
 */
function formatJson(events) {
  return JSON.stringify(events, null, 2);
}

module.exports = { formatCsv, formatJson, EVENT_FIELDS };
