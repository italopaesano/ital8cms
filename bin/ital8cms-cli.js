#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command } = require('commander');
const loadJson5 = require('../core/loadJson5');
const resetConfigsToDefault = require('../core/resetConfigsToDefault');
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
  .option('--timeout <ms>', 'connect/read timeout in milliseconds', String(DEFAULT_TIMEOUT_MS))
  .option('--no-wait', 'do not wait for the server to come back after a restart');

program
  .command('status')
  .description('show current ital8cms server status')
  .action(() => sendCommand('status'));

const admin = program.command('admin').description('admin section control (triggers a process restart)');
admin.command('start').description('enable admin section and restart the process').action(() => sendCommand('admin.start'));
admin.command('stop').description('disable admin section and restart the process').action(() => sendCommand('admin.stop'));

const pub = program.command('public').description('public section control (no restart, soft maintenance gate)');
pub.command('start').description('serve public pages normally').action(() => sendCommand('public.start'));
pub.command('stop').description('serve a "be right back" page on all public routes').action(() => sendCommand('public.stop'));

program
  .command('reset <target>')
  .description('reset a plugin/theme config to defaults (offline: deletes live x.json5, regenerated at next boot)')
  .option('-y, --yes', 'skip the confirmation prompt')
  .option('--theme', 'target is a theme under themes/ (default: a plugin under plugins/)')
  .option('--dry-run', 'show what would be removed without deleting anything')
  .option('--online', 'reset via the running server (hot; triggers a restart) instead of offline filesystem')
  .action(async (target, cmdOpts) => {
    if (cmdOpts.online) {
      if (cmdOpts.dryRun) {
        bail('client_error', '--dry-run non è supportato con --online (il reset online agisce sul server in esecuzione)');
      }
      if (!cmdOpts.yes) {
        const onlineEssential = !cmdOpts.theme && loadEssentialPlugins().includes(target);
        if (onlineEssential) {
          process.stdout.write(`\n⚠  "${target}" è ESSENZIALE. Reset ONLINE: rimuove i config vivi e RIAVVIA il server.\n`);
          const typed = await promptLine(`   Per confermare, digita il nome esatto del plugin (${target}): `);
          if (typed.trim() !== target) {
            process.stdout.write('Reset annullato (nome non confermato).\n');
            process.exit(0);
          }
        } else {
          process.stdout.write(`Reset ONLINE di ${cmdOpts.theme ? 'themes' : 'plugins'}/${target}: rimuove i config vivi e RIAVVIA il server.\n`);
          const ok = await confirm('Procedere? [y/N] ');
          if (!ok) {
            process.stdout.write('Reset annullato.\n');
            process.exit(0);
          }
        }
      }
      return sendCommand('reset', { target, theme: !!cmdOpts.theme });
    }
    return doReset(target, cmdOpts);
  });

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

function sendCommand(command, extra = {}) {
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
    handleResponse(command, payload, socketPath, exitCode);
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
    sock.write(JSON.stringify({ command, ...extra }) + '\n');
  });
  sock.connect(socketPath);
}

function handleResponse(command, payload, socketPath, exitCode) {
  const opts = program.opts();
  const restartExpected = payload && payload.ok === true && payload.restart === true;

  if (!restartExpected || opts.wait === false || opts.json) {
    // wait=false comes from --no-wait (commander negates --no-* flags into wait:false)
    emit(payload, command);
    process.exit(exitCode);
    return;
  }

  // human-readable mode + restart pending → emit initial line, then poll
  process.stdout.write(`✓ ${payload.action || command} richiesto (${payload.message || 'restart in corso'})\n`);
  process.stdout.write('⏳ in attesa del riavvio del processo...\n');

  waitForRestart(socketPath, 15000).then((statusPayload) => {
    if (statusPayload && statusPayload.ok && statusPayload.data) {
      process.stdout.write(`✓ server ripartito (pid: ${statusPayload.data.pid})\n`);
      process.exit(0);
    } else {
      process.stderr.write('⚠ server non ripartito entro 15s, controlla manualmente con: ital8cms-cli status\n');
      process.exit(1);
    }
  }).catch((err) => {
    process.stderr.write(`⚠ errore in attesa del riavvio: ${err.message}\n`);
    process.exit(1);
  });
}

