const fs = require('fs');
const path = require('path');
const loadJson5 = require('../loadJson5');

const DEFAULT_STATE_PATH = path.join(__dirname, 'state.json5');

const VALID_STATES = ['running', 'stopped'];

// Stato di partenza di un'installazione che il control plane non ha mai toccato
// (file assente): tutto acceso. È il caso del clone fresco, NON una condizione
// d'errore — vedi readState() per la distinzione con il file corrotto.
const DEFAULT_STATE = { public: 'running', reserved: 'running' };

// Stato di ripiego quando il file ESISTE ma non è leggibile/parsabile.
//
// ASIMMETRIA VOLUTA fra i due gate:
//   • public   → 'running' (fail-OPEN): un file corrotto non deve mettere in
//                manutenzione un sito sano; il danno di un falso 503 su tutto il
//                pubblico è certo, quello di restare online è nullo.
//   • reserved → 'stopped' (fail-CLOSED): qui il rapporto si inverte. Se non
//                sappiamo se la superficie riservata debba essere chiusa, la
//                risposta prudente è chiuderla — l'amministratore ha comunque il
//                control plane per riaprirla (`reserved start`), mentre una
//                riapertura silenziosa vanificherebbe l'assetto vetrina proprio
//                nel momento in cui qualcosa è andato storto.
const FALLBACK_STATE_ON_CORRUPTION = { public: 'running', reserved: 'stopped' };

function readState(statePath = DEFAULT_STATE_PATH) {
  // File assente = installazione nuova o control plane mai usato: default aperti.
  if (!fs.existsSync(statePath)) return { ...DEFAULT_STATE };
  try {
    const data = loadJson5(statePath);
    return normalizeState(data);
  } catch (err) {
    console.warn(
      `[cliBridge] state file ${statePath} non leggibile (${err.message}). ` +
      `Uso il ripiego prudente: ${JSON.stringify(FALLBACK_STATE_ON_CORRUPTION)} ` +
      `(la superficie riservata resta CHIUSA; riaprila con: npm run cli -- reserved start)`
    );
    return { ...FALLBACK_STATE_ON_CORRUPTION };
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

// Una chiave MANCANTE (o con valore non valido) in un file per il resto leggibile
// non è corruzione: è un'installazione che precede l'introduzione di quella
// chiave. Ricade quindi sul default APERTO, non sul ripiego fail-closed — che
// vale solo quando il file intero è illeggibile (vedi readState).
function normalizeState(raw) {
  const out = { ...DEFAULT_STATE };
  if (raw && typeof raw === 'object') {
    if (VALID_STATES.includes(raw.public)) out.public = raw.public;
    if (VALID_STATES.includes(raw.reserved)) out.reserved = raw.reserved;
  }
  return out;
}

module.exports = {
  readState,
  writeState,
  DEFAULT_STATE_PATH,
  DEFAULT_STATE,
  FALLBACK_STATE_ON_CORRUPTION,
  VALID_STATES,
};
