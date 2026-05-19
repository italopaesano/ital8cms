const fs = require('fs');
const server = require('./server');

let handle = null;

async function start(ital8Conf, options = {}) {
  if (handle) return handle;
  handle = await server.start(ital8Conf, options);
  return handle;
}

async function stop() {
  if (!handle) return;
  const { server: netServer, socketPath } = handle;
  handle = null;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      netServer.close(finish);
    } catch (_err) {
      finish();
    }
    // Safety: don't hang shutdown if close never fires
    setTimeout(finish, 2000).unref();
  });
  try { fs.unlinkSync(socketPath); } catch (_) {}
}

function isRunning() {
  return handle !== null;
}

module.exports = { start, stop, isRunning };
