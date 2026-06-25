/**
 * Unit Tests per l'handler reset ONLINE del cliBridge (handlers.js).
 *
 * Verifica handleReset attraverso makeDispatcher (dispatcher async):
 * - rimozione dei config vivi + richiesta di restart
 * - noop (niente restart) quando non c'è nulla da resettare
 * - target non valido / inesistente
 * - risoluzione themes/ con theme:true
 * - il dispatcher async gestisce ancora i comandi sconosciuti
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { makeDispatcher } = require('../../../core/cliBridge/handlers');

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resetHandler-'));
  fs.mkdirSync(path.join(projectRoot, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'themes'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function makePlugin(name, { withLive = true } = {}) {
  const dir = path.join(projectRoot, 'plugins', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pluginConfig.default.json5'), '{ "schemaVersion": 1, "active": 1 }\n');
  if (withLive) fs.writeFileSync(path.join(dir, 'pluginConfig.json5'), '{ "active": 0 }\n');
  return dir;
}

function ctxWith(requestRestart) {
  return {
    projectRoot,
    configPath: path.join(projectRoot, 'ital8Config.json5'),
    requestRestart,
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('cliBridge handleReset (reset online)', () => {

  test('removes live configs and requests a restart', async () => {
    makePlugin('seo');
    const requestRestart = jest.fn();
    const dispatch = makeDispatcher(ctxWith(requestRestart));

    const res = await dispatch('reset', { target: 'seo' });

    expect(res.ok).toBe(true);
    expect(res.action).toBe('reset');
    expect(res.restart).toBe(true);
    expect(res.removed).toContain('pluginConfig.json5');
    expect(fs.existsSync(path.join(projectRoot, 'plugins', 'seo', 'pluginConfig.json5'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'plugins', 'seo', 'pluginConfig.default.json5'))).toBe(true);

    await tick(); // requestRestart è schedulato con setImmediate
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(requestRestart).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reset' }));
  });

  test('noop (no restart) when there is nothing to reset', async () => {
    makePlugin('empty', { withLive: false }); // solo default, nessun vivo
    const requestRestart = jest.fn();
    const dispatch = makeDispatcher(ctxWith(requestRestart));

    const res = await dispatch('reset', { target: 'empty' });

    expect(res.ok).toBe(true);
    expect(res.restart).toBe(false);
    expect(res.noop).toBe(true);
    await tick();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  test('rejects an invalid target (path traversal)', async () => {
    const dispatch = makeDispatcher(ctxWith(jest.fn()));
    const res = await dispatch('reset', { target: '../../etc' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_target');
  });

  test('rejects a missing target', async () => {
    const dispatch = makeDispatcher(ctxWith(jest.fn()));
    const res = await dispatch('reset', { target: 'doesNotExist' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('target_not_found');
  });

  test('resolves themes/ when theme:true', async () => {
    const dir = path.join(projectRoot, 'themes', 'myTheme');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'themeConfig.default.json5'), '{ "schemaVersion": 1 }\n');
    fs.writeFileSync(path.join(dir, 'themeConfig.json5'), '{ "weight": 0 }\n');
    const requestRestart = jest.fn();
    const dispatch = makeDispatcher(ctxWith(requestRestart));

    const res = await dispatch('reset', { target: 'myTheme', theme: true });

    expect(res.ok).toBe(true);
    expect(res.removed).toContain('themeConfig.json5');
    expect(fs.existsSync(path.join(dir, 'themeConfig.json5'))).toBe(false);
  });

  test('unknown command still returns an error (async dispatcher intact)', async () => {
    const dispatch = makeDispatcher(ctxWith(jest.fn()));
    const res = await dispatch('bogus.command');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unknown_command');
  });
});
