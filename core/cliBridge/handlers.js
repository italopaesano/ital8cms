const STUB_ACTIONS = ['admin.start', 'admin.stop', 'public.start', 'public.stop'];

function buildStatus(ctx) {
  const { startTime, ital8Conf } = ctx;
  const httpsEnabled = !!(ital8Conf && ital8Conf.https && ital8Conf.https.enabled);
  return {
    ok: true,
    data: {
      pid: process.pid,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      httpPort: ital8Conf ? ital8Conf.httpPort : null,
      httpsEnabled,
      httpsPort: httpsEnabled ? ital8Conf.https.port : null,
      admin: { state: 'unknown' },
      public: { state: 'unknown' },
    },
  };
}

function buildStub(action) {
  return {
    ok: true,
    stub: true,
    action,
    message: 'comando ricevuto (stub: nessuna azione eseguita in v1)',
  };
}

function makeDispatcher(ctx) {
  return function dispatch(command) {
    if (command === 'status') return buildStatus(ctx);
    if (STUB_ACTIONS.includes(command)) return buildStub(command);
    return {
      ok: false,
      error: 'unknown_command',
      message: `comando sconosciuto: ${JSON.stringify(command)}`,
    };
  };
}

module.exports = { makeDispatcher, STUB_ACTIONS };
