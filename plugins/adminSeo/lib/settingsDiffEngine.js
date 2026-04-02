/**
 * SETTINGS DIFF ENGINE
 *
 * Pure logic functions for computing and formatting diffs between
 * two SEO settings data objects (snapshot vs current).
 *
 * Used by:
 * - globalSettings.ejs (client-side, inlined)
 * - Unit tests (server-side, require())
 *
 * All functions are pure (no DOM, no side effects).
 *
 * @module plugins/adminSeo/lib/settingsDiffEngine
 */

/** Max array elements to show in full; beyond this, only changed elements + "..." */
const DIFF_ARRAY_THRESHOLD = 5;

/** Returns true if value is a plain object (not array, not null) */
function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Compares two data objects and returns an array of diff entries.
 * Each entry: { path: 'dotted.path', oldValue: any, newValue: any }
 * Only changed properties are included.
 */
function computeDiff(oldData, newData) {
  if (!oldData || !newData) return [];

  const diffs = [];

  function compare(oldObj, newObj, pathPrefix) {
    const allKeys = new Set([
      ...Object.keys(oldObj || {}),
      ...Object.keys(newObj || {}),
    ]);

    for (const key of allKeys) {
      const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      const oldVal = oldObj?.[key];
      const newVal = newObj?.[key];

      // Both are plain objects (not arrays) — recurse
      if (isPlainObject(oldVal) && isPlainObject(newVal)) {
        compare(oldVal, newVal, fullPath);
        continue;
      }

      // Compare serialized values
      const oldSer = JSON.stringify(oldVal);
      const newSer = JSON.stringify(newVal);
      if (oldSer !== newSer) {
        diffs.push({ path: fullPath, oldValue: oldVal, newValue: newVal });
      }
    }
  }

  compare(oldData, newData, '');
  return diffs;
}

/**
 * Formats a value for display in the diff panel.
 * - Strings: shown in quotes
 * - Booleans/numbers: shown as-is
 * - Small arrays: shown in full, one element per line
 * - Large arrays: shown in full, one element per line
 * - Objects: formatted as indented JSON
 */
function formatDiffValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const formatted = value.map(item => {
      if (isPlainObject(item)) return '  ' + JSON.stringify(item);
      return '  ' + JSON.stringify(item);
    });
    return '[\n' + formatted.join(',\n') + '\n]';
  }

  // Objects
  return JSON.stringify(value, null, 2);
}

/**
 * Formats a diff entry for an array, showing only changed parts if the array is large.
 * Returns { oldText, newText } strings for display.
 */
function formatArrayDiff(oldArr, newArr) {
  oldArr = oldArr || [];
  newArr = newArr || [];

  const maxLen = Math.max(oldArr.length, newArr.length);

  // Small arrays: show in full
  if (maxLen <= DIFF_ARRAY_THRESHOLD) {
    return {
      oldText: formatDiffValue(oldArr),
      newText: formatDiffValue(newArr),
    };
  }

  // Large arrays: show only changed elements + "..."
  const oldLines = [];
  const newLines = [];
  let hasEllipsis = false;

  for (let i = 0; i < maxLen; i++) {
    const oldEl = i < oldArr.length ? JSON.stringify(oldArr[i]) : undefined;
    const newEl = i < newArr.length ? JSON.stringify(newArr[i]) : undefined;

    if (oldEl !== newEl) {
      oldLines.push(oldEl !== undefined ? `  [${i}] ${oldEl}` : `  [${i}] (assente)`);
      newLines.push(newEl !== undefined ? `  [${i}] ${newEl}` : `  [${i}] (assente)`);
    } else if (!hasEllipsis) {
      oldLines.push('  ...');
      newLines.push('  ...');
      hasEllipsis = true;
    }
    if (oldEl !== newEl) hasEllipsis = false;
  }

  return {
    oldText: `[  (${oldArr.length} elementi)\n${oldLines.join('\n')}\n]`,
    newText: `[  (${newArr.length} elementi)\n${newLines.join('\n')}\n]`,
  };
}

/**
 * Builds the "Before" and "After" text blocks from diff results.
 * Includes context lines (neighboring unchanged properties) around each change.
 * Returns { beforeLines, afterLines, changeCount }.
 */
