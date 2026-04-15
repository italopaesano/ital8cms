'use strict';

/**
 * aggregator.js — Filters and aggregates analytics events for dashboard display.
 *
 * Pipeline:
 *   1. filterEvents(events, filters) → filtered array
 *   2. aggregate(filtered, groupBy, topN) → stats object
 *
 * Auto-groupBy thresholds:
 *   ≤ 60 days  → group by day   (period key: "YYYY-MM-DD")
 *   61–365 days → group by week  (period key: "YYYY-WXX", ISO 8601)
 *   > 365 days  → group by month (period key: "YYYY-MM")
 *
 * Unique session counting: Option B — each null sessionHash counts as +1 unique.
 * Rationale: a null hash means no session cookie was present; treating them as
 * distinct visitors is the most conservative (privacy-respecting) assumption.
 */

// ── Date grouping helpers ─────────────────────────────────────────────────────

/**
 * Determines the auto-groupBy based on the span of the date range.
 *
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {'day'|'week'|'month'}
 */
function determineGroupBy(fromDate, toDate) {
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (days <= 60)  return 'day';
  if (days <= 365) return 'week';
  return 'month';
}

/**
 * Returns the ISO 8601 week string ("YYYY-WXX") for a UTC timestamp string.
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
function getIsoWeekKey(isoTimestamp) {
  const d = new Date(isoTimestamp);
  // Thursday of the same ISO week determines the year
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = thursday.getUTCFullYear();
  // Thursday of week 1 in that year
  const w1Thu = new Date(Date.UTC(year, 0, 4));
  w1Thu.setUTCDate(w1Thu.getUTCDate() - ((w1Thu.getUTCDay() + 6) % 7) + 3);
  const weekNum = 1 + Math.round((thursday.getTime() - w1Thu.getTime()) / 604_800_000);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Groups a timestamp into a period key.
 *
 * @param {string}              isoTimestamp
 * @param {'day'|'week'|'month'} groupBy
 * @returns {string}
 */
