const fs = require('fs');
const path = require('path');
const { readEnableAdmin, writeEnableAdmin } = require('./configEditor');
const { readState, writeState } = require('./stateFile');
const { detectSupervisor } = require('./respawn');
const resetConfigsToDefault = require('../resetConfigsToDefault');
const setJson5Key = require('../setJson5Key');

function buildStatus(ctx) {
  const { startTime, ital8Conf, configPath, statePath, getPublicState, getReservedState } = ctx;
  const httpsEnabled = !!(ital8Conf && ital8Conf.https && ital8Conf.https.enabled);

  let adminState = 'unknown';
  try {
    adminState = readEnableAdmin(configPath) ? 'running' : 'stopped';
  } catch (_err) {
    adminState = ital8Conf.enableAdmin ? 'running' : 'stopped';
  }

  const publicState = typeof getPublicState === 'function'
    ? getPublicState()
    : (readState(statePath).public);

  const reservedState = typeof getReservedState === 'function'
    ? getReservedState()
    : (readState(statePath).reserved);

  // Il pannello admin è un SOTTOINSIEME della superficie riservata: con
  // `reserved stop` è irraggiungibile anche quando enableAdmin è true. Senza
  // questo flag `status` mostrerebbe "admin: running" mentre l'admin riceve 404
  // — una trappola diagnostica. Il client lo rende esplicito accanto allo stato.
  const adminUnreachable = adminState === 'running' && reservedState === 'stopped';

  return {
    ok: true,
    data: {
      pid: process.pid,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      httpPort: ital8Conf ? ital8Conf.httpPort : null,
      httpsEnabled,
      httpsPort: httpsEnabled ? ital8Conf.https.port : null,
      admin: { state: adminState, unreachable: adminUnreachable },
      reserved: { state: reservedState },
      public: { state: publicState },
      supervisor: detectSupervisor(),
    },
  };
}

function handleAdminToggle(ctx, targetValue) {
  const { configPath, requestRestart } = ctx;

  let result;
  try {
    result = writeEnableAdmin(configPath, targetValue);
  } catch (err) {
    return {
      ok: false,
      error: err.code || 'config_edit_failed',
      message: err.message,
    };
  }

  const action = targetValue ? 'admin.start' : 'admin.stop';

  if (!result.changed) {
    return {
      ok: true,
      action,
      restart: false,
      noop: true,
      message: `admin già in stato ${targetValue ? 'running' : 'stopped'}, nessuna azione`,
    };
  }

  const supervisor = detectSupervisor();
  const restartMode = supervisor ? 'supervisor' : 'self-respawn';

  if (typeof requestRestart === 'function') {
    setImmediate(() => requestRestart({ reason: action, mode: restartMode }));
  }

  return {
    ok: true,
    action,
    restart: true,
    restartMode,
    supervisor,
    message: supervisor
      ? `config aggiornato; processo in chiusura, ${supervisor} si occuperà del riavvio`
      : 'config aggiornato; riavvio del processo in corso (self-respawn)',
  };
}

// Commuta una delle due superfici governate da un gate a runtime ('public' o
// 'reserved'). Entrambe funzionano allo stesso modo — scrittura nello state file
// (per sopravvivere al riavvio) + applicazione immediata sul gate in memoria —
// quindi condividono un solo handler invece di due copie da tenere allineate.
function handleRuntimeSurfaceToggle(ctx, surface, targetValue) {
  const { statePath } = ctx;
  const targetLabel = targetValue ? 'running' : 'stopped';
  const action = `${surface}.${targetValue ? 'start' : 'stop'}`;
  const applyToGate = surface === 'public' ? ctx.setPublicState : ctx.setReservedState;

  let currentState;
  try {
    currentState = readState(statePath);
  } catch (err) {
    return { ok: false, error: 'state_read_failed', message: err.message };
  }

  if (currentState[surface] === targetLabel) {
    return {
      ok: true,
      action,
      restart: false,
      noop: true,
      message: `${surface} già in stato ${targetLabel}, nessuna azione`,
    };
  }

  // Lo state file va riscritto INTERO: writeState normalizza l'oggetto ricevuto,
  // quindi passare solo la chiave toccata riporterebbe l'altra superficie al suo
  // default (un `reserved stop` spegnerebbe di nascosto una manutenzione attiva).
  try {
    writeState({ ...currentState, [surface]: targetLabel }, statePath);
  } catch (err) {
    return { ok: false, error: 'state_write_failed', message: err.message };
  }

  if (typeof applyToGate === 'function') {
    applyToGate(targetLabel);
  }

  return {
    ok: true,
    action,
    restart: false,
    message: `${surface} ${targetLabel} applicato a runtime (nessun riavvio richiesto)`,
  };
}

