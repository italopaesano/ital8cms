/**
 * Unit Tests per plugins/admin/themesInstall.js
 *
 * Copre il parser delle righe di progress emesse da `git clone --progress`.
 */

const {
  _parseGitProgressLine: parseGitProgressLine,
  _validateRepoUrl: validateRepoUrl,
  _extractThemeNameFromUrl: extractThemeNameFromUrl,
} = require('../../../plugins/admin/themesInstall');

describe('themesInstall — parseGitProgressLine', () => {
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

    test('parsa percent 100 di chiusura', () => {
      const r = parseGitProgressLine('Receiving objects: 100% (270/270), 5.42 MiB | 2.10 MiB/s, done.');
      expect(r.stage).toBe('receiving');
      expect(r.percent).toBe(100);
      expect(r.current).toBe(270);
      expect(r.total).toBe(270);
      expect(r.bytes).toBe('5.42 MiB');
      expect(r.rate).toBe('2.10 MiB/s');
    });

    test('parsa con bytes in KiB', () => {
      const r = parseGitProgressLine('Receiving objects:  30% (50/166), 120.50 KiB | 400.00 KiB/s');
      expect(r.bytes).toBe('120.50 KiB');
      expect(r.rate).toBe('400.00 KiB/s');
    });
  });

  describe('Resolving deltas', () => {
    test('parsa percentuale e current/total', () => {
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

    test('parsa percent 100', () => {
      const r = parseGitProgressLine('Resolving deltas: 100% (83/83), done.');
      expect(r.stage).toBe('resolving');
      expect(r.percent).toBe(100);
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

    test('parsa percent 100 di chiusura checkout', () => {
      const r = parseGitProgressLine('Updating files: 100% (50/50), done.');
      expect(r.stage).toBe('updatingFiles');
      expect(r.percent).toBe(100);
      expect(r.current).toBe(50);
      expect(r.total).toBe(50);
    });
  });

  describe('Righe non-progress', () => {
    test('ritorna null per riga "Cloning into ..."', () => {
      expect(parseGitProgressLine("Cloning into 'themes/foo'...")).toBeNull();
    });

    test('ritorna null per riga "remote: Enumerating objects: 270, done."', () => {
      expect(parseGitProgressLine('remote: Enumerating objects: 270, done.')).toBeNull();
    });

    test('ritorna null per riga "remote: Counting objects: 100% (270/270), done."', () => {
      expect(parseGitProgressLine('remote: Counting objects: 100% (270/270), done.')).toBeNull();
    });

    test('ritorna null per stringa vuota', () => {
      expect(parseGitProgressLine('')).toBeNull();
    });

    test('ritorna null per riga arbitraria', () => {
      expect(parseGitProgressLine('error: pathspec did not match any files')).toBeNull();
    });
  });

  describe('Robustezza input', () => {
    test('ritorna null per null', () => {
      expect(parseGitProgressLine(null)).toBeNull();
    });

    test('ritorna null per undefined', () => {
      expect(parseGitProgressLine(undefined)).toBeNull();
    });

    test('ritorna null per numero', () => {
      expect(parseGitProgressLine(42)).toBeNull();
    });

    test('riconosce riga con whitespace iniziale (output \\r-terminated tipico)', () => {
      const r = parseGitProgressLine('  Receiving objects:  10% (27/270)');
      expect(r).not.toBeNull();
      expect(r.percent).toBe(10);
    });
  });
});

describe('themesInstall — validateRepoUrl', () => {
  describe('HTTPS', () => {
    test('accetta HTTPS pubblico e marca protocol=https', () => {
      const r = validateRepoUrl('https://github.com/utente/ital8cms-theme-mySite.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('https');
      expect(r.value).toBe('https://github.com/utente/ital8cms-theme-mySite.git');
    });

    test('accetta HTTPS con credenziali inline (protocol=https)', () => {
      const r = validateRepoUrl('https://utente:ghp_token@github.com/utente/ital8cms-theme-mySite.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('https');
    });

    test('trimma whitespace circostante', () => {
      const r = validateRepoUrl('  https://github.com/u/ital8cms-theme-x.git  ');
      expect(r.ok).toBe(true);
      expect(r.value).toBe('https://github.com/u/ital8cms-theme-x.git');
    });
  });

  describe('SSH', () => {
    test('accetta scp-like git@host:owner/repo.git e marca protocol=ssh', () => {
      const r = validateRepoUrl('git@github.com:utente/ital8cms-theme-mySite.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('ssh');
    });

    test('accetta ssh:// URL e marca protocol=ssh', () => {
      const r = validateRepoUrl('ssh://git@github.com/utente/ital8cms-theme-mySite.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('ssh');
    });

    test('accetta scp-like con host gitlab', () => {
      const r = validateRepoUrl('git@gitlab.example.com:group/ital8cms-theme-x.git');
      expect(r.ok).toBe(true);
      expect(r.protocol).toBe('ssh');
    });
  });

  describe('Rifiuti', () => {
    test('rifiuta URL vuoto', () => {
      expect(validateRepoUrl('').ok).toBe(false);
      expect(validateRepoUrl('   ').ok).toBe(false);
    });

    test('rifiuta non-stringa', () => {
      expect(validateRepoUrl(null).ok).toBe(false);
      expect(validateRepoUrl(undefined).ok).toBe(false);
      expect(validateRepoUrl(42).ok).toBe(false);
    });

    test('rifiuta http:// (non TLS)', () => {
      expect(validateRepoUrl('http://github.com/u/ital8cms-theme-x.git').ok).toBe(false);
    });

    test('rifiuta URL senza suffisso .git', () => {
      expect(validateRepoUrl('https://github.com/u/ital8cms-theme-x').ok).toBe(false);
      expect(validateRepoUrl('git@github.com:u/ital8cms-theme-x').ok).toBe(false);
    });

    test('rifiuta protocolli non supportati (file://, ftp://)', () => {
      expect(validateRepoUrl('file:///etc/passwd.git').ok).toBe(false);
      expect(validateRepoUrl('ftp://host/repo.git').ok).toBe(false);
    });
  });
});

describe('themesInstall — extractThemeNameFromUrl (parsing multi-formato)', () => {
  const PREFIX = 'ital8cms-theme-';

  test('estrae nome da HTTPS', () => {
    const r = extractThemeNameFromUrl('https://github.com/u/ital8cms-theme-mySite.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value.themeName).toBe('mySite');
  });

  test('estrae nome da HTTPS con credenziali inline', () => {
    const r = extractThemeNameFromUrl('https://u:token@github.com/u/ital8cms-theme-mySite.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value.themeName).toBe('mySite');
  });

  test('estrae nome da scp-like SSH', () => {
    const r = extractThemeNameFromUrl('git@github.com:u/ital8cms-theme-myCoolSite.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value.themeName).toBe('myCoolSite');
  });

  test('converte kebab-case in camelCase da scp-like SSH', () => {
    const r = extractThemeNameFromUrl('git@github.com:u/ital8cms-theme-my-cool-site.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value.themeName).toBe('myCoolSite');
  });

  test('estrae nome da ssh:// URL', () => {
    const r = extractThemeNameFromUrl('ssh://git@github.com/u/ital8cms-theme-adminDashboard.git', PREFIX);
    expect(r.ok).toBe(true);
    expect(r.value.themeName).toBe('adminDashboard');
  });

  test('rifiuta repo che non rispetta il prefisso (scp-like)', () => {
    const r = extractThemeNameFromUrl('git@github.com:u/wrong-prefix-x.git', PREFIX);
    expect(r.ok).toBe(false);
  });
});
