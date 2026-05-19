const fs = require('fs');
const path = require('path');
const loadJson5 = require('../loadJson5');

const DEFAULT_STATE_PATH = path.join(__dirname, 'state.json5');

const VALID_STATES = ['running', 'stopped'];
const DEFAULT_STATE = { public: 'running' };

function readState(statePath = DEFAULT_STATE_PATH) {
  if (!fs.existsSync(statePath)) return { ...DEFAULT_STATE };
  try {
    const data = loadJson5(statePath);
    return normalizeState(data);
  } catch (err) {
    console.warn(
      `[cliBridge] state file ${statePath} non leggibile (${err.message}). ` +
      `Uso default: ${JSON.stringify(DEFAULT_STATE)}`
    );
    return { ...DEFAULT_STATE };
  }
}

function writeState(state, statePath = DEFAULT_STATE_PATH) {
  const normalized = normalizeState(state);
  const header = '// This file follows the JSON5 standard - written by cliBridge, do not edit by hand\n';
  const body = JSON.stringify(normalized, null, 2);
  const tempPath = statePath + '.tmp';
  fs.writeFileSync(tempPath, header + body + '\n', 'utf8');
  fs.renameSync(tempPath, statePath);
  return normalized;
}

function normalizeState(raw) {
  const out = { ...DEFAULT_STATE };
  if (raw && typeof raw === 'object' && VALID_STATES.includes(raw.public)) {
    out.public = raw.public;
  }
  return out;
}

module.exports = {
  readState,
  writeState,
  DEFAULT_STATE_PATH,
  DEFAULT_STATE,
  VALID_STATES,
};
