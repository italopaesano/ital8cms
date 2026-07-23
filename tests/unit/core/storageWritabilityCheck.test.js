/**
 * Unit test per core/storageWritabilityCheck.js
 *
 * Copre il preflight di scrivibilità plugin-declared + bloccante:
 *   - discovery via getWritablePaths() dei plugin attivi;
 *   - sonda effettiva (probeWritable): crea dir + write/delete temp;
 *   - happy path reale (dir pre-creata, temp rimosso);
 *   - fallimento → box [STORAGE] + exit(1) (bloccante), con diagnostica;
 *   - robustezza: getWritablePaths che lancia, voci malformate, plugin senza il
 *     metodo, path relativo risolto contro pathPluginFolder.
 *
 * exit/error/warn sono iniettati via options → nessuno spy su process.exit.
 * I guasti FS sono iniettati via jest.spyOn(fs, ...) per determinismo (root
 * incluso). Il require top-level "scalda" la transform babel con fs reale prima
 * dei mock (babel usa fs.existsSync per la propria config).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  checkStorageWritability,
  advisePluginWritability,
  adviseWritabilityForPluginsDir,
  probeWritable,
} = require('../../../core/storageWritabilityCheck');

/** Stub minimale di pluginSys: mappa nome→oggetto plugin. */
function makePluginSys(pluginsMap) {
  return {
    getActivePluginNames: () => Object.keys(pluginsMap),
    getPlugin: (name) => {
      const p = pluginsMap[name];
      if (!p) return null;
      return {
        pluginName: name,
        pathPluginFolder: p.pathPluginFolder || path.join('/plugins', name),
        ...p,
      };
    },
  };
}

/** Errore filesystem realistico con `code`. */
function fsError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkStorageWritability() — happy path', () => {
  test('dir scrivibile → nessun exit, dir pre-creata, temp file rimosso', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
    const dataDir = path.join(base, 'data'); // NON esiste ancora
    try {
      const exit = jest.fn();
      const pluginSys = makePluginSys({
        analytics: { getWritablePaths: () => [{ path: dataDir, purpose: 'analytics event storage' }] },
      });

      const summary = checkStorageWritability(pluginSys, { exit });

      expect(exit).not.toHaveBeenCalled();
      expect(summary).toEqual({ checked: 1, ok: 1 });
      expect(fs.existsSync(dataDir)).toBe(true);        // pre-creata dalla sonda
      expect(fs.readdirSync(dataDir)).toHaveLength(0);  // temp file ripulito
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('path relativo risolto contro pathPluginFolder', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
    try {
      const exit = jest.fn();
      const pluginSys = makePluginSys({
        analytics: { pathPluginFolder: base, getWritablePaths: () => [{ path: './data', purpose: 'x' }] },
      });

      checkStorageWritability(pluginSys, { exit });

      expect(exit).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(base, 'data'))).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('checkStorageWritability() — bloccante su dir non scrivibile', () => {
  test('sonda fallita → exit(1) e box [STORAGE] con plugin, purpose e code', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
    try {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw fsError('EACCES', 'permission denied, open');
      });
      const exit = jest.fn();
      const errorLog = jest.fn();
      const pluginSys = makePluginSys({
        analytics: { getWritablePaths: () => [{ path: tmpDir, purpose: 'analytics event storage' }] },
      });

      checkStorageWritability(pluginSys, { exit, error: errorLog });

      expect(exit).toHaveBeenCalledWith(1);
      const box = errorLog.mock.calls[0][0];
      expect(box).toContain('[STORAGE]');
      expect(box).toContain('avvio interrotto');
      expect(box).toContain('analytics');
      expect(box).toContain('analytics event storage');
      expect(box).toContain('EACCES');
      expect(box).toContain('ReadWritePaths'); // guida azionabile presente
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('con più plugin, il box elenca solo quello che fallisce', () => {
    const okDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ok-'));
    try {
      // Fa fallire solo la scrittura nella dir "ko"; per i path sani delega
      // alla writeFileSync reale (così il file temporaneo esiste e l'unlink ok).
      const realWriteFileSync = fs.writeFileSync;
      jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
        if (String(file).includes('ko-data')) throw fsError('EROFS', 'read-only file system, open');
        return realWriteFileSync(file, ...args);
      });
      const exit = jest.fn();
      const errorLog = jest.fn();
      const pluginSys = makePluginSys({
        analytics:   { getWritablePaths: () => [{ path: okDir, purpose: 'ok store' }] },
        rateLimiter: { getWritablePaths: () => [{ path: '/var/ko-data', purpose: 'state store' }] },
      });

      checkStorageWritability(pluginSys, { exit, error: errorLog });

      expect(exit).toHaveBeenCalledWith(1);
      const box = errorLog.mock.calls[0][0];
      expect(box).toContain('rateLimiter');
      expect(box).toContain('EROFS');
      expect(box).not.toContain('ok store'); // il plugin sano non compare tra i falliti
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(okDir, { recursive: true, force: true });
    }
  });
});

