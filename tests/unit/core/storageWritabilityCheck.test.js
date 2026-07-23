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

const { checkStorageWritability, probeWritable } = require('../../../core/storageWritabilityCheck');

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
