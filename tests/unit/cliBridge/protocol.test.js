const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRequestLine, parseSocketMode } = require('../../../core/cliBridge/server');
const { makeDispatcher, KNOWN_COMMANDS } = require('../../../core/cliBridge/handlers');
const { readState } = require('../../../core/cliBridge/stateFile');

describe('parseRequestLine', () => {
  test('accepts a valid status request', () => {
    const r = parseRequestLine('{"command":"status"}');
    expect(r.ok).toBe(true);
    expect(r.value.command).toBe('status');
  });

  test.each([
    ['not json at all', 'invalid_json'],
    ['null',            'invalid_request'],
    ['[1,2,3]',         'invalid_request'],
    ['{"foo":"bar"}',   'invalid_request'],
    ['{"command":42}',  'invalid_request'],
    ['{"command":""}',  'invalid_request'],
  ])('rejects %j as %s', (input, expectedError) => {
    const r = parseRequestLine(input);
    expect(r).toMatchObject({ ok: false, error: expectedError });
  });
});

describe('parseSocketMode', () => {
  test.each([
    [undefined, 0o660, 0o660],
    [null,      0o644, 0o644],
    ['',        0o600, 0o600],
    [0o600,     0o660, 0o600],
    ['0660',    0,     0o660],
    ['660',     0,     0o660],
    ['0o660',   0,     0o660],
    ['zzz',     0o644, 0o644],
  ])('parseSocketMode(%j, %j) → %d', (value, fallback, expected) => {
    expect(parseSocketMode(value, fallback)).toBe(expected);
  });
});

function makeSandbox(adminInitial = true, publicInitial = 'running') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliBridge-test-'));
  const configPath = path.join(dir, 'ital8Config.json5');
  const statePath = path.join(dir, 'state.json5');

  fs.writeFileSync(configPath,
    `{\n  "enableAdmin": ${adminInitial},\n  "httpPort": 3000,\n}\n`, 'utf8');
  fs.writeFileSync(statePath,
    `// state\n{ "public": "${publicInitial}" }\n`, 'utf8');

  return {
    dir, configPath, statePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// Il dispatcher è async (supporta handler async come reset): tutti i comandi
// vanno attesi con await, anche quelli sincroni (await su un valore lo restituisce).
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('makeDispatcher.status', () => {
  test('reports running/running when admin=true and public=running', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now() - 5000,
        ital8Conf: { httpPort: 3000, https: { enabled: true, port: 3443 } },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = await dispatch('status');
      expect(res.ok).toBe(true);
      expect(res.data.admin).toEqual({ state: 'running', unreachable: false });
      expect(res.data.reserved).toEqual({ state: 'running' });
      expect(res.data.public).toEqual({ state: 'running' });
      expect(res.data.httpPort).toBe(3000);
      expect(res.data.httpsEnabled).toBe(true);
      expect(res.data.httpsPort).toBe(3443);
    } finally { sb.cleanup(); }
  });

  test('reports stopped/stopped when admin=false and public=stopped', async () => {
    const sb = makeSandbox(false, 'stopped');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 8080, https: { enabled: false } },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = await dispatch('status');
      expect(res.data.admin).toEqual({ state: 'stopped', unreachable: false });
      expect(res.data.public).toEqual({ state: 'stopped' });
      expect(res.data.httpsEnabled).toBe(false);
      expect(res.data.httpsPort).toBeNull();
    } finally { sb.cleanup(); }
  });

  test('uses getPublicState callback if provided', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        getPublicState: () => 'stopped',
      });
      const res = await dispatch('status');
      expect(res.data.public.state).toBe('stopped');
    } finally { sb.cleanup(); }
  });
});

