/**
 * tests/integration/cliBridge.test.js
 *
 * End-to-end test del CLI control plane:
 *   1. Patch temporaneo di ital8Config.json5 (http port libera, https off,
 *      socket path in os.tmpdir)
 *   2. spawn `node index.js`
 *   3. Attesa che il socket compaia su disco
 *   4. Esecuzione di `node bin/ital8cms-cli.js ...` con vari comandi
 *   5. Verifica anche del soft public stop (HTTP GET / → 503)
 *   6. Cleanup: SIGTERM al server, restore della config, unlink del socket,
 *      ripristino file di stato cliBridge
 *
 * NOTA: i test `admin start/stop` non sono eseguiti qui perché farebbero
 * scattare un restart reale del processo, distruggendo il setup. La logica
 * è coperta dagli unit test (configEditor, protocol.test.js).
 */

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const json5 = require('json5');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CLIENT_PATH = path.join(PROJECT_ROOT, 'bin', 'ital8cms-cli.js');
const STATE_PATH = path.join(PROJECT_ROOT, 'core', 'cliBridge', 'state.json5');

const TEST_HTTP_PORT = 19500;
const TEST_SOCKET = path.join(
  os.tmpdir(),
  `ital8cms-cli-int-${process.pid}-${Date.now()}.sock`
);

jest.setTimeout(60000);

let serverProc = null;
let originalConfigRaw = null;
let originalStateRaw = null;
let serverOutput = '';

function patchConfig() {
  originalConfigRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = json5.parse(originalConfigRaw);
  const testCfg = {
    ...cfg,
    httpPort: TEST_HTTP_PORT,
    https: { ...(cfg.https || {}), enabled: false },
    cli: {
      enabled: true,
      socketPath: TEST_SOCKET,
      socketMode: '0600',
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testCfg, null, 2), 'utf8');
}

function snapshotState() {
  if (fs.existsSync(STATE_PATH)) {
    originalStateRaw = fs.readFileSync(STATE_PATH, 'utf8');
  }
}

function restoreConfig() {
  if (originalConfigRaw !== null) {
    fs.writeFileSync(CONFIG_PATH, originalConfigRaw, 'utf8');
    originalConfigRaw = null;
  }
}

function restoreState() {
  if (originalStateRaw !== null) {
    fs.writeFileSync(STATE_PATH, originalStateRaw, 'utf8');
  } else {
    try { fs.unlinkSync(STATE_PATH); } catch (_) {}
  }
}

function waitForSocket(timeoutMs = 25000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(TEST_SOCKET)) return resolve();
      if (serverProc && serverProc.exitCode !== null) {
        return reject(new Error(
          `server exited (code ${serverProc.exitCode}) before socket appeared\n--- server output ---\n${serverOutput}`
        ));
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(
          `timeout (${timeoutMs}ms) waiting for socket ${TEST_SOCKET}\n--- server output ---\n${serverOutput}`
        ));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function runClient(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLIENT_PATH, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function httpGet(reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: TEST_HTTP_PORT, path: reqPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('http timeout')));
  });
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 5000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    try { proc.kill('SIGTERM'); } catch (_) { clearTimeout(forceKill); resolve(); }
  });
}

beforeAll(async () => {
  snapshotState();
  patchConfig();
  serverProc = spawn('node', ['index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (c) => { serverOutput += c.toString(); });
  serverProc.stderr.on('data', (c) => { serverOutput += c.toString(); });
  await waitForSocket();
});

afterAll(async () => {
  await killProc(serverProc);
  restoreConfig();
  restoreState();
  try { fs.unlinkSync(TEST_SOCKET); } catch (_) {}
});

describe('cliBridge status', () => {
  test('status (--json) returns ok with pid, ports, admin/public running', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(typeof payload.data.pid).toBe('number');
    expect(payload.data.pid).toBeGreaterThan(0);
    expect(payload.data.httpPort).toBe(TEST_HTTP_PORT);
    expect(payload.data.httpsEnabled).toBe(false);
    expect(payload.data.httpsPort).toBeNull();
    expect(payload.data.admin).toEqual({ state: 'running' });
    expect(payload.data.public).toEqual({ state: 'running' });
    expect(typeof payload.data.uptime).toBe('number');
    expect(payload.data.uptime).toBeGreaterThanOrEqual(0);
  });

  test('status (human-readable) prints expected lines', async () => {
    const r = await runClient(['--socket', TEST_SOCKET, 'status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/ital8cms running/);
    expect(r.stdout).toMatch(/pid:\s+\d+/);
    expect(r.stdout).toMatch(new RegExp(`http:\\s+${TEST_HTTP_PORT}`));
    expect(r.stdout).toMatch(/https:\s+disabled/);
    expect(r.stdout).toMatch(/admin state:\s+running/);
    expect(r.stdout).toMatch(/public state:\s+running/);
  });
});

describe('cliBridge public stop/start (soft, no restart)', () => {
  // Order matters: stop first, then verify, then start, then verify again.
  // Each test depends on the previous state — keep them in order in one describe.

  test('public stop returns ok + restart:false, writes state file', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('public.stop');
    expect(payload.restart).toBe(false);
    expect(fs.readFileSync(STATE_PATH, 'utf8')).toMatch(/"public"\s*:\s*"stopped"/);
  });

  test('status reflects public=stopped after stop', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.data.public.state).toBe('stopped');
    expect(payload.data.admin.state).toBe('running');
  });

  test('GET / returns 503 + Retry-After + X-Robots-Tag when public is stopped', async () => {
    const r = await httpGet('/');
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(r.body).toMatch(/Torniamo subito/);
  });

  test('GET /admin/ still works when public is stopped (admin exempt)', async () => {
    const r = await httpGet('/admin/');
    // admin returns either 200 (page renders), 302 (redirect to login),
    // 403/401 (auth required) — anything except 503 is acceptable here.
    // The point is: admin must NOT be intercepted by the maintenance gate.
    expect(r.status).not.toBe(503);
    // Confirm the maintenance page body was not served either
    expect(r.body).not.toMatch(/Torniamo subito/);
  });

  test('public stop is idempotent (noop) when already stopped', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.noop).toBe(true);
  });

  test('public start restores serving', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('public.start');
    expect(payload.restart).toBe(false);
    expect(fs.readFileSync(STATE_PATH, 'utf8')).toMatch(/"public"\s*:\s*"running"/);
  });

  test('GET / no longer returns 503 after start', async () => {
    const r = await httpGet('/');
    expect(r.status).not.toBe(503);
  });

  test('public start is idempotent (noop) when already running', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.noop).toBe(true);
  });

  test('human output of public stop/start mentions the action', async () => {
    const rStop = await runClient(['--socket', TEST_SOCKET, 'public', 'stop']);
    expect(rStop.code).toBe(0);
    expect(rStop.stdout).toMatch(/public\.stop/);

    const rStart = await runClient(['--socket', TEST_SOCKET, 'public', 'start']);
    expect(rStart.code).toBe(0);
    expect(rStart.stdout).toMatch(/public\.start/);
  });
});

describe('cliBridge transport errors', () => {
  test('client reports not_running when socket does not exist', async () => {
    const bogusSocket = path.join(os.tmpdir(), `ital8cms-cli-bogus-${Date.now()}.sock`);
    const r = await runClient(['--json', '--socket', bogusSocket, 'status']);
    expect(r.code).toBe(1);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload).toMatchObject({ ok: false, error: 'not_running' });
    expect(payload.message).toMatch(/non sembra in esecuzione/);
  });
});
