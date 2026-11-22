/**
 * Unit tests for mailer/lib/transportFactory.js
 *
 * nodemailer è mockato qui perché questi test esercitano la FABBRICA dei
 * transport, non la libreria SMTP: un mock evita connessioni reali e rende i
 * test deterministici.
 *
 * ⚠️ La nota storica diceva « plugin-only dependency (not in the main
 * package.json) », e non è vero: `nodemailer` è una dipendenza della root
 * (`^10.6.1`). La conseguenza di quella premessa sbagliata è che NESSUN test
 * caricava il pacchetto vero — vedi il blocco « il pacchetto vero » in fondo,
 * aggiunto con l'aggiornamento a 10.x.
 */

'use strict';

// `virtual: true` resta per tolleranza: il mock regge anche in un albero dove
// nodemailer non fosse installato (un plugin disinstallato, un clone parziale).
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'smtp-test-id' }),
    verify:   jest.fn().mockResolvedValue(true),
    close:    jest.fn(),
  }),
}), { virtual: true });

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { createTransport, resolveTransportName } = require('../../../plugins/mailer/lib/transportFactory');
const SmtpTransport = require('../../../plugins/mailer/lib/transports/smtpTransport');
const FakeTransport = require('../../../plugins/mailer/lib/transports/fakeTransport');

// ── Test helpers ──

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-transport-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function defaultSmtpConfig() {
  return {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'user@example.com',
    passwordEnvVar: 'MAILER_SMTP_PASSWORD_TEST',
  };
}

function defaultFakeConfig() {
  return { saveToFile: false, maxOutboxEntries: 10 };
}

// ══════════════════════════════════════════
// resolveTransportName
// ══════════════════════════════════════════

describe('resolveTransportName', () => {

  describe('"auto" transport', () => {
    test('resolves "auto" with debugMode=0 to "smtp"', () => {
      expect(resolveTransportName('auto', 0)).toBe('smtp');
    });

    test('resolves "auto" with debugMode=1 to "fake"', () => {
      expect(resolveTransportName('auto', 1)).toBe('fake');
    });

    test('resolves "auto" with debugMode=2 to "fake"', () => {
      expect(resolveTransportName('auto', 2)).toBe('fake');
    });

    test('resolves "auto" with debugMode=99 to "fake"', () => {
      expect(resolveTransportName('auto', 99)).toBe('fake');
    });
  });

  describe('explicit transport names', () => {
    test('returns "smtp" unchanged regardless of debugMode', () => {
      expect(resolveTransportName('smtp', 0)).toBe('smtp');
      expect(resolveTransportName('smtp', 1)).toBe('smtp');
    });

    test('returns "fake" unchanged regardless of debugMode', () => {
      expect(resolveTransportName('fake', 0)).toBe('fake');
      expect(resolveTransportName('fake', 1)).toBe('fake');
    });
  });
});

// ══════════════════════════════════════════
// createTransport
// ══════════════════════════════════════════

