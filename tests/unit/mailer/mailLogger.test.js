/**
 * Unit tests for mailer/lib/mailLogger.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const json5 = require('json5');

const MailLogger = require('../../../plugins/mailer/lib/mailLogger');

// ── Test helpers ──

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-logger-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function defaultConfig(overrides = {}) {
  return { enabled: true, maxEntries: 100, ...overrides };
}

function sampleEntry(overrides = {}) {
  return {
    id:         'test-id-001',
    to:         ['user@example.com'],
    subject:    'Test email',
    transport:  'fake',
    status:     'sent',
    attempts:   1,
    durationMs: 42,
    error:      null,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// MailLogger
// ══════════════════════════════════════════

describe('MailLogger', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  // ── Initialization ──

  describe('initialization', () => {
    test('creates logger instance without throwing', () => {
      expect(() => new MailLogger(tempDir, defaultConfig())).not.toThrow();
    });

    test('starts with empty entries list when no log file exists', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      expect(logger.getEntries()).toHaveLength(0);
    });

    test('loads existing entries from mailerLog.json5 on init', () => {
      const logPath = path.join(tempDir, 'mailerLog.json5');
      const existingData = {
        entries: [
          { id: 'existing-1', timestamp: '2026-01-01T00:00:00.000Z', to: ['a@b.com'], subject: 'Old email', transport: 'smtp', status: 'sent', attempts: 1, durationMs: 10, error: null },
        ],
      };
      fs.writeFileSync(logPath, JSON.stringify(existingData, null, 2), 'utf8');

      const logger = new MailLogger(tempDir, defaultConfig());
      expect(logger.getEntries()).toHaveLength(1);
      expect(logger.getEntries()[0].id).toBe('existing-1');
    });

    test('starts with empty entries when log file is corrupted', () => {
      const logPath = path.join(tempDir, 'mailerLog.json5');
      fs.writeFileSync(logPath, 'INVALID { JSON [[[', 'utf8');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = new MailLogger(tempDir, defaultConfig());
      warnSpy.mockRestore();

      expect(logger.getEntries()).toHaveLength(0);
    });

    test('does not load file when enabled=false', () => {
      const logPath = path.join(tempDir, 'mailerLog.json5');
      fs.writeFileSync(logPath, JSON.stringify({ entries: [sampleEntry()] }), 'utf8');

      const logger = new MailLogger(tempDir, defaultConfig({ enabled: false }));
      // Even if file exists, disabled logger should not load it
      expect(logger.getEntries()).toHaveLength(0);
    });
  });

  // ── log() ──

  describe('log()', () => {
    test('adds entry to the log', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry());
      expect(logger.getEntries()).toHaveLength(1);
    });

    test('does nothing when enabled=false', () => {
      const logger = new MailLogger(tempDir, defaultConfig({ enabled: false }));
      logger.log(sampleEntry());
      expect(logger.getEntries()).toHaveLength(0);
    });

    test('adds most recent entry at the top (prepend order)', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ id: 'first', subject: 'First email' }));
      logger.log(sampleEntry({ id: 'second', subject: 'Second email' }));

      const entries = logger.getEntries();
      expect(entries[0].id).toBe('second');
      expect(entries[1].id).toBe('first');
    });

    test('adds timestamp to the log entry', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      const before = Date.now();
      logger.log(sampleEntry());
      const after = Date.now();

      const entry = logger.getEntries()[0];
      expect(entry.timestamp).toBeTruthy();
      const entryTime = new Date(entry.timestamp).getTime();
      expect(entryTime).toBeGreaterThanOrEqual(before);
      expect(entryTime).toBeLessThanOrEqual(after);
    });

    test('normalizes to array when entry.to is a string', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ to: 'user@example.com' }));

      const entry = logger.getEntries()[0];
      expect(Array.isArray(entry.to)).toBe(true);
      expect(entry.to).toContain('user@example.com');
    });

    test('keeps to as array when already an array', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ to: ['a@b.com', 'c@d.com'] }));

      expect(logger.getEntries()[0].to).toEqual(['a@b.com', 'c@d.com']);
    });

    test('sets durationMs to null when not provided', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      const entry = { ...sampleEntry() };
      delete entry.durationMs;
      logger.log(entry);

      expect(logger.getEntries()[0].durationMs).toBeNull();
    });

    test('sets error to null when not provided', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      const entry = { ...sampleEntry() };
      delete entry.error;
      logger.log(entry);

      expect(logger.getEntries()[0].error).toBeNull();
    });

    test('stores error message when provided', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ status: 'dead', error: 'Connection refused' }));

      expect(logger.getEntries()[0].error).toBe('Connection refused');
    });
  });

  // ── maxEntries limit ──

  describe('maxEntries limit', () => {
    test('trims entries when maxEntries is exceeded', () => {
      const logger = new MailLogger(tempDir, defaultConfig({ maxEntries: 3 }));

      for (let i = 0; i < 5; i++) {
        logger.log(sampleEntry({ id: `entry-${i}`, subject: `Email ${i}` }));
      }

      expect(logger.getEntries()).toHaveLength(3);
    });

    test('keeps the most recent entries when trimming', () => {
      const logger = new MailLogger(tempDir, defaultConfig({ maxEntries: 2 }));

      logger.log(sampleEntry({ id: 'old-1', subject: 'Old 1' }));
      logger.log(sampleEntry({ id: 'old-2', subject: 'Old 2' }));
      logger.log(sampleEntry({ id: 'new-3', subject: 'New 3' }));

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('new-3');
      expect(entries[1].id).toBe('old-2');
    });
  });

  // ── Persistenza su disco ──

  describe('persistence', () => {
    test('persists log to mailerLog.json5 after log()', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ id: 'persist-test' }));

      const logPath = path.join(tempDir, 'mailerLog.json5');
      expect(fs.existsSync(logPath)).toBe(true);
    });

    test('saved file is valid JSON5 with JSON5 header comment', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry());

      const logPath = path.join(tempDir, 'mailerLog.json5');
      const content = fs.readFileSync(logPath, 'utf8');

      expect(content.startsWith('//')).toBe(true);
      expect(() => json5.parse(content)).not.toThrow();
    });

    test('saved file contains the logged entry', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ id: 'file-content-test', subject: 'Persisted email' }));

      const logPath = path.join(tempDir, 'mailerLog.json5');
      const content = fs.readFileSync(logPath, 'utf8');

      expect(content).toContain('file-content-test');
      expect(content).toContain('Persisted email');
    });

    test('uses atomic write (no .tmp file after save)', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry());

      const tmpPath = path.join(tempDir, 'mailerLog.json5.tmp');
      expect(fs.existsSync(tmpPath)).toBe(false);
    });

    test('persisted log survives a new logger instance (reload)', () => {
      const logger1 = new MailLogger(tempDir, defaultConfig());
      logger1.log(sampleEntry({ id: 'survives-reload', subject: 'Reload test' }));

      const logger2 = new MailLogger(tempDir, defaultConfig());
      expect(logger2.getEntries()).toHaveLength(1);
      expect(logger2.getEntries()[0].id).toBe('survives-reload');
    });

    test('does not write file when enabled=false', () => {
      const logger = new MailLogger(tempDir, defaultConfig({ enabled: false }));
      logger.log(sampleEntry());

      const logPath = path.join(tempDir, 'mailerLog.json5');
      expect(fs.existsSync(logPath)).toBe(false);
    });
  });

  // ── getEntries ──

  describe('getEntries()', () => {
    test('returns empty array when no entries', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      expect(logger.getEntries()).toEqual([]);
    });

    test('returns all logged entries', () => {
      const logger = new MailLogger(tempDir, defaultConfig());
      logger.log(sampleEntry({ id: 'a' }));
      logger.log(sampleEntry({ id: 'b' }));
      expect(logger.getEntries()).toHaveLength(2);
    });
  });
});
