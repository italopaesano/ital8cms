const fs = require('fs');
const path = require('path');
const { readEnableAdmin, writeEnableAdmin } = require('./configEditor');
const { readState, writeState } = require('./stateFile');
const { detectSupervisor } = require('./respawn');
const resetConfigsToDefault = require('../resetConfigsToDefault');

function buildStatus(ctx) {
  const { startTime, ital8Conf, configPath, statePath, getPublicState } = ctx;
  const httpsEnabled = !!(ital8Conf && ital8Conf.https && ital8Conf.https.enabled);

  let adminState = 'unknown';
  try {
    adminState = readEnableAdmin(configPath) ? 'running' : 'stopped';
  } catch (_err) {
    adminState = ital8Conf.enableAdmin ? 'running' : 'stopped';
  }

  const publicState = typeof getPublicState === 'function'
    ? getPublicState()
    : (readState(statePath).public);

  return {
    ok: true,
    data: {
      pid: process.pid,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      httpPort: ital8Conf ? ital8Conf.httpPort : null,
      httpsEnabled,
      httpsPort: httpsEnabled ? ital8Conf.https.port : null,
      admin: { state: adminState },
      public: { state: publicState },
      supervisor: detectSupervisor(),
    },
  };
}

function handleAdminToggle(ctx, targetValue) {
  const { configPath, requestRestart } = ctx;

  let result;
  try {
    result = writeEnableAdmin(configPath, targetValue);
  } catch (err) {
    return {
      ok: false,
      error: err.code || 'config_edit_failed',
      message: err.message,
    };
  }

  const action = targetValue ? 'admin.start' : 'admin.stop';

  if (!result.changed) {
    return {
      ok: true,
      action,
      restart: false,
      noop: true,
      message: `admin già in stato ${targetValue ? 'running' : 'stopped'}, nessuna azione`,
    };
  }

  const supervisor = detectSupervisor();
  const restartMode = supervisor ? 'supervisor' : 'self-respawn';

  if (typeof requestRestart === 'function') {
    setImmediate(() => requestRestart({ reason: action, mode: restartMode }));
  }

  return {
    ok: true,
    action,
    restart: true,
    restartMode,
    supervisor,
    message: supervisor
      ? `config aggiornato; processo in chiusura, ${supervisor} si occuperà del riavvio`
      : 'config aggiornato; riavvio del processo in corso (self-respawn)',
  };
}

function handlePublicToggle(ctx, targetValue) {
  const { statePath, setPublicState } = ctx;
  const targetLabel = targetValue ? 'running' : 'stopped';
  const action = targetValue ? 'public.start' : 'public.stop';

  let current;
  try {
    current = readState(statePath).public;
  } catch (err) {
    return { ok: false, error: 'state_read_failed', message: err.message };
  }

  if (current === targetLabel) {
    return {
      ok: true,
      action,
      restart: false,
      noop: true,
      message: `public già in stato ${targetLabel}, nessuna azione`,
    };
  }

  try {
    writeState({ public: targetLabel }, statePath);
  } catch (err) {
    return { ok: false, error: 'state_write_failed', message: err.message };
  }

  if (typeof setPublicState === 'function') {
    setPublicState(targetLabel);
  }

  return {
    ok: true,
    action,
    restart: false,
    message: `public ${targetLabel} applicato a runtime (nessun riavvio richiesto)`,
  };
}

// Reset ONLINE (a caldo via socket): rimuove i config vivi del plugin/tema e
// richiede un restart. Al riavvio, materializeMissingConfigs li rigenera dai
// default. Riusa lo stesso resetConfigsToDefault del reset offline.
async function handleReset(ctx, request) {
  const { configPath, projectRoot, requestRestart } = ctx;
  const root = projectRoot || (configPath ? path.dirname(configPath) : process.cwd());

  const target = request && request.target;
  const isTheme = !!(request && request.theme);

  if (typeof target !== 'string' || !/^[A-Za-z0-9_-]+$/.test(target)) {
    return { ok: false, error: 'invalid_target', message: `target non valido: ${JSON.stringify(target)} (ammessi lettere, numeri, _ e -)` };
  }

  const base = isTheme ? 'themes' : 'plugins';
  const dir = path.join(root, base, target);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, error: 'target_not_found', message: `target non trovato: ${base}/${target}` };
  }

  let result;
  try {
    result = await resetConfigsToDefault(dir);
  } catch (err) {
    return { ok: false, error: 'reset_failed', message: err.message };
  }

  if (result.removed.length === 0) {
    return {
      ok: true, action: 'reset', target, restart: false, noop: true,
      removed: [], message: `${base}/${target} è già allo stato di default, nessuna azione`,
    };
  }

  const supervisor = detectSupervisor();
  const restartMode = supervisor ? 'supervisor' : 'self-respawn';
  if (typeof requestRestart === 'function') {
    setImmediate(() => requestRestart({ reason: 'reset', mode: restartMode }));
  }

  return {
    ok: true,
    action: 'reset',
    target,
    restart: true,
    restartMode,
    supervisor,
    removed: result.removed,
    userDataFiles: result.userDataFiles,
    message: supervisor
      ? `reset di ${base}/${target}: ${result.removed.length} file rimossi; ${supervisor} riavvierà per rigenerare dai default`
      : `reset di ${base}/${target}: ${result.removed.length} file rimossi; riavvio (self-respawn) per rigenerare dai default`,
  };
}

function makeDispatcher(ctx) {
  return async function dispatch(command, request = {}) {
    switch (command) {
      case 'status': return buildStatus(ctx);
      case 'admin.start': return handleAdminToggle(ctx, true);
      case 'admin.stop': return handleAdminToggle(ctx, false);
      case 'public.start': return handlePublicToggle(ctx, true);
      case 'public.stop': return handlePublicToggle(ctx, false);
      case 'reset': return handleReset(ctx, request);
      default:
        return {
          ok: false,
          error: 'unknown_command',
          message: `comando sconosciuto: ${JSON.stringify(command)}`,
        };
    }
  };
}

const KNOWN_COMMANDS = ['status', 'admin.start', 'admin.stop', 'public.start', 'public.stop', 'reset'];

module.exports = { makeDispatcher, KNOWN_COMMANDS };