// Reset ONLINE (a caldo via socket): rimuove i config vivi del plugin/tema e
// richiede un restart. Al riavvio, materializeMissingConfigs li rigenera dai
// default. Riusa lo stesso resetConfigsToDefault del reset offline.
async function handleReset(ctx, request) {
  const { configPath, projectRoot, requestRestart } = ctx;
  const root = projectRoot || (configPath ? path.dirname(configPath) : process.cwd());

  const target = request && request.target;
  const isTheme = !!(request && request.theme);

  if (typeof target !== 'string' || !/^[A-Za-z0-9_-]+$/.test(target)) {
    return { ok: false, error: 'invalid_target', message: `target non valido: ${JSON.stringify(target)} (ammessi lettere, numeri, _ e -)` };
  }

  const base = isTheme ? 'themes' : 'plugins';
  const dir = path.join(root, base, target);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, error: 'target_not_found', message: `target non trovato: ${base}/${target}` };
  }

  let result;
  try {
    result = await resetConfigsToDefault(dir);
  } catch (err) {
    return { ok: false, error: 'reset_failed', message: err.message };
  }

  if (result.removed.length === 0) {
    return {
      ok: true, action: 'reset', target, restart: false, noop: true,
      removed: [], message: `${base}/${target} è già allo stato di default, nessuna azione`,
    };
  }

  const supervisor = detectSupervisor();
  const restartMode = supervisor ? 'supervisor' : 'self-respawn';
  if (typeof requestRestart === 'function') {
    setImmediate(() => requestRestart({ reason: 'reset', mode: restartMode }));
  }

  return {
    ok: true,
    action: 'reset',
    target,
    restart: true,
    restartMode,
    supervisor,
    removed: result.removed,
    userDataFiles: result.userDataFiles,
    message: supervisor
      ? `reset di ${base}/${target}: ${result.removed.length} file rimossi; ${supervisor} riavvierà per rigenerare dai default`
      : `reset di ${base}/${target}: ${result.removed.length} file rimossi; riavvio (self-respawn) per rigenerare dai default`,
  };
}

