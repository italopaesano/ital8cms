const net = require('net');
const fs = require('fs');

const DEFAULT_PROBE_TIMEOUT_MS = 500;

function probeSocket(socketPath, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  if (!fs.existsSync(socketPath)) {
    return Promise.resolve('missing');
  }

  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) {}
      resolve(result);
    };

    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish('live'));
    sock.once('timeout', () => finish('stale'));
    sock.once('error', (err) => {
      if (err && err.code === 'ENOENT') finish('missing');
      else finish('stale');
    });

    sock.connect(socketPath);
  });
}

async function ensureSocketPathFree(socketPath, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  const state = await probeSocket(socketPath, timeoutMs);
  if (state === 'live') {
    const err = new Error(`socket ${socketPath} is already in use by another ital8cms instance`);
    err.code = 'EADDRINUSE';
    throw err;
  }
  if (state === 'stale') {
    fs.unlinkSync(socketPath);
  }
}

module.exports = { probeSocket, ensureSocketPathFree };
