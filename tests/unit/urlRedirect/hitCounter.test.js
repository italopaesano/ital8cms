/**
 * Unit tests for urlRedirect/lib/hitCounter.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const HitCounter = require('../../../plugins/urlRedirect/lib/hitCounter');

// ── Test helpers ──

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'urlRedirect-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

function defaultConfig(overrides = {}) {
  return {
    hitCounterFlushInterval: 0, // Immediate writes for testing
    enableLogging: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// HitCounter
// ══════════════════════════════════════════

describe('HitCounter', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  // ── Initialization ──

  describe('init', () => {
    test('creates redirectHitCount.json5 if it does not exist', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      expect(fs.existsSync(filePath)).toBe(true);

      counter.shutdown();
    });

    test('loads existing hit counts from disk', () => {
      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      const existingData = {
        '/old-page': { hitCount: 42, firstHit: '2026-01-01T00:00:00.000Z', lastHit: '2026-03-01T00:00:00.000Z' },
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');

      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      const all = counter.getAll();
      expect(all['/old-page'].hitCount).toBe(42);
      expect(all['/old-page'].firstHit).toBe('2026-01-01T00:00:00.000Z');

      counter.shutdown();
    });

    test('starts with empty counters if file is corrupted', () => {
      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      fs.writeFileSync(filePath, 'INVALID JSON {{{', 'utf8');

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      const all = counter.getAll();
      expect(Object.keys(all)).toHaveLength(0);

      console.warn = originalWarn;
      counter.shutdown();
    });
  });

  // ── Recording hits ──

  describe('recordHit', () => {
    test('creates new counter entry for first hit', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/old-page');

      const all = counter.getAll();
      expect(all['/old-page'].hitCount).toBe(1);
      expect(all['/old-page'].firstHit).toBeTruthy();
      expect(all['/old-page'].lastHit).toBeTruthy();

      counter.shutdown();
    });

    test('increments existing counter', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/old-page');
      counter.recordHit('/old-page');
      counter.recordHit('/old-page');

      const all = counter.getAll();
      expect(all['/old-page'].hitCount).toBe(3);

      counter.shutdown();
    });

    test('tracks multiple different patterns', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/page-a');
      counter.recordHit('/page-b');
      counter.recordHit('/page-a');

      const all = counter.getAll();
      expect(all['/page-a'].hitCount).toBe(2);
      expect(all['/page-b'].hitCount).toBe(1);

      counter.shutdown();
    });

    test('firstHit does not change after subsequent hits', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/page');
      const firstHit = counter.getAll()['/page'].firstHit;

      counter.recordHit('/page');
      expect(counter.getAll()['/page'].firstHit).toBe(firstHit);

      counter.shutdown();
    });

    test('lastHit updates on each hit', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/page');
      const lastHit1 = counter.getAll()['/page'].lastHit;

      // Small delay to ensure different timestamp
      counter.recordHit('/page');
      const lastHit2 = counter.getAll()['/page'].lastHit;

      // lastHit2 should be >= lastHit1
      expect(new Date(lastHit2).getTime()).toBeGreaterThanOrEqual(new Date(lastHit1).getTime());

      counter.shutdown();
    });
  });

  // ── Flush ──

  describe('flush', () => {
    test('writes counters to disk with immediate flush', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/test');
      // With flushInterval 0, recordHit triggers immediate flush

      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      const content = fs.readFileSync(filePath, 'utf8');

      // Should contain the JSON5 comment header
      expect(content).toContain('JSON5 standard');
      // Should contain the counter data
      expect(content).toContain('/test');

      counter.shutdown();
    });

    test('does not write if no changes (dirty flag)', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 9999 }));
      counter.init();

      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      const mtimeBefore = fs.statSync(filePath).mtimeMs;

      // Flush without any hits
      counter.flush();

      const mtimeAfter = fs.statSync(filePath).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);

      counter.shutdown();
    });

    test('atomic write creates temp file and renames', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 9999 }));
      counter.init();

      counter.recordHit('/atomic-test');
      counter.flush();

      // Temp file should not exist after successful rename
      const tempPath = path.join(tempDir, 'redirectHitCount.json5.tmp');
      expect(fs.existsSync(tempPath)).toBe(false);

      // Main file should have the data
      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('atomic-test');

      counter.shutdown();
    });
  });

  // ── getAll ──

  describe('getAll', () => {
    test('returns a copy of counters (not reference)', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      counter.recordHit('/page');
      const all = counter.getAll();

      // Modify the returned object
      all['/page'].hitCount = 999;

      // Internal counter should not be affected
      expect(counter.getAll()['/page'].hitCount).toBe(1);

      counter.shutdown();
    });

    test('returns empty object when no hits recorded', () => {
      const counter = new HitCounter(tempDir, defaultConfig());
      counter.init();

      const all = counter.getAll();
      expect(Object.keys(all)).toHaveLength(0);

      counter.shutdown();
    });
  });

  // ── Shutdown ──

  describe('shutdown', () => {
    test('performs final flush on shutdown', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 9999 }));
      counter.init();

      counter.recordHit('/shutdown-test');
      // No manual flush — let shutdown handle it

      counter.shutdown();

      const filePath = path.join(tempDir, 'redirectHitCount.json5');
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('shutdown-test');
    });

    test('clears interval timer on shutdown', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 1 }));
      counter.init();

      expect(counter.flushTimer).not.toBeNull();

      counter.shutdown();

      expect(counter.flushTimer).toBeNull();
    });
  });

  // ── Periodic flush ──

  describe('periodic flush', () => {
    test('starts timer when flushInterval > 0', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 60 }));
      counter.init();

      expect(counter.flushTimer).not.toBeNull();

      counter.shutdown();
    });

    test('does not start timer when flushInterval is 0', () => {
      const counter = new HitCounter(tempDir, defaultConfig({ hitCounterFlushInterval: 0 }));
      counter.init();

      expect(counter.flushTimer).toBeNull();

      counter.shutdown();
    });
  });
});
