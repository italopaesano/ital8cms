/**
 * Unit test di attemptLog — audit JSONL con rotazione e retention.
 * Usa una directory temporanea: NON scrive mai nella cartella reale del plugin.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AttemptLog = require('../../lib/attemptLog');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-rl-log-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

describe('attemptLog — init e append', () => {
  test('init crea le directory logs/ e logs/archive/', () => {
    const al = new AttemptLog(tmpDir, { enabled: true });
    al.init();
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'logs', 'archive'))).toBe(true);
  });

  test('append scrive una riga JSONL valida con ts ISO e senza campo "at"', () => {
    const al = new AttemptLog(tmpDir, { enabled: true });
    al.init();
    const at = Date.now();
    al.append({ event: 'failure', clientId: '203.0.113.5', ruleName: 'adminLogin', at });

    const lines = readLines(path.join(tmpDir, 'logs', 'attempts.jsonl'));
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.event).toBe('failure');
    expect(rec.clientId).toBe('203.0.113.5');
    expect(rec.ruleName).toBe('adminLogin');
    expect(rec.at).toBeUndefined(); // 'at' (epoch ms) sostituito da 'ts' (ISO)
    expect(new Date(rec.ts).toISOString()).toBe(rec.ts);
  });

  test('append multipli → più righe', () => {
    const al = new AttemptLog(tmpDir, { enabled: true });
    al.init();
    al.append({ event: 'failure', clientId: 'a', ruleName: 'r', at: Date.now() });
    al.append({ event: 'shortBlock', clientId: 'a', ruleName: 'r', at: Date.now() });
    al.append({ event: 'success', clientId: 'a', ruleName: 'r', at: Date.now() });
    expect(readLines(path.join(tmpDir, 'logs', 'attempts.jsonl'))).toHaveLength(3);
  });
});

describe('attemptLog — rotazione', () => {
  test('quando il file supera rotateWhenBytes viene ruotato in archive/', () => {
    const al = new AttemptLog(tmpDir, { enabled: true, rotateWhenBytes: 5, retentionDays: 30 });
    al.init();

    // 1° append: file inesistente → nessuna rotazione, scrive line1
    al.append({ event: 'failure', clientId: 'first', ruleName: 'r', at: Date.now() });
    // 2° append: file > 5 byte → rotazione di line1 in archive, poi scrive line2
    al.append({ event: 'failure', clientId: 'second', ruleName: 'r', at: Date.now() });

    const archive = fs.readdirSync(path.join(tmpDir, 'logs', 'archive'));
    expect(archive).toHaveLength(1);

    const current = readLines(path.join(tmpDir, 'logs', 'attempts.jsonl'));
    expect(current).toHaveLength(1);
    expect(JSON.parse(current[0]).clientId).toBe('second');

    // L'archivio contiene il primo evento
    const archivedLines = readLines(path.join(tmpDir, 'logs', 'archive', archive[0]));
    expect(JSON.parse(archivedLines[0]).clientId).toBe('first');
  });
});

describe('attemptLog — retention', () => {
  test('gli archivi più vecchi di retentionDays vengono cancellati, i recenti restano', () => {
    const archiveDir = path.join(tmpDir, 'logs', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    const oldFile = path.join(archiveDir, 'attempts-old.jsonl');
    const recentFile = path.join(archiveDir, 'attempts-recent.jsonl');
    fs.writeFileSync(oldFile, '{}\n');
    fs.writeFileSync(recentFile, '{}\n');

    // mtime del vecchio file: 3 giorni fa
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, threeDaysAgo, threeDaysAgo);

    // init con retentionDays=1 → cleanup
    const al = new AttemptLog(tmpDir, { enabled: true, retentionDays: 1 });
    al.init();

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  test('retentionDays <= 0 non cancella nulla', () => {
    const archiveDir = path.join(tmpDir, 'logs', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const oldFile = path.join(archiveDir, 'attempts-old.jsonl');
    fs.writeFileSync(oldFile, '{}\n');
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, old, old);

    const al = new AttemptLog(tmpDir, { enabled: true, retentionDays: 0 });
    al.init();
    expect(fs.existsSync(oldFile)).toBe(true);
  });
});