// ── publicOnly: assetto "sito vetrina" ────────────────────────────────────────
// MACRO trasparente, non un quarto stato: compone leve che restano usabili anche
// singolarmente, così `status` continua a dire la verità su tre righe e non
// esistono combinazioni contraddittorie da arbitrare.
//
//   on  → reserved stop + admin stop + dirListing.wwwPath false
//   off → reserved start + admin start        (dirListing NON viene ritoccato)
//
// PERCHE' `off` NON RIACCENDE dirListing: sarebbe l'unico effetto della macro a
// ripristinare una condizione peggiore di quella in cui ha trovato il sito. Il
// listing di directory pubblico non e' un pezzo dell'assetto vetrina da
// annullare, e' un'impostazione che quasi nessun sito in produzione vuole: chi lo
// desidera lo riattiva esplicitamente nel config. `off` riporta l'ESPOSIZIONE al
// normale, non il file di configurazione a com'era.
//
// NB: il passo su dirListing richiede koa-classic-server >= 5.2.0. Nella 5.1.0
// `enabled: false` disabilitava anche la risoluzione del file indice (404 sulla
// radice del sito), quindi il passo era stato deliberatamente omesso in attesa
// della correzione nel modulo. Vincolo espresso dal range in package.json.
async function handlePublicOnly(ctx, turnOn) {
  const { configPath, requestRestart } = ctx;
  const action = `publicOnly.${turnOn ? 'on' : 'off'}`;
  const steps = [];

  // ORDINE — prima il passo che può fallire, poi quello che non fallisce.
  // `writeEnableAdmin` legge e riscrive un file e può sollevare (config assente,
  // formato non standard, disco pieno); il toggle della superficie è una
  // scrittura di stato molto più semplice. Facendo prima il toggle, un fallimento
  // del secondo passo restituiva `ok:false` lasciando però la superficie già
  // commutata E persistita: `publicOnly off` poteva riaprire l'area riservata e
  // riportare un errore, il peggior esito possibile. Invertendo, un fallimento
  // lascia il sistema esattamente com'era.

  // 1. Area admin (riscrive enableAdmin: richiede riavvio) — passo fallibile
  let adminChanged = false;
  try {
    const adminResult = writeEnableAdmin(configPath, !turnOn);
    adminChanged = adminResult.changed;
    steps.push(`admin ${!turnOn ? 'running' : 'stopped'}${adminChanged ? '' : ' (già così)'}`);
  } catch (err) {
    return { ok: false, action, error: err.code || 'config_edit_failed', message: err.message };
  }

  // 2. Directory listing pubblico (solo in accensione — vedi commento sopra).
  //    Anche questo e' un passo fallibile che tocca il config: sta quindi PRIMA
  //    del toggle della superficie, per la stessa ragione di ordine.
  let dirListingChanged = false;
  if (turnOn) {
    try {
      const dirListingResult = await setJson5Key(configPath, ['dirListing', 'wwwPath'], false);
      dirListingChanged = dirListingResult.action !== 'unchanged';
      steps.push(`dirListing.wwwPath false${dirListingChanged ? '' : ' (già così)'}`);
    } catch (err) {
      // Non fatale: l'assetto vetrina regge anche senza questo passo (la chiusura
      // della superficie riservata, che e' il cuore, e' gia' avvenuta o sta per
      // avvenire), e interrompere qui lascerebbe il sistema a meta'.
      steps.push(`dirListing.wwwPath NON modificato (${err.message})`);
    }
  }

  // 3. Superficie riservata (runtime, senza riavvio)
  const reservedResult = handleRuntimeSurfaceToggle(ctx, 'reserved', !turnOn);
  if (!reservedResult.ok) return { ...reservedResult, action };
  steps.push(`reserved ${!turnOn ? 'running' : 'stopped'}${reservedResult.noop ? ' (già così)' : ''}`);

  // Il riavvio serve solo se qualcosa che si applica al boot è cambiato davvero:
  // enableAdmin e dirListing sono letti all'avvio, la superficie riservata no.
  const needsRestart = adminChanged || dirListingChanged;
  if (!needsRestart) {
    return {
      ok: true, action, restart: false,
      noop: reservedResult.noop === true,
      steps,
      message: `assetto ${turnOn ? 'publicOnly' : 'normale'} già in vigore: ${steps.join(', ')}`,
    };
  }

  const supervisor = detectSupervisor();
  const restartMode = supervisor ? 'supervisor' : 'self-respawn';
  if (typeof requestRestart === 'function') {
    setImmediate(() => requestRestart({ reason: action, mode: restartMode }));
  }

  return {
    ok: true,
    action,
    restart: true,
    restartMode,
    supervisor,
    steps,
    message: `assetto ${turnOn ? 'publicOnly' : 'normale'} applicato (${steps.join(', ')}); riavvio in corso`,
  };
}

function makeDispatcher(ctx) {
  return async function dispatch(command, request = {}) {
    switch (command) {
      case 'status': return buildStatus(ctx);
      case 'admin.start': return handleAdminToggle(ctx, true);
      case 'admin.stop': return handleAdminToggle(ctx, false);
      case 'public.start': return handleRuntimeSurfaceToggle(ctx, 'public', true);
      case 'public.stop': return handleRuntimeSurfaceToggle(ctx, 'public', false);
      case 'reserved.start': return handleRuntimeSurfaceToggle(ctx, 'reserved', true);
      case 'reserved.stop': return handleRuntimeSurfaceToggle(ctx, 'reserved', false);
      case 'publicOnly.on': return handlePublicOnly(ctx, true);
      case 'publicOnly.off': return handlePublicOnly(ctx, false);
      case 'reset': return handleReset(ctx, request);
      default:
        return {
          ok: false,
          error: 'unknown_command',
          message: `comando sconosciuto: ${JSON.stringify(command)}`,
        };
    }
  };
}

const KNOWN_COMMANDS = [
  'status',
  'admin.start', 'admin.stop',
  'public.start', 'public.stop',
  'reserved.start', 'reserved.stop',
  'publicOnly.on', 'publicOnly.off',
  'reset',
];

module.exports = { makeDispatcher, KNOWN_COMMANDS };
