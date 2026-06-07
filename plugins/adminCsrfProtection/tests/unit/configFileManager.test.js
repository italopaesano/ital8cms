'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRaw, backup, writeAtomic } = require('../../lib/configFileManager');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admincsrf-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('adminCsrfProtection · configFileManager', () => {
  test('readRaw legge il contenuto grezzo', () => {
    const f = path.join(dir, 'pluginConfig.json5');
    fs.writeFileSync(f, '// header\n{ "custom": {} }');
    expect(readRaw(f)).toContain('header');
  });

  test('readRaw lancia se il file non esiste', () => {
    expect(() => readRaw(path.join(dir, 'nope.json5'))).toThrow();
  });

  test('writeAtomic scrive in modo atomico (tmp + rename) e non lascia .tmp', () => {
    const f = path.join(dir, 'out.json5');
    writeAtomic(f, 'CONTENUTO');
    expect(fs.readFileSync(f, 'utf8')).toBe('CONTENUTO');
    expect(fs.existsSync(f + '.tmp')).toBe(false);
  });

  test('backup crea un file .bak nella dir di backup', () => {
    const f = path.join(dir, 'pluginConfig.json5');
    fs.writeFileSync(f, 'v1');
    const bdir = path.join(dir, 'backups');
    backup(f, bdir, 10);
    const baks = fs.readdirSync(bdir).filter((x) => x.endsWith('.bak'));
    expect(baks).toHaveLength(1);
    expect(baks[0].startsWith('pluginConfig.json5.')).toBe(true);
  });

  test('backup applica la retention (max N per file)', () => {
    const f = path.join(dir, 'pluginConfig.json5');
    fs.writeFileSync(f, 'current');
    const bdir = path.join(dir, 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    // pre-crea 5 backup con timestamp crescenti (i più vecchi ordinano prima)
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(bdir, `pluginConfig.json5.2026-06-0${i}T00-00-00-000Z.bak`), 'old' + i);
    }
    backup(f, bdir, 3); // crea il 6° (timestamp corrente, più recente) e pota a 3
    const baks = fs.readdirSync(bdir).filter((x) => x.endsWith('.bak'));
    expect(baks.length).toBe(3);
    // i più vecchi devono essere rimossi
    expect(baks.some((b) => b.includes('2026-06-01'))).toBe(false);
  });

  test('backup è no-op se il file sorgente non esiste', () => {
    const bdir = path.join(dir, 'backups');
    expect(() => backup(path.join(dir, 'assente.json5'), bdir, 10)).not.toThrow();
    expect(fs.existsSync(bdir)).toBe(false);
  });
});
