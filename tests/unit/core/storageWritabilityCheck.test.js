/**
 * Unit test per core/storageWritabilityCheck.js
 *
 * Copre:
 *   - probeWritable: sonda effettiva (crea dir + write/delete temp);
 *   - assertPluginWritableOrThrow: GATE GRACEFUL per il caricamento di un plugin
 *     (dir scrivibile → true + pre-creazione; non scrivibile → throw con
 *     code 'STORAGE_NOT_WRITABLE' + box [STORAGE]; risoluzione path relativi;
 *     robustezza discovery: getWritablePaths che lancia, voci malformate);
 *   - adviseWritabilityForPluginsDir: ADVISORY wizard/offline (non bloccante).
 *
 * error/warn sono iniettati via options → nessuno spy su process.exit.
 * I guasti FS sono iniettati via jest.spyOn(fs, ...) per determinismo (root
 * incluso). Il require top-level "scalda" la transform babel con fs reale prima
 * dei mock (babel usa fs.existsSync per la propria config).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  assertPluginWritableOrThrow,
  adviseWritabilityForPluginsDir,
  probeWritable,
} = require('../../../core/storageWritabilityCheck');

/** Errore filesystem realistico con `code`. */
function fsError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('assertPluginWritableOrThrow() — risoluzione path e discovery', () => {
  test('path relativo risolto contro pathPluginFolder (dir pre-creata)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-rel-'));
    try {
      const plugin = { pluginName: 'analytics', pathPluginFolder: base, getWritablePaths: () => [{ path: './data', purpose: 'x' }] };

      expect(assertPluginWritableOrThrow(plugin, null, {})).toBe(true);
      expect(fs.existsSync(path.join(base, 'data'))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('getWritablePaths che lancia → warn, nessun gate (non lancia)', () => {
    const warn = jest.fn();
    const plugin = { pluginName: 'analytics', getWritablePaths: () => { throw new Error('boom'); } };

    expect(assertPluginWritableOrThrow(plugin, null, { warn })).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  test('voci malformate (senza path valido) → warn, nessun gate', () => {
    const warn = jest.fn();
    const plugin = { pluginName: 'analytics', getWritablePaths: () => [{ purpose: 'no path' }, { path: '' }, { path: '   ' }] };

    expect(assertPluginWritableOrThrow(plugin, null, { warn })).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  test('più dir con una non scrivibile → lancia; il box elenca solo la fallita', () => {
    const okDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ok-'));
    try {
      // Fa fallire solo la sonda della dir "ko"; per i path sani delega alla
      // writeFileSync reale (così il file temporaneo esiste e l'unlink ok).
      const realWriteFileSync = fs.writeFileSync;
      jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
        if (String(file).includes('ko-data')) throw fsError('EROFS', 'read-only file system, open');
        return realWriteFileSync(file, ...args);
      });
      const error = jest.fn();
      const plugin = {
        pluginName: 'rateLimiter',
        getWritablePaths: () => [
          { path: okDir, purpose: 'ok store' },
          { path: '/var/ko-data', purpose: 'state store' },
        ],
      };

      let thrown;
      try { assertPluginWritableOrThrow(plugin, null, { error }); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(Error);
      const box = error.mock.calls[0][0];
      expect(box).toContain('rateLimiter');
      expect(box).toContain('/var/ko-data');
      expect(box).toContain('EROFS');
      expect(box).not.toContain('ok store'); // la dir sana non compare tra le fallite
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(okDir, { recursive: true, force: true });
    }
  });
});

describe('probeWritable()', () => {
  test('ok:true su dir scrivibile e ripulisce il file temporaneo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-probe-'));
    try {
      expect(probeWritable(dir)).toEqual({ ok: true });
      expect(fs.readdirSync(dir)).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ok:false con error se la creazione/scrittura fallisce', () => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw fsError('EROFS', 'read-only file system, mkdir');
    });

    const result = probeWritable('/ro/nope');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('EROFS');
  });
});

