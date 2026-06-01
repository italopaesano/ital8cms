/**
 * Unit test di configFileManager — read/write atomico + backup a rotazione.
 * Usa una directory temporanea (mai cartelle reali).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cfm = require('../../lib/configFileManager');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-arl-fm-'));
});
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('configFileManager — readRaw / writeAtomic', () => {
  test('writeAtomic scrive il contenuto e non lascia .tmp', () => {
    const file = path.join(tmpDir, 'protectedRoutes.json5');
    cfm.writeAtomic(file, '{ "rules": [] }');
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "rules": [] }');
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  test('readRaw legge il contenuto grezzo', () => {
    const file = path.join(tmpDir, 'x.json5');
    fs.writeFileSync(file, '// commento\n{ a: 1 }');
    expect(cfm.readRaw(file)).toContain('// commento');
  });
});

describe('configFileManager — backup + retention', () => {
  test('backup crea un .bak nella backupDir', () => {
    const file = path.join(tmpDir, 'protectedRoutes.json5');
    fs.writeFileSync(file, 'A');
    const backupDir = path.join(tmpDir, 'backups');
    cfm.backup(file, backupDir, 10);
    const baks = fs.readdirSync(backupDir).filter((f) => f.endsWith('.bak'));
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupDir, baks[0]), 'utf8')).toBe('A');
  });

  test('backup su file inesistente non fa nulla', () => {
    const backupDir = path.join(tmpDir, 'backups');
    cfm.backup(path.join(tmpDir, 'nope.json5'), backupDir, 10);
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  test('retention mantiene al massimo maxBackups', () => {
    const file = path.join(tmpDir, 'protectedRoutes.json5');
    fs.writeFileSync(file, 'A');
    const backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    // 5 backup pre-esistenti (nomi che ordinano prima del nuovo)
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(backupDir, `protectedRoutes.json5.2020-01-0${i}.bak`), 'old');
    }
    cfm.backup(file, backupDir, 3);
    const baks = fs.readdirSync(backupDir).filter((f) => f.endsWith('.bak'));
    expect(baks).toHaveLength(3);
  });
});