describe('checkStorageWritability() — robustezza discovery', () => {
  test('plugin senza getWritablePaths → ignorato, nessun exit', () => {
    const exit = jest.fn();
    const pluginSys = makePluginSys({ bootstrap: {} });

    expect(checkStorageWritability(pluginSys, { exit })).toEqual({ checked: 0, ok: 0 });
    expect(exit).not.toHaveBeenCalled();
  });

  test('getWritablePaths che lancia → warn, skip, nessun exit', () => {
    const exit = jest.fn();
    const warn = jest.fn();
    const pluginSys = makePluginSys({
      analytics: { getWritablePaths: () => { throw new Error('boom'); } },
    });

    const summary = checkStorageWritability(pluginSys, { exit, warn });

    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(summary).toEqual({ checked: 0, ok: 0 });
  });

  test('voci malformate (senza path valido) → warn, skip', () => {
    const exit = jest.fn();
    const warn = jest.fn();
    const pluginSys = makePluginSys({
      analytics: { getWritablePaths: () => [{ purpose: 'no path' }, { path: '' }, { path: '   ' }] },
    });

    const summary = checkStorageWritability(pluginSys, { exit, warn });

    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(summary).toEqual({ checked: 0, ok: 0 });
  });

  test('pluginSys assente/invalido → no-op sicuro', () => {
    const exit = jest.fn();
    expect(checkStorageWritability(null, { exit })).toEqual({ checked: 0, ok: 0 });
    expect(checkStorageWritability({}, { exit })).toEqual({ checked: 0, ok: 0 });
    expect(exit).not.toHaveBeenCalled();
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

describe('advisePluginWritability() — advisory install-time (non bloccante)', () => {
  test('dir scrivibile → true, nessun warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-adv-'));
    try {
      const warn = jest.fn();
      const plugin = { pluginName: 'analytics', pathPluginFolder: dir, getWritablePaths: () => [{ path: dir, purpose: 'x' }] };

      expect(advisePluginWritability(plugin, null, { warn })).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dir non scrivibile → false + box di AVVISO, ma NON esce (nessun blocco)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-adv-'));
    try {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw fsError('EACCES', 'permission denied, open');
      });
      const warn = jest.fn();
      const plugin = { pluginName: 'analytics', pathPluginFolder: dir, getWritablePaths: () => [{ path: dir, purpose: 'analytics event storage' }] };

      const result = advisePluginWritability(plugin, null, { warn });

      expect(result).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      const box = warn.mock.calls[0][0];
      expect(box).toContain('[STORAGE]');
      expect(box).toContain('AVVISO non bloccante');
      expect(box).toContain('analytics');
      expect(box).toContain('EACCES');
    } finally {
      jest.restoreAllMocks();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('plugin senza getWritablePaths → true, nessun warning', () => {
    const warn = jest.fn();
    expect(advisePluginWritability({ pluginName: 'bootstrap' }, null, { warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
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
