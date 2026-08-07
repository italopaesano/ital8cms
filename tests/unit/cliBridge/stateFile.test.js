const fs = require('fs');
const os = require('os');
const path = require('path');
const { readState, writeState, DEFAULT_STATE, FALLBACK_STATE_ON_CORRUPTION } = require('../../../core/cliBridge/stateFile');

function tmpStatePath() {
  return path.join(os.tmpdir(), `ital8cms-state-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json5`);
}

describe('readState', () => {
  test('returns default state when file is missing', () => {
    const p = tmpStatePath();
    expect(fs.existsSync(p)).toBe(false);
    expect(readState(p)).toEqual(DEFAULT_STATE);
  });

  test('reads valid stored state', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '// header\n{ "public": "stopped" }\n', 'utf8');
    // reserved assente: chiave semplicemente non ancora scritta (installazione
    // che precede la sua introduzione), NON corruzione → default aperto.
    try { expect(readState(p)).toEqual({ public: 'stopped', reserved: 'running' }); }
    finally { fs.unlinkSync(p); }
  });

  test('reads a stored reserved state', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '{ "public": "running", "reserved": "stopped" }', 'utf8');
    try { expect(readState(p)).toEqual({ public: 'running', reserved: 'stopped' }); }
    finally { fs.unlinkSync(p); }
  });

  // FAIL-CLOSED: un file illeggibile lascia public aperto (un falso 503 su tutto
  // il sito è un danno certo) ma chiude reserved (non sappiamo se debba stare
  // chiusa: la risposta prudente è chiuderla, il control plane la riapre).
  test('falls back to fail-closed reserved when file is invalid JSON', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, 'this is not json5', 'utf8');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readState(p)).toEqual(FALLBACK_STATE_ON_CORRUPTION);
      expect(readState(p).reserved).toBe('stopped');
      expect(readState(p).public).toBe('running');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      fs.unlinkSync(p);
    }
  });

  // Il file ASSENTE non è corruzione: è il clone fresco, e deve partire aperto —
  // altrimenti una nuova installazione nascerebbe senza login raggiungibile.
  test('missing file is NOT treated as corruption (reserved stays open)', () => {
    const p = tmpStatePath();
    expect(readState(p).reserved).toBe('running');
  });

  test('normalizes unknown reserved value to default', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '{ "public": "running", "reserved": "weird" }', 'utf8');
    try { expect(readState(p).reserved).toBe('running'); }
    finally { fs.unlinkSync(p); }
  });

  test('normalizes unknown public value to default', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '{ "public": "weird" }', 'utf8');
    try { expect(readState(p)).toEqual(DEFAULT_STATE); }
    finally { fs.unlinkSync(p); }
  });
});

describe('writeState', () => {
  test('writes state and is readable back', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      expect(fs.existsSync(p)).toBe(true);
      expect(readState(p)).toEqual({ public: 'stopped', reserved: 'running' });
    } finally { fs.unlinkSync(p); }
  });

  test('write is atomic (tmp + rename)', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      // no leftover .tmp file
      expect(fs.existsSync(p + '.tmp')).toBe(false);
    } finally { fs.unlinkSync(p); }
  });

  test('writes the do-not-edit-by-hand header', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'running' }, p);
      const content = fs.readFileSync(p, 'utf8');
      expect(content).toMatch(/^\/\/.*do not edit by hand/);
    } finally { fs.unlinkSync(p); }
  });

  test('round-trip stopped → running → stopped preserves state', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      expect(readState(p).public).toBe('stopped');
      writeState({ public: 'running' }, p);
      expect(readState(p).public).toBe('running');
      writeState({ public: 'stopped' }, p);
      expect(readState(p).public).toBe('stopped');
    } finally { fs.unlinkSync(p); }
  });
});
