const net = require('net');
const fs = require('fs');
const path = require('path');
const { ensureSocketPathFree } = require('./socketProbe');
const { makeDispatcher } = require('./handlers');

const LINE_DELIMITER = '\n';
const MAX_LINE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_SOCKET_PATH = './ital8cms.sock';
const DEFAULT_SOCKET_MODE = 0o660;

function parseRequestLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return { ok: false, error: 'invalid_json', message: err.message };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_request', message: 'request must be a JSON object' };
  }
  if (typeof parsed.command !== 'string' || parsed.command.length === 0) {
    return { ok: false, error: 'invalid_request', message: 'request.command must be a non-empty string' };
  }
  return { ok: true, value: parsed };
}

function parseSocketMode(value, fallback = DEFAULT_SOCKET_MODE) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/^0o/i, '').replace(/^0+(?=\d)/, '');
    const parsed = parseInt(cleaned, 8);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function handleConnection(socket, dispatcher) {
  let buffer = '';
  let settled = false;
  let handled = false;

  const sendResponse = (obj) => {
    if (settled) return;
    settled = true;
    try {
      socket.end(JSON.stringify(obj) + LINE_DELIMITER);
    } catch (_err) {
      try { socket.destroy(); } catch (_) {}
    }
  };

  const timeout = setTimeout(() => {
    sendResponse({
      ok: false,
      error: 'timeout',
      message: `no complete request within ${REQUEST_TIMEOUT_MS}ms`,
    });
  }, REQUEST_TIMEOUT_MS);
  timeout.unref();

  socket.on('data', async (chunk) => {
    if (settled || handled) return;
    buffer += chunk.toString('utf8');
    if (buffer.length > MAX_LINE_BYTES) {
      clearTimeout(timeout);
      sendResponse({
        ok: false,
        error: 'request_too_large',
        message: `request exceeds ${MAX_LINE_BYTES} bytes`,
      });
      return;
    }
    const nl = buffer.indexOf(LINE_DELIMITER);
    if (nl === -1) return;

    handled = true; // una sola richiesta per connessione: evita ri-dispatch durante l'await
    clearTimeout(timeout);
    const line = buffer.slice(0, nl);
    const parsed = parseRequestLine(line);
    if (!parsed.ok) {
      sendResponse({ ok: false, error: parsed.error, message: parsed.message });
      return;
    }

    let response;
    try {
      // Il dispatcher può essere async (es. reset). Gli handler sincroni restano
      // compatibili: await su un valore non-promise lo restituisce invariato.
      // Si passa l'intera richiesta così i comandi con argomenti (reset.target)
      // possono leggerli.
      response = await dispatcher(parsed.value.command, parsed.value);
    } catch (err) {
      response = { ok: false, error: 'internal_error', message: err.message };
    }
    sendResponse(response);
  });

  socket.on('error', () => {
    clearTimeout(timeout);
  });
}

function warnBindFailure(socketPath, err) {
  const line = '[cliBridge] ═══════════════════════════════════════════════════════';
  console.warn(line);
  console.warn(`[cliBridge]  ⚠  impossibile creare il control socket: ${err.code || 'ERR'}`);
  console.warn(`[cliBridge]     path: ${socketPath}`);
  console.warn(`[cliBridge]     ${err.message}`);
  console.warn('[cliBridge]');
  if (err.code === 'EACCES') {
    console.warn('[cliBridge]  Permessi insufficienti.');
    console.warn('[cliBridge]    • verifica che la directory che contiene il socket sia writable');
    console.warn('[cliBridge]    • oppure imposta `cli.socketPath` in ital8Config.json5');
  } else if (err.code === 'EADDRINUSE') {
    console.warn('[cliBridge]  Un altro processo ital8cms risulta in ascolto sullo stesso socket.');
    console.warn('[cliBridge]    • ferma l\'altra istanza, oppure');
    console.warn('[cliBridge]    • cambia `cli.socketPath` in ital8Config.json5');
  } else {
    console.warn('[cliBridge]  Per disabilitare il control plane:');
    console.warn('[cliBridge]    "cli": { "enabled": false }   in ital8Config.json5');
  }
  console.warn('[cliBridge]  ▶ il server continua senza canale CLI');
  console.warn(line);
}

