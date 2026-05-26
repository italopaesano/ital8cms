/**
 * Unit Tests per il parser di git progress in plugins/admin/pluginsInstall.js.
 *
 * Il parser è identico a quello di themesInstall (entrambi processano output
 * di `git clone --progress`). Mantenere test paralleli garantisce che future
 * divergenze tra i due moduli vengano subito rilevate.
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { _parseGitProgressLine: parseGitProgressLine } = require(
  path.join(PROJECT_ROOT, 'plugins', 'admin', 'pluginsInstall')
);

describe('pluginsInstall — parseGitProgressLine', () => {
  describe('Receiving objects', () => {
    test('parsa percentuale, current/total, bytes e rate', () => {
      const r = parseGitProgressLine('Receiving objects:  45% (123/270), 1.20 MiB | 800.00 KiB/s');
      expect(r).toEqual({
        stage: 'receiving',
        percent: 45,
        current: 123,
        total: 270,
        bytes: '1.20 MiB',
        rate: '800.00 KiB/s',
      });
    });

    test('parsa anche senza bytes/rate (inizio download)', () => {
      const r = parseGitProgressLine('Receiving objects:   0% (1/270)');
      expect(r).toEqual({
        stage: 'receiving',
        percent: 0,
        current: 1,
        total: 270,
        bytes: null,
        rate: null,
      });
    });

    test('riconosce 100% di completamento', () => {
      const r = parseGitProgressLine('Receiving objects: 100% (270/270), 5.04 MiB | 12.50 MiB/s, done.');
      expect(r.stage).toBe('receiving');
      expect(r.percent).toBe(100);
      expect(r.current).toBe(270);
      expect(r.total).toBe(270);
    });
  });

  describe('Resolving deltas', () => {
    test('parsa percentuale e current/total (no bytes)', () => {
      const r = parseGitProgressLine('Resolving deltas:  60% (50/83)');
      expect(r).toEqual({
        stage: 'resolving',
        percent: 60,
        current: 50,
        total: 83,
        bytes: null,
        rate: null,
      });
    });
  });

  describe('Updating files', () => {
    test('parsa percentuale e current/total', () => {
      const r = parseGitProgressLine('Updating files:  80% (40/50)');
      expect(r).toEqual({
        stage: 'updatingFiles',
        percent: 80,
        current: 40,
        total: 50,
        bytes: null,
        rate: null,
      });
    });
  });

  describe('Righe non riconosciute', () => {
    test('ritorna null per righe vuote o non-progress', () => {
      expect(parseGitProgressLine('')).toBeNull();
      expect(parseGitProgressLine('Cloning into ...')).toBeNull();
      expect(parseGitProgressLine('remote: Counting objects: 270, done.')).toBeNull();
      expect(parseGitProgressLine('error: pathspec did not match')).toBeNull();
    });

    test('ritorna null per input non-stringa', () => {
      expect(parseGitProgressLine(null)).toBeNull();
      expect(parseGitProgressLine(undefined)).toBeNull();
      expect(parseGitProgressLine(42)).toBeNull();
      expect(parseGitProgressLine({})).toBeNull();
    });
  });
});
