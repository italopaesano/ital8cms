'use strict';

/**
 * fileSelector.js — Selects relevant analytics JSONL files for a given date range.
 *
 * Instead of reading every file in the data directory, this module inspects the
 * date-encoded filename to determine if the file could contain events within the
 * requested [fromDate, toDate] window. This avoids loading months of history
 * when the user queries only the last 7 days.
 *
 * Supports all four rotation modes used by the analytics plugin:
 *   - none:    analytics.jsonl           → always included
 *   - daily:   analytics-YYYY-MM-DD.jsonl
 *   - monthly: analytics-YYYY-MM.jsonl
 *   - weekly:  analytics-YYYY-WXX.jsonl  (ISO 8601 weeks)
 */

const path = require('path');

/**
 * Filters a list of absolute file paths, returning only those that could
 * contain events within [fromDate, toDate].
 *
 * @param {string[]} allFiles  - Absolute paths (from analyticsApi.listDataFiles())
 * @param {Date}     fromDate  - Start of range (UTC midnight)
 * @param {Date}     toDate    - End of range (UTC end-of-day 23:59:59.999)
 * @returns {string[]}
 */
function selectFilesForRange(allFiles, fromDate, toDate) {
  return allFiles.filter(filePath => {
    const fileName = path.basename(filePath);
    return couldContainData(fileName, fromDate, toDate);
  });
}

/**
 * Returns true if the given filename could contain data within [fromDate, toDate].
 *
 * @param {string} fileName
 * @param {Date}   fromDate
 * @param {Date}   toDate
 * @returns {boolean}
 */
function couldContainData(fileName, fromDate, toDate) {
  // Rotation: none → single growing file, always include
  if (fileName === 'analytics.jsonl') return true;

  // Daily: analytics-YYYY-MM-DD.jsonl
  const daily = fileName.match(/^analytics-(\d{4}-\d{2}-\d{2})\.jsonl$/);
  if (daily) {
    const fileDay  = new Date(daily[1] + 'T00:00:00Z');
    const fromDay  = toUTCDayStart(fromDate);
    const toDay    = toUTCDayStart(toDate);
    return fileDay >= fromDay && fileDay <= toDay;
  }

  // Monthly: analytics-YYYY-MM.jsonl
  const monthly = fileName.match(/^analytics-(\d{4})-(\d{2})\.jsonl$/);
  if (monthly) {
    const year  = parseInt(monthly[1], 10);
    const month = parseInt(monthly[2], 10); // 1-based
    // File covers the entire calendar month
    const fileMonthStart = new Date(Date.UTC(year, month - 1, 1));
    const fileMonthEnd   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // last day
    return fileMonthStart <= toDate && fileMonthEnd >= fromDate;
  }

  // Weekly: analytics-YYYY-WXX.jsonl  (ISO week, Monday–Sunday)
  const weekly = fileName.match(/^analytics-(\d{4})-W(\d{2})\.jsonl$/);
  if (weekly) {
    const weekMonday = isoWeekToMonday(parseInt(weekly[1], 10), parseInt(weekly[2], 10));
    const weekSunday = new Date(weekMonday);
    weekSunday.setUTCDate(weekMonday.getUTCDate() + 6);
    weekSunday.setUTCHours(23, 59, 59, 999);
    return weekMonday <= toDate && weekSunday >= fromDate;
  }

  return false;
}

/**
 * Returns UTC midnight (00:00:00.000) for the given date.
 */
function toUTCDayStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Returns the UTC Monday of ISO week {week} in {year}.
 * ISO 8601: week 1 is the week containing January 4th.
 */
function isoWeekToMonday(year, week) {
  const jan4      = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Sunday=7, Monday=1
  const week1Mon  = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
  const weekMon   = new Date(week1Mon);
  weekMon.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return weekMon;
}

module.exports = { selectFilesForRange, couldContainData, isoWeekToMonday };
