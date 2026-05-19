const path = require('path');
const { readEnableAdmin, writeEnableAdmin } = require('./configEditor');
const { readState, writeState } = require('./stateFile');
const { detectSupervisor } = require('./respawn');

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

function makeDispatcher(ctx) {
  return function dispatch(command) {
    switch (command) {
      case 'status': return buildStatus(ctx);
      case 'admin.start': return handleAdminToggle(ctx, true);
      case 'admin.stop': return handleAdminToggle(ctx, false);
      case 'public.start': return handlePublicToggle(ctx, true);
      case 'public.stop': return handlePublicToggle(ctx, false);
      default:
        return {
          ok: false,
          error: 'unknown_command',
          message: `comando sconosciuto: ${JSON.stringify(command)}`,
        };
    }
  };
}

const KNOWN_COMMANDS = ['status', 'admin.start', 'admin.stop', 'public.start', 'public.stop'];

module.exports = { makeDispatcher, KNOWN_COMMANDS };