async function start(ital8Conf, options = {}) {
  const cliConf = (ital8Conf && ital8Conf.cli) || {};
  if (cliConf.enabled === false) {
    console.log('[cliBridge] disabilitato in config (cli.enabled=false), nessun socket creato');
    return null;
  }

  const projectRoot = options.projectRoot || process.cwd();
  const rawPath = cliConf.socketPath || DEFAULT_SOCKET_PATH;
  const socketPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
  const socketMode = parseSocketMode(cliConf.socketMode);

  try {
    await ensureSocketPathFree(socketPath);
  } catch (err) {
    warnBindFailure(socketPath, err);
    return null;
  }

  const dispatcher = makeDispatcher({
    startTime: Date.now(),
    ital8Conf,
    projectRoot,
    configPath: options.configPath,
    statePath: options.statePath,
    requestRestart: options.requestRestart,
    setPublicState: options.setPublicState,
    getPublicState: options.getPublicState,
    setReservedState: options.setReservedState,
    getReservedState: options.getReservedState,
    setSentinelState: options.setSentinelState,
    getSentinelState: options.getSentinelState,
    // Distinta dallo stato: un gate 'running' senza motore non sta filtrando.
    hasSentinelEngine: options.hasSentinelEngine,
    testSentinelRequest: options.testSentinelRequest,
  });

  const server = net.createServer((sock) => handleConnection(sock, dispatcher));

  return await new Promise((resolve) => {
    // La umask va ripristinata su OGNI uscita, non solo sul successo: vedi la
    // nota estesa sotto, accanto a dove viene impostata.
    let umaskRipristinata = false;
    const ripristinaUmask = () => {
      if (umaskRipristinata) return;
      umaskRipristinata = true;
      try { process.umask(umaskPrecedente); } catch (_) { /* non fatale */ }
    };

    server.once('error', (err) => {
      ripristinaUmask();
      warnBindFailure(socketPath, err);
      resolve(null);
    });

    // ── I PERMESSI PRIMA DELL'ESPOSIZIONE (REVIEW.md → C6) ───────────────────
    //
    // Prima il `chmod` stava DENTRO la callback di `listen`, cioè dopo che il
    // socket esisteva: fra la sua creazione e la chiusura dei permessi c'era una
    // finestra in cui il canale di controllo era raggiungibile con i permessi di
    // default (0777 & ~umask). E un `chmod` fallito era solo un warning: il
    // canale restava aperto con permessi IGNOTI.
    //
    // Il socket nasce ora già con il modo giusto, impostando la `umask` attorno
    // al bind — è il solo modo di influenzare il modo di CREAZIONE di un socket
    // UNIX da Node, che non accetta un'opzione di modo su `listen`. Il `chmod`
    // resta come cintura: se la umask non ha avuto effetto (filesystem esotici,
    // mount con opzioni particolari) il modo viene corretto comunque.
    //
    // E se nemmeno il chmod riesce, il canale NON si apre: un canale di
    // controllo con permessi ignoti è peggio di un canale assente. Chi usa la
    // CLI riceve un errore di connessione, non un canale che non sa chi ascolta.
    // ⚠️ La umask è GLOBALE al processo, e va ripristinata su ogni uscita da
    // qui — non solo sul successo. Prima la ripristinavo soltanto nella callback
    // di `listen`: un errore di bind (cartella del socket inesistente, percorso
    // occupato) arriva sull'evento `error`, quindi la umask restava a
    // `0o777 & ~socketMode` per TUTTA la vita del processo.
    //
    // Misurato: da `022` a `177`. Da quel momento ogni file creato dal processo
    // nasce a 600 e ogni **directory** a 600, cioè senza bit di esecuzione:
    // non attraversabile. Un socket in una cartella che non esiste bastava a
    // rompere, molto più tardi e altrove, la creazione di una qualunque dir.
    const umaskPerModo = 0o777 & ~socketMode;
    const umaskPrecedente = process.umask(umaskPerModo);

    server.listen(socketPath, () => {
      ripristinaUmask();

      let modoEffettivo = null;
      try {
        fs.chmodSync(socketPath, socketMode);
        modoEffettivo = fs.statSync(socketPath).mode & 0o777;
      } catch (err) {
        // Fail-closed: si chiude il socket e si rinuncia al canale.
        console.error(
          `[cliBridge] impossibile garantire i permessi ${socketMode.toString(8)} su ${socketPath}: `
          + `${err.message} — canale di controllo NON aperto (un canale con permessi ignoti è `
          + 'peggio di un canale assente).'
        );
        try { server.close(); } catch (_) { /* già chiuso */ }
        try { fs.unlinkSync(socketPath); } catch (_) { /* potrebbe non esistere */ }
        resolve(null);
        return;
      }

      if (modoEffettivo !== socketMode) {
        // Il chmod non ha lanciato ma il modo non è quello chiesto: stesso
        // trattamento, perché la garanzia che conta è quella misurata.
        console.error(
          `[cliBridge] i permessi su ${socketPath} risultano ${modoEffettivo.toString(8)} `
          + `invece di ${socketMode.toString(8)} — canale di controllo NON aperto.`
        );
        try { server.close(); } catch (_) { /* già chiuso */ }
        try { fs.unlinkSync(socketPath); } catch (_) { /* potrebbe non esistere */ }
        resolve(null);
        return;
      }

      console.log(`[cliBridge] in ascolto su ${socketPath} (mode ${socketMode.toString(8)})`);
      resolve({ server, socketPath });
    });
  });
}

module.exports = {
  start,
  parseRequestLine,
  parseSocketMode,
  DEFAULT_SOCKET_PATH,
  DEFAULT_SOCKET_MODE,
};
