/**
 * adminAnalytics — Admin dashboard for the analytics plugin.
 *
 * Reads JSONL data produced by the analytics plugin via its shared object API,
 * aggregates visits, filters by period/traffic type/auth/status, builds Chart.js
 * datasets, and exposes them through three API routes:
 *
 *   GET /api/adminAnalytics/stats    → aggregated KPIs + chart data
 *   GET /api/adminAnalytics/events   → paginated raw event log
 *   GET /api/adminAnalytics/export   → file download (CSV or JSON)
 *   GET /api/adminAnalytics/chartjs/chart.umd.min.js → serves Chart.js UMD bundle
 *
 * DEPENDENCY: analytics plugin (shared object injected via setSharedObject)
 *
 * WEIGHT: 50 — loaded after analytics (weight 5) so setSharedObject receives
 * a fully initialised analyticsApi.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const loadJson5 = require('../../core/loadJson5');

const { selectFilesForRange }  = require('./lib/fileSelector');
const { filterEvents, aggregate, determineGroupBy } = require('./lib/aggregator');
const {
  buildVisitsTrendData,
  buildTopPagesData,
  buildTopBotsData,
  buildStatusCodesData,
} = require('./lib/chartDataBuilder');
const { formatCsv, formatJson } = require('./lib/exportFormatter');

const LOG_PREFIX = '[adminAnalytics]';

/** @type {object|null} Custom config block from pluginConfig.json5 */
let config = null;

/** @type {object|null} Shared object received from the analytics plugin */
let analyticsApi = null;

/** Access level: admin + root only — analytics data is sensitive */
const adminAccess = { requiresAuth: true, allowedRoles: [0, 1] };

// ── Date range helpers ────────────────────────────────────────────────────────

/**
 * Parses `from` and `to` query params (YYYY-MM-DD) into Date objects.
 * Defaults to the last 30 days if absent or invalid.
 *
 * @param {object} query - Koa ctx.query
 * @returns {{ fromDate: Date, toDate: Date }}
 */
function parseDateRange(query) {
  const now = new Date();
  let toDate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999
  ));

  // Default: 30 days inclusive (today - 29 days → today)
  let fromDate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
  ));
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);

  if (query.from) {
    const d = new Date(query.from + 'T00:00:00Z');
    if (!isNaN(d.getTime())) fromDate = d;
  }
  if (query.to) {
    const d = new Date(query.to + 'T23:59:59.999Z');
    if (!isNaN(d.getTime())) toDate = d;
  }

  // Guarantee from <= to
  if (fromDate > toDate) fromDate = new Date(toDate);

  return { fromDate, toDate };
}

/**
 * Extracts and validates filter options from query params.
 * Unknown values fall back to 'all' / empty string.
 *
 * @param {object} query
 * @param {Date}   fromDate
 * @param {Date}   toDate
 * @returns {object}
 */
function parseFilters(query, fromDate, toDate) {
  const TRAFFIC  = new Set(['all', 'human', 'bot']);
  const AUTH     = new Set(['all', 'authenticated', 'anonymous']);
  const CTX      = new Set(['all', 'public', 'admin']);
  const STATUS   = new Set(['all', '2xx', '3xx', '4xx', '5xx']);

  return {
    fromDate,
    toDate,
    trafficType:  TRAFFIC.has(query.trafficType)  ? query.trafficType  : 'all',
    authType:     AUTH.has(query.authType)         ? query.authType     : 'all',
    context:      CTX.has(query.context)           ? query.context      : 'all',
    statusGroup:  STATUS.has(query.statusGroup)    ? query.statusGroup  : 'all',
    pathSearch:   typeof query.pathSearch === 'string' ? query.pathSearch : '',
  };
}

/**
 * Reads all events from the JSONL files that overlap with [fromDate, toDate].
 * Forces an analytics buffer flush first so in-memory events are included.
 *
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {object[]}
 */
function loadEventsForRange(fromDate, toDate) {
  if (!analyticsApi) return [];
  analyticsApi.flushNow();
  const allFiles      = analyticsApi.listDataFiles();
  const relevantFiles = selectFilesForRange(allFiles, fromDate, toDate);
  const events        = [];
  for (const filePath of relevantFiles) {
    events.push(...analyticsApi.readEventsFromFile(filePath));
  }
  return events;
}

// ── Plugin module ─────────────────────────────────────────────────────────────

