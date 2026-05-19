const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRequestLine, parseSocketMode } = require('../../../core/cliBridge/server');
const { makeDispatcher, KNOWN_COMMANDS } = require('../../../core/cliBridge/handlers');

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

describe('makeDispatcher.status', () => {
  test('reports running/running when admin=true and public=running', () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now() - 5000,
        ital8Conf: { httpPort: 3000, https: { enabled: true, port: 3443 } },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = dispatch('status');
      expect(res.ok).toBe(true);
      expect(res.data.admin).toEqual({ state: 'running' });
      expect(res.data.public).toEqual({ state: 'running' });
      expect(res.data.httpPort).toBe(3000);
      expect(res.data.httpsEnabled).toBe(true);
      expect(res.data.httpsPort).toBe(3443);
    } finally { sb.cleanup(); }
  });

  test('reports stopped/stopped when admin=false and public=stopped', () => {
    const sb = makeSandbox(false, 'stopped');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 8080, https: { enabled: false } },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = dispatch('status');
      expect(res.data.admin).toEqual({ state: 'stopped' });
      expect(res.data.public).toEqual({ state: 'stopped' });
      expect(res.data.httpsEnabled).toBe(false);
      expect(res.data.httpsPort).toBeNull();
    } finally { sb.cleanup(); }
  });

  test('uses getPublicState callback if provided', () => {
    const sb = makeSandbox(true, 'running');
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        getPublicState: () => 'stopped',
      });
      const res = dispatch('status');
      expect(res.data.public.state).toBe('stopped');
    } finally { sb.cleanup(); }
  });
});

describe('makeDispatcher.admin start/stop', () => {
  test('admin.stop writes enableAdmin=false and schedules restart', () => {
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
      const res = dispatch('admin.stop');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('admin.stop');
      expect(res.restart).toBe(true);
      expect(res.noop).toBeUndefined();
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*false/);
      // requestRestart is called via setImmediate — flush microtasks
      return new Promise((resolve) => setImmediate(() => {
        expect(restartCalls.length).toBe(1);
        expect(restartCalls[0].reason).toBe('admin.stop');
        resolve();
      }));
    } finally { sb.cleanup(); }
  });

  test('admin.start writes enableAdmin=true and schedules restart', () => {
    const sb = makeSandbox(false);
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
        requestRestart: () => {},
      });
      const res = dispatch('admin.start');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('admin.start');
      expect(res.restart).toBe(true);
      expect(fs.readFileSync(sb.configPath, 'utf8')).toMatch(/"enableAdmin"\s*:\s*true/);
    } finally { sb.cleanup(); }
  });

  test('admin.stop is idempotent (noop) when already stopped', () => {
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
      const res = dispatch('admin.stop');
      expect(res.ok).toBe(true);
      expect(res.noop).toBe(true);
      expect(res.restart).toBe(false);
      return new Promise((resolve) => setImmediate(() => {
        expect(restartCalls.length).toBe(0);
        resolve();
      }));
    } finally { sb.cleanup(); }
  });

  test('admin.stop reports config_edit_failed when config missing', () => {
    const dispatch = makeDispatcher({
      startTime: Date.now(),
      ital8Conf: { httpPort: 3000 },
      configPath: '/nonexistent/path/ital8Config.json5',
      statePath: '/nonexistent/state.json5',
    });
    const res = dispatch('admin.stop');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/ENOENT|non trovato|no such file/i);
  });
});

describe('makeDispatcher.public start/stop', () => {
  test('public.stop writes state and calls setPublicState (no restart)', () => {
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
      const res = dispatch('public.stop');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('public.stop');
      expect(res.restart).toBe(false);
      expect(calls).toEqual(['stopped']);
      const stateContent = fs.readFileSync(sb.statePath, 'utf8');
      expect(stateContent).toMatch(/"public"\s*:\s*"stopped"/);
    } finally { sb.cleanup(); }
  });

  test('public.start writes state running and calls setPublicState', () => {
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
      const res = dispatch('public.start');
      expect(res.ok).toBe(true);
      expect(res.restart).toBe(false);
      expect(calls).toEqual(['running']);
    } finally { sb.cleanup(); }
  });

  test('public.stop is idempotent (noop) when already stopped', () => {
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
      const res = dispatch('public.stop');
      expect(res.noop).toBe(true);
      expect(calls).toEqual([]);
    } finally { sb.cleanup(); }
  });
});

describe('makeDispatcher unknown commands', () => {
  test('returns unknown_command for garbage input', () => {
    const sb = makeSandbox();
    try {
      const dispatch = makeDispatcher({
        startTime: Date.now(),
        ital8Conf: { httpPort: 3000 },
        configPath: sb.configPath,
        statePath: sb.statePath,
      });
      const res = dispatch('nonsense');
      expect(res).toMatchObject({ ok: false, error: 'unknown_command' });
    } finally { sb.cleanup(); }
  });
});

test('KNOWN_COMMANDS lists all 5 commands', () => {
  expect(KNOWN_COMMANDS.sort()).toEqual(['admin.start', 'admin.stop', 'public.start', 'public.stop', 'status']);
});