describe('createTransport', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('SMTP transport creation', () => {
    test('creates SmtpTransport when transport="smtp"', () => {
      const custom = { transport: 'smtp', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 0, tempDir);
      expect(transport).toBeInstanceOf(SmtpTransport);
    });

    test('creates SmtpTransport when transport="auto" and debugMode=0', () => {
      const custom = { transport: 'auto', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 0, tempDir);
      expect(transport).toBeInstanceOf(SmtpTransport);
    });

    test('SmtpTransport getName() returns "smtp"', () => {
      const custom = { transport: 'smtp', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 0, tempDir);
      expect(transport.getName()).toBe('smtp');
    });
  });

  describe('Fake transport creation', () => {
    test('creates FakeTransport when transport="fake"', () => {
      const custom = { transport: 'fake', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 0, tempDir);
      expect(transport).toBeInstanceOf(FakeTransport);
    });

    test('creates FakeTransport when transport="auto" and debugMode=1', () => {
      const custom = { transport: 'auto', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 1, tempDir);
      expect(transport).toBeInstanceOf(FakeTransport);
    });

    test('FakeTransport getName() returns "fake"', () => {
      const custom = { transport: 'fake', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      const transport = createTransport(custom, 0, tempDir);
      expect(transport.getName()).toBe('fake');
    });
  });

  describe('unknown transport', () => {
    test('throws for unknown transport name', () => {
      const custom = { transport: 'sendgrid', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      expect(() => createTransport(custom, 0, tempDir)).toThrow(/non riconosciuto/i);
    });

    test('error message includes the invalid transport name', () => {
      const custom = { transport: 'mailgun', smtp: defaultSmtpConfig(), fake: defaultFakeConfig() };
      expect(() => createTransport(custom, 0, tempDir)).toThrow(/mailgun/);
    });
  });
});

// ══════════════════════════════════════════
// FakeTransport (behaviour)
// ══════════════════════════════════════════

describe('FakeTransport', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    cleanupTempDir(tempDir);
  });

  test('verify() always returns success', async () => {
    const transport = new FakeTransport(defaultFakeConfig(), tempDir);
    const result = await transport.verify();
    expect(result.success).toBe(true);
    expect(result.latencyMs).toBe(0);
    expect(result.error).toBeNull();
  });

  test('send() returns a messageId', async () => {
    const transport = new FakeTransport(defaultFakeConfig(), tempDir);
    const result = await transport.send({
      to: ['user@example.com'],
      subject: 'Test',
      text: 'Hello',
    });
    expect(result).toHaveProperty('messageId');
    expect(typeof result.messageId).toBe('string');
    expect(result.messageId).toMatch(/^fake-/);
  });

  test('send() with saveToFile=true writes to mailerFakeOutbox.json5', async () => {
    const transport = new FakeTransport({ saveToFile: true, maxOutboxEntries: 10 }, tempDir);
    await transport.send({
      to: ['user@example.com'],
      subject: 'Test outbox',
      text: 'Content',
    });

    const outboxPath = path.join(tempDir, 'mailerFakeOutbox.json5');
    expect(fs.existsSync(outboxPath)).toBe(true);

    const content = JSON.parse(
      fs.readFileSync(outboxPath, 'utf8').replace(/^\/\/.*\n/, '')
    );
    expect(content.entries).toHaveLength(1);
    expect(content.entries[0].subject).toBe('Test outbox');
  });

  test('send() with saveToFile=false does not write file', async () => {
    const transport = new FakeTransport({ saveToFile: false, maxOutboxEntries: 10 }, tempDir);
    await transport.send({ to: ['a@b.com'], subject: 'X', text: 'Y' });

    const outboxPath = path.join(tempDir, 'mailerFakeOutbox.json5');
    expect(fs.existsSync(outboxPath)).toBe(false);
  });

  test('outbox respects maxOutboxEntries limit', async () => {
    const transport = new FakeTransport({ saveToFile: true, maxOutboxEntries: 2 }, tempDir);
    await transport.send({ to: ['a@b.com'], subject: 'First', text: 'A' });
    await transport.send({ to: ['a@b.com'], subject: 'Second', text: 'B' });
    await transport.send({ to: ['a@b.com'], subject: 'Third', text: 'C' });

    const outboxPath = path.join(tempDir, 'mailerFakeOutbox.json5');
    const content = JSON.parse(
      fs.readFileSync(outboxPath, 'utf8').replace(/^\/\/.*\n/, '')
    );
    expect(content.entries).toHaveLength(2);
    // Most recent first
    expect(content.entries[0].subject).toBe('Third');
    expect(content.entries[1].subject).toBe('Second');
  });
});


// ── Il pacchetto VERO, non il mock ───────────────────────────────────────────
// Aggiunto aggiornando nodemailer 9.1.0 → 10.6.1 (v3.41.0), per chiudere un buco
// che il rinvio del major aveva nominato e che nessuno aveva colmato: tutto ciò
// che riguarda nodemailer, in questa suite, parla con un mock. Quindi una suite
// verde NON diceva nulla sul pacchetto — e la 10.0.0 ha riscritto il pacchetto in
// TypeScript con doppia build ESM + CommonJS, cioè ha cambiato esattamente la
// cosa che un mock non esercita: la risoluzione del modulo.
//
// Non apre connessioni: costruisce il transporter con le stesse opzioni di
// smtpTransport.js e guarda che ci sia la superficie che il plugin chiama.
describe('nodemailer — il pacchetto vero, non il mock', () => {
  const nodemailerReale = jest.requireActual('nodemailer');

  test('`require(\'nodemailer\')` risolve la build CommonJS', () => {
    expect(typeof nodemailerReale.createTransport).toBe('function');
  });

  test('createTransport espone i tre metodi che il plugin usa', () => {
    // Le stesse opzioni di smtpTransport._buildTransporter().
    const transporter = nodemailerReale.createTransport({
      host: 'localhost', port: 25, secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    try {
      // send() → sendMail, verify() → verify, e il finally di send() → close.
      expect(typeof transporter.sendMail).toBe('function');
      expect(typeof transporter.verify).toBe('function');
      expect(typeof transporter.close).toBe('function');
    } finally {
      transporter.close();
    }
  });
});
