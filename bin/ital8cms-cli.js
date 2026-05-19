#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const loadJson5 = require('../core/loadJson5');
const pkg = require('../package.json');

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_SOCKET_FILENAME = 'ital8cms.sock';

const program = new Command();

program
  .name('ital8cms-cli')
  .description('Control plane client for a running ital8cms instance')
  .version(pkg.version)
  .option('--json', 'output raw JSON instead of human-readable text')
  .option('--config <path>', 'path to ital8Config.json5 (default: ./ital8Config.json5)')
  .option('--socket <path>', 'unix socket path (overrides config)')
  .option('--timeout <ms>', 'connect/read timeout in milliseconds', String(DEFAULT_TIMEOUT_MS));

program
  .command('status')
  .description('show current ital8cms server status')
  .action(() => sendCommand('status'));

const admin = program.command('admin').description('admin section control');
admin.command('start').description('start admin section (stub in v1)').action(() => sendCommand('admin.start'));
admin.command('stop').description('stop admin section (stub in v1)').action(() => sendCommand('admin.stop'));

const pub = program.command('public').description('public section control');
pub.command('start').description('start public section (stub in v1)').action(() => sendCommand('public.start'));
pub.command('stop').description('stop public section (stub in v1)').action(() => sendCommand('public.stop'));

program.parseAsync(process.argv).catch((err) => {
  bail('client_error', err.message || String(err));
});

function resolveSocketPath() {
  const opts = program.opts();
  if (opts.socket) return path.resolve(opts.socket);

  const configPath = path.resolve(opts.config || './ital8Config.json5');
  if (!fs.existsSync(configPath)) {
    bail('client_error', `config non trovato: ${configPath} (usa --config <path> o --socket <path>)`);
  }
  let cfg;
  try {
    cfg = loadJson5(configPath);
  } catch (err) {
    bail('client_error', `errore leggendo ${configPath}: ${err.message}`);
  }
  const rawSocketPath = (cfg && cfg.cli && cfg.cli.socketPath) || `./${DEFAULT_SOCKET_FILENAME}`;
  const configDir = path.dirname(configPath);
  return path.isAbsolute(rawSocketPath) ? rawSocketPath : path.resolve(configDir, rawSocketPath);
}

function sendCommand(command) {
  const opts = program.opts();
  const socketPath = resolveSocketPath();
  const timeout = parseInt(opts.timeout, 10) || DEFAULT_TIMEOUT_MS;

  const sock = new net.Socket();
  let buffer = '';
  let finished = false;

  const finish = (exitCode, payload) => {
    if (finished) return;
    finished = true;
    try { sock.destroy(); } catch (_) {}
    emit(payload, command);
    process.exit(exitCode);
  };

  sock.setTimeout(timeout);
  sock.once('timeout', () => {
    finish(1, { ok: false, error: 'timeout', message: `nessuna risposta entro ${timeout}ms (${socketPath})` });
  });
  sock.once('error', (err) => {
    finish(1, transportError(err, socketPath));
  });
  sock.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const nl = buffer.indexOf('\n');
    if (nl === -1) return;
    const line = buffer.slice(0, nl);
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      finish(1, { ok: false, error: 'invalid_response', message: `risposta non parsabile: ${err.message}` });
      return;
    }
    finish(parsed && parsed.ok ? 0 : 2, parsed);
  });
  sock.once('connect', () => {
    sock.write(JSON.stringify({ command }) + '\n');
  });
  sock.connect(socketPath);
}

function transportError(err, socketPath) {
  if (err.code === 'ENOENT') {
    return {
      ok: false,
      error: 'not_running',
      message: `ital8cms non sembra in esecuzione (socket non trovato: ${socketPath})`,
    };
  }
  if (err.code === 'ECONNREFUSED') {
    return {
      ok: false,
      error: 'connection_refused',
      message: `socket presente ma il server non risponde (${socketPath}). Possibile crash dell'istanza.`,
    };
  }
  if (err.code === 'EACCES') {
    return {
      ok: false,
      error: 'permission_denied',
      message: `permessi insufficienti sul socket (${socketPath})`,
    };
  }
  return { ok: false, error: err.code || 'transport_error', message: err.message };
}

function bail(error, message) {
  const opts = (program && program.opts) ? program.opts() : {};
  const payload = { ok: false, error, message };
  if (opts && opts.json) {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    process.stderr.write(`ital8cms-cli: ${message}\n`);
  }
  process.exit(1);
}

function emit(payload, command) {
  const opts = program.opts();
  if (opts.json) {
    process.stdout.write(JSON.stringify(payload) + '\n');
    return;
  }
  renderHuman(payload, command);
}

function renderHuman(payload, command) {
  if (!payload || !payload.ok) {
    const msg = (payload && (payload.message || payload.error)) || 'unknown error';
    process.stderr.write(`ital8cms-cli: ${msg}\n`);
    return;
  }
  if (payload.stub) {
    process.stdout.write(`OK ${payload.action} (stub: nessuna azione eseguita in v1)\n`);
    return;
  }
  if (command === 'status' && payload.data) {
    const d = payload.data;
    const lines = [
      'ital8cms running',
      `  pid:           ${d.pid}`,
      `  uptime:        ${formatUptime(d.uptime)}`,
      `  http:          ${d.httpPort}`,
      `  https:         ${d.httpsEnabled ? d.httpsPort : 'disabled'}`,
      `  admin state:   ${d.admin && d.admin.state} (v1)`,
      `  public state:  ${d.public && d.public.state} (v1)`,
    ];
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  process.stdout.write(`OK ${command}\n`);
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return String(seconds);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return `${h}h ${mr}m ${s}s`;
}
