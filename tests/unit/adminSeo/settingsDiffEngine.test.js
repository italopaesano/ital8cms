/**
 * Unit Tests per plugins/adminSeo/lib/settingsDiffEngine.js
 *
 * Motore di diff per il confronto tra snapshot server e stato corrente
 * delle impostazioni SEO. Include: rilevamento modifiche, formattazione valori,
 * gestione array grandi/piccoli, contesto, nested objects, feature status.
 */

const {
  DIFF_ARRAY_THRESHOLD,
  FEATURE_MAP,
  isPlainObject,
  computeDiff,
  formatDiffValue,
  formatArrayDiff,
  buildDiffDisplay,
  getTabFeatureClass,
} = require('../../../plugins/adminSeo/lib/settingsDiffEngine');


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// isPlainObject
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('isPlainObject', () => {
  test('returns true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject({ nested: { deep: true } })).toBe(true);
  });

  test('returns false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  test('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  test('returns false for primitives', () => {
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// computeDiff
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('computeDiff', () => {

  describe('edge cases', () => {
    test('returns empty array when both are null', () => {
      expect(computeDiff(null, null)).toEqual([]);
    });

    test('returns empty array when oldData is null', () => {
      expect(computeDiff(null, { a: 1 })).toEqual([]);
    });

    test('returns empty array when newData is null', () => {
      expect(computeDiff({ a: 1 }, null)).toEqual([]);
    });

    test('returns empty array for identical objects', () => {
      const data = { siteName: 'Test', enableMetaTags: true };
      expect(computeDiff(data, { ...data })).toEqual([]);
    });

    test('returns empty array for empty objects', () => {
      expect(computeDiff({}, {})).toEqual([]);
    });
  });

  describe('string changes', () => {
    test('detects string value change', () => {
      const old = { siteName: 'Old' };
      const now = { siteName: 'New' };
      const diffs = computeDiff(old, now);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ path: 'siteName', oldValue: 'Old', newValue: 'New' });
    });

    test('detects empty to non-empty string', () => {
      const diffs = computeDiff({ siteUrl: '' }, { siteUrl: 'https://example.com' });
      expect(diffs).toHaveLength(1);
      expect(diffs[0].oldValue).toBe('');
      expect(diffs[0].newValue).toBe('https://example.com');
    });

    test('detects non-empty to empty string', () => {
      const diffs = computeDiff({ siteUrl: 'https://example.com' }, { siteUrl: '' });
      expect(diffs).toHaveLength(1);
    });
  });

  describe('boolean changes', () => {
    test('detects boolean toggle true→false', () => {
      const diffs = computeDiff({ enableMetaTags: true }, { enableMetaTags: false });
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ path: 'enableMetaTags', oldValue: true, newValue: false });
    });

    test('detects boolean toggle false→true', () => {
      const diffs = computeDiff({ enableSitemap: false }, { enableSitemap: true });
      expect(diffs).toHaveLength(1);
    });
  });

  describe('number changes', () => {
    test('detects number change', () => {
      const diffs = computeDiff(
        { sitemapDefaultPriority: 0.5 },
        { sitemapDefaultPriority: 0.8 }
      );
      expect(diffs).toHaveLength(1);
      expect(diffs[0].oldValue).toBe(0.5);
      expect(diffs[0].newValue).toBe(0.8);
    });
  });

  describe('array changes', () => {
    test('detects array element added', () => {
      const diffs = computeDiff(
        { sitemapExclude: ['a'] },
        { sitemapExclude: ['a', 'b'] }
      );
      expect(diffs).toHaveLength(1);
      expect(diffs[0].path).toBe('sitemapExclude');
    });

    test('detects array element removed', () => {
      const diffs = computeDiff(
        { sitemapExclude: ['a', 'b'] },
        { sitemapExclude: ['a'] }
      );
      expect(diffs).toHaveLength(1);
    });

    test('detects array element changed', () => {
      const diffs = computeDiff(
        { sitemapExclude: ['a', 'b'] },
        { sitemapExclude: ['a', 'c'] }
      );
      expect(diffs).toHaveLength(1);
    });

    test('identical arrays produce no diff', () => {
      const diffs = computeDiff(
        { sitemapExclude: ['a', 'b'] },
        { sitemapExclude: ['a', 'b'] }
      );
      expect(diffs).toHaveLength(0);
    });

    test('empty to non-empty array', () => {
      const diffs = computeDiff(
        { socialProfiles: [] },
        { socialProfiles: ['https://x.com/test'] }
      );
      expect(diffs).toHaveLength(1);
    });
  });

  describe('nested object changes', () => {
    test('detects change inside nested object', () => {
      const old = { organization: { name: 'Old Corp', url: 'https://old.com' } };
      const now = { organization: { name: 'New Corp', url: 'https://old.com' } };
      const diffs = computeDiff(old, now);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({
        path: 'organization.name',
        oldValue: 'Old Corp',
        newValue: 'New Corp',
      });
    });

    test('detects multiple changes inside nested object', () => {
      const old = { organization: { name: 'Old', url: 'https://old.com', logo: '' } };
      const now = { organization: { name: 'New', url: 'https://new.com', logo: '' } };
      const diffs = computeDiff(old, now);
      expect(diffs).toHaveLength(2);
      expect(diffs.map(d => d.path)).toEqual(['organization.name', 'organization.url']);
    });

    test('nested object unchanged produces no diff', () => {
      const org = { name: 'Corp', url: 'https://corp.com' };
      const diffs = computeDiff({ organization: { ...org } }, { organization: { ...org } });
      expect(diffs).toHaveLength(0);
    });

    test('detects array change inside nested object', () => {
      const old = { organization: { socialProfiles: ['a'] } };
      const now = { organization: { socialProfiles: ['a', 'b'] } };
      const diffs = computeDiff(old, now);
      expect(diffs).toHaveLength(1);
      expect(diffs[0].path).toBe('organization.socialProfiles');
    });
  });

  describe('multiple changes', () => {
    test('detects multiple top-level changes', () => {
      const old = { siteName: 'Old', siteUrl: '', enableMetaTags: true };
      const now = { siteName: 'New', siteUrl: 'https://x.com', enableMetaTags: false };
      const diffs = computeDiff(old, now);
      expect(diffs).toHaveLength(3);
    });

    test('detects new key added', () => {
      const diffs = computeDiff({ a: 1 }, { a: 1, b: 2 });
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ path: 'b', oldValue: undefined, newValue: 2 });
    });

    test('detects key removed', () => {
      const diffs = computeDiff({ a: 1, b: 2 }, { a: 1 });
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ path: 'b', oldValue: 2, newValue: undefined });
    });
  });

  describe('realistic SEO data', () => {
    const baseData = {
      siteName: 'Azienda XYZ',
      siteUrl: 'https://www.example.com',
      enableMetaTags: true,
      enableOpenGraph: true,
      enableTwitterCards: true,
      enableCanonicalUrl: true,
      enableStructuredData: true,
      enableSitemap: true,
      enableRobotsTxt: true,
      canonicalCleanUrl: true,
      defaultDescription: 'Description',
      defaultKeywords: 'keywords',
      defaultRobots: 'index, follow',
      defaultOgType: 'website',
      defaultOgImage: '/img/og.jpg',
      twitterCardType: 'summary_large_image',
      twitterHandle: '@azienda',
      organization: {
        name: 'Azienda XYZ',
        url: 'https://www.example.com',
        logo: '/logo.png',
        contactEmail: 'info@example.com',
        contactPhone: '+39 123 456',
        socialProfiles: ['https://x.com/azienda', 'https://linkedin.com/azienda'],
      },
      sitemapAutoScan: true,
      sitemapDefaultChangefreq: 'monthly',
      sitemapDefaultPriority: 0.5,
      sitemapExclude: ['**/*test*', '**/navbarExamples/**'],
      sitemapExtraPages: [],
      robotsTxtRules: {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/admin/', '/api/'],
      },
    };

    test('no changes on identical realistic data', () => {
      const diffs = computeDiff(baseData, JSON.parse(JSON.stringify(baseData)));
      expect(diffs).toHaveLength(0);
    });

    test('detects toggle + string change in realistic data', () => {
      const modified = { ...baseData, enableOpenGraph: false, siteName: 'New Name' };
      const diffs = computeDiff(baseData, modified);
      expect(diffs).toHaveLength(2);
      expect(diffs.map(d => d.path).sort()).toEqual(['enableOpenGraph', 'siteName']);
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// formatDiffValue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('formatDiffValue', () => {

  describe('primitives', () => {
    test('undefined → "undefined"', () => {
      expect(formatDiffValue(undefined)).toBe('undefined');
    });

    test('null → "null"', () => {
      expect(formatDiffValue(null)).toBe('null');
    });

    test('strings are wrapped in quotes', () => {
      expect(formatDiffValue('hello')).toBe('"hello"');
    });

    test('empty string → ""', () => {
      expect(formatDiffValue('')).toBe('""');
    });

    test('booleans shown as-is', () => {
      expect(formatDiffValue(true)).toBe('true');
      expect(formatDiffValue(false)).toBe('false');
    });

    test('numbers shown as-is', () => {
      expect(formatDiffValue(42)).toBe('42');
      expect(formatDiffValue(0.5)).toBe('0.5');
      expect(formatDiffValue(0)).toBe('0');
    });
  });

  describe('arrays', () => {
    test('empty array → "[]"', () => {
      expect(formatDiffValue([])).toBe('[]');
    });

    test('string array formatted with one element per line', () => {
      const result = formatDiffValue(['a', 'b', 'c']);
      expect(result).toContain('[\n');
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
      expect(result).toContain('"c"');
      expect(result).toContain('\n]');
    });

    test('array of objects formatted', () => {
      const result = formatDiffValue([{ url: '/page', priority: 0.8 }]);
      expect(result).toContain('[\n');
      expect(result).toContain('"url"');
      expect(result).toContain('/page');
    });
  });

  describe('objects', () => {
    test('objects formatted as indented JSON', () => {
      const result = formatDiffValue({ a: 1, b: 'test' });
      expect(result).toContain('"a": 1');
      expect(result).toContain('"b": "test"');
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// formatArrayDiff
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('formatArrayDiff', () => {

  describe('small arrays (≤ threshold)', () => {
    test('both empty', () => {
      const result = formatArrayDiff([], []);
      expect(result.oldText).toBe('[]');
      expect(result.newText).toBe('[]');
    });

    test('shows full content for small arrays', () => {
      const result = formatArrayDiff(['a'], ['a', 'b']);
      expect(result.oldText).toContain('"a"');
      expect(result.newText).toContain('"a"');
      expect(result.newText).toContain('"b"');
    });

    test('arrays at exactly threshold size shown in full', () => {
      const arr = Array.from({ length: DIFF_ARRAY_THRESHOLD }, (_, i) => `item${i}`);
      const result = formatArrayDiff(arr, arr);
      // Both shown in full (via formatDiffValue)
      expect(result.oldText).toContain('item0');
      expect(result.oldText).toContain(`item${DIFF_ARRAY_THRESHOLD - 1}`);
    });

    test('null arrays treated as empty', () => {
      const result = formatArrayDiff(null, ['a']);
      expect(result.oldText).toBe('[]');
      expect(result.newText).toContain('"a"');
    });
  });

  describe('large arrays (> threshold)', () => {
    const large = Array.from({ length: 8 }, (_, i) => `item${i}`);

    test('shows element count', () => {
      const modified = [...large];
      modified[3] = 'CHANGED';
      const result = formatArrayDiff(large, modified);
      expect(result.oldText).toContain(`(${large.length} elementi)`);
      expect(result.newText).toContain(`(${modified.length} elementi)`);
    });

    test('shows changed elements with index', () => {
      const modified = [...large];
      modified[3] = 'CHANGED';
      const result = formatArrayDiff(large, modified);
      expect(result.oldText).toContain('[3]');
      expect(result.oldText).toContain('"item3"');
      expect(result.newText).toContain('[3]');
      expect(result.newText).toContain('"CHANGED"');
    });

    test('shows "..." for unchanged elements', () => {
      const modified = [...large];
      modified[3] = 'CHANGED';
      const result = formatArrayDiff(large, modified);
      expect(result.oldText).toContain('...');
    });

    test('added element shows (assente) in old', () => {
      const longer = [...large, 'new_item'];
      const result = formatArrayDiff(large, longer);
      expect(result.oldText).toContain('(assente)');
      expect(result.newText).toContain('"new_item"');
    });

    test('removed element shows (assente) in new', () => {
      const shorter = large.slice(0, -1);
      const result = formatArrayDiff(large, shorter);
      expect(result.newText).toContain('(assente)');
    });

    test('multiple scattered changes show multiple ellipsis blocks', () => {
      const modified = [...large];
      modified[0] = 'FIRST';
      modified[7] = 'LAST';
      const result = formatArrayDiff(large, modified);
      // Should have "..." between the two changed elements
      expect(result.oldText).toContain('[0]');
      expect(result.oldText).toContain('[7]');
      expect(result.oldText).toContain('...');
    });
  });

  describe('arrays of objects (sitemapExtraPages)', () => {
    test('small array of objects shown in full', () => {
      const old = [{ url: '/a', priority: 0.5 }];
      const now = [{ url: '/a', priority: 0.8 }];
      const result = formatArrayDiff(old, now);
      expect(result.oldText).toContain('/a');
      expect(result.oldText).toContain('0.5');
      expect(result.newText).toContain('0.8');
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// buildDiffDisplay
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('buildDiffDisplay', () => {

  describe('no changes', () => {
    test('returns empty arrays and changeCount 0', () => {
      const result = buildDiffDisplay({ a: 1 }, { a: 1 }, []);
      expect(result.beforeLines).toEqual([]);
      expect(result.afterLines).toEqual([]);
      expect(result.changeCount).toBe(0);
    });
  });

  describe('changeCount', () => {
    test('matches number of diffs', () => {
      const old = { a: 1, b: 2, c: 3 };
      const now = { a: 10, b: 20, c: 3 };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.changeCount).toBe(2);
    });
  });

  describe('line types', () => {
    test('changed properties have type "changed"', () => {
      const old = { a: 1 };
      const now = { a: 2 };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.beforeLines.some(l => l.type === 'changed')).toBe(true);
      expect(display.afterLines.some(l => l.type === 'changed')).toBe(true);
    });

    test('unchanged neighbors have type "context"', () => {
      const old = { a: 1, b: 2, c: 3 };
      const now = { a: 1, b: 20, c: 3 };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      // a and c are context (neighbors of b)
      const contextTexts = display.beforeLines.filter(l => l.type === 'context').map(l => l.text);
      expect(contextTexts.some(t => t.includes('a:'))).toBe(true);
      expect(contextTexts.some(t => t.includes('c:'))).toBe(true);
    });

    test('separator between non-adjacent groups', () => {
      // a, b, c, d, e — change a and e → context includes b and d, c is skipped → separator
      const old = { a: 1, b: 2, c: 3, d: 4, e: 5 };
      const now = { a: 10, b: 2, c: 3, d: 4, e: 50 };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.beforeLines.some(l => l.type === 'separator')).toBe(true);
    });
  });

  describe('context lines', () => {
    test('includes 1 neighbor before changed key', () => {
      const old = { before: 'x', target: 'old', after: 'y' };
      const now = { before: 'x', target: 'new', after: 'y' };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      const texts = display.beforeLines.map(l => l.text);
      expect(texts.some(t => t.includes('before:'))).toBe(true);
    });

    test('includes 1 neighbor after changed key', () => {
      const old = { before: 'x', target: 'old', after: 'y' };
      const now = { before: 'x', target: 'new', after: 'y' };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      const texts = display.beforeLines.map(l => l.text);
      expect(texts.some(t => t.includes('after:'))).toBe(true);
    });

    test('first key changed: no "before" neighbor exists', () => {
      const old = { first: 'old', second: 'x' };
      const now = { first: 'new', second: 'x' };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      // Should not crash, second is context after
      expect(display.changeCount).toBe(1);
      const texts = display.beforeLines.map(l => l.text);
      expect(texts.some(t => t.includes('second:'))).toBe(true);
    });

    test('last key changed: no "after" neighbor exists', () => {
      const old = { first: 'x', last: 'old' };
      const now = { first: 'x', last: 'new' };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.changeCount).toBe(1);
      const texts = display.beforeLines.map(l => l.text);
      expect(texts.some(t => t.includes('first:'))).toBe(true);
    });
  });

  describe('nested object changes', () => {
    test('nested change shows parent object with braces', () => {
      const old = { org: { name: 'Old', url: 'https://old.com' } };
      const now = { org: { name: 'New', url: 'https://old.com' } };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);

      const beforeTexts = display.beforeLines.map(l => l.text);
      expect(beforeTexts.some(t => t.includes('org: {'))).toBe(true);
      expect(beforeTexts.some(t => t.includes('}'))).toBe(true);
    });

    test('unchanged nested properties are context', () => {
      const old = { org: { name: 'Old', url: 'https://same.com' } };
      const now = { org: { name: 'New', url: 'https://same.com' } };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);

      const contextLines = display.beforeLines.filter(l => l.type === 'context');
      expect(contextLines.some(l => l.text.includes('url:'))).toBe(true);
    });

    test('changed nested properties are marked changed', () => {
      const old = { org: { name: 'Old', url: 'https://same.com' } };
      const now = { org: { name: 'New', url: 'https://same.com' } };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);

      const changedBefore = display.beforeLines.filter(l => l.type === 'changed');
      const changedAfter = display.afterLines.filter(l => l.type === 'changed');
      expect(changedBefore.some(l => l.text.includes('name:') && l.text.includes('Old'))).toBe(true);
      expect(changedAfter.some(l => l.text.includes('name:') && l.text.includes('New'))).toBe(true);
    });

    test('nested array change handled', () => {
      const old = { org: { profiles: ['a'] } };
      const now = { org: { profiles: ['a', 'b'] } };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.changeCount).toBe(1);
      const changedAfter = display.afterLines.filter(l => l.type === 'changed');
      expect(changedAfter.length).toBeGreaterThan(0);
    });
  });

  describe('before/after line symmetry', () => {
    test('beforeLines and afterLines have same length', () => {
      const old = { a: 1, b: 'x', c: true };
      const now = { a: 2, b: 'y', c: true };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      expect(display.beforeLines.length).toBe(display.afterLines.length);
    });

    test('line types match between before and after', () => {
      const old = { a: 1, b: 2, c: 3, d: 4, e: 5 };
      const now = { a: 10, b: 2, c: 3, d: 4, e: 50 };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      for (let i = 0; i < display.beforeLines.length; i++) {
        expect(display.beforeLines[i].type).toBe(display.afterLines[i].type);
      }
    });

    test('context lines are identical between before and after', () => {
      const old = { a: 'unchanged', b: 'old', c: 'unchanged' };
      const now = { a: 'unchanged', b: 'new', c: 'unchanged' };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      const beforeCtx = display.beforeLines.filter(l => l.type === 'context');
      const afterCtx = display.afterLines.filter(l => l.type === 'context');
      expect(beforeCtx).toEqual(afterCtx);
    });
  });

  describe('array changes in display', () => {
    test('small array change shown in full', () => {
      const old = { items: ['a', 'b'] };
      const now = { items: ['a', 'c'] };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      const changedBefore = display.beforeLines.filter(l => l.type === 'changed');
      expect(changedBefore[0].text).toContain('"b"');
    });

    test('large array change shows truncated form', () => {
      const old = { items: Array.from({ length: 8 }, (_, i) => `v${i}`) };
      const now = { items: Array.from({ length: 8 }, (_, i) => i === 3 ? 'CHANGED' : `v${i}`) };
      const diffs = computeDiff(old, now);
      const display = buildDiffDisplay(old, now, diffs);
      const changedBefore = display.beforeLines.filter(l => l.type === 'changed');
      expect(changedBefore[0].text).toContain('elementi');
    });
  });

  describe('realistic full data diff', () => {
    const fullOld = {
      siteName: 'Old Site',
      siteUrl: 'https://old.com',
      enableMetaTags: true,
      enableOpenGraph: true,
      enableCanonicalUrl: true,
      defaultDescription: 'Old description',
      organization: {
        name: 'Old Corp',
        url: 'https://old.com',
        logo: '/old-logo.png',
      },
      sitemapExclude: ['**/*test*'],
    };

    const fullNew = {
      siteName: 'New Site',
      siteUrl: 'https://new.com',
      enableMetaTags: true,
      enableOpenGraph: false,
      enableCanonicalUrl: true,
      defaultDescription: 'New description',
      organization: {
        name: 'New Corp',
        url: 'https://new.com',
        logo: '/old-logo.png',
      },
      sitemapExclude: ['**/*test*', '**/draft/**'],
    };

    test('detects all changes across all levels', () => {
      const diffs = computeDiff(fullOld, fullNew);
      const display = buildDiffDisplay(fullOld, fullNew, diffs);

      // 6 changes: siteName, siteUrl, enableOpenGraph, defaultDescription, org.name, org.url, sitemapExclude
      expect(display.changeCount).toBe(7);
    });

    test('display contains changed and context lines', () => {
      const diffs = computeDiff(fullOld, fullNew);
      const display = buildDiffDisplay(fullOld, fullNew, diffs);
      const types = new Set(display.beforeLines.map(l => l.type));
      expect(types.has('changed')).toBe(true);
      expect(types.has('context')).toBe(true);
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// getTabFeatureClass
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('getTabFeatureClass', () => {

  test('returns "tab-feature-active" when feature is true', () => {
    expect(getTabFeatureClass({ enableMetaTags: true }, 'enableMetaTags')).toBe('tab-feature-active');
  });

  test('returns "tab-feature-inactive" when feature is false', () => {
    expect(getTabFeatureClass({ enableMetaTags: false }, 'enableMetaTags')).toBe('tab-feature-inactive');
  });

  test('returns "tab-feature-active" when key is missing (defaults to not-false)', () => {
    expect(getTabFeatureClass({}, 'enableMetaTags')).toBe('tab-feature-active');
  });

  test('returns "tab-feature-active" when data is null', () => {
    expect(getTabFeatureClass(null, 'enableMetaTags')).toBe('tab-feature-active');
  });

  test('all 7 feature toggles', () => {
    const allEnabled = {
      enableCanonicalUrl: true,
      enableMetaTags: true,
      enableOpenGraph: true,
      enableTwitterCards: true,
      enableStructuredData: true,
      enableSitemap: true,
      enableRobotsTxt: true,
    };
    const allDisabled = {
      enableCanonicalUrl: false,
      enableMetaTags: false,
      enableOpenGraph: false,
      enableTwitterCards: false,
      enableStructuredData: false,
      enableSitemap: false,
      enableRobotsTxt: false,
    };

    FEATURE_MAP.forEach(f => {
      expect(getTabFeatureClass(allEnabled, f.key)).toBe('tab-feature-active');
      expect(getTabFeatureClass(allDisabled, f.key)).toBe('tab-feature-inactive');
    });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FEATURE_MAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('FEATURE_MAP', () => {

  test('contains exactly 7 features', () => {
    expect(FEATURE_MAP).toHaveLength(7);
  });

  test('all entries have required fields', () => {
    FEATURE_MAP.forEach(f => {
      expect(f).toHaveProperty('badgeId');
      expect(f).toHaveProperty('key');
      expect(f).toHaveProperty('tabBtnId');
      expect(typeof f.badgeId).toBe('string');
      expect(typeof f.key).toBe('string');
      expect(typeof f.tabBtnId).toBe('string');
    });
  });

  test('all keys start with "enable"', () => {
    FEATURE_MAP.forEach(f => {
      expect(f.key).toMatch(/^enable/);
    });
  });

  test('all tabBtnIds start with "tabBtn-"', () => {
    FEATURE_MAP.forEach(f => {
      expect(f.tabBtnId).toMatch(/^tabBtn-/);
    });
  });

  test('all badgeIds start with "status"', () => {
    FEATURE_MAP.forEach(f => {
      expect(f.badgeId).toMatch(/^status/);
    });
  });

  test('no duplicate keys', () => {
    const keys = FEATURE_MAP.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('no duplicate tabBtnIds', () => {
    const ids = FEATURE_MAP.map(f => f.tabBtnId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no duplicate badgeIds', () => {
    const ids = FEATURE_MAP.map(f => f.badgeId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DIFF_ARRAY_THRESHOLD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('DIFF_ARRAY_THRESHOLD', () => {
  test('is a positive integer', () => {
    expect(Number.isInteger(DIFF_ARRAY_THRESHOLD)).toBe(true);
    expect(DIFF_ARRAY_THRESHOLD).toBeGreaterThan(0);
  });

  test('is 5', () => {
    expect(DIFF_ARRAY_THRESHOLD).toBe(5);
  });
});
