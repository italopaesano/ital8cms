/**
 * Unit Tests per core/resetConfigsToDefault.js
 *
 * Copre:
 * - Rimozione dei vivi che hanno un .default
 * - I .default NON vengono toccati (fonte di verità)
 * - File senza .default NON vengono toccati (codice, log)
 * - default senza vivo → absent (niente da fare)
 * - dryRun: nulla viene cancellato, ma il report elenca i candidati
 * - userDataFiles segnalati (userAccount / userRole)
 * - Errori: dir mancante, non-directory, argomento non valido
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const resetConfigsToDefault = require('../../../core/resetConfigsToDefault');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resetConfigsToDefault-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, content = '{}\n') {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}
function exists(name) {
  return fs.existsSync(path.join(dir, name));
}

describe('resetConfigsToDefault', () => {

  describe('removal', () => {
    test('removes live files that have a matching .default', async () => {
      write('pluginConfig.default.json5');
      write('pluginConfig.json5');
      write('seoPages.default.json5');
      write('seoPages.json5');

      const result = await resetConfigsToDefault(dir);

      expect(result.removed.sort()).toEqual(['pluginConfig.json5', 'seoPages.json5']);
      expect(result.absent).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(exists('pluginConfig.json5')).toBe(false);
      expect(exists('seoPages.json5')).toBe(false);
    });

    test('does NOT touch the .default files (source of truth)', async () => {
      write('pluginConfig.default.json5');
      write('pluginConfig.json5');

      await resetConfigsToDefault(dir);

      expect(exists('pluginConfig.default.json5')).toBe(true);
    });

    test('does NOT touch live files without a matching .default', async () => {
      write('main.js', '// code\n');
      write('redirectHitCount.json5', '{ "hits": 5 }\n'); // runtime, no .default

      const result = await resetConfigsToDefault(dir);

      expect(result.removed).toEqual([]);
      expect(exists('main.js')).toBe(true);
      expect(exists('redirectHitCount.json5')).toBe(true);
    });

    test('default without a live file is reported as absent', async () => {
      write('pluginConfig.default.json5');
      // no pluginConfig.json5

      const result = await resetConfigsToDefault(dir);

      expect(result.removed).toEqual([]);
      expect(result.absent).toEqual(['pluginConfig.json5']);
    });
  });

  describe('dryRun', () => {
    test('does not delete anything but reports candidates', async () => {
      write('pluginConfig.default.json5');
      write('pluginConfig.json5');

      const result = await resetConfigsToDefault(dir, { dryRun: true });

      expect(result.removed).toEqual(['pluginConfig.json5']);
      expect(exists('pluginConfig.json5')).toBe(true); // still there
    });
  });

  describe('user data warning', () => {
    test('flags userAccount / userRole among removed', async () => {
      write('userAccount.default.json5');
      write('userAccount.json5');
      write('userRole.default.json5');
      write('userRole.json5');
      write('pluginConfig.default.json5');
      write('pluginConfig.json5');

      const result = await resetConfigsToDefault(dir);

      expect(result.userDataFiles.sort()).toEqual(['userAccount.json5', 'userRole.json5']);
      expect(result.removed).toContain('pluginConfig.json5');
    });

    test('no user-data flag when only ordinary configs are reset', async () => {
      write('pluginConfig.default.json5');
      write('pluginConfig.json5');

      const result = await resetConfigsToDefault(dir);

      expect(result.userDataFiles).toEqual([]);
    });
  });

  describe('error handling', () => {
    test('throws when the directory does not exist', async () => {
      await expect(
        resetConfigsToDefault(path.join(dir, 'nope'))
      ).rejects.toThrow();
    });

    test('throws when the path is not a directory', async () => {
      const filePath = path.join(dir, 'afile');
      fs.writeFileSync(filePath, 'x', 'utf8');
      await expect(resetConfigsToDefault(filePath)).rejects.toThrow();
    });

    test('throws on invalid argument', async () => {
      await expect(resetConfigsToDefault('')).rejects.toThrow();
      await expect(resetConfigsToDefault(null)).rejects.toThrow();
    });
  });
});
