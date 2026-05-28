/**
 * Unit Tests per il parser di git progress in plugins/admin/pluginsInstall.js.
 *
 * Il parser è identico a quello di themesInstall (entrambi processano output
 * di `git clone --progress`). Mantenere test paralleli garantisce che future
 * divergenze tra i due moduli vengano subito rilevate.
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const {
  _parseGitProgressLine: parseGitProgressLine,
  _validateRepoUrl: validateRepoUrl,
  _extractPluginNameFromUrl: extractPluginNameFromUrl,
} = require(
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

describe('pluginsInstall — validateRepoUrl', () => {
  describe('HTTPS', () => {
    test('accetta HTTPS pubblico e marca protocol=https', () => {
      const r = validateRepoUrl('https://github.com/u/ital8cms-plugin-mailerSimple.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('https');
    });

    test('accetta HTTPS con credenziali inline (protocol=https)', () => {
      const r = validateRepoUrl('https://u:token@github.com/u/ital8cms-plugin-mailerSimple.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('https');
    });
  });

  describe('SSH', () => {
    test('accetta scp-like git@host:owner/repo.git e marca protocol=ssh', () => {
      const r = validateRepoUrl('git@github.com:u/ital8cms-plugin-mailerSimple.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('ssh');
    });

    test('accetta ssh:// URL e marca protocol=ssh', () => {
      const r = validateRepoUrl('ssh://git@github.com/u/ital8cms-plugin-mailerSimple.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('ssh');
    });
  });

  describe('Rifiuti', () => {
    test('rifiuta URL vuoto e non-stringa', () => {
      expect(validateRepoUrl('').ok).toBe(false);
      expect(validateRepoUrl(null).ok).toBe(false);
      expect(validateRepoUrl(42).ok).toBe(false);
    });

    test('rifiuta http:// e URL senza .git', () => {
      expect(validateRepoUrl('http://github.com/u/ital8cms-plugin-x.git').ok).toBe(false);
      expect(validateRepoUrl('https://github.com/u/ital8cms-plugin-x').ok).toBe(false);
      expect(validateRepoUrl('git@github.com:u/ital8cms-plugin-x').ok).toBe(false);
    });

    test('rifiuta protocolli non supportati', () => {
      expect(validateRepoUrl('file:///tmp/repo.git').ok).toBe(false);
      expect(validateRepoUrl('ftp://host/repo.git').ok).toBe(false);
    });
  });
});

describe('pluginsInstall — extractPluginNameFromUrl (parsing multi-formato)', () => {
  const PREFIX = 'ital8cms-plugin-';

  test('estrae nome da HTTPS', () => {
    const r = extractPluginNameFromUrl('https://github.com/u/ital8cms-plugin-mailerSimple.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('mailerSimple');
  });

  test('estrae nome da HTTPS con credenziali inline', () => {
    const r = extractPluginNameFromUrl('https://u:token@github.com/u/ital8cms-plugin-mailerSimple.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('mailerSimple');
  });

  test('estrae nome da scp-like SSH', () => {
    const r = extractPluginNameFromUrl('git@github.com:u/ital8cms-plugin-mailerSimple.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('mailerSimple');
  });

  test('estrae nome da ssh:// URL', () => {
    const r = extractPluginNameFromUrl('ssh://git@github.com/u/ital8cms-plugin-mailerSimple.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('mailerSimple');
  });

  test('rifiuta repo che non rispetta il prefisso (scp-like)', () => {
    const r = extractPluginNameFromUrl('git@github.com:u/wrong-prefix-x.git', PREFIX);
    expect(r.ok).toBe(false);
  });
});