function buildDiffDisplay(oldData, newData, diffs) {
  if (diffs.length === 0) return { beforeLines: [], afterLines: [], changeCount: 0 };

  const beforeLines = [];
  const afterLines = [];

  const allTopKeys = Object.keys(oldData || {});
  const changedTopKeys = new Set(diffs.map(d => d.path.split('.')[0]));

  // For context: include 1 key before and 1 key after each changed key
  const contextKeys = new Set();
  allTopKeys.forEach((key, idx) => {
    if (changedTopKeys.has(key)) {
      contextKeys.add(key);
      if (idx > 0) contextKeys.add(allTopKeys[idx - 1]);
      if (idx < allTopKeys.length - 1) contextKeys.add(allTopKeys[idx + 1]);
    }
  });

  let prevWasContext = false;

  allTopKeys.forEach(key => {
    if (!contextKeys.has(key)) {
      if (prevWasContext) {
        beforeLines.push({ type: 'separator', text: '  ---' });
        afterLines.push({ type: 'separator', text: '  ---' });
        prevWasContext = false;
      }
      return;
    }

    const keyDiffs = diffs.filter(d => d.path === key || d.path.startsWith(key + '.'));

    if (keyDiffs.length === 0) {
      // Context line (unchanged)
      const val = formatDiffValue(oldData[key]);
      const line = `  ${key}: ${val}`;
      beforeLines.push({ type: 'context', text: line });
      afterLines.push({ type: 'context', text: line });
    } else if (keyDiffs.length === 1 && keyDiffs[0].path === key) {
      // Direct top-level change
      const diff = keyDiffs[0];
      let oldText, newText;

      if (Array.isArray(diff.oldValue) || Array.isArray(diff.newValue)) {
        const arrDiff = formatArrayDiff(diff.oldValue, diff.newValue);
        oldText = `  ${key}: ${arrDiff.oldText}`;
        newText = `  ${key}: ${arrDiff.newText}`;
      } else {
        oldText = `  ${key}: ${formatDiffValue(diff.oldValue)}`;
        newText = `  ${key}: ${formatDiffValue(diff.newValue)}`;
      }

      beforeLines.push({ type: 'changed', text: oldText });
      afterLines.push({ type: 'changed', text: newText });
    } else {
      // Nested changes (e.g., organization.name, organization.url)
      const oldObj = oldData[key] || {};
      const newObj = newData[key] || {};
      const nestedKeys = Object.keys({ ...oldObj, ...newObj });

      beforeLines.push({ type: 'context', text: `  ${key}: {` });
      afterLines.push({ type: 'context', text: `  ${key}: {` });

      nestedKeys.forEach(nk => {
        const nestedPath = `${key}.${nk}`;
        const nestedDiff = keyDiffs.find(d => d.path === nestedPath);

        if (nestedDiff) {
          let oldText, newText;
          if (Array.isArray(nestedDiff.oldValue) || Array.isArray(nestedDiff.newValue)) {
            const arrDiff = formatArrayDiff(nestedDiff.oldValue, nestedDiff.newValue);
            oldText = `    ${nk}: ${arrDiff.oldText}`;
            newText = `    ${nk}: ${arrDiff.newText}`;
          } else {
            oldText = `    ${nk}: ${formatDiffValue(nestedDiff.oldValue)}`;
            newText = `    ${nk}: ${formatDiffValue(nestedDiff.newValue)}`;
          }
          beforeLines.push({ type: 'changed', text: oldText });
          afterLines.push({ type: 'changed', text: newText });
        } else {
          const val = formatDiffValue(oldObj[nk]);
          beforeLines.push({ type: 'context', text: `    ${nk}: ${val}` });
          afterLines.push({ type: 'context', text: `    ${nk}: ${val}` });
        }
      });

      beforeLines.push({ type: 'context', text: '  }' });
      afterLines.push({ type: 'context', text: '  }' });
    }

    prevWasContext = true;
  });

  return {
    beforeLines,
    afterLines,
    changeCount: diffs.length,
  };
}

/**
 * Returns the CSS class suffix for a feature tab based on its enabled state.
 * @param {object} data - The settings data object
 * @param {string} key - The feature toggle key (e.g., 'enableMetaTags')
 * @returns {'tab-feature-active'|'tab-feature-inactive'}
 */
function getTabFeatureClass(data, key) {
  const active = data?.[key] !== false;
  return active ? 'tab-feature-active' : 'tab-feature-inactive';
}

/**
 * Maps feature toggle keys to their tab button IDs and badge IDs.
 */
const FEATURE_MAP = [
  { badgeId: 'statusCanonical', key: 'enableCanonicalUrl', tabBtnId: 'tabBtn-canonical' },
  { badgeId: 'statusMetaTags', key: 'enableMetaTags', tabBtnId: 'tabBtn-metatags' },
  { badgeId: 'statusOpenGraph', key: 'enableOpenGraph', tabBtnId: 'tabBtn-opengraph' },
  { badgeId: 'statusTwitter', key: 'enableTwitterCards', tabBtnId: 'tabBtn-twitter' },
  { badgeId: 'statusStructured', key: 'enableStructuredData', tabBtnId: 'tabBtn-structured' },
  { badgeId: 'statusSitemap', key: 'enableSitemap', tabBtnId: 'tabBtn-sitemap' },
  { badgeId: 'statusRobots', key: 'enableRobotsTxt', tabBtnId: 'tabBtn-robots' },
];

module.exports = {
  DIFF_ARRAY_THRESHOLD,
  FEATURE_MAP,
  isPlainObject,
  computeDiff,
  formatDiffValue,
  formatArrayDiff,
  buildDiffDisplay,
  getTabFeatureClass,
};
