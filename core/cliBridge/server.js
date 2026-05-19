const net = require('net');
const fs = require('fs');
const path = require('path');
const { ensureSocketPathFree } = require('./socketProbe');
const { makeDispatcher } = require('./handlers');

const LINE_DELIMITER = '\n';
const MAX_LINE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_SOCKET_PATH = './ital8cms.sock';
const DEFAULT_SOCKET_MODE = 0o660;

function parseRequestLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return { ok: false, error: 'invalid_json', message: err.message };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_request', message: 'request must be a JSON object' };
  }
  if (typeof parsed.command !== 'string' || parsed.command.length === 0) {
    return { ok: false, error: 'invalid_request', message: 'request.command must be a non-empty string' };
  }
  return { ok: true, value: parsed };
}

function parseSocketMode(value, fallback = DEFAULT_SOCKET_MODE) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/^0o/i, '').replace(/^0+(?=\d)/, '');
    const parsed = parseInt(cleaned, 8);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function handleConnection(socket, dispatcher) {
  let buffer = '';
  let settled = false;

  const sendResponse = (obj) => {
    if (settled) return;
    settled = true;
    try {
      socket.end(JSON.stringify(obj) + LINE_DELIMITER);
    } catch (_err) {
      try { socket.destroy(); } catch (_) {}
    }
  };

  const timeout = setTimeout(() => {
    sendResponse({
      ok: false,
      error: 'timeout',
      message: `no complete request within ${REQUEST_TIMEOUT_MS}ms`,
    });
  }, REQUEST_TIMEOUT_MS);
  timeout.unref();

  socket.on('data', (chunk) => {
    if (settled) return;
    buffer += chunk.toString('utf8');
    if (buffer.length > MAX_LINE_BYTES) {
      clearTimeout(timeout);
      sendResponse({
        ok: false,
        error: 'request_too_large',
        message: `request exceeds ${MAX_LINE_BYTES} bytes`,
      });
      return;
    }
    const nl = buffer.indexOf(LINE_DELIMITER);
    if (nl === -1) return;

    clearTimeout(timeout);
    const line = buffer.slice(0, nl);
    const parsed = parseRequestLine(line);
    if (!parsed.ok) {
      sendResponse({ ok: false, error: parsed.error, message: parsed.message });
      return;
    }

    let response;
    try {
      response = dispatcher(parsed.value.command);
    } catch (err) {
      response = { ok: false, error: 'internal_error', message: err.message };
    }
    sendResponse(response);
  });

  socket.on('error', () => {
    clearTimeout(timeout);
  });
}

function warnBindFailure(socketPath, err) {
  const line = '[cliBridge] ═══════════════════════════════════════════════════════';
  console.warn(line);
  console.warn(`[cliBridge]  ⚠  impossibile creare il control socket: ${err.code || 'ERR'}`);
  console.warn(`[cliBridge]     path: ${socketPath}`);
  console.warn(`[cliBridge]     ${err.message}`);
  console.warn('[cliBridge]');
  if (err.code === 'EACCES') {
    console.warn('[cliBridge]  Permessi insufficienti.');
    console.warn('[cliBridge]    • verifica che la directory che contiene il socket sia writable');
    console.warn('[cliBridge]    • oppure imposta `cli.socketPath` in ital8Config.json5');
  } else if (err.code === 'EADDRINUSE') {
    console.warn('[cliBridge]  Un altro processo ital8cms risulta in ascolto sullo stesso socket.');
    console.warn('[cliBridge]    • ferma l\'altra istanza, oppure');
    console.warn('[cliBridge]    • cambia `cli.socketPath` in ital8Config.json5');
  } else {
    console.warn('[cliBridge]  Per disabilitare il control plane:');
    console.warn('[cliBridge]    "cli": { "enabled": false }   in ital8Config.json5');
  }
  console.warn('[cliBridge]  ▶ il server continua senza canale CLI');
  console.warn(line);
}

async function start(ital8Conf, options = {}) {
  const cliConf = (ital8Conf && ital8Conf.cli) || {};
  if (cliConf.enabled === false) {
    console.log('[cliBridge] disabilitato in config (cli.enabled=false), nessun socket creato');
    return null;
  }

  const projectRoot = options.projectRoot || process.cwd();
  const rawPath = cliConf.socketPath || DEFAULT_SOCKET_PATH;
  const socketPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
  const socketMode = parseSocketMode(cliConf.socketMode);

  try {
    await ensureSocketPathFree(socketPath);
  } catch (err) {
    warnBindFailure(socketPath, err);
    return null;
  }

  const dispatcher = makeDispatcher({
    startTime: Date.now(),
    ital8Conf,
    configPath: options.configPath,
    statePath: options.statePath,
    requestRestart: options.requestRestart,
    setPublicState: options.setPublicState,
    getPublicState: options.getPublicState,
  });

  const server = net.createServer((sock) => handleConnection(sock, dispatcher));

  return await new Promise((resolve) => {
    server.once('error', (err) => {
      warnBindFailure(socketPath, err);
      resolve(null);
    });
    server.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, socketMode);
      } catch (err) {
        console.warn(
          `[cliBridge] impossibile applicare chmod ${socketMode.toString(8)} su ${socketPath}: ${err.message}`
        );
      }
      console.log(`[cliBridge] in ascolto su ${socketPath} (mode ${socketMode.toString(8)})`);
      resolve({ server, socketPath });
    });
  });
}

module.exports = {
  start,
  parseRequestLine,
  parseSocketMode,
  DEFAULT_SOCKET_PATH,
  DEFAULT_SOCKET_MODE,
};