function waitForRestart(socketPath, totalTimeoutMs) {
  const startTime = Date.now();
  const pollIntervalMs = 200;

  return new Promise((resolve) => {
    let phase = 'wait-disappear'; // first the old socket must disappear

    const tick = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > totalTimeoutMs) return resolve(null);

      if (phase === 'wait-disappear') {
        if (!fs.existsSync(socketPath)) {
          phase = 'wait-ready';
        }
        setTimeout(tick, pollIntervalMs);
        return;
      }

      // phase = 'wait-ready' : socket must reappear and respond to status
      if (!fs.existsSync(socketPath)) {
        setTimeout(tick, pollIntervalMs);
        return;
      }

      probeStatus(socketPath, 1000).then((statusPayload) => {
        if (statusPayload) return resolve(statusPayload);
        setTimeout(tick, pollIntervalMs);
      });
    };

    setTimeout(tick, pollIntervalMs);
  });
}

function probeStatus(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let buffer = '';
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; try { sock.destroy(); } catch (_) {} resolve(val); } };

    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => done(null));
    sock.once('error', () => done(null));
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      try {
        done(JSON.parse(buffer.slice(0, nl)));
      } catch (_) { done(null); }
    });
    sock.once('connect', () => {
      sock.write(JSON.stringify({ command: 'status' }) + '\n');
    });
    sock.connect(socketPath);
  });
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
  if (payload.noop) {
    process.stdout.write(`= ${payload.action || command}: ${payload.message}\n`);
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
      `  admin state:   ${d.admin && d.admin.state}`,
      `  public state:  ${d.public && d.public.state}`,
    ];
    if (d.supervisor) lines.push(`  supervisor:    ${d.supervisor}`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  // public.start / public.stop have restart:false but still need a one-line confirmation
  if (payload.action) {
    process.stdout.write(`✓ ${payload.action}: ${payload.message || 'done'}\n`);
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

// ── reset (offline, filesystem) ─────────────────────────────────────────────
// Opera direttamente sui file e funziona anche a server spento (doc §3): rimuove
// i x.json5 vivi del plugin/tema (quelli con un x.default.json5); il prossimo
// boot li rigenera dai default. NON passa per il socket.

async function doReset(target, cmdOpts) {
  const opts = program.opts();

  // Sanitize: nome semplice, niente path traversal.
  if (!/^[A-Za-z0-9_-]+$/.test(target)) {
    bail('client_error', `nome target non valido: ${JSON.stringify(target)} (ammessi lettere, numeri, _ e -)`);
  }

  // projectRoot = cartella di ital8Config.json5 (NON quella di installazione del
  // CLI): corretto anche con install globale.
  const configPath = path.resolve(opts.config || './ital8Config.json5');
  if (!fs.existsSync(configPath)) {
    bail('client_error', `config non trovato: ${configPath} (esegui dalla root del progetto o usa --config <path>)`);
  }
  const projectRoot = path.dirname(configPath);

  const base = cmdOpts.theme ? 'themes' : 'plugins';
  const dir = path.join(projectRoot, base, target);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const otherBase = cmdOpts.theme ? 'plugins' : 'themes';
    if (fs.existsSync(path.join(projectRoot, otherBase, target))) {
      bail('client_error', `"${target}" non è in ${base}/, ma esiste in ${otherBase}/ — ${cmdOpts.theme ? 'ometti --theme' : 'aggiungi --theme'}`);
    }
    bail('client_error', `target non trovato: ${base}/${target}`);
  }

  let preview;
  try {
    preview = await resetConfigsToDefault(dir, { dryRun: true });
  } catch (err) {
    bail('client_error', err.message);
  }

  if (preview.removed.length === 0) {
    const msg = `nessun config vivo da resettare (${base}/${target} è già allo stato di default)`;
    if (opts.json) process.stdout.write(JSON.stringify({ ok: true, action: 'reset', target, noop: true, message: msg }) + '\n');
    else process.stdout.write(`= reset ${target}: ${msg}\n`);
    process.exit(0);
  }

  if (cmdOpts.dryRun) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, action: 'reset', target, dryRun: true, ...preview }) + '\n');
    } else {
      process.stdout.write(`dry-run reset ${target}: ${preview.removed.length} file verrebbero rimossi\n`);
      for (const f of preview.removed) process.stdout.write(`  - ${f}\n`);
    }
    process.exit(0);
  }

  const isEssential = !cmdOpts.theme && loadEssentialPlugins().includes(target);

  if (isEssential) {
    // Conferma RAFFORZATA per i plugin essenziali (config-lifecycle §4).
    process.stdout.write(`\n⚠  "${target}" è un plugin ESSENZIALE (essentialPlugins).\n`);
    process.stdout.write(`   Resettarlo può rompere autenticazione/controllo accessi o causare lockout del root.\n`);
    process.stdout.write(`   File da rimuovere (rigenerati dai .default al prossimo boot):\n`);
    for (const f of preview.removed) process.stdout.write(`     - ${f}\n`);
    if (cmdOpts.yes) {
      process.stdout.write('   (--yes: confermato senza prompt)\n');
    } else {
      const typed = await promptLine(`   Per confermare, digita il nome esatto del plugin (${target}): `);
      if (typed.trim() !== target) {
        process.stdout.write('Reset annullato (nome non confermato).\n');
        process.exit(0);
      }
    }
  } else if (!cmdOpts.yes) {
    process.stdout.write(`Reset di ${base}/${target}: verranno rimossi ${preview.removed.length} file vivi (rigenerati dai .default al prossimo boot):\n`);
    for (const f of preview.removed) process.stdout.write(`  - ${f}\n`);
    if (preview.userDataFiles.length) {
      process.stdout.write(`\n⚠  ATTENZIONE: reset di DATI UTENTE (${preview.userDataFiles.join(', ')}). Dovrai ricreare gli account (wizard o a mano) — rischio lockout.\n`);
    }
    const ok = await confirm('\nProcedere? [y/N] ');
    if (!ok) {
      process.stdout.write('Reset annullato.\n');
      process.exit(0);
    }
  }

  let result;
  try {
    result = await resetConfigsToDefault(dir);
  } catch (err) {
    bail('client_error', err.message);
  }

  const socketPath = safeSocketPath();
  const serverUp = !!(socketPath && fs.existsSync(socketPath));

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: result.errors.length === 0, action: 'reset', target, ...result, serverUp }) + '\n');
  } else {
    process.stdout.write(`✓ reset ${target}: ${result.removed.length} file rimossi\n`);
    for (const f of result.removed) process.stdout.write(`  - ${f}\n`);
    if (result.errors.length) {
      process.stdout.write(`⚠ ${result.errors.length} errori:\n`);
      for (const e of result.errors) process.stdout.write(`  ! ${e.file}: ${e.message}\n`);
    }
    process.stdout.write(serverUp
      ? `\nℹ il server sembra in esecuzione: i file saranno rigenerati al prossimo riavvio (o usa il reset online).\n`
      : `\nℹ i file saranno rigenerati dai .default al prossimo avvio.\n`);
  }
  process.exit(result.errors.length ? 2 : 0);
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