describe('makeDispatcher.admin start/stop', () => {
  test('admin.stop writes enableAdmin=false and schedules restart', async () => {
    const sb = makeSandbox(true);
    const restartCalls = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        requestRestart: (info) => restartCalls.push(info),
      });
      const res = await dispatch('admin.stop');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('admin.stop');
      expect(res.restart).toBe(true);
      expect(res.noop).toBeUndefined();
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*false/);
      // requestRestart is called via setImmediate — flush macrotasks
      await flush();
      expect(restartCalls.length).toBe(1);
      expect(restartCalls[0].reason).toBe('admin.stop');
    } finally { sb.cleanup(); }
  });

  test('admin.start writes enableAdmin=true and schedules restart', async () => {
    const sb = makeSandbox(false);
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        requestRestart: () => {},
      });
      const res = await dispatch('admin.start');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('admin.start');
      expect(res.restart).toBe(true);
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*true/);
    } finally { sb.cleanup(); }
  });

  test('admin.stop is idempotent (noop) when already stopped', async () => {
    const sb = makeSandbox(false);
    const restartCalls = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        requestRestart: (info) => restartCalls.push(info),
      });
      const res = await dispatch('admin.stop');
      expect(res.ok).toBe(true);
      expect(res.noop).toBe(true);
      expect(res.restart).toBe(false);
      await flush();
      expect(restartCalls.length).toBe(0);
    } finally { sb.cleanup(); }
  });

  test('admin.stop reports config_edit_failed when config missing', async () => {
    const dispatch = makeDispatcher({
      startTime: Date.now(),
      ital8Conf: { httpPort: 3000 },
      configPath: '/nonexistent/path/ital8Config.json5',
      statePath: '/nonexistent/state.json5',
    });
    const res = await dispatch('admin.stop');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/ENOENT|non trovato|no such file/i);
  });
});

describe('makeDispatcher.public start/stop', () => {
  test('public.stop writes state and calls setPublicState (no restart)', async () => {
    const sb = makeSandbox(true, 'running');
    const calls = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        setPublicState: (s) => calls.push(s),
      });
      const res = await dispatch('public.stop');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('public.stop');
      expect(res.restart).toBe(false);
      expect(calls).toEqual(['stopped']);
      const stateContent = fs.readFileSync(sb.statePath, 'utf8');
      expect(stateContent).toMatch(/"public"\s*:\s*"stopped"/);
    } finally { sb.cleanup(); }
  });

  test('public.start writes state running and calls setPublicState', async () => {
    const sb = makeSandbox(true, 'stopped');
    const calls = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        setPublicState: (s) => calls.push(s),
      });
      const res = await dispatch('public.start');
      expect(res.ok).toBe(true);
      expect(res.restart).toBe(false);
      expect(calls).toEqual(['running']);
    } finally { sb.cleanup(); }
  });

  test('public.stop is idempotent (noop) when already stopped', async () => {
    const sb = makeSandbox(true, 'stopped');
    const calls = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        setPublicState: (s) => calls.push(s),
      });
      const res = await dispatch('public.stop');
      expect(res.noop).toBe(true);
      expect(calls).toEqual([]);
    } finally { sb.cleanup(); }
  });
});

