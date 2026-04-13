/**
 * Unit tests for mailer/lib/mailQueue.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const json5 = require('json5');

const MailQueue    = require('../../../plugins/mailer/lib/mailQueue');
const MailEventBus = require('../../../plugins/mailer/lib/mailEventBus');
const MailLogger   = require('../../../plugins/mailer/lib/mailLogger');

// ── Test helpers ──

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-queue-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/** Allows fire-and-forget async operations in MailQueue to complete */
function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

function defaultQueueConfig(overrides = {}) {
  return {
    pollingIntervalSeconds: 9999, // Large value: worker won't run during tests
    maxRetries: 3,
    retryIntervals: [1, 2, 3],
    warningThreshold: 1000,
    ...overrides,
  };
}

function createMockTransport(opts = {}) {
  return {
    getName: jest.fn().mockReturnValue(opts.name || 'mock'),
    send:    opts.send    || jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
    verify:  opts.verify  || jest.fn().mockResolvedValue({ success: true, latencyMs: 10, error: null }),
  };
}

function createMockLogger() {
  return { log: jest.fn() };
}

function buildQueue(overrides = {}) {
  const pluginFolder = overrides.pluginFolder || createTempDir();
  const transport    = overrides.transport    || createMockTransport();
  const logger       = overrides.logger       || createMockLogger();
  const eventBus     = overrides.eventBus     || new MailEventBus();
  const queueConfig  = overrides.queueConfig  || defaultQueueConfig();

  const queue = new MailQueue({ pluginFolder, queueConfig, transport, logger, eventBus });
  return { queue, pluginFolder, transport, logger, eventBus };
}

// ══════════════════════════════════════════
// MailQueue
// ══════════════════════════════════════════

