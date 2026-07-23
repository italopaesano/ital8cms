/**
 * serverControl — helper per parlare con un'istanza ital8cms in esecuzione dal
 * di FUORI (script da terminale: restore, update). Riusa il control plane su
 * unix socket del cliBridge (stesso protocollo di bin/ital8cms-cli.js).
 *
 * Volutamente SENZA dipendenze npm (solo built-in): questi helper girano sul
 * percorso di recovery/aggiornamento, dove node_modules può essere assente o
 * in fase di sostituzione. Non usa il logger dell'app (che leggerebbe config e
 * scriverebbe con timestamp): l'output utente lo fa lo script chiamante.
 *
 * Concetti chiave:
 *   - Il server, se attivo, apre un unix socket (path da ital8Config.json5 →
 *     cli.socketPath, default ./ital8cms.sock) e risponde al comando `status`.
 *   - `status.data.supervisor` dice se il processo è nato sotto un supervisor
 *     (pm2/systemd/supervisord). In quel caso NON fermiamo noi il processo:
 *     lo farebbe ripartire il supervisor. Il chiamante istruisce l'utente.
 */

'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_SOCKET_FILENAME = 'ital8cms.sock';

/**
 * Estrae cli.socketPath dal testo di ital8Config.json5 SENZA dipendere dal
 * pacchetto npm `json5` (questo modulo gira anche con node_modules assente).
 * Prima tenta JSON.parse (config in JSON puro), poi ripiega su una regex
 * best-effort per il caso JSON5-con-commenti. Ritorna null se non trovato.
 */
function extractSocketPath(text) {
  try {
    const cfg = JSON.parse(text);
    return (cfg && cfg.cli && cfg.cli.socketPath) || null;
  } catch (_) {
    const m = text.match(/socketPath\s*:\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }
}

/**
 * Risolve il path dello unix socket a partire dalla config (come la CLI).
 * @param {string} projectRoot - root del progetto (dove sta ital8Config.json5).
 * @returns {string} path assoluto del socket.
 */
function resolveSocketPath(projectRoot) {
  const configPath = path.join(projectRoot, 'ital8Config.json5');
  let raw = `./${DEFAULT_SOCKET_FILENAME}`;
  try {
    raw = extractSocketPath(fs.readFileSync(configPath, 'utf8')) || raw;
  } catch (_) {
    // config assente/illeggibile → default. Il chiamante gestirà "non in esecuzione".
  }
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

/**
 * Invia un comando al socket e risolve con il payload JSON (o null se
 * irraggiungibile / timeout / risposta non valida).
 * @param {string} socketPath
 * @param {string} command
 * @param {number} timeoutMs
 * @returns {Promise<object|null>}
 */
function sendCommand(socketPath, command, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let buffer = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) {}
      resolve(val);
    };

    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => done(null));
    sock.once('error', () => done(null));
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      try { done(JSON.parse(buffer.slice(0, nl))); } catch (_) { done(null); }
    });
    sock.once('connect', () => {
      sock.write(JSON.stringify({ command }) + '\n');
    });
    sock.connect(socketPath);
  });
}

/**
 * Interroga lo stato del server.
 * @param {string} projectRoot
 * @param {number} [timeoutMs]
 * @returns {Promise<{running: boolean, data: object|null, socketPath: string}>}
 */
async function getStatus(projectRoot, timeoutMs = 2000) {
  const socketPath = resolveSocketPath(projectRoot);
  if (!fs.existsSync(socketPath)) {
    return { running: false, data: null, socketPath };
  }
  const payload = await sendCommand(socketPath, 'status', timeoutMs);
  if (payload && payload.ok && payload.data) {
    return { running: true, data: payload.data, socketPath };
  }
  // Socket presente ma nessuna risposta valida: processo forse crashato.
  return { running: false, data: null, socketPath };
}

/**
 * Attende che il socket sparisca (segno che il processo si è chiuso).
 * @param {string} socketPath
 * @param {number} totalTimeoutMs
 * @returns {Promise<boolean>} true se sparito entro il timeout.
 */
function waitForSocketGone(socketPath, totalTimeoutMs = 15000) {
  const start = Date.now();
  const interval = 200;
  return new Promise((resolve) => {
    const tick = () => {
      if (!fs.existsSync(socketPath)) return resolve(true);
      if (Date.now() - start > totalTimeoutMs) return resolve(false);
      setTimeout(tick, interval);
    };
    tick();
  });
}

/**
 * Ferma un'istanza self-managed (non sotto supervisor) inviando SIGTERM al pid,
 * su cui index.js fa gracefulShutdown. NON ferma un'istanza supervisionata:
 * ritorna { supervised } così il chiamante può istruire l'utente.
 *
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000] - attesa massima per la chiusura.
 * @returns {Promise<{wasRunning:boolean, stopped:boolean, supervised:(string|null), pid:(number|null)}>}
 */
async function stopSelfManaged(projectRoot, opts = {}) {
  const timeoutMs = opts.timeoutMs || 15000;
  const status = await getStatus(projectRoot);

  if (!status.running) {
    return { wasRunning: false, stopped: false, supervised: null, pid: null };
  }

  const supervisor = status.data.supervisor || null;
  const pid = status.data.pid || null;

  if (supervisor) {
    // Sotto supervisor: fermarlo noi sarebbe inutile (verrebbe riavviato).
    return { wasRunning: true, stopped: false, supervised: supervisor, pid };
  }

  if (!pid) {
    return { wasRunning: true, stopped: false, supervised: null, pid: null };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Processo già morto ma socket rimasto: consideralo fermo.
      return { wasRunning: true, stopped: true, supervised: null, pid };
    }
    throw err;
  }

  const gone = await waitForSocketGone(status.socketPath, timeoutMs);
  return { wasRunning: true, stopped: gone, supervised: null, pid };
}

module.exports = {
  DEFAULT_SOCKET_FILENAME,
  resolveSocketPath,
  sendCommand,
  getStatus,
  waitForSocketGone,
  stopSelfManaged,
};
