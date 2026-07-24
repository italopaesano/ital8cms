const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const sc = require('../../../scripts/lib/serverControl');

let root;
const servers = [];
const children = [];

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-sc-')); });

afterEach(async () => {
  for (const s of servers.splice(0)) { try { await new Promise((r) => s.close(r)); } catch (_) {} }
  for (const c of children.splice(0)) { try { c.kill('SIGKILL'); } catch (_) {} }
  fs.rmSync(root, { recursive: true, force: true });
});

/** Server finto sul socket di default di `root`, che risponde a status con `data`. */
function startFakeServer(data) {
  const sockPath = path.join(root, 'ital8cms.sock');
  const server = net.createServer((conn) => {
    conn.on('data', () => conn.write(JSON.stringify({ ok: true, data }) + '\n'));
  });
  servers.push(server);
  return new Promise((res) => server.listen(sockPath, () => res(sockPath)));
}

describe('resolveSocketPath', () => {
  test('default when no config', () => {
    expect(sc.resolveSocketPath(root)).toBe(path.join(root, 'ital8cms.sock'));
  });

  test('reads cli.socketPath from plain JSON config (absolute)', () => {
    fs.writeFileSync(path.join(root, 'ital8Config.json5'), JSON.stringify({ cli: { socketPath: '/tmp/custom.sock' } }));
    expect(sc.resolveSocketPath(root)).toBe('/tmp/custom.sock');
  });

  test('reads cli.socketPath from JSON5-with-comments config (relative)', () => {
    fs.writeFileSync(path.join(root, 'ital8Config.json5'),
      '// commento\n{\n  cli: { socketPath: "./run/app.sock" }, // trailing\n}\n');
    expect(sc.resolveSocketPath(root)).toBe(path.resolve(root, 'run/app.sock'));
  });
});

describe('getStatus', () => {
  test('not running when no socket', async () => {
    expect(await sc.getStatus(root)).toMatchObject({ running: false, data: null });
  });

  test('not running when socket path is a stale non-socket file', async () => {
    fs.writeFileSync(path.join(root, 'ital8cms.sock'), 'stale');
    expect((await sc.getStatus(root)).running).toBe(false);
  });

  test('running with data from a responding server', async () => {
    await startFakeServer({ pid: 4242, uptime: 9, supervisor: null });
    const st = await sc.getStatus(root);
    expect(st.running).toBe(true);
    expect(st.data).toMatchObject({ pid: 4242, supervisor: null });
  });
});

describe('stopSelfManaged', () => {
  test('no server → wasRunning false', async () => {
    expect(await sc.stopSelfManaged(root)).toMatchObject({ wasRunning: false, stopped: false, supervised: null });
  });

  test('supervised → does not stop, reports supervisor', async () => {
    await startFakeServer({ pid: 4242, supervisor: 'INVOCATION_ID' });
    const r = await sc.stopSelfManaged(root);
    expect(r).toMatchObject({ wasRunning: true, stopped: false, supervised: 'INVOCATION_ID' });
  });

  test('invalid pid → no kill attempted', async () => {
    await startFakeServer({ pid: 'not-a-number', supervisor: null });
    const r = await sc.stopSelfManaged(root);
    expect(r).toMatchObject({ wasRunning: true, stopped: false, pid: null });
  });

  test('self-managed → SIGTERM the real child, socket disappears', async () => {
    const sockPath = path.join(root, 'ital8cms.sock');
    const code = `
      const net=require('net'),fs=require('fs');
      const s=process.env.SOCK;
      const srv=net.createServer(c=>c.on('data',()=>c.write(JSON.stringify({ok:true,data:{pid:process.pid,supervisor:null}})+'\\n')));
      srv.listen(s);
      process.on('SIGTERM',()=>{try{fs.unlinkSync(s)}catch(e){}process.exit(0)});
    `;
    const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, SOCK: sockPath } });
    children.push(child);

    // attendi che il child sia in ascolto
    for (let i = 0; i < 50 && !(await sc.getStatus(root)).running; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await sc.getStatus(root)).running).toBe(true);

    const r = await sc.stopSelfManaged(root, { timeoutMs: 5000 });
    expect(r.wasRunning).toBe(true);
    expect(r.stopped).toBe(true);
    expect(fs.existsSync(sockPath)).toBe(false);
  });
});

describe('waitForSocketGone', () => {
  test('resolves true when the socket file is removed', async () => {
    const p = path.join(root, 'x.sock');
    fs.writeFileSync(p, '');
    setTimeout(() => { try { fs.unlinkSync(p); } catch (_) {} }, 150);
    expect(await sc.waitForSocketGone(p, 3000)).toBe(true);
  });

  test('resolves false on timeout while the file persists', async () => {
    const p = path.join(root, 'y.sock');
    fs.writeFileSync(p, '');
    expect(await sc.waitForSocketGone(p, 400)).toBe(false);
  });
});