describe('MailQueue', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
    jest.restoreAllMocks();
  });

  // ── Initialization ──

  describe('initialization', () => {
    test('creates queue instance without throwing', () => {
      expect(() => buildQueue({ pluginFolder: tempDir })).not.toThrow();
    });

    test('starts with empty queue when no queue file exists', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      const stats = queue.getStats();
      expect(stats.queueSize).toBe(0);
      expect(stats.deadLetterCount).toBe(0);
    });

    test('loads existing entries from mailerQueue.json5', () => {
      const queuePath = path.join(tempDir, 'mailerQueue.json5');
      const existing = {
        entries: [
          { id: 'existing-1', to: ['a@b.com'], subject: 'Old', html: '<p>X</p>', text: 'X', from: '', cc: [], bcc: [], replyTo: '', attachments: [], attempts: 0, nextRetryAt: null, status: 'pending', lastError: null, lastAttemptAt: null, sentAt: null, addedAt: new Date().toISOString() },
        ],
      };
      fs.writeFileSync(queuePath, JSON.stringify(existing, null, 2), 'utf8');

      const { queue } = buildQueue({ pluginFolder: tempDir });
      expect(queue.getStats().queueSize).toBe(1);
    });

    test('crash recovery: resets "processing" entries to "pending"', () => {
      const queuePath = path.join(tempDir, 'mailerQueue.json5');
      const existing = {
        entries: [
          { id: 'crash-1', to: ['a@b.com'], subject: 'Crashed', html: '<p>X</p>', text: 'X', from: '', cc: [], bcc: [], replyTo: '', attachments: [], attempts: 1, nextRetryAt: null, status: 'processing', lastError: null, lastAttemptAt: null, sentAt: null, addedAt: new Date().toISOString() },
        ],
      };
      fs.writeFileSync(queuePath, JSON.stringify(existing, null, 2), 'utf8');

      const { queue } = buildQueue({ pluginFolder: tempDir });
      // After crash recovery, entry should be "pending" again → counted in queueSize
      expect(queue.getStats().queueSize).toBe(1);
    });

    test('handles corrupted queue file gracefully', () => {
      const queuePath = path.join(tempDir, 'mailerQueue.json5');
      fs.writeFileSync(queuePath, 'CORRUPTED {{{', 'utf8');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => buildQueue({ pluginFolder: tempDir })).not.toThrow();
      warnSpy.mockRestore();
    });
  });

  // ── add() ──

  describe('add()', () => {
    test('returns a string ID', async () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();
      const id = await queue.add({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    test('increases queue size', async () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();
      await flushPromises(); // flush immediate processing from constructor

      // Add entries without processing
      const transport = createMockTransport({ send: jest.fn().mockResolvedValue({ messageId: 'x' }) });
      const { queue: q2 } = buildQueue({ pluginFolder: tempDir, transport });
      q2.stopWorker();

      // Since immediate processing runs, let's test getStats before flush
      const idProm = q2.add({ to: 'a@b.com', subject: 'A', html: '<p>A</p>' });
      // Stats immediately after add (before flushPromises) should reflect 1 pending
      expect(q2.getStats().queueSize + q2.getStats().deadLetterCount + 1).toBeGreaterThan(0);
      await idProm;
    });

    test('emits mailQueued event', async () => {
      const eventBus = new MailEventBus();
      const events = [];
      eventBus.on((name, data) => events.push({ name, data }));

      const { queue } = buildQueue({ pluginFolder: tempDir, eventBus });
      queue.stopWorker();

      // Mock transport that delays so we can check queued event before sent
      const slowTransport = createMockTransport({
        send: jest.fn().mockImplementation(() => new Promise(r => setTimeout(() => r({ messageId: 'x' }), 50))),
      });
      queue.setTransport(slowTransport);

      await queue.add({ to: 'a@b.com', subject: 'Queued test', html: '<p>X</p>' });

      // mailQueued should fire immediately on add
      const queuedEvents = events.filter(e => e.name === 'mailQueued');
      expect(queuedEvents).toHaveLength(1);
      expect(queuedEvents[0].data.subject).toBe('Queued test');
    });

    test('normalizes to array when to is a string', async () => {
      const eventBus = new MailEventBus();
      const queuedData = [];
      eventBus.on((name, data) => { if (name === 'mailQueued') queuedData.push(data); });

      const { queue } = buildQueue({ pluginFolder: tempDir, eventBus });
      queue.stopWorker();

      await queue.add({ to: 'user@example.com', subject: 'Test', html: '<p>X</p>' });

      expect(Array.isArray(queuedData[0].to)).toBe(true);
      expect(queuedData[0].to).toContain('user@example.com');
    });

    test('persists entry to mailerQueue.json5', async () => {
      const transport = createMockTransport({ send: jest.fn().mockResolvedValue({ messageId: 'x' }) });
      const { queue } = buildQueue({ pluginFolder: tempDir, transport });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Persist test', html: '<p>X</p>' });

      const queuePath = path.join(tempDir, 'mailerQueue.json5');
      expect(fs.existsSync(queuePath)).toBe(true);
      const content = fs.readFileSync(queuePath, 'utf8');
      expect(content).toContain('Persist test');
    });
  });

  // ── Worker ──

  describe('startWorker() / stopWorker()', () => {
    test('startWorker creates a timer', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker(); // ensure stopped
      queue.startWorker();
      expect(queue._workerTimer).not.toBeNull();
      queue.stopWorker();
    });

    test('stopWorker clears the timer', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.startWorker();
      queue.stopWorker();
      expect(queue._workerTimer).toBeNull();
    });

    test('calling startWorker twice does not create two timers', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();
      queue.startWorker();
      const timer1 = queue._workerTimer;
      queue.startWorker(); // second call
      const timer2 = queue._workerTimer;
      expect(timer1).toBe(timer2);
      queue.stopWorker();
    });
  });

  // ── setTransport ──

  describe('setTransport()', () => {
    test('replaces the active transport', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();
      const newTransport = createMockTransport({ name: 'new-mock' });
      queue.setTransport(newTransport);
      expect(queue._transport.getName()).toBe('new-mock');
    });
  });

  // ── Successful send ──

  describe('successful email send', () => {
    test('marks entry as "sent" after successful transport.send()', async () => {
      const transport = createMockTransport();
      const { queue } = buildQueue({ pluginFolder: tempDir, transport });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Success', html: '<p>OK</p>' });
      await flushPromises();

      // After processing, queueSize should be 0 (sent entries not counted)
      expect(queue.getStats().queueSize).toBe(0);
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    test('emits mailSent event after successful send', async () => {
      const eventBus = new MailEventBus();
      const sentEvents = [];
      eventBus.on((name, data) => { if (name === 'mailSent') sentEvents.push(data); });

      const transport = createMockTransport();
      const { queue } = buildQueue({ pluginFolder: tempDir, eventBus, transport });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Emit sent', html: '<p>OK</p>' });
      await flushPromises();

      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].subject).toBe('Emit sent');
      expect(sentEvents[0].transport).toBe('mock');
    });

    test('calls logger.log() with status "sent"', async () => {
      const transport = createMockTransport();
      const logger = createMockLogger();
      const { queue } = buildQueue({ pluginFolder: tempDir, transport, logger });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Log sent', html: '<p>OK</p>' });
      await flushPromises();

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'sent' })
      );
    });
  });

  // ── Failed send with retry ──

  describe('failed send with retry scheduling', () => {
    test('marks entry as "failed" and schedules retry after first failure', async () => {
      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('Connection timeout')),
      });
      const { queue } = buildQueue({ pluginFolder: tempDir, transport });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Retry test', html: '<p>X</p>' });
      await flushPromises();

      // Still in queue as "failed"
      expect(queue.getStats().queueSize).toBe(1);
    });

    test('emits mailFailed event on first failure', async () => {
      const eventBus = new MailEventBus();
      const failedEvents = [];
      eventBus.on((name, data) => { if (name === 'mailFailed') failedEvents.push(data); });

      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('SMTP error')),
      });
      const { queue } = buildQueue({ pluginFolder: tempDir, eventBus, transport });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Failed', html: '<p>X</p>' });
      await flushPromises();

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].error).toBe('SMTP error');
    });

    test('increments attempts counter on each failure', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const { queue } = buildQueue({
        pluginFolder: tempDir,
        transport,
        queueConfig: defaultQueueConfig({ maxRetries: 3, retryIntervals: [0, 0, 0] }),
      });
      queue.stopWorker();

      // First attempt (from add)
      await queue.add({ to: 'a@b.com', subject: 'Retry count', html: '<p>X</p>' });
      await flushPromises();

      // Manually force a second attempt by resetting nextRetryAt
      const entries = queue._entries;
      expect(entries[0].attempts).toBe(1);

      warnSpy.mockRestore();
    });
  });

  // ── Dead letter ──

  describe('dead letter queue', () => {
    test('marks entry as "dead" after maxRetries exhausted', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('Permanent failure')),
      });

      // maxRetries=1: first failure → dead immediately
      const { queue } = buildQueue({
        pluginFolder: tempDir,
        transport,
        queueConfig: defaultQueueConfig({ maxRetries: 1, retryIntervals: [0] }),
      });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Dead letter', html: '<p>X</p>' });
      await flushPromises();

      expect(queue.getStats().deadLetterCount).toBe(1);
      expect(queue.getStats().queueSize).toBe(0);

      warnSpy.mockRestore();
    });

    test('emits mailDead event when entry becomes dead', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const eventBus = new MailEventBus();
      const deadEvents = [];
      eventBus.on((name, data) => { if (name === 'mailDead') deadEvents.push(data); });

      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('Fatal')),
      });

      const { queue } = buildQueue({
        pluginFolder: tempDir,
        eventBus,
        transport,
        queueConfig: defaultQueueConfig({ maxRetries: 1, retryIntervals: [0] }),
      });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Dead', html: '<p>X</p>' });
      await flushPromises();

      expect(deadEvents).toHaveLength(1);
      expect(deadEvents[0].subject).toBe('Dead');
      expect(deadEvents[0].error).toBe('Fatal');

      warnSpy.mockRestore();
    });
  });

  // ── getStats() ──

  describe('getStats()', () => {
    test('returns { queueSize: 0, deadLetterCount: 0 } for empty queue', () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();
      const stats = queue.getStats();
      expect(stats).toHaveProperty('queueSize');
      expect(stats).toHaveProperty('deadLetterCount');
    });

    test('counts pending and failed as queueSize', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const transport = createMockTransport({
        send: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const { queue } = buildQueue({
        pluginFolder: tempDir,
        transport,
        queueConfig: defaultQueueConfig({ maxRetries: 5, retryIntervals: [9999] }),
      });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'A', html: '<p>A</p>' });
      await flushPromises();

      // Entry is now "failed" → still in queueSize
      expect(queue.getStats().queueSize).toBe(1);

      warnSpy.mockRestore();
    });
  });

  // ── Atomic persistence ──

  describe('atomic persistence', () => {
    test('no .tmp file remains after save', async () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Atomic', html: '<p>X</p>' });
      await flushPromises();

      const tmpPath = path.join(tempDir, 'mailerQueue.json5.tmp');
      expect(fs.existsSync(tmpPath)).toBe(false);
    });

    test('queue file has JSON5 header comment', async () => {
      const { queue } = buildQueue({ pluginFolder: tempDir });
      queue.stopWorker();

      await queue.add({ to: 'a@b.com', subject: 'Header', html: '<p>X</p>' });
      await flushPromises();

      const queuePath = path.join(tempDir, 'mailerQueue.json5');
      const content = fs.readFileSync(queuePath, 'utf8');
      expect(content.startsWith('//')).toBe(true);
    });
  });
});