module.exports = {

  /**
   * @param {object} pluginSys
   * @param {string} pathPluginFolder
   */
  async loadPlugin(pluginSys, pathPluginFolder) {
    const configPath = path.join(pathPluginFolder, 'pluginConfig.json5');
    const pluginConf = loadJson5(configPath);
    config = pluginConf.custom;

    console.log(
      `${LOG_PREFIX} Plugin caricato — maxRawLogRows: ${config.maxRawLogRows}, ` +
      `topN: ${config.topN}`
    );
  },

  /**
   * Receives the analytics plugin's shared object.
   * Called automatically by pluginSys during initialisation.
   */
  setSharedObject(fromPlugin, sharedObject) {
    if (fromPlugin === 'analytics') {
      analyticsApi = sharedObject;
      console.log(`${LOG_PREFIX} Shared object ricevuto da analytics`);
    }
  },

  /**
   * Exposes config values to EJS templates via passData.plugin.adminAnalytics.
   */
  getObjectToShareToWebPages() {
    return {
      maxRawLogRows:          config ? (config.maxRawLogRows          || 10000)  : 10000,
      exportWarningThreshold: config ? (config.exportWarningThreshold || 100000) : 100000,
    };
  },

  getRouteArray() {
    return [

      // ── GET /stats ──────────────────────────────────────────────────────────
      {
        method: 'GET',
        path: '/stats',
        access: adminAccess,
        handler: async (ctx) => {
          if (!analyticsApi) {
            ctx.status = 503;
            ctx.body = { error: 'Analytics plugin not available' };
            return;
          }

          const { fromDate, toDate } = parseDateRange(ctx.query);
          const filters  = parseFilters(ctx.query, fromDate, toDate);
          const groupBy  = determineGroupBy(fromDate, toDate);

          const rawEvents = loadEventsForRange(fromDate, toDate);
          const filtered  = filterEvents(rawEvents, filters);
          const stats     = aggregate(filtered, groupBy, config.topN || 10);

          ctx.body = {
            period: {
              from:    fromDate.toISOString().substring(0, 10),
              to:      toDate.toISOString().substring(0, 10),
              groupBy,
            },
            totals:         stats.totals,
            visitsByPeriod: stats.visitsByPeriod,
            topPages:       stats.topPages,
            topBots:        stats.topBots,
            referrers:      stats.referrers,
            statusCodes:    stats.statusCodes,
            chartData: {
              visitsTrend: buildVisitsTrendData(stats.visitsByPeriod),
              topPages:    buildTopPagesData(stats.topPages),
              topBots:     buildTopBotsData(stats.topBots),
              statusCodes: buildStatusCodesData(stats.statusCodes),
            },
          };
        },
      },

      // ── GET /events ─────────────────────────────────────────────────────────
      {
        method: 'GET',
        path: '/events',
        access: adminAccess,
        handler: async (ctx) => {
          if (!analyticsApi) {
            ctx.status = 503;
            ctx.body = { error: 'Analytics plugin not available' };
            return;
          }

          const { fromDate, toDate } = parseDateRange(ctx.query);
          const filters = parseFilters(ctx.query, fromDate, toDate);
          const page    = Math.max(1, parseInt(ctx.query.page  || '1',  10));
          const limit   = Math.min(200, Math.max(1, parseInt(ctx.query.limit || '50', 10)));

          const rawEvents = loadEventsForRange(fromDate, toDate);
          const filtered  = filterEvents(rawEvents, filters)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

          const maxRows  = config.maxRawLogRows || 10000;
          const capped   = filtered.length > maxRows;
          const cappedSlice = filtered.slice(0, maxRows);
          const total    = cappedSlice.length;
          const pages    = Math.max(1, Math.ceil(total / limit));
          const offset   = (Math.min(page, pages) - 1) * limit;

          ctx.body = {
            events: cappedSlice.slice(offset, offset + limit),
            total,
            page: Math.min(page, pages),
            pages,
            limit,
            capped,
          };
        },
      },

      // ── GET /export ─────────────────────────────────────────────────────────
      {
        method: 'GET',
        path: '/export',
        access: adminAccess,
        handler: async (ctx) => {
          if (!analyticsApi) {
            ctx.status = 503;
            ctx.body = { error: 'Analytics plugin not available' };
            return;
          }

          const { fromDate, toDate } = parseDateRange(ctx.query);
          const filters = parseFilters(ctx.query, fromDate, toDate);
          const format  = ctx.query.format === 'json' ? 'json' : 'csv';

          const rawEvents = loadEventsForRange(fromDate, toDate);
          const filtered  = filterEvents(rawEvents, filters)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

          const from  = fromDate.toISOString().substring(0, 10);
          const to    = toDate.toISOString().substring(0, 10);
          const fname = `analytics-${from}-${to}.${format}`;

          ctx.set('Content-Disposition', `attachment; filename="${fname}"`);

          if (format === 'csv') {
            ctx.set('Content-Type', 'text/csv; charset=utf-8');
            ctx.body = formatCsv(filtered);
          } else {
            ctx.set('Content-Type', 'application/json; charset=utf-8');
            ctx.body = formatJson(filtered);
          }
        },
      },

      // ── GET /chartjs/chart.umd.min.js ───────────────────────────────────────
      // Serves the Chart.js UMD bundle from node_modules.
      // Access is restricted so only authenticated admins can load it
      // (consistent with the rest of the admin interface).
      {
        method: 'GET',
        path: '/chartjs/chart.umd.min.js',
        access: adminAccess,
        handler: async (ctx) => {
          const bundlePath = path.join(
            __dirname, '../../node_modules/chart.js/dist/chart.umd.min.js'
          );
          try {
            ctx.set('Content-Type', 'application/javascript; charset=utf-8');
            ctx.set('Cache-Control', 'public, max-age=86400'); // 1-day browser cache
            ctx.body = fs.readFileSync(bundlePath, 'utf8');
          } catch (err) {
            ctx.status = 404;
            ctx.body = '/* chart.js bundle not found — run: npm install */';
          }
        },
      },

    ];
  },
};
