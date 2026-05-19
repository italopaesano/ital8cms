/**
 * tests/integration/cliBridge.test.js
 *
 * End-to-end test del CLI control plane:
 *   1. Patch temporaneo di ital8Config.json5 (http port libera, https off,
 *      socket path in os.tmpdir, plugin/theme di test)
 *   2. spawn `node index.js`
 *   3. Attesa che il socket compaia su disco
 *   4. Esecuzione di `node bin/ital8cms-cli.js ...` con vari comandi
 *   5. Cleanup: SIGTERM al server, restore della config, unlink del socket
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const json5 = require('json5');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');
const CLIENT_PATH = path.join(PROJECT_ROOT, 'bin', 'ital8cms-cli.js');

const TEST_HTTP_PORT = 19500;
const TEST_SOCKET = path.join(
  os.tmpdir(),
  `ital8cms-cli-int-${process.pid}-${Date.now()}.sock`
);

jest.setTimeout(60000);

let serverProc = null;
let originalConfigRaw = null;
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

function restoreConfig() {
  if (originalConfigRaw !== null) {
    fs.writeFileSync(CONFIG_PATH, originalConfigRaw, 'utf8');
    originalConfigRaw = null;
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

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 5000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    try { proc.kill('SIGTERM'); } catch (_) { clearTimeout(forceKill); resolve(); }
  });
}

beforeAll(async () => {
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
  try { fs.unlinkSync(TEST_SOCKET); } catch (_) {}
});

describe('cliBridge end-to-end', () => {
  test('status (--json) returns ok with pid and ports', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'status']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(typeof payload.data.pid).toBe('number');
    expect(payload.data.pid).toBeGreaterThan(0);
    expect(payload.data.httpPort).toBe(TEST_HTTP_PORT);
    expect(payload.data.httpsEnabled).toBe(false);
    expect(payload.data.httpsPort).toBeNull();
    expect(payload.data.admin).toEqual({ state: 'unknown' });
    expect(payload.data.public).toEqual({ state: 'unknown' });
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
    expect(r.stdout).toMatch(/admin state:\s+unknown/);
    expect(r.stdout).toMatch(/public state:\s+unknown/);
  });

  test('admin start returns stub (--json)', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'admin', 'start']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload).toMatchObject({ ok: true, stub: true, action: 'admin.start' });
    expect(payload.message).toMatch(/stub/);
  });

  test('admin stop returns stub', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'admin', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.action).toBe('admin.stop');
    expect(payload.stub).toBe(true);
  });

  test('public start returns stub', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'start']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.action).toBe('public.start');
    expect(payload.stub).toBe(true);
  });

  test('public stop returns stub', async () => {
    const r = await runClient(['--json', '--socket', TEST_SOCKET, 'public', 'stop']);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload.action).toBe('public.stop');
    expect(payload.stub).toBe(true);
  });

  test('stub command (human output) reports "stub: nessuna azione eseguita"', async () => {
    const r = await runClient(['--socket', TEST_SOCKET, 'admin', 'start']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/OK admin\.start \(stub: nessuna azione eseguita in v1\)/);
  });

  test('client reports not_running with clear message when socket does not exist', async () => {
    const bogusSocket = path.join(os.tmpdir(), `ital8cms-cli-bogus-${Date.now()}.sock`);
    const r = await runClient(['--json', '--socket', bogusSocket, 'status']);
    expect(r.code).toBe(1);
    const payload = JSON.parse(r.stdout.trim());
    expect(payload).toMatchObject({ ok: false, error: 'not_running' });
    expect(payload.message).toMatch(/non sembra in esecuzione/);
  });
});
