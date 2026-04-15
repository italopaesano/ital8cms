'use strict';

/**
 * chartDataBuilder.js — Converts aggregated analytics data into Chart.js dataset objects.
 *
 * Each function returns a plain Chart.js `data` object (labels + datasets).
 * Chart type and options are configured in the client-side analytics.js.
 */

// Bootstrap-inspired color palette
const COLOR_HUMAN  = { bg: 'rgba(13, 110, 253, 0.65)',  border: 'rgb(13, 110, 253)' };
const COLOR_BOT    = { bg: 'rgba(220, 53, 69, 0.55)',   border: 'rgb(220, 53, 69)' };
const COLOR_PAGE   = { bg: 'rgba(25, 135, 84, 0.70)',   border: 'rgb(25, 135, 84)' };
const COLOR_STATUS = {
  '2': 'rgba(25, 135, 84, 0.70)',   // 2xx — green
  '3': 'rgba(13, 110, 253, 0.65)',  // 3xx — blue
  '4': 'rgba(255, 193, 7, 0.70)',   // 4xx — yellow
  '5': 'rgba(220, 53, 69, 0.65)',   // 5xx — red
};

// Palette for pie/doughnut charts (10 distinct colours)
const PIE_PALETTE = [
  '#0d6efd', '#dc3545', '#198754', '#ffc107', '#0dcaf0',
  '#6f42c1', '#fd7e14', '#20c997', '#d63384', '#6c757d',
];

/**
 * Truncates a string to maxLen, prepending an ellipsis when cut.
 * Keeps the tail of the string (e.g. "/very/long/path/page") so the
 * most specific segment remains visible.
 */
function truncateTail(str, maxLen) {
  if (str.length <= maxLen) return str;
  return '\u2026' + str.substring(str.length - (maxLen - 1));
}

// ── Chart data builders ───────────────────────────────────────────────────────

/**
 * Visits-over-time stacked area line chart (human + bot).
 *
 * @param {Array<{period, humanCount, botCount}>} visitsByPeriod
 * @returns {object} Chart.js data object
 */
function buildVisitsTrendData(visitsByPeriod) {
  return {
    labels: visitsByPeriod.map(p => p.period),
    datasets: [
      {
        label: 'Human',
        data: visitsByPeriod.map(p => p.humanCount),
        backgroundColor: COLOR_HUMAN.bg,
        borderColor: COLOR_HUMAN.border,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: visitsByPeriod.length > 60 ? 0 : 3,
      },
      {
        label: 'Bot',
        data: visitsByPeriod.map(p => p.botCount),
        backgroundColor: COLOR_BOT.bg,
        borderColor: COLOR_BOT.border,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: visitsByPeriod.length > 60 ? 0 : 3,
      },
    ],
  };
}

/**
 * Top pages horizontal bar chart.
 *
 * @param {Array<{path, count}>} topPages
 * @returns {object} Chart.js data object
 */
function buildTopPagesData(topPages) {
  return {
    labels: topPages.map(p => truncateTail(p.path, 45)),
    datasets: [
      {
        label: 'Visits',
        data: topPages.map(p => p.count),
        backgroundColor: COLOR_PAGE.bg,
        borderColor: COLOR_PAGE.border,
        borderWidth: 1,
      },
    ],
  };
}

/**
 * Top bots doughnut chart.
 *
 * @param {Array<{botName, count}>} topBots
 * @returns {object} Chart.js data object
 */
function buildTopBotsData(topBots) {
  return {
    labels: topBots.map(b => b.botName),
    datasets: [
      {
        data: topBots.map(b => b.count),
        backgroundColor: topBots.map((_, i) => PIE_PALETTE[i % PIE_PALETTE.length]),
        borderWidth: 1,
        borderColor: '#fff',
      },
    ],
  };
}

/**
 * HTTP status codes bar chart.
 * Bars are colour-coded by status class (2xx green, 3xx blue, 4xx yellow, 5xx red).
 *
 * @param {Array<{code, count}>} statusCodes
 * @returns {object} Chart.js data object
 */
function buildStatusCodesData(statusCodes) {
  return {
    labels: statusCodes.map(s => String(s.code)),
    datasets: [
      {
        label: 'Requests',
        data: statusCodes.map(s => s.count),
        backgroundColor: statusCodes.map(s => {
          const key = String(Math.floor((s.code || 0) / 100));
          return COLOR_STATUS[key] || 'rgba(108, 117, 125, 0.65)';
        }),
        borderWidth: 1,
      },
    ],
  };
}

module.exports = {
  buildVisitsTrendData,
  buildTopPagesData,
  buildTopBotsData,
  buildStatusCodesData,
};