function toPeriodKey(isoTimestamp, groupBy) {
  if (groupBy === 'day')  return isoTimestamp.substring(0, 10); // YYYY-MM-DD
  if (groupBy === 'week') return getIsoWeekKey(isoTimestamp);
  return isoTimestamp.substring(0, 7);                           // YYYY-MM
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Returns true when statusCode belongs to the requested status group.
 *
 * @param {number} statusCode
 * @param {'all'|'2xx'|'3xx'|'4xx'|'5xx'} statusGroup
 */
function matchesStatusGroup(statusCode, statusGroup) {
  if (statusGroup === 'all') return true;
  const prefix = Math.floor((statusCode || 0) / 100);
  return `${prefix}xx` === statusGroup;
}

/**
 * Applies all active filters to an event array and returns matching events.
 *
 * @param {object[]} events
 * @param {object}   filters
 * @param {Date}     filters.fromDate
 * @param {Date}     filters.toDate
 * @param {string}   filters.trafficType  'all'|'human'|'bot'
 * @param {string}   filters.authType     'all'|'authenticated'|'anonymous'
 * @param {string}   filters.context      'all'|'public'|'admin'
 * @param {string}   filters.statusGroup  'all'|'2xx'|'3xx'|'4xx'|'5xx'
 * @param {string}   filters.pathSearch   substring match on event.path
 * @returns {object[]}
 */
function filterEvents(events, filters) {
  const { fromDate, toDate, trafficType, authType, context, statusGroup, pathSearch } = filters;
  const fromMs = fromDate.getTime();
  const toMs   = toDate.getTime();

  return events.filter(ev => {
    if (!ev || typeof ev.timestamp !== 'string') return false;

    const ts = new Date(ev.timestamp).getTime();
    if (isNaN(ts) || ts < fromMs || ts > toMs) return false;

    if (trafficType === 'human' &&  ev.isBot)  return false;
    if (trafficType === 'bot'   && !ev.isBot)  return false;

    if (authType === 'authenticated' && !ev.isAuthenticated) return false;
    if (authType === 'anonymous'     &&  ev.isAuthenticated) return false;

    if (context === 'admin'  && !ev.isAdmin) return false;
    if (context === 'public' &&  ev.isAdmin) return false;

    if (!matchesStatusGroup(ev.statusCode, statusGroup)) return false;

    if (pathSearch && !String(ev.path || '').includes(pathSearch)) return false;

    return true;
  });
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Aggregates pre-filtered events into dashboard-ready statistics.
 *
 * @param {object[]}             events  - Output of filterEvents()
 * @param {'day'|'week'|'month'} groupBy - Period grouping
 * @param {number}               topN    - Max items in top-N lists (default 10)
 * @returns {object}
 */
function aggregate(events, groupBy, topN = 10) {
  let botVisits      = 0;
  let totalDurationMs = 0;
  let durationCount  = 0;
  let errorCount     = 0;

  // Unique sessions: distinct non-null hashes + count of null-hash events
  const sessionSet     = new Set();
  let   nullSessionCnt = 0;

  // Period map: periodKey → { count, humanCount, botCount }
  const periodMap   = new Map();
  // Path map:   path    → { count, sessions: Set }
  const pathMap     = new Map();
  // Bot map:    botName → count
  const botMap      = new Map();
  // Referrer:   ref     → count
  const referrerMap = new Map();
  // Status:     code    → count
  const statusMap   = new Map();

  for (const ev of events) {
    const isBot = !!ev.isBot;
    if (isBot) botVisits++;

    if (typeof ev.durationMs === 'number' && isFinite(ev.durationMs)) {
      totalDurationMs += ev.durationMs;
      durationCount++;
    }

    const code = ev.statusCode || 0;
    if (code >= 400) errorCount++;

    // Session uniqueness
    if (ev.sessionHash) {
      sessionSet.add(ev.sessionHash);
    } else {
      nullSessionCnt++;
    }

    // Period bucketing
    const pk = toPeriodKey(ev.timestamp, groupBy);
    if (!periodMap.has(pk)) periodMap.set(pk, { count: 0, humanCount: 0, botCount: 0 });
    const pe = periodMap.get(pk);
    pe.count++;
    if (isBot) pe.botCount++;
    else       pe.humanCount++;

    // Path stats
    const evPath = ev.path || '(unknown)';
    if (!pathMap.has(evPath)) pathMap.set(evPath, { count: 0, sessions: new Set() });
    const pathEntry = pathMap.get(evPath);
    pathEntry.count++;
    if (ev.sessionHash) pathEntry.sessions.add(ev.sessionHash);

    // Bot names
    if (isBot && ev.botName) {
      botMap.set(ev.botName, (botMap.get(ev.botName) || 0) + 1);
    }

    // Referrers: null → "(direct)", keep all (internal and external)
    const ref = ev.referrer || '(direct)';
    referrerMap.set(ref, (referrerMap.get(ref) || 0) + 1);

    // Status codes
    statusMap.set(code, (statusMap.get(code) || 0) + 1);
  }

  const totalVisits    = events.length;
  const uniqueSessions = sessionSet.size + nullSessionCnt;

  // Top page by raw visit count
  let topPage = null, topPageVisits = 0;
  for (const [p, entry] of pathMap) {
    if (entry.count > topPageVisits) { topPageVisits = entry.count; topPage = p; }
  }

  const botPercentage = totalVisits > 0
    ? Math.round((botVisits / totalVisits) * 1000) / 10
    : 0;

  const avgResponseMs = durationCount > 0
    ? Math.round(totalDurationMs / durationCount)
    : 0;

  // Sorted by period key (lexicographic = chronological for all three formats)
  const visitsByPeriod = Array.from(periodMap.entries())
    .map(([period, d]) => ({ period, ...d }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const topPages = Array.from(pathMap.entries())
    .map(([p, e]) => ({ path: p, count: e.count, uniqueSessions: e.sessions.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  const topBots = Array.from(botMap.entries())
    .map(([botName, count]) => ({ botName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  const referrers = Array.from(referrerMap.entries())
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  const statusCodes = Array.from(statusMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totals: {
      totalVisits,
      uniqueSessions,
      topPage,
      botPercentage,
      avgResponseMs,
      errorCount,
    },
    visitsByPeriod,
    topPages,
    topBots,
    referrers,
    statusCodes,
  };
}

module.exports = { filterEvents, aggregate, determineGroupBy };