describe('makeDispatcher unknown commands', () => {
  test('returns unknown_command for garbage input', async () => {
    const sb = makeSandbox();
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = await dispatch('nonsense');
      expect(res).toMatchObject({ ok: false, error: 'unknown_command' });
    } finally { sb.cleanup(); }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINEL — la terza superficie a runtime, l'unica con TRE stati
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('makeDispatcher sentinel', () => {
  function sentinelCtx(sb, extra = {}) {
    return {
      startTime: Date.now(), ital8Conf: { httpPort: 3000 },
      configPath: sb.configPath, statePath: sb.statePath,
      ...extra,
    };
  }

  test.each([
    ['sentinel.start', 'running'],
    ['sentinel.monitor', 'monitor'],
    ['sentinel.stop', 'stopped'],
  ])('%s persiste lo stato %s', async (command, expected) => {
    const sb = makeSandbox(true, 'running');
    try {
      // Si parte da uno stato diverso da quello atteso, altrimenti il comando
      // sarebbe un noop e non proverebbe nulla.
      fs.writeFileSync(sb.statePath, `{ "sentinel": "${expected === 'monitor' ? 'running' : 'monitor'}" }`, 'utf8');
      const dispatch = makeDispatcher(sentinelCtx(sb));
      const res = await dispatch(command);
      expect(res.ok).toBe(true);
      expect(readState(sb.statePath).sentinel).toBe(expected);
    } finally { sb.cleanup(); }
  });

  // Lo state file da solo non basta: se il gate in memoria non viene commutato,
  // il comando risponde "applicato" mentre il filtro continua a comportarsi come
  // prima — ed è esattamente il caso in cui serve, cioè quando una regola ha
  // chiuso fuori qualcuno.
  test('applica lo stato al gate in memoria, non solo al file', async () => {
    const sb = makeSandbox(true, 'running');
    const applied = [];
    try {
      const dispatch = makeDispatcher(sentinelCtx(sb, { setSentinelState: (s) => applied.push(s) }));
      await dispatch('sentinel.monitor');
      expect(applied).toEqual(['monitor']);
    } finally { sb.cleanup(); }
  });

  // L'azione echeggiata deve nominare il COMANDO, non lo stato interno:
  // 'sentinel.stopped' non è un comando che esista.
  test.each([
    ['sentinel.start', 'sentinel.start'],
    ['sentinel.monitor', 'sentinel.monitor'],
    ['sentinel.stop', 'sentinel.stop'],
  ])('%s echeggia l azione %s', async (command, expectedAction) => {
    const sb = makeSandbox(true, 'running');
    try {
      fs.writeFileSync(sb.statePath, '{ "sentinel": "monitor" }', 'utf8');
      const dispatch = makeDispatcher(sentinelCtx(sb));
      const res = await dispatch(command);
      if (!res.noop) expect(res.action).toBe(expectedAction);
    } finally { sb.cleanup(); }
  });

  test('nessun riavvio richiesto: è un gate a runtime', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher(sentinelCtx(sb));
      const res = await dispatch('sentinel.stop');
      expect(res.restart).toBe(false);
    } finally { sb.cleanup(); }
  });

  test('ripetere lo stesso stato è un noop dichiarato', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher(sentinelCtx(sb));
      await dispatch('sentinel.stop');
      const res = await dispatch('sentinel.stop');
      expect(res.noop).toBe(true);
    } finally { sb.cleanup(); }
  });

  // Come per le altre superfici: writeState normalizza l'oggetto ricevuto, quindi
  // scrivere solo la chiave toccata riporterebbe le altre al loro default.
  test('non azzera le altre superfici', async () => {
    const sb = makeSandbox(true, 'stopped');
    try {
      const dispatch = makeDispatcher(sentinelCtx(sb));
      await dispatch('sentinel.stop');
      expect(readState(sb.statePath)).toEqual({ public: 'stopped', reserved: 'running', sentinel: 'stopped' });
    } finally { sb.cleanup(); }
  });

  // Un gate 'running' senza motore non sta filtrando: mostrarlo come attivo
  // sarebbe la stessa trappola diagnostica di "admin: running" su un pannello
  // che risponde 404.
  test('status distingue lo stato del gate dalla presenza del motore', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      const senzaMotore = await makeDispatcher(sentinelCtx(sb, {
        getSentinelState: () => 'running', hasSentinelEngine: () => false,
      }))('status');
      expect(senzaMotore.data.sentinel).toEqual({ state: 'running', engine: false });

      const conMotore = await makeDispatcher(sentinelCtx(sb, {
        getSentinelState: () => 'running', hasSentinelEngine: () => true,
      }))('status');
      expect(conMotore.data.sentinel).toEqual({ state: 'running', engine: true });
    } finally { sb.cleanup(); }
  });
});

test('KNOWN_COMMANDS lists all 13 commands', () => {
  expect(KNOWN_COMMANDS.sort()).toEqual([
    'admin.start', 'admin.stop',
    'public.start', 'public.stop',
    'publicOnly.off', 'publicOnly.on',
    'reserved.start', 'reserved.stop',
    'reset',
    'sentinel.monitor', 'sentinel.start', 'sentinel.stop',
    'status',
  ]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUPERFICIE RISERVATA + MACRO publicOnly
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('makeDispatcher reserved', () => {
  test('reserved.stop persists the state and applies it to the gate (no restart)', async () => {
    const sb = makeSandbox(true, 'running');
    const applied = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        setReservedState: (s) => applied.push(s),
      });
      const res = await dispatch('reserved.stop');
      expect(res.ok).toBe(true);
      expect(res.restart).toBe(false);
      expect(applied).toEqual(['stopped']);
      expect(readState(sb.statePath).reserved).toBe('stopped');
    } finally { sb.cleanup(); }
  });

  test('reserved.stop is a noop when already stopped', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      fs.writeFileSync(sb.statePath, '{ "public": "running", "reserved": "stopped" }', 'utf8');
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
      });
      const res = await dispatch('reserved.stop');
      expect(res.noop).toBe(true);
    } finally { sb.cleanup(); }
  });

  // Le due superfici sono indipendenti: toccarne una non deve riportare l'altra
  // al suo default (un `reserved stop` non deve annullare una manutenzione).
  test('reserved.stop does not clobber an active public stop', async () => {
    const sb = makeSandbox(true, 'stopped');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
      });
      await dispatch('reserved.stop');
      const state = readState(sb.statePath);
      expect(state).toEqual({ public: 'stopped', reserved: 'stopped', sentinel: 'running' });
    } finally { sb.cleanup(); }
  });

  // Il pannello sta DENTRO la superficie riservata: status deve dirlo, o
  // "admin: running" accanto a un pannello che da 404 diventa una trappola.
  test('status flags the admin panel as unreachable when reserved is stopped', async () => {
    const sb = makeSandbox(true, 'running');
    try {
      fs.writeFileSync(sb.statePath, '{ "public": "running", "reserved": "stopped" }', 'utf8');
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
      });
      const res = await dispatch('status');
      expect(res.data.admin).toEqual({ state: 'running', unreachable: true });
      expect(res.data.reserved).toEqual({ state: 'stopped' });
    } finally { sb.cleanup(); }
  });
});