// Prompt che ritorna la riga digitata (per la conferma rafforzata: ridigitare il nome).
function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer)); });
  });
}

// Lista dei plugin essenziali da ital8Config.json5 (best-effort, [] se non leggibile).
function loadEssentialPlugins() {
  try {
    const opts = program.opts();
    const configPath = path.resolve(opts.config || './ital8Config.json5');
    if (!fs.existsSync(configPath)) return [];
    const cfg = loadJson5(configPath);
    return Array.isArray(cfg.essentialPlugins) ? cfg.essentialPlugins : [];
  } catch (_) {
    return [];
  }
}

// Risolve il socket path senza uscire dal processo (best-effort, per il solo
// avviso "server in esecuzione"). resolveSocketPath() invece esce con bail().
function safeSocketPath() {
  try {
    const opts = program.opts();
    if (opts.socket) return path.resolve(opts.socket);
    const configPath = path.resolve(opts.config || './ital8Config.json5');
    if (!fs.existsSync(configPath)) return null;
    const cfg = loadJson5(configPath);
    const raw = (cfg && cfg.cli && cfg.cli.socketPath) || `./${DEFAULT_SOCKET_FILENAME}`;
    return path.isAbsolute(raw) ? raw : path.resolve(path.dirname(configPath), raw);
  } catch (_) {
    return null;
  }
}