describe('assertPluginWritableOrThrow() — gate bloccante d\'installazione', () => {
  test('dir scrivibile → true, nessun errore, dir pre-creata', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gate-'));
    const dir = path.join(base, 'data');
    try {
      const error = jest.fn();
      const plugin = { pluginName: 'analytics', pathPluginFolder: base, getWritablePaths: () => [{ path: dir, purpose: 'x' }] };

      expect(assertPluginWritableOrThrow(plugin, null, { error })).toBe(true);
      expect(error).not.toHaveBeenCalled();
      expect(fs.existsSync(dir)).toBe(true); // pre-creata
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('dir non scrivibile → LANCIA (code STORAGE_NOT_WRITABLE) + box "NON caricato"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gate-'));
    try {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw fsError('EACCES', 'permission denied, open');
      });
      const error = jest.fn();
      const plugin = { pluginName: 'analytics', pathPluginFolder: dir, getWritablePaths: () => [{ path: dir, purpose: 'analytics event storage' }] };

      let thrown;
      try {
        assertPluginWritableOrThrow(plugin, null, { error });
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.code).toBe('STORAGE_NOT_WRITABLE');
      expect(error).toHaveBeenCalledTimes(1);
      const box = error.mock.calls[0][0];
      expect(box).toContain('[STORAGE]');
      expect(box).toContain('NON caricato');
      expect(box).toContain('saltato');
      expect(box).toContain('analytics');
      expect(box).toContain('EACCES');
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('plugin senza getWritablePaths → true, nessun errore (nessun gate)', () => {
    const error = jest.fn();
    expect(assertPluginWritableOrThrow({ pluginName: 'bootstrap' }, null, { error })).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('adviseWritabilityForPluginsDir() — advisory wizard/offline', () => {
  // Costruisce una finta cartella plugins/ con un plugin attivo che dichiara una
  // data dir via getWritablePaths (main.js reale, richiesto in modo difensivo).
  function scaffoldPlugin(pluginsDir, name, { active = 1, dataSubdir = 'data' } = {}) {
    const dir = path.join(pluginsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pluginConfig.json5'),
      `// test\n{ active: ${active}, custom: { dataPath: './${dataSubdir}' } }\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, 'main.js'),
      `const path = require('path');\n` +
      `module.exports = {\n` +
      `  getWritablePaths(pluginSys, pathPluginFolder) {\n` +
      `    return [{ path: path.join(pathPluginFolder || __dirname, '${dataSubdir}'), purpose: '${name} store' }];\n` +
      `  }\n` +
      `};\n`,
      'utf8'
    );
    return dir;
  }

  test('tutte scrivibili → true, nessun warning, data dir pre-creata', () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-wiz-'));
    try {
      scaffoldPlugin(pluginsDir, 'analytics');
      const warn = jest.fn();

      expect(adviseWritabilityForPluginsDir(pluginsDir, { warn })).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(pluginsDir, 'analytics', 'data'))).toBe(true);
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  test('plugin disattivo (active:0) → ignorato', () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-wiz-'));
    try {
      scaffoldPlugin(pluginsDir, 'analytics', { active: 0 });
      const warn = jest.fn();

      expect(adviseWritabilityForPluginsDir(pluginsDir, { warn })).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      // active:0 → nemmeno introspezionato, quindi la dir NON viene pre-creata
      expect(fs.existsSync(path.join(pluginsDir, 'analytics', 'data'))).toBe(false);
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  test('dir non scrivibile → false + box consolidato di AVVISO (non blocca)', () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-wiz-'));
    try {
      scaffoldPlugin(pluginsDir, 'analytics');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(function (file, ...args) {
        // fallisce solo la sonda (probe file), non la scaffoldatura già avvenuta
        if (String(file).includes('.ital8-writecheck-')) {
          throw fsError('EROFS', 'read-only file system, open');
        }
        return fs.constants ? undefined : undefined;
      });
      const warn = jest.fn();

      const result = adviseWritabilityForPluginsDir(pluginsDir, { warn });

      expect(result).toBe(false);
      const box = warn.mock.calls[0][0];
      expect(box).toContain('[STORAGE]');
      expect(box).toContain('setup');
      expect(box).toContain('analytics');
      expect(box).toContain('EROFS');
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  test('cartella plugins/ inesistente → true, no-op sicuro', () => {
    const warn = jest.fn();
    expect(adviseWritabilityForPluginsDir('/does/not/exist', { warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