describe('makeDispatcher publicOnly', () => {
  test('publicOnly.on stops reserved, disables admin and asks for a restart', async () => {
    const sb = makeSandbox(true, 'running');
    const applied = [];
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
        setReservedState: (s) => applied.push(s),
        requestRestart: () => {},
      });
      const res = await dispatch('publicOnly.on');
      expect(res.ok).toBe(true);
      expect(res.restart).toBe(true);
      expect(applied).toEqual(['stopped']);
      expect(readState(sb.statePath).reserved).toBe('stopped');
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*false/);
      await flush();
    } finally { sb.cleanup(); }
  });

  test('publicOnly.off reopens reserved and re-enables admin', async () => {
    const sb = makeSandbox(false, 'running');
    const applied = [];
    try {
      fs.writeFileSync(sb.statePath, '{ "public": "running", "reserved": "stopped" }', 'utf8');
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
        setReservedState: (s) => applied.push(s),
        requestRestart: () => {},
      });
      const res = await dispatch('publicOnly.off');
      expect(res.ok).toBe(true);
      expect(applied).toEqual(['running']);
      expect(readState(sb.statePath).reserved).toBe('running');
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*true/);
      await flush();
    } finally { sb.cleanup(); }
  });

  // Nulla da cambiare = nessun riavvio: un riavvio inutile chiude le connessioni
  // in corso per niente.
  test('publicOnly.on does not restart when the layout is already in place', async () => {
    const sb = makeSandbox(false, 'running');
    try {
      fs.writeFileSync(sb.statePath, '{ "public": "running", "reserved": "stopped" }', 'utf8');
      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
      });
      const res = await dispatch('publicOnly.on');
      expect(res.ok).toBe(true);
      expect(res.restart).toBe(false);
    } finally { sb.cleanup(); }
  });
});

// L'ordine dei passi della macro conta: prima quello che puo fallire.
// Con l'ordine invertito, un `writeEnableAdmin` fallito restituiva ok:false
// dopo aver gia commutato E PERSISTITO la superficie — cioe `publicOnly off`
// poteva riaprire l'area riservata e riportare comunque un errore.
describe('makeDispatcher publicOnly — atomicita dei passi', () => {
  test('a failing admin write leaves the reserved surface untouched', async () => {
    const sb = makeSandbox(true, 'running');
    const applied = [];
    try {
      // Config senza enableAdmin → writeEnableAdmin lancia ENABLE_ADMIN_NOT_FOUND
      fs.writeFileSync(sb.configPath, '{\n  "httpPort": 3000,\n}\n', 'utf8');
      fs.writeFileSync(sb.statePath, '{ "public": "running", "reserved": "stopped" }', 'utf8');

      const dispatch = makeDispatcher({
        startTime: Date.now(), ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath, statePath: sb.statePath,
        setReservedState: (s) => applied.push(s),
        requestRestart: () => {},
      });
      const res = await dispatch('publicOnly.off');

      expect(res.ok).toBe(false);
      // Il punto: la superficie NON e stata riaperta né in memoria né su disco.
      expect(applied).toEqual([]);
      expect(readState(sb.statePath).reserved).toBe('stopped');
    } finally { sb.cleanup(); }
  });
});
